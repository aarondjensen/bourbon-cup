// The pin, and the races that used to decide it.
//
// Every case here is a thing that went wrong when a pin was stored as one
// answer rather than as one claim per group. See lib/ctp.
import { describe, it, expect } from "vitest";
import {
  groupKey, groupLabel, tagAheadOfPlay, readClaims, winningClaim,
  answeredGroups, resolvePin, canTakePin, OVERRIDE_KEY,
} from "./ctp";

const tag = (player_id, distance_ft, order) => ({ kind: "tag", player_id, distance_ft, order });

describe("groupKey", () => {
  it("is the same string whichever order the group was listed in", () => {
    expect(groupKey(["b", "a", "d", "c"])).toBe(groupKey(["c", "d", "a", "b"]));
  });
  it("drops blanks, and an empty group has no key at all", () => {
    expect(groupKey(["a", null, "", undefined])).toBe("a");
    expect(groupKey([])).toBeNull();
  });
});

describe("tagAheadOfPlay", () => {
  it("warns only when the tag came from a group playing behind", () => {
    expect(tagAheadOfPlay({ leaderOrder: 3, myOrder: 1 })).toMatchObject({ label: "Group 4" });
    expect(tagAheadOfPlay({ leaderOrder: 1, myOrder: 3 })).toBeNull();
  });
  it("says nothing when either order is unknown, rather than guessing", () => {
    expect(tagAheadOfPlay({ leaderOrder: null, myOrder: 1 })).toBeNull();
    expect(tagAheadOfPlay({ leaderOrder: 3, myOrder: null })).toBeNull();
  });
  it("does not warn a group about its own tag", () => {
    expect(tagAheadOfPlay({ leaderOrder: 3, leaderKey: "x", myOrder: 1, myKey: "x" })).toBeNull();
  });
});

describe("readClaims", () => {
  it("drops anything that is not a claim, so a half-written doc cannot throw", () => {
    expect(readClaims({ a: null, b: 5, c: "x", d: { kind: "nonsense" } })).toEqual({});
    expect(readClaims(null)).toEqual({});
    expect(readClaims("nope")).toEqual({});
  });
  it("reads both spellings of a stored claim", () => {
    expect(readClaims({ g: { kind: "tag", player_id: "a", distance_ft: 4 } }).g)
      .toMatchObject({ playerId: "a", distanceFt: 4 });
    expect(readClaims({ g: { kind: "tag", playerId: "a", distanceFt: 4 } }).g)
      .toMatchObject({ playerId: "a", distanceFt: 4 });
  });
  it("keeps only an integer tee order — a bad one must not read as off first", () => {
    expect(readClaims({ g: { ...tag("a", 4, 1.5) } }).g.order).toBeNull();
    expect(readClaims({ g: { ...tag("a", 4, 0) } }).g.order).toBe(0);
  });
});

describe("winningClaim — the race the old shape lost", () => {
  it("gives the pin to the closest ball, whichever group wrote last", () => {
    // The bug: both groups compared against what their own phone held, both
    // passed, and the second write landed on top.
    expect(winningClaim({ late: tag("bob", 9, 1), early: tag("amy", 5, 0) }).playerId).toBe("amy");
    expect(winningClaim({ early: tag("amy", 5, 0), late: tag("bob", 9, 1) }).playerId).toBe("amy");
  });
  it("breaks a tie on tee order — the group that played it first keeps it", () => {
    expect(winningClaim({ g3: tag("late", 7, 3), g1: tag("early", 7, 1) }).playerId).toBe("early");
  });
  it("cannot break a tie on an order it does not know, and stays stable", () => {
    const cs = { zz: tag("z", 7, null), aa: tag("a", 7, null) };
    expect(winningClaim(cs).key).toBe("aa");
  });
  it("ranks a measured tag above an unmeasured one", () => {
    expect(winningClaim({ g1: tag("nofeet", null, 0), g2: tag("measured", 30, 1) }).playerId)
      .toBe("measured");
  });
  it("lets the director's override beat every group", () => {
    const cs = { g1: tag("amy", 3, 0), [OVERRIDE_KEY]: { kind: "override", player_id: "bob" } };
    expect(winningClaim(cs).playerId).toBe("bob");
  });
  it("ignores an override that names nobody, so clearing falls back to the field", () => {
    const cs = { g1: tag("amy", 3, 0), [OVERRIDE_KEY]: { kind: "override", player_id: null } };
    expect(winningClaim(cs).playerId).toBe("amy");
  });
  it("has no winner on a hole where every group passed", () => {
    expect(winningClaim({ g1: { kind: "pass" }, g2: { kind: "confirm" } })).toBeNull();
  });
});

describe("answeredGroups", () => {
  it("counts groups, and the director is not one", () => {
    expect(answeredGroups({ g1: tag("a", 4, 0), [OVERRIDE_KEY]: {} })).toEqual(["g1"]);
  });
});

