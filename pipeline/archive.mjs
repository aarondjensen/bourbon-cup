#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
//  archive — every year the cup has been played, as facts the app can
//  read without opening ten tournaments.
// ══════════════════════════════════════════════════════════════════
//
// `npm run build:archive` → data/bourbon-cup-archive.json
//
// ── Why this file exists ──────────────────────────────────────────
// The Data tab wants career records, partnerships, head-to-heads and cup
// records — every one of which is a question about ALL the years at once. The
// app subscribes to ONE edition, on purpose: a year is roughly a thousand
// documents, and answering "how has Weezy done" by opening ten of them would
// cost ten thousand reads every time somebody tapped a tab.
//
// So the years that are over are precomputed here, at build time, and shipped
// as a static asset. The app fetches one content-hashed chunk the first time
// the tab is opened, the CDN keeps it forever because its name changes when
// its bytes do, and Firestore is not involved at all — no reads, no rules, no
// deploy step, and `git revert` genuinely undoes it.
//
// ── Why it cannot disagree with the app ───────────────────────────
// Every number here is produced by `buildVerified` + the app's own
// `computeMatchResult`, which is the same path src/lib/historyVerify.js takes
// and the same one the leaderboard takes when you switch into 2019. The
// archive is a CACHE of the cards, in exactly the sense editionSummary is:
// nothing is typed, and re-running this script is the only way to change it.
//
// ── Why it ships FACTS rather than answers ────────────────────────
// The obvious version of this file writes out finished career rows. It is the
// wrong shape, because the running year is not in here and has to be folded in
// live — and if the totals were precomputed, the app would need a second
// implementation of every one of them to add this year's matches to last
// year's answer. Two implementations of "what is a win" is how the two halves
// of a screen come to disagree.
//
// So what ships is the normalized record — one row per round, per match, per
// card — and src/lib/archiveFold.js turns rows into answers. The app appends
// the live edition's rows to these and calls the same function.
//
// ── What is NOT in here ───────────────────────────────────────────
// Hole-by-hole scores. 11,340 of them is most of a megabyte, and nothing on
// the tab asks a question below the level of a round. The one hole-level fact
// that earns its place is `a9`, the match status at the turn, because "down
// three and won it" cannot be recovered from a final margin.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLAYERS, norm } from "./players.mjs";
import { buildVerified, appView, scoreMatch } from "../src/lib/historyVerify.js";
import { historyPlayerId } from "../src/lib/historyImport.js";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const read = (f) => JSON.parse(readFileSync(join(DATA_DIR, f), "utf8"));

const { editions } = read("bourbon-cup-editions.json");
const backbone = read("bourbon-cup-backbone.json");
const matchFacts = read("bourbon-cup-matchfacts.json").matchFacts;

// ── Identity ──────────────────────────────────────────────────────
// The canonical id is the registry's, so the six men who changed handle in
// 2022 stay one golfer here (see pipeline/players.mjs — nothing downstream can
// catch a split identity, because each half looks like a complete record).
//
// `aka` ships with them because the LIVE edition has no canonical id on its
// roster. The imported years carry theirs in the document id itself
// (`hist_2019_paulw`), but 2025 was entered by hand as `bc_player_<ms>` and a
// clone of it inherits that. So the app resolves a live roster row by name,
// against this list, and every spelling the pipeline has ever had to resolve
// is in it — including the display form the app itself stores.
const playerRows = Object.entries(PLAYERS)
  .map(([id, p]) => ({
    id,
    name: p.name,
    aka: [...new Set([id, p.name, ...(p.aliases || []),
      ...(p.first && p.last ? [`${p.first} ${p.last}`, `${p.first} ${p.last[0]}`] : [])]
      .map(norm).filter(Boolean))].sort(),
  }))
  .sort((a, b) => a.id.localeCompare(b.id));

