// ══════════════════════════════════════════════════════════════════
//  notificationTypes — which pushes a player wants, and what absent means
// ══════════════════════════════════════════════════════════════════
//
// Split out of lib/notifications so it can be tested without pulling in
// Firebase: that module initialises an app at import, and "does an absent
// key read as on" is a question about three lines of logic, not about
// Firestore.
//
// THE KEYS ARE A CONTRACT WITH THE SERVER. Each one is the `type` the Cloud
// Functions stamp into a payload's data block (functions/index.js), and
// sendToPlayer gates on exactly these strings. Rename one here without
// renaming it there and the gate silently stops matching — which fails OPEN,
// so the symptom is a push somebody switched off still arriving.
export const NOTIFICATION_TYPES = ["attest_ready", "card_final", "round_final"];

// AN ABSENT KEY IS ON, and that is the whole reason this is a function
// rather than a spread. Every token registered before the switches existed
// has no `types` map at all, and the honest reading of that is "this player
// never turned anything off" — not "this player wants nothing", which is
// what a plain truthiness check on an empty object would decide for them.
//
// Only an explicit `false` mutes. Anything else — true, undefined, a key
// from a future version this build has never heard of — is on.
export const normalizeTypePrefs = (raw) =>
  Object.fromEntries(NOTIFICATION_TYPES.map(k => [k, raw?.[k] !== false]));
