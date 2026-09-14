// ══════════════════════════════════════════════════════════════════
//  The blackout, across SURFACES.
// ══════════════════════════════════════════════════════════════════
//
// lib/reveal.test.js pins the arithmetic of the seal — which counter means
// what, where each cut falls. This file asks the question one level up, and
// it is the question the tradition actually cares about:
//
//   IS THERE ANY SURFACE THAT CAN SHOW A PLAYER THE OTHER SIDE'S SCORES, OR
//   THE ROUND'S AGGREGATE STATE, BEFORE THE REVEAL?
//
// So the assertions here are about the CONTRACT the rest of the app leans
// on, not about the functions in isolation:
//
//   • the subtraction really is total — a concealing round is cut at ZERO,
//     not at the reveal, on every read-only surface;
//   • the IDENTITY promise, in both directions, because App uses `!==` as an
//     exact test for "is anything sealed right now" (see the note on
//     `nothingSealed` in App.jsx, which gates the archived edition summary).
//     A false positive there silently archives a half-scored cup; a false
//     negative silently costs every memo chain downstream of holeData;
//   • the round-trip: a concealed map through the app's own scoring engine
//     has to come out as a round nobody played. Not "a round the screen
//     declines to draw" — a round with no points in it.
//
// See lib/reveal.js's header for the design, and the AUDIT block at the
// bottom of this file for the surfaces that were traced by hand.

import { describe, it, expect } from "vitest";
import {
  concealHoleData, countdownHoleData, isConcealing, resolveSealed,
  revealedThrough, HOLE_COUNT,
} from "./lib/reveal";
import { scoringUnits } from "./lib/groups";
import { roundSummary } from "./lib/roundSummary";
import { computeMatchResult } from "./scoring";

// ── Fixtures ────────────────────────────────────────────────────────
// A live cup: round 1 is an ordinary singles round that is over, round 4 is
// the closing Team Best Ball played in the dark.
const A = ["a1", "a2", "a3", "a4"];
const B = ["b1", "b2", "b3", "b4"];
const PARS = Array(18).fill(4);

const courses = [{
  id: "c1", name: "Treetops",
  hole_pars: PARS,
  hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1),
  tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }],
}];

const tPlayers = [...A, ...B].map((pid) => ({
  player_id: pid, name: pid.toUpperCase(), team: A.includes(pid) ? "A" : "B",
  handicap_index: 0,
}));

const sideOfPlayer = (pid) =>
  (tPlayers.find((p) => p.player_id === pid)?.team === "B" ? "B" : "A");

// `final` is the director's round lock, folded onto the round object by App
// (see enrichedRounds). Defaulted the way the live cup runs: the ceremony
// finishing is not the round going in the books.
const roundsFor = ({ a = 0, b = a, final = false } = {}) => [
  {
    round_number: 1, format: "singles", course_id: "c1", tee_box: "White",
    handicap_mode: "full", scoring_type: "match", final: true,
  },
  {
    round_number: 4, format: "team_best_ball", course_id: "c1", tee_box: "White",
    handicap_mode: "full", scoring_type: "points",
    counting_scores: { holes: Array(18).fill(2) },
    sealed: true, reveal_a: a, reveal_b: b, final,
  },
];

const match4 = { id: "m4", round: 4, teamA: A, teamB: B, scoring_type: "points" };

// Round 4 is a rout: B is three shots a hole better than A on all eighteen.
// That is exactly the answer the evening exists to withhold, so every
// assertion below is against a map that genuinely holds it.
const fullHoleData = () => {
  const hd = { a1_1: {}, b1_1: {} };
  for (let h = 0; h < 18; h++) {
    hd.a1_1[h] = 3;
    hd.b1_1[h] = 5;
    A.forEach((pid) => { hd[`${pid}_4`] = { ...(hd[`${pid}_4`] || {}), [h]: 6 }; });
    B.forEach((pid) => { hd[`${pid}_4`] = { ...(hd[`${pid}_4`] || {}), [h]: 3 }; });
  }
  return hd;
};

const holesIn = (map, key) => Object.keys(map[key] || {}).length;

