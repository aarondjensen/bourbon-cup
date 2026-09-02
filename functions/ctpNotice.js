// ══════════════════════════════════════════════════════════════════
//  ctpNotice — the CTP line in the round-final push.
// ══════════════════════════════════════════════════════════════════
//
// The round-final notification used to say "Handicaps and results are frozen
// — the leaderboard is up to date", which is true and tells nobody anything
// they could not have guessed from the title. The pins are the one result of
// the round that a man wants to know before he opens the app.
//
// PURE — no firebase, no network, no logging. index.js gathers the four
// inputs and this decides the sentence, which is what lets ctpNotice.test.mjs
// pin the awkward cases (two men with the same initials, a re-pointed hole, a
// tag by somebody who never bought in) without an emulator.
//
// ── The character budget ────────────────────────────────────────────
// This is written for the smallest of the three trays it lands in:
//
//   iOS banner   title 1 line, body 2 lines   ≈ 110 chars, rest on long-press
//   web SW       title 1 line, body 2 lines   ≈ 110 chars
//   Android      title 1 line, body ONE line  ≈ 40–50 chars, no expand
//
// Android is the hard one and it is structural: FCM's `android.notification`
// has no BigText option, so a long body is truncated with an ellipsis and
// there is no chevron to open it. Hence initials rather than names — a round
// carries four par 3s (five on eight of the forty rounds on record), and
// "#4 PW, #7 JH, #12 TC, #16 AH" fits a single line where
// "#4 Paul W, #7 Jim H, #12 Tim C, #16 Andy H" does not.
//
// MAX_BODY is the two-line budget, not the one-line one. Android truncating
// the tail of a five-pin round is an acceptable loss; iOS and the web
// dropping a pin that would have fit is not.
"use strict";

const MAX_BODY = 110;
const PREFIX = "CTPs: ";

// ── A name, shortened ───────────────────────────────────────────────
// The roster already stores the short form — the app shows first name and
// last initial everywhere, so `name` is "Paul W" rather than "Paul Wilson".
// This takes the next step down: first initial and last initial, "PW".
//
// No periods. They cost two characters a name on the line this is written to
// fit, and a pair of capitals beside a hole number is not read as a sentence.
//
// FIRST and LAST, never the middle: a roster row typed "Mary Jo Smith" is
// "MS" and not "MJS", which is the same rule the display form follows.
//
// A single-word name has no last initial to take, and "G" for Ghost is worse
// than Ghost. Null says so, and the caller prints the name as it stands.
const initialsOf = (name) => {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
};

// ── Who "T.C." is ───────────────────────────────────────────────────
// TJ C and Tim C are two men, and they have both played in this tournament.
// Shortened to initials they are the same string, and a notification that
// says "#7 T.C." in front of both of them is worse than a long one: each
// reads it as himself, and the one who did not win the pin finds out later.
//
// So the fold is checked against the WHOLE round's roster rather than against
// the other winners. Tim C taking a pin is ambiguous whether or not TJ C
// happened to take one too — the ambiguity is in the field, not in the list.
// A colliding name is printed in full and costs its four characters; everyone
// else still gets initials.
const labelsFor = (roster) => {
  const holders = new Map();
  for (const p of roster) {
    const ini = initialsOf(p.name);
    if (!ini) continue;
    holders.set(ini, (holders.get(ini) || 0) + 1);
  }
  const out = {};
  for (const p of roster) {
    const ini = initialsOf(p.name);
    out[p.player_id] = ini && holders.get(ini) === 1 ? ini : p.name || p.player_id;
  }
  return out;
};

// Trim from the END, because the holes are in playing order and the ones a
// man remembers are the ones he just played. "+2 more" rather than an
// ellipsis: a count is a fact, and it tells him to open the app.
const fit = (parts) => {
  const whole = PREFIX + parts.join(", ");
  if (whole.length <= MAX_BODY) return whole;
  for (let n = parts.length - 1; n >= 1; n--) {
    const body = `${PREFIX}${parts.slice(0, n).join(", ")} +${parts.length - n} more`;
    if (body.length <= MAX_BODY) return body;
  }
  // One pin whose name alone blows the budget. Pathological, but a body that
  // says nothing is worse than one that says how many.
  return `${PREFIX}${parts.length} taken`;
};

// ── The line ────────────────────────────────────────────────────────
// Returns null when there is nothing to say, and the caller keeps the old
// sentence. That covers a round with no par 3s, a round whose pins nobody
// tagged, and a tournament that has never played CTP at all.
//
// `pars` comes off the ROUND LOCK's frozen `hole_pars`, not off the live
// course — which is the same reading lib/betting's ctpTags takes, and for the
// same reason: a director who re-points a hole after the fact must not
// resurrect a tag on a hole that is no longer a par 3.
//
// `ctpIn` is the buy-in field: an array of player ids, or null when no
// director has ever touched it, and null means EVERYBODY (see lib/betting's
// inField). A tag by somebody outside it still stands on its hole — the
// document is the hole's answer — but it wins no money and the Betting tab
// does not score it, so it is not announced either.
//
// An UNSETTLED tag is announced. By the time a director finalizes a round the
// pins are settled, and a line that silently omitted a standing tag would
// disagree with the Betting tab the man opens to check it.
function ctpBody({ pars, tags, ctpIn, roster }) {
  // The borrowed ball is a compiled card, not a person — it cannot take a pin
  // and it must not sit in the collision map either (see lib/players).
  const real = (roster || []).filter((p) => p && p.player_id && !p.borrowed);
  if (!real.length) return null;

  const known = new Set(real.map((p) => p.player_id));
  const inGame = Array.isArray(ctpIn) ? new Set(ctpIn) : null;
  const label = labelsFor(real);

  // Hole is stored 0-based (see App.onSetCtp); a later tag on the same hole
  // has already replaced the earlier one in Firestore, so this is a map only
  // to look the hole up by number.
  const byHole = new Map();
  for (const t of tags || []) {
    if (!t || t.player_id == null || !Number.isInteger(t.hole)) continue;
    byHole.set(t.hole, t.player_id);
  }

  const parts = [];
  (Array.isArray(pars) ? pars : []).forEach((par, h) => {
    if (Number(par) !== 3) return;
    const pid = byHole.get(h);
    if (!pid || !known.has(pid)) return;
    if (inGame && !inGame.has(pid)) return;
    parts.push(`#${h + 1} ${label[pid]}`);
  });

  return parts.length ? fit(parts) : null;
}

module.exports = { ctpBody, initialsOf, MAX_BODY };
