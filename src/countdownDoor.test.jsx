/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  THE WAY ONTO THE TELEVISION CANNOT CLOSE
// ══════════════════════════════════════════════════════════════════
//
// For as long as the Final Countdown was reachable only from the button
// inside round 4's amber panel on the Leaderboard, it had four conditions
// stacked under it: the round SEALED, still CONCEALING, DRAWN, and its
// section OPEN. Each one is a way for the door to disappear, and a director
// standing in a room with sixteen men and all the scores in cannot debug a
// render condition.
//
// So there is a second door that asks one question — does this edition have a
// round with a ceremony attached — and it is in the menu, where a thing you
// cannot find is looked for. This file pins both halves:
//
//   • the ROW: who gets it, and that it survives every state that takes the
//     panel's button away;
//   • the DELIVERY: the request App hands the Leaderboard really does raise
//     the countdown, including on the mount that the row itself causes.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";

vi.mock("./lib/auth", () => ({
  PROVIDERS: { GOOGLE: "google.com", APPLE: "apple.com" },
  signIn: async () => ({ user: null, error: null }),
  signOutUser: async () => {},
  onAuthUser: () => () => {},
  consumeRedirectResult: async () => ({ user: null, error: null }),
  isCancelled: () => false,
  whenAuthReady: async () => {},
  providerLabel: () => "account",
}));

vi.mock("./firebase", () => ({
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

import { SlideMenu } from "./App";
import { TeamLeaderboard } from "./components/Leaderboard";
import { concealHoleData, countdownHoleData, ceremonyRoundNumber } from "./lib/reveal";

afterEach(cleanup);

const ROW = "Final Countdown";

// ── The row ─────────────────────────────────────────────────────────
const menu = (over = {}) => render(
  <SlideMenu
    open onClose={() => {}} onNavigate={() => {}} view="leaderboard"
    user={{ isDirector: true }} alerts={{}} onEditions={() => {}}
    onCountdown={() => {}} navH={56} {...over}
  />
).container.textContent;

describe("the menu row", () => {
  it("is there when App hands it an action", () => {
    expect(menu()).toContain(ROW);
  });

  it("is not drawn at all when App hands it none", () => {
    // Which is every player who is neither a director nor a captain, and any
    // edition with no round that has a ceremony attached.
    expect(menu({ onCountdown: null })).not.toContain(ROW);
  });

  it("does not need the crown — a captain is not a director", () => {
    expect(menu({ user: { isDirector: false } })).toContain(ROW);
  });

  it("fires its action rather than navigating to a view that does not exist", () => {
    const taps = [];
    const navs = [];
    const { container } = render(
      <SlideMenu open onClose={() => {}} onNavigate={(v) => navs.push(v)} view="leaderboard"
        user={{ isDirector: true }} alerts={{}} onEditions={() => {}}
        onCountdown={() => taps.push("open")} navH={56} />
    );
    fireEvent.click([...container.querySelectorAll("button")]
      .find((b) => (b.textContent || "").includes(ROW)));
    expect(taps).toEqual(["open"]);
    expect(navs).toEqual([]);
  });
});

// ── Which round it opens, in every state the panel gives up in ──────
describe("the round the row opens", () => {
  const tbb = (o) => ({ round_number: 4, format: "team_best_ball", ...o });
  const states = {
    "live, flag unset": tbb({}),
    "live, sealed": tbb({ sealed: true }),
    "a director tried to unseal it": tbb({ sealed: false }),
    "finalized before the ceremony ran": tbb({ sealed: true, final: true }),
    "finalized with the flag unset — the panel is gone entirely": tbb({ final: true }),
    "finalized and unsealed": tbb({ sealed: false, final: true }),
  };
  Object.entries(states).forEach(([label, tr]) => {
    it(`finds round 4 when it is ${label}`, () => {
      expect(ceremonyRoundNumber([{ round_number: 1, format: "singles" }, tr])).toBe(4);
    });
  });
});

// ── The delivery ────────────────────────────────────────────────────
const A = ["a1", "a2", "a3", "a4"];
const B = ["b1", "b2", "b3", "b4"];
const courses = [{
  id: "c1", name: "Treetops", hole_pars: Array(18).fill(4),
  hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1),
  tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }],
}];
const tPlayers = [...A, ...B].map((pid) => ({
  player_id: pid, name: pid.toUpperCase(), team: A.includes(pid) ? "A" : "B", handicap_index: 0,
}));
const teams = { A: { name: "Irons" }, B: { name: "Wedges" } };
const matches = [{ id: "m4", round: 4, teamA: A, teamB: B, scoring_type: "points" }];
const holeData = {};
Array.from({ length: 18 }, (_, h) => h).forEach((h) => {
  [...A, ...B].forEach((p) => {
    holeData[`${p}_4`] = { ...(holeData[`${p}_4`] || {}), [h]: A.includes(p) ? 5 : 4 };
  });
});
const round4 = (o = {}) => [{
  round_number: 4, format: "team_best_ball", course_id: "c1", tee_box: "White",
  handicap_mode: "full", scoring_type: "points",
  counting_scores: { holes: Array(18).fill(3) }, hole_points: { front: 1, back: 2 },
  sealed: true, ...o,
}];

