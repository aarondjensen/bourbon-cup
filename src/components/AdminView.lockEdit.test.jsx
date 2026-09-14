/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  Correcting a handicap on a round that is already frozen.
// ══════════════════════════════════════════════════════════════════
//
// A round locks on its first score and freezes every handicap into a
// snapshot, and scoring answers to that snapshot for as long as it exists
// (scoring.getRoundCH reads it before it looks at anything else). That is
// the right guarantee — a GHIN sync on Saturday must not re-score Friday.
//
// It was a gate with no door. The Round CH boxes went read-only on a FINAL
// round, and on a merely LOCKED one they took the edit and told the
// director it would not count — with nothing anywhere in the app to make it
// count. `refreshRoundLockDoc` existed and was reachable from nothing; the
// correction had to be made in the Firebase console, on raw document ids.
//
// Two controls now, in the order the two decisions happen:
//
//   Reopen       FINAL → LOCKED. Moves no stroke by itself.
//   Recalculate  re-takes the snapshot off what is on screen, which is the
//                only thing that makes a corrected handicap land.
//
// What is pinned here is that the second one carries the CURRENT figures —
// the debounce and the Firestore echo between the keystroke and the tap are
// exactly where this would silently freeze the number being corrected.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";

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
const courses = [{
  id: "c1", name: "Treetops", par: 72, hole_pars: PARS,
  hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1),
  tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }],
}];
const tPlayers = [
  { player_id: "p1", name: "Aaron J", team: "A", handicap_index: 8.1 },
  { player_id: "p2", name: "Paul W", team: "B", handicap_index: 14.2 },
];
const teams = { A: { id: "A", name: "Irons" }, B: { id: "B", name: "Drivers" } };
const round = {
  id: "bc_demo__bc_round_1", round_number: 1, course_id: "c1", format: "fourball",
  tee_time: "8:30", date: "2026-07-16", scoring_type: "match", hole_scoring: "format",
};

// A lock in each of the two states that matter, plus the open round.
const LOCKED = { 1: { locked: true, final: false, players: { p1: { ch: 8, hi: 8.1 } } } };
const FINAL = { 1: { locked: true, final: true, players: { p1: { ch: 8, hi: 8.1 } } } };

const props = (over = {}) => ({
  user: { isDirector: true, player_id: "p1" },
  tPlayers, memberships: [], onSetDirector: async () => {},
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
  onOpenFinalize: () => {}, onReopenRound: async () => ({ final: false }),
  onRecalcHandicaps: async () => ({ locked: true }),
  finalizeRound: null, finalizeReady: false,
  trip: {}, onSaveTrip: async () => {}, startDate: "", endDate: "",
  budgetLines: [], onSaveBudgetLine: async () => {}, onDeleteBudgetLine: async () => {},
  ...over,
});

const roundsTab = (over = {}) => {
  const { container } = render(<AdminView {...props(over)} />);
  fireEvent.click([...container.querySelectorAll("button")].find(b => /rounds/i.test(b.textContent || "")));
  return container;
};
const button = (container, label) =>
  [...container.querySelectorAll("button")].find(b => (b.textContent || "").trim() === label);
// The confirm is a themed modal, not window.confirm, and it portals to the
// END of body — so when its label matches the button that OPENED it (Reopen,
// Recalculate), the last match in document order is the modal's, and the
// first is the one already on the page. Taking the first just reopens the
// dialog, which is a very confusing way to watch nothing happen.
const confirmWith = async (label) => {
  await waitFor(() => expect(document.body.textContent).toContain(label));
  const hits = [...document.body.querySelectorAll("button")].filter(b => (b.textContent || "").trim() === label);
  fireEvent.click(hits.at(-1));
};
// The Round CH box on a named player's row. NOT "the first number input on
// the page" — the Nassau pots and the allowance percentage are number inputs
// too, and they sit above this one.
const chBox = (container, name = "Aaron J") => {
  const cell = [...container.querySelectorAll("div")]
    .find(d => d.children.length === 0 && (d.textContent || "").trim() === name);
  expect(cell, `no row for ${name}`).toBeTruthy();
  const box = cell.parentElement.querySelector('input[type="number"]');
  expect(box, `no CH box on ${name}'s row`).toBeTruthy();
  return box;
};

