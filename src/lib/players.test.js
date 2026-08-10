import { describe, it, expect } from "vitest";
import { playerLookup, sideNames } from "./players";

describe("sideNames", () => {
  const roster = [
    { player_id: "p1", name: "Aaron J" },
    { player_id: "p2", name: "Kevin J" },
  ];
  const { nameOf } = playerLookup(roster);
  const match = {
    teamA: ["p1"], teamB: ["p2"],
    teamANames: ["Aaron Jensen"], teamBNames: ["Kev J"],
  };

  // The bug this exists for: the Leaderboard card re-joined the roster and
  // the Full Scorecard it opens read the stored copy, so a renamed player was
  // corrected on one and not the other, one tap apart.
  it("prefers the live roster over the name stored on the match", () => {
    expect(sideNames(match, "A", nameOf)).toEqual(["Aaron J"]);
    expect(sideNames(match, "B", nameOf)).toEqual(["Kevin J"]);
  });

  // And the reason the stored copy is kept rather than deleted: nameOf answers
  // an unknown id with the id itself, which is not a name for a scorecard.
  it("falls back to the stored name for a player off the roster", () => {
    const gone = { teamA: ["p9"], teamANames: ["Departed D"] };
    expect(sideNames(gone, "A", nameOf)).toEqual(["Departed D"]);
  });

  it("falls back to the id when there is no stored name either", () => {
    expect(sideNames({ teamA: ["p9"] }, "A", nameOf)).toEqual(["p9"]);
  });

  it("pairs stored names with their own player by position", () => {
    const pair = { teamA: ["p1", "p9"], teamANames: ["Old A", "Old B"] };
    expect(sideNames(pair, "A", nameOf)).toEqual(["Aaron J", "Old B"]);
  });

  it("handles a match with nothing on it", () => {
    expect(sideNames({}, "A", nameOf)).toEqual([]);
    expect(sideNames(null, "B", nameOf)).toEqual([]);
  });
});
