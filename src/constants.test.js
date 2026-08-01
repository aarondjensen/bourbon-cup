import { describe, it, expect } from "vitest";
import {
  PAR_RESULTS, PAR_RESULT_LABELS, PAR_POINTS_DEFAULTS,
  parResultFor, resolveParPoints, tiltBirdieValue,
} from "./constants";

// Only the against-par ladder is covered here — the piece of constants.js that
// is logic rather than a list. It decides what every Stableford and Tilt hole
// is worth, and its two failure modes are both silent: a rung that catches the
// wrong scores, and a stored round whose points move because the table gained
// a row it never had.

describe("parResultFor", () => {
  it("names every rung, and both ends stay open", () => {
    expect(parResultFor(-6)).toBe("double_albatross");
    expect(parResultFor(-4)).toBe("double_albatross");
    expect(parResultFor(-3)).toBe("albatross");
    expect(parResultFor(-2)).toBe("eagle");
    expect(parResultFor(-1)).toBe("birdie");
    expect(parResultFor(0)).toBe("par");
    expect(parResultFor(1)).toBe("bogey");
    expect(parResultFor(2)).toBe("double");
    expect(parResultFor(3)).toBe("triple");
    expect(parResultFor(9)).toBe("triple");
  });

  it("returns a rung the tables actually price", () => {
    for (let d = -9; d <= 12; d++) expect(PAR_RESULTS).toContain(parResultFor(d));
  });
});

describe("the tables", () => {
  it("price and label every rung, on both formats", () => {
    PAR_RESULTS.forEach(k => {
      expect(PAR_RESULT_LABELS[k]).toBeTruthy();
      expect(PAR_POINTS_DEFAULTS.stableford[k]).toBeTypeOf("number");
      expect(PAR_POINTS_DEFAULTS.tilt[k]).toBeTypeOf("number");
    });
  });

  it("pays Stableford's new outer rungs 10 and -3", () => {
    const t = resolveParPoints("stableford", null);
    expect(t.double_albatross).toBe(10);
    expect(t.triple).toBe(-3);
  });

  // The rungs Stableford has always had, unchanged: a round saved before the
  // table grew must settle to the same number afterwards.
  it("leaves Stableford's original rungs alone", () => {
    const t = resolveParPoints("stableford", null);
    expect(t).toMatchObject({ albatross: 5, eagle: 4, birdie: 3, par: 2, bogey: 1, double: 0 });
  });

  // Tilt had no rung past albatross or double, so those scores WERE albatross
  // and double. Repeating the neighbour is what keeps a stored Tilt round
  // settling the same.
  it("keeps Tilt scoring exactly as it did", () => {
    const t = resolveParPoints("tilt", null);
    expect(t.double_albatross).toBe(t.albatross);
    expect(t.triple).toBe(t.double);
  });

  it("falls back per rung, so a partial saved table keeps its defaults", () => {
    const t = resolveParPoints("stableford", { triple: -5, birdie: "" });
    expect(t.triple).toBe(-5);
    expect(t.birdie).toBe(3);
    expect(t.double_albatross).toBe(10);
  });

  it("has no table for a format that isn't scored against par", () => {
    expect(resolveParPoints("singles", null)).toBeNull();
  });
});

// The multiplier is the format's rule, not the table's: it counts strokes
// under par, so it does not move when a director edits what a rung pays.
describe("tiltBirdieValue", () => {
  it("counts a result's strokes under par", () => {
    expect(tiltBirdieValue("double_albatross")).toBe(4);
    expect(tiltBirdieValue("albatross")).toBe(3);
    expect(tiltBirdieValue("eagle")).toBe(2);
    expect(tiltBirdieValue("birdie")).toBe(1);
  });

  it("takes a par or worse off Tilt", () => {
    ["par", "bogey", "double", "triple"].forEach(r => expect(tiltBirdieValue(r)).toBe(0));
  });
});
