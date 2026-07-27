// ── Scoring engine ──
// All pure scoring math lives here — no React, no Firestore, no UI.
// Two scoring paths share these utilities:
//   - Tournament play (computeMatchResult)        — multi-format Nassau
//   - Practice play   (computePracticeMatch /
//                      computePracticeSkins)      — fixed Team Total + skins
// Both paths use the same getEffectiveHI / buildStrokeMap helpers so the
// dots displayed on a scoring screen always reflect the strokes used in
// the leaderboard math.
import {
  NASSAU_DEFAULT, POINT_METHOD_NASSAU, POINT_METHOD_TRADITIONAL, resolveAllowance,
  resolveCounting, resolveHolePoints, isPointsPerHole, SCORING_TYPE_TEAM,
} from "./constants";

// ── Course Handicap math ──
// USGA Course Handicap formula:
//   CH = HI × (Slope / 113) + (Course Rating - Par)
// where:
//   - HI is the player's official Handicap Index from admin setup
//   - Slope is the slope rating of the tee being played (113 = neutral)
//   - Course Rating is the difficulty rating of the tee
//   - Par is the par of the tee (almost always == course par)
// Result is rounded to the nearest integer per USGA convention.
export const calcCH = (hi, slope, rating, par) => (!hi && hi !== 0) ? 0 : Math.round((hi * (slope / 113)) + (rating - par));

// Resolves slope/rating/par for a course doc and runs calcCH. The tee
// the player is actually playing matters — different tees on the same
// course can have wildly different slope ratings (e.g. Black 138 vs
// White 122), and the USGA formula uses the playing tee's values, not
// course-level averages. When a specific tee is named, its values are
// definitive — they ARE the playing conditions. When no tee is named
// (legacy events created before tee selection existed), we fall back
// through: top-level course.slope/rating/par → first tee box → USGA
// neutral defaults (113/72/72). All values are coerced through
// parseFloat so string-stored values from imported APIs still work.
export const calcCHForCourse = (hi, course, teeName) => {
  if (!course) return calcCH(hi, 113, 72, 72);
  const teeBoxes = course.tee_boxes || [];
  if (teeName) {
    const tee = teeBoxes.find(t => t.name === teeName);
    if (tee) {
      const slope = parseFloat(tee.slope) || 113;
      const rating = parseFloat(tee.rating) || 72;
      const par = parseFloat(tee.par) || 72;
      return calcCH(hi, slope, rating, par);
    }
  }
  const fallbackTee = teeBoxes[0] || {};
  const slope = parseFloat(course.slope) || parseFloat(fallbackTee.slope) || 113;
  const rating = parseFloat(course.rating) || parseFloat(fallbackTee.rating) || 72;
  const par = parseFloat(course.par) || parseFloat(fallbackTee.par) || 72;
  return calcCH(hi, slope, rating, par);
};

// ── Score formatting ──
// Render a relative-to-par integer as "E", "+1", or "-2". Lives here
// (vs. a pure formatting module) because it pairs naturally with score
// math and isn't used outside scoring contexts.
export const fmtScore = (n) => n == null ? "—" : n === 0 ? "E" : n > 0 ? `+${n}` : `${n}`;

// ── Shared scoring helpers ──
// Get a player's effective Handicap Index, applying any per-round override.
// Used by every scoring path (tournament + practice) so override semantics
// stay identical everywhere. `overrides` is the round-scoped map
// (e.g. hcpOverrides[match.round]), NOT the full per-round dictionary.
export const getEffectiveHI = (pid, players, overrides) => {
  if (overrides && overrides[pid] !== undefined && overrides[pid] !== "") {
    return parseFloat(overrides[pid]) || 0;
  }
  const tp = players.find(p => p.player_id === pid);
  // Player-level HI override. Kept in its OWN field (`hi_override`) so it is
  // never touched by GHIN sync — which only ever writes `handicap_index`.
  // When the director sets one it wins over the GHIN-synced base; both values
  // are stored side by side (see the Players admin tab).
  const base = (tp?.hi_override != null && String(tp.hi_override).trim() !== "")
    ? tp.hi_override : tp?.handicap_index;
  return parseFloat(base) || 0;
};

// Allocate strokes across 18 holes by hole-handicap rank. The lowest-handicap
// hole (hardest) gets stroke 1, then 2, etc., wrapping for handicaps > 18
// (capped at 3 wraps = 54 strokes). Negative ch produces "negative strokes"
// (rare — used for plus handicaps in low-man adjustments) by signing the
// allocation. Used by both tournament and practice scoring paths so the
// dots displayed on scoring screens always match what the leaderboard
// math actually used.
// Hole par / stroke-index tables with the standard fallbacks, resolved in one
// place. A round lock's frozen tables win over the live course doc, which wins
// over a neutral default (par 4 everywhere / a plain 1-18 stroke index). Pass
// the lock only where one applies; most callers just have a course.
export const resolveHolePars = (course, lock) => lock?.hole_pars || course?.hole_pars || Array(18).fill(4);
export const resolveHoleHcps = (course, lock) => lock?.hole_handicaps || course?.hole_handicaps || Array(18).fill(9);

// ── Which way does a hole score run? ──
// Most formats hand back NET STROKES per hole, where fewer is better. Two
// hand back a per-hole POINT count instead — Stableford points and Double
// Dot's Hi/Lo dots — where more is better. Every comparison in the engine
// and on every screen (hole winner, segment winner, Total-scoring margin,
// status text) has to flip direction for those two, so the question is
// asked in exactly one place.
export const higherIsBetter = (format) => format === "stableford" || format === "double_dot";

// What a Total-scored round is actually totalling, for labels. A director who
// set "Total" on a Double Dot round is counting dots, not strokes, and the
// screens should say so.
export const totalUnit = (format) =>
  format === "double_dot" ? "dots" : format === "stableford" ? "points" : "strokes";

