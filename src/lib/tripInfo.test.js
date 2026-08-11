import { describe, it, expect } from "vitest";
import {
  safeHouseUrl, linkHost, houseFrom, hasHouse, MAX_HOUSE_NAME,
  tripSchedule, tripDates, scheduleDayLabel, tripCourses,
  courseYardage, courseWhere, hasTripInfo,
} from "./tripInfo";

const course = (over = {}) => ({
  id: "c1", name: "Treetops – Masterpiece", city: "Gaylord", state: "MI",
  par: 71, tee_boxes: [{ name: "Blue", yardage: 6399 }, { name: "White", yardage: 5900 }],
  ...over,
});

const round = (n, over = {}) => ({ round_number: n, ...over });

describe("safeHouseUrl", () => {
  it("takes a real link", () => {
    expect(safeHouseUrl("https://vrbo.com/12345")).toBe("https://vrbo.com/12345");
  });
  // What somebody actually pastes off a phone. Refusing it would only teach
  // the director to give up.
  it("puts https on a bare host", () => {
    expect(safeHouseUrl("vrbo.com/12345")).toBe("https://vrbo.com/12345");
    expect(safeHouseUrl("  www.airbnb.com/rooms/9  ")).toBe("https://www.airbnb.com/rooms/9");
  });
  // The reason this function exists rather than the href being the raw field:
  // a javascript: URL in an anchor runs with the app's own origin, and "only
  // a director can write it" is the argument behind every stored XSS there
  // has ever been.
  it("refuses anything that is not http or https", () => {
    expect(safeHouseUrl("javascript:alert(1)")).toBeNull();
    expect(safeHouseUrl("JavaScript:alert(1)")).toBeNull();
    expect(safeHouseUrl("data:text/html,<script>x</script>")).toBeNull();
    expect(safeHouseUrl("file:///etc/passwd")).toBeNull();
  });
  it("refuses a hostname that is not an address", () => {
    expect(safeHouseUrl("the big house on the lake")).toBeNull();
    expect(safeHouseUrl("http://localhost:3000")).toBeNull();
  });
  it("is null for nothing", () => {
    expect(safeHouseUrl("")).toBeNull();
    expect(safeHouseUrl(null)).toBeNull();
    expect(safeHouseUrl("   ")).toBeNull();
  });
});

describe("linkHost", () => {
  it("is what a link says with no name in front of it", () => {
    expect(linkHost("https://www.vrbo.com/12345?tracking=abc")).toBe("vrbo.com");
    expect(linkHost("https://airbnb.com/rooms/9")).toBe("airbnb.com");
  });
});

describe("houseFrom", () => {
  it("labels with the name when there is one", () => {
    const h = houseFrom({ house_name: "  The Lodge  ", house_url: "vrbo.com/1" });
    expect(h).toMatchObject({ name: "The Lodge", url: "https://vrbo.com/1", label: "The Lodge" });
  });
  it("falls back to the host when there is only a link", () => {
    expect(houseFrom({ house_url: "https://www.vrbo.com/1" }).label).toBe("vrbo.com");
  });
  it("drops a link it would not let a player tap", () => {
    expect(houseFrom({ house_name: "The Lodge", house_url: "javascript:alert(1)" }).url).toBeNull();
  });
  it("caps the name", () => {
    expect(houseFrom({ house_name: "x".repeat(200) }).name.length).toBe(MAX_HOUSE_NAME);
  });
  it("is empty for an unset document", () => {
    expect(hasHouse(houseFrom(null))).toBe(false);
    expect(hasHouse(houseFrom({}))).toBe(false);
    expect(hasHouse(houseFrom({ house_name: "The Lodge" }))).toBe(true);
  });
});

describe("tripSchedule", () => {
  const courses = [course(), course({ id: "c2", name: "The Loop", city: "Roscommon" })];
  const tRounds = [
    round(1, { course_id: "c1", date: "2026-08-13", tee_time: "8:30|8:40|8:50" }),
    round(2, { course_id: "c2", date: "2026-08-14", tee_time: "9:00" }),
    round(4, { course_id: "c1", date: "2026-08-16" }),
  ];
  const schedule = tripSchedule({ rounds: [1, 2, 3, 4], tRounds, courses });

  // A round nobody has opened in Admin has no document at all, and it is
  // still a round that is going to be played. A row that vanished would read
  // as a three-round trip.
  it("keeps a round with no document at all", () => {
    expect(schedule.map(r => r.round)).toEqual([1, 2, 3, 4]);
    expect(schedule[2]).toMatchObject({ round: 3, date: null, course: null, teeTime: "" });
  });
  it("resolves each round's course", () => {
    expect(schedule[0].courseName).toBe("Treetops – Masterpiece");
    expect(schedule[1].courseName).toBe("The Loop");
  });
  // The rest of the sheet is per-group and lives on Matches; the night before,
  // a player wants the first one.
  it("takes the FIRST tee time only", () => {
    expect(schedule[0].teeTime).toBe("8:30");
    expect(schedule[1].teeTime).toBe("9:00");
  });
  // Null rather than the round form's default: "Singles" printed under a
  // course nobody has chosen is the app stating a decision no one has made.
  it("carries the format only when a round document says so", () => {
    const s = tripSchedule({
      rounds: [1, 2], courses,
      tRounds: [round(1, { format: "best_ball" })],
    });
    expect(s[0].format).toBe("best_ball");
    expect(s[1].format).toBeNull();
  });
  it("ignores a date it cannot read", () => {
    const s = tripSchedule({ rounds: [1], tRounds: [round(1, { date: "8/13/26" })], courses });
    expect(s[0].date).toBeNull();
  });
  it("survives a course_id pointing at nothing", () => {
    const s = tripSchedule({ rounds: [1], tRounds: [round(1, { course_id: "gone" })], courses });
    expect(s[0]).toMatchObject({ course: null, courseName: "" });
  });
  it("handles no rounds at all", () => {
    expect(tripSchedule({})).toEqual([]);
  });
});

