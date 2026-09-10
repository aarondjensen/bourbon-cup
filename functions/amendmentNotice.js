// ══════════════════════════════════════════════════════════════════
//  amendmentNotice — "your card was corrected", and who hears it
// ══════════════════════════════════════════════════════════════════
//
// A round that was finalized, reopened, changed and finalized again has moved
// a scorecard somebody already signed. The men whose card it is are told when
// the correction becomes official — see src/lib/scoreEdits for why that is the
// re-finalize rather than the edit.
//
// PURE — no firebase, no network, no logging. index.js gathers the edits, the
// roster and the round's matches; this decides who is on the list and what
// the sentence says, which is what lets amendmentNotice.test.mjs pin the
// awkward cases without an emulator.
//
// ── WHO HEARS IT ────────────────────────────────────────────────────
// The man whose hole moved, and everybody else in his match.
//
// The second half is the part worth defending. A scorecard in this
// tournament is not a private document: it is signed by one player and
// attested by the others, and that attestation is the whole reason the number
// is trusted. When the number changes, the people who swore to it have as
// much standing to know as the man it belongs to — more, arguably, since they
// are the ones whose word has been quietly revised.
//
// A player in the match whose own card did not move still gets told, because
// his OPPONENT's corrected hole can turn the match he played in. "Nothing of
// yours changed" is not a reason to leave somebody out of a result that moved
// underneath them.
//
// ── THE CHARACTER BUDGET ────────────────────────────────────────────
// Same trays and the same budget as ctpNotice, and for the same structural
// reason — FCM's `android.notification` has no BigText, so a long body is
// truncated with no way to expand it:
//
//   iOS banner   title 1 line, body 2 lines   ~110 chars
//   web SW       title 1 line, body 2 lines   ~110 chars
//   Android      title 1 line, body ONE line  ~40-50 chars, no expand
//
// Which is why the body leads with the count and the holes rather than with
// an apology. "Round 2: hole 7 now 4 (was 5)" survives truncation into
// something a man can act on; "Your Round 2 scorecard has been amended by the
// tournament director" truncates into nothing at all.
"use strict";

const MAX_BODY = 110;

// ── Grouping ────────────────────────────────────────────────────────
// The edit rows for one amendment, folded into one entry per player. Rows
// arrive in whatever order Firestore hands them back, so holes are sorted
// here — a body that reads "holes 12, 3, 7" looks like a bug in front of the
// one audience that will check it against a paper card.
function byPlayer(edits) {
  const out = new Map();
  for (const e of edits || []) {
    const pid = e && e.player_id;
    // Setting rows carry no player — they are the round's, and they are fanned
    // out separately below.
    if (!pid) continue;
    if (!out.has(pid)) out.set(pid, { playerId: pid, scores: [], handicap: null });
    const entry = out.get(pid);
    if (e.kind === "handicap") entry.handicap = { from: e.from, to: e.to };
    else entry.scores.push({ hole: Number(e.hole_number), from: e.from, to: e.to });
  }
  for (const entry of out.values()) {
    entry.scores.sort((a, b) => a.hole - b.hole);
  }
  return out;
}

// A score that was never entered reads as a dash rather than as "null" or as
// nothing at all — a hole going from blank to a 5 is a real correction and
// "hole 7 now 5 (was )" is how it renders if this is skipped.
const num = (v) => (v == null || v === "" ? "–" : String(v));

