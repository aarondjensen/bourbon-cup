// ══════════════════════════════════════════════════════════════════
//  sw-cache-rules.js — the app shell, kept on the phone.
// ══════════════════════════════════════════════════════════════════
//
// Ported from WBC. Pulled into firebase-messaging-sw.js with importScripts,
// because a scope can only have ONE service worker and that file already owns
// "/". Two registrations at the same scope do not coexist — the second
// REPLACES the first — so a separate caching worker would have silently turned
// push off for everybody who had it on. This is that worker's other job.
//
// ── What this buys ──
// Firestore already keeps its DATA on disk (see the persistent cache in
// src/firebase.js), so a relaunch out of range has the leaderboard's numbers.
// The CODE had no such thing: every cold start re-fetched whatever the HTTP
// cache had let go of, and an installed app on a course is cold-starting
// constantly — the screen locks, iOS evicts the tab, somebody opens the camera
// and comes back.
//
// ── Runtime caching, not a precache ──
// Nothing is fetched here that the page was not going to fetch anyway. There
// is no build-time manifest of hashed filenames to generate and keep in step;
// responses are simply kept as they fly past, and the next launch reads them
// off disk. The first visit therefore costs nothing extra, which matters when
// the first visit is the one happening on one bar in a car park.

(function (root) {
  // Two caches so the eviction below can be blunt about one and never touch
  // the other: the shell is a single entry that must survive, and the assets
  // cache is a pile of hashed files that accumulates across deploys.
  const SHELL_CACHE = "bc-shell-v1";
  const ASSET_CACHE = "bc-assets-v1";
  // Roughly three deploys' worth of chunks. Old builds' files are dead weight
  // the moment index.html stops naming them, and nothing ever asks for them
  // again — but nothing deletes them either, so this is what stops the cache
  // growing all season. Evicting the wrong one costs a single re-fetch.
  const MAX_ASSETS = 60;

  // The shell is stored under this one key rather than under the requesting
  // URL, so whatever path an installed app launches on gets the same document.
  const SHELL_KEY = "/";

  // ── The routing decision, kept pure so it can be tested ──────────
  // Everything this needs is passed in; it touches no globals and performs no
  // I/O. See src/lib/swCacheRules.test.js, which loads this file and drives it
  // directly — a service worker cannot be imported by a test, but a function
  // that only reads its arguments can be.
  //
  //   "bypass"        — do not touch the request at all
  //   "network-first" — the server's answer wins; fall back to disk offline
  //   "cache-first"   — disk wins; only fetch what is not already held
  function routeFor({ method = "GET", sameOrigin = true, mode = "", pathname = "", cacheMode = "" } = {}) {
    // A service worker may only answer GETs from a cache, and this app's
    // writes all go to Firestore anyway.
    if (method !== "GET") return "bypass";

    // Firestore, the auth domain, gstatic, the photo bucket. Not ours to hold,
    // and Firestore in particular does its own far better caching underneath.
    if (!sameOrigin) return "bypass";

    // ── The one that would have broken pull-to-refresh ──
    // hasNewBundle() asks for index.html with `cache: "no-store"` precisely to
    // get the truth, and diffs the hashed script names in it to decide whether
    // a new build has shipped. Answer that from a cache and an installed app —
    // which has no address bar to reload from — loses its only way of ever
    // picking up a deploy. `reload` is the same intent, spelled differently.
    // See src/lib/usePullToRefresh and hasNewBundle in App.jsx.
    if (cacheMode === "no-store" || cacheMode === "reload") return "bypass";

    // The service worker itself and the manifest decide what the installed app
    // IS. The browser re-reads both to notice an update, and a stale copy of
    // the worker is the one mistake with no way back — it would keep serving
    // the version it was, forever, on a device with no address bar. Never held.
    if (/(^\/|\/)([\w.-]*sw[\w.-]*\.js|site\.webmanifest|manifest\.json)$/.test(pathname)) return "bypass";

    // The app document, and ONLY the app document. Fresh whenever the network
    // can manage it, so a deploy is picked up on the next launch rather than
    // whenever the cache feels like it; from disk when it cannot, which is
    // what makes the app open at all out of range.
    //
    // The other .html files in /public — the privacy page, the account
    // deletion page, the /app download page — are deliberately NOT shell.
    // They are separate documents that happen to be same-origin, and storing
    // one of them under the shell key would serve the privacy page as the app
    // the next time somebody launched out of range.
    if (pathname === "/" || pathname === "/index.html") return "network-first";
    if (mode === "navigate") return "bypass";

    // Everything under /assets carries a content hash, so the bytes behind a
    // URL can never change — cache-first is not a staleness risk, it is the
    // whole point of hashing them. /favicon is pinned files a deploy does not
    // regenerate, and the loose images at the root are the logos, the trophy
    // and the silhouettes.
    if (/^\/(assets|favicon)\//.test(pathname)) return "cache-first";
    if (/\.(webp|png|svg|jpe?g|woff2?)$/.test(pathname)) return "cache-first";

    // Anything else same-origin — the legal stylesheet, whatever gets added
    // next — is left alone. A rule that guesses is how a cache ends up serving
    // something nobody meant it to.
    return "bypass";
  }

  // Which entries to drop to get back under the cap. Cache.keys() returns
  // insertion order, so the front of the list is the oldest thing held.
  function entriesToEvict(keys, max = MAX_ASSETS) {
    const over = (keys || []).length - max;
    return over > 0 ? keys.slice(0, over) : [];
  }

  root.BC_CACHE_RULES = { routeFor, entriesToEvict, SHELL_CACHE, ASSET_CACHE, SHELL_KEY, MAX_ASSETS };

  // ── Wiring ────────────────────────────────────────────────────────
  // Guarded so that loading this file in a test — where there is no service
  // worker scope to add listeners to — exercises the rules above and stops.
  if (typeof root.addEventListener !== "function" || typeof root.caches === "undefined") return;

  const trim = async (cache) => {
    try {
      const keys = await cache.keys();
      await Promise.all(entriesToEvict(keys).map(k => cache.delete(k)));
    } catch { /* a cache that will not tidy is not a reason to fail a fetch */ }
  };

  const cacheFirst = async (request) => {
    const hit = await caches.match(request);
    if (hit) return hit;
    const res = await fetch(request);
    // 200 only. A 206 is half a file, and an opaque cross-origin response
    // caches as a black box that can never be checked — neither belongs on
    // disk under a name the app will trust later.
    if (res && res.status === 200 && res.type === "basic") {
      const cache = await caches.open(ASSET_CACHE);
      await cache.put(request, res.clone());
      trim(cache);
    }
    return res;
  };

  const networkFirst = async (request) => {
    try {
      const res = await fetch(request);
      if (res && res.status === 200 && res.type === "basic") {
        const cache = await caches.open(SHELL_CACHE);
        await cache.put(SHELL_KEY, res.clone());
      }
      return res;
    } catch (e) {
      // Offline. The stored shell is a whole working app — its chunks are in
      // the asset cache and Firestore's own cache has the tournament.
      const shell = await caches.match(SHELL_KEY, { cacheName: SHELL_CACHE }) || await caches.match(request);
      if (shell) return shell;
      throw e;
    }
  };

  root.addEventListener("fetch", (event) => {
    let route;
    try {
      const url = new URL(event.request.url);
      route = routeFor({
        method: event.request.method,
        sameOrigin: url.origin === root.location.origin,
        mode: event.request.mode,
        pathname: url.pathname,
        cacheMode: event.request.cache,
      });
    } catch { return; }

    // Not calling respondWith is what "bypass" means: the request goes to the
    // network exactly as if no worker existed.
    if (route === "bypass") return;
    if (route === "cache-first") event.respondWith(cacheFirst(event.request));
    if (route === "network-first") event.respondWith(networkFirst(event.request));
  });

  // Drop caches from an older rule set on the way in. The names carry a
  // version for exactly this: change how something is stored and the old pile
  // goes, rather than being served under rules it was not written for.
  root.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
      try {
        const names = await caches.keys();
        await Promise.all(names
          .filter(n => n.startsWith("bc-") && n !== SHELL_CACHE && n !== ASSET_CACHE)
          .map(n => caches.delete(n)));
      } catch { /* nothing here is worth failing activation over */ }
    })());
  });
})(self);
