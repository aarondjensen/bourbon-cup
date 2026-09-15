/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  Editing a draw that already exists.
// ══════════════════════════════════════════════════════════════════
//
// The Matches tab could build a draw and it could destroy one. Three things
// in between were missing or broken, and all three only show up once the
// tournament is actually running — which is the week nobody is reading test
// output.
//
//   THE FINAL ROUND'S DRAW WAS NOT LOCKED. The tab prints "ROUND N IS FINAL.
//   Its draw is locked to its result" and four handlers enforced it. The
//   three that a TEAM format reaches — Auto-build, the chip editor, the ✕ on
//   a tee time — did not, so the closing round, the one that decides the cup,
//   drew that banner over three live controls.
//
//   THE WRITES WERE AWAITED. Firestore's setDoc does not resolve with no
//   signal and does not reject either (see lib/connection), so at the first
//   tee every line after `await onSetMatch(...)` simply never ran: the new
//   match got no tee time, the pools stayed lit, no toast came, and a deleted
//   match left its four players standing on a tee time.
//
//   A SIDE COULD BE THE WRONG SIZE. A 2-Man Best Ball is two a side and there
//   is no other reading of one, but the cap was advisory — a red line saying
//   "check the selection" under a Create button that made the 3v1 anyway.
//
//   A PAIRING COULD NOT BE CORRECTED. "Pete and Jim are the wrong way round"
//   cost two deletes, two rebuilds and two drags to put the foursomes back on
//   the times they came off. It is two taps now.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, waitFor, screen } from "@testing-library/react";

vi.mock("../firebase", () => ({
  db: { subscribe: () => () => {}, upsert: async () => null, delete: async () => null, get: async () => [] },
  TOURNAMENT_ID: "bc_demo",
  editionDocId: (id) => `bc_demo__${id}`,
  getTournamentYear: () => 2026,
  writeFailure: () => "failed",
  writeTracker: { track: (p) => p, state: () => ({ pending: 0, kinds: {}, since: null, refused: 0, refusedKinds: {} }), subscribe: () => () => {} },
  firebaseApp: {},
}));

import { MatchSetup } from "./MatchSetup";

afterEach(cleanup);

const TEAMS = {
  A: { id: "A", name: "Alpha", color: "#005c2b", accent: "#00ae52" },
  B: { id: "B", name: "Beta", color: "#103c40", accent: "#46b4c0" },
};
const side = (t, n) => Array.from({ length: n }, (_, i) => ({
  player_id: `${t}${i + 1}`, name: `${t}Player${i + 1}`, team: t, handicap_index: 10,
}));
const roster = [...side("A", 8), ...side("B", 8)];

const props = (over = {}) => ({
  round: 1, setRound: () => {},
  tournamentRounds: [1, 2, 3, 4],
  tRounds: [{ round_number: 1, format: "best_ball", tee_time: "8:00|8:10|8:20|8:30", course_id: "c1" }],
  courses: [{ id: "c1", name: "Course", par: 72, holes: [] }],
  tPlayers: roster,
  matches: [],
  teams: TEAMS, teamNames: { A: "Alpha", B: "Beta" },
  hcpOverrides: {}, teeAssignments: {}, roundLocks: {},
  storedGroups: null,
  onSaveGroups: vi.fn(), onSetMatch: vi.fn(),
  notify: vi.fn(), confirm: vi.fn(async () => true),
  holeData: {}, onDiscardRoundScores: vi.fn(),
  ...over,
});

// Two 2-man matches off two tee times — the shape of every round but the last.
const M1 = { id: "m1", round: 1, matchNumber: 1, teamA: ["A1", "A2"], teamB: ["B1", "B2"] };
const M2 = { id: "m2", round: 1, matchNumber: 2, teamA: ["A3", "A4"], teamB: ["B3", "B4"] };
const drawn = (over = {}) => props({
  matches: [M1, M2],
  storedGroups: [["A1", "B1", "A2", "B2"], ["A3", "B3", "A4", "B4"], [], []],
  ...over,
});