// The format a match's HOLE SCORES are actually computed under. Team scoring
// ("team") re-scores every hole as team best ball regardless of the round's
// format, so any consumer deriving direction (higherIsBetter) from the
// format must ask through here — reading the raw format on a Team round
// would flip the margin on a dots/points format.
export const effectiveHoleFormat = (scoringType, format) =>
  scoringType === SCORING_TYPE_TEAM ? "best_ball" : format;

// ─────────────────────────────────────────────────────────────────────────────
// SEGMENT STATE — the one answer to "where does this stretch of holes stand?"
// ─────────────────────────────────────────────────────────────────────────────
// A "segment" is any run of holes with a result: the front nine, the back
// nine, the whole match, or the first N holes of a live round. This is the
// ONLY place that question is answered. computeMatchResult awards points from
// it, the Leaderboard prints its margin, and the Scoring tab draws its status
// strip from it — previously each of those did its own arithmetic, which is
// how a Total round ended up showing a match-play state on two screens while
// the engine was scoring it on totals.
//
//   total     — settle on the running total rather than on holes won
//   higherWins — the format's per-hole number counts up (see higherIsBetter)
//   holeValue — (holeIdx) => points that hole is worth. Present only on a
//               points-per-hole round; see the block below.
//
// `margin` is always from A's perspective and always points the same way:
// positive means A is ahead, whatever the format and whichever mode.
export function segmentState(holes, { total = false, higherWins = false, holeValue = null } = {}) {
  const played = holes.filter(h => h.played);
  const aTot = played.reduce((s, h) => s + (h.aScore ?? 0), 0);
  const bTot = played.reduce((s, h) => s + (h.bScore ?? 0), 0);
  // ── Weighted holes ──
  // Match play is the special case where every hole is worth exactly 1, so
  // counting holes won and counting points won are the same arithmetic. On a
  // points round they come apart — a back nine hole is worth two of a front
  // nine one — and every question this function answers (who leads, by how
  // much, can it still be caught) has to be asked in points instead. Passing
  // a hole's value through one function keeps both readings on one code path
  // rather than forking the whole of segmentState.
  const val = (h) => (holeValue ? holeValue(h.h) : 1);
  const aWins = played.filter(h => h.winner === "A").reduce((s, h) => s + val(h), 0);
  const bWins = played.filter(h => h.winner === "B").reduce((s, h) => s + val(h), 0);
  // What is still on offer — holes left on match play, points left when the
  // holes carry different values. This is what a lead has to beat to be safe.
  const remaining = holes.filter(h => !h.played).reduce((s, h) => s + val(h), 0);
  const allIn = played.length === holes.length && played.length > 0;
  const base = { played: played.length, total: holes.length, remaining, aTot, bTot, aWins, bWins };

  if (holeValue) {
    // Points are banked hole by hole as they are won, so nothing here is
    // pending and nothing is awarded late. `complete` still reports when the
    // segment can no longer change hands, which is what the screens use to
    // stop calling a decided round live.
    const margin = aWins - bWins;
    const clinched = played.length > 0 && Math.abs(margin) > remaining;
    return {
      ...base, unit: "points", margin, clinched, complete: clinched || allIn,
      winner: clinched || allIn ? (margin > 0 ? "A" : margin < 0 ? "B" : null) : null,
    };
  }

  if (total) {
    // Nothing can be clinched early: every remaining hole still moves the
    // total, so a Total segment is decided only when the last one is in.
    const margin = higherWins ? aTot - bTot : bTot - aTot;
    return {
      ...base, unit: "total", margin, clinched: false, complete: allIn,
      winner: allIn ? (margin > 0 ? "A" : margin < 0 ? "B" : null) : null,
    };
  }
  // Match play: a lead bigger than the holes left can't be caught, so the
  // segment is over before the holes run out ("3&2").
  const margin = aWins - bWins;
  const clinched = played.length > 0 && Math.abs(margin) > remaining;
  return {
    ...base, unit: "up", margin, clinched, complete: clinched || allIn,
    winner: clinched ? (margin > 0 ? "A" : "B")
      : allIn ? (margin > 0 ? "A" : margin < 0 ? "B" : null) : null,
  };
}

// Golf-native result text for a segment. "3&2" when a match closes early,
// "2 UP" when it goes the distance, "AS" for all square, "—" before a ball is
// struck. A Total segment gets none of that language — there is no "up" and
// nothing closes out early, only a lead on the running total, so 8 dots to 6
// reads "+2" and the leading team is carried by color.
export const statusText = (st) => {
  if (!st.played) return "—";
  const m = Math.abs(st.margin);
  // A points segment gets the same treatment as a total: there is no "up" in
  // a currency where one hole is worth two of another, and "5&4" would be a
  // flat lie about how much is left. The lead, and the color, is the whole
  // story. Halves print as halves — a split hole is worth 0.5 on the front.
  if (st.unit === "points") return m === 0 ? "TIED" : `+${m % 1 ? m.toFixed(1) : m}`;
  if (st.unit === "total") return m === 0 ? "TIED" : `+${m}`;
  if (st.clinched && st.remaining > 0) return `${m}&${st.remaining}`;
  if (m === 0) return "AS";
  return `${m} UP`;
};

// Which side a segment's margin favours right now, or null when level.
export const segmentLeader = (st) => (st.margin > 0 ? "A" : st.margin < 0 ? "B" : null);

// ── How a match reads its holes ──
// THE answer to "what flags does segmentState need for this match?", asked
// once here so the engine, the Leaderboard and the Scoring tab cannot answer
// it three ways. That divergence is not hypothetical: it is exactly how a
// Total round ended up displaying a match-play state on two screens while the
// engine scored it on totals.
export const segmentOptsFor = (match, format) => {
  // Direction comes from the format the holes were ACTUALLY scored under —
  // a Team round's holes are best-ball nets whatever the round format says,
  // so a dots/points format must not flip the margin (see effectiveHoleFormat).
  const higherWins = higherIsBetter(effectiveHoleFormat(match?.scoring_type, format));
  if (isPointsPerHole(match?.scoring_type)) {
    const hp = resolveHolePoints(match?.hole_points);
    return { higherWins, holeValue: (h) => (h < 9 ? hp.front : hp.back) };
  }
  return { total: (match?.scoring_type || "match") === "stroke", higherWins };
};

