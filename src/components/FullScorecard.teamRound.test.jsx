/** @vitest-environment jsdom */
// ── The card, on a match that is eight a side ───────────────────────
// Team Best Ball is the one format whose match outgrows a foursome, and two
// things on the card were drawn for a match that does not.
//
//   the SIDE's row     counts the best six (front) or seven (back) NETS and
//                      adds them, so a par 4 reads somewhere around 24 — a
//                      number nobody carries in their head, and one that says
//                      nothing about whether the hole went well. It reads TO
//                      PAR now, against the par of the balls it counted.
//   the HEADER         named all sixteen men, which wraps to four lines of a
//                      phone before a hole is drawn. It names the two teams.
//
// Neither changes on any other format, and that is half of what is pinned
// here.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { FullScorecard } from "./FullScorecard";
import { computeMatchResult } from "../scoring";
import { TEAM_A, TEAM_B } from "../constants";

afterEach(cleanup);

const PARS = Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
const course = {
  id: "c1", name: "Treetops", hole_pars: PARS, hole_handicaps: SI,
  tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }],
};
// Sixteen scratch golfers, so a net is a gross and the arithmetic below is
// readable: six or seven balls at par is E, and one birdie in the counting
// set is one under.
const tPlayers = Array.from({ length: 16 }, (_, i) => ({
  player_id: `p${i + 1}`, name: `Player ${i + 1}`,
  team: i < 8 ? "A" : "B", handicap_index: 0,
}));
const A = tPlayers.slice(0, 8).map(p => p.player_id);
const B = tPlayers.slice(8).map(p => p.player_id);

const card = ({ format = "team_best_ball", aScore = 4, bScore = 4, props = {} } = {}) => {
  const tRounds = [{
    round_number: 4, format, course_id: "c1", tee_box: "White",
    handicap_mode: "full", scoring_type: "match",
    counting_scores: { holes: [...Array(9).fill(6), ...Array(9).fill(7)] },
  }];
  const match = format === "team_best_ball"
    ? { id: "m4", round: 4, teamA: A, teamB: B }
    : { id: "m4", round: 4, teamA: A.slice(0, 2), teamB: B.slice(0, 2) };
  const holeData = {};
  for (const p of [...A, ...B]) {
    holeData[`${p}_4`] = Object.fromEntries(
      Array.from({ length: 18 }, (_, h) => [h, A.includes(p) ? aScore : bScore]),
    );
  }
  const result = computeMatchResult(
    match, holeData, [course], tRounds, tPlayers, format, {}, undefined, {}, {},
  );
  return render(
    <FullScorecard
      match={match} result={result} format={format}
      holePars={PARS} holeHcps={SI} course={course}
      tPlayers={tPlayers} viewer="A"
      getScore={(pid, h) => holeData[`${pid}_4`]?.[h] || 0}
      {...props}
    />,
  ).container;
};

const rows = (container, label) => [...container.querySelectorAll("div")]
  .filter(d => d.children.length > 2 && d.children[0].textContent.startsWith(label));
const totalOf = (row) => row.children[row.children.length - 2].textContent.trim();
const sum18Of = (row) => row.children[row.children.length - 1].textContent.trim();
const holesOf = (row) => [...row.children].slice(1, -2).map(c => c.textContent.trim());

describe("the side's row, on Team Best Ball", () => {
  // Six balls at par on the front, seven on the back. Both are level.
  it("reads level as E, not as six par 4s added up", () => {
    const net = rows(card(), "NET");
    expect(net.length).toBeGreaterThan(0);
    holesOf(net[0]).forEach(v => expect(v).toBe("E"));
    expect(holesOf(net[0])).not.toContain("24");
  });

  // Everybody on A makes a 3. Six counting balls, one under each: 6 under.
  it("counts the balls it actually counted", () => {
    const net = rows(card({ aScore: 3 }), "NET");
    // Team A's row is the first NET row on the block.
    expect(holesOf(net[0])).toEqual(Array(9).fill("-6"));
    expect(totalOf(net[0])).toBe("-54");          // nine holes at six under
    // Rows run front-A, front-B, back-A, back-B. The back counts seven, so
    // the eighteen is nine at six under plus nine at seven under.
    expect(sum18Of(net[2])).toBe("-117");
  });

  // Every other format's side number is one ball, or dots, or points — the
  // number people already say out loud.
  it("leaves a 2-man format's net row as strokes", () => {
    const net = rows(card({ format: "best_ball" }), "NET");
    expect(holesOf(net[0])).toEqual(Array(9).fill("4"));
  });
});

describe("the header, on a match that is two whole teams", () => {
  it("names the teams rather than sixteen men", () => {
    const t = card().textContent;
    expect(t).toContain(TEAM_A.name);
    expect(t).toContain(TEAM_B.name);
    // Not one of the sixteen, spelled out. (Their initials are still on
    // every row, which is where a man finds himself.)
    expect(t).not.toContain("Player 1 / Player 2");
  });

  it("still names the four on a foursome format", () => {
    const t = card({ format: "best_ball" }).textContent;
    expect(t).toContain("Player 1 / Player 2");
    expect(t).not.toContain(TEAM_A.name);
  });

  // The wave's own card names its four — that is `foursome`, and it is what
  // the Scoring tab draws. The team names belong to the eight-a-side view.
  it("names the foursome on a foursome's own card", () => {
    const t = card({ props: { foursome: A.slice(0, 4) } }).textContent;
    expect(t).toContain("Player 1 / Player 2 / Player 3 / Player 4");
    expect(t).not.toContain(TEAM_A.name);
  });
});
