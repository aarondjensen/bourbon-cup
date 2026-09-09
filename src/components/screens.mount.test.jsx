/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  Every screen renders. That is the whole assertion.
// ══════════════════════════════════════════════════════════════════
//
// Ported as a practice from WBC, where the Betting tab shipped DEAD ON TAP
// with lint, build and every unit test green — because no test had ever
// rendered it. `no-undef` cannot see JSX element names, so a component used
// but never imported lints clean and builds clean; `react/jsx-no-undef` is on
// for exactly that, but everything downstream of a bad import, a renamed
// export or a prop read off undefined only fails when somebody taps the tab.
//
// So this tests nothing about what these screens COMPUTE — that arithmetic
// lives in src/lib with its own suites. It mounts each one with plausible
// props and asserts nothing threw, and it covers the two states nobody
// develops against: the empty tournament and the finished one.
//
// Anything LAZY-LOADED needs this most. DataView's chunk is only fetched when
// somebody opens ☰ → Data, so a broken import there cannot fail anywhere else
// first.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";

// The screens under test reach for Firestore at import time (the db handle)
// and, in one case, subscribe on mount. Neither belongs in a mount test: this
// is about whether the tree renders, and a real listener would also be a real
// listener pointed at the live tournament.
// lib/auth calls warmAuth() at module scope — a real getRedirectResult against
// a real auth instance, fired the moment the module is evaluated (which is the
// point: it is a cold network fetch racing the user's thumb). Importing App.jsx
// for the scoring screen below evaluates it, so it is stubbed here. Everything
// any module in the tree imports from it is listed; a missing name fails loudly
// rather than at the call.
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
  // The rest of the module's surface, needed once App.jsx is in the tree: it
  // reaches the whole of it, and so do the screens it imports.
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

import { TripInfo } from "./TripInfo";
import { BudgetAdmin } from "./Budget";
import { LedgerAdmin } from "./Ledger";
import { SideBets } from "./SideBets";
import { CtpPrompt } from "./CtpPrompt";
import { PlayerActivityPanel } from "./PlayerActivityPanel";
import { SyncBanner } from "./SyncBanner";
import DataView from "./DataView";
import { MoveSignIn } from "./MoveSignIn";
import { ScoreEntry } from "../App";

afterEach(cleanup);

const PARS = Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);

const players = [
  { player_id: "p1", name: "Aaron J", team: "A", handicap_index: 8.1, auth_uid: "u1", auth_provider: "google" },
  { player_id: "p2", name: "Paul W", team: "B", handicap_index: 14.2 },
];
const courses = [{
  id: "c1", name: "Treetops", par: 72, hole_pars: PARS, hole_handicaps: SI,
  tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }],
}];
const tRounds = [{ round_number: 1, course_id: "c1", date: "2026-07-16", tee_time: "8:30", format: "fourball" }];
const teams = { A: { id: "A", name: "Irons", color: "#123456", accent: "#123456" }, B: { id: "B", name: "Drivers", color: "#654321", accent: "#654321" } };
const teamNames = { A: "Irons", B: "Drivers" };
const noop = () => {};
const asyncNoop = async () => {};

// A screen that throws takes the render down, so `render` not throwing IS the
// assertion. Asserting on the container as well keeps it from reading as a
// test with no expectation.
const mounts = (el) => {
  const { container } = render(el);
  expect(container).toBeTruthy();
};

describe("Trip Info", () => {
  it("renders a planned trip", () => {
    mounts(<TripInfo
      tournamentName="The Bourbon Cup" tournamentLocation="Gaylord, MI"
      house={{ name: "The Lodge", url: "https://vrbo.com/1234" }}
      schedule={[{ round: 1, date: "2026-07-16", course: courses[0] }]}
      dates={{ start: "2026-07-16", end: "2026-07-19" }}
      isDirector={false}
    />);
  });
  it("renders a tournament nobody has scheduled yet", () => {
    // The state a director sees in February, and the one nobody develops in.
    mounts(<TripInfo tournamentName="The Bourbon Cup" schedule={[]} dates={{}} />);
  });
});

