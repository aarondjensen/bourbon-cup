/** @vitest-environment jsdom */
// ── The countdown, turned over a side at a time ─────────────────────
// The screen the whole evening is built around, and the one place in the app
// where drawing a number one beat early cannot be taken back. lib/reveal pins
// the arithmetic; this pins what the television actually SHOWS on the far side
// of it — which can come apart from the arithmetic, because the component has
// both sides' balls in hand the whole time and chooses which to draw.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { FinalCountdown } from "./FinalCountdown";
import { computeMatchResult } from "../scoring";

afterEach(cleanup);

const PARS = Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
const courses = [{
  id: "c1", name: "Treetops", hole_pars: PARS, hole_handicaps: SI,
  tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }],
}];
const tRounds = [{
  round_number: 4, format: "team_best_ball", course_id: "c1", tee_box: "White",
  handicap_mode: "full", scoring_type: "points", hole_points: { front: 1, back: 1 },
  counting_scores: { holes: Array(18).fill(2) },
}];

// Two men a side so the counted/missed split is visible: A's low pair make the
// number and the other two do not.
const tPlayers = [
  { player_id: "a1", name: "Paul W", team: "A", handicap_index: 0 },
  { player_id: "a2", name: "Dave K", team: "A", handicap_index: 0 },
  { player_id: "a3", name: "Tim C", team: "A", handicap_index: 0 },
  { player_id: "b1", name: "Andy H", team: "B", handicap_index: 0 },
  { player_id: "b2", name: "Nick R", team: "B", handicap_index: 0 },
  { player_id: "b3", name: "Rudy T", team: "B", handicap_index: 0 },
];
const match = {
  id: "m4", round: 4, teamA: ["a1", "a2", "a3"], teamB: ["b1", "b2", "b3"],
  scoring_type: "points", hole_points: { front: 1, back: 1 },
};
// A: a birdie, a par and a bogey. B: three pars. A takes every hole.
const holeData = {};
Array.from({ length: 18 }, (_, h) => h).forEach((h) => {
  holeData.a1_4 = { ...(holeData.a1_4 || {}), [h]: 3 };
  holeData.a2_4 = { ...(holeData.a2_4 || {}), [h]: 4 };
  holeData.a3_4 = { ...(holeData.a3_4 || {}), [h]: 5 };
  holeData.b1_4 = { ...(holeData.b1_4 || {}), [h]: 4 };
  holeData.b2_4 = { ...(holeData.b2_4 || {}), [h]: 4 };
  holeData.b3_4 = { ...(holeData.b3_4 || {}), [h]: 5 };
});
const result = computeMatchResult(match, holeData, courses, tRounds, tPlayers, "team_best_ball", {}, undefined, {}, {});
const getScore = (pid, h) => holeData[`${pid}_4`]?.[h] || 0;

const advanced = [];
const screen = (reveal, extra = {}) => {
  advanced.length = 0;
  return render(
    <FinalCountdown
      match={match} result={result} getScore={getScore}
      ownResult={result} ownGetScore={getScore}
      holePars={PARS} holeHcps={SI} tPlayers={tPlayers}
      teams={{ A: { id: "A", name: "Mash Brothers" }, B: { id: "B", name: "Shot Callers" } }}
      courseName="Treetops" formatLabel="Team Best Ball"
      reveal={reveal} totals={{ A: 3, B: 1 }} toWin={12.5} clincher={null}
      isDirector onAdvance={(s, n) => advanced.push([s, n])} onClose={() => {}}
      {...extra}
    />,
  ).container;
};

