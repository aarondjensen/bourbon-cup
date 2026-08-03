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
  getAuth,
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

// ── The auth instance, and why nothing is awaited to get it ─────────
// `getAuth` is synchronous, and it already installs exactly the
// persistence this app wants: [indexedDB, localStorage, session], tried in
// that order. An explicit setPersistence used to sit here saying the same
// thing — and cost a home-screen install its first sign-in every time.
//
// The reason is user activation. iOS lets a page call window.open only
// inside the gesture that asked for it, and that permission does not
// survive a real trip to disk or the network. Awaiting setPersistence
// meant opening IndexedDB — on a fresh install, creating it — before the
// popup call was ever reached, by which point the tap had expired and
// Safari refused the window. The second tap worked because the promise
// was already resolved and the wait collapsed to a microtask, which
// activation does survive. Hence: fails once, works after.
//
// So this is sync, and signIn() calls signInWithPopup with nothing awaited
// in front of it.
let _auth = null;
export const authInstance = () => (_auth ||= getAuth(firebaseApp));

// ── Warming up ──────────────────────────────────────────────────────
// The SDK has an await of its own that no amount of care here can remove:
// signInWithPopup does `await resolver._initialize(auth)` before opening
// the window, and that initialize loads the auth iframe over the network.
// On a phone that has just installed the app, nothing is cached and that
// is a real round trip — so the popup would open long after the tap, and
// be blocked, exactly as before.
//
// It only happens once per page load, though, so the fix is to make it
// happen while the user is still reading the screen instead of when they
// tap. getRedirectResult drives the same _initialize, and the app has to
// call it at startup anyway to collect a pending redirect. One call, kicked
// off at import: it warms the resolver AND answers the redirect question,
// and everything that needs either awaits the same promise.
let _warm = null;

const warmAuth = () => {
  if (_warm) return _warm;
  const attempted = takeRedirectMark();
  _warm = getRedirectResult(authInstance()).then(
    (res) => {
      if (res?.user) return { user: res.user, error: null };
      if (attempted) {
        // We sent them to the provider and got back nothing at all. On an
        // iOS home-screen install this is storage partitioning: the handler
        // lives on another origin and Safari will not let it hand the result
        // back. Naming it beats another silent trip to the sign-in screen.
        return {
          user: null,
          error: "Sign-in came back empty. On an iPhone home-screen app this usually clears if you open the site in Safari instead — tell Aaron if it keeps happening.",
        };
      }
      return { user: null, error: null };
    },
    (e) => (isCancelled(e) ? { user: null, error: null } : { user: null, error: friendly(e) })
  );
  return _warm;
};

// Resolves once a popup can actually be opened inside a tap. The sign-in
// screen holds its buttons until then — a disabled button for a moment is
// a better answer than a tap that silently does nothing.
export const whenAuthReady = () => warmAuth().then(() => true);

// ── Popup or redirect ───────────────────────────────────────────────
// Popup is the better flow everywhere it works: the app never unloads, so
// there is no round trip through storage to resume, and Safari's storage
// partitioning never gets a say.
//
// Redirect is the one that bites, and it bit: from an iOS home-screen
// install it would come back from the auth handler with NO user and NO
// error — the app simply showed the sign-in screen again, twice in a row,
// with nothing to go on. Safari partitions storage per top-level origin,
// so a handler on <project>.firebaseapp.com cannot hand the result back to
// an app on thebourboncup.com.
//
// So popup is now tried FIRST everywhere, including the installed app,
// and redirect is only the fallback. That order used to be reversed on
// the assumption that a standalone iOS install cannot open a usable
// popup; on iOS 16.4+ it generally can, and when it cannot, `window.open`
// returns nothing and Firebase raises popup-blocked, which drops through
// to redirect below. Nothing is lost by trying.
//
// If redirect is ever reached on that platform it will still come back
// empty, which is what `markRedirect`/`consumeRedirectResult` exist to
// SAY rather than swallow. The permanent fix for it is to make the
// handler same-origin: set VITE_AUTH_DOMAIN=thebourboncup.com (the
// /__/auth rewrite in vercel.json already serves it), and add that
// handler URL to the OAuth client's authorized redirect URIs in Google
// Cloud and to the Services ID's return URLs at Apple. Both are required
// — miss either and sign-in breaks everywhere, not just here.
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

// The environment where a popup is least likely to survive, and where a
// "the user closed it" rejection is more likely to mean "it could not talk
// back to us" than an actual change of mind. Used only to decide whether
// that rejection is worth retrying as a redirect.
const popupIsFragile = () => isIOS() && isStandalone();

// ── Saying so when a redirect comes back empty ──────────────────────
// A redirect that returns with neither a user nor an error is the single
// most confusing failure this file can produce: the app looks like it just
// ignored you. sessionStorage survives the round trip (same tab, same
// origin) and nothing else does, so it is where the fact that a redirect
// was even attempted gets left.
const REDIRECT_MARK = "bc_auth_redirect";

const markRedirect = (providerId) => {
  try { sessionStorage.setItem(REDIRECT_MARK, providerId || "1"); } catch { /* blocked storage */ }
};

