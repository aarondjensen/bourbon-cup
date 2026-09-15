/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  A fifth tee time.
// ══════════════════════════════════════════════════════════════════
//
// The sheet was capped at four with nothing on screen to say so, and the cap
// was circular: the box count could only grow from times already STORED, and
// the only writer wrote exactly that many, so the string could never get
// longer. A round that needed a fifth wave could have one built by Auto-build
// — and then the fifth time was derived, invisible on this tab and impossible
// to set.
//
// Four is the Bourbon Cup's field and will be for a while. What is pinned here
// is that it is a floor rather than a ceiling, and that a tee time cannot be
// taken out from under the men standing on it.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";

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

const tPlayers = [
  { player_id: "p1", name: "Aaron J", team: "A", handicap_index: 8.1 },
  { player_id: "p2", name: "Paul W", team: "B", handicap_index: 14.2 },
];
const courses = [{ id: "c1", name: "Treetops", par: 72, hole_pars: Array(18).fill(4), hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1) }];
const round = {
  id: "bc_demo__bc_round_1", round_number: 1, course_id: "c1",
  format: "best_ball", tee_time: "8:00|8:10|8:20|8:30", scoring_type: "match",
};

const props = (over = {}) => ({
  user: { isDirector: true, player_id: "p1" },
  tPlayers, memberships: [], onSetDirector: async () => {}, onSetCaptain: async () => {},
  editionId: "bc_demo", tRounds: [round], courses, matches: [],
  onAddPlayer: async () => {}, onUpdatePlayer: async () => {}, onRemovePlayer: async () => {},
  onAddCourse: async () => {}, onSetRound: async () => {}, onSetMatch: async () => {},
  holeData: {}, onDiscardRoundScores: async () => {},
  teams: { A: { id: "A", name: "Irons", accent: "#0a0" }, B: { id: "B", name: "Drivers", accent: "#0aa" } },
  teamNames: { A: "Irons", B: "Drivers" },
  onSaveTeamNames: async () => {}, brand: {}, onSaveBranding: async () => {},
  tournamentName: "Demo", tournamentLocation: "MI", roundCount: 4,
  tournamentRounds: [1, 2, 3, 4], onSaveTournament: async () => {},
  hcpOverridesFromDb: {}, teeAssignmentsFromDb: {}, groupsFromDb: {},
  onSaveGroups: async () => {}, notify: () => {}, roundLocks: {},
  payments: [], duesAmount: 0, onLogPayment: async () => {}, onDeletePayment: async () => {},
  onSaveDues: async () => {}, onSetPlayerDues: async () => {},
  onOpenFinalize: () => {}, onRecalculateRound: async () => {},
  finalizeRound: null, currentRound: 1, finalizeReady: false,
  trip: {}, onSaveTrip: async () => {}, startDate: "", endDate: "",
  budgetLines: [], onSaveBudgetLine: async () => {}, onDeleteBudgetLine: async () => {},
  ...over,
});

// The Formats tab, with the tee-time row's controls to hand.
const formatsTab = (over = {}) => {
  const toasts = [];
  render(<AdminView {...props({ notify: (m, t) => toasts.push([m, t]), ...over })} />);
  fireEvent.click(screen.getByText("Formats"));
  const slots = () => screen.getAllByText(/^G\d+$/).map(el => el.textContent);
  return {
    toasts, slots,
    add: () => fireEvent.click(screen.getByLabelText("Add a tee time")),
    remove: () => fireEvent.click(screen.getByLabelText("Remove the last tee time")),
    hasRemove: () => screen.queryByLabelText("Remove the last tee time") !== null,
  };
};

describe("the tee sheet can be longer than four", () => {
  it("opens on four, with nothing to remove", () => {
    const t = formatsTab();
    expect(t.slots()).toEqual(["G1", "G2", "G3", "G4"]);
    expect(t.hasRemove()).toBe(false);
  });

  it("adds a fifth, and a sixth", () => {
    const t = formatsTab();
    t.add();
    expect(t.slots()).toEqual(["G1", "G2", "G3", "G4", "G5"]);
    t.add();
    expect(t.slots()).toEqual(["G1", "G2", "G3", "G4", "G5", "G6"]);
  });

  it("opens the new slot on the time the spread implies", () => {
    const t = formatsTab();
    t.add();
    // 8:00 off a ten-minute spread — one tap, not one tap and a number.
    expect(screen.getByDisplayValue("8:40")).toBeTruthy();
  });

  it("gives them back one at a time, never below four", () => {
    const t = formatsTab();
    t.add(); t.add();
    t.remove();
    expect(t.slots()).toEqual(["G1", "G2", "G3", "G4", "G5"]);
    t.remove();
    expect(t.slots()).toEqual(["G1", "G2", "G3", "G4"]);
    expect(t.hasRemove()).toBe(false);
  });

  it("draws a box for a fifth wave the draw already put on the sheet", () => {
    // Auto-build can spread a big field onto a fifth group without the round's
    // tee_time string ever mentioning one. That slot exists; this tab used to
    // be the one place it could not be seen or set.
    const t = formatsTab({ groupsFromDb: { 1: [[], [], [], [], ["p1", "p2"]] } });
    expect(t.slots()).toEqual(["G1", "G2", "G3", "G4", "G5"]);
  });

  it("refuses to remove a tee time with players standing on it", () => {
    const t = formatsTab({ groupsFromDb: { 1: [[], [], [], [], ["p1", "p2"]] } });
    t.remove();
    expect(t.slots()).toEqual(["G1", "G2", "G3", "G4", "G5"]);
    expect(t.toasts[0]).toEqual([expect.stringMatching(/players on it/i), "error"]);
  });
});