// ── One year, scored the way the app scores it ────────────────────
const factsFor = (edition) => {
  const year = edition.year;
  const built = buildVerified(edition, backbone.playerHole.filter((h) => h.year === year));
  const view = appView(built);
  // hist_2016_bent → bent. The archive is keyed on the golfer, not on the
  // roster row he happened to occupy in one year.
  const cid = (pid) => String(pid).replace(`hist_${year}_`, "");

  // 2020's borrowed ball. It is a roster row because Team Best Ball needed a
  // ball on the side, and it is not a person — so it gets no career, no
  // appearance and no partnership, the same way every screen that lists
  // PLAYERS filters it out (lib/players.isBorrowedBall). Its side keeps the
  // points it won: the match was played that way.
  const borrowed = new Set(built.bc_players.filter((p) => p.borrowed).map((p) => cid(p.player_id)));
  const real = (ids) => ids.filter((id) => !borrowed.has(id));

  const courseFor = (round) => {
    const r = built.bc_rounds.find((x) => x.round_number === round);
    return built.bc_courses.find((c) => c.id === r?.course_id) || null;
  };
  const parOf = (course) => (course?.hole_pars || []).reduce((a, b) => a + b, 0) || course?.par || 72;

  const rounds = built.bc_rounds
    .map((r) => {
      const course = courseFor(r.round_number);
      return {
        year,
        round: r.round_number,
        format: r.format,
        course: course?.name || "",
        // The SCORECARD's par, not the stored `par` field — the two can
        // disagree, and every to-par number on the tab is worked out against
        // the holes. Same call lib/tripInfo.coursePar makes.
        par: parOf(course),
        rating: course?.rating ?? null,
        slope: course?.slope ?? null,
      };
    })
    .sort((a, b) => a.round - b.round);

  const matches = built.bc_matches
    .map((m) => {
      const res = scoreMatch(built, view, m);
      return {
        year,
        round: m.round,
        A: real((m.teamA || []).map(cid)).sort(),
        B: real((m.teamB || []).map(cid)).sort(),
        ptsA: res.totalPts.A,
        ptsB: res.totalPts.B,
      };
    })
    .sort((a, b) => a.round - b.round || a.A.join().localeCompare(b.A.join()));

  // One row per card, off the DOCUMENTS the import built rather than off the
  // sheets' own round facts — because that is what the app would show, and
  // because it is the only way the archive and the running year can be
  // counting the same thing.
  //
  // The backbone carries eagles/birdies/pars/bogies/doubles per round and
  // they are NET: for 2016 R1 Andy H they reconstruct his net 78 exactly and
  // his gross 87 not at all. Net counts are a real fact, but they are not the
  // one anybody means by "how many birdies has he made", they move when a
  // handicap is corrected, and lib/archiveLive can only compute the gross
  // ones for the live year. Two definitions of a birdie on one screen is
  // worse than either. So they are recomputed here from the holes, with the
  // same arithmetic archiveLive uses.
  //
  // `d` is double bogey OR WORSE. The sheets' own bucket was the same, which
  // is why their identity only reconstructs on the 47% of rounds where nobody
  // went past a double.
  const parByRound = Object.fromEntries(rounds.map((r) => [r.round, r.par]));
  const parsByRound = Object.fromEntries(built.bc_rounds.map((r) => {
    const c = courseFor(r.round_number);
    return [r.round_number, c?.hole_pars || []];
  }));
  const cards = backbone.playerRound
    .filter((r) => r.year === year)
    .map((r) => {
      const pid = historyPlayerId(year, r.player);
      const holes = view.holeData[`${pid}_${r.round}`] || {};
      const pars = parsByRound[r.round] || [];
      const gross = Object.values(holes).reduce((a, b) => a + b, 0);
      let e = 0, b = 0, pr = 0, bo = 0, d = 0;
      Object.entries(holes).forEach(([h, score]) => {
        const v = score - (pars[Number(h)] ?? 4);
        if (v <= -2) e += 1; else if (v === -1) b += 1; else if (v === 0) pr += 1;
        else if (v === 1) bo += 1; else d += 1;
      });
      const fact = matchFacts.find((f) => f.year === year && f.round === r.round && f.player === r.player);
      return {
        year,
        round: r.round,
        p: r.player,
        g: gross,
        ch: view.roundLocks[r.round]?.players?.[pid]?.ch ?? r.course_handicap,
        tp: gross - (parByRound[r.round] ?? 72),
        e, b, pr, bo, d,
        // Match status at the turn, from the player's own side. Absent on
        // Round 4, which is one team match against another and never had one.
        ...(fact && fact.after9 != null ? { a9: fact.after9 } : {}),
      };
    })
    .sort((a, b) => a.round - b.round || a.p.localeCompare(b.p));

  return {
    edition: {
      year,
      name: edition.name,
      teamA: edition.teams?.A || "A",
      teamB: edition.teams?.B || "B",
      roster: built.bc_players
        .filter((p) => !p.borrowed)
        .map((p) => ({ p: cid(p.player_id), t: p.team }))
        .sort((a, b) => a.p.localeCompare(b.p)),
    },
    rounds,
    matches,
    cards,
  };
};

const years = editions.map((e) => e.year).sort((a, b) => a - b);
const built = editions
  .slice()
  .sort((a, b) => a.year - b.year)
  .map((e) => {
    const f = factsFor(e);
    const pts = f.matches.reduce((s, m) => ({ A: s.A + m.ptsA, B: s.B + m.ptsB }), { A: 0, B: 0 });
    console.log(`  ${f.edition.year}  ${f.matches.length} matches  ${f.cards.length} cards  `
      + `${f.edition.teamA} ${pts.A} — ${pts.B} ${f.edition.teamB}`);
    return f;
  });

// Sorted end to end, for the reason every generated file in here is sorted:
// a rebuild should be byte-comparable with what is committed, so "does this
// still reproduce?" has an answer.
const out = {
  source: "pipeline/archive.mjs",
  years,
  players: playerRows,
  editions: built.map((b) => b.edition),
  rounds: built.flatMap((b) => b.rounds),
  matches: built.flatMap((b) => b.matches),
  cards: built.flatMap((b) => b.cards),
};

const outPath = join(DATA_DIR, "bourbon-cup-archive.json");
writeFileSync(outPath, JSON.stringify(out, null, 1));
const kb = (readFileSync(outPath).length / 1024).toFixed(0);
console.log(`\nArchive — ${years.length} years, ${out.matches.length} matches, `
  + `${out.cards.length} cards, ${out.players.length} golfers → ${kb} KB`);
