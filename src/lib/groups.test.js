// Grouping — the half of a round's setup that says who walks to the first tee
// together. Most of lib/groups is exercised through the screens; what is
// pinned here is the part a format can get WRONG without anything downstream
// noticing, because who rode with whom changes no score.
import { describe, it, expect } from "vitest";
import {
  splitEvenly, autoBuildGroups, formatGroupsByTeam, isFoursomeFormat, groupIssues, hasGroupIssues, sidesInRound, GROUP_TARGET, assignPlayersToGroup, groupSizeAfter, groupFitsAfter, scoringUnits, unitForPlayer, readableUnits, swapPlayersInDraw, isForeignGroupEdit, teeSlotCount, TEE_SLOTS,
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

// ── groupIssues — the checks besides mixed/oversized ───────────────
// `mixed` and `oversized` are pinned above; the other four checks the same
// function makes were otherwise untested.
describe("groupIssues — the other checks", () => {
  const matches = [
    { id: "m1", teamA: ["a1", "a2"], teamB: ["b1", "b2"] },
    { id: "m2", teamA: ["a3", "a4"], teamB: ["b3", "b4"] },
  ];

  it("flags a player sitting in two groups at once — he can only tee off once", () => {
    const groups = [["a1", "b1"], ["a1", "a2", "b1", "b2"]];
    const issues = groupIssues({ groups, matches });
    expect(issues.duplicated).toEqual(["a1", "b1"]);
    expect(hasGroupIssues(issues)).toBe(true);
  });

  it("flags a player who has a match but no tee time", () => {
    const groups = [["a1", "b1"]];   // a2/b2 never assigned
    const issues = groupIssues({ groups, matches: [matches[0]] });
    expect(issues.unassigned).toEqual(["a2", "b2"]);
  });

  it("flags a player on a tee time who isn't playing a match this round", () => {
    const groups = [["a1", "b1", "a2", "b2", "z9"]];
    const issues = groupIssues({ groups, matches: [matches[0]] });
    expect(issues.unmatched).toEqual(["z9"]);
  });

  it("flags a 2-man match small enough to ride together that has been split across tee times", () => {
    const groups = [["a1"], ["b1"]];
    const issues = groupIssues({ groups, matches: [matches[0]] });
    expect(issues.split).toEqual([matches[0]]);
  });

  it("does not call an entirely ungrouped match split — there is nowhere for it to disagree with itself", () => {
    const issues = groupIssues({ groups: [[], []], matches: [matches[0]] });
    expect(issues.split).toEqual([]);
  });

  it("has nothing to say about an empty round with no groups drawn yet", () => {
    const issues = groupIssues({ groups: [], matches: [] });
    expect(hasGroupIssues(issues)).toBe(false);
    expect(issues).toMatchObject({
      mixed: [], unassigned: [], duplicated: [], unmatched: [], split: [], oversized: [],
    });
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

  // ── Singles ────────────────────────────────────────────────────
  // Two 1v1 matches ride together — autoBuildGroups has always drawn it that
  // way — and the four of them mark each other's cards. The unit is the tee
  // group, so one phone holds the foursome instead of two phones holding two
  // men each and neither seeing the other pair.
  const S3 = { id: "m3", round: 3, teamA: ["a1"], teamB: ["b1"] };
  const S4 = { id: "m4", round: 3, teamA: ["a2"], teamB: ["b2"] };
  const S_GROUPS = [["a1", "b1", "a2", "b2"], ["a3", "b3", "a4", "b4"]];

  it("draws a singles match as its whole tee group", () => {
    const units = scoringUnits({ match: S3, groups: S_GROUPS, formatId: "singles" });
    expect(units).toHaveLength(1);
    expect(units[0].pids).toEqual(["a1", "b1", "a2", "b2"]);
    expect(units[0].groupIdx).toBe(0);
  });

  // Keyed on the GROUP, so both matches in it resolve to the same screen and
  // walking between them does not restart the hole machinery keyed on it.
  it("gives both matches in a group the same unit key", () => {
    const a = scoringUnits({ match: S3, groups: S_GROUPS, formatId: "singles" })[0];
    const b = scoringUnits({ match: S4, groups: S_GROUPS, formatId: "singles" })[0];
    expect(a.key).toBe(b.key);
    expect(a.pids).toEqual(b.pids);
  });

  it("puts a match in the second group on that group, not the first", () => {
    const m = { id: "m5", round: 3, teamA: ["a3"], teamB: ["b3"] };
    const u = scoringUnits({ match: m, groups: S_GROUPS, formatId: "singles" })[0];
    expect(u.pids).toEqual(["a3", "b3", "a4", "b4"]);
    expect(u.groupIdx).toBe(1);
  });

  // Nothing to pair with is not a reason to invent a pairing out of the
  // roster: the draw is the only thing that says who rides with whom.
  it("is just the match before anybody has been drawn", () => {
    const u = scoringUnits({ match: S3, groups: [], formatId: "singles" })[0];
    expect(u).toEqual({ key: "m3", pids: ["a1", "b1"], groupIdx: null });
  });

  it("is just the match when it has a tee to itself", () => {
    const u = scoringUnits({ match: S3, groups: [["a1", "b1"]], formatId: "singles" })[0];
    expect(u).toEqual({ key: "m3", pids: ["a1", "b1"], groupIdx: 0 });
  });

  // A 1v1 whose two men were drawn into different groups is a draw error the
  // admin screen already flags. Picking one of the two groups to show would
  // be answering it.
  it("does not pick a group for a match the draw split", () => {
    const u = scoringUnits({ match: S3, groups: [["a1", "a2"], ["b1", "b2"]], formatId: "singles" })[0];
    expect(u.pids).toEqual(["a1", "b1"]);
    expect(u.groupIdx).toBeNull();
  });

  // A threeball — a director part-way through building the tee sheet. The
  // group is still the unit; the Scoring tab draws whatever matches it can
  // resolve out of it and leaves the stray man to the phone that has him.
  it("takes an odd group at its word", () => {
    const u = scoringUnits({ match: S3, groups: [["a1", "b1", "a2"]], formatId: "singles" })[0];
    expect(u.pids).toEqual(["a1", "b1", "a2"]);
    expect(u.groupIdx).toBe(0);
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

// ── The sealed round's picker ──────────────────────────────────────
// The closing round is played in the dark (see lib/reveal), and the Scoring
// tab's exception — somebody has to write the numbers down — was written for
// a mixed FOURSOME, not for a licence to walk the whole draw. These pin the
// filter and, more importantly, the FLOOR: `scoringUnits` hands back one unit
// holding the entire match when a round is undrawn, which is the state the
// closing round is in until a director builds the tee waves.
describe("readableUnits", () => {
  const match = { id: "m1", teamA: A8, teamB: B8 };
  // A reader on side A: everybody on B is the other side.
  const otherSide = (pid) => B8.includes(pid);
  const drawn = [
    { key: "m1#0", pids: ["a1", "a2", "a3", "a4"], groupIdx: 0 },
    { key: "m1#1", pids: ["a5", "a6", "a7", "a8"], groupIdx: 1 },
    { key: "m1#2", pids: ["b1", "b2", "b3", "b4"], groupIdx: 2 },
    { key: "m1#3", pids: ["b5", "b6", "b7", "b8"], groupIdx: 3 },
  ];

  it("is inert on a round nobody sealed", () => {
    const { open, floor } = readableUnits({ units: drawn, sealed: false, otherSide });
    expect(open).toBe(drawn);
    expect(floor).toBe(drawn[0]);
  });

  it("offers a sealed round only the reader's own side's waves", () => {
    const { open } = readableUnits({ units: drawn, sealed: true, otherSide });
    expect(open.map(u => u.key)).toEqual(["m1#0", "m1#1"]);
  });

  it("withholds a wave drawn across both sides rather than half-showing it", () => {
    const mixed = [{ key: "m1#0", pids: ["a1", "a2", "b1", "b2"], groupIdx: 0 }];
    const { open } = readableUnits({ units: mixed, sealed: true, otherSide });
    expect(open).toEqual([]);
  });

  // THE REGRESSION. An undrawn closing round is one unit holding all sixteen,
  // so the filter above empties and the floor is the only thing left standing
  // between a player and the other side's cards.
  it("cuts the floor to the reader's own side on an undrawn sealed round", () => {
    const undrawn = scoringUnits({ match, groups: [], formatId: "team_best_ball" });
    expect(undrawn).toHaveLength(1);
    expect(undrawn[0].pids).toHaveLength(16);   // the hazard, stated

    const { open, floor } = readableUnits({ units: undrawn, sealed: true, otherSide });
    expect(open).toEqual([]);                    // nothing wholly his own
    expect(floor.pids).toEqual(A8);              // ...so the floor is his eight
    expect(floor.pids.some(pid => B8.includes(pid))).toBe(false);
    expect(floor.key).toBe("m1");                // and it is still that unit
  });

  it("cuts the floor for a side B reader the same way", () => {
    const undrawn = scoringUnits({ match, groups: [], formatId: "team_best_ball" });
    const { floor } = readableUnits({
      units: undrawn, sealed: true, otherSide: (pid) => A8.includes(pid),
    });
    expect(floor.pids).toEqual(B8);
  });

  it("leaves the floor whole when it is already the reader's own side", () => {
    const { floor } = readableUnits({ units: drawn, sealed: true, otherSide });
    expect(floor).toBe(drawn[0]);
  });

  it("never hands back a pid from the other side, on any shape", () => {
    // The invariant rather than a case list: whatever `open` and `floor` come
    // back as, nothing in either may belong to the other side.
    [drawn, scoringUnits({ match, groups: [], formatId: "team_best_ball" }),
      [{ key: "m1#none", pids: ["a1", "b1"], groupIdx: null }]].forEach((units) => {
      const { open, floor } = readableUnits({ units, sealed: true, otherSide });
      open.forEach(u => u.pids.forEach(pid => expect(otherSide(pid)).toBe(false)));
      (floor?.pids || []).forEach(pid => expect(otherSide(pid)).toBe(false));
    });
  });

  it("survives an empty draw and a missing unit list", () => {
    expect(readableUnits({ units: [], sealed: true, otherSide })).toEqual({ open: [], floor: null });
    expect(readableUnits({ units: null, sealed: true, otherSide })).toEqual({ open: [], floor: null });
  });
});


// ── Correcting a pairing ────────────────────────────────────────────
// The verb the Matches tab was missing. What is pinned is that a swap is a
// straight substitution: every match and every tee time keeps its exact size,
// because the alternative — delete and rebuild — is what this replaced and it
// moved men off their tee times as a side effect.
describe("swapPlayersInDraw", () => {
  const draw = () => ({
    matches: [
      { id: "m1", round: 1, teamA: ["a1", "a2"], teamB: ["b1", "b2"] },
      { id: "m2", round: 1, teamA: ["a3", "a4"], teamB: ["b3", "b4"] },
    ],
    groups: [["a1", "b1", "a2", "b2"], ["a3", "b3", "a4", "b4"]],
  });

  it("trades two players between two matches, and their tee times with them", () => {
    const { matches, groups } = swapPlayersInDraw({ ...draw(), a: "a2", b: "a3" });
    expect(matches).toEqual([
      { id: "m1", teamA: ["a1", "a3"], teamB: ["b1", "b2"] },
      { id: "m2", teamA: ["a2", "a4"], teamB: ["b3", "b4"] },
    ]);
    expect(groups).toEqual([["a1", "b1", "a3", "b2"], ["a2", "b3", "a4", "b4"]]);
  });

  it("returns PATCHES, never the match it was handed", () => {
    // The matches this is given are App's enriched ones — they carry the
    // round's nassau pots and form of play for the leaderboard to price
    // against. Handing one back whole is how a stale copy of the round's
    // setup ends up stored on a match document.
    const enriched = [{
      id: "m1", round: 1, teamA: ["a1", "a2"], teamB: ["b1", "b2"],
      nassau: { front: 1 }, scoring_type: "match", matchNumber: 3,
    }];
    const { matches } = swapPlayersInDraw({ matches: enriched, groups: [], a: "a1", b: "a2" });
    expect(Object.keys(matches[0]).sort()).toEqual(["id", "teamA", "teamB"]);
  });

  it("substitutes a man who is not in the draw at all", () => {
    // The late arrival / the man who cannot play. One match changes, and the
    // outgoing player simply has no seat afterwards.
    const { matches, groups } = swapPlayersInDraw({ ...draw(), a: "a2", b: "sub" });
    expect(matches).toEqual([{ id: "m1", teamA: ["a1", "sub"], teamB: ["b1", "b2"] }]);
    expect(groups[0]).toEqual(["a1", "b1", "sub", "b2"]);
    expect(groups.flat()).not.toContain("a2");
  });

  it("never changes the size of a match or of a tee time", () => {
    const before = draw();
    const { groups } = swapPlayersInDraw({ ...before, a: "a1", b: "b4" });
    expect(groups.map(g => g.length)).toEqual(before.groups.map(g => g.length));
    const { matches } = swapPlayersInDraw({ ...before, a: "a1", b: "b4" });
    matches.forEach(m => expect(m.teamA.length + m.teamB.length).toBe(4));
  });

  it("is a no-op for a missing or self-directed swap", () => {
    const before = draw();
    [["a1", "a1"], ["a1", null], [null, "a1"]].forEach(([a, b]) => {
      const out = swapPlayersInDraw({ ...before, a, b });
      expect(out.matches).toEqual([]);
      expect(out.groups).toEqual(before.groups);
    });
  });
});


// ── Two directors on two devices ────────────────────────────────────
// A round's groups are one document written whole, so a concurrent edit is
// last-write-wins and the loser's drag undoes itself on screen with nothing
// said. It is not prevented — a transaction would reject with no signal and
// take the tee sheet down on a golf course — so what is pinned here is that
// it gets SAID, and that it stays quiet the rest of the time.
describe("isForeignGroupEdit", () => {
  const base = { writer: "them", clientId: "me", lastWriter: "me", edited: true };

  it("speaks up when somebody else writes a sheet this session has edited", () => {
    expect(isForeignGroupEdit(base)).toBe(true);
  });

  it("says nothing about this session's own writes", () => {
    expect(isForeignGroupEdit({ ...base, writer: "me" })).toBe(false);
  });

  it("says nothing to a director who has not touched this round", () => {
    // Somebody else building a draw is not news until something of yours is
    // at stake.
    expect(isForeignGroupEdit({ ...base, edited: false })).toBe(false);
  });

  it("says it once per handover, not once per snapshot", () => {
    expect(isForeignGroupEdit({ ...base, lastWriter: "them" })).toBe(false);
  });

  it("says nothing about a document written before the stamp existed", () => {
    [undefined, null, ""].forEach(writer => {
      expect(isForeignGroupEdit({ ...base, writer })).toBe(false);
    });
  });
});

// ── A fifth tee time ────────────────────────────────────────────────
describe("teeSlotCount", () => {
  it("floors at the four the Formats tab always writes", () => {
    expect(teeSlotCount({ tr: { tee_time: "" }, groups: [] })).toBe(TEE_SLOTS);
    expect(teeSlotCount({ tr: { tee_time: "8:00|8:10" }, groups: [] })).toBe(TEE_SLOTS);
  });

  it("grows with the times a director has typed", () => {
    expect(teeSlotCount({ tr: { tee_time: "8:00|8:10|8:20|8:30|8:40" }, groups: [] })).toBe(5);
    expect(teeSlotCount({ tr: { tee_time: "8:00|8:10|8:20|8:30|8:40|8:50" }, groups: [] })).toBe(6);
  });

  it("never drops below the groups that already exist", () => {
    // A tee time removed out from under an occupied wave would take four men
    // off the sheet with it.
    expect(teeSlotCount({
      tr: { tee_time: "8:00|8:10|8:20|8:30" },
      groups: [[], [], [], [], ["a1", "a2", "a3", "a4"]],
    })).toBe(5);
  });
});