const board = ({ request = null, onClosed = () => {}, tRounds = round4() } = {}) => render(
  <TeamLeaderboard
    matches={matches} holeData={concealHoleData(holeData, tRounds)} ownHoleData={holeData}
    countdownHoleData={countdownHoleData(holeData, tRounds)} courses={courses}
    tRounds={tRounds} tPlayers={tPlayers} teams={teams} hcpOverrides={{}} teeAssignments={{}}
    roundLocks={{}} viewer="A" canReveal onSetReveal={() => {}} onSetHole={() => {}}
    countdownRequest={request} onCountdownClosed={onClosed}
  />
);

// The countdown is a PORTAL onto document.body and the component behind it is
// lazily imported, so what lands first is the Suspense fallback — a black
// screen at z-index 9999, which is exactly what the television is meant to
// show while it loads. Either of those two is the screen being up. The board
// itself goes on rendering underneath, so asserting on the container's text
// would only ever tell you the portal is a portal.
const screenUp = (container) =>
  [...document.body.querySelectorAll("*")]
    .some((el) => !container.contains(el) && /9999/.test(el.getAttribute("style") || ""));

describe("the request App hands down", () => {
  it("opens the countdown on the mount the row itself causes", () => {
    // The row switches to this tab AND sets the request in one act, so the
    // component mounts with the request already in hand. Seeding `served`
    // from the prop would mark it honoured before it had been, and the row
    // would do nothing at all — which is the bug this whole file is about.
    const { container } = board({ request: { id: 1, round: 4 } });
    expect(screenUp(container)).toBe(true);
  });

  it("leaves the board alone when there is no request", () => {
    const { container } = board();
    expect(screenUp(container)).toBe(false);
    expect(container.textContent).toContain("WAITING ON THE FINAL COUNTDOWN");
  });

  it("tells App when the screen closes, so a served request cannot re-fire", async () => {
    const closed = [];
    const { container } = board({ request: { id: 7, round: 4 }, onClosed: () => closed.push(true) });
    // Wait for the real screen, which is where the exit lives.
    // FinalCountdown is lazily imported, so the portal opens on the black
    // Suspense fallback first — which is the right thing on a television and
    // the wrong thing to look for an EXIT button on.
    await act(async () => { await vi.dynamicImportSettled(); });
    const exit = [...document.body.querySelectorAll("button")]
      .find((b) => (b.textContent || "").trim() === "EXIT");
    expect(exit, "the countdown's EXIT").toBeTruthy();
    fireEvent.click(exit);
    expect(closed.length).toBeGreaterThan(0);
    expect(screenUp(container)).toBe(false);
  });
});

describe("and the panel's own button, once the round stops concealing", () => {
  it("is still offered to a director", () => {
    // Sealed, walked and in the books. The reveal stepper was already here —
    // the way back from a stray tap — and the television goes with it, for
    // the director who wants to walk it again.
    const done = round4({ reveal_through: 18, final: true });
    const { container } = render(
      <TeamLeaderboard
        matches={matches} holeData={concealHoleData(holeData, done)} ownHoleData={holeData}
        countdownHoleData={countdownHoleData(holeData, done)} courses={courses}
        tRounds={done} tPlayers={tPlayers} teams={teams} hcpOverrides={{}} teeAssignments={{}}
        roundLocks={{ 4: { locked: true, final: true } }} viewer="A"
        canReveal onSetReveal={() => {}} onSetHole={() => {}}
      />
    );
    expect(container.textContent).toContain("OPEN THE FINAL COUNTDOWN");
  });
});
