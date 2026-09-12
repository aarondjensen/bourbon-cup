import { describe, it, expect, vi } from "vitest";
import {
  currentRoundNumber,
  nextRoundNumber,
  unfinalizedRoundNumbers,
  openRoundAfter,
  buildRoundLockDoc,
  refreshRoundLockDoc,
  lockedPlayerEntry,
  markRoundFinal,
  unfinalizeRound,
  clearRoundLockDoc,
  describeHiChangeImpact,
  lockedRoundNumbers,
  finalRoundNumbers,
  lastFinalRoundNumber,
  roundLockState,
  LOCK_OPEN,
  LOCK_LOCKED,
  LOCK_FINAL,
} from "./roundLocks";
import { handicapModeFor } from "../constants";

// A lock map of the shape App maintains: { [round]: { locked, final } }.
const locks = (...finalRounds) =>
  Object.fromEntries(finalRounds.map(r => [r, { locked: true, final: true }]));

describe("unfinalizedRoundNumbers", () => {
  it("is every round nobody has frozen, ascending", () => {
    expect(unfinalizedRoundNumbers(locks(1, 2), [1, 2, 3, 4])).toEqual([3, 4]);
    expect(unfinalizedRoundNumbers({}, [3, 1, 2])).toEqual([1, 2, 3]);
    expect(unfinalizedRoundNumbers(locks(1, 2, 3, 4), [1, 2, 3, 4])).toEqual([]);
  });

  // The whole reason it exists: currentRoundNumber answers with ONE round, and
  // a round left open behind the live one is invisible to it.
  it("keeps a round the live one has moved past", () => {
    const l = locks(2);              // Saturday finalized, Friday never was
    expect(currentRoundNumber(l, [1, 2, 3])).toBe(1);
    expect(unfinalizedRoundNumbers(l, [1, 2, 3])).toEqual([1, 3]);
  });

  it("counts a locked-but-not-final round as still to do", () => {
    const l = { 1: { locked: true, final: false } };
    expect(unfinalizedRoundNumbers(l, [1, 2])).toEqual([1, 2]);
  });
});

describe("openRoundAfter", () => {
  it("hands the live round to the next one along", () => {
    expect(openRoundAfter({}, [1, 2, 3, 4], 1)).toBe(2);
    expect(openRoundAfter(locks(1), [1, 2, 3, 4], 2)).toBe(3);
  });

  it("skips rounds already final", () => {
    expect(openRoundAfter(locks(1, 2), [1, 2, 3, 4], 3)).toBe(4);
  });

  it("is null when finalizing this one closes the event", () => {
    expect(openRoundAfter(locks(1, 2, 3), [1, 2, 3, 4], 4)).toBe(null);
    expect(openRoundAfter({}, [1], 1)).toBe(null);
  });

  // The case nextRoundNumber gets wrong, and why the sheet says "leaves
  // scoring on Round 2" rather than promising to open a round that is
  // already taking scores.
  it("points BACKWARDS for a round the field has walked off", () => {
    const l = {};                    // nothing final; the field is on Rd 2 today
    expect(openRoundAfter(l, [1, 2, 3], 1)).toBe(2);
    expect(openRoundAfter(l, [1, 2, 3], 2)).toBe(1);
    expect(nextRoundNumber(l, [1, 2, 3])).toBe(2);
  });
});

// ── currentRoundNumber / lastFinalRoundNumber — the two ends of the event ──
describe("currentRoundNumber", () => {
  it("is null once every round is finalized — the event is over", () => {
    const l = locks(1, 2);
    expect(currentRoundNumber(l, [1, 2])).toBeNull();
  });

  it("is null with no rounds at all — reads the same as nothing taking scores", () => {
    expect(currentRoundNumber({}, [])).toBeNull();
  });
});

describe("lastFinalRoundNumber", () => {
  it("is null when nothing has been finalized yet", () => {
    expect(lastFinalRoundNumber({}, [1, 2, 3])).toBeNull();
  });

  it("is the highest finalized round, not the last one in the list", () => {
    const l = locks(1, 3);
    expect(lastFinalRoundNumber(l, [1, 2, 3, 4])).toBe(3);
  });
});

// ── State predicates ────────────────────────────────────────────────
describe("roundLockState / lockedRoundNumbers / finalRoundNumbers", () => {
  it("moves open -> locked -> final", () => {
    expect(roundLockState({}, 1)).toBe(LOCK_OPEN);
    expect(roundLockState({ 1: { locked: true } }, 1)).toBe(LOCK_LOCKED);
    expect(roundLockState({ 1: { locked: true, final: true } }, 1)).toBe(LOCK_FINAL);
  });

  it("lists locked and final round numbers ascending, regardless of key order", () => {
    const l = { 3: { locked: true }, 1: { locked: true, final: true }, 2: { locked: false } };
    expect(lockedRoundNumbers(l)).toEqual([1, 3]);
    expect(finalRoundNumbers(l)).toEqual([1]);
  });
});

