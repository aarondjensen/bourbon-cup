// ══════════════════════════════════════════════════════════════════
//  streaks — what happened on consecutive holes, and how it is written down.
// ══════════════════════════════════════════════════════════════════
//
// A streak is the one record on the Data tab that cannot be answered from a
// round summary. "Nine holes without a net bogey" is a claim about hole 14 of
// Friday and hole 4 of Saturday being next to each other, and the archive
// ships one row per CARD — eagles, birdies, pars, bogies and doubles as
// counts, in whatever order they happened, which is no order at all.
//
// Hole-by-hole SCORES are not the answer either, and pipeline/archive.mjs
// says why: 11,340 of them is most of a megabyte, shipped to a phone to
// answer a question nobody asked below the level of a round.
//
// So each card carries two eighteen-character strings instead — what the hole
// did, not what was written on it:
//
//   np   net against par:  E B P 1 2 3    (eagle-or-better … triple-or-worse)
//   hr   the hole's result: W L H         (from the side this card is on)
//
// and `-` in either is a hole with no evidence: not played, not scored, or
// a match the other side has not finished. 36 bytes a card, which gzips to
// almost nothing next to the ~800 the scores would have cost, and it keeps
// the archive's own bargain: it ships FACTS and lets archiveFold ask the
// questions, so a streak nobody has thought of yet needs no rebuild.
//
// Pure — no Firebase, no React, no scoring engine. Both producers import the
// marks from here (pipeline/archive.mjs for the ten finished years,
// lib/archiveLive for the one being played) so the two can never disagree
// about what a P means.

export const HOLES_PER_ROUND = 18;

// A hole nobody can speak for. Its own character rather than a space, so a
// committed archive diff stays readable and a mark can never be mistaken for
// the end of the string.
export const GAP = "-";

// ── Net against par ───────────────────────────────────────────────
// Clamped at both ends: an albatross and an eagle are both `E`, a triple and
// an eleven are both `3`. Nothing here asks how far past a double somebody
// went, and a bucket that stops is what keeps this one character wide.
export const netMark = (netVsPar) => {
  if (netVsPar == null || !Number.isFinite(netVsPar)) return GAP;
  if (netVsPar <= -2) return "E";
  if (netVsPar === -1) return "B";
  if (netVsPar === 0) return "P";
  if (netVsPar === 1) return "1";
  if (netVsPar === 2) return "2";
  return "3";
};

// ── The hole's result ─────────────────────────────────────────────
// Written from the side the card belongs to, so a man's own string reads W
// where his side took the hole. `winner` is the engine's — null on a hole
// both sides tied, which is a HALVE and not a gap, and null again on a hole
// nobody has finished, which is.
export const holeMark = (winner, side, played = true) => {
  if (!played) return GAP;
  if (winner == null) return "H";
  return winner === side ? "W" : "L";
};

// An eighteen-character string from whatever a producer has per hole. Short
// input is padded with gaps rather than left ragged: a string that is not 18
// long is one the reader has to measure before it can index it.
export const encodeHoles = (marks = []) => {
  const out = [];
  for (let h = 0; h < HOLES_PER_ROUND; h++) out.push(marks[h] || GAP);
  return out.join("");
};

// ── What counts as what ───────────────────────────────────────────
// Read by archiveFold, and the reason the marks are a closed set: a streak is
// defined by naming the characters that continue it, so "without a net
// double" is the complement of the two that end it rather than a second
// definition of a double.
export const NET_PAR_OR_BETTER = new Set(["E", "B", "P"]);
export const NET_DOUBLE_OR_WORSE = new Set(["2", "3"]);
export const NET_BOGEY_OR_WORSE = new Set(["1", "2", "3"]);
export const NET_MARKS = new Set(["E", "B", "P", "1", "2", "3"]);

// ── The longest run ───────────────────────────────────────────────
// `seq` is one man's career in order — every hole he has a mark for, oldest
// first — and each item carries where it happened so a record can say so.
//
// A gap ENDS a run rather than being stepped over, and that is the whole
// judgement in this file. A streak is a claim about consecutive holes; there
// is nothing to claim across a hole with no score on it, and a shared-ball
// round is a gap for the same reason a missing one is (see archiveFold). The
// alternative — skipping gaps — would let a man hole out on Sunday 2019, miss
// three cups, and continue a streak in 2023.
//
// The FIRST run of the longest length wins a tie, which is the older one.
export const longestRun = (seq = [], hit) => {
  let best = null;
  let run = 0;
  let from = null;
  for (const s of seq) {
    if (s && s.v != null && s.v !== GAP && hit(s.v)) {
      run += 1;
      if (run === 1) from = s;
      if (!best || run > best.len) best = { len: run, from, to: s };
    } else {
      run = 0;
      from = null;
    }
  }
  return best;
};

// ── Where it happened ─────────────────────────────────────────────
// A streak is a span, and the interesting ones cross a round: the label has
// to collapse to the shortest true thing rather than always printing both
// ends. One round, one week, or a run that outlived a cup.
export const streakWhere = (s) => {
  if (!s || !s.from) return "";
  const { from, to } = s;
  if (from.year !== to.year) return `${from.year}–${to.year}`;
  if (from.round == null || to.round == null) return String(from.year);
  if (from.round !== to.round) return `${from.year} R${from.round}–${to.round}`;
  return `${from.year} R${from.round}`;
};
