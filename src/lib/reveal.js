// ══════════════════════════════════════════════════════════════════
//  The reveal — a round that is played in the dark and turned over
//  one hole at a time afterwards.
// ══════════════════════════════════════════════════════════════════
//
// THE TRADITION
// -------------
// The Bourbon Cup's closing round is a Team Best Ball: the whole side is
// one match, and a hole is the sum of that side's best N net balls. It is
// scored live on the course like every other round — but nobody is allowed
// to know how it is going. The cards come back to the house, everyone sits
// down, and the round is revealed a hole at a time with the cup riding on
// it. That reveal is the event; a leaderboard that answered the question on
// the 14th tee would take the whole evening away.
//
// So a round can be SEALED. While it is:
//
//   • the scoreboard does not score it AT ALL. Not hole by hole as the
//     reveal walks — at all, until the last of the eighteen is turned over.
//     No points banked, no hole strip, no status, nothing in the cup total.
//   • a player still sees THEIR OWN SIDE's numbers, for every hole their
//     team has posted. "Only your own team" is the whole ask; a blackout
//     that hid a team from itself would just be an off switch.
//   • the director turns the holes over from the countdown, one tap each,
//     and the television in the room follows.
//
// WHY THE BOARD IS ALL-OR-NOTHING
// -------------------------------
// It used to walk with the reveal: hole 7 turned over on the director's
// phone put hole 7 on the scoreboard too, and the cup bar moved a little
// at a time. That was wrong for the only evening it runs. The ceremony is
// ONE screen — the television — and everyone else in the room is holding
// a phone. A scoreboard that keeps step with it is a second, smaller,
// FASTER copy of the reveal: it lands the hole without the stagger, so
// half the room reads the outcome off a phone before the number is on the
// TV, and a match that turns on 16 is over on sixteen phones while the
// screen is still opening it. It also let the round's running match status
// build up in front of anybody who scrolled — which is the ending, arrived
// at early, which is the whole thing the seal exists to prevent.
//
// So the board holds at nothing until the countdown is COMPLETE, and then
// the whole round lands at once. Two audiences, two subtractions:
// `concealHoleData` for every read-only surface, `countdownHoleData` for
// the one screen the room is watching.
//
// HOW IT IS ENFORCED
// ------------------
// By subtraction at the source, not by asking each screen to remember. App
// passes `concealHoleData(holeData, tRounds)` to the read-only surfaces —
// the scoreboard, the Betting tab and the Data tab — and everything
// downstream of that is scored off a round that genuinely has no scores in
// it. There is no code path where a screen has the numbers and is trusted
// not to draw them, which is what a per-component `if (sealed)` would have
// been.
//
// The Final Countdown is handed `countdownHoleData(holeData, tRounds)` —
// the same subtraction cut at the reveal instead of at zero — so the one
// screen that is supposed to walk the round has hole `through - 1` as the
// last one that exists, and no hole after it to leak.
//
// The Scoring tab is the exception, and has to be: somebody standing on the
// 7th is entering four cards, two of which belong to the other side. What is
// concealed there is what the entries ADD UP TO — the side totals, the match
// state, the running line — not the numbers being typed.
//
// WHAT THIS IS NOT
// ----------------
// It is not a security boundary. The rules serve every hole score to every
// member (they must — a mixed foursome enters both sides' cards), so the
// numbers are in the browser and somebody determined to spoil the evening
// for themselves could read them out of it. This is the gate that stops the
// app from telling you, which is the only thing that was ever in the way.
//
// STORAGE
// -------
// Two fields on the round document (`bc_rounds`):
//
//   sealed         — boolean. Set from the Rounds tab; on for Team Best Ball
//                    and off for everything else. An UNSET flag falls back to
//                    that same default while the round is still live, so a
//                    round nobody edited is not played in the open; a round
//                    already final is never touched, which is what keeps every
//                    imported year visible. See resolveSealed.
//   reveal_through — 0-18, how many holes have been turned over. Written
//                    ONLY by the reveal control, never by the round form's
//                    auto-save, so a director editing the tee times cannot
//                    give the ending away.

export const HOLE_COUNT = 18;

// The formats whose rounds open sealed in the Rounds tab. Team Best Ball is
// the closing round and the reveal is what it is for; every other format is
// off unless a director says otherwise.
export const SEAL_DEFAULT_FORMATS = ["team_best_ball"];

export const sealDefaultFor = (format) => SEAL_DEFAULT_FORMATS.includes(format);

// The rule, in ONE place — the Rounds tab seeds the form from it and the
// board reads it. A stored flag always wins; an unset one falls back to the
// format's default, but only while the round is still live.
//
// It used to be explicit-only at read time: a document that had never carried
// the flag was not sealed, whatever its format. The reasoning was that
// nothing already in the books should go dark because this shipped, and that
// half is still right — hence `final`.
//
// The other half was backwards, and round 4 of the live cup is what showed
// it. The seed only reached the document if a director happened to open that
// round's form, so a Team Best Ball round nobody edited was played in the
// open: opponents' scores and the match status on every phone on the course,
// which is the one thing the reveal exists to prevent. The two failures are
// not comparable. Sealing a finished round by mistake hides a result until
// somebody turns it over — visible, and a toggle away. NOT sealing a live one
// spoils the ending for the whole field, and there is no undo for what
// sixteen people have already read.
//
// So an unset flag now defaults to the format. `final` is the guard on the
// other end, and it is what keeps every imported year visible: history is
// written locked and final (see historyImport), so none of it is reachable
// by this fallback.
export const resolveSealed = (format, raw, final) =>
  raw == null ? (!final && sealDefaultFor(format)) : !!raw;

