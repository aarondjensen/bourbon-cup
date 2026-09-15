/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  Which round the Matches tab opens on.
// ══════════════════════════════════════════════════════════════════
//
// It was Round 1, every time. App renders the console as `{view === "admin"
// && <AdminView/>}`, so leaving it for the Leaderboard unmounts it and the
// `useState(1)` seed came back — which on the Saturday of a four-round week
// put a director reaching for the draw on Friday's finished round, with the
// round he was standing on a tap away in small type.
//
// That is the same hazard `scoringRoundNumber` exists to keep the SCORING tab
// off, so it is the same answer: `currentRound`, resolved rather than stored,
// so a tap still wins and a deleted round still falls back.
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
// A course per round, so the tab's banner names which round is on screen —
// the round pills say it too, but by styling rather than by text.
const courses = [1, 2, 3, 4].map(n => ({
  id: `c${n}`, name: `Course ${n}`, par: 72,
  hole_pars: Array(18).fill(4), hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1),
}));
const tRounds = [1, 2, 3, 4].map(n => ({
  id: `bc_demo__bc_round_${n}`, round_number: n, course_id: `c${n}`,
  format: n === 4 ? "team_best_ball" : "best_ball", tee_time: "8:00|8:10|8:20|8:30",
}));

const props = (over = {}) => ({
  user: { isDirector: true, player_id: "p1" },
  tPlayers, memberships: [], onSetDirector: async () => {}, onSetCaptain: async () => {},
  editionId: "bc_demo", tRounds, courses, matches: [],
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

// Open the console on its Matches tab and report which round it landed on.
const openMatches = (over) => {
  render(<AdminView {...props(over)} />);
  fireEvent.click(screen.getByText("Matches"));
  return Number(screen.getByText(/^Course [1-4]$/).textContent.split(" ")[1]);
};

describe("the Matches tab opens on the live round", () => {
  it("lands on Round 3 when Rounds 1 and 2 are done", () => {
    expect(openMatches({
      currentRound: 3,
      roundLocks: { 1: { final: true }, 2: { final: true } },
    })).toBe(3);
  });

  it("lands on Round 4 on the closing day", () => {
    expect(openMatches({
      currentRound: 4,
      roundLocks: { 1: { final: true }, 2: { final: true }, 3: { final: true } },
    })).toBe(4);
  });

  it("opens on Round 1 while Round 1 is the live one", () => {
    expect(openMatches({ currentRound: 1 })).toBe(1);
  });

  it("keeps the director's own tap over the live round", () => {
    render(<AdminView {...props({ currentRound: 4 })} />);
    fireEvent.click(screen.getByText("Matches"));
    expect(screen.getByText("Course 4")).toBeTruthy();
    fireEvent.click(screen.getByText("Rd 2"));
    expect(screen.getByText("Course 2")).toBeTruthy();
  });

  it("falls back to the first round when every round is final", () => {
    // currentRound is null once the event is over — every answer is a
    // finalized round then, so the console reads from the start.
    expect(openMatches({ currentRound: null })).toBe(1);
  });
});
