import { describe, it, expect } from "vitest";
import { inField, computeSkins, lowNetRows, ctpTags, ctpPinTotal, moneyHole, moneyHoleRows, moneyHoleWins, moneyHolePars, DEFAULT_MONEY_HOLE } from "./betting";

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

describe("ctpPinTotal", () => {
  // c1 has three par 3s: holes 0, 6 and 13.
  const two = { ...course, id: "c2", hole_pars: [3, 4, 4, 4, 5, 4, 4, 4, 4, 4, 4, 5, 4, 3, 4, 4, 4, 4] };

  it("counts every par 3 on the schedule, played or not", () => {
    const r = ctpPinTotal({ rounds: [1], tRounds, courses: [course], roundLocks: {} });
    expect(r.pins).toBe(3);
    expect(r.partial).toBe(false);
  });

  it("adds the rounds together", () => {
    const rs = [
      { round_number: 1, course_id: "c1" },
      { round_number: 2, course_id: "c2" },
    ];
    const r = ctpPinTotal({ rounds: [1, 2], tRounds: rs, courses: [course, two], roundLocks: {} });
    expect(r.pins).toBe(5);           // 3 + 2
    expect(r.scheduled).toBe(2);
    expect(r.partial).toBe(false);
  });

  // resolveHolePars falls back to eighteen par 4s with no course, which would
  // read as a real "no par 3s here" — it has to say the count is unfinished
  // instead, because the pot's per-pin share will fall when the course lands.
  it("does not count a round with no course, and says the total is partial", () => {
    const rs = [{ round_number: 1, course_id: "c1" }, { round_number: 2 }];
    const r = ctpPinTotal({ rounds: [1, 2], tRounds: rs, courses: [course], roundLocks: {} });
    expect(r.pins).toBe(3);
    expect(r.scheduled).toBe(1);
    expect(r.rounds).toBe(2);
    expect(r.partial).toBe(true);
  });

  // A locked round froze its course. Reading the live round doc instead would
  // re-count the pins of a settled round if the director re-pointed it after.
  it("reads a locked round through its lock", () => {
    const rs = [{ round_number: 1, course_id: "c2" }];
    const locks = { 1: { locked: true, course_id: "c1", hole_pars: course.hole_pars } };
    const r = ctpPinTotal({ rounds: [1], tRounds: rs, courses: [course, two], roundLocks: locks });
    expect(r.pins).toBe(3);
  });

  it("is zero on an empty schedule", () => {
    expect(ctpPinTotal({ rounds: [], tRounds, courses: [course], roundLocks: {} }).pins).toBe(0);
    expect(ctpPinTotal({ rounds: null, tRounds, courses: [course], roundLocks: {} }).pins).toBe(0);
  });
});


// ── The money hole ──────────────────────────────────────────────────────
// One designated hole a round. Lowest net takes it and a TIE SPLITS, which is
// the one thing that separates it from a skin on the same hole.
describe("moneyHole", () => {
  it("defaults anything unusable to the designated 18th", () => {
    [undefined, null, "", 0, 19, -3, NaN, "nope"].forEach(v =>
      expect(moneyHole(v)).toBe(DEFAULT_MONEY_HOLE));
  });
  it("keeps a hole that is on the card", () => {
    expect(moneyHole(1)).toBe(1);
    expect(moneyHole(9)).toBe(9);
    expect(moneyHole("12")).toBe(12);
  });
});

describe("moneyHoleRows", () => {
  const one = (scores) => Object.fromEntries(
    Object.entries(scores).map(([pid, v]) => [`${pid}_1`, { 17: v }]));

  it("gives the hole to the outright lowest net", () => {
    const rows = moneyHoleRows({ round: 1, hole: 18, field: players, holeData: one({ p1: 3, p2: 4, p3: 5, p4: 4 }) });
    expect(rows[0].pid).toBe("p1");
    expect(rows.filter(r => r.won).map(r => r.pid)).toEqual(["p1"]);
  });

  // The whole point of the game: a tie does not push, it splits.
  it("makes equal-lowest cards co-winners rather than pushing", () => {
    const rows = moneyHoleRows({ round: 1, hole: 18, field: players, holeData: one({ p1: 3, p2: 4, p3: 3, p4: 4 }) });
    expect(rows.filter(r => r.won).map(r => r.pid).sort()).toEqual(["p1", "p3"]);
  });

  // A shot on the hole is a shot in this game — same stroke maps as net skins.
  it("takes the hole's stroke off before comparing", () => {
    const maps = { p3: { 17: 1 } };
    const rows = moneyHoleRows({ round: 1, hole: 18, field: players, holeData: one({ p1: 3, p2: 4, p3: 4, p4: 4 }), maps });
    expect(rows.filter(r => r.won).map(r => r.pid).sort()).toEqual(["p1", "p3"]);
    expect(rows.find(r => r.pid === "p3").gross).toBe(4);
    expect(rows.find(r => r.pid === "p3").net).toBe(3);
  });

  // Somebody still out on the course is not losing the hole, he has not played
  // it — so he ranks below the cards that are in and prints no number.
  it("ranks a player with no score below everybody who has one, and never wins", () => {
    const rows = moneyHoleRows({ round: 1, hole: 18, field: players, holeData: one({ p1: 5, p2: 4 }) });
    // Cards in first, best net on top; the two who have not played it fall in
    // behind them by name ("Four" before "Three").
    expect(rows.map(r => r.pid)).toEqual(["p2", "p1", "p4", "p3"]);
    expect(rows[2].posted).toBe(false);
    expect(rows[2].net).toBe(null);
    expect(rows.filter(r => r.won).map(r => r.pid)).toEqual(["p2"]);
  });

  it("has no winner on a hole nobody has posted", () => {
    const rows = moneyHoleRows({ round: 1, hole: 18, field: players, holeData: {} });
    expect(rows.filter(r => r.won)).toHaveLength(0);
  });

  // Which hole is a stored choice, so the rows have to read the one named.
  it("scores the hole it is given, not the eighteenth", () => {
    const rows = moneyHoleRows({ round: 1, hole: 9, field: players, holeData: { p1_1: { 8: 3 }, p2_1: { 8: 4, 17: 2 } } });
    expect(rows.filter(r => r.won).map(r => r.pid)).toEqual(["p1"]);
  });
});

