/** @vitest-environment jsdom */
// ── The board follows a theme toggle, without a reload ─────────────
// The round header's type is a shared style object rather than a literal in
// JSX, and it used to be built once at import: whatever BC held when the
// module was evaluated was the ink it painted for the rest of the session.
// Toggling to light left the course name in dark mode's near-white `t1`, on
// a cream page, which is invisible rather than merely wrong.
//
// This is the end of that: render the board, change the theme the way the
// app's own switch does, re-render, and the colour has to have followed.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { TeamLeaderboard } from "./Leaderboard";
import { BC, applyBCTheme } from "../theme";

afterEach(() => { cleanup(); applyBCTheme("dark"); });

const PARS = Array(18).fill(4);
const courses = [{
  id: "c1", name: "Treetops", hole_pars: PARS,
  hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1),
  tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }],
}];
const tPlayers = ["a1", "b1"].map((pid) => ({
  player_id: pid, name: pid.toUpperCase(), team: pid[0] === "a" ? "A" : "B", handicap_index: 0,
}));
const board = () => render(
  <TeamLeaderboard
    matches={[{ id: "m1", round: 1, teamA: ["a1"], teamB: ["b1"], scoring_type: "match" }]}
    holeData={{}} ownHoleData={{}} countdownHoleData={{}}
    courses={courses}
    tRounds={[{ round_number: 1, format: "singles", course_id: "c1", tee_box: "White", handicap_mode: "full", scoring_type: "match" }]}
    tPlayers={tPlayers} teams={{ A: { name: "Irons" }, B: { name: "Drivers" } }}
    hcpOverrides={{}} teeAssignments={{}} roundLocks={{}} viewer="A"
  />
);

describe("the round header after a theme toggle", () => {
  it("repaints its course name in the mode the app is now in", () => {
    applyBCTheme("dark");
    const inDark = board().getByText("TREETOPS").style.color;
    expect(inDark).toBeTruthy();
    cleanup();

    // What the switch in More → My Account does — no reload.
    applyBCTheme("light");
    const inLight = board().getByText("TREETOPS").style.color;

    expect(inLight).toBeTruthy();
    expect(inLight).not.toBe(inDark);
  });

  it("paints the palette the app is actually in, not a remembered one", () => {
    applyBCTheme("light");
    const { getByText } = board();
    // rgb(22, 22, 26) — light mode's near-black ink. Dark's t1 is near-white,
    // which is what this row was drawing on a cream page.
    expect(getByText("TREETOPS").style.color).toBe("rgb(22, 22, 26)");
  });
});
