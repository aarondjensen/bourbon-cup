// ══════════════════════════════════════════════════════════════════
//  What the captain says out loud
// ══════════════════════════════════════════════════════════════════
//
// The Final Countdown is narrated, not displayed. Before a hole goes up on
// the television the captain of the side going first tells the room what is
// on it — "on hole one, a net eagle from Paul, couple of birdies off Dave and
// John, we're three under" — and THEN taps. The screen confirms the story; it
// does not tell it.
//
// So his phone needs the hole before the room has it. That costs nothing and
// exposes nothing: it is HIS OWN SIDE, and a team is never hidden from itself
// (see lib/reveal). What he must not see is the other side's, and he does not.
//
// KEEP IT SIMPLE — the brief, and the whole design constraint. He is standing
// in front of fifteen people holding a drink. What he can use is a headline he
// can read at a glance and two or three names worth saying. What he cannot use
// is eight rows of a scorecard, which is what his own eyes are for.
//
// So: WHAT IT CAME TO, then WHO MADE IT. Nothing else.
//
// WHAT COUNTS AS WORTH SAYING
// ---------------------------
// Net eagle or better, and net birdie. That is the line, and it is drawn at
// "would anybody cheer": a net par is the hole doing what it was supposed to,
// and a net bogey read out to a room is a man being named for a bad hole in
// front of the person he cost. This screen will not do that.
//
// A ball that DID NOT COUNT is never notable however good it was — on a
// best-six-of-eight the ninth-best birdie did not happen, as far as the number
// is concerned, and shouting it out invites the argument the format exists to
// avoid.
//
// Pure — no React, no Firebase, no theme. Given balls and a par it returns
// text. Everything about how it looks lives in the component.

export const EAGLE = "eagle";
export const BIRDIE = "birdie";

// Net-to-par for one ball, or null when there is no score on it.
export const netToPar = (ball, par) =>
  ball?.net == null || !Number.isFinite(par) ? null : ball.net - par;

// What one ball is worth saying about, or null. Only ever a ball that COUNTED
// — see the note above.
export const ballNote = (ball, par) => {
  if (!ball?.counted) return null;
  const rel = netToPar(ball, par);
  if (rel == null) return null;
  if (rel <= -2) return EAGLE;
  if (rel === -1) return BIRDIE;
  return null;
};

// "−3", "+2", "E" — the side's number against the par it took to make it. On
// a best-N format the side's score is the sum of N balls, so the par it is
// measured against is N pars, not one.
export const relToPar = (score, par, countN) => {
  if (score == null || !Number.isFinite(par)) return null;
  const n = Number.isFinite(countN) && countN > 0 ? countN : 1;
  return score - par * n;
};

export const fmtRel = (rel) =>
  rel == null ? "—" : rel === 0 ? "E" : rel > 0 ? `+${rel}` : `−${Math.abs(rel)}`;

// Names, joined the way somebody would say them.
export const sayNames = (names) => {
  const list = (names || []).filter(Boolean);
  if (!list.length) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
};

// ── The prompt ──────────────────────────────────────────────────────
// `balls` is one side's eight, in the shape FinalCountdown already builds
// them: { pid, name, gross, strokes, net, counted }.
//
// Returns:
//   ready     — is there anything on this hole at all? A hole the group has
//               not finished posting has no story and no number, and the
//               captain needs to know that rather than read out a blank.
//   headline  — "YOUR SIDE −3" / "YOUR SIDE E"
//   notes     — the lines worth saying, best first. Empty is a legitimate
//               answer and reads better than a manufactured one.
//   counted   — how many balls made the number, for the "best 6 of 8" line.
export function holePrompt({ balls, par, countN, score }) {
  const all = balls || [];
  const posted = all.filter((b) => b.net != null);
  const counted = all.filter((b) => b.counted && b.net != null);
  const need = Number.isFinite(countN) && countN > 0 ? countN : counted.length;

  if (!posted.length || score == null) {
    return { ready: false, headline: "NO SCORES ON THIS HOLE YET", notes: [], counted: 0, need };
  }

  const rel = relToPar(score, par, need);
  const headline = `YOUR SIDE ${fmtRel(rel)}`;

  const eagles = [], birdies = [];
  counted.forEach((b) => {
    const note = ballNote(b, par);
    if (note === EAGLE) eagles.push(b.name);
    else if (note === BIRDIE) birdies.push(b.name);
  });

  const notes = [];
  if (eagles.length) {
    notes.push(`Net ${eagles.length > 1 ? "eagles" : "eagle"} — ${sayNames(eagles)}`);
  }
  if (birdies.length) {
    notes.push(`Net ${birdies.length > 1 ? "birdies" : "birdie"} — ${sayNames(birdies)}`);
  }
  // Nothing to shout about is a real thing that happens on a par 3 everybody
  // pars, and saying so beats an empty panel the captain reads as a bug.
  if (!notes.length) notes.push("Nothing to shout about — read the number");

  return { ready: true, headline, notes, counted: counted.length, need };
}
