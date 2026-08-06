#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
//  Bourbon Cup — the fact layer as three flat CSVs.
// ══════════════════════════════════════════════════════════════════
//
// data/holes.csv, data/rounds.csv and data/matches.csv are the JSON facts in
// the shape a spreadsheet or a notebook can open: one row per player-hole, per
// player-round, and per player-match, with display NAMES rather than canonical
// ids.
//
// They were in the repo before this script was, exported by hand from the
// SQLite build and therefore not reproducible — which stopped mattering the
// day a canonical id changed underneath them (Telly and Ben T turning out to
// be the same man) and three committed files started disagreeing with the
// facts they came from.
//
//   node pipeline/export-csv.mjs        # after backbone.mjs + phase2.mjs
//
// Written to reproduce the existing files byte for byte, which is how it was
// checked: it was run against the pre-fold facts and diffed against what was
// already committed.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// The formal name — first name, last initial — because that is what the
// committed exports have always carried ("Adam P", not "Pace"), and what the
// app shows.
import { formalName } from "./players.mjs";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const read = (f) => JSON.parse(readFileSync(join(DATA_DIR, f), "utf8"));

// Booleans go out as 0/1 — the form the SQLite export used, and the one a
// spreadsheet filters on. Nulls go out empty rather than as "null".
const cell = (v) => {
  if (v === true) return "1";
  if (v === false) return "0";
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const table = (rows, columns) =>
  [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\n") + "\n";

const backbone = read("bourbon-cup-backbone.json");
const matchFacts = read("bourbon-cup-matchfacts.json").matchFacts;

const holes = backbone.playerHole.map((h) => ({ ...h, player: formalName(h.player) }));
const rounds = backbone.playerRound.map((r) => ({ ...r, player: formalName(r.player) }));
const matches = matchFacts.map((m) => ({
  ...m,
  player: formalName(m.player),
  // The opponent is a SIDE, stored canonically as "timc+dk". Spelled out here
  // the way the export always spelled it.
  opponent: String(m.opponent || "").split("+").map((p) => formalName(p)).join(" + "),
  trajectory: (m.trajectory || []).join(" "),
  // Two flags Phase 2 only writes on some branches. The export has always
  // carried a 0 there rather than a blank, the way the SQLite build's b01()
  // did — a forfeit row is the one that has neither.
  opponent_absent: m.opponent_absent ?? false,
  involves_ghost: m.involves_ghost ?? false,
}));

const files = [
  ["holes.csv", holes, ["year", "round", "hole", "player", "format", "scoring_type", "course",
    "par", "hole_index", "segment", "gross", "net", "net_vs_par", "strokes_received", "involves_ghost"]],
  ["rounds.csv", rounds, ["year", "round", "player", "format", "scoring_type", "course",
    "course_handicap", "gross_total", "net_total", "net_vs_par", "eagles", "birdies", "pars",
    "bogies", "doubles", "netParsOrBetter", "matchRoyale"]],
  ["matches.csv", matches, ["year", "round", "format", "player", "opponent", "team", "after9",
    "final", "margin", "won", "halved", "involves_ghost", "opponent_absent", "trajectory"]],
];

// rounds.csv names two metrics differently from the JSON (net_pars_or_better,
// match_royale). Renamed on the way out rather than in the facts, where the
// camelCase keys are what every other reader already uses.
const HEADER_ALIAS = { netParsOrBetter: "net_pars_or_better", matchRoyale: "match_royale" };

for (const [name, rows, columns] of files) {
  const body = table(rows, columns);
  const header = columns.map((c) => HEADER_ALIAS[c] || c).join(",");
  writeFileSync(join(DATA_DIR, name), header + body.slice(body.indexOf("\n")));
  console.log(`${name.padEnd(12)} ${rows.length} rows`);
}