describe("a hole half turned over", () => {
  it("shows the side that has spoken and not the one that hasn't", () => {
    // A has hole 1; B does not. A's balls are on screen; B's are not.
    const t = screen({ A: 1, B: 0 }).textContent;
    expect(t).toContain("HOLE 1");
    expect(t).toContain("Paul W");
    expect(t).not.toContain("Andy H");
    expect(t).toContain("SHOT CALLERS TO TELL IT");
  });

  // The one thing the screen must never do early. Both sides' numbers are in
  // the component's hands from the first render — the guard is what it DRAWS.
  it("gives no verdict until both captains have spoken", () => {
    expect(screen({ A: 1, B: 0 }).textContent).not.toContain("TAKE IT");
    // The app's all-caps is CSS, which jsdom does not apply — this is the
    // text as the component writes it.
    expect(screen({ A: 1, B: 1 }).textContent).toContain("Mash Brothers TAKE IT");
  });

  it("names the balls that made the number and dims the ones that didn't", () => {
    const t = screen({ A: 1, B: 1 }).textContent;
    // Best 2 of 3: Paul and Dave count, Tim does not — but he is still named,
    // because on this format that is half the conversation in the room.
    expect(t).toContain("Paul W");
    expect(t).toContain("Dave K");
    expect(t).toContain("Tim C");
  });
});

describe("whose tap it is", () => {
  it("offers both sides on a fresh hole", () => {
    const t = screen({ A: 1, B: 1 }).textContent;
    expect(t).toContain("REVEAL MASH BROTHERS · HOLE 2");
    expect(t).toContain("REVEAL SHOT CALLERS · HOLE 2");
  });

  // One hole, both stories, next hole. A side that ran ahead would leave the
  // other tapping through holes nobody in the room could see.
  it("holds the side that is a hole up", () => {
    const t = screen({ A: 2, B: 1 }).textContent;
    expect(t).toContain("WAITING ON SHOT CALLERS");
    expect(t).toContain("REVEAL SHOT CALLERS · HOLE 2");
    expect(t).not.toContain("REVEAL MASH BROTHERS");
  });

  it("advances the side that was tapped, and only that side", () => {
    const c = screen({ A: 1, B: 1 });
    fireEvent.click([...c.querySelectorAll("button")].find(b => b.textContent.includes("SHOT CALLERS · HOLE 2")));
    expect(advanced).toEqual([["B", 2]]);
  });

  it("refuses a tap from a side that is already ahead", () => {
    const c = screen({ A: 2, B: 1 });
    const held = [...c.querySelectorAll("button")].find(b => b.textContent.includes("WAITING ON"));
    fireEvent.click(held);
    expect(advanced).toEqual([]);
  });
});

describe("a captain's phone", () => {
  const captain = { isDirector: false, captainSide: "A" };

  it("gives him one button and it is his own side's", () => {
    const t = screen({ A: 1, B: 1 }, captain).textContent;
    expect(t).toContain("REVEAL MASH BROTHERS · HOLE 2");
    expect(t).not.toContain("REVEAL SHOT CALLERS");
  });

  // The whole reason his phone has the hole before the room does: he is
  // reading it out. It is his OWN side, which is never hidden from him.
  it("tells him what to say before he taps", () => {
    const t = screen({ A: 1, B: 1 }, captain).textContent;
    expect(t).toContain("YOU’RE UP · HOLE 2");
    expect(t).toContain("YOUR SIDE −1");     // birdie + par against two pars
    expect(t).toContain("Net birdie — Paul W");
  });

  // A net bogey is never read out — see lib/countdownPrompt for why.
  it("never names the man who made the bogey", () => {
    const t = screen({ A: 1, B: 1 }, captain).textContent;
    const band = t.slice(t.indexOf("YOU’RE UP"));
    expect(band).not.toContain("Tim C");
  });

  it("says nothing while the other captain is talking", () => {
    // His side is a hole up: it is not his go, and a prompt here would be him
    // reading ahead over the top of the man who is speaking.
    expect(screen({ A: 2, B: 1 }, captain).textContent).not.toContain("YOU’RE UP");
  });

  it("leaves a spectator with no controls at all", () => {
    const t = screen({ A: 1, B: 1 }, { isDirector: false, captainSide: null }).textContent;
    expect(t).not.toContain("REVEAL");
    expect(t).toContain("THE CAPTAINS ARE DRIVING");
  });
});
