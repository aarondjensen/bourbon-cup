/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  The course editor is a keyboard-aware sheet, like every other
//  popup in the app you type into.
// ══════════════════════════════════════════════════════════════════
//
// The bug: a director tapped Edit on a course, put the cursor in the Name
// field, and the sheet shut itself a second or two later — taking the draft
// with it. The second attempt always worked, which is the tell.
//
// Nothing in the editor closed it. The overlay was sized to the LAYOUT
// viewport, which no mobile browser shrinks for the keyboard, and the card was
// CENTRED in it. Measured in Chromium at 390px wide: full height, the card ran
// 158→686 with the name field at y=173; at keyboard height it re-centred to
// 16→484 with the name field at y=31. So the sheet jumped 142px the moment the
// keys came up, and 200px of what had been card became backdrop — where a
// tap is `onClose`, and `onClose` discards the course. The second time round
// the keyboard is already up, the card is already settled, and taps land where
// they look.
//
// `viewportFit align="start"` is the app's own answer to this, and the course
// editor was the only typed-into popup without it: the player sheet in this
// same file, GhinLink, SideBets, Ledger, Budget, EditionSwitcher and TripInfo
// all carry it. Pinned to the visible rect and aligned to its top, the card
// cannot move when the keyboard arrives.
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
  par: 72, hole_pars: Array(18).fill(4),
  hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1),
  tee_boxes: [{ name: "Championship", slope: 138, rating: 74.2, par: 72, yardage: 7104 }],
}];
const teams = { A: { id: "A", name: "Irons" }, B: { id: "B", name: "Drivers" } };
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
});

const byText = (re) => [...document.body.querySelectorAll("button")]
  .find(b => re.test((b.textContent || "").trim()));

// Admin → Rounds → the COURSE field → a library row's Edit.
const openCourseEditor = async () => {
  const { container } = render(<AdminView {...props()} />);
  fireEvent.click([...container.querySelectorAll("button")].find(b => /rounds/i.test(b.textContent || "")));
  await act(async () => { fireEvent.click([...container.querySelectorAll("button")].find(b => (b.textContent || "").includes("Treetops"))); });
  await act(async () => { fireEvent.click(byText(/^Edit$/)); });
  const name = [...document.body.querySelectorAll("input")].find(i => i.value === "Treetops");
  expect(name, "the course editor did not open").toBeTruthy();
  return { name, card: name.closest("[data-popup]").firstElementChild, backdrop: name.closest("[data-popup]") };
};

// The one thing that makes a popup scrollable from the inside — see
// Popup.test.jsx, where the same marker picks the inner scroller out.
const scrollerAbove = (el, stopAt) => {
  for (let n = el; n && n !== stopAt; n = n.parentElement) {
    if (n.style.overflowY === "auto") return n;
  }
  return null;
};

describe("the course editor", () => {
  // The fix. Both halves matter: viewportFit stops the keyboard hiding the
  // card, align=start stops the card MOVING when it appears.
  it("sits above the keyboard and holds still when it opens", async () => {
    const { backdrop } = await openCourseEditor();
    // align="start" — a centred card re-centres on every viewport change.
    expect(backdrop.style.alignItems).toBe("flex-start");
    // viewportFit — the overlay is sized to the visible rect rather than
    // stretched across a layout viewport the keyboard is sitting on top of.
    expect(backdrop.style.height).not.toBe("");
    expect(backdrop.style.bottom).toBe("");
  });

  // A viewportFit Popup hands scrolling to its content (Popup.jsx), so an
  // editor that did not scroll itself would simply have its scorecard clipped.
  it("scrolls its own body, since the frame no longer does", async () => {
    const { name, card } = await openCourseEditor();
    const tees = [...card.querySelectorAll("input")].find(i => i.value === "Championship");
    expect(scrollerAbove(tees, card), "the editor body does not scroll").toBeTruthy();
    // The name field is in the frame's header, above the scroll — it is the
    // one thing that must stay on screen while the rest of the sheet moves.
    expect(scrollerAbove(name, card)).toBe(null);
  });

  // Save used to sit below eighteen holes of scorecard, inside the scroll.
  // At keyboard height that put it off the bottom of the visible rect.
  it("keeps Cancel and Save pinned to the frame", async () => {
    const { card } = await openCourseEditor();
    for (const label of [/^Cancel$/, /Save Changes/]) {
      const btn = byText(label);
      expect(btn, `${label} missing`).toBeTruthy();
      expect(scrollerAbove(btn, card), `${label} scrolls away with the scorecard`).toBe(null);
    }
  });
});
