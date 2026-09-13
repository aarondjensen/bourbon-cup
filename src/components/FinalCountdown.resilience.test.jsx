/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  The Final Countdown, fed garbage
// ══════════════════════════════════════════════════════════════════
//
//  The sibling file (FinalCountdown.test.jsx) pins what the television SHOWS.
//  This one pins that it shows ANYTHING AT ALL.
//
//  The distinction matters more here than anywhere else in the app. This
//  screen runs once a year, in a room, on a machine nobody is going to open a
//  console on, with sixteen people watching and the cup riding on the next
//  tap. Every other screen's worst failure is "that number looks wrong" and
//  somebody reloads. This one's worst failure is a dark television at the
//  moment the tournament is decided, and there is no developer in the room and
//  no second chance at the evening.
//
//  So every test below is the same test: mount the real component against an
//  input shape that should not happen, and assert it renders SOMETHING rather
//  than throwing. What it draws for a nameless man or a missing par is a
//  secondary question — an em dash is a fine answer and so is a raw player id.
//  A thrown TypeError is not.
//
//  WHICH SHAPES ARE REACHABLE, since a test for an impossible input is just
//  ballast. Traced from the call site (components/Leaderboard, `countdown`):
//
//    result          — computeMatchResult's "bail in the shape of a result"
//                      branch when a round's course has been deleted or not
//                      yet booked. It really does hand back `counting: null`,
//                      `holePoints: null` and eighteen empty holes. Reached in
//                      February every year, when the draw exists and the
//                      courses do not.
//    ownResult       — `(ownResults[rnd] || [])[0]?.result || null`. Null is
//                      the documented case, not an edge.
//    holePars/Hcps   — off getRoundCourseCtx, which has no course to read them
//                      from in exactly the same situation.
//    match.teamA/B   — a draw made a side at a time, so unequal and one-man
//                      sides exist while a director is building it.
//    tPlayers        — a roster row deleted after the draw leaves a pid in the
//                      match that nothing can name.
//    withdrawn       — a flag on the roster row, never a removal from the
//                      draw, so the pid stays in teamA and the engine drops it.
//
//  The rest — a null `result`, a garbage `reveal`, a `getScore` that returns a
//  string — are not reachable through today's App. They are here because this
//  component is one refactor upstream away from being handed any of them, and
//  the cost of finding out on the night is the whole evening.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { createPortal } from "react-dom";
import { FinalCountdown } from "./FinalCountdown";
import ErrorBoundary from "./ErrorBoundary";
import { computeMatchResult } from "../scoring";

afterEach(cleanup);

const setWidth = (w) => {
  window.innerWidth = w;
  window.dispatchEvent(new Event("resize"));
};
const PHONE = 393;
const TV = 1280;
afterEach(() => setWidth(TV));

// ── The known-good fixture, copied from the sibling harness ──────────
// Everything below is this with one thing broken, so a failure names the one
// thing rather than the fixture.
const PARS = Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
const courses = [{
  id: "c1", name: "Treetops", hole_pars: PARS, hole_handicaps: SI,
  tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }],
}];
const tRounds = [{
  round_number: 4, format: "team_best_ball", course_id: "c1", tee_box: "White",
  handicap_mode: "full", scoring_type: "points", hole_points: { front: 1, back: 1 },
  counting_scores: { holes: Array(18).fill(2) },
}];
const tPlayers = [
  { player_id: "a1", name: "Paul W", team: "A", handicap_index: 0 },
  { player_id: "a2", name: "Dave K", team: "A", handicap_index: 0 },
  { player_id: "a3", name: "Tim C", team: "A", handicap_index: 0 },
  { player_id: "b1", name: "Andy H", team: "B", handicap_index: 0 },
  { player_id: "b2", name: "Nick R", team: "B", handicap_index: 0 },
  { player_id: "b3", name: "Rudy T", team: "B", handicap_index: 0 },
];
const match = {
  id: "m4", round: 4, teamA: ["a1", "a2", "a3"], teamB: ["b1", "b2", "b3"],
  scoring_type: "points", hole_points: { front: 1, back: 1 },
};
const holeData = {};
Array.from({ length: 18 }, (_, h) => h).forEach((h) => {
  holeData.a1_4 = { ...(holeData.a1_4 || {}), [h]: 3 };
  holeData.a2_4 = { ...(holeData.a2_4 || {}), [h]: 4 };
  holeData.a3_4 = { ...(holeData.a3_4 || {}), [h]: 5 };
  holeData.b1_4 = { ...(holeData.b1_4 || {}), [h]: 4 };
  holeData.b2_4 = { ...(holeData.b2_4 || {}), [h]: 4 };
  holeData.b3_4 = { ...(holeData.b3_4 || {}), [h]: 5 };
});
const result = computeMatchResult(
  match, holeData, courses, tRounds, tPlayers, "team_best_ball", {}, undefined, {}, {});
