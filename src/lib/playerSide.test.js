// ══════════════════════════════════════════════════════════════════
//  The side lookup the countdown's subtraction is cut by.
// ══════════════════════════════════════════════════════════════════
//
// `countdownHoleData` cuts a concealing round PER PLAYER — team A's twelfth
// can be on the map while team B's twelfth is not — and it decides which
// counter to cut a given player at by asking a lookup the caller supplies.
//
// The contract has a third answer, and it is the one that matters: a player
// the lookup CANNOT PLACE is cut at the safer of the two counters, the side
// that has been shown less. App wires that lookup to `playerLookup().teamOf`,
// which answers null for an id it has never heard of.
//
// This file pins the two halves together, because they are in different
// modules and each one is individually correct while the pair can still be
// wrong: App used to hand in a hand-rolled `?.team === "B" ? "B" : "A"`,
// which answers "A" for an unknown player and so made the null branch below
// unreachable. The window where that bites is the television being refreshed
// mid-ceremony — holeData lands before the roster does, every pid is unknown
// for a frame or two, and team B's map gets cut at team A's counter.
import { describe, it, expect } from "vitest";
import { playerLookup } from "./players";
import { countdownHoleData } from "./reveal";

// One concealing Team Best Ball round with the sides at different counters:
// A has turned over five holes, B three.
const ROUND = [{ round_number: 4, format: "team_best_ball", sealed: true, reveal_a: 5, reveal_b: 3 }];

// Eighteen holes on every card, so whatever survives the cut is the cut and
// not a gap in the data.
const card = () => Object.fromEntries(Array.from({ length: 18 }, (_, h) => [h, 4]));

const ROSTER = [
  { player_id: "p_a", name: "Ada A", team: "A" },
  { player_id: "p_b", name: "Ben B", team: "B" },
  { player_id: "p_none", name: "Nol N" },              // on the roster, no team
  { player_id: "p_odd", name: "Odd O", team: "Red" },  // a team spelled some other way
];

const holeData = {
  p_a_4: card(),
  p_b_4: card(),
  p_none_4: card(),
  p_odd_4: card(),
  p_ghost_4: card(),   // in the draw, not on the roster at all
};

// How many holes survived for one player, and the highest index kept.
const kept = (out, key) => Object.keys(out[key] || {}).map(Number).sort((a, b) => a - b);

describe("the countdown's side lookup, wired to teamOf", () => {
  const sideOf = playerLookup(ROSTER).teamOf;
  const out = countdownHoleData(holeData, ROUND, sideOf);

  it("cuts each known player at their OWN side's counter", () => {
    // A has been shown five holes: indexes 0-4.
    expect(kept(out, "p_a_4")).toEqual([0, 1, 2, 3, 4]);
    // B has been shown three: indexes 0-2. B's fourth and fifth are the holes
    // his captain has not spoken to yet, and they are not on this map.
    expect(kept(out, "p_b_4")).toEqual([0, 1, 2]);
  });

  it("cuts a player it cannot place at the SAFER of the two counters", () => {
    // The regression. A pid in the draw that the roster does not answer for
    // must be cut at min(5, 3) — not at team A's five, which is what a lookup
    // that collapses null to "A" produced.
    expect(kept(out, "p_ghost_4")).toEqual([0, 1, 2]);
  });

  it("treats a roster row with no team the same way", () => {
    expect(kept(out, "p_none_4")).toEqual([0, 1, 2]);
  });

  it("treats a team spelled some other way the same way", () => {
    // Not "A" and not "B", so it is not placeable, so it is cut at the
    // minimum. A director who types a team name of his own cannot widen
    // what the room can see.
    expect(kept(out, "p_odd_4")).toEqual([0, 1, 2]);
  });

  it("never lets an unplaceable player see more than the side shown least", () => {
    // Stated as the invariant rather than as a number, so it still holds if
    // the fixture's counters ever move: nothing unplaceable may carry a hole
    // index at or beyond the lower counter.
    const floor = Math.min(ROUND[0].reveal_a, ROUND[0].reveal_b);
    ["p_ghost_4", "p_none_4", "p_odd_4"].forEach((key) => {
      kept(out, key).forEach((h) => expect(h).toBeLessThan(floor));
    });
  });

  it("teamOf answers null for an id the roster has never heard of", () => {
    // The half of the contract that lives in lib/players. If this ever comes
    // back "A" again, the cut above silently widens and nothing else fails.
    expect(playerLookup(ROSTER).teamOf("p_ghost")).toBeNull();
  });

  it("is inert on a round nobody sealed", () => {
    const open = [{ round_number: 4, format: "singles", sealed: false }];
    // The identity guarantee App leans on: nothing concealing, same object.
    expect(countdownHoleData(holeData, open, sideOf)).toBe(holeData);
  });
});
