// The marks are a wire format between two producers that cannot import each
// other — pipeline/archive.mjs for the ten finished years, lib/archiveLive for
// the one being played — so what a letter means is pinned here.
import { describe, it, expect } from "vitest";
import {
  GAP, HOLES_PER_ROUND, NET_BOGEY_OR_WORSE, NET_DOUBLE_OR_WORSE, NET_PAR_OR_BETTER,
  encodeHoles, holeMark, longestRun, netMark, streakWhere,
} from "./streaks.js";

describe("the marks", () => {
  it("buckets net against par, clamped at both ends", () => {
    expect([-4, -2, -1, 0, 1, 2, 3, 9].map(netMark)).toEqual(["E", "E", "B", "P", "1", "2", "3", "3"]);
  });

  it("reads a hole with no number as a gap, not as a par", () => {
    expect(netMark(null)).toBe(GAP);
    expect(netMark(undefined)).toBe(GAP);
    expect(netMark(NaN)).toBe(GAP);
  });

  it("writes a hole result from the side the card is on", () => {
    expect(holeMark("A", "A")).toBe("W");
    expect(holeMark("A", "B")).toBe("L");
    expect(holeMark("B", "B")).toBe("W");
  });

  // The distinction the streaks turn on: a tied hole is a fact about the
  // hole, an unfinished one is the absence of a fact.
  it("separates a halved hole from one nobody has finished", () => {
    expect(holeMark(null, "A", true)).toBe("H");
    expect(holeMark(null, "A", false)).toBe(GAP);
  });

  it("pads to eighteen rather than leaving a short string", () => {
    expect(encodeHoles(["W", "L"])).toBe("WL----------------");
    expect(encodeHoles([]).length).toBe(HOLES_PER_ROUND);
    expect(encodeHoles(Array(18).fill("P"))).toBe("P".repeat(18));
  });

  it("agrees about which marks continue which streak", () => {
    expect([..."EBP"].every((m) => NET_PAR_OR_BETTER.has(m))).toBe(true);
    expect([..."123"].some((m) => NET_PAR_OR_BETTER.has(m))).toBe(false);
    expect([..."23"].every((m) => NET_DOUBLE_OR_WORSE.has(m))).toBe(true);
    expect(NET_DOUBLE_OR_WORSE.has("1")).toBe(false);
    expect([..."123"].every((m) => NET_BOGEY_OR_WORSE.has(m))).toBe(true);
  });
});

describe("the longest run", () => {
  const seq = (s, year = 2020, round = 1) =>
    [...s].map((v, i) => ({ v: v === GAP ? null : v, year, round, hole: i + 1 }));

  it("finds the longest, not the last", () => {
    const r = longestRun(seq("WWWLWW"), (v) => v === "W");
    expect(r.len).toBe(3);
    expect(r.from.hole).toBe(1);
    expect(r.to.hole).toBe(3);
  });

  // The judgement the whole file rests on. A hole nobody has a score for is
  // not evidence that the streak survived it.
  it("is ended by a gap, never stepped over", () => {
    expect(longestRun(seq("WW-WW"), (v) => v === "W").len).toBe(2);
    expect(longestRun(seq("W".repeat(5)), (v) => v === "W").len).toBe(5);
  });

  it("returns nothing when it never happens", () => {
    expect(longestRun(seq("LLLL"), (v) => v === "W")).toBeNull();
    expect(longestRun([], (v) => v === "W")).toBeNull();
  });

  it("keeps the older run when two are the same length", () => {
    const r = longestRun([...seq("WW", 2016), ...seq("WW", 2019)], (v) => v === "W");
    expect(r.from.year).toBe(2016);
  });
});

describe("where it happened", () => {
  const at = (year, round, hole) => ({ year, round, hole });

  it("collapses to the shortest true thing", () => {
    expect(streakWhere({ from: at(2020, 3, 1), to: at(2020, 3, 9) })).toBe("2020 R3");
    expect(streakWhere({ from: at(2020, 2, 14), to: at(2020, 3, 4) })).toBe("2020 R2–3");
    expect(streakWhere({ from: at(2016, null, null), to: at(2021, null, null) })).toBe("2016–2021");
  });

  it("says the year alone when there is no round to name", () => {
    expect(streakWhere({ from: at(2020, null, null), to: at(2020, null, null) })).toBe("2020");
  });

  it("says nothing about a streak that does not exist", () => {
    expect(streakWhere(null)).toBe("");
  });
});
