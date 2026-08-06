// ══════════════════════════════════════════════════════════════════
//  historyVerify — does an imported year come out as it was played?
// ══════════════════════════════════════════════════════════════════
//
// historyImport.js builds the documents; this runs the APP'S OWN scoring
// engine over them and compares the answer with the record. It is the half
// that can be wrong in a way nobody would notice: a stroke allocated on the
// wrong hole shows a plausible leaderboard for a tournament that finished
// differently, and there is nothing on screen to say so.
//
// Both callers use it, and that is the point of it being a module:
//
//   historyImport.fidelity.test.js   runs it over all ten years on every
//                                    `npm test`.
//   scripts/import-history.mjs       runs it before writing a single document,
//                                    and refuses to write a year that fails.
//
// It imports scoring.js, so it cannot live in historyImport.js — that file
// stays free of the app's engine so a plain-Node script can build documents
// without loading it.
import { computeMatchResult } from "../scoring.js";
import { handicapModeFor } from "../constants.js";
import { buildEdition, historyPlayerId } from "./historyImport.js";

// ── The app's view of a built edition ─────────────────────────────
// The same maps App.jsx assembles from its Firestore subscriptions: hole
// scores keyed `pid_round`, locks keyed by round number, and each round's
// Nassau merged onto its matches (the pots belong to the round, never to the
// match — App does exactly this before it scores anything).
export const appView = (built) => {
  const holeData = {};
  for (const h of built.bc_hole_scores) {
    (holeData[`${h.player_id}_${h.round_number}`] ||= {})[h.hole_number - 1] = h.score;
  }
  const roundLocks = {};
  for (const l of built.bc_round_locks) roundLocks[l.round_number] = l;
  const tRounds = built.bc_rounds.map((r) => ({
    ...r,
    nassau: { front: r.nassau_front ?? 1, back: r.nassau_back ?? 1, overall: r.nassau_overall ?? 1 },
  }));
  return { holeData, roundLocks, tRounds };
};

export const scoreMatch = (built, view, match) => {
  const tr = view.tRounds.find((r) => r.round_number === match.round);
  return computeMatchResult(
    { ...match, nassau: tr.nassau, scoring_type: tr.scoring_type, hole_points: tr.hole_points },
    view.holeData, built.bc_courses, view.tRounds, built.bc_players,
    tr.format, {}, undefined, {}, view.roundLocks,
  );
};

// ── Calibrating Team Best Ball ────────────────────────────────────
// How many of a side's nets count on a hole. The app holds ONE number per
// nine; the sheets set it hole by hole and moved it mid-nine (2025 opens at
// four and goes to five for holes 7–9). So for most years there is no
// front/back pair that is literally what was played.
//
// There is, though, a pair that produces the result that WAS played — the
// point share the card totals at the bottom. This searches for it, which is
// the honest way round: the round's recorded result is the fact, and the
// contribution count is a setting chosen to reproduce it.
//
// Ties are broken toward the sheet's own dominant count, then downward, so the
// answer is deterministic and lands on the sheet's numbers when they work
// (2017, 2020 and 2025 all do).
export const calibrateCounting = (edition, holes) => {
  const out = {};
  for (const round of edition.rounds) {
    const target = round.recorded_points;
    if (!target || round.format !== "team_best_ball") continue;
    const sheet = round.counting_scores || { front: 4, back: 4 };

    let best = null;
    for (let front = 1; front <= 8; front++) {
      for (let back = 1; back <= 8; back++) {
        const built = buildEdition(edition, holes, {
          handicapModeFor, counting: { [round.round]: { front, back } },
        });
        const view = appView(built);
        const match = built.bc_matches.find((m) => m.round === round.round);
        if (!match) continue;
        const res = scoreMatch(built, view, match);
        if (Math.abs(res.totalPts.A - target.A) > 0.001 || Math.abs(res.totalPts.B - target.B) > 0.001) continue;
        const distance = Math.abs(front - sheet.front) + Math.abs(back - sheet.back);
        if (!best || distance < best.distance
          || (distance === best.distance && (front < best.front || (front === best.front && back < best.back)))) {
          best = { front, back, distance };
        }
      }
    }
    if (best) out[round.round] = { front: best.front, back: best.back };
  }
  return out;
};

// Build a year the way an import writes it: calibrated, and with the app's own
// handicap-mode catalog.
export const buildVerified = (edition, holes) =>
  buildEdition(edition, holes, { handicapModeFor, counting: calibrateCounting(edition, holes) });

// ── The checks ────────────────────────────────────────────────────
// Each returns a list of failures, empty when the year came out as it was
// played. Kept separate so a caller can say which KIND of thing went wrong —
// a card that didn't survive the import is a different problem from a match
// the engine scores differently.

