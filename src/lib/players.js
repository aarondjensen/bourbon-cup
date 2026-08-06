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
// ── The borrowed ball ─────────────────────────────────────────────
// 2020 went out a man short and played against a compiled card — a ball made
// of the team's own scores, not a person. It has to EXIST as a roster row,
// because Team Best Ball adds the best N nets on a side and a side of seven
// against a side of eight is not the round that was played: leave it out and
// that round reads 13–14 instead of the 7½–19½ it finished.
//
// But it is not somebody, so it does not belong in a list of players. Every
// screen that shows the ROSTER filters it out through here; every screen that
// shows a SCORE leaves it alone, which is the line between the two.
export const isBorrowedBall = (p) => !!p?.borrowed;

// The roster, minus anything that isn't a golfer.
export const realPlayers = (players) => (players || []).filter((p) => !isBorrowedBall(p));

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
