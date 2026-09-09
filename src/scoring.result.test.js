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
import { segmentState, statusText } from "./scoring";

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

  it("was HALVED when nobody is ahead at the end", () => {
    // The past tense is the whole of it: this match is over and paid out half
    // a point each. All square is what it was on the 17th tee.
    const st = seg("AAAAAAAAABBBBBBBBB");
    expect(st.decided).toBe(null);
    expect(st.clinched).toBe(false);
    expect(st.complete).toBe(true);
    expect(st.winner).toBe(null);
    expect(statusText(st)).toBe("HALVED");
  });

  it("is ALL SQUARE while it is still level and still live", () => {
    const st = seg("AB................"); // level through 2
    expect(st.complete).toBe(false);
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

// ── One word for level, in every currency ───────────────────────────
// Golf has never called this tied. A level match still being played is ALL
// SQUARE; one that finished level was HALVED, and the past tense is the whole
// of the difference — a halved match paid out, half a point each.
//
// "TIED" was the wording on a Total or points segment, on the reasoning that
// neither has an "up" to be square about. That put one outcome under two
// names across four screens: the card said HALVED on a nine and TIED on the
// round below it, the Leaderboard said "½" for match play and TIED for the
// rest. The distinction that matters is not the currency, it is the tense.
describe("a segment that is level", () => {
  const units = [
    ["match play", undefined],
    ["a Total round", { total: true }],
    ["a points round", { holeValue: () => 1 }],
  ];

  units.forEach(([name, opts]) => {
    it(`is ALL SQUARE while ${name} is still live`, () => {
      expect(statusText(seg("AB................", opts))).toBe("AS");
    });

    it(`was HALVED once ${name} is over`, () => {
      expect(statusText(seg("ABABABABABABABABAB", opts))).toBe("HALVED");
    });
  });

  it("says neither before a ball is struck", () => {
    expect(statusText(seg("..................", { total: true }))).toBe("—");
  });
});
