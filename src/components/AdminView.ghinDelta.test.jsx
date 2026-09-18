/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  What the GHIN sync moved, on the rows it moved
// ══════════════════════════════════════════════════════════════════
//
// The batch sync's toast can only carry a count. "3 updated, 13 unchanged" is
// true and useless: the director now knows three indexes moved and has a
// sixteen-man roster to scroll looking for them, against numbers nobody wrote
// down before the sync overwrote them. So each row that moved takes the same
// ▲/▼ badge a tee change raises in the Formats tab, and the pair it moved
// between is on the tooltip.
//
// The map is held in AdminView state rather than on the player document, and
// that is the decision these tests pin: it is replaced whole on every run, so
// a man who moved on Saturday and held on Sunday is not still wearing
// Saturday's badge.
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

// Only the network hop is faked. `parseGhinHI`, `fmtHI` and `hiDelta` are the
// real ones — the sign on a plus handicap and the rounding are exactly what a
// mocked helper would stop testing.
const upstream = { calls: [], reply: {} };
vi.mock("../lib/ghin", async (orig) => ({
  ...(await orig()),
  syncGhinNumbers: async (numbers) => { upstream.calls.push(numbers); return upstream.reply; },
}));

import { AdminView } from "./AdminView";

afterEach(() => { cleanup(); upstream.calls = []; upstream.reply = {}; });

const teams = { A: { id: "A", name: "Irons", accent: "#00ae52" }, B: { id: "B", name: "Drivers", accent: "#46b4c0" } };

// Three linked men and one manual one. Dave is off a plus handicap, stored
// negative; Tim carries a director override, so his strokes cannot move even
// when his index does.
const tPlayers = [
  { player_id: "p1", name: "Dave K", first_name: "Dave", last_name: "Kelly", team: "A", handicap_index: -2.1, ghin_number: "1111111" },
  { player_id: "p2", name: "Paul W", first_name: "Paul", last_name: "Wynn", team: "A", handicap_index: 9.4, ghin_number: "2222222" },
  { player_id: "p3", name: "Tim C", first_name: "Tim", last_name: "Cole", team: "B", handicap_index: 14.2, hi_override: 12, ghin_number: "3333333" },
  { player_id: "p4", name: "Joe E", first_name: "Joe", last_name: "Elger", team: "B", handicap_index: 7.7 },
];