describe("Budget", () => {
  it("renders priced lines", () => {
    mounts(<BudgetAdmin
      lines={[
        { id: "b1", category: "lodging", detail: "The Lodge", amount: 4800, basis: "total" },
        { id: "b2", category: "golf", detail: "", amount: 90, basis: "per_man" },
        { id: "b3", category: "retired_category", amount: 50 },
      ]}
      playerCount={16} charged={12800} duesAmount={800}
      onSaveLine={asyncNoop} onDeleteLine={asyncNoop} notify={noop}
    />);
  });
  it("renders before anything has been budgeted", () => {
    mounts(<BudgetAdmin lines={[]} playerCount={0} charged={0} duesAmount={0}
      onSaveLine={asyncNoop} onDeleteLine={asyncNoop} notify={noop} />);
  });
});

describe("Ledger", () => {
  it("renders balances, including an overpayment", () => {
    mounts(<LedgerAdmin
      tPlayers={players} teams={teams} duesAmount={800}
      payments={[
        { id: "l1", player_id: "p1", amount: 400, date: "2026-05-01", method: "venmo" },
        { id: "l2", player_id: "p1", amount: 500, date: "2026-06-01", method: "cash" },
      ]}
      onSaveDues={asyncNoop} onLogPayment={asyncNoop} onDeletePayment={asyncNoop}
      onSetPlayerDues={asyncNoop} notify={noop}
    />);
  });
  it("renders a tournament with no ledger at all", () => {
    // duesAmount 0 means there is no ledger; the card disappears everywhere.
    mounts(<LedgerAdmin tPlayers={players} teams={teams} duesAmount={0} payments={[]}
      onSaveDues={asyncNoop} onLogPayment={asyncNoop} onDeletePayment={asyncNoop}
      onSetPlayerDues={asyncNoop} notify={noop} />);
  });
});

describe("Side bets", () => {
  it("renders open and settled bets", () => {
    mounts(<SideBets
      players={players} user={players[0]} authUid="u1" teams={teams}
      bets={[
        { id: "s1", from_player_id: "p1", to_player_id: "p2", amount: 20, terms: "Front nine", settled: false },
        { id: "s2", from_player_id: "p2", to_player_id: "p1", amount: 5, terms: "", settled: true },
      ]}
      onAddBet={asyncNoop} onDeleteBet={asyncNoop} onSettleBet={asyncNoop} confirm={asyncNoop}
    />);
  });
  it("renders with no bets", () => {
    mounts(<SideBets players={players} user={players[0]} authUid="u1" teams={teams} bets={[]}
      onAddBet={asyncNoop} onDeleteBet={asyncNoop} onSettleBet={asyncNoop} confirm={asyncNoop} />);
  });
});

describe("CTP prompt", () => {
  it("renders an untagged pin", () => {
    mounts(<CtpPrompt holeNumber={7} players={players} teams={teams}
      leader={null} leaderName="" outOfOrder={null}
      onSave={asyncNoop} onPass={asyncNoop} onClose={noop} />);
  });
  it("renders a standing tag from a group playing behind", () => {
    // Both tee orders present, which is what lets a tie be offered to the
    // group that played first — see lib/ctp.
    mounts(<CtpPrompt holeNumber={7} players={players} teams={teams}
      leader={{ player_id: "p2", distance_ft: 7, approved: false, tagged_group_order: 3 }}
      leaderName="Paul W"
      outOfOrder={{ leaderOrder: 3, label: "Group 4" }}
      leaderOrder={3} myOrder={1}
      onSave={asyncNoop} onPass={asyncNoop} onClose={noop} />);
  });
});

