// phase3.mjs — Bourbon Cup fact layer (JSON) → query-ready SQLite database.
//
// Run AFTER backbone.mjs + phase2.mjs, whenever the JSON facts change (i.e. once a year):
//   node phase3.mjs <backbone.json> <matchfacts.json> <out.db>
// Defaults (run from the folder holding the JSONs):
//   node phase3.mjs           → reads ./bourbon-cup-backbone.json + ./bourbon-cup-matchfacts.json → writes ./bourbon-cup.db
//
// Uses Node 22's built-in node:sqlite (no native build, no npm install). The output .db is a
// standard SQLite file readable by better-sqlite3, @libsql/client, the sqlite3 CLI, etc.
//
// Design: one table per fact grain (player_hole / player_round / match), plus a players dimension
// and a match_hole table that EXPLODES each match's trajectory array into rows — so "comeback",
// "blew a lead", and "lead changes" become plain SQL instead of array gymnastics. No metrics are
// precomputed; every stat is a query over these atomic facts.

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { PLAYERS } from "./players.mjs";

const BACKBONE   = process.argv[2] || "./bourbon-cup-backbone.json";
const MATCHFACTS = process.argv[3] || "./bourbon-cup-matchfacts.json";
const OUT        = process.argv[4] || "./bourbon-cup.db";

const backbone = JSON.parse(readFileSync(BACKBONE, "utf8"));
const matches  = JSON.parse(readFileSync(MATCHFACTS, "utf8")).matchFacts;
const b01 = v => (v === true ? 1 : v === false ? 0 : v == null ? 0 : v ? 1 : 0);

const db = new DatabaseSync(OUT);
db.exec("PRAGMA journal_mode = WAL;");

// ── schema ──────────────────────────────────────────────────────────────────
db.exec(`
DROP TABLE IF EXISTS match_hole;
DROP TABLE IF EXISTS match;
DROP TABLE IF EXISTS player_round;
DROP TABLE IF EXISTS player_hole;
DROP TABLE IF EXISTS players;

CREATE TABLE players (
  id   TEXT PRIMARY KEY,          -- canonical id (e.g. 'nicks')
  name TEXT NOT NULL              -- display name (e.g. 'Nick S')
);

CREATE TABLE player_hole (        -- one row per player per hole (the atomic grain)
  id INTEGER PRIMARY KEY,
  year INTEGER, round INTEGER, hole INTEGER, seq INTEGER,
  player TEXT REFERENCES players(id),
  format TEXT, scoring_type TEXT, course TEXT,
  par INTEGER, hole_index INTEGER,         -- hole_index = stroke index (1=hardest)
  segment TEXT,                            -- 'front' | 'back'
  gross INTEGER, net INTEGER,
  strokes_received INTEGER, net_vs_par INTEGER,   -- net_vs_par: <0 under par, 0 even, >0 over
  hole_result TEXT, status_after INTEGER, contribution_counted INTEGER,
  involves_ghost INTEGER                    -- 0/1
);

CREATE TABLE player_round (       -- one row per player per round (totals + inline metrics)
  id INTEGER PRIMARY KEY,
  year INTEGER, round INTEGER,
  player TEXT REFERENCES players(id),
  format TEXT, scoring_type TEXT, course TEXT,
  course_handicap REAL, gross_total INTEGER, net_total REAL, net_vs_par REAL,
  net_pars_or_better REAL, match_royale REAL,
  eagles INTEGER, birdies INTEGER, pars INTEGER, bogies INTEGER, doubles INTEGER
);

CREATE TABLE match (              -- one row per PARTICIPANT per match (head-to-head formats only)
  id INTEGER PRIMARY KEY,
  year INTEGER, round INTEGER, format TEXT,
  player TEXT REFERENCES players(id),
  opponent TEXT,                  -- opponent id(s); team formats join with '+', e.g. 'andy+petec'; 'ghost' for borrowed slot
  team TEXT,
  after9 INTEGER, final INTEGER, margin INTEGER,  -- margin/final in holes (+ = up, - = down, 0 = halved)
  won INTEGER, halved INTEGER,                     -- 0/1
  involves_ghost INTEGER, opponent_absent INTEGER  -- 0/1 (opponent_absent = singles forfeit)
);

CREATE TABLE match_hole (         -- match.trajectory exploded: running match status after each hole
  match_id INTEGER REFERENCES match(id),
  hole INTEGER,
  margin INTEGER,                 -- holes up (+) / down (-) for this participant after this hole
  PRIMARY KEY (match_id, hole)
);

CREATE INDEX idx_ph_player ON player_hole(player);
CREATE INDEX idx_ph_yr     ON player_hole(year, round);
CREATE INDEX idx_ph_par    ON player_hole(par);
CREATE INDEX idx_pr_player ON player_round(player);
CREATE INDEX idx_pr_yr     ON player_round(year, round);
CREATE INDEX idx_m_player  ON match(player);
CREATE INDEX idx_m_opp     ON match(opponent);
CREATE INDEX idx_m_yr      ON match(year, round);
`);

// ── load ──────────────────────────────────────────────────────────────────
const tx = db.exec.bind(db);
db.exec("BEGIN;");

const insPlayer = db.prepare("INSERT INTO players (id,name) VALUES (?,?)");
for (const [id, { name }] of Object.entries(PLAYERS)) insPlayer.run(id, name);

const insHole = db.prepare(`INSERT INTO player_hole
  (year,round,hole,seq,player,format,scoring_type,course,par,hole_index,segment,
   gross,net,strokes_received,net_vs_par,hole_result,status_after,contribution_counted,involves_ghost)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
for (const h of backbone.playerHole)
  insHole.run(h.year,h.round,h.hole,h.seq,h.player,h.format,h.scoring_type,h.course,h.par,h.hole_index,h.segment,
    h.gross,h.net,h.strokes_received,h.net_vs_par,h.hole_result,h.status_after,h.contribution_counted,b01(h.involves_ghost));

const insRound = db.prepare(`INSERT INTO player_round
  (year,round,player,format,scoring_type,course,course_handicap,gross_total,net_total,net_vs_par,
   net_pars_or_better,match_royale,eagles,birdies,pars,bogies,doubles)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
for (const r of backbone.playerRound)
  insRound.run(r.year,r.round,r.player,r.format,r.scoring_type,r.course,r.course_handicap,r.gross_total,r.net_total,r.net_vs_par,
    r.netParsOrBetter,r.matchRoyale,r.eagles,r.birdies,r.pars,r.bogies,r.doubles);

const insMatch = db.prepare(`INSERT INTO match
  (year,round,format,player,opponent,team,after9,final,margin,won,halved,involves_ghost,opponent_absent)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const insMH = db.prepare("INSERT INTO match_hole (match_id,hole,margin) VALUES (?,?,?)");
for (const m of matches) {
  const info = insMatch.run(m.year,m.round,m.format,m.player,m.opponent,m.team,
    m.after9,m.final,m.margin,b01(m.won),b01(m.halved),b01(m.involves_ghost),b01(m.opponent_absent));
  const mid = Number(info.lastInsertRowid);
  if (Array.isArray(m.trajectory))
    m.trajectory.forEach((margin, i) => insMH.run(mid, i + 1, margin));
}

db.exec("COMMIT;");

// ── report ──────────────────────────────────────────────────────────────────
const count = t => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
console.log(`→ ${OUT}`);
for (const t of ["players","player_hole","player_round","match","match_hole"])
  console.log(`   ${t.padEnd(13)} ${count(t)}`);
db.close();
