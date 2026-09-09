/** @vitest-environment jsdom */
// ── The two nines, on the card itself ───────────────────────────────
// A Nassau round is three matches: the front, the back and the eighteen, each
// for its own point. The card used to spell out one of them — the header
// states the overall, and each nine's result was a chip in the corner of its
// MATCH row, sixteen rows apart from the other two. That is readable
// mid-round and not enough to SIGN, which is the moment somebody swears to
// all three at once.
//
// This pins what the NINES row says and, as much, when it says nothing:
// a nine that isn't a match, a card that has a screen stating this already,
// and a round that is sealed.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { FullScorecard } from "./FullScorecard";
import { computeMatchResult } from "../scoring";

afterEach(cleanup);

const PARS = Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
const course = {
  id: "c1", name: "Treetops", hole_pars: PARS, hole_handicaps: SI,
  tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }],
};
const tRounds = [{
  round_number: 1, format: "singles", course_id: "c1", tee_box: "White",
  handicap_mode: "full", scoring_type: "match",
}];
const tPlayers = [
  { player_id: "a1", name: "Sam Osborne", team: "A", handicap_index: 0 },
  { player_id: "b1", name: "Vic Carr", team: "B", handicap_index: 0 },
];

// A takes the front 5&4. The back is played out level — three won each way
// and three halved — which is a HALVE, not a match still all square.
const WINNERS = "AAAAABBBB" + "ABABABHHH";

const card = (over = {}, props = {}) => {
  const match = {
    id: "m1", round: 1, teamA: ["a1"], teamB: ["b1"],
    scoring_type: "match", nassau: { front: 1, back: 1, overall: 2 },
    ...over,
  };
  const holeData = { a1_1: {}, b1_1: {} };
  [...WINNERS].forEach((w, h) => {
    holeData.a1_1[h] = w === "A" ? 3 : w === "H" ? 4 : 5;
    holeData.b1_1[h] = w === "B" ? 3 : w === "H" ? 4 : 5;
  });
  const result = computeMatchResult(
    match, holeData, [course], tRounds, tPlayers, "singles", {}, undefined, {}, {},
  );
  return render(
    <FullScorecard
      match={match} result={result} format="singles"
      holePars={PARS} holeHcps={SI} course={course}
      tPlayers={tPlayers} viewer="A"
      getScore={(pid, h) => holeData[`${pid}_1`]?.[h] || 0}
      {...props}
    />,
  ).container.textContent;
};

describe("the nines row", () => {
  it("names both nines on a Nassau card", () => {
    const t = card();
    expect(t).toContain("F9");
    expect(t).toContain("B9");
  });

  it("gives each nine the result its own block gives it", () => {
    // The front closed on the fifth. Whatever the row says has to be what the
    // OUT chip says — they read one computation now, and this is the test
    // that keeps it that way.
    const t = card();
    expect(t.match(/5&4/g)).toHaveLength(2);   // the row, and the OUT chip
  });

  it("calls a nine that finished level TIED", () => {
    // Not HALVED and not AS — both are the older words, and this app says
    // TIED wherever a result is level.
    const t = card();
    expect(t).toContain("TIED");
    expect(t).not.toContain("HALVED");
    expect(t).not.toMatch(/\bAS\b/);
  });

  it("says it in every place that states the result, not just the new one", () => {
    // The row, and the IN chip on that nine's own MATCH row. One fact in two
    // words three inches apart is the same failure as an 8&6 sitting under a
    // 10&4 — see the clinch test beside this one.
    const t = card();
    expect(t.match(/TIED/g)).toHaveLength(2);
  });

  it("says TIED on a RUNNING match cell too", () => {
    // Two holes in, one each: the match is level and LIVE. It reads the same
    // as a finished level one, because this app has one word for level.
    const holeData = { a1_1: {}, b1_1: {} };
    [..."AB"].forEach((w, h) => {
      holeData.a1_1[h] = w === "A" ? 3 : w === "H" ? 4 : 5;
      holeData.b1_1[h] = w === "B" ? 3 : w === "H" ? 4 : 5;
    });
    const match = {
      id: "m1", round: 1, teamA: ["a1"], teamB: ["b1"],
      scoring_type: "match", nassau: { front: 1, back: 1, overall: 2 },
    };
    const result = computeMatchResult(
      match, holeData, [course], tRounds, tPlayers, "singles", {}, undefined, {}, {},
    );
    const t = render(
      <FullScorecard
        match={match} result={result} format="singles"
        holePars={PARS} holeHcps={SI} course={course}
        tPlayers={tPlayers} viewer="A"
        getScore={(pid, h) => holeData[`${pid}_1`]?.[h] || 0}
      />,
    ).container.textContent;
    expect(t).toContain("TIED");
    expect(t).not.toContain("HALVED");
  });

  it("says nothing about a nine that isn't a match", () => {
    // A Traditional round pays one pot for the eighteen, so neither nine is
    // a match and the row does not appear at all.
    const t = card({ point_method: "traditional" });
    expect(t).not.toContain("F9");
    expect(t).not.toContain("B9");
    // The card is otherwise unchanged — the eighteen is still stated, in the
    // header chip between the two names. This used to check for the course
    // name, which the card printed in a terms line under that header; the line
    // is gone (it restated the Scoring tab's format badge and the Matches
    // tab's round banner), and the eighteen's own result was always the
    // better witness to "the card still states the match".
    expect(t).toContain("1 UP");
  });

  it("shows only the nine that carries a point", () => {
    const t = card({ nassau: { front: 1, back: 0, overall: 2 } });
    expect(t).toContain("F9");
    expect(t).not.toContain("B9");
  });

  it("stays off the Leaderboard's copy of the card", () => {
    // showHeader is off there because its own row states the match with F9
    // and B9 either side of it, and its segment pills say all three again.
    const t = card({}, { showHeader: false });
    expect(t).not.toContain("F9");
    expect(t).not.toContain("B9");
  });

  it("states nothing on a sealed round", () => {
    // A segment result is exactly what the blackout holds back — the same
    // test the Scoring tab's own Nassau pills are switched off by.
    const t = card({}, { conceal: { through: 0, side: "A" } });
    expect(t).not.toContain("F9");
    expect(t).not.toContain("B9");
  });
});
