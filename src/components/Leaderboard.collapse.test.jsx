/** @vitest-environment jsdom */
// ── One thing at a time ────────────────────────────────────────────
// The board opens on the round the field is out on and folds every earlier
// one away. It used to open every round whose state was "live", and live
// meant scored-but-not-settled — so Friday's round, waiting on one group to
// attest, sat open above Saturday's for the whole of Saturday. Two rounds
// expanded on a phone is most of a screen spent on the one that is over.
//
// What is pinned here is the pair of it: a later round that is genuinely out
// folds the earlier one, and a score that reaches a round before anybody has
// teed off in it does not.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { TeamLeaderboard } from "./Leaderboard";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const PARS = Array(18).fill(4);
const card = { hole_pars: PARS, hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1), tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }] };
const courses = [
  { id: "c1", name: "Treetops", ...card },
  { id: "c2", name: "Arthur Hills", ...card },
];

const tPlayers = ["a1", "b1"].map((pid) => ({
  player_id: pid, name: pid.toUpperCase(), team: pid[0] === "a" ? "A" : "B", handicap_index: 0,
}));
const teams = { A: { name: "Irons" }, B: { name: "Drivers" } };

// Friday and Saturday, each with a tee sheet. The clock below is Saturday.
const tRounds = [
  { round_number: 1, format: "singles", course_id: "c1", tee_box: "White", handicap_mode: "full", scoring_type: "match", date: "2026-07-17", tee_time: "8:30" },
  { round_number: 2, format: "singles", course_id: "c2", tee_box: "White", handicap_mode: "full", scoring_type: "match", date: "2026-07-18", tee_time: "9:00" },
];

const matches = [
  { id: "m1", round: 1, teamA: ["a1"], teamB: ["b1"], scoring_type: "match" },
  { id: "m2", round: 2, teamA: ["a1"], teamB: ["b1"], scoring_type: "match" },
];

// `holes` scores in a round, a1 winning every one of them.
const scores = (round, holes) => {
  const out = {};
  Array.from({ length: holes }, (_, h) => h).forEach((h) => {
    out[`a1_${round}`] = { ...(out[`a1_${round}`] || {}), [h]: 3 };
    out[`b1_${round}`] = { ...(out[`b1_${round}`] || {}), [h]: 5 };
  });
  return out;
};

// Friday's round, seventeen holes in and going to the last: a1 takes the
// front, b1 eight of the next nine, so the match is 1 up with one to play and
// nothing has clinched. That is the round the old rule kept open — scored,
// undecided, and therefore "live" — for the whole of Saturday.
const unfinished = () => {
  const out = { a1_1: {}, b1_1: {} };
  Array.from({ length: 17 }, (_, h) => h).forEach((h) => {
    out.a1_1[h] = h < 9 ? 3 : 5;
    out.b1_1[h] = h < 9 ? 5 : 3;
  });
  return out;
};

const at = (h, m = 0) => vi.setSystemTime(new Date(2026, 6, 18, h, m));

const board = (holeData) => render(
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
  />
).container;

// The round headers are the buttons carrying the course name.
const section = (container, name) => [...container.querySelectorAll("button[aria-expanded]")]
  .find((b) => b.textContent.toUpperCase().includes(name.toUpperCase()));
const isOpen = (container, name) => section(container, name).getAttribute("aria-expanded") === "true";

describe("the board folds the rounds that are over", () => {
  it("collapses an unfinished earlier round once a later one is out", () => {
    vi.useFakeTimers();
    at(10);
    // Friday never finalized — 17 holes, so its match is still undecided —
    // and Saturday three holes in, an hour after its first tee time.
    const c = board({ ...unfinished(), ...scores(2, 3) });
    expect(isOpen(c, "Arthur Hills")).toBe(true);
    expect(isOpen(c, "Treetops")).toBe(false);
  });

  it("keeps the earlier round open until the later one has actually teed off", () => {
    vi.useFakeTimers();
    at(8);
    // Same scores, an hour before Saturday's first group goes off: the card a
    // director entered at breakfast is not the field being out on the round.
    const c = board({ ...unfinished(), ...scores(2, 3) });
    expect(isOpen(c, "Treetops")).toBe(true);
    expect(isOpen(c, "Arthur Hills")).toBe(false);
  });

  it("leaves the last round played open when it is the last one out", () => {
    vi.useFakeTimers();
    at(10);
    // Sunday evening's board: the round is over and it is still the round
    // everybody is reading.
    const c = board(scores(1, 18));
    expect(isOpen(c, "Treetops")).toBe(true);
  });

  it("moves on from a finished round to an early card in the next one", () => {
    vi.useFakeTimers();
    at(8);
    // The same hour as the test above, with Friday's round decided rather than
    // hanging: there is nothing still being played for the tee time to
    // protect, so the most recent thing there is to show wins. This is the
    // demo edition's own shape — yesterday in the books, today nine holes in —
    // and a reviewer who opens the app at eight is asking about today.
    const c = board({ ...scores(1, 18), ...scores(2, 3) });
    expect(isOpen(c, "Arthur Hills")).toBe(true);
    expect(isOpen(c, "Treetops")).toBe(false);
  });

  it("still lets a tap open a round the rule folded away", () => {
    vi.useFakeTimers();
    at(10);
    const c = board({ ...unfinished(), ...scores(2, 3) });
    fireEvent.click(section(c, "Treetops"));
    expect(isOpen(c, "Treetops")).toBe(true);
    expect(isOpen(c, "Arthur Hills")).toBe(true);
  });
});
