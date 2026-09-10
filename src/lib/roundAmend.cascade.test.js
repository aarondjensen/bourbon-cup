// ══════════════════════════════════════════════════════════════════
//  What a correction to a FINALIZED round actually reaches
// ══════════════════════════════════════════════════════════════════
//
// The whole amendment flow rests on a split that is stated in three places in
// prose (lib/roundLocks' "WHAT IS FROZEN", scoring.js's live-value resolvers,
// and lib/roundAmend) and, until this file, pinned in none:
//
//   POINTS are live.   Nassau pots, hole values, par points and counting
//                      scores are read from the round document over the
//                      snapshot, ALWAYS — a final round included. A director
//                      who finds the wrong Nassau allotment on a round the
//                      field finished yesterday fixes it and it lands, with
//                      no reopen and no recalculate.
//   STROKES are frozen. Handicaps, allowance, mode, tees and the course come
//                      off the snapshot. Correcting one of those on a final
//                      round changes a stored field and NOTHING ELSE until
//                      the snapshot is re-taken.
//
// Both halves are dangerous in the direction they fail. If the first ever
// stopped being true, a director would correct a pot and watch a leaderboard
// refuse to move. If the second ever stopped being true, a GHIN sync would
// silently re-score a tournament that was over. Neither failure announces
// itself on screen, which is exactly why they are pinned here rather than
// trusted to the comments that describe them.
import { describe, it, expect } from "vitest";
import { computeMatchResult } from "../scoring";
import { buildRoundLockDoc, markRoundFinal, refreshRoundLockDoc } from "./roundLocks";

const PARS = Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
const course = {
  id: "c1", name: "Treetops", par: 72, slope: 113, rating: 72,
  hole_pars: PARS, hole_handicaps: SI,
  tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }],
};

// Two men off very different indexes, so an allowance change has somewhere to
// bite: at 100% B gets ten strokes, at 50% he gets five.
const tPlayers = [
  { player_id: "a1", name: "Sam O", team: "A", handicap_index: 0 },
  { player_id: "b1", name: "Vic C", team: "B", handicap_index: 10 },
];

const roundDoc = (over = {}) => ({
  round_number: 1, format: "singles", course_id: "c1", tee_box: "White",
  handicap_mode: "full", scoring_type: "match", ...over,
});

// A won every hole gross. With ten strokes B takes the ones he gets.
const holeData = {
  a1_1: Object.fromEntries(PARS.map((_, h) => [h, 4])),
  b1_1: Object.fromEntries(PARS.map((_, h) => [h, 5])),
};

const match = { id: "m1", round: 1, teamA: ["a1"], teamB: ["b1"], scoring_type: "match" };

// A FINAL round, frozen against the setup it was played on.
const finalLocks = (tr) => ({
  1: markRoundFinal(buildRoundLockDoc({
    tournamentId: "bc_2026", round: 1, players: tPlayers,
    tRounds: [tr], courses: [course],
  }), "Aaron J"),
});

const score = (tr, locks, m = match) =>
  computeMatchResult(m, holeData, [course], [tr], tPlayers, "singles", {}, undefined, {}, locks);

describe("points corrections reach a FINALIZED round", () => {
  // The director's own example: the Nassau allotment for a format was wrong,
  // the scores are already in, and changing it has to re-price the round.
  it("re-prices a final round when the Nassau pots change", () => {
    const tr = roundDoc();
    const locks = finalLocks(tr);

    const before = score(tr, locks, { ...match, nassau: { front: 1, back: 1, overall: 1 } });
    const after = score(tr, locks, { ...match, nassau: { front: 2, back: 2, overall: 5 } });

    // Same holes, same strokes — only what the match is WORTH has moved.
    expect(after.holes).toEqual(before.holes);
    const total = (r) => r.totalPts.A + r.totalPts.B;
    expect(total(before)).toBe(3);
    expect(total(after)).toBe(9);
  });

  it("re-prices a final points-per-hole round when the hole values change", () => {
    const base = roundDoc({ scoring_type: "points", hole_points: { front: 1, back: 1 } });
    const locks = finalLocks(base);
    const raised = roundDoc({ scoring_type: "points", hole_points: { front: 1, back: 3 } });

    const before = score(base, locks, { ...match, scoring_type: "points" });
    const after = score(raised, locks, { ...match, scoring_type: "points" });

    expect(before.holePoints).toEqual({ front: 1, back: 1 });
    // The LIVE round document wins over the snapshot the round was frozen
    // with. If this ever reads { front: 1, back: 1 }, the lock has started
    // winning and a points correction has become impossible to land.
    expect(after.holePoints).toEqual({ front: 1, back: 3 });
    expect(after.totalPts.A).toBeGreaterThan(before.totalPts.A);
  });
});

describe("stroke corrections do NOT reach a finalized round on their own", () => {
  // The guarantee roundLocks exists for, from the other side: this is what
  // makes the recalculate a necessary second act rather than a formality.
  it("ignores an allowance edited after the round was frozen", () => {
    const played = roundDoc({ allowance: { enabled: true, pct: 100 } });
    const locks = finalLocks(played);
    const corrected = roundDoc({ allowance: { enabled: true, pct: 50 } });

    const before = score(played, locks);
    const after = score(corrected, locks);

    expect(after.allowance.pct).toBe(before.allowance.pct);
    expect(after.playingCH).toEqual(before.playingCH);
    expect(after.status).toBe(before.status);
  });

  it("ignores a handicap index edited after the round was frozen", () => {
    const tr = roundDoc();
    const locks = finalLocks(tr);
    const resynced = [tPlayers[0], { ...tPlayers[1], handicap_index: 24 }];

    const after = computeMatchResult(
      match, holeData, [course], [tr], resynced, "singles", {}, undefined, {}, locks,
    );
    expect(after.playingCH.b1).toBe(score(tr, locks).playingCH.b1);
  });

  // And the recalculate is what lands it. Same corrected round, same live
  // players — the only thing that changed is that the snapshot was re-taken.
  it("lands the correction once the snapshot is recalculated", () => {
    const played = roundDoc({ allowance: { enabled: true, pct: 100 } });
    const locks = finalLocks(played);
    const corrected = roundDoc({ allowance: { enabled: true, pct: 50 } });

    const before = score(corrected, locks);

    // What onRecalculateRound does: rebuild against live values, preserving
    // the audit trail. Reopened first — refreshing a final round is refused.
    const reopened = { ...locks[1], final: false };
    const recalculated = {
      1: refreshRoundLockDoc({
        tournamentId: "bc_2026", round: 1, players: tPlayers,
        tRounds: [corrected], courses: [course], previous: reopened,
      }),
    };
    const after = score(corrected, recalculated);

    expect(before.allowance.pct).toBe(100);
    expect(after.allowance.pct).toBe(50);
    expect(after.playingCH.b1).toBe(Math.round(before.playingCH.b1 / 2));
    // Which is the point: strokes moved in a round that had been played.
    expect(after.holes).not.toEqual(before.holes);
  });

  it("keeps the original locked_at through a recalculate, so the trail survives", () => {
    const tr = roundDoc();
    const locks = finalLocks(tr);
    const reopened = { ...locks[1], final: false };
    const next = refreshRoundLockDoc({
      tournamentId: "bc_2026", round: 1, players: tPlayers,
      tRounds: [tr], courses: [course], previous: reopened,
    });
    expect(next.locked_at).toBe(locks[1].locked_at);
    expect(next.finalized_at).toBe(locks[1].finalized_at);
    expect(next.refreshed_at).toBeTruthy();
  });
});
