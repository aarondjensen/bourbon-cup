/** @vitest-environment jsdom */
// ── What a match is worth, on the row ──────────────────────────────
// The cup is played in points and the row used to be the one place that
// wouldn't say so: three results across it on a Nassau round — front, back,
// overall — and what any of it PAID was behind a tap.
//
// What is pinned here is that the line prints only what the cup has actually
// been GIVEN. A segment pays when it settles; until then there is nothing
// official to show, so a match with no settled segment prints no pair at all
// and one with a settled front nine prints that nine's point alone. The
// figure only grows, and it never shows a projection — on this row a
// provisional pair would be the same type in the same place as a match that
// was over.
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
const tPlayers = ["a1", "a2", "a3", "a4", "b1", "b2", "b3", "b4"].map((pid) => ({
  player_id: pid, name: pid.toUpperCase(), team: pid[0] === "a" ? "A" : "B", handicap_index: 0,
}));
const teams = { A: { name: "Irons" }, B: { name: "Drivers" } };
const tRounds = [{
  round_number: 1, format: "singles", course_id: "c1", tee_box: "White",
  handicap_mode: "full", scoring_type: "match",
}];
// One match played out, one twelve holes in, one five holes in, one nobody
// has teed off on — the four states the line has to answer for.
const matches = [
  { id: "m1", round: 1, teamA: ["a1"], teamB: ["b1"], scoring_type: "match" },
  { id: "m2", round: 1, teamA: ["a2"], teamB: ["b2"], scoring_type: "match" },
  { id: "m3", round: 1, teamA: ["a3"], teamB: ["b3"], scoring_type: "match" },
  { id: "m4", round: 1, teamA: ["a4"], teamB: ["b4"], scoring_type: "match", teeTime: "8:20" },
];
// The a-side wins every hole it plays. m1 goes the distance and takes all
// three pots; m2 is through 12, so its front nine is in the books and the
// back and the overall are not; m3 is through 5 and has settled nothing.
const holeData = {};
const play = (a, b, holes) => {
  Array.from({ length: holes }, (_, h) => h).forEach((h) => {
    holeData[`${a}_1`] = { ...(holeData[`${a}_1`] || {}), [h]: 3 };
    holeData[`${b}_1`] = { ...(holeData[`${b}_1`] || {}), [h]: 5 };
  });
};
play("a1", "b1", 18);
play("a2", "b2", 12);
play("a3", "b3", 5);

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

  it("counts a settled nine and nothing that is still being played", () => {
    // Through 12: the front nine has paid its point, the back nine and the
    // overall have not. A projection would read 3–0 here, which is the whole
    // thing this is keeping off the row.
    expect(board()).toContain("1–0");
  });

  it("prints no pair before anything has settled", () => {
    const text = board();
    // Covers both the match five holes in and the one nobody has teed off on.
    expect(text).not.toContain("0–0");
    // The unplayed match is still on the board — it just has a tee time
    // where a result would go.
    expect(text).toContain("8:20");
  });
});
