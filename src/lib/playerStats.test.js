import { describe, it, expect } from "vitest";
import { matchRecord, scoringRecord, playerTable } from "./playerStats";

const course = {
  id: "c1",
  hole_pars: Array(18).fill(4),          // par 72
  hole_handicaps: Array.from({ length: 18 }, (_, h) => h + 1),
  tee_boxes: [{ name: "Blue", slope: 113, rating: 72, par: 72 }],
};
const tPlayers = [
  { player_id: "a1", name: "A One", team: "A", handicap_index: 0 },
  { player_id: "a2", name: "A Two", team: "A", handicap_index: 0 },
  { player_id: "b1", name: "B One", team: "B", handicap_index: 0 },
  { player_id: "b2", name: "B Two", team: "B", handicap_index: 0 },
];
const card = (v, holes = 18) =>
  Object.fromEntries(Array.from({ length: holes }, (_, h) => [h, v]));
const tRounds = [
  { round_number: 1, format: "singles", course_id: "c1", tee_box: "Blue" },
  { round_number: 2, format: "singles", course_id: "c1", tee_box: "Blue" },
];
const base = { tPlayers, courses: [course], tRounds, roundLocks: {} };

describe("matchRecord", () => {
  // A won every hole of round 1, so it takes front, back and overall.
  const holeData = { a1_1: card(4), b1_1: card(5) };
  const matches = [{
    id: "m1", round: 1, teamA: ["a1"], teamB: ["b1"],
    nassau: { front: 1, back: 1, overall: 1 },
  }];

  it("credits points to the side that earned them", () => {
    const r = matchRecord({ ...base, matches, holeData });
    expect(r.a1.pts).toBe(3);
    expect(r.b1.pts).toBe(0);
  });

  it("counts the win and the loss", () => {
    const r = matchRecord({ ...base, matches, holeData });
    expect(r.a1).toMatchObject({ wins: 1, losses: 0, halves: 0, matches: 1 });
    expect(r.b1).toMatchObject({ wins: 0, losses: 1, halves: 0, matches: 1 });
  });

  // A four-ball is won by two people together and both of them won it.
  it("credits every player on the side, not a share", () => {
    const fourBall = [{
      id: "m2", round: 1, teamA: ["a1", "a2"], teamB: ["b1", "b2"],
      nassau: { front: 1, back: 1, overall: 2 },
    }];
    const hd = { a1_1: card(4), a2_1: card(4), b1_1: card(5), b2_1: card(5) };
    const r = matchRecord({ ...base, matches: fourBall, holeData: hd });
    expect(r.a1.pts).toBe(4);
    expect(r.a2.pts).toBe(4);   // not 2 each
    expect(r.a2.wins).toBe(1);
  });

  it("counts a halved match as a half for both", () => {
    const hd = { a1_1: card(4), b1_1: card(4) };
    const r = matchRecord({ ...base, matches, holeData: hd });
    expect(r.a1).toMatchObject({ wins: 0, losses: 0, halves: 1 });
    expect(r.b1).toMatchObject({ wins: 0, losses: 0, halves: 1 });
  });
});

describe("scoringRecord", () => {
  it("counts holes and totals against par", () => {
    const r = scoringRecord({ ...base, holeData: { a1_1: card(5) } });
    expect(r.a1.holes).toBe(18);
    expect(r.a1.toPar).toBe(18);        // 90 against a par of 72
  });

  it("averages over complete rounds", () => {
    const r = scoringRecord({ ...base, holeData: { a1_1: card(5), a1_2: card(3) } });
    expect(r.a1.rounds).toBe(2);
    expect(r.a1.avgToPar).toBe(0);      // +18 and -18
  });

  // A player through fourteen is not having a good week, they are unfinished.
  it("does not average a partial round", () => {
    const r = scoringRecord({ ...base, holeData: { a1_1: card(5), a1_2: card(3, 9) } });
    expect(r.a1.rounds).toBe(1);
    expect(r.a1.avgToPar).toBe(18);     // only the complete round
    expect(r.a1.holes).toBe(27);        // but every posted hole counts
  });

  it("has no average at all for a player who has not teed off", () => {
    const r = scoringRecord({ ...base, holeData: {} });
    expect(r.a1.avgToPar).toBe(null);
    expect(r.a1.rounds).toBe(0);
    expect(r.a1.best).toBe(null);
  });

  it("finds the best complete round and names it", () => {
    const r = scoringRecord({ ...base, holeData: { a1_1: card(5), a1_2: card(4) } });
    expect(r.a1.best).toEqual({ round: 2, gross: 72, toPar: 0 });
  });

  it("will not call a partial round the best one", () => {
    // Nine holes of 3s is 27 shots — lower than any full round, and not a round.
    const r = scoringRecord({ ...base, holeData: { a1_1: card(4), a1_2: card(3, 9) } });
    expect(r.a1.best.round).toBe(1);
    expect(r.a1.best.gross).toBe(72);
  });

  // A locked round froze its course, so the pars come from the snapshot.
  it("scores against the frozen par table when a round is locked", () => {
    const r = scoringRecord({
      ...base,
      holeData: { a1_1: card(4) },
      roundLocks: { 1: { locked: true, course_id: "c1", hole_pars: Array(18).fill(3) } },
    });
    expect(r.a1.toPar).toBe(18);   // 72 against a frozen par of 54
  });
});

describe("playerTable", () => {
  const holeData = { a1_1: card(4), b1_1: card(5), a2_1: card(6) };
  const matches = [{
    id: "m1", round: 1, teamA: ["a1"], teamB: ["b1"],
    nassau: { front: 1, back: 1, overall: 1 },
  }];

  it("joins both halves onto one row per player", () => {
    const rows = playerTable({ ...base, matches, holeData });
    const a1 = rows.find(r => r.pid === "a1");
    expect(a1).toMatchObject({ name: "A One", team: "A", wins: 1, pts: 3, rounds: 1, toPar: 0 });
  });

  it("ranks by points", () => {
    const rows = playerTable({ ...base, matches, holeData });
    expect(rows[0].pid).toBe("a1");
  });

  // Somebody who has not played must not share the top with everyone on nought.
  it("sinks a player with no card below one who has played", () => {
    const rows = playerTable({ ...base, matches: [], holeData });
    const order = rows.map(r => r.pid);
    expect(order.indexOf("a1")).toBeLessThan(order.indexOf("b2"));
    expect(rows.find(r => r.pid === "b2").avgToPar).toBe(null);
  });
});
