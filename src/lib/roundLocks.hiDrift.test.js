// ══════════════════════════════════════════════════════════════════
//  What a locked round has drifted away from.
// ══════════════════════════════════════════════════════════════════
//
// The Formats tab's HI column answers to the round's snapshot, and that is
// the guarantee roundLocks.js exists to make. What it did not do was SAY so:
// a GHIN sync moved `handicap_index`, the Players tab took the new number,
// and the column went on printing the old one with nothing on the row naming
// the gap. `lockedHiDrift` is the list of rows in that state, and these are
// the four things about it that are not obvious from reading it.
import { describe, it, expect } from "vitest";
import { lockedHiDrift } from "./roundLocks";

const lockWith = (players, over = {}) => ({
  1: { locked: true, final: false, players, ...over },
});
const p = (player_id, handicap_index, extra = {}) =>
  ({ player_id, name: player_id, handicap_index, ...extra });

describe("lockedHiDrift", () => {
  it("is empty on an open round — nothing is frozen, so nothing can be stale", () => {
    expect(lockedHiDrift({}, 1, [p("p1", 12.4)])).toEqual([]);
    expect(lockedHiDrift({ 1: { locked: false, players: { p1: { hi: 8.1 } } } }, 1, [p("p1", 12.4)]))
      .toEqual([]);
  });

  it("names the players whose live index has left the snapshot behind", () => {
    const out = lockedHiDrift(lockWith({ p1: { hi: 8.1 }, p2: { hi: 14.2 } }), 1,
      [p("p1", 12.4), p("p2", 14.2)]);
    expect(out).toEqual([
      { pid: "p1", name: "p1", frozen: 8.1, live: 12.4, delta: 4.3 },
    ]);
  });

  // 12.4 - 8.1 is 4.300000000000001 in binary floating point, and the badge
  // that prints this is two characters wide.
  it("rounds the gap to a tenth", () => {
    const [row] = lockedHiDrift(lockWith({ p1: { hi: 8.1 } }), 1, [p("p1", 12.4)]);
    expect(row.delta).toBe(4.3);
  });

  // A plus handicap is stored negative (see scoring.js / lib/ghin), so the
  // sign has to come out of the arithmetic rather than out of the display.
  it("reads a plus handicap's direction off the stored sign", () => {
    // +2.1 → +1.8 is the index going UP: he got worse, and gains a stroke.
    const [row] = lockedHiDrift(lockWith({ p1: { hi: -2.1 } }), 1, [p("p1", -1.8)]);
    expect(row.delta).toBe(0.3);
  });

  // The director's index override is what the round WOULD recalculate onto,
  // so it is the figure the snapshot is compared against — not the GHIN base
  // underneath it. A sync that moves a base an override is covering moves no
  // strokes, and must not raise a mark saying it did.
  it("compares against the effective index, override and all", () => {
    expect(lockedHiDrift(lockWith({ p1: { hi: 6 } }), 1, [p("p1", 12.4, { hi_override: 6 })]))
      .toEqual([]);
    const [row] = lockedHiDrift(lockWith({ p1: { hi: 6 } }), 1, [p("p1", 6, { hi_override: 9 })]);
    expect(row).toMatchObject({ frozen: 6, live: 9, delta: 3 });
  });

  // A player with no frozen row is the late substitute, who scores off live
  // values by design. Marking them would claim a gap that is not there.
  it("says nothing about a player added after the lock", () => {
    expect(lockedHiDrift(lockWith({ p1: { hi: 8.1 } }), 1, [p("p1", 8.1), p("sub", 20)]))
      .toEqual([]);
  });

  it("survives a lock with no players and a roster of none", () => {
    expect(lockedHiDrift(lockWith(undefined), 1, [p("p1", 8.1)])).toEqual([]);
    expect(lockedHiDrift(lockWith({ p1: { hi: 8.1 } }), 1, undefined)).toEqual([]);
  });
});
