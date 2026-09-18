/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  The Formats tab says when its indexes have gone out of date.
// ══════════════════════════════════════════════════════════════════
//
// A director syncs GHIN on the Players tab, watches every index take the new
// number, opens Formats — and the HI column still reads the old ones. That is
// correct: a round locks on its first score and from that moment it answers to
// its snapshot, which is the whole guarantee lib/roundLocks makes. But the
// column said nothing about it, so the only reading available was that the
// screen was broken.
//
// What is pinned here is the candour, not the freeze. The frozen figure still
// wins — a played round never moves on its own — and the row now names the
// figure it is frozen away from, with the count repeated at the foot of the
// section, beside the button that closes the gap.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";

vi.mock("../firebase", () => ({
  db: { subscribe: () => () => {}, upsert: async () => null, delete: async () => null, get: async () => [] },
  TOURNAMENT_ID: "bc_demo",
  editionDocId: (id) => `bc_demo__${id}`,
  getTournamentYear: () => 2026,
  writeFailure: () => "failed",
  writeTracker: { track: (p) => p, state: () => ({ pending: 0, kinds: {}, since: null, refused: 0, refusedKinds: {} }), subscribe: () => () => {} },
  firebaseApp: {},
  getActiveTournamentId: () => "bc_demo",
  getDefaultEditionId: () => "bc_demo",
  setActiveTournamentId: () => {},
  readUserSession: () => null,
  writeUserSession: () => {},
  readTournamentIdentity: () => null,
  writeTournamentIdentity: () => {},
  spectatorSession: () => null,
  BOOTSTRAP_DIRECTOR: "bootstrap_director",
  SPECTATOR_ID: "spectator",
  getMessagingInstance: async () => null,
}));

import { AdminView } from "./AdminView";

afterEach(cleanup);

const PARS = Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
const courses = [{
  id: "bc_course_1", name: "Treetops", city: "Gaylord", state: "MI",
  par: 72, hole_pars: PARS, hole_handicaps: SI,
  tee_boxes: [{ name: "White", slope: 113, rating: 71.8, par: 72, yardage: 6412 }],
}];
const teams = { A: { id: "A", name: "Irons" }, B: { id: "B", name: "Drivers" } };
const round = {
  id: "bc_demo__bc_round_1", round_number: 1, course_id: "bc_course_1",
  format: "fourball", tee_time: "8:30", date: "2026-07-16",
  scoring_type: "match", hole_scoring: "format",
};

const roster = (hi) => [{ player_id: "p1", name: "Aaron J", team: "A", handicap_index: hi }];

// The snapshot as it stood when the first score landed: Aaron off 8.1.
const lockedAt81 = (over = {}) => ({
  1: {
    locked: true, final: false, course_id: "bc_course_1", handicap_mode: "full",
    hole_pars: PARS, hole_handicaps: SI,
    players: { p1: { name: "Aaron J", team: "A", hi: 8.1, tee: "White", slope: 113, rating: 71.8, par: 72, ch: 8, ch_exact: 8.05 } },
    ...over,
  },
});

const props = (over = {}) => ({
  user: { isDirector: true, player_id: "p1" },
  tPlayers: roster(8.1), memberships: [], onSetDirector: async () => {},
  tRounds: [round], courses, matches: [],
  onAddPlayer: async () => {}, onUpdatePlayer: async () => {}, onRemovePlayer: async () => {},
  onAddCourse: async () => {}, onSetRound: async () => {}, onSetMatch: async () => {},
  holeData: {}, onDiscardRoundScores: async () => {},
  teams, teamNames: { A: "Irons", B: "Drivers" },
  onSaveTeamNames: async () => {}, brand: {}, onSaveBranding: async () => {},
  tournamentName: "Demo", tournamentLocation: "MI", roundCount: 4,
  tournamentRounds: [1, 2, 3, 4], onSaveTournament: async () => {},
  hcpOverridesFromDb: {}, teeAssignmentsFromDb: {}, groupsFromDb: {},
  onSaveGroups: async () => {}, notify: () => {}, roundLocks: {},
  payments: [], duesAmount: 0, onLogPayment: async () => {}, onDeletePayment: async () => {},
  onSaveDues: async () => {}, onSetPlayerDues: async () => {},
  onOpenFinalize: () => {}, onRecalculateRound: async () => ({}),
  finalizeRound: null, finalizeReady: false,
  trip: {}, onSaveTrip: async () => {}, startDate: "", endDate: "",
  budgetLines: [], onSaveBudgetLine: async () => {}, onDeleteBudgetLine: async () => {},
  ...over,
});

// Mount on Formats, then let a GHIN sync land on the roster underneath it —
// which is what the live subscription does, a prop at a time, while the
// director is looking at this screen.
const syncTo = async (hi, over = {}) => {
  const { container, rerender } = render(<AdminView {...props(over)} />);
  const tab = [...container.querySelectorAll("button")].find(b => /formats/i.test(b.textContent || ""));
  await act(async () => { fireEvent.click(tab); });
  await act(async () => {
    rerender(<AdminView {...props({ ...over, tPlayers: roster(hi) })} />);
  });
  return container;
};

