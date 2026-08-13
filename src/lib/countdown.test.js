import { describe, it, expect } from "vitest";
import { countdown, teeOffAt, firstTeeAt } from "./countdown";

const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;

describe("countdown", () => {
  it("breaks the remainder into days, hours, minutes and seconds", () => {
    const c = countdown(2 * DAY + 5 * HOUR + 12 * MIN + 4 * SEC);
    expect(c).toMatchObject({ days: 2, hours: 5, mins: 12, secs: 4, done: false });
  });

  it("rounds up, so the last tick reads one second and not zero", () => {
    // 400ms left is still time on the clock — a header that says the field
    // has gone out while it is standing on the tee is the wrong error.
    expect(countdown(400)).toMatchObject({ secs: 1, done: false });
  });

  it("is done at zero and stays done past it", () => {
    expect(countdown(0).done).toBe(true);
    expect(countdown(-5 * DAY)).toMatchObject({ total: 0, days: 0, done: true });
  });

  it("treats a missing value as done rather than as NaN", () => {
    expect(countdown(null).done).toBe(true);
    expect(countdown(undefined).done).toBe(true);
  });

  it("turns urgent inside the last hour only", () => {
    expect(countdown(HOUR + SEC).urgent).toBe(false);
    expect(countdown(HOUR).urgent).toBe(true);
    expect(countdown(SEC).urgent).toBe(true);
    // Already gone is not urgent — there is nothing left to hurry for.
    expect(countdown(0).urgent).toBe(false);
  });
});

describe("teeOffAt", () => {
  it("pins the date and the earliest slot to local wall-clock time", () => {
    const at = teeOffAt("2026-07-16", [8 * 60 + 40, 8 * 60 + 30, 8 * 60 + 50]);
    const d = new Date(at);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    // The 16th in the reader's own zone. Parsed as UTC this would be the
    // evening of the 15th in Michigan, which is the bug lib/dates exists for.
    expect(d.getDate()).toBe(16);
    // The EARLIEST slot, not the first one the director typed.
    expect(d.getHours()).toBe(8);
    expect(d.getMinutes()).toBe(30);
  });

  it("is null without a date, so nothing counts down to midnight", () => {
    expect(teeOffAt(null, [510])).toBe(null);
    expect(teeOffAt("", [510])).toBe(null);
    expect(teeOffAt("July 16", [510])).toBe(null);
  });

  it("is null without a readable tee time", () => {
    expect(teeOffAt("2026-07-16", [])).toBe(null);
    expect(teeOffAt("2026-07-16", null)).toBe(null);
    // parseTeeTime returns null for anything it cannot read; those drop out
    // rather than becoming a 0 that would place the field on the tee at
    // midnight.
    expect(teeOffAt("2026-07-16", [null, undefined, NaN])).toBe(null);
  });

  it("keeps a real midnight, which is not the same as an unreadable one", () => {
    expect(teeOffAt("2026-07-16", [0])).not.toBe(null);
  });
});

describe("firstTeeAt", () => {
  const rounds = [
    { round_number: 1, date: "2026-07-16", tee_time: "8:40|8:30|8:50" },
    { round_number: 2, date: "2026-07-17", tee_time: "9:00" },
  ];

  it("reads round one's sheet by default", () => {
    expect(firstTeeAt(rounds)).toBe(teeOffAt("2026-07-16", [8 * 60 + 30]));
  });

  it("finds a round by number rather than by position", () => {
    expect(firstTeeAt([...rounds].reverse(), 2)).toBe(teeOffAt("2026-07-17", [9 * 60]));
  });

  it("is null for a round that is not set up, or not there at all", () => {
    expect(firstTeeAt([])).toBe(null);
    expect(firstTeeAt(null)).toBe(null);
    expect(firstTeeAt(rounds, 4)).toBe(null);
    expect(firstTeeAt([{ round_number: 1, date: "2026-07-16", tee_time: "" }])).toBe(null);
    expect(firstTeeAt([{ round_number: 1, tee_time: "8:30" }])).toBe(null);
  });

  it("reads the director's loose tee-time spellings through parseTeeTime", () => {
    const at = firstTeeAt([{ round_number: 1, date: "2026-07-16", tee_time: "830 | 8:20 AM" }]);
    expect(new Date(at).getHours()).toBe(8);
    expect(new Date(at).getMinutes()).toBe(20);
  });
});
