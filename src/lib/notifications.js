// ══════════════════════════════════════════════════════════════════
//  notifications — the client half of push.
// ══════════════════════════════════════════════════════════════════
//
// Ported from the MnQ golf league app, minus its native (Capacitor) branch:
// the Bourbon Cup ships as a web app and an iOS home-screen PWA, and there
// is no WebView build to serve. Everything here is the web path.
//
// The lifecycle, in order:
//   1. register the service worker (public/firebase-messaging-sw.js)
//   2. ask permission — from a user gesture, or iOS Safari ignores it
//   3. get an FCM token for this browser
//   4. store it in bc_notification_tokens so the Cloud Functions can aim
//   5. render foreground messages, which FCM does NOT do for you
//   6. unsubscribe — revoke at FCM, delete the row
//
// ONE ROW PER (PLAYER, DEVICE). A player with a phone and a laptop has two,
// added and revoked independently, and the functions fan out to all of
// them. That is also why the doc id hashes the token: FCM tokens are ~160
// characters, which is not a document id anyone wants to look at.
//
// WHAT A TOKEN IS. A send-to address for one browser, not a credential —
// holding it lets you push a notification to that device and nothing else.
// It is stored in a world-readable collection, like everything in this app
// (see firestore.rules), and that is the trade the app has always made.
//
// EDITIONS. Tokens are deliberately NOT edition-scoped. A push subscription
// belongs to a person's phone, not to a tournament year, and switching
// editions should not silently unsubscribe the field. `bc_notification_tokens`
// is therefore absent from EDITION_DATA_COLS in lib/editions.
//
// MODULE LOAD POLICY. firebase/messaging is imported DYNAMICALLY inside the
// functions that need it, never at the top of this file. A synchronous
// import can fail outright on iOS Safari below 16.4 and in any non-secure
// context, and that failure would take the whole importing chunk with it.
// Dynamic imports keep it contained to the call.

// ── The native branch is back, on both platforms ────────────────────
// The note above says this file was ported from MnQ minus its Capacitor
// branch, because the Bourbon Cup shipped as a web app and an iOS
// home-screen PWA. It now ships as a Capacitor app on iOS AND Android, and a
// webview has none of the lifecycle above: no service worker, no Notification
// API, no Web Push, and a meaningless VAPID key. Apple leaves all of it out of
// WKWebView on purpose, so that a native app uses APNs.
//
// So each exported function below forks. The native side goes through
// @capacitor-firebase/messaging, which returns an **FCM token** on both
// platforms — swizzling APNs underneath on iOS, and talking to FCM directly on
// Android. That is the detail that keeps this cheap: the row written to
// `bc_notification_tokens` has one shape, `sendToPlayer` in functions/index.js
// sends one way, and there is no second delivery path to keep in step.
// See docs/app-store.md §2.2 and docs/play-store.md.
//
// WHAT CHANGED WHEN ANDROID STOPPED BEING A TWA. A Trusted Web Activity is a
// browser: `isNative()` was false inside it and it took the web path above,
// which worked. Now it does not, and the difference matters in `writeTokenRow`
// — see the note on `platform` there.
import { db, TOURNAMENT_ID, getMessagingInstance } from "../firebase";
import { normalizeTypePrefs } from "./notificationTypes";
import { isNative, isNativeIOS, platformName } from "./platform";

// Re-exported so callers take the whole preference API off one module.
export { NOTIFICATION_TYPES, normalizeTypePrefs } from "./notificationTypes";

// ── VAPID public key ────────────────────────────────────────────────
// Firebase Console → Project Settings → Cloud Messaging → Web Push
// certificates → Generate key pair. The PUBLIC half goes here and is safe
// to commit (it ships to the browser either way); the private half stays
// with FCM and is never exposed.
//
// Until this is filled in, everything else in the app works and no push
// will ever fire — registerForPush returns a `vapid_key_missing` error that
// the settings page surfaces rather than failing silently.
const VAPID_PUBLIC_KEY = import.meta.env?.VITE_FCM_VAPID_KEY || "";

