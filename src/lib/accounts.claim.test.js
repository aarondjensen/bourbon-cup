// What a refused claim SAYS, which is the whole of its value on this screen.
//
// The claim rule refuses for three different reasons and they need three
// different answers. Two of them existed already — a locked edition, and
// rules that were never deployed. The third arrived with the reviewer code:
// a membership stamped `demo_only` is confined to demo editions, so a store
// reviewer who taps a name on the cup's roster rather than switching first
// is refused. Without a case for it that reviewer sees "the security rules
// may not be deployed yet", which is wrong and reads like a broken app to
// the one person it must not read that way to.
import { describe, it, expect, vi, beforeEach } from "vitest";

const rows = { bc_players: [], bc_editions: {}, bc_accounts: {} };
let upsertError = null;

const denied = () => Object.assign(new Error("PERMISSION_DENIED"), { code: "permission-denied" });

vi.mock("../firebase", () => ({
  db: {
    get: vi.fn(async (col, filters = []) => {
      const all = rows[col] || [];
      return filters.reduce((acc, f) => acc.filter((r) => r[f.field] === f.value), all);
    }),
    getById: vi.fn(async (col, id) => rows[col]?.[id] ?? null),
    upsert: vi.fn(async (col, data) => { if (upsertError) throw upsertError; return data; }),
  },
  TOURNAMENT_ID: "bc_2026",
  writeFailure: (e, fallback) =>
    (e?.code === "permission-denied" ? "the security rules may not be deployed yet" : fallback),
}));

const { claimPlayer } = await import("./accounts");

const USER = { uid: "u_reviewer", email: "r@example.com", provider: "apple" };
const PLAYER = { player_id: "p1", name: "Dave R" };

beforeEach(() => {
  rows.bc_players = [{ id: "p1", player_id: "p1", name: "Dave R" }];
  rows.bc_editions = { bc_2026: { id: "bc_2026", name: "2026" } };
  rows.bc_accounts = {};
  upsertError = null;
});

describe("claimPlayer on a refusal", () => {
  it("names the lock first, since that is the one the field actually hits", async () => {
    upsertError = denied();
    rows.bc_editions.bc_2026.locked = true;
    const res = await claimPlayer(PLAYER, USER);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/locked/i);
  });

  it("tells a demo-only account to switch tournaments, not that rules are undeployed", async () => {
    upsertError = denied();
    rows.bc_accounts.u_reviewer = { demo_only: true };
    const res = await claimPlayer(PLAYER, USER);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/demo tournaments/i);
    expect(res.error).toMatch(/Switch tournament/);
    expect(res.error).not.toMatch(/rules/i);
  });

  // The stamp is not the explanation when the edition IS a demo — something
  // else refused, and blaming the stamp would send a reviewer to a screen
  // they are already on.
  it("does not blame the stamp inside a demo edition", async () => {
    upsertError = denied();
    rows.bc_editions.bc_2026.is_demo = true;
    rows.bc_accounts.u_reviewer = { demo_only: true };
    const res = await claimPlayer(PLAYER, USER);
    expect(res.error).not.toMatch(/Switch tournament/);
  });

  it("still falls back to writeFailure for an ordinary membership", async () => {
    upsertError = denied();
    rows.bc_accounts.u_reviewer = {};
    const res = await claimPlayer(PLAYER, USER);
    expect(res.error).toMatch(/rules/i);
  });

  // The read is on the failure path only: a player who claims successfully
  // pays one write and nothing else.
  it("reads no membership when the claim lands", async () => {
    const firebase = await import("../firebase");
    firebase.db.getById.mockClear();
    const res = await claimPlayer(PLAYER, USER);
    expect(res.ok).toBe(true);
    expect(firebase.db.getById).not.toHaveBeenCalled();
  });
});