// ── One player's sentence ───────────────────────────────────────────
// What HIS card did, not what the round did. Three shapes:
//
//   his own holes moved            name them, with the numbers
//   only his handicap moved        say so, with the numbers
//   neither, but his match's did   say the match was corrected
//
// The third is the playing partner above, and it deliberately does not name
// whose hole moved. A push that says "Vic's hole 7 became a 4" hands one
// player a result about another before either has opened the app; the card is
// there for anybody who wants the detail.
function bodyFor({ round, entry, matchOnly }) {
  if (matchOnly) {
    return `A card in your Round ${round} match was corrected — open Scoring to see it.`;
  }

  const parts = [];
  const holes = entry.scores || [];
  if (holes.length === 1) {
    const h = holes[0];
    parts.push(`hole ${h.hole} now ${num(h.to)} (was ${num(h.from)})`);
  } else if (holes.length > 1) {
    // Numbers per hole stop fitting somewhere around three, and a truncated
    // list is worse than an honest count — a man who reads "holes 3, 7" and
    // has four corrections has been misinformed by the notification itself.
    const listed = holes.slice(0, 3).map(h => `${h.hole}`).join(", ");
    const more = holes.length > 3 ? ` +${holes.length - 3}` : "";
    parts.push(`holes ${listed}${more} changed`);
  }

  if (entry.handicap) {
    parts.push(`handicap ${num(entry.handicap.from)} → ${num(entry.handicap.to)}`);
  }

  if (!parts.length) {
    return `Your Round ${round} card was corrected — open Scoring to see it.`;
  }
  const body = `Round ${round}: ${parts.join(", ")}.`;
  return body.length <= MAX_BODY ? body : `${body.slice(0, MAX_BODY - 1).trimEnd()}…`;
}

// ── The notices ─────────────────────────────────────────────────────
// One per recipient: { playerId, title, body, ownCard }.
//
// `matchmates` maps a player id to everybody in his match for this round
// (index.js builds it off bc_matches). A player with no match — withdrawn,
// or a roster row nobody drew in — still hears about his OWN card; there is
// simply nobody to pass it on to.
//
// Recipients are deduplicated across matches, and a player who is in the
// edit list wins over the same player reached as somebody's matchmate: his
// own holes are the more specific news and must not be overwritten by the
// generic match line.
// The round-level rows: an allowance, a mode, a course. No player on them,
// because they reach everybody who played.
const settingsIn = (edits) => (edits || []).filter(e => e && e.kind === "setting");

// What a round-wide change says. Named rather than vague — unlike a partner's
// corrected hole, this is not somebody else's result, it is a term of the
// round every man in it played under, and "your strokes may have moved" with
// no reason attached is an alarm rather than information.
function settingBody({ round, settings }) {
  const labels = settings.map(s => s.label || s.field).filter(Boolean);
  if (settings.length === 1) {
    const s = settings[0];
    const detail = s.from != null && s.to != null ? ` ${s.from} → ${s.to}` : "";
    const body = `Round ${round}: ${labels[0]}${detail}. Your strokes may have moved.`;
    return body.length <= MAX_BODY ? body : `Round ${round}: ${labels[0]} changed — your strokes may have moved.`;
  }
  return `Round ${round}: ${labels.slice(0, 2).join(" and ")} changed — your strokes may have moved.`;
}

function amendmentNotices({ round, edits, matchmates = {} }) {
  const grouped = byPlayer(edits);
  const settings = settingsIn(edits);
  if (!grouped.size && !settings.length) return [];

  const notices = new Map();

  // Pass 1 — the men whose own card moved. The most specific news there is,
  // so it goes first and nothing below may overwrite it.
  for (const entry of grouped.values()) {
    notices.set(entry.playerId, {
      playerId: entry.playerId,
      title: `Your Round ${round} card was corrected`,
      body: bodyFor({ round, entry, matchOnly: false }),
      ownCard: true,
    });
  }

  // Pass 2 — a round-level change, to everybody who played the round.
  // Ahead of the matchmate pass because it is the more informative of the
  // two: it names the term that moved rather than pointing at somebody
  // else's card.
  if (settings.length) {
    const body = settingBody({ round, settings });
    for (const pid of Object.keys(matchmates)) {
      if (notices.has(pid)) continue;
      notices.set(pid, {
        playerId: pid,
        title: `Round ${round} was re-scored`,
        body,
        ownCard: false,
      });
    }
  }

  // Pass 3 — the playing partners and opponents of anyone in pass 1.
  for (const entry of grouped.values()) {
    for (const pid of matchmates[entry.playerId] || []) {
      if (!pid || notices.has(pid)) continue;
      notices.set(pid, {
        playerId: pid,
        title: `Round ${round} was corrected`,
        body: bodyFor({ round, entry, matchOnly: true }),
        ownCard: false,
      });
    }
  }

  return [...notices.values()];
}

module.exports = { amendmentNotices, bodyFor, byPlayer, settingBody, MAX_BODY };
