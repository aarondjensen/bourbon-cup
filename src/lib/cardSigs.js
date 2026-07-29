// ══════════════════════════════════════════════════════════════════
//  cardSigs — who signed the card, and who attested it.
// ══════════════════════════════════════════════════════════════════
//
// Ported from the MnQ golf league app, which has run this workflow for a
// season. The shape is deliberately the same one — one document per card,
// carrying a single signer and a growing list of attesters — because the
// thing it is modelling is the same: a scorecard is not finished when the
// last number is typed, it is finished when a second player agrees the
// numbers are right.
//
//   SIGNING is one player saying "this card is complete and correct."
//   ATTESTING is every OTHER player in the match saying the same.
//
// Until a card is signed it is a draft: anyone in the match can type into
// it. The moment it is signed the scores lock — for the players, not for
// the director — and the only remaining moves are attest, or unsign and go
// back to editing. When the last non-signer attests, the card is FINAL and
// nothing but a director edit moves it again.
//
// WHY A SEPARATE COLLECTION AND NOT A FLAG ON THE SCORES
// ------------------------------------------------------
// Scores are keyed player+round+hole (see lib/scoreGuard) — eighteen
// documents per player, and a signature is not a property of any one of
// them. It is a property of the CARD: one match, one round, four players.
// So it gets its own document, keyed the same way a match is, and the
// scores underneath are untouched by any of this. That also means a
// signature survives everything a score survives: re-draw the same pairing
// and the card comes back with its signature intact.
//
// A NOTE ON WHAT THIS IS NOT
// --------------------------
// It is not access control. The Firestore rules are open (see
// firestore.rules) and the app has no sign-in, so "Nate attested this" means
// "somebody using Nate's phone tapped Attest". That is exactly what a paper
// card's signature means too. The value is the ritual and the record, not
// cryptography — do not build anything on this that needs it to be proof.
//
// Everything here is pure. `holeData` is the in-memory map App.jsx already
// subscribes to (holeData[`${pid}_${round}`][holeIdx] = gross), and
// `cardSigs` is the array of signature documents from bc_card_sigs.

import { matchPlayers } from "./groups";
import { holesEntered } from "./scoreGuard";

// One card per match. The match id already encodes the round, but the round
// goes in the id too so a human reading the Firestore console can see which
// round a stray document belongs to without cross-referencing.
export const cardSigBareId = (round, matchId) => `bc_sig_r${round}_${matchId}`;

// The signature document for one match, or null. Matched on match_id rather
// than on the document id so it keeps working for a namespaced edition
// (editionDocId rewrites ids; it does not rewrite fields).
export const sigForMatch = (cardSigs, matchId) =>
  (cardSigs || []).find(s => s.match_id === matchId) || null;

// ── Completeness ────────────────────────────────────────────────────
// A card can only be signed when every player in the match has all 18.
// This is stricter than the round-level progress in scoreGuard, and on
// purpose: that one asks "is the ROUND done", this one asks "is THIS card
// signable", and a player should not be blocked from signing their own
// finished card because another group is still on 14.
export const cardComplete = (match, holeData) => {
  const pids = matchPlayers(match);
  if (!pids.length || match?.round == null) return false;
  return pids.every(pid => holesEntered(holeData, pid, match.round) >= 18);
};

