import { describe, it, expect } from "vitest";
import {
  scheduledRounds, resolveRoundCount, allRounds, roundsBeyondCount, clampRoundCount,
  roundWhen, roundTeeBox, DEFAULT_ROUND_COUNT, MAX_ROUND_COUNT,
} from "./rounds";

describe("scheduledRounds", () => {
  it("is empty for a tournament with nothing set up", () => {
    expect(scheduledRounds({})).toEqual([]);
    expect(scheduledRounds()).toEqual([]);
  });

  it("unions the three sources", () => {
    const rounds = scheduledRounds({
      tRounds: [{ round_number: 1 }, { round_number: 2 }],
      matches: [{ round: 2 }, { round: 3 }],
      roundLocks: { 4: { locked: true } },
    });
    expect(rounds).toEqual([1, 2, 3, 4]);
  });

  it("counts a round that exists only as a draw", () => {
    expect(scheduledRounds({ matches: [{ round: 7 }] })).toEqual([7]);
  });

  // The load-bearing case: a lock is written by the first score of a round, so
  // a locked round is one somebody has played. Losing it here would move the
  // whole field on while their scores sat in the round they were standing on.
  it("counts a round that exists only because it was played", () => {
    expect(scheduledRounds({ roundLocks: { 3: { locked: true } } })).toEqual([3]);
  });

  it("ignores a lock that was never taken", () => {
    expect(scheduledRounds({ roundLocks: { 3: { locked: false }, 4: null } })).toEqual([]);
  });

  it("sorts numerically, not lexically", () => {
    const rounds = scheduledRounds({
      matches: [{ round: 10 }, { round: 2 }, { round: 1 }],
    });
    expect(rounds).toEqual([1, 2, 10]);
  });

  it("de-duplicates across sources regardless of stored type", () => {
    // Lock keys arrive as object keys, so they are strings; a round must not
    // appear twice because two sources spelled its number differently.
    const rounds = scheduledRounds({
      tRounds: [{ round_number: 2 }],
      matches: [{ round: 2 }],
      roundLocks: { 2: { locked: true } },
    });
    expect(rounds).toEqual([2]);
  });

  // Number(null) and Number("") are both 0, so a blank round number would
  // arrive as a round zero and seat itself in front of round 1 in every
  // picker. The from-1 floor is what stops it.
  it("drops rows with no usable round number", () => {
    const rounds = scheduledRounds({
      tRounds: [{ round_number: null }, { round_number: undefined }, {}],
      matches: [{ round: 1 }, { round: "" }, { round: 0 }],
    });
    expect(rounds).toEqual([1]);
  });
});

describe("resolveRoundCount", () => {
  const four = { tRounds: [1, 2, 3, 4].map(round_number => ({ round_number })) };

  it("uses the number the director set", () => {
    expect(resolveRoundCount({ roundCount: 3, ...four })).toBe(3);
  });

  // An edition that predates the setting must read exactly as it did before
  // it existed — nobody re-enters a four they already implied.
  it("falls back to the schedule when nothing is set", () => {
    expect(resolveRoundCount(four)).toBe(4);
    expect(resolveRoundCount({ matches: [{ round: 3 }] })).toBe(3);
  });

  it("seeds a brand-new edition", () => {
    expect(resolveRoundCount({})).toBe(DEFAULT_ROUND_COUNT);
  });

  it("ignores a nonsense setting", () => {
    expect(resolveRoundCount({ roundCount: 0, ...four })).toBe(4);
    expect(resolveRoundCount({ roundCount: "", ...four })).toBe(4);
    expect(resolveRoundCount({ roundCount: null, ...four })).toBe(4);
  });

  it("caps a runaway setting", () => {
    expect(resolveRoundCount({ roundCount: 400 })).toBe(MAX_ROUND_COUNT);
  });
});

