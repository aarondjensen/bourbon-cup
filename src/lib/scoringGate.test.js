// Which round the Scoring tab lands on, and when a phone may post to it.
//
// The failure this exists for: currentRoundNumber is the lowest UNFINALIZED
// round, so a Friday round left unattested put every phone in the field on
// Round 1 on Saturday morning. See lib/scoringGate.
import { describe, it, expect } from "vitest";
import {
  roundForToday, isScoringOpen, roundDate, hasRoundDates,
  firstTeeMinutes, scoringClosedMessage, SCORING_LEAD_MIN,
} from "./scoringGate";

const week = [
  { round_number: 1, date: "2026-07-16", tee_time: "8:40|8:30|8:50" },
  { round_number: 2, date: "2026-07-17", tee_time: "9:00" },
  { round_number: 3, date: "2026-07-18" },
  { round_number: 4, date: "2026-07-18", tee_time: "13:00" },
];
const rounds = [1, 2, 3, 4];
const at = (h, m = 0) => new Date(2026, 6, 18, h, m);

describe("roundDate / hasRoundDates", () => {
  it("reads a round's day, and refuses anything that is not one", () => {
    expect(roundDate(week, 2)).toBe("2026-07-17");
    expect(roundDate([{ round_number: 1, date: "soon" }], 1)).toBeNull();
    expect(roundDate(week, 9)).toBeNull();
  });
  it("knows whether this tournament schedules at all", () => {
    expect(hasRoundDates(week)).toBe(true);
    expect(hasRoundDates([{ round_number: 1 }])).toBe(false);
    expect(hasRoundDates([])).toBe(false);
  });
});

describe("roundForToday", () => {
  it("finds the round being played", () => {
    expect(roundForToday({ tRounds: week, rounds, today: "2026-07-17" })).toBe(2);
  });
  it("takes the lower of two rounds on a 36-hole day", () => {
    expect(roundForToday({ tRounds: week, rounds, today: "2026-07-18" })).toBe(3);
  });
  it("says nothing on a day with no round", () => {
    expect(roundForToday({ tRounds: week, rounds, today: "2026-07-20" })).toBeNull();
  });
  it("ignores a round document the edition no longer has", () => {
    // A shortened week leaves the old round document behind; landing the tab
    // on a round with no draw would be worse than the bug being fixed.
    expect(roundForToday({ tRounds: week, rounds: [1, 2], today: "2026-07-18" })).toBeNull();
  });
  it("says nothing for a tournament that has never been dated", () => {
    expect(roundForToday({ tRounds: [{ round_number: 1 }], rounds, today: "2026-07-18" })).toBeNull();
    expect(roundForToday({})).toBeNull();
  });
});

describe("firstTeeMinutes", () => {
  it("takes the EARLIEST time, whatever order the sheet lists them in", () => {
    expect(firstTeeMinutes(week, 1)).toBe(8 * 60 + 30);
  });
  it("is null on a round nobody timed", () => {
    expect(firstTeeMinutes(week, 3)).toBeNull();
  });
});

describe("isScoringOpen", () => {
  const today = "2026-07-18";

  it("never closes the door on a director", () => {
    // They are the fix-it path; a gate that locks them out locks out the only
    // person who can repair what it caught.
    const v = isScoringOpen({ round: 1, tRounds: week, isDirector: true, today, now: at(6) });
    expect(v.open).toBe(true);
  });

  it("leaves an undated round exactly as open as it always was", () => {
    // The ten imported years, the demo, and any week drawn but not scheduled.
    const undated = [{ round_number: 1 }];
    expect(isScoringOpen({ round: 1, tRounds: undated, today, now: at(6) }).open).toBe(true);
    expect(isScoringOpen({ round: 1, tRounds: [], today, now: at(6) }).open).toBe(true);
  });

  it("closes a round dated for another day — the one case that is always a mistake", () => {
    const past = isScoringOpen({ round: 1, tRounds: week, today, now: at(10) });
    expect(past).toMatchObject({ open: false, reason: "past" });
    const future = isScoringOpen({ round: 2, tRounds: week, today: "2026-07-16", now: at(10) });
    expect(future).toMatchObject({ open: false, reason: "not-yet" });
  });

  it("opens today's round from half an hour before the first group", () => {
    const early = isScoringOpen({ round: 4, tRounds: week, today, now: at(12, 29) });
    expect(early).toMatchObject({ open: false, reason: "too-early" });
    expect(isScoringOpen({ round: 4, tRounds: week, today, now: at(12, 30) }).open).toBe(true);
    expect(isScoringOpen({ round: 4, tRounds: week, today, now: at(15) }).open).toBe(true);
    expect(SCORING_LEAD_MIN).toBe(30);
  });

  it("opens a round with no tee sheet for the whole day", () => {
    // Closing on a missing tee time would lock out a tournament that simply
    // never filled one in.
    expect(isScoringOpen({ round: 3, tRounds: week, today, now: at(5) }).open).toBe(true);
  });

  it("honours a director's force-open against every rule above", () => {
    const v = isScoringOpen({ round: 1, tRounds: week, scoringOpen: { 1: true }, today, now: at(6) });
    expect(v.open).toBe(true);
  });

  it("is open when there is no round to be on", () => {
    expect(isScoringOpen({ round: null, tRounds: week, today }).open).toBe(true);
  });
});

describe("scoringClosedMessage", () => {
  it("says nothing when the door is open", () => {
    expect(scoringClosedMessage({ open: true }, 1)).toBeNull();
    expect(scoringClosedMessage(null, 1)).toBeNull();
  });
  it("names the round and points at the way out", () => {
    expect(scoringClosedMessage({ open: false, reason: "not-yet" }, 3).title).toContain("Round 3");
    expect(scoringClosedMessage({ open: false, reason: "past" }, 1).body).toContain("director");
    expect(scoringClosedMessage({ open: false, reason: "too-early" }, 4).body).toContain("half an hour");
  });
});