describe("resolvePin", () => {
  it("returns the record shape every screen already reads", () => {
    const r = resolvePin({ claims: { g1: { ...tag("amy", 5, 2), by: "p1", by_name: "Amy" } } });
    expect(r).toMatchObject({
      player_id: "amy", distance_ft: 5, tagged_by: "p1",
      tagged_group_key: "g1", tagged_group_order: 2, approved: false,
    });
  });
  it("carries no group order for a director's pick", () => {
    const r = resolvePin({ claims: { [OVERRIDE_KEY]: { kind: "override", player_id: "bob" } } });
    expect(r.tagged_group_key).toBeNull();
    expect(r.tagged_group_order).toBeNull();
    expect(r.approved).toBe(true);
  });
  it("keeps showing a pin tagged before claims existed", () => {
    const r = resolvePin({ legacy: { player_id: "old", distance_ft: 8, approved: true } });
    expect(r).toMatchObject({ player_id: "old", distance_ft: 8, approved: true });
  });
  it("does NOT erase a legacy winner when a group confirms him", () => {
    // The group is agreeing with the tag in front of them. On a pin written
    // before claims existed, that tag IS the flat field — so clearing it on
    // their agreement would delete the winner at the moment the field
    // confirmed him.
    const r = resolvePin({
      claims: { g2: { kind: "confirm", by: "p2" } },
      legacy: { player_id: "old", distance_ft: 8 },
    });
    expect(r.player_id).toBe("old");
    expect(r.confirmed_by).toEqual(["p2"]);
    expect(r.answered_groups).toEqual(["g2"]);
  });
  it("lets a new tag displace a legacy winner", () => {
    const r = resolvePin({
      claims: { g2: tag("new", 3, 1) },
      legacy: { player_id: "old", distance_ft: 8 },
    });
    expect(r.player_id).toBe("new");
  });
  it("tells an untagged hole the field played apart from one nobody reached", () => {
    const asked = resolvePin({ claims: { g1: { kind: "pass" }, g2: { kind: "pass" } } });
    expect(asked.player_id).toBeNull();
    expect(asked.answered_groups).toHaveLength(2);

    const untouched = resolvePin({});
    expect(untouched.player_id).toBeNull();
    expect(untouched.answered_groups).toHaveLength(0);
  });
  it("folds confirmations written under both shapes into one list", () => {
    const r = resolvePin({
      claims: { g2: { kind: "confirm", by: "p2" }, g3: { kind: "confirm", by: "p3" } },
      legacy: { player_id: "x", confirmed_by: ["p1", "p2"] },
    });
    expect(r.confirmed_by).toEqual(["p1", "p2", "p3"]);
  });
  it("survives a document with nothing usable in it", () => {
    expect(() => resolvePin({ claims: "rubbish", legacy: null })).not.toThrow();
    expect(resolvePin({ claims: "rubbish" }).player_id).toBeNull();
  });
});

describe("canTakePin agrees with winningClaim", () => {
  // If these two ever disagree the prompt offers a tag the board refuses.
  const leader = { leaderFt: 7, leaderOrder: 2 };
  it("offers a strictly shorter ball", () => {
    expect(canTakePin({ ...leader, myFt: 6, myOrder: 5 })).toBe(true);
  });
  it("refuses a longer one", () => {
    expect(canTakePin({ ...leader, myFt: 8, myOrder: 0 })).toBe(false);
  });
  it("offers a tie to the group that played first, and only to them", () => {
    expect(canTakePin({ ...leader, myFt: 7, myOrder: 1 })).toBe(true);
    expect(canTakePin({ ...leader, myFt: 7, myOrder: 3 })).toBe(false);
    // and what it offers is what the board then awards
    expect(winningClaim({ g2: tag("them", 7, 2), g1: tag("us", 7, 1) }).playerId).toBe("us");
  });
  it("refuses a tie it cannot order, rather than guessing", () => {
    expect(canTakePin({ leaderFt: 7, leaderOrder: null, myFt: 7, myOrder: 1 })).toBe(false);
    expect(canTakePin({ ...leader, myFt: 7, myOrder: null })).toBe(false);
  });
  it("treats an undecided wheel as unanswered, not as beating it", () => {
    expect(canTakePin({ ...leader, myFt: null, myOrder: 0 })).toBe(false);
  });
  it("lets anything take an untagged pin", () => {
    expect(canTakePin({ leaderFt: null, leaderOrder: null, myFt: 40, myOrder: null })).toBe(true);
  });
});

describe("groupLabel", () => {
  it("counts from one, and names an unknown group without pretending", () => {
    expect(groupLabel(0)).toBe("Group 1");
    expect(groupLabel(null)).toBe("another group");
  });
});

// ── A hole-in-one — zero feet ────────────────────────────────────────
// Zero is a legitimate distance (the ball is IN the hole) and it is falsy in
// JS, which is exactly the shape of bug that slips past a quick `if (!ft)`
// check. Nothing here is untested logic — `== null` guards throughout mean
// it should already work — but it is the one distance never actually
// exercised above, and it is the value most likely to break if any of these
// checks are ever rewritten as a truthiness test instead.
describe("a hole-in-one is zero feet, not no distance", () => {
  it("winningClaim: a holed tee shot beats every measured tag", () => {
    const cs = { g1: tag("ace", 0, 1), g2: tag("close", 3, 0) };
    expect(winningClaim(cs).playerId).toBe("ace");
  });

  it("winningClaim: two aces still tie on tee order, not on distance", () => {
    const cs = { g2: tag("late", 0, 2), g1: tag("early", 0, 1) };
    expect(winningClaim(cs).playerId).toBe("early");
  });

  it("canTakePin: nothing beats a standing zero except another zero played first", () => {
    const leader = { leaderFt: 0, leaderOrder: 2 };
    expect(canTakePin({ ...leader, myFt: 1, myOrder: 0 })).toBe(false);
    expect(canTakePin({ ...leader, myFt: 0, myOrder: 0 })).toBe(true);
    expect(canTakePin({ ...leader, myFt: 0, myOrder: 5 })).toBe(false);
  });

  it("resolvePin: a legacy zero distance is kept, not read as missing", () => {
    const r = resolvePin({ legacy: { player_id: "old", distance_ft: 0 } });
    expect(r.distance_ft).toBe(0);
  });
});