describe("clampRoundCount", () => {
  it("keeps a legal number", () => {
    expect(clampRoundCount("3")).toBe(3);
  });
  it("floors a fraction and clamps the ends", () => {
    expect(clampRoundCount("3.7")).toBe(3);
    expect(clampRoundCount(0)).toBe(1);
    expect(clampRoundCount(999)).toBe(MAX_ROUND_COUNT);
  });
  // The box shares its Save with the name and the venue, so an empty field
  // must not fail the save.
  it("lands anything unreadable on the seed", () => {
    expect(clampRoundCount("")).toBe(DEFAULT_ROUND_COUNT);
    expect(clampRoundCount("abc")).toBe(DEFAULT_ROUND_COUNT);
  });
});

describe("allRounds", () => {
  it("is the configured count, counted from 1", () => {
    expect(allRounds({ roundCount: 3 })).toEqual([1, 2, 3]);
    expect(allRounds({ roundCount: 6 })).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("reads an unconfigured tournament off its schedule", () => {
    expect(allRounds({ tRounds: [1, 2, 3].map(round_number => ({ round_number })) }))
      .toEqual([1, 2, 3]);
  });

  // The safety catch. Shortening the count must never take a round somebody
  // has played off the schedule — the live round is the lowest unfinalized
  // round in this list, so doing that mid-tournament would move the whole
  // field backwards onto a round they had already signed off.
  it("keeps a played round past the configured count", () => {
    expect(allRounds({ roundCount: 3, roundLocks: { 4: { locked: true } } }))
      .toEqual([1, 2, 3, 4]);
  });

  it("keeps a round that has a draw past the count", () => {
    expect(allRounds({ roundCount: 2, matches: [{ round: 5 }] })).toEqual([1, 2, 5]);
  });

  it("adds rounds freely when the count grows", () => {
    expect(allRounds({ roundCount: 5, tRounds: [{ round_number: 1 }] }))
      .toEqual([1, 2, 3, 4, 5]);
  });

  it("drops an empty round when the count shrinks", () => {
    const setUp = { tRounds: [1, 2, 3, 4].map(round_number => ({ round_number })) };
    // Round 4 exists as setup only — no draw, no scores — so it goes.
    expect(allRounds({ roundCount: 3, tRounds: [{ round_number: 1 }] })).toEqual([1, 2, 3]);
    // But once it is set up it is on the schedule, so it stays.
    expect(allRounds({ roundCount: 3, ...setUp })).toEqual([1, 2, 3, 4]);
  });
});

describe("roundsBeyondCount", () => {
  it("names what the schedule is holding on to", () => {
    expect(roundsBeyondCount({ roundCount: 2, roundLocks: { 3: { locked: true }, 4: { locked: true } } }))
      .toEqual([3, 4]);
  });

  it("is empty when the count covers everything", () => {
    expect(roundsBeyondCount({ roundCount: 4, matches: [{ round: 2 }] })).toEqual([]);
  });
});

// ── When a round that has no score yet goes off ────────────────────
// The two facts the group text carries the night before: which day, and what
// time the first group is out.
describe("roundWhen", () => {
  // 2026-08-14 is a Friday. Worked out arithmetically — see lib/dates — so
  // this is exact rather than dependent on the machine running the test.
  const friday = "2026-08-14";

  it("gives the weekday and the first tee time", () => {
    expect(roundWhen({ date: friday, tee_time: "8:30|8:40|8:50" }))
      .toBe("Friday · 8:30 AM");
  });

  it("takes the EARLIEST time, not the first box the director filled", () => {
    // The list is positional — group i goes off at time i — so a reordered
    // sheet leaves the morning's first time somewhere other than the front.
    expect(roundWhen({ date: friday, tee_time: "9:10|8:30|9:20" }))
      .toBe("Friday · 8:30 AM");
  });

  it("reads an empty slot as no tee time rather than as midnight", () => {
    expect(roundWhen({ date: friday, tee_time: "||9:00|9:10" }))
      .toBe("Friday · 9:00 AM");
  });

  it("says the half it has", () => {
    expect(roundWhen({ date: friday })).toBe("Friday");
    expect(roundWhen({ tee_time: "1:10" })).toBe("1:10 PM");
  });

  it("says nothing when the round has neither", () => {
    expect(roundWhen({})).toBe("");
    expect(roundWhen()).toBe("");
    // A date the app cannot read is not a weekday to guess at.
    expect(roundWhen({ date: "sometime in August" })).toBe("");
  });

  it("reads an afternoon tee time the way a golfer types it", () => {
    // parseTeeTime's rule: a bare 1–4 is the afternoon.
    expect(roundWhen({ date: friday, tee_time: "2:00" })).toBe("Friday · 2:00 PM");
  });
});

// ── Which tee, when the field is on one ───────────────────────────
// The third fact in the group text, and the one the board had no answer for.
// It only exists under One tee: a field with three men on the golds has a tee
// box per player, and naming one of them would be naming the majority and
// calling it the round.
describe("roundTeeBox", () => {
  const friday = "2026-08-14";
  const course = { tee_boxes: [{ name: "White" }, { name: "Blue" }, { name: "Gold" }] };
  const tPlayers = ["a1", "a2", "b1", "b2"].map((pid) => ({ player_id: pid }));
  const all = (tee) => ({ 3: Object.fromEntries(tPlayers.map((p) => [p.player_id, tee])) });

  it("names the tee the whole field is assigned", () => {
    expect(roundTeeBox({
      tr: { round_number: 3, uniform_tee: true }, tPlayers, course,
      teeAssignments: all("Blue"),
    })).toBe("Blue");
  });

  it("says nothing under Any tee, however uniform the assignments are", () => {
    expect(roundTeeBox({
      tr: { round_number: 3 }, tPlayers, course, teeAssignments: all("Blue"),
    })).toBe("");
  });

  it("falls back to the tee an unassigned field is already scored off", () => {
    // resolveTeeSpec's own chain: the round's tee_box, then the first box on
    // the card. A round set up in February has a course, a tee and nobody
    // entered yet, and that IS the tee the field will be on.
    expect(roundTeeBox({
      tr: { round_number: 3, uniform_tee: true }, tPlayers, course, teeAssignments: {},
    })).toBe("White");
    expect(roundTeeBox({
      tr: { round_number: 3, uniform_tee: true, tee_box: "Gold" }, tPlayers, course,
      teeAssignments: {},
    })).toBe("Gold");
    expect(roundTeeBox({
      tr: { round_number: 3, uniform_tee: true }, tPlayers: [], course, teeAssignments: {},
    })).toBe("White");
  });

  it("says nothing when the field has drifted off its one tee", () => {
    // A man added to the roster after the switch was set is still on the
    // round's fallback, so there is no one word for where the field is.
    const drifted = all("Blue");
    drifted[3].c1 = undefined;
    expect(roundTeeBox({
      tr: { round_number: 3, uniform_tee: true },
      tPlayers: [...tPlayers, { player_id: "c1" }],
      course, teeAssignments: drifted,
    })).toBe("");
  });

  it("answers from a locked round's frozen snapshot", () => {
    // getRoundTee is the one door every stroke dot goes through, so the board
    // can never print a tee the strokes were not calculated against.
    expect(roundTeeBox({
      tr: { round_number: 3, uniform_tee: true }, tPlayers, course,
      teeAssignments: all("Blue"),
      roundLocks: {
        3: { locked: true, players: Object.fromEntries(tPlayers.map((p) => [p.player_id, { tee: "Gold" }])) },
      },
    })).toBe("Gold");
  });

  it("rides on the end of the when line, and only when there is one", () => {
    expect(roundWhen({ date: friday, tee_time: "8:30|8:40" }, { tee: "Blue" }))
      .toBe("Friday · 8:30 AM · Blue");
    expect(roundWhen({ tee_time: "8:30" }, { tee: "Blue" })).toBe("8:30 AM · Blue");
    // Nothing to ride beside: the slot answers "when does this go off", and a
    // colour on its own answers a different question. The caller's TBD is the
    // true thing to say there.
    expect(roundWhen({}, { tee: "Blue" })).toBe("");
    expect(roundWhen({ date: friday, tee_time: "8:30" }, { tee: "" }))
      .toBe("Friday · 8:30 AM");
  });
});
