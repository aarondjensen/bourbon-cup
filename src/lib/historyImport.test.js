// Shapes, ids and the handful of decisions historyImport makes on its own.
// Whether an imported year SCORES the way it was played is the other test —
// historyImport.fidelity.test.js, against all ten years of real data.
import { describe, it, expect } from "vitest";
import {
  buildEdition, editionDocFor, editionIdForYear, historyPlayerId, historyCourseId,
  isHistoryCourseId, playerDocFor, roundDocFor, roundLockDocFor, matchDocFor, holeDocFor,
  teamNamesDocFor, formOfPlayFor, allowanceFor, countDocs, IMPORT_COLLECTIONS, HISTORY_TEE,
} from "./historyImport.js";

const round = (over = {}) => ({
  round: 1,
  format: "best_ball",
  source_format: "2man_best_ball",
  handicap_mode: "low_man",
  course: { name: "Arthur Hills - Orange", par: 72, rating: 71.2, slope: 130, hole_pars: Array(18).fill(4), hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1) },
  nassau: { front: 1, back: 1, overall: 2 },
  ch: { jensen: 7, kj: 9 },
  ...over,
});

const edition = (over = {}) => ({
  year: 2019,
  name: "The Bourbon Cup 2019",
  teams: { A: "DEFCON", B: "BULLEIT" },
  players: [
    { id: "jensen", name: "Jensen", team: "A", index: 7.2 },
    { id: "kj", name: "KJ", team: "B", index: 9.1 },
  ],
  rounds: [round()],
  matches: [{ round: 1, teamA: ["jensen"], teamB: ["kj"] }],
  ...over,
});

const holes = (player, gross = 4) =>
  Array.from({ length: 18 }, (_, i) => ({ year: 2019, round: 1, player, hole: i + 1, gross, scoring_type: "match_status" }));

describe("ids", () => {
  it("scopes a roster row to its year, because the row IS the player document", () => {
    expect(historyPlayerId(2019, "jensen")).toBe("hist_2019_jensen");
    expect(historyPlayerId(2020, "jensen")).not.toBe(historyPlayerId(2019, "jensen"));
  });

  it("keys a course by round, so one course played twice is two cards", () => {
    const r2 = historyCourseId(2020, 2, "Harbor Shores - Gray");
    const r3 = historyCourseId(2020, 3, "Harbor Shores - Gray");
    expect(r2).not.toBe(r3);
    expect(isHistoryCourseId(r2)).toBe(true);
    expect(isHistoryCourseId("bc_course_123")).toBe(false);
  });

  it("namespaces every per-edition document id", () => {
    expect(roundDocFor({ year: 2019, round: round() }).id).toBe("bc_2019__bc_round_1");
    expect(teamNamesDocFor({ year: 2019, teams: { A: "a", B: "b" } }).id).toBe("bc_2019__team_names");
    expect(holeDocFor({ year: 2019, round: 1, playerId: "jensen", hole: 7, gross: 5, courseName: "X" }).id)
      .toBe("bc_2019__bc_hs_r1_hist_2019_jensen_h7");
  });
});

describe("the edition row", () => {
  it("arrives archived and namespaced, and says where it came from", () => {
    const doc = editionDocFor({ year: 2016, name: "The Bourbon Cup 2016" });
    expect(doc).toMatchObject({ id: "bc_2016", year: 2016, status: "archived", namespaced: true, created_from: null });
    expect(doc.imported_from).toBeTruthy();
  });

  it("falls back to a name rather than importing a blank one", () => {
    expect(editionDocFor({ year: 2016, name: "  " }).name).toBe("The Bourbon Cup 2016");
  });
});

describe("form of play", () => {
  it("settles the dots and points games on a total, not on holes won", () => {
    expect(formOfPlayFor("2man_hi_lo")).toBe("stroke");
    expect(formOfPlayFor("double_dot")).toBe("stroke");
    expect(formOfPlayFor("dirty_dozen")).toBe("stroke");
    expect(formOfPlayFor("2man_stableford")).toBe("stroke");
    expect(formOfPlayFor("2man_tilt")).toBe("stroke");
  });

  it("scores Team Best Ball in points per hole", () => {
    expect(formOfPlayFor("team_best_ball")).toBe("points");
    expect(formOfPlayFor("8man_top4net")).toBe("points");
  });

  it("leaves everything else a match", () => {
    expect(formOfPlayFor("singles")).toBe("match");
    expect(formOfPlayFor("2man_scramble")).toBe("match");
    expect(formOfPlayFor("something new")).toBe("match");
  });
});

describe("the allowance", () => {
  it("is 50/50 on the shared-ball formats — the sheet already blended them", () => {
    expect(allowanceFor("scramble")).toEqual({ enabled: true, low: 50, high: 50 });
    expect(allowanceFor("pinehurst")).toEqual({ enabled: true, low: 50, high: 50 });
  });

  it("is absent everywhere else, which the app reads as 100%", () => {
    expect(allowanceFor("singles")).toBe(null);
    expect(allowanceFor("team_best_ball")).toBe(null);
  });
});