const TOKENS_COL = "bc_notification_tokens";

// ── Per-type preferences ────────────────────────────────────────────
// Which of the three pushes this player wants. The keys are the `type`
// values the Cloud Functions stamp into each payload's data block
// (functions/index.js), and they are the join between this file and the
// gate over there — rename one and the other silently stops matching, which
// is why they are listed here once rather than spelled out at each use.
//
// STORED ON THE TOKEN ROWS, one copy per device, rather than in a document
// of their own. Two reasons, and the second is the load-bearing one:
//
//   • `bc_notification_tokens` is already a collection a member may write
//     (see firestore.rules) — it is the one thing a player owns about their
//     own push. A new collection would need a new rule, and a preference
//     screen that cannot save until somebody deploys rules is worse than
//     no preference screen.
//   • sendToPlayer already has the token document in its hand when it
//     decides whether to send. Reading the preference off the row it is
//     already looking at means no second query per push and no way for the
//     two to disagree.
//
// Written to EVERY device of that player, so it reads as a personal
// preference rather than a per-device one — the same call the master
// unsubscribe makes.
//
// The keys and "absent means on" live in lib/notificationTypes, which is
// Firebase-free so both halves of that rule can be tested.

// Mirrored per device for the same reason the subscription status is: the
// token read is a Firestore round-trip, and three switches that paint ON and
// then flick OFF a moment later look broken.
const TYPES_CACHE_PREFIX = "bc_notif_types_";

export const getCachedTypePrefs = (playerId) => {
  if (!playerId || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(TYPES_CACHE_PREFIX + playerId);
    return raw ? normalizeTypePrefs(JSON.parse(raw)) : null;
  } catch { return null; }
};

const setCachedTypePrefs = (playerId, prefs) => {
  if (!playerId || typeof localStorage === "undefined") return;
  try { localStorage.setItem(TYPES_CACHE_PREFIX + playerId, JSON.stringify(prefs)); } catch { /* private mode */ }
};

// The server's answer, off any one of this player's token rows — they are
// written together and therefore agree. Null when the read failed or there
// is nothing registered, so a caller can keep showing the cached answer
// instead of resetting somebody's switches on a dropped connection.
export const readTypePrefs = async (playerId) => {
  if (!playerId) return null;
  try {
    const docs = await db.getStrict(TOKENS_COL, [{ field: "player_id", op: "==", value: playerId }]);
    const withTypes = docs.find(d => d.types) || docs[0];
    if (!withTypes) return null;
    const prefs = normalizeTypePrefs(withTypes.types);
    setCachedTypePrefs(playerId, prefs);
    return prefs;
  } catch (e) {
    console.warn("readTypePrefs failed:", e);
    return null;
  }
};

// Cache first, then every device. The cache is what makes the preference
// survive turning push off and back on: with no token rows there is nowhere
// on the server to keep it, and registerForPush reads it back out when a new
// token is minted. So a player who muted "a round is final", switched
// notifications off for a week and switched them back on stays muted.
export const saveTypePrefs = async (playerId, prefs) => {
  const clean = normalizeTypePrefs(prefs);
  setCachedTypePrefs(playerId, clean);
  if (!playerId) return { ok: false, error: "missing playerId" };
  try {
    const docs = await db.getStrict(TOKENS_COL, [{ field: "player_id", op: "==", value: playerId }]);
    const writes = await Promise.all(docs.map(d => db.upsert(TOKENS_COL, { id: d.id, types: clean })));
    // A refused write returns null from upsert, and silence here is the
    // failure this screen must not have: a switch that stays where it was
    // put while the push keeps arriving.
    if (writes.some(w => w === null)) return { ok: false, error: "Couldn't save that — try again" };
    return { ok: true };
  } catch (e) {
    console.warn("saveTypePrefs failed:", e);
    return { ok: false, error: e?.message || "Couldn't save that — try again" };
  }
};

