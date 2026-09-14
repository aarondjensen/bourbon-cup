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

const resultFor = (over = {}) => computeMatchResult(
  { ...match, ...over.match }, over.holeData || holeData, courses,
  [{ ...tRounds[0], ...over.round }], tPlayers, "team_best_ball", {}, undefined, {}, {},
);
const scoreboard = (over) => render(
  <TeamBestBallScoreboard result={resultFor(over)} holePars={PARS} />,
).container;
// Every PTS cell on the card, in document order. The columns are the two
// outermost of five, so reading them off the row is what tells a tie from a
// win rather than searching the whole card for a string.
const ptsCells = (el) => [...el.querySelectorAll("div")]
  .filter(d => d.children.length === 0 && /^[0-9.]+$/.test((d.textContent || "").trim()));

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
    const result = resultFor();
    // Hole 1: A wins the front's 1-point pot outright. Hole 2: a tie splits it.
    // 1 + 0.5 = 1.5 for A; 0 + 0.5 = 0.5 for B.
    expect(result.totalPts.A).toBe(1.5);
    expect(result.totalPts.B).toBe(0.5);
    const text = render(<TeamBestBallScoreboard result={result} holePars={PARS} />).container.textContent;
    expect(text).toContain("1.5");
  });
});

// ── The two nines are not priced the same ───────────────────────────
// The sheet this is modeled on ran "1 Pt/Hole Front, 2 Pt/Hole Back", and
// potFor's whole job is to know which nine a hole is in. Every hole above is
// on the front, so the back branch was never once exercised.
describe("a back nine priced differently from the front", () => {
  const backHoles = {
    a1_4: { 9: 4, 10: 4 }, a2_4: { 9: 4, 10: 4 },
    b1_4: { 9: 9, 10: 4 }, b2_4: { 9: 9, 10: 4 },
  };
  const over = { holeData: backHoles, match: { hole_points: { front: 1, back: 2 } } };

  it("pays the back nine's pot on a back nine hole", () => {
    // Hole 10 is A's outright: the back pot is 2, not the front's 1.
    const result = resultFor(over);
    expect(result.holePoints.back).toBe(2);
    expect(result.totalPts.A).toBe(3);     // 2 for the win, 1 for half of the tie
    expect(result.totalPts.B).toBe(1);
  });

  it("prints that pot rather than the front's", () => {
    expect(scoreboard(over).textContent).toContain("2");
  });
});

// ── A round that does not pay by the hole ───────────────────────────
// Team Best Ball offers Match and Total as well as Points (constants FORMATS),
// and on those two `result.holePoints` is null — the round pays Nassau pots by
// the NINE and has no per-hole pot at all. Reading that as zero printed
// eighteen zeros down both PTS columns under a TOTAL row showing the round's
// real points: columns that summed to nothing under a number that wasn't.
describe("a Team Best Ball round run as a match rather than on points", () => {
  const asMatch = { match: { scoring_type: "match" }, round: { scoring_type: "match" } };

  it("has no per-hole pot to state", () => {
    expect(resultFor(asMatch).holePoints).toBe(null);
  });

  it("draws no PTS columns at all", () => {
    const el = scoreboard(asMatch);
    expect(el.textContent).not.toContain("PTS");
    // And no zeros standing in for the points it cannot state.
    expect(ptsCells(el).filter(d => d.textContent.trim() === "0")).toHaveLength(0);
  });

  it("still draws the net-per-hole half, which is true on every form", () => {
    const el = scoreboard(asMatch);
    expect(el.textContent).toContain("NET");
    expect(el.textContent).toContain("+4");
    expect(el.textContent).toContain("+12");
  });

  it("still states what the round is worth, off the engine", () => {
    // Whatever the Nassau pots have banked — nothing yet on a round two holes
    // old, since a pot is not awarded until its nine settles. The point is
    // that this number comes from computeMatchResult and is NOT the sum of a
    // column of per-hole points, which is exactly why that column must not be
    // drawn as zeros beside it.
    const result = resultFor(asMatch);
    const el = render(<TeamBestBallScoreboard result={result} holePars={PARS} />).container;
    expect(el.textContent).toContain("TOTAL");
    expect(result.holePoints).toBe(null);
    expect(typeof result.totalPts.A).toBe("number");
  });

  it("keeps the PTS columns on a points round", () => {
    expect(scoreboard().textContent).toContain("PTS");
  });
});