// ══════════════════════════════════════════════════════════════════
//  buildRoundLockDoc — the snapshot itself
// ══════════════════════════════════════════════════════════════════
// Neutral tee (slope 113, rating 72, par 72) so CH == HI exactly and the
// fixtures don't need calcCH's rounding worked out by hand.
const neutralTee = { name: "Blue", slope: 113, rating: 72, par: 72 };
const course = {
  id: "c1",
  name: "Arthur Hills",
  tee_boxes: [neutralTee],
  hole_pars: Array(18).fill(4),
  hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1),
};
const players = [
  { player_id: "p1", name: "Paul W", team: "A", handicap_index: 10 },
  { player_id: "p2", name: "Jim H", team: "A", handicap_index: 8 },
];
const tRounds = [{ round_number: 1, format: "singles", course_id: "c1", tee_box: "Blue" }];

describe("buildRoundLockDoc", () => {
  it("freezes each player's HI, tee and resulting course handicap", () => {
    const lock = buildRoundLockDoc({
      tournamentId: "t1", round: 1, players, tRounds, courses: [course], lockedBy: "aaron",
    });
    expect(lock.locked).toBe(true);
    expect(lock.locked_by).toBe("aaron");
    expect(lock.players.p1).toMatchObject({
      hi: 10, ch: 10, tee: "Blue", slope: 113, rating: 72, par: 72, overridden: false,
    });
    expect(lock.players.p2).toMatchObject({ hi: 8, ch: 8 });
  });

  it("freezes the course id and the format's default handicap mode when the round names none", () => {
    const lock = buildRoundLockDoc({ tournamentId: "t1", round: 1, players, tRounds, courses: [course] });
    expect(lock.course_id).toBe("c1");
    expect(lock.course_name).toBe("Arthur Hills");
    expect(lock.handicap_mode).toBe(handicapModeFor("singles"));
    expect(lock.hole_pars).toEqual(course.hole_pars);
    expect(lock.hole_handicaps).toEqual(course.hole_handicaps);
  });

  it("freezes a direct CH override as the final answer, not the index behind it", () => {
    const lock = buildRoundLockDoc({
      tournamentId: "t1", round: 1, players, tRounds, courses: [course],
      chOverrides: { 1: { p1: 5 } },
    });
    expect(lock.players.p1).toMatchObject({ hi: 10, ch: 5, overridden: true });
    // The other player is untouched by a single override.
    expect(lock.players.p2).toMatchObject({ ch: 8, overridden: false });
  });
});

// ── Late substitutes ─────────────────────────────────────────────────
// The lock captures every player on the roster AT LOCK TIME. A name added to
// the roster afterwards — a late substitute — has no row in the snapshot,
// and lockedPlayerEntry has to say so plainly rather than inventing one, so
// scoring.js's own fallback to live values is the thing that answers for him.
describe("lockedPlayerEntry — late substitutes fall through to live values", () => {
  it("is null when the round was never locked", () => {
    expect(lockedPlayerEntry({}, 1, "p1")).toBeNull();
  });

  it("returns the frozen row for a player captured at lock time", () => {
    const lock = buildRoundLockDoc({ tournamentId: "t1", round: 1, players, tRounds, courses: [course] });
    expect(lockedPlayerEntry({ 1: lock }, 1, "p1")).toMatchObject({ ch: 10 });
  });

  // p3 joined the roster (a substitute for an injured player) after Round 1's
  // lock was already taken by the first score posted.
  it("is null for a player who was not on the roster when the round locked", () => {
    const lock = buildRoundLockDoc({ tournamentId: "t1", round: 1, players, tRounds, courses: [course] });
    expect(lockedPlayerEntry({ 1: lock }, 1, "p3")).toBeNull();
    // Meanwhile everybody who WAS there stays frozen.
    expect(lockedPlayerEntry({ 1: lock }, 1, "p1")).not.toBeNull();
  });
});

