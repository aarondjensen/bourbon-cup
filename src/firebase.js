// ── Firebase ──
// Centralizes Firestore initialization and exposes a thin wrapper (`db`)
// that absorbs the Firestore SDK's verbosity. Every collection access goes
// through this object so error handling, query building, and subscription
// teardown stay consistent everywhere.
//
// Note on the API key: Firebase web config keys are public by design —
// they're shipped to the browser. Real access control happens through
// Firestore Security Rules, not by hiding the key.
import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, doc, setDoc, getDoc, getDocs,
  query, where, onSnapshot, deleteDoc,
} from "firebase/firestore";

// The PRODUCTION project — the live tournament. It stays inline as the default
// so a build with no env configured behaves exactly as it always has, and so
// deploys need no new Vercel settings.
const PROD_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCvR8I_5N0tXIXaPRkvsvBMzKfUY1_KzA0",
  authDomain: "the-bourbon-cup.firebaseapp.com",
  projectId: "the-bourbon-cup",
  storageBucket: "the-bourbon-cup.firebasestorage.app",
  messagingSenderId: "957218531964",
  appId: "1:957218531964:web:753b42a551463fd50537f9",
};

// ── Pointing a dev server at a different project ────────────────────
// `AdminView` auto-saves to Firestore on edit, so with more than one person
// working, a stray click on a local dev server mutates a real round. Copy
// .env.example to .env.local and fill in every VITE_FIREBASE_* var to aim that
// machine at a scratch Firebase project instead.
//
// The override is deliberately all-or-nothing: a partial set throws at startup
// rather than silently pairing a dev project id with the prod API key, which
// would look like it worked and write to production anyway.
const FIREBASE_ENV_KEYS = {
  apiKey: "VITE_FIREBASE_API_KEY",
  authDomain: "VITE_FIREBASE_AUTH_DOMAIN",
  projectId: "VITE_FIREBASE_PROJECT_ID",
  storageBucket: "VITE_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "VITE_FIREBASE_MESSAGING_SENDER_ID",
  appId: "VITE_FIREBASE_APP_ID",
};

const _resolveFirebaseConfig = () => {
  const env = import.meta.env || {};
  const entries = Object.entries(FIREBASE_ENV_KEYS);
  const missing = entries.filter(([, key]) => !env[key]).map(([, key]) => key);

  if (missing.length === entries.length) {
    if (env.DEV) {
      console.warn(
        `[firebase] No VITE_FIREBASE_* override — this dev server is on the LIVE ` +
        `project "${PROD_FIREBASE_CONFIG.projectId}". Edits reach real tournament ` +
        `data. See .env.example to point at a scratch project.`
      );
    }
    return PROD_FIREBASE_CONFIG;
  }
  if (missing.length) {
    // Logged as well as thrown: this throws during module evaluation, before
    // React (and ErrorBoundary) exist, so the only symptom is a blank page.
    const msg =
      `[firebase] Partial VITE_FIREBASE_* override — also set: ${missing.join(", ")}. ` +
      `Unset them all to use the production project. See .env.example.`;
    console.error(msg);
    throw new Error(msg);
  }

  const cfg = Object.fromEntries(entries.map(([field, key]) => [field, env[key]]));
  console.info(`[firebase] Using project "${cfg.projectId}" from env.`);
  return cfg;
};

// ── The auth handler's origin ───────────────────────────────────────
// `authDomain` is the origin that hosts Firebase's OAuth handler page, and
// by default that is <project>.firebaseapp.com — a different origin from
// the app. Popup sign-in does not care. The redirect flow (which iOS
// home-screen installs are stuck with, see lib/auth.js) does: Safari
// partitions storage per top-level origin, so a handler on a foreign
// origin can come back with nothing.
//
// Pointing this at the app's OWN domain fixes that, and costs one rewrite:
// vercel.json proxies /__/auth/* through to the firebaseapp.com handler,
// so `https://thebourboncup.com/__/auth/handler` serves the same page from
// the app's origin. Set VITE_AUTH_DOMAIN to that domain in Vercel to turn
// it on; the domain must also be listed under Firebase console →
// Authentication → Settings → Authorized domains.
//
// It is a single, separate override rather than part of the all-or-nothing
// six above because it is orthogonal: it changes where sign-in is served
// from, not which project the data lives in. Unset, everything behaves as
// it always has.
const FIREBASE_CONFIG = (() => {
  const cfg = _resolveFirebaseConfig();
  const override = (import.meta.env || {}).VITE_AUTH_DOMAIN;
  return override ? { ...cfg, authDomain: override } : cfg;
})();

