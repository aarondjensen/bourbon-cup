// ══════════════════════════════════════════════════════════════════
//  groups — playing groups (foursomes) and the tee times they go off on.
// ══════════════════════════════════════════════════════════════════
//
// A MATCH is a competition: who is playing whom, and how the points are
// settled. A GROUP is logistics: who walks to the first tee together, and
// at what time. For most of this app's formats the two are the same thing
// and nobody has to think about it — a 2-man format puts exactly four
// players in a match, so the match IS the foursome. That is why groups
// were never modelled before.
//
// They come apart the moment a round isn't 2v2:
//   • Singles      — a match is two players, so a foursome is TWO matches.
//   • Team formats — Team Best Ball puts the whole side in one match, so a
//                    single match spans as many foursomes as it takes — and
//                    those foursomes are TEAMMATES, because the side plays as
//                    a side (see `groupsByTeam` in constants.js). It is the
//                    one format here where a group holding both teams is a
//                    mistake rather than the point.
// In both cases the pairing is a judgement call (who plays with whom, who
// goes off first) that only the director can make. Hence this module.
//
// ── Storage ────────────────────────────────────────────────────────
// One document per round in `bc_groups`, following the same shape as the
// other per-round documents (bc_hcp_overrides, bc_tee_assignments):
//
//   { id, tournament_id, round_number,
//     groups: [ { players: ["a1","b1","a2","b2"] }, … ] }
//
// A group is just its ordered player ids, so the natural encoding would be
// an array of arrays — but Firestore does not support nested arrays, and a
// write of one fails with invalid-argument. Each group is therefore wrapped
// in a one-field map on the way out and unwrapped on the way in
// (encodeGroups / decodeGroups below); everything above the persistence
// boundary works with plain string[][].
//
// Tee times are deliberately NOT stored here — they already live on the
// round document as `tee_time`, a pipe-delimited list ("8:30|8:40|8:50")
// that the Rounds tab has always written. Group i goes off at time i.
//
// Which makes the tee-time list the group list. The Rounds tab writes one
// box per group, labelled G1–G4, so by the time a director reaches the
// Matches tab the round's groups already exist — there is nothing to create,
// only matches to drop into them. This document holds who rides in each,
// never how many there are or when they go off.

import { editionDocId } from "../firebase";
import { FORMATS } from "../constants";

export const GROUPS_COL = "bc_groups";
export const groupsDocId = (round) => editionDocId(`bc_groups_r${round}`);

// Persistence boundary. See the storage note above for why the wrapper map
// exists. decodeGroups also accepts a bare array so a hand-edited document
// (or a future shape that no longer needs the wrapper) still reads.
export const encodeGroups = (groups) => (groups || []).map(players => ({ players }));
export const decodeGroups = (raw) => (raw || [])
  .map(g => (Array.isArray(g) ? g : (g?.players || [])))
  .filter(Array.isArray);

// A foursome is the target; a fivesome is tolerated (courses allow them,
// and an odd roster sometimes forces one). Past that it isn't a group.
export const GROUP_TARGET = 4;
export const GROUP_MAX = 5;

// Minutes between consecutive groups when the round setup doesn't imply
// one. Matches the spread the Rounds tab has always auto-filled.
export const DEFAULT_TEE_INTERVAL = 10;

// How many tee times the Rounds tab always writes (G1–G4). A sixteen-player
// field is four foursomes, so this is the whole tee sheet in the normal case
// and the floor in every other.
export const TEE_SLOTS = 4;