const props = (over = {}) => ({
  user: { isDirector: true, player_id: "p9", auth_uid: "u9" },
  tPlayers, memberships: [],
  onSetDirector: async () => ({ ok: true }),
  onSetCaptain: async () => ({ ok: true }),
  editionId: "bc_demo",
  tRounds: [], courses: [], matches: [],
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

// The roster row is the innermost div that names the man and carries an Edit
// button — the same handle AdminView.roleBadges.test.jsx uses.
const row = (container, name) => {
  const rows = [...container.querySelectorAll("div")].filter(d =>
    d.textContent.includes(name)
    && [...d.querySelectorAll("button")].some(b => /^EDIT$/i.test(b.textContent || "")));
  const last = rows[rows.length - 1];
  expect(last, `no row for ${name}`).toBeTruthy();
  return last;
};

// The delta badge, found by the tooltip it wears rather than by its glyph —
// ▲ is also the tee column's chevron elsewhere in the tab.
const deltaOf = (container, name) =>
  [...row(container, name).querySelectorAll("span[title]")]
    .find(s => (s.getAttribute("title") || "").startsWith("GHIN sync:"));

// Press the column header's 🔄 and take the confirm it raises.
const runSync = async (container) => {
  const btn = container.querySelector('button[aria-label="Re-sync handicaps from GHIN for every linked player"]');
  expect(btn, "no batch sync button").toBeTruthy();
  await act(async () => { fireEvent.click(btn); });
  const yes = [...document.body.querySelectorAll("button")]
    .find(b => /^Re-sync \d+$/.test((b.textContent || "").trim()));
  expect(yes, "the sync did not ask first").toBeTruthy();
  await act(async () => { fireEvent.click(yes); });
};

describe("the GHIN sync's delta badge", () => {
  it("is absent until a sync has run", () => {
    const { container } = render(<AdminView {...props()} />);
    expect(deltaOf(container, "Dave K")).toBeFalsy();
    expect(container.textContent).not.toContain("GHIN sync:");
  });

  // The column the badge sits beside printed the STORED index, and a plus
  // handicap is stored negative — so the one man in the field playing off a
  // plus read "-2.1" on this screen and "+2.1" on every screen a golfer sees.
  // It went unnoticed while nothing else on the row named a number; a badge
  // saying "moved +2.1 → +1.8" beside a column saying "-2.1" does not.
  it("prints the index the way a golfer writes it", () => {
    const { container } = render(<AdminView {...props()} />);
    expect(row(container, "Dave K").textContent).toContain("+2.1");
    expect(row(container, "Dave K").textContent).not.toContain("-2.1");
    // And leaves every ordinary index alone, override star included.
    expect(row(container, "Paul W").textContent).toContain("9.4");
    expect(row(container, "Tim C").textContent).toContain("12*");
  });

  it("marks the men who moved, and leaves the ones who held alone", async () => {
    upstream.reply = {
      "1111111": { ghin_number: "1111111", handicap_index: "+1.8" },  // -2.1 → -1.8: up 0.3
      "2222222": { ghin_number: "2222222", handicap_index: "9.4" },   // held
      "3333333": { ghin_number: "3333333", handicap_index: "13.6" },  // 14.2 → 13.6: down 0.6
    };
    const { container } = render(<AdminView {...props()} />);
    await runSync(container);

    // A plus handicap losing a tenth of its plus is an index going UP, which
    // is the direction the stored negative has to survive.
    expect(deltaOf(container, "Dave K").textContent).toBe("▲0.3");
    expect(deltaOf(container, "Dave K").getAttribute("title")).toContain("+2.1 → +1.8");

    expect(deltaOf(container, "Tim C").textContent).toBe("▼0.6");

    // Held, and never linked: neither is news.
    expect(deltaOf(container, "Paul W")).toBeFalsy();
    expect(deltaOf(container, "Joe E")).toBeFalsy();
    expect(upstream.calls).toEqual([["1111111", "2222222", "3333333"]]);
  });

  // The override wins over the synced index forever, so a badge on that row
  // is about a number that is not deciding anybody's strokes. It still shows
  // — that is precisely when a director wants to look at the override again —
  // and the tooltip is where the qualification goes, because the badge is the
  // same badge either way.
  it("says so when an override is holding the strokes still", async () => {
    upstream.reply = { "3333333": { ghin_number: "3333333", handicap_index: "13.6" } };
    const { container } = render(<AdminView {...props({ tPlayers: [tPlayers[2]] })} />);
    await runSync(container);
    expect(deltaOf(container, "Tim C").getAttribute("title")).toContain("override still wins");
    // The badge itself is unchanged — the qualification is on the tooltip,
    // not a second glyph nobody would be able to tell from the first.
    expect(deltaOf(container, "Tim C").textContent).toBe("▼0.6");
  });

  // The whole map is replaced on every run, including a run where nobody
  // moved. Merging instead would leave a row wearing three Saturdays of
  // badges, each one describing a sync the director has since re-run.
  it("clears on the next sync rather than accumulating", async () => {
    upstream.reply = { "2222222": { ghin_number: "2222222", handicap_index: "10.1" } };
    const { container } = render(<AdminView {...props({ tPlayers: [tPlayers[1]] })} />);
    await runSync(container);
    expect(deltaOf(container, "Paul W").textContent).toBe("▲0.7");

    // Second run, same stored 9.4 (tPlayers is static here, as a refused or
    // un-echoed write would leave it) and GHIN now agreeing with it.
    upstream.reply = { "2222222": { ghin_number: "2222222", handicap_index: "9.4" } };
    await runSync(container);
    expect(deltaOf(container, "Paul W")).toBeFalsy();
  });

  // Every one failing is the whole-batch outage the toast's reason string is
  // for. What must not happen is a badge claiming a move that never landed.
  it("marks nobody when the sync failed", async () => {
    upstream.reply = {
      "1111111": { ghin_number: "1111111", error: "401 from GHIN" },
      "2222222": { ghin_number: "2222222", handicap_index: null },
    };
    const { container } = render(<AdminView {...props({ tPlayers: [tPlayers[0], tPlayers[1]] })} />);
    await runSync(container);
    expect(container.textContent).not.toContain("GHIN sync:");
  });
});
