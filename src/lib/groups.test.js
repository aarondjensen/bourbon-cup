// Grouping — the half of a round's setup that says who walks to the first tee
// together. Most of lib/groups is exercised through the screens; what is
// pinned here is the part a format can get WRONG without anything downstream
// noticing, because who rode with whom changes no score.
import { describe, it, expect } from "vitest";
import {
  splitEvenly, autoBuildGroups, formatGroupsByTeam, isFoursomeFormat, groupIssues, hasGroupIssues, sidesInRound, GROUP_TARGET, assignPlayersToGroup, groupSizeAfter, groupFitsAfter, scoringUnits, unitForPlayer,
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

// ── Filling a foursome by hand ─────────────────────────────────────
// The manual road. Everything above builds a draw FROM the matches; this is
// the director putting four named men on a tee time because that is who is
// walking together, which is the only way to do it in a format whose match is
// the whole side.
describe("assignPlayersToGroup", () => {
  it("fills an empty tee time with the players given", () => {
    const out = assignPlayersToGroup({ groups: [[], []], pids: ["a1", "a2", "b1", "b2"], gi: 0 });
    expect(out).toEqual([["a1", "a2", "b1", "b2"], []]);
  });

  it("keeps the order they were tapped in", () => {
    const out = assignPlayersToGroup({ groups: [[]], pids: ["b2", "a1", "b1"], gi: 0 });
    expect(out[0]).toEqual(["b2", "a1", "b1"]);
  });

  it("adds to whoever is already on the time", () => {
    const out = assignPlayersToGroup({ groups: [["a1"]], pids: ["a2"], gi: 0 });
    expect(out).toEqual([["a1", "a2"]]);
  });

  // The one guarantee that matters: a man tees off once. Moving him somewhere
  // else has to take him out of where he was, or the draw quietly grows a
  // duplicate that only groupIssues would ever mention.
  it("moves players out of the group they were in", () => {
    const out = assignPlayersToGroup({
      groups: [["a1", "a2", "a3"], ["b1"]], pids: ["a1", "a3"], gi: 1,
    });
    expect(out).toEqual([["a2"], ["b1", "a1", "a3"]]);
  });

  it("never leaves a player in two groups", () => {
    const out = assignPlayersToGroup({
      groups: [["a1", "a2"], ["a3", "a4"], []], pids: ["a1", "a3"], gi: 2,
    });
    const all = out.flat();
    expect(new Set(all).size).toBe(all.length);
    expect(out[2]).toEqual(["a1", "a3"]);
  });

  it("ungroups on a negative index", () => {
    const out = assignPlayersToGroup({ groups: [["a1", "a2"]], pids: ["a1"], gi: -1 });
    expect(out).toEqual([["a2"]]);
  });

  // A round has the tee time whether or not this document has mentioned it
  // yet — same rule assignMatchToGroup follows.
  it("opens the list up to a later tee time", () => {
    const out = assignPlayersToGroup({ groups: [["a1"]], pids: ["a2"], gi: 3 });
    expect(out).toEqual([["a1"], [], [], ["a2"]]);
  });

  it("is a no-op with nothing selected", () => {
    const groups = [["a1"], ["b1"]];
    expect(assignPlayersToGroup({ groups, pids: [], gi: 0 })).toEqual(groups);
    expect(assignPlayersToGroup({ groups, pids: undefined, gi: 0 })).toEqual(groups);
  });

  it("survives an empty draw", () => {
    expect(assignPlayersToGroup({ groups: undefined, pids: ["a1"], gi: 0 })).toEqual([["a1"]]);
  });

  // Building a whole Team Best Ball tee sheet by hand, which is the case this
  // exists for: four waves of four teammates, nobody riding twice.
  it("builds a teammate tee sheet a wave at a time", () => {
    let groups = [[], [], [], []];
    const waves = [
      ["a1", "a2", "a3", "a4"],
      ["b1", "b2", "b3", "b4"],
      ["a5", "a6", "a7", "a8"],
      ["b5", "b6", "b7", "b8"],
    ];
    waves.forEach((w, i) => { groups = assignPlayersToGroup({ groups, pids: w, gi: i }); });
    expect(groups).toEqual(waves);
    const issues = groupIssues({ groups, matches: wholeSide(), formatId: "team_best_ball" });
    expect(hasGroupIssues(issues)).toBe(false);
  });
});

// ── Four go off at a time ──────────────────────────────────────────
// The cap the by-hand editor labels its buttons from and refuses on. It has
// to be ONE predicate: a screen that says a tee time has room and a tap that
// then refuses is worse than either answer on its own.
describe("groupSizeAfter / groupFitsAfter", () => {
  it("counts the players moving in", () => {
    expect(groupSizeAfter({ group: ["a1", "a2"], pids: ["b1"] })).toBe(3);
    expect(groupFitsAfter({ group: ["a1", "a2"], pids: ["b1"] })).toBe(true);
  });

  it("fills a tee time to exactly four", () => {
    expect(groupFitsAfter({ group: [], pids: ["a1", "a2", "a3", "a4"] })).toBe(true);
    expect(groupSizeAfter({ group: [], pids: ["a1", "a2", "a3", "a4"] })).toBe(GROUP_TARGET);
  });

  it("refuses the fifth", () => {
    expect(groupFitsAfter({ group: ["a1", "a2", "a3", "a4"], pids: ["b1"] })).toBe(false);
    expect(groupFitsAfter({ group: ["a1", "a2"], pids: ["b1", "b2", "b3"] })).toBe(false);
  });

  // The case a naive length + length gets wrong: re-dropping men who are
  // already here changes nothing, so it cannot be refused.
  it("does not double-count a player already on the time", () => {
    expect(groupSizeAfter({ group: ["a1", "a2", "a3", "a4"], pids: ["a1", "a2"] })).toBe(4);
    expect(groupFitsAfter({ group: ["a1", "a2", "a3", "a4"], pids: ["a1", "a2"] })).toBe(true);
  });

  it("counts a swap within one tee time as a swap", () => {
    // Three already here, four lifted, three of them the same men: lands at 4.
    expect(groupSizeAfter({ group: ["a1", "a2", "a3"], pids: ["a1", "a2", "a3", "b1"] })).toBe(4);
    expect(groupFitsAfter({ group: ["a1", "a2", "a3"], pids: ["a1", "a2", "a3", "b1"] })).toBe(true);
  });

  it("is empty-safe at both ends", () => {
    expect(groupSizeAfter({ group: undefined, pids: undefined })).toBe(0);
    expect(groupFitsAfter({ group: [], pids: [] })).toBe(true);
  });

  // Auto-build has to produce a sheet the by-hand editor would accept, or the
  // two halves of the tab disagree about what a tee time holds.
  it("accepts every group Auto-build makes for a full field", () => {
    const built = autoBuildGroups({ formatId: "team_best_ball", matches: wholeSide() });
    built.forEach(g => expect(groupFitsAfter({ group: [], pids: g })).toBe(true));
  });
});

describe("groupIssues — oversized", () => {
  // Nothing in the app can build one now, so this names a group that arrived
  // some other way: a document written before the cap, or a console edit.
  it("names a group of five", () => {
    const groups = [["a1", "a2", "a3", "a4", "a5"]];
    const issues = groupIssues({ groups, matches: wholeSide(), formatId: "team_best_ball" });
    expect(issues.oversized).toEqual([{ i: 0, n: 5 }]);
    expect(hasGroupIssues(issues)).toBe(true);
  });

  it("says nothing about a foursome", () => {
    const groups = [["a1", "a2", "a3", "a4"]];
    expect(groupIssues({ groups, matches: wholeSide() }).oversized).toEqual([]);
  });
});

// ── scoringUnits ──────────────────────────────────────────────────
// What one phone shows. The bug this exists for: the closing round is one
// match holding the whole roster, and the Scoring tab drew all sixteen score
// cards on it.
describe("scoringUnits", () => {
  const A8 = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"];
  const B8 = ["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8"];
  // The real round-4 tee sheet: a side splits into waves, nobody rides with
  // an opponent.
  const R4_GROUPS = [
    ["a1", "a2", "a3", "a4"],
    ["b1", "b2", "b3", "b4"],
    ["a5", "a6", "a7", "a8"],
    ["b5", "b6", "b7", "b8"],
  ];
  const teamMatch = { id: "m4", round: 4, teamA: A8, teamB: B8 };

  it("splits a team match into its tee groups, in tee order", () => {
    const units = scoringUnits({ match: teamMatch, groups: R4_GROUPS, formatId: "team_best_ball" });
    expect(units).toHaveLength(4);
    expect(units.map(u => u.groupIdx)).toEqual([0, 1, 2, 3]);
    expect(units[0].pids).toEqual(["a1", "a2", "a3", "a4"]);
    expect(units[3].pids).toEqual(["b5", "b6", "b7", "b8"]);
    // Nobody appears twice, and nobody is dropped.
    expect(units.flatMap(u => u.pids).sort()).toEqual([...A8, ...B8].sort());
  });

  it("keeps every unit inside a foursome", () => {
    scoringUnits({ match: teamMatch, groups: R4_GROUPS, formatId: "team_best_ball" })
      .forEach(u => expect(u.pids.length).toBeLessThanOrEqual(4));
  });

  // The whole point of the shape: rounds 1-3 must not move.
  it("leaves a 2-man match as one unit", () => {
    const m = { id: "m1", round: 1, teamA: ["a1", "a2"], teamB: ["b1", "b2"] };
    const units = scoringUnits({ match: m, groups: [["a1", "a2", "b1", "b2"]], formatId: "best_ball" });
    expect(units).toEqual([{ key: "m1", pids: ["a1", "a2", "b1", "b2"], groupIdx: 0 }]);
  });

  // A 2-man match spread over two tee times is a draw error the admin screen
  // already flags. Halving the card on the course is not the fix for it.
  it("does not split a 2-man match that the draw broke", () => {
    const m = { id: "m1", round: 1, teamA: ["a1", "a2"], teamB: ["b1", "b2"] };
    const units = scoringUnits({ match: m, groups: [["a1", "a2"], ["b1", "b2"]], formatId: "best_ball" });
    expect(units).toHaveLength(1);
    expect(units[0].pids).toEqual(["a1", "a2", "b1", "b2"]);
    expect(units[0].groupIdx).toBeNull();
  });

  it("is one unit before anybody has been drawn", () => {
    const units = scoringUnits({ match: teamMatch, groups: [], formatId: "team_best_ball" });
    expect(units).toHaveLength(1);
    expect(units[0].pids).toHaveLength(16);
    expect(units[0].groupIdx).toBeNull();
  });

  it("gives a player the draw missed somewhere to be scored", () => {
    const partial = [["a1", "a2", "a3", "a4"], ["b1", "b2", "b3", "b4"]];
    const units = scoringUnits({ match: teamMatch, groups: partial, formatId: "team_best_ball" });
    const loose = units.find(u => u.groupIdx == null);
    expect(loose.pids).toEqual(["a5", "a6", "a7", "a8", "b5", "b6", "b7", "b8"]);
    expect(units.flatMap(u => u.pids)).toHaveLength(16);
  });

  it("is empty for no match", () => {
    expect(scoringUnits({ match: null, groups: R4_GROUPS, formatId: "team_best_ball" })).toEqual([]);
  });
});

describe("unitForPlayer", () => {
  const units = [
    { key: "m#0", pids: ["a1", "a2"], groupIdx: 0 },
    { key: "m#1", pids: ["b1", "b2"], groupIdx: 1 },
  ];

  it("finds the group the reader is walking with", () => {
    expect(unitForPlayer(units, "b2").key).toBe("m#1");
  });

  // A director who is not in this round's draw. The caller falls back to the
  // first unit and offers the picker.
  it("is null for somebody not in the match", () => {
    expect(unitForPlayer(units, "z9")).toBeNull();
    expect(unitForPlayer([], "a1")).toBeNull();
  });
});