const getScore = (pid, h) => holeData[`${pid}_4`]?.[h] || 0;
const teams = { A: { id: "A", name: "Mash Brothers" }, B: { id: "B", name: "Shot Callers" } };

const advanced = [];
const cleared = [];

// The whole prop surface, in one place. Anything a case does not name comes
// from the good fixture — so `mount({ result: null })` is "the real screen,
// with no result".
const props = (extra = {}) => ({
  match, result, getScore, ownResult: result, ownGetScore: getScore,
  holePars: PARS, holeHcps: SI, tPlayers, teams,
  courseName: "Treetops", formatLabel: "Team Best Ball",
  reveal: { A: 1, B: 1 }, totals: { A: 3, B: 1 }, toWin: 12.5, clincher: null,
  isDirector: true,
  onAdvance: (s, n) => advanced.push([s, n]),
  onSetHole: (n) => cleared.push(n),
  onClose: () => {},
  ...extra,
});

const mount = (extra = {}) => {
  advanced.length = 0;
  cleared.length = 0;
  return render(<FinalCountdown {...props(extra)} />).container;
};

// ── The assertion the whole file is made of ─────────────────────────
// Not "it throws nothing" alone: a component that renders `null` throws
// nothing either, and a dark television is the failure being tested for. So
// this asks for the fixed backdrop AND for ink on it.
const survives = (extra = {}) => {
  let c;
  expect(() => { c = mount(extra); }).not.toThrow();
  expect(c.firstChild).toBeTruthy();
  expect(c.firstChild.style.position).toBe("fixed");
  expect(c.textContent.trim().length).toBeGreaterThan(0);
  return c;
};

// ══════════════════════════════════════════════════════════════════
//  The result
// ══════════════════════════════════════════════════════════════════
describe("a result that is missing or half-built", () => {
  it("renders with no result at all", () => {
    // The cup band is scored from `totals`, not from `result`, so the two
    // numbers everybody is watching survive a result that never arrived.
    const c = survives({ result: null });
    expect(c.textContent).toContain("TO WIN THE CUP");
    expect(c.textContent).toContain("HOLE 1");
  });

  it("renders with the result prop simply absent", () => {
    survives({ result: undefined });
  });

  it("renders with an empty object for a result", () => {
    survives({ result: {} });
  });

  it("renders with a result holding no holes", () => {
    survives({ result: { ...result, holes: [] } });
  });

  it("renders on a hole past the end of a short holes array", () => {
    // Six holes on the card and the room is on the fourteenth.
    survives({ result: { ...result, holes: result.holes.slice(0, 6) }, reveal: { A: 14, B: 14 } });
  });

  it("renders with holes present but every entry null", () => {
    survives({ result: { ...result, holes: Array(18).fill(null) }, reveal: { A: 9, B: 9 } });
  });

  // `counting` is null on every format that is not Team Best Ball, and on the
  // course-less bail. The "BEST n OF m" line is what reads it.
  it("renders with no counting scores", () => {
    const c = survives({ result: { ...result, counting: null } });
    expect(c.textContent).not.toContain("BEST");
    // And with no counted list, every ball is drawn as having made the number
    // rather than all eight being dimmed — which would be a lie about a
    // Singles or a Team Total.
    expect(c.textContent).toContain("Paul W");
  });

  it("renders with no hole points", () => {
    const c = survives({ result: { ...result, holePoints: null } });
    expect(c.textContent).not.toContain("POINT");
  });

  it("renders with neither, which is the shape the two arrive in", () => {
    survives({ result: { ...result, counting: null, holePoints: null } });
  });

  it("renders with no stroke maps to draw dots from", () => {
    survives({ result: { ...result, strokeMaps: undefined } });
  });

  // ── The course-less round, scored for real ──
  // Not a hand-built object: computeMatchResult's own bail branch, fed a match
  // whose round has no course and no lock. A director draws in February and
  // books in June, and between those two this is what every screen is handed.
  it("renders the result computeMatchResult hands back for a deleted course", () => {
    const bail = computeMatchResult(
      match, holeData, [], tRounds, tPlayers, "team_best_ball", {}, undefined, {}, {});
    expect(bail.counting).toBe(null);
    expect(bail.holePoints).toBe(null);
    expect(bail.holes).toHaveLength(18);
    // The hole tables come off the same missing course, so they go too.
    const c = survives({
      result: bail, ownResult: bail, holePars: undefined, holeHcps: undefined,
      courseName: null, reveal: { A: 5, B: 5 },
    });
    expect(c.textContent).toContain("HOLE 5");
    expect(c.textContent).toContain("PAR — · HANDICAP —");
  });

  it("renders the course-less result from the opening screen too", () => {
    const bail = computeMatchResult(
      match, holeData, [], tRounds, tPlayers, "team_best_ball", {}, undefined, {}, {});
    const c = survives({ result: bail, ownResult: bail, reveal: { A: 0, B: 0 } });
    expect(c.textContent).toContain("THE FINAL COUNTDOWN");
    // No hole points to multiply out: it says nothing rather than NaN.
    expect(c.textContent).not.toContain("NaN");
  });
});