// ── Active edition pointer ──────────────────────────────────────────
// Every query and write is namespaced by `tournament_id` so multiple
// editions (bc_2025, bc_2026, …) coexist in one Firestore. The active
// edition used to be a hardcoded constant; it is now a single mutable
// source so the director can switch years without a redeploy.
//
// `TOURNAMENT_ID` remains exported as a LIVE BINDING: because it is an
// exported `let` reassigned inside this module, every existing importer
// (`import { TOURNAMENT_ID } from "./firebase"`) reads the current edition
// at access time — no call sites had to change. New code should prefer
// getActiveTournamentId() / tournamentFilter() for clarity; both read the
// same source. The pointer persists per-device in localStorage; the
// canonical edition list will live in the `bc_editions` collection once
// the edition picker is built. Defaults to bc_2025, so behavior is
// unchanged until an edition is chosen.
const DEFAULT_TOURNAMENT_ID = "bc_2025";
export const ACTIVE_EDITION_KEY = "bc_active_edition";
export const ACTIVE_EDITION_NS_KEY = "bc_active_edition_ns";

const _readInitialEdition = () => {
  try {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(ACTIVE_EDITION_KEY) || DEFAULT_TOURNAMENT_ID;
    }
  } catch { /* blocked storage / SSR */ }
  return DEFAULT_TOURNAMENT_ID;
};

// Live binding — reassigned by setActiveTournamentId below.
export let TOURNAMENT_ID = _readInitialEdition();

// ── Per-edition document-ID namespacing ─────────────────────────────
// The original edition (bc_2025) stored its per-edition singleton/round docs
// under GLOBAL doc ids ("team_names", "bc_round_1", …). That means a second
// edition writing the same ids would overwrite the first. So editions created
// from now on are "namespaced": their singleton/round doc ids are prefixed
// with the edition id (`bc_2026__team_names`), making editions truly
// independent. The original edition stays un-namespaced (bare ids) so its
// existing data is untouched — for it, editionDocId() is an identity function
// and every read/write path is byte-identical to before.
//
// The active edition's flag is cached in localStorage (written at switch
// time) so it's known synchronously here, before any write happens.
let _editionNamespaced = (() => {
  try { return typeof localStorage !== "undefined" && localStorage.getItem(ACTIVE_EDITION_NS_KEY) === "true"; }
  catch { return false; }
})();

export const isEditionNamespaced = () => _editionNamespaced;

// Resolve a per-edition doc id. `bareId` is the legacy global id
// ("team_names", `bc_round_${r}`, …). For a namespaced edition it becomes
// `${tid}__${bareId}`; for the legacy edition it's returned unchanged.
export const editionDocId = (bareId, tid = TOURNAMENT_ID, namespaced = _editionNamespaced) =>
  namespaced ? `${tid}__${bareId}` : bareId;

export const getActiveTournamentId = () => TOURNAMENT_ID;

// The active edition's year, derived from its id (bc_2025 → 2025). Single
// source for every "which year is this" label in the UI, so the displayed
// year always matches the edition whose data is on screen.
export const getTournamentYear = () =>
  parseInt(String(TOURNAMENT_ID).replace(/\D/g, ""), 10) || new Date().getFullYear();

export const setActiveTournamentId = (id, namespaced = false) => {
  if (!id) return TOURNAMENT_ID;
  TOURNAMENT_ID = id;
  _editionNamespaced = !!namespaced;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(ACTIVE_EDITION_KEY, id);
      localStorage.setItem(ACTIVE_EDITION_NS_KEY, namespaced ? "true" : "false");
    }
  } catch { /* ignore */ }
  return TOURNAMENT_ID;
};

// Standard tournament-scope filter for db queries — routes through the
// active edition. Prefer this over hand-writing the filter literal.
export const tournamentFilter = () => [{ field: "tournament_id", op: "==", value: TOURNAMENT_ID }];

