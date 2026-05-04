// ── Scoring engine ──
// All pure scoring math lives here — no React, no Firestore, no UI.
// Two scoring paths share these utilities:
//   - Tournament play (computeMatchResult)        — multi-format Nassau
//   - Practice play   (computePracticeMatch /
//                      computePracticeSkins)      — fixed Team Total + skins
// Both paths use the same getEffectiveHI / buildStrokeMap helpers so the
// dots displayed on a scoring screen always reflect the strokes used in
// the leaderboard math.
import { NASSAU_DEFAULT, POINT_METHOD_NASSAU, POINT_METHOD_TRADITIONAL } from "./constants";

// ── Course Handicap math ──
// USGA Course Handicap formula:
//   CH = HI × (Slope / 113) + (Course Rating - Par)
// where:
//   - HI is the player's official Handicap Index from admin setup
//   - Slope is the slope rating of the tee being played (113 = neutral)
//   - Course Rating is the difficulty rating of the tee
//   - Par is the par of the tee (almost always == course par)
// Result is rounded to the nearest integer per USGA convention.
export const calcCH = (hi, slope, rating, par) => (!hi && hi !== 0) ? 0 : Math.round((hi * (slope / 113)) + (rating - par));

// Resolves slope/rating/par for a course doc and runs calcCH. The tee
// the player is actually playing matters — different tees on the same
// course can have wildly different slope ratings (e.g. Black 138 vs
// White 122), and the USGA formula uses the playing tee's values, not
// course-level averages. When a specific tee is named, its values are
// definitive — they ARE the playing conditions. When no tee is named
// (legacy events created before tee selection existed), we fall back
// through: top-level course.slope/rating/par → first tee box → USGA
// neutral defaults (113/72/72). All values are coerced through
// parseFloat so string-stored values from imported APIs still work.
export const calcCHForCourse = (hi, course, teeName) => {
  if (!course) return calcCH(hi, 113, 72, 72);
  const teeBoxes = course.tee_boxes || [];
  if (teeName) {
    const tee = teeBoxes.find(t => t.name === teeName);
    if (tee) {
      const slope = parseFloat(tee.slope) || 113;
      const rating = parseFloat(tee.rating) || 72;
      const par = parseFloat(tee.par) || 72;
      return calcCH(hi, slope, rating, par);
    }
  }
  const fallbackTee = teeBoxes[0] || {};
  const slope = parseFloat(course.slope) || parseFloat(fallbackTee.slope) || 113;
  const rating = parseFloat(course.rating) || parseFloat(fallbackTee.rating) || 72;
  const par = parseFloat(course.par) || parseFloat(fallbackTee.par) || 72;
  return calcCH(hi, slope, rating, par);
};

// ── Score formatting ──
// Render a relative-to-par integer as "E", "+1", or "-2". Lives here
// (vs. a pure formatting module) because it pairs naturally with score
// math and isn't used outside scoring contexts.
export const fmtScore = (n) => n == null ? "—" : n === 0 ? "E" : n > 0 ? `+${n}` : `${n}`;

// ── Shared scoring helpers ──
// Get a player's effective Handicap Index, applying any per-round override.
// Used by every scoring path (tournament + practice) so override semantics
// stay identical everywhere. `overrides` is the round-scoped map
// (e.g. hcpOverrides[match.round]), NOT the full per-round dictionary.
export const getEffectiveHI = (pid, players, overrides) => {
  if (overrides && overrides[pid] !== undefined && overrides[pid] !== "") {
    return parseFloat(overrides[pid]) || 0;
  }
  const tp = players.find(p => p.player_id === pid);
  return parseFloat(tp?.handicap_index) || 0;
};

