// ══════════════════════════════════════════════════════════════════
//  swRegister — putting the app's own code on the phone.
// ══════════════════════════════════════════════════════════════════
//
// Ported from WBC. The worker at /firebase-messaging-sw.js has two jobs:
// background pushes, and holding the app shell on disk so a cold start out of
// range opens instead of hanging (see public/sw-cache-rules.js).
//
// It used to be registered only by lib/notifications.js, when somebody
// switched notifications ON — so the caching half reached the handful of
// people who wanted push and nobody else. This registers it for everyone.
// Both call sites name the same script and the same scope, which makes
// register() idempotent: whichever runs first wins and the other is handed
// the same registration back.
//
// SCOPE, and why there is only one worker: a scope has exactly one
// registration, and registering a different script at "/" REPLACES what is
// there. A separate caching worker would have silently turned push off for
// everybody who had it on. Hence one file doing both.

export const SW_URL = "/firebase-messaging-sw.js";
export const SW_SCOPE = "/";

// ── Whether this device should have one at all ────────────────────
// Pure, so the three answers that are easy to get wrong can be tested.
//
//   dev     — Vite serves modules unbundled and reloads them constantly. A
//             worker caching that is a worker serving yesterday's code back
//             to whoever is editing it.
//   native  — the Capacitor builds read their assets out of the app bundle,
//             off local storage, with no network in the path. There is
//             nothing for a cache to save and a worker only adds a way for it
//             to go wrong. See lib/platform.
//   http    — service workers require a secure context. localhost counts as
//             one, which is what keeps `npm run preview` testable.
export function shouldRegisterSW({
  supported = false,
  isProd = false,
  isNative = false,
  protocol = "",
  hostname = "",
} = {}) {
  if (!supported) return false;
  if (!isProd) return false;
  if (isNative) return false;
  const secure = protocol === "https:" || hostname === "localhost" || hostname === "127.0.0.1";
  return secure;
}

// Fire and forget. A registration that fails costs this launch nothing — the
// app has just loaded every one of these files over the network, which is
// what it would have done anyway — so there is nothing here worth surfacing
// to somebody trying to read a leaderboard.
export async function registerAppServiceWorker(env = {}) {
  const {
    supported = typeof navigator !== "undefined" && "serviceWorker" in navigator,
    isProd = true,
    isNative = false,
    protocol = typeof location !== "undefined" ? location.protocol : "",
    hostname = typeof location !== "undefined" ? location.hostname : "",
    register = (url, opts) => navigator.serviceWorker.register(url, opts),
  } = env;

  if (!shouldRegisterSW({ supported, isProd, isNative, protocol, hostname })) return null;
  try {
    return await register(SW_URL, { scope: SW_SCOPE });
  } catch (e) {
    console.warn("[sw] registration skipped:", e?.message || e);
    return null;
  }
}
