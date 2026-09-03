/** @vitest-environment jsdom */
// ── Every round the tournament has, drawn or not ───────────────────
// The board used to list the rounds that had a DRAW, which meant the two
// rounds in the middle of the week — course picked, format picked, pairings
// still to come — had no row on it at all. A player looking for "what are we
// playing Friday" got Round 1 and Round 4 and a gap.
//
// What is pinned here is the pair of it: the undrawn round appears and says
// where and what it is, and it does NOT acquire a score by appearing.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { TeamLeaderboard } from "./Leaderboard";

afterEach(cleanup);

const PARS = Array(18).fill(4);

const courses = [
  { id: "c1", name: "Treetops", hole_pars: PARS, hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1), tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }] },
  { id: "c2", name: "Arthur Hills", hole_pars: PARS, hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1), tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }] },
];

const tPlayers = ["a1", "b1"].map((pid) => ({
  player_id: pid, name: pid.toUpperCase(), team: pid[0] === "a" ? "A" : "B", handicap_index: 0,
}));

const teams = { A: { name: "Irons" }, B: { name: "Drivers" } };

// Round 1 is drawn and played. Rounds 2 and 3 are set up and nothing else —
// the shape a director leaves the tournament in for most of the summer.
const tRounds = [
  { round_number: 1, format: "singles", course_id: "c1", tee_box: "White", handicap_mode: "full", scoring_type: "match" },
  { round_number: 2, format: "team_best_ball", course_id: "c2", tee_box: "White", handicap_mode: "full", scoring_type: "match" },
  { round_number: 3, format: "scramble", course_id: "c1", tee_box: "White", handicap_mode: "full", scoring_type: "match" },
];

const matches = [{ id: "m1", round: 1, teamA: ["a1"], teamB: ["b1"], scoring_type: "match" }];

// a1 wins every hole of round 1, so round 1 has a real score to show.
const holeData = {};
Array.from({ length: 18 }, (_, h) => h).forEach((h) => {
  holeData.a1_1 = { ...(holeData.a1_1 || {}), [h]: 3 };
  holeData.b1_1 = { ...(holeData.b1_1 || {}), [h]: 5 };
});

const board = (props = {}) => render(
  <TeamLeaderboard
    matches={matches}
    holeData={holeData}
    ownHoleData={holeData}
    countdownHoleData={holeData}
    courses={courses}
    tRounds={tRounds}
    tPlayers={tPlayers}
    teams={teams}
    hcpOverrides={{}}
    teeAssignments={{}}
    roundLocks={{}}
    viewer="A"
    {...props}
  />
).container.textContent;

describe("the board's round list", () => {
  it("draws a round that has a course and a format but no pairings", () => {
    const text = board();
    expect(text).toContain("TREETOPS · SINGLES");
    expect(text).toContain("ARTHUR HILLS · TEAM BEST BALL");
    expect(text).toContain("SCRAMBLE");
  });

  it("says the pairings are still to come rather than showing 0–0", () => {
    const text = board();
    expect(text).toContain("TBD");
    // Round 1 was swept and still says so; the undrawn rounds took a dash.
    expect(text).toContain("3–0");
    expect(text).not.toContain("0–0");
  });

  // Team Best Ball seals by DEFAULT (lib/reveal.resolveSealed), so round 2
  // here is a sealed round from the moment its format was picked. It has no
  // draw, so there is nothing behind the blackout and nothing to say about
  // it — the seal has to wait for the matches.
  it("does not announce a blackout over a round with no matches in it", () => {
    const text = board();
    expect(text).not.toContain("sealed");
    expect(text).not.toContain("🔒");
    // And it reads TBD like any other undrawn round, rather than taking the
    // sealed round's dash — both undrawn rounds here, not just the one whose
    // format doesn't seal.
    expect(text.match(/TBD/g)).toHaveLength(2);
  });

  it("offers no round summary for a round nobody has been paired for", () => {
    // The summary sheet is a round's whole result; there isn't one yet.
    const text = board({ onOpenSummary: () => {} });
    expect(text).toContain("ROUND 1 SUMMARY");
    expect(text).not.toContain("ROUND 2 SUMMARY");
    expect(text).not.toContain("ROUND 3 SUMMARY");
  });

  it("still shows a round nobody has set up but somebody has played", () => {
    // A lock is written by the first score of a round — that round exists
    // whether or not it has a document, and losing it would take scores off
    // the board.
    const text = board({ roundLocks: { 4: { locked: true } } });
    expect(text).toContain("COURSE TBD");
  });

  it("keeps the empty state when the tournament has no rounds at all", () => {
    const text = board({ tRounds: [], matches: [] });
    expect(text).toContain("No matches yet");
  });
});
