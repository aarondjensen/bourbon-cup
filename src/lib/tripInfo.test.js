import { describe, it, expect } from "vitest";
import {
  safeHouseUrl, linkHost, houseFrom, hasHouse, MAX_HOUSE_NAME,
  tripSchedule, tripDates, tripDayOptions, tripDateFields, tripDatesError, scheduleDayLabel,
  courseTees, courseScorecard, coursePar, courseYardage, courseWhere, hasTripInfo,
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

  // The tournament's own pair is the source of truth — a director knows the
  // weekend in February and the draw in July, so a banner that waited for the
  // schedule could not answer "when is it" for the months people ask.
  it("is the tournament's own pair when it has one", () => {
    const d = tripDates({ trip: { start_date: "2026-08-13", end_date: "2026-08-16" }, schedule: s("2026-09-01") });
    expect(d).toMatchObject({ from: "2026-08-13", to: "2026-08-16", label: "Aug 13 – 16, 2026", derived: false });
  });
  it("takes one end alone as a real answer", () => {
    expect(tripDates({ trip: { start_date: "2026-08-13" } }))
      .toMatchObject({ from: "2026-08-13", to: "2026-08-13", label: "Aug 13, 2026" });
  });
  // Not a second source of truth — what an edition set up before the field
  // existed still reads as, until a director saves the pair.
  it("falls back to the round dates when the pair is unset", () => {
    const d = tripDates({ trip: null, schedule: s("2026-08-13", "2026-08-14", "2026-08-16") });
    expect(d).toMatchObject({ from: "2026-08-13", to: "2026-08-16", label: "Aug 13 – 16, 2026", derived: true });
  });
  it("ignores a stored date it cannot read", () => {
    const d = tripDates({ trip: { start_date: "8/13/26" }, schedule: s("2026-08-14") });
    expect(d).toMatchObject({ from: "2026-08-14", derived: true });
  });
  it("says nothing when there is nothing at all", () => {
    expect(tripDates({ trip: null, schedule: s(null, null) })).toMatchObject({ from: null, label: "", derived: false });
    expect(tripDates()).toMatchObject({ label: "" });
  });
});

describe("tripDayOptions", () => {
  // What "Rounds pulls from Tournament" means concretely: the round date
  // picker offers these rather than the whole calendar.
  it("is every day of the trip", () => {
    expect(tripDayOptions({ start_date: "2026-08-13", end_date: "2026-08-16" }))
      .toEqual(["2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16"]);
  });
  it("is the one day when only a start is set", () => {
    expect(tripDayOptions({ start_date: "2026-08-13" })).toEqual(["2026-08-13"]);
  });
  // Empty is what tells the round form to fall back to a plain date box
  // rather than showing an empty dropdown.
  it("is empty when the trip has no dates", () => {
    expect(tripDayOptions(null)).toEqual([]);
    expect(tripDayOptions({ end_date: "2026-08-16" })).toEqual([]);
  });
});

