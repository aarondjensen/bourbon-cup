#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
//  Bourbon Cup — EDITIONS extractor.
// ══════════════════════════════════════════════════════════════════
//
// The other three phases build the STAT layer: atomic facts about players and
// holes, for the record book. This one builds the TOURNAMENT layer — the setup
// a year was played under, in the shape the app runs a tournament in:
//
//   teams · roster · courses · round setup · the draw
//
// Its output (`data/bourbon-cup-editions.json`) is what turns 2016–2024 into
// editions somebody can switch to in the app. Scores are NOT copied into it:
// they already exist, hole by hole, in bourbon-cup-backbone.json, and
// duplicating eleven thousand rows into a second file only creates a second
// answer that can disagree with the first. src/lib/historyImport.js reads both.
//
//   node pipeline/editions.mjs                  # every year under data/historical sheets
//   node pipeline/editions.mjs 2016 2019        # just those
//
// ── Where each fact comes from ────────────────────────────────────
// The Master Input tab is the tournament's own setup sheet, and it holds
// almost all of it: both team names, every player with their team and index,
// each round's course and game, that course's par/rating/slope, and the points
// table saying what a match in each game was worth. That is read here rather
// than re-typed, so an edition says what the sheet says.
//
// The draw is the exception, and it comes from two places:
//
//   match-play rounds  bourbon-cup-matchfacts.json, which Phase 2 already
//                      resolved off the scorecards — every player with the
//                      side he faced. Four rounds in ten years have no facts
//                      (the dots, Tilt and Stableford openers), because those
//                      games record no match status to resolve.
//   those four rounds  the scorecards themselves. A card IS the match in a
//                      two-man game: four players, two a side.
//
// Round 4 needs neither. Team Best Ball is the whole side against the whole
// side, so the draw is the roster split by team — there is nothing to look up.
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildResolver, displayName, PLAYERS } from "./players.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "data");
const SHEETS_DIR = join(DATA_DIR, "historical sheets");

const resolve = buildResolver();
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const num = (v) => { const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : null; };

function parseCSV(t) {
  const rows = []; let c = "", q = false, row = [];
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(c); c = ""; }
    else if (ch === "\n") { row.push(c); rows.push(row); row = []; c = ""; }
    else if (ch !== "\r") c += ch;
  }
  if (c.length || row.length) { row.push(c); rows.push(row); }
  return rows;
}
const sheet = (dir, part) => {
  const f = readdirSync(dir).find((x) => norm(x).includes(norm(part)) && x.endsWith(".csv"));
  return f ? parseCSV(readFileSync(join(dir, f), "utf8")) : null;
};

// ── Format names ──────────────────────────────────────────────────
// The sheet's game name → the app's format id. Written against the app's
// FORMATS catalog (src/constants.js) rather than against the sheet, because
// the app is what has to run the round afterwards.
//
// Two games have no exact counterpart and are mapped to the nearest one that
// scores the same shape. Both are recorded on the round as `source_format` so
// nothing has to guess later what was really played:
//
//   Dirty Dozen (2023 R1)   a dots game. Double Dot is the app's dots format.
//   8-Man Top 4 Net (2017 R4)  Team Best Ball counting the best 4 nets, which
//                           is what the name says it is.
const FORMAT_MAP = {
  singles: "singles",
  "2man_best_ball": "best_ball",
  "2man_hi_lo": "double_dot",
  double_dot: "double_dot",
  dirty_dozen: "double_dot",
  "2man_scramble": "scramble",
  "2man_tilt": "tilt",
  "2man_stableford": "stableford",
  pinehurst: "pinehurst",
  shamble: "shamble",
  team_best_ball: "team_best_ball",
  "8man_top4net": "team_best_ball",
};
// How many balls a side plays — used to check a parsed draw is the right shape.
const PER_SIDE = {
  singles: 1, best_ball: 2, double_dot: 2, scramble: 2, tilt: 2,
  stableford: 2, pinehurst: 2, shamble: 2, team_best_ball: null,
};