// ══════════════════════════════════════════════════════════════════
//  The draw
// ══════════════════════════════════════════════════════════════════
describe("a match whose sides are not eight and eight", () => {
  it("renders with both sides empty", () => {
    survives({ match: { ...match, teamA: [], teamB: [] } });
  });

  it("renders with one man a side", () => {
    const c = survives({ match: { ...match, teamA: ["a1"], teamB: ["b1"] } });
    expect(c.textContent).toContain("Paul W");
    expect(c.textContent).toContain("Andy H");
  });

  it("renders with sides of unequal length", () => {
    survives({ match: { ...match, teamA: ["a1", "a2", "a3"], teamB: ["b1"] } });
  });

  it("renders with one side empty and the other full", () => {
    survives({ match: { ...match, teamA: [] } });
  });

  it("renders with teamA missing entirely", () => {
    // The "BEST n OF m" line reads `match.teamA?.length` for its m.
    const c = survives({ match: { id: "m4", round: 4, teamB: ["b1", "b2", "b3"] } });
    expect(c.textContent).toContain("BEST 2 OF —");
  });

  it("renders with no match object worth the name", () => {
    survives({ match: {} });
  });
});

// ══════════════════════════════════════════════════════════════════
//  Men the roster cannot name
// ══════════════════════════════════════════════════════════════════
//  A roster row deleted after the draw was made. The match keeps the pid —
//  that is deliberate, it is the only record of who played — and `nameOf`
//  answers with the raw id, which is documented behaviour in lib/players and
//  the thing this screen has to draw.
describe("a pid nothing can name", () => {
  it("draws the raw player id rather than a blank", () => {
    const c = survives({ match: { ...match, teamA: ["a1", "ghost_9", "a3"] } });
    expect(c.textContent).toContain("ghost_9");
    // And the men either side of him are still there, in alphabetical order
    // with the id sorting among them.
    expect(c.textContent).toContain("Paul W");
    expect(c.textContent).toContain("Tim C");
  });

  it("renders with no roster at all", () => {
    // Every man on both sides is an unnameable id. The subscription arriving a
    // frame late is exactly this.
    const c = survives({ tPlayers: [] });
    expect(c.textContent).toContain("a1");
  });

  it("renders with the roster prop null", () => {
    survives({ tPlayers: null });
  });

  it("renders with a roster row carrying no name", () => {
    survives({
      tPlayers: tPlayers.map((p) => (p.player_id === "a1" ? { player_id: "a1", team: "A" } : p)),
    });
  });

  // The one that genuinely has no name to fall back on: `nameOf` answers a
  // null pid with the null. A draw cannot write one today — MatchSetup stores
  // the selected ids — but the sort that orders the column is one `.name` away
  // from a TypeError, and a TypeError here is the dark television.
  it("renders with a hole in the side where a pid should be", () => {
    const c = survives({ match: { ...match, teamA: ["a1", null, "a3"] } });
    expect(c.textContent).toContain("Paul W");
  });

  it("renders with an undefined pid in the side", () => {
    survives({ match: { ...match, teamB: ["b1", undefined] } });
  });

  it("renders with a duplicated pid on one side", () => {
    // Two rows keyed the same — React complains, it does not crash.
    survives({ match: { ...match, teamA: ["a1", "a1", "a2"] } });
  });
});

// ══════════════════════════════════════════════════════════════════
//  Withdrawals
// ══════════════════════════════════════════════════════════════════
//  A withdrawal is a flag on the roster row and never a removal from the draw
//  (see the note in scoring.js) — so the pid is still in `match.teamA`, the
//  engine has dropped him from every sum, and this screen still has to draw
//  him a line.
describe("a man who went home", () => {
  const withdrawnPlayers = tPlayers.map(
    (p) => (p.player_id === "a2" ? { ...p, withdrawn: true } : p));
  const withdrawnResult = computeMatchResult(
    match, holeData, courses, tRounds, withdrawnPlayers, "team_best_ball", {}, undefined, {}, {});

  it("renders the hole with a withdrawn man still in the draw", () => {
    const c = survives({
      result: withdrawnResult, ownResult: withdrawnResult, tPlayers: withdrawnPlayers,
    });
    expect(c.textContent).toContain("Dave K");
  });

  it("renders when a whole side has withdrawn", () => {
    const gone = tPlayers.map((p) => (p.team === "B" ? { ...p, withdrawn: true } : p));
    const r = computeMatchResult(
      match, holeData, courses, tRounds, gone, "team_best_ball", {}, undefined, {}, {});
    survives({ result: r, ownResult: r, tPlayers: gone, reveal: { A: 9, B: 9 } });
  });

  it("renders on a captain's phone with his own partner withdrawn", () => {
    setWidth(PHONE);
    survives({
      result: withdrawnResult, ownResult: withdrawnResult, tPlayers: withdrawnPlayers,
      isDirector: false, captainSide: "A",
    });
  });
});

