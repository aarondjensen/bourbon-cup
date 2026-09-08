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
