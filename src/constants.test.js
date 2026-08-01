import { describe, it, expect } from "vitest";
import {
  PAR_RESULTS_BY_FORMAT, PAR_POINTS_DEFAULTS,
  parResultsFor, parResultLabel, parResultFor, resolveParPoints, tiltBirdieValue,
} from "./constants";

// Only the against-par ladders are covered here — the piece of constants.js
// that is logic rather than a list. They decide what every Stableford and Tilt
// hole is worth, and the failure modes are all silent: a rung that catches the
// wrong scores, a rung a format's table has no value for, or a stored round
// whose points move because its ladder changed shape underneath it.

describe("parResultFor on Stableford", () => {
  it("names every rung, and both ends stay open", () => {
    const r = (d) => parResultFor(d, "stableford");
    expect(r(-6)).toBe("double_albatross");
    expect(r(-4)).toBe("double_albatross");
    expect(r(-3)).toBe("albatross");
    expect(r(-2)).toBe("eagle");
    expect(r(-1)).toBe("birdie");
    expect(r(0)).toBe("par");
    expect(r(1)).toBe("bogey");
    expect(r(2)).toBe("double");
    expect(r(3)).toBe("triple");
    expect(r(9)).toBe("triple");
  });
});

// Tilt's ladder did not grow. A hole better than an albatross or worse than a
// double bogey lands on that end rung, which is precisely what it scored
// before Stableford's table gained two rows — so every stored Tilt round
// settles to the same number.
describe("parResultFor on Tilt", () => {
  it("stops at albatross and at double, as it always has", () => {
    const r = (d) => parResultFor(d, "tilt");
    expect(r(-6)).toBe("albatross");
    expect(r(-4)).toBe("albatross");
    expect(r(-3)).toBe("albatross");
    expect(r(2)).toBe("double");
    expect(r(3)).toBe("double");
    expect(r(9)).toBe("double");
  });

  it("scores the rungs between exactly as Stableford classifies them", () => {
    for (let d = -3; d <= 2; d++) {
      expect(parResultFor(d, "tilt")).toBe(parResultFor(d, "stableford"));
    }
  });

  it("never lands a Tilt hole on a rung Stableford invented", () => {
    for (let d = -9; d <= 12; d++) {
      expect(["double_albatross", "triple"]).not.toContain(parResultFor(d, "tilt"));
    }
  });
});

describe("the ladders and their tables", () => {
  it("only ever return a rung the format's own table prices", () => {
    Object.keys(PAR_POINTS_DEFAULTS).forEach(fmt => {
      const table = resolveParPoints(fmt, null);
      for (let d = -9; d <= 12; d++) {
        expect(table[parResultFor(d, fmt)]).toBeTypeOf("number");
      }
    });
  });

  it("price and label every rung on their own ladder, and nothing else", () => {
    Object.keys(PAR_POINTS_DEFAULTS).forEach(fmt => {
      const ladder = parResultsFor(fmt);
      expect(Object.keys(PAR_POINTS_DEFAULTS[fmt]).sort()).toEqual([...ladder].sort());
      ladder.forEach(k => expect(parResultLabel(fmt, k)).toBeTruthy());
    });
  });

  it("gives Stableford the two rungs Tilt does not have", () => {
    expect(parResultsFor("stableford")).toContain("double_albatross");
    expect(parResultsFor("stableford")).toContain("triple");
    expect(parResultsFor("tilt")).not.toContain("double_albatross");
    expect(parResultsFor("tilt")).not.toContain("triple");
  });

  it("pays Stableford's new outer rungs 10 and -3", () => {
    const t = resolveParPoints("stableford", null);
    expect(t.double_albatross).toBe(10);
    expect(t.triple).toBe(-3);
  });

  // The rungs Stableford has always had, unchanged: a round saved before the
  // table grew must settle to the same number afterwards.
  it("leaves Stableford's original rungs alone", () => {
    expect(resolveParPoints("stableford", null))
      .toMatchObject({ albatross: 5, eagle: 4, birdie: 3, par: 2, bogey: 1, double: 0 });
  });

  it("leaves Tilt's table exactly as it was", () => {
    expect(resolveParPoints("tilt", null))
      .toEqual({ albatross: 16, eagle: 8, birdie: 4, par: 2, bogey: 0, double: -4 });
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

// The "+" marks the rung that swallows everything below it, so it follows
// where each ladder ends rather than being baked into the rung's name.
describe("parResultLabel", () => {
  it("puts the + on each format's bottom rung and nowhere else", () => {
    expect(parResultLabel("tilt", "double")).toBe("Double +");
    expect(parResultLabel("stableford", "double")).toBe("Double");
    expect(parResultLabel("stableford", "triple")).toBe("Triple +");
    expect(parResultLabel("stableford", "double_albatross")).toBe("Dbl Alb");
  });
});

// Clamping only works because each format's ladder is a contiguous slice of
// the same best-to-worst ordering. If one ever skips a rung, parResultFor
// starts returning results that format has no value for.
describe("the ladders' shape", () => {
  it("keeps every format's ladder a contiguous slice of Stableford's", () => {
    const all = PAR_RESULTS_BY_FORMAT.stableford;
    Object.values(PAR_RESULTS_BY_FORMAT).forEach(ladder => {
      const start = all.indexOf(ladder[0]);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(ladder).toEqual(all.slice(start, start + ladder.length));
    });
  });
});

describe("tiltBirdieValue", () => {
  it("counts a result's strokes under par", () => {
    expect(tiltBirdieValue("albatross")).toBe(3);
    expect(tiltBirdieValue("eagle")).toBe(2);
    expect(tiltBirdieValue("birdie")).toBe(1);
  });

  it("takes a par or worse off Tilt", () => {
    ["par", "bogey", "double"].forEach(r => expect(tiltBirdieValue(r)).toBe(0));
  });
});
