// ══════════════════════════════════════════════════════════════════
//  Further edge cases in the scoring engine, beyond what the existing
//  scoring.* test files already pin down.
// ══════════════════════════════════════════════════════════════════
// Each block below targets one thing the engine's own comments say has to be
// true, that no existing test exercises: a points-per-hole tie's fractional
// formatting, a double withdrawal clamping Team Best Ball's count, Double
// Dot's one-man-side half-format, a disagreeing shared-ball card, an
// allowance tie-break, a plus-handicap's sign through the stroke map, the
// resolution order of the per-round getters when a lock and an override both
// exist, Traditional's explicit carve-out for Total rounds, and a
// points-per-hole segment clinching before its own last hole.
import { describe, it, expect } from "vitest";
import {
  computeMatchResult, fmtPts, sharedBallScore, buildStrokeMap, allowanceHandicaps,
  getRoundCH, getRoundHandicapMode, getRoundAllowance, getRoundCounting, getRoundParPoints,
  segmentState,
} from "./scoring";
import { parResultFor, tiltBirdieValue, tiltMultiplier, POINT_METHOD_TRADITIONAL, SCORING_TYPE_TOTAL } from "./constants";

const PARS = Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
const scratchCourse = {
  id: "c1", name: "Test", hole_pars: PARS, hole_handicaps: SI,
  tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }],
};

const scratchPlayers = (pids) => pids.map(pid => ({
  player_id: pid, name: pid, team: pid.startsWith("a") || pid.startsWith("p") ? "A" : "B",
  handicap_index: 0,
}));

// ── 1. A points-per-hole tie at 18, and fmtPts on the halves it produces ──
describe("points-per-hole: every hole halved, all the way to 18", () => {
  it("accumulates fractional front/back/total points and fmtPts prints them cleanly", () => {
    const teamA = ["a1", "a2"], teamB = ["b1", "b2"];
    const players = [...scratchPlayers(teamA), ...scratchPlayers(teamB).map(p => ({ ...p, team: "B" }))];
    const holeData = {};
    // Every player shoots par on every hole: both sides' best ball ties every
    // hole, so every hole is halved.
    [...teamA, ...teamB].forEach(pid => {
      holeData[`${pid}_1`] = Object.fromEntries(PARS.map((par, h) => [h, par]));
    });
    const tRounds = [{ round_number: 1, course_id: "c1", tee_box: "White", format: "best_ball", handicap_mode: "low_man" }];
    const match = { id: "m", round: 1, teamA, teamB, scoring_type: "points" };
    const res = computeMatchResult(match, holeData, [scratchCourse], tRounds, players, "best_ball", {}, undefined, {}, {});

    // hole_points defaults to {front:1, back:2}: 9 halved front holes pay
    // 0.5 each side = 4.5; 9 halved back holes at 2 apiece pay 1 each = 9.
    expect(res.frontPts).toEqual({ A: 4.5, B: 4.5 });
    expect(res.backPts).toEqual({ A: 9, B: 9 });
    // Points-per-hole never awards an overall pot — the two nines already
    // account for every point.
    expect(res.overallPts).toEqual({ A: 0, B: 0 });
    expect(res.totalPts).toEqual({ A: 13.5, B: 13.5 });

    expect(fmtPts(res.frontPts.A)).toBe("4.5");
    expect(fmtPts(res.backPts.A)).toBe("9");
    expect(fmtPts(res.totalPts.A)).toBe("13.5");
  });
});