// The sheet's game name, normalized, → the same keys the backbone uses. Kept
// here (rather than imported from backbone.mjs) because that file computes it
// inline while parsing; this is the same rule stated once as a table.
const GAME_KEY = (label) => {
  const n = norm(label);
  if (!n) return null;
  if (n.includes("dozen")) return "dirty_dozen";
  if (n.includes("doubledot")) return "double_dot";
  if (n.includes("stableford")) return "2man_stableford";
  if (n.includes("singles")) return "singles";
  if (n.includes("scramble")) return "2man_scramble";
  if (n.includes("hilo")) return "2man_hi_lo";
  if (n.includes("pinehurst")) return "pinehurst";
  if (n.includes("shamble")) return "shamble";
  if (n.includes("tilt")) return "2man_tilt";
  if (n.includes("top4") || n.includes("8man")) return "8man_top4net";
  if (n.includes("bestball")) return n.includes("2man") ? "2man_best_ball" : "team_best_ball";
  return null;
};

// ── The points table ──────────────────────────────────────────────
// "Game Scoring / Points Awarded" on the Master Input: what a match in each
// game is worth, front / back / overall. That IS the app's Nassau, field for
// field, so it is read rather than assumed — the cup went from 3 points a
// match to 4 in 2020, and a year scored on the wrong one is a different
// tournament.
//
// Team Best Ball's row is not a Nassau at all ("1 Pt/Hole Front, 2 Pt/Hole
// Back"): its two numbers are points PER HOLE, which the app stores
// separately. `overall` reads "NA" there, which is how the two are told apart.
function readPointsTable(rows) {
  const out = {};
  let hdr = -1, col = 0;
  rows.forEach((r, i) => {
    const c = r.findIndex((x) => norm(x) === "gamename");
    if (c >= 0 && hdr < 0) { hdr = i; col = c; }
  });
  if (hdr < 0) return out;
  for (let i = hdr + 1; i < rows.length; i++) {
    const [name, front, back, overall] = rows[i].slice(col, col + 4);
    const key = GAME_KEY(name);
    if (!key) continue;
    const f = num(front), b = num(back), o = num(overall);
    if (f == null && b == null && o == null) continue;
    // "NA" in the overall column means these are per-hole points, not a Nassau.
    const perHole = o == null && norm(overall).includes("na");
    out[key] = perHole
      ? { hole_points: { front: f ?? 1, back: b ?? 1 } }
      : { nassau: { front: f ?? 0, back: b ?? 0, overall: o ?? 0 } };
  }
  return out;
}

// ── The Course List tab ───────────────────────────────────────────
// Present in six of the ten years, and the only place those years record a
// course rating — the Master Input in 2016, 2018 and 2019 carries slope alone.
// Nothing is SCORED off a rating here (the recorded course handicap is stored,
// see src/lib/historyImport.js), so this is what the course page shows rather
// than an input to a result. Rows are `name, rating, slope, distance, …`.
function readCourseList(dir) {
  const rows = sheet(dir, "Course_List");
  const out = new Map();
  if (!rows) return out;
  for (const r of rows) {
    const name = (r[0] || "").trim();
    const rating = num(r[1]), slope = num(r[2]);
    if (!name || rating == null || slope == null) continue;
    if (!out.has(norm(name))) out.set(norm(name), { rating, slope });
  }
  return out;
}

