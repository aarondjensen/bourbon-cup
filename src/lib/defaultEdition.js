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
import { DEMO_EDITION_ID, isDemoEdition } from "./editionLock.js";

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

// ══════════════════════════════════════════════════════════════════
//  liveEdition — the tournament that is actually on, as opposed to the
//  one you happen to be looking at.
// ══════════════════════════════════════════════════════════════════
//
// Two different questions wear the word "active" in this app and they must not
// be confused: `getActiveTournamentId()` is WHICH EDITION THIS DEVICE HAS
// OPEN — a per-device pointer, and the thing the picker paints ACTIVE — while
// this is WHICH EDITION IS THE CUP. They are the same id until somebody opens
// 2019, and the whole reason this exists is the moment they part: the way back
// has to be one tap, and one tap needs a destination.
//
// Read off `status`, which is the field that already carries this fact:
//
//   archived   the finished cups. Every imported year is written this way
//              (historyImport), and a year that is over ought to become one.
//   published  the tournament being played. `ensureActiveEditionDoc` writes it
//              and a director sets it in ☰ → Tournaments → ✎.
//   draft      next year, still being built. Not somewhere to send anybody
//              back TO — it has no draw and possibly no roster.
//
// Newest published wins, so the day a director publishes 2026 the row starts
// pointing at 2026 with no code change. Deliberately NOT the device default:
// that is a build-time constant answering a different question (where a device
// with no pointer starts), and it would go on naming last year's cup forever.
//
// The demo is the one exception and it is the device default that decides it —
// a store build's home IS `bc_demo`, because that is where a fresh install
// lands and where the tester's claimable roster row is. On the web the demo is
// never the way home, even though the seed publishes it.
//
// Returns "" when there is nothing to point at — no editions loaded yet, or a
// project with no published year — so the caller renders no row rather than a
// row that goes nowhere.
export const liveEdition = (editions = [], deviceDefault = "") => {
  const rows = (editions || []).filter((e) => e?.id);
  const home = rows.find((e) => e.id === deviceDefault);
  if (isDemoEdition(home)) return home.id;
  const published = rows
    .filter((e) => e.status === "published" && !isDemoEdition(e))
    .sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0));
  if (published.length) return published[0].id;
  return home ? home.id : "";
};