// ── 2. Team Best Ball: withdrawals on BOTH sides clamp the count at once ──
describe("Team Best Ball counting, clamped by withdrawals on both sides", () => {
  it("clamps `need` to the smaller roster on EITHER side, not just the shorter one", () => {
    const A = ["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7"];
    const B = ["b0", "b1", "b2", "b3", "b4", "b5", "b6", "b7"];
    const withdrawnA = ["a5", "a6", "a7"];   // A drops from 8 to 5
    const withdrawnB = ["b4", "b5", "b6", "b7"]; // B drops from 8 to 4
    const tPlayers = [...A, ...B].map(pid => ({
      player_id: pid, name: pid, team: A.includes(pid) ? "A" : "B", handicap_index: 0,
      ...(withdrawnA.includes(pid) || withdrawnB.includes(pid) ? { withdrawn: true } : {}),
    }));
    const scores = {
      a0: 3, a1: 4, a2: 4, a3: 5, a4: 6,
      b0: 4, b1: 4, b2: 4, b3: 5,
    };
    const holeData = {};
    Object.entries(scores).forEach(([pid, g]) => { holeData[`${pid}_1`] = { 0: g }; });
    const tRounds = [{
      round_number: 1, course_id: "c1", tee_box: "White", format: "team_best_ball",
      handicap_mode: "full", counting_scores: { front: 6, back: 6 },
    }];
    const match = { id: "m", round: 1, teamA: A, teamB: B };
    const res = computeMatchResult(match, holeData, [scratchCourse], tRounds, tPlayers, "team_best_ball", {}, undefined, {}, {});

    // The round is set to count 6, but withdrawals leave A at 5 and B at 4 —
    // countFor has to clamp to the smaller of the two, 4, or neither side
    // could ever post this hole.
    const h = res.holes[0];
    expect(h.aScore).toBe(3 + 4 + 4 + 5);   // a0,a1,a2,a3 — a4 (6) misses out
    expect(h.bScore).toBe(4 + 4 + 4 + 5);   // all four of B's remaining
    expect(h.counted.A).toEqual(["a0", "a1", "a2", "a3"]);
    expect(h.counted.B).toEqual(["b0", "b1", "b2", "b3"]);
    expect(h.winner).toBe("A");
    expect(h.played).toBe(true);
  });
});

// ── 3. Double Dot: a one-man side, made one-man by a withdrawal ──
describe("Double Dot with a one-man side", () => {
  it("plays only the low-ball dot when a withdrawal leaves one side with a single ball", () => {
    const teamA = ["p1", "p2"], teamB = ["q1", "q2"];
    const tPlayers = [
      { player_id: "p1", name: "p1", team: "A", handicap_index: 0 },
      { player_id: "p2", name: "p2", team: "A", handicap_index: 0, withdrawn: true },
      { player_id: "q1", name: "q1", team: "B", handicap_index: 0 },
      { player_id: "q2", name: "q2", team: "B", handicap_index: 0 },
    ];
    const holeData = {
      p1_1: { 0: 5 },
      q1_1: { 0: 4 }, q2_1: { 0: 6 },
    };
    const tRounds = [{ round_number: 1, course_id: "c1", tee_box: "White", format: "double_dot", handicap_mode: "low_man" }];
    const match = { id: "m", round: 1, teamA, teamB };
    const res = computeMatchResult(match, holeData, [scratchCourse], tRounds, tPlayers, "double_dot", {}, undefined, {}, {});

    const h = res.holes[0];
    // B's low ball (4) beats A's only ball (5): one dot to B. There is no
    // high-ball sub-match for a one-man side, so B's high ball (6, worse
    // than A's 5) does NOT also win a second dot — a two-dot hole would let
    // the two-man side win both dots off a side that only has one ball.
    expect(h.aScore).toBe(0);
    expect(h.bScore).toBe(1);
    expect(h.winner).toBe("B");
  });
});

// ── 4. Shared-ball (scramble/pinehurst): disagreeing cards, 0 vs null ──
describe("sharedBallScore", () => {
  it("takes the lower of two disagreeing cards", () => {
    expect(sharedBallScore([7, 5])).toBe(5);
  });
  it("treats a 0 as an absent score, not a hole-in-none", () => {
    expect(sharedBallScore([0, 5])).toBe(5);
  });
  it("treats null the same way as 0 — both are absent", () => {
    expect(sharedBallScore([null, 5])).toBe(5);
    expect(sharedBallScore([0, null])).toBe(null);
  });
  it("is null with nothing posted at all", () => {
    expect(sharedBallScore([])).toBe(null);
    expect(sharedBallScore([null, null])).toBe(null);
  });
});

describe("Scramble: a shared-ball hole through computeMatchResult", () => {
  it("scores off the lower of two disagreeing partner cards, and nulls out when both are absent", () => {
    const teamA = ["p1", "p2"], teamB = ["q1", "q2"];
    const tPlayers = scratchPlayers(teamA).concat(scratchPlayers(teamB).map(p => ({ ...p, team: "B" })));
    const holeData = {
      p1_1: { 0: 7, 1: 0 }, p2_1: { 0: 5, 1: null },
      q1_1: { 0: 0, 1: 4 }, q2_1: { 0: 4, 1: 4 },
    };
    const tRounds = [{ round_number: 1, course_id: "c1", tee_box: "White", format: "scramble", handicap_mode: "low_man" }];
    const match = { id: "m", round: 1, teamA, teamB };
    const res = computeMatchResult(match, holeData, [scratchCourse], tRounds, tPlayers, "scramble", {}, undefined, {}, {});

    // Hole 0: A's cards disagree (7 vs 5) — the side's score is the lower.
    // B's cards are 0 (absent) and 4 — the 0 is filtered out, leaving 4.
    expect(res.holes[0].aScore).toBe(5);
    expect(res.holes[0].bScore).toBe(4);
    // Hole 1: A posted 0 and null — both absent, so the side has no score.
    expect(res.holes[1].aScore).toBeNull();
    expect(res.holes[1].played).toBe(false);
  });
});

