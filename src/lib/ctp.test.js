import { describe, it, expect } from "vitest";
import { groupKey, groupLabel, tagAheadOfPlay } from "./ctp";

describe("groupKey", () => {
  it("is the same string however the group was listed", () => {
    expect(groupKey(["d", "a", "c", "b"])).toBe(groupKey(["a", "b", "c", "d"]));
  });

  it("is null when there is no group", () => {
    expect(groupKey([])).toBe(null);
    expect(groupKey(null)).toBe(null);
    expect(groupKey([null, undefined])).toBe(null);
  });

  it("tells two different foursomes apart", () => {
    expect(groupKey(["a", "b"])).not.toBe(groupKey(["a", "c"]));
  });
});

describe("groupLabel", () => {
  it("counts from one, the way the tee sheet does", () => {
    expect(groupLabel(0)).toBe("Group 1");
    expect(groupLabel(2)).toBe("Group 3");
  });

  it("has something to say when the order is unknown", () => {
    expect(groupLabel(null)).toBe("another group");
  });
});

describe("tagAheadOfPlay", () => {
  // The case this exists for: group 2 walks off a par 3 without entering,
  // group 3 finishes the hole and tags it, and group 2 finally puts their
  // scores in twenty minutes later against a tag from behind them.
  it("flags a tag made by a group playing behind this one", () => {
    expect(tagAheadOfPlay({ leaderOrder: 2, myOrder: 1 })).toEqual({
      leaderOrder: 2,
      label: "Group 3",
    });
  });

  it("says nothing when the tag came from a group ahead", () => {
    expect(tagAheadOfPlay({ leaderOrder: 0, myOrder: 1 })).toBe(null);
  });

  it("says nothing when the tag is this group's own", () => {
    expect(tagAheadOfPlay({ leaderOrder: 1, myOrder: 1 })).toBe(null);
    expect(tagAheadOfPlay({ leaderOrder: 3, leaderKey: "g", myOrder: 1, myKey: "g" })).toBe(null);
  });

  // A director's pick off the Betting tab carries no group, and neither does
  // a tag written before tags recorded one. Both are unknown, not early.
  it("says nothing when either order is unknown", () => {
    expect(tagAheadOfPlay({ leaderOrder: null, myOrder: 1 })).toBe(null);
    expect(tagAheadOfPlay({ leaderOrder: 2, myOrder: null })).toBe(null);
    expect(tagAheadOfPlay({})).toBe(null);
  });

  // Two matches riding in the same group answer the same question from the
  // same tee, so neither can be behind the other.
  it("says nothing between two matches in one group", () => {
    expect(tagAheadOfPlay({ leaderOrder: 2, leaderKey: "x", myOrder: 2, myKey: "y" })).toBe(null);
  });
});
