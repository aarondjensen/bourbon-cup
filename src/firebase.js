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
  getFirestore, collection, doc, setDoc, getDocs,
  query, where, onSnapshot, deleteDoc,
} from "firebase/firestore";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCvR8I_5N0tXIXaPRkvsvBMzKfUY1_KzA0",
  authDomain: "the-bourbon-cup.firebaseapp.com",
  projectId: "the-bourbon-cup",
  storageBucket: "the-bourbon-cup.firebasestorage.app",
  messagingSenderId: "957218531964",
  appId: "1:957218531964:web:753b42a551463fd50537f9",
};

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

const _app = initializeApp(FIREBASE_CONFIG);
const _db = getFirestore(_app);

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
  subscribe: (col, filters = [], cb) => {
    try {
      return onSnapshot(db._q(col, filters), snap => cb(snap.docs.map(d => d.data())), e => console.error("subscribe", e));
    } catch(e) { console.error("subscribe setup", e); return () => {}; }
  },
};