describe("Director panels", () => {
  it("renders the player activity panel", () => {
    mounts(<PlayerActivityPanel tPlayers={players} />);
  });
  it("renders nothing at all for an empty roster", () => {
    const { container } = render(<PlayerActivityPanel tPlayers={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("Sync banner", () => {
  it("draws nothing while writes are landing", () => {
    // The whole design: no healthy state. A strip that is always there is
    // furniture nobody reads.
    const { container } = render(<SyncBanner />);
    expect(container.firstChild).toBeNull();
  });
  it("draws a refusal, which is the state that needs somebody to act", () => {
    const tracker = {
      state: () => ({ pending: 0, kinds: {}, since: null, refused: 1, refusedKinds: { bc_hole_scores: 1 } }),
      subscribe: (fn) => { fn({ pending: 0, kinds: {}, since: null, refused: 1, refusedKinds: { bc_hole_scores: 1 } }); return () => {}; },
    };
    render(<SyncBanner tracker={tracker} />);
    expect(document.body.textContent).toContain("did not save");
  });
});

describe("Data tab", () => {
  const common = {
    tPlayers: players, matches: [], holeData: {}, tRounds, courses,
    hcpOverrides: {}, teeAssignments: {}, roundLocks: {},
    teamNames, teams, myPlayerId: "p1",
    editions: [{ id: "bc_2026", year: 2026, name: "The Bourbon Cup 2026" }],
    activeYear: 2026,
  };
  it("renders the running year", () => {
    // Lazy-loaded, so a broken import here cannot fail anywhere else first.
    mounts(<DataView {...common} />);
  });
  it("renders a demo edition, where the live fold is switched off", () => {
    mounts(<DataView {...common} isDemo />);
  });
  it("renders an edition with no cards in it yet", () => {
    mounts(<DataView {...common} tPlayers={[]} tRounds={[]} courses={[]} editions={[]} />);
  });
});

describe("Move to a new sign-in", () => {
  it("renders folded away, which is how most people will never see it", () => {
    const { container } = render(<MoveSignIn notify={noop} />);
    expect(container.textContent).toContain("Move to a New Sign-In");
  });
  it("renders the explanation once opened", () => {
    // The offer half of the move-code pair. The claim half lives on the
    // claim screen; see lib/authPairing.
    const { container, getByText } = render(<MoveSignIn notify={noop} />);
    fireEvent.click(getByText("Move to a New Sign-In"));
    expect(container.textContent).toContain("invite code");
  });
});

// ── The scoring screen ──────────────────────────────────────────────
// The one screen the whole tournament is entered through, and the one that
// shipped DEAD ON TAP: `cardState(match, sig, withdrawn)` sat five lines
// above `const withdrawn = useMemo(…)`, which is a temporal dead zone, not a
// style question — `const` hoists the binding without the value, so every
// render that had a match to score threw ReferenceError and the tab was the
// error boundary. Lint was clean, the build was clean, and 1279 unit tests
// were green, because none of them rendered it.
//
// It is exported out of App.jsx for this test and nothing else. The round
// below is the shape it went wrong on: the closing Team Best Ball, sixteen
// men in ONE match spanning four tee waves, sealed. That is the format whose
// match is not a foursome, so it is also the only one that exercises
// scoringUnits — and it needs a MATCH to be present at all, which is exactly
// why an empty round hid the crash.
describe("Scoring", () => {
  const field = Array.from({ length: 16 }, (_, i) => ({
    player_id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    team: i < 8 ? "A" : "B",
    handicap_index: 6 + i * 0.7,
    ...(i === 0 ? { auth_uid: "u1" } : {}),
  }));
  const pids = field.map(p => p.player_id);
  const teamA = pids.slice(0, 8);
  const teamB = pids.slice(8);
  // Four waves of four, teammates riding together — groupsByTeam, which Team
  // Best Ball is the one format to set.
  const waves = [
    [...teamA.slice(0, 4)], [...teamB.slice(0, 4)],
    [...teamA.slice(4)], [...teamB.slice(4)],
  ];
  const bestBallRound = {
    round_number: 4, course_id: "c1", date: "2026-07-19",
    tee_time: "8:00|8:10|8:20|8:30", format: "team_best_ball",
    sealed: true, reveal_through: 0,
    counting_scores: { holes: [...Array(9).fill(6), ...Array(9).fill(7)] },
  };
  const match = { id: "m4", round: 4, teamA, teamB, tournament_id: "bc_test" };
  const scoring = (over = {}) => ({
    user: { ...field[0], isDirector: false },
    matches: [match], holeData: {}, onSaveHole: asyncNoop,
    tPlayers: field, courses, tRounds: [bestBallRound], notify: noop,
    teams, hcpOverrides: {}, teeAssignments: {}, roundLocks: {},
    rounds: [1, 2, 3, 4], currentRound: 4, groups: { 4: waves },
    ctpData: {}, onSetCtp: asyncNoop, onConfirmCtp: asyncNoop,
    buyIns: {}, cardSigs: [], onSignCard: asyncNoop,
    onAttestCard: asyncNoop, onUnsignCard: asyncNoop,
    ...over,
  });

  it("renders the sealed closing round for a player in it", () => {
    mounts(<ScoreEntry {...scoring()} />);
  });

  // ── Who a sealed round will let you walk to ───────────────────────
  // The picker exists so a DIRECTOR can score a group they are not in, and on
  // the closing round that is four tee times deep — which put every score in
  // the sealed round four taps from a man who is also playing in it.
  //
  // The waves here are teammates, which is what a team round's draw is: 8:00
  // and 8:20 are Team A, 8:10 and 8:30 are Team B, and the reader is p1.
  describe("the seal, on the group picker", () => {
    const text = (props) => render(<ScoreEntry {...props} />).container.textContent;
    const director = { ...field[0], isDirector: true };

    it("gives a player no picker at all", () => {
      // Fifteen of the sixteen are in exactly one group and need no control to
      // find it. This is the half that was already true, and the half that has
      // to stay true — it is the whole answer to "can a player see the round".
      const t = text(scoring());
      expect(t).not.toContain("8:10");
      expect(t).not.toContain("8:20");
      expect(t).not.toContain("8:30");
    });

    it("keeps a player's screen to their own four", () => {
      const t = text(scoring());
      expect(t).toContain("Player 2");    // his own wave
      expect(t).not.toContain("Player 5");  // his side's other wave
      expect(t).not.toContain("Player 9");  // the other side
    });

    it("padlocks the other side's waves for a director", () => {
      const t = text(scoring({ user: director }));
      expect(t).toContain("🔒 8:10");
      expect(t).toContain("🔒 8:30");
    });

    it("leaves a director's own side unlocked", () => {
      // A team is never hidden from itself — the line every other surface in
      // the app draws. Checking your own side's card is not the result.
      const t = text(scoring({ user: director }));
      expect(t).toContain("8:00");
      expect(t).toContain("8:20");
      expect(t).not.toContain("🔒 8:00");
      expect(t).not.toContain("🔒 8:20");
    });

    it("lands a director on their own group, not on the first tee time", () => {
      const t = text(scoring({ user: director }));
      expect(t).toContain("Player 2");
      expect(t).not.toContain("Player 9");
    });

    it("asks before it opens one, and shows nothing until answered", async () => {
      const { container, getByText } = render(<ScoreEntry {...scoring({ user: director })} />);
      fireEvent.click(getByText("🔒 8:10"));
      // The confirm is up, naming what the tap costs.
      await waitFor(() => expect(document.body.textContent).toContain("Show the other side"));
      // And nothing has moved behind it.
      expect(container.textContent).not.toContain("Player 9");
    });

    it("padlocks nothing once the round is not sealed at all", () => {
      const open = { ...bestBallRound, sealed: false };
      const t = text(scoring({ user: director, tRounds: [open] }));
      expect(t).toContain("8:10");
      expect(t).not.toContain("🔒");
    });

    it("padlocks nothing once the countdown has finished", () => {
      // Sealed and fully revealed. The round is over and public; there is
      // nothing left to protect and the picker goes back to being a picker.
      const done = { ...bestBallRound, reveal_through: 18 };
      const t = text(scoring({ user: director, tRounds: [done] }));
      expect(t).toContain("8:10");
      expect(t).not.toContain("🔒");
    });
  });
  it("renders it for a director, who gets the group picker", () => {
    // The picker only exists when a match spans more than one unit, so this
    // is the branch scoringUnits was written for.
    mounts(<ScoreEntry {...scoring({ user: { ...field[0], isDirector: true } })} />);
  });
  it("renders for somebody who is not in the round at all", () => {
    // A spectator, or a man who withdrew. Resolves to no unit of his own and
    // falls back to the first — the path that must not read off undefined.
    mounts(<ScoreEntry {...scoring({ user: { player_id: "nobody", name: "Guest" } })} />);
  });
  it("renders a round with no draw yet, which is what hid the crash", () => {
    mounts(<ScoreEntry {...scoring({ matches: [], groups: {} })} />);
  });

  // ── The Nassau chips, from the reader's own side ──
  // Not a mount check. These three chips say WON or LOST and then said the
  // margin from TEAM A's side whoever was holding the phone, so a front nine
  // played out two down came back as "LOST 2 UP". scoring.result.test pins
  // the words; this pins that the screen is asking for them.
  // ── A hole the whole group skipped ──
  // Found on a demo card: holes 1-10 in, the 11th blank, 12 and 13 in, the
  // group on the 14th — and the screen said nothing. The strip's badge and
  // the can't-sign note BOTH only looked at holes somebody had scored, so the
  // one gap neither could see was the one nobody scored. Meanwhile the engine
  // skips an unscored hole, so FRONT / OVERALL / BACK were being computed
  // around a hole that was never played and presented as the state of a match.
  describe("a hole nobody in the group scored", () => {
    const four = [
      { player_id: "d1", name: "Dave R", team: "A", handicap_index: 0 },
      { player_id: "d2", name: "Marty K", team: "A", handicap_index: 0 },
      { player_id: "d3", name: "Tom F", team: "B", handicap_index: 0 },
      { player_id: "d4", name: "Wes L", team: "B", handicap_index: 0 },
    ];
    const bb = { id: "mg", round: 1, teamA: ["d1", "d2"], teamB: ["d3", "d4"], tournament_id: "bc_test" };
    const round = { round_number: 1, course_id: "c1", date: "2026-07-16", tee_time: "8:30", format: "best_ball" };
    const gapped = {};
    for (const p of four) {
      const card = {};
      for (let h = 0; h < 13; h++) { if (h === 10) continue; card[h] = 4; }   // hole 11 skipped
      gapped[`${p.player_id}_1`] = card;
    }
    const screen = (holeData) => render(<ScoreEntry {...scoring({
      user: { ...four[0], isDirector: false },
      matches: [bb], holeData, tPlayers: four, tRounds: [round],
      rounds: [1], currentRound: 1, groups: { 1: [["d1", "d2", "d3", "d4"]] },
    })} />).container.textContent;

    it("says the hole was not scored and the status is provisional", () => {
      const t = screen(gapped);
      expect(t).toContain("Hole 11 not scored");
      expect(t).toContain("status is provisional");
    });

    it("stays quiet on a clean round in progress", () => {
      const clean = {};
      for (const p of four) {
        const card = {};
        for (let h = 0; h < 13; h++) card[h] = 4;
        clean[`${p.player_id}_1`] = card;
      }
      const t = screen(clean);
      expect(t).not.toContain("not scored");
      expect(t).not.toContain("provisional");
    });
  });

  // ── Why the sign CTA is not there ──
  // A complete card promotes the Full Scorecard button into "Complete — Sign
  // Card", but only for somebody IN the match: a signature is a claim, and
  // signed_by is checked against that match's roster. A director scoring
  // another group's card entered the eighteenth score and got nothing — no
  // CTA and no reason, because the missing-holes note has nothing to say
  // about a card that is complete.
  describe("a complete card the reader cannot sign", () => {
    const two = [
      { player_id: "x1", name: "Hank B", team: "A", handicap_index: 0 },
      { player_id: "x2", name: "Gil A", team: "B", handicap_index: 0 },
    ];
    const solo = { id: "mx", round: 1, teamA: ["x1"], teamB: ["x2"], tournament_id: "bc_test" };
    const singles = { round_number: 1, course_id: "c1", date: "2026-07-16", tee_time: "8:30", format: "singles" };
    const full = { x1_1: {}, x2_1: {} };
    for (let h = 0; h < 18; h++) { full.x1_1[h] = 4; full.x2_1[h] = 5; }
    const screen = (user) => render(<ScoreEntry {...scoring({
      user, matches: [solo], holeData: full, tPlayers: two, tRounds: [singles],
      rounds: [1], currentRound: 1, groups: { 1: [["x1", "x2"]] },
    })} />).container.textContent;

    it("offers the CTA to a player in the match", () => {
      const t = screen({ ...two[0], isDirector: false });
      expect(t).toContain("Complete — Sign Card");
      expect(t).not.toContain("a player in this match signs it");
    });

    it("tells everybody else why they are not being offered it", () => {
      // A director scoring somebody else's group — the shape this was found in.
      const t = screen({ player_id: "someone-else", name: "Aaron J", isDirector: true });
      expect(t).not.toContain("Complete — Sign Card");
      expect(t).toContain("Card complete");
      expect(t).toContain("a player in this match signs it");
    });

    it("says nothing of the kind while holes are still missing", () => {
      // The other note owns that case; two of them at once would be noise.
      const partial = { x1_1: { ...full.x1_1 }, x2_1: { ...full.x2_1 } };
      delete partial.x2_1[6];
      const t = render(<ScoreEntry {...scoring({
        user: { player_id: "someone-else", name: "Aaron J", isDirector: true },
        matches: [solo], holeData: partial, tPlayers: two, tRounds: [singles],
        rounds: [1], currentRound: 1, groups: { 1: [["x1", "x2"]] },
      })} />).container.textContent;
      expect(t).not.toContain("Card complete");
    });
  });

  describe("the front / overall / back chips", () => {
    const two = [
      { player_id: "a", name: "Aaron J", team: "A", handicap_index: 0, auth_uid: "u1" },
      { player_id: "b", name: "Paul W", team: "B", handicap_index: 0 },
    ];
    const singles = { round_number: 1, course_id: "c1", date: "2026-07-16", tee_time: "8:30", format: "singles" };
    const solo = { id: "m1", round: 1, teamA: ["a"], teamB: ["b"], tournament_id: "bc_test" };
    // A takes the first three, halves the fourth, loses the last five — two
    // down at the turn, with the nine played out rather than closed. Then the
    // tenth, so the back and the overall are live and the front is not.
    const WINNERS = "AAA-BBBBBB";
    const holeData = { a_1: {}, b_1: {} };
    [...WINNERS].forEach((w, h) => {
      holeData.a_1[h] = w === "A" ? 3 : w === "B" ? 5 : 4;
      holeData.b_1[h] = w === "A" ? 5 : w === "B" ? 3 : 4;
    });
    const chips = (pid) => render(<ScoreEntry {...scoring({
      user: { ...two.find(p => p.player_id === pid), isDirector: false },
      matches: [solo], holeData, tPlayers: two, tRounds: [singles],
      rounds: [1], currentRound: 1, groups: { 1: [["a", "b"]] },
    })} />).container.textContent;

    it("tells the loser he lost two DN, not two up", () => {
      const text = chips("a");
      expect(text).toContain("LOST 2 DN");
      expect(text).not.toContain("LOST 2 UP");
    });

    it("tells the winner he won two UP", () => {
      expect(chips("b")).toContain("WON 2 UP");
    });

    it("says the live nine from each man's own side", () => {
      // One hole of the back is in and A lost it: A is 1 down on it, B 1 up.
      expect(chips("a")).toContain("1 DN");
      expect(chips("b")).toContain("1 UP");
    });
  });
});
