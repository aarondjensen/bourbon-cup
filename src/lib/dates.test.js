import { describe, it, expect } from "vitest";
import {
  isISODate, todayISO, formatISODate, formatISORange,
  addDays, daysBetween, rangeDays,
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
