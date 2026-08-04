import { describe, it, expect } from "vitest";
import {
  holesEntered, roundScoreProgress, scoredAmong,
  matchScoreImpact, orphanedScores, incomingScores,
  describeScored, totalHoles,
} from "./scoreGuard";

// These functions are what stands between a director and a draw edit that
// silently strands somebody's morning. They are pure, they read a plain map,
// and every one of their answers goes on screen in front of a destructive
// tap — which makes them exactly the code worth pinning down.

// holeData[`${pid}_${round}`][holeIdx] = gross
const hd = (entries) => entries;
// n holes posted for a player in a round.
const card = (n, s = 4) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i, s]));

const match = (round, teamA, teamB, id = `m${round}`) => ({ id, round, teamA, teamB });

describe("holesEntered", () => {
  it("counts the holes a player has posted in a round", () => {
    expect(holesEntered(hd({ p1_1: card(7) }), "p1", 1)).toBe(7);
  });

  // A cleared score writes a 0 rather than deleting the document — the whole
  // file reads "has a score" as `> 0` so that a cleared hole never counts as
  // played anywhere.
  it("does not count a cleared score", () => {
    expect(holesEntered(hd({ p1_1: { ...card(4), 2: 0 } }), "p1", 1)).toBe(3);
  });

  it("is zero for a player, round or map that isn't there", () => {
    expect(holesEntered(hd({ p1_1: card(4) }), "p1", 2)).toBe(0);
    expect(holesEntered(hd({ p1_1: card(4) }), "p9", 1)).toBe(0);
    expect(holesEntered(undefined, "p1", 1)).toBe(0);
  });

  // Scores are keyed by player + ROUND, so the same player in round 2 is a
  // different card. This is the property that lets a card survive re-pairing.
  it("keeps rounds separate", () => {
    const data = hd({ p1_1: card(18), p1_2: card(3) });
    expect(holesEntered(data, "p1", 1)).toBe(18);
    expect(holesEntered(data, "p1", 2)).toBe(3);
  });
});

describe("roundScoreProgress", () => {
  it("counts every player in every match of the round", () => {
    const matches = [match(1, ["a", "b"], ["c", "d"]), match(1, ["e"], ["f"], "m1b")];
    const data = hd({ a_1: card(18), b_1: card(18), c_1: card(18), d_1: card(9), e_1: card(18), f_1: card(18) });
    const r = roundScoreProgress(matches, data, 1);
    expect(r.total).toBe(6 * 18);
    expect(r.entered).toBe(5 * 18 + 9);
    expect(r.missing).toBe(9);
    expect(r.complete).toBe(false);
  });

  it("is complete only when every hole of every card is in", () => {
    const matches = [match(2, ["a"], ["b"])];
    const data = hd({ a_2: card(18), b_2: card(18) });
    expect(roundScoreProgress(matches, data, 2).complete).toBe(true);
  });

  // An empty round is not a finished one. Without this, a round with no draw
  // would report 0/0 = complete and fire the ready-to-finalize notification.
  it("does not call an empty round complete", () => {
    expect(roundScoreProgress([], hd({}), 1)).toMatchObject({ total: 0, complete: false });
    expect(roundScoreProgress(undefined, hd({}), 1)).toMatchObject({ total: 0, complete: false });
  });

  it("ignores matches from other rounds", () => {
    const matches = [match(1, ["a"], ["b"]), match(2, ["c"], ["d"], "m2")];
    expect(roundScoreProgress(matches, hd({}), 1).total).toBe(2 * 18);
  });

  it("returns nothing to do when the round is null", () => {
    expect(roundScoreProgress([match(1, ["a"], ["b"])], hd({}), null)).toMatchObject({ total: 0, complete: false });
  });

  // A player in two matches of the same round is still one card. Double
  // counting would push the round past 100% and finalize it early.
  it("counts a player once even if they appear twice in the round", () => {
    const matches = [match(1, ["a"], ["b"]), match(1, ["a"], ["c"], "m1b")];
    expect(roundScoreProgress(matches, hd({}), 1).total).toBe(3 * 18);
  });

  // A stray key outside 0–17 must not be able to push a partial round over
  // the line — `entered` is compared against pids × 18.
  it("clamps a card at 18 holes", () => {
    const data = hd({ a_1: { ...card(18), 99: 4, 100: 5 } });
    const r = roundScoreProgress([match(1, ["a"], [])], data, 1);
    expect(r.entered).toBe(18);
    expect(r.complete).toBe(true);
  });

  it("lists who is missing what, heaviest first", () => {
    const matches = [match(1, ["a", "b"], ["c"])];
    const data = hd({ a_1: card(18), b_1: card(10), c_1: card(2) });
    expect(roundScoreProgress(matches, data, 1).missingBy)
      .toEqual([{ pid: "c", missing: 16 }, { pid: "b", missing: 8 }]);
  });
});

describe("scoredAmong", () => {
  // The order matters: a confirmation reads this out, and it should open with
  // the player who has the most to lose.
  it("returns the heaviest card first and drops silent players", () => {
    const data = hd({ a_1: card(12), b_1: card(3), c_1: {} });
    expect(scoredAmong(data, 1, ["a", "b", "c"]))
      .toEqual([{ pid: "a", holes: 12 }, { pid: "b", holes: 3 }]);
  });

  it("de-duplicates the player list", () => {
    const data = hd({ a_1: card(5) });
    expect(scoredAmong(data, 1, ["a", "a", "a"])).toEqual([{ pid: "a", holes: 5 }]);
  });

  it("is empty for no players", () => {
    expect(scoredAmong(hd({}), 1, undefined)).toEqual([]);
  });
});

