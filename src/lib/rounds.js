// ══════════════════════════════════════════════════════════════════
//  rounds — how many rounds does this tournament have?
// ══════════════════════════════════════════════════════════════════
//
// One question, asked from five places, and it used to have two different
// answers depending on which screen you were standing on: the Scoring tab,
// the Betting tab and the round gate DERIVED it from the data, while the
// scoreboard and both admin pickers held the literal `[1, 2, 3, 4]`.
//
// The scoreboard was the expensive half of that. Its cup total, its clinch
// line and its points-on-offer bar are summed over EVERY match, while its
// round sections came off the literal — so a fifth round's points counted
// toward winning the cup from a round the board never drew.
//
// ── It is a setting, not a derivation ─────────────────────────────────
// The first fix here made every picker derive the list from the data and
// offer one empty slot past the end, so a fifth round could be built by
// walking into it. That worked, but it had the question backwards: how long
// a tournament is, is a thing the director KNOWS on the Tuesday before, not
// something the app should infer from what has been entered so far. A
// three-round trip should say three and stop, rather than always showing one
// more round than exists and never being finished being set up.
//
// So the count lives in tournament setup (Admin → Event, stored on the
// bc_settings/tournament document beside the name and the venue), and this
// module turns it into the list every picker and the round gate read.
//
// The data is still consulted, but as a FLOOR rather than as the answer —
// see allRounds. That is the one guarantee worth keeping from the derived
// version: a round somebody has actually played can never disappear because
// a number in a settings form says the tournament is shorter than it is.

// What a brand-new edition opens its setup form on. This is the seed for a
// field the director immediately owns — not a rule, and nothing downstream
// reads it once a count is stored. The Bourbon Cup has been four rounds
// every year since 2016, so that is the useful thing to put in the box.
export const DEFAULT_ROUND_COUNT = 4;

// A ceiling, so a slipped keystroke in a number field cannot ask the app to
// render four hundred round pills. Well clear of any golf trip anybody is
// actually taking, and the setup input clamps to it rather than refusing.
export const MAX_ROUND_COUNT = 12;

// A typed count, made legal. Clamped rather than refused: the Rounds box
// shares its Save with the tournament's name and venue, and a blank field or
// a slipped keystroke has no business failing a save that also carries those.
// Anything unreadable lands on the seed.
export const clampRoundCount = (raw) => {
  // Blank first, and separately, because `Number("")` is 0 — which is finite,
  // so an isFinite test alone reads an emptied box as somebody asking for zero
  // rounds and clamps it to one. Emptying a field is not a request; it is an
  // absence, and an absence takes the seed.
  //
  // A typed 0 is different and does clamp to 1: that IS a request, just not a
  // legal one, and landing on the nearest legal number is what the row under
  // the box promises.
  const str = String(raw ?? "").trim();
  if (!str) return DEFAULT_ROUND_COUNT;
  const n = Math.floor(Number(str));
  if (!Number.isFinite(n)) return DEFAULT_ROUND_COUNT;
  return Math.min(Math.max(n, 1), MAX_ROUND_COUNT);
};

// Every round that EXISTS in the data, in order.
//
// Three sources, unioned, because a round can legitimately exist in any one
// of them alone:
//
//   tRounds     the director set it up (format, course, tee times)
//   matches     it has a draw, whether or not it has a round document
//   roundLocks  somebody has posted a score in it
//
// That last one is load-bearing: a lock is written by the first score of a
// round, so a locked round is a round somebody has played.
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

// The configured length of the tournament.
//
// The stored setting wins. When there isn't one — every edition that predates
// the field, including the running year — the data answers instead, so an
// existing tournament reads exactly as it did before this setting existed and
// nobody has to go and re-enter a four they already implied. A brand-new
// edition with neither gets the seed.
export const resolveRoundCount = ({ roundCount, tRounds, matches, roundLocks } = {}) => {
  const n = Number(roundCount);
  if (Number.isFinite(n) && n >= 1) return Math.min(Math.floor(n), MAX_ROUND_COUNT);
  const existing = scheduledRounds({ tRounds, matches, roundLocks });
  return existing.length ? Math.max(...existing) : DEFAULT_ROUND_COUNT;
};

// THE list — what every round picker, the schedule and the round gate read.
//
// The configured rounds, 1..N, plus any round the DATA says exists beyond
// them. That second term is the safety catch and it is not hypothetical: a
// director who plays four rounds and then edits the count to three would
// otherwise take round four off the schedule — and since the live round is
// the lowest unfinalized round in this list, doing that mid-tournament would
// move the whole field backwards onto a round they had already signed off,
// with their round-four scores still sitting in the database.
//
// So the setting decides how long the tournament IS, and the data decides how
// short it is allowed to claim to be. A count can always add rounds; it can
// only ever remove ones nobody has touched.
export const allRounds = ({ roundCount, tRounds, matches, roundLocks } = {}) => {
  const n = resolveRoundCount({ roundCount, tRounds, matches, roundLocks });
  const seen = new Set(Array.from({ length: n }, (_, i) => i + 1));
  scheduledRounds({ tRounds, matches, roundLocks }).forEach(r => seen.add(r));
  return [...seen].sort((a, b) => a - b);
};

// Rounds past the configured count that exist anyway — the ones the safety
// catch above is holding on to. The setup form names them, so a director who
// types 3 into a four-round tournament is told why it still says four rather
// than being left to wonder whether the setting took.
export const roundsBeyondCount = (args) => {
  const n = resolveRoundCount(args);
  return scheduledRounds(args).filter(r => r > n);
};