// ══════════════════════════════════════════════════════════════════
//  The hole tables
// ══════════════════════════════════════════════════════════════════
describe("pars and stroke indexes that are not there", () => {
  it("renders with neither table", () => {
    const c = survives({ holePars: undefined, holeHcps: undefined });
    expect(c.textContent).toContain("PAR — · HANDICAP —");
  });

  it("renders with both tables null", () => {
    survives({ holePars: null, holeHcps: null });
  });

  it("renders with tables shorter than the round", () => {
    const c = survives({
      holePars: PARS.slice(0, 9), holeHcps: SI.slice(0, 9), reveal: { A: 14, B: 14 },
    });
    expect(c.textContent).toContain("HOLE 14");
    expect(c.textContent).toContain("PAR —");
  });

  it("renders with nulls inside the tables", () => {
    const holed = PARS.map((p, i) => (i % 3 === 0 ? null : p));
    survives({ holePars: holed, holeHcps: SI.map((s, i) => (i % 4 === 0 ? null : s)) });
  });

  it("renders with a par that is not a number", () => {
    survives({ holePars: PARS.map(() => "four") });
  });

  it("renders with the tables as objects rather than arrays", () => {
    // A hole-table written as a map, which is a shape Firestore likes and
    // arrays-with-holes turn into.
    survives({ holePars: { 0: 4, 1: 4 }, holeHcps: { 0: 1 } });
  });

  it("renders the captain's card with no par or index to read out", () => {
    setWidth(PHONE);
    const c = survives({
      holePars: undefined, holeHcps: undefined, isDirector: false, captainSide: "A",
    });
    expect(c.textContent).toContain("HOLE 2");
  });
});

// ══════════════════════════════════════════════════════════════════
//  getScore
// ══════════════════════════════════════════════════════════════════
//  The real one is `(map[key] || {})[h] || 0`, so it always answers with a
//  number. These are what a refactor of that line could start answering with.
describe("a getScore that answers oddly", () => {
  const each = [
    ["zero, which is the real one's no-score", () => 0],
    ["null", () => null],
    ["undefined", () => undefined],
    ["a string", () => "4"],
    ["a non-numeric string", () => "x"],
    ["a negative number", () => -3],
    ["NaN", () => NaN],
    ["Infinity", () => Infinity],
    ["a float", () => 4.5],
    ["an object", () => ({})],
  ];
  each.forEach(([label, fn]) => {
    it(`renders when getScore returns ${label}`, () => {
      survives({ getScore: fn, ownGetScore: fn });
    });
  });

  it("renders on a captain's phone with every ball a string", () => {
    setWidth(PHONE);
    survives({
      getScore: () => "5", ownGetScore: () => "5", isDirector: false, captainSide: "A",
    });
  });
});

// ══════════════════════════════════════════════════════════════════
//  The teams
// ══════════════════════════════════════════════════════════════════
//  resolveTeams in constants.js guarantees a name today, so these are not
//  reachable through App — but the name is read into `.toUpperCase()` in four
//  places and one of them is the waiting line the room stares at for the whole
//  of a captain's story.
describe("teams that are not fully named", () => {
  it("renders with a team carrying no name", () => {
    survives({ teams: { A: { id: "A" }, B: { id: "B", name: "Shot Callers" } } });
  });

  it("renders with neither side named", () => {
    survives({ teams: { A: {}, B: {} } });
  });

  it("renders with an empty name string", () => {
    survives({ teams: { A: { id: "A", name: "" }, B: { id: "B", name: "" } } });
  });

  it("renders with no colours on the team objects", () => {
    // The palette is read from the theme by side id, never off these objects,
    // so a team with no colour is drawn in the side's colour anyway.
    const c = survives({ teams: { A: { name: "Irons" }, B: { name: "Drivers" } } });
    expect(c.textContent).toContain("Irons");
  });

  it("renders with a team object missing altogether", () => {
    survives({ teams: { A: { id: "A", name: "Mash Brothers" } } });
  });

  it("renders with no teams object at all", () => {
    survives({ teams: {} });
  });

  it("renders a captain's card with his own side unnamed", () => {
    setWidth(PHONE);
    survives({
      teams: { A: {}, B: {} }, isDirector: false, captainSide: "A",
    });
  });
});

// ══════════════════════════════════════════════════════════════════
//  The cup band's own numbers
// ══════════════════════════════════════════════════════════════════
describe("totals and the line to win", () => {
  it("renders with no totals object", () => {
    survives({ totals: {} });
  });

  it("renders with totals that are not numbers", () => {
    survives({ totals: { A: null, B: undefined } });
  });

  it("renders with no target to reach", () => {
    survives({ toWin: null });
  });

  it("renders with a zero target", () => {
    // `pct` divides by a scale floored at 1, so a zero target cannot divide by
    // zero — the ticks land on the ends.
    const c = survives({ toWin: 0, totals: { A: 0, B: 0 } });
    expect(c.textContent).not.toContain("NaN%");
  });

  it("renders with totals past the target", () => {
    survives({ totals: { A: 40, B: 2 }, toWin: 12.5 });
  });

  it("renders with a clincher naming a side that is not playing", () => {
    survives({ clincher: "C" });
  });
});

