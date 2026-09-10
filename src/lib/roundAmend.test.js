import { describe, it, expect } from "vitest";
import {
  amendableRoundNumbers,
  wasAmended,
  amendNeedsRefresh,
  describeAmendImpact,
  amendImpactLines,
  describeRefreshImpact,
  recordAmendment,
  describeAmendment,
} from "./roundAmend";
import { scoringRoundNumber } from "./roundLocks";

// A lock map of the shape App maintains: { [round]: { locked, final } }.
const locks = (...finalRounds) =>
  Object.fromEntries(finalRounds.map(r => [r, { locked: true, final: true }]));

const R4 = [1, 2, 3, 4];

describe("amendableRoundNumbers", () => {
  it("is every FINAL round, not merely the most recent", () => {
    expect(amendableRoundNumbers(locks(1, 2, 3), R4)).toEqual([1, 2, 3]);
  });

  it("is empty when nothing has been finalized", () => {
    expect(amendableRoundNumbers({}, R4)).toEqual([]);
    expect(amendableRoundNumbers({ 1: { locked: true, final: false } }, R4)).toEqual([]);
  });

  // The gap this whole module exists to close: the old control pointed at
  // lastFinalRoundNumber, so Round 2 of a finished cup was unreachable.
  it("reaches a round buried behind two later finals", () => {
    expect(amendableRoundNumbers(locks(1, 2, 3, 4), R4)).toContain(2);
  });

  it("ignores finalized rounds the tournament no longer has", () => {
    expect(amendableRoundNumbers(locks(1, 2, 3, 4), [1, 2])).toEqual([1, 2]);
  });
});

describe("describeAmendImpact", () => {
  it("says the gate moves when the reopened round becomes the lowest open one", () => {
    // Rounds 1-3 final, field on 4. Reopening 1 drags scoring back to it.
    const impact = describeAmendImpact({ locks: locks(1, 2, 3), allRounds: R4, round: 1 });
    expect(impact.gateFrom).toBe(4);
    expect(impact.gateTo).toBe(1);
    expect(impact.gateMoves).toBe(true);
  });

  // The mitigation that matters on the Saturday of a dated week: today's
  // round wins, so reopening Friday does not move a single phone.
  it("says the gate holds when a dated week pins it to today's round", () => {
    const impact = describeAmendImpact({
      locks: locks(1, 2, 3), allRounds: R4, round: 1, roundToday: 4,
    });
    expect(impact.gateFrom).toBe(4);
    expect(impact.gateTo).toBe(4);
    expect(impact.gateMoves).toBe(false);
  });

  it("agrees with the gate rule App actually draws with", () => {
    const l = locks(1, 2, 3);
    const impact = describeAmendImpact({ locks: l, allRounds: R4, round: 2, roundToday: null });
    expect(impact.gateFrom).toBe(scoringRoundNumber({ locks: l, allRounds: R4 }));
  });

  it("reopens scoring on a cup that had closed out", () => {
    const impact = describeAmendImpact({ locks: locks(1, 2, 3, 4), allRounds: R4, round: 4 });
    expect(impact.gateFrom).toBe(null);   // every round final — nothing open
    expect(impact.gateTo).toBe(4);
    expect(impact.wasComplete).toBe(true);
    expect(impact.resultStale).toBe(true);
  });

  it("names the later rounds that stay final", () => {
    const impact = describeAmendImpact({ locks: locks(1, 2, 3, 4), allRounds: R4, round: 2 });
    expect(impact.laterFinals).toEqual([3, 4]);
  });

  it("refuses a round that is not final", () => {
    expect(describeAmendImpact({ locks: {}, allRounds: R4, round: 1 }).amendable).toBe(false);
    expect(describeAmendImpact({ locks: locks(1), allRounds: R4, round: 1 }).amendable).toBe(true);
  });

  it("does not mutate the lock map it is asked about", () => {
    const l = locks(1, 2);
    describeAmendImpact({ locks: l, allRounds: R4, round: 1 });
    expect(l[1].final).toBe(true);
  });
});

