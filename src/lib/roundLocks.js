// ══════════════════════════════════════════════════════════════════
//  Round handicap locks — a completed round NEVER recalculates.
// ══════════════════════════════════════════════════════════════════
//
// THE PROBLEM
// -----------
// Every scoring path derived a player's Course Handicap live, at render
// time, from `bc_players.handicap_index`. That is correct right up until
// the moment a director updates a handicap mid-event — at which point
// EVERY match in EVERY round silently re-derives its stroke allocation,
// including rounds that finished hours or days ago. A player who won 2&1
// on Friday could quietly become a loser on Saturday because someone
// synced a GHIN index.
//
// THE FIX
// -------
// Freeze the inputs. The moment a round starts taking scores, we write a
// snapshot ("lock") of everything that feeds stroke allocation for that
// round. From then on the round scores off the snapshot, not off live
// data. A handicap edited afterwards applies only to rounds that have not
// yet been locked — i.e. future rounds — exactly as intended.
//
// WHAT IS FROZEN (all of it matters)
// ----------------------------------
//   players[pid].hi      — effective Handicap Index (base HI or the
//                          round's override, already resolved)
//   players[pid].tee     — the tee that player played
//   players[pid].slope   \
//   players[pid].rating   >  the tee's rating values at lock time
//   players[pid].par     /
//   players[pid].ch      — the resulting Course Handicap. Stored as the
//                          final answer, not just its inputs, so even a
//                          change to calcCH's rounding could not move a
//                          completed round.
//   handicap_mode        — low_man vs full. Flipping this re-allocates
//                          every stroke in the match, so it is frozen.
//   course_id            — pointing the round at a different course after
//                          the fact would otherwise re-rate everything.
//   hole_pars            \  frozen because a course re-import (GHIN, the
//   hole_handicaps       /  course API) can rewrite them, and hole
//                          handicaps decide WHICH holes get strokes.
//
// Deliberately NOT frozen: hole scores (that IS the live data), match
// rosters, and Nassau/point values (a director legitimately adjusts what
// a match is worth; that never changes strokes).
//
// LIFECYCLE
// ---------
//   open   → no snapshot; the round scores off live data. Handicap edits
//            flow through. This is the correct state for a future round.
//   locked → snapshot exists; the round is immune to handicap edits. The
//            director can still Refresh the snapshot (deliberate, with a
//            confirm) if a round was locked prematurely.
//   final  → the round is over. Refresh is disabled behind an explicit,
//            typed Unlock. This is the "never touched again" state.
//
// Locking is AUTOMATIC on the first score saved for a round (see
// ensureRoundLock in App.jsx). That automation is the actual guarantee —
// it does not depend on the director remembering to press anything
// before the group tees off.
import { calcCH, calcCHForCourse, getEffectiveHI } from "../scoring";

export const ROUND_LOCKS_COL = "bc_round_locks";
export const roundLockDocId = (round) => `bc_lock_r${round}`;

export const LOCK_OPEN = "open";
export const LOCK_LOCKED = "locked";
export const LOCK_FINAL = "final";

// ── State predicates ────────────────────────────────────────────────
// `locks` is the round-keyed map App maintains: { [round_number]: lockDoc }.
export const isRoundLocked = (locks, round) => !!locks?.[round]?.locked;
export const isRoundFinal = (locks, round) => !!(locks?.[round]?.locked && locks[round].final);
export const roundLockState = (locks, round) =>
  isRoundFinal(locks, round) ? LOCK_FINAL : isRoundLocked(locks, round) ? LOCK_LOCKED : LOCK_OPEN;

export const LOCK_STATE_LABEL = {
  [LOCK_OPEN]: "OPEN",
  [LOCK_LOCKED]: "LOCKED",
  [LOCK_FINAL]: "FINAL",
};

// Round numbers with an active snapshot, ascending.
export const lockedRoundNumbers = (locks) =>
  Object.keys(locks || {})
    .map(Number)
    .filter((r) => Number.isFinite(r) && isRoundLocked(locks, r))
    .sort((a, b) => a - b);

export const finalRoundNumbers = (locks) =>
  lockedRoundNumbers(locks).filter((r) => isRoundFinal(locks, r));

export const openRoundNumbers = (locks, allRounds = [1, 2, 3, 4]) =>
  allRounds.filter((r) => !isRoundLocked(locks, r));

// A single player's frozen row for a round, or null when the round is
// unlocked OR the player was added after the lock was taken (a late sub
// legitimately falls through to live values — see resolution in scoring.js).
export const lockedPlayerEntry = (locks, round, pid) => {
  if (!isRoundLocked(locks, round)) return null;
  return locks[round].players?.[pid] || null;
};

// ── Tee resolution ──────────────────────────────────────────────────
// Mirrors calcCHForCourse's fallback chain so the snapshot records the
// exact slope/rating/par the live math would have used at this instant.
const resolveTeeSpec = (course, teeName) => {
  const teeBoxes = course?.tee_boxes || [];
  const named = teeName ? teeBoxes.find((t) => t.name === teeName) : null;
  if (named) {
    return {
      tee: named.name || null,
      slope: parseFloat(named.slope) || 113,
      rating: parseFloat(named.rating) || 72,
      par: parseFloat(named.par) || 72,
    };
  }
  const fallback = teeBoxes[0] || {};
  return {
    tee: teeName || fallback.name || null,
    slope: parseFloat(course?.slope) || parseFloat(fallback.slope) || 113,
    rating: parseFloat(course?.rating) || parseFloat(fallback.rating) || 72,
    par: parseFloat(course?.par) || parseFloat(fallback.par) || 72,
  };
};