// ══════════════════════════════════════════════════════════════════
//  The reveal state
// ══════════════════════════════════════════════════════════════════
//  `sideReveal` clamps both counters to 0…18 before this screen ever sees
//  them, so none of this arrives through App today. It is one prop-drilling
//  change away from doing so, and the failure mode is the one that cannot be
//  recovered in the room.
describe("a reveal made of garbage", () => {
  const each = [
    ["no reveal object at all", undefined],
    ["a null reveal", null],
    ["an empty reveal", {}],
    ["one side set and the other absent", { A: 4 }],
    ["the other side set alone", { B: 7 }],
    ["past the eighteenth", { A: 25, B: 25 }],
    ["one side past the eighteenth", { A: 25, B: 3 }],
    ["negative counters", { A: -4, B: -9 }],
    ["one negative counter", { A: -1, B: 5 }],
    ["non-numeric counters", { A: "six", B: "seven" }],
    ["numeric strings", { A: "6", B: "6" }],
    ["fractional counters", { A: 3.5, B: 3.5 }],
    ["a cursor beyond both counters", { A: 2, B: 2, cursor: 17 }],
    ["a cursor past the eighteenth", { A: 2, B: 2, cursor: 40 }],
    ["a negative cursor", { A: 2, B: 2, cursor: -5 }],
    ["a non-numeric cursor", { A: 2, B: 2, cursor: "eight" }],
    ["a cursor behind both counters", { A: 9, B: 9, cursor: 2 }],
    ["nulls for both counters", { A: null, B: null }],
  ];
  each.forEach(([label, reveal]) => {
    it(`renders with ${label}`, () => { survives({ reveal }); });
  });

  // ── What it actually draws, pinned ──────────────────────────────
  // A counter that is not a number turns `Math.max` into NaN and the header
  // reads "HOLE NaN". That is a bad-looking screen and not a dark one: the cup
  // band, the strip and both captains' buttons are all still there, and one
  // tap takes the room back. It cannot arrive through App — `sideReveal`
  // clamps both counters to 0…18 before this screen ever sees them — so this
  // is recorded rather than repaired, and a future caller that stops clamping
  // shows up here as a changed expectation instead of as a surprise in the
  // room.
  it("degrades to a NaN hole rather than a dark screen", () => {
    const c = survives({ reveal: { A: 4 } });
    expect(c.textContent).toContain("HOLE NaN");
    expect(c.textContent).toContain("TO WIN THE CUP");
    expect(c.textContent).toContain("REVEAL");
  });

  it("draws a counter past the eighteenth as the hole it says", () => {
    const c = survives({ reveal: { A: 25, B: 25 } });
    expect(c.textContent).toContain("HOLE 25");
    // Both sides are out of holes, so neither button offers one.
    expect(c.textContent).toContain("ALL OUT");
    // And the strip is still eighteen cells, not twenty-five.
    const cells = [...c.querySelectorAll("div,button")]
      .filter((d) => /^([1-9]|1[0-8])$/.test(d.textContent)
        && d.style.borderRadius?.startsWith("clamp(3px"));
    expect(cells).toHaveLength(18);
  });

  it("renders garbage on a phone too, where the captain's card also reads it", () => {
    setWidth(PHONE);
    each.forEach(([, reveal]) => {
      expect(() => render(
        <FinalCountdown {...props({ reveal, isDirector: false, captainSide: "A" })} />,
      )).not.toThrow();
      cleanup();
    });
  });
});

