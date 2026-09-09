// ══════════════════════════════════════════════════════════════════
//  The properties every format has to have, whatever the format is
// ══════════════════════════════════════════════════════════════════
//
// The unit tests next door check that particular formats produce particular
// numbers. This checks the things that have to be true of ALL of them at once
// — the class of defect that hides in one branch of a nine-branch switch and
// is only ever found by someone reading that branch.
//
// Each of these is a rule the engine states about itself somewhere in
// scoring.js. Stating them as a sweep over every format in the catalog is what
// stops the eleventh format being added without them.
import { describe, it, expect } from "vitest";
import { computeMatchResult, buildStrokeMap } from "./scoring";
import { summarizeEdition } from "./lib/editionSummary";
import { FORMATS, NASSAU_DEFAULT } from "./constants";

const PARS = [4,4,3,5,4,4,3,4,5,4,3,4,4,5,4,3,4,4];
const SI   = [5,9,15,1,11,3,17,7,13,6,16,2,10,4,8,18,12,14];
const course = { id: "c1", par: 72, hole_pars: PARS, hole_handicaps: SI,
  tee_boxes: [{ name: "White", slope: 124, rating: 71.4, par: 72 }] };

const ALL = FORMATS.map(f => f.id);
// A Team Best Ball side is the whole team; everything else states its own.
const sideSize = (id) => FORMATS.find(f => f.id === id).perSide ?? 4;
const countingFor = (id) => (id === "team_best_ball" ? { holes: Array(18).fill(2) } : null);

const rng = (s) => () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

const build = ({ format, sizeA, sizeB, seed = 5, scoring_type, mode = "low_man", indexes, drop = [], withdrawn = [] }) => {
  const r = rng(seed);
  const teamA = Array.from({ length: sizeA }, (_, i) => `a${i}`);
  const teamB = Array.from({ length: sizeB }, (_, i) => `b${i}`);
  const all = [...teamA, ...teamB];
  const tPlayers = all.map((pid, i) => ({
    player_id: pid, name: pid, team: teamA.includes(pid) ? "A" : "B",
    handicap_index: indexes ? indexes[i] : Math.round(r() * 280) / 10,
    ...(withdrawn.includes(pid) ? { withdrawn: true } : {}),
  }));
  const holeData = {};
  for (const pid of all) {
    const card = {};
    if (!withdrawn.includes(pid)) {
      for (let h = 0; h < 18; h++) {
        if (drop.some(d => d.pid === pid && d.h === h)) continue;
        card[h] = Math.max(2, PARS[h] + Math.floor(r() * 4) - 1);
      }
    }
    holeData[`${pid}_1`] = card;
  }
  const tRounds = [{ round_number: 1, course_id: "c1", tee_box: "White", format,
    handicap_mode: mode, ...(scoring_type ? { scoring_type } : {}),
    ...(countingFor(format) ? { counting_scores: countingFor(format) } : {}) }];
  const match = { id: "m", round: 1, teamA, teamB, ...(scoring_type ? { scoring_type } : {}) };
  return { match, holeData, tPlayers, tRounds, format };
};
const run = (f, over = {}) => computeMatchResult(
  { ...f.match, ...over }, f.holeData, [course], f.tRounds, f.tPlayers, f.format, {}, undefined, {}, {});
const evenly = (format, extra = {}) => build({ format, sizeA: sideSize(format), sizeB: sideSize(format), ...extra });

describe("the allocation", () => {
  it("hands out exactly the handicap, wrapping to three strokes a hole", () => {
    for (let ch = -30; ch <= 60; ch++) {
      const total = Object.values(buildStrokeMap(ch, SI)).reduce((a, b) => a + b, 0);
      expect(total, `ch=${ch}`).toBe(Math.sign(ch) * Math.min(Math.abs(ch), 54));
    }
  });

  it("puts somebody on scratch in every low-man match", () => {
    const bad = [];
    for (const format of ALL) {
      const res = run(evenly(format, { seed: 3, mode: "low_man" }));
      const totals = Object.values(res.strokeMaps).map(m => Object.values(m).reduce((a, b) => a + b, 0));
      if (Math.min(...totals) !== 0) bad.push(`${format}: nobody at scratch (${totals.join(",")})`);
    }
    expect(bad.join("\n")).toBe("");
  });

  it("survives a plus handicap", () => {
    const bad = [];
    for (const format of ALL) {
      const n = sideSize(format);
      const idx = Array.from({ length: n * 2 }, (_, i) => (i === 0 ? -4.2 : 5 + i));
      const res = run(build({ format, sizeA: n, sizeB: n, indexes: idx, mode: "full" }));
      if (!Number.isFinite(res.overall.margin)) bad.push(`${format}: margin ${res.overall.margin}`);
      for (const [pid, m] of Object.entries(res.strokeMaps))
        for (const v of Object.values(m)) if (!Number.isFinite(v)) bad.push(`${format} ${pid}: ${v}`);
    }
    expect(bad.join("\n")).toBe("");
  });
});