// ── Time parsing ───────────────────────────────────────────────────
// Accepts what a director actually types into a tee-time box: "8:30",
// "830", "8", "1:10 PM", "13:10". Returns minutes past midnight, or null
// when there is nothing to read. Golf-specific guess when AM/PM is
// omitted: 1–4 is the afternoon, everything else is the morning.
export function parseTeeTime(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const ap = /p/i.test(s) ? "pm" : /a/i.test(s) ? "am" : "";
  const digits = s.replace(/[^0-9]/g, "");
  if (!digits) return null;
  let h, min;
  if (s.includes(":")) {
    const [hh, mm] = s.split(":");
    h = parseInt(hh.replace(/[^0-9]/g, ""), 10);
    min = parseInt((mm || "0").replace(/[^0-9]/g, ""), 10) || 0;
  } else if (digits.length <= 2) {
    h = parseInt(digits, 10); min = 0;
  } else if (digits.length === 3) {
    h = parseInt(digits[0], 10); min = parseInt(digits.slice(1), 10);
  } else {
    h = parseInt(digits.slice(0, 2), 10); min = parseInt(digits.slice(2, 4), 10);
  }
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (ap === "pm" && h !== 12) h += 12;
  else if (ap === "am" && h === 12) h = 0;
  else if (!ap && h >= 1 && h <= 4) h += 12;
  return h * 60 + min;
}

// `ampm: true` for anything a player reads (the Matches screen); the bare
// "8:30" form for the admin inputs, which is what those boxes have always
// shown and what parseTeeTime reads back without ambiguity.
export function formatTeeTime(mins, { ampm = false } = {}) {
  if (mins == null) return "";
  let h = Math.floor(mins / 60) % 24;
  const m = ((mins % 60) + 60) % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")}${ampm ? ` ${suffix}` : ""}`;
}

// The round document's pipe-delimited tee-time list, as an array. Empty
// slots are preserved — index position is what ties a time to a group.
// Times are stored bare ("8:30") but older documents may carry a suffix; the
// boxes read cleaner without it and parseTeeTime doesn't need it. String() so
// a document holding a number instead of a string cannot take the screen down.
export const stripAMPM = (s) => (s ? String(s).replace(/\s*(AM|PM)/gi, "").trim() : s);

export const teeTimeList = (tr) =>
  (tr?.tee_time ? String(tr.tee_time).split("|") : []).map(s => s.trim());

export const joinTeeTimes = (times) => times.join("|");

// The spread the director has actually set, read off the first two slots.
// Falls back to the 10-minute default when there aren't two to compare.
export function teeInterval(times) {
  const a = parseTeeTime(times[0]);
  const b = parseTeeTime(times[1]);
  if (a == null || b == null || b <= a) return DEFAULT_TEE_INTERVAL;
  return b - a;
}

// A time for every group: whatever the director set, and for slots they
// never filled, the first tee plus one interval per group. Returns [] when
// there is no first tee to count from — an unset schedule shows as unset
// rather than inventing times off midnight.
export function expandTeeTimes(times, count) {
  const first = parseTeeTime(times[0]);
  const iv = teeInterval(times);
  return Array.from({ length: count }, (_, i) => {
    const set = (times[i] || "").trim();
    if (set) return set;
    return first == null ? "" : formatTeeTime(first + iv * i);
  });
}

// ── Slots ──────────────────────────────────────────────────────────
// A group's identity is its POSITION in the round's tee-time list, so a
// trailing empty group says nothing — it is only the tee sheet running out.
// Trimmed on the way to Firestore, which is what lets a round shrink: empty
// the last group and the round is back to however many tee times it has,
// with no "remove group" button needed to say so.
export const trimGroups = (groups) => {
  const out = [...(groups || [])];
  while (out.length && !out[out.length - 1].length) out.pop();
  return out;
};

// How many groups a round has: one per tee time the Rounds tab set, never
// fewer than the four it always writes, and never fewer than are already
// occupied (an eighteen-player field needs a fifth, and its players must not
// vanish because the tee sheet only lists four).
export const teeSlotCount = ({ tr, groups }) =>
  Math.max(teeTimeList(tr).length, trimGroups(groups).length, TEE_SLOTS);