// ══════════════════════════════════════════════════════════════════
//  1. The cut is at ZERO, and it is surgical
// ══════════════════════════════════════════════════════════════════
describe("concealHoleData takes the whole round, and only that round", () => {
  // The board does not walk with the reveal. Seventeen holes turned over is
  // still a round with no scores in it as far as every read-only surface is
  // concerned — see WHY THE BOARD IS ALL-OR-NOTHING in lib/reveal.
  it("cuts at zero however far the countdown has walked", () => {
    const hd = fullHoleData();
    [0, 1, 9, 17].forEach((through) => {
      const out = concealHoleData(hd, roundsFor({ a: through, b: through }));
      [...A, ...B].forEach((pid) => {
        expect(out[`${pid}_4`]).toBeUndefined();
      });
    });
  });

  // The other half of the same promise, and the one a per-round bug would
  // break silently: the rest of the tournament is untouched, byte for byte.
  it("leaves every other round alone, by reference", () => {
    const hd = fullHoleData();
    const out = concealHoleData(hd, roundsFor({ a: 5, b: 5 }));
    expect(holesIn(out, "a1_1")).toBe(18);
    expect(holesIn(out, "b1_1")).toBe(18);
    // Not a copy — the untouched keys are the SAME score objects, which is
    // what keeps the memo chains under an unsealed round from invalidating.
    expect(out.a1_1).toBe(hd.a1_1);
    expect(out.b1_1).toBe(hd.b1_1);
  });

  it("never mutates the map it was handed", () => {
    const hd = fullHoleData();
    concealHoleData(hd, roundsFor({ a: 5, b: 5 }));
    expect(holesIn(hd, "a1_4")).toBe(18);
    expect(holesIn(hd, "b1_4")).toBe(18);
  });

  // ── The separator ────────────────────────────────────────────────
  // Player ids are minted `bc_player_<ms>` and a director may rename nothing
  // about them, but the app has carried ids with underscores in them since
  // the history import (`hist_2019_paulw`). The round is read off the LAST
  // separator for exactly this reason — a naive split("_")[1] reads "player"
  // as the round number and leaves the sealed card in the map.
  it("reads the round off the LAST separator, not the first", () => {
    const pid = "bc_player_1757_x";
    const hd = {
      [`${pid}_4`]: { 0: 4, 1: 5, 2: 6 },
      [`${pid}_1`]: { 0: 4, 1: 5 },
      // The id that broke the naive parse most convincingly: it ENDS in
      // something that looks like a round number.
      "hist_2019_paulw_4": { 0: 3, 1: 3 },
      "hist_2019_paulw_1": { 0: 3, 1: 3 },
    };
    const out = concealHoleData(hd, roundsFor({ a: 9, b: 9 }));
    expect(out[`${pid}_4`]).toBeUndefined();
    expect(out["hist_2019_paulw_4"]).toBeUndefined();
    // And round 1 survives whole, for both of them.
    expect(holesIn(out, `${pid}_1`)).toBe(2);
    expect(holesIn(out, "hist_2019_paulw_1")).toBe(2);
  });

  // The same parse, on the screen that is allowed to walk the round.
  it("countdownHoleData reads the same separator", () => {
    const pid = "bc_player_1757_x";
    const hd = { [`${pid}_4`]: { 0: 4, 1: 5, 2: 6 }, [`${pid}_1`]: { 0: 4 } };
    // No side lookup for this id, so it is cut at the lower counter — 2.
    const out = countdownHoleData(hd, roundsFor({ a: 5, b: 2 }));
    expect(Object.keys(out[`${pid}_4`])).toEqual(["0", "1"]);
    expect(out[`${pid}_1`]).toEqual({ 0: 4 });
  });
});

