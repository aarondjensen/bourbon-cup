/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  TWO TAPS ON THE BOARD ARE NOT A WAY INTO THE OTHER SIDE'S CARD
// ══════════════════════════════════════════════════════════════════
//
// A team round's match is the whole SIDE, so the full scorecard behind a
// match row is not a foursome's card — it is all sixteen men, hole by hole.
// The row cycles collapsed → points → full card, and that third state was
// open for the entire time a round was being played.
//
// The blackout did not reach it, and could not: it works by SUBTRACTING
// scores (lib/reveal), and this card is only ever drawn on a round that has
// scores left in it. A sealed round draws no match rows at all — so the one
// round that gets here is a Team Best Ball round being played in the open,
// which is exactly the round somebody taps twice on a tee box.
//
// The rule pinned here: until the round is FINAL, the card is the reader's
// own side. Not the seal — the LOCK — because the seal is a per-round
// director switch and the whole failure is the round where it is off.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { TeamLeaderboard } from "./Leaderboard";
import { concealHoleData } from "../lib/reveal";

afterEach(cleanup);

const A = ["a1", "a2", "a3", "a4"];
const B = ["b1", "b2", "b3", "b4"];
const PARS = Array(18).fill(4);

// Initials are what a card prints, so every man gets a distinct pair and the
// assertions below match a cell EXACTLY rather than searching the page for a
// two-letter substring that "REVEALED" also contains.
const NAMES = {
  a1: "Ada Irons", a2: "Ben Irons", a3: "Cal Irons", a4: "Dan Irons",
  b1: "Eve Wedge", b2: "Fay Wedge", b3: "Gus Wedge", b4: "Hal Wedge",
};
const OURS = ["AI", "BI", "CI", "DI"];
const THEIRS = ["EW", "FW", "GW", "HW"];

const courses = [{
  id: "c1", name: "Treetops",
  hole_pars: PARS,
  hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1),
  tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }],
}];

const tPlayers = [...A, ...B].map((pid) => ({
  player_id: pid, name: NAMES[pid], team: A.includes(pid) ? "A" : "B",
  handicap_index: 0,
}));

const teams = { A: { name: "Irons" }, B: { name: "Wedges" } };

const bestBall = (over = {}) => ({
  round_number: 4, format: "team_best_ball", course_id: "c1", tee_box: "White",
  handicap_mode: "full", scoring_type: "points",
  counting_scores: { holes: Array(18).fill(2) },
  // Played in the open. This is the state the fix is about: `isConcealing` is
  // false, so the board draws the round like any other and the card behind the
  // row is reachable.
  sealed: false,
  ...over,
});

const singles = {
  round_number: 1, format: "singles", course_id: "c1", tee_box: "White",
  handicap_mode: "full", scoring_type: "match",
};

const matches = [
  { id: "m1", round: 1, teamA: ["a1"], teamB: ["b1"], scoring_type: "match" },
  { id: "m4", round: 4, teamA: A, teamB: B, scoring_type: "points" },
];

// B is three shots a hole better on every hole of round 4.
const holeData = {};
Array.from({ length: 18 }, (_, h) => h).forEach((h) => {
  holeData.a1_1 = { ...(holeData.a1_1 || {}), [h]: 5 };
  holeData.b1_1 = { ...(holeData.b1_1 || {}), [h]: 4 };
  A.forEach((pid) => { holeData[`${pid}_4`] = { ...(holeData[`${pid}_4`] || {}), [h]: 6 }; });
  B.forEach((pid) => { holeData[`${pid}_4`] = { ...(holeData[`${pid}_4`] || {}), [h]: 3 }; });
});

// An EXACT cell match. A card prints initials in a cell of their own, so this
// asks the question the screen actually answers — is this man's row on it —
// rather than whether two letters appear anywhere in the page's text.
const cell = (container, text) =>
  [...container.querySelectorAll("*")].some(
    (el) => el.children.length === 0 && el.textContent.trim() === text,
  );

