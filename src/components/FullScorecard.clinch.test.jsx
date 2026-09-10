/** @vitest-environment jsdom */
// ── A card that was decided, and then went on being scored ─────────
// Every hole of every round is played here whatever the 18-hole match did —
// the two nine pots outlive it, the skins and the total outlive those — so a
// card carries scores on holes the match was already over for.
//
// This pins what the card SAYS about that, in the two places it says it: the
// header chip over the four names, and the stamp on the hole the match
// closed. They used to be two different pieces of arithmetic, and they
// disagreed by exactly the holes played after the closeout — the row stamped
// 8&6 on the twelfth while the chip three inches above it read 10&4, which is
// not a score golf can produce.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { FullScorecard } from "./FullScorecard";
import { computeMatchResult } from "../scoring";
import { BC, teamColor } from "../theme";

afterEach(cleanup);

const PARS = Array(18).fill(4);
const courses = [{
  id: "c1", name: "Treetops",
  hole_pars: PARS,
  hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1),
  tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }],
}];
const tRounds = [{
  round_number: 1, format: "singles", course_id: "c1", tee_box: "White",
  handicap_mode: "full", scoring_type: "match",
}];
const tPlayers = [
  { player_id: "a1", name: "Sam Osborne", team: "A", handicap_index: 0 },
  { player_id: "b1", name: "Vic Carr", team: "B", handicap_index: 0 },
];
const match = { id: "m1", round: 1, teamA: ["a1"], teamB: ["b1"], scoring_type: "match" };

// B takes the first nine, A takes the 10th and 11th, B takes the 12th — which
// ends it, 8 up with 6 to play — and the group scores the 13th and 14th on
// their way to a back nine that is still worth playing for.
const WINNERS = "BBBBBBBBBAABBB";
const holeData = { a1_1: {}, b1_1: {} };
[...WINNERS].forEach((w, h) => {
  holeData.a1_1[h] = w === "A" ? 3 : 5;
  holeData.b1_1[h] = w === "A" ? 5 : 3;
});

const card = (viewer) => {
  const result = computeMatchResult(
    match, holeData, courses, tRounds, tPlayers, "singles", {}, undefined, {}, {},
  );
  return render(
    <FullScorecard
      match={match} result={result} format="singles"
      holePars={PARS} holeHcps={courses[0].hole_handicaps} course={courses[0]}
      tPlayers={tPlayers} viewer={viewer}
      getScore={(pid, h) => holeData[`${pid}_1`]?.[h] || 0}
    />,
  ).container;
};

describe("a match scored past its own closeout", () => {
  it("reads 8&6 in both places, and 10&4 in neither", () => {
    const text = card("A").textContent;
    expect(text).toContain("8&6");
    expect(text).not.toContain("10&4");
  });

  it("says nothing about the match on the holes after it ended", () => {
    // The running line ends on the twelfth, where the stamp is. ▼9 belongs
    // to the ninth and is inside the match; ▼10 would be the thirteenth,
    // which the match was not there for.
    const text = card("A").textContent;
    expect(text).toContain("▼9");     // the ninth, still inside the match
    expect(text).not.toContain("▼10");
    // Nothing after the stamp on the twelfth still runs the match.
    expect(text.split("8&6").pop()).not.toMatch(/[▲▼]/);
  });

  it("gives each nine the result it finished on, not the one it ran to", () => {
    // The front closed on the fifth — 5&4 — and B went on to win the rest of
    // it. Read off the running margin that nine printed "9 UP".
    const text = card("A").textContent;
    expect(text).toContain("5&4");
    expect(text).not.toContain("9 UP");
  });
});

// ── Whose lead it is, not whether it is good news ──────────────────
// The MATCH row's running number was the last green/red match state in the
// app: green when the reader's side was up, red when it was down. Two things
// wrong with it, and the second is the one that was reported.
//
// `viewer` is App.jsx's `userTeam`, which falls back to a reader's ROSTER
// team when he is not in the match — so a director opening somebody else's
// card was handed a side he does not have, and read a red ▼ naming a loser
// who was nobody. And BC.teamA under BC.green is two greens two pixels
// apart, saying nearly the same thing in different hues.
//
// The colour is the leading team's now, which is a question this row can
// always answer and the currency every other mark on the card is already in.
// The ▲ / ▼ still points from the reader's side; it never needed a colour.
const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
// Every running-match glyph on the card, as [text, colour].
const runningCells = (root) => [...root.querySelectorAll("span")]
  .filter(el => /^[▲▼]\d+$/.test(el.textContent))
  .map(el => [el.textContent, el.style.color]);

describe("the running match is coloured for the team, not the reader", () => {
  it("hands both readers the same colours", () => {
    // Same card, opposite sides of it. The arrows flip and nothing else does
    // — which is what lets somebody on neither side read it at all.
    const a = runningCells(card("A")), b = runningCells(card("B"));
    expect(a.length).toBeGreaterThan(8);
    expect(a.map(([, c]) => c)).toEqual(b.map(([, c]) => c));
    expect(a.map(([t]) => t)).not.toEqual(b.map(([t]) => t));
  });

  it("paints the lead in the leading team's colour", () => {
    // B leads every hole of this card except none — every glyph is B's.
    const cells = runningCells(card("A"));
    expect(cells.every(([t]) => t.startsWith("▼"))).toBe(true);
    expect(new Set(cells.map(([, c]) => c))).toEqual(new Set([rgb(teamColor("B"))]));
  });

  it("uses neither the good-news nor the bad-news colour", () => {
    for (const viewer of ["A", "B"]) {
      const colours = new Set(runningCells(card(viewer)).map(([, c]) => c));
      expect(colours).not.toContain(rgb(BC.green));
      expect(colours).not.toContain(rgb(BC.danger));
    }
  });
});