// ── Permission state ────────────────────────────────────────────────
//   "unsupported" — no Notification API or no service worker
//   "default"     — never asked
//   "granted"     — yes
//   "denied"      — no, and the browser will not re-prompt; the user has to
//                   undo it in their own settings
//
// ── Why native needs a cache to answer a synchronous question ───────
// Two screens read this during render, so it has to stay synchronous. The
// browser can do that because `Notification.permission` is a property. iOS
// cannot: the plugin's checkPermissions() is a round trip to the OS.
//
// So the native answer is cached, seeded by `refreshPermissionState()` and
// re-stamped by every call below that could have changed it. It starts at
// "default", which is the honest answer before anybody has asked, and is
// also what the browser says in the same situation.
let _nativePermission = "default";

const NATIVE_PERMISSION = {
  granted: "granted",
  denied: "denied",
  prompt: "default",
  "prompt-with-rationale": "default",
};

export const getNotificationPermissionState = () => {
  if (isNative()) return _nativePermission;
  if (typeof window === "undefined") return "unsupported";
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return "unsupported";
  return Notification.permission;
};

// Bring the cache up to date and hand back the result. On the web this is
// the same synchronous read wrapped in a promise, so a caller can await it
// unconditionally rather than branching on platform itself.
export const refreshPermissionState = async () => {
  if (!isNative()) return getNotificationPermissionState();
  try {
    const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
    const { receive } = await FirebaseMessaging.checkPermissions();
    _nativePermission = NATIVE_PERMISSION[receive] || "default";
  } catch (e) {
    console.warn("[push] native checkPermissions:", e?.message || e);
  }
  return _nativePermission;
};

// ── Service worker ──────────────────────────────────────────────────
// Idempotent, and the registration is cached because getToken needs the
// same one. Registered at the root scope so it controls the whole app.
//
// Returns `{ error }` rather than throwing, so the settings page can say
// WHY. The usual failure is a 404 — the file did not get deployed — and
// "couldn't enable notifications" is a much worse message than that.
let _swRegistration = null;
const registerServiceWorker = async () => {
  if (_swRegistration) return _swRegistration;
  if (!("serviceWorker" in navigator)) return { error: "This browser has no service worker support" };
  try {
    _swRegistration = await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
    return _swRegistration;
  } catch (e) {
    const detail = e?.message || String(e);
    console.error("Service worker registration failed:", detail, e);
    return { error: detail };
  }
};

// ── Register ────────────────────────────────────────────────────────
// Returns { success, state, error? }. Call it from a tap: iOS Safari
// suppresses a requestPermission() that no gesture asked for.
//
// ── The row, written once for both platforms ────────────────────────
// The web path and the native path differ entirely in how they get a token
// and not at all in what they do with it. Pulled out here so that stays
// true: a field added for one platform cannot be forgotten on the other,
// and `sendToPlayer` in functions/index.js only ever sees one shape.
//
// The device context is a point-in-time snapshot, kept because the one
// support question this feature generates is "why didn't I get it" and the
// answer used to be "iOS, not installed to the home screen". On the native
// build that answer is gone — it is always installed, and `platform` says
// which kind of thing wrote the row.
const writeTokenRow = async (playerId, token) => {
  const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
  await db.upsert(TOKENS_COL, {
    id: `p${playerId}_${await sha256Short(token)}`,
    player_id: playerId,
    token,
    // Stamped for the record, not for filtering — a token is not
    // edition-scoped and the functions never query on this.
    registered_for: TOURNAMENT_ID,
    user_agent: ua.slice(0, 200),
    // `platformName()` rather than `isNative()`. These two lines said "native
    // means iOS", which was true for exactly as long as the Android app was a
    // Trusted Web Activity — a browser, which reported itself as web. Android
    // is a Capacitor app now, so that shorthand would have filed every Android
    // phone as an iPhone, in the one field somebody would consult to work out
    // why a push did not arrive.
    is_ios: isNativeIOS() || (!isNative() && /iPhone|iPad|iPod/.test(ua)),
    is_standalone: isNative() ? true : isStandalonePWA(),
    // "web" for a browser, "ios" or "android" for a store build. The field
    // that answers "which build is this man actually carrying" without
    // inferring it from a user-agent string.
    platform: platformName(),
    registered_at: Date.now(),
    last_seen_at: Date.now(),
    // Carried onto the new row from this device's cache, so a player who
    // muted a type before switching push off is still muted when they
    // switch it back on. All-on when nothing was ever chosen, which is what
    // a first-time subscriber means by tapping the switch.
    types: normalizeTypePrefs(getCachedTypePrefs(playerId)),
  });
  setCachedSubscriptionStatus(playerId, true);
};

