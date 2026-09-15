/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  Two doors onto one course library
// ══════════════════════════════════════════════════════════════════
//
// Courses are reachable from Admin → Formats (over the round they are about
// to be assigned to) and from Admin → Event → Courses (as a thing the
// tournament has). Both open the SAME editor, because the alternative is two
// sheets that drift — one growing a yardage row the other does not have, on a
// screen where the numbers are the whole point.
//
// What this pins is the pair, not the pixels: each door opens, and what it
// opens is the editor with its tees and its scorecard. A second copy of the
// list would still pass a test that only ever opened one of them.
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

const courses = [{
  id: "bc_course_1", name: "Treetops", city: "Gaylord", state: "MI",
  par: 72, slope: 138, hole_pars: Array(18).fill(4),
  hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1),
  tee_boxes: [{ name: "Championship", slope: 138, rating: 74.2, par: 72, yardage: 7104 }],
}];
const round = {
  id: "bc_demo__bc_round_1", round_number: 1, course_id: "bc_course_1", format: "fourball",
  tee_time: "8:30", date: "2026-07-16", scoring_type: "match", hole_scoring: "format",
};

const props = () => ({
  user: { isDirector: true, player_id: "p1" },
  tPlayers: [{ player_id: "p1", name: "Aaron J", team: "A", handicap_index: 8.1 }],
  memberships: [], onSetDirector: async () => {},
  tRounds: [round], courses, matches: [],
  onAddPlayer: async () => {}, onUpdatePlayer: async () => {}, onRemovePlayer: async () => {},
  onAddCourse: async () => {}, onSetRound: async () => {}, onSetMatch: async () => {},
  holeData: {}, onDiscardRoundScores: async () => {},
  teams: { A: { id: "A", name: "Irons" }, B: { id: "B", name: "Drivers" } },
  teamNames: { A: "Irons", B: "Drivers" },
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
});

const buttons = (root = document.body) => [...root.querySelectorAll("button")];
const openTab = async (container, re) => {
  await act(async () => { fireEvent.click(buttons(container).find(b => re.test((b.textContent || "").trim()))); });
};
// The editor and nothing else: the name in a box, and the tee list under it.
const editorIsOpen = () => {
  const inputs = [...document.body.querySelectorAll("input")];
  return inputs.some(i => i.value === "Treetops") && inputs.some(i => i.value === "Championship");
};

describe("the Courses card on the Event tab", () => {
  it("lists the saved courses and opens the editor on a row", async () => {
    const { container } = render(<AdminView {...props()} />);
    await openTab(container, /^Event$/);

    const row = buttons(container).find(b => (b.textContent || "").includes("Treetops"));
    expect(row, "no course row on the Event tab").toBeTruthy();
    // The library's own meta line, so this is the course list rather than
    // some other screen that happens to name the course.
    expect(row.textContent).toContain("Gaylord, MI");

    await act(async () => { fireEvent.click(row); });
    expect(editorIsOpen(), "the row did not open the course editor").toBe(true);
  });

  // The R chips are what the Event card keeps from the picker: assigning is
  // still possible from here, it is just no longer the only thing a row does.
  it("still assigns a course to a round from the chips", async () => {
    const writes = [];
    const { container } = render(<AdminView {...props()} onSetRound={async (r) => { writes.push(r); }} />);
    await openTab(container, /^Event$/);

    const chip = buttons(container).find(b => (b.textContent || "").trim() === "R2");
    expect(chip, "no round chips on the Event tab").toBeTruthy();
    await act(async () => { fireEvent.click(chip); });
    expect(writes.at(-1)?.round_number).toBe(2);
    expect(writes.at(-1)?.course_id).toBe("bc_course_1");
  });

  // The other door, and the point of the pair: one editor, two ways in.
  it("opens the same editor from the Formats tab's picker", async () => {
    const { container } = render(<AdminView {...props()} />);
    await openTab(container, /^Formats$/);
    await act(async () => { fireEvent.click(buttons(container).find(b => (b.textContent || "").includes("Treetops"))); });
    await act(async () => { fireEvent.click(buttons().find(b => (b.textContent || "").trim() === "Edit")); });
    expect(editorIsOpen(), "the picker's Edit did not open the course editor").toBe(true);
  });

  // The picker's row tap is an ASSIGNMENT, so the chip for the round it was
  // opened from has to stay a toggle — closing the sheet on it would make
  // "unassign Rd 1" impossible to see the result of.
  it("keeps the picker open when its own round's chip is tapped", async () => {
    const { container } = render(<AdminView {...props()} />);
    await openTab(container, /^Formats$/);
    await act(async () => { fireEvent.click(buttons(container).find(b => (b.textContent || "").includes("Treetops"))); });
    // Scoped to the popup: the tab underneath has round controls of its own,
    // and clicking one of those would leave this passing for no reason.
    const picker = [...document.body.querySelectorAll("[data-popup]")]
      .find(el => /COURSE FOR RD 1/.test(el.textContent || ""));
    expect(picker, "the picker did not open").toBeTruthy();
    const chip = buttons(picker).find(b => (b.textContent || "").trim() === "R1");
    expect(chip, "no R1 chip inside the picker").toBeTruthy();
    await act(async () => { fireEvent.click(chip); });
    expect(document.body.textContent).toContain("COURSE FOR RD 1");
  });
});
