// ══════════════════════════════════════════════════════════════════
//  guest — a way into the app with no account at all.
// ══════════════════════════════════════════════════════════════════
//
// Google Play's closed-testing requirement wants a dozen people to install
// the app and use it. Every one of them would otherwise hit the three
// screens in lib/auth.js and lib/accounts.js: sign in, present the
// tournament password, claim a name off the roster. That is the right
// sequence for a golfer and the wrong one for a tester — handing out the
// password is exactly what the password exists to prevent, and a stranger
// claiming "Weezy" takes a roster row a director then has to unlink.
//
// So there is a fourth way in that grants nothing: a guest.
//
// ── Why this needs no rules, no console toggle and no deploy ────────
// A guest is NOT signed in to Firebase. There is no anonymous account, no
// uid, no membership document. That is the whole design, because it makes
// the read-only guarantee structural rather than a promise this file makes:
//
//   • Reads in firestore.rules are open to everyone (`isOpen()`), which is
//     what already lets a spouse open a shared leaderboard link. A guest is
//     that reader, with the app's own chrome around them.
//   • EVERY write rule in the project starts at `isMember()`, which starts
//     at `request.auth != null`. A guest has no auth token, so a guest
//     cannot write a single document — not a score, not a push token, not a
//     photo, not a side bet. It is not that the app declines to offer it;
//     it is that the database would refuse it.
//
// Which also means nothing here has to be deployed to work, and no Firebase
// console setting can be missing. Anonymous auth would have given a guest a
// uid — and a uid is one loosened rule away from being a member.
//
// The app still hides the write affordances a guest would only watch fail
// (see AccountView and the Scoring empty state); that is courtesy, not the
// safeguard.
//
// ── Why it persists ────────────────────────────────────────────────
// localStorage, the same store the signed-in session cache uses and for the
// same reason: a tester who opens the app on day three of fourteen should
// not have to find the guest button again, and a home-screen install throws
// sessionStorage away every time it is closed.
//
// Leaving is My Account → Exit Guest, which drops the flag and puts the
// sign-in screen back. Signing in for real clears it too — the app prefers
// a real account over this one whenever both are present.

// The player id a guest carries. Deliberately NOT the spectator id: a
// spectator is a signed-in member looking at a year they are not in, and
// conflating the two would let one identity's rules leak onto the other.
// It matches no roster row, which is what keeps a guest out of every match,
// every card and every ledger row without a single extra check.
export const GUEST_ID = "guest";

// The localStorage key. `bc_` prefixed like every other one this app owns.
export const GUEST_KEY = "bc_guest";

// The identity the app runs on. Same shape as BOOTSTRAP_DIRECTOR and the
// spectator session in firebase.js, so everything downstream that already
// copes with a player-less identity copes with this one.
//
// Frozen because it is a module-level singleton handed to React state — a
// caller spreading it is fine, a caller mutating it would change what every
// later guest is.
export const GUEST_USER = Object.freeze({
  player_id: GUEST_ID,
  name: "Guest",
  team: null,
  isDirector: false,
});

// Whether the identity on screen is the guest one. Used to withhold the
// controls a guest can only watch fail, and to word the screens that talk
// about "your account" at somebody who does not have one.
export const isGuest = (user) => user?.player_id === GUEST_ID;

// Reads swallow their errors: private browsing and a locked-down webview
// both throw on localStorage, and the right answer there is "not a guest"
// rather than a blank page.
export const readGuestMode = () => {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(GUEST_KEY) === "1";
  } catch { return false; }
};

export const writeGuestMode = (on) => {
  try {
    if (typeof localStorage === "undefined") return;
    if (on) localStorage.setItem(GUEST_KEY, "1");
    else localStorage.removeItem(GUEST_KEY);
  } catch { /* blocked storage */ }
};

// ── The scoreboard door ────────────────────────────────────────────
// The same guest, narrowed to one screen: the leaderboard, with no bottom
// nav, no menu and no other tab reachable from it.
//
// It is a SECOND flag on the SAME identity rather than a fourth way in,
// which is the only part of this worth defending. A guest already reads
// everything and writes nothing — that guarantee is structural and is
// argued above — so "leaderboard only" has nothing to add to it and
// nothing to weaken; it is a question about what the app DRAWS, not about
// what the database will accept. Building it as its own identity would
// have meant a second set of allowances to keep in step with the guest's,
// and the app has three player-less identities already.
//
// Who it is for: the wives, the group text, the four men who could not get
// the week off. They want the score and they are never going to sign in,
// and until this existed the only door on the sign-in screen for them was
// one that hands over the whole app — five tabs, a draw, a betting sheet
// and a photo library — to answer "who's up?".
//
// Board mode implies guest mode, and the pair is only ever written
// together (App's enterBoard / doSignOut). It is read at mount like the
// guest flag and for the same reason: somebody who opened the scoreboard
// on Friday is opening it again on Saturday, and being asked to find the
// button a second time is the thing a bookmark is supposed to prevent.
export const BOARD_KEY = "bc_board";

export const readBoardMode = () => {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(BOARD_KEY) === "1";
  } catch { return false; }
};

export const writeBoardMode = (on) => {
  try {
    if (typeof localStorage === "undefined") return;
    if (on) localStorage.setItem(BOARD_KEY, "1");
    else localStorage.removeItem(BOARD_KEY);
  } catch { /* blocked storage */ }
};
