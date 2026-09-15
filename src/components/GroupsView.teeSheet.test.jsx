/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  The field's "Matches" tab, on a round whose match is not a pairing.
// ══════════════════════════════════════════════════════════════════
//
// This tab doubles as the tee sheet — it is where a man looks up who he is
// walking with and when he goes off — and on the closing round it could
// answer neither.
//
// Team Best Ball's match is the whole side against the whole side, so the tab
// drew ONE card: sixteen names, "MATCH 9", and no tee time at all, because a
// match spread across four groups has no single time of its own
// (teeTimeForMatch returns "" by design, and that design is right). The
// director had built four waves with four times on them and not one of them
// reached a single phone, on the round the cup is decided in.
//
// Pinned here: that the waves ARE the cards on such a round, that a man the
// draw has not reached yet still finds himself, and that every other format —
// where a match IS a tee time — is untouched.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, within } from "@testing-library/react";

vi.mock("../lib/auth", () => ({
  PROVIDERS: { GOOGLE: "google.com", APPLE: "apple.com" },
  signIn: async () => ({ user: null, error: null }),
  signOutUser: async () => {},
  onAuthUser: () => () => {},
  consumeRedirectResult: async () => ({ user: null, error: null }),
  isCancelled: () => false,
  whenAuthReady: async () => {},
  providerLabel: () => "account",
}));
vi.mock("../firebase", () => ({
  db: { subscribe: () => () => {}, upsert: async () => null, delete: async () => null, get: async () => [] },
  TOURNAMENT_ID: "bc_test",
  editionDocId: (id) => id,
  getTournamentYear: () => 2026,
  writeFailure: () => "failed",
  writeTracker: { track: (p) => p, state: () => ({ pending: 0, kinds: {}, since: null, refused: 0, refusedKinds: {} }), subscribe: () => () => {} },
  firebaseApp: {},
  getMessagingInstance: async () => null,
  getActiveTournamentId: () => "bc_test",
  getDefaultEditionId: () => "bc_test",
  setActiveTournamentId: () => {},
  readUserSession: () => null,
  writeUserSession: () => {},
  readTournamentIdentity: () => null,
  writeTournamentIdentity: () => {},
  spectatorSession: () => null,
  BOOTSTRAP_DIRECTOR: "bootstrap_director",
  SPECTATOR_ID: "spectator",
}));

import { GroupsView } from "../App";

afterEach(cleanup);

const A = ["Aaron J", "Pete C", "Jim H", "Joe E", "Dave R", "Ben T", "Shaun W", "Tim C"];
const B = ["Paul W", "Mike A", "Rob K", "Nick S", "Chris B", "Matt L", "Sam O", "Luke P"];
const roster = [
  ...A.map((name, i) => ({ player_id: `A${i + 1}`, name, team: "A" })),
  ...B.map((name, i) => ({ player_id: `B${i + 1}`, name, team: "B" })),
];
const teams = {
  A: { id: "A", name: "Shot Callers", color: "#005c2b", accent: "#00ae52" },
  B: { id: "B", name: "Irons", color: "#103c40", accent: "#46b4c0" },
};
const courses = [{ id: "c1", name: "Treetops", par: 72 }];
const TEE = "8:00|8:10|8:20|8:30";

const teamMatch = {
  id: "t", round: 4, matchNumber: 9,
  teamA: A.map((_, i) => `A${i + 1}`), teamB: B.map((_, i) => `B${i + 1}`),
};
const waves = [["A1", "A2", "A3", "A4"], ["B1", "B2", "B3", "B4"], ["A5", "A6", "A7", "A8"], ["B5", "B6", "B7", "B8"]];

const singlesMatches = Array.from({ length: 8 }, (_, i) => ({
  id: `m${i + 1}`, round: 1, matchNumber: i + 1, teamA: [`A${i + 1}`], teamB: [`B${i + 1}`],
}));
const singlesGroups = [["A1", "B1", "A2", "B2"], ["A3", "B3", "A4", "B4"], ["A5", "B5", "A6", "B6"], ["A7", "B7", "A8", "B8"]];

