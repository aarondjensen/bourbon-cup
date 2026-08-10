// ══════════════════════════════════════════════════════════════════
//  Side bets — the wagers the app does not run
// ══════════════════════════════════════════════════════════════════
//
// Skins, CTP and low net are games the app SCORES: it knows the rules, reads
// the cards and works out who won. A side bet is the opposite. Two players
// agree something between themselves on the first tee — closest on 17, first
// to break 90, a press on the back — and the app has no idea what any of that
// means and should not pretend to.
//
// So this is a LEDGER, not a game. It records who, against whom, for how much
// and on what terms, and it settles nothing. The terms are free text on
// purpose: every attempt to enumerate the shapes a bar bet can take ends with
// somebody's bet not fitting the form, and then it lives on a napkin again,
// which is the thing this replaces.
//
// ── What is trusted and what is not ───────────────────────────────
// `created_by` is an auth uid and is pinned by the security rules to the
// caller's own — it is the field the delete rule trusts, so it has to be
// unforgeable at the moment it is written. `player_a` / `player_b` are roster
// ids and are NOT verifiable by the rules: finding the roster row whose
// auth_uid is yours needs a query, and rules only fetch paths they can
// construct (the same limit documented in firestore.rules for the crown).
//
// That is fine here, and worth being explicit about rather than papering
// over. The record is public to the whole field, so a bet somebody did not
// agree to is a bet with their name on it in front of everybody who would
// know better. This is sixteen people at a golf course; visibility is the
// enforcement, and the alternative — an accept/decline handshake — would mean
// half the bets sitting unconfirmed all weekend because the other guy is on
// the tee box with his phone in the cart.

export const SIDE_BETS_COL = "bc_side_bets";

// Free text, capped. See buildSideBet for why.
export const MAX_DETAIL = 280;

// One id per bet, and it has to be unique across a field of phones creating
// them at the same time on the same tee. Time alone is not: two players
// tapping Save in the same millisecond would collide and one bet would
// silently overwrite the other. The random tail is what makes that a
// non-event.
export const sideBetId = (now, rand) =>
  `bc_sidebet_${now}_${Math.floor(rand * 1e6).toString(36)}`;

// What the form has to be able to say NO to, in the order a person fills it
// in. Returns a message or null — the caller shows the first thing wrong
// rather than a list, because a two-field form with three errors on it is a
// form somebody closes.
export const sideBetError = ({ playerA, playerB, amount }) => {
  if (!playerA || !playerB) return "Pick both players.";
  if (playerA === playerB) return "A bet needs two different players.";
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return "Enter an amount.";
  return null;
};

// The document, built from a validated form. Kept here rather than in the
// component so the shape has one author and the tests can see it.
export const buildSideBet = ({
  id, tournamentId, createdBy, playerA, playerB, amount, detail, now,
}) => ({
  id,
  tournament_id: tournamentId,
  // The uid, not the roster id — see the note above on what the rules can
  // actually check.
  created_by: createdBy,
  player_a: playerA,
  player_b: playerB,
  amount: Number(amount),
  // Trimmed and capped. Free text that can grow without limit is free text
  // that eventually arrives as a wall on a phone screen, and the terms of a
  // golf bet have never needed a second paragraph.
  detail: String(detail || "").trim().slice(0, MAX_DETAIL),
  created_at: now,
});

// Newest first. A side-bet list is read to find the one just made, or the one
// being argued about, and both of those are recent.
export const sortSideBets = (bets) =>
  [...bets].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

// Is this player in this bet? Both sides, because "my bets" means bets I am
// ON, not bets I typed in.
export const inSideBet = (bet, pid) =>
  !!pid && (bet.player_a === pid || bet.player_b === pid);

// The header card's three numbers. `mine` is EXPOSURE — what this player has
// riding, win or lose — not a net position, because nothing here knows who
// won. Calling it anything else would be the screen claiming knowledge it
// does not have.
export const sideBetTotals = (bets, pid) => {
  let atStake = 0, mine = 0;
  bets.forEach(b => {
    const amt = Number(b.amount) || 0;
    atStake += amt;
    if (inSideBet(b, pid)) mine += amt;
  });
  return { atStake, count: bets.length, mine };
};

// Who may remove one. Mirrors the `delete` rule in firestore.rules exactly —
// the person who logged it, or a director cleaning up. Anybody else gets no
// affordance, which is the honest thing to show: a button that only fails is
// worse than no button.
//
// Deliberately NOT "either player in the bet". The other side of a bet you
// dispute is not yours to erase — that is an argument to have on the tee, and
// the director is the one who settles those here as everywhere else.
export const canDeleteSideBet = (bet, { uid, isDirector }) =>
  !!bet && (isDirector === true || (!!uid && bet.created_by === uid));
