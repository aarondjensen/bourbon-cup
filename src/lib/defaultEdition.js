// ══════════════════════════════════════════════════════════════════
//  defaultEdition — where a device with no pointer starts
// ══════════════════════════════════════════════════════════════════
//
// Consulted on a FRESH install and never again: one tap in ☰ → Tournaments
// writes localStorage, and from then on that is the answer. So this decides
// exactly one thing — what somebody sees the first time they open the app,
// before they know it has years in it at all.
//
// EVERY install now opens on the cup, web and store build alike.
//
// It used to fork: a native build opened on `bc_demo`, because a store build
// meant Play's twelve closed-test strangers, who had no name on any roster and
// would have landed on a locked edition that refuses every write. That reason
// is gone. Play distribution is INTERNAL TESTING (`play-store.md` §7), so a
// store build is now installed by the same sixteen men who use the website —
// and opening THEM on "DEMO — Testers" is the same failure the fork existed to
// prevent, pointed the other way: the field would install the app off
// thebourboncup.com/app and find a tournament nobody has played.
//
// The demo edition is untouched and still reachable in ☰ → Tournaments; it is
// simply no longer where anybody starts. A reviewer's path is the guest door
// (`store-submission.md` §1.4), which needs no roster row at all and is what
// the Review Notes point at.
//
// `VITE_DEFAULT_EDITION` still overrides, which is how next year's tournament
// becomes a build setting rather than a code change.
//
// Pure, and its own module, because firebase.js initialises Firebase on
// import and so cannot be unit-tested — the same split as editionLock.js and
// editions.js. What somebody sees first is worth pinning.
import { isDemoEdition } from "./editionLock.js";

// The web app's own year. Not "the latest edition": there is no server-side
// flag saying which year is current — the active pointer is per-device — and
// this has to be answered synchronously, before the first query is built, so
// a Firestore round trip cannot be waited on.
export const WEB_DEFAULT_EDITION_ID = "bc_2025";

/**
 * @param {object} opts
 * @param {string} [opts.override]  VITE_DEFAULT_EDITION. Wins, which is how
 *   next year's tournament becomes a build setting rather than a code change.
 * @returns {string} the edition id to open on.
 */
export const defaultEdition = ({ override } = {}) => {
  const cleaned = typeof override === "string" ? override.trim() : "";
  return cleaned || WEB_DEFAULT_EDITION_ID;
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
