// ══════════════════════════════════════════════════════════════════
//  editionDocs — finding an edition's singleton documents
// ══════════════════════════════════════════════════════════════════
//
// One tournament keeps a handful of SINGLETONS in shared collections —
// `team_names`, `tournament`, `branding`, the dues figure, the trip document,
// `bc_settings_main`. They are found by document id, and the id comes in two
// shapes because the app's first edition predates the idea of a second one:
//
//   bc_2025   "team_names"              the original, bare
//   bc_2026   "bc_2026__team_names"     every edition created since
//
// `editionDocId` in firebase.js is the WRITING half of that — it picks a shape
// from `_editionNamespaced`, a per-device localStorage flag. This is the
// READING half, and it deliberately does not consult the flag at all.
//
// ── Why reading must not ask the flag ───────────────────────────────
// Nothing tells a phone which shape an edition uses until the `bc_editions`
// subscription lands and App reconciles it (`setActiveTournamentId`). A device
// that has never switched editions has no flag, so it starts on the default:
// bare ids — the wrong shape for every edition made since bc_2025, which
// includes the cup being played.
//
// The subscriptions then race. If `bc_settings` arrives before the edition
// document has been read and the flag repaired, EVERY lookup in that snapshot
// misses, and a snapshot callback does not run again until a document changes.
// So the app sits there rendering its own fallbacks — "Team Alpha" and "Team
// Beta" over the real field, the default title and location, no branding
// colours, a zero skins pot — until something writes or somebody reloads.
//
// That is a first-load-only failure, which is why it went unseen: every phone
// that has had the app for a day carries the flag, and a player signing in
// reloads several times before reaching the leaderboard. The scoreboard door
// (lib/guest) is what made it visible — it takes a cold start with an empty
// localStorage straight to the board, which is exactly the one path that has
// no second load to hide behind.
//
// Fixing the race instead would mean ordering two independent subscriptions,
// and any future reader would have to know to wait. Accepting both id shapes
// removes the question: the rows handed in are already filtered to ONE
// edition's `tournament_id`, so neither shape can name another year's
// document, and a first load renders the same thing as a tenth.

// The namespaced shape, for an edition that uses it.
export const namespacedDocId = (bareId, tid) => `${tid}__${bareId}`;

/**
 * Find an edition's singleton document in a subscription's rows.
 *
 * @param {Array<{id?: string}>} rows  one edition's rows, as subscribed
 * @param {string} bareId              the legacy id ("team_names", …)
 * @param {string} tid                 the active edition id
 * @returns {object|null}
 *
 * The namespaced id wins where both somehow exist: it names this edition
 * outright, while a bare id is only this edition's by virtue of the filter.
 */
export const findEditionDoc = (rows, bareId, tid) => {
  if (!Array.isArray(rows) || !bareId) return null;
  const ns = namespacedDocId(bareId, tid);
  return rows.find(r => r?.id === ns) || rows.find(r => r?.id === bareId) || null;
};