const driftMark = (container) =>
  [...container.querySelectorAll("span")]
    .map(s => (s.textContent || "").trim())
    .filter(t => /^[▲▼][\d.]+$/.test(t));

describe("an OPEN round has nothing to be stale about", () => {
  it("takes the new index outright and raises no mark", async () => {
    const container = await syncTo(12.4);
    expect(container.textContent).toContain("12.4");
    expect(container.textContent).not.toContain("8.1");
    expect(driftMark(container)).toEqual([]);
  });
});

describe("a LOCKED round keeps its snapshot and says what it is missing", () => {
  it("still prints the frozen index — a played round does not move on its own", async () => {
    const container = await syncTo(12.4, { roundLocks: lockedAt81() });
    expect(container.textContent).toContain("8.1");
  });

  it("marks the row with the gap the roster has opened", async () => {
    const container = await syncTo(12.4, { roundLocks: lockedAt81() });
    expect(driftMark(container)).toEqual(["▲4.3"]);
  });

  // The tooltip is the only place both numbers appear together, which is what
  // makes the mark answer its own question rather than raise a new one.
  it("names both figures on the cell", async () => {
    const container = await syncTo(12.4, { roundLocks: lockedAt81() });
    const cell = [...container.querySelectorAll("div[title]")]
      .find(d => /Frozen at/.test(d.getAttribute("title") || ""));
    expect(cell?.getAttribute("title")).toBe(
      "Frozen at 8.1 when the round locked — the roster now reads 12.4");
  });

  // The count and the marks are one list. A heading saying one moved with no
  // mark under it is worse than either on its own.
  it("counts it at the foot of HANDICAPS, beside Recalculate", async () => {
    const container = await syncTo(12.4, { roundLocks: lockedAt81() });
    expect(container.textContent).toContain("Round 1 is scoring on 1 index the roster has moved past");
  });

  it("goes back to the plain heading when nothing has moved", async () => {
    const container = await syncTo(8.1, { roundLocks: lockedAt81() });
    expect(driftMark(container)).toEqual([]);
    expect(container.textContent).toContain("Round 1's handicaps are frozen");
  });

  // A reopened round is waiting on Recalculate for a reason the director
  // already knows — that heading is not displaced by a drift count.
  it("lets the reopened heading win", async () => {
    const container = await syncTo(12.4, {
      roundLocks: lockedAt81({
        amend_count: 1, amend_reason: "wrong hole",
        locked_at: "2026-07-16T12:00:00.000Z", amended_at: "2026-07-18T12:00:00.000Z",
      }),
    });
    expect(container.textContent).toContain("Round 1 was reopened");
  });
});

// The column printed the stored value raw, so the one man playing off a plus
// read "-2.1" here and "+2.1" on every screen a golfer sees. Unnoticed while
// nothing else on the row named a number; not survivable beside a drift mark
// whose tooltip names both figures.
describe("a plus handicap reads the way a golfer writes it", () => {
  it("prints the frozen index through fmtHI and still drifts on the stored sign", async () => {
    const plus = { roundLocks: { 1: { ...lockedAt81()[1], players: { p1: { name: "John S", team: "A", hi: -2.1, tee: "White", slope: 113, rating: 71.8, par: 72, ch: -2, ch_exact: -2.35 } } } } };
    const { container, rerender } = render(<AdminView {...props(plus)} />);
    const tab = [...container.querySelectorAll("button")].find(b => /formats/i.test(b.textContent || ""));
    await act(async () => { fireEvent.click(tab); });
    await act(async () => {
      rerender(<AdminView {...props({ ...plus, tPlayers: [{ player_id: "p1", name: "John S", team: "A", handicap_index: -1.8 }] })} />);
    });
    expect(container.textContent).toContain("+2.1");
    expect(container.textContent).not.toContain("-2.1");
    // +2.1 → +1.8 is the index going UP: he got worse, and gains a stroke.
    expect(driftMark(container)).toEqual(["▲0.3"]);
    const cell = [...container.querySelectorAll("div[title]")]
      .find(d => /Frozen at/.test(d.getAttribute("title") || ""));
    expect(cell?.getAttribute("title")).toBe(
      "Frozen at +2.1 when the round locked — the roster now reads +1.8");
  });
});

// A FINAL round has no Recalculate card at all — the round has to be reopened
// first, which is what makes the amendment a real gate. So the row mark is the
// only thing on the screen that can explain the stale column, and it is
// exactly the round a director is most likely to be looking at in October.
describe("a FINAL round still marks the rows", () => {
  it("marks the drift with no card under it to carry the count", async () => {
    const container = await syncTo(12.4, { roundLocks: lockedAt81({ final: true }) });
    expect(driftMark(container)).toEqual(["▲4.3"]);
    expect(container.textContent).not.toContain("Recalculate Round 1 handicaps");
  });
});
