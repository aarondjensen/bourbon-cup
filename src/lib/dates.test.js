import { describe, it, expect } from "vitest";
import { isISODate, todayISO, formatISODate, formatISORange } from "./dates";

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
