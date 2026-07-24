// ══════════════════════════════════════════════════════════════════
//  Scoring engine — two orthogonal axes + handicap allowance.
// ══════════════════════════════════════════════════════════════════
//
// Axis 1  FORMAT      — how each hole's team number is derived.
// Axis 2  RESOLUTION  — how the 18 hole outcomes become a match result.
//
// A director configures a match as (format × resolution × allowance).
// Most stroke-play formats (Team Bestball, Shamble, Pinehurst) accept
// any of Nassau / Single match / Total strokes. The points-native
// formats bring their own resolver (Modified Stableford → points total,
// Hi/Lo → low+high points).
//
// Everything here is pure and parameterized — the CH math is reused from
// scoring.js so there is ONE source of truth for strokes. This module is
// the intended future core; computeMatchResult will become a thin adapter
// over it (next phase, once its callers are wired).
import { calcCHForCourse, getEffectiveHI, buildStrokeMap } from "./scoring";

// ── Registry metadata (drives the director's format/resolution pickers) ──
export const RESOLUTIONS = {
  nassau:        { label: "Nassau (front / back / overall)" },
  single_match:  { label: "Single match (18-hole match play)" },
  total_strokes: { label: "Total strokes (low net total wins)" },
  points_total:  { label: "Points total (high points win)" },
  hi_lo_points:  { label: "Hi/Lo points (low + high per hole)" },
};

// `allowance` describes the director's handicap-allowance setting.
//   { enabled, type: "single"|"split", pct, lowPct, highPct }
// Defaults live on each format so the toggle starts at the conventional
// value and the director can override the amounts.
export const FORMATS = {
  team_bestball: {
    label: "Team Bestball", scorer: "bestN",
    resolutions: ["nassau", "single_match", "total_strokes"],
    scorerOpts: { bestN: 1 },
    allowanceDefault: { enabled: false, type: "single", pct: 100 },
  },
  shamble: {
    label: "Shamble", scorer: "bestN",
    resolutions: ["nassau", "single_match", "total_strokes"],
    scorerOpts: { bestN: 2 },
    allowanceDefault: { enabled: true, type: "single", pct: 90 },
  },
  pinehurst: {
    label: "Pinehurst (Chapman)", scorer: "teamBall",
    resolutions: ["nassau", "single_match", "total_strokes"],
    allowanceDefault: { enabled: true, type: "split", lowPct: 60, highPct: 40 },
  },
  hi_lo: {
    label: "Hi/Lo (Double Dot)", scorer: "hiLo",
    resolutions: ["hi_lo_points"],
    allowanceDefault: { enabled: false, type: "single", pct: 100 },
  },
  modified_stableford: {
    label: "Modified Stableford", scorer: "stableford",
    resolutions: ["points_total"],
    // Eagle +5 (Albatross +8), Birdie +2, Par 0, Bogey -1, Double+ -3.
    scorerOpts: { table: { "-3": 8, "-2": 5, "-1": 2, "0": 0, "1": -1, "2": -3 }, teamMode: "sum" },
    allowanceDefault: { enabled: false, type: "single", pct: 100 },
  },
};

// ── Handicap allowance ──────────────────────────────────────────────
// Applied to a player's Course Handicap BEFORE the low-man match-play
// adjustment. "single" scales one player's CH (Shamble 90%, Scramble
// 35%); "split" combines a team's low/high CH (Pinehurst 60/40).
export function applyAllowanceSingle(ch, allowance) {
  if (!allowance?.enabled || allowance.type !== "single") return ch;
  return Math.round(ch * (allowance.pct ?? 100) / 100);
}
export function teamAllowanceSplit(lowCH, highCH, allowance) {
  const lo = allowance?.lowPct ?? 60, hi = allowance?.highPct ?? 40;
  return Math.round(lowCH * lo / 100 + highCH * hi / 100);
}

// ── Net-score context ───────────────────────────────────────────────
// Resolves each player's stroke-adjusted net per hole, honoring the
// allowance (single) and handicap mode (full / low_man). Returns helpers
// the scorers use so no scorer re-touches CH math.
function buildContext(cfg) {
  const { teamA, teamB, course, players, hcpOverrides, teeAssignments,
          handicapMode = "low_man", allowance } = cfg;
  const holePars = course.hole_pars || Array(18).fill(4);
  const holeHcps = course.hole_handicaps || Array(18).fill(9);
  const allPids = [...teamA, ...teamB];

  const rawCH = (pid) =>
    calcCHForCourse(getEffectiveHI(pid, players, hcpOverrides), course, teeAssignments?.[pid]);

  // single-allowance scaled CH (split allowance is handled by the teamBall scorer)
  const scaledCH = {};
  allPids.forEach(pid => { scaledCH[pid] = applyAllowanceSingle(rawCH(pid), allowance); });
  const minCH = Math.min(...allPids.map(p => scaledCH[p]));
  const playingCH = (pid) => handicapMode === "full" ? scaledCH[pid] : scaledCH[pid] - minCH;

  const strokeMaps = {};
  allPids.forEach(pid => { strokeMaps[pid] = buildStrokeMap(playingCH(pid), holeHcps); });

  const scoreOf = (pid, h) => cfg.scores[`${pid}_${h}`];
  const netOf = (pid, h) => {
    const g = scoreOf(pid, h);
    return (g == null || g === 0) ? null : g - (strokeMaps[pid][h] || 0);
  };
  return { holePars, holeHcps, rawCH, strokeMaps, scoreOf, netOf, teamA, teamB };
}