// ── User session ────────────────────────────────────────────────────
// WHO is signed in is owned by Firebase Auth (src/lib/auth.js), which
// persists it in IndexedDB and hands it back asynchronously a moment after
// startup. WHICH PLAYER that account is lives on the roster document
// (bc_players.auth_uid), which arrives a moment after THAT, over the
// Firestore subscription.
//
// This cache exists only to cover those two moments. Without it the app
// would render the sign-in screen, then the claim screen, then finally the
// leaderboard on every cold start — a flicker that looks exactly like
// being logged out, which is the complaint this whole feature answers.
// So the last known (account → player) pairing is written here and used
// on the next start until the live data confirms or replaces it. It is
// never trusted on its own: the entry carries the `auth_uid` it belongs
// to, and is ignored unless Firebase reports that same uid signed in.
//
// localStorage, not sessionStorage: sessionStorage is scoped to the tab
// and is discarded when the home-screen app is closed, which is precisely
// the reload this is here to survive.
export const USER_SESSION_KEY = "bc_user";

// Generic director identity used to BOOTSTRAP setup — an empty roster (no
// player to tap), or after an edition switch where the prior player may not
// exist in the new edition. Persisted in place of a stale player identity.
export const BOOTSTRAP_DIRECTOR = { player_id: "bootstrap_director", name: "Director (Setup)", team: null, isDirector: true };

// ── Viewing an edition you are not in ───────────────────────────────
// Every past cup imported from the spreadsheets has a roster of sixteen
// players and not one account behind any of them, because those tournaments
// finished before the app existed. Landing on the claim screen is the wrong
// answer there: it asks somebody who only wanted to look at 2019 to bind their
// account to a roster row on a finished tournament, which only a director can
// undo.
//
// So switching editions writes THIS instead of a player — a player-less
// identity that gets past the claim screen and shows the app read-only, the
// same way the bootstrap director does for an empty new edition. It grants
// nothing: Admin still rides on the membership flag, exactly as it does for
// every other identity.
//
// SCOPED TO THE EDITION IT WAS WRITTEN FOR, which is the part that matters. A
// player who has never claimed a name must still meet the claim screen on the
// live tournament; without the scope, one look at 2019 would leave them a
// spectator on the year they are actually playing.
export const SPECTATOR_ID = "spectator";
export const spectatorSession = (tid = TOURNAMENT_ID) =>
  ({ player_id: SPECTATOR_ID, name: "Viewing", team: null, isDirector: false, edition: tid });

