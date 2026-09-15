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
// Two doors now, and they are in two places because they answer two
// different questions:
//
//   Reopen       FINAL → LOCKED, on the Finalize sheet, stamped with who,
//                when and why (lib/roundAmend). Moves no stroke by itself.
//   Recalculate  HERE, at the foot of HANDICAPS, on the round this form is
//                editing — re-takes the snapshot off what is on screen,
//                which is the only thing that makes a corrected handicap
//                land.
//
// Three things are pinned. That the second one carries the CURRENT figures
// — the debounce and the Firestore echo between the keystroke and the tap
// are exactly where this would silently freeze the number being corrected.
// That it names the handicaps it is about to move, in numbers, behind a
// typed word, because it re-scores holes that have been played. And that a
// FINAL round is not offered it at all, which is what makes the amendment a
// real gate rather than a speed bump.
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

// What onRecalculateRound resolves to — { lock, impact }, where impact is
// lib/roundAmend's describeRefreshImpact. Built here rather than inline so a
// test that cares about one field does not have to spell out the other four.
const RECALC = ({ rows = [{ pid: "p1", name: "Aaron J", from: 8, to: 12 }], unchanged = 1, settings = [] } = {}) => ({
  lock: { locked: true, final: false },
  impact: { rows, changed: rows.length, unchanged, settings, settingsChanged: settings.length },
});

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
  onOpenFinalize: () => {},
  onRecalculateRound: async () => RECALC({ changed: 1 }),
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

// The recalculate button's own label, which names the round it acts on.
const RECALC_BTN = "Recalculate Round 1 handicaps";
// Typing the word the confirm holds itself back behind.
const typeToConfirm = (word) => {
  const box = document.body.querySelector(`input[aria-label="Type ${word} to continue"]`);
  expect(box, `no ${word} box`).toBeTruthy();
  fireEvent.change(box, { target: { value: word } });
};

describe("the controls a frozen round offers", () => {
  it("offers nothing on an open round", () => {
    const c = roundsTab();
    expect(button(c, RECALC_BTN)).toBeFalsy();
  });

  it("offers Recalculate once the round is locked", () => {
    const c = roundsTab({ roundLocks: LOCKED });
    expect(button(c, RECALC_BTN)).toBeTruthy();
  });

  // The gate. A final round has to come back to LOCKED before its snapshot
  // can be re-taken at all — App's onRecalculateRound refuses one outright —
  // and a control that appears only to say no is the failure these guards
  // were rewritten to stop making.
  it("offers nothing at all once the round is final", () => {
    const c = roundsTab({ roundLocks: FINAL });
    expect(button(c, RECALC_BTN)).toBeFalsy();
  });

  // The amendment does not gate the control, it words it: a round somebody
  // REOPENED is waiting on this, and one that locked on its first score this
  // morning is not waiting on anything.
  it("says which of the two frozen rounds this is", () => {
    expect(roundsTab({ roundLocks: LOCKED }).textContent).toContain("Round 1's handicaps are frozen");
    const amended = {
      1: {
        ...LOCKED[1], amend_count: 1,
        amended_at: "2026-07-18T12:00:00.000Z", locked_at: "2026-07-16T12:00:00.000Z",
      },
    };
    expect(roundsTab({ roundLocks: amended }).textContent).toContain("Round 1 was reopened");
  });

  it("draws nothing when the caller supplies no action", () => {
    // A non-director never reaches this tab, but the prop is optional and a
    // card whose button does nothing is furniture.
    const c = roundsTab({ roundLocks: LOCKED, onRecalculateRound: null });
    expect(button(c, RECALC_BTN)).toBeFalsy();
    expect(c.textContent).not.toContain("handicaps are frozen");
  });
});

