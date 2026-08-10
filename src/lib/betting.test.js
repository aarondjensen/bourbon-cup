import { describe, it, expect } from "vitest";
import { inField, computeSkins, lowNetRows, ctpTags, settle } from "./betting";

const course = {
  id: "c1",
  hole_pars: [3, 4, 4, 4, 5, 4, 3, 4, 4, 4, 4, 5, 4, 3, 4, 4, 4, 4],
  hole_handicaps: Array.from({ length: 18 }, (_, h) => h + 1),
  tee_boxes: [{ name: "Blue", slope: 113, rating: 72, par: 72 }],
};
const players = [
  { player_id: "p1", name: "One", team: "A", handicap_index: 0 },
  { player_id: "p2", name: "Two", team: "A", handicap_index: 0 },
  { player_id: "p3", name: "Three", team: "B", handicap_index: 0 },
  { player_id: "p4", name: "Four", team: "B", handicap_index: 0 },
];
const tRounds = [{ round_number: 1, format: "singles", course_id: "c1", tee_box: "Blue" }];
const ctx = { tPlayers: players, tRounds, courses: [course], roundLocks: {}, hcpOverrides: {}, teeAssignments: {} };
const pars = course.hole_pars;
const card = (v) => Object.fromEntries(Array.from({ length: 18 }, (_, h) => [h, v]));

describe("inField", () => {
  // Null means the director never tagged anybody, and that means everybody.
  it("treats a null list as the whole roster", () => {
    expect(inField(players, null)).toHaveLength(4);
  });
  // An empty array is a different answer, and the two must not be collapsed.
  it("treats an empty list as nobody", () => {
    expect(inField(players, [])).toHaveLength(0);
  });
  it("filters to the named players", () => {
    expect(inField(players, ["p1", "p3"]).map(p => p.player_id)).toEqual(["p1", "p3"]);
  });
});

describe("computeSkins", () => {
  const field = players;
  const skins = (holeData) => computeSkins({ round: 1, gross: true, field, holeData, pars, maps: null });

  it("gives the hole to the outright lowest", () => {
    const s = skins({ p1_1: card(4), p2_1: card(5), p3_1: card(5), p4_1: card(5) });
    expect(s[0].winner.pid).toBe("p1");
    expect(s.filter(h => h.winner)).toHaveLength(18);
  });

  // A tie carries — which is why the pot divides by skins WON, not by holes.
  it("pushes a tied hole to nobody", () => {
    const s = skins({ p1_1: card(4), p2_1: card(4), p3_1: card(5), p4_1: card(5) });
    expect(s[0].winner).toBe(null);
    expect(s[0].tied).toBe(true);
  });

  // One card on a hole is not a contest.
  it("does not award a hole only one player has posted", () => {
    const s = skins({ p1_1: card(3) });
    expect(s[0].winner).toBe(null);
    expect(s[0].tied).toBe(false);
  });

  it("takes strokes off in net mode", () => {
    const maps = { p3: Object.fromEntries(Array.from({ length: 18 }, (_, h) => [h, 1])) };
    const holeData = { p1_1: card(4), p2_1: card(5), p3_1: card(5), p4_1: card(5) };
    const net = computeSkins({ round: 1, gross: false, field, holeData, pars, maps });
    // p3 gets a stroke a hole, so their 5 nets 4 and ties p1's — nobody wins.
    expect(net[0].winner).toBe(null);
    expect(net[0].tied).toBe(true);
  });
});

describe("lowNetRows", () => {
  it("ranks finished cards by net and marks the winner", () => {
    const rows = lowNetRows({
      round: 1, field: players, holeData: { p1_1: card(4), p2_1: card(5) }, ...ctx,
    });
    expect(rows[0].pid).toBe("p1");
    expect(rows[0].won).toBe(true);
    expect(rows[1].won).toBe(false);
  });

  // A player through fourteen is unfinished, not leading.
  it("will not rank an unfinished card", () => {
    const partial = Object.fromEntries(Array.from({ length: 9 }, (_, h) => [h, 2]));
    const rows = lowNetRows({
      round: 1, field: players, holeData: { p1_1: card(5), p2_1: partial }, ...ctx,
    });
    expect(rows[0].pid).toBe("p1");     // the complete card leads
    expect(rows.find(r => r.pid === "p2").won).toBe(false);
  });

  // Low net has nowhere to carry to, so equal lowest cards are co-winners.
  it("makes equal lowest cards co-winners", () => {
    const rows = lowNetRows({
      round: 1, field: players, holeData: { p1_1: card(4), p2_1: card(4) }, ...ctx,
    });
    expect(rows.filter(r => r.won)).toHaveLength(2);
  });
});

