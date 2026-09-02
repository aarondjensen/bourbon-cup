import { describe, it, expect } from "vitest";
import { roundSummary } from "./roundSummary";

// Hole 1, 7 and 14 are par 3s; hole 18 is the money hole and is a par 4.
const course = {
  id: "c1",
  hole_pars: [3, 4, 4, 4, 5, 4, 3, 4, 4, 4, 4, 5, 4, 3, 4, 4, 4, 4],
  hole_handicaps: Array.from({ length: 18 }, (_, h) => h + 1),
  tee_boxes: [{ name: "Blue", slope: 113, rating: 72, par: 72 }],
  name: "Arthur Hills",
};
const tPlayers = [
  { player_id: "p1", name: "Paul W", team: "A", handicap_index: 0 },
  { player_id: "p2", name: "Jim H", team: "A", handicap_index: 0 },
  { player_id: "p3", name: "Tim C", team: "B", handicap_index: 0 },
  { player_id: "p4", name: "Andy H", team: "B", handicap_index: 0 },
];
const tRounds = [{ round_number: 1, format: "singles", course_id: "c1", tee_box: "Blue" }];
const matches = [
  { id: "m1", round: 1, teamA: ["p1"], teamB: ["p3"] },
  { id: "m2", round: 1, teamA: ["p2"], teamB: ["p4"] },
];
const card = (v) => Object.fromEntries(Array.from({ length: 18 }, (_, h) => [h, v]));

const base = {
  round: 1, matches, tPlayers, tRounds, courses: [course],
  teamNames: { A: "IRONS", B: "DRIVERS" },
  holeData: { p1_1: card(4), p2_1: card(4), p3_1: card(5), p4_1: card(5) },
};

