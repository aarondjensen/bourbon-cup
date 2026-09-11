// The layout, and the handful of decisions inside it that would each produce
// a file that looks right and is not. The fidelity test next door checks the
// numbers against the real workbook; this checks the shape and the edges it
// cannot reach — an unplayed round, a card in progress, a comma in a name.
import { describe, it, expect } from "vitest";
import {
  csvCell, toCsv, exportRoster, exportFilename, playerScores,
  roundBlock, roundHeading, allScoresRows, scoresCsv,
  COL, netCol, HOLES, ALL_SCORES_WIDTH, NET_OFFSET,
} from "./scoresExport";

// A flat par-4 course with a plain 1-18 stroke index, so a handicap of N puts
// a stroke on exactly holes 1..N and the arithmetic is checkable by eye.
const course = (over = {}) => ({
  id: "c1", name: "Kaufman",
  tee_boxes: [{ name: "White", slope: 134, rating: 70.8, par: 72 }],
  hole_pars: Array(18).fill(4),
  hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1),
  ...over,
});

const tRound = (n, over = {}) => ({ round_number: n, course_id: "c1", tee_box: "White", ...over });

const player = (id, name, team, index = 0) => ({
  player_id: id, name, team, handicap_index: index,
});

// A full 18-hole card of the same number.
const card = (score) => Object.fromEntries(Array.from({ length: 18 }, (_, h) => [h, score]));

const ctx = (over = {}) => ({
  players: [player("p1", "Jensen", "A", 7), player("p2", "Telly", "B", 7)],
  holeData: { p1_1: card(5), p2_1: card(4) },
  courses: [course()],
  tRounds: [tRound(1)],
  roundLocks: {},
  chOverrides: {},
  teeAssignments: {},
  ...over,
});

const block = (over = {}) => roundBlock({ round: 1, ...ctx(over) });
const lineFor = (rows, name) => rows.find(r => r[COL.player] === name);

