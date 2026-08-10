import { describe, it, expect } from "vitest";
import {
  sideBetId, sideBetError, buildSideBet, sortSideBets,
  inSideBet, sideBetTotals, canDeleteSideBet, MAX_DETAIL,
} from "./sideBets";

const bet = (over = {}) => ({
  id: "b1", tournament_id: "bc_2026", created_by: "uid_a",
  player_a: "p1", player_b: "p2", amount: 20, detail: "", created_at: 1000,
  ...over,
});

describe("sideBetId", () => {
  // Two phones on the same tee, same millisecond. Without the random tail one
  // bet silently overwrites the other.
  it("does not collide for the same timestamp", () => {
    expect(sideBetId(1700, 0.1)).not.toBe(sideBetId(1700, 0.9));
  });
  it("is a plain document id", () => {
    expect(sideBetId(1700, 0.5)).toMatch(/^bc_sidebet_1700_[0-9a-z]+$/);
  });
});

describe("sideBetError", () => {
  it("accepts a complete bet", () => {
    expect(sideBetError({ playerA: "p1", playerB: "p2", amount: "20" })).toBeNull();
  });
  it("wants both players", () => {
    expect(sideBetError({ playerA: "p1", playerB: "", amount: "20" })).toMatch(/both/i);
  });
  // A bet against yourself is not a bet, and it would render as one name twice.
  it("refuses a player betting themselves", () => {
    expect(sideBetError({ playerA: "p1", playerB: "p1", amount: "20" })).toMatch(/different/i);
  });
  it("wants a positive amount", () => {
    expect(sideBetError({ playerA: "p1", playerB: "p2", amount: "0" })).toMatch(/amount/i);
    expect(sideBetError({ playerA: "p1", playerB: "p2", amount: "-5" })).toMatch(/amount/i);
    expect(sideBetError({ playerA: "p1", playerB: "p2", amount: "" })).toMatch(/amount/i);
    expect(sideBetError({ playerA: "p1", playerB: "p2", amount: "abc" })).toMatch(/amount/i);
  });
});

describe("buildSideBet", () => {
  const built = (over = {}) => buildSideBet({
    id: "b9", tournamentId: "bc_2026", createdBy: "uid_a",
    playerA: "p1", playerB: "p2", amount: "20", detail: "  low score, back 9  ",
    now: 1234, ...over,
  });

  it("stores the amount as a number", () => {
    expect(built().amount).toBe(20);
  });
  it("trims the terms", () => {
    expect(built().detail).toBe("low score, back 9");
  });
  it("caps the terms rather than storing a wall of text", () => {
    expect(built({ detail: "x".repeat(500) }).detail).toHaveLength(MAX_DETAIL);
  });
  // The field the delete rule trusts. It is the caller's uid, never a roster
  // id — see the note in sideBets.js.
  it("records the author as an auth uid", () => {
    expect(built().created_by).toBe("uid_a");
  });
  it("carries the edition, so a year's bets go with the year", () => {
    expect(built().tournament_id).toBe("bc_2026");
  });
});

describe("sortSideBets", () => {
  it("puts the newest first", () => {
    const rows = [bet({ id: "old", created_at: 1 }), bet({ id: "new", created_at: 9 })];
    expect(sortSideBets(rows).map(b => b.id)).toEqual(["new", "old"]);
  });
  it("does not mutate its input", () => {
    const rows = [bet({ id: "a", created_at: 1 }), bet({ id: "b", created_at: 9 })];
    sortSideBets(rows);
    expect(rows.map(b => b.id)).toEqual(["a", "b"]);
  });
});

describe("inSideBet", () => {
  it("matches either side", () => {
    expect(inSideBet(bet(), "p1")).toBe(true);
    expect(inSideBet(bet(), "p2")).toBe(true);
  });
  it("does not match a bystander", () => {
    expect(inSideBet(bet(), "p3")).toBe(false);
  });
  // A spectator or a director with no roster row has no player id at all.
  it("is false for nobody", () => {
    expect(inSideBet(bet(), null)).toBe(false);
  });
});

describe("sideBetTotals", () => {
  const rows = [
    bet({ id: "b1", amount: 20, player_a: "p1", player_b: "p2" }),
    bet({ id: "b2", amount: 50, player_a: "p3", player_b: "p4" }),
    bet({ id: "b3", amount: 5, player_a: "p2", player_b: "p1" }),
  ];
  it("sums everything on the table", () => {
    expect(sideBetTotals(rows, "p1").atStake).toBe(75);
  });
  it("counts the bets", () => {
    expect(sideBetTotals(rows, "p1").count).toBe(3);
  });
  // EXPOSURE, not a net position — nothing here knows who won.
  it("sums only the asking player's own exposure", () => {
    expect(sideBetTotals(rows, "p1").mine).toBe(25);
    expect(sideBetTotals(rows, "p4").mine).toBe(50);
  });
  it("gives a spectator no exposure", () => {
    expect(sideBetTotals(rows, null).mine).toBe(0);
  });
  it("is zero across the board with no bets", () => {
    expect(sideBetTotals([], "p1")).toEqual({ atStake: 0, count: 0, mine: 0 });
  });
});

describe("canDeleteSideBet", () => {
  // Mirrors the delete rule in firestore.rules. If these two ever disagree the
  // screen offers a button that only fails.
  it("lets the author remove their own", () => {
    expect(canDeleteSideBet(bet(), { uid: "uid_a", isDirector: false })).toBe(true);
  });
  it("lets a director clean up anybody's", () => {
    expect(canDeleteSideBet(bet(), { uid: "uid_z", isDirector: true })).toBe(true);
  });
  // The other side of a bet you dispute is not yours to erase.
  it("refuses the opponent", () => {
    expect(canDeleteSideBet(bet(), { uid: "uid_b", isDirector: false })).toBe(false);
  });
  it("refuses a signed-out reader", () => {
    expect(canDeleteSideBet(bet(), { uid: null, isDirector: false })).toBe(false);
  });
});