// ── 5. allowanceHandicaps: a tie on Course Handicap ──
describe("allowanceHandicaps with a tied Course Handicap on both partners", () => {
  it("gives the low share to whichever partner is listed first", () => {
    const getCH = (pid) => ({ p1: 10, p2: 10 }[pid]);
    const allowance = { split: true, low: 35, high: 15 };
    const forward = allowanceHandicaps([["p1", "p2"]], getCH, allowance);
    expect(forward.p1).toBeCloseTo(10 * 0.35, 5);
    expect(forward.p2).toBeCloseTo(10 * 0.15, 5);

    const reversed = allowanceHandicaps([["p2", "p1"]], getCH, allowance);
    expect(reversed.p2).toBeCloseTo(10 * 0.35, 5);
    expect(reversed.p1).toBeCloseTo(10 * 0.15, 5);
  });
});

// ── 6. A plus-handicap's negative strokes through buildStrokeMap ──
describe("buildStrokeMap with a negative (plus) Course Handicap", () => {
  it("signs the allocation negative, on the hardest holes first", () => {
    const map = buildStrokeMap(-3, SI);
    expect(map).toEqual({ 0: -1, 1: -1, 2: -1 });
  });
  it("wraps three full passes the same way strokes-for do, just negative", () => {
    const map = buildStrokeMap(-54, SI);
    expect(Object.keys(map)).toHaveLength(18);
    expect(Object.values(map).every(v => v === -3)).toBe(true);
    expect(Object.values(map).reduce((a, b) => a + b, 0)).toBe(-54);
  });
});

// ── 7. Resolution order: lock vs override/explicit vs computed ──
describe("getRoundCH: lock beats override beats computed", () => {
  it("a locked round answers to its own frozen ch, ignoring any chOverride", () => {
    const roundLocks = { 1: { locked: true, players: { p1: { hi: 10, ch: 7, tee: "White" } } } };
    const chOverrides = { 1: { p1: 99 } };
    const players = [{ player_id: "p1", handicap_index: 5 }];
    const ch = getRoundCH({ roundLocks, round: 1, pid: "p1", players, course: null, chOverrides, teeAssignments: {}, roundTee: "White" });
    expect(ch).toBe(7);
  });

  it("an open round's chOverride wins over the computed figure", () => {
    const players = [{ player_id: "p1", handicap_index: 5 }];
    const chOverrides = { 2: { p1: 42 } };
    const ch = getRoundCH({ roundLocks: {}, round: 2, pid: "p1", players, course: null, chOverrides, teeAssignments: {}, roundTee: undefined });
    expect(ch).toBe(42);
  });

  it("falls all the way back to the computed CH when neither applies", () => {
    const players = [{ player_id: "p1", handicap_index: 5 }];
    const ch = getRoundCH({ roundLocks: {}, round: 2, pid: "p1", players, course: null, chOverrides: {}, teeAssignments: {}, roundTee: undefined });
    expect(ch).toBe(5); // calcCH(5, 113, 72, 72) === 5
  });
});

describe("getRoundHandicapMode: the lock wins outright, even over an explicit argument", () => {
  it("a locked mode overrides both the explicit argument and the round doc", () => {
    const roundLocks = { 1: { locked: true, handicap_mode: "full" } };
    const tRounds = [{ round_number: 1, format: "singles", handicap_mode: "low_man" }];
    expect(getRoundHandicapMode({ roundLocks, round: 1, tRounds, explicit: "low_man" })).toBe("full");
  });
  it("an open round lets the explicit argument win over the round doc", () => {
    const tRounds = [{ round_number: 1, format: "singles", handicap_mode: "low_man" }];
    expect(getRoundHandicapMode({ roundLocks: {}, round: 1, tRounds, explicit: "full" })).toBe("full");
  });
});