// Those groups laid out against their slots — the ones with players in them,
// plus an empty group for every tee time nobody is riding yet.
export const padGroups = (groups, n) =>
  Array.from({ length: Math.max(n, (groups || []).length) }, (_, i) => groups?.[i] || []);

// ── Format shape ───────────────────────────────────────────────────
export const matchPlayers = (m) => [...(m?.teamA || []), ...(m?.teamB || [])];
export const formatPerSide = (formatId) => FORMATS.find(f => f.id === formatId)?.perSide ?? null;

// True when one match is exactly one foursome, so grouping is automatic
// and the director never has to think about it.
export const isFoursomeFormat = (formatId) => formatPerSide(formatId) === 2;

// True when a foursome is a team's OWN players — nobody rides with an
// opponent. Team Best Ball is the only format that says so (see the note on
// `groupsByTeam` in constants.js): a side of seven or eight plays as a side,
// so the draw for it is that side split into waves, not a tee sheet of 2v2
// foursomes. It is the ONE format question this module asks that the scoring
// engine never does — who walked with whom changes no result, it changes the
// tee sheet.
export const formatGroupsByTeam = (formatId) =>
  !!FORMATS.find(f => f.id === formatId)?.groupsByTeam;

// A side split into as-even groups as its size allows, never more than a
// foursome in one. Even rather than greedy on purpose: a side of five sliced
// four-at-a-time leaves one man teeing off alone, where 3 + 2 is two real
// groups. Eight is 4 + 4 and seven is 4 + 3 either way, which is the field
// this actually runs on.
export function splitEvenly(players, size = GROUP_TARGET) {
  const list = (players || []).filter(Boolean);
  if (!list.length) return [];
  const count = Math.ceil(list.length / size);
  const out = [];
  let i = 0;
  for (let g = 0; g < count; g++) {
    const take = Math.ceil((list.length - i) / (count - g));
    out.push(list.slice(i, i + take));
    i += take;
  }
  return out;
}

// Alternate the two sides so every generated foursome is as close to 2v2
// as the rosters allow, rather than both of one team going off together.
function interleave(a = [], b = []) {
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i]);
    if (b[i]) out.push(b[i]);
  }
  return out;
}

// A match's players in the order they should ride: opponents alternating.
// Everything that puts a match INTO a group goes through this, so a group
// built by hand reads the same way as one the auto-builder made.
export const matchSeq = (m) => interleave(m?.teamA, m?.teamB);

// ── Auto-build ─────────────────────────────────────────────────────
// Groups the round's matches into foursomes the obvious way for the round's
// format. The director can then adjust — this is a starting point, not a
// decision. Match integrity is never broken where it can be kept: a match
// small enough to fit in one group always lands in one group.
export function autoBuildGroups({ formatId, matches }) {
  const perSide = formatPerSide(formatId);
  const out = [];

  if (perSide === 2) {
    // One match = one foursome. Nothing to decide.
    matches.forEach(m => out.push(matchSeq(m)));
  } else if (perSide === 1) {
    // Singles: two matches ride together.
    for (let i = 0; i < matches.length; i += 2) {
      out.push(matches.slice(i, i + 2).flatMap(matchSeq));
    }
  } else if (formatGroupsByTeam(formatId)) {
    // Teammate foursomes (Team Best Ball). The side is the unit: each team is
    // split into waves of its own men and NOT interleaved with the opposition,
    // because that is how this round is played — the whole side plays the
    // whole side, and the four men walking together are counting each other's
    // nets, not marking an opponent's.
    //
    // The two sides' waves then alternate down the tee sheet (A, B, A, B) so
    // each team is spread across the morning rather than one side going off
    // an hour behind the other.
    matches.forEach(m => {
      out.push(...interleave(
        splitEvenly(m?.teamA || []),
        splitEvenly(m?.teamB || []),
      ));
    });
  } else {
    // Any other variable-size format: one match can hold the whole field, so
    // slice it into foursomes, keeping the sides alternating.
    matches.forEach(m => {
      const seq = matchSeq(m);
      for (let i = 0; i < seq.length; i += GROUP_TARGET) out.push(seq.slice(i, i + GROUP_TARGET));
    });
  }
  return out.filter(g => g.length);
}

