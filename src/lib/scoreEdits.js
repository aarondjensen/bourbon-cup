// ══════════════════════════════════════════════════════════════════
//  scoreEdits — what changed on a card after the round was reopened
// ══════════════════════════════════════════════════════════════════
//
// THE PROBLEM
// -----------
// lib/roundAmend gave a director the way back into a finished round. It did
// not give the FIELD anything at all. A man signs his card on Friday, four
// people attest it, the round is finalized — and on Sunday morning a hole he
// signed for reads a different number. Nothing on his phone ever said so.
//
// That is the worst shape a change can have in this app. He agreed to a
// scorecard; the scorecard he agreed to is not the one on record any more;
// and the only people who know are the director who typed it and whoever
// happened to be standing next to them. A correction made in the open is
// ordinary tournament housekeeping. The same correction made silently is the
// thing an attestation exists to prevent.
//
// So every hole moved inside an amendment window is written down here, and
// the men whose card it is are told.
//
// ── WHEN IT IS SENT, AND WHY NOT SOONER ────────────────────────────
// On RE-FINALIZE, not on the edit. Three reasons, and the first is the one
// that decides it:
//
//   • A correction in progress is not a correction. A director fixing a card
//     types 5, sees it is wrong, types 4. Pushing on each keystroke tells a
//     man his 7 became a 5 and then that it became a 4, and the first of
//     those was never true of anything.
//   • One push, not one per hole. A miskeyed card is rarely one hole, and
//     four notifications for one correction is how a player learns to swipe
//     them away without reading.
//   • Re-finalizing is the moment the correction becomes OFFICIAL — the same
//     moment the original result became official. A round left reopened is a
//     round still being worked on, and there is nothing settled to announce.
//
// A director who reopens a round and never finalizes it again has changed
// nothing anybody needs to hear about yet; the round is visibly open, and the
// finalize alert is already nagging them about it.
//
// ── WHAT COUNTS AS A CHANGE ────────────────────────────────────────
// Two kinds, and they are on this list for the same reason: both alter a
// score that a man has already signed for.
//
//   score      a hole's number moved. The obvious one.
//   handicap   a recalculate moved his Course Handicap (see roundAmend's
//              describeRefreshImpact). Not a stroke he typed, but it changes
//              the net on every hole he played and can turn the match — a
//              player told about a corrected 7 and not told his handicap
//              moved two strokes has been told the smaller half.
//
//   setting    a frozen ROUND-LEVEL field moved — the allowance, the handicap
//              mode, the format, the course, the stroke index. Round-wide
//              rather than per-player, and it has to be its own kind because
//              it moves strokes WITHOUT moving a single stored Course
//              Handicap: the allowance is applied downstream of the snapshot
//              (see roundAmend's describeRefreshImpact). Recorded against no
//              player, because it reaches everybody who played the round.
//
// Deliberately NOT recorded: a points-side change — a Nassau pot, a hole
// value. Those move what the round is WORTH, not what anybody shot, they
// need no amendment to land (see lib/roundAmend), and they apply to the whole
// field equally rather than to one man's card.
//
// PURE — no firebase, no React. The writing is App's; the deciding is here.
import { editionDocId } from "../firebase";

export const SCORE_EDITS_COL = "bc_score_edits";

// ── The window ──────────────────────────────────────────────────────
// A round is taking AMENDMENT edits when it has been reopened and not yet
// re-finalized. All three clauses matter:
//
//   locked        an unlocked round has no result to amend — it never
//                 started, and its scores are ordinary first entry.
//   !final        a final round is closed; nothing should be writing to it.
//   amend_count   the round was REOPENED rather than merely still open.
//                 Without this, every ordinary round in the tournament is a
//                 window and every score typed on a tee box is an amendment.
export const inAmendmentWindow = (lock) =>
  !!(lock?.locked && !lock.final && lock.amend_count > 0);

// Which amendment an edit belongs to. Amendment 2's edits must not blend into
// amendment 1's — a round reopened twice was corrected twice, and reporting
// the first correction's holes again the second time would tell a man his
// card moved when it did not.
export const amendSeqOf = (lock) => (lock?.amend_count || 0);

// ── Document ids ────────────────────────────────────────────────────
// Keyed by round, amendment, player and hole, so the SAME hole edited three
// times inside one amendment is one document rather than three. That is what
// makes the notification read 7 → 4 rather than 7 → 5 → 4 → 4, and it is why
// `from` below is written once and never again.
export const scoreEditDocId = ({ round, amendSeq, playerId, hole }) =>
  editionDocId(`bc_edit_r${round}_a${amendSeq}_${playerId}_h${hole}`);

export const handicapEditDocId = ({ round, amendSeq, playerId }) =>
  editionDocId(`bc_edit_r${round}_a${amendSeq}_${playerId}_ch`);

