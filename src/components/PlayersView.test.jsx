/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  The Players tab's Round CH columns, and the one rule they keep
// ══════════════════════════════════════════════════════════════════
//
// A Course Handicap is frozen the moment its round locks and live until then.
// This screen is the first place in the app where a PLAYER can read one, and
// it puts every round's side by side — so the day the two halves of that rule
// disagree, sixteen phones show it rather than one director's setup screen.
//
// The failure it guards is quiet and one-directional: a GHIN sync on Saturday
// morning that moved Friday's column would print a handicap the field did not
// play off, over a round whose scoring underneath had not moved an inch. The
// card would be right and the screen would be wrong, which is the worst of
// the two ways round.
//
// The lock is built by the real `buildRoundLockDoc`, not typed here. A
// hand-written snapshot is a second opinion about the shape of a frozen
// round, and the whole point of the resolution below is that there is one.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { PlayersView } from "./PlayersView";
import { buildRoundLockDoc } from "../lib/roundLocks";

afterEach(cleanup);

const teams = {
  A: { id: "A", name: "Irons", color: "#00ae52", accent: "#00ae52" },
  B: { id: "B", name: "Drivers", color: "#46b4c0", accent: "#46b4c0" },
};

// Slope 113 / rating 72 / par 72 — the neutral tee, so a Course Handicap is
// the rounded index and every number below can be read off the fixture.
const courses = [{
  id: "c1", name: "Treetops", par: 72,
  tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }],
}];

const tRounds = [
  { round_number: 1, course_id: "c1", tee_box: "White" },
  { round_number: 2, course_id: "c1", tee_box: "White" },
  // Round 3 exists in the draw and has never been set up. Nothing to compute
  // a handicap from, and 113/72/72 is `resolveTeeSpec`'s fallback — so a
  // number here would be the index wearing a Course Handicap's clothes.
  { round_number: 3 },
];

const atIndex = (hi) => ([
  { player_id: "p1", name: "Aaron J", team: "A", handicap_index: hi },
  { player_id: "p2", name: "Paul W", team: "B", handicap_index: 14 },
]);

// Round 1 locked while Aaron was off 8, which is what a lock IS: the round
// took its first score that morning.
const locks = {
  1: buildRoundLockDoc({
    tournamentId: "bc_test", round: 1,
    players: atIndex(8), tRounds, courses,
  }),
};

// One player's row, as [name, index, R1, R2, R3]. The row is the grid div
// whose first child holds the name.
const rowFor = (container, name) => {
  const row = [...container.querySelectorAll("div")]
    .find(d => d.firstElementChild?.tagName === "SPAN" && d.firstElementChild.textContent === name);
  return row ? [...row.children].map(c => c.textContent) : null;
};

const mount = (players) => render(<PlayersView
  tPlayers={players} teams={teams}
  rounds={[1, 2, 3]} tRounds={tRounds} courses={courses}
  roundLocks={locks} hcpOverrides={{}} teeAssignments={{}}
/>);

describe("the Round CH columns", () => {
  it("reads the live index for a round nobody has started", () => {
    const { container } = mount(atIndex(8));
    expect(rowFor(container, "Aaron J")).toEqual(["Aaron J", "8", "8", "8", "–"]);
  });

  it("moves an unlocked round when the index does, and leaves the locked one alone", () => {
    // The Saturday-morning GHIN sync. Round 1 was played off 8 and says 8
    // forever; round 2 has not been played and follows him to 12.
    const { container } = mount(atIndex(12));
    const row = rowFor(container, "Aaron J");
    expect(row[1]).toBe("12"); // index
    expect(row[2]).toBe("8");  // R1 — locked, and the round was played off 8
    expect(row[3]).toBe("12"); // R2 — still open
  });

  it("says nothing rather than something wrong for a round with no course", () => {
    const { container } = mount(atIndex(12));
    expect(rowFor(container, "Aaron J")[4]).toBe("–");
  });

  it("prefers the player-level index override, the way the engine does", () => {
    const players = atIndex(12);
    players[0] = { ...players[0], hi_override: "3" };
    const { container } = mount(players);
    const row = rowFor(container, "Aaron J");
    expect(row[1]).toBe("3");
    expect(row[3]).toBe("3"); // the open round follows it
    expect(row[2]).toBe("8"); // the locked one still does not
  });

  it("draws both sides", () => {
    const { container } = mount(atIndex(8));
    expect(rowFor(container, "Paul W")).toEqual(["Paul W", "14", "14", "14", "–"]);
  });
});

describe("what it deliberately does not show", () => {
  // The two columns this screen exists WITHOUT. They are the director's
  // answers to "who runs this" and "why can't I claim my name", and both are
  // asked of a director rather than read off a roster — see the head of
  // PlayersView.jsx. A crown that crept back in would be a role badge on a
  // screen sixteen men read.
  it("carries no crown and no sign-in link", () => {
    const players = atIndex(8).map(p => ({ ...p, auth_uid: "u1", auth_email: "a@b.c" }));
    const { container } = mount(players);
    expect(container.textContent).not.toContain("👑");
    expect(container.textContent).not.toContain("🔗");
  });
});
