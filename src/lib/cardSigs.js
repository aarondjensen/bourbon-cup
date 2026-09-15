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

import { matchPlayers, formatGroupsByTeam, scoringUnits } from "./groups";
import { groupKey, groupLabel } from "./ctp";
import { holesEntered } from "./scoreGuard";

// ══════════════════════════════════════════════════════════════════
//  What a CARD is
// ══════════════════════════════════════════════════════════════════
//
// Everything below used to take a MATCH, because on every format but one a
// card IS the match: four men, one card, and the people who sign it are the
// people in it.
//
// Team Best Ball breaks that and it broke this. Its match is the WHOLE SIDE
// — eight men across four tee times — so "every player in the match has all
// eighteen" was asking about two waves on a different tee, and the "can't
// sign yet" note named men this foursome never saw. The round was therefore
// given no sign-off ritual at all, which is the wrong end of the stick: the
// four men who walked together kept a card between them exactly like every
// other foursome in the tournament, and they are the four who can swear to
// it. The eight-a-side MATCH is a thing the ENGINE computes; it is not a
// thing anybody signs.
//
// So a card is its own object — `{ id, round, pids, matchId, label }` — and
// the match is only where it comes from.
//
//   every other format   one card, the match
//   Team Best Ball       one card per TEE WAVE
//
// ── Why the wave's id is its players and not its slot ──────────────
// `${match.id}#3` would follow the SLOT: rebuild the tee sheet and the
// signature that belonged to the 8:20 wave lands on whoever is in slot three
// now — four men shown a card they never signed, as signed. Keyed by the
// men, a director who moves somebody between waves orphans the signature
// instead, and the card reads unsigned. One of those fails wrong and the
// other fails safe.
//
// `groupKey` is lib/ctp's, and it is the same question that module asks of
// the same thing — which tee group is this — so the two cannot answer it
// differently.
export const matchCard = (match) => ({
  id: match.id,
  round: match.round,
  matchId: match.id,
  pids: matchPlayers(match),
  label: `Match ${match.matchNumber ?? "?"}`,
});

export const waveCard = (match, pids, groupIdx = null) => ({
  id: `${match.id}#${groupKey(pids)}`,
  round: match.round,
  matchId: match.id,
  pids: (pids || []).filter(Boolean),
  label: groupLabel(groupIdx),
});

// Every card in a match. Through `scoringUnits`, so the cards a round is
// signed in are exactly the groups the Scoring tab draws it in — a wave that
// appears on one phone and not in the finalize gate's count is how a round
// sits one card short with nobody able to say which.
//
// An undrawn team round has one unit holding all sixteen, so it has one card.
// That is the old behaviour and the safe one: there are no waves to sign yet.
export const cardsForMatch = ({ match, groups, formatId }) => {
  if (!match) return [];
  if (!formatGroupsByTeam(formatId)) return [matchCard(match)];
  return scoringUnits({ match, groups, formatId })
    .map(u => waveCard(match, u.pids, u.groupIdx));
};

// Every card in a round, for the gate that counts them all.
export const cardsForRound = ({ matches, round, groups, formatId }) =>
  (matches || [])
    .filter(m => m.round === round)
    .flatMap(match => cardsForMatch({ match, groups, formatId }));

// The round goes in the document id as well as the card's own key, so a human
// reading the Firestore console can see which round a stray document belongs
// to without cross-referencing.
export const cardSigBareId = (round, cardId) => `bc_sig_r${round}_${cardId}`;

// The signature document for one card, or null. Matched on a FIELD rather
// than on the document id so it keeps working for a namespaced edition
// (editionDocId rewrites ids; it does not rewrite fields).
//
// `match_id` is the fallback, and it is what every signature written before
// cards existed carries. On every format but Team Best Ball a card's id IS
// its match id, so those documents go on resolving untouched; Team Best Ball
// has none to resolve, because it could not be signed at all.
export const sigForCard = (cardSigs, card) => {
  if (!card) return null;
  return (cardSigs || []).find(s => (
    s.card_id ? s.card_id === card.id : s.match_id === card.id
  )) || null;
};

