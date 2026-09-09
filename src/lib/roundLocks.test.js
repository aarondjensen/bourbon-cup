import { describe, it, expect } from "vitest";
import {
  currentRoundNumber,
  nextRoundNumber,
  unfinalizedRoundNumbers,
  openRoundAfter,
} from "./roundLocks";

// A lock map of the shape App maintains: { [round]: { locked, final } }.
const locks = (...finalRounds) =>
  Object.fromEntries(finalRounds.map(r => [r, { locked: true, final: true }]));

describe("unfinalizedRoundNumbers", () => {
  it("is every round nobody has frozen, ascending", () => {
    expect(unfinalizedRoundNumbers(locks(1, 2), [1, 2, 3, 4])).toEqual([3, 4]);
    expect(unfinalizedRoundNumbers({}, [3, 1, 2])).toEqual([1, 2, 3]);
    expect(unfinalizedRoundNumbers(locks(1, 2, 3, 4), [1, 2, 3, 4])).toEqual([]);
  });

  // The whole reason it exists: currentRoundNumber answers with ONE round, and
  // a round left open behind the live one is invisible to it.
  it("keeps a round the live one has moved past", () => {
    const l = locks(2);              // Saturday finalized, Friday never was
    expect(currentRoundNumber(l, [1, 2, 3])).toBe(1);
    expect(unfinalizedRoundNumbers(l, [1, 2, 3])).toEqual([1, 3]);
  });

  it("counts a locked-but-not-final round as still to do", () => {
    const l = { 1: { locked: true, final: false } };
    expect(unfinalizedRoundNumbers(l, [1, 2])).toEqual([1, 2]);
  });
});

describe("openRoundAfter", () => {
  it("hands the live round to the next one along", () => {
    expect(openRoundAfter({}, [1, 2, 3, 4], 1)).toBe(2);
    expect(openRoundAfter(locks(1), [1, 2, 3, 4], 2)).toBe(3);
  });

  it("skips rounds already final", () => {
    expect(openRoundAfter(locks(1, 2), [1, 2, 3, 4], 3)).toBe(4);
  });

  it("is null when finalizing this one closes the event", () => {
    expect(openRoundAfter(locks(1, 2, 3), [1, 2, 3, 4], 4)).toBe(null);
    expect(openRoundAfter({}, [1], 1)).toBe(null);
  });

  // The case nextRoundNumber gets wrong, and why the sheet says "leaves
  // scoring on Round 2" rather than promising to open a round that is
  // already taking scores.
  it("points BACKWARDS for a round the field has walked off", () => {
    const l = {};                    // nothing final; the field is on Rd 2 today
    expect(openRoundAfter(l, [1, 2, 3], 1)).toBe(2);
    expect(openRoundAfter(l, [1, 2, 3], 2)).toBe(1);
    expect(nextRoundNumber(l, [1, 2, 3])).toBe(2);
  });
});
