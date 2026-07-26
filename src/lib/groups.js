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
//                    single match spans as many foursomes as it takes.
// In both cases the pairing is a judgement call (who plays with whom, who
// goes off first) that only the director can make. Hence this module.
//
// ── Storage ────────────────────────────────────────────────────────
// One document per round in `bc_groups`, following the same shape as the
// other per-round documents (bc_hcp_overrides, bc_tee_assignments):
//
//   { id, tournament_id, round_number, groups: [ ["a1","b1","a2","b2"], … ] }
//
// A group is just its ordered player ids. Tee times are deliberately NOT
// stored here — they already live on the round document as `tee_time`, a
// pipe-delimited list ("8:30|8:40|8:50") that the Rounds tab has always
// written. Group i goes off at time i. Keeping one source of truth means
// the Rounds tab and the Matches tab can both edit tee times without
// either one being able to contradict the other.

import { editionDocId } from "../firebase";
import { FORMATS } from "../constants";

export const GROUPS_COL = "bc_groups";
export const groupsDocId = (round) => editionDocId(`bc_groups_r${round}`);

// A foursome is the target; a fivesome is tolerated (courses allow them,
// and an odd roster sometimes forces one). Past that it isn't a group.
export const GROUP_TARGET = 4;
export const GROUP_MAX = 5;

// Minutes between consecutive groups when the round setup doesn't imply
// one. Matches the spread the Rounds tab has always auto-filled.
export const DEFAULT_TEE_INTERVAL = 10;

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

// ── Format shape ───────────────────────────────────────────────────
export const matchPlayers = (m) => [...(m?.teamA || []), ...(m?.teamB || [])];
export const formatPerSide = (formatId) => FORMATS.find(f => f.id === formatId)?.perSide ?? null;

// True when one match is exactly one foursome, so grouping is automatic
// and the director never has to think about it.
export const isFoursomeFormat = (formatId) => formatPerSide(formatId) === 2;

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
    matches.forEach(m => out.push(interleave(m.teamA, m.teamB)));
  } else if (perSide === 1) {
    // Singles: two matches ride together.
    for (let i = 0; i < matches.length; i += 2) {
      out.push(matches.slice(i, i + 2).flatMap(m => interleave(m.teamA, m.teamB)));
    }
  } else {
    // Team / variable-size formats: one match can hold the whole field, so
    // slice it into foursomes, keeping the sides alternating.
    matches.forEach(m => {
      const seq = interleave(m.teamA, m.teamB);
      for (let i = 0; i < seq.length; i += GROUP_TARGET) out.push(seq.slice(i, i + GROUP_TARGET));
    });
  }
  return out.filter(g => g.length);
}

// ── Lookups ────────────────────────────────────────────────────────
export const groupIndexForPlayer = (groups, pid) =>
  groups.findIndex(g => g.includes(pid));

// The time a match goes off. A match whose players sit in one group has
// that group's time; one spread over several has none of its own (the
// group cards carry the times in that case), and an ungrouped match has
// nothing yet.
export function teeTimeForMatch({ groups, times, match }) {
  const pids = matchPlayers(match);
  if (!pids.length) return "";
  const idxs = new Set(pids.map(p => groupIndexForPlayer(groups, p)));
  if (idxs.size !== 1) return "";
  const [i] = [...idxs];
  return i < 0 ? "" : (times[i] || "");
}

// ── Validation ─────────────────────────────────────────────────────
// Everything the director needs told about a round's grouping. Each entry
// is a plain list so the caller can render whichever ones it cares about.
export function groupIssues({ groups, matches }) {
  const seen = new Map();          // pid → times assigned
  groups.forEach(g => g.forEach(pid => seen.set(pid, (seen.get(pid) || 0) + 1)));

  const inMatches = new Set(matches.flatMap(matchPlayers));

  return {
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
     || issues.split.length || issues.oversized.length);
