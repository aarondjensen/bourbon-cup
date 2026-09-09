import { describe, it, expect } from "vitest";
import {
  captainSideFor, isCaptainOf, playerCaptainSide, captainForSide, captainPatch,
} from "./captains";
import { membershipFor } from "./accounts";

// The armband decides who may turn over half of the closing round, so the
// question "is this man a captain, here, on this side" has to have one answer
// and it has to be the one the security rules will give.

const acct = (id, editions) => ({ id, uid: id, captain_of: editions });
const player = (pid, uid, team) => ({ player_id: pid, name: pid, team, auth_uid: uid });

describe("captainSideFor", () => {
  it("reads the side out of the edition map", () => {
    expect(captainSideFor(acct("u1", { bc_2026: "A" }), "bc_2026")).toBe("A");
    expect(captainSideFor(acct("u1", { bc_2026: "B" }), "bc_2026")).toBe("B");
  });

  // A captaincy is a fact about ONE tournament. The man who captained 2025 is
  // not captaining 2026 because nobody said otherwise, and an edition cloned
  // forward carries no armband with it.
  it("does not carry across editions", () => {
    expect(captainSideFor(acct("u1", { bc_2025: "A" }), "bc_2026")).toBe(null);
  });

  it("reads anything that isn't a side as no captaincy", () => {
    expect(captainSideFor(acct("u1", { bc_2026: "yes" }), "bc_2026")).toBe(null);
    expect(captainSideFor(acct("u1", { bc_2026: true }), "bc_2026")).toBe(null);
    expect(captainSideFor(acct("u1", {}), "bc_2026")).toBe(null);
    expect(captainSideFor(acct("u1", undefined), "bc_2026")).toBe(null);
    expect(captainSideFor(null, "bc_2026")).toBe(null);
    expect(captainSideFor(acct("u1", { bc_2026: "A" }), null)).toBe(null);
  });

  it("answers isCaptainOf for one side only", () => {
    const m = acct("u1", { bc_2026: "A" });
    expect(isCaptainOf(m, "bc_2026", "A")).toBe(true);
    expect(isCaptainOf(m, "bc_2026", "B")).toBe(false);
    expect(isCaptainOf(m, "bc_2026", null)).toBe(false);
  });
});

describe("reading it off the roster", () => {
  const memberships = [acct("u1", { bc_2026: "A" }), acct("u2", { bc_2026: "B" }), acct("u3", {})];
  const players = [
    player("p1", "u1", "A"), player("p2", "u2", "B"),
    player("p3", "u3", "A"), player("p4", null, "B"),
  ];

  it("joins a roster row to its membership", () => {
    expect(playerCaptainSide(memberships, players[0], "bc_2026", membershipFor)).toBe("A");
    expect(playerCaptainSide(memberships, players[1], "bc_2026", membershipFor)).toBe("B");
    expect(playerCaptainSide(memberships, players[2], "bc_2026", membershipFor)).toBe(null);
  });

  it("reads a man who has never signed in as no captain", () => {
    // There is no membership document to carry the flag, which is the same
    // thing that stops him being crowned.
    expect(playerCaptainSide(memberships, players[3], "bc_2026", membershipFor)).toBe(null);
  });

  it("finds the man holding a side", () => {
    expect(captainForSide(memberships, players, "bc_2026", "A", membershipFor)?.player_id).toBe("p1");
    expect(captainForSide(memberships, players, "bc_2026", "B", membershipFor)?.player_id).toBe("p2");
    expect(captainForSide(memberships, players, "bc_2025", "A", membershipFor)).toBe(null);
    expect(captainForSide(memberships, players, "bc_2026", null, membershipFor)).toBe(null);
  });
});

describe("captainPatch", () => {
  it("adds an edition without disturbing the others", () => {
    const m = acct("u1", { bc_2025: "B" });
    expect(captainPatch(m, "bc_2026", "A")).toEqual({ captain_of: { bc_2025: "B", bc_2026: "A" } });
  });

  // Removed rather than stored as null: a man who has never captained and one
  // who was stood down should read identically, and a null in the map would
  // make `captainSideFor` the only thing standing between them.
  it("removes an edition rather than nulling it", () => {
    const m = acct("u1", { bc_2025: "B", bc_2026: "A" });
    expect(captainPatch(m, "bc_2026", null)).toEqual({ captain_of: { bc_2025: "B" } });
  });

  it("writes the whole map, because the writer merges documents", () => {
    // A dotted field path through a merging set lands as a literal key with a
    // dot in it. This is why the patch is the map and not `captain_of.bc_2026`.
    expect(Object.keys(captainPatch(null, "bc_2026", "A"))).toEqual(["captain_of"]);
    expect(captainPatch(null, "bc_2026", "A")).toEqual({ captain_of: { bc_2026: "A" } });
  });

  it("ignores a side that is not a side", () => {
    expect(captainPatch(acct("u1", { bc_2026: "A" }), "bc_2026", "C")).toEqual({ captain_of: {} });
  });
});
