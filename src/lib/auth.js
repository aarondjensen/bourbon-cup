// ══════════════════════════════════════════════════════════════════
//  auth — signing in with Google or Apple.
// ══════════════════════════════════════════════════════════════════
//
// Until this file the app had no accounts at all: the login screen listed
// the roster and you tapped your own name. That is a fine way to start, and
// it survived two tournaments, but it has one failure everybody hit —
// identity lived in sessionStorage, which the browser throws away when the
// tab (or the home-screen app) closes. Reopening the app on Saturday
// morning put you back on the tap-a-player screen every single time.
//
// Firebase Auth fixes that as a side effect of doing the real thing: the
// SDK persists its session in IndexedDB, so a signed-in user stays signed
// in across app restarts, OS restarts and new bundles until they actually
// press Logout. Everything below is a thin, opinionated wrapper around it
// so App.jsx never touches a provider object.
//
// ── What this does NOT do ─────────────────────────────────────────
// Signing in proves you own a Google or Apple account. It says nothing
// about which PLAYER you are — that link is made once, by the person, on
// the claim screen, and stored on the roster document. See lib/accounts.js.
//
// ── Console setup this depends on ─────────────────────────────────
// Neither provider works until it is switched on for the Firebase project
// (Console → Authentication → Sign-in method):
//
//   • Google — one toggle, no external account needed.
//   • Apple  — needs an Apple Developer Program membership: a Services ID,
//              a key, and the team id, all pasted into the Firebase
//              console. Apple's Services ID must list
//              `https://<project>.firebaseapp.com/__/auth/handler` as a
//              return URL.
//
// Every domain the app is served from (thebourboncup.com, localhost, and
// any Vercel preview URL you actually sign in from) must also be listed
// under Authentication → Settings → Authorized domains, or the sign-in
// call comes back as auth/unauthorized-domain. The error text below says
// so in as many words, because that one is otherwise a guessing game.
import {
  getAuth, setPersistence, indexedDBLocalPersistence, browserLocalPersistence,
  GoogleAuthProvider, OAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, signOut,
} from "firebase/auth";
import { firebaseApp } from "../firebase";

// ── The two providers ───────────────────────────────────────────────
// Exported as data rather than as two functions so the login screen can
// render its buttons from the same list this module signs in with — one
// place to add a third provider, if it ever comes to that.
export const PROVIDERS = [
  { id: "google", label: "Continue with Google", brand: "#FFFFFF", ink: "#1F1F1F" },
  { id: "apple",  label: "Continue with Apple",  brand: "#000000", ink: "#FFFFFF" },
];

const makeProvider = (id) => {
  if (id === "apple") {
    const p = new OAuthProvider("apple.com");
    // Apple hands these over only on the FIRST authorization for a given
    // Services ID; afterwards the token carries just the subject id. We
    // key everything off the uid, so nothing here depends on getting a
    // name back — the scopes are requested to fill in the greeting, and
    // "Hide My Email" giving us a privaterelay address costs us nothing.
    p.addScope("email");
    p.addScope("name");
    return p;
  }
  const p = new GoogleAuthProvider();
  // Always ask which account. Phones are handed around at this event and
  // a silent sign-in as whoever used the phone last is the exact accident
  // the claim screen then makes permanent.
  p.setCustomParameters({ prompt: "select_account" });
  return p;
};

// ── The auth instance ───────────────────────────────────────────────
// Persistence is set explicitly rather than left at the SDK default so the
// intent is legible: IndexedDB first, localStorage if IndexedDB is
// unavailable (private windows, some embedded webviews). Both outlive the
// tab, which is the whole point. A failure to set it is not fatal — the
// SDK keeps its default and the user simply signs in again sooner.
let _auth = null;
let _ready = null;

const authReady = () => {
  if (_ready) return _ready;
  _auth = getAuth(firebaseApp);
  _ready = setPersistence(_auth, indexedDBLocalPersistence)
    .catch(() => setPersistence(_auth, browserLocalPersistence))
    .catch((e) => { console.warn("[auth] persistence unavailable:", e?.message || e); })
    .then(() => _auth);
  return _ready;
};

// ── Popup or redirect ───────────────────────────────────────────────
// Popup is the better flow everywhere it works: the app never unloads, so
// there is no round trip through storage to resume, and Safari's storage
// partitioning never gets a say. It has exactly one environment where it
// cannot work — an iOS home-screen install, where `window.open` does not
// give us a window we can talk back to, and the call either hangs or comes
// back as a cancelled popup.
//
// That environment is precisely how this app is used, so it gets the
// redirect flow instead, and redirect brings its own caveat worth knowing
// before debugging it: on Safari it wants the auth handler to be
// same-origin with the app. Set VITE_AUTH_DOMAIN=thebourboncup.com (and
// keep the /__/auth rewrite in vercel.json) to make it so. Without that it
// usually still works and occasionally, on a cold install, returns no user
// at all — in which case the user is looking at the sign-in screen again
// rather than at an error, and tapping the button a second time works.
const isStandalone = () => {
  try {
    return window.matchMedia?.("(display-mode: standalone)")?.matches === true
      || window.navigator?.standalone === true;
  } catch { return false; }
};

