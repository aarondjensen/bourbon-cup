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
// AND THE OTHER END OF IT, WHICH IS NOT THE SAME THING. The one ball that
// stands apart from the rest of the side is not a bad hole, it is a story —
// the ball off the cart path, the one that never came out of the bunker — and
// the man who made it is the first to tell it. The card is fun facts, not a
// leaderboard: a side can be four under with four net birdies and still have
// somebody who blew up on the same hole, and leaving that out is leaving out
// the half of it everybody enjoyed.
//
// IT IS MEASURED AGAINST THE SIDE, NOT AGAINST PAR, and that distinction is
// the whole of it — see blowUpNote. Naming a man for a bad NUMBER is what the
// paragraph above refuses; naming him for being three clear of everybody he
// played the hole with is a different thing, and on a hole where the rest of
// them made birdie it is the only thing anybody wants to hear. It rides after
// the good news rather than instead of it, and it never affects the number.
//
// A ball that DID NOT COUNT is still a birdie the man made, and the card says
// so. That is a reversal, and the hole that forced it is worth writing down:
// four balls counted, and FIVE men were at net one under. The card named four
// of them. There is no fourth-best of five identical scores — which four
// "counted" is an arbitrary tie-break inside the engine — so the fifth man
// stood in the room and heard his own birdie left out of a list of birdies,
// which is precisely the argument the old rule was written to avoid.
//
// So every ball that beat par is named, and when fewer of them counted than
// were made, the line SAYS SO: "Five net birdies — … (four counted)". The
// number the side is measured by has not moved an inch; the captain simply
// stops reading out a list that is missing somebody standing in front of him.
//
// `ballNote` keeps the old rule and is still what the NUGGETS read, on
// purpose. "The first net eagle of the round" is a claim about the scoring,
// and an eagle the format threw away did not move it. See holeNuggets.
//
// Pure — no React, no Firebase, no theme. Given balls and a par it returns
// text. Everything about how it looks lives in the component.

export const EAGLE = "eagle";
export const BIRDIE = "birdie";

// Net-to-par for one ball, or null when there is no score on it.
export const netToPar = (ball, par) =>
  ball?.net == null || !Number.isFinite(par) ? null : ball.net - par;

// What one ball is worth saying about, purely on the SCORE — whether the
// format counted it is a separate question and a separate reader's.
export const ballScoreNote = (ball, par) => {
  const rel = netToPar(ball, par);
  if (rel == null) return null;
  if (rel <= -2) return EAGLE;
  if (rel === -1) return BIRDIE;
  return null;
};

// The same question asked of a ball that MADE THE NUMBER. What the nuggets
// read: "the first net eagle of the round" is a claim about the scoring, and
// an eagle the format threw away did not move it.
export const ballNote = (ball, par) => (ball?.counted ? ballScoreNote(ball, par) : null);

// ── The other end of the card ───────────────────────────────────────
// It is AGAINST THE SIDE, not against par, and that is the whole of it.
//
// It started as a hard line at three over net, and a hard line is wrong in
// both directions at once. On a brutal par 3 where the side went +2, +2, +2,
// +3, +3, +3, +3, +4, the man on +4 played the hole as well as anybody and got
// shouted at for it. And on the hole this was actually reported from — seven
// net birdies and one net DOUBLE — the interesting ball was three clear of the
// entire side and said nothing at all, because +2 is not +3.
//
// So the question is how far he is from how his own side played the hole, and
// nothing else. A man two clear of the middle of eight balls is the story
// wherever par happens to be.
//
// The MEDIAN of the other balls rather than the next-worst one, because two
// men blowing up together is MORE of a story and a next-worst test cancels it
// out exactly then: [0,0,0,0,0,0,+3,+3] would read as no gap at all.
export const OUTLIER_GAP = 3;

// A par is never a blow-up, however far clear of the side it is. Seven net
// eagles and a net par is a hole seven men will talk about on their own.
export const OUTLIER_FLOOR = 1;

// Enough balls for "how the side played it" to mean anything — the worst one,
// and at least two to take a middle of.
const OUTLIER_MIN_BALLS = 3;

const OVER_WORD = { 1: "bogey", 2: "double", 3: "triple", 4: "quad" };

// What a golfer calls it. Past a quad nobody has a word, so it says the
// number — spelled, because the card is read out loud.
export const overWord = (rel) => OVER_WORD[rel] || `${countWord(rel)}-over`;

const median = (sorted) => {
  const n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
};

