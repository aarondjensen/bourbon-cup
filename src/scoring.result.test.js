// ══════════════════════════════════════════════════════════════════
//  A match result is what stood on the hole it was decided
// ══════════════════════════════════════════════════════════════════
//
// The Bourbon Cup plays every hole of every round out, whatever the 18-hole
// match did — the two nine pots outlive it, and the skins and the total
// outlive those. So the running margin keeps moving after the match itself is
// over, and reading a result off it drifts one hole per hole, in both
// directions at once: the lead grows while the holes left shrink.
//
// That drift produced a score golf cannot produce. A match 8 up with 6 to
// play is over — 8&6 — and playing the next two holes had the app announce it
// as "10&4" on the Scoring tab while the Full Scorecard, which found the
// closing hole itself, stamped 8&6 on the twelfth. Played all the way to 18
// the same reading printed "6 UP" for a nine that ended 4&3.
import { describe, it, expect } from "vitest";
import { segmentState, statusText, verdictText } from "./scoring";

// A segment from a string of hole winners: "A" / "B" / "-" halved / "." not
// yet played. Scores are what segmentState counts holes with; the winner is
// what it counts holes BY, so only the winner has to be honest here.
const seg = (s, opts) => segmentState(
  [...s].map((c, h) => ({
    h,
    played: c !== ".",
    winner: c === "A" || c === "B" ? c : null,
    aScore: c === "." ? null : 4,
    bScore: c === "." ? null : 4,
  })),
  opts,
);

describe("a match that closes out early", () => {
  it("is over on the hole the lead outgrew the holes left", () => {
    // 7 up after 11 is not over — seven holes are left and seven can be won
    // back. The twelfth makes it eight, and eight cannot be.
    const st = seg("AAAAAAAAABBA......");
    expect(st.decided).toEqual({ margin: 8, remaining: 6, at: 11 });
    expect(st.clinched).toBe(true);
    expect(st.complete).toBe(true);
    expect(st.winner).toBe("A");
    expect(statusText(st)).toBe("8&6");
  });

  it("keeps that result when the group plays the rest of the holes", () => {
    // The same twelve holes, then six more that go 4-2 to A. The running
    // margin ends at 10 with nothing left; the match is still 8&6.
    const st = seg("AAAAAAAAABBAAABAAB");
    expect(st.margin).toBe(10);          // running, and still true
    expect(statusText(st)).toBe("8&6");  // the result, and unmoved
  });

  it("does not report a lead that outlived its own holes", () => {
    // The shape the demo threw: down 8 with 6 to play, scored on to the
    // fourteenth. Ten down with four to play is not a score.
    const st = seg("BBBBBBBBBAABBB....");
    expect(statusText(st)).toBe("8&6");
    expect(statusText(st)).not.toBe("10&4");
  });

  it("reports a nine that closed on the sixth as 4&3, not 7 UP", () => {
    const st = seg("BBB--BBBB");
    expect(st.decided).toEqual({ margin: -4, remaining: 3, at: 5 });
    expect(st.margin).toBe(-7);
    expect(statusText(st)).toBe("4&3");
  });
});

describe("a match that goes the distance", () => {
  it("reads N UP when it is decided on the last hole", () => {
    const st = seg("AABBAABB-AABB-AAB-");
    expect(st.decided).toEqual({ margin: 1, remaining: 0, at: 17 });
    expect(statusText(st)).toBe("1 UP");
  });

  it("is all square when nobody is ahead at the end", () => {
    const st = seg("AAAAAAAAABBBBBBBBB");
    expect(st.decided).toBe(null);
    expect(st.clinched).toBe(false);
    expect(st.complete).toBe(true);
    expect(st.winner).toBe(null);
    expect(statusText(st)).toBe("AS");
  });

  it("reads the running margin while it is still live", () => {
    const st = seg("AAB..............."); // 1 up through 3
    expect(st.decided).toBe(null);
    expect(statusText(st)).toBe("1 UP");
  });
});

describe("a hole nobody has scored yet", () => {
  it("is still a hole to play, so the match is not over on the ninth", () => {
    // Every hole in but the second, and one up. That one hole can square it,
    // so this is live — and `complete` has to say so, or the pot pays out on
    // a nine somebody is still walking back to.
    const st = seg("A.-------");
    expect(st.decided).toBe(null);
    expect(st.complete).toBe(false);
    expect(statusText(st)).toBe("1 UP");
  });

  it("pushes the closeout back by exactly the hole it is", () => {
    const clean = seg("AAAAAA...");
    const gapped = seg("A.AAAAA..");
    expect(clean.decided).toEqual({ margin: 5, remaining: 4, at: 4 });
    expect(gapped.decided).toEqual({ margin: 5, remaining: 4, at: 5 });
    expect(statusText(clean)).toBe("5&4");
    expect(statusText(gapped)).toBe("5&4");
  });
});

