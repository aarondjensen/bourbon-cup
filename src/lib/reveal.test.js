import { describe, it, expect } from "vitest";
import {
  resolveSealed,
  HOLE_COUNT, sealDefaultFor, isSealedRound, revealedThrough, isFullyRevealed,
  isConcealing, revealState, concealedRoundNumbers, concealHoleData,
  stepReveal, revealSummary,
} from "./reveal";

// The blackout is the one feature of this app whose failure mode is silent
// and unrecoverable: a leaderboard that shows one hole too many has given
// away an ending that cannot be un-given. So the subtraction gets pinned
// down here rather than trusted to read correctly.

const round = (n, extra = {}) => ({ round_number: n, format: "singles", ...extra });
const sealedRound = (n, through, extra = {}) =>
  round(n, { format: "team_best_ball", sealed: true, reveal_through: through, ...extra });

// n holes posted for a player in a round: { 0: 4, 1: 4, … }
const card = (n, s = 4) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i, s]));

describe("sealDefaultFor", () => {
  it("opens Team Best Ball sealed and nothing else", () => {
    expect(sealDefaultFor("team_best_ball")).toBe(true);
    expect(sealDefaultFor("singles")).toBe(false);
    expect(sealDefaultFor("best_ball")).toBe(false);
    expect(sealDefaultFor(undefined)).toBe(false);
  });
});

describe("isSealedRound", () => {
  // A stored flag is the director's word and always wins, in both directions.
  it("takes the stored flag over everything", () => {
    expect(isSealedRound(round(4, { format: "team_best_ball", sealed: true }))).toBe(true);
    expect(isSealedRound(round(4, { format: "team_best_ball", sealed: false }))).toBe(false);
    // Even on a finished round, and even against the format.
    expect(isSealedRound(round(4, { format: "team_best_ball", sealed: false, final: true }))).toBe(false);
    expect(isSealedRound(round(1, { format: "best_ball", sealed: true }))).toBe(true);
  });

  // The reason this fallback exists. The seed only reaches the document when a
  // director opens that round's form, so a Team Best Ball round nobody edited
  // was played in the open — opponents' scores and the match status on every
  // phone on the course, which is the one thing the reveal is for.
  it("seals an unflagged Team Best Ball round that is still live", () => {
    expect(isSealedRound(round(4, { format: "team_best_ball" }))).toBe(true);
  });

  // The other end, and the load-bearing one: every imported year is written
  // locked and final, so none of a decade of results can be pulled off the
  // board by this fallback.
  it("never seals a finished round on the format alone", () => {
    expect(isSealedRound(round(4, { format: "team_best_ball", final: true }))).toBe(false);
  });

  it("leaves every other format alone", () => {
    expect(isSealedRound(round(1, { format: "best_ball" }))).toBe(false);
    expect(isSealedRound(round(2, { format: "scramble" }))).toBe(false);
    expect(isSealedRound(round(3, { format: undefined }))).toBe(false);
    expect(isSealedRound(null)).toBe(false);
  });
});

describe("resolveSealed", () => {
  // One rule, shared by the Rounds form's seed and the board that reads it.
  // They each held their own copy, which is how a form and a scoreboard came
  // to disagree about what an unwritten flag meant.
  it("is the same answer the Rounds form seeds from", () => {
    expect(resolveSealed("team_best_ball", null, false)).toBe(true);
    expect(resolveSealed("team_best_ball", null, true)).toBe(false);
    expect(resolveSealed("team_best_ball", undefined, false)).toBe(true);
    expect(resolveSealed("best_ball", null, false)).toBe(false);
    expect(resolveSealed("best_ball", true, true)).toBe(true);
    expect(resolveSealed("team_best_ball", false, false)).toBe(false);
  });
});

describe("revealedThrough", () => {
  it("is every hole on a round that isn't sealed", () => {
    expect(revealedThrough(round(1))).toBe(HOLE_COUNT);
    expect(revealedThrough(round(1, { reveal_through: 3 }))).toBe(HOLE_COUNT);
  });

  it("is nothing on a sealed round that has never been stepped", () => {
    expect(revealedThrough(round(4, { sealed: true }))).toBe(0);
    expect(revealedThrough(round(4, { sealed: true, reveal_through: null }))).toBe(0);
    expect(revealedThrough(round(4, { sealed: true, reveal_through: "nonsense" }))).toBe(0);
  });

  it("clamps to the card", () => {
    expect(revealedThrough(sealedRound(4, -5))).toBe(0);
    expect(revealedThrough(sealedRound(4, 99))).toBe(HOLE_COUNT);
    expect(revealedThrough(sealedRound(4, 7))).toBe(7);
  });
});

describe("isConcealing", () => {
  it("stops the moment the last hole is turned over", () => {
    expect(isConcealing(sealedRound(4, 0))).toBe(true);
    expect(isConcealing(sealedRound(4, 17))).toBe(true);
    expect(isConcealing(sealedRound(4, 18))).toBe(false);
    expect(isConcealing(round(4))).toBe(false);
  });

  // The flag survives the reveal — a revealed round still reads as a sealed
  // one in Admin, and re-sealing it is a step back, not a re-tick.
  it("leaves the round sealed once it is fully revealed", () => {
    expect(isFullyRevealed(sealedRound(4, 18))).toBe(true);
    expect(isSealedRound(sealedRound(4, 18))).toBe(true);
  });
});