describe("tripDates", () => {
  const s = (...dates) => dates.map((date, i) => ({ round: i + 1, date }));
  it("spans the first and last round dates", () => {
    expect(tripDates(s("2026-08-13", "2026-08-14", "2026-08-16")).label).toBe("Aug 13 – 16, 2026");
  });
  // Derived, so a schedule entered out of order still reads correctly — the
  // whole point of not having a separate pair of trip-date fields.
  it("does not care what order the rounds carry them in", () => {
    expect(tripDates(s("2026-08-16", "2026-08-13")).label).toBe("Aug 13 – 16, 2026");
  });
  it("ignores the rounds that have no date yet", () => {
    const d = tripDates(s("2026-08-13", null, null, "2026-08-16"));
    expect(d).toMatchObject({ from: "2026-08-13", to: "2026-08-16", count: 2 });
  });
  it("is one day when only one round is dated", () => {
    expect(tripDates(s(null, "2026-08-14")).label).toBe("Aug 14, 2026");
  });
  it("says nothing when nothing is dated", () => {
    expect(tripDates(s(null, null))).toMatchObject({ from: null, label: "", count: 0 });
    expect(tripDates([])).toMatchObject({ label: "" });
  });
});

describe("scheduleDayLabel", () => {
  it("leads with the weekday, which is what a golfer plans around", () => {
    expect(scheduleDayLabel({ date: "2026-08-13" })).toBe("Thu, Aug 13");
  });
  it("is empty for an undated round", () => {
    expect(scheduleDayLabel({ date: null })).toBe("");
  });
});

describe("tripCourses", () => {
  const a = course(), b = course({ id: "c2", name: "The Loop" });
  // A trip that plays the same course twice is one card saying "Rounds 1 & 3",
  // not the same card printed twice.
  it("is distinct, and remembers which rounds are played on each", () => {
    const out = tripCourses([
      { round: 1, course: a }, { round: 2, course: b },
      { round: 3, course: a }, { round: 4, course: null },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ rounds: [1, 3] });
    expect(out[1]).toMatchObject({ rounds: [2] });
  });
  it("is empty when no round has a course", () => {
    expect(tripCourses([{ round: 1, course: null }])).toEqual([]);
  });
});

describe("courseYardage and courseWhere", () => {
  it("spans the tee boxes", () => {
    expect(courseYardage(course())).toBe("5,900 – 6,399 yds");
  });
  it("is a single figure when there is one tee", () => {
    expect(courseYardage(course({ tee_boxes: [{ name: "Blue", yardage: 6399 }] }))).toBe("6,399 yds");
  });
  // A course imported without a scorecard carries zero-yardage boxes, and
  // "0 – 6,399" is worse than saying nothing.
  it("drops the boxes with no yardage", () => {
    expect(courseYardage(course({ tee_boxes: [{ yardage: 0 }, { yardage: 6399 }] }))).toBe("6,399 yds");
    expect(courseYardage(course({ tee_boxes: [] }))).toBe("");
    expect(courseYardage(null)).toBe("");
  });
  it("joins the city and state it has", () => {
    expect(courseWhere(course())).toBe("Gaylord, MI");
    expect(courseWhere(course({ state: "" }))).toBe("Gaylord");
    expect(courseWhere(course({ city: "", state: "" }))).toBe("");
  });
});

describe("hasTripInfo", () => {
  const empty = { house: houseFrom(null), schedule: [{ round: 1, date: null, course: null, teeTime: "" }] };
  it("is false when there is genuinely nothing", () => {
    expect(hasTripInfo(empty)).toBe(false);
  });
  it("is true on any one of the three", () => {
    expect(hasTripInfo({ ...empty, house: houseFrom({ house_name: "The Lodge" }) })).toBe(true);
    expect(hasTripInfo({ ...empty, schedule: [{ round: 1, date: "2026-08-13" }] })).toBe(true);
    expect(hasTripInfo({ ...empty, schedule: [{ round: 1, course: course() }] })).toBe(true);
    expect(hasTripInfo({ ...empty, schedule: [{ round: 1, teeTime: "8:30" }] })).toBe(true);
  });
});