const takeRedirectMark = () => {
  try {
    const v = sessionStorage.getItem(REDIRECT_MARK);
    if (v) sessionStorage.removeItem(REDIRECT_MARK);
    return v;
  } catch { return null; }
};

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
// NOT async, and nothing is awaited before signInWithPopup — see the note
// on user activation above. Everything this needs (the auth instance, the
// provider) is built synchronously so the popup call happens inside the
// tap that asked for it.
export function signIn(providerId) {
  const auth = authInstance();
  const provider = makeProvider(providerId);
  const fail = (e) => {
    const out = new Error(friendly(e));
    out.code = e?.code;
    return out;
  };

  const viaRedirect = async () => {
    markRedirect(providerId);
    try { await signInWithRedirect(auth, provider); return null; }
    catch (e) { takeRedirectMark(); throw fail(e); }
  };

  return signInWithPopup(auth, provider).then((res) => res?.user || null, (e) => {
    // A popup this environment could never have opened, or — on the one
    // platform where a popup cannot reliably talk back — one that reported
    // itself closed. Neither is a reason to give up; both are a reason to
    // take the long way round.
    if (REDIRECT_FALLBACK.has(e?.code) || (popupIsFragile() && isCancelled(e))) return viaRedirect();
    throw fail(e);
  });
}

// The other half of the redirect flow, and the app's startup call. Both
// are the same promise now (see warmAuth): collecting a pending redirect
// is what initializes the resolver, so asking the question is also what
// makes the next popup openable. A SUCCESSFUL redirect needs nothing from
// the caller — the state listener fires with the new user like any other
// sign-in — but a failed one has no other way to be seen.
export const consumeRedirectResult = () => warmAuth();

// ── Watching the session ────────────────────────────────────────────
// Fires immediately with the restored user (or null) once the SDK has read
// its persisted state, and again on every sign-in and sign-out. The shape
// handed to the callback is deliberately small — App.jsx has no business
// with a Firebase User object, it needs an id and something to greet.
export function onAuthUser(cb) {
  let stop = () => {};
  let cancelled = false;
  // Not awaited on the instance (getAuth is synchronous), but deferred a
  // tick so the listener is registered after warmAuth has had the chance
  // to collect a pending redirect — the SDK reports that as an ordinary
  // sign-in, and registering first would have it arrive twice.
  Promise.resolve().then(() => {
    if (cancelled) return;
    stop = onAuthStateChanged(authInstance(), (u) => {
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
  try { await signOut(authInstance()); }
  catch (e) { console.error("[auth] signOut", e); }
}

// ── Telling Apple to forget us ──────────────────────────────────────
// Deleting the Firebase user is enough for the app: the uid is gone and
// nothing signs in as it again. It is NOT enough for Apple. An app that
// offers Sign in with Apple has to revoke the token when the account goes,
// or it stays listed forever under Settings → Apple Account → Sign in with
// Apple on a phone whose account it no longer holds — which is both a
// review item and, from the user's side, a deletion that did not take.
//
// The catch is the token. Apple's access token reaches us exactly once,
// inside the credential a sign-in hands back, and we do not store it —
// keeping an OAuth token around to use months later is the thing not to do.
// So revocation needs a FRESH authorization, which is what the reauth here
// is for. It is the only reason this function exists: the deletion itself
// runs through a Cloud Function on the admin SDK, which needs no recent
// login at all.
//
// Best-effort by construction. A blocked popup, a cancelled prompt, or a
// Google account (nothing to revoke) all return quietly and the caller
// deletes the account regardless — refusing to delete somebody's account
// because a popup would not open is the worse failure of the two.
export async function revokeProviderAccess() {
  const auth = authInstance();
  const u = auth.currentUser;
  if (!u) return { revoked: false, reason: "no_user" };
  // Google issues no token this call can revoke; Firebase's
  // revokeAccessToken supports Apple and nothing else today.
  if (u.providerData?.[0]?.providerId !== "apple.com") return { revoked: false, reason: "not_apple" };

  try {
    const { reauthenticateWithPopup, revokeAccessToken, OAuthProvider: OAP } =
      await import("firebase/auth");
    const res = await reauthenticateWithPopup(u, makeProvider("apple"));
    const token = OAP.credentialFromResult(res)?.accessToken;
    if (!token) return { revoked: false, reason: "no_token" };
    await revokeAccessToken(auth, token);
    return { revoked: true };
  } catch (e) {
    // Logged, never surfaced: the user asked to delete an account, not to
    // hear about Apple's token endpoint.
    console.warn("[auth] Apple token revocation skipped:", e?.code || e?.message || e);
    return { revoked: false, reason: e?.code || "failed" };
  }
}

// Which button someone used, for the admin roster. providerData gives
// "google.com" / "apple.com"; the roster wants a word.
export const providerLabel = (providerId) =>
  providerId === "apple.com" ? "Apple" : providerId === "google.com" ? "Google" : "account";

// Start the warm-up the moment this module is evaluated, not when a screen
// mounts or a button is tapped. On a phone that just installed the app,
// loading the auth iframe is a cold network fetch, and every millisecond
// of it that happens before the user's thumb arrives is a millisecond the
// popup is not waiting on.
warmAuth();
