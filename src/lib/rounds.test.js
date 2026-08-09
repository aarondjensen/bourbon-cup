import { describe, it, expect } from "vitest";
import { scheduledRounds, nextRoundSlot, editableRounds } from "./rounds";

describe("scheduledRounds", () => {
  it("is empty for a tournament with nothing set up", () => {
    expect(scheduledRounds({})).toEqual([]);
    expect(scheduledRounds()).toEqual([]);
  });

  it("unions the three sources", () => {
    const rounds = scheduledRounds({
      tRounds: [{ round_number: 1 }, { round_number: 2 }],
      matches: [{ round: 2 }, { round: 3 }],
      roundLocks: { 4: { locked: true } },
    });
    expect(rounds).toEqual([1, 2, 3, 4]);
  });

  it("counts a round that exists only as a draw", () => {
    expect(scheduledRounds({ matches: [{ round: 7 }] })).toEqual([7]);
  });

  // The load-bearing case: a lock is written by the first score of a round, so
  // a locked round is one somebody has played. Losing it here would move the
  // whole field on while their scores sat in the round they were standing on.
  it("counts a round that exists only because it was played", () => {
    expect(scheduledRounds({ roundLocks: { 3: { locked: true } } })).toEqual([3]);
  });

  it("ignores a lock that was never taken", () => {
    expect(scheduledRounds({ roundLocks: { 3: { locked: false }, 4: null } })).toEqual([]);
  });

  it("sorts numerically, not lexically", () => {
    const rounds = scheduledRounds({
      matches: [{ round: 10 }, { round: 2 }, { round: 1 }],
    });
    expect(rounds).toEqual([1, 2, 10]);
  });

  it("de-duplicates across sources regardless of stored type", () => {
    // Lock keys arrive as object keys, so they are strings; a round must not
    // appear twice because two sources spelled its number differently.
    const rounds = scheduledRounds({
      tRounds: [{ round_number: 2 }],
      matches: [{ round: 2 }],
      roundLocks: { 2: { locked: true } },
    });
    expect(rounds).toEqual([2]);
  });

  // Number(null) and Number("") are both 0, so a blank round number would
  // arrive as a round zero and seat itself in front of round 1 in every
  // picker. The from-1 floor is what stops it.
  it("drops rows with no usable round number", () => {
    const rounds = scheduledRounds({
      tRounds: [{ round_number: null }, { round_number: undefined }, {}],
      matches: [{ round: 1 }, { round: "" }, { round: 0 }],
    });
    expect(rounds).toEqual([1]);
  });
});

describe("nextRoundSlot", () => {
  it("starts a fresh edition at 1", () => {
    expect(nextRoundSlot([])).toBe(1);
  });

  it("follows the last round", () => {
    expect(nextRoundSlot([1, 2, 3, 4])).toBe(5);
  });

  // A director who deleted round 2 of four is not asking for it back.
  it("goes past the end rather than filling a gap", () => {
    expect(nextRoundSlot([1, 3, 4])).toBe(5);
  });
});

describe("editableRounds", () => {
  it("offers one empty slot on a fresh edition", () => {
    expect(editableRounds({})).toEqual([1]);
  });

  it("offers a fifth round to a four-round tournament", () => {
    expect(editableRounds({
      tRounds: [1, 2, 3, 4].map(round_number => ({ round_number })),
    })).toEqual([1, 2, 3, 4, 5]);
  });

  it("stops at four for a three-round trip", () => {
    expect(editableRounds({
      tRounds: [1, 2, 3].map(round_number => ({ round_number })),
    })).toEqual([1, 2, 3, 4]);
  });
});
