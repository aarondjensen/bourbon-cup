/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  The round form saves what it lets you edit.
// ══════════════════════════════════════════════════════════════════
//
// The Rounds tab has no Save button — every edit commits on its own — which
// makes "did that land?" a question the screen has to answer honestly. It did
// not on a FINAL round: `roundIsFinal` discarded the entire write while half
// the form's controls stayed live, so a director retyping a final round's
// Nassau pots watched the box take the number, watched the leaderboard not
// move, and found the old value back on the next reload.
//
// What is pinned here is the line the round lock actually draws
// (lib/roundLocks): a final round's SCORING is frozen — format, form of play,
// hole scoring — and what a match is WORTH is not.
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

// The round as App hands it over — enriched (see enrichedRounds), which is
// what the form reads its stored values off.
const round = {
  id: "bc_demo__bc_round_1", round_number: 1, course_id: "c1", format: "fourball",
  tee_time: "8:30", date: "2026-07-16", scoring_type: "match", hole_scoring: "format",
};

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
  onOpenFinalize: () => {}, finalizeRound: null, finalizeReady: false,
  trip: {}, onSaveTrip: async () => {}, startDate: "", endDate: "",
  budgetLines: [], onSaveBudgetLine: async () => {}, onDeleteBudgetLine: async () => {},
  ...over,
});

// The Rounds tab, mounted, with every write it makes collected.
const roundsTab = (roundLocks = {}) => {
  const writes = [];
  const { container } = render(<AdminView {...props({ roundLocks, onSetRound: async (r) => { writes.push(r); } })} />);
  const tab = [...container.querySelectorAll("button")].find(b => /rounds/i.test(b.textContent || ""));
  fireEvent.click(tab);
  return { container, writes };
};

// The box beside a label on the POINTS AT STAKE row.
const potBox = (container, label) => {
  const tag = [...container.querySelectorAll("span")].find(s => s.textContent === label);
  expect(tag, `${label} box not found`).toBeTruthy();
  return tag.parentElement.querySelector("input");
};

const settle = async (fn) => {
  vi.useFakeTimers();
  try { const out = fn(); await act(async () => { vi.advanceTimersByTime(1500); }); return out; }
  finally { vi.useRealTimers(); }
};

describe("the round form's Nassau pots", () => {
  it("writes the new overall pot on an open round", async () => {
    const { container, writes } = roundsTab();
    await settle(() => fireEvent.change(potBox(container, "OVR"), { target: { value: "2" } }));
    expect(writes.at(-1).nassau_overall).toBe(2);
  });

  it("writes it on a LOCKED round — the lock freezes strokes, not value", async () => {
    const { container, writes } = roundsTab({ 1: { locked: true, final: false } });
    await settle(() => fireEvent.change(potBox(container, "F9"), { target: { value: "3" } }));
    expect(writes.at(-1).nassau_front).toBe(3);
  });

  // The bug. A final round took the number and threw the write away, so the
  // pots on screen and the points on the leaderboard disagreed until a reload
  // put the old ones back.
  it("writes it on a FINAL round", async () => {
    const { container, writes } = roundsTab({ 1: { locked: true, final: true } });
    await settle(() => fireEvent.change(potBox(container, "OVR"), { target: { value: "2" } }));
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.at(-1).nassau_overall).toBe(2);
  });
});

describe("a final round's scoring", () => {
  it("cannot be re-formatted", () => {
    const { container } = roundsTab({ 1: { locked: true, final: true } });
    const select = container.querySelector("select");
    expect(select.disabled).toBe(true);
  });

  it("is untouched by a pot edit — only the value moves", async () => {
    const { container, writes } = roundsTab({ 1: { locked: true, final: true } });
    await settle(() => fireEvent.change(potBox(container, "OVR"), { target: { value: "2" } }));
    const w = writes.at(-1);
    expect(w.format).toBe("fourball");
    expect(w.scoring_type).toBe("match");
    expect(w.hole_scoring).toBe("format");
  });
});

describe("opening a round", () => {
  it("writes nothing on its own", async () => {
    const { writes } = await settle(() => roundsTab({ 1: { locked: true, final: true } }));
    expect(writes).toEqual([]);
  });
});