// ══════════════════════════════════════════════════════════════════
//  Every hole of the ceremony, both sides, on both screens
// ══════════════════════════════════════════════════════════════════
//  The single most valuable block in the file. 361 is the whole space the two
//  counters can be in — including the pairs the ceremony forbids, because a
//  stale subscription, a second phone or a director's repair can put them
//  anywhere and the screen is not the thing enforcing the rule.
//
//  It costs about twenty seconds of the suite, which is the cheapest insurance
//  in this repo: the alternative way to find out that hole 13 with A four
//  ahead renders is to find out in the room.
describe("the whole ceremony, state by state", () => {
  it("renders all 361 reveal pairs on the television", () => {
    setWidth(TV);
    for (let a = 0; a <= 18; a += 1) {
      for (let b = 0; b <= 18; b += 1) {
        let c;
        expect(() => { c = mount({ reveal: { A: a, B: b } }); },
          `reveal A=${a} B=${b}`).not.toThrow();
        expect(c.textContent.trim().length, `reveal A=${a} B=${b}`).toBeGreaterThan(0);
        // The hole on screen is the furthest either captain has gone.
        const on = Math.max(a, b);
        expect(c.textContent, `reveal A=${a} B=${b}`)
          .toContain(on === 0 ? "THE FINAL COUNTDOWN" : `HOLE ${on}`);
        cleanup();
      }
    }
  }, 120_000);

  // The phone carries a second thing the television does not — the captain's
  // card, compiled from his side's history up to the hole he is announcing —
  // so it is walked separately. Only the pairs the ceremony can actually
  // produce (a side is at most one hole ahead), because the card is the one
  // part of this screen whose cost grows with the round and the full square
  // would double the block's running time for states the rules refuse.
  it("renders every legal pair on a captain's phone, card and all", () => {
    setWidth(PHONE);
    for (let a = 0; a <= 18; a += 1) {
      [a - 1, a, a + 1].forEach((b) => {
        if (b < 0 || b > 18) return;
        ["A", "B"].forEach((side) => {
          expect(() => {
            render(<FinalCountdown {...props({
              reveal: { A: a, B: b }, isDirector: false, captainSide: side,
            })} />);
          }, `reveal A=${a} B=${b} as ${side}`).not.toThrow();
          cleanup();
        });
      });
    }
  }, 120_000);

  // The cleared board: both captains done, the director taps ▸, and the room
  // sits on a hole with nothing on it. `countdownHole` is the max of the
  // cursor and the reveal, so the cursor ahead of the counters is the shape
  // that matters — a cursor behind them is covered by the garbage block above.
  it("renders every cleared board the cursor can sit on", () => {
    setWidth(TV);
    for (let h = 0; h <= 18; h += 1) {
      for (let cur = h; cur <= 18; cur += 1) {
        let c;
        expect(() => { c = mount({ reveal: { A: h, B: h, cursor: cur } }); },
          `hole ${h} cursor ${cur}`).not.toThrow();
        expect(c.textContent.trim().length, `hole ${h} cursor ${cur}`).toBeGreaterThan(0);
        cleanup();
      }
    }
  }, 120_000);
});

// ══════════════════════════════════════════════════════════════════
//  The eighteenth
// ══════════════════════════════════════════════════════════════════
describe("the last hole and the band under the cup", () => {
  const last = { A: 18, B: 18 };
  // The clinch band is ALWAYS in the layout and only sometimes lit (see the
  // sibling file), so its text is on screen from hole 1 and `toContain` alone
  // proves nothing. Opacity is what says the cup has been won.
  const band = (c) => [...c.querySelectorAll("div")]
    .find((d) => d.children.length === 1 && /WIN THE BOURBON CUP$/.test(d.textContent));

  it("renders the eighteenth with both sides out and nobody clinching", () => {
    const c = survives({ reveal: last });
    expect(c.textContent).toContain("HOLE 18");
    expect(c.textContent).toContain("ALL OUT");
  });

  it("renders a dead tie", () => {
    const c = survives({ reveal: last, totals: { A: 12, B: 12 }, toWin: 12.5, clincher: null });
    expect(c.textContent).toContain("12");
    // Nobody won it: the band is in the layout and unlit.
    expect(band(c).style.opacity).toBe("0");
  });

  it("renders a one-point win", () => {
    const c = survives({ reveal: last, totals: { A: 12.5, B: 11.5 }, toWin: 12.5, clincher: "A" });
    expect(band(c).textContent).toContain("Mash Brothers WIN THE BOURBON CUP");
    expect(band(c).style.opacity).toBe("1");
  });

  it("renders a blowout", () => {
    const c = survives({ reveal: last, totals: { A: 3, B: 21 }, toWin: 12.5, clincher: "B" });
    expect(band(c).textContent).toContain("Shot Callers WIN THE BOURBON CUP");
    expect(band(c).style.opacity).toBe("1");
    // The confetti falls, on the winners, and it does not take the screen down.
    const fall = [...c.querySelectorAll("span")]
      .filter((el) => (el.style.animation || "").includes("bcConfettiFall"));
    expect(fall.length).toBeGreaterThan(20);
  });

  it("renders a clinch on a half-turned eighteenth", () => {
    // A's captain has spoken and B's has not, and the cup total already says
    // it is over. The band must wait, and the screen must not.
    const c = survives({ reveal: { A: 18, B: 17 }, clincher: "A" });
    expect(band(c).style.opacity).toBe("0");
  });

  it("renders a clinch with no result to read a winner from", () => {
    survives({ reveal: last, clincher: "A", result: null });
  });

  it("renders a clinch on a phone", () => {
    setWidth(PHONE);
    survives({ reveal: last, clincher: "B", totals: { A: 8, B: 16 } });
  });

  // ── Already mathematically over before the eighteenth ──
  // The room still walks the remaining holes, and the band stays lit across
  // every one of them. It is the longest-lived state on this screen.
  it("renders every hole after the cup is already won", () => {
    for (let h = 12; h <= 18; h += 1) {
      let c;
      expect(() => {
        c = mount({ reveal: { A: h, B: h }, totals: { A: 14, B: 4 }, toWin: 12.5, clincher: "A" });
      }, `hole ${h}`).not.toThrow();
      expect(c.textContent).toContain("WIN THE BOURBON CUP");
      cleanup();
    }
  });
});