describe("amendImpactLines", () => {
  it("leads with the gate moving, and always says no stroke moves yet", () => {
    const lines = amendImpactLines(
      describeAmendImpact({ locks: locks(1, 2, 3), allRounds: R4, round: 1 })
    );
    expect(lines[0]).toMatch(/moves from Round 4 to Round 1/);
    expect(lines.join(" ")).toMatch(/moves no stroke until you Recalculate/);
  });

  it("says so plainly when the field is not moved", () => {
    const lines = amendImpactLines(
      describeAmendImpact({ locks: locks(1, 2, 3), allRounds: R4, round: 1, roundToday: 4 })
    );
    expect(lines[0]).toMatch(/stays on Round 4/);
  });

  it("warns that a finished cup's recorded result goes stale", () => {
    const lines = amendImpactLines(
      describeAmendImpact({ locks: locks(1, 2, 3, 4), allRounds: R4, round: 3 })
    );
    expect(lines.join(" ")).toMatch(/recorded result stays as it is/);
  });

  it("says nothing at all about a round that cannot be amended", () => {
    expect(amendImpactLines(describeAmendImpact({ locks: {}, allRounds: R4, round: 1 }))).toEqual([]);
  });
});

describe("recordAmendment", () => {
  it("counts, stamps and keeps the reason", () => {
    const next = recordAmendment({ locked: true, final: false }, { by: "Aaron J", reason: "Hole 7" });
    expect(next.amend_count).toBe(1);
    expect(next.amended_by).toBe("Aaron J");
    expect(next.amend_reason).toBe("Hole 7");
    expect(next.amend_history).toHaveLength(1);
  });

  it("accumulates across amendments rather than replacing", () => {
    const once = recordAmendment({ locked: true }, { by: "A", reason: "first" });
    const twice = recordAmendment(once, { by: "B", reason: "second" });
    expect(twice.amend_count).toBe(2);
    expect(twice.amend_reason).toBe("second");
    expect(twice.amend_history.map(h => h.reason)).toEqual(["first", "second"]);
  });

  it("caps the history so a repeatedly reopened round cannot grow unbounded", () => {
    let lock = { locked: true };
    for (let i = 0; i < 14; i++) lock = recordAmendment(lock, { reason: `r${i}` });
    expect(lock.amend_count).toBe(14);          // the count never rolls off
    expect(lock.amend_history).toHaveLength(10);
    expect(lock.amend_history[9].reason).toBe("r13");
  });

  it("survives a lock whose history is missing or the wrong shape", () => {
    expect(recordAmendment({ locked: true, amend_history: "nope" }).amend_history).toHaveLength(1);
    expect(recordAmendment(null)).toBe(null);
  });
});

describe("wasAmended / describeAmendment", () => {
  it("is false for a round nobody has reopened", () => {
    expect(wasAmended({ locked: true, final: true })).toBe(false);
    expect(describeAmendment({ locked: true })).toBe(null);
  });

  // The point of the permanent mark: a re-finalized round must never again
  // look identical to one that was closed once and left alone.
  it("stays true after the round is finalized again", () => {
    const amended = recordAmendment({ locked: true, final: false }, { by: "A", reason: "why" });
    const refinalized = { ...amended, final: true };
    expect(wasAmended(refinalized)).toBe(true);
    expect(describeAmendment(refinalized)).toMatch(/Amended once/);
  });

  it("counts repeats", () => {
    const twice = recordAmendment(recordAmendment({ locked: true }), {});
    expect(describeAmendment(twice)).toMatch(/Amended 2 times/);
  });
});

