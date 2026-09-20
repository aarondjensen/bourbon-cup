/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  SWITCHING ROUNDS MUST NOT CARRY THE LAST ROUND'S SETTINGS WITH IT
// ══════════════════════════════════════════════════════════════════
//
// The Formats tab holds ONE set of form state and points it at whichever
// round the pills select, so every round switch is a re-seed. The hydration
// effect does that, and it has two early returns that exist to protect a
// director's keystrokes from the echo of his own write:
//
//   • a queued write owns the form — re-seeding would discard the edits it
//     is about to send;
//   • the arriving document IS our own write, so the form already holds it,
//     possibly with newer keystrokes on top which must survive.
//
// Both were reached AFTER `setSeed`, which is what marks the round hydrated
// and arms the auto-save. So a round the director had EDITED EARLIER IN THE
// SAME SESSION came back marked hydrated with the other round's values still
// in the boxes — and the auto-save, now armed, wrote them to Firestore.
//
// Edit Rd 4 → Rd 1 → Rd 4 was all it took, and the edit is the part that
// arms it: `lastWrittenRef` is what both guards read, and it is only set by
// a write. The closing round came back with round 1's format, its form of
// play, its tee time and date, no counting scores, and `sealed: false` —
// which is the Final Countdown switching itself off.
//
// THE ECHO IS PART OF THE REPRODUCTION. The second guard only fires when the
// arriving document MATCHES what we wrote, so the harness below feeds each
// write back into `tRounds` exactly as App's Firestore subscription does.
// Without that the bug is invisible, which is why it survived this long.
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

// ── The harness ─────────────────────────────────────────────────────
// AdminView with a live Firestore behind it: every write is merged into the
// round it names and handed straight back, which is what App's subscription
// does and what makes the echo guard reachable at all.
function Console({ writes }) {
  const [rounds, setRounds] = useState([ROUND_1, ROUND_4]);
  return <AdminView {...props({
    tRounds: rounds,
    onSetRound: async (w) => {
      writes.push(w);
      setRounds((prev) => prev.map((r) => (r.round_number === w.round_number ? { ...r, ...w } : r)));
    },
  })} />;
}

const pill = (container, n) => [...container.querySelectorAll("button")]
  .find((b) => (b.textContent || "").trim() === `Rd ${n}`);

const lastWriteFor = (writes, n) => writes.filter((w) => w.round_number === n).slice(-1)[0] || null;

// One fake-timer window per gesture: the 700ms debounce has to be advanced on
// the same clock the gesture armed it on.
const step = async (fn) => {
  await act(async () => { fn(); });
  await act(async () => { vi.advanceTimersByTime(1500); });
};

// The hole-contribution boxes. [0] and [1] are the per-nine figures — the
// two a director actually types into — and the eighteen per-hole boxes follow
// them. Index 0 is "how many balls count on the front", which is the "small
// change" in every one of these tests.
const holeBoxes = (container) =>
  [...container.querySelectorAll("input")].filter((el) => el.type === "number");

describe("edit Rd 4, visit Rd 1, come back", () => {
  let container, writes;

  beforeEach(async () => {
    vi.useFakeTimers();
    writes = [];
    const r = render(<Console writes={writes} />);
    container = r.container;
    await act(async () => {
      fireEvent.click([...container.querySelectorAll("button")]
        .find((b) => /formats/i.test(b.textContent || "")));
    });
    await act(async () => { vi.advanceTimersByTime(1500); });
    await step(() => fireEvent.click(pill(container, 4)));
    // THE SMALL CHANGE TO THE HOLE CONTRIBUTIONS. One box, one digit — and
    // the write it causes is what arms both guards for this round.
    await step(() => fireEvent.change(holeBoxes(container)[0], { target: { value: "5" } }));
    expect(lastWriteFor(writes, 4), "the edit itself must save").toBeTruthy();
    writes.length = 0;
    await step(() => fireEvent.click(pill(container, 1)));
    await step(() => fireEvent.click(pill(container, 4)));
  });

  afterEach(() => { vi.useRealTimers(); });

  const back = () => lastWriteFor(writes, 4);

  it("does not turn the Final Countdown off", () => {
    // The symptom that started this: the closing round came back unsealed.
    expect(back()?.sealed ?? true).toBe(true);
  });

  it("does not write round 1's format onto round 4", () => {
    expect(back()?.format ?? "team_best_ball").toBe("team_best_ball");
  });

  it("does not drop the hole contributions", () => {
    const w = back();
    if (w) expect(w.counting_scores?.holes?.[1]).toBe(6);
  });

  it("does not carry round 1's tee time and date over", () => {
    const w = back();
    if (w) { expect(w.tee_time).toBe("9:00"); expect(w.date).toBe("2026-07-19"); }
  });

  it("keeps the form itself showing round 4", () => {
    // The write is the damage; the boxes are where a director would see it.
    expect(container.querySelector("select").value).toBe("team_best_ball");
    expect([...container.querySelectorAll("input")]
      .some((el) => el.value === "2026-07-19")).toBe(true);
  });

  it("leaves round 1 alone in the other direction", () => {
    const w = lastWriteFor(writes, 1);
    if (w) {
      expect(w.format).toBe("fourball");
      expect(w.sealed).toBe(false);
      expect(w.counting_scores).toBe(null);
    }
  });
});

