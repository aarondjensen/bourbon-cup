// ── Firebase ──
// Centralizes Firestore initialization + Auth and exposes thin wrappers
// (`db` and `auth`) that absorb the Firebase SDK's verbosity. Every
// collection access and every auth operation goes through these objects so
// error handling stays consistent everywhere.
//
// Note on the API key: Firebase web config keys are public by design —
// they're shipped to the browser. Real access control happens through
// Firestore Security Rules, not by hiding the key.
import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, doc, setDoc, getDocs,
  query, where, onSnapshot, deleteDoc,
} from "firebase/firestore";
import {
  getAuth, setPersistence, browserLocalPersistence,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink,
  signOut as fbSignOut, onAuthStateChanged as fbOnAuthStateChanged,
} from "firebase/auth";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCvR8I_5N0tXIXaPRkvsvBMzKfUY1_KzA0",
  authDomain: "the-bourbon-cup.firebaseapp.com",
  projectId: "the-bourbon-cup",
  storageBucket: "the-bourbon-cup.firebasestorage.app",
  messagingSenderId: "957218531964",
  appId: "1:957218531964:web:753b42a551463fd50537f9",
};

// Tournament-scope filter applied to nearly every query — namespaces all
// data by tournament so future events can live in the same Firestore
// without collision. Used as `[{ field: "tournament_id", op: "==", value: TOURNAMENT_ID }]`.
export const TOURNAMENT_ID = "bc_2025";

const _app = initializeApp(FIREBASE_CONFIG);
const _db = getFirestore(_app);
const _auth = getAuth(_app);

// Persistence: keep users signed in across browser sessions until they
// explicitly sign out. Errors here are non-fatal — auth still works,
// just with default (session) persistence as a fallback.
setPersistence(_auth, browserLocalPersistence).catch(e => {
  console.error("auth.setPersistence", e);
});

// localStorage key used during the magic-link round trip. The user types
// their email on device A, gets a link emailed, clicks it — and we need to
// remember which email was used to complete the sign-in. Magic-link sign-in
// requires re-providing the email at completion time as a security check.
const MAGIC_LINK_EMAIL_KEY = "bc_pending_login_email";

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

// ── Auth wrapper ──
// All auth operations go through this object. Two providers are wired:
//   - Google: one-click popup, returns immediately on success.
//   - Email magic link: two-step (send → click email link → complete).
// The magic-link round trip uses localStorage to bridge the two steps,
// since the link can be opened on a different device than the original
// "send" request (this is supported but not the common path).
export const auth = {
  // Subscribe to auth-state changes. cb fires with the Firebase user (or
  // null) immediately on subscribe and then on every sign-in/sign-out.
  // Returns an unsubscribe function.
  onAuthStateChanged: (cb) => fbOnAuthStateChanged(_auth, cb),

  // Sign in with Google. Tries popup first (slick UX on desktop) and
  // falls back to full-page redirect on common popup failures: COOP-
  // related handoff blocks (typical on Vercel), mobile Safari closing
  // popups aggressively, in-app browsers (Instagram/Facebook webview)
  // not supporting cross-window messaging, and explicit popup blockers.
  // Returns the user on popup success; returns undefined when redirecting
  // (the page will navigate away before this resolves anyway).
  signInWithGoogle: async () => {
    const provider = new GoogleAuthProvider();
    try {
      const cred = await signInWithPopup(_auth, provider);
      return cred.user;
    } catch(e) {
      const fallbackCodes = new Set([
        "auth/popup-blocked",
        "auth/popup-closed-by-user",
        "auth/cancelled-popup-request",
        "auth/operation-not-supported-in-this-environment",
        "auth/web-storage-unsupported",
        "auth/internal-error", // covers many COOP-related closes
      ]);
      if (fallbackCodes.has(e?.code)) {
        // signInWithRedirect navigates the page away. Anything queued
        // after this point will not run; the redirect-return handler on
        // the next page load picks up the result via getRedirectResult.
        await signInWithRedirect(_auth, provider);
        return undefined;
      }
      console.error("auth.signInWithGoogle", e);
      throw e;
    }
  },

  // Consume any pending Google-redirect result. Called once on app mount;
  // if the user just returned from a Google redirect, this resolves with
  // the credential. If not, it resolves with null. Errors here surface
  // OAuth failures (e.g. user cancelled, account selection mismatch).
  getGoogleRedirectResult: async () => {
    try {
      return await getRedirectResult(_auth);
    } catch(e) {
      console.error("auth.getGoogleRedirectResult", e);
      throw e;
    }
  },

  // Step 1 of magic-link sign-in: send the link email. The link points
  // back to the current origin so clicking returns the user to the app.
  // Stores the email locally so step 2 can re-supply it without asking.
  sendMagicLink: async (email) => {
    try {
      const actionCodeSettings = {
        url: window.location.origin + "/",
        handleCodeInApp: true,
      };
      await sendSignInLinkToEmail(_auth, email, actionCodeSettings);
      window.localStorage.setItem(MAGIC_LINK_EMAIL_KEY, email);
      return true;
    } catch(e) {
      console.error("auth.sendMagicLink", e);
      throw e;
    }
  },

  // True if the current URL is a magic-link return (i.e., the user just
  // clicked the link in their email). App should call completeMagicLink
  // immediately when this is true.
  isMagicLinkReturn: (url) => isSignInWithEmailLink(_auth, url || window.location.href),

  // Step 2 of magic-link sign-in: complete the sign-in. Email is read
  // from localStorage if not provided; this is the typical path. If the
  // user opened the link on a different device, the app should prompt
  // for the email and pass it explicitly.
  completeMagicLink: async (email, url) => {
    try {
      const e = email || window.localStorage.getItem(MAGIC_LINK_EMAIL_KEY);
      if (!e) throw new Error("No email available to complete sign-in");
      const cred = await signInWithEmailLink(_auth, e, url || window.location.href);
      window.localStorage.removeItem(MAGIC_LINK_EMAIL_KEY);
      return cred.user;
    } catch(e) {
      console.error("auth.completeMagicLink", e);
      throw e;
    }
  },

  // Read the stored email used in step 1 — useful for showing the user
  // which address was sent the link, or detecting whether step 1 was
  // initiated on this device.
  getPendingEmail: () => window.localStorage.getItem(MAGIC_LINK_EMAIL_KEY),

  signOut: async () => {
    try { await fbSignOut(_auth); }
    catch(e) { console.error("auth.signOut", e); }
  },

  // Direct access to the current Firebase user, mainly for synchronous
  // checks. Prefer the onAuthStateChanged subscription for reactive UI.
  currentUser: () => _auth.currentUser,
};
