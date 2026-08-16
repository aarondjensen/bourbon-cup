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
import { resolveFirebaseConfig } from "./lib/firebaseConfig";
import {
  getFirestore, initializeFirestore,
  persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, getDoc, getDocs,
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
// The decision itself lives in lib/firebaseConfig.js, which is pure and tested
// — this file imports the Firebase SDK at module scope, so anything decided in
// here can only be checked by booting the app against a real project. See that
// file for why the override is all-or-nothing.
//
// The logging stays here on purpose: it lets the warning name real tournament
// data without the shared module knowing anything about tournaments, so all
// three apps can carry the same resolver.
const _resolveFirebaseConfig = () => {
  let verdict;
  try {
    verdict = resolveFirebaseConfig(import.meta.env, PROD_FIREBASE_CONFIG, "real tournament data");
  } catch (e) {
    // Logged as well as re-thrown: this throws during module evaluation, before
    // React (and ErrorBoundary) exist, so the only symptom is a blank page.
    console.error(e.message);
    throw e;
  }
  if (verdict.warn) console.warn(verdict.warn);
  if (verdict.source === "env") console.info(`[firebase] Using project "${verdict.config.projectId}" from env.`);
  return verdict.config;
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
// ── The cache that survives a reload ────────────────────────────────
// The default Firestore cache is IN MEMORY and thrown away on every reload,
// which means a cold start re-reads — and re-pays for — every document this
// app subscribes to.
//
// That is not a small number here. The subscriptions are scoped to a whole
// edition: the roster, every round, every match, the groups, the tee sheet,
// the locks, the signatures, and hole scores at sixteen players x four rounds
// x eighteen holes. A cold start is on the order of a thousand documents.
//
// And a phone on a golf course cold-starts constantly — the screen locks, iOS
// evicts the tab to take a photo, somebody switches to the camera and back. A
// dozen phones relaunching twenty to forty times over a weekend day is
// hundreds of thousands of billed reads against a 50,000/day free quota.
//
// With a persistent cache the listener resumes from its stored resume token
// and only CHANGED documents come down the wire or onto the bill — roughly an
// order of magnitude less. The second benefit matters just as much on this
// course: a relaunch in a dead spot paints from disk instead of showing an
// empty leaderboard.
//
// `persistentMultipleTabManager` is required rather than optional. Without it
// a second tab — or the same phone with the app open twice — fails to
// initialise its cache at all.
//
// Wrapped, because this can legitimately throw: Safari private browsing
// refuses the storage, and an already-initialised Firestore rejects a second
// initializeFirestore. Falling back to the in-memory default is the old
// behaviour, which is worse but is not broken.
const _db = (() => {
  try {
    return initializeFirestore(_app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (e) {
    console.warn("[firebase] Persistent cache unavailable, using memory cache:", e?.message || e);
    return getFirestore(_app);
  }
})();

// The initialized app, for the one other module that needs it: lib/auth.js
// builds the Auth instance from it. Everything else goes through `db`.
export const firebaseApp = _app;

// How long to wait before each reattach of a failed listener, and — by
// running out — how long to keep trying at all. See db.subscribe.
const SUBSCRIBE_RETRY_MS = [1000, 2000, 4000, 8000, 15000, 30000, 60000];

// ── Every row knows its own id ──────────────────────────────────────
// Each document in this project stores its id as a FIELD as well as being
// filed under it, and it is the field every screen reads: the settings
// singletons are found with `rows.find(r => r.id === editionDocId("tournament"))`,
// the edition picker opens `switchEdition(e.id)`, and `db.upsert` refuses a
// row that has no `id` on it. Nothing enforced that invariant, and the demo
// seed broke it — it used each document's id to NAME the Firestore document
// and then stored everything except the id, leaving a whole tournament the app
// could not identify. Tapping "DEMO — Testers" called `switchEdition(undefined)`,
// which cannot switch, so the reload came back on the edition you were already
// in. See `demoWrites` in lib/demoSeed for the writing half of that fix.
//
// So the document id fills the gap when the document does not carry one. The
// STORED field still wins wherever it exists, which makes this a no-op for
// every document the app or scripts/import-history.mjs has ever written — and
// it means a demo already sitting in Firestore reads correctly on the next
// deploy, rather than waiting on somebody to re-run the seed with a
// service-account key.
const rowOf = (d) => ({ id: d.id, ...d.data() });

export const db = {
  _q: (col, filters = []) => {
    const ref = collection(_db, col);
    return filters.length ? query(ref, ...filters.map(f => where(f.field, f.op, f.value))) : ref;
  },
  get: async (col, filters = []) => {
    try { const s = await getDocs(db._q(col, filters)); return s.docs.map(rowOf); }
    catch(e) { console.error("db.get", col, e); return []; }
  },
  // `loud` leaves the rejection in. The default swallows it into `null`,
  // which is right for a screen that would rather render stale than blow up —
  // but it makes "the rules refused this" and "something went wrong"
  // indistinguishable, and those have very different fixes. A form with a
  // Save button on it wants the difference; see writeFailure below.
  upsert: async (col, data, { loud = false } = {}) => {
    if (!data.id) {
      if (loud) throw new Error("upsert needs an id");
      return null;
    }
    try { await setDoc(doc(_db, col, String(data.id)), data, { merge: true }); return data; }
    catch(e) {
      if (loud) throw e;
      console.error("db.upsert", col, e);
      return null;
    }
  },
  delete: async (col, id) => {
    try { await deleteDoc(doc(_db, col, String(id))); return true; }
    catch(e) { console.error("db.delete", col, e); return null; }
  },
  // `withId` makes the DOCUMENT ID win over a stored `id` field. Every row
  // already carries one either way (see rowOf above); this is for
  // bc_accounts, where a membership can also be created by hand in the
  // Firebase console (that is how the first director is made) and whoever
  // typed it may well have added an `id` field of their own. The document id
  // — the uid — is the one that has to be believed there.
  //
  // ── A listener that does not die quietly ──────────────────────────
  // onSnapshot's error callback is TERMINAL. Firestore detaches the listener
  // when it fires and never retries; going offline is handled internally and
  // does not come through here, so what reaches it is a rules refusal.
  //
  // The refusal that actually happens is a collection whose rules have not
  // been deployed yet. Rules are deployed by hand and the app is not, and the
  // ordering is deliberately app-first (see firestore.rules), so every new
  // collection has a window where its reads are denied by the default-deny
  // rule at the bottom of that file.
  //
  // Before this, a listener that hit that window was dead for the life of the
  // tab, and nothing said so — the screen went on showing a working, EMPTY
  // list. That is how a side bet written moments after the rules landed saved
  // correctly, sat in Firestore with every field right, and never appeared on
  // the phone that wrote it. An empty list and a broken one must not look the
  // same, and of the two ways to fix that this is the one that needs no
  // screen to grow an error state.
  //
  // So it reattaches on a backoff, and the backoff RUNS OUT rather than
  // looping forever: a collection that is genuinely denied to this reader
  // should not log once a minute until the tab closes. The schedule spans
  // about two minutes, which covers a director deploying rules with the app
  // open in front of them. Past that, a reload is the answer and the console
  // says so.
  //
  // The counter resets on every good snapshot, so a listener that works for
  // an hour and then blips gets a full budget rather than the tail of an old
  // one.
  subscribe: (col, filters = [], cb, { withId = false } = {}) => {
    const rows = (snap) => snap.docs.map(d => (withId ? { ...d.data(), id: d.id } : rowOf(d)));
    let stopped = false, detach = null, timer = null, attempt = 0;

    const attach = () => {
      if (stopped) return;
      try {
        detach = onSnapshot(
          db._q(col, filters),
          snap => { attempt = 0; cb(rows(snap)); },
          e => {
            // Firestore has already detached by the time this runs, so the
            // handle is stale — clearing it keeps the unsubscribe below from
            // calling a dead one.
            detach = null;
            const wait = SUBSCRIBE_RETRY_MS[attempt];
            if (wait == null) {
              console.error(`subscribe ${col}: gave up after ${SUBSCRIBE_RETRY_MS.length} retries — reload to try again`, e);
              return;
            }
            console.error(`subscribe ${col}: failed, retrying in ${wait}ms`, e);
            attempt += 1;
            timer = setTimeout(attach, wait);
          },
        );
      } catch (e) { console.error("subscribe setup", col, e); }
    };
    attach();

    // Idempotent, and safe whether it lands before a retry, during one, or
    // after the schedule has run out. StrictMode unmounts every effect once
    // in development, so this is exercised on every dev reload.
    return () => {
      stopped = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (detach) { detach(); detach = null; }
    };
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

// ── Why a write was refused, in words ───────────────────────────────
// "Could not save — try again" is the worst thing a form can say when the
// answer is "and it never will, until somebody deploys the rules". Rules are
// deployed BY HAND in this project and the app is not (see firestore.rules),
// so every new collection has a window where its writes are denied — and the
// only person who ever sees that window is the director, who is also the
// person who can end it.
//
// So permission-denied gets named. The other two codes worth telling apart
// are a device that is offline and a payload Firestore will not take.
// Everything else falls back to the generic line the caller supplies.
export const writeFailure = (e, fallback = "That didn't save — try again") => {
  const code = e?.code || "";
  if (code === "permission-denied") return "Firestore refused that — the security rules may not be deployed yet";
  if (code === "unavailable" || code === "failed-precondition") return "No connection — that didn't save";
  if (code === "invalid-argument") return "Firestore wouldn't take that — check the values";
  return fallback;
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