export const readUserSession = () => {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(USER_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

export const writeUserSession = (user) => {
  try {
    if (typeof localStorage === "undefined") return;
    if (user) localStorage.setItem(USER_SESSION_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_SESSION_KEY);
  } catch { /* blocked storage */ }
};

// ── Tournament identity cache ───────────────────────────────────────
// Same idea as the user session above, for the same reason: the name and
// place live in bc_settings/tournament and arrive a moment after startup,
// and the app has to letter the splash before then.
//
// It used to letter it from the constants in constants.js, which are not
// this edition's answer — they are the fallback for an edition nobody has
// set up yet, and they point at the NEXT cup's venue. So a cold start on
// 2025 opened "2025 · GAYLORD, MI" (2026's town) and snapped to
// "2025 · GRAND RAPIDS, MI" when the document landed, which reads as the
// app correcting itself about where the tournament is.
//
// Keyed by edition, because the name and the place are per-edition and an
// edition switch hard-reloads: opening 2019 must not letter itself with the
// venue of the year you were just looking at. Nothing is invented here — a
// cold start on an edition never opened on this device still falls back to
// the constants, which is the only case they were ever meant to cover.
const identityKey = (tid = TOURNAMENT_ID) => `bc_tournament_identity_${tid}`;

export const readTournamentIdentity = (tid) => {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(identityKey(tid));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

export const writeTournamentIdentity = ({ name, location }, tid) => {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(identityKey(tid), JSON.stringify({ name, location }));
  } catch { /* blocked storage */ }
};

const _app = initializeApp(FIREBASE_CONFIG);
const _db = getFirestore(_app);

// The initialized app, for the one other module that needs it: lib/auth.js
// builds the Auth instance from it. Everything else goes through `db`.
export const firebaseApp = _app;

export const db = {
  _q: (col, filters = []) => {
    const ref = collection(_db, col);
    return filters.length ? query(ref, ...filters.map(f => where(f.field, f.op, f.value))) : ref;
  },
  get: async (col, filters = []) => {
    try { const s = await getDocs(db._q(col, filters)); return s.docs.map(d => d.data()); }
    catch(e) { console.error("db.get", col, e); return []; }
  },
  upsert: async (col, data) => {
    if (!data.id) return null;
    try { await setDoc(doc(_db, col, String(data.id)), data, { merge: true }); return data; }
    catch(e) { console.error("db.upsert", col, e); return null; }
  },
  delete: async (col, id) => {
    try { await deleteDoc(doc(_db, col, String(id))); return true; }
    catch(e) { console.error("db.delete", col, e); return null; }
  },
  // `withId` stamps the DOCUMENT ID onto each row. Everything in this app
  // stores its own id as a field as well, so nothing needed it — until
  // bc_accounts, where a membership can also be created by hand in the
  // Firebase console (that is how the first director is made) and will
  // then have only the fields whoever typed it thought to add. The id is
  // the one thing such a document always has.
  subscribe: (col, filters = [], cb, { withId = false } = {}) => {
    const rows = (snap) => snap.docs.map(d => (withId ? { ...d.data(), id: d.id } : d.data()));
    try {
      return onSnapshot(db._q(col, filters), snap => cb(rows(snap)), e => console.error("subscribe", e));
    } catch(e) { console.error("subscribe setup", e); return () => {}; }
  },
  // db.get with the error left in. Every other reader here swallows a failed
  // query into `[]`, which is the right default for a screen that would
  // rather render empty than blow up — but it makes "the read failed" and
  // "there is nothing there" the same answer. The notification code has to
  // tell those apart: treating a transient failure as "not subscribed" would
  // nag a subscribed user to re-enable push they already have.
  getStrict: async (col, filters = []) => {
    const s = await getDocs(db._q(col, filters));
    return s.docs.map(d => d.data());
  },
  // One document, by id. Everything else here queries a collection, which
  // is the right shape for tournament data but the wrong one for a document
  // whose id you already know AND whose collection you are not allowed to
  // list — bc_accounts is readable only to its owner (see firestore.rules),
  // so a `where` over it is rejected outright while a direct read is fine.
  // Errors are thrown rather than swallowed: "denied" and "absent" are
  // different answers here and the caller has to tell them apart.
  getById: async (col, id) => {
    const snap = await getDoc(doc(_db, col, String(id)));
    return snap.exists() ? snap.data() : null;
  },
  // A create that is allowed to fail loudly. `upsert` merges and swallows,
  // which is right for tournament data; the membership write needs the
  // rejection, because "permission-denied" IS the wrong-password answer.
  create: async (col, data) => {
    if (!data?.id) throw new Error("create needs an id");
    await setDoc(doc(_db, col, String(data.id)), data);
    return data;
  },
  // `upsert` with the rejection left in — for the other write the rules
  // police, appointing a director. A denial there is an answer ("not yours
  // to give"), not a glitch to log.
  //
  // The id is a separate argument rather than a field on the payload, and
  // that is load-bearing: the rule for this write allows exactly one key to
  // change, and `upsert`'s habit of writing `id` into the document as well
  // would put a second key in the diff and get the whole thing refused.
  upsertStrict: async (col, id, data) => {
    if (!id) throw new Error("upsertStrict needs an id");
    await setDoc(doc(_db, col, String(id)), data, { merge: true });
    return data;
  },
};

// ── Firebase Cloud Messaging (lazy-loaded) ──────────────────────────
// Messaging only exists where there is a Service Worker + Push API +
// Notifications API. iOS Safari below 16.4 has no Push API at all, and
// even on 16.4+ it only works from a home-screen install.
//
// CRITICAL: this module is imported by everything. A top-level import of
// firebase/messaging would put the messaging SDK on the critical path for
// the entire app, and any failure loading it — unsupported browser, a
// flaky chunk fetch — would turn into a blank page rather than a missing
// notification. The dynamic import keeps the blast radius at the one
// caller that asked.
let _messaging = null;
let _messagingChecked = false;
export const getMessagingInstance = async () => {
  if (_messagingChecked) return _messaging;
  _messagingChecked = true;
  try {
    const { getMessaging, isSupported } = await import("firebase/messaging");
    if (!(await isSupported())) return null;
    _messaging = getMessaging(_app);
    return _messaging;
  } catch (e) {
    // Some browsers throw out of isSupported rather than returning false.
    // Either way the answer is the same: no push here.
    console.warn("Firebase Messaging unavailable:", e?.message || e);
    return null;
  }
};