// The closing round: one match holding both sides, waves of teammates.
const teamRound = (over = {}) => props({
  round: 4,
  tRounds: [{ round_number: 4, format: "team_best_ball", tee_time: "8:00|8:10|8:20|8:30", course_id: "c1" }],
  matches: [{
    id: "bc_demo__bc_match_r4_teams", round: 4, matchNumber: 9,
    teamA: side("A", 8).map(p => p.player_id), teamB: side("B", 8).map(p => p.player_id),
  }],
  storedGroups: [["A1", "A2", "A3", "A4"], ["B1", "B2", "B3", "B4"], ["A5", "A6", "A7", "A8"], ["B5", "B6", "B7", "B8"]],
  roundLocks: { 4: { round_number: 4, final: true, locked: true, players: {} } },
  ...over,
});

describe("a FINAL round's draw is locked on every format", () => {
  it("says so", () => {
    render(<MatchSetup {...teamRound()} />);
    expect(screen.getByText(/ROUND 4 IS FINAL/i)).toBeTruthy();
  });

  it("takes Auto-build and the tee-time ✕ off the team sheet", () => {
    const { container } = render(<MatchSetup {...teamRound()} />);
    expect(screen.queryByText("Auto-build")).toBeNull();
    expect([...container.querySelectorAll("button")].filter(b => b.textContent === "✕")).toHaveLength(0);
  });

  it("leaves the waves on screen but refuses to lift one of them", () => {
    const p = teamRound();
    render(<MatchSetup {...p} />);
    // The draw is still READABLE — this is the only place Round 4's waves are
    // drawn, and hiding them would answer the wrong question.
    expect(screen.getByText("APlayer1")).toBeTruthy();
    fireEvent.click(screen.getByText("APlayer1"));
    expect(screen.queryByText(/Move APlayer1 here/i)).toBeNull();
    expect(p.onSaveGroups).not.toHaveBeenCalled();
  });

  it("still offers all three the moment the round is reopened", () => {
    render(<MatchSetup {...teamRound({ roundLocks: { 4: { round_number: 4, final: false, locked: true, players: {} } } })} />);
    expect(screen.getByText("Auto-build")).toBeTruthy();
    fireEvent.click(screen.getByText("APlayer1"));
    expect(screen.getAllByText(/Move APlayer1 here/i).length).toBeGreaterThan(0);
  });
});

describe("with no signal, the write waits and the screen does not", () => {
  // A promise that never settles is exactly what setDoc hands back offline.
  const stuck = () => vi.fn(() => new Promise(() => {}));

  it("a created match still lands on a tee time and still says so", async () => {
    const p = props({ onSetMatch: stuck() });
    render(<MatchSetup {...p} />);
    ["APlayer1", "APlayer2", "BPlayer1", "BPlayer2"].forEach(n => fireEvent.click(screen.getByText(n)));
    fireEvent.click(screen.getByText(/^Create Match/));
    await waitFor(() => expect(p.onSaveGroups).toHaveBeenCalled());
    expect(p.onSaveGroups.mock.calls[0][1][0]).toEqual(["A1", "B1", "A2", "B2"]);
    expect(p.notify.mock.calls[0]).toEqual([expect.stringMatching(/Match created — off 8:00/), "success"]);
    // And the pools are clear for the next pairing.
    expect(screen.queryByText(/^Create Match/)).toBeNull();
  });

  it("a deleted match still takes its players off their tee time", async () => {
    const p = drawn({ onSetMatch: stuck() });
    const { container } = render(<MatchSetup {...p} />);
    fireEvent.click([...container.querySelectorAll("button")].filter(b => b.textContent === "✕")[0]);
    await waitFor(() => expect(p.onSaveGroups).toHaveBeenCalled());
    // M1's four are gone; M2's tee time is untouched.
    expect(p.onSaveGroups.mock.calls[0][1]).toEqual([[], ["A3", "B3", "A4", "B4"]]);
  });
});