describe("tripDateFields and tripDatesError", () => {
  it("gives the form what was typed, not a fallback", () => {
    expect(tripDateFields({ start_date: "2026-08-13" })).toEqual({ start: "2026-08-13", end: "" });
    expect(tripDateFields(null)).toEqual({ start: "", end: "" });
  });
  it("accepts a well-formed pair, or an empty one", () => {
    expect(tripDatesError({ start: "2026-08-13", end: "2026-08-16" })).toBeNull();
    expect(tripDatesError({ start: "", end: "" })).toBeNull();
    expect(tripDatesError({ start: "2026-08-13", end: "2026-08-13" })).toBeNull();
  });
  // Backwards makes the day list empty and the banner read backwards.
  it("refuses an end before the start", () => {
    expect(tripDatesError({ start: "2026-08-16", end: "2026-08-13" })).toMatch(/before/i);
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

describe("courseTees", () => {
  it("normalizes each tee, padding its holes to eighteen", () => {
    const t = courseTees(course({
      tee_boxes: [{ name: " Blue ", color: "#2d8fd4", rating: "71.2", slope: "135", yardage: "6399", hole_yards: [355, 410] }],
    }))[0];
    expect(t).toMatchObject({ index: 0, name: "Blue", rating: 71.2, slope: 135, yardage: 6399 });
    expect(t.holeYards).toHaveLength(18);
    expect(t.holeYards.slice(0, 3)).toEqual([355, 410, 0]);
  });
  it("names a tee that has none", () => {
    expect(courseTees({ tee_boxes: [{}, {}] }).map(t => t.name)).toEqual(["Tee 1", "Tee 2"]);
  });
  it("is empty for a course with no tees", () => {
    expect(courseTees(course({ tee_boxes: [] }))).toEqual([]);
    expect(courseTees(null)).toEqual([]);
  });
});

describe("courseScorecard", () => {
  const withCard = course({
    hole_pars: [4, 5, 3, 4, 4, 4, 5, 3, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5],
    hole_handicaps: [7, 1, 17, 5, 11, 3, 9, 15, 13, 8, 2, 18, 6, 12, 4, 16, 10, 14],
    tee_boxes: [
      { name: "Blue", yardage: 6399, hole_yards: Array(18).fill(355) },
      { name: "White", yardage: 5900, hole_yards: Array(18).fill(327) },
    ],
  });

  it("lays out eighteen holes with par, index and the chosen tee's yardage", () => {
    const sc = courseScorecard(withCard, 0);
    expect(sc.holes).toHaveLength(18);
    expect(sc.holes[1]).toEqual({ hole: 2, par: 5, hcp: 1, yards: 355 });
    expect(sc.front).toHaveLength(9);
    expect(sc.back[0].hole).toBe(10);
  });
  it("follows the tee that was picked", () => {
    expect(courseScorecard(withCard, 1).holes[0].yards).toBe(327);
    expect(courseScorecard(withCard, 1).tee.name).toBe("White");
  });
  it("totals out, in and the whole card", () => {
    const { totals } = courseScorecard(withCard, 0);
    expect(totals.out).toEqual({ par: 36, yards: 9 * 355 });
    expect(totals.in).toEqual({ par: 36, yards: 9 * 355 });
    expect(totals.total).toEqual({ par: 72, yards: 18 * 355 });
  });
  // A course imported with a total but no per-hole breakdown would otherwise
  // print a real yardage as zero.
  it("falls back to the tee's own total when the holes carry none", () => {
    const noHoleYards = course({
      hole_pars: Array(18).fill(4),
      tee_boxes: [{ name: "Blue", yardage: 6399, hole_yards: [] }],
    });
    expect(courseScorecard(noHoleYards, 0).totals.total).toEqual({ par: 72, yards: 6399 });
  });
  // 0 is what the import writes when the source had no stroke index. It is
  // "not recorded", not a rung, so it reads as blank rather than as zero.
  it("reads an unrecorded stroke index as nothing", () => {
    const sc = courseScorecard(course({ hole_pars: Array(18).fill(4), hole_handicaps: Array(18).fill(0) }), 0);
    expect(sc.holes[0].hcp).toBeNull();
  });
  it("is null for a course with no hole data at all", () => {
    expect(courseScorecard(course({ hole_pars: [] }), 0)).toBeNull();
    expect(courseScorecard(course({ hole_pars: Array(18).fill(0) }), 0)).toBeNull();
    expect(courseScorecard(null, 0)).toBeNull();
  });
  it("survives a tee index that does not exist", () => {
    const sc = courseScorecard(course({ hole_pars: Array(18).fill(4), tee_boxes: [] }), 3);
    expect(sc.tee).toBeNull();
    expect(sc.holes[0].yards).toBe(0);
  });
});

describe("coursePar", () => {
  // The stored `par` and the scorecard can disagree — one came from the
  // import, the other from a director correcting holes since. Showing both is
  // how a sheet says "Par 71" at the top and totals 72 at the bottom.
  it("prefers the card over the stored summary", () => {
    expect(coursePar(course({ par: 71, hole_pars: Array(18).fill(4) }))).toBe(72);
  });
  it("falls back to the stored summary with no card", () => {
    expect(coursePar(course({ par: 71, hole_pars: [] }))).toBe(71);
    expect(coursePar(course({ par: 71, hole_pars: Array(18).fill(0) }))).toBe(71);
  });
  it("is null when the course knows neither", () => {
    expect(coursePar(course({ par: 0, hole_pars: [] }))).toBeNull();
    expect(coursePar(null)).toBeNull();
  });
});
