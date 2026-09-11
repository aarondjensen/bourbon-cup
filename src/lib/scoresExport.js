// ══════════════════════════════════════════════════════════════════
//  scoresExport — the cards, in the shape the spreadsheet drew them.
// ══════════════════════════════════════════════════════════════════
//
// Admin → Event → Export. One button a round, plus one for all of them, and
// each writes a CSV of everybody's card laid out like the ALL SCORES tab of
// the Google Sheets workbook the cup ran off before this app existed
// (`data/historical sheets/<year>/Bourbon Cup <year> - Scoring - ALL SCORES`).
//
// ── Why mirror a spreadsheet ──────────────────────────────────────
// This is the backup plan, and a backup is only a backup if it lands
// somewhere the tournament can actually be finished. If Firestore is
// unreachable on the Saturday, the answer is a laptop, a phone hotspot and
// the sheet everybody already knows how to read — so the file has to paste
// into Google Sheets and be recognisable on arrival, not merely be complete.
//
// That is the whole reason for the layout below. Nobody would design 54
// columns with a 27-wide gross block, a spacer and a mirrored net block. It
// is copied because being copied is the point: the columns land where a man
// looking for them expects them, and the sums can be re-added in place.
//
// ── What is in it, and what is deliberately not ───────────────────
// Scores. Every player's gross card hole by hole, the course handicap each
// one played off, and the net card that falls out of the two — plus the par
// and stroke-index rows the net card is derived from, and the course, rating
// and slope the handicaps came from. That is everything needed to rebuild the
// arithmetic from scratch in a spreadsheet.
//
// The workbook's tab carried three more things and none of them are here:
//
//   SK G / SK N / SK C   skins, and the CTP and LP5 rows under them. Side
//                        games, settled between players on the Betting tab,
//                        and nothing the Event tab is handed can answer them.
//                        An empty "CTP" row would read as "nobody won one".
//   CHECK                the tab's cross-check against the four group-card
//                        tabs. There is one set of cards here and this file
//                        is printed off it, so the column has nothing to
//                        disagree with.
//   Net Pars / Royale /  the analytics block. Derived, field-relative, and
//   the birdie counts    recomputable in the spreadsheet from what IS here.
//
// The columns those occupied are left empty rather than closed up, so
// everything after them stays where the workbook put it.
//
// ── Pure ──────────────────────────────────────────────────────────
// No Firebase, no React, no DOM. It takes the same maps App.jsx already holds
// and hands back rows of strings; lib/fileSave gets them onto a phone. That is
// what lets scoresExport.fidelity.test.js rebuild 2025's tab out of the
// imported documents and diff it against the real one, cell for cell.
import {
  getRoundCourseCtx, getRoundCH, buildStrokeMap, resolveTeeSpec,
} from "../scoring";

export const HOLES = 18;

// ── The geometry ──────────────────────────────────────────────────
// Read off the workbook, and the reason it is a table of named constants
// rather than arithmetic at each use: every one of these is a fact about a
// spreadsheet somebody else laid out, so there is nothing to derive them from
// and a number written inline would look like a choice.
//
// The gross block runs 0–26, column 27 is the gutter, and the net block is
// the same shape shifted 28 right. 53 is the net block's last column — the
// workbook's CHECK — which nothing here fills but the round's slope, on the
// header row, sits in.
export const COL = {
  player: 0,
  hcp: 1,       // "H" — the course handicap the round was played off
  skins: 2,     // SK G / SK N in the workbook; empty here
  label: 3,     // the row's own name: Hole / Handi / Par
  firstHole: 4, // 4..21 are holes 1..18
  out: 22,
  in: 23,
  total: 24,    // and, on the header row, the course rating
  net: 25,      // and, on the header row, the slope
  esc: 26,
};
export const NET_OFFSET = 28;
export const ALL_SCORES_WIDTH = 54;

// The same column in the net block. Every net-side write goes through this
// rather than through a second table, so the two halves cannot drift apart.
export const netCol = (col) => col + NET_OFFSET;

const emptyRow = () => Array(ALL_SCORES_WIDTH).fill("");

// A number for a cell. `null`/`undefined` is an absence and stays blank —
// never a zero, which in a score column is a hole somebody shot nothing on.
const num = (n) => (n == null || !Number.isFinite(Number(n)) ? "" : String(Number(n)));

// ── CSV ───────────────────────────────────────────────────────────
// Quoted only when it has to be, so the file stays readable in a text editor.
// A course name with a comma in it is the case that makes this necessary —
// "The Nightmare - Blue/White" is fine, "Forest Dunes, ii/iii" is not.
export const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// CRLF, because that is what RFC 4180 says and what Excel expects; Sheets
// takes either. The trailing newline keeps the last row from being a special
// case for anything that reads the file line by line.
export const toCsv = (rows) =>
  (rows || []).map(r => (r || []).map(csvCell).join(",")).join("\r\n") + "\r\n";