// ── Completeness ────────────────────────────────────────────────────
// A card can only be signed when every player in the match has all 18.
// This is stricter than the round-level progress in scoreGuard, and on
// purpose: that one asks "is the ROUND done", this one asks "is THIS card
// signable", and a player should not be blocked from signing their own
// finished card because another group is still on 14.
// ── Withdrawals ──────────────────────────────────────────────────────
// A man who walks in after nine leaves holes that will never be filled. The
// app already let a director finalize over that, behind a confirm naming who
// is out — but nothing could RECORD it, so his three partners were left with
// a card that could never be signed and a "can't sign yet" strip that was
// permanently right and permanently useless.
//
// So a withdrawal is a flag on the roster row (`withdrawn`), and the two
// completeness questions below skip him. Nothing else changes: his holes
// still count exactly as they did, the leaderboard still reads them, and the
// match still scores off whoever has scores. This does NOT fill his card with
// a sentinel the way WBC does — WBC's rounds are individual boards where an
// unplayed hole has to be worth something, and these are matches, where
// inventing eighteen scores for a man who drove home would move a result the
// field never played for.
//
// `withdrawnPids` is passed in rather than read off the match, because a match
// document holds ids and the flag lives on the roster. Every caller that has
// the roster can supply it; one that does not gets the old behaviour, which is
// correct for a tournament where nobody has withdrawn.
const notWithdrawn = (pids, withdrawnPids) => {
  const out = withdrawnPids instanceof Set ? withdrawnPids : new Set(withdrawnPids || []);
  return pids.filter(pid => !out.has(pid));
};

// Everybody on the card still expected to post scores.
export const activePids = (card, withdrawnPids) =>
  notWithdrawn(card?.pids || [], withdrawnPids);

// The roster's withdrawn ids, as a Set. One place, so a screen cannot ask the
// question a slightly different way.
export const withdrawnIds = (players) =>
  new Set((players || []).filter(p => p?.withdrawn === true).map(p => p.player_id));

