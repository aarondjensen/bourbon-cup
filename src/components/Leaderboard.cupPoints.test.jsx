/** @vitest-environment jsdom */
// ── What a match is worth, on the row ──────────────────────────────
// The cup is played in points and the row used to be the one place that
// wouldn't say so: three results across it on a Nassau round — front, back,
// overall — and what any of it PAID was behind a tap.
//
// Two things are pinned here, and the second is the one that will break
// first. A match nobody has teed off on must not print a pair: it has banked
// nothing and has nothing in flight, so "0 – 0" would be a result invented
// for a match whose tee time hasn't come round.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { TeamLeaderboard } from "./Leaderboard";

afterEach(cleanup);

const PARS = Array(18).fill(4);
const courses = [{
  id: "c1", name: "Treetops", hole_pars: PARS,
  hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1),
  tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }],
}];
const tPlayers = ["a1", "a2", "b1", "b2"].map((pid) => ({
  player_id: pid, name: pid.toUpperCase(), team: pid[0] === "a" ? "A" : "B", handicap_index: 0,
}));
const teams = { A: { name: "Irons" }, B: { name: "Drivers" } };
const tRounds = [{
  round_number: 1, format: "singles", course_id: "c1", tee_box: "White",
  handicap_mode: "full", scoring_type: "match",
}];
// One match played out, one nobody has teed off on.
const matches = [
  { id: "m1", round: 1, teamA: ["a1"], teamB: ["b1"], scoring_type: "match" },
  { id: "m2", round: 1, teamA: ["a2"], teamB: ["b2"], scoring_type: "match", teeTime: "8:20" },
];
// a1 wins every hole: the front, the back and the match, so all three pots.
const holeData = {};
Array.from({ length: 18 }, (_, h) => h).forEach((h) => {
  holeData.a1_1 = { ...(holeData.a1_1 || {}), [h]: 3 };
  holeData.b1_1 = { ...(holeData.b1_1 || {}), [h]: 5 };
});

const board = () => render(
  <TeamLeaderboard
    matches={matches} holeData={holeData} ownHoleData={holeData} countdownHoleData={holeData}
    courses={courses} tRounds={tRounds} tPlayers={tPlayers} teams={teams}
    hcpOverrides={{}} teeAssignments={{}} roundLocks={{}} viewer="A"
  />
).container.textContent;

describe("a match's cup points on its row", () => {
  it("says what the finished match paid, without expanding it", () => {
    // Three pots at a point each, all of them a1's. The dash is its own span,
    // so the pair reads as one string with nothing between the numbers.
    expect(board()).toContain("3–0");
  });

  it("prints no pair for a match nobody has teed off on", () => {
    const text = board();
    expect(text).not.toContain("0–0");
    // It is on the board — it just has a tee time where a result would go.
    expect(text).toContain("8:20");
  });
});
