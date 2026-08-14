// ══════════════════════════════════════════════════════════════════
//  platform — the one place that knows the app is running natively.
// ══════════════════════════════════════════════════════════════════
//
// Three of the four things `docs/app-store.md` §2 lists as broken inside a
// WKWebView are broken for the same underlying reason: a Capacitor build
// runs from `capacitor://localhost` and not from `https://thebourboncup.com`.
// Google refuses OAuth to an embedded webview, there is no service worker
// so no Web Push, and every relative `/api` fetch resolves against the app
// bundle instead of Vercel.
//
// Every one of those needs the same question answered — "are we native?" —
// and answering it in five files is how the five answers drift. So it is
// answered here, once, and the branches elsewhere read from this module.
//
// ── The rule this file exists to enforce ────────────────────────────
// EVERYTHING HERE IS A NO-OP ON THE WEB. The web app and the TWA are the
// production app for the whole field; the iOS build does not exist yet.
// Not one of these functions may change what a browser does, and the
// no-op has to be the DEFAULT branch rather than a case somebody
// remembered — which is why each one tests `isNative()` and falls through
// to the behaviour that was already there.
//
// ── Why the plugins are imported dynamically ────────────────────────
// `@capacitor/core` is imported at the top because it is small, it is the
// supported way to ask the question, and reading `window.Capacitor`
// by hand is the same thing with a typo in it. The PLUGINS are not: each
// one registers itself on import and ships a web shim that the browser
// build would carry for nothing. Loading them inside the native branch
// keeps them out of the web bundle entirely, and Vite gives each its own
// chunk that is never fetched off a phone in Safari.
import { Capacitor } from "@capacitor/core";

// ── The question ────────────────────────────────────────────────────
// Synchronous, because callers need it to pick a branch before they can
// know whether to await anything. `isNativePlatform()` reads a global the
// native runtime injects before any of our code evaluates, so there is no
// window in which this answers wrongly.
export const isNative = () => {
  try { return Capacitor.isNativePlatform() === true; } catch { return false; }
};

// "ios" | "android" | "web". Android is listed for completeness and is not
// expected: the Android app is a Trusted Web Activity, which is a browser
// and reports itself as "web" (see docs/play-store.md).
export const platformName = () => {
  try { return Capacitor.getPlatform() || "web"; } catch { return "web"; }
};

export const isNativeIOS = () => isNative() && platformName() === "ios";

// ── Where /api lives ────────────────────────────────────────────────
// On the web this is the empty string, so `fetch("/api/ghin")` stays the
// same-origin relative call it has always been: in production that is
// Vercel serving the function next to the app, and in `npm run dev` it is
// the proxy in vite.config.js. Neither changes.
//
// A native build has no such origin. `fetch("/api/ghin")` there resolves
// against `capacitor://localhost/api/ghin`, which is a path inside the app
// bundle, and comes back 404 — not as a network error, which is what makes
// it hard to recognise. So native gets an absolute base pointing at the
// deployed site, where the functions and their credentials already live.
//
// Overridable for the same reason `VITE_API_PROXY` is: pointing a device
// build at `vercel dev` on a laptop is the only way to exercise a change to
// `api/*.js` itself.
export const API_BASE = isNative()
  ? (import.meta.env?.VITE_API_BASE || "https://thebourboncup.com")
  : "";

// Join a repo-relative API path onto whichever base applies. Takes the path
// exactly as it was written before this module existed — leading slash and
// all — so a call site changes from `fetch(\`/api/ghin?…\`)` to
// `fetch(apiUrl(\`/api/ghin?…\`))` and nothing else.
export const apiUrl = (path) => `${API_BASE}${path}`;

// ── Leaving the app ─────────────────────────────────────────────────
// A plain `target="_blank"` anchor opens INSIDE the webview on native, with
// no address bar, no back button and no way out but killing the app. It is
// also precisely the "repackaged website" tell guideline 4.2 is looking
// for. Trip Info's house link is the only one today.
//
// On the web this is `window.open`, which is what the anchor was already
// doing — so the anchor stays a real anchor and this only preempts it when
// there is something to preempt.
export const openExternal = async (url) => {
  if (!url) return;
  if (!isNative()) {
    try { window.open(url, "_blank", "noopener,noreferrer"); } catch { /* popup blocked */ }
    return;
  }
  try {
    const { Browser } = await import("@capacitor/browser");
    // presentationStyle popover keeps the app visible behind the sheet, so
    // "swipe down to come back" is discoverable without a hint.
    await Browser.open({ url, presentationStyle: "popover" });
  } catch (e) {
    console.warn("[platform] external open failed:", e?.message || e);
  }
};

// ── Haptics ─────────────────────────────────────────────────────────
// Native feel that a web app cannot have, and one of the things App Review
// notices in the first ten seconds of tapping (docs/app-store.md §3).
// Deliberately fire-and-forget: a score must post whether or not the taptic
// engine answered, so nothing here is ever awaited by a caller and every
// failure is swallowed.
//
// `light` is for a value changing under a thumb — a stroke going up or
// down — and it fires many times in a row while somebody spins to a 6.
// `success` is for a thing that is now done and cannot be un-done by the
// next tap: a signed card, a posted score.
const impact = async (style) => {
  if (!isNative()) return;
  try {
    const { Haptics, ImpactStyle, NotificationType } = await import("@capacitor/haptics");
    if (style === "success") await Haptics.notification({ type: NotificationType.Success });
    else await Haptics.impact({ style: ImpactStyle.Light });
  } catch { /* no taptic engine, or a web shim that declines */ }
};

export const tapFeedback = () => { void impact("light"); };
export const commitFeedback = () => { void impact("success"); };

// ── Status bar and keyboard ─────────────────────────────────────────
// index.html carries a long comment about `apple-mobile-web-app-status-bar-
// style` having to stay "black", with numbers measured off an iPhone 16 Pro.
// Every tag in that block is a Safari home-screen mechanism and NONE of them
// do anything inside a WKWebView — see docs/app-store.md §2.4. This is the
// native restatement of the same decision: an opaque bar in the app's own
// background colour, with the web view starting below it, which is what made
// the nav reach the physical bottom edge.
//
// `overlaysWebView: false` is also set in capacitor.config.json. It is set
// twice on purpose: the config value applies at launch, and this call is
// what re-applies it whenever the theme pill in My Account is flipped —
// the app has a light mode, and white text on a near-white bar is a status
// bar with nothing legible in it.
//
// Capacitor's `Style.Dark` means LIGHT TEXT for a dark background, and
// `Style.Light` means dark text for a light one. The names read backwards
// from every other use of the words in this codebase, which is why the call
// below is written from `darkMode` rather than passed a style.
export const applyNativeChrome = async (darkMode = true) => {
  if (!isNative()) return;
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setStyle({ style: darkMode ? Style.Dark : Style.Light });
    // Android-only in Capacitor; harmless on iOS, where the bar takes the
    // colour of what is behind it and the web view starts below it.
    await StatusBar.setBackgroundColor({ color: darkMode ? "#0a0a0b" : "#fafaf9" });
  } catch (e) {
    console.warn("[platform] status bar:", e?.message || e);
  }
};