// Is this round played behind the blackout at all?
//
// `tr.final` is not a stored field on bc_rounds — App folds each round's lock
// state onto the round objects it hands out (see enrichedRounds), because
// finality lives in bc_round_locks and every reader here already has the
// round. A round object without it reads as not-final, which is the safe end:
// a live round seals.
export const isSealedRound = (tr) => resolveSealed(tr?.format, tr?.sealed, tr?.final);

// How many holes are public. An unsealed round is all eighteen, which is
// what makes every caller below safe to run against any round.
export const revealedThrough = (tr) => {
  if (!isSealedRound(tr)) return HOLE_COUNT;
  const n = Math.floor(Number(tr.reveal_through));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(HOLE_COUNT, n));
};

export const isFullyRevealed = (tr) => revealedThrough(tr) >= HOLE_COUNT;

// Sealed AND still holding something back. This is the question every screen
// actually has — a fully revealed round keeps its `sealed` flag forever (it
// WAS a sealed round; that is how it is scored and how it reads in Admin),
// but it conceals nothing.
export const isConcealing = (tr) => isSealedRound(tr) && !isFullyRevealed(tr);

const roundOf = (tRounds, round) =>
  (tRounds || []).find((t) => t.round_number === round) || null;

// The reveal state of one round, for a screen that has a round number.
// `through` is always meaningful: 18 on anything that isn't concealing.
export const revealState = (tRounds, round) => {
  const tr = roundOf(tRounds, round);
  return {
    sealed: isSealedRound(tr),
    concealing: isConcealing(tr),
    through: revealedThrough(tr),
  };
};

// Round numbers still holding something back, ascending.
export const concealedRoundNumbers = (tRounds) =>
  (tRounds || [])
    .filter((tr) => isConcealing(tr) && Number.isFinite(tr.round_number))
    .map((tr) => tr.round_number)
    .sort((a, b) => a - b);

// ── The subtraction ─────────────────────────────────────────────────
// `holeData` keyed `${player_id}_${round}` → { [holeIdx]: gross }, which is
// the shape App's bc_hole_scores subscription builds. Both functions below
// return a copy of that map with a concealing round's holes removed; they
// differ only in where the cut falls.
//
// Both return the ORIGINAL object when nothing is concealing — which is the
// common case, every round of every other day — so this costs a scan of the
// round list and nothing else, and the identity keeps React's memo chains
// downstream from invalidating on every render. App leans on that identity
// as an exact test for "is anything sealed right now" (see editionSummary),
// so neither may ever return a fresh object for an unsealed cup.
//
// A player id can itself contain underscores, so the round is read off the
// LAST separator rather than by splitting.
function cutHoleData(holeData, limits) {
  if (!limits.size) return holeData;

  const out = {};
  Object.entries(holeData || {}).forEach(([key, scores]) => {
    const rnd = Number(key.slice(key.lastIndexOf("_") + 1));
    if (!limits.has(rnd)) { out[key] = scores; return; }
    const through = limits.get(rnd);
    // Nothing public yet: the round has no scores at all, so the key is
    // dropped rather than left as an empty object. Every reader already
    // handles a missing one.
    if (through <= 0) return;
    const kept = {};
    Object.entries(scores || {}).forEach(([h, v]) => {
      if (Number(h) < through) kept[h] = v;
    });
    out[key] = kept;
  });
  return out;
}

// What every read-only surface gets — the scoreboard, the Betting tab, the
// Data tab, and the edition summary that gets archived.
//
// A concealing round is cut to ZERO holes however far the reveal has walked.
// It is not "the revealed part of the round"; it is a round that has not
// been played, and every point, strip, status and total those screens
// compute follows from that on its own. The moment the eighteenth hole is
// turned over the round stops concealing and the whole thing lands at once.
// See WHY THE BOARD IS ALL-OR-NOTHING at the top of this file.
export function concealHoleData(holeData, tRounds) {
  const limits = new Map();
  (tRounds || []).forEach((tr) => {
    if (isConcealing(tr)) limits.set(tr.round_number, 0);
  });
  return cutHoleData(holeData, limits);
}

// What the Final Countdown gets — the one screen that is SUPPOSED to walk
// the round, so its cut falls at the reveal rather than at zero. Hole
// `through - 1` is the last one that exists in the map it hands back, which
// is what makes that screen safe to lay out without a per-hole guard.
export function countdownHoleData(holeData, tRounds) {
  const limits = new Map();
  (tRounds || []).forEach((tr) => {
    if (isConcealing(tr)) limits.set(tr.round_number, revealedThrough(tr));
  });
  return cutHoleData(holeData, limits);
}

// ── Stepping the reveal ─────────────────────────────────────────────
// Clamped both ends. Going back to 0 re-seals the round completely, which is
// the way out of a hole turned over by a stray tap.
export const stepReveal = (through, by) =>
  Math.max(0, Math.min(HOLE_COUNT, (Number(through) || 0) + by));

// What the board says about a concealing round, in one line.
export const revealSummary = (through) =>
  through <= 0
    ? "Sealed — nothing revealed yet"
    : `${through} of ${HOLE_COUNT} holes revealed`;

// The hash the Final Countdown lives behind. It exists so the television can
// be pointed at one URL, bookmarked, and survive the refresh somebody will
// inevitably perform two minutes before everyone sits down — the app is a
// single page with no router, so a hash is the whole of its addressing.
export const COUNTDOWN_HASH = "#countdown";
