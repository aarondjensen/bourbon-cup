/** @vitest-environment jsdom */
// ── The board, while the countdown is running ──────────────────────
// The one thing this screen must never do is answer the question the room
// is sitting down to watch. lib/reveal.test pins the subtraction; this pins
// what the scoreboard actually DRAWS on the far side of it, because the two
// can come apart — the board has the sealed round's matches, its pot and
// its own section header whether or not it has any holes.
//
// The assertion that matters is invariance: as the director walks the
// reveal from 0 to 17, NOTHING on this board may change except how far the
// countdown has got. The moment the eighteenth is turned over, everything
// lands at once.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { TeamLeaderboard } from "./Leaderboard";
import { countdownHoleData, concealHoleData } from "../lib/reveal";

afterEach(cleanup);

const A = ["a1", "a2", "a3", "a4"];
const B = ["b1", "b2", "b3", "b4"];
const PARS = Array(18).fill(4);

const courses = [{
  id: "c1", name: "Treetops",
  hole_pars: PARS,
  hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1),
  tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }],
}];

const tPlayers = [...A, ...B].map((pid) => ({
  player_id: pid, name: pid.toUpperCase(), team: A.includes(pid) ? "A" : "B",
  handicap_index: 0,
}));

const teams = { A: { name: "Irons" }, B: { name: "Drivers" } };

const roundsFor = (through) => [
  {
    round_number: 1, format: "singles", course_id: "c1", tee_box: "White",
    handicap_mode: "full", scoring_type: "match",
  },
  {
    round_number: 4, format: "team_best_ball", course_id: "c1", tee_box: "White",
    handicap_mode: "full", scoring_type: "points",
    counting_scores: { holes: Array(18).fill(2) },
    sealed: true, reveal_through: through,
  },
];

const matches = [
  { id: "m1", round: 1, teamA: ["a1"], teamB: ["b1"], scoring_type: "match" },
  { id: "m4", round: 4, teamA: A, teamB: B, scoring_type: "points" },
];

// Round 1: a1 beats b1 outright. Round 4: B's side is four shots a hole
// better than A's, all eighteen holes — a rout, and exactly the sort of
// answer the countdown exists to hold back.
const holeData = {};
Array.from({ length: 18 }, (_, h) => h).forEach((h) => {
  holeData.a1_1 = { ...(holeData.a1_1 || {}), [h]: 3 };
  holeData.b1_1 = { ...(holeData.b1_1 || {}), [h]: 5 };
  A.forEach((pid) => { holeData[`${pid}_4`] = { ...(holeData[`${pid}_4`] || {}), [h]: 6 }; });
  B.forEach((pid) => { holeData[`${pid}_4`] = { ...(holeData[`${pid}_4`] || {}), [h]: 3 }; });
});

// What App hands the board, computed the way App computes it.
const boardAt = (through, extra = {}) => {
  const tRounds = roundsFor(through);
  const { container } = render(
    <TeamLeaderboard
      matches={matches}
      holeData={concealHoleData(holeData, tRounds)}
      ownHoleData={holeData}
      countdownHoleData={countdownHoleData(holeData, tRounds)}
      courses={courses}
      tRounds={tRounds}
      tPlayers={tPlayers}
      teams={teams}
      hcpOverrides={{}}
      teeAssignments={{}}
      roundLocks={{}}
      viewer="A"
      {...extra}
    />
  );
  return container.textContent;
};

// The two strings that are ALLOWED to move: the lock chip on the round bar
// and the line inside the sealed panel. Both say how far the ceremony has
// got, which is not a score.
const blindfold = (text) => text
  .replace(/🔒 \d+\/18/g, "🔒 n/18")
  // The panel's own counter and the line under it, matched together so the
  // counter's digits cannot be read as part of the summary that follows it.
  .replace(/\d+ \/ 18(?:Sealed — nothing revealed yet|\d+ of 18 holes revealed)/g, "PROGRESS");

describe("the scoreboard during the Final Countdown", () => {
  it("does not move a single character as the reveal walks", () => {
    const sealed = blindfold(boardAt(0));
    cleanup();
    for (let through = 1; through <= 17; through += 1) {
      expect(blindfold(boardAt(through)), `reveal at ${through}`).toBe(sealed);
      cleanup();
    }
  });

  it("says nothing about the sealed round's score while it is sealed", () => {
    const text = boardAt(12);
    expect(text).toContain("THE FINAL COUNTDOWN");
    // The round has a section, and it is showing a dash rather than a score.
    expect(text).toContain("TREETOPS · TEAM BEST BALL");
    // B won every hole of it. Nothing on this board may say so.
    expect(text).not.toContain("Drivers win");
    cleanup();
  });

  it("lands the whole round the moment the eighteenth is turned over", () => {
    const held = blindfold(boardAt(17));
    cleanup();
    const landed = blindfold(boardAt(18));
    expect(landed).not.toBe(held);
    // The banner is gone with the seal, and the round has a score — the
    // rout the board sat on for eighteen holes, all of it at once.
    expect(landed).not.toContain("THE FINAL COUNTDOWN");
    expect(landed).toContain("0–27");
    expect(landed).toContain("FINAL");
    cleanup();
  });

  // The cup bar is the number everybody reads first, so it gets its own
  // pin: the sealed round's points are on offer, not banked, right up to
  // the last hole.
  it("banks none of the sealed round's points until the reveal is done", () => {
    const held = boardAt(17);
    expect(held).toMatch(/lands when the countdown ends/);
    cleanup();
    const landed = boardAt(18);
    expect(landed).not.toMatch(/lands when the countdown ends/);
    cleanup();
  });
});

// ── The other half of the split ────────────────────────────────────
// The board holding still is only correct because ONE screen is walking.
// If the countdown were handed the board's map too, the ceremony would be
// eighteen taps of a blank television — a failure nobody would find until
// the room was already sitting down.
describe("the Final Countdown itself", () => {
  it("has the holes the board does not", async () => {
    // `autoCountdown` is how the television lands on it: App's reading of
    // the #countdown hash, resolved during render.
    boardAt(5, { autoCountdown: true });
    // Lazy-loaded, and portaled onto the body rather than into the board.
    const tv = await screen.findByText("HOLE 5");
    expect(tv).toBeTruthy();
    // The round's points are on the countdown's own cup bar as they come
    // out — Drivers have taken all five holes turned over so far — while
    // the board behind it still has them on nothing. Both numbers are on
    // screen at once, and that is the whole shape of this change.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const all = document.body.textContent;
    expect(all).toContain("Drivers0");   // the scoreboard
    expect(all).toContain("Drivers5");   // the television
    // And the hole itself is drawn from the balls, not from a blank map.
    expect(all).toContain("BEST 2 OF 4");
    cleanup();
  });
});