// ── Snapshot builder ────────────────────────────────────────────────
// Captures EVERY tournament player, not just those in the round's
// matches, so a late roster change or substitution still lands on frozen
// numbers rather than falling through to whatever the live index says by
// then.
//
// `previous` (when refreshing an existing lock) preserves the original
// locked_at / locked_by so the audit trail shows when the round was first
// closed as well as when it was last refreshed.
export function buildRoundLockDoc({
  tournamentId,
  round,
  players = [],
  tRounds = [],
  courses = [],
  hcpOverrides = {},
  teeAssignments = {},
  lockedBy = null,
  previous = null,
  reason = "manual",
}) {
  const tr = tRounds.find((t) => t.round_number === round) || {};
  const course = courses.find((c) => c.id === tr.course_id) || null;
  const roundOverrides = hcpOverrides?.[round] || {};
  const roundTees = teeAssignments?.[round] || {};
  const now = new Date().toISOString();

  const snapshot = {};
  players.forEach((p) => {
    const pid = p.player_id;
    if (!pid) return;
    const hi = getEffectiveHI(pid, players, roundOverrides);
    const teeName = roundTees[pid] || tr.tee_box || null;
    const spec = resolveTeeSpec(course, teeName);
    snapshot[pid] = {
      name: p.name || pid,
      team: p.team || null,
      hi,
      base_hi: parseFloat(p.handicap_index) || 0,
      overridden: roundOverrides[pid] !== undefined && roundOverrides[pid] !== "",
      tee: spec.tee,
      slope: spec.slope,
      rating: spec.rating,
      par: spec.par,
      // The final answer, frozen. Everything above is audit detail.
      ch: calcCHForCourse(hi, course, teeName),
    };
  });

  return {
    id: roundLockDocId(round),
    tournament_id: tournamentId,
    round_number: round,
    locked: true,
    final: previous?.final || false,
    locked_at: previous?.locked_at || now,
    locked_by: previous?.locked_by || lockedBy || null,
    locked_reason: previous?.locked_reason || reason,
    refreshed_at: previous ? now : null,
    refreshed_by: previous ? lockedBy || null : null,
    finalized_at: previous?.finalized_at || null,
    finalized_by: previous?.finalized_by || null,
    // Frozen round context
    course_id: tr.course_id || null,
    course_name: course?.name || null,
    handicap_mode: tr.handicap_mode || (round === 4 ? "full" : "low_man"),
    format: tr.format || null,
    hole_pars: course?.hole_pars || null,
    hole_handicaps: course?.hole_handicaps || null,
    players: snapshot,
  };
}

// Re-take a snapshot against current live values, preserving audit fields.
export const refreshRoundLockDoc = (args) =>
  buildRoundLockDoc({ ...args, previous: args.previous || null, reason: "refresh" });

// Mark the round finished. `final` is what disables Refresh — the round
// is now in its "never touched again" state.
export function markRoundFinal(lock, by = null) {
  if (!lock) return null;
  const now = new Date().toISOString();
  return {
    ...lock,
    final: true,
    finalized_at: lock.finalized_at || now,
    finalized_by: lock.finalized_by || by,
  };
}

// Step a FINAL round back to merely LOCKED. Deliberately does not clear
// the snapshot — un-finalizing re-enables Refresh, it does not by itself
// change a single stroke. The director must then explicitly Refresh.
export function unfinalizeRound(lock, by = null) {
  if (!lock) return null;
  return {
    ...lock,
    final: false,
    unfinalized_at: new Date().toISOString(),
    unfinalized_by: by,
  };
}

// Remove the snapshot entirely and hand the round back to live data.
// Only reachable for a non-final round; used when a round was locked by a
// stray score entry before the event actually began.
export function clearRoundLockDoc(lock, round, tournamentId, by = null) {
  return {
    id: roundLockDocId(round),
    tournament_id: tournamentId,
    round_number: round,
    locked: false,
    final: false,
    players: {},
    cleared_at: new Date().toISOString(),
    cleared_by: by,
    // Keep the previous audit trail visible rather than deleting history.
    previous_locked_at: lock?.locked_at || null,
    previous_locked_by: lock?.locked_by || null,
  };
}

// ── Impact reporting ────────────────────────────────────────────────
// Used by the Players tab so a director editing a handicap is told, in
// the same breath, exactly which rounds the edit will and will not touch.
export function describeHiChangeImpact(locks, allRounds = [1, 2, 3, 4]) {
  const locked = lockedRoundNumbers(locks).filter((r) => allRounds.includes(r));
  const open = allRounds.filter((r) => !locked.includes(r));
  return {
    locked,
    open,
    text: locked.length
      ? `Rounds ${locked.join(", ")} are locked and will NOT change. This applies to round${open.length === 1 ? "" : "s"} ${open.join(", ") || "— none remaining"}.`
      : "No rounds are locked yet, so this applies everywhere.",
  };
}

// Short human string for the lock badge / tooltip.
export function describeLock(lock) {
  if (!lock?.locked) return "Not locked — scoring off live handicaps.";
  const at = lock.locked_at ? new Date(lock.locked_at).toLocaleString() : "unknown time";
  const who = lock.locked_by ? ` by ${lock.locked_by}` : "";
  const how = lock.locked_reason === "auto" ? " (auto, on first score)" : "";
  const refreshed = lock.refreshed_at
    ? ` · refreshed ${new Date(lock.refreshed_at).toLocaleString()}`
    : "";
  return `${lock.final ? "Final" : "Locked"} ${at}${who}${how}${refreshed}`;
}

// Course Handicap straight off a frozen tee spec. Used where a format
// needs to re-derive a CH from a modified index (scramble's 35% team
// allowance) but must still do so against the tee as it was at lock time.
export const chFromLockedSpec = (hi, entry) =>
  calcCH(hi, entry?.slope ?? 113, entry?.rating ?? 72, entry?.par ?? 72);