// ══════════════════════════════════════════════════════════════════
//  Hands on the controls
// ══════════════════════════════════════════════════════════════════
describe("taps that come faster than the state", () => {
  // The reveal is CONTROLLED — the counters live in Firestore and arrive back
  // as props — so a captain tapping four times before the write lands is four
  // calls with the same argument, not four holes. That is the guarantee worth
  // pinning: the screen cannot run ahead of the room on its own.
  it("asks for the same hole however many times it is tapped", () => {
    const c = mount({ reveal: { A: 3, B: 3 } });
    const btn = [...c.querySelectorAll("button")]
      .find((b) => b.textContent.includes("REVEAL SHOT CALLERS"));
    for (let i = 0; i < 8; i += 1) fireEvent.click(btn);
    expect(advanced).toHaveLength(8);
    advanced.forEach((call) => expect(call).toEqual(["B", 4]));
    // And the screen is still on the hole it was on.
    expect(c.textContent).toContain("HOLE 3");
  });

  it("stays consistent when both sides are hammered at once", () => {
    const c = mount({ reveal: { A: 3, B: 3 } });
    const buttons = [...c.querySelectorAll("button")]
      .filter((b) => b.textContent.includes("REVEAL"));
    for (let i = 0; i < 6; i += 1) buttons.forEach((b) => fireEvent.click(b));
    // Every call is hole 4, whichever side it was for. Nothing asked for 5.
    advanced.forEach(([, n]) => expect(n).toBe(4));
  });

  it("survives the state arriving one tap at a time, all eighteen holes", () => {
    // The real sequence: A reveals, B reveals, the director clears, repeat.
    // Re-mounted at each step because that is what a prop change does here.
    setWidth(TV);
    let a = 0, b = 0;
    for (let h = 1; h <= 18; h += 1) {
      [["A"], ["B"]].forEach(([side]) => {
        const c = mount({ reveal: { A: a, B: b, cursor: h } });
        const btn = [...c.querySelectorAll("button")]
          .find((x) => x.textContent.includes(`REVEAL ${side === "A" ? "MASH" : "SHOT"}`));
        if (btn) fireEvent.click(btn);
        if (side === "A") a = h; else b = h;
        cleanup();
      });
      expect(() => { mount({ reveal: { A: a, B: b, cursor: h } }); }).not.toThrow();
      cleanup();
    }
    expect(a).toBe(18);
    expect(b).toBe(18);
  });

  it("survives the arrows and the keyboard on a broken hole", () => {
    const c = mount({ reveal: { A: 7, B: 7 }, result: null, holePars: undefined });
    const next = c.querySelector('button[aria-label="Next hole"]');
    const prev = c.querySelector('button[aria-label="Previous hole"]');
    expect(() => {
      fireEvent.click(next); fireEvent.click(prev);
      fireEvent.keyDown(window, { key: " " });
      fireEvent.keyDown(window, { key: "ArrowLeft" });
      fireEvent.keyDown(window, { key: "Escape" });
    }).not.toThrow();
  });

  it("survives every control with no handlers wired at all", () => {
    // A spectator's television: no onAdvance, no onSetHole. Nothing may assume
    // a callback exists.
    const c = survives({
      onAdvance: undefined, onSetHole: undefined, isDirector: false, captainSide: null,
      reveal: { A: 9, B: 9 },
    });
    expect(c.textContent).toContain("THE CAPTAINS ARE DRIVING");
    expect(() => fireEvent.keyDown(window, { key: " " })).not.toThrow();
  });

  it("survives a director with no onSetHole but an onAdvance", () => {
    survives({ onSetHole: null, reveal: { A: 9, B: 9 } });
  });

  it("survives a strip tap on a screen with no result", () => {
    const c = mount({ reveal: { A: 9, B: 9 }, result: null });
    const cell = [...c.querySelectorAll("button")]
      .filter((d) => d.textContent === "3").pop();
    expect(() => fireEvent.click(cell)).not.toThrow();
    expect(advanced).toEqual([[null, 3]]);
  });
});

