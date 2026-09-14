// ══════════════════════════════════════════════════════════════════
//  Double Dot settles on DOTS, never on holes won
// ══════════════════════════════════════════════════════════════════
// Double Dot is not match play wearing a dots label. Every hole puts two dots
// up — one for the low ball, one for the high — and a side takes both, one, or
// none. Those dots ACCRUE. A side that sweeps a hole banks 2; it does not go
// "1 up", and the side holding the most dots at the end of a Nassau segment
// takes it.
//
// Counting holes won instead throws the second dot away, and the two readings
// genuinely disagree: a side can win FEWER holes and still hold MORE dots. That
// is the whole of what these tests pin. Every one of them fails if the engine
// goes back to settling a Double Dot round on holes won — which is what it did
// for every round saved under the format's old `formDefault` of Match.
import { describe, it, expect } from "vitest";
import {
  computeMatchResult, segmentState, segmentOptsFor, settlesOnTotal,
  statusText, verdictText,
} from "./scoring";
import { SCORING_TYPE_MATCH, SCORING_TYPE_TOTAL } from "./constants";

const PARS = Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
const scratchCourse = {
  id: "c1", name: "Test", hole_pars: PARS, hole_handicaps: SI,
  tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }],
};
const tRounds = [{
  round_number: 1, course_id: "c1", tee_box: "White",
  format: "double_dot", handicap_mode: "low_man",
}];
const teamA = ["a1", "a2"], teamB = ["b1", "b2"];
// Scratch throughout, so a net score is the gross one and every dot below is
// decided by the numbers written here rather than by a stroke allocation.
const players = [
  { player_id: "a1", name: "a1", team: "A", handicap_index: 0 },
  { player_id: "a2", name: "a2", team: "A", handicap_index: 0 },
  { player_id: "b1", name: "b1", team: "B", handicap_index: 0 },
  { player_id: "b2", name: "b2", team: "B", handicap_index: 0 },
];

// Each entry is one hole as [a1, a2, b1, b2]. Anything past the end is halved
// flat — four 4s win nobody a dot and leave the segment's totals where the
// listed holes put them.
const cardOf = (holes) => {
  const d = { a1_1: {}, a2_1: {}, b1_1: {}, b2_1: {} };
  for (let h = 0; h < 18; h++) {
    const [a1, a2, b1, b2] = holes[h] || [4, 4, 4, 4];
    d.a1_1[h] = a1; d.a2_1[h] = a2; d.b1_1[h] = b1; d.b2_1[h] = b2;
  }
  return d;
};

const resultFor = (holes, match = {}) => computeMatchResult(
  { id: "m", round: 1, teamA, teamB, ...match },
  cardOf(holes), [scratchCourse], tRounds, players, "double_dot", {}, undefined, {}, {},
);

// ── The card the whole file turns on ──
// A sweeps the first two holes 2-0 (four dots, two holes). B then takes the low
// ball on three straight while the high balls tie, one dot a hole (three dots,
// three holes). The rest are halved flat.
//
//   holes won  A 2, B 3   → B, on match play
//   dots       A 4, B 3   → A, on the dots actually won
//
// Those point at different teams on purpose. There is no reading of this card
// on which both are right, so every assertion below is a choice between them.
const SPLIT_CARD = [
  [3, 3, 5, 5],   // 1  A both dots  (low 3<5, high 3<5)
  [3, 3, 5, 5],   // 2  A both dots
  [4, 4, 3, 4],   // 3  B low only   (low 3<4, high 4=4 ties away)
  [4, 4, 3, 4],   // 4  B low only
  [4, 4, 3, 4],   // 5  B low only
];

describe("Double Dot: more dots beats more holes", () => {
  const res = resultFor(SPLIT_CARD);
  const opts = segmentOptsFor({ id: "m", round: 1, teamA, teamB }, "double_dot");
  const front = segmentState(res.holes.slice(0, 9), opts);

  it("hands out two dots, one, or none per hole", () => {
    expect(res.holes.slice(0, 5).map(h => [h.aScore, h.bScore]))
      .toEqual([[2, 0], [2, 0], [0, 1], [0, 1], [0, 1]]);
    // A halved hole pays nobody. Both balls tied on each sub-match.
    expect([res.holes[5].aScore, res.holes[5].bScore]).toEqual([0, 0]);
  });

  it("settles the segment on dots even though the other side won more holes", () => {
    // The disagreement, stated outright: B won the majority of the holes and
    // still loses the front, because A banked more dots getting there.
    expect(front.bWins).toBeGreaterThan(front.aWins);   // B, counting holes
    expect(front.aTot).toBe(4);
    expect(front.bTot).toBe(3);
    expect(front.winner).toBe("A");                      // A, counting dots
    expect(front.margin).toBe(1);
  });

  it("awards the Nassau pot to the side holding the dots", () => {
    // A match doc carrying no `nassau` of its own is worth NASSAU_DEFAULT —
    // one point a pot. (The format's { front: 1, back: 1, overall: 2 } seeds
    // the admin form; it is not what an unset match scores.)
    expect(res.frontPts.A).toBe(1);
    expect(res.frontPts.B).toBe(0);
    expect(res.overallPts.A).toBe(1);
    expect(res.overallPts.B).toBe(0);
    // The back nine is halved flat, so its pot splits.
    expect(res.backPts).toEqual({ A: 0.5, B: 0.5 });
  });
});