describe("roundSummary", () => {
  it("names the round's course and format", () => {
    const s = roundSummary(base);
    expect(s.courseName).toBe("Arthur Hills");
    expect(s.format).toBe("singles");
  });

  it("scores every match in the round through the engine", () => {
    const s = roundSummary(base);
    expect(s.matches).toHaveLength(2);
    // Team A won every hole in both matches.
    expect(s.matches.every(m => m.winner === "A")).toBe(true);
    expect(s.points.A).toBeGreaterThan(0);
    expect(s.points.B).toBe(0);
    expect(s.points.leader).toBe("A");
  });

  it("carries the team names the year was played under", () => {
    const s = roundSummary(base);
    expect(s.points.teamA).toBe("IRONS");
    expect(s.points.teamB).toBe("DRIVERS");
  });

  it("leaves out matches belonging to another round", () => {
    const s = roundSummary({ ...base, matches: [...matches, { id: "m3", round: 2, teamA: ["p1"], teamB: ["p3"] }] });
    expect(s.matches.map(m => m.id)).toEqual(["m1", "m2"]);
  });

  it("reads the side names off the roster", () => {
    const s = roundSummary(base);
    expect(s.matches[0].a).toEqual(["Paul W"]);
    expect(s.matches[0].b).toEqual(["Tim C"]);
  });

  // ── Side games ────────────────────────────────────────────────────
  it("lists only the holes a skin was actually won on", () => {
    const holeData = {
      p1_1: { ...card(4), 0: 2 },   // outright low on hole 1
      p2_1: card(4), p3_1: card(4), p4_1: card(4),
    };
    const s = roundSummary({ ...base, holeData });
    expect(s.skins.gross).toHaveLength(1);
    expect(s.skins.gross[0]).toMatchObject({ hole: 0, pid: "p1", name: "Paul W", par: 3 });
  });

  // The golf word is off the GROSS, because that is what a birdie is
  // everywhere else in this app.
  it("carries both scores and names the gross result", () => {
    const holeData = {
      p1_1: { ...card(4), 0: 2 },   // a 2 on the par 3 — off scratch, a birdie
      p2_1: card(4), p3_1: card(4), p4_1: card(4),
    };
    const [k] = roundSummary({ ...base, holeData }).skins.net;
    expect(k).toMatchObject({ gross: 2, net: 2, strokes: 0, par: 3, result: "Birdie" });
  });

  it("names the gross result even when a stroke is what won the hole", () => {
    // p1 off a 20 index gets two shots on the stroke-index-1 hole, which is
    // hole 1 here; a gross 4 on that par 3 is a net 2 and takes the skin. The
    // shot he actually hit was a bogey, and that is what the row says.
    const tPlayersHcp = [{ ...tPlayers[0], handicap_index: 20 }, ...tPlayers.slice(1)];
    const holeData = { p1_1: card(9), p2_1: card(5), p3_1: card(5), p4_1: card(5) };
    holeData.p1_1[0] = 4;
    const [k] = roundSummary({ ...base, tPlayers: tPlayersHcp, holeData }).skins.net;
    expect(k).toMatchObject({ gross: 4, net: 2, strokes: 2, par: 3, result: "Bogey" });
    expect(k.gross).toBe(k.net + k.strokes);
  });

  it("uses the app's own ladder for the word", () => {
    // A 2 on the par 5 at hole 5 is an albatross.
    const holeData = {
      p1_1: { ...card(4), 4: 2 },
      p2_1: card(4), p3_1: card(4), p4_1: card(4),
    };
    const k = roundSummary({ ...base, holeData }).skins.net.find(x => x.hole === 4);
    expect(k.result).toBe("Albatross");
  });

  // ── Gross and net are two games on the same holes ─────────────────
  // The whole reason both are drawn: they disagree, and showing one and
  // calling it "skins" answers half the question.
  it("scores gross and net as separate games", () => {
    // p1 off a 20 index gets two shots on hole 1 (stroke index 1). Everyone
    // makes 4 there: gross is a four-way halve and carries, net is p1's by
    // two. On hole 2 (stroke index 15, no shot for anybody) p1's 3 wins both.
    const tPlayersHcp = [{ ...tPlayers[0], handicap_index: 20 }, ...tPlayers.slice(1)];
    const holeData = {
      p1_1: { ...card(9), 0: 4, 1: 3 },
      p2_1: { ...card(9), 0: 4, 1: 4 },
      p3_1: { ...card(9), 0: 4, 1: 4 },
      p4_1: { ...card(9), 0: 4, 1: 4 },
    };
    const s = roundSummary({ ...base, tPlayers: tPlayersHcp, holeData });
    expect(s.skins.gross.map(k => k.hole)).not.toContain(0);   // halved gross
    expect(s.skins.net.map(k => k.hole)).toContain(0);         // won on strokes
    expect(s.skins.gross.map(k => k.hole)).toContain(1);       // won on both
    expect(s.skins.net.map(k => k.hole)).toContain(1);
  });

  it("takes no stroke off a gross skin", () => {
    const tPlayersHcp = [{ ...tPlayers[0], handicap_index: 20 }, ...tPlayers.slice(1)];
    const holeData = {
      p1_1: { ...card(9), 1: 3 },
      p2_1: { ...card(9), 1: 4 }, p3_1: { ...card(9), 1: 4 }, p4_1: { ...card(9), 1: 4 },
    };
    const k = roundSummary({ ...base, tPlayers: tPlayersHcp, holeData }).skins.gross.find(x => x.hole === 1);
    expect(k).toMatchObject({ gross: 3, net: 3, strokes: 0 });
  });

  it("counts no skin on a carried hole", () => {
    const s = roundSummary(base);   // A pair tie every hole
    expect(s.skins.gross).toEqual([]);
    expect(s.skins.net).toEqual([]);
  });

  it("names the pins the round played, in hole order", () => {
    const ctpData = {
      "1_6": { player_id: "p2", distance_ft: 11 },
      "1_0": { player_id: "p1", distance_ft: 4 },
    };
    const s = roundSummary({ ...base, ctpData });
    expect(s.ctp).toEqual([
      { hole: 0, pid: "p1", name: "Paul W", distanceFt: 4 },
      { hole: 6, pid: "p2", name: "Jim H", distanceFt: 11 },
    ]);
  });

  it("ignores a pin on a hole that is not a par 3 in this round", () => {
    const s = roundSummary({ ...base, ctpData: { "1_2": { player_id: "p1", distance_ft: 4 } } });
    expect(s.ctp).toEqual([]);
  });

  it("ignores a pin from another round", () => {
    const s = roundSummary({ ...base, ctpData: { "2_6": { player_id: "p1", distance_ft: 4 } } });
    expect(s.ctp).toEqual([]);
  });

  it("ranks only a finished card for low net, and splits a tie", () => {
    const s = roundSummary(base);
    // p1 and p2 both shot 72 off scratch; p3 and p4 both 90.
    expect(s.lowNet.map(r => r.pid).sort()).toEqual(["p1", "p2"]);
    expect(s.lowNet[0].net).toBe(72);
  });

  it("does not rank an unfinished card", () => {
    const holeData = { ...base.holeData, p1_1: { 0: 2 } };
    const s = roundSummary({ ...base, holeData });
    expect(s.lowNet.map(r => r.pid)).not.toContain("p1");
  });

  it("settles the money hole on the designated hole", () => {
    const holeData = { ...base.holeData, p3_1: { ...card(5), 17: 2 } };
    const s = roundSummary({ ...base, holeData, buyIns: { moneyHoleNumber: 18 } });
    expect(s.moneyHole.hole).toBe(18);
    expect(s.moneyHole.winners.map(w => w.pid)).toEqual(["p3"]);
  });

  it("falls back to hole 18 when no hole was designated", () => {
    expect(roundSummary(base).moneyHole.hole).toBe(18);
  });

  // ── The buy-in fields ─────────────────────────────────────────────
  // Null is the state of a tournament that never opened the panel, and it
  // means everybody. An empty array is a different answer.
  it("treats a null buy-in field as everybody", () => {
    const holeData = { ...base.holeData, p1_1: { ...card(4), 0: 2 } };
    const s = roundSummary({ ...base, holeData, buyIns: { skinsIn: null } });
    expect(s.skins.net).toHaveLength(1);
  });

  it("leaves a man outside the buy-in out of the game he did not enter", () => {
    const holeData = { ...base.holeData, p1_1: { ...card(4), 0: 2 } };
    const s = roundSummary({ ...base, holeData, buyIns: { skinsIn: ["p2", "p3", "p4"] } });
    expect(s.skins.net.some(k => k.pid === "p1")).toBe(false);
    expect(s.skins.gross.some(k => k.pid === "p1")).toBe(false);
  });

  it("scores each game against its OWN field", () => {
    const ctpData = { "1_0": { player_id: "p1", distance_ft: 4 } };
    const s = roundSummary({ ...base, ctpData, buyIns: { skinsIn: [], ctpIn: null } });
    expect(s.skins.gross).toEqual([]);
    expect(s.skins.net).toEqual([]);
    expect(s.ctp).toHaveLength(1);
  });

  // ── The states that are not a result ──────────────────────────────
  it("says a round nobody has scored has not been played", () => {
    expect(roundSummary({ ...base, holeData: {} }).played).toBe(false);
    expect(roundSummary(base).played).toBe(true);
  });

  it("reports whether the director has finalized it", () => {
    expect(roundSummary(base).final).toBe(false);
    const roundLocks = { 1: { locked: true, final: true } };
    expect(roundSummary({ ...base, roundLocks }).final).toBe(true);
  });

  it("returns an empty summary for a round that is not on the schedule", () => {
    const s = roundSummary({ ...base, round: null });
    expect(s.matches).toEqual([]);
    expect(s.ctp).toEqual([]);
    expect(s.played).toBe(false);
  });

  // The engine's own status string appends the leading side's LETTER —
  // "3&2 (A)" — which is what the Leaderboard wants beside two team columns
  // and is opaque on a stacked row here.
  it("gives the golf status without the team letter", () => {
    expect(roundSummary(base).matches[0].status).toMatch(/UP|&|AS/);
    expect(roundSummary(base).matches[0].status).not.toMatch(/\(/);
  });

  // A match whose round has neither a course nor a lock bails out of the
  // engine with a stub carrying no `overall` and no `totalPts`. Reading
  // either off it used to throw, and a round set up before its course is
  // picked is an ordinary state to open this on.
  it("survives a round that has no course yet", () => {
    const s = roundSummary({
      ...base,
      courses: [],
      tRounds: [{ round_number: 1, format: "singles" }],
    });
    expect(s.matches).toHaveLength(2);
    expect(s.matches[0].status).toBe("—");
    expect(s.matches[0].pts).toEqual({ A: 0, B: 0 });
    expect(s.matches[0].winner).toBe(null);
    expect(s.points).toMatchObject({ A: 0, B: 0, leader: null });
  });

  it("survives being called with nothing at all", () => {
    const s = roundSummary();
    expect(s.matches).toEqual([]);
    expect(s.points.A).toBe(0);
  });

  it("every section is present and empty rather than missing", () => {
    const s = roundSummary({ ...base, holeData: {}, matches: [] });
    expect(s.skins).toEqual({ gross: [], net: [] });
    expect(s.ctp).toEqual([]);
    expect(s.lowNet).toEqual([]);
    expect(s.moneyHole.winners).toEqual([]);
    expect(s.matches).toEqual([]);
  });
});