// ══════════════════════════════════════════════════════════════════
//  The captain's card, on nothing
// ══════════════════════════════════════════════════════════════════
//  It is the only part of this screen that reads a SECOND pass of the engine,
//  and the caller's own expression for it ends in `|| null`.
describe("the captain's own card", () => {
  const asCaptain = { isDirector: false, captainSide: "A" };

  it("renders with no own-result to build a prompt from", () => {
    setWidth(PHONE);
    const c = survives({ ...asCaptain, ownResult: null });
    // No card, and the screen is otherwise whole: he still gets his button.
    expect(c.textContent).toContain("REVEAL MASH BROTHERS");
  });

  it("renders with an own-result holding no holes", () => {
    setWidth(PHONE);
    survives({ ...asCaptain, ownResult: { ...result, holes: [] } });
  });

  it("renders with an own-result that is an empty object", () => {
    setWidth(PHONE);
    survives({ ...asCaptain, ownResult: {} });
  });

  it("renders with no own-score reader", () => {
    setWidth(PHONE);
    survives({ ...asCaptain, ownGetScore: null });
  });

  it("renders deep into the round, where the nugget history is longest", () => {
    setWidth(PHONE);
    survives({ ...asCaptain, reveal: { A: 17, B: 17 } });
  });

  it("renders for a captain of a side that is not in the match", () => {
    setWidth(PHONE);
    survives({ ...asCaptain, captainSide: "B", match: { ...match, teamB: [] } });
  });

  it("renders for a captain whose side has nothing left to show", () => {
    setWidth(PHONE);
    survives({ ...asCaptain, reveal: { A: 18, B: 18 } });
  });
});

// ══════════════════════════════════════════════════════════════════
//  If it DOES crash, what does the room see?
// ══════════════════════════════════════════════════════════════════
//  Every test above is an argument that it will not. This one is the floor
//  under that argument, and it is worth having written down because the answer
//  is not obvious from the source: the countdown is rendered with
//  `createPortal(…, document.body)` from inside TeamLeaderboard, so its DOM
//  node is nowhere near the app shell — but a portal's CHILDREN are still part
//  of the React tree of the component that created them, which means App's
//  `<ErrorBoundary key={view}>` is above it and does catch it.
//
//  So a crash here is not a white screen. It is the Leaderboard tab replaced
//  by "Something went wrong" with the television's portal torn down — the
//  whole tab, on every phone in the room, not just the countdown.
describe("the boundary above it", () => {
  // React logs the caught error; the test is about the fallback, not the noise.
  const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

  it("catches a crash in the countdown even through the portal", () => {
    const spy = quiet();
    const boom = () => { throw new Error("a hole that is not there"); };
    const c = render(
      <ErrorBoundary>
        {createPortal(
          <FinalCountdown {...props({ getScore: boom, ownGetScore: boom })} />,
          document.body,
        )}
      </ErrorBoundary>,
    ).container;
    // The friendly fallback, in the tab's own tree.
    expect(c.textContent).toContain("Something went wrong");
    // And the television's fixed layer is gone rather than left half-drawn.
    expect(document.querySelector('div[style*="z-index: 4000"]')).toBe(null);
    spy.mockRestore();
  });

  it("leaves the app standing when the countdown is the only thing broken", () => {
    const spy = quiet();
    const boom = () => { throw new Error("nope"); };
    const c = render(
      <ErrorBoundary>
        <div>THE SCOREBOARD</div>
        {createPortal(
          <FinalCountdown {...props({ getScore: boom, ownGetScore: boom })} />,
          document.body,
        )}
      </ErrorBoundary>,
    ).container;
    // …except it does NOT. The boundary is the tab, so the sibling goes with
    // it. That is the finding, pinned: containment here is per-TAB, not
    // per-countdown, and closing the gap means a boundary of its own around
    // the portal in components/Leaderboard.
    expect(c.textContent).not.toContain("THE SCOREBOARD");
    expect(c.textContent).toContain("Something went wrong");
    spy.mockRestore();
  });
});

// ══════════════════════════════════════════════════════════════════
//  Everything at once
// ══════════════════════════════════════════════════════════════════
//  The February screen: a round drawn, no course booked, half a roster, the
//  reveal state a director left behind last year. If this renders, the
//  television is not going dark.
describe("all of it broken together", () => {
  it("renders the worst input this screen can be handed", () => {
    const c = survives({
      match: { round: 4, teamA: ["a1", null], teamB: [] },
      result: {},
      ownResult: null,
      getScore: () => null,
      ownGetScore: () => null,
      holePars: null,
      holeHcps: null,
      tPlayers: [],
      teams: { A: {}, B: {} },
      courseName: null,
      formatLabel: null,
      reveal: { A: "x", B: null, cursor: 99 },
      totals: {},
      toWin: undefined,
      clincher: "A",
    });
    expect(c.firstChild.style.position).toBe("fixed");
  });

  it("renders the same wreck on a phone, as a captain", () => {
    setWidth(PHONE);
    survives({
      match: { round: 4, teamA: ["a1", null], teamB: [] },
      result: {}, ownResult: {}, getScore: () => null, ownGetScore: () => null,
      holePars: null, holeHcps: null, tPlayers: [], teams: { A: {}, B: {} },
      reveal: { A: "x", B: null, cursor: 99 }, totals: {}, toWin: undefined,
      isDirector: false, captainSide: "A",
    });
  });
});
