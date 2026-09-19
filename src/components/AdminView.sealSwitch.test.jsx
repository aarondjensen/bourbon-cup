/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  THE CLOSING ROUND'S SEAL IS NOT A SWITCH
// ══════════════════════════════════════════════════════════════════
//
// THE FINAL COUNTDOWN toggle on the Formats tab decides whether a round is
// played behind the blackout. On Team Best Ball it opens ON — and for as long
// as Off was tappable there, one tap on a form that AUTO-SAVES, months before
// anybody tees off, put round 4's cup points live on sixteen phones for the
// whole of the round. There is no undo for what the field has already read.
//
// `resolveSealed` now refuses a stored `false` on a live closing round, so the
// tap would do nothing. This file pins the other half of that: the switch must
// not OFFER a position the rule is going to ignore. A control that can lie to
// the man holding it is the one thing this project does not ship — and a
// director who taps Off, watches the pill move and believes the round is live
// is being lied to whichever way the board then behaves.
//
// It comes back the moment the round is FINAL, which is the only time turning
// the seal off answers a real question — a finished round somebody wants on
// the board without running the ceremony. See canUnseal in lib/reveal, which
// is the single place both this switch and the board ask.
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

const PARS = Array(18).fill(4);
const courses = [{
  // A stored course (bc_course_* is what marks one as existing) with a full
  // card and the longest tee name anybody actually uses — the editor's widest
  // case, which is the one the no-zoom sizes have to survive.
  id: "bc_course_1", name: "Treetops", city: "Gaylord", state: "MI",
  par: 72, hole_pars: PARS,
  hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1),
  tee_boxes: [
    { name: "Championship", slope: 138, rating: 74.2, par: 72, yardage: 7104,
      hole_yards: Array.from({ length: 18 }, () => 412) },
    { name: "White", slope: 113, rating: 71.8, par: 72, yardage: 6412 },
  ],
}];
const tPlayers = [
  { player_id: "p1", name: "Aaron J", team: "A", handicap_index: 8.1 },
  { player_id: "p2", name: "Paul W", team: "B", handicap_index: 14.2 },
];
const teams = { A: { id: "A", name: "Irons" }, B: { id: "B", name: "Drivers" } };

// The round as App hands it over — enriched (see enrichedRounds), which is
// what the form reads its stored values off.
const round = (over = {}) => ({
  id: "bc_demo__bc_round_1", round_number: 1, course_id: "bc_course_1",
  format: "team_best_ball", tee_time: "8:30", date: "2026-07-16",
  scoring_type: "points", hole_scoring: "format", ...over,
});

const props = (over = {}) => ({
  user: { isDirector: true, player_id: "p1" },
  tPlayers, memberships: [], onSetDirector: async () => {},
  tRounds: [round()], courses, matches: [],
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
  onOpenFinalize: () => {}, finalizeRound: null, finalizeReady: false,
  trip: {}, onSaveTrip: async () => {}, startDate: "", endDate: "",
  budgetLines: [], onSaveBudgetLine: async () => {}, onDeleteBudgetLine: async () => {},
  ...over,
});

// The Formats tab, mounted, with every write and every toast it makes
// collected.
const roundsTab = ({ roundLocks = {}, tRounds } = {}) => {
  const writes = [];
  const toasts = [];
  const { container } = render(<AdminView {...props({
    roundLocks,
    ...(tRounds ? { tRounds } : null),
    onSetRound: async (r) => { writes.push(r); },
    notify: (msg) => { toasts.push(msg); },
  })} />);
  const tab = [...container.querySelectorAll("button")].find(b => /formats/i.test(b.textContent || ""));
  fireEvent.click(tab);
  return { container, writes, toasts };
};


// The two positions of THE FINAL COUNTDOWN switch, by their own labels. They
// are the only controls on the tab reading exactly "Off" and "On".
const sealPill = (container, label) =>
  [...container.querySelectorAll("button")]
    .find((b) => (b.textContent || "").trim() === label);

describe("Off, on a live Team Best Ball round", () => {
  it("is drawn but refused", () => {
    const { container } = roundsTab();
    const off = sealPill(container, "Off");
    expect(off, "the Off pill is still on screen").toBeTruthy();
    expect(off.disabled).toBe(true);
  });

  it("says why, where a director will find it", () => {
    const { container } = roundsTab();
    expect(sealPill(container, "Off").getAttribute("title"))
      .toContain("once the round is final");
  });

  it("does nothing when tapped", () => {
    const { container } = roundsTab();
    fireEvent.click(sealPill(container, "Off"));
    // On is still the selected position — the switch did not move under him.
    expect(sealPill(container, "On")).toBeTruthy();
    expect(sealPill(container, "Off").disabled).toBe(true);
  });

  it("leaves On tappable, so the position that is true can still be set", () => {
    const { container } = roundsTab();
    expect(sealPill(container, "On").disabled).toBeFalsy();
  });
});

describe("and once the round is in the books", () => {
  it("Off comes back", () => {
    const { container } = roundsTab({ roundLocks: { 1: { locked: true, final: true } } });
    const off = sealPill(container, "Off");
    expect(off.disabled).toBeFalsy();
    expect(off.getAttribute("title")).toContain("shown live");
  });
});

describe("every other format keeps its switch", () => {
  it("offers Off on a live round that is not the closing one", () => {
    const { container } = roundsTab({ tRounds: [round({ format: "fourball", scoring_type: "match" })] });
    expect(sealPill(container, "Off").disabled).toBeFalsy();
  });
});