const lowest = (arr, n) => [...arr].sort((a, b) => a - b).slice(0, n);
const sum = (arr) => arr.reduce((a, b) => a + b, 0);

// ── Per-hole SCORERS ────────────────────────────────────────────────
// Each returns a per-hole object. Stroke-play scorers return
// { a, b, higherWins }. Hi/Lo returns the four balls it needs.
const SCORERS = {
  // best N net balls per team (bestball = 1, shamble = 2)
  bestN: (ctx, h, opts) => {
    const n = opts?.bestN ?? 1;
    const aNets = ctx.teamA.map(p => ctx.netOf(p, h)).filter(v => v != null);
    const bNets = ctx.teamB.map(p => ctx.netOf(p, h)).filter(v => v != null);
    const need = Math.min(n, ctx.teamA.length, ctx.teamB.length);
    const a = aNets.length >= need ? sum(lowest(aNets, n)) : null;
    const b = bNets.length >= need ? sum(lowest(bNets, n)) : null;
    return { a, b, higherWins: false };
  },
  // one team ball per hole; team CH via split allowance (Pinehurst).
  // Convention: the team's single gross is stored under its FIRST pid.
  teamBall: (ctx, h, opts, cfg) => {
    const teamNet = (team) => {
      const chs = team.map(ctx.rawCH);
      const lo = Math.min(...chs), hi = Math.max(...chs);
      const teamCH = teamAllowanceSplit(lo, hi, cfg.allowance);
      const map = buildStrokeMap(teamCH, ctx.holeHcps);
      const gross = ctx.scoreOf(team[0], h);
      return (gross == null || gross === 0) ? null : gross - (map[h] || 0);
    };
    return { a: teamNet(ctx.teamA), b: teamNet(ctx.teamB), higherWins: false };
  },
  // low ball vs low ball, high ball vs high ball (net)
  hiLo: (ctx, h) => {
    const aNets = ctx.teamA.map(p => ctx.netOf(p, h)).filter(v => v != null);
    const bNets = ctx.teamB.map(p => ctx.netOf(p, h)).filter(v => v != null);
    if (aNets.length < 2 || bNets.length < 2) return { played: false };
    return {
      aLow: Math.min(...aNets), aHigh: Math.max(...aNets),
      bLow: Math.min(...bNets), bHigh: Math.max(...bNets), played: true,
    };
  },
  // modified stableford points vs par (net); team = sum or best
  stableford: (ctx, h, opts) => {
    const table = opts?.table || { "-2": 5, "-1": 2, "0": 0, "1": -1, "2": -3 };
    const pts = (net) => {
      if (net == null) return null;
      const d = Math.max(-3, Math.min(2, net - ctx.holePars[h]));
      return table[String(d)] ?? 0;
    };
    const teamPts = (team) => {
      const ps = team.map(p => pts(ctx.netOf(p, h))).filter(v => v != null);
      if (!ps.length) return null;
      return opts?.teamMode === "best" ? Math.max(...ps) : sum(ps);
    };
    return { a: teamPts(ctx.teamA), b: teamPts(ctx.teamB), higherWins: true };
  },
};

// per-hole winner for stroke-play scorers ("A" | "B" | null)
const holeWinner = (cell) => {
  if (cell.a == null || cell.b == null) return { winner: null, played: false };
  const aBetter = cell.higherWins ? cell.a > cell.b : cell.a < cell.b;
  const bBetter = cell.higherWins ? cell.a < cell.b : cell.a > cell.b;
  return { winner: aBetter ? "A" : bBetter ? "B" : null, played: true };
};

// ── RESOLVERS ───────────────────────────────────────────────────────
// match-play over a slice of holes → margin, clinch, result text
function matchPlaySegment(cells) {
  const wins = cells.map(holeWinner);
  const played = wins.filter(w => w.played).length;
  if (!played) return { winner: null, margin: 0, text: "—", complete: false, thru: 0 };
  let aUp = 0, thru = 0;
  wins.forEach((w) => { if (w.played) { thru++; if (w.winner === "A") aUp++; else if (w.winner === "B") aUp--; } });
  const remaining = cells.length - played;
  const clinched = Math.abs(aUp) > remaining && remaining > 0;
  const complete = played === cells.length || clinched;
  let text = "AS", winner = null;
  if (aUp !== 0) winner = aUp > 0 ? "A" : "B";
  if (clinched) text = `${Math.abs(aUp)}&${remaining}`;
  else if (played === cells.length) text = aUp === 0 ? "AS" : `${Math.abs(aUp)}UP`;
  else text = aUp === 0 ? "AS" : `${Math.abs(aUp)}UP`;
  return { winner: complete ? winner : null, margin: aUp, text, complete, thru, remaining };
}

