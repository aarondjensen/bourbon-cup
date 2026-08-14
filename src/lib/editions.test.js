// Naming an edition, and the guard that stops one landing on another.
//
// The bug this pins: the id used to be `bc_${year}` and nothing else, so a
// demo edition typed as 2026 was not a second tournament — it was the 2026
// already being built for the real trip. `db.upsert` merges, so the collision
// duplicated the roster (fresh player ids, same tournament_id) and merged the
// source's copies over the singletons whose ids ARE the edition (settings,
// team names, each round). Nothing looked broken; the year just came back
// with two of every player.
import { describe, it, expect, vi, beforeEach } from "vitest";

const rows = { bc_editions: [], bc_players: [] };
const upserts = [];

vi.mock("../firebase", () => ({
  db: {
    get: vi.fn(async (col, filters = []) => {
      const all = rows[col] || [];
      return filters.reduce(
        (acc, f) => acc.filter((r) => r[f.field] === f.value),
        all,
      );
    }),
    upsert: vi.fn(async (col, data) => { upserts.push([col, data]); return data; }),
    delete: vi.fn(async () => true),
    subscribe: vi.fn(),
  },
  getActiveTournamentId: () => "bc_2025",
  setActiveTournamentId: vi.fn(),
  editionDocId: (bare, tid, ns) => (ns ? `${tid}__${bare}` : bare),
  writeUserSession: vi.fn(),
  spectatorSession: (id) => ({ id }),
}));

const { editionSlug, editionIdFor, editionExists, createEdition, cloneEdition, updateEdition } =
  await import("./editions");

beforeEach(() => {
  rows.bc_editions = [];
  rows.bc_players = [];
  upserts.length = 0;
});

describe("editionIdFor", () => {
  it("is the bare year when there is no label", () => {
    expect(editionIdFor(2026)).toBe("bc_2026");
    expect(editionIdFor("2026", "")).toBe("bc_2026");
    expect(editionIdFor("2026", "   ")).toBe("bc_2026");
  });

  it("appends a slugged label so a second 2026 gets an id of its own", () => {
    expect(editionIdFor(2026, "demo")).toBe("bc_2026_demo");
    expect(editionIdFor(2026, "App Store Test")).toBe("bc_2026_app_store_test");
  });

  it("slugs to what a Firestore doc id can carry", () => {
    // Punctuation collapses, edges trim, and it cannot run away with a
    // paragraph — the id is a database key, not a caption.
    expect(editionSlug("  --Demo/Test!!  ")).toBe("demo_test");
    expect(editionSlug("x".repeat(40))).toHaveLength(24);
  });
});

describe("editionExists", () => {
  it("sees an edition by its document", async () => {
    rows.bc_editions = [{ id: "bc_2026", year: 2026 }];
    expect(await editionExists("bc_2026")).toBe(true);
    expect(await editionExists("bc_2027")).toBe(false);
  });

  it("also sees one by its data, with no document", async () => {
    // The case a document-only check waves through: an edition whose row in
    // the picker was removed by hand while its tournament is still on disk.
    rows.bc_players = [{ id: "p1", tournament_id: "bc_2026" }];
    expect(await editionExists("bc_2026")).toBe(true);
  });
});

describe("updateEdition", () => {
  it("writes the name and the status, and nothing else", () => {
    // The id, year and namespaced flag are absent from the payload on purpose:
    // the id IS the tournament_id every other collection filters on, so an
    // edit here would orphan the whole edition while the picker looked right.
    return updateEdition("bc_2026", { name: "  The Bourbon Cup 2026  ", status: "published" }).then((res) => {
      expect(res.ok).toBe(true);
      expect(upserts).toEqual([["bc_editions", { id: "bc_2026", name: "The Bourbon Cup 2026", status: "published" }]]);
    });
  });

  it("leaves the status alone when none is given", async () => {
    await updateEdition("bc_2026", { name: "Renamed" });
    expect(upserts[0][1]).toEqual({ id: "bc_2026", name: "Renamed" });
  });

  it("refuses a blank name rather than writing one", async () => {
    const res = await updateEdition("bc_2026", { name: "   " });
    expect(res.ok).toBe(false);
    expect(upserts).toHaveLength(0);
  });

  it("refuses a status that is not one of the three", async () => {
    const res = await updateEdition("bc_2026", { name: "x", status: "retired" });
    expect(res.ok).toBe(false);
    expect(upserts).toHaveLength(0);
  });

  it("reports a refused write instead of returning success", async () => {
    // db.upsert swallows a rejection and returns null, and bc_editions is
    // director-only — so without this the new name sits on screen until the
    // next reload takes it away again.
    const { db } = await import("../firebase");
    db.upsert.mockImplementationOnce(async () => null);
    const res = await updateEdition("bc_2026", { name: "Renamed" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/rules/);
  });
});

describe("the collision guard", () => {
  it("refuses to create into an id that is already a tournament", async () => {
    rows.bc_editions = [{ id: "bc_2026", name: "The Bourbon Cup 2026" }];
    const res = await createEdition({ year: "2026" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/bc_2026 already exists/);
    expect(upserts).toHaveLength(0);
  });

  it("refuses to clone into one, before it writes anything", async () => {
    rows.bc_editions = [{ id: "bc_2026" }];
    rows.bc_players = [{ id: "bc_player_1", tournament_id: "bc_2026", name: "Aaron J" }];
    const res = await cloneEdition("bc_2025", { year: "2026" }, { players: true, teams: true });
    expect(res.ok).toBe(false);
    // The whole point: not one document written. A partial clone is the
    // duplicated roster that started all this.
    expect(upserts).toHaveLength(0);
  });

  it("lets a labelled copy of an occupied year through", async () => {
    rows.bc_editions = [{ id: "bc_2026" }];
    const res = await createEdition({ year: "2026", label: "demo" });
    expect(res.ok).toBe(true);
    expect(res.edition.id).toBe("bc_2026_demo");
    expect(res.edition.namespaced).toBe(true);
    expect(upserts[0]).toEqual(["bc_editions", expect.objectContaining({ id: "bc_2026_demo" })]);
  });

  it("files a labelled clone's data under the labelled id, not the year's", async () => {
    rows.bc_editions = [{ id: "bc_2026" }];
    rows.bc_players = [{ id: "bc_player_1", player_id: "bc_player_1", tournament_id: "bc_2025", name: "Aaron J", dues_amount: 400 }];
    const res = await cloneEdition("bc_2025", { year: "2026", label: "demo" }, { players: true });
    expect(res.ok).toBe(true);

    const player = upserts.find(([col]) => col === "bc_players")[1];
    expect(player.tournament_id).toBe("bc_2026_demo");
    expect(player.name).toBe("Aaron J");
    // Still dropped, for the reason in the module: last year's per-man
    // override bills somebody wrong on a screen nobody re-checks.
    expect(player.dues_amount).toBeUndefined();
  });
});
