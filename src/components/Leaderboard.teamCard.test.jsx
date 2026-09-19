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
// scores left in it. A sealed round draws no match rows at all — so the round
// that got here was a Team Best Ball round being played in the open, which at
// the time was one tap on the Formats tab away.
//
// THE SEAL HAS SINCE CLOSED THAT DOOR FIRST: `resolveSealed` refuses an
// unseal on a live closing round, so the rows are gone before any of this
// applies. This file therefore pins TWO things, and the second is the reason
// the first is not enough on its own:
//
//   • the composite: a live team round puts nothing on the board, whatever
//     its `sealed` flag says;
//   • the SECOND LOCK: the card opens on the ROUND LOCK, not on the seal's
//     say-so. Asserted in the state where the two disagree — the round
//     released from the seal, the lock not yet landed — because a guarantee
//     that only holds while another guarantee holds is one guarantee.
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
  ...over,
});

// The round released from the seal but NOT in the books — `sealed: false` with
// `final` on the document (which is what lets the unseal through at all) and
// no row in `roundLocks`. Contrived on purpose: it is the one state that
// reaches the match card with the round not final, and it is exactly the
// disagreement the second lock exists to survive.
const released = bestBall({ sealed: false, final: true });

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

const live = [singles, released];

describe("a team round's full card, while the round is not in the books", () => {
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

describe("and the outer wall, which closes it first", () => {
  // The seal takes the rows away entirely, so none of the above is reached on
  // a round anybody actually plays. Tapping everything the section draws must
  // put nothing of either side on screen, and no cup points either.
  const noRows = (tr) => {
    const r = board({ tRounds: [singles, tr] });
    // What the board says at rest — the section opens itself on a concealing
    // round, so this is what a player finds when he taps the tab.
    const atRest = r.container.textContent;
    // And then every control on it, in case one of them is a way in. The
    // round header is among them, so the section ends up closed; the
    // assertions below are about what is never drawn, not about the panel.
    r.getAllByRole("button").forEach((b) => fireEvent.click(b));
    [...OURS, ...THEIRS].forEach((ini) => expect(cell(r.container, ini)).toBe(false));
    // 27 is what B banks on this fixture, and it must not appear in either
    // state — not on the round's score slot, not in the cup bar, not in a
    // per-hole tally behind a tap.
    [atRest, r.container.textContent].forEach((t) => expect(t).not.toContain("27"));
    return atRest;
  };

  it("draws no match row on a sealed round", () => {
    expect(noRows(bestBall({ sealed: true, reveal_through: 0 }))).toContain("WAITING ON THE FINAL COUNTDOWN");
  });

  it("draws none on a round a director tried to unseal mid-play", () => {
    // The whole of what stood between the field and round 4's cup points.
    expect(noRows(bestBall({ sealed: false }))).toContain("WAITING ON THE FINAL COUNTDOWN");
  });

  it("draws none on a round whose flag was never written", () => {
    expect(noRows(bestBall())).toContain("WAITING ON THE FINAL COUNTDOWN");
  });

  it("holds until the eighteenth hole AND the director", () => {
    expect(noRows(bestBall({ sealed: true, reveal_through: 18 })))
      .toContain("WAITING ON THE FINAL COUNTDOWN");
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