// The first tee time with room for a match of `need` players, or -1 when the
// sheet is full. This is what makes the draw make itself: the groups already
// exist, so a new pairing goes off the first one that will hold it and the
// sheet packs from the first tee down without anyone assigning anything.
export const firstOpenGroup = ({ groups, need, target = GROUP_TARGET }) =>
  (groups || []).findIndex(g => g.length + need <= target);

// ── Lookups ────────────────────────────────────────────────────────
export const groupIndexForPlayer = (groups, pid) =>
  groups.findIndex(g => g.includes(pid));

// The one group a match rides in, or -1 when there is no single answer:
// nobody grouped yet, or the match spread over several groups (a team match
// legitimately, a small one by mistake).
export function groupIndexForMatch({ groups, match }) {
  const pids = matchPlayers(match);
  if (!pids.length) return -1;
  const idxs = new Set(pids.map(p => groupIndexForPlayer(groups, p)));
  if (idxs.size !== 1) return -1;
  const [i] = [...idxs];
  return i;
}

// The time a match goes off. A match whose players sit in one group has
// that group's time; one spread over several has none of its own (the
// group cards carry the times in that case), and an ungrouped match has
// nothing yet.
export function teeTimeForMatch({ groups, times, match }) {
  const i = groupIndexForMatch({ groups, match });
  return i < 0 ? "" : (times[i] || "");
}

// ── Assignment ─────────────────────────────────────────────────────
// Put a whole match in one group, in one move. Grouping is decided by the
// MATCH — "these two singles ride together off 8:40" — not player by
// player, so the match list is where it should be settled; lifting chips
// one at a time is the fallback for the odd case, not the main road.
//
// The match's players come out of wherever they were first, so this is also
// how a match MOVES between groups. `gi < 0` ungroups them. A gi past the end
// of the stored list opens the groups up to it, which is what happens the
// first time a match is sent off a later tee time — the round has that group
// already (the tee time is what makes it one); this document just hadn't had
// occasion to mention it yet.
export function assignMatchToGroup({ groups, match, gi }) {
  const seq = matchSeq(match);
  const moving = new Set(seq);
  const next = (groups || []).map(g => g.filter(p => !moving.has(p)));
  if (gi < 0) return next;
  while (next.length <= gi) next.push([]);
  next[gi] = [...next[gi], ...seq];
  return next;
}

// The matches riding in a group, in the order given. Lets a group card name
// what is actually playing in it rather than only who is sitting in it.
export const matchesInGroup = ({ group, matches }) =>
  (matches || []).filter(m => matchPlayers(m).some(p => group.includes(p)));

// Whether a group has room for `need` more players without going over a
// foursome. `firstOpenGroup` is the same question asked of the whole sheet.
export const groupHasRoom = ({ group, need, target = GROUP_TARGET }) =>
  (group?.length || 0) + need <= target;