describe("moneyHoleWins", () => {
  const hd = {
    p1_1: { 17: 3 }, p2_1: { 17: 4 }, p3_1: { 17: 3 }, p4_1: { 17: 5 },
    p1_2: { 17: 5 }, p2_2: { 17: 4 }, p3_2: { 17: 5 }, p4_2: { 17: 5 },
  };
  const wins = moneyHoleWins({ rounds: [1, 2], hole: 18, field: players, holeData: hd, pot: 160 });

  // $160 over two rounds is $80 a hole; a tied hole splits ITS share rather
  // than paying twice, so no round can be worth more than a clean one.
  it("divides the pot by the rounds and splits a tied round's share", () => {
    expect(wins.filter(w => w.round === 1).map(w => w.share)).toEqual([40, 40]);
    expect(wins.filter(w => w.round === 2)).toEqual([expect.objectContaining({ pid: "p2", share: 80 })]);
    expect(wins.reduce((a, w) => a + w.share, 0)).toBe(160);
  });

  // The user's own worked example: an $80 pot on one hole, two men on net 3.
  it("pays two tied men $40 each out of an $80 pot on a single round", () => {
    const w = moneyHoleWins({ rounds: [1], hole: 18, field: players, holeData: hd, pot: 80 });
    expect(w.map(x => x.share)).toEqual([40, 40]);
  });

  it("yields nothing from a round nobody has posted", () => {
    expect(moneyHoleWins({ rounds: [1], hole: 18, field: players, holeData: {}, pot: 80 })).toHaveLength(0);
  });

  it("is empty with no rounds on the schedule", () => {
    expect(moneyHoleWins({ rounds: [], hole: 18, field: players, holeData: hd, pot: 80 })).toHaveLength(0);
    expect(moneyHoleWins({ rounds: null, hole: 18, field: players, holeData: hd, pot: 80 })).toHaveLength(0);
  });
});

// A par 3 already carries the CTP pot, so the money hole must not land on one
// — and the check is per ROUND, because four rounds are four courses.
describe("moneyHolePars", () => {
  // hole_pars above: the 1st, 7th and 14th are par 3s; c1's 18th is a par 4.
  it("flags the rounds whose designated hole is a par 3", () => {
    const r = moneyHolePars({ rounds: [1], hole: 7, tRounds, courses: [course], roundLocks: {} });
    expect(r.par3.map(x => x.round)).toEqual([1]);
    expect(r.par3[0].par).toBe(3);
  });

  it("says nothing about a hole that is not a par 3", () => {
    const r = moneyHolePars({ rounds: [1], hole: 18, tRounds, courses: [course], roundLocks: {} });
    expect(r.par3).toHaveLength(0);
    expect(r.unknown).toHaveLength(0);
    expect(r.hole).toBe(18);
  });

  // resolveHolePars hands back eighteen par 4s with no course, which would
  // read as a settled "not a par 3" on a question the draw has not answered.
  it("holds a round with no course apart rather than passing it", () => {
    const rs = [{ round_number: 1, course_id: "c1" }, { round_number: 2 }];
    const r = moneyHolePars({ rounds: [1, 2], hole: 7, tRounds: rs, courses: [course], roundLocks: {} });
    expect(r.par3.map(x => x.round)).toEqual([1]);
    expect(r.unknown.map(x => x.round)).toEqual([2]);
  });

  // A locked round froze its course; the warning has to read the same table
  // the scoring does, or it would clear a hole the round is not playing.
  it("reads a locked round through its lock", () => {
    const rs = [{ round_number: 1, course_id: "c2" }];
    // c2's first hole is a par 4; the lock says the round was played on c1,
    // whose first is a par 3.
    const other = { ...course, id: "c2", hole_pars: course.hole_pars.map((p, i) => (i === 0 ? 4 : p)) };
    const locks = { 1: { locked: true, course_id: "c1", hole_pars: course.hole_pars } };
    const r = moneyHolePars({ rounds: [1], hole: 1, tRounds: rs, courses: [course, other], roundLocks: locks });
    expect(r.par3.map(x => x.round)).toEqual([1]);
  });

  it("is empty on an empty schedule", () => {
    const r = moneyHolePars({ rounds: [], hole: 18, tRounds, courses: [course], roundLocks: {} });
    expect(r.perRound).toEqual([]);
    expect(r.par3).toEqual([]);
  });
});