describe("the formats that never close early", () => {
  it("a Total segment has no result until the last hole", () => {
    const st = seg("AAAAAAAAAAAAAAAAAA", { total: true });
    expect(st.decided).toBe(undefined);
    expect(st.clinched).toBe(false);
  });

  it("a points segment banks hole by hole and reads as a lead", () => {
    const st = seg("AAAAAAAAAAAA......", { holeValue: () => 1 });
    expect(st.decided).toBe(undefined);
    expect(statusText(st)).toBe("+12");
  });
});

// ── The same result, said to the man reading it ─────────────────────
// The Scoring tab's FRONT / OVERALL / BACK chips answer "did I win it", so
// they say WON or LOST — and then pasted `statusText` on the end of that,
// which answers from TEAM A's side whoever is holding the phone. A front nine
// played out two down came back as "LOST 2 UP". You win two up and you lose
// two down; "lost 2 up" is not a thing anybody has said on a golf course.
describe("a settled match, from the reader's own side", () => {
  const A_WON_ON_18 = seg("AABBAABB-AABB-AAB-");   // 1 up, decided on the last

  it("is won UP and lost DOWN, never lost up", () => {
    expect(verdictText(A_WON_ON_18, "A")).toBe("WON 1 UP");
    expect(verdictText(A_WON_ON_18, "B")).toBe("LOST 1 DOWN");
  });

  it("reports the margin it finished on, not the running one", () => {
    // Three up through three and two down at the turn — the shape on screen
    // when this was found.
    const st = seg("AAA-BBBBB");
    expect(st.decided).toEqual({ margin: -2, remaining: 0, at: 8 });
    expect(verdictText(st, "A")).toBe("LOST 2 DOWN");
    expect(verdictText(st, "B")).toBe("WON 2 UP");
  });

  it("says a closeout the same way from either side", () => {
    // "3&2" IS the result and reads the same whoever lost it, so WON / LOST
    // carries all the direction it needs. Only a match that reached the last
    // hole has an up and a down to get backwards.
    const st = seg("AAAAAAAAABBA......");
    expect(verdictText(st, "A")).toBe("WON 8&6");
    expect(verdictText(st, "B")).toBe("LOST 8&6");
  });

  it("halves without taking a side", () => {
    expect(verdictText(seg("AAAAAAAAABBBBBBBBB"), "A")).toBe("HALVED");
    expect(verdictText(seg("AAAAAAAAABBBBBBBBB"), "B")).toBe("HALVED");
  });
});

describe("a live match, from the reader's own side", () => {
  it("flips the direction rather than leaving it to the colour", () => {
    const st = seg("AAB...............");   // A 1 up through 3
    expect(verdictText(st, "A")).toBe("1 UP");
    expect(verdictText(st, "B")).toBe("1 DOWN");
  });

  it("is all square to both of them", () => {
    const st = seg("AB................");
    expect(verdictText(st, "A")).toBe("AS");
    expect(verdictText(st, "B")).toBe("AS");
  });

  it("says nothing before a ball is struck", () => {
    expect(verdictText(seg(".................."), "A")).toBe("—");
  });
});

describe("the formats with no up and no down", () => {
  it("keeps a Total segment's signed lead and adds only the verdict", () => {
    const done = seg("AAAAAAAAAAAAAAAAAA", { total: true });
    // Every hole scored 4 apiece, so the totals are level however it is read.
    expect(verdictText(done, "A")).toBe("TIED");
  });

  it("leaves a live points segment as a bare lead", () => {
    const st = seg("AAAAAA............", { holeValue: () => 1 });
    expect(verdictText(st, "A")).toBe("+6");
    expect(verdictText(st, "B")).toBe("+6");
  });

  it("puts the verdict in front of a settled one and nothing else", () => {
    // "+12" is a magnitude, not a direction, so it takes WON / LOST without
    // contradicting either. There is no "up" in a currency where one hole can
    // be worth two of another — see statusText.
    const st = seg("AAAAAAAAAAAA......", { holeValue: () => 1 });
    expect(verdictText(st, "A")).toBe("WON +12");
    expect(verdictText(st, "B")).toBe("LOST +12");
  });
});