describe("getRoundAllowance: the lock wins outright, even over an explicit argument", () => {
  it("a locked allowance overrides both explicit and the round doc", () => {
    const roundLocks = { 1: { locked: true, format: "singles", allowance: { enabled: true, pct: 80 } } };
    const tRounds = [{ round_number: 1, format: "singles", allowance: { enabled: true, pct: 50 } }];
    const res = getRoundAllowance({ roundLocks, round: 1, tRounds, format: "singles", explicit: { enabled: true, pct: 20 } });
    expect(res.pct).toBe(80);
  });
  it("an open round lets the explicit argument win over the round doc", () => {
    const tRounds = [{ round_number: 1, format: "singles", allowance: { enabled: true, pct: 50 } }];
    const res = getRoundAllowance({ roundLocks: {}, round: 1, tRounds, format: "singles", explicit: { enabled: true, pct: 20 } });
    expect(res.pct).toBe(20);
  });
});

// Counting scores and par points are the documented EXCEPTION: they decide
// points, not strokes, so the LIVE value wins over a lock — the opposite
// priority from CH, handicap mode and allowance above.
describe("getRoundCounting: unlike allowance/mode, the live value wins over the lock", () => {
  const roundLocks = { 1: { locked: true, format: "team_best_ball", counting_scores: { front: 5, back: 5 } } };

  it("an explicit argument wins even on a locked round", () => {
    const tRounds = [{ round_number: 1, format: "team_best_ball", counting_scores: { front: 3, back: 3 } }];
    const res = getRoundCounting({ roundLocks, round: 1, tRounds, format: "team_best_ball", explicit: { front: 9, back: 9 } });
    expect(res[0]).toBe(9);
    expect(res[9]).toBe(9);
  });

  it("with no explicit argument, the round doc still beats the lock", () => {
    const tRounds = [{ round_number: 1, format: "team_best_ball", counting_scores: { front: 3, back: 3 } }];
    const res = getRoundCounting({ roundLocks, round: 1, tRounds, format: "team_best_ball" });
    expect(res[0]).toBe(3);
  });

  it("falls back to the lock only when the round doc has nothing of its own", () => {
    const tRounds = [{ round_number: 1, format: "team_best_ball" }];
    const res = getRoundCounting({ roundLocks, round: 1, tRounds, format: "team_best_ball" });
    expect(res[0]).toBe(5);
  });
});

describe("getRoundParPoints: same live-wins-over-lock order as counting", () => {
  const roundLocks = { 1: { locked: true, format: "stableford", par_points: { birdie: 99 } } };

  it("an explicit argument wins even on a locked round", () => {
    const tRounds = [{ round_number: 1, format: "stableford", par_points: { birdie: 1 } }];
    const res = getRoundParPoints({ roundLocks, round: 1, tRounds, format: "stableford", explicit: { birdie: 55 } });
    expect(res.birdie).toBe(55);
  });

  it("with no explicit argument, the round doc still beats the lock", () => {
    const tRounds = [{ round_number: 1, format: "stableford", par_points: { birdie: 1 } }];
    const res = getRoundParPoints({ roundLocks, round: 1, tRounds, format: "stableford" });
    expect(res.birdie).toBe(1);
  });

  it("falls back to the lock only when the round doc has nothing of its own", () => {
    const tRounds = [{ round_number: 1, format: "stableford" }];
    const res = getRoundParPoints({ roundLocks, round: 1, tRounds, format: "stableford" });
    expect(res.birdie).toBe(99);
  });
});

