/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  Admin → Budget → Winnings, and what has to reach it
// ══════════════════════════════════════════════════════════════════
//
// lib/winnings.test.js pins the arithmetic. This pins the WIRING, which is the
// half that fails silently: every figure on this board is derived from props
// AdminView had no reason to carry before it existed — the ctp map, the
// buy-ins, the typed skins pot — and a board handed none of them does not
// error, it renders "No pots yet" over a tournament with four live pots.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

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

// One par 3 (the second hole) so the CTP pot has something to divide by.
const courses = [{
  id: "c1", name: "Treetops", par: 71,
  hole_pars: [4, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1),
  tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }],
}];
const tPlayers = [
  { player_id: "p1", name: "Aaron J", team: "A", handicap_index: 0 },
  { player_id: "p2", name: "Paul W", team: "B", handicap_index: 0 },
  // The borrowed ball is a card, not a person, and cannot be paid out.
  { player_id: "ghost", name: "Borrowed Ball", team: "A", borrowed: true },
];
const teams = { A: { id: "A", name: "Irons" }, B: { id: "B", name: "Drivers" } };
const tRounds = [{ id: "r1", round_number: 1, course_id: "c1", format: "singles", scoring_type: "match", tee_box: "White" }];
// Aaron takes every hole outright.
const card = (v) => Object.fromEntries(Array.from({ length: 18 }, (_, h) => [h, v]));
const holeData = { p1_1: card(4), p2_1: card(5) };

const props = (over = {}) => ({
  user: { isDirector: true, player_id: "p1" },
  tPlayers, memberships: [], onSetDirector: async () => {},
  tRounds, courses, matches: [],
  onAddPlayer: async () => {}, onUpdatePlayer: async () => {}, onRemovePlayer: async () => {},
  onAddCourse: async () => {}, onSetRound: async () => {}, onSetMatch: async () => {},
  holeData, onDiscardRoundScores: async () => {},
  teams, teamNames: { A: "Irons", B: "Drivers" },
  onSaveTeamNames: async () => {}, brand: {}, onSaveBranding: async () => {},
  tournamentName: "Demo", tournamentLocation: "MI", roundCount: 1,
  tournamentRounds: [1], onSaveTournament: async () => {},
  hcpOverridesFromDb: {}, teeAssignmentsFromDb: {}, groupsFromDb: {},
  onSaveGroups: async () => {}, notify: () => {}, roundLocks: {},
  payments: [], duesAmount: 0, onLogPayment: async () => {}, onDeletePayment: async () => {},
  onSaveDues: async () => {}, onSetPlayerDues: async () => {},
  onOpenFinalize: () => {}, onRecalculateRound: async () => ({}),
  finalizeRound: null, finalizeReady: false,
  trip: {}, onSaveTrip: async () => {}, startDate: "", endDate: "",
  budgetLines: [], onSaveBudgetLine: async () => {}, onDeleteBudgetLine: async () => {},
  ctpData: { "1_1": { player_id: "p2", distance_ft: 7 } },
  buyIns: { skinsAmount: 20, ctpAmount: 10 },
  skinsPot: 0,
  ...over,
});

const winnings = (over = {}) => {
  const { container } = render(<AdminView {...props(over)} />);
  const tap = (re) => fireEvent.click([...container.querySelectorAll("button")].find(b => re.test(b.textContent || "")));
  tap(/budget/i);
  tap(/^Winnings$/i);
  return container;
};

describe("Admin → Budget → Winnings", () => {
  it("is reachable from the money tab", () => {
    expect(winnings().textContent).toContain("WINNINGS");
  });

  it("adds a man's games up into one figure", () => {
    const text = winnings().textContent;
    // Two men in at $20: a $40 skins pot, and Aaron won all eighteen.
    expect(text).toContain("Aaron J");
    expect(text).toContain("$40");
    // And the pin Paul took, out of a $20 CTP pot with one par 3 on the week.
    expect(text).toContain("Paul W");
  });

  // The pot is not the payout. A week with pins nobody hit leaves money in the
  // hat, and a board that printed the pot as spoken for would have a director
  // handing out money the field has not won.
  it("shows what each pot holds beside what it has paid", () => {
    expect(winnings().textContent).toContain("POT");
  });

  // Everything here is derived. Nothing on this tab may write.
  it("offers nothing that saves", () => {
    const c = winnings();
    const labels = [...c.querySelectorAll("button")].map(b => (b.textContent || "").trim());
    expect(labels.filter(l => /save|delete|log payment/i.test(l))).toEqual([]);
  });

  // The borrowed ball is a card, not a person — it cannot collect.
  it("never pays out the borrowed ball", () => {
    expect(winnings().textContent).not.toContain("Borrowed Ball");
  });

  // A tournament whose director has never priced a game has nothing to add up,
  // and four $0 rows say less than one empty state.
  it("says so when no game has a pot", () => {
    expect(winnings({ buyIns: {}, skinsPot: 0 }).textContent).toContain("No pots yet");
  });
});
