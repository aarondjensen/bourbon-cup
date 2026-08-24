// ══════════════════════════════════════════════════════════════════
//  impliedMatches — the match a format leaves nothing to decide about.
// ══════════════════════════════════════════════════════════════════
//
// Most formats need a director: who partners whom, who plays whom. Team Best
// Ball does not. Its match is the whole of one side against the whole of the
// other, every time, and there is no arrangement of the field that would make
// it anything else. Asking somebody to select sixteen names to say so is data
// entry with exactly one possible answer.
//
// So it is DERIVED, not built — the same shape lib/groups already uses for a
// 2-man format's foursomes, where `roundPlaySetup` falls back to
// `autoBuildGroups` rather than making a director materialize the obvious.
//
// ── Why derived rather than written once ───────────────────────────
// A stored copy is a second answer to a question the roster already answers,
// and it goes stale silently. Add a seventeenth man in Admin → Players and a
// stored round-4 match still holds sixteen: he appears on the roster, on the
// leaderboard and on a tee time, and contributes nothing to the round the cup
// is decided in. Nothing on screen would say so — the match card would look
// exactly as it always has. Derived, he is in it the moment he is on the
// roster.
//
// ── What it is NOT ─────────────────────────────────────────────────
// Not a default a director then edits. A stored match for the round always
// wins (see withImpliedMatches), so a hand-built round-4 draw from an earlier
// edition keeps working untouched, and the derivation only fills a vacuum.

import { editionDocId, TOURNAMENT_ID } from "../firebase";
import { FORMATS } from "../constants";

// Whether the format's match is the whole side against the whole side. See
// the note on `teamVsTeam` in constants.js.
export const formatTeamVsTeam = (formatId) =>
  !!FORMATS.find(f => f.id === formatId)?.teamVsTeam;

// A deterministic id, built from the round alone.
//
// Deliberately NOT derived from the roster, the way a hand-built match's id
// is (`bc_match_r4_a1_a2_vs_b1_b2`): a signed scorecard stores the match id it
// was signed against (cardSigs.match_id), so an id that moved when somebody
// joined the roster would orphan every signature on the round. The round
// number is the only thing about this match that cannot change.
export const impliedMatchId = (round) => editionDocId(`bc_match_r${round}_teams`);

// Every player on a side, in a device-independent order.
//
// Sorted by player_id rather than left in Firestore's arrival order, for the
// same reason canonicalMatchOrder exists: Auto-build splits a side into waves
// IN THIS ORDER, so two phones handed the roster in different sequences would
// otherwise draw two different tee sheets from the same data.
//
// The borrowed ball is deliberately KEPT (no realPlayers filter). It is not a
// person and no roster screen shows it, but Team Best Ball counts the best N
// nets on a side — and a side of seven against a side of eight is not the
// round that was played. See isBorrowedBall in lib/players.
const sideOf = (tPlayers, team) => (tPlayers || [])
  .filter(p => p?.team === team && p?.player_id)
  .map(p => p.player_id)
  .sort((a, b) => String(a).localeCompare(String(b)));

// The match a round implies, or null when the format does not imply one or
// there is nobody to play it. A side with no players means no match rather
// than a one-sided one — an edition whose roster has not been entered yet
// should show an empty round, not a match against nobody.
export function impliedMatchForRound({ tr, tPlayers }) {
  if (!tr || !formatTeamVsTeam(tr.format)) return null;
  const teamA = sideOf(tPlayers, "A");
  const teamB = sideOf(tPlayers, "B");
  if (!teamA.length || !teamB.length) return null;
  return {
    id: impliedMatchId(tr.round_number),
    tournament_id: TOURNAMENT_ID,
    round: tr.round_number,
    teamA,
    teamB,
    // No teamANames/teamBNames. Those exist on a stored match as the record of
    // who was drawn under a name since corrected (see sideNames in
    // lib/players); a derived match reads the roster on every render, so there
    // is no earlier state for them to preserve.
    //
    // The flag every consumer checks before offering to change this match.
    // There is no document behind it — a delete would remove nothing and the
    // match would be back on the next render.
    implied: true,
  };
}

// The round's matches, plus the one its format implies when it has none.
//
// A stored match ALWAYS wins, and wins for the whole round: a director who has
// drawn round 4 by hand — or an imported year that carries its own documents —
// is left completely alone. This only ever fills a round that has nothing.
export function withImpliedMatches({ matches, tRounds, tPlayers }) {
  const drawn = new Set((matches || []).map(m => m?.round));
  const extra = (tRounds || [])
    .filter(tr => !drawn.has(tr?.round_number))
    .map(tr => impliedMatchForRound({ tr, tPlayers }))
    .filter(Boolean);
  return extra.length ? [...(matches || []), ...extra] : (matches || []);
}

// Whether this match is one the app derived. Read off the flag rather than by
// re-deriving and comparing, so a screen can never disagree with the object it
// was handed.
export const isImpliedMatch = (m) => !!m?.implied;