describe("recalculating a locked round", () => {
  it("re-takes the snapshot off the CH on screen, not the one in Firestore", async () => {
    // THE POINT OF ALL OF THIS. The box auto-saves on a 700ms debounce and
    // App only learns the new value when Firestore echoes it back, so a
    // director who types 12 and taps Recalculate straight away must not
    // preview, or freeze, the 8 he was correcting. The form hands over what
    // it is holding — on the PREVIEW call as well as the write, since the
    // preview is what the dialog then reports as about to happen.
    const seen = [];
    const c = roundsTab({
      roundLocks: LOCKED,
      onRecalculateRound: async (r, opts) => { seen.push({ r, ...opts }); return RECALC(); },
    });
    fireEvent.change(chBox(c), { target: { value: "12" } });
    // No timers advanced: the debounce is deliberately still pending.
    fireEvent.click(button(c, RECALC_BTN));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toMatchObject({ r: 1, preview: true });
    expect(seen[0].inputs.chOverrides[1].p1).toBe("12");

    await waitFor(() => expect(document.body.textContent).toContain("Move 1 handicap"));
    typeToConfirm("RECALCULATE");
    await confirmWith("Recalculate");
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1].preview).toBeUndefined();
    expect(seen[1].inputs.chOverrides[1].p1).toBe("12");
  });

  it("flushes the pending save before it freezes anything", async () => {
    // The snapshot and the stored override have to agree — a frozen 12 with
    // an 8 still in bc_hcp_overrides is a round that reverts the next time
    // anybody recalculates it.
    const order = [];
    const c = roundsTab({
      roundLocks: LOCKED,
      onSetRound: async () => { order.push("save"); },
      onRecalculateRound: async (r, o) => { order.push(o?.preview ? "preview" : "recalc"); return RECALC(); },
    });
    fireEvent.change(chBox(c), { target: { value: "12" } });
    fireEvent.click(button(c, RECALC_BTN));
    await waitFor(() => expect(order).toContain("preview"));
    expect(order).toEqual(["save", "preview"]);
  });

  // In numbers, not in prose. "Some handicaps may change" is the sentence
  // that gets tapped through; a name and two figures is the one that gets
  // read, and it is the list that will actually land because it was built by
  // the same call that lands it.
  it("names the handicaps it is about to move", async () => {
    const c = roundsTab({
      roundLocks: LOCKED,
      onRecalculateRound: async () => RECALC({
        rows: [{ pid: "p1", name: "Aaron J", from: 8, to: 12 }, { pid: "p2", name: "Paul W", from: 14, to: 13 }],
        unchanged: 3,
      }),
    });
    fireEvent.click(button(c, RECALC_BTN));
    await waitFor(() => expect(document.body.textContent).toContain("Move 2 handicaps"));
    expect(document.body.textContent).toContain("Aaron J: 8 → 12");
    expect(document.body.textContent).toContain("Paul W: 14 → 13");
    expect(document.body.textContent).toContain("2 Course Handicaps will change and 3 will not");
  });

  // The allowance is the case that exposed this. It is applied downstream of
  // the snapshot, so correcting a round from 100% to 50% moves every stroke
  // in it and not one stored Course Handicap — and a dialog that read only
  // the players told the director their fix was somewhere else.
  it("reports a round-level setting even when no stored handicap moves", async () => {
    const c = roundsTab({
      roundLocks: LOCKED,
      onRecalculateRound: async () => RECALC({
        rows: [], unchanged: 4,
        settings: [{ key: "allowance", label: "Handicap allowance", from: { pct: 100 }, to: { pct: 50 } }],
      }),
    });
    fireEvent.click(button(c, RECALC_BTN));
    await waitFor(() => expect(document.body.textContent).toContain("Re-score a round that has been played?"));
    expect(document.body.textContent).toContain("Handicap allowance: 100% → 50%");
    expect(document.body.textContent).toContain("No stored Course Handicap moves");
  });

  // The useful answer, and the one a director has no other way to get: the
  // correction was on the points side, which is live already, and there is
  // nothing to land.
  it("says so, and offers nothing, when nothing would move", async () => {
    const seen = [];
    const c = roundsTab({
      roundLocks: LOCKED,
      onRecalculateRound: async (r, o) => { seen.push(o); return RECALC({ rows: [], unchanged: 4 }); },
    });
    fireEvent.click(button(c, RECALC_BTN));
    await waitFor(() => expect(document.body.textContent).toContain("Nothing to recalculate"));
    expect(document.body.querySelector('input[aria-label="Type RECALCULATE to continue"]')).toBeFalsy();
    expect(seen).toHaveLength(1);          // the preview, and nothing after it
  });

  it("warns that strokes move, and does nothing if the answer is no", async () => {
    const seen = [];
    const c = roundsTab({
      roundLocks: LOCKED,
      onRecalculateRound: async (r, o) => { seen.push(o); return RECALC(); },
    });
    fireEvent.click(button(c, RECALC_BTN));
    await waitFor(() => expect(document.body.textContent).toContain("This re-allocates strokes on holes that have already been played"));
    await confirmWith("Cancel");
    expect(seen).toHaveLength(1);          // the preview only
  });

  // A one-tap confirm on the only act in the app that re-scores a played
  // round is the reflex, not the check.
  it("holds the write back until the word is typed", async () => {
    const seen = [];
    const c = roundsTab({
      roundLocks: LOCKED,
      onRecalculateRound: async (r, o) => { seen.push(o); return RECALC(); },
    });
    fireEvent.click(button(c, RECALC_BTN));
    await waitFor(() => expect(document.body.textContent).toContain("Type RECALCULATE to continue"));
    await confirmWith("Recalculate");
    expect(seen).toHaveLength(1);          // refused: nothing typed
    typeToConfirm("RECALCULATE");
    await confirmWith("Recalculate");
    await waitFor(() => expect(seen).toHaveLength(2));
  });
});

describe("what the form tells a director who types into a frozen round", () => {
  it("points a locked round at Recalculate instead of dead-ending", async () => {
    const c = roundsTab({ roundLocks: LOCKED });
    fireEvent.focusIn(chBox(c));
    await waitFor(() => expect(document.body.textContent).toContain("Round 1 is locked"));
    expect(document.body.textContent).toContain("tap Recalculate");
  });

  // The dead end that sent the one director who needed this into the Firebase
  // console. It names the door rather than stopping at "no".
  it("points a final round at the way back in", async () => {
    const c = roundsTab({ roundLocks: FINAL });
    fireEvent.focusIn(chBox(c));
    await waitFor(() => expect(document.body.textContent).toContain("Round 1 is final"));
    expect(document.body.textContent).toContain("Correct a finished round");
  });
});

// Keep the timer plumbing honest — the suite above leans on real timers.
it("uses no fake timers", () => { expect(vi.isFakeTimers()).toBe(false); });
