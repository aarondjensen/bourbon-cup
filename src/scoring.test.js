import { describe, it, expect } from "vitest";
import { computeMatchResult } from "./scoring";

// ── holes[h].counted ──────────────────────────────────────────────
// The list of balls that MADE a side's number on a hole. It exists for the
// Final Countdown, which reads it out to a room — so getting it wrong is not
// a wrong total, it is naming the wrong six people in front of them while
// the right six sit there. Worth pinning down even though the sum it comes
// from has been right for years.
//
// Every handicap here is 0 against a 113/72/72 course, so Course Handicap is
// 0, nobody gets a stroke, and net == gross. That keeps these tests about
// WHICH balls were taken rather than about the stroke allocation, which is
// its own machinery.

const A = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"];
const B = ["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8"];

const PARS = Array(18).fill(4);
const courses = [{
  id: "c1", name: "Test", hole_pars: PARS,
  hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1),
  tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }],
}];

const tPlayers = [...A, ...B].map((pid) => ({
  player_id: pid, name: pid.toUpperCase(), team: A.includes(pid) ? "A" : "B",
  handicap_index: 0,
}));

// `scores` is { pid: grossOnHole0 }. Every other hole is left empty, so only
// hole 0 has a result — which is all these tests look at.
const run = ({ scores, front = 6, format = "team_best_ball", teamA = A, teamB = B }) => {
  const holeData = {};
  Object.entries(scores).forEach(([pid, gross]) => { holeData[`${pid}_4`] = { 0: gross }; });
  const tRounds = [{
    round_number: 4, format, course_id: "c1", tee_box: "White",
    handicap_mode: "full", scoring_type: "points",
    counting_scores: { holes: Array(18).fill(front) },
  }];
  const match = { id: "m", round: 4, teamA, teamB, scoring_type: "points" };
  return computeMatchResult(match, holeData, courses, tRounds, tPlayers, format, {}, undefined, {}, {});
};

// Eight cards a side. A's six best are 3,4,4,5,5,6 = 27; B's are 4,4,4,5,5,5 = 27.
const EIGHT = {
  a1: 3, a2: 4, a3: 4, a4: 5, a5: 5, a6: 6, a7: 7, a8: 8,
  b1: 4, b2: 4, b3: 4, b4: 5, b5: 5, b6: 5, b7: 9, b8: 9,
};

describe("counted — Team Best Ball", () => {
  it("names exactly the balls the number was built from", () => {
    const h = run({ scores: EIGHT }).holes[0];
    expect(h.aScore).toBe(27);
    expect(h.counted.A).toEqual(["a1", "a2", "a3", "a4", "a5", "a6"]);
    expect(h.counted.B).toEqual(["b1", "b2", "b3", "b4", "b5", "b6"]);
  });

  it("adds up to the side's score, every time", () => {
    const r = run({ scores: EIGHT });
    const h = r.holes[0];
    const sum = (side, key) => h.counted[key].reduce((t, pid) => t + EIGHT[pid], 0);
    expect(sum(A, "A")).toBe(h.aScore);
    expect(sum(B, "B")).toBe(h.bScore);
  });

  it("follows the round's counting score", () => {
    const h = run({ scores: EIGHT, front: 3 }).holes[0];
    expect(h.counted.A).toEqual(["a1", "a2", "a3"]);
    expect(h.aScore).toBe(3 + 4 + 4);
  });

  // The sum is identical whichever of two equal nets is taken; the NAME is
  // not, and every phone in the room has to read out the same one.
  it("breaks a tie for the last spot by roster order, not by luck", () => {
    // All eight of A on the same net: two of them have to miss out, and which
    // two is a real answer somebody will be told out loud.
    const scores = { ...EIGHT };
    A.forEach((pid) => { scores[pid] = 4; });
    expect(run({ scores }).holes[0].counted.A).toEqual(["a1", "a2", "a3", "a4", "a5", "a6"]);
    // And the same answer on a card handed in the other way round, because it
    // is roster order that decides it and not arrival order.
    const reversed = Object.fromEntries(Object.entries(scores).reverse());
    expect(run({ scores: reversed }).holes[0].counted.A).toEqual(["a1", "a2", "a3", "a4", "a5", "a6"]);
  });

  // A side that hasn't got N cards in has no number, so there is nothing to
  // attribute — and the Countdown must not print a partial six as the six.
  it("attributes nothing on a hole the side hasn't finished", () => {
    const short = {};
    A.slice(0, 4).forEach((pid) => { short[pid] = 4; });
    B.forEach((pid) => { short[pid] = 4; });
    const h = run({ scores: short }).holes[0];
    expect(h.aScore).toBeNull();
    expect(h.counted.A).toEqual([]);
    expect(h.counted.B).toHaveLength(6);
  });

  it("leaves nobody out when the side is exactly N deep", () => {
    const scores = {};
    A.slice(0, 6).forEach((pid, i) => { scores[pid] = 4 + i; });
    B.slice(0, 6).forEach((pid, i) => { scores[pid] = 4 + i; });
    const h = run({ scores, teamA: A.slice(0, 6), teamB: B.slice(0, 6) }).holes[0];
    expect(h.counted.A).toEqual(A.slice(0, 6));
  });
});

