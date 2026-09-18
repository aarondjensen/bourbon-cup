// ══════════════════════════════════════════════════════════════════
//  How far an index moved — the number behind the sync's ▲/▼ badge
// ══════════════════════════════════════════════════════════════════
//
// Small enough to look obvious, and it is here for two answers that are not:
// the rounding (a tenth, because binary floating point turns 12.5 − 12.1 into
// 0.39999999999999947 and a two-character badge cannot hold it) and the sign
// on a plus handicap (stored negative, so the arithmetic has to read a plus
// player losing a tenth of his plus as the same direction as anybody else
// gaining one).
import { describe, it, expect } from "vitest";
import { hiDelta } from "./ghin";

describe("hiDelta", () => {
  it("rounds to the tenth an index is carried to", () => {
    // The literal reason this function exists rather than being `to - from`
    // at the call site.
    expect(12.5 - 12.1).not.toBe(0.4);
    expect(hiDelta(12.1, 12.5)).toBe(0.4);
    expect(hiDelta(9.4, 9.1)).toBe(-0.3);
    expect(hiDelta(14.2, 18)).toBe(3.8);
  });

  it("is 0 when the index held, and null when it is not known", () => {
    // Different answers, deliberately: a golfer with no handicap on file has
    // not "held steady", and a caller testing truthiness gets neither wrong.
    expect(hiDelta(9.4, 9.4)).toBe(0);
    expect(hiDelta(null, 9.4)).toBe(null);
    expect(hiDelta(9.4, null)).toBe(null);
    expect(hiDelta(9.4, "NH")).toBe(null);
    expect(hiDelta(undefined, undefined)).toBe(null);
  });

  it("reads a plus handicap the way the stored sign does", () => {
    // +2.1 → +1.8 is stored -2.1 → -1.8 (see parseGhinHI). The index got
    // HIGHER by three tenths, which is the direction the badge must show.
    expect(hiDelta(-2.1, -1.8)).toBe(0.3);
    // And through scratch, which is where a sign error would hide.
    expect(hiDelta(-0.2, 0.3)).toBe(0.5);
    expect(hiDelta(0.3, -0.2)).toBe(-0.5);
  });

  it("takes the strings a Firestore document hands it", () => {
    expect(hiDelta("12.1", "12.5")).toBe(0.4);
    expect(hiDelta("12.1", 12.1)).toBe(0);
  });
});