// ── Who is on the export, and in what order ───────────────────────
// Team A, then team B, then anybody unassigned — the Players tab's own
// grouping, and the workbook's. Roster order within a team, because that is
// the order the director put them in and there is no better one.
//
// The BORROWED BALL is included, unlike every screen that shows the roster.
// 2020 went out a man short and played against a compiled card; it is not a
// person, but it is a card, and this file is a file of cards. Leaving it out
// would export a round that cannot be re-scored. See lib/players.
export const exportRoster = (players) => {
  const of = (team) => (players || []).filter(p => p?.player_id && p.team === team);
  const rest = (players || []).filter(p => p?.player_id && p.team !== "A" && p.team !== "B");
  return [...of("A"), ...of("B"), ...rest];
};

// ── A round's setting ─────────────────────────────────────────────
// Resolved through the app's own accessors, so a LOCKED round exports the
// frozen snapshot and an open one exports live data — the same rule every
// other screen follows. A director exporting 2019 gets what 2019 was played
// off, not what its course document says today.
export const roundHeading = ({ round, tRounds, courses, roundLocks }) => {
  const { lock, tr, course } = getRoundCourseCtx({ roundLocks, round, tRounds, courses });
  const tee = tr?.tee_box || null;
  const name = lock?.course_name || course?.name || "";
  // Blank rather than the neutral 113/72 that resolveTeeSpec falls back to.
  // A round the director has not booked a course for yet has no rating, and
  // printing the fallback would put a plausible number in a column somebody
  // would go on to recompute handicaps from.
  const spec = course ? resolveTeeSpec(course, tee) : null;
  return {
    // "Kaufman - White" — the workbook's own form. The tee matters: it is
    // half of what the rating and slope beside it describe.
    course: name && tee ? `${name} - ${tee}` : name,
    rating: spec ? spec.rating : null,
    slope: spec ? spec.slope : null,
    // A round with neither is one nobody has set up. Its block still prints —
    // the roster and their handicaps are real — but with no par or stroke
    // index to score against.
    scored: !!(course || lock),
  };
};

