import { describe, it, expect } from "vitest";
import {
  isISODate, todayISO, formatISODate, formatISORange,
  addDays, daysBetween, rangeDays,
  isYearMonth, monthOf, addMonths, formatMonthYear, monthGrid,
  nextRangeSelection, rangePosition,
} from "./dates";

// Every one of these exists because a `Date` object would get it wrong. See
// the header of dates.js — the failure mode is a date reading as the day
// before, on the phone of somebody standing on that day.

describe("isISODate", () => {
  it("accepts the stored shape and nothing else", () => {
    expect(isISODate("2026-07-01")).toBe(true);
    expect(isISODate("7/1/26")).toBe(false);
    expect(isISODate("2026-7-1")).toBe(false);
    expect(isISODate("")).toBe(false);
    expect(isISODate(null)).toBe(false);
    expect(isISODate(undefined)).toBe(false);
  });
});

describe("todayISO", () => {
  // 11pm on the 1st in a negative-offset zone is still the 1st. A round trip
  // through toISOString() would say the 2nd.
  it("stamps the LOCAL day, not the UTC one", () => {
    expect(todayISO(new Date(2026, 6, 1, 23, 30))).toBe("2026-07-01");
    expect(todayISO(new Date(2026, 0, 1, 0, 5))).toBe("2026-01-01");
  });
  it("pads a single-digit month and day", () => {
    expect(todayISO(new Date(2026, 8, 5, 12))).toBe("2026-09-05");
  });
});

describe("formatISODate", () => {
  it("reads a date without dragging the day backwards", () => {
    expect(formatISODate("2026-07-01")).toBe("Jul 1");
    expect(formatISODate("2026-07-01", { withYear: true })).toBe("Jul 1, 2026");
  });
  // Sakamoto's method, and worth pinning: nothing here constructs a Date to
  // ask what day of the week it is.
  it("works out the weekday arithmetically", () => {
    expect(formatISODate("2026-08-13", { weekday: true })).toBe("Thu, Aug 13");
    expect(formatISODate("2026-01-01", { weekday: true })).toBe("Thu, Jan 1");
    expect(formatISODate("2024-02-29", { weekday: true })).toBe("Thu, Feb 29");
    expect(formatISODate("2000-02-29", { weekday: true })).toBe("Tue, Feb 29");
    expect(formatISODate("1999-12-31", { weekday: true })).toBe("Fri, Dec 31");
  });
  it("leaves something it cannot read alone", () => {
    expect(formatISODate("")).toBe("");
    expect(formatISODate(null)).toBe("");
    expect(formatISODate("later")).toBe("later");
    expect(formatISODate("2026-13-01")).toBe("2026-13-01");
  });
});

describe("formatISORange", () => {
  it("collapses a span inside one month", () => {
    expect(formatISORange("2026-08-13", "2026-08-16")).toBe("Aug 13 – 16, 2026");
  });
  it("keeps both months when it crosses one", () => {
    expect(formatISORange("2026-08-30", "2026-09-02")).toBe("Aug 30 – Sep 2, 2026");
  });
  it("keeps both years when it crosses one", () => {
    expect(formatISORange("2026-12-30", "2027-01-02")).toBe("Dec 30, 2026 – Jan 2, 2027");
  });
  it("is one date when both ends are the same day", () => {
    expect(formatISORange("2026-08-13", "2026-08-13")).toBe("Aug 13, 2026");
  });
  // A schedule where only some rounds have a date yet.
  it("falls back to whichever end it has", () => {
    expect(formatISORange("2026-08-13", null)).toBe("Aug 13, 2026");
    expect(formatISORange(null, "2026-08-16")).toBe("Aug 16, 2026");
    expect(formatISORange(null, null)).toBe("");
  });
});