describe("the two sides are the same shape", () => {
  it("swapping A and B mirrors every hole, the margin and the points", () => {
    const bad = [];
    for (const format of ALL) {
      for (const scoring_type of [undefined, "total", "points"]) {
        for (const mode of ["low_man", "full"]) {
          const f = evenly(format, { seed: 7, scoring_type, mode });
          const fwd = run(f);
          const rev = computeMatchResult({ ...f.match, teamA: f.match.teamB, teamB: f.match.teamA },
            f.holeData, [course], f.tRounds, f.tPlayers, format, {}, undefined, {}, {});
          const tag = `${format}/${scoring_type || "match"}/${mode}`;
          if (fwd.overall.margin !== -rev.overall.margin) bad.push(`${tag}: margin ${fwd.overall.margin} vs ${rev.overall.margin}`);
          if (fwd.totalPts.A !== rev.totalPts.B || fwd.totalPts.B !== rev.totalPts.A) bad.push(`${tag}: points did not swap`);
          for (let h = 0; h < 18; h++) {
            if (fwd.holes[h].aScore !== rev.holes[h].bScore || fwd.holes[h].bScore !== rev.holes[h].aScore) {
              bad.push(`${tag} h${h + 1}: ${fwd.holes[h].aScore}/${fwd.holes[h].bScore} vs ${rev.holes[h].bScore}/${rev.holes[h].aScore}`); break;
            }
          }
        }
      }
    }
    expect(bad.join("\n")).toBe("");
  });

  it("does not care which order a side's names are listed in", () => {
    // The one documented exception is which of two EQUAL nets a Team Best
    // Ball credits, which is a caption on the Countdown and not the score.
    const bad = [];
    for (const format of ALL) {
      const f = evenly(format, { seed: 11 });
      const fwd = run(f);
      const rev = computeMatchResult(
        { ...f.match, teamA: [...f.match.teamA].reverse(), teamB: [...f.match.teamB].reverse() },
        f.holeData, [course], f.tRounds, f.tPlayers, format, {}, undefined, {}, {});
      if (fwd.overall.margin !== rev.overall.margin) bad.push(`${format}: margin ${fwd.overall.margin} vs ${rev.overall.margin}`);
    }
    expect(bad.join("\n")).toBe("");
  });
});

describe("a hole nobody could have finished is not a hole", () => {
  it("a side with no players posts nothing, on every format", () => {
    // `[].every()` is TRUE and `[].reduce(…, 0)` is 0, so 2-Man Agg, Tilt and
    // Stableford used to hand an empty side a perfect zero on all eighteen —
    // the best aggregate there is — and pay out an 18-0 win to a side with no
    // card on it. Nothing on screen would have said so.
    const bad = [];
    for (const format of ALL) {
      const res = run(build({ format, sizeA: 0, sizeB: sideSize(format) }));
      const scored = res.holes.filter(h => h.played).length;
      if (scored) bad.push(`${format}: ${scored} holes scored against an empty side`);
      if (res.totalPts.A || res.totalPts.B) bad.push(`${format}: paid out ${JSON.stringify(res.totalPts)}`);
    }
    expect(bad.join("\n")).toBe("");
  });
});

describe("the pots", () => {
  it("a finished Nassau pays out exactly what was on offer, once", () => {
    const bad = [];
    for (const format of ALL) {
      for (const scoring_type of [undefined, "total"]) {
        const res = run(evenly(format, { seed: 21, scoring_type }), { nassau: NASSAU_DEFAULT });
        const pot = NASSAU_DEFAULT.front + NASSAU_DEFAULT.back + NASSAU_DEFAULT.overall;
        const paid = res.totalPts.A + res.totalPts.B;
        if (Math.abs(paid - pot) > 1e-9) bad.push(`${format}/${scoring_type || "match"}: paid ${paid} of ${pot}`);
      }
    }
    expect(bad.join("\n")).toBe("");
  });
});

describe("a round whose course nobody has picked yet", () => {
  // Not a rare path: the draw is made in February and the courses are booked
  // in June, so for months a match exists whose round has no course, and every
  // screen scores it like any other.
  const tRounds = [
    { round_number: 1, course_id: "c1", tee_box: "White", format: "singles" },
    { round_number: 2, format: "singles" },                       // no course yet
  ];
  const matches = [
    { id: "m1", round: 1, teamA: ["p1"], teamB: ["p2"] },
    { id: "m2", round: 2, teamA: ["p1"], teamB: ["p2"] },
  ];
  const two = [
    { player_id: "p1", name: "A", team: "A", handicap_index: 8 },
    { player_id: "p2", name: "B", team: "B", handicap_index: 8 },
  ];
  const holeData = { p1_1: {}, p2_1: {} };
  for (let h = 0; h < 18; h++) { holeData.p1_1[h] = 4; holeData.p2_1[h] = 5; }

  it("still hands back something shaped like a result", () => {
    // It used to bail with `{ status: "AS", frontPts: 0, … }` — no `totalPts`,
    // no segments, and the pot fields as NUMBERS where a result carries
    // { A, B }. Anything reading the result it was handed threw on it.
    const res = computeMatchResult(matches[1], holeData, [], tRounds, two, "singles", {}, undefined, {}, {});
    expect(res.totalPts).toEqual({ A: 0, B: 0 });
    expect(res.overall.played).toBe(0);
    expect(res.holes).toHaveLength(18);
    expect(res.status).toBe("—");
  });

  it("does not take the cup's own stored score down with it", () => {
    // summarizeEdition reads res.totalPts.A for every match to write the row
    // on bc_editions. One course-less round threw a TypeError through it.
    const sum = summarizeEdition({ matches, holeData, courses: [course], tRounds,
      tPlayers: two, teamNames: { A: "Irons", B: "Drivers" } });
    expect(sum.scoreA + sum.scoreB).toBeGreaterThan(0);
    expect(Number.isFinite(sum.scoreA)).toBe(true);
  });
});