describe("Double Dot: a swept hole banks two, it does not go one up", () => {
  // A sweeps all nine of the front 2-0: eighteen dots against nothing.
  const sweep = Array(9).fill([3, 3, 5, 5]);
  const res = resultFor(sweep);
  const opts = segmentOptsFor({ id: "m", round: 1, teamA, teamB }, "double_dot");
  const front = segmentState(res.holes.slice(0, 9), opts);

  it("counts every dot rather than every hole", () => {
    expect(front.aWins).toBe(9);    // nine holes
    expect(front.aTot).toBe(18);    // eighteen dots — what it settles on
    expect(front.margin).toBe(18);
  });

  it("never closes out early", () => {
    // Match play ends the moment a lead outgrows the holes left ("5&4").
    // Dots have no such moment: every remaining hole still moves the total, so
    // a Double Dot segment is live until the last one is in.
    expect(front.clinched).toBe(false);
    expect(front.decided).toBeUndefined();
    expect(statusText(front)).toBe("+18");
    expect(statusText(front)).not.toMatch(/UP|&/);
  });
});

describe("Double Dot: the status reads in dots, from either side of the match", () => {
  const res = resultFor(SPLIT_CARD);
  const opts = segmentOptsFor({ id: "m", round: 1, teamA, teamB }, "double_dot");
  const front = segmentState(res.holes.slice(0, 9), opts);

  it("is a dot lead, not a match-play state", () => {
    expect(front.unit).toBe("total");
    expect(statusText(front)).toBe("+1");
  });

  it("says the same thing to both teams, with no UP or DN on it", () => {
    // A total segment has no up and no down — the lead is printed unsigned and
    // the colour carries whose it is. The match-play wording is what put "1 UP"
    // on the loser's phone for a front nine they were a dot behind on.
    for (const side of ["A", "B"]) {
      expect(verdictText(front, side)).toBe("+1");
      expect(verdictText(front, side)).not.toMatch(/\bUP\b|\bDN\b|&/);
    }
  });

  it("still says TIED when the dots are level", () => {
    const level = segmentState(res.holes.slice(9, 18), opts);
    expect(level.aTot).toBe(level.bTot);
    expect(statusText(level)).toBe("TIED");
  });
});

describe("settlesOnTotal", () => {
  const dd = (scoring_type) => ({ id: "m", round: 1, teamA, teamB, scoring_type });

  it("is true for Double Dot whatever form of play the round was saved under", () => {
    // The migration-proof half. Double Dot opened on Match until this was
    // fixed, so the rounds already in Firestore carry scoring_type "match" —
    // and they have to score on dots too. Reading the stored value alone would
    // go on settling every one of them on holes won.
    expect(settlesOnTotal(dd(SCORING_TYPE_MATCH), "double_dot")).toBe(true);
    expect(settlesOnTotal(dd(SCORING_TYPE_TOTAL), "double_dot")).toBe(true);
    expect(settlesOnTotal(dd(undefined), "double_dot")).toBe(true);
  });

  it("leaves a stroke format's Match round on holes won", () => {
    expect(settlesOnTotal(dd(SCORING_TYPE_MATCH), "singles")).toBe(false);
    expect(settlesOnTotal(dd(SCORING_TYPE_TOTAL), "singles")).toBe(true);
  });

  it("does not sweep in the points formats", () => {
    // A Stableford hole's number is points SCORED, not sub-matches won, and
    // winning a hole on them is a real game. Only dots accrue by construction.
    expect(settlesOnTotal(dd(SCORING_TYPE_MATCH), "2man_stableford")).toBe(false);
  });

  it("follows a best-ball override off the dots", () => {
    // A best-ball override re-scores every hole as net strokes whatever the
    // round is called, so the holes are no longer dots and must not be read as
    // them — the same trap holeFormatFor exists for.
    const overridden = { ...dd(SCORING_TYPE_MATCH), hole_scoring: "best_ball" };
    expect(settlesOnTotal(overridden, "double_dot")).toBe(false);
  });
});

describe("Double Dot: a legacy round saved as Match", () => {
  it("scores on dots through computeMatchResult, not on holes won", () => {
    // The same card as the first block, on a match doc explicitly stored the
    // old way. It has to come out the same: A takes the front on dots.
    const res = resultFor(SPLIT_CARD, { scoring_type: SCORING_TYPE_MATCH });
    expect(res.frontPts.A).toBe(1);
    expect(res.overallPts.A).toBe(1);
    expect(res.status).not.toMatch(/\bUP\b|&/);
  });
});