// ── Calendar arithmetic ──
// Safe only because both ends are UTC — see the note in dates.js. These pin
// the cases where a local-timezone reading would drift a day.
describe("addDays", () => {
  it("moves inside a month", () => {
    expect(addDays("2026-08-13", 3)).toBe("2026-08-16");
    expect(addDays("2026-08-16", -3)).toBe("2026-08-13");
  });
  it("rolls over a month and a year", () => {
    expect(addDays("2026-08-30", 3)).toBe("2026-09-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("knows about leap years", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
  it("is zero-safe and refuses what it cannot read", () => {
    expect(addDays("2026-08-13", 0)).toBe("2026-08-13");
    expect(addDays("nonsense", 1)).toBe("");
    expect(addDays(null, 1)).toBe("");
  });
});

describe("daysBetween", () => {
  it("counts whole days, signed", () => {
    expect(daysBetween("2026-08-13", "2026-08-16")).toBe(3);
    expect(daysBetween("2026-08-16", "2026-08-13")).toBe(-3);
    expect(daysBetween("2026-08-13", "2026-08-13")).toBe(0);
  });
  it("is null when either end is unreadable", () => {
    expect(daysBetween("2026-08-13", "")).toBeNull();
    expect(daysBetween(null, "2026-08-13")).toBeNull();
  });
});

describe("rangeDays", () => {
  it("is every day of the trip, inclusive", () => {
    expect(rangeDays("2026-08-13", "2026-08-16"))
      .toEqual(["2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16"]);
  });
  it("is one day when both ends match", () => {
    expect(rangeDays("2026-08-13", "2026-08-13")).toEqual(["2026-08-13"]);
  });
  it("falls back to the start when the end is missing or backwards", () => {
    expect(rangeDays("2026-08-13", "")).toEqual(["2026-08-13"]);
    expect(rangeDays("2026-08-16", "2026-08-13")).toEqual(["2026-08-16"]);
  });
  // A mistyped year would otherwise build thirty-six thousand strings to fill
  // a dropdown with.
  it("guards against a mistyped year", () => {
    expect(rangeDays("2026-08-13", "2126-08-13")).toEqual(["2026-08-13"]);
  });
  it("is empty with no start at all", () => {
    expect(rangeDays("", "2026-08-16")).toEqual([]);
    expect(rangeDays(null, null)).toEqual([]);
  });
});

// ── The calendar the range picker draws ───────────────────────────

describe("isYearMonth", () => {
  it("accepts a month and rejects a day or a bad month", () => {
    expect(isYearMonth("2026-08")).toBe(true);
    expect(isYearMonth("2026-12")).toBe(true);
    expect(isYearMonth("2026-08-13")).toBe(false);
    expect(isYearMonth("2026-13")).toBe(false);
    expect(isYearMonth("2026-00")).toBe(false);
    expect(isYearMonth("")).toBe(false);
    expect(isYearMonth(null)).toBe(false);
  });
});

describe("monthOf", () => {
  it("is the month a date falls in", () => {
    expect(monthOf("2026-08-13")).toBe("2026-08");
  });
  it("is empty for something unreadable", () => {
    expect(monthOf("8/13/26")).toBe("");
    expect(monthOf(null)).toBe("");
  });
});

describe("addMonths", () => {
  it("moves within a year", () => {
    expect(addMonths("2026-08", 2)).toBe("2026-10");
    expect(addMonths("2026-08", -2)).toBe("2026-06");
  });
  // The reason it counts in total months rather than walking a Date:
  // `new Date(2026, 0, 31)` moved on a month is March 3rd.
  it("rolls the year at both ends", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-01", -13)).toBe("2024-12");
    expect(addMonths("2026-12", 13)).toBe("2028-01");
  });
  it("is empty for something unreadable", () => {
    expect(addMonths("2026-08-13", 1)).toBe("");
    expect(addMonths("", 1)).toBe("");
  });
});

describe("formatMonthYear", () => {
  it("spells the month out", () => {
    expect(formatMonthYear("2026-08")).toBe("August 2026");
    expect(formatMonthYear("2027-01")).toBe("January 2027");
  });
  it("is empty for something unreadable", () => {
    expect(formatMonthYear("nope")).toBe("");
  });
});

describe("monthGrid", () => {
  const flat = (ym) => monthGrid(ym).flat();

  it("is six whole weeks, always", () => {
    for (const ym of ["2026-02", "2026-08", "2027-05", "2024-02"]) {
      expect(monthGrid(ym)).toHaveLength(6);
      expect(monthGrid(ym).every(w => w.length === 7)).toBe(true);
    }
  });

  it("starts on a Sunday and runs consecutively", () => {
    const cells = flat("2026-08");
    // August 1st 2026 is a Saturday, so the grid opens on July 26th.
    expect(cells[0].iso).toBe("2026-07-26");
    cells.forEach((c, i) => {
      if (i > 0) expect(c.iso).toBe(addDays(cells[i - 1].iso, 1));
    });
  });

  it("marks which days belong to the month being drawn", () => {
    const cells = flat("2026-08");
    expect(cells.filter(c => c.inMonth)).toHaveLength(31);
    expect(cells.find(c => c.iso === "2026-08-01").inMonth).toBe(true);
    expect(cells.find(c => c.iso === "2026-07-31").inMonth).toBe(false);
  });

  it("holds a 31-day month that starts on a Saturday — the worst case", () => {
    // The row count is fixed at six because of exactly this shape: five
    // weeks cannot hold it.
    const cells = flat("2026-08");
    expect(cells.filter(c => c.inMonth).at(-1).iso).toBe("2026-08-31");
  });

  it("gets February right in a leap year and out of one", () => {
    expect(flat("2024-02").filter(c => c.inMonth)).toHaveLength(29);
    expect(flat("2026-02").filter(c => c.inMonth)).toHaveLength(28);
    expect(flat("2100-02").filter(c => c.inMonth)).toHaveLength(28);
    expect(flat("2000-02").filter(c => c.inMonth)).toHaveLength(29);
  });

  it("is empty for something unreadable", () => {
    expect(monthGrid("2026-08-13")).toEqual([]);
    expect(monthGrid(null)).toEqual([]);
  });
});

describe("nextRangeSelection", () => {
  const pick = (start, end, p) => nextRangeSelection({ start, end, pick: p });

  it("takes the first tap as the first day", () => {
    expect(pick("", "", "2026-08-13")).toEqual({ start: "2026-08-13", end: "" });
  });
  it("takes the second tap as the last day", () => {
    expect(pick("2026-08-13", "", "2026-08-16")).toEqual({ start: "2026-08-13", end: "2026-08-16" });
  });
  it("allows a one-day trip", () => {
    expect(pick("2026-08-13", "", "2026-08-13")).toEqual({ start: "2026-08-13", end: "2026-08-13" });
  });
  // A tap before the start is somebody saying "no, THIS is the first day" —
  // not a request to drag the start back and keep the end.
  it("restarts from a tap before the first day", () => {
    expect(pick("2026-08-13", "", "2026-08-10")).toEqual({ start: "2026-08-10", end: "" });
  });
  it("restarts once a whole range is on screen", () => {
    expect(pick("2026-08-13", "2026-08-16", "2026-08-20")).toEqual({ start: "2026-08-20", end: "" });
    expect(pick("2026-08-13", "2026-08-16", "2026-08-14")).toEqual({ start: "2026-08-14", end: "" });
  });
  it("never produces a backwards range", () => {
    const cases = [["", "", "2026-08-16"], ["2026-08-13", "", "2026-08-01"], ["2026-08-13", "2026-08-16", "2026-08-02"]];
    for (const [s, e, p] of cases) {
      const r = pick(s, e, p);
      if (r.start && r.end) expect(daysBetween(r.start, r.end)).toBeGreaterThanOrEqual(0);
    }
  });
  it("ignores an unreadable tap rather than clearing what is there", () => {
    expect(pick("2026-08-13", "2026-08-16", "nope")).toEqual({ start: "2026-08-13", end: "2026-08-16" });
    expect(pick(null, null, null)).toEqual({ start: "", end: "" });
  });
});

describe("rangePosition", () => {
  it("names the two ends and the days between", () => {
    const at = (iso) => rangePosition(iso, "2026-08-13", "2026-08-16");
    expect(at("2026-08-13")).toBe("start");
    expect(at("2026-08-16")).toBe("end");
    expect(at("2026-08-14")).toBe("between");
    expect(at("2026-08-12")).toBeNull();
    expect(at("2026-08-17")).toBeNull();
  });
  it("is a single day when the range is one, or has no end yet", () => {
    expect(rangePosition("2026-08-13", "2026-08-13", "2026-08-13")).toBe("only");
    expect(rangePosition("2026-08-13", "2026-08-13", "")).toBe("only");
    expect(rangePosition("2026-08-14", "2026-08-13", "")).toBeNull();
  });
  it("is null with no range at all", () => {
    expect(rangePosition("2026-08-13", "", "")).toBeNull();
    expect(rangePosition("", "2026-08-13", "2026-08-16")).toBeNull();
  });
});