describe("amendNeedsRefresh", () => {
  const AMENDED = "2026-07-04T12:00:00.000Z";

  it("is true when the snapshot predates the amendment", () => {
    expect(amendNeedsRefresh({
      locked: true, amend_count: 1, amended_at: AMENDED,
      locked_at: "2026-07-03T10:00:00.000Z",
    })).toBe(true);
  });

  it("is false once the snapshot has been re-taken since", () => {
    expect(amendNeedsRefresh({
      locked: true, amend_count: 1, amended_at: AMENDED,
      locked_at: "2026-07-03T10:00:00.000Z",
      refreshed_at: "2026-07-04T12:30:00.000Z",
    })).toBe(false);
  });

  // A stale refresh from BEFORE the amendment must not be read as catching up.
  it("ignores a refresh older than the amendment", () => {
    expect(amendNeedsRefresh({
      locked: true, amend_count: 1, amended_at: AMENDED,
      refreshed_at: "2026-07-01T09:00:00.000Z",
    })).toBe(true);
  });

  // Finalizing again ends the amendment, whether or not it was recalculated:
  // most amendments are score corrections and need no recalculate at all.
  it("is false again once the round has been re-finalized", () => {
    expect(amendNeedsRefresh({
      locked: true, final: true, amend_count: 1, amended_at: AMENDED,
      locked_at: "2026-07-03T10:00:00.000Z",
    })).toBe(false);
  });

  it("is false for a round that was never amended, however it is locked", () => {
    expect(amendNeedsRefresh({ locked: true, locked_at: "2026-07-03T10:00:00.000Z" })).toBe(false);
    expect(amendNeedsRefresh(null)).toBe(false);
    expect(amendNeedsRefresh({ locked: false, amend_count: 1, amended_at: AMENDED })).toBe(false);
  });
});

describe("describeRefreshImpact", () => {
  const lockWith = (players) => ({ locked: true, final: false, players });

  it("reports only the handicaps that actually move", () => {
    const before = { 2: lockWith({ a: { name: "Andy H", ch: 12 }, b: { name: "Paul W", ch: 8 } }) };
    const next = lockWith({ a: { name: "Andy H", ch: 14 }, b: { name: "Paul W", ch: 8 } });
    const { rows, changed, unchanged } = describeRefreshImpact({ locks: before, round: 2, nextLock: next });
    expect(changed).toBe(1);
    expect(unchanged).toBe(1);
    expect(rows).toEqual([{ pid: "a", name: "Andy H", from: 12, to: 14 }]);
  });

  // The useful null result: the director corrected something on the POINTS
  // side, which is live already, and needs to be told to stand down.
  it("reports nothing moving when the correction was not a handicap one", () => {
    const before = { 1: lockWith({ a: { name: "Andy H", ch: 12 } }) };
    const next = lockWith({ a: { name: "Andy H", ch: 12 } });
    expect(describeRefreshImpact({ locks: before, round: 1, nextLock: next }).changed).toBe(0);
  });

  it("orders by the size of the move, largest first", () => {
    const before = { 1: lockWith({ a: { ch: 10 }, b: { ch: 10 }, c: { ch: 10 } }) };
    const next = lockWith({ a: { ch: 11 }, b: { ch: 16 }, c: { ch: 8 } });
    const { rows } = describeRefreshImpact({ locks: before, round: 1, nextLock: next });
    expect(rows.map(r => r.pid)).toEqual(["b", "c", "a"]);
  });

  // A player with no frozen row was already scoring off live values, so
  // listing them as a change would be noise rather than news.
  it("says nothing about a player added after the lock was taken", () => {
    const before = { 1: lockWith({ a: { ch: 10 } }) };
    const next = lockWith({ a: { ch: 10 }, late: { name: "Late Sub", ch: 20 } });
    expect(describeRefreshImpact({ locks: before, round: 1, nextLock: next }).rows).toEqual([]);
  });

  it("is empty for an unlocked round or a missing snapshot", () => {
    expect(describeRefreshImpact({ locks: {}, round: 1, nextLock: lockWith({}) }).changed).toBe(0);
    expect(describeRefreshImpact({ locks: { 1: lockWith({}) }, round: 1, nextLock: null }).rows).toEqual([]);
  });
});