// ── 8. Traditional's point method explicitly excludes Total rounds ──
describe("Traditional point method on a Total-scoring round", () => {
  const teamA = ["p1"], teamB = ["p2"];
  const players = [
    { player_id: "p1", name: "p1", team: "A", handicap_index: 0 },
    { player_id: "p2", name: "p2", team: "B", handicap_index: 0 },
  ];
  const holeData = {
    p1_1: Object.fromEntries(PARS.map((par, h) => [h, par])),          // A pars every hole
    p2_1: Object.fromEntries(PARS.map((par, h) => [h, par + 1])),      // B bogeys every hole
  };
  const tRounds = [{ round_number: 1, course_id: "c1", tee_box: "White", format: "singles", handicap_mode: "low_man" }];

  it("pays out Nassau, not the traditional pot, when formOfPlay is Total", () => {
    const match = {
      id: "m", round: 1, teamA, teamB,
      point_method: POINT_METHOD_TRADITIONAL, traditional_points: 5, scoring_type: SCORING_TYPE_TOTAL,
    };
    const res = computeMatchResult(match, holeData, [scratchCourse], tRounds, players, "singles", {}, undefined, {}, {});
    expect(res.overall.winner).toBe("A");
    // NASSAU_DEFAULT.overall (1), not match.traditional_points (5) —
    // the explicit `formOfPlay !== SCORING_TYPE_TOTAL` guard in scoring.js.
    expect(res.overallPts).toEqual({ A: 1, B: 0 });
    expect(res.frontPts).toEqual({ A: 1, B: 0 });
    expect(res.backPts).toEqual({ A: 1, B: 0 });
  });

  it("pays the traditional single pot on the same cards when formOfPlay is Match", () => {
    const match = {
      id: "m", round: 1, teamA, teamB,
      point_method: POINT_METHOD_TRADITIONAL, traditional_points: 5,
    };
    const res = computeMatchResult(match, holeData, [scratchCourse], tRounds, players, "singles", {}, undefined, {}, {});
    expect(res.overall.winner).toBe("A");
    expect(res.overallPts).toEqual({ A: 5, B: 0 });
    // Traditional's single pot means no front/back pot is awarded at all.
    expect(res.frontPts).toEqual({ A: 0, B: 0 });
    expect(res.backPts).toEqual({ A: 0, B: 0 });
  });
});

// ── 9. A points-per-hole segment can clinch before its own last hole ──
describe("segmentState: a front-nine points lead clinched before the ninth hole", () => {
  it("is already unbeatable with three holes still to play", () => {
    const holes = Array.from({ length: 9 }, (_, h) => ({
      h, played: h < 6, winner: h < 6 ? "A" : null, aScore: null, bScore: null,
    }));
    const st = segmentState(holes, { holeValue: () => 1 });
    expect(st.played).toBe(6);
    expect(st.remaining).toBe(3);
    expect(st.margin).toBe(6);
    expect(st.clinched).toBe(true);
    expect(st.complete).toBe(true);
    expect(st.winner).toBe("A");
  });
});

// ── 10. Tilt: the streak rides through the turn, and its ladder clamps ──
describe("Tilt streak across the turn", () => {
  it("carries a birdie's multiplier from the last front-nine hole into the first back-nine hole", () => {
    const teamA = ["p1"], teamB = ["p2"];
    const players = [
      { player_id: "p1", name: "p1", team: "A", handicap_index: 0 },
      { player_id: "p2", name: "p2", team: "B", handicap_index: 0 },
    ];
    const holeData = {
      // hole index 8 (the 9th, last of the front) and 9 (the 10th, first of
      // the back) are both birdies; index 10 (the 11th) is a plain par.
      p1_1: { 8: 3, 9: 3, 10: 4 },
    };
    const tRounds = [{ round_number: 1, course_id: "c1", tee_box: "White", format: "tilt", handicap_mode: "full" }];
    const match = { id: "m", round: 1, teamA, teamB };
    const res = computeMatchResult(match, holeData, [scratchCourse], tRounds, players, "tilt", {}, undefined, {}, {});

    // Birdie at face value (streak 0 → ×1): 4 * 1 = 4.
    expect(res.holes[8].aScore).toBe(4);
    // Second birdie in a row, ACROSS the turn, carries the ×2 the first
    // birdie earned — the nines are not a reset.
    expect(res.holes[9].aScore).toBe(8);
    // A plain par is scored at the ×3 carried IN from two birdies (the hole
    // that ends a streak is not exempt from the multiplier it inherited),
    // then drops the streak back to zero afterwards.
    expect(res.holes[10].aScore).toBe(6);
  });

  it("classifies anything four-or-more under as albatross, Tilt's ladder having no rung above it", () => {
    // Tilt's own ladder stops at albatross (its printed key ends "Dub +" at
    // the bottom, and nothing above albatross is priced separately either) —
    // a hole five under still reads as merely an albatross on Tilt, where
    // Stableford's finer ladder keeps a distinct "double_albatross" rung.
    expect(parResultFor(-5, "tilt")).toBe("albatross");
    expect(parResultFor(-5, "stableford")).toBe("double_albatross");
    expect(tiltBirdieValue("albatross")).toBe(3);
  });

  it("keeps climbing with no cap", () => {
    expect(tiltMultiplier(5)).toBe(6);
    expect(tiltMultiplier(10)).toBe(11);
  });
});
