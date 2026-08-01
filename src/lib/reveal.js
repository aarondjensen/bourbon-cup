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
//   • the scoreboard scores it off the REVEALED HOLES ONLY. Every hole past
//     the reveal is treated exactly as if it had not been played — no
//     points banked, no hole strip, no status, nothing in the cup total.
//   • a player still sees THEIR OWN SIDE's numbers, for every hole their
//     team has posted. "Only your own team" is the whole ask; a blackout
//     that hid a team from itself would just be an off switch.
//   • the director turns the holes over from the scoreboard, one tap each,
//     and every phone in the room follows.
//
// HOW IT IS ENFORCED
// ------------------
// By subtraction at the source, not by asking each screen to remember. App
// passes `concealHoleData(holeData, tRounds)` to the read-only surfaces —
// the scoreboard and the analytics tab — and everything downstream of that
// is scored off a round that genuinely has no scores past the reveal. There
// is no code path where a screen has the numbers and is trusted not to draw
// them, which is what a per-component `if (sealed)` would have been.
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
//   sealed         — boolean. Set from the Rounds tab; seeded on for Team
//                    Best Ball and off for everything else, and never
//                    inferred at read time, so no existing round can go
//                    dark because this shipped.
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

// Is this round played behind the blackout at all? Explicit only — a round
// document that has never carried the flag is not sealed, whatever its
// format, so nothing already in the books can be hidden by a deploy.
export const isSealedRound = (tr) => !!tr?.sealed;

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
// the shape App's bc_hole_scores subscription builds. Returns the same map
// with every hole past a concealing round's reveal removed.
//
// Returns the ORIGINAL object when nothing is concealing — which is the
// common case, every round of every other day — so this costs a scan of the
// round list and nothing else, and the identity keeps React's memo chains
// downstream from invalidating on every render.
//
// A player id can itself contain underscores, so the round is read off the
// LAST separator rather than by splitting.
export function concealHoleData(holeData, tRounds) {
  const limits = new Map();
  (tRounds || []).forEach((tr) => {
    if (isConcealing(tr)) limits.set(tr.round_number, revealedThrough(tr));
  });
  if (!limits.size) return holeData;

  const out = {};
  Object.entries(holeData || {}).forEach(([key, scores]) => {
    const rnd = Number(key.slice(key.lastIndexOf("_") + 1));
    if (!limits.has(rnd)) { out[key] = scores; return; }
    const through = limits.get(rnd);
    // Nothing turned over yet: the round has no scores at all, so the key
    // is dropped rather than left as an empty object. Every reader already
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