export const buildStrokeMap = (ch, holeHcps) => {
  const sorted = holeHcps.map((h, i) => ({ idx: i, hcp: h })).sort((a, b) => a.hcp - b.hcp);
  const map = {};
  let rem = Math.abs(ch);
  const sign = ch >= 0 ? 1 : -1;
  for (let pass = 0; pass < 3 && rem > 0; pass++) {
    for (const h of sorted) { if (rem <= 0) break; map[h.idx] = (map[h.idx] || 0) + sign; rem--; }
  }
  return map;
};

// ─────────────────────────────────────────────────────────────────────────────
// ROUND HANDICAP LOCKS — the guarantee that completed rounds never move
// ─────────────────────────────────────────────────────────────────────────────
// `roundLocks` is a round-keyed map of frozen snapshots, { [round]: lockDoc },
// written by src/lib/roundLocks.js the moment a round starts taking scores.
// Everything below reads that snapshot in preference to live data.
//
// This module deliberately does NOT import lib/roundLocks (that module imports
// this one, for the CH math). A lock is plain data, so reading its shape here
// is enough and keeps the dependency one-directional.
//
// The resolution rule, applied identically by every caller:
//
//     round is locked AND the player is in the snapshot  →  frozen value
//     otherwise                                          →  live value
//
// The second branch is not a loophole. It is how a player added AFTER the
// lock (a late substitute) still gets a sensible handicap. Every player who
// was on the roster when the round locked takes the first branch, always.

// The snapshot for a round, or null when that round is still open.
export const lockForRound = (roundLocks, round) => {
  const lock = roundLocks?.[round];
  return lock && lock.locked ? lock : null;
};

// A player's frozen row for a round, or null (round open, or late addition).
export const lockedPlayerRow = (roundLocks, round, pid) => {
  const lock = lockForRound(roundLocks, round);
  if (!lock) return null;
  const row = lock.players?.[pid];
  return row || null;
};

// Effective Handicap Index for a player in a round. Per-round adjustments are
// now made at the COURSE-HANDICAP level (see getRoundCH / chOverrides), not the
// index level, so this resolves to the frozen HI when locked, else the
// player-level effective index (hi_override ?? handicap_index).
export const getRoundHI = ({ roundLocks, round, pid, players }) => {
  const row = lockedPlayerRow(roundLocks, round, pid);
  if (row && row.hi != null && Number.isFinite(Number(row.hi))) return Number(row.hi);
  return getEffectiveHI(pid, players);
};

// The tee a player played in a round (frozen when locked).
export const getRoundTee = ({ roundLocks, round, pid, teeAssignments, roundTee }) => {
  const row = lockedPlayerRow(roundLocks, round, pid);
  if (row && row.tee) return row.tee;
  return (teeAssignments?.[round] || {})[pid] || roundTee;
};

// THE resolution point for stroke allocation. Every scoring path, every
// leaderboard, every stroke dot on every screen goes through this function —
// which is precisely why a locked round cannot drift: there is one door and
// it is closed.
//
// Note the frozen CH is stored as the ANSWER, not recomputed from frozen
// inputs. Even a change to calcCH's rounding could not move a locked round.
export const getRoundCH = ({
  roundLocks, round, pid, players, course, chOverrides, teeAssignments, roundTee,
}) => {
  const row = lockedPlayerRow(roundLocks, round, pid);
  if (row && row.ch != null && Number.isFinite(Number(row.ch))) return Number(row.ch);
  // Director's per-round Course-Handicap override. Set DIRECTLY (not derived
  // from the index) and wins over the calculated CH for any OPEN round. A
  // locked round already returned its frozen `row.ch` above, so overrides can
  // never move a completed round. `chOverrides` shape: { [round]: { [pid]: ch } }.
  const cho = chOverrides?.[round]?.[pid];
  if (cho != null && String(cho).trim() !== "" && Number.isFinite(Number(cho))) return Number(cho);
  const hi = getRoundHI({ roundLocks, round, pid, players });
  const tee = getRoundTee({ roundLocks, round, pid, teeAssignments, roundTee });
  return calcCHForCourse(hi, course, tee);
};

// low_man vs full re-allocates every stroke in a match, so it is frozen too.
// Lock wins over an explicit argument on purpose: a completed round answers
// to its snapshot and nothing else.
export const getRoundHandicapMode = ({ roundLocks, round, tRounds, explicit }) => {
  const lock = lockForRound(roundLocks, round);
  if (lock?.handicap_mode) return lock.handicap_mode;
  return explicit
    || tRounds?.find(t => t.round_number === round)?.handicap_mode
    || (round === 4 ? "full" : "low_man");
};

// The round's handicap allowance, resolved the same way the mode is: a locked
// round answers to its snapshot, then an explicit argument, then the round doc.
// A round that names none is OFF — full handicaps — never the format's
// recommendation, which is a prefill for the admin prompt and nothing more.
// The shape always follows the FORMAT, so a round whose format changed can't be
// scored off a stale low/high pair.
export const getRoundAllowance = ({ roundLocks, round, tRounds, format, explicit }) => {
  const lock = lockForRound(roundLocks, round);
  const tr = tRounds?.find(t => t.round_number === round);
  const fmt = format || lock?.format || tr?.format;
  const saved = lock?.allowance || explicit || tr?.allowance || null;
  return resolveAllowance(fmt, saved);
};

