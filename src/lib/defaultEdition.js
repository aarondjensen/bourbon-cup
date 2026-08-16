// ══════════════════════════════════════════════════════════════════
//  defaultEdition — where a device with no pointer starts
// ══════════════════════════════════════════════════════════════════
//
// Consulted on a FRESH install and never again: one tap in ☰ → Tournaments
// writes localStorage, and from then on that is the answer. So this decides
// exactly one thing — what somebody sees the first time they open the app,
// before they know it has years in it at all.
//
// The two audiences are genuinely different, and it is the INSTALL that tells
// them apart rather than anything about the person:
//
//   web    — the sixteen men, on thebourboncup.com. Unchanged: the cup.
//   native — a store build. Today that is Play's internal testers and the two
//            review queues. They are handed the app to try, not to navigate.
//
// A tester landing on a finished cup gets a roster they cannot claim: those
// editions are locked, and `canWriteEdition()` refuses every write, so their
// first act in the app is a refusal. Telling them to go and find the right
// tournament is not a fix — a tester who must be instructed where to start is
// a tester who reports the app as broken, and the store forms promise them a
// roster they can claim from.
//
// Pure, and its own module, because firebase.js initialises Firebase on
// import and so cannot be unit-tested — the same split as editionLock.js and
// editions.js. What a reviewer sees first is worth pinning.
import { DEMO_EDITION_ID } from "./editionLock.js";

// The web app's own year. Not "the latest edition": there is no server-side
// flag saying which year is current — the active pointer is per-device — and
// this has to be answered synchronously, before the first query is built, so
// a Firestore round trip cannot be waited on.
export const WEB_DEFAULT_EDITION_ID = "bc_2025";

/**
 * @param {object} opts
 * @param {string} [opts.override]  VITE_DEFAULT_EDITION. Wins over everything,
 *   which is how this stops being a special case: when the field installs the
 *   store builds rather than twelve testers, set it to that year and the fork
 *   is gone without a code change.
 * @param {boolean} [opts.native]   Running inside a Capacitor build.
 * @returns {string} the edition id to open on.
 */
export const defaultEdition = ({ override, native = false } = {}) => {
  const cleaned = typeof override === "string" ? override.trim() : "";
  if (cleaned) return cleaned;
  return native ? DEMO_EDITION_ID : WEB_DEFAULT_EDITION_ID;
};