// ── Master Input, standard layout (2016, 2018–2025) ───────────────
// Anchored on the "Teams, Players, Courses, & Handis" row, which carries the
// four course/game pairs at a stride of two from column 4. Everything else is
// found relative to it, so the extra columns years differ by (an Average block
// here, a Live column there) move nothing.
function readMasterStandard(rows) {
  const anchor = rows.findIndex((r) => norm(r[0]).includes("teamsplayerscourses"));
  if (anchor < 0) return null;

  const rounds = {};
  for (let rd = 1; rd <= 4; rd++) {
    const c = (rows[anchor][4 + (rd - 1) * 2] || "").trim();
    const g = (rows[anchor][5 + (rd - 1) * 2] || "").trim();
    if (c || g) rounds[rd] = { course: c, game: GAME_KEY(g), game_label: g };
  }

  // Par / Rating / Slope sit in the rows just under the anchor, each as a
  // label/value pair in the same two-column stride. Which of the three a year
  // bothered to fill in varies (2016 has slope alone), so they are matched by
  // their label rather than by row offset.
  for (let i = anchor + 1; i < Math.min(rows.length, anchor + 6); i++) {
    for (let rd = 1; rd <= 4; rd++) {
      const label = norm(rows[i][4 + (rd - 1) * 2]);
      const value = num(rows[i][5 + (rd - 1) * 2]);
      if (value == null || !rounds[rd]) continue;
      if (label === "coursepar") rounds[rd].par = value;
      else if (label === "courserating") rounds[rd].rating = value;
      else if (label === "courseslope") rounds[rd].slope = value;
    }
  }

  // Team names are marked in the sheet by the "<-- Team Nm" note beside them.
  // Sheet order decides which is Team A: for 2025 that gives Mash Brothers,
  // which is the team the live edition already calls A.
  const teams = rows
    .filter((r) => r.some((c) => norm(c).includes("teamnm")))
    .map((r) => (r[0] || "").trim())
    .filter(Boolean);

  // A player row is one whose first cell resolves to a known golfer AND whose
  // second cell names one of this year's teams. The second half matters: the
  // sheet repeats player names further down in the handicap-working columns,
  // and those rows carry no team.
  const players = [];
  for (const r of rows) {
    const pid = resolve(r[0]);
    if (!pid) continue;
    const team = (r[1] || "").trim();
    if (!team || !teams.some((t) => norm(t) === norm(team))) continue;
    if (players.some((p) => p.id === pid)) continue;
    // The index only. The course handicap a player actually played each round
    // off is taken from the backbone (which reads it off the cards), not from
    // this sheet — see the note on `ch` in buildYear.
    players.push({
      id: pid,
      sheet_name: (r[0] || "").trim(),
      team: norm(team) === norm(teams[0]) ? "A" : "B",
      index: num(r[2]),
    });
  }

  return { rounds, teams, players, points: readPointsTable(rows) };
}

// ── Master Input, 2017 ────────────────────────────────────────────
// 2017's sheet predates the layout every other year uses: no anchor row, no
// team-name markers, no points table. It is a plain table — player, team,
// index, then one course-handicap column per round — with a course/rating/
// slope list beside it. Read on its own terms rather than bent into the other
// reader, which would mean four fallbacks in a function that is otherwise
// exact.
function readMaster2017(rows) {
  const hdr = rows.findIndex((r) => norm(r[0]) === "player" && norm(r[1]).includes("team"));
  if (hdr < 0) return null;

  const rounds = {};
  for (let rd = 1; rd <= 4; rd++) {
    const c = (rows[hdr][3 + (rd - 1)] || "").trim();
    if (c) rounds[rd] = { course: c, game: null, game_label: "" };
  }
  // The slope row sits directly above the header, one column per round.
  const slopeRow = rows.slice(0, hdr).reverse().find((r) => norm(r[2]).includes("courseslope"));
  if (slopeRow) for (let rd = 1; rd <= 4; rd++) if (rounds[rd]) rounds[rd].slope = num(slopeRow[3 + (rd - 1)]);

  // The course list to the right: name / rating / slope / distance. Ratings
  // for the four played courses come from here, matched on the same name the
  // round column uses.
  const rated = new Map();
  for (const r of rows) {
    const name = (r[8] || "").trim();
    const rating = num(r[9]);
    if (name && rating != null) rated.set(norm(name), { rating, slope: num(r[10]) });
  }
  for (let rd = 1; rd <= 4; rd++) {
    const hit = rounds[rd] && rated.get(norm(rounds[rd].course));
    if (hit) { rounds[rd].rating = hit.rating; rounds[rd].slope = rounds[rd].slope ?? hit.slope; }
  }

  const teams = [];
  const players = [];
  for (let i = hdr + 1; i < rows.length; i++) {
    const r = rows[i];
    const pid = resolve(r[0]);
    const team = (r[1] || "").trim();
    if (!pid || !team) continue;
    if (players.some((p) => p.id === pid)) continue;
    if (!teams.some((t) => norm(t) === norm(team))) teams.push(team);
    players.push({
      id: pid,
      sheet_name: (r[0] || "").trim(),
      team,   // resolved to A/B below, once both names are known
      index: num(r[2]),
    });
  }
  for (const p of players) p.team = norm(p.team) === norm(teams[0]) ? "A" : "B";

  return { rounds, teams, players, points: {} };
}

