/** @vitest-environment jsdom */
// ── The hole-by-hole tally, pinned against a hand-worked round ──────
// Two holes are actually played: hole 1 is a clean Team A win (net 12 vs
// net 20, off two-player sides so the numbers stay checkable by hand), hole 2
// is an exact tie. That's enough to pin both branches of the win/tie-split
// points rule and the net-to-par derivation, without needing all 18 holes
// filled in — the rest stay unplayed and print as placeholders.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { TeamBestBallScoreboard } from "./TeamBestBallScoreboard";
import { computeMatchResult } from "../scoring";

afterEach(cleanup);

const PARS = Array(18).fill(4);
const courses = [{
  id: "c1", name: "Treetops",
  hole_pars: PARS,
  hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1),
  tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }],
}];
const tRounds = [{
  round_number: 4, format: "team_best_ball", course_id: "c1", tee_box: "White",
  handicap_mode: "full", scoring_type: "points",
}];
const teamA = ["a1", "a2"], teamB = ["b1", "b2"];
const tPlayers = [...teamA, ...teamB].map((pid) => ({
  player_id: pid, name: pid.toUpperCase(), team: teamA.includes(pid) ? "A" : "B",
  handicap_index: 0,
}));
const match = { id: "m4", round: 4, teamA, teamB, scoring_type: "points" };

// Hole 1 (index 0): A's two nets are 5+7=12 against par 8 (par 4 x 2) -> +4.
// B's two nets are 9+11=20 against par 8 -> +12. Fewer strokes wins, so A
// takes the hole despite also being over par itself.
// Hole 2 (index 1): both sides net 16 against par 8 -> +8 each. A tie.
const holeData = {
  a1_4: { 0: 5, 1: 8 }, a2_4: { 0: 7, 1: 8 },
  b1_4: { 0: 9, 1: 8 }, b2_4: { 0: 11, 1: 8 },
};

const scoreboard = () => {
  const result = computeMatchResult(
    match, holeData, courses, tRounds, tPlayers, "team_best_ball", {}, undefined, {}, {},
  );
  return render(<TeamBestBallScoreboard result={result} holePars={PARS} />).container;
};

describe("TeamBestBallScoreboard", () => {
  it("shows the decisive hole's net-to-par and awards it the whole pot", () => {
    const text = scoreboard().textContent;
    // Team A's +4 and Team B's +12 on hole 1.
    expect(text).toContain("+4");
    expect(text).toContain("+12");
    // The front nine's pot is 1 point by default — A takes it whole, B gets 0.
  });

  it("splits a tied hole's points 0.5/0.5", () => {
    const text = scoreboard().textContent;
    // Both sides read +8 on hole 2, and each banks half the front pot.
    expect(text).toContain("+8");
    expect(text).toContain("0.5");
  });

  it("totals the round to what computeMatchResult itself banked", () => {
    const result = computeMatchResult(
      match, holeData, courses, tRounds, tPlayers, "team_best_ball", {}, undefined, {}, {},
    );
    // Hole 1: A wins the front's 1-point pot outright. Hole 2: a tie splits it.
    // 1 + 0.5 = 1.5 for A; 0 + 0.5 = 0.5 for B.
    expect(result.totalPts.A).toBe(1.5);
    expect(result.totalPts.B).toBe(0.5);
    const text = render(<TeamBestBallScoreboard result={result} holePars={PARS} />).container.textContent;
    expect(text).toContain("1.5");
  });
});