// ══════════════════════════════════════════════════════════════════
//  2. The identity guarantee, in BOTH directions
// ══════════════════════════════════════════════════════════════════
//
// App.jsx:5738 — `const nothingSealed = revealedHoleData === holeData;` —
// and that boolean gates the write that archives the edition's result. The
// reference IS the test, so both directions are load-bearing:
//
//   a fresh object when nothing is sealed  → the cup is never archived
//   the same object when something IS      → a half-scored cup is archived
//                                            as the year's final result,
//                                            and a stored row does not
//                                            correct itself later.
describe("the identity contract App tests with ===", () => {
  it("hands back the ORIGINAL object when nothing is concealing", () => {
    const hd = fullHoleData();
    // No sealed round at all.
    const open = [{ round_number: 1, format: "singles" }];
    expect(concealHoleData(hd, open)).toBe(hd);
    expect(countdownHoleData(hd, open, sideOfPlayer)).toBe(hd);

    // Sealed, fully revealed AND final — the round is in the books and
    // conceals nothing, so the map must come back untouched by reference.
    const done = roundsFor({ a: 18, b: 18, final: true });
    expect(concealHoleData(hd, done)).toBe(hd);
    expect(countdownHoleData(hd, done, sideOfPlayer)).toBe(hd);

    // And the degenerate inputs, which App hits on the first frame.
    expect(concealHoleData(hd, [])).toBe(hd);
    expect(concealHoleData(hd, null)).toBe(hd);
    expect(countdownHoleData(hd, null, sideOfPlayer)).toBe(hd);
  });

  it("hands back a FRESH object the moment anything conceals", () => {
    const hd = fullHoleData();
    [0, 1, 17].forEach((through) => {
      const rounds = roundsFor({ a: through, b: through });
      expect(concealHoleData(hd, rounds)).not.toBe(hd);
      expect(countdownHoleData(hd, rounds, sideOfPlayer)).not.toBe(hd);
    });
    // Eighteen out but not final: the ceremony is over, the round is not.
    const ceremonyDone = roundsFor({ a: 18, b: 18, final: false });
    expect(concealHoleData(hd, ceremonyDone)).not.toBe(hd);
    expect(countdownHoleData(hd, ceremonyDone, sideOfPlayer)).not.toBe(hd);
  });

  // The subtle one. A concealing round whose scores are not in the map yet —
  // nobody has teed off, or the subscription has not arrived — still has to
  // break the identity, or App reads "nothing sealed" during exactly the
  // window the round is most sealed.
  it("breaks identity even when the sealed round has no scores to remove", () => {
    const noFour = { a1_1: { 0: 4 } };
    const rounds = roundsFor({ a: 0, b: 0 });
    const out = concealHoleData(noFour, rounds);
    expect(out).not.toBe(noFour);
    expect(out).toEqual(noFour);
    expect(countdownHoleData(noFour, rounds, sideOfPlayer)).not.toBe(noFour);

    // Down to an empty map, which is the first frame of every cold start.
    const empty = {};
    expect(concealHoleData(empty, rounds)).not.toBe(empty);
    expect(concealHoleData(empty, rounds)).toEqual({});
  });
});

