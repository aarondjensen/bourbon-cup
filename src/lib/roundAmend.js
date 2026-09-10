// ══════════════════════════════════════════════════════════════════
//  Amending a finalized round — the way back into a closed round.
// ══════════════════════════════════════════════════════════════════
//
// THE PROBLEM
// -----------
// lib/roundLocks freezes a round so that nothing can move it by accident,
// and that guarantee is the right one: a handicap synced on Saturday must
// not re-score Friday. But "cannot be moved by accident" was implemented as
// "cannot be moved", and those are not the same promise. A hole typed wrong,
// signed, attested and finalized is a real thing that happens once a decade,
// and when it does the app had no answer at all — the fix was a Firebase
// console edit on raw document ids, performed by the one person least able
// to verify it from a phone on a golf course.
//
// A gate with no door is not safer than a heavy door. It just moves the
// override outside the app, where nothing records it and nothing checks it.
//
// THE SHAPE OF THE DOOR
// ---------------------
// No new lock state. The lifecycle in roundLocks already has the state an
// amendment wants — LOCKED, which is "frozen snapshot, still movable by a
// deliberate act" — so amending is simply FINAL → LOCKED, the existing
// `unfinalizeRound`, reached from a control that makes it hard to do by
// mistake and impossible to do without being told what it costs.
//
// What changes is REACH and CANDOUR:
//
//   reach   the sheet's old reopen pointed at lastFinalRoundNumber and
//           nothing else, so Round 2 of a finished cup was unreachable while
//           3 and 4 stood. Every final round is amendable now.
//   candour a director reopening a round is told which of them it moves —
//           the scoring gate, the later rounds, the recorded result — before
//           they do it, off `describeAmendImpact` below rather than off a
//           sentence somebody wrote once and did not revisit.
//
// WHAT AN AMENDMENT DOES NOT DO BY ITSELF
// ---------------------------------------
// Reopening changes what can be TYPED. It moves no stroke on its own, and
// saying otherwise would be the dangerous lie here: a director who reopens a
// round to correct an allowance, edits it, and re-finalizes has changed a
// stored field and nothing else, because scoring reads the frozen snapshot
// for everything that allocates strokes (roundLocks' "WHAT IS FROZEN").
//
// The snapshot has to be RE-TAKEN for a handicap-side correction to land, and
// that is a second, separate, deliberate act — `refreshRoundLockDoc`, surfaced
// as Recalculate. `amendNeedsRefresh` below is what lets the UI tell the two
// apart instead of leaving a director to guess which of their edits took.
//
// The point-side settings — Nassau pots, hole points, par points, counting
// scores — are the opposite case and always have been: scoring.js reads the
// LIVE value over the snapshot for every one of them (see getRoundHolePoints
// and its neighbours), so correcting a Nassau pot on a finished round lands on
// the leaderboard the moment it saves, with no reopen and no recalculate. That
// asymmetry is deliberate — points are not strokes — and it is why the two
// halves of this module report separately.
import {
  isRoundFinal,
  finalRoundNumbers,
  scoringRoundNumber,
  lockedPlayerEntry,
} from "./roundLocks";

// ── What can be amended ─────────────────────────────────────────────
// Every final round, ascending. Deliberately not "the last one": the round
// that needs correcting is the one somebody found a mistake in, and there is
// no reason that should be the most recent.
export const amendableRoundNumbers = (locks, allRounds = [1, 2, 3, 4]) =>
  finalRoundNumbers(locks).filter((r) => allRounds.includes(r));

// Has this round been through an amendment before? Read off the audit marks
// written by `recordAmendment`, so a round that was reopened and re-finalized
// never again looks identical to one that was closed once and left alone.
export const wasAmended = (lock) => !!(lock && lock.amend_count > 0);

// A round is waiting on a recalculate when it has been amended but its
// snapshot has not been re-taken since — i.e. the director reopened it, and
// whatever they changed on the handicap side has not reached the scoring yet.
//
// Compares the two timestamps rather than trusting a flag, because a refresh
// can also happen for its own reasons and the question is strictly "is the
// snapshot older than the amendment".
//
// FINAL is false, and that is not a technicality. A director who reopens a
// round, fixes a typed score and finalizes again has finished — the strokes
// were never in question. Reading that round as "waiting on a recalculate"
// forever would leave a standing prompt on a closed round, offering an action
// the app then refuses because the round is final: a control that appears
// only to say no, which is the exact failure the guards in AdminView were
// rewritten to stop making.
export function amendNeedsRefresh(lock) {
  if (!lock?.locked || lock.final || !wasAmended(lock)) return false;
  const amended = lock.amended_at || null;
  if (!amended) return false;
  const taken = lock.refreshed_at || lock.locked_at || null;
  if (!taken) return true;
  return taken < amended;
}

// ── What reopening a round costs ────────────────────────────────────
// Every consequence a director should be told about, computed rather than
// written down, so the dialog cannot promise something the data disagrees
// with. `roundToday` is lib/scoringGate's answer for the edition (null when
// it has no dates) and is what decides whether the gate actually moves.
//
// Returns:
//   round          the round being reopened
//   amendable      false when it is not final — nothing to reopen
//   gateFrom/To    where score entry sits now, and where it lands after
//   gateMoves      whether those two differ. The loud one: it closes the
//                  round the field may be standing on.
//   laterFinals    final rounds after this one, which STAY final
//   wasComplete    every round was final — the cup was over
//   resultStale    the stored edition result stops being rewritten until
//                  the cup is complete again
export function describeAmendImpact({
  locks,
  allRounds = [1, 2, 3, 4],
  round,
  roundToday = null,
}) {
  const rounds = [...allRounds].sort((a, b) => a - b);
  const amendable = isRoundFinal(locks, round);
  const gateFrom = scoringRoundNumber({ locks, allRounds: rounds, roundToday });

  // The lock map as it would be the instant after the reopen lands. Only the
  // one round moves; nothing else about the map changes.
  const after = { ...(locks || {}), [round]: { ...(locks?.[round] || {}), final: false } };
  const gateTo = scoringRoundNumber({ locks: after, allRounds: rounds, roundToday });

  const laterFinals = rounds.filter((r) => r > round && isRoundFinal(locks, r));
  const wasComplete = rounds.length > 0 && rounds.every((r) => isRoundFinal(locks, r));

  return {
    round,
    amendable,
    gateFrom,
    gateTo,
    gateMoves: gateFrom !== gateTo,
    laterFinals,
    wasComplete,
    resultStale: wasComplete,
  };
}