// ── Dragging a match onto a tee time ───────────────────────────────
// A tee sheet has fixed capacity: four players go off at a time. So dropping
// a match on a FULL tee time cannot mean "add it" — a scramble foursome
// dropped on another foursome would make an eightsome, which is not a thing
// the starter can send off. It means the two are trading times.
//
// So this displaces whatever it has to. Matches are lifted out of the target
// in the order given until the dragged one fits, and each lands in the group
// the dragged match came from. For every 2-man format that is a clean 1-for-1
// swap of two foursomes; in Singles, where a group holds two matches, it
// swaps the dragged match with as many as it needs (one, normally) and leaves
// the rest of both groups alone.
//
// Requires a source group to displace INTO, so the caller must not offer this
// for an ungrouped match — there is nowhere for the occupants to go, and
// silently ungrouping them to make space would be a worse surprise than the
// eightsome this exists to prevent.
export function swapMatchIntoGroup({ groups, match, gi, matches, target = GROUP_TARGET }) {
  const from = groupIndexForMatch({ groups, match });
  const seq = matchSeq(match);
  if (from < 0 || gi < 0 || from === gi) {
    return { groups: assignMatchToGroup({ groups, match, gi }), displaced: [] };
  }

  const next = (groups || []).map(g => [...g]);
  while (next.length <= gi) next.push([]);
  const moving = new Set(seq);
  for (let i = 0; i < next.length; i++) next[i] = next[i].filter(p => !moving.has(p));

  // Read the occupants off the ORIGINAL groups: `next` is already mid-edit.
  const occupants = (matches || []).filter(m =>
    m.id !== match.id && groupIndexForMatch({ groups, match: m }) === gi);

  const displaced = [];
  for (const occ of occupants) {
    if (groupHasRoom({ group: next[gi], need: seq.length, target })) break;
    const out = new Set(matchSeq(occ));
    next[gi] = next[gi].filter(p => !out.has(p));
    displaced.push(occ);
  }

  next[gi] = [...next[gi], ...seq];
  displaced.forEach(occ => { next[from] = [...next[from], ...matchSeq(occ)]; });
  return { groups: next, displaced };
}

