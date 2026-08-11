import { describe, it, expect } from "vitest";
import {
  BUDGET_CATEGORIES, categoryLabel, categoryIcon, normalizeCategory,
  budgetLineId, budgetLineError, buildBudgetLine, MAX_LABEL, MAX_NOTE,
  budgetGroups, budgetTotal, budgetPerPlayer, budgetVsDues,
} from "./budget";

const line = (over = {}) => ({
  id: "b1", tournament_id: "bc_2026", category: "lodging",
  label: "The house", amount: 3400, note: "", created_by: "uid_a", created_at: 1, ...over,
});

describe("budgetLineId", () => {
  it("does not collide for the same timestamp", () => {
    expect(budgetLineId(1700, 0.1)).not.toBe(budgetLineId(1700, 0.9));
  });
  it("is a plain document id", () => {
    expect(budgetLineId(1700, 0.5)).toMatch(/^bc_budget_1700_[0-9a-z]+$/);
  });
});

describe("categories", () => {
  it("labels and marks what it knows", () => {
    expect(categoryLabel("golf")).toBe("Golf");
    expect(categoryIcon("golf")).toBe("⛳");
  });
  // A line whose category was retired must not vanish off the screen with its
  // money still in the total.
  it("files anything it does not know under Other", () => {
    expect(normalizeCategory("caddies")).toBe("other");
    expect(normalizeCategory(undefined)).toBe("other");
    expect(categoryLabel("caddies")).toBe("Other");
  });
  it("keeps every id unique", () => {
    const ids = BUDGET_CATEGORIES.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("budgetLineError", () => {
  const ok = { label: "The house", amount: "3400" };
  it("accepts a complete line", () => {
    expect(budgetLineError(ok)).toBeNull();
  });
  it("wants a name", () => {
    expect(budgetLineError({ ...ok, label: "  " })).toMatch(/name/i);
  });
  // A $0 line is a real thing to write down — something comped, or a
  // placeholder for a quote that has not come back.
  it("allows zero but not negative", () => {
    expect(budgetLineError({ ...ok, amount: "0" })).toBeNull();
    expect(budgetLineError({ ...ok, amount: "-50" })).toMatch(/amount/i);
    expect(budgetLineError({ ...ok, amount: "" })).toMatch(/amount/i);
    expect(budgetLineError({ ...ok, amount: "lots" })).toMatch(/amount/i);
  });
});

describe("buildBudgetLine", () => {
  const built = buildBudgetLine({
    id: "b1", tournamentId: "bc_2026", category: "golf",
    label: "  Greens fees  ", amount: "2880.004", note: "  4 rounds x 16  ",
    createdBy: "uid_a", now: 1000,
  });
  it("trims and rounds", () => {
    expect(built).toMatchObject({ label: "Greens fees", amount: 2880, note: "4 rounds x 16" });
  });
  it("caps the free text", () => {
    const long = buildBudgetLine({ ...built, label: "x".repeat(200), note: "y".repeat(500) });
    expect(long.label.length).toBe(MAX_LABEL);
    expect(long.note.length).toBe(MAX_NOTE);
  });
  it("normalizes a category it does not know", () => {
    expect(buildBudgetLine({ ...built, category: "caddies" }).category).toBe("other");
  });
});

describe("budgetGroups", () => {
  const lines = [
    line({ id: "a", category: "golf", label: "Greens fees", amount: 2880 }),
    line({ id: "b", category: "lodging", label: "The house", amount: 3400 }),
    line({ id: "c", category: "golf", label: "Carts", amount: 640 }),
    line({ id: "d", category: "caddies", label: "Forecaddie", amount: 200 }),
  ];
  const groups = budgetGroups(lines);

  it("is in the catalog's order, not the data's", () => {
    expect(groups.map(g => g.id)).toEqual(["lodging", "golf", "other"]);
  });
  it("puts the biggest line first inside a group", () => {
    expect(groups.find(g => g.id === "golf").lines.map(l => l.id)).toEqual(["a", "c"]);
  });
  it("subtotals each group", () => {
    expect(groups.find(g => g.id === "golf").total).toBe(3520);
    expect(groups.find(g => g.id === "lodging").total).toBe(3400);
  });
  // A line whose category was retired still shows up, under Other.
  it("keeps an unknown category's money on screen", () => {
    expect(groups.find(g => g.id === "other").lines.map(l => l.id)).toEqual(["d"]);
  });
  it("leaves out a category with nothing in it", () => {
    expect(groups.map(g => g.id)).not.toContain("prizes");
  });
  it("handles no lines at all", () => {
    expect(budgetGroups([])).toEqual([]);
    expect(budgetGroups(undefined)).toEqual([]);
  });
});

describe("budgetTotal and budgetPerPlayer", () => {
  const lines = [line({ amount: 3400 }), line({ id: "b", amount: 2880 }), line({ id: "c", amount: 640 })];
  it("adds every line", () => {
    expect(budgetTotal(lines)).toBe(6920);
    expect(budgetTotal([])).toBe(0);
  });
  it("divides by the field", () => {
    expect(budgetPerPlayer(lines, 16)).toBe(432.5);
  });
  // Dividing by nobody has no answer, and "$0 a man" would read as a free trip.
  it("is null for an empty roster", () => {
    expect(budgetPerPlayer(lines, 0)).toBeNull();
    expect(budgetPerPlayer(lines, undefined)).toBeNull();
  });
});

describe("budgetVsDues", () => {
  const lines = [line({ amount: 6400 })];

  it("is square when the field covers the trip exactly", () => {
    const v = budgetVsDues({ lines, charged: 6400, playerCount: 16 });
    expect(v).toMatchObject({ total: 6400, perPlayer: 400, billed: 6400, gap: 0, comparable: true });
  });
  // The failure this exists to catch: the trip is priced, then a bigger house
  // is booked, and the ledger happily collects the old figure until October.
  it("goes negative when the trip costs more than is being charged", () => {
    expect(budgetVsDues({ lines, charged: 5600, playerCount: 16 }).gap).toBe(-800);
  });
  it("goes positive when there is money to spare", () => {
    expect(budgetVsDues({ lines, charged: 6800, playerCount: 16 }).gap).toBe(400);
  });
  // Mid-setup is not wrong, and a screaming "SHORT $6,400" on it would be noise.
  it("is not comparable until both sides exist", () => {
    expect(budgetVsDues({ lines, charged: 0, playerCount: 16 }).comparable).toBe(false);
    expect(budgetVsDues({ lines: [], charged: 6400, playerCount: 16 }).comparable).toBe(false);
  });
  it("survives an empty roster", () => {
    expect(budgetVsDues({ lines, charged: 6400, playerCount: 0 }))
      .toMatchObject({ total: 6400, perPlayer: null, gap: 0 });
  });
});