describe("revealState / concealedRoundNumbers", () => {
  const tRounds = [round(1), round(2), sealedRound(3, 18), sealedRound(4, 6)];

  it("answers per round", () => {
    expect(revealState(tRounds, 1)).toEqual({ sealed: false, concealing: false, through: 18 });
    expect(revealState(tRounds, 3)).toEqual({ sealed: true, concealing: false, through: 18 });
    expect(revealState(tRounds, 4)).toEqual({ sealed: true, concealing: true, through: 6 });
  });

  it("reads an unknown round as wide open", () => {
    expect(revealState(tRounds, 9)).toEqual({ sealed: false, concealing: false, through: 18 });
    expect(revealState(undefined, 1).concealing).toBe(false);
  });

  it("lists only the rounds still holding something back", () => {
    expect(concealedRoundNumbers(tRounds)).toEqual([4]);
    expect(concealedRoundNumbers([round(1), round(2)])).toEqual([]);
  });
});

describe("concealHoleData", () => {
  const data = { p1_3: card(18), p1_4: card(18), "p_two_4": card(12) };

  it("hands back the same object when nothing is sealed", () => {
    const tRounds = [round(3), round(4)];
    expect(concealHoleData(data, tRounds)).toBe(data);
  });

  it("hands back the same object once everything is revealed", () => {
    expect(concealHoleData(data, [round(3), sealedRound(4, 18)])).toBe(data);
  });

  it("drops the round entirely when nothing has been turned over", () => {
    const out = concealHoleData(data, [round(3), sealedRound(4, 0)]);
    expect(out.p1_4).toBeUndefined();
    expect(out.p_two_4).toBeUndefined();
    // Every other round is untouched.
    expect(out.p1_3).toEqual(card(18));
  });

  it("keeps exactly the revealed holes and no more", () => {
    const out = concealHoleData(data, [sealedRound(4, 6)]);
    expect(Object.keys(out.p1_4).map(Number).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(out.p1_4[5]).toBe(4);
    expect(out.p1_4[6]).toBeUndefined();
  });

  // A player id with underscores in it must not be read as a round number.
  it("reads the round off the last separator", () => {
    const out = concealHoleData(data, [sealedRound(4, 3)]);
    expect(Object.keys(out.p_two_4)).toHaveLength(3);
  });

  it("leaves the original untouched", () => {
    concealHoleData(data, [sealedRound(4, 3)]);
    expect(Object.keys(data.p1_4)).toHaveLength(18);
  });

  it("survives an empty map", () => {
    expect(concealHoleData(undefined, [sealedRound(4, 3)])).toEqual({});
  });
});

describe("stepReveal", () => {
  it("walks the card and stops at both ends", () => {
    expect(stepReveal(0, 1)).toBe(1);
    expect(stepReveal(0, -1)).toBe(0);
    expect(stepReveal(17, 1)).toBe(18);
    expect(stepReveal(18, 1)).toBe(18);
    expect(stepReveal(undefined, 1)).toBe(1);
  });
});

describe("revealSummary", () => {
  it("says nothing is out rather than '0 of 18'", () => {
    expect(revealSummary(0)).toBe("Sealed — nothing revealed yet");
    expect(revealSummary(6)).toBe("6 of 18 holes revealed");
  });
});

// ── The whole point, end to end ────────────────────────────────────
// isSealedRound is a predicate; what the field actually experiences is
// concealHoleData, which is what the scoreboard and the Data tab are scored
// off. These pin the subtraction on the shape that failed: a live cup whose
// round 4 nobody opened the Rounds form for.
describe("a live Team Best Ball round nobody flagged", () => {
  const liveCup = [
    { round_number: 1, format: "best_ball" },
    { round_number: 4, format: "team_best_ball" },
  ];
  const holes = {
    "a1_1": { 0: 4, 1: 5, 2: 3 },
    "a1_4": { 0: 4, 1: 5, 2: 3 },
    "b1_4": { 0: 5, 1: 4, 2: 4 },
  };

  it("takes round 4 off the board entirely and leaves round 1 alone", () => {
    const out = concealHoleData(holes, liveCup);
    expect(out["a1_1"]).toEqual({ 0: 4, 1: 5, 2: 3 });
    // Nothing turned over yet, so the round has no scores at all — no side
    // totals, no match status, nothing banked.
    expect(out["a1_4"]).toBeUndefined();
    expect(out["b1_4"]).toBeUndefined();
  });

  it("hands the holes back as the director turns them over", () => {
    const through2 = [{ round_number: 4, format: "team_best_ball", reveal_through: 2 }];
    const out = concealHoleData(holes, through2);
    expect(out["a1_4"]).toEqual({ 0: 4, 1: 5 });
    expect(out["b1_4"]).toEqual({ 0: 5, 1: 4 });
  });

  it("is fully open again once all eighteen are revealed", () => {
    const done = [{ round_number: 4, format: "team_best_ball", reveal_through: HOLE_COUNT }];
    expect(concealHoleData(holes, done)).toBe(holes);
  });

  // A decade of results must survive the deploy that turned this on.
  it("does not touch a finished year", () => {
    const history = [{ round_number: 4, format: "team_best_ball", final: true }];
    expect(concealHoleData(holes, history)).toBe(holes);
  });

  // And a director who deliberately wants it live keeps that.
  it("respects an explicit unseal", () => {
    const open = [{ round_number: 4, format: "team_best_ball", sealed: false }];
    expect(concealHoleData(holes, open)).toBe(holes);
  });
});