describe("csvCell", () => {
  it("leaves an ordinary value alone", () => {
    expect(csvCell("Jensen")).toBe("Jensen");
    expect(csvCell(72)).toBe("72");
  });
  // The case that makes quoting necessary at all: a course or a man with a
  // comma in his name would otherwise shift every column after him one left,
  // which is a file that parses cleanly into the wrong answer.
  it("quotes anything with a comma, a quote or a newline in it", () => {
    expect(csvCell("Forest Dunes, ii/iii")).toBe('"Forest Dunes, ii/iii"');
    expect(csvCell('He said "no"')).toBe('"He said ""no"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });
  it("writes an absence as an empty cell", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("toCsv", () => {
  it("joins rows with CRLF and ends with one", () => {
    expect(toCsv([["a", "b"], ["c", "d"]])).toBe("a,b\r\nc,d\r\n");
  });
  it("survives no rows at all", () => {
    expect(toCsv([])).toBe("\r\n");
  });
});

describe("exportRoster", () => {
  const roster = [
    player("p3", "Telly", "B"), player("p1", "Jensen", "A"),
    player("p9", "Nobody", null), player("p2", "Andy", "A"),
  ];
  // Team A, then B, then the unassigned — the Players tab's own grouping and
  // the workbook's. Roster order within a team, because the director chose it.
  it("puts team A first, then B, then anyone unassigned", () => {
    expect(exportRoster(roster).map(p => p.name)).toEqual(["Jensen", "Andy", "Telly", "Nobody"]);
  });
  // 2020 went out a man short and played against a compiled card. It is not a
  // person, so no screen showing the ROSTER lists it — but it is a card, and
  // leaving it out exports a round that cannot be re-scored.
  it("keeps the borrowed ball, which the roster screens drop", () => {
    const withBall = [...roster, { player_id: "ball", name: "Team Ball", team: "A", borrowed: true }];
    expect(exportRoster(withBall).map(p => p.name)).toContain("Team Ball");
  });
  it("drops a row with no player id rather than exporting a blank line", () => {
    expect(exportRoster([...roster, { name: "Ghost", team: "A" }])).toHaveLength(4);
  });
});

describe("playerScores", () => {
  const si = Array.from({ length: 18 }, (_, i) => i + 1);

  it("takes a stroke off the holes the handicap falls on", () => {
    const s = playerScores({ card: card(5), ch: 3, holeHcps: si });
    expect(s.gross).toEqual(Array(18).fill(5));
    expect(s.net.slice(0, 3)).toEqual([4, 4, 4]);
    expect(s.net.slice(3)).toEqual(Array(15).fill(5));
    expect(s.netTotal).toBe(87);
    expect(s.grossTotal).toBe(90);
  });

  // The workbook's own rule, and the honest one: OUT and IN add what has been
  // posted so a round in progress still shows a running nine, but a TOTAL
  // under a card with holes missing is a number that looks finished and isn't.
  it("adds the nines in progress but withholds a total until the card is whole", () => {
    const s = playerScores({ card: { 0: 4, 1: 5, 2: 4 }, ch: 0, holeHcps: si });
    expect(s.grossOut).toBe(13);
    expect(s.grossIn).toBe(null);
    expect(s.grossTotal).toBe(null);
    expect(s.netTotal).toBe(null);
    expect(s.complete).toBe(false);
  });

  // A cleared score is stored as null and every reader in the app tests `> 0`.
  // A zero arriving here is an absence, not a hole in none.
  it("reads a zero as an unposted hole", () => {
    const s = playerScores({ card: { ...card(4), 5: 0 }, ch: 0, holeHcps: si });
    expect(s.gross[5]).toBe(null);
    expect(s.complete).toBe(false);
  });

  it("has no card at all without falling over", () => {
    const s = playerScores({ card: undefined, ch: 4, holeHcps: si });
    expect(s.gross).toEqual(Array(18).fill(null));
    expect(s.grossOut).toBe(null);
  });

  // Over 18 a handicap wraps and a hole carries two strokes — buildStrokeMap's
  // rule, and the export has to show the same card the app does.
  it("wraps a handicap over eighteen", () => {
    const s = playerScores({ card: card(6), ch: 20, holeHcps: si });
    expect(s.net[0]).toBe(4);   // stroke 1 and stroke 19
    expect(s.net[2]).toBe(5);   // one stroke only
  });
});

describe("roundHeading", () => {
  it("names the course and its tee, with that tee's rating and slope", () => {
    const h = roundHeading({ round: 1, tRounds: [tRound(1)], courses: [course()], roundLocks: {} });
    expect(h).toEqual({ course: "Kaufman - White", rating: 70.8, slope: 134, scored: true });
  });

  // A director draws the round in February and books the course in June. In
  // between, the round is real and has no rating — and printing resolveTeeSpec's
  // neutral 113/72 would put a plausible number in the column somebody would
  // go on to recompute handicaps from.
  it("leaves the rating and slope blank on a round with no course yet", () => {
    const h = roundHeading({ round: 1, tRounds: [tRound(1, { course_id: null })], courses: [], roundLocks: {} });
    expect(h).toEqual({ course: "", rating: null, slope: null, scored: false });
  });

  // A locked round answers to its snapshot, like every other screen. The
  // course document can be renamed or deleted afterwards and the round still
  // exports what it was played on.
  it("reads a locked round's frozen course name", () => {
    const h = roundHeading({
      round: 1, tRounds: [tRound(1)], courses: [],
      roundLocks: { 1: { locked: true, course_name: "Quail Ridge", hole_pars: Array(18).fill(4) } },
    });
    expect(h.course).toBe("Quail Ridge - White");
    expect(h.scored).toBe(true);
  });
});

describe("roundBlock", () => {
  it("is four header rows, a line per player and a blank", () => {
    const rows = block();
    expect(rows).toHaveLength(4 + 2 + 1);
    expect(rows.every(r => r.length === ALL_SCORES_WIDTH)).toBe(true);
    expect(rows[rows.length - 1].every(c => c === "")).toBe(true);
  });

  // The geometry, read off the workbook. If any of this moves, a paste into a
  // copy of the sheet lands in the wrong columns.
  it("puts the workbook's headings in the workbook's columns", () => {
    const [head, cols, si, par] = block();
    expect(head[COL.player]).toBe("Round 1");
    expect(head[COL.label]).toBe("Kaufman - White");
    expect(head[COL.total]).toBe("70.8");
    expect(head[COL.net]).toBe("134");
    expect(cols[COL.player]).toBe("GROSS");
    expect(cols[netCol(COL.player)]).toBe("NET");
    expect(cols[COL.firstHole]).toBe("1");
    expect(cols[COL.firstHole + 17]).toBe("18");
    expect([cols[COL.out], cols[COL.in], cols[COL.total], cols[COL.net], cols[COL.esc]])
      .toEqual(["OUT", "IN", "TOTAL", "NET", "ESC"]);
    expect(si[COL.label]).toBe("Handi");
    expect(si[COL.firstHole]).toBe("1");
    expect(par[COL.label]).toBe("Par");
    expect([par[COL.out], par[COL.in], par[COL.total]]).toEqual(["36", "36", "72"]);
    expect(par[COL.player]).toBe("Player");
    expect(par[COL.hcp]).toBe("H");
  });

  // The net half is the gross half shifted 28 columns right, and every write
  // to it goes through netCol so the two cannot drift.
  it("mirrors the heading into the net block", () => {
    const [head, , , par] = block();
    expect(head[netCol(COL.player)]).toBe("Round 1");
    expect(head[netCol(COL.label)]).toBe("Kaufman - White");
    expect(head[netCol(COL.total)]).toBe("70.8");
    expect(par[netCol(COL.label)]).toBe("Par");
    expect(netCol(COL.player)).toBe(NET_OFFSET);
  });

  it("writes each man's card on both halves", () => {
    const row = lineFor(block(), "Jensen");
    // index 7 off White (134/70.8, par 72) → CH 7
    expect(row[COL.hcp]).toBe("7");
    expect(row[netCol(COL.hcp)]).toBe("7");
    expect(row[netCol(COL.player)]).toBe("Jensen");
    expect(row[COL.firstHole]).toBe("5");
    expect(row[netCol(COL.firstHole)]).toBe("4");        // a stroke on SI 1
    expect(row[netCol(COL.firstHole) + 6]).toBe("4");    // and on SI 7, the last of them
    expect(row[netCol(COL.firstHole) + 7]).toBe("5");    // not on SI 8
    expect([row[COL.out], row[COL.in], row[COL.total]]).toEqual(["45", "45", "90"]);
    expect(row[COL.net]).toBe("83");
    expect([row[netCol(COL.out)], row[netCol(COL.in)], row[netCol(COL.total)]])
      .toEqual(["38", "45", "83"]);
  });

  // The workbook's ESC column is its TOTAL repeated — Equitable Stroke Control
  // was never actually applied. Carried across as what it is, so everything
  // after it stays in the column the workbook put it in.
  it("repeats the total into ESC, as the workbook does", () => {
    const row = lineFor(block(), "Jensen");
    expect(row[COL.esc]).toBe(row[COL.total]);
  });

  // The three side-game columns and the analytics block have no source on the
  // Event tab. Left empty rather than closed up, so nothing after them shifts.
  it("leaves the skins column and everything past the net block empty", () => {
    block().forEach(r => {
      expect(r[COL.skins]).toBe("");
      expect(r[netCol(COL.skins)]).toBe("");
      for (let c = 54; c < r.length; c++) expect(r[c]).toBe("");
    });
  });

  // A round nobody has set up still has a real roster on real handicaps. It
  // prints, with nothing to score against — which is a truthful empty block
  // rather than a missing one.
  it("still lists the field for a round with no course", () => {
    const rows = block({ tRounds: [tRound(1, { course_id: null })], courses: [] });
    const row = lineFor(rows, "Jensen");
    expect(row[COL.player]).toBe("Jensen");
    expect(row[COL.firstHole]).toBe("");
    expect(row[COL.total]).toBe("");
    expect(rows[3][COL.firstHole]).toBe("");   // no par row either
  });

  // A round lock is the one door stroke allocation goes through, and it must
  // close for an export exactly as it does for a screen.
  it("takes a locked round's frozen handicap over the live index", () => {
    const rows = block({
      roundLocks: {
        1: {
          locked: true, course_id: "c1", course_name: "Kaufman",
          hole_pars: Array(18).fill(4),
          hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1),
          players: { p1: { ch: 2 } },
        },
      },
    });
    const row = lineFor(rows, "Jensen");
    expect(row[COL.hcp]).toBe("2");
    expect(row[netCol(COL.firstHole) + 2]).toBe("5");   // third stroke no longer falls
  });

  it("applies a per-round course-handicap override to an open round", () => {
    const rows = block({ chOverrides: { 1: { p1: 12 } } });
    expect(lineFor(rows, "Jensen")[COL.hcp]).toBe("12");
  });

  // A man on a different tee plays off a different handicap, and the H column
  // is what a spreadsheet would re-derive the net card from.
  it("uses the tee a man actually played", () => {
    const rows = block({
      courses: [course({
        tee_boxes: [
          { name: "White", slope: 134, rating: 70.8, par: 72 },
          { name: "Gold", slope: 113, rating: 68, par: 72 },
        ],
      })],
      teeAssignments: { 1: { p1: "Gold" } },
    });
    expect(lineFor(rows, "Jensen")[COL.hcp]).toBe("3");     // 7 × 113/113 + (68-72)
    expect(lineFor(rows, "Telly")[COL.hcp]).toBe("7");
  });

  it("names a man with no roster row by his id rather than a blank", () => {
    const rows = block({ players: [{ player_id: "p1", team: "A" }] });
    expect(rows[4][COL.player]).toBe("p1");
  });
});

describe("allScoresRows", () => {
  it("stacks every round in order", () => {
    const rows = allScoresRows({
      rounds: [1, 2],
      ...ctx({ tRounds: [tRound(1), tRound(2)], holeData: { p1_1: card(5), p1_2: card(4) } }),
    });
    const heads = rows.filter(r => /^Round \d+$/.test(r[COL.player])).map(r => r[COL.player]);
    expect(heads).toEqual(["Round 1", "Round 2"]);
    expect(rows).toHaveLength(2 * (4 + 2 + 1));
  });

  it("produces a CSV whose every line has the same column count", () => {
    const csv = scoresCsv({ rounds: [1], ...ctx() });
    const lines = csv.trimEnd().split("\r\n");
    expect(lines).toHaveLength(7);
    lines.forEach(l => expect(l.split(",")).toHaveLength(ALL_SCORES_WIDTH));
    expect(lines[0].startsWith("Round 1,")).toBe(true);
  });

  it("asked for no rounds, says nothing rather than throwing", () => {
    expect(allScoresRows({ rounds: [], ...ctx() })).toEqual([]);
  });
});

describe("exportFilename", () => {
  it("says which tournament and which round", () => {
    expect(exportFilename({ tournamentName: "The Bourbon Cup", round: 2 }))
      .toBe("The Bourbon Cup - Round 2.csv");
    expect(exportFilename({ tournamentName: "The Bourbon Cup" }))
      .toBe("The Bourbon Cup - All Scores.csv");
  });
  // A tournament name is a free-text field, and a slash or a colon in it is a
  // file the director's machine refuses to save.
  it("takes the characters a file system objects to back out", () => {
    expect(exportFilename({ tournamentName: "Bourbon Cup: 2025/26", round: 1 }))
      .toBe("Bourbon Cup 2025 26 - Round 1.csv");
  });
  it("falls back to a name rather than producing a bare .csv", () => {
    expect(exportFilename({ tournamentName: "   ", round: 1 })).toBe("Bourbon Cup - Round 1.csv");
    expect(exportFilename({})).toBe("Bourbon Cup - All Scores.csv");
  });
});

describe("the geometry constants", () => {
  // These are facts about somebody else's spreadsheet, so they are pinned
  // rather than derived. A change to any of them is a change to the format.
  it("is the workbook's", () => {
    expect(COL).toEqual({
      player: 0, hcp: 1, skins: 2, label: 3, firstHole: 4,
      out: 22, in: 23, total: 24, net: 25, esc: 26,
    });
    expect(NET_OFFSET).toBe(28);
    expect(ALL_SCORES_WIDTH).toBe(54);
    expect(HOLES).toBe(18);
  });
});
