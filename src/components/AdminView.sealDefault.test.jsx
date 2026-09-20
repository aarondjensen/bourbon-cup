/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  PICKING TEAM BEST BALL PICKS THE FINAL COUNTDOWN WITH IT
// ══════════════════════════════════════════════════════════════════
//
// The format select re-derives everything it touches from the NEW format —
// the nassau pots, the form of play, the hole-scoring method, the handicap
// mode, the allowance, the counting scores, the hole values, the par table.
// It did not re-derive the SEAL, so a round set up as a fourball and then
// changed to Team Best Ball kept the fourball's Off.
//
// Nothing leaked: `resolveSealed` forces the seal on while a seal-default
// round is live, so the board held either way. What broke was the switch —
// it read Off on the closing round while the board sealed it, and the write
// stored that Off. On the one control a director's whole confidence in the
// evening comes off, the screen and the app disagreed.
//
// And the badge is the backstop for the same invariant, drawn where the
// switch is. It should be absent on every state this file can reach, which is
// what the assertions below check; `sealWarning` in lib/reveal.test pins the
// state it fires on, because the app no longer produces one.
//
// THAT IT REALLY DRAWS is settled by mutation rather than by a fixture: take
// `setSealed` back out of the format handler and "draws no warning badge"
// fails — the badge appears, on exactly the bug this file was written for. It
// is not decoration waiting for a state that cannot happen; it is the thing
// that would have put yesterday's gap on screen.
import { useState } from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
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
// Two rounds that disagree about everything the form holds. Round 4 is the
// closing round — sealed, counting scores, points per hole; round 1 is an
// ordinary fourball. Anything of round 1's that turns up on round 4 got there
// by leaking through the form.
const ROUND_1 = {
  id: "bc_demo__bc_round_1", round_number: 1, course_id: "bc_course_1", format: "fourball",
  tee_time: "8:30", date: "2026-07-16", scoring_type: "match", hole_scoring: "format",
  sealed: false, nassau_front: 1, nassau_back: 1, nassau_overall: 1,
};
const ROUND_4 = {
  id: "bc_demo__bc_round_4", round_number: 4, course_id: "bc_course_1",
  format: "team_best_ball", tee_time: "9:00", date: "2026-07-19",
  scoring_type: "points", hole_scoring: "format",
  sealed: true, counting_scores: { holes: [...Array(9).fill(6), ...Array(9).fill(7)] },
  hole_points: { front: 1, back: 2 },
};

const props = (over = {}) => ({
  user: { isDirector: true, player_id: "p1" },
  tPlayers, memberships: [], onSetDirector: async () => {},
  tRounds: [ROUND_1, ROUND_4], courses, matches: [],
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

// The whole Formats tab, with a live Firestore behind it.
function Console({ writes, round }) {
  const [rounds, setRounds] = useState([round]);
  return <AdminView {...props({
    tRounds: rounds,
    onSetRound: async (w) => {
      writes.push(w);
      setRounds((prev) => prev.map((r) => (r.round_number === w.round_number ? { ...r, ...w } : r)));
    },
  })} />;
}

const seg = (container, label) => [...container.querySelectorAll("button")]
  .find((b) => (b.textContent || "").trim().startsWith(label));

// The Final Countdown's two pills. Anchored on their titles rather than on
// their position: several sections on this tab have an Off/On pair, and which
// one comes last is a fact about the layout rather than about the seal.
const sealPill = (container, label) => [...container.querySelectorAll("button")]
  .find((b) => (b.textContent || "").trim() === label
    && /sealed|shown live/i.test(b.getAttribute("title") || ""));

const BADGE = "SHOWN LIVE";
const lastWrite = (writes) => writes.slice(-1)[0] || null;

const step = async (fn) => {
  await act(async () => { fn(); });
  await act(async () => { vi.advanceTimersByTime(1500); });
};

// Round 1, because that is the round the form opens on.
const FOURBALL = {
  id: "bc_demo__bc_round_1", round_number: 1, course_id: "bc_course_1",
  format: "fourball", tee_time: "9:00", date: "2026-07-19",
  scoring_type: "match", hole_scoring: "format", sealed: false,
};

describe("changing the format to Team Best Ball", () => {
  let container, writes;

  beforeEach(async () => {
    vi.useFakeTimers();
    writes = [];
    const r = render(<Console writes={writes} round={FOURBALL} />);
    container = r.container;
    await act(async () => { fireEvent.click(seg(container, "Formats")); });
    await act(async () => { vi.advanceTimersByTime(1500); });
  });
  afterEach(() => { vi.useRealTimers(); });

  it("opens with the seal off while it is still a fourball", () => {
    // The starting state, and the one the bug carried forward.
    expect(container.textContent).not.toContain(BADGE);
    expect(sealPill(container, "Off")).toBeTruthy();
  });

  it("turns the Final Countdown on", async () => {
    writes.length = 0;
    await step(() => fireEvent.change(container.querySelector("select"), {
      target: { value: "team_best_ball" },
    }));
    const w = lastWrite(writes);
    expect(w, "the format change must save").toBeTruthy();
    expect(w.format).toBe("team_best_ball");
    expect(w.sealed).toBe(true);
  });

  it("draws no warning badge, because there is nothing to warn about", async () => {
    await step(() => fireEvent.change(container.querySelector("select"), {
      target: { value: "team_best_ball" },
    }));
    expect(container.textContent).not.toContain(BADGE);
  });

  it("refuses the Off position once it is the closing round", async () => {
    // The other half of the same guarantee — see AdminView.sealSwitch.test.
    await step(() => fireEvent.change(container.querySelector("select"), {
      target: { value: "team_best_ball" },
    }));
    expect(sealPill(container, "Off").disabled).toBe(true);
  });

  it("gives the seal back when the format changes away again", async () => {
    await step(() => fireEvent.change(container.querySelector("select"), {
      target: { value: "team_best_ball" },
    }));
    writes.length = 0;
    await step(() => fireEvent.change(container.querySelector("select"), {
      target: { value: "scramble" },
    }));
    const w = lastWrite(writes);
    expect(w.format).toBe("scramble");
    expect(w.sealed).toBe(false);
    expect(sealPill(container, "Off").disabled).toBeFalsy();
  });
});

describe("a round that is already Team Best Ball", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("opens with the Final Countdown on and no badge", async () => {
    vi.useFakeTimers();
    const writes = [];
    const { container } = render(<Console writes={writes} round={{
      ...FOURBALL, format: "team_best_ball", scoring_type: "points",
    }} />);
    await act(async () => { fireEvent.click(seg(container, "Formats")); });
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(container.textContent).not.toContain(BADGE);
    // And it corrects the stored `sealed: false` it opened on.
    expect(lastWrite(writes)?.sealed).toBe(true);
  });
});
