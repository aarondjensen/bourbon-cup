// ══════════════════════════════════════════════════════════════════
//  scoreGuard — what a destructive draw edit would take with it.
// ══════════════════════════════════════════════════════════════════
//
// Scores are keyed by PLAYER + ROUND + HOLE (`bc_hs_r1_<pid>_h7`), never by
// match. That is deliberate — a card belongs to the player who shot it, and
// it should survive being re-paired — but it has a consequence the admin
// console has to say out loud:
//
//   A MATCH DOCUMENT IS ONLY A VIEW ONTO SCORES ITS PLAYERS ALREADY POSTED.
//
// Delete the match and the scores do not go anywhere. They stop being
// displayed — no leaderboard row, no card on the Scoring tab, nothing in the
// round's progress count — while every one of them is still sitting in
// Firestore. Draw the SAME pairing again and they all come back, which is
// usually the mercy you wanted. Draw a DIFFERENT pairing into that round and
// they come back too, attached to whoever now occupies the slot, with
// nothing on screen to say they are yesterday's holes.
//
// So every control that changes who is in a round's draw asks this module
// what is behind the change first, and the answer goes in front of the
// director BEFORE the tap, not in a toast afterwards.
//
// Everything here is pure and reads the in-memory `holeData` map the app
// already subscribes to: holeData[`${pid}_${round}`][holeIdx] = gross.
// A cleared score writes a 0 rather than removing the document, so "has a
// score" is `> 0` everywhere — the same test roundScoreProgress uses, so
// these counts and the finalize card's can never disagree.

import { matchPlayers } from "./groups";

// How many holes this player has actually posted in this round.
export const holesEntered = (holeData, pid, round) =>
  Object.values(holeData?.[`${pid}_${round}`] || {}).filter(s => s > 0).length;

// [{ pid, holes }] for the given players, heaviest card first, silent players
// dropped. The order matters: when this list is read out in a confirmation
// it should open with the player who has the most to lose.
export const scoredAmong = (holeData, round, pids) =>
  [...new Set(pids || [])]
    .map(pid => ({ pid, holes: holesEntered(holeData, pid, round) }))
    .filter(p => p.holes > 0)
    .sort((a, b) => b.holes - a.holes);

// What deleting this match would hide. `holes` is the total across the
// match, which is the number worth leading a warning with — four players
// eight holes deep is "32 holes", and that reads as the morning it was.
export function matchScoreImpact({ match, holeData }) {
  const scored = scoredAmong(holeData, match?.round, matchPlayers(match));
  return {
    scored,
    holes: scored.reduce((n, p) => n + p.holes, 0),
    hasScores: scored.length > 0,
  };
}

// Players carrying scores in a round that no match in that round accounts
// for. This is the wreckage of a delete that has already happened: the
// scores are live in the database and invisible in every view. Surfacing
// them is the difference between "the draw is empty" and "the draw is empty
// and there are 54 holes underneath it".
export function orphanedScores({ holeData, matches, round, players }) {
  const inMatches = new Set(
    (matches || []).filter(m => m.round === round).flatMap(matchPlayers)
  );
  return scoredAmong(
    holeData, round,
    (players || []).map(p => p.player_id).filter(pid => !inMatches.has(pid))
  );
}

// The mirror hazard: these players are about to be put INTO a match in a
// round where they already have holes posted. Whatever the new pairing is,
// it inherits those holes the moment it saves.
export const incomingScores = ({ holeData, round, pids }) =>
  scoredAmong(holeData, round, pids);

// Render helper — "Aaron (12), Dave (7)" or "Aaron (12) …and 3 more".
export function describeScored(scored, nameOf, max = 4) {
  const head = scored.slice(0, max).map(({ pid, holes }) => `${nameOf(pid)} (${holes})`);
  const rest = scored.length - head.length;
  return head.join(", ") + (rest > 0 ? `, +${rest} more` : "");
}

export const totalHoles = (scored) => scored.reduce((n, p) => n + p.holes, 0);