export const cardComplete = (card, holeData, withdrawnPids) => {
  const pids = activePids(card, withdrawnPids);
  if (!pids.length || card?.round == null) return false;
  return pids.every(pid => holesEntered(holeData, pid, card.round) >= 18);
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
// noise. So a hole only counts once SOMEBODY has a score on it.
//
// ── And not the hole they are standing on either ──────────────────────
// That alone is not enough, and it is why this note still fired on the
// first tee: the moment the first of four players is entered, the hole he
// was entered on has "somebody with a score", so the other three are
// instantly missing it. The scorer is told the card cannot be signed while
// he is still tapping in the group he is standing with.
//
// So the window stops SHORT of the furthest hole anybody has touched. That
// hole is the one in progress, by definition — it is where the group is —
// and a blank on it is a score not yet typed, not a gap. Everything before
// it is behind them, and a blank there is somebody who got skipped.
//
// The two conditions are both load-bearing. Dropping the first would flag
// holes the group has not reached at all, which on a shotgun start is most
// of the card for most of the round; dropping the second is the bug above.
//
// A player who has posted nothing at all still shows every hole in that
// window, which is right — they are either still out there or have been
// missed, and both are worth naming. MnQ excludes that case because a
// league night has an "absent / making up" concept; a Bourbon Cup round has
// no such thing.
//
// This is deliberately NOT how `cardComplete` above decides: signing still
// requires all 18. The note answers "what is stopping me signing RIGHT NOW
// that I could go fix", and neither an unplayed hole nor the one being
// played is that.
export const missingForCard = (card, holeData, withdrawnPids) => {
  if (card?.round == null) return [];
  // The frontier is still read off EVERYBODY who has a score, a withdrawn man
  // included: his holes are real and they say where the group got to. He is
  // only dropped from who is expected to fill the gaps.
  const all = card.pids || [];
  const pids = notWithdrawn(all, withdrawnPids);
  const scoreAt = (pid, h) => holeData?.[`${pid}_${card.round}`]?.[h];
  const touched = [];
  for (let h = 0; h < 18; h++) if (all.some(pid => scoreAt(pid, h) > 0)) touched.push(h);
  const frontier = touched.length ? touched[touched.length - 1] : -1;
  // ── Every hole the group has walked past, not just the scored ones ──
  // This used to be `touched.filter(h => h < frontier)`, which can only ever
  // report a hole SOMEBODY has a score on — so the one case it could not see
  // was a hole the WHOLE group skipped. Nobody scored it, so it never entered
  // `touched`, so it was missing for nobody, and the strip stayed silent while
  // the group played on past it. The engine skips an unscored hole too, so the
  // match status went on being computed around a hole nobody had played and
  // nothing on the screen said so.
  //
  // The window is the group's FIRST scored hole to its frontier, and both ends
  // matter. The frontier is what has always decided "behind": a hole ahead of
  // the group is not missing, and the one they are standing on is excluded by
  // `h < frontier`. The first end is what keeps a SHOTGUN start quiet — a
  // group that went off the 5th has four blank holes at the front of its card
  // that it has not reached yet, and they are not gaps just because holes
  // above them are filled.
  const played = touched.length
    ? Array.from({ length: frontier - touched[0] }, (_, i) => touched[0] + i)
    : [];
  return pids
    .map(pid => ({ pid, holes: played.filter(h => !(scoreAt(pid, h) > 0)).map(h => h + 1) }))
    .filter(m => m.holes.length > 0);
};

// ── The holes NOBODY played ─────────────────────────────────────────
// A subset of what `missingForCard` reports, and a different sentence. One
// player missing the 7th is a card to chase; the whole group missing the 11th
// is a hole that was never played, and the match status on screen was computed
// without it — the front nine, the back nine and the overall are all provisional
// until it is filled. That is worth saying in those words rather than as four
// men each missing the same hole.
export const skippedHoles = (card, holeData, withdrawnPids) => {
  if (card?.round == null) return [];
  const all = card.pids || [];
  const pids = notWithdrawn(all, withdrawnPids);
  if (!pids.length) return [];
  const scoreAt = (pid, h) => holeData?.[`${pid}_${card.round}`]?.[h];
  const touched = [];
  for (let h = 0; h < 18; h++) if (all.some(pid => scoreAt(pid, h) > 0)) touched.push(h);
  const frontier = touched.length ? touched[touched.length - 1] : -1;
  // Between the group's first scored hole and its frontier, for the reasons
  // missingForCard gives: a shotgun group's blank front is holes it has not
  // reached, and the hole it is standing on is not a gap either.
  const out = [];
  if (!touched.length) return out;
  for (let h = touched[0]; h < frontier; h++) {
    if (!all.some(pid => scoreAt(pid, h) > 0)) out.push(h + 1);
  }
  return out;
};

// ── Who has attested ────────────────────────────────────────────────
// An attestation used to be an append to the `attested_by` ARRAY: read the
// current list, add yourself, write the whole thing back. That converges on
// one device and loses on two — both phones compute `[...seen, me]` from the
// same snapshot and the second write lands on top, so one man's attestation
// disappears and the card sits one short forever while he watched it register.
//
// So an attestation is now its own key in the `attests` MAP. `db.upsert` is
// `setDoc(…, { merge: true })`, which merges a map key by key, and two phones
// writing two different keys cannot erase each other. Same reasoning as the
// CTP claims map in lib/ctp, and the same shape.
//
// Both are read here. The array is what every card signed before this change
// carries, and a card can be part-written under each shape — one attestation
// landing before the deploy and one after — so the two are folded into one
// list rather than one winning.
export const attestedPids = (sig) => {
  const legacy = Array.isArray(sig?.attested_by) ? sig.attested_by : [];
  const map = sig?.attests && typeof sig.attests === "object" ? sig.attests : {};
  // A map key whose value is null is an attestation that was withdrawn; the
  // key survives the merge, so absence has to be read off the value.
  const fromMap = Object.keys(map).filter(pid => map[pid]);
  return [...new Set([...legacy, ...fromMap])];
};

// ── Signature state ─────────────────────────────────────────────────
// Everyone in the match except whoever signed it. These are the players
// the card is waiting on.
export const nonSignerPids = (card, sig, withdrawnPids) =>
  activePids(card, withdrawnPids).filter(pid => pid !== sig?.signed_by);

// A card is fully attested when every non-signer has attested. The
// degenerate case — a match somehow containing only the signer — counts as
// attested rather than hanging forever on an empty list, which mirrors
// MnQ's autoAttest branch at signing time.
export const isFullyAttested = (card, sig, withdrawnPids) => {
  if (!sig) return false;
  const pending = nonSignerPids(card, sig, withdrawnPids);
  const attested = attestedPids(sig);
  return pending.length === 0 || pending.every(pid => attested.includes(pid));
};

// Three states, named once so the UI never re-derives them inconsistently:
// "open" (no signature), "signed" (signed, waiting on attesters), "final".
export const cardState = (card, sig, withdrawnPids) =>
  !sig ? "open" : isFullyAttested(card, sig, withdrawnPids) ? "final" : "signed";

// ── Round-level progress ────────────────────────────────────────────
// What the director's finalize gate reads. Counts EVERY card in the round,
// which is the same population roundScoreProgress counts over — the two are
// meant to be read side by side in the finalize sheet.
//
// CARDS, not matches, so a Team Best Ball round is counted in the four waves
// it is actually signed in. Counted by match it would read "1 card" for a
// round sixteen men played, and be complete the moment any one wave signed.
// The caller builds the list (cardsForRound) because only it knows the
// round's format and draw.
//
// `complete` is the whole round attested, and is what promotes the
// ready-to-finalize notification. A round with no cards is not complete, for
// the same reason an empty round is not a finished one there.
export function roundCardProgress(cards, cardSigs, withdrawnPids) {
  const all = cards || [];
  let signed = 0, attested = 0;
  const unsigned = [], awaiting = [];
  all.forEach(card => {
    const sig = sigForCard(cardSigs, card);
    if (!sig) { unsigned.push(card); return; }
    signed++;
    if (isFullyAttested(card, sig, withdrawnPids)) attested++;
    else awaiting.push({
      card,
      pending: nonSignerPids(card, sig, withdrawnPids).filter(pid => !attestedPids(sig).includes(pid)),
    });
  });
  return {
    total: all.length,
    signed, attested,
    unsigned,   // cards with no signature at all
    awaiting,   // signed cards, with who they are waiting on
    complete: all.length > 0 && attested === all.length,
  };
}

// The cards this player personally owes an attestation on, out of whatever
// matches it is given. Drives the app badge — a player who walked off
// without attesting should carry the count wherever they are, not only on
// the screen showing that match.
//
// Callers pass the cards they consider ACTIONABLE (App scopes it to the
// current round), because a badge counting something the app has no button
// for is a badge that never clears.
export function pendingAttestations(cards, cardSigs, pid, withdrawnPids) {
  if (!pid) return [];
  const out = withdrawnPids instanceof Set ? withdrawnPids : new Set(withdrawnPids || []);
  // A man who withdrew is not asked to attest the card he walked off.
  if (out.has(pid)) return [];
  return (cards || []).filter(card => {
    if (!(card.pids || []).includes(pid)) return false;
    const sig = sigForCard(cardSigs, card);
    if (!sig || sig.signed_by === pid) return false;
    return !attestedPids(sig).includes(pid) && !isFullyAttested(card, sig, withdrawnPids);
  });
}
