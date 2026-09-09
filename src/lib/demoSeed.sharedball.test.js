// ── One ball means one number ───────────────────────────────────────
// Rounds 2 and 3 are a scramble and a Pinehurst: the side plays a single ball
// and both partners' cards carry it. The seed generated a card per MAN
// whatever the format, so the two men on one ball posted different scores —
// and the scorecard, which prints partner one's gross over the engine's
// better-ball net, showed a stroke on every hole the partner had won. It was
// indistinguishable from a handicap stroke and the dots above the row said
// none had been given. This is the demo a store reviewer opens.
import { describe, it, expect } from "vitest";
import { buildDemo, demoPlayerId } from "./demoSeed.js";
import { formatIsSharedBall } from "../constants.js";
import { computeMatchResult, sharedBallScore } from "../scoring.js";

const built = buildDemo();
const scoreOf = (pid, round, hole) => built.bc_hole_scores
  .find(h => h.player_id === pid && h.round_number === round && h.hole_number === hole)?.score;

describe("a shared-ball side posts one card", () => {
  const shared = built.bc_rounds.filter(r => formatIsSharedBall(r.format));

  it("has a shared-ball round to check", () => {
    expect(shared.map(r => r.format)).toContain("scramble");
  });

  it("gives both partners the same number on every hole", () => {
    for (const r of shared) {
      for (const m of built.bc_matches.filter(x => x.round === r.round_number)) {
        for (const side of [m.teamA, m.teamB]) {
          for (let h = 1; h <= 18; h++) {
            const posted = side.map(pid => scoreOf(pid, r.round_number, h));
            expect(new Set(posted).size, `${r.format} R${r.round_number} h${h} ${side.join("+")}`).toBe(1);
          }
        }
      }
    }
  });

  it("leaves the per-man rounds one card each", () => {
    // Round 1 is a Team Best Ball off individual cards. Two partners posting
    // the same eighteen holes there would be the opposite bug.
    const r1 = built.bc_matches.find(m => m.round === 1);
    const cards = [...r1.teamA, ...r1.teamB]
      .map(pid => Array.from({ length: 18 }, (_, i) => scoreOf(pid, 1, i + 1)).join(","));
    expect(new Set(cards).size).toBe(cards.length);
  });
});

describe("the card adds up", () => {
  it("prints a gross the dots and the net agree on", () => {
    // The invariant the screen has to satisfy: for a shared-ball side,
    // side ball − strokes given = the net the match was scored on. Checked
    // through the engine so it is the engine's own numbers, not a restatement.
    const holeData = {};
    for (const h of built.bc_hole_scores) {
      (holeData[`${h.player_id}_${h.round_number}`] ||= {})[h.hole_number - 1] = h.score;
    }
    let checked = 0;
    for (const r of built.bc_rounds.filter(x => formatIsSharedBall(x.format))) {
      for (const m of built.bc_matches.filter(x => x.round === r.round_number)) {
        const res = computeMatchResult(
          m, holeData, built.bc_courses, built.bc_rounds, built.bc_players,
          r.format, {}, undefined, {}, {},
        );
        for (const [side, key] of [[m.teamA, "aScore"], [m.teamB, "bScore"]]) {
          for (let h = 0; h < 18; h++) {
            const ball = sharedBallScore(side.map(pid => holeData[`${pid}_${r.round_number}`]?.[h]));
            if (ball == null) continue;
            const dots = res.strokeMaps[side[0]]?.[h] || 0;
            expect(res.holes[h][key], `R${r.round_number} h${h + 1}`).toBe(ball - dots);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("a tester's edit still lands on the seeded document", () => {
  it("keeps the id shape the app writes", () => {
    const pid = demoPlayerId("chris");
    const doc = built.bc_hole_scores.find(h => h.player_id === pid && h.round_number === 2 && h.hole_number === 3);
    expect(doc.id).toContain(`bc_hs_r2_${pid}_h3`);
  });
});
