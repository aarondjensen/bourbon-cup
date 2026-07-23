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

export const getActiveTournamentId = () => TOURNAMENT_ID;

export const setActiveTournamentId = (id) => {
  if (!id) return TOURNAMENT_ID;
  TOURNAMENT_ID = id;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(ACTIVE_EDITION_KEY, id);
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
