// The two things that can be silently wrong about folding the running year
// into ten finished ones: who somebody IS across years, and whether the year
// on screen gets counted twice.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { canonicalId, liveFacts, mergeLive } from "./archiveLive.js";
import { aliasIndex, foldArchive } from "./archiveFold.js";

const read = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}`, import.meta.url), "utf8"));
const archive = read("bourbon-cup-archive.json");
const index = aliasIndex(archive.players);

describe("who a roster row is", () => {
  it("reads the canonical id straight out of an imported id", () => {
    expect(canonicalId({ player_id: "hist_2019_paulw" }, index)).toBe("paulw");
  });

  it("matches a hand-entered row by the name the app stores", () => {
    // 2025 was typed into the app, so its ids carry nothing — `bc_player_<ms>`
    // is a timestamp. The display name is the only handle it has.
    expect(canonicalId({ player_id: "bc_player_1712345678", name: "Paul W" }, index)).toBe("paulw");
    expect(canonicalId({ player_id: "bc_player_1712345679", name: "Aaron J" }, index)).toBe("jensen");
  });

  it("matches on first and last name when the display name was edited", () => {
    expect(canonicalId({ player_id: "x", name: "", first_name: "Dave", last_name: "Kelley" }, index)).toBe("dk");
  });

  it("folds a man onto himself across the 2022 handle change", () => {
    // The whole reason pipeline/players.mjs exists: a split identity gives
    // each half a complete, plausible record and nothing downstream notices.
    expect(canonicalId({ player_id: "hist_2021_jimh" }, index))
      .toBe(canonicalId({ player_id: "hist_2023_hile" }, index));
  });

  it("prefers an explicit career_id over everything else", () => {
    expect(canonicalId({ player_id: "hist_2019_paulw", career_id: "timc" }, index)).toBe("timc");
  });

  it("gives a golfer nobody has ever seen a career of his own", () => {
    const id = canonicalId({ player_id: "bc_player_999", name: "Brand N" }, index);
    expect(id).toBe("live:bc_player_999");
    expect(archive.players.some((p) => p.id === id)).toBe(false);
  });
});

// A minimal running edition: two rounds, one four-ball, two complete cards.
const tRounds = [
  { round_number: 1, format: "best_ball", course_id: "c1", scoring_type: "match", nassau_front: 1, nassau_back: 1, nassau_overall: 1 },
];
const courses = [{
  id: "c1", name: "Somewhere New", par: 72,
  hole_pars: [4, 4, 4, 3, 4, 4, 5, 3, 5, 4, 3, 5, 4, 5, 4, 4, 3, 4],
  hole_handicaps: [13, 7, 9, 17, 15, 5, 3, 11, 1, 18, 14, 2, 6, 4, 12, 8, 16, 10],
}];
const tPlayers = [
  { player_id: "p1", name: "Paul W", team: "A", handicap_index: 12 },
  { player_id: "p2", name: "Tim C", team: "A", handicap_index: 12 },
  { player_id: "p3", name: "Andy H", team: "B", handicap_index: 8 },
  { player_id: "p4", name: "Kevin J", team: "B", handicap_index: 17 },
];
const card = (n) => Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i, n]));
const live = () => liveFacts({
  year: 2099,
  tPlayers,
  matches: [{ id: "m1", round: 1, teamA: ["p1", "p2"], teamB: ["p3", "p4"] }],
  holeData: { p1_1: card(4), p2_1: card(5), p3_1: card(5), p4_1: card(6) },
  tRounds, courses, roundLocks: {}, teamNames: { A: "REDS", B: "BLUES" },
  players: archive.players,
});

describe("the running year, as rows", () => {
  it("names its players the way the archive does", () => {
    const f = live();
    expect(f.matches[0].A).toEqual(["paulw", "timc"]);
    expect(f.matches[0].B).toEqual(["andy", "kj"]);
    expect(f.edition.roster.map((r) => r.p).sort()).toEqual(["andy", "kj", "paulw", "timc"]);
  });

  it("is not complete until the rounds are signed off", () => {
    expect(live().edition.complete).toBe(false);
  });

  it("scores its cards against the scorecard's own par", () => {
    const f = live();
    const mine = f.cards.find((c) => c.p === "paulw");
    expect(mine.g).toBe(72);
    expect(mine.tp).toBe(0);
    // 72 round on a par-72 card that has four par 3s and three par 5s.
    expect(mine.e + mine.b + mine.pr + mine.bo + mine.d).toBe(18);
  });

  it("leaves an unfinished round off the record entirely", () => {
    const partial = liveFacts({
      year: 2099, tPlayers,
      matches: [{ id: "m1", round: 1, teamA: ["p1", "p2"], teamB: ["p3", "p4"] }],
      holeData: { p1_1: { 0: 4, 1: 4, 2: 4 } },
      tRounds, courses, roundLocks: {}, players: archive.players,
    });
    expect(partial.cards).toEqual([]);
  });
});

describe("the running year replaces the archive's copy of itself", () => {
  const yearInArchive = archive.years[archive.years.length - 1];

  it("drops the archived rows for the year that is open", () => {
    const stand = liveFacts({
      year: yearInArchive, tPlayers,
      matches: [{ id: "m1", round: 1, teamA: ["p1", "p2"], teamB: ["p3", "p4"] }],
      holeData: {}, tRounds, courses, roundLocks: {}, players: archive.players,
    });
    const merged = mergeLive(archive, stand);
    expect(merged.editions.filter((e) => e.year === yearInArchive)).toHaveLength(1);
    expect(merged.cards.filter((c) => c.year === yearInArchive)).toEqual([]);
    expect(merged.matches.filter((m) => m.year === yearInArchive)).toHaveLength(1);
  });

  it("does not double a man's career when his year is the one on screen", () => {
    const before = foldArchive(archive).careerOf("andy");
    const merged = mergeLive(archive, live());        // a year the archive has never seen
    const after = foldArchive(merged).careerOf("andy");
    expect(after.apps).toBe(before.apps + 1);
    expect(after.matches).toBe(before.matches + 1);
  });

  it("leaves the archive alone when there is no live year", () => {
    expect(mergeLive(archive, null)).toBe(archive);
  });

  it("does not let a half-loaded edition blank a year that is over", () => {
    // The app's subscriptions arrive over several frames. For the first of
    // them the running edition looks like a tournament nobody played, and
    // replacing a finished year with that would empty a decade of records on
    // screen and then fill them back in.
    const empty = liveFacts({
      year: yearInArchive, tPlayers: [], matches: [], holeData: {},
      tRounds: [], courses: [], roundLocks: {}, players: archive.players,
    });
    expect(mergeLive(archive, empty)).toBe(archive);
  });

  it("still adds a brand new edition that has nothing in it yet", () => {
    const draft = liveFacts({
      year: 2099, tPlayers: [], matches: [], holeData: {},
      tRounds: [], courses: [], roundLocks: {}, players: archive.players,
    });
    const merged = mergeLive(archive, draft);
    expect(merged.editions.some((e) => e.year === 2099)).toBe(true);
  });
});
