import { describe, it, expect } from "vitest";
import {
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
  // The load-bearing one. If the format could imply a seal, every Team Best
  // Ball round ever played would go dark the moment this shipped — including
  // the ones whose results have been on the board for a decade.
  it("is explicit — a format never implies it", () => {
    expect(isSealedRound(round(4, { format: "team_best_ball" }))).toBe(false);
    expect(isSealedRound(round(4, { format: "team_best_ball", sealed: true }))).toBe(true);
    expect(isSealedRound(round(4, { format: "team_best_ball", sealed: false }))).toBe(false);
    expect(isSealedRound(null)).toBe(false);
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
