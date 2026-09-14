// ══════════════════════════════════════════════════════════════════
//  scoresExport — is it actually the spreadsheet's tab?
// ══════════════════════════════════════════════════════════════════
//
// The unit tests next door check the layout. This one checks the only thing
// that finally matters about a backup: run the exporter over an imported year
// and the numbers in it must be the numbers the ORIGINAL ALL SCORES tab
// printed for that year — the real CSV, committed under `data/historical
// sheets`, exported from the workbook the cup was actually run off.
//
// This is the trick historyImport.fidelity.test.js plays, for the same reason.
// An export that is subtly wrong — a stroke on the wrong hole, an OUT that
// sums ten holes — produces a file that looks completely plausible, and it
// would be discovered on the one Saturday it is needed, by somebody with no
// way to check it.
//
// Two years, 2024 and 2025: the two whose workbooks still have their ALL
// SCORES tab exported to CSV beside them.
//
// ── What is compared, and what cannot be ──────────────────────────
// The numbers: course handicap, all eighteen gross, OUT/IN/TOTAL/NET/ESC, all
// eighteen net, and net OUT/IN/TOTAL — per round, per player, both halves.
//
// Not the text. The workbook calls men by the names on the group text (R-Mac,
// TJSC, Telly) and the import writes the roster form (first name, last
// initial); the courses differ the same way, because a handicap pasted into a
// sheet as a value has no tee to have come from and the import gives every
// historical round one named "Historical". Neither is a score, and pinning
// either here would pin the IMPORT'S naming, which historyImport.test.js owns.
//
// ── The one place the two disagree, on purpose ────────────────────
// A SCRAMBLE round's handicaps are fractional, and only a scramble round's.
// The sheets blended each pair's Scramble and Pinehurst handicaps themselves
// and wrote the result on both partners' rows (see the note in
// historyImport.js), so 2025's round 3 has men playing off 6.2 and 11.5. The
// import freezes those into the round lock exactly as recorded.
//
// The sheet then FLOORED such a handicap to allocate strokes — 6.2 got six.
// The app's buildStrokeMap, which every scorecard, stroke dot and low-net
// calculation in the app goes through, hands out a stroke for the remainder
// too, so 6.2 gets seven. One stroke, on one hole, per affected card.
//
// The export follows THE APP, and that is the deliberate choice: this file is
// a backup of what the app holds, and a backup that disagreed with the screen
// it was taken from would be worse than no backup at all — two answers to one
// question, discovered during the argument it exists to settle.
//
// It also cannot reach a live tournament. calcCH ends in Math.round, so a
// course handicap the app calculates is always a whole number; a fractional
// one exists only inside an imported historical round. So the test below
// splits the field: an INTEGER handicap must match the workbook cell for
// cell, and a fractional one is allowed exactly this divergence and no more —
// same gross card, and a net card differing by one stroke on at most one hole.
// If that ever grows, this fails.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildEdition } from "./historyImport.js";
import { appView } from "./historyVerify.js";
import { handicapModeFor } from "../constants.js";
import { allScoresRows, COL, netCol, HOLES } from "./scoresExport.js";

