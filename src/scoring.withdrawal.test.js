// ══════════════════════════════════════════════════════════════════
//  A man goes home, and the round carries on without him
// ══════════════════════════════════════════════════════════════════
//
// A withdrawal is a FLAG on the roster row, never a removal from the draw
// (lib/cardSigs): the match keeps its pids so the men who finished the card
// can still sign and attest it. That means the engine sees a partner with no
// scores, and "no score" is two opposite things on a card — a man still
// walking up the fairway, whose hole is unfinished, and a man who withdrew,
// whose ball is never coming.
//
// Read as the first, the four formats that need every partner's number to
// make a hole — 2-Man Agg, Double Dot, Tilt, Stableford — waited all round for
// a card nobody was going to post. The match scored NOTHING: no holes, no
// winner, and its Nassau pot quietly unawarded on a leaderboard showing a
// dash. Double Dot has been played in four of the ten cups.
//
// Then the other half, which is the one that matters more: a side a man short
// must not WIN by being short. Both sides add up the same number of balls,
// which is the rule countFor already applies to Team Best Ball.
import { describe, it, expect } from "vitest";
import { computeMatchResult } from "./scoring";
import { FORMATS } from "./constants";

const PARS = [4,4,3,5,4,4,3,4,5,4,3,4,4,5,4,3,4,4];
const SI   = [5,9,15,1,11,3,17,7,13,6,16,2,10,4,8,18,12,14];
const course = { id: "c1", par: 72, hole_pars: PARS, hole_handicaps: SI,
  tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }] };
const sideSize = (id) => FORMATS.find(f => f.id === id).perSide ?? 4;

// Everybody scratch, everybody plays the card to par. Nobody out-golfs anybody,
// so any margin at all is the engine's doing and not the field's.
const level = (format, out) => {
  const n = sideSize(format);
  const teamA = Array.from({ length: n }, (_, i) => `a${i}`);
  const teamB = Array.from({ length: n }, (_, i) => `b${i}`);
  const tPlayers = [...teamA, ...teamB].map(pid => ({
    player_id: pid, name: pid, team: teamA.includes(pid) ? "A" : "B",
    handicap_index: 0, ...(pid === out ? { withdrawn: true } : {}),
  }));
  const holeData = {};
  for (const pid of [...teamA, ...teamB]) {
    const card = {};
    if (pid !== out) for (let h = 0; h < 18; h++) card[h] = PARS[h];
    holeData[`${pid}_1`] = card;
  }
  const tRounds = [{ round_number: 1, course_id: "c1", tee_box: "White", format,
    handicap_mode: "low_man",
    ...(format === "team_best_ball" ? { counting_scores: { holes: Array(18).fill(2) } } : {}) }];
  return computeMatchResult({ id: "m", round: 1, teamA, teamB },
    holeData, [course], tRounds, tPlayers, format, {}, undefined, {}, {});
};

describe("the match goes on", () => {
  it("every format still posts holes with a man withdrawn", () => {
    const dead = [];
    for (const format of FORMATS.map(f => f.id)) {
      if (sideSize(format) < 2) continue;
      const res = level(format, `a${sideSize(format) - 1}`);
      const scored = res.holes.filter(h => h.played).length;
      if (scored !== 18) dead.push(`${format}: ${scored}/18 holes scored`);
    }
    expect(dead.join("\n")).toBe("");
  });
});

describe("and being a man short does not win it", () => {
  it("two sides playing identical golf are all square, short a man or not", () => {
    const bad = [];
    for (const format of FORMATS.map(f => f.id)) {
      if (sideSize(format) < 2) continue;
      const full = level(format, null);
      if (full.overall.margin !== 0) bad.push(`${format}: identical golf is not AS at full strength (${full.overall.margin})`);
      const short = level(format, `a${sideSize(format) - 1}`);
      if (short.overall.margin !== 0) {
        bad.push(`${format}: a withdrawal alone moved it to ${short.overall.margin}`
          + ` — h1 A=${short.holes[0].aScore} B=${short.holes[0].bScore}`);
      }
    }
    expect(bad.join("\n")).toBe("");
  });

  it("does not let a man who went home take strokes off the men still out there", () => {
    // Low man is the lowest PLAYING handicap in the match. A scratch player
    // who withdrew would otherwise go on setting it all round, in a match he
    // is not in — every opponent gives him shots he will never use.
    const teamA = ["a0", "a1"], teamB = ["b0", "b1"];
    const idx = { a0: 0, a1: 18, b0: 18, b1: 18 };   // a0 is scratch, and out
    const tPlayers = [...teamA, ...teamB].map(pid => ({
      player_id: pid, name: pid, team: teamA.includes(pid) ? "A" : "B",
      handicap_index: idx[pid], ...(pid === "a0" ? { withdrawn: true } : {}),
    }));
    const holeData = {};
    for (const pid of [...teamA, ...teamB]) {
      const card = {};
      if (pid !== "a0") for (let h = 0; h < 18; h++) card[h] = PARS[h];
      holeData[`${pid}_1`] = card;
    }
    const tRounds = [{ round_number: 1, course_id: "c1", tee_box: "White", format: "best_ball", handicap_mode: "low_man" }];
    const res = computeMatchResult({ id: "m", round: 1, teamA, teamB },
      holeData, [course], tRounds, tPlayers, "best_ball", {}, undefined, {}, {});
    // The three men actually playing are all 18s, so they all play scratch
    // against each other and identical golf is all square.
    expect(res.overall.margin).toBe(0);
  });
});
