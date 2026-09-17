/** @vitest-environment jsdom */
// ── A round with no score says when it goes off ────────────────────
// The slot where a round's score goes said TBD until somebody teed off, and
// TBD is true and useless — a man looking at Sunday's round on Friday night
// wants the day and the first tee time, which is what the group text is
// about.
//
// The second case here is the one that was actually wrong rather than merely
// unhelpful. Team Best Ball seals by default, so the closing round is drawn
// and sealed months before it is played; with a draw in place it had matches
// to score and no scores in them, and it read 0–0 — a round played to a
// nil-nil standstill, which is a real result and not this one.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { TeamLeaderboard } from "./Leaderboard";

afterEach(cleanup);

const PARS = Array(18).fill(4);
const courses = [
  { id: "c1", name: "Treetops", hole_pars: PARS, hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1), tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }] },
  { id: "c2", name: "Forest Dunes", hole_pars: PARS, hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1), tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }] },
];
const tPlayers = ["a1", "a2", "b1", "b2"].map((pid) => ({
  player_id: pid, name: pid.toUpperCase(), team: pid[0] === "a" ? "A" : "B", handicap_index: 0,
}));
const teams = { A: { name: "Irons" }, B: { name: "Drivers" } };

// 2026-08-14 is a Friday, 2026-08-16 a Sunday.
const tRounds = [
  // Played out.
  { round_number: 1, format: "singles", course_id: "c1", tee_box: "White", handicap_mode: "full", scoring_type: "match", date: "2026-08-14", tee_time: "8:30|8:40" },
  // Set up, no draw — the shape a tournament sits in for most of the summer.
  { round_number: 2, format: "scramble", course_id: "c2", tee_box: "White", handicap_mode: "full", scoring_type: "match", date: "2026-08-16", tee_time: "9:00|9:10" },
  // Drawn, sealed by its format, and nobody has teed off.
  { round_number: 3, format: "team_best_ball", course_id: "c2", tee_box: "White", handicap_mode: "full", scoring_type: "points", hole_points: { front: 1, back: 1 }, date: "2026-08-16", tee_time: "1:20|1:30" },
  // Drawn, NOT sealed, and nobody has teed off — the plain 0–0 case.
  { round_number: 4, format: "singles", course_id: "c1", tee_box: "White", handicap_mode: "full", scoring_type: "match", date: "2026-08-15", tee_time: "7:50|8:00" },
];
const matches = [
  { id: "m1", round: 1, teamA: ["a1"], teamB: ["b1"], scoring_type: "match" },
  { id: "m3", round: 3, teamA: ["a1", "a2"], teamB: ["b1", "b2"], scoring_type: "points", hole_points: { front: 1, back: 1 } },
  { id: "m4", round: 4, teamA: ["a1"], teamB: ["b1"], scoring_type: "match" },
];
// Round 1 only. Rounds 2 and 3 have no holes at all.
const holeData = {};
Array.from({ length: 18 }, (_, h) => h).forEach((h) => {
  holeData.a1_1 = { ...(holeData.a1_1 || {}), [h]: 3 };
  holeData.b1_1 = { ...(holeData.b1_1 || {}), [h]: 5 };
});

const board = (props = {}) => render(
  <TeamLeaderboard
    matches={matches} holeData={holeData} ownHoleData={holeData} countdownHoleData={holeData}
    courses={courses} tRounds={tRounds} tPlayers={tPlayers} teams={teams}
    hcpOverrides={{}} teeAssignments={{}} roundLocks={{}} viewer="A" {...props}
  />
).container.textContent;

describe("a round that has not been played", () => {
  it("shows the day and the first tee time instead of TBD", () => {
    expect(board()).toContain("SUNDAY · 9:00 AM");
  });

  it("does the same for a drawn round nobody has teed off in", () => {
    const text = board();
    // Round 4 has a draw, so it has matches to score — and no scores in them,
    // which is the round that read 0–0.
    expect(text).toContain("SATURDAY · 7:50 AM");
    expect(text).not.toContain("0–0");
  });

  it("takes the slot ahead of a seal, on a round sealed before it is played", () => {
    // Team Best Ball seals by default, so round 3 is sealed from the day its
    // format was picked. A dash would sit over it all summer where its tee
    // time belongs; there is no result to hold back until somebody plays.
    expect(board()).toContain("SUNDAY · 1:20 PM");
  });

  it("still shows a played round's score", () => {
    // Round 1: a1 wins the front, the back and the match.
    expect(board()).toContain("3–0");
  });

  it("falls back to TBD when the round has no date and no tee sheet", () => {
    const bare = tRounds.map(({ date, tee_time, ...rest }) => rest);
    expect(board({ tRounds: bare })).toContain("TBD");
  });
});

// ── And which tee, when the field is on one ────────────────────────
// "Which tees are we playing?" is the third question in the group text and it
// is settled weeks before the draw. The slot is a line of its own and it was
// two facts wide, so answering it costs the board nothing.
describe("a round the whole field plays off one tee", () => {
  // The switch is a property of the ROUND (AdminView's One tee), and the tee
  // itself comes off the assignments it writes for every player.
  const oneTee = (round, tee) => ({
    tRounds: tRounds.map((t) => (t.round_number === round ? { ...t, uniform_tee: true } : t)),
    teeAssignments: { [round]: Object.fromEntries(tPlayers.map((p) => [p.player_id, tee])) },
  });

  it("names the tee beside the first tee time", () => {
    const { tRounds: trs, teeAssignments } = oneTee(2, "Blue");
    expect(board({ tRounds: trs, teeAssignments })).toContain("SUNDAY · 9:00 AM · BLUE");
  });

  it("leaves a round on Any tee saying the day and the time alone", () => {
    // Round 2 is the one switched on above; round 4 is not, and a board where
    // one round answers is a board where the others must not.
    const { tRounds: trs, teeAssignments } = oneTee(2, "Blue");
    const text = board({ tRounds: trs, teeAssignments });
    expect(text).toContain("SATURDAY · 7:50 AM");
    expect(text).not.toContain("SATURDAY · 7:50 AM · ");
  });

  it("adds nothing to a round that is being played", () => {
    // Round 1 has scores, so the slot holds them — the tee box never displaces
    // a score.
    const { tRounds: trs, teeAssignments } = oneTee(1, "Blue");
    const text = board({ tRounds: trs, teeAssignments });
    expect(text).toContain("3–0");
    expect(text).not.toContain("BLUE");
  });
});