// ── The draw ──────────────────────────────────────────────────────
// From the match facts. Each fact names the SIDE that player faced, so a match
// is recovered by reading the far side's own facts back: whoever they say they
// were playing is the near side. Recovering it that way (rather than pairing
// players off by position on a card) means the draw comes from the same
// resolution Phase 2 already validated against the scorecards.
//
// Reading it back matters, and 2016 is why. With fifteen players that year's
// Singles round could not be drawn 1v1 all the way down, so TJSC played TWO
// singles matches. Grouping players by the side they faced merges those into
// one 2v1 — Ben T and Paul W both faced TJSC, so both land in the same bucket.
// Going through TJSC's own facts keeps them apart, because he names one
// opponent per match.
// The other half of the borrowed ball. When a fact's opponent resolves to
// nobody on the roster, the man opposite was playing somebody else's card —
// and the card says whose: it carries that player's row TWICE, once for each
// match it was counted in. 2020's Singles round is the only place this
// happens, where Andy H's card played both Julius P and Joe O.
//
// Without this, Joe O has no singles match in 2020 and three points go missing
// from a round the app would otherwise show as complete.
function borrowedOpponent(dir, round, player, teamOf) {
  for (let g = 1; g <= 8; g++) {
    const rows = sheet(dir, `R${round}_G${g}`);
    if (!rows) continue;
    const named = rows.map((r) => resolve(r[0])).filter(Boolean);
    if (!named.includes(player)) continue;
    const counts = new Map();
    for (const p of named) counts.set(p, (counts.get(p) || 0) + 1);
    const twice = [...counts.entries()]
      .filter(([p, n]) => n > 1 && p !== player && teamOf(p) && teamOf(p) !== teamOf(player))
      .map(([p]) => p);
    if (twice.length === 1) return twice;
  }
  return null;
}

function matchesFromFacts(facts, teamOf, roster, onBorrowed) {
  const key = (ids) => [...ids].sort().join("+");
  // Sides come out of the facts as names; anything not on the roster is
  // dropped. That is 2020's "ghost" — the borrowed ball a short field played
  // against, which is a scoring device rather than a person and has no roster
  // row to point at.
  const side = (s) => String(s || "").split("+").filter((p) => p && roster.has(p));
  const byPlayer = new Map();
  for (const f of facts) {
    if (!byPlayer.has(f.player)) byPlayer.set(f.player, []);
    byPlayer.get(f.player).push(side(f.opponent));
  }

  const seen = new Set();
  const out = [];
  for (const f of facts) {
    const far = side(f.opponent).length ? side(f.opponent) : (onBorrowed?.(f.player) || []);
    if (!far.length) continue;
    // The near side is whichever of the far side's own opponent-sides names
    // this player. Falls back to him alone when the far side recorded nothing
    // (a card that was never posted).
    const near = far.flatMap((o) => byPlayer.get(o) || [])
      .find((s) => s.includes(f.player)) || [f.player];
    const id = [key(near), key(far)].sort().join("|");
    if (seen.has(id)) continue;
    seen.add(id);
    // A match is stored as A-side vs B-side, never as near vs far.
    const aFirst = teamOf(near[0]) === "A";
    out.push({ teamA: aFirst ? near : far, teamB: aFirst ? far : near });
  }
  return out;
}