const read = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}`, import.meta.url), "utf8"));
const { editions } = read("bourbon-cup-editions.json");
const backbone = read("bourbon-cup-backbone.json");

const sheetRows = (year) => readFileSync(
  new URL(`../../data/historical sheets/${year}/Bourbon Cup ${year} - Scoring - ALL SCORES.csv`,
    import.meta.url), "utf8",
).split(/\r?\n/).map(r => r.split(","));

// The exporter's own output for a year, built from the documents the import
// would write — through the same `appView` the scoring engine is verified on.
const exported = (year) => {
  const edition = editions.find((e) => e.year === year);
  const built = buildEdition(
    edition, backbone.playerHole.filter((h) => h.year === year), { handicapModeFor },
  );
  const view = appView(built);
  return allScoresRows({
    rounds: edition.rounds.map((r) => r.round),
    players: built.bc_players,
    holeData: view.holeData,
    courses: built.bc_courses,
    tRounds: view.tRounds,
    roundLocks: view.roundLocks,
    chOverrides: {},
    teeAssignments: {},
  });
};

// ── Lining the two up ─────────────────────────────────────────────
// The workbook's block is 24 rows (4 header, 16 players, then the SK C / CTP /
// LP5 side-game rows and a blank); ours is the same minus those three. So
// blocks are found by their heading rather than by arithmetic on a stride —
// which also means this test cannot quietly pass when a block goes missing.
const blocksOf = (rows) => {
  const out = [];
  rows.forEach((r, i) => {
    const m = /^Round (\d+)$/.exec((r[COL.player] || "").trim());
    if (m) out.push({ round: Number(m[1]), at: i });
  });
  return out;
};

// Player lines start four rows below the heading and run to the first row
// with no name in it.
const playerLines = (rows, at) => {
  const lines = [];
  for (let i = at + 4; i < rows.length; i++) {
    if (!(rows[i]?.[COL.player] || "").trim()) break;
    lines.push(rows[i]);
  }
  return lines;
};

// Blank on both sides means absent; everything else compares as a NUMBER, so
// "72" and "72.0" cannot fail on formatting alone.
const numOf = (row, col) => {
  const v = (row?.[col] ?? "").trim();
  return v === "" ? null : Number(v);
};
const holesOf = (row, first) => Array.from({ length: HOLES }, (_, h) => numOf(row, first + h));

const YEARS = [2024, 2025];

describe.each(YEARS)("%i — the export reproduces the workbook's ALL SCORES tab", (year) => {
  const mine = exported(year);
  const theirs = sheetRows(year);
  const myBlocks = blocksOf(mine);
  const theirBlocks = blocksOf(theirs);

  // Every player-round, paired with the workbook's line for the same man.
  const pairs = () => myBlocks.flatMap((b, i) => {
    const sheet = playerLines(theirs, theirBlocks[i].at);
    return playerLines(mine, b.at).map((row, r) => ({
      round: b.round, line: r + 1, row, want: sheet[r],
    }));
  });

  it("has the same rounds, in the same order", () => {
    expect(myBlocks.map(b => b.round)).toEqual(theirBlocks.map(b => b.round));
    expect(myBlocks.length).toBeGreaterThan(0);
  });

  it("has the same field in each round, in the same order", () => {
    myBlocks.forEach((b, i) => {
      expect(playerLines(mine, b.at)).toHaveLength(playerLines(theirs, theirBlocks[i].at).length);
    });
  });

  // Not a score, but it is the one thing in the file somebody would recompute
  // a course handicap FROM, so a wrong one is a wrong backup.
  it("carries each round's rating and slope", () => {
    myBlocks.forEach((b, i) => {
      const t = theirs[theirBlocks[i].at];
      const m = mine[b.at];
      expect([numOf(m, COL.total), numOf(m, COL.net)])
        .toEqual([numOf(t, COL.total), numOf(t, COL.net)]);
    });
  });

  it("carries each round's par and stroke index", () => {
    myBlocks.forEach((b, i) => {
      expect(holesOf(mine[b.at + 2], COL.firstHole))     // Handi
        .toEqual(holesOf(theirs[theirBlocks[i].at + 2], COL.firstHole));
      expect(holesOf(mine[b.at + 3], COL.firstHole))     // Par
        .toEqual(holesOf(theirs[theirBlocks[i].at + 3], COL.firstHole));
    });
  });

  // Gross is the record. Nothing about a handicap touches it, so this holds
  // for every man in every round with no exception carved out — and it is the
  // half a disaster recovery could not do without.
  it("reproduces every gross card, hole for hole", () => {
    pairs().forEach(({ round, line, row, want }) => {
      expect({
        round, line,
        ch: numOf(row, COL.hcp),
        gross: holesOf(row, COL.firstHole),
        out: numOf(row, COL.out),
        in: numOf(row, COL.in),
        total: numOf(row, COL.total),
        esc: numOf(row, COL.esc),
      }).toEqual({
        round, line,
        ch: numOf(want, COL.hcp),
        gross: holesOf(want, COL.firstHole),
        out: numOf(want, COL.out),
        in: numOf(want, COL.in),
        total: numOf(want, COL.total),
        esc: numOf(want, COL.esc),
      });
    });
  });

  // The net card, for everybody playing off a whole number — which is every
  // man in every round a director will ever export, because calcCH rounds.
  it("reproduces every net card played off a whole handicap", () => {
    const whole = pairs().filter(p => Number.isInteger(numOf(p.row, COL.hcp)));
    expect(whole.length).toBeGreaterThan(0);
    whole.forEach(({ round, line, row, want }) => {
      expect({
        round, line,
        net: holesOf(row, netCol(COL.firstHole)),
        out: numOf(row, netCol(COL.out)),
        in: numOf(row, netCol(COL.in)),
        total: numOf(row, netCol(COL.total)),
        grossNet: numOf(row, COL.net),
      }).toEqual({
        round, line,
        net: holesOf(want, netCol(COL.firstHole)),
        out: numOf(want, netCol(COL.out)),
        in: numOf(want, netCol(COL.in)),
        total: numOf(want, netCol(COL.total)),
        grossNet: numOf(want, COL.net),
      });
    });
  });

  // ── The fenced-off disagreement ───────────────────────────────
  // A blended scramble handicap, which the sheet floored and the app does not.
  // Pinned to exactly one stroke on at most one hole, in the app's direction,
  // so the day it becomes two this test says so rather than shrugging.
  it("differs from the workbook only by the blended-handicap stroke", () => {
    const frac = pairs().filter(p => !Number.isInteger(numOf(p.row, COL.hcp)));
    expect(frac.length).toBeGreaterThan(0);   // 2024 and 2025 both have a scramble
    frac.forEach(({ round, line, row, want }) => {
      const ours = holesOf(row, netCol(COL.firstHole));
      const sheet = holesOf(want, netCol(COL.firstHole));
      const diffs = ours.map((v, h) => (v == null || sheet[h] == null ? 0 : sheet[h] - v))
        .filter(d => d !== 0);
      // One hole, one stroke, and ours is the LOWER net — the extra stroke
      // the app hands out for the fractional remainder.
      expect({ round, line, diffs }).toEqual({ round, line, diffs: diffs.length ? [1] : [] });
    });
  });
});