// Every gross total and every course handicap, against the round facts.
export const checkCards = (built, view, year, playerRounds) => {
  const bad = [];
  for (const r of playerRounds) {
    const pid = historyPlayerId(year, r.player);
    const holes = view.holeData[`${pid}_${r.round}`];
    if (!holes) { bad.push(`${r.player} R${r.round}: no card`); continue; }
    const gross = Object.values(holes).reduce((a, b) => a + b, 0);
    if (gross !== r.gross_total) bad.push(`${r.player} R${r.round}: gross ${gross} ≠ ${r.gross_total}`);
    const ch = view.roundLocks[r.round]?.players?.[pid]?.ch;
    if (ch !== r.course_handicap) bad.push(`${r.player} R${r.round}: CH ${ch} ≠ ${r.course_handicap}`);
  }
  return bad;
};

// Every player the record has in a match is in one in the draw. A match played
// against the borrowed ball is not one the draw can hold — there is no roster
// row on the other side of it — so it is named rather than counted as a miss.
export const checkDraw = (built, year, facts, roster) => {
  const bad = [];
  for (const f of facts) {
    const opponents = String(f.opponent || "").split("+").filter(Boolean);
    if (opponents.length && opponents.every((o) => !roster.has(o))) continue;
    const pid = historyPlayerId(year, f.player);
    const inMatch = built.bc_matches.some((m) =>
      m.round === f.round && (m.teamA.includes(pid) || m.teamB.includes(pid)));
    if (!inMatch) bad.push(`${f.player} R${f.round}: played a match the draw doesn't have`);
  }
  return bad;
};

// Every match-play match, against the running status the scorecard kept.
// Compared on which side is ahead rather than by how much: the margin in a
// dots or points game counts something different from holes, and the fact
// worth defending is who won.
export const checkMatches = (built, view, year, facts) => {
  const bad = [];
  let checked = 0;
  for (const m of built.bc_matches) {
    const tr = view.tRounds.find((r) => r.round_number === m.round);
    if (tr.scoring_type === "points") continue;   // Round 4 — checked below
    const f = facts.find((x) => x.final != null && x.round === m.round
      && m.teamA.includes(historyPlayerId(year, x.player)));
    if (!f) continue;
    checked++;
    // `overall.margin` is from A's perspective, and the fact's player is on A
    // by the line above, so the two point the same way.
    const margin = scoreMatch(built, view, m).overall?.margin ?? 0;
    if (Math.sign(margin) !== Math.sign(f.final)) {
      bad.push(`R${m.round} ${m.teamANames.join("+")} vs ${m.teamBNames.join("+")}: app ${margin}, card ${f.final}`);
    }
  }
  return { checked, bad };
};

// Round 4, against the point share the card totals. Exact, not a sign check:
// this round is scored in points rather than holes and half a point is a real
// difference in a cup that has finished one apart.
export const checkPointsRounds = (built, view, edition) => {
  const bad = [];
  for (const round of edition.rounds) {
    const target = round.recorded_points;
    if (!target) continue;
    const match = built.bc_matches.find((m) => m.round === round.round);
    if (!match) { bad.push(`R${round.round}: no match to score`); continue; }
    const res = scoreMatch(built, view, match);
    if (Math.abs(res.totalPts.A - target.A) > 0.001 || Math.abs(res.totalPts.B - target.B) > 0.001) {
      bad.push(`R${round.round}: app ${res.totalPts.A}–${res.totalPts.B}, card ${target.A}–${target.B}`);
    }
  }
  return bad;
};

// Everything, for one year. `playerRounds` and `facts` are that year's rows
// from the backbone and the match facts.
export const verifyEdition = (edition, holes, { playerRounds = [], facts = [] } = {}) => {
  const built = buildVerified(edition, holes);
  const view = appView(built);
  const roster = new Set(edition.players.map((p) => p.id));
  const matches = checkMatches(built, view, edition.year, facts);
  return {
    built,
    view,
    cards: checkCards(built, view, edition.year, playerRounds),
    draw: checkDraw(built, edition.year, facts, roster),
    matchesChecked: matches.checked,
    matches: matches.bad,
    points: checkPointsRounds(built, view, edition),
  };
};

export const verdictOf = (v) =>
  [...v.cards, ...v.draw, ...v.matches, ...v.points];

// The cup as the app would show it — every match's points, by team. Printed by
// the import so the run says what each year will read as on the leaderboard.
export const cupScore = (built, view) => {
  let A = 0, B = 0;
  for (const m of built.bc_matches) {
    const res = scoreMatch(built, view, m);
    A += res.totalPts.A;
    B += res.totalPts.B;
  }
  return { A, B };
};
