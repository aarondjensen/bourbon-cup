import { describe, it, expect } from "vitest";
import { amendmentNotices, bodyFor, byPlayer, settingBody, MAX_BODY } from "./amendmentNotice.js";

// One amendment's worth of rows, in the shape src/lib/scoreEdits writes.
const score = (player_id, hole_number, from, to) =>
  ({ player_id, kind: "score", hole_number, from, to });
const handicap = (player_id, from, to) =>
  ({ player_id, kind: "handicap", from, to });
// Round-level: no player on it, because it reaches everybody who played.
const setting = (field, label, from, to) => ({ kind: "setting", field, label, from, to });

// Two fourballs. a1/a2 v b1/b2, and c1 v d1.
const MATCHMATES = {
  a1: ["a2", "b1", "b2"], a2: ["a1", "b1", "b2"],
  b1: ["a1", "a2", "b2"], b2: ["a1", "a2", "b1"],
  c1: ["d1"], d1: ["c1"],
};

describe("byPlayer", () => {
  it("folds a player's holes into one entry, in hole order", () => {
    const g = byPlayer([score("a1", 12, 5, 4), score("a1", 3, 6, 5), score("a1", 7, 4, 3)]);
    expect(g.get("a1").scores.map(s => s.hole)).toEqual([3, 7, 12]);
  });

  it("keeps a handicap move beside the holes rather than as a hole", () => {
    const g = byPlayer([score("a1", 7, 5, 4), handicap("a1", 12, 14)]);
    expect(g.get("a1").scores).toHaveLength(1);
    expect(g.get("a1").handicap).toEqual({ from: 12, to: 14 });
  });

  it("ignores a row with no player on it", () => {
    expect(byPlayer([{ kind: "score", hole_number: 7 }, null]).size).toBe(0);
  });
});

describe("bodyFor — the man whose card moved", () => {
  const of = (edits) => bodyFor({ round: 2, entry: byPlayer(edits).get("a1"), matchOnly: false });

  it("gives both numbers for a single corrected hole", () => {
    expect(of([score("a1", 7, 5, 4)])).toBe("Round 2: hole 7 now 4 (was 5).");
  });

  // Two numbers per hole stops fitting fast, and a partial list read as a
  // complete one is the notification misinforming its only careful reader.
  it("lists the holes and counts the rest once there are several", () => {
    const body = of([score("a1", 3, 6, 5), score("a1", 7, 5, 4), score("a1", 12, 4, 5), score("a1", 16, 3, 4)]);
    expect(body).toBe("Round 2: holes 3, 7, 12 +1 changed.");
  });

  it("says so when a hole was never entered", () => {
    expect(of([score("a1", 7, null, 5)])).toBe("Round 2: hole 7 now 5 (was –).");
    expect(of([score("a1", 7, 5, null)])).toBe("Round 2: hole 7 now – (was 5).");
  });

  // The half a player would otherwise never be told about: his strokes moved
  // without a single number on his card changing.
  it("reports a moved handicap on its own", () => {
    expect(of([handicap("a1", 12, 14)])).toBe("Round 2: handicap 12 → 14.");
  });

  it("reports both when both moved", () => {
    expect(of([score("a1", 7, 5, 4), handicap("a1", 12, 14)]))
      .toBe("Round 2: hole 7 now 4 (was 5), handicap 12 → 14.");
  });

  it("stays inside the tray's budget", () => {
    const many = Array.from({ length: 18 }, (_, i) => score("a1", i + 1, 5, 4));
    const body = bodyFor({ round: 2, entry: byPlayer([...many, handicap("a1", 12, 14)]).get("a1"), matchOnly: false });
    expect(body.length).toBeLessThanOrEqual(MAX_BODY);
  });
});

describe("bodyFor — his playing partners", () => {
  // Deliberately vague. A push that names whose hole moved hands one player a
  // result about another before either has opened the app.
  it("says a card in the match moved without naming whose", () => {
    const body = bodyFor({ round: 2, entry: null, matchOnly: true });
    expect(body).toBe("A card in your Round 2 match was corrected — open Scoring to see it.");
    expect(body).not.toMatch(/hole \d/);
  });
});