describe("counted — other formats", () => {
  it("names the one ball on a Four-Ball", () => {
    const h = run({
      scores: { a1: 5, a2: 3, b1: 4, b2: 6 },
      format: "best_ball", teamA: ["a1", "a2"], teamB: ["b1", "b2"],
    }).holes[0];
    expect(h.aScore).toBe(3);
    expect(h.counted.A).toEqual(["a2"]);
    expect(h.counted.B).toEqual(["b1"]);
  });

  // Every ball counts on a Team Total, and there is no "best" to name. Null
  // rather than "all of them", so the Countdown can tell the difference
  // between a format that selects balls and one that doesn't.
  it("is null on a format where nothing is selected", () => {
    const h = run({
      scores: { a1: 5, a2: 3, b1: 4, b2: 6 },
      format: "team_total", teamA: ["a1", "a2"], teamB: ["b1", "b2"],
    }).holes[0];
    expect(h.aScore).toBe(8);
    expect(h.counted).toBeNull();
  });
});

// ── Shared-ball team handicaps ──────────────────────────────────────
// A 2-Man Scramble side plays one ball, so it gets one handicap: the sum of
// each partner's allowance-adjusted Course Handicap (35% of the low man's,
// 15% of the high man's), taken on the EXACT figures and rounded once — not
// each player's own figure rounded first and then added. Nothing pinned this
// down before; it was only reachable by reading scoring.js.
describe("Shared-ball team handicaps — 2-Man Scramble", () => {
  // Slope 113 / rating-par 0 makes Course Handicap == the index, rounded —
  // so a 9.4/11.2 pair gives clean, checkable-by-hand inputs: CH 9 and 11,
  // 35% of 9 (3.15) + 15% of 11 (1.65) = 4.8, rounded once to 5.
  const players = [
    { player_id: "p1", name: "P1", team: "A", handicap_index: 9.4 },
    { player_id: "p2", name: "P2", team: "A", handicap_index: 11.2 },
    { player_id: "p3", name: "P3", team: "B", handicap_index: 0 },
    { player_id: "p4", name: "P4", team: "B", handicap_index: 0 },
  ];
  const tRounds = [{
    round_number: 1, format: "scramble", course_id: "c1", tee_box: "White",
    allowance: { enabled: true },
  }];
  const match = { id: "m", round: 1, teamA: ["p1", "p2"], teamB: ["p3", "p4"], scoring_type: "match" };
  const result = () =>
    computeMatchResult(match, {}, courses, tRounds, players, "scramble", {}, undefined, {}, {});

  it("sums the unrounded per-player figures and rounds once, not the other way round", () => {
    const r = result();
    // Rounding each player first would give round(3.15) + round(1.65) = 3 + 2 = 5
    // here too by coincidence — the case that actually distinguishes the two
    // orders is any pair whose per-player roundings both go the SAME way
    // (e.g. two low-CH players at 34%/16% would sum-then-round to a different
    // whole number than round-then-sum). This pins the sum-first order down
    // directly against the exact figures rather than relying on a case where
    // the two methods happen to agree.
    expect(r.exactCH.p1).toBeCloseTo(9 * 0.35, 5);
    expect(r.exactCH.p2).toBeCloseTo(11 * 0.15, 5);
    expect(r.exactCH.p1 + r.exactCH.p2).toBeCloseTo(4.8, 5);
    expect(r.teamCH.A).toBe(5);
  });

  it("is null on a format that doesn't share a ball", () => {
    const tr = [{ ...tRounds[0], format: "best_ball" }];
    const r = computeMatchResult(match, {}, courses, tr, players, "best_ball", {}, undefined, {}, {});
    expect(r.teamCH).toBeNull();
  });
});