// A round-level setting carries no player id — it is the round's, not
// anybody's — so the field name takes that slot in the key.
export const settingEditDocId = ({ round, amendSeq, field }) =>
  editionDocId(`bc_edit_r${round}_a${amendSeq}_set_${field}`);

// A moved round setting. `from` and `to` are already the readable strings the
// recalculate dialog printed — the raw values are an allowance object and two
// eighteen-long arrays, none of which belong in a push notification, and
// re-deriving the wording on the server would be a second copy of it.
export function buildSettingEdit({
  tournamentId, round, amendSeq, field, label, from, to, by = null,
}) {
  if (from === to) return null;
  return {
    id: settingEditDocId({ round, amendSeq, field }),
    tournament_id: tournamentId,
    round_number: round,
    amend_seq: amendSeq,
    // No player_id: this one is the round's. The server fans it out to
    // everybody who played rather than to one card.
    kind: "setting",
    field,
    label: label || field,
    from: from ?? null,
    to: to ?? null,
    edited_by: by,
    edited_at: new Date().toISOString(),
  };
}

// A blank hole and a null hole are the same hole — not played. Compared
// numerically so a stored "4" and a typed 4 are not read as a change, which
// they would be by ===: hole scores arrive off number inputs and round trips
// through Firestore as numbers, and one string in that chain would report a
// correction on every hole of every reopened round.
const sameScore = (a, b) => {
  const na = a == null || a === "" ? null : Number(a);
  const nb = b == null || b === "" ? null : Number(b);
  if (na == null && nb == null) return true;
  if (na == null || nb == null) return false;
  return na === nb;
};

// ── Builders ────────────────────────────────────────────────────────
// `previous` is the document already on record for this hole in this
// amendment, when there is one. Its presence is the whole reason these return
// a partial: `from` is the score as it stood when the round was REOPENED, and
// re-writing it on the second edit of the same hole would quietly narrow the
// change to the last keystroke.
//
// THREE RETURNS, and the third is the one that is easy to leave out:
//
//   a document   record this change
//   null         nothing to record and nothing on file
//   { revert }   a change that had been recorded is no longer a change —
//                DELETE the document it names
//
// That last case is a hole edited away from its original value and then back
// to it, which happens whenever a director opens the wrong card, types, and
// undoes it. The card now reads exactly as the man signed it, so telling him
// it moved would be a false alarm produced entirely by the app's own
// bookkeeping — and leaving a stale row behind is how one gets sent.
export function buildScoreEdit({
  tournamentId, round, amendSeq, playerId, hole, from, to, by = null, previous = null,
}) {
  const origin = previous ? previous.from : from;
  if (sameScore(origin, to)) return previous ? { revert: true, id: previous.id } : null;
  const base = {
    id: scoreEditDocId({ round, amendSeq, playerId, hole }),
    tournament_id: tournamentId,
    round_number: round,
    amend_seq: amendSeq,
    player_id: playerId,
    kind: "score",
    hole_number: hole,
    to: to ?? null,
    edited_by: by,
    edited_at: new Date().toISOString(),
  };
  // `from` only on the first write of this hole in this amendment. A merge
  // that carried it every time would overwrite the original with the previous
  // keystroke — see above.
  return previous ? base : { ...base, from: from ?? null };
}

// A moved Course Handicap. One per player per amendment: a recalculate can
// only be run against live values, so running it twice does not stack.
export function buildHandicapEdit({
  tournamentId, round, amendSeq, playerId, from, to, by = null, previous = null,
}) {
  const origin = previous ? previous.from : from;
  if (sameScore(origin, to)) return previous ? { revert: true, id: previous.id } : null;
  const base = {
    id: handicapEditDocId({ round, amendSeq, playerId }),
    tournament_id: tournamentId,
    round_number: round,
    amend_seq: amendSeq,
    player_id: playerId,
    kind: "handicap",
    to: to ?? null,
    edited_by: by,
    edited_at: new Date().toISOString(),
  };
  return previous ? base : { ...base, from: from ?? null };
}

// ── Reading them back ───────────────────────────────────────────────
// The edits belonging to one amendment of one round, which is the set the
// notification is built from. Keyed by the same id shape the builders write,
// so a caller holding the app's subscribed map can find the previous document
// for a hole without a query.
export const editsForAmendment = (edits, round, amendSeq) =>
  Object.values(edits || {}).filter(
    e => e && e.round_number === round && (e.amend_seq || 0) === amendSeq
  );

// Everybody whose card moved in this amendment. The recipients before the
// match is folded in — see the server's amendmentNotice for why their
// playing partners hear about it too.
// Setting rows carry no player and are filtered out by `filter(Boolean)`,
// which is right: "whose card moved" is a question about the per-player rows.
// Who hears about a setting change is a wider question and the server's —
// see functions/amendmentNotice.
export const playersAffected = (edits, round, amendSeq) =>
  [...new Set(editsForAmendment(edits, round, amendSeq).map(e => e.player_id).filter(Boolean))];
