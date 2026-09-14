/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  The sealed card, and whose gross scores are on it.
// ══════════════════════════════════════════════════════════════════
//
// The closing round is played in the dark: neither side may learn the
// other's scores until the cards come back to the house and the room turns
// them over a hole at a time (src/lib/reveal.js).
//
// This card hid the things that COMPARE the two sides — the side's net row,
// the hole-won boxes, the running line, the nine's result — and went on
// printing every player's GROSS row underneath them. That was deliberate and
// it was right for the round it was written against: a 2v2 match IS one
// foursome, so the four men on the card walked it together and wrote all four
// of those rows themselves, and taking them back would be hiding numbers they
// typed an hour ago.
//
// Team Best Ball breaks it in half. Its match is the whole side across four
// tee waves — sixteen men on one card — so the eight on the other side are a
// different group on a different tee that this phone never saw. The card was
// handing over all eight of their cards, in full, on the one round of the
// year whose entire point is that nobody knows.
//
// So the gross rows now follow the same rule as everything else on a sealed
// card, EXCEPT when the two sides genuinely shared a foursome. Both halves
// are pinned here, because either one alone is a card that is wrong.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { FullScorecard } from "./FullScorecard";
import { computeMatchResult } from "../scoring";

afterEach(cleanup);

const PARS = Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
const courses = [{
  id: "c1", name: "Treetops", hole_pars: PARS, hole_handicaps: SI,
  tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }],
}];

// Scratch all round, so every net is its gross and nothing below turns on a
// handicap allocation.
const mk = (pid, team) => ({ player_id: pid, name: `${team}${pid} Man`, team, handicap_index: 0 });
const teamA = ["a1", "a2", "a3", "a4"];
const teamB = ["b1", "b2", "b3", "b4"];
const tPlayers = [...teamA.map(p => mk(p, "A")), ...teamB.map(p => mk(p, "B"))];

// A shoots 4s, B shoots 11s, so B's nine totals 99 — a number that appears
// nowhere else on this card, which is what gives "is B's card on screen" an
// exact answer instead of a guess at which 4 belongs to whom. Deliberately
// NOT 108: that is what A's own NET row comes to (best three of four 4s, nine
// times over), and a sentinel that collides with a number the reader IS
// entitled to see would fail this suite for the wrong reason.
const A_SHOT = 4, B_SHOT = 11, B_NINE = 99;
const holeData = {};
teamA.forEach(p => { holeData[`${p}_4`] = {}; for (let h = 0; h < 18; h++) holeData[`${p}_4`][h] = A_SHOT; });
teamB.forEach(p => { holeData[`${p}_4`] = {}; for (let h = 0; h < 18; h++) holeData[`${p}_4`][h] = B_SHOT; });

const round = {
  round_number: 4, format: "team_best_ball", course_id: "c1", tee_box: "White",
  handicap_mode: "full", scoring_type: "match", sealed: true, reveal_through: 0,
  counting_scores: { holes: [...Array(9).fill(3), ...Array(9).fill(3)] },
};
const match = { id: "m4", round: 4, teamA, teamB, scoring_type: "match" };

// `through: 0` is the state the round spends the whole afternoon in: sealed,
// and not one hole turned over yet.
const SEALED = { through: 0, side: "A" };

const card = (conceal) => {
  const result = computeMatchResult(
    match, holeData, courses, [round], tPlayers, "team_best_ball", {}, undefined, {}, {},
  );
  return render(
    <FullScorecard
      match={match} result={result} format="team_best_ball"
      holePars={PARS} holeHcps={SI} course={courses[0]}
      tPlayers={tPlayers} viewer="A" conceal={conceal}
      getScore={(pid, h) => holeData[`${pid}_4`]?.[h] || 0}
    />,
  ).container;
};

const locks = (el) => el.querySelectorAll('[title="Sealed until the reveal"]').length;

describe("a sealed card whose match is bigger than a foursome", () => {
  // mixedFoursome false: Team Best Ball. Nobody holding this phone wrote a
  // stroke of the other side's card.
  const teamRound = { ...SEALED, mixedFoursome: false };

  it("does not print the other side's totals", () => {
    expect(card(teamRound).textContent).not.toContain(String(B_NINE));
  });

  it("still prints the reader's own side in full", () => {
    // A team is never hidden from itself — the line every surface in this app
    // draws. Four players, two nines, 36 apiece.
    const text = card(teamRound).textContent;
    expect(text).toContain("36");
  });

  it("locks every one of the other side's gross cells", () => {
    // Four B players over eighteen holes. Counted against the SAME card drawn
    // for a foursome that did share a tee, so the difference is exactly the
    // gross rows and nothing else on the card has moved.
    const shared = locks(card({ ...SEALED, mixedFoursome: true }));
    expect(locks(card(teamRound)) - shared).toBe(teamB.length * 18);
  });
});

describe("a sealed card whose two sides shared a foursome", () => {
  // mixedFoursome true: a 2v2 match is one foursome, so these four men wrote
  // all four of these rows between them. What the blackout owes them is what
  // the scores ADD UP TO, not the scores back.
  const foursome = { ...SEALED, mixedFoursome: true };

  it("keeps printing the opponents' gross rows", () => {
    expect(card(foursome).textContent).toContain(String(B_NINE));
  });

  it("still withholds what those scores come to", () => {
    // The card's own header: a sealed round states no result either way.
    expect(card(foursome).textContent).toContain("SEALED");
    expect(locks(card(foursome))).toBeGreaterThan(0);
  });
});

describe("an unsealed card", () => {
  it("prints both sides, and locks nothing", () => {
    const el = card(null);
    expect(el.textContent).toContain(String(B_NINE));
    expect(locks(el)).toBe(0);
  });
});