// Which holes each player is missing, for the "can't sign yet" strip.
// [{ pid, holes: [3, 7, 12] }] — 1-based hole numbers, because that is what
// the strip prints and what a player standing on the tee calls them.
//
// ── Missing means SKIPPED, not "not yet reached" ──────────────────────
// A hole nobody in the match has posted is a hole the group has not played,
// and a group standing on the 10th tee is not missing nine scores — it is
// nine holes into its round. Counting those made the note permanent for the
// whole round and loudest at the first tee, when it has nothing to say; it
// also meant the one thing it exists to catch, a hole where three players
// are in and the fourth was skipped, arrived buried in eight holes of
// noise. So the window is the holes the match has actually played: any hole
// where SOMEBODY has a score. Within that window a blank is a real gap.
//
// A player who has posted nothing at all still shows every played hole,
// which is right — they are either still out there or have been missed, and
// both are worth naming. MnQ excludes that case because a league night has
// an "absent / making up" concept; a Bourbon Cup round has no such thing.
//
// This is deliberately NOT how `cardComplete` above decides: signing still
// requires all 18. The note answers "what is stopping me signing RIGHT NOW
// that I could go fix", and an unplayed hole is not that.
export const missingForCard = (match, holeData) => {
  if (match?.round == null) return [];
  const pids = matchPlayers(match);
  const scoreAt = (pid, h) => holeData?.[`${pid}_${match.round}`]?.[h];
  const played = [];
  for (let h = 0; h < 18; h++) if (pids.some(pid => scoreAt(pid, h) > 0)) played.push(h);
  return pids
    .map(pid => ({ pid, holes: played.filter(h => !(scoreAt(pid, h) > 0)).map(h => h + 1) }))
    .filter(m => m.holes.length > 0);
};

// ── Signature state ─────────────────────────────────────────────────
// Everyone in the match except whoever signed it. These are the players
// the card is waiting on.
export const nonSignerPids = (match, sig) =>
  matchPlayers(match).filter(pid => pid !== sig?.signed_by);

// A card is fully attested when every non-signer has attested. The
// degenerate case — a match somehow containing only the signer — counts as
// attested rather than hanging forever on an empty list, which mirrors
// MnQ's autoAttest branch at signing time.
export const isFullyAttested = (match, sig) => {
  if (!sig) return false;
  const pending = nonSignerPids(match, sig);
  const attested = sig.attested_by || [];
  return pending.length === 0 || pending.every(pid => attested.includes(pid));
};

// Three states, named once so the UI never re-derives them inconsistently:
// "open" (no signature), "signed" (signed, waiting on attesters), "final".
export const cardState = (match, sig) =>
  !sig ? "open" : isFullyAttested(match, sig) ? "final" : "signed";

// ── Round-level progress ────────────────────────────────────────────
// What the director's finalize gate reads. Counts EVERY match in the round,
// which is the same population roundScoreProgress counts over — the two are
// meant to be read side by side in the finalize sheet.
//
// `complete` is the whole round attested, and is what promotes the
// ready-to-finalize notification. A round with no matches drawn is not
// complete, for the same reason an empty round is not a finished one there.
export function roundCardProgress(matches, cardSigs, round) {
  const rnd = round == null ? [] : (matches || []).filter(m => m.round === round);
  let signed = 0, attested = 0;
  const unsigned = [], awaiting = [];
  rnd.forEach(m => {
    const sig = sigForMatch(cardSigs, m.id);
    if (!sig) { unsigned.push(m); return; }
    signed++;
    if (isFullyAttested(m, sig)) attested++;
    else awaiting.push({
      match: m,
      pending: nonSignerPids(m, sig).filter(pid => !(sig.attested_by || []).includes(pid)),
    });
  });
  return {
    total: rnd.length,
    signed, attested,
    unsigned,   // matches with no signature at all
    awaiting,   // signed matches, with who they are waiting on
    complete: rnd.length > 0 && attested === rnd.length,
  };
}

// The cards this player personally owes an attestation on, out of whatever
// matches it is given. Drives the app badge — a player who walked off
// without attesting should carry the count wherever they are, not only on
// the screen showing that match.
//
// Callers pass the matches they consider ACTIONABLE (App scopes it to the
// current round), because a badge counting something the app has no button
// for is a badge that never clears.
export function pendingAttestations(matches, cardSigs, pid) {
  if (!pid) return [];
  return (matches || []).filter(m => {
    if (!matchPlayers(m).includes(pid)) return false;
    const sig = sigForMatch(cardSigs, m.id);
    if (!sig || sig.signed_by === pid) return false;
    return !(sig.attested_by || []).includes(pid) && !isFullyAttested(m, sig);
  });
}
