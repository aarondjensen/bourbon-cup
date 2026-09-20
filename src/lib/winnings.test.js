import { describe, it, expect } from "vitest";
import { winningsBooks, hasPots } from "./winnings";
import { potFor, shareOf } from "./betting";

// One par 3 (the first hole), eighteen holes, stroke index in hole order.
const course = {
  id: "c1",
  hole_pars: [3, 4, 4, 4, 5, 4, 4, 4, 4, 4, 4, 5, 4, 4, 4, 4, 4, 4],
  hole_handicaps: Array.from({ length: 18 }, (_, h) => h + 1),
  tee_boxes: [{ name: "Blue", slope: 113, rating: 72, par: 72 }],
};
const players = [
  { player_id: "p1", name: "One", team: "A", handicap_index: 0 },
  { player_id: "p2", name: "Two", team: "A", handicap_index: 0 },
  { player_id: "p3", name: "Three", team: "B", handicap_index: 0 },
  { player_id: "p4", name: "Four", team: "B", handicap_index: 0 },
];
const tRounds = [
  { round_number: 1, format: "singles", course_id: "c1", tee_box: "Blue" },
  { round_number: 2, format: "singles", course_id: "c1", tee_box: "Blue" },
];
const ctx = {
  tPlayers: players, tRounds, courses: [course],
  roundLocks: {}, hcpOverrides: {}, teeAssignments: {},
};
const card = (v) => Object.fromEntries(Array.from({ length: 18 }, (_, h) => [h, v]));

// p1 wins every hole of round 1 outright; nobody has posted round 2.
const holeData = {
  p1_1: card(4), p2_1: card(5), p3_1: card(5), p4_1: card(5),
};

const books = (over = {}) => winningsBooks({
  roster: players, rounds: [1, 2], holeData, ctpData: {},
  buyIns: { skinsAmount: 10 }, skinsPot: 0, ...ctx, ...over,
});

describe("potFor", () => {
  it("counts the pot from the buy-in when there is a price", () => {
    expect(potFor(players, 20, 500)).toBe(80);
  });
  // A tournament already under way has a hand-typed pot and no price.
  it("falls back to the typed figure when there is no price", () => {
    expect(potFor(players, 0, 500)).toBe(500);
  });
  it("is nothing when there is neither", () => {
    expect(potFor(players, 0)).toBe(0);
  });
});

describe("shareOf", () => {
  // Exact, and rounded only where it prints — ten skins out of an $80/36 pot
  // are $22.22, not ten times $2.22.
  it("does not round", () => {
    expect(shareOf(80, 36) * 10).toBeCloseTo(22.222, 3);
  });
  it("is zero rather than infinite when nothing has been won", () => {
    expect(shareOf(80, 0)).toBe(0);
  });
});