// The native half asks the OS and then asks FCM, and that is the whole of
// it: no service worker to register, no VAPID key to be missing, and no
// "install it to the home screen first" — it IS installed.
const nativeRegister = async (playerId) => {
  let FirebaseMessaging;
  try {
    ({ FirebaseMessaging } = await import("@capacitor-firebase/messaging"));
  } catch (e) {
    return { success: false, state: "error", error: e?.message || "messaging plugin unavailable" };
  }

  let receive;
  try {
    // Returns the existing answer without prompting if one was already
    // given, exactly like Notification.requestPermission().
    ({ receive } = await FirebaseMessaging.requestPermissions());
  } catch (e) {
    return { success: false, state: "error", error: e?.message || String(e) };
  }
  _nativePermission = NATIVE_PERMISSION[receive] || "default";
  if (_nativePermission !== "granted") return { success: false, state: _nativePermission };

  let token;
  try {
    ({ token } = await FirebaseMessaging.getToken());
  } catch (e) {
    // The overwhelmingly likely cause, and the one worth naming: no APNs
    // authentication key uploaded to Firebase → Project Settings → Cloud
    // Messaging. Without it iOS hands over an APNs token that FCM cannot
    // exchange, and every send silently no-ops.
    console.error("[push] native getToken failed:", e);
    return { success: false, state: "error", error: e?.message || String(e) };
  }
  if (!token) return { success: false, state: "no_token" };

  await writeTokenRow(playerId, token);
  return { success: true, state: "granted", token };
};

export const registerForPush = async (playerId) => {
  if (!playerId) return { success: false, state: "error", error: "missing playerId" };
  if (isNative()) return nativeRegister(playerId);
  if (getNotificationPermissionState() === "unsupported") return { success: false, state: "unsupported" };

  let permission;
  try {
    permission = await Notification.requestPermission();
  } catch (e) {
    return { success: false, state: "error", error: e.message };
  }
  // Already-granted returns "granted" immediately; a prior denial returns
  // "denied" without prompting, which the settings page explains rather
  // than retrying.
  if (permission !== "granted") return { success: false, state: permission };

  const reg = await registerServiceWorker();
  if (!reg || reg.error) {
    return { success: false, state: "error", error: reg?.error ? `Service worker: ${reg.error}` : "sw_registration_failed" };
  }

  const messaging = await getMessagingInstance();
  if (!messaging) return { success: false, state: "unsupported" };

  if (!VAPID_PUBLIC_KEY) {
    console.warn("[push] VITE_FCM_VAPID_KEY is not set — no push will fire");
    return { success: false, state: "error", error: "vapid_key_missing" };
  }

  let token;
  try {
    const { getToken } = await import("firebase/messaging");
    token = await getToken(messaging, { vapidKey: VAPID_PUBLIC_KEY, serviceWorkerRegistration: reg });
  } catch (e) {
    console.error("FCM getToken failed:", e);
    return { success: false, state: "error", error: e.message };
  }
  if (!token) return { success: false, state: "no_token" };

  await writeTokenRow(playerId, token);
  return { success: true, state: "granted", token };
};