// ── Refreshing (re-locking) an existing snapshot ─────────────────────
describe("refreshRoundLockDoc / re-locking", () => {
  it("preserves the original locked_at/locked_by and only moves refreshed_at", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T10:00:00Z"));
    const first = buildRoundLockDoc({
      tournamentId: "t1", round: 1, players, tRounds, courses: [course], lockedBy: "aaron",
    });

    vi.setSystemTime(new Date("2026-06-01T14:00:00Z"));
    // A handicap changed after the round was locked — Refresh is supposed to
    // pick it up; that is what distinguishes a deliberate Refresh from the
    // freeze itself moving.
    const changed = players.map(p => (p.player_id === "p1" ? { ...p, handicap_index: 20 } : p));
    const refreshed = refreshRoundLockDoc({
      tournamentId: "t1", round: 1, players: changed, tRounds, courses: [course],
      lockedBy: "director2", previous: first,
    });

    expect(refreshed.locked_at).toBe(first.locked_at);
    expect(refreshed.locked_by).toBe("aaron");
    expect(refreshed.refreshed_at).toBe("2026-06-01T14:00:00.000Z");
    expect(refreshed.refreshed_by).toBe("director2");
    expect(refreshed.locked_reason).toBe("manual");
    expect(refreshed.players.p1.ch).toBe(20);
    vi.useRealTimers();
  });

  // Re-taking a snapshot with no `previous` (a fresh buildRoundLockDoc call on
  // an already-locked round, as opposed to going through Refresh) starts a new
  // audit trail rather than treating the earlier lock as history.
  it("a fresh build with no `previous` starts its own audit trail", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T10:00:00Z"));
    const first = buildRoundLockDoc({
      tournamentId: "t1", round: 1, players, tRounds, courses: [course], lockedBy: "aaron",
    });
    vi.setSystemTime(new Date("2026-06-02T10:00:00Z"));
    const second = buildRoundLockDoc({
      tournamentId: "t1", round: 1, players, tRounds, courses: [course], lockedBy: "someone-else",
    });
    expect(second.locked_at).not.toBe(first.locked_at);
    expect(second.locked_by).toBe("someone-else");
    expect(second.refreshed_at).toBeNull();
    vi.useRealTimers();
  });
});

// ── final / unfinalize / clear ────────────────────────────────────────
describe("markRoundFinal / unfinalizeRound", () => {
  it("does nothing to a null lock rather than throwing", () => {
    expect(markRoundFinal(null)).toBeNull();
    expect(unfinalizeRound(null)).toBeNull();
  });

  it("sets finalized_at once — finalizing an already-final lock again does not move it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T10:00:00Z"));
    const lock = buildRoundLockDoc({ tournamentId: "t1", round: 1, players, tRounds, courses: [course] });
    const final1 = markRoundFinal(lock, "aaron");
    expect(final1.final).toBe(true);
    expect(final1.finalized_at).toBe("2026-06-01T10:00:00.000Z");
    expect(final1.finalized_by).toBe("aaron");

    vi.setSystemTime(new Date("2026-06-01T18:00:00Z"));
    const final2 = markRoundFinal(final1, "someone-else");
    expect(final2.finalized_at).toBe(final1.finalized_at);
    expect(final2.finalized_by).toBe("aaron");
    vi.useRealTimers();
  });

  it("un-finalizing flips `final` back but leaves the frozen snapshot and finalized_at alone", () => {
    const lock = buildRoundLockDoc({ tournamentId: "t1", round: 1, players, tRounds, courses: [course] });
    const final = markRoundFinal(lock, "aaron");
    const back = unfinalizeRound(final, "aaron");
    expect(back.final).toBe(false);
    expect(back.players).toEqual(final.players);
    expect(back.finalized_at).toBe(final.finalized_at);
    expect(back.locked).toBe(true);   // still locked — this only steps FINAL back to LOCKED
  });
});

describe("clearRoundLockDoc — unlocking", () => {
  it("wipes the snapshot and hands the round back to live data", () => {
    const lock = buildRoundLockDoc({
      tournamentId: "t1", round: 1, players, tRounds, courses: [course], lockedBy: "aaron",
    });
    const cleared = clearRoundLockDoc(lock, 1, "t1", "aaron");
    expect(cleared.locked).toBe(false);
    expect(cleared.final).toBe(false);
    expect(cleared.players).toEqual({});
    // A round scoring off this doc is scoring off live data again.
    expect(lockedPlayerEntry({ 1: cleared }, 1, "p1")).toBeNull();
  });

  it("keeps the prior lock's audit trail visible rather than deleting history", () => {
    const lock = buildRoundLockDoc({
      tournamentId: "t1", round: 1, players, tRounds, courses: [course], lockedBy: "aaron",
    });
    const cleared = clearRoundLockDoc(lock, 1, "t1", "director2");
    expect(cleared.previous_locked_at).toBe(lock.locked_at);
    expect(cleared.previous_locked_by).toBe("aaron");
    expect(cleared.cleared_by).toBe("director2");
  });
});

describe("describeHiChangeImpact", () => {
  it("names which rounds a handicap edit will and will not touch", () => {
    const l = { 1: { locked: true }, 2: { locked: true } };
    const impact = describeHiChangeImpact(l, [1, 2, 3, 4]);
    expect(impact.locked).toEqual([1, 2]);
    expect(impact.open).toEqual([3, 4]);
    expect(impact.text).toMatch(/^Rounds 1, 2 are locked/);
  });

  it("says the edit applies everywhere when nothing is locked yet", () => {
    expect(describeHiChangeImpact({}, [1, 2, 3]).text)
      .toBe("No rounds are locked yet, so this applies everywhere.");
  });
});