// ── And the guard the early returns were written for ────────────────
// Narrowing them must not re-open the thing they protect: a director types,
// the debounce sends, and he types again before Firestore answers. The echo
// of the FIRST value must not land on top of the second.
//
// The harness delays its echo here for exactly that reason — the instant
// echo above can never overlap a keystroke, which is why this case needs a
// fixture of its own rather than another assertion on the one above.
describe("a keystroke that lands while the last one is still in flight", () => {
  function SlowConsole({ writes }) {
    const [rounds, setRounds] = useState([ROUND_1, ROUND_4]);
    return <AdminView {...props({
      tRounds: rounds,
      onSetRound: async (w) => {
        writes.push(w);
        setTimeout(() => setRounds(
          (prev) => prev.map((r) => (r.round_number === w.round_number ? { ...r, ...w } : r))), 400);
      },
    })} />;
  }

  afterEach(() => { vi.useRealTimers(); });

  it("keeps the newer number", async () => {
    vi.useFakeTimers();
    const writes = [];
    const { container } = render(<SlowConsole writes={writes} />);
    await act(async () => {
      fireEvent.click([...container.querySelectorAll("button")]
        .find((b) => /formats/i.test(b.textContent || "")));
    });
    await act(async () => { vi.advanceTimersByTime(1500); });
    await step(() => fireEvent.click(pill(container, 4)));

    // Type 5. The debounce sends it; the echo is 400ms behind.
    await act(async () => {
      fireEvent.change(holeBoxes(container)[0], { target: { value: "5" } });
    });
    await act(async () => { vi.advanceTimersByTime(750); });
    // Type 4 while the echo of 5 is still on the wire.
    await act(async () => {
      fireEvent.change(holeBoxes(container)[0], { target: { value: "4" } });
    });
    // Now let the echo of 5 arrive, and everything after it settle.
    await act(async () => { vi.advanceTimersByTime(2000); });

    expect(holeBoxes(container)[0].value).toBe("4");
    expect(lastWriteFor(writes, 4).counting_scores.holes[0]).toBe(4);
  });
});

// ── The sequence as it was reported ─────────────────────────────────
// "A director made a small change to the hole contributions and the Final
// Countdown got toggled off." The change is the trigger, but the damage was
// done by the round he had looked at before it: the boxes were still holding
// that round when he typed, and the edit is simply what made the form write.
describe("a small change to the hole contributions", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("does not take anything else with it", async () => {
    vi.useFakeTimers();
    const writes = [];
    const { container } = render(<Console writes={writes} />);
    await act(async () => {
      fireEvent.click([...container.querySelectorAll("button")]
        .find((b) => /formats/i.test(b.textContent || "")));
    });
    await act(async () => { vi.advanceTimersByTime(1500); });

    // A director's actual afternoon: set up round 4, glance at round 1,
    // come back, and adjust one hole.
    await step(() => fireEvent.click(pill(container, 4)));
    await step(() => fireEvent.change(holeBoxes(container)[0], { target: { value: "5" } }));
    await step(() => fireEvent.click(pill(container, 1)));
    await step(() => fireEvent.click(pill(container, 4)));
    writes.length = 0;
    await step(() => fireEvent.change(holeBoxes(container)[0], { target: { value: "4" } }));

    const w = lastWriteFor(writes, 4);
    expect(w, "the hole change must save").toBeTruthy();
    // The contributions he touched moved, and the back nine did not.
    expect(w.counting_scores.holes[0]).toBe(4);
    expect(w.counting_scores.holes[9]).toBe(7);
    expect(w.sealed).toBe(true);
    expect(w.format).toBe("team_best_ball");
    expect(w.scoring_type).toBe("points");
    expect(w.tee_time).toBe("9:00");
    expect(w.date).toBe("2026-07-19");
    expect(w.hole_points).toEqual({ front: 1, back: 2 });
  });
});