// ── Subscription status ─────────────────────────────────────────────
// Distinct from permission, which stays "granted" forever once given and
// cannot tell you whether the user later switched notifications off in the
// app. The presence of a token row is the real answer.
//
// Returns null when the READ failed, so a caller can leave its state alone
// instead of treating a dropped connection as "not subscribed" — hence
// getStrict rather than get.
export const checkSubscriptionStatus = async (playerId) => {
  if (!playerId) return false;
  try {
    const docs = await db.getStrict(TOKENS_COL, [{ field: "player_id", op: "==", value: playerId }]);
    const subscribed = docs.length > 0;
    setCachedSubscriptionStatus(playerId, subscribed);
    return subscribed;
  } catch (e) {
    console.warn("checkSubscriptionStatus failed:", e);
    return null;
  }
};

// The Firestore round-trip above takes a few hundred ms on a cold start,
// and anything that renders "you're not subscribed" in the meantime flashes
// at a user who is. The last known answer is mirrored per-device so that UI
// starts from the truth and only corrects itself if the server disagrees.
//
// Per player rather than global: this app switches identity on a shared
// device more than most, and the answer is genuinely per (device, player).
const SUB_CACHE_PREFIX = "bc_notif_sub_";

// true / false / null — null meaning "no cached answer on this device".
export const getCachedSubscriptionStatus = (playerId) => {
  if (!playerId || typeof localStorage === "undefined") return null;
  try {
    const v = localStorage.getItem(SUB_CACHE_PREFIX + playerId);
    return v === "1" ? true : v === "0" ? false : null;
  } catch { return null; }
};

const setCachedSubscriptionStatus = (playerId, subscribed) => {
  if (!playerId || typeof localStorage === "undefined") return;
  try { localStorage.setItem(SUB_CACHE_PREFIX + playerId, subscribed ? "1" : "0"); } catch { /* private mode */ }
};

// ── Unsubscribe ─────────────────────────────────────────────────────
// Both halves, both best-effort: revoke at FCM so the endpoint stops
// accepting, and delete the rows so the functions stop trying. Every device
// for this player goes, not just this one — the toggle reads as a personal
// preference, not a per-device one, and MnQ made the same call.
export const unsubscribeFromPush = async (playerId) => {
  if (isNative()) {
    try {
      const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
      await FirebaseMessaging.deleteToken();
    } catch (e) { console.warn("native deleteToken failed:", e?.message || e); }
  } else {
    const messaging = await getMessagingInstance();
    if (messaging) {
      try {
        const { deleteToken } = await import("firebase/messaging");
        await deleteToken(messaging);
      } catch (e) { console.warn("deleteToken failed:", e); }
    }
  }
  if (playerId) {
    const docs = await db.get(TOKENS_COL, [{ field: "player_id", op: "==", value: playerId }]);
    await Promise.all(docs.map(d => db.delete(TOKENS_COL, d.id)));
    setCachedSubscriptionStatus(playerId, false);
  }
  return { success: true };
};

// ── Foreground messages ─────────────────────────────────────────────
// FCM splits delivery: with the tab open and focused, onMessage fires
// INSTEAD OF the service worker's onBackgroundMessage, and nothing is
// displayed. Re-rendering it here is what makes "a push always shows a
// notification" true regardless of what the app was doing.
//
// Call once, on mount.
let _foregroundUnsub = null;
export const initForegroundNotifications = async () => {
  if (_foregroundUnsub) return;
  // Native needs none of this, and that is a real difference rather than a
  // gap. iOS decides whether a notification is shown while the app is in
  // the foreground from `presentationOptions` in capacitor.config.json, and
  // it draws the banner itself. Re-rendering it here would show it twice.
  if (isNative()) return;
  const messaging = await getMessagingInstance();
  if (!messaging) return;
  // The SW registration is needed to display; if push was never enabled on
  // this device there is nothing to attach to and nothing to display either.
  if (!_swRegistration) {
    const reg = await registerServiceWorker();
    if (!reg || reg.error) return;
  }
  const { onMessage } = await import("firebase/messaging");
  _foregroundUnsub = onMessage(messaging, (payload) => {
    const data = payload.data || {};
    const title = data.title || payload.notification?.title || "The Bourbon Cup";
    const body = data.body || payload.notification?.body || "";
    // showNotification off the registration, not `new Notification(...)` —
    // the latter is restricted or outright ignored in several browsers.
    _swRegistration?.showNotification(title, {
      body,
      icon: "/favicon/web-app-manifest-192x192.png",
      badge: "/favicon/web-app-manifest-192x192.png",
      data,
      tag: data.type || "default",
      renotify: true,
    });
  });
};

