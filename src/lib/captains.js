// ══════════════════════════════════════════════════════════════════
//  Captains
// ══════════════════════════════════════════════════════════════════
//
// One man per side, per edition, and the only thing the app gives him is the
// Final Countdown: on the evening the closing round is turned over, HIS side's
// holes come out when HE says they do, off his own phone, after he has told
// the room what is on them. See components/FinalCountdown.
//
// WHERE THE FLAG LIVES, AND WHY IT IS NOT ON THE ROSTER
// ----------------------------------------------------
// On the MEMBERSHIP document — `bc_accounts/{uid}.captain_of`, a map of
// edition id → "A" | "B". The roster row would be the obvious home and it is
// the wrong one, for the same reason `bc_players.isDirector` is vestigial:
// the security rules have to be able to check this, and rules can only
// `get()` a path they can construct. Finding the roster row whose `auth_uid`
// is yours needs a QUERY, which rules cannot do; `bc_accounts/$(uid)` they
// already read on every write in the project.
//
// So the badge on screen and the write the rules will honour come off one
// field, and cannot disagree. That is the whole argument, and it is the same
// one the crown makes.
//
// A MAP rather than a bare side, because a captain is a fact about one
// tournament. The man who captained 2025 is not automatically captaining
// 2026, and an edition cloned forward must not carry it — nothing here reads
// an edition it was not asked about.
//
// WHY IT IS NOT THE CROWN
// -----------------------
// A director administers the tournament. A captain narrates half of one
// round. The overlap is usually total — both captains will be directors here
// — and they are still different powers: a captain can move his own side's
// reveal counter and nothing else in the project, which is why the rules can
// afford to hand it to a member at all.

export const CAPTAIN_FIELD = "captain_of";

const SIDES = ["A", "B"];

export const isSide = (v) => SIDES.includes(v);

// The side this membership captains in one edition, or null. Tolerant of a
// missing map, a missing edition and a value somebody typed by hand into the
// console — anything that is not exactly "A" or "B" is not a captaincy.
export const captainSideFor = (membership, editionId) => {
  if (!membership || !editionId) return null;
  const side = membership[CAPTAIN_FIELD]?.[editionId];
  return isSide(side) ? side : null;
};

export const isCaptainOf = (membership, editionId, side) =>
  side != null && captainSideFor(membership, editionId) === side;

// ── Reading it off the roster ───────────────────────────────────────
// `memberships` is App's live bc_accounts subscription and `membershipFor`
// (lib/accounts) is the roster-row → membership join. Both are passed in
// rather than imported, so this module stays free of Firebase and can be
// unit-tested — the same split accounts.js already draws.

export const playerCaptainSide = (memberships, player, editionId, membershipFor) =>
  captainSideFor(membershipFor(memberships, player), editionId);

// The roster row captaining one side, or null. First match wins: two men
// flagged for one side is a state only a console edit can reach, and picking
// one is better than drawing neither.
export const captainForSide = (memberships, players, editionId, side, membershipFor) => {
  if (!isSide(side)) return null;
  return (players || []).find(
    (p) => captainSideFor(membershipFor(memberships, p), editionId) === side
  ) || null;
};

// What a director's toggle writes. The WHOLE map goes back, because the app's
// writer merges documents rather than patching field paths — a dotted key
// through a merging set would land as a literal key with a dot in it.
//
// `null` removes the edition's entry rather than storing a null, so a
// membership that has never captained anything and one that was stood down
// read identically.
export const captainPatch = (membership, editionId, side) => {
  const next = { ...(membership?.[CAPTAIN_FIELD] || {}) };
  if (isSide(side)) next[editionId] = side;
  else delete next[editionId];
  return { [CAPTAIN_FIELD]: next };
};