describe("the controls a frozen round offers", () => {
  it("offers neither on an open round", () => {
    const c = roundsTab();
    expect(button(c, "Reopen")).toBeFalsy();
    expect(button(c, "Recalculate")).toBeFalsy();
  });

  it("offers Recalculate once the round is locked", () => {
    const c = roundsTab({ roundLocks: LOCKED });
    expect(button(c, "Recalculate")).toBeTruthy();
    expect(button(c, "Reopen")).toBeFalsy();
  });

  it("offers Reopen once it is final, and not Recalculate", () => {
    // The two are a sequence, not a choice: a final round has to come back to
    // LOCKED before its snapshot can be re-taken at all (onLockRound refuses).
    const c = roundsTab({ roundLocks: FINAL });
    expect(button(c, "Reopen")).toBeTruthy();
    expect(button(c, "Recalculate")).toBeFalsy();
  });

  it("says what state the round is in either way", () => {
    expect(roundsTab({ roundLocks: FINAL }).textContent).toContain("Round 1 is final");
    expect(roundsTab({ roundLocks: LOCKED }).textContent).toContain("frozen on the snapshot");
  });

  it("draws nothing at all when the caller supplies no actions", () => {
    // A non-director never reaches this tab, but the props are optional and a
    // strip with no buttons in it is furniture.
    const c = roundsTab({ roundLocks: FINAL, onReopenRound: null, onRecalcHandicaps: null });
    expect(button(c, "Reopen")).toBeFalsy();
    expect(button(c, "Recalculate")).toBeFalsy();
    expect(c.textContent).not.toContain("handicaps are read-only");
  });
});

describe("reopening a final round", () => {
  it("asks first, and says that it moves no stroke on its own", async () => {
    const calls = [];
    const c = roundsTab({ roundLocks: FINAL, onReopenRound: async (r) => { calls.push(r); return { final: false }; } });
    fireEvent.click(button(c, "Reopen"));
    await waitFor(() => expect(document.body.textContent).toContain("Reopen Round 1 for editing?"));
    // The sentence that stops a director thinking the job is done.
    expect(document.body.textContent).toContain("Recalculate is what makes a handicap correction land");
    expect(calls).toEqual([]);              // nothing yet
    await confirmWith("Reopen");
    await waitFor(() => expect(calls).toEqual([1]));
  });

  it("does nothing if the director backs out", async () => {
    const calls = [];
    const c = roundsTab({ roundLocks: FINAL, onReopenRound: async (r) => { calls.push(r); return {}; } });
    fireEvent.click(button(c, "Reopen"));
    await waitFor(() => expect(document.body.textContent).toContain("Reopen Round 1"));
    await confirmWith("Cancel");
    expect(calls).toEqual([]);
  });
});

describe("recalculating a locked round", () => {
  it("re-takes the snapshot off the CH on screen, not the one in Firestore", async () => {
    // THE POINT OF ALL OF THIS. The box auto-saves on a 700ms debounce and
    // App only learns the new value when Firestore echoes it back, so a
    // director who types 12 and taps Recalculate straight away must not
    // freeze the 8 he was correcting. The form hands over what it is holding.
    const seen = [];
    const c = roundsTab({
      roundLocks: LOCKED,
      onRecalcHandicaps: async (r, inputs) => { seen.push({ r, inputs }); return { locked: true }; },
    });
    const box = chBox(c);
    fireEvent.change(box, { target: { value: "12" } });
    // No timers advanced: the debounce is deliberately still pending.
    fireEvent.click(button(c, "Recalculate"));
    await confirmWith("Recalculate");
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].r).toBe(1);
    expect(seen[0].inputs.chOverrides[1].p1).toBe("12");
  });

  it("flushes the pending save before it freezes anything", async () => {
    // The snapshot and the stored override have to agree — a frozen 12 with
    // an 8 still in bc_hcp_overrides is a round that reverts the next time
    // anybody recalculates it.
    const writes = [];
    const order = [];
    const c = roundsTab({
      roundLocks: LOCKED,
      onSetRound: async (r) => { writes.push(r); order.push("save"); },
      onRecalcHandicaps: async () => { order.push("recalc"); return { locked: true }; },
    });
    fireEvent.change(chBox(c), { target: { value: "12" } });
    fireEvent.click(button(c, "Recalculate"));
    await confirmWith("Recalculate");
    await waitFor(() => expect(order).toContain("recalc"));
    expect(order).toEqual(["save", "recalc"]);
  });

  it("warns that strokes move, and does nothing if the answer is no", async () => {
    const seen = [];
    const c = roundsTab({ roundLocks: LOCKED, onRecalcHandicaps: async () => { seen.push(1); return {}; } });
    fireEvent.click(button(c, "Recalculate"));
    await waitFor(() => expect(document.body.textContent).toContain("Strokes are re-allocated"));
    await confirmWith("Cancel");
    expect(seen).toEqual([]);
  });
});

describe("what the form tells a director who types into a frozen round", () => {
  it("points a locked round at Recalculate instead of dead-ending", async () => {
    const c = roundsTab({ roundLocks: LOCKED });
    fireEvent.focusIn(chBox(c));
    await waitFor(() => expect(document.body.textContent).toContain("Round 1 is locked"));
    expect(document.body.textContent).toContain("tap Recalculate");
  });

  it("points a final round at Reopen", async () => {
    const c = roundsTab({ roundLocks: FINAL });
    fireEvent.focusIn(chBox(c));
    await waitFor(() => expect(document.body.textContent).toContain("Round 1 is final"));
    expect(document.body.textContent).toContain("Reopen it");
  });
});

// Keep the timer plumbing honest — the suite above leans on real timers.
it("uses no fake timers", () => { expect(vi.isFakeTimers()).toBe(false); });
