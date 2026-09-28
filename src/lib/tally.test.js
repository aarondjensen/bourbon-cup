// The side games carry no currency — see the header of lib/tally for the
// rejection that decided it.
import { describe, it, expect } from "vitest";
import { tally } from "./tally";

describe("tally", () => {
  it("writes no currency symbol, ever", () => {
    for (const n of [0, 1, 400, 57.14, -25, 1234.5]) {
      expect(tally(n)).not.toMatch(/[$£€]/);
    }
  });

  it("hides decimals a whole figure does not have", () => {
    expect(tally(400)).toBe("400");
    expect(tally(0)).toBe("0");
  });

  // A total is a buy-in times a head count and divides badly on purpose:
  // 400 across seven skins is 57.14, and rounding that to 57 would be
  // rounding somebody's share away.
  it("keeps the two decimals a division produces", () => {
    expect(tally(400 / 7)).toBe("57.14");
    expect(tally(11.111)).toBe("11.11");
  });

  it("groups thousands", () => {
    expect(tally(1200)).toBe("1,200");
  });

  // 9.999 rounds to 10.00, and the hundredths have to carry rather than be
  // written beside the whole they came from.
  it("carries hundredths that round up to a whole", () => {
    expect(tally(9.999)).toBe("10");
    expect(tally(1.995)).toBe("2");
  });

  it("keeps a negative sign in front of the grouping", () => {
    expect(tally(-1234.5)).toBe("-1,234.50");
  });

  it("does not render nonsense as NaN on screen", () => {
    expect(tally(undefined)).toBe("0");
    expect(tally(null)).toBe("0");
    expect(tally("x")).toBe("0");
  });
});
