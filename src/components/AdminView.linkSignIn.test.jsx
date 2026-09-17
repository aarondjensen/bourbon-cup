/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  The way a name gets a sign-in when nobody claimed it here
// ══════════════════════════════════════════════════════════════════
//
// TJ signs in on 2026 and claims his name. He switches to 2025 — a tournament
// whose roster has his name on it — and the app does not know him: the claim
// wrote his uid onto ONE row, and `linkedPlayer` finds nothing here, so the
// switch leaves him a spectator.
//
// The visible cost is the captain badge. It reaches his membership through
// the roster row's `auth_uid` (membershipFor), so on a row nobody claimed
// there is nothing to find, the badge is inert, and the line under it used to
// say "They need to sign in and claim this name first" — advice for a problem
// he does not have, pointed at the one man who has already done it.
//
// So the sheet gains the other half of the unlink that was always there.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";

vi.mock("../firebase", () => ({
  db: { subscribe: () => () => {}, upsert: async () => null, delete: async () => null, get: async () => [] },
  TOURNAMENT_ID: "bc_2025",
  editionDocId: (id) => `bc_2025__${id}`,
  getTournamentYear: () => 2025,
  writeFailure: () => "failed",
  writeTracker: { track: (p) => p, state: () => ({ pending: 0, kinds: {}, since: null, refused: 0, refusedKinds: {} }), subscribe: () => () => {} },
  firebaseApp: {},
  getActiveTournamentId: () => "bc_2025",
  getDefaultEditionId: () => "bc_2025",
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

const teams = { A: { id: "A", name: "Irons", accent: "#00ae52" }, B: { id: "B", name: "Drivers", accent: "#46b4c0" } };

// 2025's roster. Dave claimed his name here; TJ's row is unclaimed, because
// he first signed in on 2026.
const tPlayers = [
  { player_id: "p1", name: "Dave K", first_name: "Dave", last_name: "Kelly", team: "A", handicap_index: 9.4, auth_uid: "u_dave" },
  { player_id: "p2", name: "TJ M", first_name: "TJ", last_name: "Moore", team: "A", handicap_index: 7.1 },
];
// bc_accounts is NOT edition-scoped — one membership per person, whichever
// year they signed in on. That is what makes this fixable at all.
const memberships = [
  { id: "u_dave", uid: "u_dave", email: "dave@example.com" },
  { id: "u_tj", uid: "u_tj", email: "tj@example.com" },
];

const props = (over = {}) => ({
  user: { isDirector: true, player_id: "p9", auth_uid: "u9" },
  tPlayers, memberships,
  onSetDirector: async () => ({ ok: true }),
  onSetCaptain: async () => ({ ok: true }),
  editionId: "bc_2025",
  tRounds: [], courses: [], matches: [],
  onAddPlayer: async () => {}, onUpdatePlayer: async () => {}, onRemovePlayer: async () => {},
  onAddCourse: async () => {}, onSetRound: async () => {}, onSetMatch: async () => {},
  holeData: {}, onDiscardRoundScores: async () => {},
  teams, teamNames: { A: "Irons", B: "Drivers" },
  onSaveTeamNames: async () => {}, brand: {}, onSaveBranding: async () => {},
  tournamentName: "The Bourbon Cup 2025", tournamentLocation: "MI", roundCount: 4,
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

// Open one man's sheet. It is a Popup, portaled onto <body>.
const sheet = (name, over = {}) => {
  const { container } = render(<AdminView {...props(over)} />);
  const rows = [...container.querySelectorAll("div")].filter(d =>
    d.textContent.includes(name)
    && [...d.querySelectorAll("button")].some(b => /^EDIT$/i.test(b.textContent || "")));
  const row = rows[rows.length - 1];
  expect(row, `no row for ${name}`).toBeTruthy();
  fireEvent.click([...row.querySelectorAll("button")].find(b => /^EDIT$/i.test(b.textContent)));
  return document.body;
};

const picker = (c) => [...c.querySelectorAll("select")]
  .find((s) => [...s.options].some((o) => /@example\.com/.test(o.textContent)));
const press = (c, label) => [...c.querySelectorAll("button")]
  .find(b => (b.textContent || "").trim().toUpperCase() === label);

describe("linking a sign-in to an unclaimed name", () => {
  it("offers the accounts that hold no name in this year", () => {
    const sel = picker(sheet("TJ M"));
    expect(sel).toBeTruthy();
    const labels = [...sel.options].map((o) => o.textContent);
    // TJ, because his name here is unclaimed even though he holds one in 2026.
    expect(labels).toContain("tj@example.com");
    // Not Dave — he already holds a name in THIS edition.
    expect(labels).not.toContain("dave@example.com");
    // And the way out of it, for a director who opened the picker by mistake.
    expect(labels).toContain("Not signed in");
  });

  it("is not drawn on a name somebody already claimed", () => {
    // That row has the Unlink instead, and offering both would be two
    // controls for one field pointing opposite ways.
    const c = sheet("Dave K");
    expect(picker(c)).toBeFalsy();
    expect(c.textContent).toContain("Unlink");
  });

  it("writes nothing until Save is confirmed", async () => {
    const saved = [];
    const c = sheet("TJ M", { onUpdatePlayer: async (p) => { saved.push(p); } });
    await act(async () => { fireEvent.change(picker(c), { target: { value: "u_tj" } }); });
    expect(saved).toEqual([]);
    await act(async () => { fireEvent.click(press(c, "SAVE")); });
    // Named in the confirm, with what it buys — the badges are the point.
    expect(c.textContent).toContain("Sign-in: link tj@example.com");
    expect(c.textContent).toContain("The Bourbon Cup 2025");
    expect(saved).toEqual([]);
    const yes = [...c.querySelectorAll("button")]
      .filter(b => /^confirm$/i.test((b.textContent || "").trim())).pop();
    await act(async () => { fireEvent.click(yes); });
    expect(saved.length).toBe(1);
    expect(saved[0].auth_uid).toBe("u_tj");
    expect(saved[0].auth_email).toBe("tj@example.com");
    expect(saved[0].player_id).toBe("p2");
  });

  it("leaves the row alone when the director picks nobody", async () => {
    const saved = [];
    const c = sheet("TJ M", { onUpdatePlayer: async (p) => { saved.push(p); } });
    await act(async () => { fireEvent.click(press(c, "SAVE")); });
    expect(saved).toEqual([]);
    expect(c.textContent).not.toContain("Sign-in: link");
  });
});

// The line under the two badges. It was written for a man who has never
// signed in, and it is the wrong advice for the man this whole control is
// for — he HAS signed in, on another year.
describe("what the badges say about it", () => {
  it("points at the control rather than at a sign-in he already did", () => {
    const c = sheet("TJ M");
    expect(c.textContent).toContain("set Signed in as below");
    expect(c.textContent).not.toContain("They need to sign in and claim this name first.");
  });

  it("says it once, not once per badge", () => {
    // The crown and the armband are out for the same reason and the sheet
    // de-duplicates their hints. Two spellings of one condition print as two
    // separate problems, which is what happened when only one was reworded.
    const hint = "Nobody is signed in to this name here — set Signed in as below.";
    expect(sheet("TJ M").textContent.split(hint).length - 1).toBe(1);
  });

  it("still says the old thing when there is nobody left to offer", () => {
    // Every membership already holds a name here, so the picker has nothing
    // in it and the remedy really is for him to go and sign in.
    const only = [{ id: "u_dave", uid: "u_dave", email: "dave@example.com" }];
    const c = sheet("TJ M", { memberships: only });
    expect(picker(c)).toBeFalsy();
    expect(c.textContent).toContain("sign in and claim this name first");
  });
});

// ── Naming him and naming him captain are one act ─────────────────
// The armband is why a director opens this sheet at all — a man cannot be
// made captain of a year he is a stranger in. Reading the pick out of the
// FORM rather than waiting for it to be saved is what keeps that one Save:
// otherwise the badge stays inert behind a line that has just stopped being
// true, and the fix is to save, close the sheet and open it again.
describe("the armband, on the same visit", () => {
  const horn = (c) => c.querySelector('button[aria-label="Irons captain"]');

  it("lights as soon as an account is picked", async () => {
    const c = sheet("TJ M");
    expect(horn(c).disabled).toBe(true);
    await act(async () => { fireEvent.change(picker(c), { target: { value: "u_tj" } }); });
    expect(horn(c).disabled).toBe(false);
    // And the line explaining why it was out goes with it.
    expect(c.textContent).not.toContain("set Signed in as below");
  });

  it("goes back out if the director changes their mind", async () => {
    const c = sheet("TJ M");
    await act(async () => { fireEvent.change(picker(c), { target: { value: "u_tj" } }); });
    await act(async () => { fireEvent.change(picker(c), { target: { value: "" } }); });
    expect(horn(c).disabled).toBe(true);
  });

  it("writes the link and the captaincy in one Save", async () => {
    let saved = null; const grants = [];
    const c = sheet("TJ M", {
      onUpdatePlayer: async (p) => { saved = p; },
      onSetCaptain: async (...a) => { grants.push(a); return { ok: true }; },
    });
    await act(async () => { fireEvent.change(picker(c), { target: { value: "u_tj" } }); });
    await act(async () => { fireEvent.click(horn(c)); });
    await act(async () => { fireEvent.click(press(c, "SAVE")); });
    // Both named on the way past, because both are about to happen.
    expect(c.textContent).toContain("Sign-in: link tj@example.com");
    expect(c.textContent).toContain("Captain of Irons");
    const yes = [...c.querySelectorAll("button")]
      .filter(b => /^confirm$/i.test((b.textContent || "").trim())).pop();
    await act(async () => { fireEvent.click(yes); });
    expect(saved.auth_uid).toBe("u_tj");
    // The armband goes onto the membership that was picked, not onto the
    // roster row — it is the uid the rules read (lib/captains).
    expect(grants).toEqual([["u_tj", "A"]]);
  });
});