const half = (mp) => mp / 2;

const RESOLVERS = {
  nassau: (cells, cfg) => {
    const n = cfg.nassau || { front: 1, back: 1, overall: 1 };
    const seg = (slice) => matchPlaySegment(slice);
    const f = seg(cells.slice(0, 9)), b = seg(cells.slice(9, 18)), o = seg(cells);
    const pts = { A: 0, B: 0 };
    const award = (s, val) => { if (!s.complete) return; if (s.winner) pts[s.winner] += val; else { pts.A += half(val); pts.B += half(val); } };
    award(f, n.front); award(b, n.back); award(o, n.overall);
    return { method: "nassau", front: f, back: b, overall: o, points: pts, status: o.text };
  },
  single_match: (cells, cfg) => {
    const mp = cfg.matchPoints ?? 1;
    const o = matchPlaySegment(cells);
    const pts = { A: 0, B: 0 };
    if (o.complete) { if (o.winner) pts[o.winner] += mp; else { pts.A += half(mp); pts.B += half(mp); } }
    return { method: "single_match", result: o, points: pts, status: o.text };
  },
  total_strokes: (cells, cfg) => {
    const mp = cfg.matchPoints ?? 1;
    let a = 0, b = 0, played = 0;
    cells.forEach(c => { if (c.a != null && c.b != null) { a += c.a; b += c.b; played++; } });
    const complete = played === cells.length;
    const winner = a < b ? "A" : a > b ? "B" : null;
    const pts = { A: 0, B: 0 };
    if (complete) { if (winner) pts[winner] += mp; else { pts.A += half(mp); pts.B += half(mp); } }
    return { method: "total_strokes", totals: { A: a, B: b }, winner: complete ? winner : null, points: pts, status: `${a}-${b}` };
  },
  points_total: (cells, cfg) => {
    const mp = cfg.matchPoints ?? 1;
    let a = 0, b = 0, played = 0;
    cells.forEach(c => { if (c.a != null && c.b != null) { a += c.a; b += c.b; played++; } });
    const complete = played === cells.length;
    const winner = a > b ? "A" : a < b ? "B" : null; // high points win
    const pts = { A: 0, B: 0 };
    if (complete) { if (winner) pts[winner] += mp; else { pts.A += half(mp); pts.B += half(mp); } }
    return { method: "points_total", totals: { A: a, B: b }, winner: complete ? winner : null, points: pts, status: `${a}-${b} pts` };
  },
  // 2 points per hole: one for low ball, one for high ball (lower net wins each)
  hi_lo_points: (cells, cfg) => {
    const mp = cfg.matchPoints ?? 1; // points multiplier per dot
    let aPts = 0, bPts = 0, lowA = 0, lowB = 0, highA = 0, highB = 0;
    cells.forEach(c => {
      if (!c.played) return;
      if (c.aLow < c.bLow) { aPts += mp; lowA++; } else if (c.bLow < c.aLow) { bPts += mp; lowB++; }
      if (c.aHigh < c.bHigh) { aPts += mp; highA++; } else if (c.bHigh < c.aHigh) { bPts += mp; highB++; }
    });
    const winner = aPts > bPts ? "A" : bPts > aPts ? "B" : null;
    return { method: "hi_lo_points", points: { A: aPts, B: bPts }, low: { A: lowA, B: lowB }, high: { A: highA, B: highB }, winner, status: `${aPts}-${bPts}` };
  },
};

// ── Orchestrator ────────────────────────────────────────────────────
// cfg: { teamA, teamB, scores, course, players, format, resolution,
//        handicapMode, allowance, teeAssignments, hcpOverrides,
//        nassau, matchPoints, scorerOpts }
export function computeFormatMatch(cfg) {
  const fmt = FORMATS[cfg.format];
  if (!fmt) throw new Error(`Unknown format: ${cfg.format}`);
  const resolution = cfg.resolution || fmt.resolutions[0];
  const allowance = cfg.allowance || fmt.allowanceDefault;
  const opts = { ...fmt.scorerOpts, ...cfg.scorerOpts };

  const ctx = buildContext({ ...cfg, allowance });
  const scorer = SCORERS[fmt.scorer];
  const cells = Array.from({ length: 18 }, (_, h) => scorer(ctx, h, opts, { ...cfg, allowance }));

  const resolver = RESOLVERS[resolution];
  if (!resolver) throw new Error(`Unknown resolution: ${resolution}`);
  const result = resolver(cells, cfg);
  return { format: cfg.format, resolution, allowance, cells, ...result };
}