// ── One player's line ─────────────────────────────────────────────
// Gross straight off the cards; net is gross less the strokes that fall on
// the hole, allocated by buildStrokeMap — the same function the scoring
// screens, the leaderboard and every stroke dot in the app go through.
//
// OUT and IN add whatever has been posted, so a round in progress still
// exports a running nine. TOTAL, NET and ESC appear only on a COMPLETE card,
// which is the workbook's own rule (`if(count(E5:V5)=18, …, "")`) and the
// honest one: a total under a card with four holes missing is a number that
// looks finished and is not.
export const playerScores = ({ card, ch, holeHcps }) => {
  const strokes = buildStrokeMap(Number(ch) || 0, holeHcps || Array(HOLES).fill(9));
  const gross = [];
  const net = [];
  for (let h = 0; h < HOLES; h++) {
    const raw = (card || {})[h];
    const g = raw != null && Number(raw) > 0 ? Number(raw) : null;
    gross.push(g);
    net.push(g == null ? null : g - (strokes[h] || 0));
  }
  const sum = (arr, from, to) => {
    const vals = arr.slice(from, to).filter(v => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const complete = gross.every(g => g != null);
  return {
    gross,
    net,
    grossOut: sum(gross, 0, 9),
    grossIn: sum(gross, 9, 18),
    grossTotal: complete ? sum(gross, 0, 18) : null,
    netOut: sum(net, 0, 9),
    netIn: sum(net, 9, 18),
    netTotal: complete ? sum(net, 0, 18) : null,
    complete,
  };
};

// ── One round's block ─────────────────────────────────────────────
// Four header rows, a line per player, and a blank one to separate it from
// the next round — exactly the workbook's stride.
export const roundBlock = ({
  round, players, holeData, courses, tRounds, roundLocks, chOverrides, teeAssignments,
}) => {
  const { tr, course, holePars, holeHcps } =
    getRoundCourseCtx({ roundLocks, round, tRounds, courses });
  const heading = roundHeading({ round, tRounds, courses, roundLocks });
  const roster = exportRoster(players);
  const rows = [];

  // Row 1 — the round, its course and the tee's rating and slope, said once
  // on each side. Both halves are labelled because the two blocks are wide
  // enough that the net side scrolls clear of the gross side's heading.
  const head = emptyRow();
  head[COL.player] = `Round ${round}`;
  head[COL.label] = heading.course;
  head[COL.total] = num(heading.rating);
  head[COL.net] = num(heading.slope);
  head[netCol(COL.player)] = `Round ${round}`;
  head[netCol(COL.label)] = heading.course;
  head[netCol(COL.total)] = num(heading.rating);
  head[netCol(COL.net)] = num(heading.slope);
  rows.push(head);

  // Row 2 — which half is which, and the column headings.
  const cols = emptyRow();
  cols[COL.player] = "GROSS";
  cols[COL.label] = "Hole";
  cols[netCol(COL.player)] = "NET";
  cols[netCol(COL.label)] = "Hole";
  for (let h = 0; h < HOLES; h++) {
    cols[COL.firstHole + h] = String(h + 1);
    cols[netCol(COL.firstHole) + h] = String(h + 1);
  }
  cols[COL.out] = "OUT";
  cols[COL.in] = "IN";
  cols[COL.total] = "TOTAL";
  cols[COL.net] = "NET";
  cols[COL.esc] = "ESC";
  cols[netCol(COL.out)] = "OUT";
  cols[netCol(COL.in)] = "IN";
  cols[netCol(COL.total)] = "TOTAL";
  rows.push(cols);

  // Row 3 — the stroke index. This is the row that makes the net card
  // checkable: without it, "why does he get a shot here" has no answer in
  // the file and the whole export is a set of numbers to be taken on trust.
  const si = emptyRow();
  si[COL.label] = "Handi";
  si[netCol(COL.label)] = "Handi";
  if (heading.scored) {
    for (let h = 0; h < HOLES; h++) {
      si[COL.firstHole + h] = num(holeHcps?.[h]);
      si[netCol(COL.firstHole) + h] = num(holeHcps?.[h]);
    }
  }
  rows.push(si);

  // Row 4 — par, and the headings for the two columns to its left.
  const par = emptyRow();
  par[COL.player] = "Player";
  par[COL.hcp] = "H";
  par[COL.label] = "Par";
  par[netCol(COL.player)] = "Player";
  par[netCol(COL.hcp)] = "H";
  par[netCol(COL.label)] = "Par";
  if (heading.scored) {
    for (let h = 0; h < HOLES; h++) {
      par[COL.firstHole + h] = num(holePars?.[h]);
      par[netCol(COL.firstHole) + h] = num(holePars?.[h]);
    }
    const parOut = (holePars || []).slice(0, 9).reduce((a, b) => a + (Number(b) || 0), 0);
    const parIn = (holePars || []).slice(9, 18).reduce((a, b) => a + (Number(b) || 0), 0);
    par[COL.out] = num(parOut);
    par[COL.in] = num(parIn);
    par[COL.total] = num(parOut + parIn);
    par[netCol(COL.out)] = num(parOut);
    par[netCol(COL.in)] = num(parIn);
    par[netCol(COL.total)] = num(parOut + parIn);
  }
  rows.push(par);

  roster.forEach((p) => {
    const pid = p.player_id;
    // The one door for stroke allocation, so an exported round can no more
    // drift than a rendered one: locked rounds answer to their snapshot,
    // open ones to the live index, per-round CH overrides in between.
    const ch = getRoundCH({
      roundLocks, round, pid, players, course, chOverrides, teeAssignments,
      roundTee: tr?.tee_box,
    });
    const s = playerScores({
      card: holeData?.[`${pid}_${round}`],
      ch,
      holeHcps: heading.scored ? holeHcps : null,
    });
    const row = emptyRow();
    // The name, not the id. This file is read by a man with a laptop on a
    // Saturday, and `bc_player_1773595975465` is not who anybody is.
    row[COL.player] = p.name || pid;
    row[COL.hcp] = num(ch);
    row[netCol(COL.player)] = p.name || pid;
    row[netCol(COL.hcp)] = num(ch);
    if (heading.scored) {
      for (let h = 0; h < HOLES; h++) {
        row[COL.firstHole + h] = num(s.gross[h]);
        row[netCol(COL.firstHole) + h] = num(s.net[h]);
      }
      row[COL.out] = num(s.grossOut);
      row[COL.in] = num(s.grossIn);
      row[COL.total] = num(s.grossTotal);
      row[COL.net] = num(s.netTotal);
      // The workbook's ESC column is its TOTAL column repeated (`AA5 = Y5`) —
      // Equitable Stroke Control was never actually applied. Carried across as
      // what it is rather than dropped, so the columns after it stay put.
      row[COL.esc] = num(s.grossTotal);
      row[netCol(COL.out)] = num(s.netOut);
      row[netCol(COL.in)] = num(s.netIn);
      row[netCol(COL.total)] = num(s.netTotal);
    }
    rows.push(row);
  });

  rows.push(emptyRow());
  return rows;
};

// Every round, stacked — the ALL SCORES tab itself.
export const allScoresRows = ({ rounds, ...ctx }) =>
  (rounds || []).flatMap(round => roundBlock({ round, ...ctx }));

export const scoresCsv = (args) => toCsv(allScoresRows(args));

// ── The file's name ───────────────────────────────────────────────
// It is going to land in a downloads folder beside last year's, so it says
// which tournament and which round without being opened. Anything a file
// system objects to becomes a space, and runs of spaces collapse — a
// tournament called "The Bourbon Cup: 2025/26" should not produce a file
// nobody can save.
export const exportFilename = ({ tournamentName, round = null }) => {
  const base = String(tournamentName || "Bourbon Cup").trim() || "Bourbon Cup";
  const what = round == null ? "All Scores" : `Round ${round}`;
  return `${`${base} - ${what}`.replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim()}.csv`;
};
