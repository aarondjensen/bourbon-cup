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
const countedBalls = (balls) => (balls || []).filter((b) => b.counted && b.net != null);

const runWord = (n) => (["", "", "two", "three", "four", "five", "six", "seven"][n] || `${n}`);

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
// "The first net eagle of the round" said on the third hole means first of the
// three everybody has watched. If it quietly meant first of eighteen, it would
// be telling the room there is no other eagle coming, on an evening whose
// entire point is that nobody knows what is coming. The caller passes the
// window; this module never reaches outside it, and it has no way to.
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
    out.push(`🦅 First net eagle of the round — ${sayNames(eaglesNow)}`);
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
      out.push(`⭐ ${possessive(side)} best hole of the round`);
    }
  }

  return out.slice(0, 2);
}

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

  return {
    ready: true,
    headline,
    notes,
    nuggets: holeNuggets({ balls, par, countN, score, history, teamName }),
    counted: counted.length,
    need,
  };
}