// Apply a round's allowance to a set of Course Handicaps. Returns the EXACT
// (unrounded) figures — see applyAllowance below for the whole numbers play
// actually happens off.
//
// `sides` is one array of pids per side, because a split allowance is decided
// within a side: the lower handicap of the pair plays off `low`, their partner
// off `high`. Ties go to the lower percentage first, which matches how a side
// would be written on a card (low man first) and keeps the result stable
// regardless of roster order. A one-man side plays off `low` — there is no
// high ball to discount.
export const allowanceHandicaps = (sides, getCH, allowance) => {
  const exact = {};
  const pct = (ch, p) => ch * (p / 100);
  sides.forEach(side => {
    if (!allowance?.split) {
      side.forEach(pid => { exact[pid] = pct(getCH(pid), allowance?.pct ?? 100); });
      return;
    }
    const ranked = side
      .map(pid => ({ pid, ch: getCH(pid) }))
      .sort((a, b) => a.ch - b.ch);
    ranked.forEach(({ pid, ch }, i) => {
      exact[pid] = pct(ch, i === 0 ? allowance.low : allowance.high);
    });
  });
  return exact;
};

// The PLAYING handicaps — the numbers strokes are allocated from. Rounded per
// player, per the USGA's convention of applying the allowance to the Course
// Handicap and rounding to a whole number before play. A side that plays one
// ball rounds ONCE on its total instead (see computeMatchResult), which is why
// the exact figures are kept separately rather than summed after rounding.
export const applyAllowance = (sides, getCH, allowance) => {
  const exact = allowanceHandicaps(sides, getCH, allowance);
  const playing = {};
  Object.keys(exact).forEach(pid => { playing[pid] = Math.round(exact[pid]); });
  return playing;
};

// The round's counting scores — how many of a side's nets are added up on a
// hole. Null for every format that doesn't count scores, which is all of them
// but Team Best Ball.
//
// Unlike the allowance, the LIVE value wins over the lock. That is the line
// roundLocks.js already draws: it freezes what allocates STROKES, and leaves
// what a match is worth editable, because a director adjusting the latter
// means the adjustment to land. A count doesn't touch a single stroke — every
// net in the match is identical either way — it decides how many of those
// nets are added up. So a director who notices on the 3rd tee that the front
// nine is counting 7 can fix it, which locking it would make impossible
// without re-taking the round's handicaps as well. The count still rides in
// the lock snapshot so a finished round can say what it was scored on.
export const getRoundCounting = ({ roundLocks, round, tRounds, format, explicit }) => {
  const lock = lockForRound(roundLocks, round);
  const tr = tRounds?.find(t => t.round_number === round);
  const fmt = format || lock?.format || tr?.format;
  const saved = explicit || tr?.counting_scores || lock?.counting_scores || null;
  return resolveCounting(fmt, saved);
};

// What one hole is worth on each nine, for a points-per-hole round. Same
// resolution order and the same reasoning as the counting scores: it awards
// points, not strokes, so a director fixing it mid-round means the fix.
export const getRoundHolePoints = ({ roundLocks, round, tRounds, explicit }) => {
  const lock = lockForRound(roundLocks, round);
  const tr = tRounds?.find(t => t.round_number === round);
  return resolveHolePoints(explicit || tr?.hole_points || lock?.hole_points || null);
};

// Course + hole tables for a round. Hole handicaps decide WHICH holes get
// strokes, so a course re-import must not be able to reshuffle a finished
// round's stroke allocation — the frozen tables win when present.
export const getRoundCourseCtx = ({ roundLocks, round, tRounds, courses }) => {
  const lock = lockForRound(roundLocks, round);
  const tr = tRounds?.find(t => t.round_number === round);
  const courseId = lock?.course_id || tr?.course_id;
  const course = courses?.find(c => c.id === courseId) || null;
  return {
    lock,
    tr,
    course,
    holePars: resolveHolePars(course, lock),
    holeHcps: resolveHoleHcps(course, lock),
  };
};