// ══════════════════════════════════════════════════════════════════
//  3. The countdown's per-side cut
// ══════════════════════════════════════════════════════════════════
//
// A hole is turned over ONE SIDE AT A TIME, so the cut is per PLAYER. Team
// A's twelfth exists on the countdown's map while team B's twelfth does not.
describe("countdownHoleData cuts per side", () => {
  const hd = fullHoleData();
  const rounds = roundsFor({ a: 5, b: 3 });

  it("gives each side its own counter", () => {
    const out = countdownHoleData(hd, rounds, sideOfPlayer);
    // reveal_a = 5 → holes 0..4 exist. Index 4 is the last one out.
    expect(out.a1_4[4]).toBe(6);
    expect(out.a1_4[5]).toBeUndefined();
    expect(Object.keys(out.a1_4)).toHaveLength(5);
    // reveal_b = 3 → holes 0..2 exist. Index 3 is NOT out.
    expect(out.b1_4[3]).toBeUndefined();
    expect(out.b1_4[2]).toBe(3);
    expect(Object.keys(out.b1_4)).toHaveLength(3);
  });

  // The public number is still the minimum — a hole with one side left to
  // speak has no result — so the BOARD's idea of the round never leads the
  // countdown's.
  it("is never more generous than the board's own reading", () => {
    expect(revealedThrough(rounds[1])).toBe(3);
  });

  it("falls back to the minimum for BOTH sides with no lookup at all", () => {
    const out = countdownHoleData(hd, rounds);
    expect(Object.keys(out.a1_4)).toHaveLength(3);
    expect(Object.keys(out.b1_4)).toHaveLength(3);
  });

  // A player the roster does not know — a withdrawal edited out, a score
  // keyed to an id no longer on the roster, a spectator's own id. `sideOf`
  // returns null and the cut has to fall on the SAFER side, which is the one
  // that has been shown less. Verified as a fact about the output rather
  // than trusted to the comment.
  it("cuts an unknown player at the SAFER of the two counters", () => {
    const withGhost = { ...hd, ghost_4: { 0: 4, 1: 4, 2: 4, 3: 4, 4: 4 } };
    const unknown = () => null;
    // a=5, b=3 → the safer cut is 3.
    expect(Object.keys(countdownHoleData(withGhost, rounds, unknown).ghost_4)).toHaveLength(3);
    // And the other way round, so this is not an accident of which side is
    // ahead: a=2, b=7 → the safer cut is 2.
    const other = roundsFor({ a: 2, b: 7 });
    expect(Object.keys(countdownHoleData(withGhost, other, unknown).ghost_4)).toHaveLength(2);
  });

  it("drops a side that has nothing out at all", () => {
    const out = countdownHoleData(hd, roundsFor({ a: 4, b: 0 }), sideOfPlayer);
    expect(Object.keys(out.a1_4)).toHaveLength(4);
    expect(out.b1_4).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════
//  4. The two conditions, and the fallback that keeps ten years visible
// ══════════════════════════════════════════════════════════════════
describe("isConcealing needs BOTH the eighteenth and the director", () => {
  it("keeps concealing on eighteen revealed but not final", () => {
    expect(isConcealing(roundsFor({ a: 18, b: 18, final: false })[1])).toBe(true);
  });

  it("keeps concealing on final but only seventeen revealed", () => {
    expect(isConcealing(roundsFor({ a: 17, b: 17, final: true })[1])).toBe(true);
    // And on a pair that is level on 18 for one side only.
    expect(isConcealing(roundsFor({ a: 18, b: 17, final: true })[1])).toBe(true);
  });

  it("stops only when both are in", () => {
    expect(isConcealing(roundsFor({ a: 18, b: 18, final: true })[1])).toBe(false);
  });

  it("is the door the scoreboard reads — zero holes until both", () => {
    const hd = fullHoleData();
    // Eighteen out, not final: the room has watched the whole round and the
    // board still holds at nothing.
    const held = concealHoleData(hd, roundsFor({ a: 18, b: 18, final: false }));
    expect(held.a1_4).toBeUndefined();
    expect(held.b1_4).toBeUndefined();
    // The director finalises and the entire round lands at once.
    const landed = concealHoleData(hd, roundsFor({ a: 18, b: 18, final: true }));
    expect(holesIn(landed, "a1_4")).toBe(18);
    expect(holesIn(landed, "b1_4")).toBe(18);
  });
});

describe("resolveSealed's unset-flag fallback", () => {
  // The failure that put this here: the Rounds form's seed only reaches the
  // document when a director opens it, so a Team Best Ball round nobody
  // edited was played in the open.
  it("seals a live Team Best Ball round nobody flagged", () => {
    expect(resolveSealed("team_best_ball", undefined, false)).toBe(true);
    expect(resolveSealed("team_best_ball", null, undefined)).toBe(true);
  });

  // The guard on the other end, and it is what keeps 2016–2024 on screen:
  // the history import writes every round locked and final, so none of it
  // is reachable by the fallback above.
  it("never retro-seals a finished round on the format alone", () => {
    expect(resolveSealed("team_best_ball", undefined, true)).toBe(false);
    expect(resolveSealed("team_best_ball", null, true)).toBe(false);
  });

  it("still takes an explicit flag over both", () => {
    expect(resolveSealed("team_best_ball", false, false)).toBe(false);
    expect(resolveSealed("singles", true, true)).toBe(true);
  });

  // End to end, on the map: an imported year's closing round is scored.
  it("leaves an imported year's Team Best Ball round on the board", () => {
    const hd = { hist_2019_paulw_4: { 0: 4, 1: 4 } };
    const imported = [{
      round_number: 4, format: "team_best_ball", final: true, // sealed unset
    }];
    expect(concealHoleData(hd, imported)).toBe(hd);
  });
});

// ══════════════════════════════════════════════════════════════════
//  5. Round-trip: a concealed map through the app's own engine
// ══════════════════════════════════════════════════════════════════
//
// The subtraction is only as good as what the engine makes of it. The whole
// design is that no screen HAS the sealed numbers and declines to draw them
// — so the proof is that the result object itself is empty, which is what
// every points total, strip, status and cup bar is computed from.
describe("a concealed round scores as a round nobody played", () => {
  const scoreWith = (map, rounds) =>
    computeMatchResult(match4, map, courses, rounds, tPlayers, "team_best_ball",
      {}, undefined, {}, {});

  it("banks no points and plays no holes", () => {
    const rounds = roundsFor({ a: 12, b: 11 });
    const concealed = concealHoleData(fullHoleData(), rounds);
    const res = scoreWith(concealed, rounds);
    expect(res.totalPts).toEqual({ A: 0, B: 0 });
    expect(res.holesPlayed).toBe(0);
    expect(res.holes.every((h) => !h.played)).toBe(true);
    // Nothing for a reader to do the arithmetic on: no hole carries a side's
    // score, so the strip is blank rather than one-sided.
    expect(res.holes.every((h) => h.aScore == null && h.bScore == null)).toBe(true);
  });

  // The control. The same match, the same engine, the same fixtures — the
  // ONLY difference is the seal — and the rout is worth points to B. If this
  // ever came back zero the test above would be proving nothing.
  it("and the identical map, unsealed, is worth points to B", () => {
    const open = roundsFor({ a: 18, b: 18, final: true });
    const res = scoreWith(concealHoleData(fullHoleData(), open), open);
    expect(res.holesPlayed).toBe(HOLE_COUNT);
    expect(res.totalPts.B).toBeGreaterThan(0);
    expect(res.totalPts.A).toBe(0);
  });

  // Eighteen turned over, director has not finalised. This is the beat the
  // second condition of isConcealing exists for, and the one where a board
  // that walked with the reveal would already be showing the ending.
  it("holds at zero on the eighteenth until the director finalises", () => {
    const rounds = roundsFor({ a: 18, b: 18, final: false });
    const res = scoreWith(concealHoleData(fullHoleData(), rounds), rounds);
    expect(res.totalPts).toEqual({ A: 0, B: 0 });
    expect(res.holesPlayed).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════
//  6. AUDIT — what the grep found, expressed where it can be
// ══════════════════════════════════════════════════════════════════
//
// Every consumer of the raw `holeData` map in src/, traced by hand:
//
//   App.jsx:6322  ScoreEntry        — the DESIGNED exception. Raw gross,
//                                     including the two opponents in a mixed
//                                     foursome, because somebody has to write
//                                     them down. What it conceals is what
//                                     they add up to (`conceal`, App:1222).
//   App.jsx:6300  ownHoleData       — the captain's own-side pass. Traced
//                                     below.
//   App.jsx:6301  countdownData     — the countdown's cut-at-the-reveal map.
//   App.jsx:6510  AdminView         — director-only, and it reads COUNTS
//                                     (holesEntered, orphanedScores,
//                                     matchScoreImpact), never a score.
//   App.jsx:5759  roundScoreProgress — counts again, director-only alert.
//
// Everything else — the scoreboard (6299), the Betting tab (6366), the Data
// tab (6440), the round summary sheet (6648) and the archived edition
// summary (5740) — is handed `revealedHoleData`.
describe("AUDIT: ownHoleData reaches exactly one place", () => {
  // Leaderboard.jsx passes the UNSEALED map into `ownResults` (993–1007),
  // and `ownResults` is read at exactly one line — 1197, `ownResult` on
  // FinalCountdown, alongside `ownGetScore` at 1198. Inside FinalCountdown
  // both are read only by `myPrompt` (804–860), which is gated three ways:
  // `compact` (never the television), `captainSide` (null for everybody who
  // is not a captain, and null for a director who captains nothing), and a
  // `sidesPending` check so it is not live while the OTHER captain is
  // talking. The window it reads is capped at the captain's own counter.
  //
  // That is a source-level fact rather than a runtime one, so it is asserted
  // as one: if a second consumer of ownResults/ownHoleData ever appears,
  // this fails and somebody re-reads the note above.
  // Comment lines are dropped first — the note at the top of TeamLeaderboard
  // explains this design at length and mentions both names, and a count that
  // moved when somebody improved a comment would be a count nobody trusts.
  const codeLines = async (file) => {
    const { readFileSync } = await import("node:fs");
    return readFileSync(new URL(file, import.meta.url), "utf8")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
  };

  it("has exactly one consumer in Leaderboard.jsx", async () => {
    const lines = await codeLines("./components/Leaderboard.jsx");
    // `ownResults`: the declaration, and ONE read — the `ownResult` prop on
    // FinalCountdown. Two lines, and that is the whole of its reach.
    const reads = lines.filter((l) => /\bownResults\b/.test(l));
    expect(reads).toHaveLength(2);
    expect(reads.filter((l) => /ownResult=/.test(l))).toHaveLength(1);

    // `ownHoleData`: the prop in the signature, the computeMatchResult call
    // inside ownResults, that memo's dep array, and `ownGetScore`. Nothing
    // else, and in particular nothing that renders.
    const own = lines.filter((l) => /\bownHoleData\b/.test(l));
    expect(own).toHaveLength(4);
    expect(own.filter((l) => /ownGetScore=/.test(l))).toHaveLength(1);

    // The thing that would actually be the bug: the board's own results
    // must never be scored from the unsealed map.
    const matchResultsCall = lines.find(
      (l) => /const res = computeMatchResult\(m,/.test(l));
    expect(matchResultsCall).toMatch(/computeMatchResult\(m, holeData,/);
  });

  it("the board's own pass is scored off the concealed map", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("./components/Leaderboard.jsx", import.meta.url), "utf8");
    // matchResults — what the cup bar, the round bars and every match card
    // read — takes `holeData`, which App has already concealed.
    expect(src).toMatch(
      /const matchResults = useMemo\(\(\) => matches\.map\(\(m\) => \{[\s\S]{0,400}?computeMatchResult\(m, holeData,/);
  });
});

// ── The one gap the audit found, pinned so it does not drift ────────
//
// App.jsx:1264-1285. On a concealing round the group picker refuses to walk
// to the other side without a deliberate second ask (`sealedToOwnSide`), and
// `openUnits` is the filtered list. But `unit` has a FLOOR:
//
//     const unit = openUnits.find(...) || unitForPlayer(openUnits, userPid)
//                  || openUnits[0] || units[0] || null;
//
// `units[0]` is reached when the reader's own side has no unit at all — and
// `scoringUnits` returns ONE unit holding the whole match when the round is
// undrawn or drawn entirely into a single group. That unit holds both sides,
// so `otherSideUnit` is true for it, `openUnits` is empty, and the floor
// hands back the all-sixteen card.
//
// It is raw GROSS only — `conceal` still blanks the running match state, the
// side totals and the other side's column on the Full Scorecard — so this is
// the documented Scoring-tab exception applied to sixteen men rather than to
// a foursome, not an aggregate leak. Reported rather than fixed: App.jsx is
// off limits this session, and the floor is deliberate ("a screen has to be
// about somebody").
describe("AUDIT: the undrawn closing round collapses to one unit", () => {
  it("is a single whole-match unit when nobody has been grouped", () => {
    const units = scoringUnits({ match: match4, groups: null, formatId: "team_best_ball" });
    expect(units).toHaveLength(1);
    expect(units[0].pids).toEqual([...A, ...B]);
    // Which is what makes App's `otherSideUnit` true for it whichever side
    // the reader is on — the filter has nothing left to offer.
    const otherSideUnit = (u, userTeam) =>
      u.pids.some((pid) => (match4.teamA.includes(pid) ? "A" : "B") !== userTeam);
    expect(otherSideUnit(units[0], "A")).toBe(true);
    expect(otherSideUnit(units[0], "B")).toBe(true);
    expect(units.filter((u) => !otherSideUnit(u, "A"))).toHaveLength(0);
  });

  // Drawn properly, which is how the round actually runs, the filter works:
  // a side A reader keeps his own two waves and neither of B's.
  it("but a drawn round leaves each side its own waves", () => {
    // A group is a flat list of player ids — see groupIndexForPlayer.
    const groups = [["a1", "a2"], ["a3", "a4"], ["b1", "b2"], ["b3", "b4"]];
    const units = scoringUnits({ match: match4, groups, formatId: "team_best_ball" });
    expect(units).toHaveLength(4);
    const otherSideUnit = (u, userTeam) =>
      u.pids.some((pid) => (match4.teamA.includes(pid) ? "A" : "B") !== userTeam);
    const openForA = units.filter((u) => !otherSideUnit(u, "A"));
    expect(openForA).toHaveLength(2);
    expect(openForA.flatMap((u) => u.pids).sort()).toEqual(A);
  });
});

// ── The second gap: the pins are not concealed by anything ──────────
//
// `concealHoleData` subtracts SCORES. It does not touch `ctpData`, and
// nothing else does either — App hands the raw map to the Betting tab
// (6357), the round summary sheet (6675) and the countdown's own caller.
// For every round but one that is exactly right: a pin is tagged out loud on
// the tee and the whole group watches it happen.
//
// On the sealed round it means the closest-to-pin winners, with distances,
// are readable before the ceremony — and the round summary sheet is the
// sharp end of it, because:
//
//   • the Leaderboard's own button to that sheet IS gated on the seal
//     (Leaderboard.jsx:840, `!seal?.concealing`), but the `#round/N` DEEP
//     LINK is not (App.jsx:6652 renders on `summaryRound != null`);
//   • `onRoundFinal` (functions/index.js:385) fires on the round lock's
//     false→true edge, which a director can set BEFORE the reveal starts —
//     `isConcealing` needs final AND eighteen out, so the round is still
//     sealed at that moment;
//   • that push's BODY is the pins (ctpNotice.js) and its `url` is
//     `/#round/N`. So sixteen phones get "Round 4 is final", the pins in the
//     body, and a tap that opens the sheet.
//
// Every score-derived section of the sheet is correctly empty — that is the
// subtraction working. The CTP card is the one that is not, and it renders
// unconditionally (RoundSummarySheet.jsx:412). Pinned here rather than
// fixed: the fix is a policy call about whether a pin is part of the round's
// result, and it touches App.jsx, which is off limits this session.
describe("AUDIT: CTP pins survive the subtraction", () => {
  const parThreeCourse = [{
    id: "c1", name: "Treetops",
    hole_pars: PARS.map((p, i) => (i === 6 ? 3 : p)),
    hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1),
    tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 71 }],
  }];

  const sheetFor = (rounds) => roundSummary({
    round: 4,
    matches: [match4],
    holeData: concealHoleData(fullHoleData(), rounds),
    tPlayers, tRounds: rounds, courses: parThreeCourse, roundLocks: {},
    ctpData: { "4_6": { player_id: "a1", distance_ft: 4 } },
    buyIns: null, hcpOverrides: {}, teeAssignments: {}, teamNames: {},
  });

  it("blanks every score-derived section of the sealed round's sheet", () => {
    const s = sheetFor(roundsFor({ a: 0, b: 0 }));
    expect(s.played).toBe(false);
    expect(s.points.A).toBe(0);
    expect(s.points.B).toBe(0);
    expect(s.skins.gross).toHaveLength(0);
    expect(s.skins.net).toHaveLength(0);
    expect(s.lowNet).toHaveLength(0);
    // The money hole card can still appear — it is the round's LAST hole,
    // which is a fact about the schedule — but it names nobody.
    expect(s.moneyHole?.winners ?? []).toHaveLength(0);
  });

  // The gap, stated as a fact rather than a worry. If somebody later decides
  // a pin IS part of the round and conceals it, this flips and the note
  // above gets read.
  it("but still names the pin winner, on a round nothing has been revealed of", () => {
    const s = sheetFor(roundsFor({ a: 0, b: 0 }));
    expect(s.ctp).toHaveLength(1);
    expect(s.ctp[0]).toMatchObject({ hole: 6, pid: "a1", distanceFt: 4 });
  });
});
