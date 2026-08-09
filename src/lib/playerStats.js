// ══════════════════════════════════════════════════════════════════
//  playerStats — the tournament sliced by player rather than by match.
// ══════════════════════════════════════════════════════════════════
//
// The Analytics tab showed four numbers a player could not get anywhere else
// — won, lost, halved, points — and one it could not get at all: a `skinsWon`
// field that was initialised to zero for everybody and never written to.
//
// What was missing is the thing sixteen people actually argue about on the
// drive home, and every bit of it was already subscribed: how each player
// scored. Not who beat whom, which the leaderboard says better, but how they
// went round.
//
// Two functions, kept apart because they answer different questions off
// different data:
//
//   matchRecord     from the MATCHES — won, lost, halved, points. A team
//                   result, credited to everyone on the side.
//   scoringRecord   from the CARDS — rounds, holes, to par, best round. An
//                   individual result, and true whatever the format was.
//
// Neither invents a number. A player with nothing posted has no average
// rather than an average of zero, which is the distinction the tab got wrong
// when it seeded every counter at 0 and displayed them all the same.
import { computeMatchResult, getRoundCourseCtx } from "../scoring";
import { DEFAULT_FORMAT } from "../constants";

export const HOLES_PER_ROUND = 18;

// ── Match record ──────────────────────────────────────────────────
// Every match scored once, its points credited to each player on the side
// that earned them, and the result counted as a win, a loss or a half.
//
// The result is the MATCH's, not the player's share of it: a four-ball is won
// by two people together and both of them won it. That is how a cup record
// has always been read and it is what the leaderboard's own totals sum to.
export const matchRecord = ({
  matches = [], holeData = {}, courses = [], tRounds = [], tPlayers = [],
  hcpOverrides = {}, teeAssignments = {}, roundLocks = {},
} = {}) => {
  const out = {};
  const row = (pid) => (out[pid] || (out[pid] = { wins: 0, losses: 0, halves: 0, pts: 0, matches: 0 }));

  matches.forEach((m) => {
    const fmt = tRounds.find((t) => t.round_number === m.round)?.format || DEFAULT_FORMAT;
    const res = computeMatchResult(
      m, holeData, courses, tRounds, tPlayers, fmt,
      hcpOverrides, undefined, teeAssignments, roundLocks,
    );
    const { A, B } = res.totalPts;
    const credit = (pids, mine, theirs) => (pids || []).forEach((pid) => {
      const r = row(pid);
      r.matches += 1;
      r.pts += mine;
      if (mine > theirs) r.wins += 1;
      else if (theirs > mine) r.losses += 1;
      else r.halves += 1;
    });
    credit(m.teamA, A, B);
    credit(m.teamB, B, A);
  });
  return out;
};

// ── Scoring record ────────────────────────────────────────────────
// Straight off the cards, against each round's own par table — resolved
// through the round LOCK where there is one, the same way every other scoring
// surface resolves it, so a course re-pointed after the fact cannot re-par a
// round somebody has already played.
//
// Only COMPLETE rounds are averaged or ranked. A player through fourteen is
// not having a good week, they are unfinished, and averaging their card
// against a full one would put whoever had played least on top — the same
// trap the Low Net board avoids for the same reason. Holes and to-par count
// everything posted, because those are totals rather than comparisons.
export const scoringRecord = ({
  tPlayers = [], holeData = {}, tRounds = [], courses = [], roundLocks = {},
} = {}) => {
  const out = {};
  // One par table per round rather than one per player per round.
  const parsFor = {};
  const pars = (round) => {
    if (!parsFor[round]) {
      parsFor[round] = getRoundCourseCtx({ roundLocks, round, tRounds, courses }).holePars;
    }
    return parsFor[round];
  };

  const rounds = [...new Set(tRounds.map(t => t.round_number).filter(r => r != null))];

  tPlayers.forEach((p) => {
    const pid = p.player_id;
    if (!pid) return;
    let holes = 0, toPar = 0, complete = 0, completeToPar = 0;
    let best = null;

    rounds.forEach((round) => {
      const card = holeData[`${pid}_${round}`] || {};
      const played = Object.keys(card).filter(h => card[h] > 0).map(Number);
      if (!played.length) return;
      const par = pars(round);
      const gross = played.reduce((s, h) => s + card[h], 0);
      const parSum = played.reduce((s, h) => s + (par[h] ?? 4), 0);
      holes += played.length;
      toPar += gross - parSum;

      if (played.length === HOLES_PER_ROUND) {
        complete += 1;
        completeToPar += gross - parSum;
        if (!best || gross < best.gross) best = { round, gross, toPar: gross - parSum };
      }
    });

    out[pid] = {
      holes,
      toPar,
      rounds: complete,
      // Null rather than zero when there is nothing to average — an unplayed
      // player has no scoring average, and printing "E" for one would rank
      // them above everybody who actually teed off.
      avgToPar: complete ? completeToPar / complete : null,
      best,
    };
  });
  return out;
};

// The two joined, ready for a table. Sorted by points, then by the better
// scoring average among equals — which is the tiebreak the players would use
// themselves, and it puts somebody who has not played at the bottom rather
// than sharing the top with everyone else on nought.
export const playerTable = (args) => {
  const record = matchRecord(args);
  const scoring = scoringRecord(args);
  return (args.tPlayers || [])
    .filter(p => p.player_id)
    .map(p => ({
      pid: p.player_id,
      name: p.name,
      team: p.team,
      ...(record[p.player_id] || { wins: 0, losses: 0, halves: 0, pts: 0, matches: 0 }),
      ...(scoring[p.player_id] || { holes: 0, toPar: 0, rounds: 0, avgToPar: null, best: null }),
    }))
    .sort((a, b) =>
      b.pts - a.pts
      || (a.avgToPar ?? Infinity) - (b.avgToPar ?? Infinity)
      || String(a.name || "").localeCompare(String(b.name || "")));
};