// The ball that stands apart from the rest of the side, and everybody level
// with it. ONE line: a hole where three men blew up is a hole where the story
// is the worst of them, and reading out a list of bad numbers is the thing the
// header refuses.
//
// Reads every POSTED ball rather than the counted ones. On a best-N hole the
// outlier is by definition the ball the format threw away, so asking only the
// counted ones would find nothing, ever — and it moves no number either way.
export const blowUpNote = (balls, par) => {
  const rels = (balls || [])
    .filter((b) => b?.net != null)
    .map((b) => ({ b, rel: netToPar(b, par) }))
    .filter((e) => e.rel != null);
  if (rels.length < OUTLIER_MIN_BALLS) return null;

  const worst = Math.max(...rels.map((e) => e.rel));
  if (worst < OUTLIER_FLOOR) return null;

  const rest = rels.filter((e) => e.rel < worst).map((e) => e.rel).sort((a, b) => a - b);
  if (rest.length < 2) return null;
  if (worst - median(rest) < OUTLIER_GAP) return null;

  const who = rels.filter((e) => e.rel === worst).map((e) => e.b.name);
  return `💥 ${sayNames(who)} — net ${overWord(worst)}`;
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
const countedBalls = (balls) => (balls || []).filter((b) => b.counted && b.net != null);

// Spelled, because it is read aloud. "Five net birdies" is a sentence; "5 net
// birdies" is a caption a man has to convert while he is talking.
const WORDS = ["none", "one", "two", "three", "four", "five", "six", "seven", "eight"];
const countWord = (n) => WORDS[n] ?? `${n}`;
const runWord = countWord;

// "Mash Brothers" → "Mash Brothers'", "Irons" → "Irons'", "Drivers" → "Drivers'".
// A team name ending in s takes the bare apostrophe; anything else takes 's.
// Both sides here end in one, but a director names his own teams.
export const possessive = (name) => {
  const n = String(name || "").trim();
  if (!n) return "";
  return /s$/i.test(n) ? `${n}'` : `${n}'s`;
};

// ── The nuggets ─────────────────────────────────────────────────────
// The things worth saying that ONE hole cannot tell you: the first net eagle
// anybody has hit, a man on his third birdie running, the best hole of the
// evening so far. They are what turns a number read out into a story, and
// they are the half a captain cannot work out standing there.
//
// WHAT THEY MAY LOOK AT, AND THIS IS THE WHOLE OF IT
// --------------------------------------------------
// `history` is the holes ALREADY TURNED OVER, and the hole being announced.
// Nothing else. It is not a shortage of data — a captain's phone holds his
// side's whole round, because a team is never hidden from itself — it is that
// a nugget compiled from a hole the room has not seen is the ending, leaked
// through the one thing on this screen nobody would think to check.
//
// AND THEY SAY "SO FAR", WHICH IS NOT A HEDGE. The window is the guarantee;
// the wording is what stops the guarantee from being undone out loud. Both
// lines read "of the round" — "the first net eagle OF THE ROUND", "their best
// hole OF THE ROUND" — said on the sixth of eighteen, in a room whose entire
// point is that nobody knows what is coming. A captain reading that is telling
// fifteen people no better hole is on its way, which is the ending, arrived at
// early, and he cannot even know it is true: the cap means he is looking at
// six holes and the sentence claims all eighteen.
//
// "So far" is the true one and it is also the more exciting one — it says the
// evening is still running. The caller passes the window; this module never
// reaches outside it, and now it never talks as though it had.
//
// Scoped to the captain's OWN SIDE, which is the only round he can see all of
// and the only one he is narrating. The other side's eagles are their
// captain's to announce.
//
// At most two, and they come after the hole's own names. He is standing in
// front of fifteen people holding a drink.
export function holeNuggets({ balls, par, countN, score, history, teamName }) {
  const out = [];
  const now = countedBalls(balls);
  const past = history || [];
  const need = Number.isFinite(countN) && countN > 0 ? countN : now.length;
  const side = teamName || "your side";

  // ── The first net eagle anybody has seen ──
  const eaglesNow = now.filter((b) => ballNote(b, par) === EAGLE).map((b) => b.name);
  const eagleBefore = past.some((h) => countedBalls(h.balls).some((b) => ballNote(b, h.par) === EAGLE));
  if (eaglesNow.length && !eagleBefore) {
    out.push(`🦅 First net eagle so far — ${sayNames(eaglesNow)}`);
  }

  // ── A man on a run ──
  // Counted birdies-or-better, on consecutive holes, ending on this one. Two
  // in a row is worth saying out loud; one is just the birdie line above.
  const under = (bs, p) => new Set(countedBalls(bs).filter((b) => ballNote(b, p) != null).map((b) => b.pid));
  const hot = under(balls, par);
  if (hot.size) {
    const runs = [];
    hot.forEach((pid) => {
      let n = 1;
      for (let i = past.length - 1; i >= 0; i -= 1) {
        if (!under(past[i].balls, past[i].par).has(pid)) break;
        n += 1;
      }
      if (n >= 2) {
        const name = now.find((b) => b.pid === pid)?.name || pid;
        runs.push({ name, n });
      }
    });
    runs.sort((a, b) => b.n - a.n);
    if (runs.length) {
      const best = runs[0];
      out.push(`🔥 ${best.name} — ${runWord(best.n)} in a row`);
    }
  }

  // ── The best hole of the evening so far ──
  // Strictly better than every hole already turned over, and under par: a side
  // that has been level all night does not get told the level one is its best.
  const rel = relToPar(score, par, need);
  if (rel != null && rel < 0 && past.length) {
    const before = past
      .map((h) => relToPar(h.score, h.par, Number.isFinite(h.countN) && h.countN > 0 ? h.countN : countedBalls(h.balls).length))
      .filter((v) => v != null);
    if (before.length && rel < Math.min(...before)) {
      out.push(`⭐ ${possessive(side)} best hole so far`);
    }
  }

  // ── And the blow-up, which is never crowded out ──
  // Appended AFTER the cap rather than competing for a place in it. The hole
  // that made this necessary was four net birdies, four under, and a net quad
  // on the same eight balls — three good-news lines, and the one everybody in
  // the room actually wanted to hear would have lost the tie-break to every
  // one of them. It goes last because it is the punchline.
  const blow = blowUpNote(balls, par);
  return blow ? [...out.slice(0, 2), blow] : out.slice(0, 2);
}

// ── The quiet hole, said a different way each time ──────────────────
// Four men par a par 3 and there is genuinely nothing to name. Saying so is
// right — an empty panel reads as a bug to the man holding it — but it was ONE
// string, and a captain who hit two flat holes in an evening read the identical
// sentence out twice. On a screen whose whole job is to be spoken aloud that
// does not land as consistency, it lands as a stuck app.
//
// So they cycle, and the index is HOW MANY QUIET HOLES HAVE ALREADY GONE BY
// rather than the hole number: it is the repeat that has to be avoided, and
// two flat holes six apart are as obvious as two in a row. Nothing repeats
// until all five are spent, and the fifth one back round is twenty minutes
// after the first.
//
// Derived rather than random, for the same reason everything else here is: a
// captain re-reading a hole the director stepped back to must find the same
// words on it, and `history` is the only state this module has.
export const QUIET_LINES = [
  "Nothing to shout about — read the number",
  "Quiet one — straight to the number",
  "No fireworks — just the number",
  "Everybody made their four — read it out",
  "Nothing doing here — the number says it",
];

// Was this hole one of the quiet ones? The same test the notes above make,
// asked of a hole in the window — a hole nobody has posted is not quiet, it
// is unplayed, and it must not advance the cycle.
const isQuiet = (h) => {
  const posted = (h?.balls || []).filter((b) => b.net != null);
  if (!posted.length || h?.score == null) return false;
  return !posted.some((b) => ballScoreNote(b, h.par) != null);
};

export const quietLine = (history) => {
  const before = (history || []).filter(isQuiet).length;
  return QUIET_LINES[before % QUIET_LINES.length];
};

export function holePrompt({ balls, par, countN, score, history, teamName }) {
  const all = balls || [];
  const posted = all.filter((b) => b.net != null);
  const counted = countedBalls(all);
  const need = Number.isFinite(countN) && countN > 0 ? countN : counted.length;

  if (!posted.length || score == null) {
    return { ready: false, headline: "NO SCORES ON THIS HOLE YET", notes: [], counted: 0, need };
  }

  const rel = relToPar(score, par, need);
  // The side is NAMED. It used to read "YOUR SIDE −4", which is the app
  // talking to the man holding the phone — and he is not the audience, the
  // room is. He reads this out; "Mash Brothers, four under" is a sentence and
  // "your side, four under" is a prompt he has to translate first.
  const headline = `${teamName || "YOUR SIDE"} ${fmtRel(rel)}`;

  // Every ball that beat par, counted or not — see the note at the top of the
  // file. Read off `posted` rather than `counted`, which is the whole change.
  const eagles = [], birdies = [];
  posted.forEach((b) => {
    const note = ballScoreNote(b, par);
    if (note === EAGLE) eagles.push(b);
    else if (note === BIRDIE) birdies.push(b);
  });

  // One line per kind. It stays the short form — "Net birdies — Dave and
  // John" — whenever every one of them made the number, which is nearly every
  // hole; the count is only spoken when the two numbers genuinely differ, and
  // then it leads, because "five net birdies" is the thing he says first.
  const line = (group, one, many) => {
    const names = sayNames(group.map((b) => b.name));
    const made = group.length;
    const kept = group.filter((b) => b.counted).length;
    if (made === kept) return `Net ${made > 1 ? many : one} — ${names}`;
    const lead = countWord(made);
    return `${lead[0].toUpperCase()}${lead.slice(1)} net ${made > 1 ? many : one} — ${names} (${countWord(kept)} counted)`;
  };

  const notes = [];
  if (eagles.length) notes.push(line(eagles, "eagle", "eagles"));
  if (birdies.length) notes.push(line(birdies, "birdie", "birdies"));
  // Nothing to shout about is a real thing that happens on a par 3 everybody
  // pars, and saying so beats an empty panel the captain reads as a bug.
  if (!notes.length) notes.push(quietLine(history));

  return {
    ready: true,
    headline,
    notes,
    nuggets: holeNuggets({ balls, par, countN, score, history, teamName }),
    counted: counted.length,
    need,
  };
}
