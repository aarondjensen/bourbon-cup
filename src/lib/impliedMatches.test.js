// The match Team Best Ball leaves nothing to decide about. What is pinned here
// is the part that would fail SILENTLY: a derived match that misses a man, or
// one that overwrites a draw a director made by hand.
import { describe, it, expect } from "vitest";
import {
  formatTeamVsTeam, impliedMatchForRound, withImpliedMatches, isImpliedMatch,
  impliedMatchId,
} from "./impliedMatches";

const roster = [
  { player_id: "a2", name: "Pete C", team: "A" },
  { player_id: "a1", name: "Aaron J", team: "A" },
  { player_id: "b1", name: "Dave R", team: "B" },
  { player_id: "b2", name: "Mike L", team: "B" },
];
const r4 = { round_number: 4, format: "team_best_ball" };
const r1 = { round_number: 1, format: "best_ball" };

describe("formatTeamVsTeam", () => {
  it("is Team Best Ball and nothing else", () => {
    expect(formatTeamVsTeam("team_best_ball")).toBe(true);
    expect(formatTeamVsTeam("best_ball")).toBe(false);
    expect(formatTeamVsTeam("singles")).toBe(false);
    expect(formatTeamVsTeam(undefined)).toBe(false);
  });
});

describe("impliedMatchForRound", () => {
  it("puts the whole of each side in it", () => {
    const m = impliedMatchForRound({ tr: r4, tPlayers: roster });
    expect(m.teamA).toEqual(["a1", "a2"]);
    expect(m.teamB).toEqual(["b1", "b2"]);
    expect(m.round).toBe(4);
    expect(isImpliedMatch(m)).toBe(true);
  });

  // Two phones handed the roster in different orders must draw the same tee
  // sheet, and Auto-build splits a side in exactly this order.
  it("orders each side the same way whatever order the roster arrives in", () => {
    const shuffled = [...roster].reverse();
    expect(impliedMatchForRound({ tr: r4, tPlayers: shuffled }).teamA).toEqual(["a1", "a2"]);
  });

  it("gives the same id whoever is on the roster", () => {
    const a = impliedMatchForRound({ tr: r4, tPlayers: roster });
    const b = impliedMatchForRound({ tr: r4, tPlayers: [...roster, { player_id: "a3", team: "A" }] });
    expect(a.id).toBe(b.id);
    expect(a.id).toBe(impliedMatchId(4));
  });

  // The round the cup is decided in has to hold everybody who is on the
  // roster — a man added late is in it, with nothing to press.
  it("picks up a player added after the round existed", () => {
    const grown = [...roster, { player_id: "a3", name: "Andy H", team: "A" }];
    expect(impliedMatchForRound({ tr: r4, tPlayers: grown }).teamA).toEqual(["a1", "a2", "a3"]);
  });

  // 2020 played a side short against a compiled card. It is not a person and
  // no roster screen shows it, but Team Best Ball counts the best N nets on a
  // side — leave it out and the round is seven against eight.
  it("keeps the borrowed ball on its side", () => {
    const short = [...roster, { player_id: "bb", name: "Borrowed", team: "B", borrowed: true }];
    expect(impliedMatchForRound({ tr: r4, tPlayers: short }).teamB).toContain("bb");
  });

  it("implies nothing for a format that builds its own matches", () => {
    expect(impliedMatchForRound({ tr: r1, tPlayers: roster })).toBeNull();
  });

  it("implies nothing without a round", () => {
    expect(impliedMatchForRound({ tr: null, tPlayers: roster })).toBeNull();
  });

  // A match against nobody is not a match. An edition whose roster has not
  // been entered shows an empty round instead.
  it("implies nothing when a side is empty", () => {
    const oneSided = roster.filter(p => p.team === "A");
    expect(impliedMatchForRound({ tr: r4, tPlayers: oneSided })).toBeNull();
    expect(impliedMatchForRound({ tr: r4, tPlayers: [] })).toBeNull();
  });

  it("ignores a roster row with no team or no id", () => {
    const messy = [...roster, { player_id: "x1" }, { team: "A" }];
    const m = impliedMatchForRound({ tr: r4, tPlayers: messy });
    expect(m.teamA).toEqual(["a1", "a2"]);
  });
});

describe("withImpliedMatches", () => {
  it("fills a round that has none", () => {
    const out = withImpliedMatches({ matches: [], tRounds: [r1, r4], tPlayers: roster });
    expect(out).toHaveLength(1);
    expect(out[0].round).toBe(4);
  });

  // The guarantee that keeps an existing tournament working: a round somebody
  // has already drawn is left completely alone.
  it("leaves a round that already has a match alone", () => {
    const drawn = [{ id: "m1", round: 4, teamA: ["a1"], teamB: ["b1"] }];
    const out = withImpliedMatches({ matches: drawn, tRounds: [r4], tPlayers: roster });
    expect(out).toEqual(drawn);
    expect(out.some(isImpliedMatch)).toBe(false);
  });

  it("keeps other rounds' matches untouched", () => {
    const drawn = [{ id: "m1", round: 1, teamA: ["a1", "a2"], teamB: ["b1", "b2"] }];
    const out = withImpliedMatches({ matches: drawn, tRounds: [r1, r4], tPlayers: roster });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(drawn[0]);
    expect(out[1].round).toBe(4);
  });

  it("adds nothing when no round implies one", () => {
    const out = withImpliedMatches({ matches: [], tRounds: [r1], tPlayers: roster });
    expect(out).toEqual([]);
  });

  it("survives empty inputs", () => {
    expect(withImpliedMatches({})).toEqual([]);
    expect(withImpliedMatches({ matches: undefined, tRounds: undefined, tPlayers: undefined })).toEqual([]);
  });

  // Same input, same output — the derivation runs on every render and on every
  // device, so it cannot introduce a new object identity's worth of churn in
  // what it returns for a round that is already drawn.
  it("returns the original array when there is nothing to add", () => {
    const drawn = [{ id: "m1", round: 4, teamA: ["a1"], teamB: ["b1"] }];
    expect(withImpliedMatches({ matches: drawn, tRounds: [r4], tPlayers: roster })).toBe(drawn);
  });
});