// Allocate strokes across 18 holes by hole-handicap rank. The lowest-handicap
// hole (hardest) gets stroke 1, then 2, etc., wrapping for handicaps > 18
// (capped at 3 wraps = 54 strokes). Negative ch produces "negative strokes"
// (rare — used for plus handicaps in low-man adjustments) by signing the
// allocation. Used by both tournament and practice scoring paths so the
// dots displayed on scoring screens always match what the leaderboard
// math actually used.
export const buildStrokeMap = (ch, holeHcps) => {
  const sorted = holeHcps.map((h, i) => ({ idx: i, hcp: h })).sort((a, b) => a.hcp - b.hcp);
  const map = {};
  let rem = Math.abs(ch);
  const sign = ch >= 0 ? 1 : -1;
  for (let pass = 0; pass < 3 && rem > 0; pass++) {
    for (const h of sorted) { if (rem <= 0) break; map[h.idx] = (map[h.idx] || 0) + sign; rem--; }
  }
  return map;
};

// ── Match Scoring Engine ──
// `teeAssignments` is a round-scoped map of { pid: teeName } so each player's
// course handicap reflects the tee they actually played. Without it, every
// player on a multi-tee round would be calculated against the course's first
// tee, which silently mis-allocates strokes (a "Black tees" player gets the
// same CH as a "White tees" player on the same course — they shouldn't).
export function computeMatchResult(match, holeData, courses, tRounds, tPlayers, format, hcpOverrides, handicapMode, teeAssignments) {
  // holeData: { pid_round: { holeIdx: score } }
  const rnd = match.round;
  const tr = tRounds.find(t => t.round_number === rnd);
  const course = courses.find(c => c.id === tr?.course_id);
  if (!course) return { status: "AS", frontPts: 0, backPts: 0, overallPts: 0, holes: [] };

  const holePars = course.hole_pars || Array(18).fill(4);
  const holeHcps = course.hole_handicaps || Array(18).fill(9);

  const getPlayerScores = (pid) => holeData[`${pid}_${rnd}`] || {};
  const roundOverrides = hcpOverrides?.[rnd] || {};
  const roundTees = teeAssignments?.[rnd] || {};
  const getPlayerHI = (pid) => getEffectiveHI(pid, tPlayers, roundOverrides);
  const getCH = (pid) => calcCHForCourse(getPlayerHI(pid), course, roundTees[pid]);
  const getStrokeMap = (ch) => buildStrokeMap(ch, holeHcps);
  const netScore = (gross, holeIdx, strokeMap) => gross == null ? null : gross - (strokeMap[holeIdx] || 0);

  const teamA = match.teamA; // array of pids
  const teamB = match.teamB;

  // ── Handicap allocation ──
  const roundHandicapMode = handicapMode || tRounds.find(t => t.round_number === rnd)?.handicap_mode || (rnd === 4 ? "full" : "low_man");
  const allPids = [...teamA, ...teamB];
  const allCHs = allPids.map(pid => getCH(pid));
  const minCH = Math.min(...allCHs);
  const getAdjustedStrokeMap = (pid) => {
    if (roundHandicapMode === "full") return getStrokeMap(getCH(pid));
    // Play off the low man: low man gets 0, others get the difference
    const adjustedCH = getCH(pid) - minCH;
    return getStrokeMap(adjustedCH);
  };

  // Compute per-hole results
  const holeResults = Array(18).fill(null).map((_, h) => {
    let aScore = null, bScore = null;
    if (format === "singles") {
      const aPid = teamA[0], bPid = teamB[0];
      const aMap = getAdjustedStrokeMap(aPid);
      const bMap = getAdjustedStrokeMap(bPid);
      const aRaw = getPlayerScores(aPid)[h];
      const bRaw = getPlayerScores(bPid)[h];
      aScore = netScore(aRaw, h, aMap);
      bScore = netScore(bRaw, h, bMap);
    } else if (format === "best_ball") {
      const aNets = teamA.map(pid => { const m = getAdjustedStrokeMap(pid); return netScore(getPlayerScores(pid)[h], h, m); }).filter(s => s != null);
      const bNets = teamB.map(pid => { const m = getAdjustedStrokeMap(pid); return netScore(getPlayerScores(pid)[h], h, m); }).filter(s => s != null);
      aScore = aNets.length ? Math.min(...aNets) : null;
      bScore = bNets.length ? Math.min(...bNets) : null;
    } else if (format === "aggregate" || format === "team_total") {
      // Combined team net per hole — both teammates' net scores are summed
      // and compared as a single team score. The Bourbon Cup name for this is
      // "Team Total"; "aggregate" is a legacy alias retained for any matches
      // saved before the format was officially exposed in the FORMATS list.
      const aNets = teamA.map(pid => { const m = getAdjustedStrokeMap(pid); return netScore(getPlayerScores(pid)[h], h, m); });
      const bNets = teamB.map(pid => { const m = getAdjustedStrokeMap(pid); return netScore(getPlayerScores(pid)[h], h, m); });
      if (aNets.every(s => s != null)) aScore = aNets.reduce((a,b) => a+b, 0);
      if (bNets.every(s => s != null)) bScore = bNets.reduce((a,b) => a+b, 0);
    } else if (format === "scramble") {
      // For scramble, team shares one score — use best raw, no individual handicaps
      const aRaws = teamA.map(pid => getPlayerScores(pid)[h]).filter(s => s != null);
      const bRaws = teamB.map(pid => getPlayerScores(pid)[h]).filter(s => s != null);
      // Apply team handicap (avg of players / 2 for scramble)
      const aAvgHI = teamA.reduce((s,p) => s + getPlayerHI(p), 0) / teamA.length;
      const bAvgHI = teamB.reduce((s,p) => s + getPlayerHI(p), 0) / teamB.length;
      const aTeamCH = Math.round(calcCHForCourse(aAvgHI * 0.35, course));
      const bTeamCH = Math.round(calcCHForCourse(bAvgHI * 0.35, course));
      const aMap = getStrokeMap(aTeamCH), bMap = getStrokeMap(bTeamCH);
      aScore = aRaws.length ? netScore(Math.min(...aRaws), h, aMap) : null;
      bScore = bRaws.length ? netScore(Math.min(...bRaws), h, bMap) : null;
    } else if (format === "stableford") {
      const aPid = teamA[0], bPid = teamB[0];
      const aCH = getCH(aPid), bCH = getCH(bPid);
      const aMap = getStrokeMap(aCH), bMap = getStrokeMap(bCH);
      const aNet = netScore(getPlayerScores(aPid)[h], h, aMap);
      const bNet = netScore(getPlayerScores(bPid)[h], h, bMap);
      const sfPts = (net) => { if (net == null) return null; const d = net - holePars[h]; return Math.max(0, 2 - d); };
      aScore = sfPts(aNet);
      bScore = sfPts(bNet);
    } else {
      // Default: match play net
      const aPid = teamA[0], bPid = teamB[0];
      const aMap = getAdjustedStrokeMap(aPid);
      const bMap = getAdjustedStrokeMap(bPid);
      aScore = netScore(getPlayerScores(aPid)[h], h, aMap);
      bScore = netScore(getPlayerScores(bPid)[h], h, bMap);
    }

    let winner = null;
    if (aScore != null && bScore != null) {
      if (format === "stableford") winner = aScore > bScore ? "A" : aScore < bScore ? "B" : null;
      else winner = aScore < bScore ? "A" : aScore > bScore ? "B" : null;
    }
    return { h, aScore, bScore, winner, played: aScore != null && bScore != null };
  });

  // Match-play segment helper — used for both Nassau (front/back/overall)
  // and Traditional (overall only) point allocation. Tracks winner, margin,
  // and whether the segment is complete (either all holes played or
  // mathematically clinched).
  const calcSegment = (holes) => {
    const played = holes.filter(r => r.played);
    if (!played.length) return { winner: null, margin: 0, complete: false };
    const aWins = played.filter(r => r.winner === "A").length;
    const bWins = played.filter(r => r.winner === "B").length;
    const margin = aWins - bWins;
    const remaining = holes.filter(r => !r.played).length;
    // Match play: can be clinched early
    const canWin = Math.abs(margin) > remaining;
    return {
      winner: canWin ? (margin > 0 ? "A" : "B") : played.length === holes.length ? (margin > 0 ? "A" : margin < 0 ? "B" : null) : null,
      margin,
      complete: played.length === holes.length || canWin,
      aWins, bWins, played: played.length, total: holes.length
    };
  };

  // Always compute all three segments so the leaderboard can show
  // front/back progress regardless of point method (the per-hole tracker
  // and "to win" math don't care which method is in use).
  const front = calcSegment(holeResults.slice(0, 9));
  const back = calcSegment(holeResults.slice(9, 18));
  const overall = calcSegment(holeResults);

  // Award points based on the match's configured point_method.
  //   Traditional → single pot for the overall result; ½/½ on a halve.
  //   Nassau      → independent pots for front, back, and overall.
  // Method falls back to Nassau when absent so legacy matches saved
  // before this field existed continue to score correctly.
  const pointMethod = match.point_method || POINT_METHOD_NASSAU;
  const frontPts = { A: 0, B: 0 };
  const backPts = { A: 0, B: 0 };
  const overallPts = { A: 0, B: 0 };

  if (pointMethod === POINT_METHOD_TRADITIONAL) {
    const pot = match.traditional_points ?? 1;
    if (overall.complete) {
      if (overall.winner) overallPts[overall.winner] = pot;
      else { overallPts.A = pot / 2; overallPts.B = pot / 2; }
    }
  } else {
    // Nassau
    const nassau = match.nassau || NASSAU_DEFAULT;
    if (front.complete) {
      if (front.winner) frontPts[front.winner] = nassau.front;
      else { frontPts.A = nassau.front / 2; frontPts.B = nassau.front / 2; }
    }
    if (back.complete) {
      if (back.winner) backPts[back.winner] = nassau.back;
      else { backPts.A = nassau.back / 2; backPts.B = nassau.back / 2; }
    }
    if (overall.complete) {
      if (overall.winner) overallPts[overall.winner] = nassau.overall;
      else { overallPts.A = nassau.overall / 2; overallPts.B = nassau.overall / 2; }
    }

    // Double dot: bonus point for winning the last 3 holes. This is
    // conceptually a Nassau press, so it only applies in Nassau mode —
    // in Traditional there's only a single pot, no presses to add to.
    if (format === "double_dot") {
      const dd = calcSegment(holeResults.slice(15, 18));
      if (dd.complete && dd.winner) {
        overallPts[dd.winner] = (overallPts[dd.winner] || 0) + 1;
      }
    }
  }

  // Current match status string for display
  const playedHoles = holeResults.filter(r => r.played);
  const aUp = overall.aWins - overall.bWins;
  let status = "AS";
  if (playedHoles.length > 0) {
    if (aUp > 0) status = `${aUp}UP (A)`;
    else if (aUp < 0) status = `${Math.abs(aUp)}UP (B)`;
    else status = "AS";
  }

  return {
    holes: holeResults,
    front, back, overall,
    frontPts, backPts, overallPts,
    status,
    holesPlayed: playedHoles.length,
    totalPts: {
      A: (frontPts.A || 0) + (backPts.A || 0) + (overallPts.A || 0),
      B: (frontPts.B || 0) + (backPts.B || 0) + (overallPts.B || 0),
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PRACTICE / TEST EVENT MODE
// ─────────────────────────────────────────────────────────────────────────────
// Self-contained "practice round" feature — separate from main tournament data.
// 8 players → 4 teams of 2 → 2 head-to-head Team Total match-play matches.
//
// Storage:
//   bc_practice_event   — single doc { id: 'current', course_id, hcp_mode,
//                         hcp_overrides, teams: [{id,name,p1,p2}],
//                         matches: [{id,team1,team2}] }
//   bc_practice_scores  — { id, player_id, hole_number (1-18), score }
//   bc_practice_ctp     — { id, hole, player_id }
// (Skins are auto-computed from scores, no Firestore needed.)

// ─────────────────────────────────────────────────────────────────────────────
// Team Total match-play calculation (18 holes)
// ─────────────────────────────────────────────────────────────────────────────
// Per hole: sum each team's net scores. Lower combined net wins the hole.
// Walk all 18; track running cumulative (T1 holes − T2 holes).
// matchResultText: "AS" | "1UP" | "5&4" | "3&2"
// Returns a thru count so the leaderboard knows how far along the match is.
export function computePracticeMatch({ match, scores, course, players, hcpOverrides, hcpMode, teeName }) {
  const empty = { holes: Array(18).fill({ result: null, n1: null, n2: null }), running: Array(18).fill(0), thru: 0, matchResultText: "—", winnerTeamId: null, clinched: false, endHole: 17, holesWon1: 0, holesWon2: 0, dormie: false };
  if (!course || !match) return empty;

  const holePars = course.hole_pars || Array(18).fill(4);
  const holeHcps = course.hole_handicaps || Array(18).fill(9);

  const t1Pids = [match.team1.player1, match.team1.player2].filter(Boolean);
  const t2Pids = [match.team2.player1, match.team2.player2].filter(Boolean);
  const allPids = [...t1Pids, ...t2Pids];
  if (allPids.length < 4) return empty;

  // HI lookup with per-event override support — delegates to the shared
  // helper so override semantics stay identical to tournament scoring.
  const getHI = (pid) => getEffectiveHI(pid, players, hcpOverrides);
  const getCH = (pid) => calcCHForCourse(getHI(pid), course, teeName);

  // Low-man adjustment: low CH plays scratch, others get diff
  const allCHs = allPids.map(getCH);
  const minCH = Math.min(...allCHs);
  const adjustedCH = (pid) => hcpMode === "full" ? getCH(pid) : (getCH(pid) - minCH);

  // Stroke map across 18 holes (shared helper allocates strokes to
  // lowest-hcp holes first; up to 3 wraps for handicaps > 18).
  const strokeMaps = {};
  allPids.forEach(pid => { strokeMaps[pid] = buildStrokeMap(adjustedCH(pid), holeHcps); });

  // Per-hole combined team net
  const holes = [];
  for (let h = 0; h < 18; h++) {
    let n1 = 0, n2 = 0, ok1 = true, ok2 = true;
    for (const pid of t1Pids) {
      const raw = scores[`${pid}_${h}`];
      if (raw == null || raw === 0) { ok1 = false; }
      else { n1 += raw - (strokeMaps[pid][h] || 0); }
    }
    for (const pid of t2Pids) {
      const raw = scores[`${pid}_${h}`];
      if (raw == null || raw === 0) { ok2 = false; }
      else { n2 += raw - (strokeMaps[pid][h] || 0); }
    }
    let result = null;
    if (ok1 && ok2) {
      if (n1 < n2) result = 1;
      else if (n2 < n1) result = -1;
      else result = 0;
    }
    holes.push({ result, n1: ok1 ? n1 : null, n2: ok2 ? n2 : null });
  }

  // Running cumulative; null holes don't change cumulative
  const running = [];
  let cum = 0;
  holes.forEach(hole => {
    if (hole.result !== null) cum += hole.result;
    running.push(cum);
  });

  // Find clinch hole (lead > remaining holes). Only valid BEFORE hole 18 — if
  // a match goes all 18 it's a "XUP" finish, not a clinched "X&0".
  let endHole = 17;
  let margin = Math.abs(running[17]);
  let clinched = false;
  for (let h = 0; h < 18; h++) {
    if (holes[h].result === null) continue;  // can't clinch on unscored hole
    const lead = Math.abs(running[h]);
    const remaining = 17 - h;
    if (remaining > 0 && lead > remaining) { endHole = h; margin = lead; clinched = true; break; }
  }

  // Last completed hole
  let lastCompleted = -1;
  for (let h = 17; h >= 0; h--) {
    if (holes[h].result !== null) { lastCompleted = h; break; }
  }
  const thru = lastCompleted + 1;

  let matchResultText = "—";
  let winnerTeamId = null;
  if (lastCompleted < 0) {
    matchResultText = "—";
  } else if (clinched) {
    const remaining = 17 - endHole;
    matchResultText = `${margin}&${remaining}`;
    winnerTeamId = running[endHole] > 0 ? match.team1.id : match.team2.id;
  } else if (lastCompleted === 17) {
    const final = running[17];
    if (final === 0) matchResultText = "AS";
    else { matchResultText = `${Math.abs(final)}UP`; winnerTeamId = final > 0 ? match.team1.id : match.team2.id; }
  } else {
    // In progress
    const cur = running[lastCompleted];
    const remaining = 17 - lastCompleted;
    if (cur === 0) matchResultText = "AS";
    else if (Math.abs(cur) === remaining) matchResultText = `${Math.abs(cur)}UP (Dormie)`;
    else matchResultText = `${Math.abs(cur)}UP`;
  }

  const dormie = !clinched && lastCompleted >= 0 && lastCompleted < 17 && Math.abs(running[lastCompleted]) === (17 - lastCompleted);

  return {
    holes,
    running,
    thru,
    matchResultText,
    winnerTeamId,
    clinched,
    endHole,
    holesWon1: holes.filter(h => h.result === 1).length,
    holesWon2: holes.filter(h => h.result === -1).length,
    dormie,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Skins — auto-computed from scores (gross + net)
// ─────────────────────────────────────────────────────────────────────────────
// For each hole: lowest gross unique → gross skin; lowest net unique → net skin.
// Tie = no skin on that hole. Returns { gross: {h: pid|null}, net: {h: pid|null} }.
export function computePracticeSkins({ scores, players, course, hcpOverrides, teeName }) {
  const result = { gross: {}, net: {}, strokeMaps: {} };
  if (!course || !players.length) return result;

  const holeHcps = course.hole_handicaps || Array(18).fill(9);
  const getHI = (pid) => getEffectiveHI(pid, players, hcpOverrides);
  const getCH = (pid) => calcCHForCourse(getHI(pid), course, teeName);

  // Each player gets their FULL course handicap for skins (not low-man adjusted —
  // skins are an individual side game, not match play). Standard practice.
  const strokeMaps = {};
  players.forEach(p => { strokeMaps[p.player_id] = buildStrokeMap(getCH(p.player_id), holeHcps); });

  for (let h = 0; h < 18; h++) {
    const grossEntries = [];
    const netEntries = [];
    for (const p of players) {
      const raw = scores[`${p.player_id}_${h}`];
      if (raw == null || raw === 0) continue;
      grossEntries.push({ pid: p.player_id, score: raw });
      netEntries.push({ pid: p.player_id, score: raw - (strokeMaps[p.player_id][h] || 0) });
    }
    if (grossEntries.length < 2) { result.gross[h] = null; result.net[h] = null; continue; }

    // Gross skin
    grossEntries.sort((a, b) => a.score - b.score);
    if (grossEntries[0].score < grossEntries[1].score) result.gross[h] = grossEntries[0].pid;
    else result.gross[h] = null;

    // Net skin
    netEntries.sort((a, b) => a.score - b.score);
    if (netEntries[0].score < netEntries[1].score) result.net[h] = netEntries[0].pid;
    else result.net[h] = null;
  }
  // Expose the per-player stroke maps so the UI can render stroke
  // dots and net scores per hole. The maps are already computed for
  // skin determination; surfacing them avoids re-computing the same
  // thing in the betting view.
  result.strokeMaps = strokeMaps;
  return result;
}