describe("matchScoreImpact", () => {
  // The number worth leading a warning with: four players eight holes deep is
  // "32 holes", and that reads as the morning it was.
  it("totals the holes across the whole match", () => {
    const data = hd({ a_1: card(8), b_1: card(8), c_1: card(8), d_1: card(8) });
    const r = matchScoreImpact({ match: match(1, ["a", "b"], ["c", "d"]), holeData: data });
    expect(r.holes).toBe(32);
    expect(r.hasScores).toBe(true);
    expect(r.scored).toHaveLength(4);
  });

  it("reports no scores for an untouched match", () => {
    const r = matchScoreImpact({ match: match(1, ["a"], ["b"]), holeData: hd({}) });
    expect(r).toMatchObject({ holes: 0, hasScores: false, scored: [] });
  });

  it("survives a missing match", () => {
    expect(matchScoreImpact({ match: undefined, holeData: hd({}) }))
      .toMatchObject({ holes: 0, hasScores: false });
  });

  // Deleting a round-1 match must not warn about round-2 holes.
  it("only counts the match's own round", () => {
    const data = hd({ a_1: card(4), a_2: card(18) });
    expect(matchScoreImpact({ match: match(1, ["a"], []), holeData: data }).holes).toBe(4);
  });
});

describe("orphanedScores", () => {
  // The wreckage of a delete that has already happened: live in the database,
  // invisible in every view. This is the difference between "the draw is
  // empty" and "the draw is empty and there are 22 holes underneath it".
  it("finds players carrying scores no match accounts for", () => {
    const players = [{ player_id: "a" }, { player_id: "b" }, { player_id: "c" }];
    const data = hd({ a_1: card(18), b_1: card(4), c_1: card(9) });
    const matches = [match(1, ["a"], [])];
    expect(orphanedScores({ holeData: data, matches, round: 1, players }))
      .toEqual([{ pid: "c", holes: 9 }, { pid: "b", holes: 4 }]);
  });

  it("is empty when everyone with a score is in the draw", () => {
    const players = [{ player_id: "a" }, { player_id: "b" }];
    const data = hd({ a_1: card(9), b_1: card(9) });
    expect(orphanedScores({ holeData: data, matches: [match(1, ["a"], ["b"])], round: 1, players }))
      .toEqual([]);
  });

  // The case the function exists for: every match gone, every score still there.
  it("surfaces the whole round after the draw is wiped", () => {
    const players = [{ player_id: "a" }, { player_id: "b" }];
    const data = hd({ a_1: card(11), b_1: card(11) });
    expect(totalHoles(orphanedScores({ holeData: data, matches: [], round: 1, players }))).toBe(22);
  });

  // A player drawn in round 2 is not cover for their round-1 scores.
  it("does not let another round's match account for a score", () => {
    const players = [{ player_id: "a" }];
    const data = hd({ a_1: card(6) });
    const matches = [match(2, ["a"], [], "m2")];
    expect(orphanedScores({ holeData: data, matches, round: 1, players }))
      .toEqual([{ pid: "a", holes: 6 }]);
  });

  it("survives missing inputs", () => {
    expect(orphanedScores({ holeData: hd({}), matches: undefined, round: 1, players: undefined }))
      .toEqual([]);
  });
});

describe("incomingScores", () => {
  // The mirror hazard: these players are about to be put INTO a match in a
  // round where they already have holes posted, and the new pairing inherits
  // those holes the moment it saves.
  it("reports what a new pairing would inherit", () => {
    const data = hd({ a_1: card(7), b_1: {} });
    expect(incomingScores({ holeData: data, round: 1, pids: ["a", "b"] }))
      .toEqual([{ pid: "a", holes: 7 }]);
  });

  it("is empty for a clean round", () => {
    expect(incomingScores({ holeData: hd({}), round: 1, pids: ["a", "b"] })).toEqual([]);
  });
});

describe("describeScored / totalHoles", () => {
  it("reads out names and hole counts", () => {
    const scored = [{ pid: "a", holes: 12 }, { pid: "b", holes: 7 }];
    expect(describeScored(scored, pid => ({ a: "Aaron", b: "Dave" }[pid])))
      .toBe("Aaron (12), Dave (7)");
  });

  it("truncates a long list rather than running off the card", () => {
    const scored = ["a", "b", "c", "d", "e", "f"].map((pid, i) => ({ pid, holes: 18 - i }));
    expect(describeScored(scored, pid => pid.toUpperCase()))
      .toBe("A (18), B (17), C (16), D (15), +2 more");
  });

  it("honours a custom max", () => {
    const scored = [{ pid: "a", holes: 3 }, { pid: "b", holes: 2 }, { pid: "c", holes: 1 }];
    expect(describeScored(scored, p => p, 1)).toBe("a (3), +2 more");
  });

  it("is empty for nothing scored", () => {
    expect(describeScored([], p => p)).toBe("");
    expect(totalHoles([])).toBe(0);
  });

  it("sums the holes across a list", () => {
    expect(totalHoles([{ pid: "a", holes: 12 }, { pid: "b", holes: 7 }])).toBe(19);
  });
});
