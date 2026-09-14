/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  The scores export, and the one round it must not hand over quietly.
// ══════════════════════════════════════════════════════════════════
//
// The blackout is enforced by subtracting scores at the source (lib/reveal),
// and this tab is one of the two the subtraction deliberately does not reach
// — a director has to be able to type both sides' cards. That exemption was
// written for a SCREEN. A file is a different thing: it persists, it goes to
// a downloads folder or a share sheet, and it does it on the evening the
// director is most likely to be mirroring their screen to a television.
//
// The round is not withheld — a backup missing Round 4 is a broken backup —
// but it is never handed over silently.
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

// The file never actually leaves — the point here is WHETHER it is built.
const saved = [];
vi.mock("../lib/fileSave", async (orig) => {
  const actual = await orig();
  return { ...actual, saveTextFile: async (args) => { saved.push(args); return actual.SAVED.downloaded; } };
});

import { AdminView } from "./AdminView";

afterEach(() => { cleanup(); saved.length = 0; });

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
// Round 1 is ordinary; Round 4 is the sealed closing round, mid-reveal.
const rounds = (sealedFinal = false) => ([
  { id: "r1", round_number: 1, course_id: "c1", format: "fourball", scoring_type: "match" },
  {
    id: "r4", round_number: 4, course_id: "c1", format: "team_best_ball",
    scoring_type: "points", sealed: true, reveal_through: sealedFinal ? 18 : 6,
    final: sealedFinal,
  },
]);
const holeData = { p1_4: { 0: 4, 1: 5 }, p2_4: { 0: 6, 1: 5 } };

const props = (over = {}) => ({
  user: { isDirector: true, player_id: "p1" },
  tPlayers, memberships: [], onSetDirector: async () => {},
  tRounds: rounds(), courses, matches: [],
  onAddPlayer: async () => {}, onUpdatePlayer: async () => {}, onRemovePlayer: async () => {},
  onAddCourse: async () => {}, onSetRound: async () => {}, onSetMatch: async () => {},
  holeData, onDiscardRoundScores: async () => {},
  teams, teamNames: { A: "Irons", B: "Drivers" },
  onSaveTeamNames: async () => {}, brand: {}, onSaveBranding: async () => {},
  tournamentName: "Demo", tournamentLocation: "MI", roundCount: 4,
  tournamentRounds: [1, 2, 3, 4], onSaveTournament: async () => {},
  hcpOverridesFromDb: {}, teeAssignmentsFromDb: {}, groupsFromDb: {},
  onSaveGroups: async () => {}, notify: () => {}, roundLocks: {},
  payments: [], duesAmount: 0, onLogPayment: async () => {}, onDeletePayment: async () => {},
  onSaveDues: async () => {}, onSetPlayerDues: async () => {},
  onOpenFinalize: () => {}, onReopenRound: async () => ({}), onRecalcHandicaps: async () => ({}),
  finalizeRound: null, finalizeReady: false,
  trip: {}, onSaveTrip: async () => {}, startDate: "", endDate: "",
  budgetLines: [], onSaveBudgetLine: async () => {}, onDeleteBudgetLine: async () => {},
  ...over,
});

// The export buttons live on the Event tab.
const eventTab = (over = {}) => {
  const { container } = render(<AdminView {...props(over)} />);
  fireEvent.click([...container.querySelectorAll("button")].find(b => /event/i.test(b.textContent || "")));
  return container;
};
const button = (c, re) => [...c.querySelectorAll("button")].find(b => re.test((b.textContent || "").trim()));
const confirmWith = async (label) => {
  await waitFor(() => expect(document.body.textContent).toContain(label));
  const hits = [...document.body.querySelectorAll("button")].filter(b => (b.textContent || "").trim() === label);
  fireEvent.click(hits.at(-1));
};

describe("exporting while a round is sealed", () => {
  it("names the sealed round before it writes anything", async () => {
    const c = eventTab();
    const all = button(c, /^All scores$/i);
    expect(all, "no All scores button").toBeTruthy();
    fireEvent.click(all);
    await waitFor(() => expect(document.body.textContent).toContain("Round 4 is sealed"));
    // And nothing has been written while the question is on screen.
    expect(saved).toEqual([]);
  });

  it("writes the file once the director says so", async () => {
    fireEvent.click(button(eventTab(), /^All scores$/i));
    await confirmWith("Export anyway");
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].text).toContain("Aaron J");
  });

  it("writes nothing if they back out", async () => {
    fireEvent.click(button(eventTab(), /^All scores$/i));
    await confirmWith("Cancel");
    expect(saved).toEqual([]);
  });

  it("asks nothing when the sealed round is not in the export", async () => {
    // Round 1 on its own is nobody's secret.
    const c = eventTab();
    const one = button(c, /^Rd 1$/);
    expect(one, "no Rd 1 button").toBeTruthy();
    fireEvent.click(one);
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(document.body.textContent).not.toContain("is sealed");
  });

  it("asks nothing once the round is revealed and final", async () => {
    // Both gates open: the countdown is done and the cup has a winner, so
    // there is nothing left to hold back.
    const c = eventTab({ tRounds: rounds(true), roundLocks: { 4: { locked: true, final: true } } });
    fireEvent.click(button(c, /^All scores$/i));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(document.body.textContent).not.toContain("is sealed");
  });
});
