// ══════════════════════════════════════════════════════════════════
//  players — looking a player up by id.
// ══════════════════════════════════════════════════════════════════
//
// Scores, matches and groups all store player_ids; every screen that shows
// one has to turn it back into a name. That one-liner had been written out
// six times across four files — four `nameOf`, two `teamOf` — and the two
// teamOf's had already drifted, one returning null for an unknown id and the
// other undefined.
//
// A factory rather than free functions, because the roster is the same for
// every lookup on a screen and threading it through twenty call sites would
// be the noise this is meant to remove:
//
//     const { nameOf, teamOf } = playerLookup(tPlayers);
//
// Unknown ids fall back to the id itself for a name, which is what every
// caller already did — it keeps a stale match row readable instead of
// rendering a blank where a player used to be.
export function playerLookup(players) {
  const find = (pid) => (players || []).find((p) => p.player_id === pid);
  const nameOf = (pid) => find(pid)?.name || pid;
  return {
    nameOf,
    // First name only, for the places a full name will not fit.
    shortOf: (pid) => nameOf(pid).split(" ")[0] || pid,
    teamOf: (pid) => find(pid)?.team ?? null,
  };
}