// ── Play order ─────────────────────────────────────────────────────
// Matches in a stable, device-independent order — by document id, which is
// the order Firestore hands them back in anyway when a query names no sort.
// Anything ORDER-DEPENDENT derived from a round's matches starts here,
// because that derivation runs on every phone at once: derived groups follow
// the match order, tee times follow the groups, and match numbers follow the
// tee times, so a client that received the documents in some other order
// would otherwise number the same draw differently from everyone else.
export const canonicalMatchOrder = (matches) =>
  [...(matches || [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));

// The groups and tee times a round actually plays off, resolved the one way
// every surface resolves them: the groups the director saved, or the
// foursomes a 2-man format implies, timed off the round's tee-time list.
// `minSlots` is how many time boxes the caller wants back regardless of the
// group count (the admin tab always draws four).
export function roundPlaySetup({ tr, matches, storedGroups, minSlots = 1 }) {
  const groups = storedGroups || (isFoursomeFormat(tr?.format)
    ? autoBuildGroups({ formatId: tr?.format, matches: canonicalMatchOrder(matches) })
    : []);
  const times = expandTeeTimes(teeTimeList(tr), Math.max(groups.length, minSlots));
  return { groups, times };
}

// One round's matches in the order they go off: by tee time, anything
// untimed last, and the match id as the final tiebreak so every device
// agrees on the order no matter what sequence Firestore delivered the
// documents in.
//
// Pass the round's matches as they arrive, never this function's own output:
// derived groups follow the match order and tee times follow the groups, so
// feeding a tee-time sort back into that chain would let the order chase its
// own tail.
export function orderMatchesForRound({ matches, groups = [], times = [] }) {
  const at = (m) => parseTeeTime(teeTimeForMatch({ groups, times, match: m }));
  return [...(matches || [])].sort((a, b) => {
    const ta = at(a), tb = at(b);
    if (ta !== tb) {
      if (ta == null) return 1;
      if (tb == null) return -1;
      return ta - tb;
    }
    return String(a.id).localeCompare(String(b.id));
  });
}

// ── Match numbers ──────────────────────────────────────────────────
// Every match carries ONE number and the numbers run straight through the
// schedule: Round 1's first match is Match 1, and each match after it is
// the match before it plus one. Four matches in Round 1 therefore makes
// Round 2's first match Match 5 — nothing restarts per round, so "Match 5"
// names exactly one match of the week rather than one per round.
//
// Derived on read, never written to the match document. A deleted match
// closes the gap it leaves behind and a retimed one takes its new place in
// the order, neither of which a number stamped on at creation time could
// do. Returns { [matchId]: number }.
export function numberMatches({ matches, tRounds, groupsByRound }) {
  // A match with no round still gets a number: it sorts to the end rather
  // than falling out of the count.
  const byRound = new Map();
  (matches || []).forEach(m => {
    const key = m.round == null ? Infinity : m.round;
    if (!byRound.has(key)) byRound.set(key, []);
    byRound.get(key).push(m);
  });

  const out = {};
  let n = 0;
  [...byRound.keys()].sort((a, b) => a - b).forEach(rnd => {
    const rndMatches = byRound.get(rnd);
    const tr = (tRounds || []).find(t => t.round_number === rnd);
    const { groups, times } = roundPlaySetup({
      tr, matches: rndMatches, storedGroups: groupsByRound?.[rnd],
    });
    orderMatchesForRound({ matches: rndMatches, groups, times })
      .forEach(m => { out[m.id] = ++n; });
  });
  return out;
}

// Which side of the round's draw each player is on. Read off the matches
// rather than the roster, because that is what the draw itself says — a
// player the director moved between teams after the match was built is on
// the side the match has him on, and it is the match that will be scored.
export function sidesInRound(matches) {
  const side = new Map();
  (matches || []).forEach(m => {
    (m?.teamA || []).forEach(pid => side.set(pid, "A"));
    (m?.teamB || []).forEach(pid => side.set(pid, "B"));
  });
  return side;
}

// ── Validation ─────────────────────────────────────────────────────
// Everything the director needs told about a round's grouping. Each entry
// is a plain list so the caller can render whichever ones it cares about.
//
// `formatId` is optional and only widens the checks: a format whose foursomes
// are teammates (Team Best Ball) also wants to hear about a group holding both
// sides, which for every other format is exactly how a group is supposed to
// look.
export function groupIssues({ groups, matches, formatId }) {
  const seen = new Map();          // pid → times assigned
  groups.forEach(g => g.forEach(pid => seen.set(pid, (seen.get(pid) || 0) + 1)));

  const inMatches = new Set(matches.flatMap(matchPlayers));
  const side = sidesInRound(matches);

  return {
    // A group with both sides in it, in a format that plays its foursomes as
    // teammates. Silent everywhere else — a 2v2 foursome is two of each by
    // definition — so this list is empty unless the format asks for it.
    mixed: formatGroupsByTeam(formatId)
      ? groups
        .map((g, i) => ({ i, sides: new Set(g.map(pid => side.get(pid)).filter(Boolean)) }))
        .filter(({ sides }) => sides.size > 1)
        .map(({ i }) => i)
      : [],
    // A player who has a match but no tee time.
    unassigned: [...inMatches].filter(pid => !seen.has(pid)),
    // The same player in two groups — they can only tee off once.
    duplicated: [...seen.entries()].filter(([, n]) => n > 1).map(([pid]) => pid),
    // In a group but not playing a match this round.
    unmatched: [...seen.keys()].filter(pid => !inMatches.has(pid)),
    // A match small enough to ride together that has been split up.
    // Opponents have to be in the same group to play each other.
    split: matches.filter(m => {
      const pids = matchPlayers(m);
      if (!pids.length || pids.length > GROUP_TARGET) return false;
      const idxs = new Set(pids.map(p => groupIndexForPlayer(groups, p)));
      return idxs.size > 1 && ![...idxs].every(i => i < 0);
    }),
    // More players than will go off together.
    oversized: groups.map((g, i) => ({ i, n: g.length })).filter(g => g.n > GROUP_MAX),
  };
}

export const hasGroupIssues = (issues) =>
  !!(issues.unassigned.length || issues.duplicated.length || issues.unmatched.length
     || issues.split.length || issues.oversized.length || issues.mixed?.length);
