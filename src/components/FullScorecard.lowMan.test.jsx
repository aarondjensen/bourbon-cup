/** @vitest-environment jsdom */
// ── A low-man nine has no total to state ────────────────────────────
// Under low_man the strokes are the DIFFERENCE off the lowest playing
// handicap in the match, so a hole's net is a figure relative to one man.
// Per hole that is exactly right and it is what the match is settled on.
// Added up, it stops being that: the low man's "net" total is his gross, and
// the man off 18 posts a number that is not what he shot, not what he would
// post off his own handicap, and not comparable to anybody in another match.
//
// These pin the three halves of the rule — the total goes, the per-hole nets
// stay, and the gross totals above are untouched — plus the two cases that
// keep their total: a full-handicap round, whose nets are real net scores,
// and a dots round, whose numbers accrue and whose total is the point of it.
//
// The assertions go through the DOM rather than textContent, because the
// question is WHICH CELL a number is in. The side's row is a label cell, nine
// hole cells and a total cell, in that order.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { FullScorecard } from "./FullScorecard";
import { computeMatchResult } from "../scoring";

afterEach(cleanup);

const PARS = Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
const course = {
  id: "c1", name: "Treetops", hole_pars: PARS, hole_handicaps: SI,
  tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }],
};
// Scratch against an 18. Under low_man that is a stroke a hole for B and
// none for A, so their nets are 4 and 4 — level every hole, and B's nine
// "nets" to 36 having actually shot 45.
const tPlayers = [
  { player_id: "a1", name: "Sam Osborne", team: "A", handicap_index: 0 },
  { player_id: "b1", name: "Vic Carr", team: "B", handicap_index: 18 },
];

const card = ({ format = "singles", mode = "low_man", grossB = 5 } = {}) => {
  const tRounds = [{
    round_number: 1, format, course_id: "c1", tee_box: "White",
    handicap_mode: mode, scoring_type: format === "double_dot" ? "total" : "match",
  }];
  const match = { id: "m1", round: 1, teamA: ["a1"], teamB: ["b1"] };
  const holeData = { a1_1: {}, b1_1: {} };
  for (let h = 0; h < 18; h++) { holeData.a1_1[h] = 4; holeData.b1_1[h] = grossB; }
  const result = computeMatchResult(
    match, holeData, [course], tRounds, tPlayers, format, {}, undefined, {}, {},
  );
  return render(
    <FullScorecard
      match={match} result={result} format={format}
      holePars={PARS} holeHcps={SI} course={course}
      tPlayers={tPlayers} viewer="A"
      getScore={(pid, h) => holeData[`${pid}_1`]?.[h] || 0}
    />,
  ).container;
};

// Every row whose first cell STARTS with `label` — the side rows are exactly
// "NET", "DOTS" or "PTS"; a player's gross row is their initials followed by
// the playing handicap the dots on it were allocated from ("VC18").
const rows = (container, label) => [...container.querySelectorAll("div")]
  .filter(d => d.children.length > 2 && d.children[0].textContent.startsWith(label));
const totalOf = (row) => row.children[row.children.length - 1].textContent.trim();
const holesOf = (row) => [...row.children].slice(1, -1).map(c => c.textContent.trim());

describe("the NET row's total, under low_man", () => {
  it("states no total on either nine", () => {
    const net = rows(card(), "NET");
    expect(net.length).toBeGreaterThan(0);
    net.forEach(r => expect(totalOf(r)).toBe(""));
  });

  // The whole point of keeping the nets: 4 against 4 IS the hole, whoever the
  // low man is, and it is what the match is settled on.
  it("keeps every per-hole net", () => {
    const net = rows(card(), "NET");
    net.forEach(r => expect(holesOf(r).filter(Boolean)).toHaveLength(9));
    // B shot 5s off a stroke a hole: every net is a 4.
    expect(holesOf(net[net.length - 1])).toEqual(Array(9).fill("4"));
  });

  // The gross total is the number a man is actually looking for, and it sits
  // directly above the blank one in the same column.
  it("leaves the gross totals alone", () => {
    const c = card();
    const gross = rows(c, "VC");
    expect(gross.length).toBeGreaterThan(0);
    expect(totalOf(gross[0])).toBe("45");   // nine 5s
  });
});

describe("the rounds that keep their total", () => {
  // Team Best Ball is the app's one full-handicap format: everybody plays
  // their whole figure, so a net is a real net score and nine of them sum to
  // one. Asked of the ROUND, not the format — a director who moves a round
  // to full gets the same answer.
  it("states it on a full-handicap round", () => {
    const net = rows(card({ mode: "full" }), "NET");
    expect(net.length).toBeGreaterThan(0);
    net.forEach(r => expect(totalOf(r)).not.toBe(""));
  });

  // Dots accrue — a side that sweeps a hole banks two — and the total is what
  // the segment is settled on. Low-man or not, it is not a net score and the
  // rule above has nothing to say about it.
  it("states it on a dots round", () => {
    const dots = rows(card({ format: "double_dot" }), "DOTS");
    expect(dots.length).toBeGreaterThan(0);
    expect(dots.some(r => totalOf(r) !== "")).toBe(true);
  });
});