describe("amendmentNotices", () => {
  it("tells the man whose card moved, and everybody who signed it with him", () => {
    const out = amendmentNotices({ round: 2, edits: [score("a1", 7, 5, 4)], matchmates: MATCHMATES });
    expect(out.map(n => n.playerId).sort()).toEqual(["a1", "a2", "b1", "b2"]);
    expect(out.find(n => n.playerId === "a1").ownCard).toBe(true);
    expect(out.filter(n => n.ownCard)).toHaveLength(1);
  });

  it("leaves the rest of the field out of it", () => {
    const out = amendmentNotices({ round: 2, edits: [score("a1", 7, 5, 4)], matchmates: MATCHMATES });
    expect(out.map(n => n.playerId)).not.toContain("c1");
    expect(out.map(n => n.playerId)).not.toContain("d1");
  });

  // The specific news must win. A man whose own hole moved and who is also
  // somebody else's matchmate has to get his own numbers, not the vague line.
  it("never lets the match line overwrite a man's own card", () => {
    const out = amendmentNotices({
      round: 2, edits: [score("a1", 7, 5, 4), score("b1", 3, 6, 5)], matchmates: MATCHMATES,
    });
    const a1 = out.find(n => n.playerId === "a1");
    const b1 = out.find(n => n.playerId === "b1");
    expect(a1.ownCard).toBe(true);
    expect(a1.body).toMatch(/hole 7/);
    expect(b1.ownCard).toBe(true);
    expect(b1.body).toMatch(/hole 3/);
    // And nobody is told twice.
    expect(new Set(out.map(n => n.playerId)).size).toBe(out.length);
  });

  it("still tells a man with no match at all about his own card", () => {
    const out = amendmentNotices({ round: 2, edits: [score("solo", 7, 5, 4)], matchmates: {} });
    expect(out).toHaveLength(1);
    expect(out[0].playerId).toBe("solo");
    expect(out[0].ownCard).toBe(true);
  });

  // The common amendment: reopened to fix a Nassau pot or a format, which
  // moves nobody's card. Sending "your card was corrected" to a field whose
  // cards are untouched would be the app inventing an alarm.
  it("sends nothing when no card moved", () => {
    expect(amendmentNotices({ round: 2, edits: [], matchmates: MATCHMATES })).toEqual([]);
    expect(amendmentNotices({ round: 2, edits: null, matchmates: MATCHMATES })).toEqual([]);
  });

  it("titles the two groups differently", () => {
    const out = amendmentNotices({ round: 3, edits: [score("a1", 7, 5, 4)], matchmates: MATCHMATES });
    expect(out.find(n => n.playerId === "a1").title).toBe("Your Round 3 card was corrected");
    expect(out.find(n => n.playerId === "a2").title).toBe("Round 3 was corrected");
  });
});

// A corrected allowance moves every stroke in the round and not one stored
// Course Handicap, so this path is the ONLY thing that tells the field about
// the most consequential correction a director can make.
describe("round-level changes", () => {
  it("names the term that moved and both its values", () => {
    expect(settingBody({ round: 2, settings: [setting("allowance", "Handicap allowance", "100%", "50%")] }))
      .toBe("Round 2: Handicap allowance 100% → 50%. Your strokes may have moved.");
  });

  it("folds several into one sentence", () => {
    const body = settingBody({ round: 2, settings: [
      setting("allowance", "Handicap allowance", "100%", "50%"),
      setting("handicap_mode", "Handicap mode", "full", "low_man"),
    ] });
    expect(body).toBe("Round 2: Handicap allowance and Handicap mode changed — your strokes may have moved.");
    expect(body.length).toBeLessThanOrEqual(MAX_BODY);
  });

  it("reaches everybody who played, not just one card", () => {
    const out = amendmentNotices({
      round: 2, edits: [setting("allowance", "Handicap allowance", "100%", "50%")], matchmates: MATCHMATES,
    });
    expect(out.map(n => n.playerId).sort()).toEqual(["a1", "a2", "b1", "b2", "c1", "d1"]);
    expect(out.every(n => n.ownCard === false)).toBe(true);
  });

  // A man whose own hole moved AND who played under a corrected allowance is
  // owed the specific news. The round-wide line must not displace it.
  it("never displaces a man's own corrected hole", () => {
    const out = amendmentNotices({
      round: 2,
      edits: [score("a1", 7, 5, 4), setting("allowance", "Handicap allowance", "100%", "50%")],
      matchmates: MATCHMATES,
    });
    const a1 = out.find(n => n.playerId === "a1");
    expect(a1.ownCard).toBe(true);
    expect(a1.body).toMatch(/hole 7/);
    expect(out.find(n => n.playerId === "c1").body).toMatch(/Handicap allowance/);
  });

  // The round-wide line says WHAT moved; the matchmate line only points at
  // somebody else's card. When both apply, the informative one wins.
  it("prefers the round-wide line over the vaguer matchmate one", () => {
    const out = amendmentNotices({
      round: 2,
      edits: [score("a1", 7, 5, 4), setting("allowance", "Handicap allowance", "100%", "50%")],
      matchmates: MATCHMATES,
    });
    expect(out.find(n => n.playerId === "b1").body).toMatch(/Handicap allowance/);
  });

  it("counts a setting row as something to say even with no card edits", () => {
    expect(amendmentNotices({
      round: 2, edits: [setting("course_id", "Course", "c1", "c2")], matchmates: MATCHMATES,
    })).toHaveLength(6);
  });
});