// A card in a two-man game IS the match: four players, two a side. Used for
// the four rounds whose game records no match status (2022 Tilt, 2023 Dirty
// Dozen, 2024 Stableford, 2025 Double Dot), where there are no facts to read.
function matchesFromCards(dir, round, teamOf) {
  const out = [];
  for (let g = 1; g <= 8; g++) {
    const rows = sheet(dir, `R${round}_G${g}`);
    if (!rows) continue;
    const seen = new Set();
    const A = [], B = [];
    for (const r of rows) {
      const pid = resolve(r[0]);
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      (teamOf(pid) === "A" ? A : B).push(pid);
    }
    if (A.length && B.length) out.push({ teamA: A, teamB: B });
  }
  return out;
}

// ── The ghost ─────────────────────────────────────────────────────
// 2020 went out a man short and played a borrowed ball. It is a scoring device
// rather than a person, so Phase 1 drops it from the fact layer on purpose —
// no golfer posted those scores and no career total should carry them.
//
// Round 4 is where that stops working. Team Best Ball adds the best N nets on
// a side, so a side of seven against a side of eight is not the round that was
// played: without the ghost's card the app makes 2020's final round 13–14, and
// the scorecard says 7½–19½. That is not a rounding difference, it is the
// wrong team winning the last round of a tournament.
//
// So the ghost is imported as what the card shows it as — a roster entry with
// exactly the scores it posted, and nothing else. It appears in no other round
// because it has a card in no other round; 2020's Hi/Lo and Best Ball rounds
// were genuinely played two against one, which the app scores correctly as it
// is.
const GHOST = "ghost";

// The eighteen gross scores on a card row. The row carries the front nine, the
// OUT total, then repeats the player's name before the back nine — so the back
// is found by that second name cell rather than by a fixed column, which the
// years disagree about.
function cardRowHoles(rows, name) {
  const row = rows.find((r) => norm(r[0]) === norm(name));
  if (!row) return null;
  const second = row.findIndex((c, i) => i > 0 && norm(c) === norm(name));
  if (second < 0) return null;
  // Front nine: the nine cells ending where the OUT total sits, which is the
  // cell before the gap preceding the repeated name.
  const front = row.slice(second - 11, second - 2).map(num);
  const back = row.slice(second + 1, second + 10).map(num);
  const all = [...front, ...back];
  return all.length === 18 && all.every((n) => n != null && n > 0) ? all : null;
}

// The ghost's card for one round, or null. Also returns the tee handicap the
// card gives it, which is the handicap that round was scored off.
function ghostCard(dir, round, teams) {
  for (let g = 1; g <= 8; g++) {
    const rows = sheet(dir, `R${round}_G${g}`);
    if (!rows) continue;
    const holes = cardRowHoles(rows, GHOST);
    if (!holes) continue;
    const row = rows.find((r) => norm(r[0]) === GHOST);
    const teamName = (row[1] || "").trim();
    return {
      round,
      team: norm(teamName) === norm(teams[0]) ? "A" : "B",
      ch: num(row[2]) ?? 0,
      holes,
    };
  }
  return null;
}

