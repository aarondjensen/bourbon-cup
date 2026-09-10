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

// ── The re-price confirm ────────────────────────────────────────────
// A FINAL round asks once, on the first points edit, before the change lands —
// a director had no other way to learn that this one live field on an
// otherwise read-only form moves a result the field has already seen.
//
// The edit is carried THROUGH the dialog rather than discarded by it, which is
// the part these tests are really guarding: refusing the keystroke that raised
// the question would put the box back to reading what it read before, which is
// the exact failure this file was written for.
// One fake-timer window covering the whole gesture: the edit, the answer, and
// the debounce it arms. Splitting them arms the save with a REAL timer and
// then advances a fake clock, which fires nothing and reads as "the write
// never happened".
const editPot = async (container, label, value, answer = "Re-price it") => {
  vi.useFakeTimers();
  try {
    fireEvent.change(potBox(container, label), { target: { value } });
    await act(async () => {});                        // let the confirm mount
    if (answer) {
      const btn = [...document.body.querySelectorAll("button")]
        .find(b => (b.textContent || "").trim() === answer);
      expect(btn, `"${answer}" not found — the re-price confirm did not open`).toBeTruthy();
      await act(async () => { fireEvent.click(btn); });
    }
    await act(async () => { vi.advanceTimersByTime(1500); });
  } finally { vi.useRealTimers(); }
};

const repriceOffered = () => [...document.body.querySelectorAll("button")]
  .some(b => (b.textContent || "").trim() === "Re-price it");

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
  it("writes it on a FINAL round, once the re-price is confirmed", async () => {
    const { container, writes } = roundsTab({ 1: { locked: true, final: true } });
    await editPot(container, "OVR", "2");
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.at(-1).nassau_overall).toBe(2);
  });

  // The typed number survives the dialog. Discarding it would send a director
  // back to retype a value they already entered, and teach them the field
  // cannot be trusted — which is the same lesson the discarded WRITE taught.
  it("does not make the director retype the number", async () => {
    const { container, writes } = roundsTab({ 1: { locked: true, final: true } });
    await editPot(container, "OVR", "3");
    expect(writes.at(-1).nassau_overall).toBe(3);
    expect(potBox(container, "OVR").value).toBe("3");
  });

  it("writes nothing when the re-price is declined", async () => {
    const { container, writes } = roundsTab({ 1: { locked: true, final: true } });
    await editPot(container, "OVR", "2", "Cancel");
    expect(writes).toEqual([]);
  });

  // Once per round per visit. A confirm on every keystroke would fight the
  // keyboard and train the reflex that defeats it.
  it("asks once, not on every keystroke", async () => {
    const { container, writes } = roundsTab({ 1: { locked: true, final: true } });
    await editPot(container, "OVR", "2");
    await editPot(container, "F9", "4", null);   // no dialog to answer this time
    expect(writes.at(-1).nassau_front).toBe(4);
    expect(repriceOffered()).toBe(false);
  });

  // An OPEN round is the routine case and must never see the dialog.
  it("never asks on a round that is not final", async () => {
    const { container, writes } = roundsTab();
    await editPot(container, "OVR", "2", null);
    expect(writes.at(-1).nassau_overall).toBe(2);
    expect(repriceOffered()).toBe(false);
  });
});

// ── The phantom leading zero ────────────────────────────────────────
// React reconciles a number input with a LOOSE compare — `node.value !=
// props.value` — so with a NUMBER in `value`, "02" != 2 is false and the DOM
// is never corrected. A director tapping a box reading 0 and typing 2 was
// left looking at "02" for good, while the stored value was 2 the whole time:
// the box lied about data that was correct, which is the worse half of it.
// Handing React a STRING makes the compare "02" != "2", which is true.
describe("a pot box that reads 0", () => {
  it("does not keep a leading zero when a digit is typed onto it", async () => {
    const { container, writes } = roundsTab();
    const box = potBox(container, "OVR");
    // The round starts at 1; put it to 0 the way the Single pill would.
    await editPot(container, "OVR", "0", null);
    expect(box.value).toBe("0");
    // Now type a 2 onto the end of it, which is what a tap-and-type does.
    await editPot(container, "OVR", "02", null);
    expect(box.value).toBe("2");
    expect(writes.at(-1).nassau_overall).toBe(2);
  });

  it("keeps the box and the stored value telling the same story", async () => {
    const { container, writes } = roundsTab();
    await editPot(container, "F9", "03", null);
    expect(potBox(container, "F9").value).toBe("3");
    expect(writes.at(-1).nassau_front).toBe(3);
  });
});

// ── The zoom trap ───────────────────────────────────────────────────
// iOS Safari zooms the page in when a focused input is under 16px and does
// not zoom back out. The theme says so beside the FS scale; the round form's
// numeric boxes were the ones that never got it, so tapping the Nassau field
// left the director on a viewport they had to pinch out of with the form's
// labels off the side of the screen.
describe("the round form's inputs", () => {
  it("keeps every typed field at the no-zoom size", () => {
    const { container } = roundsTab();
    const fields = [...container.querySelectorAll("input, select")]
      .filter(el => el.type !== "checkbox" && el.type !== "radio" && el.type !== "file");
    expect(fields.length).toBeGreaterThan(0);
    fields.forEach(el => {
      const px = parseFloat(el.style.fontSize);
      // Inline styles only — anything without one inherits the app's body
      // size, which is already at or above the floor.
      if (Number.isFinite(px)) {
        expect(px, `${el.type} field near "${el.parentElement?.textContent?.slice(0, 30)}" at ${px}px would zoom iOS`).toBeGreaterThanOrEqual(16);
      }
    });
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
    await editPot(container, "OVR", "2");
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