describe("winningsBooks", () => {
  it("names the four scored games and no others", () => {
    expect(books().games.map(g => g.key)).toEqual(["skins", "ctp", "lownet", "moneyhole"]);
  });

  // The money hole's column is its HOLE, the way the Betting tab names it.
  it("labels the money hole with the hole it is played on", () => {
    const b = books({ buyIns: { moneyHoleAmount: 5, moneyHoleNumber: 9 } });
    expect(b.games.find(g => g.key === "moneyhole").label).toBe("Hole 9");
  });

  it("pays the whole skins pot to the only man who won a skin", () => {
    const b = books();
    const skins = b.games.find(g => g.key === "skins");
    expect(skins.pot).toBe(40);
    expect(skins.paid).toBeCloseTo(40, 6);
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0].pid).toBe("p1");
    expect(b.rows[0].total).toBeCloseTo(40, 6);
    expect(b.rows[0].games.skins.count).toBe(18);
  });

  it("carries the player's name and team onto the row", () => {
    expect(books().rows[0]).toMatchObject({ name: "One", team: "A" });
  });

  // A pot nobody has won out of is intact, and the board has to be able to
  // say so — otherwise a director hands out money the field has not won.
  it("counts a pot as unpaid until somebody wins out of it", () => {
    const b = books({ buyIns: { skinsAmount: 10, lowNetAmount: 5 } });
    const lowNet = b.games.find(g => g.key === "lownet");
    expect(lowNet.pot).toBe(20);
    // Round 1's cards are complete, round 2's are not — so half the pot.
    expect(lowNet.paid).toBeCloseTo(10, 6);
    expect(b.pot).toBe(60);
    expect(b.paid).toBeCloseTo(50, 6);
  });

  // A pin nobody hit leaves its share in the hat: the pot divides by the par
  // 3s the WEEK holds, not by the ones taken. See ctpPinTotal.
  it("divides the CTP pot by the week's pins, not by the tags standing", () => {
    const b = books({
      buyIns: { ctpAmount: 10 },
      ctpData: { "1_0": { player_id: "p2", distance_ft: 4 } },
    });
    const ctp = b.games.find(g => g.key === "ctp");
    expect(ctp.pot).toBe(40);
    // Two rounds, one par 3 each — one of the two taken.
    expect(ctp.paid).toBeCloseTo(20, 6);
    expect(b.rows.find(r => r.pid === "p2").total).toBeCloseTo(20, 6);
  });

  it("adds a man's games together into one total", () => {
    const b = books({
      buyIns: { skinsAmount: 10, ctpAmount: 10 },
      ctpData: { "1_0": { player_id: "p1", distance_ft: 4 } },
    });
    const row = b.rows.find(r => r.pid === "p1");
    expect(row.games.skins.money).toBeCloseTo(40, 6);
    expect(row.games.ctp.money).toBeCloseTo(20, 6);
    expect(row.total).toBeCloseTo(60, 6);
  });

  // Most money first — the order a director pays people out in.
  it("sorts the winners by what they are owed", () => {
    const b = books({
      buyIns: { skinsAmount: 10, ctpAmount: 1 },
      ctpData: { "1_0": { player_id: "p3", distance_ft: 4 } },
    });
    expect(b.rows.map(r => r.pid)).toEqual(["p1", "p3"]);
  });

  // Who won nothing is answered by not being on the list.
  it("gives no row to a man who has won nothing", () => {
    expect(books().rows.map(r => r.pid)).not.toContain("p2");
  });

  // Net is the game as this cup plays it, and gross is a different set of
  // winners — the board says which it is showing for exactly this reason.
  it("scores skins net by default and gross when asked", () => {
    const strokes = {
      ...holeData,
      // p3 off a handicap gets strokes; gross he is beaten on every hole.
      p3_1: card(5),
    };
    const shot = { ...ctx, tPlayers: players.map(p => p.player_id === "p3" ? { ...p, handicap_index: 9 } : p) };
    const net = winningsBooks({ roster: players, rounds: [1], holeData: strokes, ctpData: {}, buyIns: { skinsAmount: 10 }, ...shot });
    const gross = winningsBooks({ roster: players, rounds: [1], holeData: strokes, ctpData: {}, buyIns: { skinsAmount: 10 }, gross: true, ...shot });
    // Gross: p1 sweeps the eighteen. Net: p3 has a shot on the first nine and
    // ties him there, so those nine push and only nine skins are won — which
    // makes each of them worth twice as much.
    expect(gross.rows[0].pid).toBe("p1");
    expect(gross.rows[0].games.skins.count).toBe(18);
    expect(net.rows[0].pid).toBe("p1");
    expect(net.rows[0].games.skins.count).toBe(9);
    expect(net.rows[0].total).toBeCloseTo(gross.rows[0].total, 6);
    expect(net.gross).toBe(false);
    expect(gross.gross).toBe(true);
  });

  // The buy-in lists are read the way every other one in the app is: null is
  // everybody, an empty array is nobody, and the two are not the same answer.
  it("keeps a man who is not in a game out of its pot and its winnings", () => {
    const b = books({ buyIns: { skinsAmount: 10, skinsIn: ["p2", "p3", "p4"] } });
    const skins = b.games.find(g => g.key === "skins");
    expect(skins.pot).toBe(30);
    expect(b.rows.map(r => r.pid)).not.toContain("p1");
  });

  it("reads an empty buy-in list as nobody rather than as everybody", () => {
    const b = books({ buyIns: { skinsAmount: 10, skinsIn: [] } });
    expect(b.games.find(g => g.key === "skins").pot).toBe(0);
    expect(b.rows).toHaveLength(0);
  });

  // A shared-ball round is never played for the money hole — both partners
  // carry one ball and the weaker half of the pair takes the hole off it.
  it("never pays the money hole out of a shared-ball round", () => {
    const shared = [
      { round_number: 1, format: "scramble", course_id: "c1", tee_box: "Blue" },
      { round_number: 2, format: "singles", course_id: "c1", tee_box: "Blue" },
    ];
    const b = winningsBooks({
      roster: players, rounds: [1, 2], holeData, ctpData: {},
      buyIns: { moneyHoleAmount: 10, moneyHoleNumber: 1 },
      ...ctx, tRounds: shared,
    });
    // Round 1 is out, so its share is not paid — and round 2 has no cards.
    expect(b.games.find(g => g.key === "moneyhole").paid).toBe(0);
  });

  it("is empty on a tournament with no rounds and no pots", () => {
    const b = winningsBooks({ roster: players, rounds: [], holeData: {}, ctpData: {}, buyIns: {}, ...ctx });
    expect(b.rows).toHaveLength(0);
    expect(b.pot).toBe(0);
    expect(hasPots(b)).toBe(false);
  });

  it("knows a tournament that has priced a game", () => {
    expect(hasPots(books())).toBe(true);
  });
});