describe("correcting a pairing", () => {
  it("trades two players on the same side, across two matches and two tee times", async () => {
    const p = drawn();
    render(<MatchSetup {...p} />);
    fireEvent.click(screen.getByText("APlayer2"));   // lift, out of M1
    expect(screen.getByText(/APlayer2 lifted/)).toBeTruthy();
    fireEvent.click(screen.getByText("APlayer3"));   // trade, into M2
    await waitFor(() => expect(p.onSetMatch).toHaveBeenCalledTimes(2));
    const written = Object.fromEntries(p.onSetMatch.mock.calls.map(([m]) => [m.id, m]));
    expect(written.m1.teamA).toEqual(["A1", "A3"]);
    expect(written.m2.teamA).toEqual(["A2", "A4"]);
    // The stored names are rebuilt off the new ids, never left on the old pair.
    expect(written.m1.teamANames).toEqual(["APlayer1", "APlayer3"]);
    // Neither match carries a copy of the round's setup back to Firestore.
    expect(written.m1.nassau).toBeUndefined();
    expect(written.m1.scoring_type).toBeUndefined();
    // Each man takes the other's seat, so both tee times keep their shape.
    expect(p.onSaveGroups.mock.calls[0][1]).toEqual([["A1", "B1", "A3", "B2"], ["A2", "B3", "A4", "B4"]]);
  });

  it("reads a tap on the other side as a change of mind, not a transfer", async () => {
    const p = drawn();
    render(<MatchSetup {...p} />);
    fireEvent.click(screen.getByText("APlayer2"));
    fireEvent.click(screen.getByText("BPlayer3"));
    expect(p.onSetMatch).not.toHaveBeenCalled();
    expect(screen.getByText(/BPlayer3 lifted/)).toBeTruthy();
  });

  it("puts a lifted man back down when he is tapped again", () => {
    const p = drawn();
    render(<MatchSetup {...p} />);
    fireEvent.click(screen.getByText("APlayer2"));
    fireEvent.click(screen.getByText("APlayer2"));
    expect(screen.queryByText(/lifted/)).toBeNull();
    expect(p.onSetMatch).not.toHaveBeenCalled();
  });

  it("says what the holes will do before it moves anybody who has posted", async () => {
    const p = drawn({ holeData: { A2_1: { 0: 4, 1: 5, 2: 4 } }, confirm: vi.fn(async () => false) });
    render(<MatchSetup {...p} />);
    fireEvent.click(screen.getByText("APlayer2"));
    fireEvent.click(screen.getByText("APlayer3"));
    await waitFor(() => expect(p.confirm).toHaveBeenCalled());
    expect(p.confirm.mock.calls[0][0].message).toMatch(/APlayer2 \(3\)/);
    expect(p.onSetMatch).not.toHaveBeenCalled();   // declined
  });

  it("substitutes a man off the pool for one in a match", async () => {
    // Only two matches are drawn, so A5–A8 are still in the pool.
    const p = drawn();
    render(<MatchSetup {...p} />);
    fireEvent.click(screen.getByText("APlayer4"));   // lifted out of M2
    fireEvent.click(screen.getByText("APlayer5"));   // off the pool
    await waitFor(() => expect(p.onSetMatch).toHaveBeenCalledTimes(1));
    expect(p.onSetMatch.mock.calls[0][0].teamA).toEqual(["A3", "A5"]);
    expect(p.onSaveGroups.mock.calls[0][1][1]).toEqual(["A3", "B3", "A5", "B4"]);
  });

  it("is off on a final round", () => {
    const p = drawn({ roundLocks: { 1: { round_number: 1, final: true, locked: true, players: {} } } });
    render(<MatchSetup {...p} />);
    fireEvent.click(screen.getByText("APlayer2"));
    expect(screen.queryByText(/lifted/)).toBeNull();
  });
});