const isIOS = () => {
  try {
    const ua = navigator.userAgent || "";
    // iPadOS 13+ reports itself as a Mac; the touch-point count is the
    // usual way to tell an iPad from a trackpad Mac.
    return /iP(hone|ad|od)/.test(ua)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  } catch { return false; }
};

const prefersRedirect = () => isIOS() && isStandalone();

// Popup failures that are worth retrying as a redirect rather than showing
// to the user. `popup-blocked` is a blocker extension or a browser that
// wanted a more direct gesture; `operation-not-supported-in-this-environment`
// is a webview with no popup support at all.
const REDIRECT_FALLBACK = new Set([
  "auth/popup-blocked",
  "auth/operation-not-supported-in-this-environment",
  "auth/web-storage-unsupported",
]);

// The user closing the Google window is not an error to report back — it
// is them changing their mind, and a red banner for it reads as a fault.
const CANCELLED = new Set([
  "auth/popup-closed-by-user",
  "auth/cancelled-popup-request",
  "auth/user-cancelled",
]);

export const isCancelled = (err) => CANCELLED.has(err?.code);

// Firebase's own messages are written for the developer ("The popup has
// been closed by the user before finalizing the operation"). These are
// written for a golfer standing on a tee box, and name the console setting
// to change where there is one, because the person reading it on their
// phone is usually also the person who can fix it.
const friendly = (err) => {
  const code = err?.code || "";
  switch (code) {
    case "auth/operation-not-allowed":
      return "That sign-in method isn't switched on for this app yet — Firebase console → Authentication → Sign-in method.";
    case "auth/unauthorized-domain":
      return `Sign-in isn't allowed from ${typeof location !== "undefined" ? location.hostname : "this domain"} — add it under Firebase console → Authentication → Settings → Authorized domains.`;
    case "auth/account-exists-with-different-credential":
      return "You already signed in here with the other button. Use the one you used the first time.";
    case "auth/network-request-failed":
      return "No connection — check signal and try again.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a minute and try again.";
    case "auth/internal-error":
      return "Sign-in failed on the way back. Try again.";
    default:
      return err?.message?.replace(/^Firebase:\s*/, "") || "Sign-in failed. Try again.";
  }
};

// ── Signing in ──────────────────────────────────────────────────────
// Resolves with the signed-in user, or with null when the browser is being
// navigated away for the redirect flow (in which case this page is about
// to be replaced and there is nothing to render). Rejects with an Error
// carrying a human `message` plus the original `code`.
export async function signIn(providerId) {
  const auth = await authReady();
  const provider = makeProvider(providerId);
  const fail = (e) => {
    const out = new Error(friendly(e));
    out.code = e?.code;
    return out;
  };

  if (prefersRedirect()) {
    try { await signInWithRedirect(auth, provider); return null; }
    catch (e) { throw fail(e); }
  }

  try {
    const res = await signInWithPopup(auth, provider);
    return res?.user || null;
  } catch (e) {
    if (REDIRECT_FALLBACK.has(e?.code)) {
      try { await signInWithRedirect(auth, provider); return null; }
      catch (e2) { throw fail(e2); }
    }
    throw fail(e);
  }
}

// The other half of the redirect flow, called once at startup. A pending
// redirect resolves into a signed-in user here; onAuthUser then fires with
// it like any other sign-in, so callers only need this to surface an ERROR
// that happened on the far side of the round trip — which would otherwise
// be invisible, the app simply showing the sign-in screen again.
export async function consumeRedirectResult() {
  try {
    const auth = await authReady();
    const res = await getRedirectResult(auth);
    return { user: res?.user || null, error: null };
  } catch (e) {
    if (isCancelled(e)) return { user: null, error: null };
    return { user: null, error: friendly(e) };
  }
}

// ── Watching the session ────────────────────────────────────────────
// Fires immediately with the restored user (or null) once the SDK has read
// its persisted state, and again on every sign-in and sign-out. The shape
// handed to the callback is deliberately small — App.jsx has no business
// with a Firebase User object, it needs an id and something to greet.
export function onAuthUser(cb) {
  let stop = () => {};
  let cancelled = false;
  authReady().then((auth) => {
    if (cancelled) return;
    stop = onAuthStateChanged(auth, (u) => {
      cb(u ? {
        uid: u.uid,
        email: u.email || null,
        displayName: u.displayName || null,
        photoURL: u.photoURL || null,
        provider: u.providerData?.[0]?.providerId || null,
      } : null);
    }, (e) => {
      console.error("[auth] state listener", e);
      cb(null);
    });
  });
  return () => { cancelled = true; stop(); };
}

export async function signOutUser() {
  try { await signOut(await authReady()); }
  catch (e) { console.error("[auth] signOut", e); }
}

// Which button someone used, for the admin roster. providerData gives
// "google.com" / "apple.com"; the roster wants a word.
export const providerLabel = (providerId) =>
  providerId === "apple.com" ? "Apple" : providerId === "google.com" ? "Google" : "account";