// ── Team Best Ball's counting scores ──────────────────────────────
// How many of a side's nets are added on a hole. The sheet writes it on the
// Round 4 card as a "Contribs / Hole" row — and some years vary it hole by
// hole (2024 opens at four and climbs to six). The app holds one number per
// nine, so the most common value on each nine is taken and the spread is
// reported, rather than silently keeping the first.
function countingFromCard(dir, round) {
  const rows = sheet(dir, `R${round}_G1`);
  if (!rows) return null;
  // Matched on the label in the first two columns only — "Contribs/Hole" also
  // appears as a stray note at the end of the Average row, and reading that
  // row instead returns the side's average score to two decimals.
  const label = (c) => { const n = norm(c); return n.startsWith("contrhole") || n.startsWith("contribshole"); };
  const row = rows.find((r) => label(r[0]) || label(r[1]));
  if (!row) return null;
  // The counts are the run of small whole numbers on the row; a nine's worth
  // on each half of the card.
  const nums = row.map(num).filter((n) => n != null && Number.isInteger(n) && n >= 1 && n <= 12);
  if (nums.length < 18) return null;
  const mode = (arr) => {
    const tally = new Map();
    for (const n of arr) tally.set(n, (tally.get(n) || 0) + 1);
    return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };
  const front = nums.slice(0, 9), back = nums.slice(9, 18);
  return {
    front: mode(front), back: mode(back),
    varies: new Set(front).size > 1 || new Set(back).size > 1,
  };
}

// ── What Round 4 was worth ────────────────────────────────────────
// Team Best Ball is the one round no match status is recorded for, so the
// match facts cannot check it. The card totals it instead, on a "Point Share"
// row per side — the row that carries a number for each hole and the side's
// total at the end. That total is the round's recorded result, and it is what
// scripts/import-history.mjs verifies the imported round against.
function recordedPoints(dir, round, teams) {
  const out = {};
  for (let g = 1; g <= 8; g++) {
    const rows = sheet(dir, `R${round}_G${g}`);
    if (!rows) continue;
    for (const r of rows) {
      const cell = [r[0], r[1]].find((c) => c && (norm(c) === norm(teams[0]) || norm(c) === norm(teams[1])));
      if (!cell) continue;
      // The point-share row is the one with a figure on (nearly) every hole,
      // which is what tells it apart from the player rows carrying the same
      // team name.
      if (r.filter((c) => num(c) != null).length < 10) continue;
      const total = num([...r].reverse().find((c) => String(c).trim() !== ""));
      if (total == null || total > 40) continue;
      const key = norm(cell) === norm(teams[0]) ? "A" : "B";
      out[key] = Math.max(out[key] ?? 0, total);
    }
  }
  return out.A != null && out.B != null ? out : null;
}

