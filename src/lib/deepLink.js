// ══════════════════════════════════════════════════════════════════
//  deepLink — where a tapped notification lands.
// ══════════════════════════════════════════════════════════════════
//
// The app is a single page with no router, so a hash is the whole of its
// addressing — the same decision `COUNTDOWN_HASH` documents in lib/reveal.
// This is the part that READS one.
//
// It had to be written because nothing did. The service worker has been
// sending taps to `/#leaderboard` and `/#scoring` since push landed, and its
// own comment said the app read them "see getTabFromHash in App.jsx". There
// is no such function and there never was: every tap on every notification
// has been landing on whatever tab the app opens on, and the one hash the app
// does read is the countdown's.
//
// ── What a link may do ──────────────────────────────────────────────
// Select a tab, and open the round summary over it. Nothing else — a hash
// arrives from a push payload, from a service worker, and (on iOS) from
// whatever the OS hands back on a tap, so the set of things it can ask for is
// deliberately closed. An unrecognised hash is null and the app opens
// normally, which is what it did before this existed.
//
// `#countdown` is deliberately NOT ours. It is the television's URL, read
// once at module load by AUTO_COUNTDOWN and owned by the Leaderboard
// thereafter; answering it here would have two things acting on one hash.

// The tabs a link may select. The five on the bottom nav plus the four the
// menu reaches — but not `menu` itself, which opens a drawer rather than a
// view, and would leave the app on the tab underneath it.
const TABS = new Set([
  "scoring", "groups", "leaderboard", "betting",
  "account", "trip", "data", "photos", "admin",
]);

// `#round/3` — the round summary, over the leaderboard.
//
// A path segment rather than a query (`#round?n=3`) because the hash is
// hand-written in three places (the push payload, the service worker's
// fallback map, and the tests) and one of them will eventually be typed by a
// person reading this file.
const ROUND = /^round\/(\d+)$/;

// Returns { view, round } — `round` null unless the link asks for a summary —
// or null when the hash is not one of ours.
export const parseDeepLink = (hash) => {
  const raw = String(hash || "").replace(/^#/, "").trim();
  if (!raw) return null;

  const round = raw.match(ROUND);
  if (round) {
    const n = parseInt(round[1], 10);
    // Round 0 is not a round. The app numbers from 1 and a zero here would
    // open a summary of nothing.
    return n > 0 ? { view: "leaderboard", round: n } : null;
  }

  return TABS.has(raw) ? { view: raw, round: null } : null;
};

// The hash for a round summary, so the two ends cannot drift. The functions
// build the same string server-side (functions/index.js) — it is the one copy
// this module cannot own, and it is spelled out there with a pointer back.
export const roundSummaryHash = (round) => `#round/${round}`;
