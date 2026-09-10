/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  The two roles, as badges
// ══════════════════════════════════════════════════════════════════
//
// The crown and the armband were two full-width buttons — "👑 Director" on its
// own half-row and "📣 Mash Brothers captain" on a whole row of its own — four
// lines of the player sheet, counting their labels, to hold two booleans that
// are OFF for fourteen of the sixteen men.
//
// They are emoji badges now, and the thing that has to survive the shrink is
// the CONFIRM. A 36px square is easy to catch with a thumb, and both of these
// write to a document the roster edit cannot reach: `is_director` on a
// membership, and `captain_of` on another one that may belong to a different
// man entirely. So a tap moves the FORM and nothing else; Save is where the
// change is named and where it costs something.
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

const teams = { A: { id: "A", name: "Irons", accent: "#00ae52" }, B: { id: "B", name: "Drivers", accent: "#46b4c0" } };
const tPlayers = [
  // Signed in, and holds both roles.
  { player_id: "p1", name: "Dave K", first_name: "Dave", last_name: "Kelly", team: "A", handicap_index: 9.4, auth_uid: "u1" },
  // Signed in, holds neither.
  { player_id: "p2", name: "Paul W", first_name: "Paul", last_name: "Wynn", team: "A", handicap_index: 4.1, auth_uid: "u2" },
  // Never signed in — there is no membership document to flag.
  { player_id: "p3", name: "Tim C", first_name: "Tim", last_name: "Cole", team: "B", handicap_index: 14.2 },
];
const memberships = [
  { id: "u1", uid: "u1", is_director: true, captain_of: { bc_demo: "A" } },
  { id: "u2", uid: "u2" },
];

const props = (over = {}) => ({
  user: { isDirector: true, player_id: "p9", auth_uid: "u9" },
  tPlayers, memberships,
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

// Open one man's sheet on the Players tab, which is where AdminView lands.
const sheet = (name, over = {}) => {
  const { container } = render(<AdminView {...props(over)} />);
  const rows = [...container.querySelectorAll("div")].filter(d =>
    d.textContent.includes(name)
    && [...d.querySelectorAll("button")].some(b => /^EDIT$/i.test(b.textContent || "")));
  const row = rows[rows.length - 1];
  expect(row, `no row for ${name}`).toBeTruthy();
  fireEvent.click([...row.querySelectorAll("button")].find(b => /^EDIT$/i.test(b.textContent)));
  // The sheet is a Popup, portaled onto <body> — it is not inside the
  // container the roster rows live in.
  return document.body;
};

const badge = (c, label) => c.querySelector(`button[aria-label="${label}"]`);
const crown = (c) => badge(c, "Director");
const horn = (c) => badge(c, "Irons captain");
const press = (c, label) => [...c.querySelectorAll("button")]
  .find(b => (b.textContent || "").trim().toUpperCase() === label);

describe("the role badges", () => {
  it("are two tappable emoji, not two labelled buttons", () => {
    const c = sheet("Dave K");
    expect(crown(c).textContent).toBe("👑");
    expect(horn(c).textContent).toBe("📣");
    // The words they replaced are gone with them — that is the space saved.
    expect(c.textContent).not.toContain("Not a captain");
    expect(c.textContent).not.toContain("👑 Director");
  });

  // Three states, and the third has to be tellable from the second at a
  // glance: lit (he has it), grey (he does not — tap), and barely there and
  // inert (it is not yours to give, and the line underneath says why).
  it("light up for the roles he holds", () => {
    const c = sheet("Dave K");
    [crown(c), horn(c)].forEach((b) => {
      expect(b.getAttribute("aria-pressed")).toBe("true");
      expect(b.style.filter).toBe("none");
      expect(Number(b.style.opacity)).toBe(1);
      expect(b.disabled).toBe(false);
    });
  });

  it("grey out for the roles he does not, and stay tappable", () => {
    const c = sheet("Paul W");
    [crown(c), horn(c)].forEach((b) => {
      expect(b.getAttribute("aria-pressed")).toBe("false");
      expect(b.style.filter).toContain("grayscale");
      expect(b.disabled).toBe(false);
    });
  });

  it("go faint and inert for a man who has never signed in", () => {
    const c = sheet("Tim C");
    const cr = crown(c), hn = badge(c, "Drivers captain");
    [cr, hn].forEach((b) => {
      expect(b.disabled).toBe(true);
      expect(Number(b.style.opacity)).toBeLessThan(0.5);
    });
    // And the reason is printed ONCE, not once per badge — both are out for
    // the same reason, and saying it twice reads as two separate problems.
    const hint = "They need to sign in and claim this name first.";
    expect(c.textContent.split(hint).length - 1).toBe(1);
  });

  // The armband names the side, so there is nothing to pick — and it follows
  // the form's team, not the saved one, so moving a man across the sheet moves
  // it with him.
  it("name the side on the armband", () => {
    expect(horn(sheet("Dave K"))).toBeTruthy();
    cleanup();
    expect(badge(sheet("Tim C"), "Drivers captain")).toBeTruthy();
  });
});

// ── The half that matters now the target is a 36px square ──────────
describe("what a tap costs", () => {
  it("writes nothing on its own", async () => {
    const grants = [];
    const c = sheet("Paul W", { onSetDirector: async (...a) => { grants.push(a); return { ok: true }; } });
    await act(async () => { fireEvent.click(crown(c)); });
    expect(grants).toEqual([]);
    // It moved the FORM, which is what every other field on this sheet does.
    expect(crown(c).getAttribute("aria-pressed")).toBe("true");
  });

  it("still asks on Save, and names what is changing", async () => {
    const c = sheet("Paul W");
    await act(async () => { fireEvent.click(crown(c)); });
    await act(async () => { fireEvent.click(horn(c)); });
    await act(async () => { fireEvent.click(press(c, "SAVE")); });
    expect(c.textContent).toContain("Director: No → Yes");
    expect(c.textContent).toContain("Captain of Irons");
    // And what each one costs, which is the half a director cannot see.
    expect(c.textContent).toContain("They get the Admin tab");
    expect(c.textContent).toContain("Dave K stops being captain");
  });

  it("asks on the way back down too", async () => {
    const c = sheet("Dave K");
    await act(async () => { fireEvent.click(horn(c)); });
    await act(async () => { fireEvent.click(press(c, "SAVE")); });
    expect(c.textContent).toContain("No longer Irons captain");
    expect(c.textContent).toContain("no captain until you name one");
  });

  it("grants only once the confirm is taken", async () => {
    const grants = [];
    const c = sheet("Paul W", { onSetCaptain: async (...a) => { grants.push(a); return { ok: true }; } });
    await act(async () => { fireEvent.click(horn(c)); });
    await act(async () => { fireEvent.click(press(c, "SAVE")); });
    expect(grants).toEqual([]);
    // The dialog's own Confirm, not the sheet's Save behind it.
    const yes = [...c.querySelectorAll("button")]
      .filter(b => /^confirm$/i.test((b.textContent || "").trim())).pop();
    await act(async () => { fireEvent.click(yes); });
    expect(grants).toEqual([["u2", "A"]]);
  });
});