describe("the round lock", () => {
  const lock = roundLockDocFor({
    year: 2019,
    round: round(),
    players: edition().players,
    ch: { jensen: 7, kj: 9 },
    course: round().course,
  });

  it("arrives locked AND final — these tournaments are over", () => {
    expect(lock.locked).toBe(true);
    expect(lock.final).toBe(true);
    expect(lock.locked_reason).toBe("import");
  });

  it("freezes the recorded course handicap as the answer", () => {
    expect(lock.players.hist_2019_jensen.ch).toBe(7);
    expect(lock.players.hist_2019_kj.ch).toBe(9);
    // Not flagged as an override: nobody typed it, it is what was played off.
    expect(lock.players.hist_2019_jensen.overridden).toBe(false);
  });

  it("leaves the handicap null when the sheet recorded none, rather than guessing zero", () => {
    const partial = roundLockDocFor({
      year: 2019, round: round(), players: edition().players, ch: { jensen: 7 }, course: round().course,
    });
    expect(partial.players.hist_2019_kj.ch).toBe(null);
  });

  it("carries the hole tables, so a deleted course can't re-rate a finished round", () => {
    expect(lock.hole_pars).toHaveLength(18);
    expect(lock.hole_handicaps).toHaveLength(18);
  });
});

describe("buildEdition", () => {
  const built = buildEdition(edition(), [...holes("jensen", 4), ...holes("kj", 5)], { handicapModeFor: () => "low_man" });

  it("writes every collection an edition is made of", () => {
    expect(Object.keys(built)).toEqual(expect.arrayContaining(IMPORT_COLLECTIONS));
    expect(countDocs(built)).toBe(1 + 2 + 2 + 1 + 1 + 1 + 1 + 36);
  });

  it("points the scores, the round and the lock at the same course document", () => {
    const courseId = built.bc_courses[0].id;
    expect(built.bc_rounds[0].course_id).toBe(courseId);
    expect(built.bc_round_locks[0].course_id).toBe(courseId);
    expect(built.bc_hole_scores.every((h) => h.course_id === courseId)).toBe(true);
  });

  it("plays every round off the one tee the sheet recorded", () => {
    expect(built.bc_courses[0].tee_boxes[0].name).toBe(HISTORY_TEE);
    expect(built.bc_rounds[0].tee_box).toBe(HISTORY_TEE);
    expect(built.bc_round_locks[0].players.hist_2019_jensen.tee).toBe(HISTORY_TEE);
  });

  it("carries the names onto the match, the way MatchSetup does", () => {
    expect(built.bc_matches[0]).toMatchObject({
      round: 1, teamA: ["hist_2019_jensen"], teamB: ["hist_2019_kj"],
      teamANames: ["Jensen"], teamBNames: ["KJ"],
    });
  });

  it("takes the borrowed ball's card from the edition, not the fact layer", () => {
    const withGhost = edition({
      players: [...edition().players, { id: "ghost", name: "Ghost", team: "B", index: 0 }],
      extra_holes: holes("ghost", 6).map(({ round: r, player, hole, gross }) => ({ round: r, player, hole, gross })),
    });
    const b = buildEdition(withGhost, holes("jensen"), { handicapModeFor: () => "low_man" });
    expect(b.bc_hole_scores.filter((h) => h.player_id === "hist_2019_ghost")).toHaveLength(18);
  });

  it("drops a score whose player is not on the roster", () => {
    const b = buildEdition(edition(), [...holes("jensen"), ...holes("nobody")], { handicapModeFor: () => "low_man" });
    expect(b.bc_hole_scores.every((h) => h.player_id === "hist_2019_jensen")).toBe(true);
  });

  it("takes a calibrated contribution count over the sheet's own", () => {
    const tbb = edition({
      rounds: [round({ format: "team_best_ball", source_format: "team_best_ball", counting_scores: { front: 4, back: 4 } })],
    });
    const b = buildEdition(tbb, [], { handicapModeFor: () => "full", counting: { 1: { front: 5, back: 6 } } });
    expect(b.bc_rounds[0].counting_scores).toEqual({ front: 5, back: 6 });
    expect(b.bc_round_locks[0].counting_scores).toEqual({ front: 5, back: 6 });
  });

  it("gives a roster row no account, and says so explicitly", () => {
    expect(playerDocFor({ year: 2019, id: "jensen", name: "Jensen", team: "A", index: 7.2 }).auth_uid).toBe(null);
  });

  it("keeps the edition id off the year's own arithmetic", () => {
    expect(editionIdForYear(2016)).toBe("bc_2016");
    expect(built.bc_players.every((p) => p.tournament_id === "bc_2019")).toBe(true);
  });
});

describe("matchDocFor", () => {
  it("builds an id from both sides, so two matches in a round can't collide", () => {
    const a = matchDocFor({ year: 2019, match: { round: 2, teamA: ["jensen"], teamB: ["kj"] }, nameOf: (x) => x });
    const b = matchDocFor({ year: 2019, match: { round: 2, teamA: ["jensen"], teamB: ["telly"] }, nameOf: (x) => x });
    expect(a.id).not.toBe(b.id);
  });
});