// ── One year ──────────────────────────────────────────────────────
function buildYear(year, { backbone, facts }) {
  const dir = join(SHEETS_DIR, String(year));
  if (!existsSync(dir)) return { year, error: "no sheet directory" };
  const masterRows = sheet(dir, "Master_Input");
  if (!masterRows) return { year, error: "no Master Input" };

  const master = readMasterStandard(masterRows) || readMaster2017(masterRows);
  if (!master) return { year, error: "Master Input layout not recognised" };

  const warnings = [];
  const courseList = readCourseList(dir);
  // 2017 kept no points table. Its neighbours on both sides — 2016 and 2018 —
  // ran every match at three points, one a nine and one overall, and the cup
  // did not go to four until 2020; so that is what 2017 is scored at, stated
  // here rather than left to a silent default.
  if (!Object.keys(master.points).length) {
    warnings.push("no points table on the sheet — matches scored at the 3-point Nassau of the years either side");
    master.points = {
      singles: { nassau: { front: 1, back: 1, overall: 1 } },
      "2man_best_ball": { nassau: { front: 1, back: 1, overall: 1 } },
      pinehurst: { nassau: { front: 1, back: 1, overall: 1 } },
      "8man_top4net": { hole_points: { front: 1, back: 2 } },
    };
  }
  const yearHoles = backbone.playerHole.filter((h) => h.year === year);
  const yearRounds = backbone.playerRound.filter((r) => r.year === year);
  const yearFacts = facts.filter((f) => f.year === year);

  // The roster the SCORES know about, which is the one that matters — a player
  // on the sheet who never posted a card is not in this tournament.
  const scored = new Set(yearRounds.map((r) => r.player));
  const players = master.players.filter((p) => scored.has(p.id));
  for (const pid of scored) {
    if (!players.some((p) => p.id === pid)) {
      warnings.push(`${pid} has scores but no Master Input row — not on the roster`);
    }
  }
  const teamOf = (pid) => players.find((p) => p.id === pid)?.team || null;

  const rounds = [];
  const matches = [];
  for (let rd = 1; rd <= 4; rd++) {
    const holes = yearHoles.filter((h) => h.round === rd);
    if (!holes.length) continue;
    const m = master.rounds[rd] || {};
    // The backbone's format is the one Phase 1 already reconciled between the
    // Master Input and the scorecard headers, so it wins over re-reading the
    // sheet here; the sheet fills in only what the backbone has no field for.
    const sourceFormat = holes[0].format || m.game;
    const format = FORMAT_MAP[sourceFormat];
    if (!format) { warnings.push(`R${rd}: no app format for "${sourceFormat}"`); continue; }

    // Par and stroke index, off the cards. Every player's row carries them, so
    // the first complete one is the course.
    const pars = [], hcps = [];
    for (let h = 1; h <= 18; h++) {
      const hit = holes.find((x) => x.hole === h && x.par != null);
      pars.push(hit?.par ?? null);
      hcps.push(holes.find((x) => x.hole === h && x.hole_index != null)?.hole_index ?? null);
    }

    const pts = master.points[sourceFormat] || master.points[m.game] || {};
    const name = (holes[0].course || m.course || `Round ${rd}`).trim();
    const listed = courseList.get(norm(name)) || courseList.get(norm(m.course)) || {};
    const round = {
      round: rd,
      format,
      source_format: sourceFormat,
      course: {
        name,
        par: m.par ?? (pars.every((p) => p != null) ? pars.reduce((a, b) => a + b, 0) : null),
        rating: m.rating ?? listed.rating ?? null,
        slope: m.slope ?? listed.slope ?? null,
        hole_pars: pars,
        hole_handicaps: hcps,
      },
      nassau: pts.nassau || null,
      hole_points: pts.hole_points || null,
      // The recorded course handicap, per player. This is the number the round
      // was actually played off, and the app is given it directly rather than
      // asked to re-derive it — see the note in src/lib/historyImport.js.
      ch: Object.fromEntries(
        yearRounds.filter((r) => r.round === rd && r.course_handicap != null)
          .map((r) => [r.player, r.course_handicap])),
    };
    if (format === "team_best_ball") {
      const counting = countingFromCard(dir, rd);
      if (counting) {
        round.counting_scores = { front: counting.front, back: counting.back };
        if (counting.varies) warnings.push(`R${rd}: contributions per hole varied — the sheet's own count is ${counting.front}/${counting.back}`);
      }
      const points = recordedPoints(dir, rd, master.teams);
      if (points) round.recorded_points = points;
      else warnings.push(`R${rd}: no point-share row found — the round can't be checked against the card`);
    }
    if (!round.nassau && !round.hole_points) {
      warnings.push(`R${rd}: no points row on the sheet for "${sourceFormat}"`);
    }
    rounds.push(round);

    // The draw.
    const drawn = format === "team_best_ball"
      ? [{ teamA: players.filter((p) => p.team === "A").map((p) => p.id),
           teamB: players.filter((p) => p.team === "B").map((p) => p.id) }]
      : yearFacts.some((f) => f.round === rd)
        ? matchesFromFacts(yearFacts.filter((f) => f.round === rd), teamOf, new Set(players.map((p) => p.id)),
            (pid) => borrowedOpponent(dir, rd, pid, teamOf))
        : matchesFromCards(dir, rd, teamOf);
    if (!drawn.length) warnings.push(`R${rd}: no draw could be recovered`);
    const per = PER_SIDE[format];
    for (const d of drawn) {
      if (per && (d.teamA.length !== per || d.teamB.length !== per)) {
        warnings.push(`R${rd}: match ${d.teamA.join("+")} vs ${d.teamB.join("+")} is not ${per}v${per}`);
      }
      matches.push({ round: rd, ...d });
    }
  }

  // The ghost, if this year played one, in the rounds where it has a card.
  const roster = players.map((p) => ({
    id: p.id, name: displayName(p.id) || p.sheet_name, team: p.team, index: p.index,
  }));
  const extraHoles = [];
  for (const r of rounds) {
    const card = ghostCard(dir, r.round, master.teams);
    if (!card) continue;
    if (!roster.some((p) => p.id === GHOST)) {
      roster.push({ id: GHOST, name: "Ghost", team: card.team, index: 0, borrowed: true });
    }
    r.ch[GHOST] = card.ch;
    card.holes.forEach((gross, i) => extraHoles.push({ round: r.round, player: GHOST, hole: i + 1, gross }));
    // Team Best Ball is the whole side, so the draw for that round has to
    // include it; the two-man rounds it has no card for are left as they were
    // played, which is a man short.
    const m = matches.find((x) => x.round === r.round);
    if (r.format === "team_best_ball" && m) (card.team === "A" ? m.teamA : m.teamB).push(GHOST);
    warnings.push(`R${r.round}: a borrowed ball ("Ghost") is on the card and is imported as a roster entry`);
  }

  return {
    year,
    name: `The Bourbon Cup ${year}`,
    teams: { A: master.teams[0] || "Team A", B: master.teams[1] || "Team B" },
    players: roster,
    rounds,
    matches,
    extra_holes: extraHoles,
    warnings,
  };
}