// ── Match Scoring Engine ──
// `teeAssignments` is a round-scoped map of { pid: teeName } so each player's
// course handicap reflects the tee they actually played. Without it, every
// player on a multi-tee round would be calculated against the course's first
// tee, which silently mis-allocates strokes (a "Black tees" player gets the
// same CH as a "White tees" player on the same course — they shouldn't).
//
// `roundLocks` (last arg) is the frozen-snapshot map described above. When the
// match's round is locked, handicaps, tees, handicap mode, course and hole
// tables all come from the snapshot and live edits are ignored entirely.
export function computeMatchResult(match, holeData, courses, tRounds, tPlayers, format, chOverrides, handicapMode, teeAssignments, roundLocks) {
  // holeData: { pid_round: { holeIdx: score } }
  const rnd = match.round;
  const { lock, tr, course, holePars, holeHcps } =
    getRoundCourseCtx({ roundLocks, round: rnd, tRounds, courses });
  // A locked round can still be scored if the course doc has since been
  // deleted — the snapshot carries its own hole tables. Only bail when
  // there is neither a course nor a snapshot to score against.
  if (!course && !lock) return { status: "AS", frontPts: 0, backPts: 0, overallPts: 0, holes: [] };

  const getPlayerScores = (pid) => holeData[`${pid}_${rnd}`] || {};
  const roundTee = tr?.tee_box;
  const getCH = (pid) => getRoundCH({
    roundLocks, round: rnd, pid, players: tPlayers, course, chOverrides, teeAssignments, roundTee,
  });
  const getStrokeMap = (ch) => buildStrokeMap(ch, holeHcps);
  // Scoring type: how each pot is awarded — and, for "team", how holes are
  // scored. Match (default) plays hole-by-hole under the round's format;
  // "stroke" (labelled Medal) awards each segment on the running total;
  // "team" is team best ball — each side's hole score is its best individual
  // net, scored as match play, whatever the format's own per-hole method
  // would be. Team routes through the existing best_ball branch below so the
  // engine keeps exactly one definition of "best ball".
  const scoringType = match.scoring_type || "match";
  const holeFormat = effectiveHoleFormat(scoringType, format);
  // Stableford points and Double Dot dots count UP; every other format's
  // per-hole number is net strokes and counts down.
  const higherWins = higherIsBetter(holeFormat);
  const netScore = (gross, holeIdx, strokeMap) => gross == null ? null : gross - (strokeMap[holeIdx] || 0);

  const teamA = match.teamA; // array of pids
  const teamB = match.teamB;

  // ── Handicap allocation ──
  // Three settings decide every stroke in the match, in this order:
  //
  //   1. ALLOWANCE — how much of each player's Course Handicap comes to the
  //      tee at all (Four-Ball 90%, Scramble 35/15, …). Off unless the
  //      director turned it on for the round, in which case it is a flat
  //      100% and this step changes nothing. Frozen once the round locks.
  //   2. MODE      — low_man plays the difference off the lowest PLAYING
  //      handicap in the match; full gives everyone their whole figure.
  //   3. Stroke-index allocation, which is just arithmetic from there.
  //
  // Allowance comes first because it is a property of the format's fairness,
  // and low-man is a property of the match: taking the difference of two
  // already-reduced handicaps is the order the Rules of Handicapping use.
  const roundHandicapMode = getRoundHandicapMode({ roundLocks, round: rnd, tRounds, explicit: handicapMode });
  const allowance = getRoundAllowance({ roundLocks, round: rnd, tRounds, format });
  // How many of a side's nets count on a hole (Team Best Ball only; null
  // everywhere else). Both sides count the SAME number — the smaller of the
  // director's figure and the smaller roster — because two sums built from
  // different numbers of scores are not comparable, and a side short a player
  // would otherwise never post a hole at all.
  const counting = getRoundCounting({ roundLocks, round: rnd, tRounds, format });
  const countFor = (h) => Math.min(counting[h], teamA.length, teamB.length);
  const allPids = [...teamA, ...teamB];
  // Playing handicaps — the allowance-adjusted figures. A split allowance is
  // resolved per SIDE, so teamA and teamB are passed as separate groups.
  const exactCH = allowanceHandicaps([teamA, teamB], getCH, allowance);
  const playingCH = {};
  allPids.forEach(pid => { playingCH[pid] = Math.round(exactCH[pid] ?? 0); });
  const minCH = Math.min(...allPids.map(pid => playingCH[pid] ?? 0));
  const getAdjustedStrokeMap = (pid) => {
    if (roundHandicapMode === "full") return getStrokeMap(playingCH[pid] ?? 0);
    // Play off the low man: low man gets 0, others get the difference
    return getStrokeMap((playingCH[pid] ?? 0) - minCH);
  };

  // ── Shared-ball team handicaps ──
  // A side that plays ONE ball has one handicap: the sum of its players'
  // allowance-adjusted figures (35% of the low man + 15% of the high man for
  // a two-man scramble). Summed, not averaged — the allowance percentages are
  // already sized on the assumption that they add up. The sum is taken on the
  // exact figures and rounded once, so two halves make a stroke rather than
  // rounding to nothing (or to two) on the way in.
  const teamCH = (side) => Math.round(side.reduce((s, pid) => s + (exactCH[pid] ?? 0), 0));
  const aTeamCH = teamCH(teamA), bTeamCH = teamCH(teamB);
  // Low-man applies to the SIDES here rather than to individuals, for the same
  // reason it applies to individuals elsewhere: the better side plays scratch
  // and the other plays the difference.
  const teamMin = roundHandicapMode === "full" ? 0 : Math.min(aTeamCH, bTeamCH);
  const sharedStrokeMaps = {
    A: getStrokeMap(aTeamCH - teamMin),
    B: getStrokeMap(bTeamCH - teamMin),
  };

  // Compute per-hole results
  const holeResults = Array(18).fill(null).map((_, h) => {
    let aScore = null, bScore = null;
    if (holeFormat === "singles") {
      const aPid = teamA[0], bPid = teamB[0];
      const aMap = getAdjustedStrokeMap(aPid);
      const bMap = getAdjustedStrokeMap(bPid);
      const aRaw = getPlayerScores(aPid)[h];
      const bRaw = getPlayerScores(bPid)[h];
      aScore = netScore(aRaw, h, aMap);
      bScore = netScore(bRaw, h, bMap);
    } else if (holeFormat === "best_ball") {
      const aNets = teamA.map(pid => { const m = getAdjustedStrokeMap(pid); return netScore(getPlayerScores(pid)[h], h, m); }).filter(s => s != null);
      const bNets = teamB.map(pid => { const m = getAdjustedStrokeMap(pid); return netScore(getPlayerScores(pid)[h], h, m); }).filter(s => s != null);
      aScore = aNets.length ? Math.min(...aNets) : null;
      bScore = bNets.length ? Math.min(...bNets) : null;
    } else if (holeFormat === "team_best_ball") {
      // ── Team Best Ball ──
      // The whole side is one match, and a hole is the SUM of that side's
      // best N net scores — not its single best ball. N is the round's
      // counting score for THAT hole (see constants: the front has counted
      // 5-6 of 8 and the back 6-7), which is why this can't be expressed as
      // either a Four-Ball or a Team Total.
      //
      // A hole scores as soon as N of a side's players are in. That is
      // deliberate on a format where the side is spread over four tee times:
      // holding the hole until all eight had posted would leave the
      // leaderboard half an hour behind the course all day. Adding a later
      // net can only ever lower the sum (it is added only if it beats one
      // already counted), so the number moves in one direction and settles
      // the moment the side finishes the hole.
      const nets = (side) => side
        .map(pid => netScore(getPlayerScores(pid)[h], h, getAdjustedStrokeMap(pid)))
        .filter(s => s != null)
        .sort((a, b) => a - b);
      const need = countFor(h);
      const sideScore = (side) => {
        const ns = nets(side);
        if (!need || ns.length < need) return null;
        return ns.slice(0, need).reduce((a, b) => a + b, 0);
      };
      aScore = sideScore(teamA);
      bScore = sideScore(teamB);
    } else if (holeFormat === "aggregate" || holeFormat === "team_total") {
      // Combined team net per hole — both teammates' net scores are summed
      // and compared as a single team score. The Bourbon Cup name for this is
      // "Team Total"; "aggregate" is a legacy alias retained for any matches
      // saved before the format was officially exposed in the FORMATS list.
      const aNets = teamA.map(pid => { const m = getAdjustedStrokeMap(pid); return netScore(getPlayerScores(pid)[h], h, m); });
      const bNets = teamB.map(pid => { const m = getAdjustedStrokeMap(pid); return netScore(getPlayerScores(pid)[h], h, m); });
      if (aNets.every(s => s != null)) aScore = aNets.reduce((a,b) => a+b, 0);
      if (bNets.every(s => s != null)) bScore = bNets.reduce((a,b) => a+b, 0);
    } else if (holeFormat === "double_dot") {
      // ── Double Dot (2-man Hi/Lo) ──
      // Every hole is TWO sub-matches played at once: the two sides' LOW
      // balls against each other, and their HIGH balls against each other.
      // Each sub-match won is a dot; a tied sub-match awards no dot to
      // anyone. So a hole hands out 2, 1 or 0 dots and can be split 1-1 —
      // which is where the name comes from, and why the running total is
      // dots rather than holes.
      //
      // aScore/bScore are therefore DOT COUNTS (0-2) here, not net strokes.
      // higherIsBetter("double_dot") is what tells the rest of the engine
      // to read them the right way round.
      const nets = (team) => team.map(pid => {
        const m = getAdjustedStrokeMap(pid);
        return netScore(getPlayerScores(pid)[h], h, m);
      });
      const aNets = nets(teamA), bNets = nets(teamB);
      if (aNets.length && bNets.length && aNets.every(s => s != null) && bNets.every(s => s != null)) {
        const aLo = Math.min(...aNets), bLo = Math.min(...bNets);
        // A one-man side has no separate high ball to contest, so only the
        // low-ball dot is on offer. Better a half-format that scores than a
        // side whose single ball wins both dots by itself.
        const twoBall = aNets.length > 1 && bNets.length > 1;
        const aHi = Math.max(...aNets), bHi = Math.max(...bNets);
        aScore = (aLo < bLo ? 1 : 0) + (twoBall && aHi < bHi ? 1 : 0);
        bScore = (bLo < aLo ? 1 : 0) + (twoBall && bHi < aHi ? 1 : 0);
      }
    } else if (holeFormat === "scramble") {
      // The side plays one ball, so it posts one score and takes strokes off
      // ONE team handicap (built above from the round's allowance). Both
      // partners' cards should carry the team score; taking the lower of the
      // two keeps the hole scoring when only one of them has been entered.
      const aRaws = teamA.map(pid => getPlayerScores(pid)[h]).filter(s => s != null);
      const bRaws = teamB.map(pid => getPlayerScores(pid)[h]).filter(s => s != null);
      aScore = aRaws.length ? netScore(Math.min(...aRaws), h, sharedStrokeMaps.A) : null;
      bScore = bRaws.length ? netScore(Math.min(...bRaws), h, sharedStrokeMaps.B) : null;
    } else if (holeFormat === "stableford") {
      // Stableford scores against PAR, not against the other side, so the
      // full playing handicap is used — there is no low-man difference to
      // take. The allowance still applies: it decides the handicap itself.
      const aPid = teamA[0], bPid = teamB[0];
      const aMap = getStrokeMap(playingCH[aPid] ?? 0), bMap = getStrokeMap(playingCH[bPid] ?? 0);
      const aNet = netScore(getPlayerScores(aPid)[h], h, aMap);
      const bNet = netScore(getPlayerScores(bPid)[h], h, bMap);
      const sfPts = (net) => { if (net == null) return null; const d = net - holePars[h]; return Math.max(0, 2 - d); };
      aScore = sfPts(aNet);
      bScore = sfPts(bNet);
    } else {
      // Default: match play net
      const aPid = teamA[0], bPid = teamB[0];
      const aMap = getAdjustedStrokeMap(aPid);
      const bMap = getAdjustedStrokeMap(bPid);
      aScore = netScore(getPlayerScores(aPid)[h], h, aMap);
      bScore = netScore(getPlayerScores(bPid)[h], h, bMap);
    }

    let winner = null;
    if (aScore != null && bScore != null) {
      if (higherWins) winner = aScore > bScore ? "A" : aScore < bScore ? "B" : null;
      else winner = aScore < bScore ? "A" : aScore > bScore ? "B" : null;
    }
    return { h, aScore, bScore, winner, played: aScore != null && bScore != null };
  });

  // How the round settles, given scoringType (resolved at the top).
  //
  //   Match  — holes won take the nassau {front, back, overall} pots.
  //   Medal  — the same pots, but awarded on the side's RUNNING TOTAL over
  //            each segment rather than on holes won: fewest net strokes for
  //            a stroke format, most dots for Double Dot, most points for
  //            Stableford. "Single" (front=back=0) collapses to one 18-hole
  //            pot. The stored value is still `"stroke"` — it predates the
  //            Medal label.
  //   Team   — team best ball: the holes were re-scored above as each side's
  //            best individual net, and settle on holes won, exactly like
  //            Match.
  //   Points — every HOLE is its own pot, worth what its nine is worth. No
  //            pots, no segments to settle, nothing awarded late. Kept in
  //            the engine for rounds saved while it was offered, though the
  //            admin toggle no longer exposes it.
  const pointsPerHole = isPointsPerHole(scoringType);
  const holePoints = pointsPerHole
    ? getRoundHolePoints({ roundLocks, round: rnd, tRounds })
    : null;
  const segOpts = segmentOptsFor({ ...match, hole_points: holePoints }, format);

  // The three segments, from the shared segmentState — the same function the
  // Leaderboard and the Scoring tab call, so a match can never be awarded on
  // one reading of the holes and displayed on another. All three are computed
  // regardless of point method: the leaderboard shows front/back progress
  // even on a Traditional round that only pays out on the overall.
  const front = segmentState(holeResults.slice(0, 9), segOpts);
  const back = segmentState(holeResults.slice(9, 18), segOpts);
  const overall = segmentState(holeResults, segOpts);

  // Award points based on the match's configured point_method.
  //   Traditional → single pot for the overall result; ½/½ on a halve.
  //   Nassau      → independent pots for front, back, and overall.
  // Method falls back to Nassau when absent so legacy matches saved
  // before this field existed continue to score correctly.
  //
  // Total rounds always pay out Nassau-style, because the "Single" case is
  // already a Nassau with front and back set to zero.
  const pointMethod = match.point_method || POINT_METHOD_NASSAU;
  const frontPts = { A: 0, B: 0 };
  const backPts = { A: 0, B: 0 };
  const overallPts = { A: 0, B: 0 };

  // One pot, one segment: the winner takes it, a halved segment splits it.
  const award = (seg, pot, out) => {
    if (!seg.complete || !pot) return;
    if (seg.winner) out[seg.winner] = pot;
    else { out.A = pot / 2; out.B = pot / 2; }
  };

  if (pointsPerHole) {
    // 18 settlements, not three. Each hole pays its own value out the moment
    // it is played — winner takes it, a halved hole splits it — so the front
    // and back totals here are running tallies rather than pots waiting on a
    // segment to close. `overallPts` stays empty on purpose: the two nines
    // already account for every point in the round, and adding an overall pot
    // on top would pay for the same 18 holes twice.
    holeResults.forEach((hr) => {
      if (!hr.played) return;
      const pot = hr.h < 9 ? holePoints.front : holePoints.back;
      if (!pot) return;
      const out = hr.h < 9 ? frontPts : backPts;
      if (hr.winner) out[hr.winner] += pot;
      else { out.A += pot / 2; out.B += pot / 2; }
    });
  } else if (pointMethod === POINT_METHOD_TRADITIONAL && scoringType !== "stroke") {
    award(overall, match.traditional_points ?? 1, overallPts);
  } else {
    const nassau = match.nassau || NASSAU_DEFAULT;
    award(front, nassau.front, frontPts);
    award(back, nassau.back, backPts);
    award(overall, nassau.overall, overallPts);
  }

  // Current match status string for display, in the same words the screens
  // use — "3&2", "2 UP", "+2" — with the side it favours appended.
  const playedHoles = holeResults.filter(r => r.played);
  const leader = segmentLeader(overall);
  const status = leader ? `${statusText(overall)} (${leader})` : statusText(overall);

  // Per-player adjusted stroke maps (allowance, then low-man or full per the
  // round's mode) — the exact strokes this result was scored with. Exposed so
  // score-entry and scorecard views render dots from the SAME allocation
  // instead of mirroring this function's internals.
  //
  // On a shared-ball format both partners get their side's TEAM map, because
  // that is the only allocation in play: the side has one ball and one set of
  // strokes. Handing back individual maps here would draw dots on the scoring
  // screen that nothing in the result was ever scored with.
  const strokeMaps = {};
  const sharedBall = !!allowance.shared;
  allPids.forEach(pid => {
    strokeMaps[pid] = sharedBall
      ? sharedStrokeMaps[teamA.includes(pid) ? "A" : "B"]
      : getAdjustedStrokeMap(pid);
  });

  return {
    holes: holeResults,
    front, back, overall,
    frontPts, backPts, overallPts,
    status,
    holesPlayed: playedHoles.length,
    strokeMaps,
    // The handicap terms this result was scored on, for the screens that
    // show a player's number next to their name. `playingCH` is post-
    // allowance, pre-low-man; `teamCH` is the side's figure on a shared-ball
    // format and null on every other.
    allowance,
    // 18 per-hole counts on Team Best Ball, null on every other format — the
    // counts this result's hole scores were actually built from.
    counting,
    // {front, back} on a points-per-hole round, null otherwise: what one hole
    // was worth on each nine.
    holePoints,
    playingCH,
    teamCH: sharedBall ? { A: aTeamCH, B: bTeamCH } : null,
    totalPts: {
      A: (frontPts.A || 0) + (backPts.A || 0) + (overallPts.A || 0),
      B: (frontPts.B || 0) + (backPts.B || 0) + (overallPts.B || 0),
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PRACTICE / TEST EVENT MODE
// ─────────────────────────────────────────────────────────────────────────────
// Self-contained "practice round" feature — separate from main tournament data.
// 8 players → 4 teams of 2 → 2 head-to-head Team Total match-play matches.
//
// Storage:
//   bc_practice_event   — single doc { id: 'current', course_id, hcp_mode,
//                         hcp_overrides, teams: [{id,name,p1,p2}],
//                         matches: [{id,team1,team2}] }
//   bc_practice_scores  — { id, player_id, hole_number (1-18), score }
//   bc_practice_ctp     — { id, hole, player_id }
// (Skins are auto-computed from scores, no Firestore needed.)

// ─────────────────────────────────────────────────────────────────────────────
// Team Total match-play calculation (18 holes)
// ─────────────────────────────────────────────────────────────────────────────
// Per hole: sum each team's net scores. Lower combined net wins the hole.
// Walk all 18; track running cumulative (T1 holes − T2 holes).
// matchResultText: "AS" | "1UP" | "5&4" | "3&2"
// Returns a thru count so the leaderboard knows how far along the match is.
export function computePracticeMatch({ match, scores, course, players, hcpOverrides, hcpMode, teeName }) {
  const empty = { holes: Array(18).fill({ result: null, n1: null, n2: null }), running: Array(18).fill(0), thru: 0, matchResultText: "—", winnerTeamId: null, clinched: false, endHole: 17, holesWon1: 0, holesWon2: 0, dormie: false };
  if (!course || !match) return empty;

  const holeHcps = resolveHoleHcps(course);

  const t1Pids = [match.team1.player1, match.team1.player2].filter(Boolean);
  const t2Pids = [match.team2.player1, match.team2.player2].filter(Boolean);
  const allPids = [...t1Pids, ...t2Pids];
  if (allPids.length < 4) return empty;

  // HI lookup with per-event override support — delegates to the shared
  // helper so override semantics stay identical to tournament scoring.
  const getHI = (pid) => getEffectiveHI(pid, players, hcpOverrides);
  const getCH = (pid) => calcCHForCourse(getHI(pid), course, teeName);

  // Low-man adjustment: low CH plays scratch, others get diff
  const allCHs = allPids.map(getCH);
  const minCH = Math.min(...allCHs);
  const adjustedCH = (pid) => hcpMode === "full" ? getCH(pid) : (getCH(pid) - minCH);

  // Stroke map across 18 holes (shared helper allocates strokes to
  // lowest-hcp holes first; up to 3 wraps for handicaps > 18).
  const strokeMaps = {};
  allPids.forEach(pid => { strokeMaps[pid] = buildStrokeMap(adjustedCH(pid), holeHcps); });

  // Per-hole combined team net
  const holes = [];
  for (let h = 0; h < 18; h++) {
    let n1 = 0, n2 = 0, ok1 = true, ok2 = true;
    for (const pid of t1Pids) {
      const raw = scores[`${pid}_${h}`];
      if (raw == null || raw === 0) { ok1 = false; }
      else { n1 += raw - (strokeMaps[pid][h] || 0); }
    }
    for (const pid of t2Pids) {
      const raw = scores[`${pid}_${h}`];
      if (raw == null || raw === 0) { ok2 = false; }
      else { n2 += raw - (strokeMaps[pid][h] || 0); }
    }
    let result = null;
    if (ok1 && ok2) {
      if (n1 < n2) result = 1;
      else if (n2 < n1) result = -1;
      else result = 0;
    }
    holes.push({ result, n1: ok1 ? n1 : null, n2: ok2 ? n2 : null });
  }

  // Running cumulative; null holes don't change cumulative
  const running = [];
  let cum = 0;
  holes.forEach(hole => {
    if (hole.result !== null) cum += hole.result;
    running.push(cum);
  });

  // Find clinch hole (lead > remaining holes). Only valid BEFORE hole 18 — if
  // a match goes all 18 it's a "XUP" finish, not a clinched "X&0".
  let endHole = 17;
  let margin = Math.abs(running[17]);
  let clinched = false;
  for (let h = 0; h < 18; h++) {
    if (holes[h].result === null) continue;  // can't clinch on unscored hole
    const lead = Math.abs(running[h]);
    const remaining = 17 - h;
    if (remaining > 0 && lead > remaining) { endHole = h; margin = lead; clinched = true; break; }
  }

  // Last completed hole
  let lastCompleted = -1;
  for (let h = 17; h >= 0; h--) {
    if (holes[h].result !== null) { lastCompleted = h; break; }
  }
  const thru = lastCompleted + 1;

  let matchResultText = "—";
  let winnerTeamId = null;
  if (lastCompleted < 0) {
    matchResultText = "—";
  } else if (clinched) {
    const remaining = 17 - endHole;
    matchResultText = `${margin}&${remaining}`;
    winnerTeamId = running[endHole] > 0 ? match.team1.id : match.team2.id;
  } else if (lastCompleted === 17) {
    const final = running[17];
    if (final === 0) matchResultText = "AS";
    else { matchResultText = `${Math.abs(final)}UP`; winnerTeamId = final > 0 ? match.team1.id : match.team2.id; }
  } else {
    // In progress
    const cur = running[lastCompleted];
    const remaining = 17 - lastCompleted;
    if (cur === 0) matchResultText = "AS";
    else if (Math.abs(cur) === remaining) matchResultText = `${Math.abs(cur)}UP (Dormie)`;
    else matchResultText = `${Math.abs(cur)}UP`;
  }

  const dormie = !clinched && lastCompleted >= 0 && lastCompleted < 17 && Math.abs(running[lastCompleted]) === (17 - lastCompleted);

  return {
    holes,
    running,
    thru,
    matchResultText,
    winnerTeamId,
    clinched,
    endHole,
    holesWon1: holes.filter(h => h.result === 1).length,
    holesWon2: holes.filter(h => h.result === -1).length,
    dormie,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Skins — auto-computed from scores (gross + net)
// ─────────────────────────────────────────────────────────────────────────────
// For each hole: lowest gross unique → gross skin; lowest net unique → net skin.
// Tie = no skin on that hole. Returns { gross: {h: pid|null}, net: {h: pid|null} }.
export function computePracticeSkins({ scores, players, course, hcpOverrides, teeName }) {
  const result = { gross: {}, net: {}, strokeMaps: {} };
  if (!course || !players.length) return result;

  const holeHcps = resolveHoleHcps(course);
  const getHI = (pid) => getEffectiveHI(pid, players, hcpOverrides);
  const getCH = (pid) => calcCHForCourse(getHI(pid), course, teeName);

  // Each player gets their FULL course handicap for skins (not low-man adjusted —
  // skins are an individual side game, not match play). Standard practice.
  const strokeMaps = {};
  players.forEach(p => { strokeMaps[p.player_id] = buildStrokeMap(getCH(p.player_id), holeHcps); });

  for (let h = 0; h < 18; h++) {
    const grossEntries = [];
    const netEntries = [];
    for (const p of players) {
      const raw = scores[`${p.player_id}_${h}`];
      if (raw == null || raw === 0) continue;
      grossEntries.push({ pid: p.player_id, score: raw });
      netEntries.push({ pid: p.player_id, score: raw - (strokeMaps[p.player_id][h] || 0) });
    }
    if (grossEntries.length < 2) { result.gross[h] = null; result.net[h] = null; continue; }

    // Gross skin
    grossEntries.sort((a, b) => a.score - b.score);
    if (grossEntries[0].score < grossEntries[1].score) result.gross[h] = grossEntries[0].pid;
    else result.gross[h] = null;

    // Net skin
    netEntries.sort((a, b) => a.score - b.score);
    if (netEntries[0].score < netEntries[1].score) result.net[h] = netEntries[0].pid;
    else result.net[h] = null;
  }
  // Expose the per-player stroke maps so the UI can render stroke
  // dots and net scores per hole. The maps are already computed for
  // skin determination; surfacing them avoids re-computing the same
  // thing in the betting view.
  result.strokeMaps = strokeMaps;
  return result;
}
