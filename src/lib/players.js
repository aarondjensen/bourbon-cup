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

// ── The names on one side of a match ──────────────────────────────
// Current first, stored second, id last.
//
// A match document carries `teamANames` alongside `teamA`, written when the
// draw was made. Three screens read one and three read the other, and until
// this function they disagreed the moment a director fixed a typo in
// somebody's name: the Leaderboard's match card re-joined the roster and
// showed the correction, while the Full Scorecard that unfolds out of that
// very card — and the Admin draw — still showed the name as it was when the
// match was created. One tap apart, contradicting each other.
//
// So the ROSTER is the source. But the stored copy is not redundant, and
// deleting it would trade one bug for another: it is the only record of who
// played once a roster row is gone, and `nameOf` answers a deleted player
// with their raw id (`bc_player_1773595975465`), which is not a name anybody
// wants on a scorecard. Same shape as a round lock — live data wins, the
// snapshot covers what live data can no longer answer.
//
// `nameOf` returning the pid unchanged IS the "not on the roster" signal;
// that is its documented fallback, so the test costs nothing extra.
export const sideNames = (match, side, nameOf) => {
  const pids = (side === "B" ? match?.teamB : match?.teamA) || [];
  const stored = (side === "B" ? match?.teamBNames : match?.teamANames) || [];
  return pids.map((pid, i) => {
    const live = nameOf(pid);
    return live === pid ? (stored[i] || pid) : live;
  });
};

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
