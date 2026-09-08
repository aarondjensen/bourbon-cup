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
import { render, cleanup } from "@testing-library/react";

// The screens under test reach for Firestore at import time (the db handle)
// and, in one case, subscribe on mount. Neither belongs in a mount test: this
// is about whether the tree renders, and a real listener would also be a real
// listener pointed at the live tournament.
vi.mock("../firebase", () => ({
  db: { subscribe: () => () => {}, upsert: async () => null, delete: async () => null, get: async () => [] },
  TOURNAMENT_ID: "bc_test",
  editionDocId: (id) => id,
  getTournamentYear: () => 2026,
  writeFailure: () => "failed",
  writeTracker: { track: (p) => p, state: () => ({ pending: 0, kinds: {}, since: null, refused: 0, refusedKinds: {} }), subscribe: () => () => {} },
}));

import { TripInfo } from "./TripInfo";
import { BudgetAdmin } from "./Budget";
import { LedgerAdmin } from "./Ledger";
import { SideBets } from "./SideBets";
import { CtpPrompt } from "./CtpPrompt";
import { PlayerActivityPanel } from "./PlayerActivityPanel";
import { SyncBanner } from "./SyncBanner";
import DataView from "./DataView";

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