describe("re-timing a match without a drag", () => {
  // A drag cannot scroll the page it is on — the grip holds pointer capture
  // and refuses panning — so a tee card below the fold was unreachable. A tap
  // lifts instead, and the sheet can then be scrolled with both thumbs free.
  const grip = (label) => screen.getByText(label).parentElement;

  it("a tap on the grip lifts the match and offers every other tee time", () => {
    render(<MatchSetup {...drawn()} />);
    fireEvent.pointerDown(grip("M1"), { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(grip("M1"), { pointerId: 1, clientX: 10, clientY: 10 });
    expect(screen.getByText(/M1 lifted/)).toBeTruthy();
    // Its own tee time is not offered; the other three are.
    expect(screen.getAllByText(/^(Move|Swap) here$/)).toHaveLength(3);
  });

  it("and tapping a tee time commits the same move a drop would", async () => {
    const p = drawn();
    render(<MatchSetup {...p} />);
    fireEvent.pointerDown(grip("M1"), { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(grip("M1"), { pointerId: 1, clientX: 10, clientY: 10 });
    // The first offered card is the 8:10 time, which M2 is riding — full, so
    // this is the swap the drag would have called SWAP.
    fireEvent.click(screen.getAllByText(/^(Move|Swap) here$/)[0]);
    await waitFor(() => expect(p.onSaveGroups).toHaveBeenCalled());
    expect(p.onSaveGroups.mock.calls[0][1]).toEqual([["A3", "B3", "A4", "B4"], ["A1", "B1", "A2", "B2"]]);
    expect(screen.queryByText(/M1 lifted/)).toBeNull();
  });

  it("a tap that travelled is a drag, and does not lift", () => {
    render(<MatchSetup {...drawn()} />);
    fireEvent.pointerDown(grip("M1"), { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(grip("M1"), { pointerId: 1, clientX: 10, clientY: 90 });
    fireEvent.pointerUp(grip("M1"), { pointerId: 1, clientX: 10, clientY: 90 });
    expect(screen.queryByText(/M1 lifted/)).toBeNull();
  });

  it("does not offer the lift on a final round", () => {
    render(<MatchSetup {...drawn({ roundLocks: { 1: { round_number: 1, final: true, locked: true, players: {} } } })} />);
    fireEvent.pointerDown(grip("M1"), { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(grip("M1"), { pointerId: 1, clientX: 10, clientY: 10 });
    expect(screen.queryByText(/M1 lifted/)).toBeNull();
  });
});


describe("a side is the size the format says", () => {
  // Not a warning. The engine has no reading of a 3v1 best ball or a 2v1
  // single, so an over-filled side is not a match to be flagged — it is a tap
  // that should not land.
  // The POOL row, specifically. A selected man is also named on the strokes
  // card above the button, so a bare getByText finds two of him.
  const pick = (...names) => names.forEach(n => {
    const inPool = screen.getAllByText(n).find(el => /CH /.test(el.parentElement?.textContent || ""));
    fireEvent.click(inPool || screen.getByText(n));
  });

  it("refuses the third man on a 2-a-side format, and says why", () => {
    const p = props();
    render(<MatchSetup {...p} />);
    pick("APlayer1", "APlayer2", "APlayer3");
    expect(p.notify.mock.calls[0]).toEqual([expect.stringMatching(/2-Man Best Ball is 2 a side/), "error"]);
    pick("BPlayer1", "BPlayer2");
    fireEvent.click(screen.getByText(/^Create Match/));
    expect(p.onSetMatch.mock.calls[0][0].teamA).toEqual(["A1", "A2"]);
  });

  it("refuses the second man on Singles", () => {
    const p = props({ tRounds: [{ round_number: 1, format: "singles", tee_time: "8:00|8:10|8:20|8:30", course_id: "c1" }] });
    render(<MatchSetup {...p} />);
    pick("APlayer1", "APlayer2");
    expect(p.notify.mock.calls[0]).toEqual([expect.stringMatching(/Singles is 1 a side/), "error"]);
  });

  it("tapping a name off makes room for another", () => {
    const p = props();
    render(<MatchSetup {...p} />);
    pick("APlayer1", "APlayer2");
    pick("APlayer2");                       // off again
    pick("APlayer5");
    pick("BPlayer1", "BPlayer2");
    fireEvent.click(screen.getByText(/^Create Match/));
    expect(p.onSetMatch.mock.calls[0][0].teamA).toEqual(["A1", "A5"]);
  });

  it("does not offer Create until both sides are full", () => {
    render(<MatchSetup {...props()} />);
    pick("APlayer1", "BPlayer1");
    // One a side is a complete Singles match and half a 2-man one. The button
    // used to light here and create the 1v1.
    expect(screen.queryByText(/^Create Match/)).toBeNull();
    pick("APlayer2", "BPlayer2");
    expect(screen.getByText(/^Create Match/)).toBeTruthy();
  });

  it("still lets a teammate format pick its four", () => {
    // perSide is null there, and the cap is the tee time's four instead.
    const p = props({
      round: 4,
      tRounds: [{ round_number: 4, format: "team_best_ball", tee_time: "8:00|8:10|8:20|8:30", course_id: "c1" }],
      storedGroups: [[], [], [], []],
    });
    render(<MatchSetup {...p} />);
    pick("APlayer1", "APlayer2", "APlayer3", "APlayer4");
    expect(screen.getByText(/off 8:00/)).toBeTruthy();
    pick("APlayer5");
    expect(p.notify.mock.calls[0]).toEqual([expect.stringMatching(/A tee time holds 4/), "error"]);
  });
});