const board = ({ tRounds, roundLocks = {}, viewer = "A" }) => render(
  <TeamLeaderboard
    matches={matches}
    holeData={concealHoleData(holeData, tRounds)}
    ownHoleData={holeData}
    countdownHoleData={holeData}
    courses={courses}
    tRounds={tRounds}
    tPlayers={tPlayers}
    teams={teams}
    hcpOverrides={{}}
    teeAssignments={{}}
    roundLocks={roundLocks}
    viewer={viewer}
  />
);

// The match row, found by the men on it rather than by position — the board
// draws a section header per round above them. Tapping it is what cycles the
// card: once to the points tally, twice to the full scorecard.
// The eight-a-side row is the one carrying a man who is in no other match —
// `Ben Irons` plays round 4 and nothing else, so this cannot pick up round 1's
// Ada-versus-Eve row by accident whichever order the sections are drawn in.
const teamRow = (result) => result.getAllByRole("button")
  .find((b) => b.textContent.includes("Ben Irons"));
const singlesRow = (result) => result.getAllByRole("button")
  .find((b) => b.textContent.includes("Ada Irons") && !b.textContent.includes("Ben Irons"));

const openCard = (result, taps) => {
  const row = teamRow(result);
  for (let i = 0; i < taps; i += 1) fireEvent.click(row);
  return result.container;
};

const NOTE = "FULL CARD WHEN THE ROUND IS FINAL";

const live = [singles, bestBall()];

describe("a team round's full card, while the round is being played", () => {
  it("draws the reader's own side and says where the rest is", () => {
    const c = openCard(board({ tRounds: live }), 2);
    OURS.forEach((ini) => expect(cell(c, ini)).toBe(true));
    expect(c.textContent).toContain(NOTE);
  });

  it("does not draw one row of the other side", () => {
    const c = openCard(board({ tRounds: live }), 2);
    THEIRS.forEach((ini) => expect(cell(c, ini)).toBe(false));
  });

  it("reads from the OTHER side for a reader on it", () => {
    const c = openCard(board({ tRounds: live, viewer: "B" }), 2);
    THEIRS.forEach((ini) => expect(cell(c, ini)).toBe(true));
    OURS.forEach((ini) => expect(cell(c, ini)).toBe(false));
  });

  it("is not unlocked by every man having posted all eighteen", () => {
    // Every hole of the fixture is in and the match is decided — the row says
    // FINAL. The ROUND is not in the books, and that is the thing that opens
    // this card.
    const c = openCard(board({ tRounds: live }), 2);
    expect(c.textContent).toContain("FINAL");
    expect(c.textContent).toContain(NOTE);
  });
});

describe("and once the director puts the round in the books", () => {
  it("draws both sides in full, with nothing withheld", () => {
    const c = openCard(board({
      tRounds: [singles, bestBall({ final: true })],
      roundLocks: { 4: { locked: true, final: true } },
    }), 2);
    [...OURS, ...THEIRS].forEach((ini) => expect(cell(c, ini)).toBe(true));
    expect(c.textContent).not.toContain(NOTE);
  });
});

describe("a sealed round never gets this far", () => {
  it("has no match row to tap at all", () => {
    // Belt and braces on the ordinary case: `isConcealing` takes the rows away
    // before any of the above applies. Tapping everything the section draws
    // must still put nothing of either side on screen.
    const r = board({ tRounds: [singles, bestBall({ sealed: true, reveal_through: 0 })] });
    r.getAllByRole("button").forEach((b) => fireEvent.click(b));
    [...OURS, ...THEIRS].forEach((ini) => expect(cell(r.container, ini)).toBe(false));
  });
});

describe("a round whose match IS a foursome is untouched", () => {
  it("opens straight to both cards on one tap", () => {
    // Singles, best ball, scramble — the four men walked it together and wrote
    // all four rows between them. Withholding half of that would be hiding a
    // card from the people who kept it.
    const r = board({ tRounds: live });
    // Round 1's section is folded away behind the round the field is out on.
    fireEvent.click(r.getAllByRole("button")[0]);
    fireEvent.click(singlesRow(r));
    expect(cell(r.container, "AI")).toBe(true);
    expect(cell(r.container, "EW")).toBe(true);
    expect(r.container.textContent).not.toContain(NOTE);
  });
});