const view = (over = {}) => render(<GroupsView
  matches={[teamMatch]}
  tRounds={[{ round_number: 4, format: "team_best_ball", tee_time: TEE, course_id: "c1" }]}
  tPlayers={roster}
  courses={courses}
  groups={{ 4: waves }}
  teams={teams}
  currentRound={4}
  {...over}
/>);

describe("a match that spans tee times shows the tee sheet", () => {
  it("names every wave, its side and the time it goes off", () => {
    view();
    ["8:00 AM", "8:10 AM", "8:20 AM", "8:30 AM"].forEach(t => expect(screen.getByText(t)).toBeTruthy());
    expect(screen.getAllByText("Shot Callers")).toHaveLength(2);
    expect(screen.getAllByText("Irons")).toHaveLength(2);
    // Sixteen men, each named once — in his wave, not in one roster column.
    [...A, ...B].forEach(n => expect(screen.getAllByText(n)).toHaveLength(1));
  });

  it("drops the sixteen-name match card, which said nothing the banner does not", () => {
    view();
    expect(screen.queryByText(/MATCH 9/i)).toBeNull();
    // The format is already named above the sheet, which is what makes the
    // 8v8 sayable without a card of its own.
    expect(screen.getByText(/TEAM BEST BALL/i)).toBeTruthy();
  });

  it("still finds a man the draw has not reached yet", () => {
    view({ groups: { 4: waves.slice(0, 2) } });
    const card = screen.getByText(/No tee time yet/i).closest("div").parentElement;
    ["Dave R", "Ben T", "Shaun W", "Tim C", "Chris B", "Matt L", "Sam O", "Luke P"]
      .forEach(n => expect(within(card).getByText(n)).toBeTruthy());
    // And the men who DO have one are not in it.
    expect(within(card).queryByText("Aaron J")).toBeNull();
  });

  it("falls back to the match card when nothing has been drawn at all", () => {
    view({ groups: { 4: [] } });
    expect(screen.getByText(/MATCH 9/i)).toBeTruthy();
  });
});

describe("every other format is untouched", () => {
  const singles = (over = {}) => view({
    matches: singlesMatches,
    tRounds: [{ round_number: 1, format: "singles", tee_time: TEE, course_id: "c1" }],
    groups: { 1: singlesGroups },
    currentRound: 1,
    ...over,
  });

  it("draws a card per match, each stamped with its own tee time", () => {
    singles();
    expect(screen.getByText("MATCH 1")).toBeTruthy();
    expect(screen.getByText("MATCH 8")).toBeTruthy();
    // Two matches to a tee time, so each time is printed twice.
    expect(screen.getAllByText("8:00 AM")).toHaveLength(2);
    expect(screen.queryByText(/No tee time yet/i)).toBeNull();
  });
});

describe("the round it opens on", () => {
  // The tab a player opens looking for his tee time must not land him on a
  // round that finished yesterday. `currentRound` is the scoring gate's own
  // answer, so the two tabs cannot disagree about which round is live.
  const multi = (over = {}) => view({
    matches: [...singlesMatches, teamMatch],
    tRounds: [
      { round_number: 1, format: "singles", tee_time: TEE, course_id: "c1" },
      { round_number: 4, format: "team_best_ball", tee_time: TEE, course_id: "c1" },
    ],
    groups: { 1: singlesGroups, 4: waves },
    ...over,
  });

  it("opens on the live round, not the first of the week", () => {
    multi({ currentRound: 4 });
    expect(screen.getByText(/TEAM BEST BALL/i)).toBeTruthy();
  });

  it("opens on the first round when the event is over", () => {
    // Every round final — any answer lands on a finalized round, so the
    // archive still reads from the start.
    multi({ currentRound: null });
    expect(screen.getByText(/SINGLES/i)).toBeTruthy();
  });
});
