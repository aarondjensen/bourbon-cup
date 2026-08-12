import { describe, it, expect } from "vitest";
import {
  BUDGET_CATEGORIES, categoryLabel, categoryIcon, normalizeCategory,
  budgetLineId, budgetLineError, buildBudgetLine, MAX_LABEL,
  BUDGET_BASES, normalizeBasis, isPerMan, lineTotal, lineTitle,
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
  // A Lodging line for the house needs no elaboration — demanding one means
  // typing the word "Lodging" twice.
  it("does not need a detail", () => {
    expect(budgetLineError({ amount: "3400" })).toBeNull();
    expect(budgetLineError({ label: "  ", amount: "3400" })).toBeNull();
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
    label: "  Greens fees  ", amount: "2880.004",
    createdBy: "uid_a", now: 1000,
  });
  it("trims and rounds", () => {
    expect(built).toMatchObject({ label: "Greens fees", amount: 2880 });
  });
  it("caps the detail", () => {
    expect(buildBudgetLine({ ...built, label: "x".repeat(200) }).label.length).toBe(MAX_LABEL);
  });
  it("normalizes a category it does not know", () => {
    expect(buildBudgetLine({ ...built, category: "caddies" }).category).toBe("other");
  });
  it("defaults to a total and keeps a per-man basis", () => {
    expect(built.basis).toBe("total");
    expect(buildBudgetLine({ ...built, basis: "per_man" }).basis).toBe("per_man");
    expect(buildBudgetLine({ ...built, basis: "nonsense" }).basis).toBe("total");
  });
  // A second optional free-text field beside an optional label is one more
  // than a budget line needs. Not writing it means a note typed before the
  // change survives the next edit rather than being blanked.
  it("does not write a note field at all", () => {
    expect(buildBudgetLine({ ...built, note: "leftover" })).not.toHaveProperty("note");
  });
});

describe("basis", () => {
  it("offers exactly the two ways a director knows a price", () => {
    expect(BUDGET_BASES.map(b => b.id)).toEqual(["total", "per_man"]);
  });
  // Every line written before `basis` existed is a total.
  it("reads an absent basis as a total", () => {
    expect(normalizeBasis(undefined)).toBe("total");
    expect(isPerMan(line({ basis: undefined }))).toBe(false);
    expect(isPerMan(line({ basis: "per_man" }))).toBe(true);
  });
  it("expands a per-man line by the field", () => {
    expect(lineTotal(line({ amount: 90, basis: "per_man" }), 16)).toBe(1440);
    expect(lineTotal(line({ amount: 3400, basis: "total" }), 16)).toBe(3400);
  });
  // Guessing a field size would put an invented number in the total.
  it("contributes nothing per-man against an empty roster", () => {
    expect(lineTotal(line({ amount: 90, basis: "per_man" }), 0)).toBe(0);
    expect(lineTotal(line({ amount: 3400 }), 0)).toBe(3400);
  });
});

describe("lineTitle", () => {
  it("is the detail when there is one", () => {
    expect(lineTitle(line({ label: "Greens fees" }))).toBe("Greens fees");
  });
  // Leaving it blank on a Lodging line means "Lodging", and that is true.
  it("falls back to the category", () => {
    expect(lineTitle(line({ label: "", category: "lodging" }))).toBe("Lodging");
    expect(lineTitle(line({ label: "   ", category: "caddies" }))).toBe("Other");
  });
});

describe("budgetGroups", () => {
  const lines = [
    line({ id: "a", category: "golf", label: "Greens fees", amount: 2880 }),
    line({ id: "b", category: "lodging", label: "The house", amount: 3400 }),
    line({ id: "c", category: "golf", label: "Carts", amount: 640 }),
    line({ id: "d", category: "caddies", label: "Forecaddie", amount: 200 }),
  ];
  const groups = budgetGroups(lines, 16);

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
    expect(budgetGroups([], 16)).toEqual([]);
    expect(budgetGroups(undefined, 16)).toEqual([]);
  });
  // A $90-a-man line is bigger than a $350 cleaning fee and has to sort like
  // it — the comparable number is what the line costs the TRIP.
  it("sorts on what a line costs the trip, not the number typed on it", () => {
    const g = budgetGroups([
      line({ id: "x", category: "golf", label: "Cleaning", amount: 350 }),
      line({ id: "y", category: "golf", label: "Greens fees", amount: 90, basis: "per_man" }),
    ], 16);
    expect(g[0].lines.map(l => l.id)).toEqual(["y", "x"]);
    expect(g[0].total).toBe(1790);
  });
});

describe("budgetTotal and budgetPerPlayer", () => {
  const lines = [line({ amount: 3400 }), line({ id: "b", amount: 2880 }), line({ id: "c", amount: 640 })];
  it("adds every line", () => {
    expect(budgetTotal(lines, 16)).toBe(6920);
    expect(budgetTotal([], 16)).toBe(0);
  });
  it("expands the per-man lines before adding", () => {
    expect(budgetTotal([line({ amount: 3400 }), line({ id: "b", amount: 90, basis: "per_man" })], 16))
      .toBe(3400 + 1440);
  });
  it("divides by the field", () => {
    expect(budgetPerPlayer(lines, 16)).toBe(432.5);
  });
  // The round trip a per-man line has to survive: type $90 a man, get $90 a
  // man back out of the per-player figure.
  it("returns a per-man line's own number when it is the only line", () => {
    expect(budgetPerPlayer([line({ amount: 90, basis: "per_man" })], 16)).toBe(90);
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