// The impact above, as the lines a confirm dialog prints. Kept here beside
// the facts so the two cannot drift — a consequence added to the shape above
// and not to the copy is a consequence the director is never told about.
//
// Ordered loudest first: what closes, then what stays, then what is merely
// bookkeeping.
export function amendImpactLines(impact) {
  const lines = [];
  if (!impact?.amendable) return lines;

  if (impact.gateMoves) {
    lines.push(
      impact.gateTo == null
        ? `Score entry closes — Round ${impact.gateFrom} is no longer the open round.`
        : impact.gateFrom == null
          ? `Score entry reopens on Round ${impact.gateTo}.`
          : `Score entry moves from Round ${impact.gateFrom} to Round ${impact.gateTo} on every phone in the field.`
    );
  } else if (impact.gateTo != null) {
    lines.push(`Score entry stays on Round ${impact.gateTo} — the field is not moved.`);
  }

  if (impact.laterFinals.length) {
    lines.push(
      `Round${impact.laterFinals.length === 1 ? "" : "s"} ${impact.laterFinals.join(", ")} stay${impact.laterFinals.length === 1 ? "s" : ""} final and ${impact.laterFinals.length === 1 ? "is" : "are"} not touched.`
    );
  }

  lines.push(
    "Handicaps stay frozen exactly as they are. Reopening changes what can be typed — it moves no stroke until you Recalculate."
  );

  if (impact.resultStale) {
    lines.push(
      "The cup stops reading as finished, and the recorded result stays as it is until you finalize every round again."
    );
  }

  return lines;
}

// ── What a recalculate would actually move ──────────────────────────
// A director who reopens a round, corrects an allowance and taps Recalculate
// is re-deriving every player's Course Handicap from live values. That is the
// one act in this whole flow that CHANGES A FINISHED RESULT, so it is the one
// that has to say what it is about to do in numbers rather than in prose.
//
// Diffs the frozen snapshot against a freshly-built one and reports only the
// players whose CH actually moves. An empty list is the useful answer too: it
// means the correction was on the points side, or on nothing at all, and the
// director can stand down instead of wondering whether the tap did anything.
export function describeRefreshImpact({ locks, round, nextLock }) {
  const before = locks?.[round] || null;
  const rows = [];
  if (!before?.locked || !nextLock?.players) return { rows, changed: 0, unchanged: 0 };

  let unchanged = 0;
  Object.entries(nextLock.players).forEach(([pid, next]) => {
    const prev = lockedPlayerEntry(locks, round, pid);
    const from = prev ? Number(prev.ch) : null;
    const to = Number(next.ch);
    if (prev && Number.isFinite(from) && Number.isFinite(to) && from === to) {
      unchanged += 1;
      return;
    }
    // A player with no frozen row is a late addition who was scoring off live
    // values anyway — recording them as a change would be noise, not news.
    if (!prev) return;
    rows.push({ pid, name: next.name || prev?.name || pid, from, to });
  });

  rows.sort((a, b) => Math.abs((b.to ?? 0) - (b.from ?? 0)) - Math.abs((a.to ?? 0) - (a.from ?? 0)));
  return { rows, changed: rows.length, unchanged };
}

// ── The audit trail ─────────────────────────────────────────────────
// Stamped onto the lock when a final round is reopened for amendment. An
// amendment is rare and consequential, so it is recorded permanently — a
// re-finalized round keeps the count and the reason forever, which is what
// lets anybody looking at 2026 later ask why its Round 2 was opened twice.
//
// Deliberately additive: nothing here clears on re-finalize, and
// `markRoundFinal` in roundLocks does not touch these fields.
export function recordAmendment(lock, { by = null, reason = "" } = {}) {
  if (!lock) return null;
  const now = new Date().toISOString();
  const history = Array.isArray(lock.amend_history) ? lock.amend_history : [];
  return {
    ...lock,
    amend_count: (lock.amend_count || 0) + 1,
    amended_at: now,
    amended_by: by,
    amend_reason: reason || null,
    // Capped so a lock document cannot grow without bound on a round somebody
    // reopens repeatedly; the count above is the number that never rolls off.
    amend_history: [...history, { at: now, by, reason: reason || null }].slice(-10),
  };
}

// Short human string for the amend badge, or null when the round has never
// been amended. Mirrors roundLocks' describeLock in shape and intent.
export function describeAmendment(lock) {
  if (!wasAmended(lock)) return null;
  const n = lock.amend_count;
  const at = lock.amended_at ? new Date(lock.amended_at).toLocaleString() : "unknown time";
  const who = lock.amended_by ? ` by ${lock.amended_by}` : "";
  const why = lock.amend_reason ? ` — ${lock.amend_reason}` : "";
  return `Amended ${n === 1 ? "once" : `${n} times`}, last ${at}${who}${why}`;
}