describe("ctpTags", () => {
  // Holes 0, 6 and 13 are the par 3s on this course.
  const ctpData = { "1_0": { player_id: "p1" }, "1_6": { player_id: "p2" }, "1_1": { player_id: "p3" } };

  it("counts a tag on a par 3", () => {
    const t = ctpTags({ rounds: [1], field: players, ctpData, ...ctx });
    expect(t.map(x => x.hole).sort((a, b) => a - b)).toEqual([0, 6]);
  });

  // A record left on a hole that is no longer a par 3 must not keep counting.
  it("ignores a tag on a hole that is not a par 3", () => {
    const t = ctpTags({ rounds: [1], field: players, ctpData, ...ctx });
    expect(t.some(x => x.hole === 1)).toBe(false);
  });

  it("ignores a tag naming somebody not in the game", () => {
    const t = ctpTags({ rounds: [1], field: inField(players, ["p2"]), ctpData, ...ctx });
    expect(t).toHaveLength(1);
    expect(t[0].player_id).toBe("p2");
  });
});

describe("settle", () => {
  // p1 wins every hole outright — all 18 skins.
  const holeData = { p1_1: card(3), p2_1: card(5), p3_1: card(5), p4_1: card(5) };
  const base = {
    players, rounds: [1], holeData, ctpData: {}, buyIns: {}, skinsPot: 0, grossSkins: true, ...ctx,
  };

  it("pays the whole pot out across the skins won", () => {
    const s = settle({ ...base, buyIns: { skinsAmount: 10, skinsIn: null } });
    expect(s.pots.skins).toBe(40);                    // 4 players x $10
    expect(s.totalSkins).toBe(18);
    const p1 = s.rows.find(r => r.pid === "p1");
    expect(p1.won.skins).toBeCloseTo(40, 10);         // every skin
    expect(p1.net).toBeCloseTo(30, 10);               // won 40, staked 10
  });

  it("leaves the losers down exactly their stake", () => {
    const s = settle({ ...base, buyIns: { skinsAmount: 10, skinsIn: null } });
    expect(s.rows.find(r => r.pid === "p2").net).toBeCloseTo(-10, 10);
  });

  // The table has to balance, or somebody is paying for a pot that does not
  // exist. Exact money is carried through and only rounded where it prints.
  it("balances to zero across the field", () => {
    const s = settle({
      ...base,
      ctpData: { "1_0": { player_id: "p2" }, "1_6": { player_id: "p3" } },
      buyIns: { skinsAmount: 10, skinsIn: null, ctpAmount: 5, ctpIn: null, lowNetAmount: 20, lowNetIn: null },
    });
    const sum = s.rows.reduce((a, r) => a + r.net, 0);
    expect(sum).toBeCloseTo(0, 10);
  });

  it("splits a low net round between co-winners", () => {
    const level = { p1_1: card(4), p2_1: card(4), p3_1: card(5), p4_1: card(5) };
    const s = settle({ ...base, holeData: level, buyIns: { lowNetAmount: 10, lowNetIn: null } });
    expect(s.pots.lowNet).toBe(40);
    expect(s.rows.find(r => r.pid === "p1").won.lowNet).toBeCloseTo(20, 10);
    expect(s.rows.find(r => r.pid === "p2").won.lowNet).toBeCloseTo(20, 10);
  });

  it("only charges a player for the games they are in", () => {
    const s = settle({
      ...base,
      buyIns: { skinsAmount: 10, skinsIn: ["p1", "p2"], lowNetAmount: 20, lowNetIn: ["p1"] },
    });
    expect(s.rows.find(r => r.pid === "p1").paid).toBe(30);
    expect(s.rows.find(r => r.pid === "p2").paid).toBe(10);
    expect(s.rows.find(r => r.pid === "p3").paid).toBe(0);
  });

  // An untagged buy-in list means everybody, so a tournament that priced only
  // skins still has the whole roster "in" CTP and low net at nought a head.
  // The settlement is about money, so it lists money.
  it("leaves out a player with no stake and no winnings", () => {
    const s = settle({ ...base, buyIns: { skinsAmount: 10, skinsIn: ["p1", "p2"] } });
    expect(s.rows.find(r => r.pid === "p3").playing).toBe(false);
    expect(s.rows.find(r => r.pid === "p1").playing).toBe(true);
    expect(s.rows.find(r => r.pid === "p2").playing).toBe(true);
  });

  // A typed pot records no stake for anybody, so a net cannot be computed.
  it("flags a typed skins pot as unstaked", () => {
    const s = settle({ ...base, skinsPot: 100 });
    expect(s.pots.skins).toBe(100);
    expect(s.staked).toBe(false);
    expect(s.rows.find(r => r.pid === "p1").paid).toBe(0);
  });

  it("counts a priced pot as staked", () => {
    expect(settle({ ...base, buyIns: { skinsAmount: 10, skinsIn: null } }).staked).toBe(true);
  });

  // No pot at all is not an unstaked pot — there is simply nothing to settle.
  it("counts an empty tournament as staked", () => {
    expect(settle(base).staked).toBe(true);
  });

  it("sorts the field up-first", () => {
    const s = settle({ ...base, buyIns: { skinsAmount: 10, skinsIn: null } });
    expect(s.rows[0].pid).toBe("p1");
    expect(s.rows[s.rows.length - 1].net).toBeLessThan(0);
  });
});
