// Grouping — the half of a round's setup that says who walks to the first tee
// together. Most of lib/groups is exercised through the screens; what is
// pinned here is the part a format can get WRONG without anything downstream
// noticing, because who rode with whom changes no score.
import { describe, it, expect } from "vitest";
import {
  splitEvenly, autoBuildGroups, formatGroupsByTeam, isFoursomeFormat,
  groupIssues, hasGroupIssues, sidesInRound, GROUP_TARGET,
} from "./groups";

const A8 = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"];
const B8 = ["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8"];
const wholeSide = (a = A8, b = B8) => [{ id: "m1", teamA: a, teamB: b }];

describe("splitEvenly", () => {
  it("splits a full side into foursomes", () => {
    expect(splitEvenly(A8)).toEqual([["a1", "a2", "a3", "a4"], ["a5", "a6", "a7", "a8"]]);
  });

  it("takes the bigger group first when the side is odd", () => {
    expect(splitEvenly(A8.slice(0, 7))).toEqual([["a1", "a2", "a3", "a4"], ["a5", "a6", "a7"]]);
  });

  // Greedy four-at-a-time would leave a man teeing off on his own.
  it("balances rather than stranding a single", () => {
    expect(splitEvenly(A8.slice(0, 5))).toEqual([["a1", "a2", "a3"], ["a4", "a5"]]);
    expect(splitEvenly(A8.slice(0, 6))).toEqual([["a1", "a2", "a3"], ["a4", "a5", "a6"]]);
  });

  it("never exceeds a foursome", () => {
    for (let n = 1; n <= 24; n++) {
      const out = splitEvenly(Array.from({ length: n }, (_, i) => `p${i}`));
      expect(out.flat()).toHaveLength(n);
      out.forEach(g => expect(g.length).toBeLessThanOrEqual(GROUP_TARGET));
      expect(out.every(g => g.length > 0)).toBe(true);
    }
  });

  it("has nothing to say about an empty side", () => {
    expect(splitEvenly([])).toEqual([]);
    expect(splitEvenly(undefined)).toEqual([]);
  });
});

describe("formatGroupsByTeam", () => {
  it("is Team Best Ball's alone", () => {
    expect(formatGroupsByTeam("team_best_ball")).toBe(true);
    expect(formatGroupsByTeam("best_ball")).toBe(false);
    expect(formatGroupsByTeam("singles")).toBe(false);
    expect(formatGroupsByTeam(undefined)).toBe(false);
  });

  // The two questions are separate: a 2-man match IS a foursome, and it is
  // two of each side. Team Best Ball is neither.
  it("is not the same question as isFoursomeFormat", () => {
    expect(isFoursomeFormat("team_best_ball")).toBe(false);
    expect(formatGroupsByTeam("best_ball")).toBe(false);
  });
});

describe("autoBuildGroups — Team Best Ball", () => {
  const built = () => autoBuildGroups({ formatId: "team_best_ball", matches: wholeSide() });

  it("puts four teammates in every foursome", () => {
    const groups = built();
    expect(groups).toHaveLength(4);
    groups.forEach(g => {
      expect(g).toHaveLength(4);
      const sides = new Set(g.map(pid => pid[0]));
      expect(sides.size).toBe(1);
    });
  });

  it("alternates the sides down the tee sheet", () => {
    expect(built().map(g => g[0][0])).toEqual(["a", "b", "a", "b"]);
  });

  it("draws every player exactly once", () => {
    const all = built().flat();
    expect(all).toHaveLength(16);
    expect(new Set(all).size).toBe(16);
  });

  it("keeps foursomes teammates on an odd side", () => {
    const groups = autoBuildGroups({
      formatId: "team_best_ball",
      matches: wholeSide(A8.slice(0, 7), B8.slice(0, 7)),
    });
    expect(groups.map(g => g.length)).toEqual([4, 4, 3, 3]);
    groups.forEach(g => expect(new Set(g.map(pid => pid[0])).size).toBe(1));
  });

  // The regression this exists for: the old builder interleaved the sides, so
  // every foursome went out 2v2 and the closing round was drawn as if it were
  // a 2-man format.
  it("does not interleave opponents", () => {
    expect(built()[0]).toEqual(["a1", "a2", "a3", "a4"]);
  });
});

describe("autoBuildGroups — the other shapes are unchanged", () => {
  it("makes one foursome per 2-man match, opponents alternating", () => {
    expect(autoBuildGroups({
      formatId: "best_ball",
      matches: [{ id: "m1", teamA: ["a1", "a2"], teamB: ["b1", "b2"] }],
    })).toEqual([["a1", "b1", "a2", "b2"]]);
  });

  it("rides two singles matches together", () => {
    expect(autoBuildGroups({
      formatId: "singles",
      matches: [
        { id: "m1", teamA: ["a1"], teamB: ["b1"] },
        { id: "m2", teamA: ["a2"], teamB: ["b2"] },
      ],
    })).toEqual([["a1", "b1", "a2", "b2"]]);
  });
});

describe("sidesInRound", () => {
  it("reads each player's side off the draw", () => {
    const side = sidesInRound(wholeSide(["a1"], ["b1"]));
    expect(side.get("a1")).toBe("A");
    expect(side.get("b1")).toBe("B");
    expect(side.get("nobody")).toBeUndefined();
  });
});

describe("groupIssues — mixed foursomes", () => {
  const matches = wholeSide();

  it("flags a group holding both sides on a teammate format", () => {
    const groups = [["a1", "a2", "a3", "b1"], ["a4", "a5", "a6", "a7"]];
    const issues = groupIssues({ groups, matches, formatId: "team_best_ball" });
    expect(issues.mixed).toEqual([0]);
    expect(hasGroupIssues(issues)).toBe(true);
  });

  it("says nothing about a clean teammate draw", () => {
    const groups = autoBuildGroups({ formatId: "team_best_ball", matches });
    expect(groupIssues({ groups, matches, formatId: "team_best_ball" }).mixed).toEqual([]);
  });

  // A 2v2 foursome is both sides by definition — flagging it would put every
  // round of the week in CHECK.
  it("is silent for every other format", () => {
    const groups = [["a1", "b1", "a2", "b2"]];
    const twoMan = [{ id: "m1", teamA: ["a1", "a2"], teamB: ["b1", "b2"] }];
    expect(groupIssues({ groups, matches: twoMan, formatId: "best_ball" }).mixed).toEqual([]);
    expect(groupIssues({ groups, matches: twoMan }).mixed).toEqual([]);
  });

  it("does not call an empty tee time mixed", () => {
    const issues = groupIssues({ groups: [[], []], matches: [], formatId: "team_best_ball" });
    expect(issues.mixed).toEqual([]);
  });
});