// ── run ───────────────────────────────────────────────────────────
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const years = (args.length ? args.map(Number) : readdirSync(SHEETS_DIR)
  .filter((d) => /^\d{4}$/.test(d)).map(Number)).sort((a, b) => a - b);

const backbone = JSON.parse(readFileSync(join(DATA_DIR, "bourbon-cup-backbone.json"), "utf8"));
const facts = JSON.parse(readFileSync(join(DATA_DIR, "bourbon-cup-matchfacts.json"), "utf8")).matchFacts;

const editions = [];
for (const year of years) {
  const e = buildYear(year, { backbone, facts });
  editions.push(e);
  if (e.error) { console.log(`\n${year}: ✗ ${e.error}`); continue; }
  console.log(`\n${year} — ${e.teams.A} vs ${e.teams.B} · ${e.players.length} players`);
  for (const r of e.rounds) {
    const pts = r.nassau ? `${r.nassau.front}/${r.nassau.back}/${r.nassau.overall}`
      : r.hole_points ? `${r.hole_points.front}/${r.hole_points.back} per hole` : "—";
    console.log(`   R${r.round} ${r.format.padEnd(15)} ${String(r.course.name).slice(0, 34).padEnd(35)} ` +
      `${String(r.course.rating ?? "?").padStart(4)}/${String(r.course.slope ?? "?").padEnd(4)} ` +
      `pts ${pts.padEnd(14)} ${e.matches.filter((m) => m.round === r.round).length} matches`);
  }
  for (const w of e.warnings) console.log(`   ⚠ ${w}`);
}

const out = join(DATA_DIR, "bourbon-cup-editions.json");
const ok = editions.filter((e) => !e.error);
// Merged by year rather than replaced, so `node pipeline/editions.mjs 2019`
// rebuilds one year without quietly dropping the other nine from the file.
let prior = [];
try { prior = JSON.parse(readFileSync(out, "utf8")).editions || []; } catch { /* first run */ }
const rebuilt = new Set(ok.map((e) => e.year));
const merged = [...prior.filter((e) => !rebuilt.has(e.year)), ...ok].sort((a, b) => a.year - b.year);
writeFileSync(out, JSON.stringify({ editions: merged }, null, 2));
console.log(`\n→ ${out}`);
console.log(`   ${merged.length} editions (${ok.length} rebuilt) · ` +
  `${merged.reduce((n, e) => n + e.matches.length, 0)} matches · ` +
  `${ok.reduce((n, e) => n + e.warnings.length, 0)} warnings`);
