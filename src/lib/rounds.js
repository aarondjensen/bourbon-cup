// ══════════════════════════════════════════════════════════════════
//  rounds — how many rounds does this tournament have?
// ══════════════════════════════════════════════════════════════════
//
// One question, asked from five places, and until this module it had two
// different answers depending on which screen you were standing on.
//
// The Scoring tab, the Matches tab, the Betting tab and the round gate all
// DERIVED it — from the rounds the director set up, the rounds that have a
// draw, and the rounds somebody has already played. BettingView says so in
// its own comment: "the rounds that actually exist, not a hardcoded 1-4: a
// two-round tournament used to get two empty tabs, and a fifth round never
// appeared at all."
//
// But four places still held the literal `[1, 2, 3, 4]`:
//
//   • the scoreboard's list of round sections
//   • the Admin › Matches round pills
//   • the Admin › Rounds round pills
//   • the per-round handicap-mode map's initial state
//
// So the app was half-generalised, and the halves disagreed. The scoreboard
// was the expensive one: its cup total, its clinch line and its points-on-
// offer bar are summed over EVERY match, while its round sections came off
// the literal — so a fifth round's points counted toward winning the cup
// from a round the board never drew. Nothing on screen would have explained
// where they came from.
//
// The other three simply made a five-round trip unbuildable and a three-round
// one look broken, with a dead pill for a round nobody was playing.

// Every round this tournament has, in order.
//
// Three sources, unioned, because a round can legitimately exist in any one
// of them alone:
//
//   tRounds     the director set it up (format, course, tee times)
//   matches     it has a draw, whether or not it has a round document
//   roundLocks  somebody has posted a score in it
//
// That last one is load-bearing and the reason this takes locks at all: a
// lock is written by the first score of a round, so a locked round is a round
// somebody has played. Without it, a round defined only by its matches
// vanishes from the schedule the moment its last match is deleted — and since
// the live round is the lowest unfinalized round in this list, the whole field
// would be moved on while their scores sat in the round they were standing on.
export const scheduledRounds = ({ tRounds, matches, roundLocks } = {}) => {
  const seen = new Set();
  // Rounds are numbered from 1, and that floor is what does the filtering
  // rather than a null check: `Number(null)` and `Number("")` are both 0, so
  // a row with no round number would otherwise arrive as a round zero and
  // seat itself at the front of every picker in the app.
  //
  // Coerced rather than compared raw because the lock source arrives as object
  // KEYS, which are strings — without this a round present in both tRounds and
  // roundLocks would appear twice, once as 2 and once as "2".
  const add = (v) => {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 1) seen.add(n);
  };
  (tRounds || []).forEach(t => add(t?.round_number));
  (matches || []).forEach(m => add(m?.round));
  Object.entries(roundLocks || {}).forEach(([r, lock]) => { if (lock?.locked) add(r); });
  return [...seen].sort((a, b) => a - b);
};

// The number a new round would take. A tournament with nothing on the
// schedule starts at 1, which is what a fresh edition needs.
//
// Deliberately max + 1 rather than "first gap": a director who deleted round 2
// of four is not asking for it back, and dropping the next round into the hole
// would be the app second-guessing that. Rounds are a schedule, not a set of
// slots to fill.
export const nextRoundSlot = (rounds) => (rounds.length ? Math.max(...rounds) + 1 : 1);

// What a round PICKER offers: every round that exists, plus one empty slot
// past the end.
//
// The trailing slot is the whole affordance for adding a round, and it costs
// nothing to leave there: both admin tabs auto-save by diffing the form
// against Firestore, so selecting an empty round writes no document until
// somebody actually edits it. Configure round 1 and round 2 appears; a
// three-round trip simply stops at four and nobody ever touches it.
export const editableRounds = (args) => {
  const rounds = scheduledRounds(args);
  return [...rounds, nextRoundSlot(rounds)];
};
