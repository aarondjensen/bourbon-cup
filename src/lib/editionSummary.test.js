import { describe, it, expect } from "vitest";
import { summarizeEdition, sameSummary } from "./editionSummary";

// A minimal but real tournament: one 18-hole singles match, par 4s, no
// handicaps in play, A shooting 4s and B shooting 5s. A wins every hole.
const course = {
  id: "c1",
  hole_pars: Array(18).fill(4),
  hole_handicaps: Array.from({ length: 18 }, (_, h) => h + 1),
  tee_boxes: [{ name: "Blue", slope: 113, rating: 72, par: 72 }],
};
const tPlayers = [
  { player_id: "a1", name: "A One", team: "A", handicap_index: 0 },
  { player_id: "b1", name: "B One", team: "B", handicap_index: 0 },
];
const card = (v) => Object.fromEntries(Array.from({ length: 18 }, (_, h) => [h, v]));
const holeData = { a1_1: card(4), b1_1: card(5) };
const tRounds = [{ round_number: 1, format: "singles", course_id: "c1", tee_box: "Blue" }];
const matches = [{
  id: "m1", round: 1, teamA: ["a1"], teamB: ["b1"],
  nassau: { front: 1, back: 1, overall: 1 },
}];
const base = {
  matches, holeData, courses: [course], tRounds, tPlayers,
  teamNames: { A: "Mash Brothers", B: "Shot Callers" },
  location: "Gaylord, MI",
};
const finalLock = { 1: { locked: true, final: true } };

describe("summarizeEdition", () => {
  it("scores the cup off the cards", () => {
    const s = summarizeEdition({ ...base, roundLocks: finalLock });
    // A sweeps front, back and overall.
    expect(s.scoreA).toBe(3);
    expect(s.scoreB).toBe(0);
  });

  // The name, not the letter — "A won" means nothing three years later.
  it("names the winner", () => {
    const s = summarizeEdition({ ...base, roundLocks: finalLock });
    expect(s.winner).toBe("Mash Brothers");
    expect(s.halved).toBe(false);
  });

  // Team names are a property of the YEAR: 2023 was TEES against WEEZ.
  it("stores that year's team names, not this year's", () => {
    const s = summarizeEdition({
      ...base, roundLocks: finalLock, teamNames: { A: "TEES", B: "WEEZ" },
    });
    expect(s.teamA).toBe("TEES");
    expect(s.teamB).toBe("WEEZ");
    expect(s.winner).toBe("TEES");
  });

  it("carries the venue", () => {
    expect(summarizeEdition({ ...base, roundLocks: finalLock }).location).toBe("Gaylord, MI");
  });

  // A cup mid-round has a score but not a result, and only a result is
  // written down — see the write gate in App.
  it("is incomplete while a round is unfinalized", () => {
    const open = summarizeEdition({ ...base, roundLocks: { 1: { locked: true, final: false } } });
    expect(open.complete).toBe(false);
    expect(open.scoreA).toBe(3);   // the score is still real
  });

  it("is complete once every round is final", () => {
    expect(summarizeEdition({ ...base, roundLocks: finalLock }).complete).toBe(true);
  });

  it("is never complete with nothing played", () => {
    const s = summarizeEdition({ teamNames: { A: "X", B: "Y" } });
    expect(s.complete).toBe(false);
    expect(s.rounds).toBe(0);
    expect(s.winner).toBe(null);
  });

  // A halved cup is a real outcome, not a missing one.
  it("reports a halved cup rather than a winner", () => {
    const level = { ...holeData, b1_1: card(4) };
    const s = summarizeEdition({ ...base, holeData: level, roundLocks: finalLock });
    expect(s.scoreA).toBe(s.scoreB);
    expect(s.winner).toBe(null);
    expect(s.halved).toBe(true);
  });

  it("counts every round the tournament has", () => {
    const s = summarizeEdition({
      ...base,
      tRounds: [1, 2, 3, 4].map(round_number => ({ round_number, format: "singles", course_id: "c1" })),
      roundLocks: finalLock,
    });
    expect(s.rounds).toBe(4);
    // Only round 1 is final, so four rounds is not a finished cup.
    expect(s.complete).toBe(false);
  });
});

describe("sameSummary", () => {
  const s = summarizeEdition({ ...base, roundLocks: finalLock });

  it("matches an identical row", () => {
    expect(sameSummary(s, summarizeEdition({ ...base, roundLocks: finalLock }))).toBe(true);
  });

  it("does not match a missing row", () => {
    expect(sameSummary(undefined, s)).toBe(false);
    expect(sameSummary(s, null)).toBe(false);
  });

  it("notices a corrected score", () => {
    expect(sameSummary(s, { ...s, scoreA: 2 })).toBe(false);
  });

  // A renamed team or a corrected venue should land too.
  it("notices a rename and a moved venue", () => {
    expect(sameSummary(s, { ...s, teamA: "Something Else" })).toBe(false);
    expect(sameSummary(s, { ...s, location: "Grand Rapids, MI" })).toBe(false);
  });
});