// ── App badge ───────────────────────────────────────────────────────
// The badge means PENDING ACTIONS, not unread messages: it is the count of
// cards this player still owes an attestation on. So it is not cleared by
// reading a notification or opening the app — only by doing the thing.
//
// The service worker owns the canonical count (it survives SW restarts in
// IndexedDB and increments on a background push), so the app tells it what
// the truth is rather than setting the badge behind its back. That keeps a
// later background increment counting up from the right number.
//
// ── Native, and the one thing it cannot do ──────────────────────────
// `navigator.setAppBadge` does not exist in a WKWebView and there is no
// service worker to postMessage to, so native goes through the Badge plugin
// instead. What it does NOT do is the service worker's other job: increment
// on a background push. iOS runs no JavaScript for this app while it is
// closed, so a card signed overnight does not move the badge until the app
// is next opened, at which point the live subscription recomputes and this
// is called with the true number.
//
// The alternative was an absolute badge count in the APNs payload, set by
// `sendToPlayer` in functions/index.js. It was rejected on purpose. That
// count would be a SECOND implementation of "what does this player still
// owe" — `pendingAttestations` in lib/cardSigs is the first — and the two
// would be scoped differently the moment either changed, which surfaces as
// a badge that jumps to a different number when the app opens. A badge that
// is late is a smaller lie than a badge that disagrees with the screen
// behind it.
export const syncAppBadge = async (count) => {
  const n = Math.max(0, count | 0);
  if (isNative()) {
    try {
      const { Badge } = await import("@capawesome/capacitor-badge");
      // The badge permission rides along with the notification one, so a
      // player who never enabled push has nothing to set and this throws.
      // Swallowed: a missing badge is not worth a console error a round.
      if (n > 0) await Badge.set({ count: n });
      else await Badge.clear();
    } catch { /* no permission, or no badge on this OS */ }
    return;
  }
  if (typeof navigator === "undefined") return;
  try {
    if (n > 0) await navigator.setAppBadge?.(n);
    else await navigator.clearAppBadge?.();
  } catch { /* unsupported, or not installed */ }
  navigator.serviceWorker?.controller?.postMessage({ type: "SET_BADGE", count: n });
};

// ── Environment ─────────────────────────────────────────────────────
// iOS grants push only to an app launched from the home screen, never to a
// Safari tab. This drives the "install it first" onboarding.
export const isStandalonePWA = () => {
  // The native build is not a PWA and is not standalone in the sense this
  // function was written to test — but every caller uses it to ask "can this
  // thing receive a push", and the App Store build is the one case where the
  // answer is unconditionally yes.
  if (isNative()) return true;
  if (typeof window === "undefined") return false;
  return (
    window.navigator.standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true
  );
};

// Push on iOS needs 16.4+. Below that no amount of installing helps and the
// onboarding should say so instead of walking someone through a dead end.
export const isIOSPushCapable = () => {
  // The 16.4 floor is Safari's Web Push floor. The native build does not use
  // Web Push at all — it uses APNs, which every iOS this app's deployment
  // target allows supports — so the version check does not apply to it.
  if (isNative()) return true;
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (!/iPhone|iPad|iPod/.test(ua)) return true;   // everyone else is pre-qualified
  const m = ua.match(/OS (\d+)_(\d+)/);
  if (!m) return false;
  const [major, minor] = [parseInt(m[1], 10), parseInt(m[2], 10)];
  return major > 16 || (major === 16 && minor >= 4);
};

// First 8 bytes of SHA-256, hex. 64 bits is far more than enough to keep a
// dozen friends' devices from colliding, and it turns a 160-character token
// into something you can read in the Firestore console.
const sha256Short = async (input) => {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).slice(0, 8)
    .map(b => b.toString(16).padStart(2, "0")).join("");
};
