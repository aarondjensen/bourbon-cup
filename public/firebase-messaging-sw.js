// ══════════════════════════════════════════════════════════════════
//  firebase-messaging-sw.js — push, when the app is not on screen.
// ══════════════════════════════════════════════════════════════════
//
// Lives in /public so Vite serves it from the root, which is where it has
// to be: a service worker can only control paths at or below its own URL,
// and this one needs the whole app.
//
// MESSAGE FORMAT CONTRACT with functions/index.js:
//   • messages are DATA-ONLY — no FCM `notification` block
//   • title and body live in payload.data.title / payload.data.body
//   • data.type is the trigger: attest_ready | card_final | round_final | test
//
// Data-only is deliberate. A message with a `notification` block is
// displayed by the browser itself, which sounds simpler and is, right up
// until you want to decide anything about it — whether it counts toward
// the badge, which tab it opens. Data-only hands every message to the
// handler below, so all of that is one place. It is also the format that
// delivers most reliably to an installed iOS PWA.
//
// THE CONFIG BELOW IS THE PRODUCTION PROJECT, HARDCODED. A service worker
// is a static file: it cannot read import.meta.env, so the VITE_FIREBASE_*
// override that points a dev machine at a scratch project (see
// src/firebase.js) does not reach it. That is the safe direction to fail —
// a dev server aimed at a scratch project simply gets no push, rather than
// quietly pushing to the real field.
//
// BADGE MODEL: pending actions, not unread notifications. Only attest_ready
// increments — it is the only push that represents something the user still
// has to DO. The badge is cleared by attesting, never by reading, so it is
// not touched on notificationclick either. The app reconciles the count to
// the real number of outstanding attestations whenever it is opened
// (syncAppBadge in src/lib/notifications.js), so any overcount from here
// self-corrects.

importScripts("https://www.gstatic.com/firebasejs/12.10.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.10.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCvR8I_5N0tXIXaPRkvsvBMzKfUY1_KzA0",
  authDomain: "the-bourbon-cup.firebaseapp.com",
  projectId: "the-bourbon-cup",
  storageBucket: "the-bourbon-cup.firebasestorage.app",
  messagingSenderId: "957218531964",
  appId: "1:957218531964:web:753b42a551463fd50537f9",
});

const messaging = firebase.messaging();

// ── Activate immediately ────────────────────────────────────────────
// Without these a newly-deployed worker waits for every tab to close
// before taking over, which on a phone that is never quite closed means a
// fix can sit undeployed for days.
self.addEventListener("install", (e) => e.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// ── Badge count, in IndexedDB ───────────────────────────────────────
// A service worker is killed and restarted freely between pushes, so the
// count cannot live in a module variable — it would reset to zero somewhere
// between the second notification and the third.
const BADGE_DB = "bc-notif-state";
const BADGE_STORE = "kv";
const BADGE_KEY = "badge-count";

const openBadgeDB = () => new Promise((resolve, reject) => {
  if (!self.indexedDB) return reject(new Error("no idb"));
  const req = self.indexedDB.open(BADGE_DB, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(BADGE_STORE);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const getBadgeCount = async () => {
  try {
    const db = await openBadgeDB();
    return await new Promise((resolve) => {
      const req = db.transaction(BADGE_STORE, "readonly").objectStore(BADGE_STORE).get(BADGE_KEY);
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => resolve(0);
    });
  } catch { return 0; }
};

const setBadgeCount = async (count) => {
  try {
    const db = await openBadgeDB();
    await new Promise((resolve) => {
      const tx = db.transaction(BADGE_STORE, "readwrite");
      tx.objectStore(BADGE_STORE).put(count, BADGE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* swallow — a wrong badge is not worth a failed notification */ }
};

const applyBadge = async (count) => {
  try {
    if (count > 0) await self.navigator.setAppBadge?.(count);
    else await self.navigator.clearAppBadge?.();
  } catch { /* unsupported */ }
};

// ── Background messages ─────────────────────────────────────────────
messaging.onBackgroundMessage(async (payload) => {
  try {
    const data = payload.data || {};
    const title = data.title || payload.notification?.title || "The Bourbon Cup";
    const body = data.body || payload.notification?.body || "";

    if (data.type === "attest_ready") {
      const next = (await getBadgeCount()) + 1;
      await setBadgeCount(next);
      await applyBadge(next);
    }

    return self.registration.showNotification(title, {
      body,
      icon: "/favicon/web-app-manifest-192x192.png",
      badge: "/favicon/favicon-96x96.png",
      data,
      // Tagged by type so a second card waiting on the same player replaces
      // the first rather than stacking; renotify so it still buzzes.
      tag: data.type || "default",
      renotify: true,
    });
  } catch (err) {
    console.error("[SW] onBackgroundMessage failed", err);
    // Something arrived and the user should know, even if we could not work
    // out what to say about it.
    try {
      return self.registration.showNotification("The Bourbon Cup", {
        body: "Something moved — open the app for details.",
        icon: "/favicon/web-app-manifest-192x192.png",
      });
    } catch { /* truly hopeless */ }
  }
});

// ── Tapping one ─────────────────────────────────────────────────────
// Focus the app if it is already open, otherwise launch it, and in both
// cases land on the tab the notification was about. Deliberately does NOT
// clear the badge: under the pending-actions model, reading about a card
// you owe an attestation on does not discharge the obligation.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  // The app reads window.location.hash for its tab (see getTabFromHash in
  // App.jsx), so these are hash routes. A ?tab= query would be silently
  // ignored and always land on the default tab.
  const urlMap = {
    attest_ready: "/#scoring",
    card_final:   "/#scoring",
    round_final:  "/#leaderboard",
  };
  const target = data.url || urlMap[data.type] || "/";

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) {
      if ("focus" in client) {
        try { await client.navigate(target); } catch { /* same-origin only; ignore */ }
        return client.focus();
      }
    }
    return self.clients.openWindow?.(target);
  })());
});

// ── Page → worker ───────────────────────────────────────────────────
// SET_BADGE is the app telling the worker what the count actually is,
// having counted the outstanding attestations properly. CLEAR_BADGE is the
// blunt version of the same thing.
self.addEventListener("message", async (event) => {
  if (event.data?.type === "CLEAR_BADGE") {
    await setBadgeCount(0);
    await applyBadge(0);
  }
  if (event.data?.type === "SET_BADGE") {
    const count = Math.max(0, parseInt(event.data.count, 10) || 0);
    await setBadgeCount(count);
    await applyBadge(count);
  }
});
