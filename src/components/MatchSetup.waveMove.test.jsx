/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  Re-timing a Team Best Ball wave.
// ══════════════════════════════════════════════════════════════════
//
// The closing round's draw is four waves of teammates, and until now it could
// be BUILT and it could be CLEARED and that was the whole vocabulary. The edit
// a director actually makes to one — "the Alpha four go off last" — had no
// verb: four lifts and four drops if the time he wanted was empty, and a Clear
// plus a rebuild of both waves from the pools if it was not.
//
// Every other format has had this since the draw was draggable, and reaches it
// by a road a team format cannot use: a 2-man match IS its foursome, so the
// match row is the wave and dragging it re-times one. A match holding the
// whole side has no such row — sixteen men do not go off one tee — so the tee
// SLOT had to become the thing that moves.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";

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

// Round 4 as it is actually played: one match holding both sides, four waves
// of four teammates, off ten-minute intervals. Open, not final — a final
// round's draw is locked and that is pinned in MatchSetup.drawEdit.test.
const WAVES = [
  ["A1", "A2", "A3", "A4"],
  ["B1", "B2", "B3", "B4"],
  ["A5", "A6", "A7", "A8"],
  ["B5", "B6", "B7", "B8"],
];
const teamRound = (over = {}) => ({
  round: 4, setRound: () => {},
  tournamentRounds: [1, 2, 3, 4],
  tRounds: [{ round_number: 4, format: "team_best_ball", tee_time: "8:00|8:10|8:20|8:30", course_id: "c1" }],
  courses: [{ id: "c1", name: "Course", par: 72, holes: [] }],
  tPlayers: roster,
  matches: [{
    id: "bc_demo__bc_match_r4_teams", round: 4, matchNumber: 9,
    teamA: side("A", 8).map(p => p.player_id), teamB: side("B", 8).map(p => p.player_id),
  }],
  teams: TEAMS, teamNames: { A: "Alpha", B: "Beta" },
  hcpOverrides: {}, teeAssignments: {}, roundLocks: {},
  storedGroups: WAVES.map(w => [...w]),
  onSaveGroups: vi.fn(), onSetMatch: vi.fn(),
  notify: vi.fn(), confirm: vi.fn(async () => true),
  holeData: {}, onDiscardRoundScores: vi.fn(),
  ...over,
});

// The tee time is the wave's grip, so the button to press is the one the time
// is drawn inside.
const grip = (time) => screen.getByText(time).closest("button");

describe("lifting a wave", () => {
  it("offers a grip on every tee time that has men on it", () => {
    render(<MatchSetup {...teamRound()} />);
    ["8:00", "8:10", "8:20", "8:30"].forEach(t => expect(grip(t)).toBeTruthy());
  });

  // Nothing to pick up, so nothing that looks like it can be picked up.
  it("does not offer one on an empty tee time", () => {
    render(<MatchSetup {...teamRound({ storedGroups: [WAVES[0], [], [], []] })} />);
    expect(grip("8:00")).toBeTruthy();
    expect(grip("8:10")).toBeNull();
  });

  it("turns every other tee time into a target", () => {
    render(<MatchSetup {...teamRound()} />);
    fireEvent.click(grip("8:00"));
    // Three targets, and no target on the card that is doing the moving.
    expect(screen.getAllByText("Swap")).toHaveLength(3);
  });

  it("puts the wave back down when its own grip is tapped again", () => {
    const p = teamRound();
    render(<MatchSetup {...p} />);
    fireEvent.click(grip("8:00"));
    fireEvent.click(grip("8:00"));
    expect(screen.queryByText("Swap")).toBeNull();
    expect(p.onSaveGroups).not.toHaveBeenCalled();
  });

  // One lifted thing at a time. A man up and a wave up at once is a screen
  // saying two different things about what the next tap does.
  it("is put down by lifting a man instead", () => {
    render(<MatchSetup {...teamRound()} />);
    fireEvent.click(grip("8:00"));
    fireEvent.click(screen.getByText("APlayer5"));
    expect(screen.queryByText("Swap")).toBeNull();
    expect(screen.getAllByText(/Move APlayer5 here/i).length).toBeGreaterThan(0);
  });
});

describe("dropping it on another tee time", () => {
  it("trades the two waves' times and leaves the rest of the sheet alone", () => {
    const p = teamRound();
    render(<MatchSetup {...p} />);
    fireEvent.click(grip("8:00"));
    fireEvent.click(screen.getAllByText("Swap")[2]);   // the 8:30 card
    expect(p.onSaveGroups).toHaveBeenCalledWith(4, [
      ["B5", "B6", "B7", "B8"],
      ["B1", "B2", "B3", "B4"],
      ["A5", "A6", "A7", "A8"],
      ["A1", "A2", "A3", "A4"],
    ]);
  });

  // An empty time receives rather than trades, and the button says which.
  it("reads Move here when the time is free, and moves the wave there", () => {
    const p = teamRound({ storedGroups: [WAVES[0], [], [], []] });
    render(<MatchSetup {...p} />);
    fireEvent.click(grip("8:00"));
    expect(screen.queryByText("Swap")).toBeNull();
    fireEvent.click(screen.getAllByText("Move here")[0]);  // the 8:10 card
    // trimGroups drops the trailing empties — the sheet still HAS four tee
    // times, they just live on the round document.
    expect(p.onSaveGroups).toHaveBeenCalledWith(4, [[], ["A1", "A2", "A3", "A4"]]);
  });

  it("clears the lift once it lands", () => {
    render(<MatchSetup {...teamRound()} />);
    fireEvent.click(grip("8:00"));
    fireEvent.click(screen.getAllByText("Swap")[0]);
    expect(screen.queryByText("Swap")).toBeNull();
  });

  it("names both times in the toast", () => {
    const p = teamRound();
    render(<MatchSetup {...p} />);
    fireEvent.click(grip("8:00"));
    fireEvent.click(screen.getAllByText("Swap")[0]);
    expect(p.notify).toHaveBeenCalledWith("8:00 and 8:10 swapped tee times", "success");
  });

  // The whole point of a trade: a tee sheet is full when a director wants
  // this, and neither end can come out of it holding five.
  it("can never put five men on a tee", () => {
    const p = teamRound();
    render(<MatchSetup {...p} />);
    fireEvent.click(grip("8:00"));
    fireEvent.click(screen.getAllByText("Swap")[1]);
    const [, saved] = p.onSaveGroups.mock.calls[0];
    expect(saved.every(g => g.length <= 4)).toBe(true);
    expect(saved.flat()).toHaveLength(16);
  });
});

describe("a final round", () => {
  const final = (over = {}) => teamRound({
    roundLocks: { 4: { round_number: 4, final: true, locked: true, players: {} } },
    ...over,
  });

  // Its draw is part of its result — the same rule the chip editor, Auto-build
  // and the ✕ already follow.
  it("offers no grip at all", () => {
    render(<MatchSetup {...final()} />);
    expect(grip("8:00")).toBeNull();
    expect(screen.getByText("8:00")).toBeTruthy();
  });
});
