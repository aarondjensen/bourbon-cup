import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, setDoc, getDocs, query, where, writeBatch, onSnapshot, deleteDoc } from "firebase/firestore";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ─── BOURBON CUP THEME ───
// `BC` is mutated in place when the user toggles dark/light mode. The mutation
// pattern (vs. swapping the reference) is intentional: every component holds
// a stale closure over `BC` from when the module loaded, but since they all
// point to the SAME object, mutating its keys updates every consumer at once.
// React picks up the visual change because the App-level `darkMode` state
// transition triggers a top-level re-render that propagates down — children
// re-read the now-updated BC values inline in JSX.
//
// Borrowed from the MNQ pattern: getTheme(mode) → applyTheme(mode) mutates K.
const getBCTheme = (mode) => {
  if (mode === "light") {
    return {
      bg: "#faf6ec",        // warm cream — bourbon-soaked parchment
      card: "#ffffff",      // pure white card surface
      inp: "#f1ead8",       // input / inactive
      hover: "#e8e0c9",     // hover
      bdr: "#d8cdb0",       // warm border
      t1: "#2a2010",        // ink — dark warm brown for primary text
      t2: "#6b5d47",        // medium warm
      t3: "#9c8d72",        // muted warm
      amber: "#a8730a",     // bourbon gold (slightly darker for contrast on white)
      amberGlow: "rgba(168,115,10,0.12)",
      amberDim: "#7a5505",
      gold: "#b8870a",      // brighter gold
      goldGlow: "rgba(184,135,10,0.12)",
      danger: "#dc2626",
      warn: "#d97706",
      green: "#059669",
    };
  }
  // dark (default)
  return {
    bg: "#0a0804",
    card: "#12100d",
    inp: "#0d0b09",
    hover: "#1a1612",
    bdr: "#2a2218",
    t1: "#f0e8d8",
    t2: "#b8a98a",
    t3: "#6b5d47",
    amber: "#c8860a",
    amberGlow: "rgba(200,134,10,0.15)",
    amberDim: "#8a5c07",
    gold: "#d4a843",
    goldGlow: "rgba(212,168,67,0.12)",
    danger: "#ef4444",
    warn: "#f59e0b",
    green: "#22c55e",
  };
};

// Read saved preference (default: dark). Wrapped in try/catch so SSR or
// blocked-localStorage envs don't crash module load.
const _bcSavedMode = (() => {
  try {
    return typeof window !== "undefined" && localStorage.getItem("bc_theme") === "light" ? "light" : "dark";
  } catch { return "dark"; }
})();
const BC = { ...getBCTheme(_bcSavedMode) };
const applyBCTheme = (mode) => {
  const next = getBCTheme(mode);
  for (const key in next) BC[key] = next[key];
};

// ── Inject global styles ──
// The body bg is set on initial load so the page paints the correct theme
// before React mounts. A useEffect in App keeps it in sync when the user
// toggles the theme (the inline rule below would otherwise be stale).
const _style = document.createElement("style");
_style.id = "bc-global-style";
_style.textContent = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #root { height: 100%; width: 100%; background: ${BC.bg}; overflow: hidden; }
  body { margin: 0; padding: 0; }
`;
document.head.appendChild(_style);

// ── Inject Montserrat font ──
const _link = document.createElement("link");
_link.rel = "stylesheet";
_link.href = "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap";
document.head.appendChild(_link);

const TROPHY_PHOTO = "/trophy_photo.png";
const LOGO_TEAM_A = "/mash_brothers_logo_on_black.png";
const LOGO_TEAM_A_WHITE = "/mash_brothers_logo_on_white.png";
const LOGO_TEAM_B = "/shot_callers_logo.png";
const SHOT_CALLERS_LOGO = "/shot_callers_logo.png";
const TROPHY_SILHOUETTE = "/trophy_logo_silhouette.png";

let TEAM_A = { id: "A", name: "Team Alpha", color: "#004d24", accent: "#009144", glow: "rgba(0,145,68,0.2)", short: "α", logo: LOGO_TEAM_A };
let TEAM_B = { id: "B", name: "Team Beta",  color: "#0d3235", accent: "#3A96A0", glow: "rgba(58,150,160,0.2)", short: "β", logo: LOGO_TEAM_B };

const FORMATS = [
  { id: "singles",        label: "Singles",            desc: "Match play, 1v1. Nassau scored: front 9, back 9, overall.", nassau: { front: 1, back: 1, overall: 1 }, scoringType: "nassau" },
  { id: "best_ball",      label: "2-Man Best Ball",    desc: "Each player plays their own ball, team uses the better net score per hole. Nassau scored.", nassau: { front: 1, back: 1, overall: 2 }, scoringType: "nassau" },
  { id: "team_total",     label: "Team Total",         desc: "Combined team net per hole vs combined team net. Lower combined wins the hole. Nassau scored.", nassau: { front: 1, back: 1, overall: 2 }, scoringType: "nassau" },
  { id: "pinehurst",      label: "Pinehurst",          desc: "Partners each drive, swap balls, then choose best to finish as scramble. Nassau scored.", nassau: { front: 1, back: 1, overall: 2 }, scoringType: "nassau" },
  { id: "team_best_ball", label: "Team Best Ball",     desc: "Full team format — custom scoring applies. See director for point structure.", nassau: { front: 0, back: 0, overall: 0 }, scoringType: "custom" },
  { id: "double_dot",     label: "Double Dot",         desc: "Nassau with automatic press on the back 9 and last 3 holes.", nassau: { front: 1, back: 1, overall: 2 }, scoringType: "nassau" },
  { id: "shamble",        label: "Shamble",            desc: "All players drive, choose best drive, each plays their own ball in. Nassau scored.", nassau: { front: 1, back: 1, overall: 2 }, scoringType: "nassau" },
  { id: "scramble",       label: "2-Man Scramble",     desc: "Both hit every shot, choose best ball location, both play from there. Nassau scored.", nassau: { front: 1, back: 1, overall: 2 }, scoringType: "nassau" },
  { id: "tilt",           label: "2-Man Tilt",         desc: "4-point match: 1pt per side, 2pt overall. No individual Nassau components.", nassau: { front: 0, back: 0, overall: 4 }, scoringType: "tilt" },
  { id: "stableford",     label: "2-Man Stableford",   desc: "Points per hole: eagle=4, birdie=3, par=2, bogey=1. Nassau scored.", nassau: { front: 1, back: 1, overall: 2 }, scoringType: "nassau" },
];

const NASSAU_DEFAULT = { front: 1, back: 1, overall: 1 };

// ── Firebase ──
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCvR8I_5N0tXIXaPRkvsvBMzKfUY1_KzA0",
  authDomain: "the-bourbon-cup.firebaseapp.com",
  projectId: "the-bourbon-cup",
  storageBucket: "the-bourbon-cup.firebasestorage.app",
  messagingSenderId: "957218531964",
  appId: "1:957218531964:web:753b42a551463fd50537f9",
};
const TOURNAMENT_ID = "bc_2025";
const _app = initializeApp(FIREBASE_CONFIG);
const _db = getFirestore(_app);

const db = {
  _q: (col, filters = []) => {
    const ref = collection(_db, col);
    return filters.length ? query(ref, ...filters.map(f => where(f.field, f.op, f.value))) : ref;
  },
  get: async (col, filters = []) => {
    try { const s = await getDocs(db._q(col, filters)); return s.docs.map(d => d.data()); }
    catch(e) { console.error("db.get", col, e); return []; }
  },
  upsert: async (col, data) => {
    if (!data.id) return null;
    try { await setDoc(doc(_db, col, String(data.id)), data, { merge: true }); return data; }
    catch(e) { console.error("db.upsert", col, e); return null; }
  },
  delete: async (col, id) => {
    try { await deleteDoc(doc(_db, col, String(id))); return true; }
    catch(e) { console.error("db.delete", col, e); return null; }
  },
  subscribe: (col, filters = [], cb) => {
    try {
      return onSnapshot(db._q(col, filters), snap => cb(snap.docs.map(d => d.data())), e => console.error("subscribe", e));
    } catch(e) { console.error("subscribe setup", e); return () => {}; }
  },
};

// ── Helpers ──
const calcCH = (hi, slope, rating, par) => (!hi && hi !== 0) ? 0 : Math.round((hi * (slope / 113)) + (rating - par));
const fmtScore = (n) => n == null ? "—" : n === 0 ? "E" : n > 0 ? `+${n}` : `${n}`;
const getTeam = (tid) => tid === "A" ? TEAM_A : TEAM_B;
const oppTeam = (tid) => tid === "A" ? TEAM_B : TEAM_A;
// First+last initials from a player's full name. "Aaron Jensen" → "AJ".
// Single-name fallback grabs the first two letters (e.g. "Joe" → "JO") so a
// missing surname doesn't produce a one-character badge that breaks the
// 2-char width alignment elsewhere.
const getInitials = (name) => {
  if (!name) return "??";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "??";
  if (parts.length === 1) return (parts[0].slice(0, 2) || "??").toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

// ── ScoreCell ──
// Single-cell rendering of a player's score on one hole, used in the full
// scorecard popup. Mirrors MNQ's visualization:
//   - Stroke dots ("•") on a tiny row above the score
//   - Birdie (-1) → single circle outline
//   - Eagle/Albatross (-2 or better) → nested circles
//   - Bogey (+1) → single square outline
//   - Double bogey or worse (+2+) → nested squares
//   - Par or empty → no overlay
// `colorOverride` lets the cell render in a non-default color (e.g. red for an
// absent player). Empty cells still show stroke-dot row + a placeholder dot,
// so column alignment stays consistent before and after a score is entered.
const ScoreCell = ({ score, par, strokes, size = 13, colorOverride }) => {
  const sh = size + 8;          // outer shape size (square or circle)
  const dotH = 10;              // height of stroke-dots row above the score
  const bc = colorOverride || BC.t2;
  const empty = !score || score <= 0;

  if (empty) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", height: dotH + sh, justifyContent: "flex-end" }}>
        <div style={{ height: dotH, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          {strokes > 0 && <span style={{ color: colorOverride || "#4ba3d4", fontSize: 10, fontWeight: 900, letterSpacing: 1, lineHeight: 1 }}>{"•".repeat(strokes)}</span>}
        </div>
        <div style={{ width: sh, height: sh, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: BC.t3 + "30", fontSize: size, lineHeight: 1 }}>·</span>
        </div>
      </div>
    );
  }

  const diff = score - par;
  let border = null;
  if (diff <= -2) {
    border = (
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: sh, height: sh, borderRadius: "50%", border: `1.5px solid ${bc}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: sh - 6, height: sh - 6, borderRadius: "50%", border: `1px solid ${bc}` }} />
      </div>
    );
  } else if (diff === -1) {
    border = <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: sh, height: sh, borderRadius: "50%", border: `1.5px solid ${bc}` }} />;
  } else if (diff === 1) {
    border = <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: sh, height: sh, borderRadius: 3, border: `1.5px solid ${bc}` }} />;
  } else if (diff >= 2) {
    border = (
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: sh, height: sh, borderRadius: 3, border: `1.5px solid ${bc}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: sh - 6, height: sh - 6, borderRadius: 2, border: `1px solid ${bc}` }} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", height: dotH + sh, justifyContent: "flex-end" }}>
      <div style={{ height: dotH, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
        {strokes > 0 && <span style={{ color: colorOverride || "#4ba3d4", fontSize: 10, fontWeight: 900, letterSpacing: 1, lineHeight: 1 }}>{"•".repeat(strokes)}</span>}
      </div>
      <div style={{ position: "relative", width: sh, height: sh, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {border}
        <span style={{ position: "relative", zIndex: 1, fontSize: size, fontWeight: 700, lineHeight: 1, color: colorOverride || BC.t1, transform: "translateY(0.5px)" }}>{score}</span>
      </div>
    </div>
  );
};

// ── Match Scoring Engine ──
function computeMatchResult(match, holeData, courses, tRounds, tPlayers, format, hcpOverrides, handicapMode) {
  // holeData: { pid_round: { holeIdx: score } }
  const rnd = match.round;
  const tr = tRounds.find(t => t.round_number === rnd);
  const course = courses.find(c => c.id === tr?.course_id);
  if (!course) return { status: "AS", frontPts: 0, backPts: 0, overallPts: 0, holes: [] };

  const holePars = course.hole_pars || Array(18).fill(4);
  const holeHcps = course.hole_handicaps || Array(18).fill(9);

  const getPlayerScores = (pid) => holeData[`${pid}_${rnd}`] || {};
  const getPlayerHI = (pid) => {
    const roundOverrides = hcpOverrides?.[rnd] || {};
    if (roundOverrides[pid] !== undefined && roundOverrides[pid] !== "") return parseFloat(roundOverrides[pid]) || 0;
    const tp = tPlayers.find(t => t.player_id === pid);
    return parseFloat(tp?.handicap_index) || 0;
  };
  const getCH = (pid) => {
    const hi = getPlayerHI(pid);
    return calcCH(hi, course.slope || 113, course.rating || 72, course.par || 72);
  };
  const getStrokeMap = (ch) => {
    const sorted = holeHcps.map((h,i) => ({ idx: i, hcp: h })).sort((a,b) => a.hcp - b.hcp);
    const map = {};
    let rem = Math.abs(ch);
    const sign = ch >= 0 ? 1 : -1;
    for (let pass = 0; pass < 3 && rem > 0; pass++) {
      for (const h of sorted) { if (rem <= 0) break; map[h.idx] = (map[h.idx] || 0) + sign; rem--; }
    }
    return map;
  };
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
      const aTeamCH = Math.round(calcCH(aAvgHI * 0.35, course.slope || 113, course.rating || 72, course.par || 72));
      const bTeamCH = Math.round(calcCH(bAvgHI * 0.35, course.slope || 113, course.rating || 72, course.par || 72));
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

  // Nassau scoring
  const nassau = match.nassau || NASSAU_DEFAULT;
  const calcNassauSegment = (holes) => {
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

  const front = calcNassauSegment(holeResults.slice(0, 9));
  const back = calcNassauSegment(holeResults.slice(9, 18));
  const overall = calcNassauSegment(holeResults);

  // Award points
  const frontPts = { A: 0, B: 0 };
  const backPts = { A: 0, B: 0 };
  const overallPts = { A: 0, B: 0 };
  const halfPt = nassau.front / 2;

  if (front.complete) {
    if (front.winner) frontPts[front.winner] = nassau.front;
    else { frontPts.A = halfPt; frontPts.B = halfPt; }
  }
  if (back.complete) {
    if (back.winner) backPts[back.winner] = nassau.back;
    else { backPts.A = nassau.back / 2; backPts.B = nassau.back / 2; }
  }
  if (overall.complete) {
    if (overall.winner) overallPts[overall.winner] = nassau.overall;
    else { overallPts.A = nassau.overall / 2; overallPts.B = nassau.overall / 2; }
  }

  // Double dot: auto double on holes 16-18
  if (format === "double_dot") {
    const lastHoles = holeResults.slice(15, 18);
    const dd = calcNassauSegment(lastHoles);
    // extra point for winning 16-18 segment
    if (dd.complete) {
      if (dd.winner) overallPts[dd.winner] = (overallPts[dd.winner] || 0) + 1;
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

// 4 distinct team colors for the practice mode (independent of Mash/Shot)
const PRACTICE_TEAM_COLORS = [
  { color: "#1f4d2b", accent: "#3db461", glow: "rgba(61,180,97,0.2)" },   // green
  { color: "#0f3a52", accent: "#4ba3d4", glow: "rgba(75,163,212,0.2)" },  // blue
  { color: "#5a2d0f", accent: "#d48845", glow: "rgba(212,136,69,0.2)" }, // orange/copper
  { color: "#3a1f4d", accent: "#a063d4", glow: "rgba(160,99,212,0.2)" }, // purple
];

// ─────────────────────────────────────────────────────────────────────────────
// Team Total match-play calculation (18 holes)
// ─────────────────────────────────────────────────────────────────────────────
// Per hole: sum each team's net scores. Lower combined net wins the hole.
// Walk all 18; track running cumulative (T1 holes − T2 holes).
// matchResultText: "AS" | "1UP" | "5&4" | "3&2"
// Returns a thru count so the leaderboard knows how far along the match is.
function computePracticeMatch({ match, scores, course, players, hcpOverrides, hcpMode }) {
  const empty = { holes: Array(18).fill({ result: null, n1: null, n2: null }), running: Array(18).fill(0), thru: 0, matchResultText: "—", winnerTeamId: null, clinched: false, endHole: 17, holesWon1: 0, holesWon2: 0, dormie: false };
  if (!course || !match) return empty;

  const holePars = course.hole_pars || Array(18).fill(4);
  const holeHcps = course.hole_handicaps || Array(18).fill(9);

  const t1Pids = [match.team1.player1, match.team1.player2].filter(Boolean);
  const t2Pids = [match.team2.player1, match.team2.player2].filter(Boolean);
  const allPids = [...t1Pids, ...t2Pids];
  if (allPids.length < 4) return empty;

  // HI lookup with per-event override support
  const getHI = (pid) => {
    if (hcpOverrides && hcpOverrides[pid] !== undefined && hcpOverrides[pid] !== "") {
      return parseFloat(hcpOverrides[pid]) || 0;
    }
    const tp = players.find(t => t.player_id === pid);
    return parseFloat(tp?.handicap_index) || 0;
  };
  const getCH = (pid) => calcCH(getHI(pid), course.slope || 113, course.rating || 72, course.par || 72);

  // Low-man adjustment: low CH plays scratch, others get diff
  const allCHs = allPids.map(getCH);
  const minCH = Math.min(...allCHs);
  const adjustedCH = (pid) => hcpMode === "full" ? getCH(pid) : (getCH(pid) - minCH);

  // Stroke map across 18 holes (allocates strokes to lowest-hcp holes first)
  const buildStrokeMap = (ch) => {
    const sorted = holeHcps.map((h, i) => ({ idx: i, hcp: h })).sort((a, b) => a.hcp - b.hcp);
    const map = {};
    let rem = Math.abs(ch);
    for (let pass = 0; pass < 3 && rem > 0; pass++) {
      for (const h of sorted) { if (rem <= 0) break; map[h.idx] = (map[h.idx] || 0) + 1; rem--; }
    }
    return map;
  };
  const strokeMaps = {};
  allPids.forEach(pid => { strokeMaps[pid] = buildStrokeMap(adjustedCH(pid)); });

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
function computePracticeSkins({ scores, players, course, hcpOverrides }) {
  const result = { gross: {}, net: {} };
  if (!course || !players.length) return result;

  const holeHcps = course.hole_handicaps || Array(18).fill(9);
  const getHI = (pid) => {
    if (hcpOverrides && hcpOverrides[pid] !== undefined && hcpOverrides[pid] !== "") {
      return parseFloat(hcpOverrides[pid]) || 0;
    }
    const tp = players.find(t => t.player_id === pid);
    return parseFloat(tp?.handicap_index) || 0;
  };
  const getCH = (pid) => calcCH(getHI(pid), course.slope || 113, course.rating || 72, course.par || 72);

  // Each player gets their FULL course handicap for skins (not low-man adjusted —
  // skins are an individual side game, not match play). Standard practice.
  const buildStrokeMap = (ch) => {
    const sorted = holeHcps.map((h, i) => ({ idx: i, hcp: h })).sort((a, b) => a.hcp - b.hcp);
    const map = {};
    let rem = Math.abs(ch);
    for (let pass = 0; pass < 3 && rem > 0; pass++) {
      for (const h of sorted) { if (rem <= 0) break; map[h.idx] = (map[h.idx] || 0) + 1; rem--; }
    }
    return map;
  };
  const strokeMaps = {};
  players.forEach(p => { strokeMaps[p.player_id] = buildStrokeMap(getCH(p.player_id)); });

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
  return result;
}


// ── Notification Toast ──
function Notif({ notif }) {
  if (!notif) return null;
  return (
    <div style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
      background: notif.type === "error" ? "#7f1d1d" : "#1a2d1a", border: `1px solid ${notif.type === "error" ? "#ef4444" : "#22c55e"}`,
      borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 600, color: "#f0e8d8",
      boxShadow: "0 4px 24px rgba(0,0,0,0.6)", maxWidth: "80vw", textAlign: "center" }}>
      {notif.msg}
    </div>
  );
}

// ── Login Screen ──
const DIRECTOR_CODE = "bcdir2025";
function LoginScreen({ players, onLogin, teamNames }) {
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (search === DIRECTOR_CODE) {
      onLogin({ player_id: "bootstrap_director", name: "Director (Setup)", team: null, isDirector: true });
    }
  }, [search]);

  const teamA = { ...TEAM_A, name: teamNames?.A || TEAM_A.name };
  const teamB = { ...TEAM_B, name: teamNames?.B || TEAM_B.name };

  const teamAPlayers = players.filter(p => p.team === "A");
  const teamBPlayers = players.filter(p => p.team === "B");

  const filterPlayers = (list) => list;

  const PlayerBtn = ({ p, team }) => (
    <button onClick={() => onLogin(p)} style={{
      width: "100%", padding: "clamp(8px, 2.5vw, 12px) clamp(10px, 3vw, 14px)", background: team.color + "22",
      border: `1px solid ${team.accent}33`, borderRadius: 6,
      color: BC.t2, fontSize: "clamp(13px, 3.8vw, 14px)", fontWeight: 600, cursor: "pointer", textAlign: "center",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
    }}>
      <span style={{ flex: 1, lineHeight: 1.3 }}>{p.name}</span>
    </button>
  );

  return (
    <div style={{ height: "100svh", background: BC.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 10px", fontFamily: "'Montserrat', sans-serif", position: "relative", overflow: "hidden" }}>
      {/* Silhouette — fixed full-screen background */}
      <img src={TROPHY_SILHOUETTE} alt="" style={{
        position: "fixed", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        width: "100%", height: "100%",
        objectFit: "contain", opacity: 0.28, filter: "brightness(1.4) contrast(1.2)", pointerEvents: "none", userSelect: "none", zIndex: 0,
      }} />

      {/* Title — sits above the silhouette, outside content card */}
      <div style={{ textAlign: "center", position: "relative", zIndex: 1, marginBottom: 14 }}>
        <div style={{ fontSize: "clamp(20px, 8vw, 28px)", fontWeight: 800, color: BC.gold, letterSpacing: 2 }}>THE BOURBON CUP</div>
        <div style={{ fontSize: "clamp(10px, 3vw, 12px)", color: BC.t3, letterSpacing: "0.3em", marginTop: 3 }}>2026 GAYLORD, MI</div>
      </div>

      {/* Desktop centering wrapper */}
      <div style={{ width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", alignItems: "center", position: "relative", zIndex: 1 }}>



      {/* Two-column layout with logos above each column and VS between */}
      <div style={{ width: "100%", maxWidth: 480, display: "flex", gap: "clamp(6px, 2vw, 12px)", position: "relative", zIndex: 1, alignItems: "flex-start" }}>
        {[teamA, teamB].map((team, ti) => {
          const teamPlayers = filterPlayers(team.id === "A" ? teamAPlayers : teamBPlayers);
          return (
            <div key={team.id} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
              {/* Logo centered above column */}
              <img src={team.logo} alt={team.name} style={{ width: "clamp(60px, 32vw, 90px)", height: "clamp(44px, 22vw, 64px)", objectFit: "contain", marginBottom: 6 }} />
              {/* Player list */}
              <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "clamp(3px, 1vw, 6px)", background: BC.card + "88", border: `1px solid ${team.accent}44`, borderTop: `2px solid ${team.accent}`, borderRadius: 10, padding: "clamp(4px, 1.5vw, 8px)" }}>
                {teamPlayers.length === 0
                  ? <div style={{ textAlign: "center", color: BC.t3, fontSize: 11, padding: "12px 4px" }}>No players</div>
                  : teamPlayers.map(p => <PlayerBtn key={p.player_id} p={p} team={team} />)
                }
              </div>
            </div>
          );
        })}
      </div>

      {players.length === 0 && (
        <div style={{ textAlign: "center", color: BC.t3, padding: 16, fontSize: 12, position: "relative", zIndex: 1, marginTop: 12 }}>
          No players yet. Type <span style={{ color: BC.amber, fontWeight: 700 }}>bcdir2025</span> to set up.
        </div>
      )}
      </div>
    </div>
  );
}

// ── Team Scoreboard (main leaderboard) ──
function TeamLeaderboard({ matches, holeData, courses, tRounds, tPlayers, rounds, teamNames, hcpOverrides }) {
  const [expandedMatch, setExpandedMatch] = useState(null);
  const [activeRound, setActiveRound] = useState(null); // null = show all rounds

  const tA = { ...TEAM_A, name: teamNames?.A || TEAM_A.name };
  const tB = { ...TEAM_B, name: teamNames?.B || TEAM_B.name };

  // Tournament totals
  const tourneyTotals = useMemo(() => {
    const tot = { A: 0, B: 0 };
    matches.forEach(m => {
      const fmt = tRounds.find(t => t.round_number === m.round)?.format || "singles";
      const res = computeMatchResult(m, holeData, courses, tRounds, tPlayers, fmt, hcpOverrides);
      tot.A += res.totalPts.A; tot.B += res.totalPts.B;
    });
    return tot;
  }, [matches, holeData, courses, tRounds, tPlayers]);

  const totalAvail = matches.reduce((s, m) => {
    const n = m.nassau || NASSAU_DEFAULT;
    return s + (n.front||0) + (n.back||0) + (n.overall||0);
  }, 0);
  const toWin = Math.floor(totalAvail / 2) + 0.5;
  const aLeads = tourneyTotals.A > tourneyTotals.B;
  const bLeads = tourneyTotals.B > tourneyTotals.A;
  const gap = Math.abs(tourneyTotals.A - tourneyTotals.B);

  // Group matches by round
  const roundsWithMatches = [1,2,3,4].filter(r => matches.some(m => m.round === r));
  const displayRounds = activeRound ? [activeRound] : roundsWithMatches;

  return (
    <div style={{ fontFamily: "'Montserrat', sans-serif" }}>

      {/* ══ SCOREBOARD ══ */}
      {(() => {
        // Build progress bar segments from all matches
        // earned = final pts, leading = pts if current match status holds, neutral = rest
        const segments = { aEarned: 0, aLeading: 0, bLeading: 0, bEarned: 0, neutral: 0 };
        matches.forEach(m => {
          const fmt = tRounds.find(t => t.round_number === m.round)?.format || "singles";
          const res = computeMatchResult(m, holeData, courses, tRounds, tPlayers, fmt, hcpOverrides);
          const nassau = m.nassau || NASSAU_DEFAULT;
          const maxPts = (nassau.front||0) + (nassau.back||0) + (nassau.overall||0);
          const aP = res.totalPts.A, bP = res.totalPts.B;
          const complete = res.overall?.complete;
          if (complete) {
            segments.aEarned += aP;
            segments.bEarned += bP;
            segments.neutral += maxPts - aP - bP;
          } else if (aP > bP) {
            segments.aEarned += aP; // already locked in segments
            segments.aLeading += 0; // show projected
            segments.neutral += maxPts - aP;
          } else if (bP > aP) {
            segments.bEarned += bP;
            segments.neutral += maxPts - bP;
          } else {
            segments.neutral += maxPts;
          }
        });
        const tot = totalAvail || 1;
        // For in-progress matches, show projected pts as dim
        const allResults = matches.map(m => {
          const fmt = tRounds.find(t => t.round_number === m.round)?.format || "singles";
          return computeMatchResult(m, holeData, courses, tRounds, tPlayers, fmt, hcpOverrides);
        });
        // Earned (final) vs projected (in-progress leading)
        let aFinal = 0, aProj = 0, bFinal = 0, bProj = 0, neutral = 0;
        allResults.forEach((res, i) => {
          const nassau = matches[i].nassau || NASSAU_DEFAULT;
          const maxPts = (nassau.front||0) + (nassau.back||0) + (nassau.overall||0);
          const complete = res.overall?.complete;
          if (complete) {
            aFinal += res.totalPts.A;
            bFinal += res.totalPts.B;
            neutral += maxPts - res.totalPts.A - res.totalPts.B;
          } else {
            aProj += res.totalPts.A;
            bProj += res.totalPts.B;
            neutral += maxPts - res.totalPts.A - res.totalPts.B;
          }
        });

        const fmtScore = (n) => n % 1 === 0 ? String(n) : n.toFixed(1);

        return (
          <div style={{ background: "#111", borderRadius: 14, border: `1px solid ${BC.bdr}`, marginBottom: 12, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr" }}>
              {/* Team A */}
              <div style={{ background: aLeads ? TEAM_A.color + "55" : TEAM_A.color + "1a", padding: "14px 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <img src={TEAM_A.logo} alt={tA.name} style={{ width: 80, height: 52, objectFit: "contain" }} />
                <div style={{ display: "flex", alignItems: "baseline", gap: 5, justifyContent: "center" }}>
                  <div style={{ fontSize: 44, fontWeight: 900, color: "#fff", lineHeight: 1 }}>{fmtScore(tourneyTotals.A)}</div>
                  {aProj > 0 && <div style={{ fontSize: 13, fontWeight: 700, color: TEAM_A.accent + "99" }}>+{fmtScore(aProj)}</div>}
                </div>
                {aLeads && <div style={{ fontSize: 8, color: TEAM_A.accent, fontWeight: 700, letterSpacing: 0.5, textAlign: "center" }}>LEADS · {fmtScore(gap)} ahead</div>}
              </div>

              {/* Center */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "12px 10px", gap: 6, minWidth: 62 }}>
                <img src={TROPHY_PHOTO} alt="" style={{ width: 38, height: 38, objectFit: "contain" }} />
                {!aLeads && !bLeads && <div style={{ fontSize: 8, fontWeight: 800, color: BC.gold, letterSpacing: 1 }}>TIED</div>}
                <div style={{ fontSize: 8, color: BC.t3, textAlign: "center", lineHeight: 1.6 }}>
                  <span style={{ color: BC.gold, fontWeight: 700 }}>{fmtScore(Math.max(0, totalAvail - tourneyTotals.A - tourneyTotals.B - aProj - bProj))}</span><br/>avail
                </div>
              </div>

              {/* Team B */}
              <div style={{ background: bLeads ? TEAM_B.color + "55" : TEAM_B.color + "1a", padding: "14px 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <img src={TEAM_B.logo} alt={tB.name} style={{ width: 80, height: 52, objectFit: "contain" }} />
                <div style={{ display: "flex", alignItems: "baseline", gap: 5, justifyContent: "center" }}>
                  <div style={{ fontSize: 44, fontWeight: 900, color: "#fff", lineHeight: 1 }}>{fmtScore(tourneyTotals.B)}</div>
                  {bProj > 0 && <div style={{ fontSize: 13, fontWeight: 700, color: TEAM_B.accent + "99" }}>+{fmtScore(bProj)}</div>}
                </div>
                {bLeads && <div style={{ fontSize: 8, color: TEAM_B.accent, fontWeight: 700, letterSpacing: 0.5, textAlign: "center" }}>LEADS · {fmtScore(gap)} ahead</div>}
              </div>
            </div>

            {/* Progress bar: bright=earned, dim=projected/leading, neutral=grey */}
            <div style={{ height: 8, display: "flex" }}>
              {/* A earned */}
              <div style={{ width: `${(aFinal/tot)*100}%`, background: TEAM_A.accent, transition: "width 0.6s ease" }} />
              {/* A projected (in-progress, leading) */}
              <div style={{ width: `${(aProj/tot)*100}%`, background: TEAM_A.accent + "55", transition: "width 0.6s ease" }} />
              {/* Neutral */}
              <div style={{ flex: 1, background: BC.bdr + "66" }} />
              {/* B projected */}
              <div style={{ width: `${(bProj/tot)*100}%`, background: TEAM_B.accent + "55", transition: "width 0.6s ease" }} />
              {/* B earned */}
              <div style={{ width: `${(bFinal/tot)*100}%`, background: TEAM_B.accent, transition: "width 0.6s ease" }} />
            </div>

            {/* Legend */}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 12px 6px", fontSize: 8, color: BC.t3 }}>
              <span><span style={{ color: TEAM_A.accent }}>■</span> Earned <span style={{ color: TEAM_A.accent + "88" }}>■</span> Projected</span>
              <span style={{ color: BC.gold, fontWeight: 700 }}>{fmtScore(toWin)} to win</span>
              <span><span style={{ color: TEAM_B.accent + "88" }}>■</span> Projected <span style={{ color: TEAM_B.accent }}>■</span> Earned</span>
            </div>
          </div>
        );
      })()}

      {/* ══ ROUND FILTER TABS ══ */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
        <button onClick={() => setActiveRound(null)} style={{
          flex: 1, padding: "7px 4px", borderRadius: 8, border: "none", fontSize: 10, fontWeight: 700, cursor: "pointer",
          background: activeRound === null ? `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})` : BC.card,
          color: activeRound === null ? "#0a0804" : BC.t2, border: `1px solid ${activeRound === null ? "transparent" : BC.bdr}`,
        }}>All</button>
        {[1,2,3,4].map(r => {
          const tr = tRounds.find(t => t.round_number === r);
          const fmt = FORMATS.find(f => f.id === tr?.format);
          const has = matches.some(m => m.round === r);
          return (
            <button key={r} onClick={() => setActiveRound(r === activeRound ? null : r)} style={{
              flex: 1, padding: "7px 4px", borderRadius: 8, border: "none", fontSize: 10, fontWeight: 700, cursor: "pointer",
              background: activeRound === r ? `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})` : BC.card,
              color: activeRound === r ? "#0a0804" : has ? BC.t2 : BC.t3,
              border: `1px solid ${activeRound === r ? "transparent" : BC.bdr}`,
              opacity: has ? 1 : 0.5,
            }}>
              <div>Rd {r}</div>
              {fmt && <div style={{ fontSize: 7, opacity: 0.75, marginTop: 1 }}>{fmt.label.split(" ").slice(-1)[0].substring(0,5)}</div>}
            </button>
          );
        })}
      </div>

      {/* ══ MATCHES BY ROUND ══ */}
      {displayRounds.map(rnd => {
        const tr = tRounds.find(t => t.round_number === rnd);
        const course = courses.find(c => c.id === tr?.course_id);
        const fmt = FORMATS.find(f => f.id === tr?.format);
        const rndMatches = matches.filter(m => m.round === rnd);
        const format = tr?.format || "singles";

        const rndResults = rndMatches.map(m => ({
          ...m,
          result: computeMatchResult(m, holeData, courses, tRounds, tPlayers, format, hcpOverrides),
        }));

        const rndTot = { A: 0, B: 0 };
        rndResults.forEach(m => { rndTot.A += m.result.totalPts.A; rndTot.B += m.result.totalPts.B; });

        return (
          <div key={rnd}>
            {/* Round header — like Google Sheet section header */}
            <div style={{ background: BC.card, borderRadius: 10, border: `1px solid ${BC.bdr}`, padding: "8px 12px", marginBottom: 6, display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: TEAM_A.accent }}>{rndTot.A % 1 === 0 ? rndTot.A : rndTot.A.toFixed(1)} pts</div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: BC.gold }}>Round {rnd} {fmt ? `· ${fmt.label}` : ""}</div>
                {course && <div style={{ fontSize: 9, color: BC.t3, marginTop: 1 }}>{course.name}</div>}
              </div>
              <div style={{ fontSize: 12, fontWeight: 800, color: TEAM_B.accent, textAlign: "right" }}>{rndTot.B % 1 === 0 ? rndTot.B : rndTot.B.toFixed(1)} pts</div>
            </div>

            {rndMatches.length === 0 && (
              <div style={{ textAlign: "center", color: BC.t3, padding: "16px 0 20px", fontSize: 12 }}>No matches set up yet.</div>
            )}

            {/* Match cards */}
            {rndResults.map((m, mi) => {
              const res = m.result;
              const exp = expandedMatch === m.id;
              const nassau = m.nassau || NASSAU_DEFAULT;
              const aUp = res.overall.aWins - res.overall.bWins;
              const holesLeft = 18 - res.holesPlayed;
              const matchWinner = res.overall.complete ? (aUp > 0 ? "A" : aUp < 0 ? "B" : null) : null;

              let statusText = "—";
              if (res.holesPlayed > 0) {
                if (res.overall.complete) {
                  if (aUp === 0) statusText = "TIED";
                  else statusText = `${Math.abs(aUp)}&${holesLeft === 0 ? "0" : holesLeft}`;
                } else {
                  statusText = aUp === 0 ? "AS" : `${Math.abs(aUp)} UP`;
                }
              }

              return (
                <div key={m.id} style={{ background: BC.card, borderRadius: 10, border: `1px solid ${exp ? BC.amber + "55" : BC.bdr}`, marginBottom: 6, overflow: "hidden" }}>
                  <button onClick={() => setExpandedMatch(exp ? null : m.id)} style={{ width: "100%", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>

                    {/* Top row: Round label | Thru | Match # */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", padding: "6px 10px 4px", alignItems: "center", borderBottom: `1px solid ${BC.bdr}10` }}>
                      <div style={{ fontSize: 8, color: BC.t3, fontWeight: 700, letterSpacing: 0.5 }}>Round {rnd}</div>
                      <div style={{ fontSize: 8, color: BC.t3, textAlign: "center" }}>
                        {res.holesPlayed > 0 ? `Thru ${res.holesPlayed}` : "Not Started"}
                      </div>
                      <div style={{ fontSize: 8, color: BC.t3, fontWeight: 700, textAlign: "right" }}>Match {mi + 1}</div>
                    </div>

                    {/* Main row: Team A names | Status | Team B names */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", padding: "8px 10px 4px", gap: 8, alignItems: "center" }}>
                      {/* Team A */}
                      <div style={{ borderLeft: `3px solid ${TEAM_A.accent}`, paddingLeft: 6 }}>
                        <img src={TEAM_A.logo} alt={tA.name} style={{ width: 32, height: 22, objectFit: "contain", marginBottom: 3, display: "block" }} />
                        {(m.teamANames || ["Team A"]).map((name, ni) => (
                          <div key={ni} style={{ fontSize: 12, fontWeight: 700, color: matchWinner === "A" ? TEAM_A.accent : TEAM_A.accent + "66", lineHeight: 1.4 }}>{name}</div>
                        ))}
                      </div>

                      {/* Status */}
                      <div style={{ textAlign: "center", minWidth: 60 }}>
                        {res.holesPlayed === 0 ? (
                          <div style={{ fontSize: 9, color: BC.t3 }}>—</div>
                        ) : (
                          <div style={{
                            fontSize: 13, fontWeight: 900, lineHeight: 1,
                            color: matchWinner === "A" ? TEAM_A.accent : matchWinner === "B" ? TEAM_B.accent : BC.gold,
                          }}>{statusText}</div>
                        )}
                        {res.overall.complete && <div style={{ fontSize: 7, color: BC.t3, marginTop: 2, fontWeight: 700, letterSpacing: 1 }}>FINAL</div>}
                      </div>

                      {/* Team B */}
                      <div style={{ borderRight: `3px solid ${TEAM_B.accent}`, paddingRight: 6, textAlign: "right" }}>
                        <img src={TEAM_B.logo} alt={tB.name} style={{ width: 32, height: 22, objectFit: "contain", marginBottom: 3, display: "block", marginLeft: "auto" }} />
                        {(m.teamBNames || ["Team B"]).map((name, ni) => (
                          <div key={ni} style={{ fontSize: 12, fontWeight: 700, color: matchWinner === "B" ? TEAM_B.accent : TEAM_B.accent + "66", lineHeight: 1.4 }}>{name}</div>
                        ))}
                      </div>
                    </div>

                    {/* Nassau points row — Front | Back | Overall */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderTop: `1px solid ${BC.bdr}10`, margin: "0 10px" }}>
                      {[["Front", res.frontPts, nassau.front], ["Back", res.backPts, nassau.back], ["Overall", res.overallPts, nassau.overall]].map(([lbl, pts, max]) => {
                        const aW = (pts?.A||0) > (pts?.B||0);
                        const bW = (pts?.B||0) > (pts?.A||0);
                        return (
                          <div key={lbl} style={{ padding: "5px 4px", textAlign: "center" }}>
                            <div style={{ fontSize: 7, color: BC.t3, letterSpacing: 0.5, marginBottom: 2 }}>{lbl.toUpperCase()}</div>
                            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 4 }}>
                              <span style={{ fontSize: 11, fontWeight: 800, color: aW ? TEAM_A.accent : BC.t3, minWidth: 18, textAlign: "right" }}>{(pts?.A||0) % 1 === 0 ? (pts?.A||0) : (pts?.A||0).toFixed(1)}</span>
                              <span style={{ fontSize: 8, color: BC.bdr }}>|</span>
                              <span style={{ fontSize: 11, fontWeight: 800, color: bW ? TEAM_B.accent : BC.t3, minWidth: 18, textAlign: "left" }}>{(pts?.B||0) % 1 === 0 ? (pts?.B||0) : (pts?.B||0).toFixed(1)}</span>
                            </div>
                            <div style={{ fontSize: 7, color: BC.t3 }}>of {max} pts</div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Cup Points row */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderTop: `1px solid ${BC.bdr}10`, padding: "5px 10px 6px" }}>
                      <div>
                        <div style={{ fontSize: 7, color: BC.t3, letterSpacing: 0.5 }}>CUP POINTS</div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: TEAM_A.accent }}>{res.totalPts.A % 1 === 0 ? res.totalPts.A : res.totalPts.A.toFixed(1)}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 7, color: BC.t3, letterSpacing: 0.5 }}>CUP POINTS</div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: TEAM_B.accent }}>{res.totalPts.B % 1 === 0 ? res.totalPts.B : res.totalPts.B.toFixed(1)}</div>
                      </div>
                    </div>

                    {/* Hole tracker bar 1–18 with numbers */}
                    <div style={{ padding: "0 10px 8px" }}>
                      {/* Hole numbers */}
                      <div style={{ display: "flex", gap: 1, marginBottom: 2 }}>
                        {[...Array(9)].map((_,i) => (
                          <div key={i} style={{ flex:1, textAlign:"center", fontSize:7, color:BC.t3 }}>{i+1}</div>
                        ))}
                        <div style={{ width: 4 }} />
                        {[...Array(9)].map((_,i) => (
                          <div key={i+9} style={{ flex:1, textAlign:"center", fontSize:7, color:BC.t3 }}>{i+10}</div>
                        ))}
                      </div>
                      {/* Color bar */}
                      <div style={{ display: "flex", gap: 1, alignItems: "center" }}>
                        {res.holes.slice(0,9).map((h, hi) => (
                          <div key={hi} style={{ flex:1, height:8, borderRadius:2,
                            background: !h.played ? BC.bdr+"33" : h.winner==="A" ? TEAM_A.accent : h.winner==="B" ? TEAM_B.accent : BC.t3+"66",
                          }} />
                        ))}
                        <div style={{ width:4, height:10, background:BC.bdr, borderRadius:1, flexShrink:0 }} />
                        {res.holes.slice(9,18).map((h, hi) => (
                          <div key={hi+9} style={{ flex:1, height:8, borderRadius:2,
                            background: !h.played ? BC.bdr+"33" : h.winner==="A" ? TEAM_A.accent : h.winner==="B" ? TEAM_B.accent : BC.t3+"66",
                          }} />
                        ))}
                      </div>
                    </div>
                  </button>

                  {/* Expanded scorecard */}
                  {exp && <MatchScorecard match={m} result={res} format={format} courses={courses} tRounds={tRounds} tA={tA} tB={tB} />}
                </div>
              );
            })}

            <div style={{ marginBottom: 14 }} />
          </div>
        );
      })}

      {displayRounds.length === 0 && (
        <div style={{ textAlign: "center", color: BC.t3, padding: 40, fontSize: 13 }}>No matches set up yet.</div>
      )}
    </div>
  );
}

// ── Match Scorecard ──
function MatchScorecard({ match, result, format, courses, tRounds }) {
  const tr = tRounds.find(t => t.round_number === match.round);
  const course = courses.find(c => c.id === tr?.course_id);
  const holePars = course?.hole_pars || Array(18).fill(4);
  const holes = result.holes;

  const renderSegment = (start, end, label) => (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 9, color: BC.t3, fontWeight: 700, marginBottom: 4, letterSpacing: 1 }}>{label}</div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${end - start}, 1fr) 32px`, gap: 2 }}>
        {/* Hole numbers */}
        {Array.from({ length: end - start }, (_, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 8, color: BC.t3, paddingBottom: 2 }}>{start + i + 1}</div>
        ))}
        <div style={{ textAlign: "center", fontSize: 8, color: BC.t3, paddingBottom: 2 }}>▸</div>

        {/* Par */}
        {Array.from({ length: end - start }, (_, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 8, color: BC.t3 }}>{holePars[start + i]}</div>
        ))}
        <div style={{ textAlign: "center", fontSize: 8, color: BC.t3 }}>{holePars.slice(start, end).reduce((a,b)=>a+b,0)}</div>

        {/* Team A scores */}
        {holes.slice(start, end).map((h, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 10, fontWeight: 700,
            color: h.winner === "A" ? TEAM_A.accent : h.winner === "B" ? BC.t3 : BC.t2,
            background: h.winner === "A" ? TEAM_A.color + "33" : "transparent", borderRadius: 4, padding: "1px 0" }}>
            {h.aScore != null ? h.aScore : "·"}
          </div>
        ))}
        <div style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: TEAM_A.accent }}>
          {holes.slice(start, end).filter(h => h.winner === "A").length}
        </div>

        {/* Team B scores */}
        {holes.slice(start, end).map((h, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 10, fontWeight: 700,
            color: h.winner === "B" ? TEAM_B.accent : h.winner === "A" ? BC.t3 : BC.t2,
            background: h.winner === "B" ? TEAM_B.color + "33" : "transparent", borderRadius: 4, padding: "1px 0" }}>
            {h.bScore != null ? h.bScore : "·"}
          </div>
        ))}
        <div style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: TEAM_B.accent }}>
          {holes.slice(start, end).filter(h => h.winner === "B").length}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ padding: "0 14px 14px", borderTop: `1px solid ${BC.bdr}` }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 8, marginTop: 10, justifyContent: "space-between" }}>
        <span style={{ fontSize: 9, color: TEAM_A.accent, fontWeight: 700 }}>{match.teamANames?.join(" / ")}</span>
        <span style={{ fontSize: 9, color: BC.t3 }}>vs</span>
        <span style={{ fontSize: 9, color: TEAM_B.accent, fontWeight: 700 }}>{match.teamBNames?.join(" / ")}</span>
      </div>
      {renderSegment(0, 9, "FRONT NINE")}
      {renderSegment(9, 18, "BACK NINE")}
    </div>
  );
}

// ── Score Entry ──
function ScoreEntry({ user, matches, holeData, onSaveHole, tPlayers, courses, tRounds, notify, teamNames, hcpOverrides }) {
  const [view, setView] = useState("entry"); // "entry" | "card"
  const [activeMatch, setActiveMatch] = useState(null);
  const [activeHole, setActiveHole] = useState(0);

  // Find matches this user is in
  const userPid = user.player_id;
  const tA = { ...TEAM_A, name: teamNames?.A || TEAM_A.name };
  const tB = { ...TEAM_B, name: teamNames?.B || TEAM_B.name };
  const myMatches = matches.filter(m => [...m.teamA, ...m.teamB].includes(userPid));

  const match = activeMatch ? matches.find(m => m.id === activeMatch) : myMatches[0];
  const format = tRounds.find(t => t.round_number === match?.round)?.format || "singles";
  const tr = tRounds.find(t => t.round_number === match?.round);
  const course = courses.find(c => c.id === tr?.course_id);

  if (!match) return (
    <div style={{ textAlign: "center", padding: 40, color: BC.t3, fontFamily: "'Montserrat', sans-serif" }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>⛳</div>
      <div>You're not in any matches yet.</div>
    </div>
  );

  const allPlayers = [...match.teamA, ...match.teamB];
  const holePars = course?.hole_pars || Array(18).fill(4);
  const holePar = holePars[activeHole];

  const getScore = (pid) => (holeData[`${pid}_${match.round}`] || {})[activeHole];

  const setScore = async (pid, score) => {
    await onSaveHole(pid, match.round, activeHole, score, tr?.course_id);
  };

  const result = useMemo(() => computeMatchResult(match, holeData, courses, tRounds, tPlayers, format, hcpOverrides), [match, holeData, format, hcpOverrides]);

  const ScoreBtn = ({ pid, name, team }) => {
    const cur = getScore(pid);
    const par = holePar;
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: getTeam(team).accent }} />
          <span style={{ fontSize: 11, color: BC.t2, fontWeight: 600 }}>{name}</span>
          {cur != null && <span style={{ fontSize: 10, color: cur - par < 0 ? "#22c55e" : cur - par > 0 ? BC.danger : BC.t3, fontWeight: 700 }}>{fmtScore(cur - par)}</span>}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[1,2,3,4,5,6,7,8,9,10].map(s => (
            <button key={s} onClick={() => setScore(pid, s)} style={{
              flex: 1, padding: "10px 0", borderRadius: 8,
              background: s === cur ? (s < par ? "#1a3a1a" : s === par ? BC.hover : "#3a1a1a") : BC.card,
              border: `1px solid ${s === cur ? (s < par ? "#22c55e" : s === par ? BC.amber : BC.danger) : BC.bdr}`,
              color: s === cur ? BC.t1 : BC.t3, fontSize: 13, fontWeight: s === cur ? 700 : 400, cursor: "pointer",
            }}>{s}</button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div style={{ fontFamily: "'Montserrat', sans-serif" }}>
      {/* Toggle */}
      <div style={{ display: "flex", background: BC.card, borderRadius: 20, padding: 3, marginBottom: 16, border: `1px solid ${BC.bdr}` }}>
        {[["entry","✏️ Score Entry"],["card","📋 Match View"]].map(([v, label]) => (
          <button key={v} onClick={() => setView(v)} style={{
            flex: 1, padding: "8px 0", borderRadius: 16, fontSize: 12, fontWeight: 700, cursor: "pointer",
            background: view === v ? `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})` : "transparent",
            color: view === v ? "#0a0804" : BC.t3, border: "none",
          }}>{label}</button>
        ))}
      </div>

      {/* Match selector if multiple matches */}
      {myMatches.length > 1 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {myMatches.map(m => (
            <button key={m.id} onClick={() => setActiveMatch(m.id)} style={{
              flex: 1, padding: "8px 6px", borderRadius: 10, fontSize: 10, fontWeight: 700, cursor: "pointer",
              background: match?.id === m.id ? BC.amber + "22" : BC.card, border: `1px solid ${match?.id === m.id ? BC.amber : BC.bdr}`,
              color: match?.id === m.id ? BC.amber : BC.t3,
            }}>Rd {m.round}</button>
          ))}
        </div>
      )}

      {view === "entry" && (
        <>
          {/* Hole nav */}
          <div style={{ background: BC.card, borderRadius: 12, padding: "10px 14px", marginBottom: 12, border: `1px solid ${BC.bdr}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <button onClick={() => setActiveHole(h => Math.max(0, h - 1))} disabled={activeHole === 0}
                style={{ background: BC.hover, border: "none", color: BC.t1, borderRadius: 8, padding: "6px 14px", fontSize: 16, cursor: "pointer", opacity: activeHole === 0 ? 0.3 : 1 }}>‹</button>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: BC.gold }}>Hole {activeHole + 1}</div>
                <div style={{ fontSize: 11, color: BC.t3 }}>Par {holePar} &nbsp;·&nbsp; {activeHole < 9 ? "Front" : "Back"} Nine</div>
                <div style={{ fontSize: 10, color: BC.t3, marginTop: 2 }}>Match: {result.status} (Thru {result.holesPlayed})</div>
              </div>
              <button onClick={() => setActiveHole(h => Math.min(17, h + 1))} disabled={activeHole === 17}
                style={{ background: BC.hover, border: "none", color: BC.t1, borderRadius: 8, padding: "6px 14px", fontSize: 16, cursor: "pointer", opacity: activeHole === 17 ? 0.3 : 1 }}>›</button>
            </div>
            {/* Hole dots */}
            <div style={{ display: "flex", gap: 3, justifyContent: "center" }}>
              {Array.from({length: 18}, (_, i) => {
                const allScored = allPlayers.every(p => getScore(p) != null);
                const anyScored = allPlayers.some(p => (holeData[`${p}_${match.round}`] || {})[i] != null);
                return (
                  <button key={i} onClick={() => setActiveHole(i)} style={{
                    width: 14, height: 14, borderRadius: "50%", border: "none", cursor: "pointer",
                    background: i === activeHole ? BC.amber : anyScored ? (allScored ? BC.green : BC.amber + "66") : BC.bdr,
                  }} />
                );
              })}
            </div>
          </div>

          {/* Score inputs */}
          <div style={{ background: BC.card, borderRadius: 12, padding: 14, border: `1px solid ${BC.bdr}` }}>
            <div style={{ fontSize: 10, color: BC.t3, marginBottom: 10, letterSpacing: 1, fontWeight: 700 }}>
              {FORMATS.find(f => f.id === format)?.label?.toUpperCase() || "MATCH PLAY"} · ROUND {match.round}
            </div>
            {match.teamA.map((pid, i) => {
              const tp = tPlayers.find(t => t.player_id === pid);
              return <ScoreBtn key={pid} pid={pid} name={tp?.name || pid} team="A" />;
            })}
            <div style={{ borderTop: `1px dashed ${BC.bdr}`, margin: "10px 0" }} />
            {match.teamB.map((pid, i) => {
              const tp = tPlayers.find(t => t.player_id === pid);
              return <ScoreBtn key={pid} pid={pid} name={tp?.name || pid} team="B" />;
            })}
          </div>
        </>
      )}

      {view === "card" && (
        <MatchScorecard match={match} result={result} format={format} courses={courses} tRounds={tRounds} />
      )}
    </div>
  );
}

// ── Groups View ──
function GroupsView({ matches, tRounds, tPlayers, courses, teamNames }) {
  const rounds = [...new Set(matches.map(m => m.round))].sort();
  const tA = { ...TEAM_A, name: teamNames?.A || TEAM_A.name };
  const tB = { ...TEAM_B, name: teamNames?.B || TEAM_B.name };
  const [activeRound, setActiveRound] = useState(rounds[0] || 1);
  const rndMatches = matches.filter(m => m.round === activeRound);
  const tr = tRounds.find(t => t.round_number === activeRound);
  const course = courses.find(c => c.id === tr?.course_id);
  const fmt = FORMATS.find(f => f.id === tr?.format);

  return (
    <div style={{ fontFamily: "'Montserrat', sans-serif" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {rounds.map(r => (
          <button key={r} onClick={() => setActiveRound(r)} style={{
            flex: 1, padding: "8px 4px", borderRadius: 10, border: `1px solid ${r === activeRound ? "transparent" : BC.bdr}`,
            background: r === activeRound ? `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})` : BC.card,
            color: r === activeRound ? "#0a0804" : BC.t2, fontSize: 11, fontWeight: 700, cursor: "pointer",
          }}>Rd {r}</button>
        ))}
      </div>

      <div style={{ background: BC.card, borderRadius: 10, padding: "10px 14px", marginBottom: 12, border: `1px solid ${BC.bdr}` }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: BC.gold }}>{course?.name || "TBD"}</div>
        {fmt && <div style={{ fontSize: 10, color: BC.t3, marginTop: 2 }}>{fmt.label} · {fmt.desc}</div>}
        {tr?.tee_time && <div style={{ fontSize: 10, color: BC.amber, marginTop: 2 }}>First Tee: {tr.tee_time}</div>}
      </div>

      {rndMatches.length === 0 && <div style={{ textAlign: "center", color: BC.t3, padding: 32 }}>No matches scheduled.</div>}
      {rndMatches.map((m, i) => (
        <div key={m.id} style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, padding: "12px 14px", marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: BC.t3, marginBottom: 6, fontWeight: 700 }}>MATCH {i + 1}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1 }}>
              {m.teamA.map(pid => {
                const tp = tPlayers.find(t => t.player_id === pid);
                return <div key={pid} style={{ fontSize: 12, fontWeight: 600, color: TEAM_A.accent }}>{tp?.name || pid}</div>;
              })}
            </div>
            <div style={{ fontSize: 12, color: BC.t3, fontWeight: 700 }}>vs</div>
            <div style={{ flex: 1, textAlign: "right" }}>
              {m.teamB.map(pid => {
                const tp = tPlayers.find(t => t.player_id === pid);
                return <div key={pid} style={{ fontSize: 12, fontWeight: 600, color: TEAM_B.accent }}>{tp?.name || pid}</div>;
              })}
            </div>
          </div>
          {m.teeTime && <div style={{ fontSize: 10, color: BC.amber, marginTop: 6 }}>⏰ {m.teeTime}</div>}
        </div>
      ))}
    </div>
  );
}

// ── Admin View ──

// ── CH Delta Popup ── shows stroke change when tee or index changes
function ChDeltaBadge({ delta }) {
  if (delta === undefined || delta === null || delta === 0) return null;
  const up = delta > 0;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 1,
      fontSize: 9, fontWeight: 800,
      color: up ? "#22c55e" : "#ef4444",
      animation: "fadeIn 0.2s ease",
    }}>
      {up ? "▲" : "▼"}{Math.abs(delta)}
    </span>
  );
}

function AdminView({ user, tPlayers, tRounds, courses, matches, onAddPlayer, onUpdatePlayer, onRemovePlayer, onAddCourse, onSetRound, onSetMatch, teamNames, onSaveTeamNames, hcpOverridesFromDb, teeAssignmentsFromDb, notify }) {
  const [tab, setTab] = useState("players");
  const [editTeamNames, setEditTeamNames] = useState({ A: "", B: "" });
  const [editingTeam, setEditingTeam] = useState(null);

  useEffect(() => {
    setEditTeamNames({ A: teamNames.A, B: teamNames.B });
  }, [teamNames]);
  const [newPlayerName, setNewPlayerName] = useState("");
  const [newPlayerTeam, setNewPlayerTeam] = useState(null);
  const [newPlayerHI, setNewPlayerHI] = useState("");
  const [courseSearch, setCourseSearch] = useState("");
  const [courseStateFilter, setCourseStateFilter] = useState("MI");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [coursePreview, setCoursePreview] = useState(null);
  const [expandedCourse, setExpandedCourse] = useState(null);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef(null);

  const [editRound, setEditRound] = useState(1);
  const [roundFormat, setRoundFormat] = useState("");
  const [roundCourse, setRoundCourse] = useState("");
  const [roundTeeTime, setRoundTeeTime] = useState("");
  const [hcpOverrides, setHcpOverrides] = useState({});

  // Auto-load round settings from Firestore when tRounds first populates
  useEffect(() => {
    const tr = tRounds.find(t => t.round_number === editRound);
    if (!tr) return;
    setRoundFormat(tr.format || "");
    setRoundTeeTime(tr.tee_time || "");
    setNassau({ front: tr.nassau_front ?? 1, back: tr.nassau_back ?? 1, overall: tr.nassau_overall ?? 1 });
    if (tr.handicap_mode) setHandicapMode(prev => ({ ...prev, [editRound]: tr.handicap_mode }));
  }, [tRounds]);
  const [handicapMode, setHandicapMode] = useState({ 1: "low_man", 2: "low_man", 3: "low_man", 4: "full" }); // per round
  const [chDeltas, setChDeltas] = useState({});
  const [editingPlayer, setEditingPlayer] = useState(null); // { pid, name, hi }
  const [swipePid, setSwipePid] = useState(null);
  const [swipeX, setSwipeX] = useState(0);
  const swipeStartX = useRef(null);
  const [teeAssignments, setTeeAssignments] = useState({}); // { round: { pid: teeName } } // { pid_context: delta } — auto-clears after 3.5s

  const showChDelta = (key, delta) => {
    if (!delta) return;
    setChDeltas(prev => ({ ...prev, [key]: delta }));
    setTimeout(() => setChDeltas(prev => { const n = {...prev}; delete n[key]; return n; }), 3500);
  }; // { round: { pid: value } }
  useEffect(() => { if (hcpOverridesFromDb) setHcpOverrides(hcpOverridesFromDb); }, [JSON.stringify(hcpOverridesFromDb)]);
  const [nassau, setNassau] = useState(NASSAU_DEFAULT);

  // Match builder
  const [matchRound, setMatchRound] = useState(1);
  const [matchTeamA, setMatchTeamA] = useState([]);
  const [matchTeamB, setMatchTeamB] = useState([]);

  const teamAPlayers = tPlayers.filter(p => p.team === "A"); // used in match builder
  const teamBPlayers = tPlayers.filter(p => p.team === "B");

  if (!user.isDirector) return (
    <div style={{ textAlign: "center", padding: 40 }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: BC.t1 }}>Directors Only</div>
      <div style={{ fontSize: 12, color: BC.t3, marginTop: 8 }}>Only tournament directors can manage settings.</div>
    </div>
  );

  const saveRound = async () => {
    const tr = tRounds.find(t => t.round_number === editRound) || {};
    // Always save handicap overrides (even if empty, to clear old values)
    const overrides = hcpOverrides[editRound] || {};
    await db.upsert("bc_hcp_overrides", { id: `bc_hcp_r${editRound}`, tournament_id: TOURNAMENT_ID, round_number: editRound, overrides });
    // Save tee assignments
    const assignments = teeAssignments[editRound] || {};
    await db.upsert("bc_tee_assignments", { id: `bc_tee_r${editRound}`, tournament_id: TOURNAMENT_ID, round_number: editRound, assignments });
    const data = {
      id: `bc_round_${editRound}`,
      tournament_id: TOURNAMENT_ID,
      round_number: editRound,
      course_id: tr?.course_id || "",
      format: roundFormat || tr.format || "singles",
      handicap_mode: handicapMode[editRound] || "low_man",
      tee_time: roundTeeTime || tr.tee_time || "",
      nassau_front: nassau.front,
      nassau_back: nassau.back,
      nassau_overall: nassau.overall,
    };
    await onSetRound(data);
    notify("Round saved!", "success");
  };

  const saveMatch = async () => {
    if (matchTeamA.length === 0 || matchTeamB.length === 0) { notify("Select players for both teams", "error"); return; }
    const mId = `bc_match_r${matchRound}_${matchTeamA.join("_")}_vs_${matchTeamB.join("_")}`;
    const data = {
      id: mId,
      tournament_id: TOURNAMENT_ID,
      round: matchRound,
      teamA: matchTeamA,
      teamB: matchTeamB,
      teamANames: matchTeamA.map(pid => tPlayers.find(p => p.player_id === pid)?.name || pid),
      teamBNames: matchTeamB.map(pid => tPlayers.find(p => p.player_id === pid)?.name || pid),
      nassau: nassau,
    };
    await onSetMatch(data);
    setMatchTeamA([]); setMatchTeamB([]);
    notify("Match created!", "success");
  };


  // ── Course Search (ported from WBC) ──
  const TEE_COLOR_MAP = {
    black:"#2c2c2c",blue:"#2d8fd4",white:"#e8e8e8",gold:"#d4a843",red:"#9b2335",
    green:"#2d8a4e",silver:"#a8b2bd",yellow:"#e6c619",orange:"#e67e22",purple:"#7b2d8b",
    maroon:"#6b1c2a",navy:"#1b2a4a",teal:"#1a8a7a",tan:"#c4a86b",platinum:"#c0c0c0",
  };
  const resolveTeeColor = (tee, index) => {
    const key = (tee.name || "").toLowerCase().trim();
    if (TEE_COLOR_MAP[key]) return TEE_COLOR_MAP[key];
    for (const [word, clr] of Object.entries(TEE_COLOR_MAP)) { if (key.includes(word)) return clr; }
    const c = tee.color || "";
    // Black tees: use white text/border so it's visible on dark background
    if (!c || c === "#000" || c === "#000000" || c === "black") return "#ffffff";
    if (c && tee.color !== "#000" && tee.color !== "#000000") return tee.color;
    return ["#60a5fa","#f59e0b","#a78bfa","#34d399","#fb923c"][index % 5];
  };
  const TeeColorSwatch = ({ color, name, size = 12 }) => {
    const isLight = ["#e8e8e8","#a8b2bd","#c0c0c0","#f7e7ce"].includes((color||"").toLowerCase());
    return <span style={{ display:"inline-block", width:size, height:size, borderRadius:3, background:color||"#888", border:`1px solid ${isLight?"#99999960":"#ffffff15"}`, flexShrink:0 }} />;
  };

  const doCourseSearch = (query, stateOverride) => {
    setCourseSearch(query);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!query.trim() || query.trim().length < 2) { setSearchResults([]); return; }
    searchTimerRef.current = setTimeout(async () => {
      setSearchLoading(true);
      const stateFilter = stateOverride !== undefined ? stateOverride : courseStateFilter;
      try {
        const q = query.trim();
        const stateParam = stateFilter ? `&state=${encodeURIComponent(stateFilter)}` : "";
        let results = [];
        const decodeHtml = (str) => str ? str.replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'") : str;
        const hasRealSlope = (c) => (c.tee_boxes||[]).some(tb => parseInt(tb.slope) !== 113) || (parseInt(c.slope) !== 113 && !!c.slope);
        const stateMatches = (courseState, filter) => {
          if (!filter || !courseState) return true;
          return courseState.trim().toUpperCase() === filter.trim().toUpperCase();
        };

        const parseRapidAPI = (rawCourses, sf) => rawCourses.filter(c => stateMatches(c.state, sf)).map((c, ci) => {
          const sc = Array.isArray(c.scorecard) ? c.scorecard : [];
          const hole_pars = sc.map(h => parseInt(h.Par) || 4);
          const hole_handicaps = sc.map(h => parseInt(h.Handicap) || 0);
          const par = hole_pars.reduce((a,b) => a+b, 0) || 72;
          const teeKeys = [...new Set(sc.flatMap(h => h.tees ? Object.keys(h.tees) : []))];
          const tees = teeKeys.length ? teeKeys.map((key, ti) => {
            const sample = sc.find(h => h.tees?.[key]);
            const color = sample?.tees?.[key]?.color || key;
            const yardage = sc.reduce((a, h) => a + (parseInt(h.tees?.[key]?.yards) || 0), 0);
            const hole_yards = sc.map(h => parseInt(h.tees?.[key]?.yards) || 0);
            return { name: color || key, color: resolveTeeColor({ name: color||key, color: color||"" }, ti), slope: parseInt(c.slopeRating)||113, rating: parseFloat(c.courseRating)||72.0, par, yardage, hole_yards };
          }) : [{ name:"Default", color: resolveTeeColor({name:"Default",color:""}, 0), slope: parseInt(c.slopeRating)||113, rating: parseFloat(c.courseRating)||72.0, par, yardage:0, hole_yards:[] }];
          return { id:`rapid_${c._id||ci}`, name:decodeHtml(c.name)||"Unknown", city:c.city||"", state:c.state||"", par, slope:parseInt(c.slopeRating)||113, rating:parseFloat(c.courseRating)||72.0, hole_pars, hole_handicaps, tee_boxes:tees, _source:"RapidAPI" };
        });

        const parseGolfCourseAPI = (rawCourses) => {
          const arr = Array.isArray(rawCourses) ? rawCourses : (rawCourses.courses || []);
          return arr.map((c, ci) => {
            const teesObj = c.tees || {};
            const allTees = Array.isArray(teesObj.male) && teesObj.male.length ? teesObj.male : (teesObj.female || []);
            const tees = allTees.map((t, ti) => ({ name:t.tee_name||"Default", color:resolveTeeColor({name:t.tee_name||"",color:""}, ti), rating:parseFloat(t.course_rating)||72.0, slope:parseInt(t.slope_rating)||113, par:parseInt(t.par_total)||72, yardage:parseInt(t.total_yards)||0, hole_yards:(t.holes||[]).map(h=>parseInt(h.yardage)||0) }));
            const firstTee = allTees[0]; const holes = firstTee?.holes || [];
            return { id:`gc_${c.id||ci}`, name:decodeHtml([c.club_name,c.course_name].filter(Boolean).join(" – ")||c.name||"Unknown"), city:c.location?.city||c.city||"", state:c.location?.state||c.state||"", par:parseInt(firstTee?.par_total)||72, slope:parseInt(firstTee?.slope_rating)||113, rating:parseFloat(firstTee?.course_rating)||72.0, hole_pars:holes.map(h=>parseInt(h.par)||4), hole_handicaps:holes.map(h=>parseInt(h.handicap)||0), tee_boxes:tees, _source:"GolfCourseAPI" };
          });
        };

        // 1. RapidAPI
        try {
          const r = await fetch(`/api/courses2?search=${encodeURIComponent(q)}${stateParam}`);
          if (r.ok) { const data = await r.json(); const raw = Array.isArray(data)?data:(data.courses||data.data||[]); results = [...results, ...parseRapidAPI(raw, stateFilter)]; }
        } catch(e) { console.log("[RapidAPI] failed:", e); }

        // 2. GolfCourseAPI
        try {
          const r2 = await fetch(`/api/courses?search=${encodeURIComponent(q)}${stateParam}`);
          if (r2.ok) {
            const data2 = await r2.json();
            const gcParsed = parseGolfCourseAPI(data2);
            const existingNames = new Set(results.map(r => r.name.toLowerCase()));
            for (const gc of gcParsed) {
              if (!stateMatches(gc.state, stateFilter)) continue;
              if (!existingNames.has(gc.name.toLowerCase())) results.push(gc);
            }
          }
        } catch(e) { console.log("[GolfCourseAPI] failed:", e); }

        // If no results with state filter, retry without state param but still filter client-side
        if (results.length === 0 && stateFilter) {
          try {
            const r3 = await fetch(`/api/courses2?search=${encodeURIComponent(q)}`);
            if (r3.ok) { const d3 = await r3.json(); const raw3 = Array.isArray(d3)?d3:(d3.courses||d3.data||[]); results = [...results, ...parseRapidAPI(raw3, stateFilter)]; }
          } catch(e) {}
          try {
            const r4 = await fetch(`/api/courses?search=${encodeURIComponent(q)}`);
            if (r4.ok) { const d4 = await r4.json(); const gc4 = parseGolfCourseAPI(d4).filter(c => stateMatches(c.state, stateFilter)); for (const gc of gc4) { if (!results.find(r => r.name.toLowerCase() === gc.name.toLowerCase())) results.push(gc); } }
          } catch(e) {}
        }

        results = results.map(c => ({ ...c, _incompleteData: !hasRealSlope(c) }));
        setSearchResults(results);
      } catch(err) { console.log("Search failed:", err); setSearchResults([]); }
      setSearchLoading(false);
    }, 400);
  };

  const InputStyle = { width: "100%", padding: "10px 12px", background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 8, color: BC.t1, fontSize: 13, boxSizing: "border-box", outline: "none", fontFamily: "'Montserrat', sans-serif" };
  const LabelStyle = { fontSize: 10, color: BC.t3, fontWeight: 700, letterSpacing: 1, marginBottom: 4, display: "block" };
  const BtnStyle = { padding: "10px 20px", borderRadius: 10, border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer", background: `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})`, color: "#0a0804" };

  return (
    <div style={{ fontFamily: "'Montserrat', sans-serif" }}>
      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, background: BC.card, borderRadius: 12, padding: 4, border: `1px solid ${BC.bdr}` }}>
        {[["players","Players"],["rounds","Rounds"],["matches","Matches"],["courses","Courses"]].map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            flex: 1, padding: "8px 4px", borderRadius: 8, fontSize: 10, fontWeight: 700, cursor: "pointer", border: "none",
            background: tab === k ? `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})` : "transparent",
            color: tab === k ? "#0a0804" : BC.t3,
          }}>{lbl}</button>
        ))}
      </div>

      {tab === "players" && (
        <div>
          {[TEAM_A, TEAM_B].map(team => (
            <div key={team.id} style={{ marginBottom: 10 }}>
              {/* Team header with editable name */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "8px 12px", background: team.color + "33", borderRadius: 10, border: `1px solid ${team.accent}44` }}>
                {team.logo && !editingTeam && (
                  <img src={team.logo} alt={team.name} style={{ width: 28, height: 28, objectFit: "contain", flexShrink: 0 }} />
                )}
                {editingTeam === team.id ? (
                  <input
                    autoFocus
                    value={editTeamNames[team.id]}
                    onChange={e => setEditTeamNames(n => ({ ...n, [team.id]: e.target.value }))}
                    onBlur={() => setEditingTeam(null)}
                    onKeyDown={async e => {
                      if (e.key === "Enter") {
                        const newName = editTeamNames[team.id].trim();
                        if (!newName) { setEditingTeam(null); return; }
                        if (window.confirm(`Rename to "${newName}"?`)) {
                          await onSaveTeamNames({ ...teamNames, [team.id]: newName });
                        }
                        setEditingTeam(null);
                      }
                      if (e.key === "Escape") setEditingTeam(null);
                    }}
                    style={{ flex: 1, background: "transparent", border: "none", borderBottom: `1px solid ${team.accent}`, color: team.accent, fontSize: 11, fontWeight: 800, letterSpacing: 1, outline: "none", textTransform: "uppercase" }}
                  />
                ) : (
                  <span
                    onClick={() => setEditingTeam(team.id)}
                    title="Click to edit team name"
                    style={{ fontSize: 11, fontWeight: 800, color: team.accent, letterSpacing: 1, flex: 1, cursor: "pointer" }}
                  >{teamNames[team.id].toUpperCase()}</span>
                )}
                {/* + Add button inline with team name */}
                <button
                  onClick={() => setNewPlayerTeam(prev => prev === team.id ? null : team.id)}
                  style={{
                    padding: "3px 10px", borderRadius: 8, border: `1px solid ${team.accent}66`,
                    background: newPlayerTeam === team.id ? team.accent : "transparent",
                    color: newPlayerTeam === team.id ? "#0a0804" : team.accent,
                    fontSize: 16, fontWeight: 700, cursor: "pointer", lineHeight: 1, flexShrink: 0,
                  }}>+</button>
              </div>

              {/* Expandable add card */}
              {newPlayerTeam === team.id && (
                <div style={{ background: BC.inp, borderRadius: 10, padding: 10, marginBottom: 10, border: `1px solid ${team.accent}44` }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      autoFocus
                      value={newPlayerName}
                      onChange={e => setNewPlayerName(e.target.value)}
                      onKeyDown={async e => { if (e.key === "Enter") { if (!newPlayerName.trim()) return; const pid = `bc_player_${Date.now()}`; await onAddPlayer({ id: pid, player_id: pid, tournament_id: TOURNAMENT_ID, name: newPlayerName.trim(), team: team.id, handicap_index: parseFloat(newPlayerHI) || 0 }); setNewPlayerName(""); setNewPlayerHI(""); setNewPlayerTeam(null); notify(`Added!`, "success"); } }}
                      placeholder="Player name"
                      style={{ flex: 2, padding: "9px 10px", background: "#1e1c18", border: `1px solid ${team.accent}55`, borderRadius: 8, color: "#ffffff", fontSize: 12, outline: "none" }}
                    />
                    <input
                      value={newPlayerHI}
                      onChange={e => setNewPlayerHI(e.target.value)}
                      placeholder="HI"
                      type="number"
                      style={{ width: 52, padding: "9px 8px", background: "#1e1c18", border: `1px solid ${team.accent}55`, borderRadius: 8, color: "#ffffff", fontSize: 12, outline: "none" }}
                    />
                    <button onClick={async () => {
                      if (!newPlayerName.trim()) { notify("Enter a name", "error"); return; }
                      const pid = `bc_player_${Date.now()}`;
                      await onAddPlayer({ id: pid, player_id: pid, tournament_id: TOURNAMENT_ID, name: newPlayerName.trim(), team: team.id, handicap_index: parseFloat(newPlayerHI) || 0 });
                      setNewPlayerName(""); setNewPlayerHI(""); setNewPlayerTeam(null);
                      notify(`Added!`, "success");
                    }} style={{ padding: "9px 12px", borderRadius: 8, border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer", background: team.color, border: `1px solid ${team.accent}`, color: team.accent, flexShrink: 0 }}>✓</button>
                    <button onClick={() => { setNewPlayerTeam(null); setNewPlayerName(""); setNewPlayerHI(""); }} style={{
                      padding: "9px 10px", borderRadius: 8, border: `1px solid ${BC.bdr}`, background: "transparent", color: BC.t3, fontSize: 12, cursor: "pointer", flexShrink: 0,
                    }}>✕</button>
                  </div>
                </div>
              )}

              {/* Player list */}
              {tPlayers.filter(p => p.team === team.id).map(p => {
                const isEditing = editingPlayer?.pid === p.player_id;
                const isSwiping = swipePid === p.player_id;
                const dx = isSwiping ? swipeX : 0;
                const showDelete = dx < -60;
                return (
                  <div key={p.player_id} style={{ position: "relative", marginBottom: 2, borderRadius: 6, overflow: "hidden" }}>
                    {/* Swipe-to-delete red background */}
                    <div style={{ position: "absolute", inset: 0, background: BC.danger, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 16 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>Delete</span>
                    </div>
                    {/* Row */}
                    <div
                      onTouchStart={e => { swipeStartX.current = e.touches[0].clientX; setSwipePid(p.player_id); setSwipeX(0); }}
                      onTouchMove={e => { if (swipeStartX.current == null) return; const dx2 = e.touches[0].clientX - swipeStartX.current; setSwipeX(Math.min(0, dx2)); }}
                      onTouchEnd={() => { if (swipeX < -80) { if (window.confirm(`Remove ${p.name}?`)) { onRemovePlayer(p.player_id); } } setSwipePid(null); setSwipeX(0); swipeStartX.current = null; }}
                      style={{ background: BC.card, borderRadius: 6, padding: "4px 8px", border: `1px solid ${BC.bdr}`, display: "flex", alignItems: "center", gap: 6, boxShadow: `inset 3px 0 0 ${team.accent}55`, position: "relative", transform: `translateX(${dx}px)`, transition: isSwiping ? "none" : "transform 0.2s ease" }}>
                      {isEditing ? (
                        <>
                          <input autoFocus value={editingPlayer.name} onChange={e => setEditingPlayer(prev => ({...prev, name: e.target.value}))}
                            style={{ fontSize: 12, fontWeight: 600, color: BC.t1, width: 110, flexShrink: 0, background: BC.inp, border: `1px solid ${team.accent}66`, borderRadius: 4, padding: "2px 6px", outline: "none", fontFamily: "'Montserrat', sans-serif" }} />
                          <input type="number" value={editingPlayer.hi} onChange={e => setEditingPlayer(prev => ({...prev, hi: e.target.value}))}
                            style={{ fontSize: 11, color: BC.t1, width: 42, flexShrink: 0, background: BC.inp, border: `1px solid ${team.accent}66`, borderRadius: 4, padding: "2px 6px", outline: "none", fontFamily: "'Montserrat', sans-serif" }} />
                          <span style={{ flex: 1 }} />
                          <button onClick={() => {
                            const changes = [];
                            if (editingPlayer.name !== p.name) changes.push(`Name: "${p.name}" → "${editingPlayer.name}"`);
                            if (parseFloat(editingPlayer.hi) !== parseFloat(p.handicap_index)) changes.push(`HI: ${p.handicap_index} → ${editingPlayer.hi}`);
                            if (changes.length === 0) { setEditingPlayer(null); return; }
                            if (window.confirm("Confirm changes for " + p.name + ":\n" + changes.join("\n"))) {
                              onUpdatePlayer({ ...p, name: editingPlayer.name.trim(), handicap_index: parseFloat(editingPlayer.hi) || 0 });
                            }
                            setEditingPlayer(null);
                          }} style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, border: "none", background: team.accent, color: "#0a0804", fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>✓</button>
                          <button onClick={() => setEditingPlayer(null)} style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, border: `1px solid ${BC.bdr}`, background: "transparent", color: BC.t3, cursor: "pointer", flexShrink: 0 }}>✕</button>
                        </>
                      ) : (
                        <>
                          <span style={{ fontSize: 12, fontWeight: 600, color: team.accent + "88", width: 110, flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                          <span style={{ fontSize: 11, fontWeight: 400, color: BC.t1, width: 36, flexShrink: 0 }}>{p.handicap_index}</span>
                          <span style={{ flex: 1 }} />
                          <button onClick={() => setEditingPlayer({ pid: p.player_id, name: p.name, hi: String(p.handicap_index) })} style={{
                            fontSize: 9, padding: "1px 5px", borderRadius: 4, border: `1px solid ${BC.bdr}`, background: "transparent", color: BC.t3, cursor: "pointer", flexShrink: 0,
                          }}>Edit</button>
                          <button onClick={() => onUpdatePlayer({ ...p, isDirector: !p.isDirector })} style={{
                            fontSize: 7, padding: "1px 3px", borderRadius: 3, border: `1px solid ${p.isDirector ? BC.amber : BC.bdr}`,
                            background: p.isDirector ? BC.amber + "22" : "transparent", color: p.isDirector ? BC.amber : BC.t3, cursor: "pointer", fontWeight: 700, flexShrink: 0,
                          }}>DIR</button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              {tPlayers.filter(p => p.team === team.id).length === 0 && (
                <div style={{ color: BC.t3, fontSize: 11, padding: "6px 10px" }}>No players yet.</div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "rounds" && (
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {[1,2,3,4].map(r => (
              <button key={r} onClick={() => {
                setEditRound(r);
                const tr = tRounds.find(t => t.round_number === r);
                if (tr) {
                  setRoundFormat(tr.format || "singles");
                  setRoundCourse(tr.course_id || "");
                  setRoundTeeTime(tr.tee_time || "");
                  setNassau({ front: tr.nassau_front || 1, back: tr.nassau_back || 1, overall: tr.nassau_overall || 1 });
                }
                // Load existing overrides and handicap mode for this round
                setHcpOverrides(prev => ({ ...prev }));
                if (tr?.handicap_mode) setHandicapMode(prev => ({ ...prev, [r]: tr.handicap_mode }));
              }} style={{
                flex: 1, padding: "8px 4px", borderRadius: 10, fontSize: 11, fontWeight: 700, cursor: "pointer",
                background: editRound === r ? `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})` : BC.card,
                border: `1px solid ${editRound === r ? "transparent" : BC.bdr}`,
                color: editRound === r ? "#0a0804" : BC.t2,
              }}>Rd {r}</button>
            ))}
          </div>
          <div style={{ background: BC.card, borderRadius: 12, padding: "12px 12px", border: `1px solid ${BC.bdr}` }}>
            {/* Format + Course — 2 col compact, matched sizing */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: BC.gold, marginBottom: 6 }}>FORMAT</div>
                <select value={roundFormat} onChange={e => {
                  const fmt = FORMATS.find(f => f.id === e.target.value);
                  setRoundFormat(e.target.value);
                  if (fmt?.nassau) setNassau(fmt.nassau);
                }} style={{ ...InputStyle, marginBottom: 0, fontSize: 12, padding: "8px 8px", height: 38 }}>
                  <option value="">Select...</option>
                  {FORMATS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: BC.gold, marginBottom: 6 }}>COURSE</div>
                {(() => {
                  const tr = tRounds.find(t => t.round_number === editRound);
                  const course = courses.find(c => c.id === tr?.course_id);
                  return (
                    <div style={{ padding: "8px 8px", background: BC.inp, borderRadius: 8, border: `1px solid ${BC.bdr}`, fontSize: 12, color: course ? BC.t1 : BC.t3, height: 38, display: "flex", alignItems: "center", overflow: "hidden" }}>
                      {course ? <span style={{ fontWeight: 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{course.name}</span> : <span>Set in Courses tab</span>}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Tee Times */}

            {(() => {
              const parseTime = (str) => {
                if (!str) return null;
                const clean = str.trim();
                // Check for explicit AM/PM
                const apMatch = clean.match(/[aApP][mM]/);
                const ap = apMatch ? apMatch[0].toLowerCase() : null;
                const digits = clean.replace(/[^0-9]/g, "");
                if (!digits) return null;
                let h, min;
                // Interpret digit sequences: 1=1:00, 12=12:00, 110=1:10, 800=8:00, 1230=12:30
                if (digits.length <= 2) {
                  h = parseInt(digits); min = 0;
                } else if (digits.length === 3) {
                  h = parseInt(digits[0]); min = parseInt(digits.slice(1));
                } else {
                  h = parseInt(digits.slice(0, 2)); min = parseInt(digits.slice(2, 4));
                }
                if (ap === "pm" && h !== 12) h += 12;
                else if (ap === "am" && h === 12) h = 0;
                else if (!ap) {
                  // No AM/PM: golf is morning, assume AM for 5-11, PM for 1-4, keep 12
                  if (h >= 1 && h <= 4) h += 12;
                }
                return h * 60 + min;
              };
              const formatTime = (mins) => {
                if (mins == null) return "";
                let h = Math.floor(mins / 60) % 24, m = mins % 60;
                const ap = h >= 12 ? "PM" : "AM";
                if (h > 12) h -= 12;
                if (h === 0) h = 12;
                return `${h}:${String(m).padStart(2,"0")}`;
              };
              const stripAMPM = (s) => s ? s.replace(/\s*(AM|PM)/gi, "").trim() : s;
              const teeTimes = roundTeeTime ? roundTeeTime.split("|") : ["","","",""];
              const commitTime = (idx, val) => {
                const times = [...teeTimes];
                // Auto-complete
                if (val && !/[aApP][mM]/.test(val)) {
                  const mins = parseTime(val);
                  times[idx] = mins != null ? formatTime(mins) : val;
                } else {
                  times[idx] = val;
                }
                // Propagate from idx 0 or 1
                if (idx === 0) {
                  const t0 = parseTime(times[0]);
                  if (t0 != null) {
                    times[1] = formatTime(t0 + 8);
                    times[2] = formatTime(t0 + 16);
                    times[3] = formatTime(t0 + 24);
                  }
                } else if (idx === 1) {
                  const t0 = parseTime(times[0]);
                  const t1 = parseTime(times[1]);
                  if (t0 != null && t1 != null) {
                    const iv = t1 - t0;
                    times[2] = formatTime(t1 + iv);
                    times[3] = formatTime(t1 + iv * 2);
                  }
                }
                setRoundTeeTime(times.join("|"));
              };
              const tt = roundTeeTime ? roundTeeTime.split("|") : ["","","",""];
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: BC.gold, flexShrink: 0 }}>TEE TIMES</div>
                  {["G1","G2","G3","G4"].map((lbl, i) => (
                    <div key={i} style={{ flex: 1, display: "flex", alignItems: "center", gap: 3 }}>
                      <span style={{ fontSize: 9, color: BC.t3, flexShrink: 0, fontWeight: 600 }}>{lbl}</span>
                      <input
                        value={stripAMPM(tt[i] || "")}
                        onChange={e => { const times = [...tt]; times[i] = e.target.value; setRoundTeeTime(times.join("|")); }}
                        onBlur={e => commitTime(i, e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") { e.target.blur(); } }}
                        placeholder=""
                        inputMode="numeric"
                        style={{ ...InputStyle, marginBottom: 0, fontSize: 16, padding: "4px 3px", textAlign: "center", minWidth: 0, transform: "scale(0.85)", transformOrigin: "center" }}
                      />
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Scoring + Low Man toggle on same line */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: BC.gold, flexShrink: 0 }}>SCORING</div>
              {[["front", "F9"], ["back", "B9"], ["overall", "OVR"]].map(([k, lbl]) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <span style={{ fontSize: 9, color: BC.t3, flexShrink: 0 }}>{lbl}</span>
                  <input type="number" step="0.5" min="0" value={nassau[k]}
                    onChange={e => setNassau(n => ({ ...n, [k]: parseFloat(e.target.value) || 0 }))}
                    onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
                    style={{ ...InputStyle, marginBottom: 0, padding: "4px 4px", fontSize: 11, textAlign: "center", width: 38 }} />
                </div>
              ))}
              {/* Low Man / All toggle inline */}
              <div style={{ display: "flex", background: BC.bg, borderRadius: 20, padding: 2, border: `1px solid ${BC.bdr}`, marginLeft: "auto" }}>
                {[["low_man", "Low Man"], ["full", "All"]].map(([val, lbl]) => {
                  const active = (handicapMode[editRound] || "low_man") === val;
                  return (
                    <button key={val} onClick={() => setHandicapMode(prev => ({ ...prev, [editRound]: val }))} style={{
                      padding: "3px 8px", borderRadius: 16, fontSize: 9, fontWeight: 700, border: "none", cursor: "pointer",
                      background: active ? `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})` : "transparent",
                      color: active ? "#0a0804" : BC.t3,
                    }}>{lbl}</button>
                  );
                })}
              </div>
            </div>

            {/* Handicap Overrides */}
            <div style={{ marginBottom: 14 }}>
              {/* PLAYER DETAILS header already in column headers */}
              {tPlayers.length === 0 && <div style={{ fontSize: 11, color: BC.t3 }}>No players added yet.</div>}
              {tPlayers.length > 0 && (() => {
                const tr2h = tRounds.find(t => t.round_number === editRound);
                const course2h = courses.find(c => c.id === tr2h?.course_id);
                const tees2h = course2h?.tee_boxes || [];
                // Grid: name | init | round-input | tee-dots... | delta
                const gridCols = `1fr 30px 58px ${tees2h.map(() => "22px").join(" ")} 22px`;
                return (
                  <div>
                    <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 4, padding: "0 2px", marginBottom: 4, alignItems: "center" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: BC.gold }}>PLAYER DETAILS</div>
                      <div style={{ fontSize: 7, color: BC.t3, fontWeight: 700, textAlign: "center", lineHeight: 1.2 }}>Init HI</div>
                      <div style={{ fontSize: 7, color: BC.t3, fontWeight: 700, textAlign: "center" }}>Round HI</div>
                      {tees2h.length > 0
                        ? <div style={{ fontSize: 7, color: BC.t3, fontWeight: 700, textAlign: "center", gridColumn: `span ${tees2h.length}` }}>Tee</div>
                        : null}
                      <div />
                    </div>
                  </div>
                );
              })()}
              {[TEAM_A, TEAM_B].map((team, teamIdx) => (
                <div key={team.id} style={{ marginBottom: 4 }}>
                  {teamIdx === 1 && <div style={{ height: 1, background: BC.bdr, margin: "6px 0 8px" }} />}
                  {tPlayers.filter(p => p.team === team.id).map(p => {
                    const baseHI = p.handicap_index;
                    const override = hcpOverrides[editRound]?.[p.player_id];
                    const hasOverride = override !== undefined && override !== "";
                    const tr2 = tRounds.find(t => t.round_number === editRound);
                    const course2 = courses.find(c => c.id === tr2?.course_id);
                    const tees2 = course2?.tee_boxes || [];
                    const assignments2 = teeAssignments[editRound] || {};
                    const currentTee2 = assignments2[p.player_id] || tees2[0]?.name;
                    const assignTee2 = (teeName) => {
                      const oldTee = tees2.find(t => t.name === (assignments2[p.player_id] || tees2[0]?.name));
                      const newTee = tees2.find(t => t.name === teeName);
                      if (oldTee && newTee) {
                        const oldCH = calcCH(parseFloat(baseHI)||0, oldTee.slope||113, oldTee.rating||72, oldTee.par||72);
                        const newCH = calcCH(parseFloat(baseHI)||0, newTee.slope||113, newTee.rating||72, newTee.par||72);
                        showChDelta(`tee_${editRound}_${p.player_id}`, newCH - oldCH);
                      }
                      setTeeAssignments(prev => ({ ...prev, [editRound]: { ...(prev[editRound]||{}), [p.player_id]: teeName } }));
                    };
                    return (
                      <div key={p.player_id} style={{ display: "grid", gridTemplateColumns: `1fr 30px 58px ${tees2.map(() => "22px").join(" ")} 22px`, gap: 4, alignItems: "center", marginBottom: 3 }}>
                        <div style={{ fontSize: 11, color: (p.team === "A" ? TEAM_A : TEAM_B).accent + "88", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                        <div style={{ fontSize: 10, color: BC.t3, textAlign: "center" }}>{baseHI}</div>
                        <input
                          type="number" step="0.1"
                          value={hasOverride ? override : ""}
                          onChange={e => {
                            const newVal = e.target.value;
                            const oldHI = parseFloat(hcpOverrides[editRound]?.[p.player_id] ?? p.handicap_index) || 0;
                            const newHI = parseFloat(newVal) || parseFloat(p.handicap_index) || 0;
                            const trC = tRounds.find(t => t.round_number === editRound);
                            const crs = courses.find(c => c.id === trC?.course_id);
                            if (crs && newVal !== "") {
                              showChDelta(`hcp_${editRound}_${p.player_id}`,
                                calcCH(newHI, crs.slope||113, crs.rating||72, crs.par||72) -
                                calcCH(oldHI, crs.slope||113, crs.rating||72, crs.par||72));
                            }
                            setHcpOverrides(prev => ({ ...prev, [editRound]: { ...(prev[editRound]||{}), [p.player_id]: newVal } }));
                          }}
                          placeholder={String(baseHI)}
                          style={{ padding: "5px 8px", background: hasOverride ? BC.amber+"15" : BC.inp, border: `1px solid ${hasOverride ? BC.amber : BC.bdr}`, borderRadius: 6, color: hasOverride ? BC.amber : BC.t2, fontSize: 12, fontWeight: hasOverride ? 700 : 400, outline: "none", textAlign: "center" }}
                        />
                        {tees2.map((tee, ti) => {
                          const isAct = currentTee2 === tee.name;
                          return (
                            <button key={tee.name} onClick={() => assignTee2(tee.name)} title={tee.name} style={{
                              background: "transparent", border: "none", cursor: "pointer", padding: 0,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              opacity: isAct ? 1 : 0.35,
                              transform: isAct ? "scale(1.3)" : "scale(1)",
                              transition: "all 0.15s ease",
                            }}>
                              <TeeCircle tee={tee} index={ti} size={14} active={isAct} />
                            </button>
                          );
                        })}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {chDeltas[`hcp_${editRound}_${p.player_id}`] !== undefined && (
                            <ChDeltaBadge delta={chDeltas[`hcp_${editRound}_${p.player_id}`]} />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            <button onClick={saveRound} style={BtnStyle}>Save Round {editRound}</button>
          </div>
        </div>
      )}

      {tab === "matches" && (() => {
        const tr = tRounds.find(t => t.round_number === matchRound);
        const course = courses.find(c => c.id === tr?.course_id);
        const hcpMode = tr?.handicap_mode || "low_man";

        // Get CH for a player using round overrides and tee assignments
        const getPlayerCH = (pid) => {
          const p = tPlayers.find(t => t.player_id === pid);
          if (!p || !course) return 0;
          const hi = parseFloat(hcpOverrides?.[matchRound]?.[pid] ?? p.handicap_index) || 0;
          const teeAssign = teeAssignments[matchRound]?.[pid];
          const teeObj = teeAssign ? (course.tee_boxes||[]).find(t => t.name === teeAssign) : (course.tee_boxes||[])[0];
          return calcCH(hi, teeObj?.slope||course.slope||113, teeObj?.rating||course.rating||72, teeObj?.par||course.par||72);
        };

        // Stroke situation: given selected players, compute who gets strokes vs who
        const strokeSituation = () => {
          const allPids = [...matchTeamA, ...matchTeamB];
          if (allPids.length < 2) return null;
          const chs = allPids.map(pid => ({ pid, ch: getPlayerCH(pid) }));
          const minCH = Math.min(...chs.map(c => c.ch));
          if (hcpMode === "full") {
            return chs.map(({pid, ch}) => ({ pid, strokes: ch }));
          }
          return chs.map(({pid, ch}) => ({ pid, strokes: ch - minCH }));
        };

        const allSelected = [...matchTeamA, ...matchTeamB];
        const strokes = strokeSituation();

        return (
        <div>
          {/* Round tabs */}
          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
            {[1,2,3,4].map(r => (
              <button key={r} onClick={() => { setMatchRound(r); setMatchTeamA([]); setMatchTeamB([]); }} style={{
                flex: 1, padding: "7px 4px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
                background: matchRound === r ? `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})` : BC.card,
                border: `1px solid ${matchRound === r ? "transparent" : BC.bdr}`,
                color: matchRound === r ? "#0a0804" : BC.t2,
              }}>Rd {r}</button>
            ))}
          </div>

          {/* Player pool — two columns by team */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
            {[["A", teamAPlayers], ["B", teamBPlayers]].map(([tid, players]) => {
              const team = getTeam(tid);
              const sel = tid === "A" ? matchTeamA : matchTeamB;
              const setSel = tid === "A" ? setMatchTeamA : setMatchTeamB;
              return (
                <div key={tid}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: team.accent, letterSpacing: 1, marginBottom: 5 }}>{teamNames?.[tid]}</div>
                  {players.map(p => {
                    const isSelected = sel.includes(p.player_id);
                    const ch = getPlayerCH(p.player_id);
                    return (
                      <button key={p.player_id} onClick={() => setSel(prev => isSelected ? prev.filter(x => x !== p.player_id) : [...prev, p.player_id])} style={{
                        width: "100%", padding: "7px 8px", marginBottom: 3, borderRadius: 8, cursor: "pointer", textAlign: "left",
                        background: isSelected ? team.color + "55" : BC.inp,
                        border: `1.5px solid ${isSelected ? team.accent : BC.bdr}`,
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                      }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: isSelected ? team.accent : BC.t2 }}>{p.name}</span>
                        <span style={{ fontSize: 10, color: BC.t3 }}>CH {ch}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Stroke situation — shown when all players selected */}
          {strokes && allSelected.length >= 2 && (
            <div style={{ background: BC.card, borderRadius: 10, padding: "10px 12px", marginBottom: 10, border: `1px solid ${BC.bdr}` }}>
              <div style={{ fontSize: 9, color: BC.t3, fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>
                STROKE SITUATION · {hcpMode === "low_man" ? "Play Off Low Man" : "Full Strokes"}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {strokes.map(({ pid, strokes: s }) => {
                  const p = tPlayers.find(t => t.player_id === pid);
                  const team = getTeam(p?.team);
                  return (
                    <div key={pid} style={{ background: team.color + "33", border: `1px solid ${team.accent}44`, borderRadius: 8, padding: "5px 10px", textAlign: "center" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: team.accent }}>{p?.name?.split(" ")[0]}</div>
                      <div style={{ fontSize: 13, fontWeight: 900, color: s === 0 ? BC.gold : BC.t1 }}>{s === 0 ? "Scratch" : `+${s}`}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Create Match button */}
          {matchTeamA.length > 0 && matchTeamB.length > 0 && (
            <button onClick={saveMatch} style={{ ...BtnStyle, marginBottom: 14 }}>
              Create Match — {matchTeamA.map(pid => tPlayers.find(p=>p.player_id===pid)?.name?.split(" ")[0]).join("/")} vs {matchTeamB.map(pid => tPlayers.find(p=>p.player_id===pid)?.name?.split(" ")[0]).join("/")}
            </button>
          )}

          {/* Existing matches by round */}
          {[1,2,3,4].map(r => {
            const rndM = matches.filter(m => m.round === r);
            if (!rndM.length) return null;
            const trR = tRounds.find(t => t.round_number === r);
            const fmt = FORMATS.find(f => f.id === trR?.format);
            return (
              <div key={r} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: BC.gold, fontWeight: 700, marginBottom: 8, letterSpacing: 1 }}>ROUND {r}{fmt ? ` · ${fmt.label}` : ""}</div>
                {rndM.map(m => (
                  <div key={m.id} style={{ background: BC.card, borderRadius: 10, padding: "8px 12px", marginBottom: 5, border: `1px solid ${BC.bdr}`, display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, fontSize: 11 }}>
                      <span style={{ color: TEAM_A.accent+"99", fontWeight: 600 }}>{m.teamANames?.join(" / ")}</span>
                      <span style={{ color: BC.t3 }}> vs </span>
                      <span style={{ color: TEAM_B.accent+"99", fontWeight: 600 }}>{m.teamBNames?.join(" / ")}</span>
                    </div>
                    <button onClick={() => onSetMatch({ ...m, _delete: true })} style={{
                      fontSize: 9, padding: "3px 7px", borderRadius: 6, border: `1px solid ${BC.danger}22`, background: "transparent", color: BC.danger, cursor: "pointer", flexShrink: 0,
                    }}>✕</button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        );
      })()}

      {tab === "courses" && (
        <div>
          {/* Course Library */}
          <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, marginBottom: 14, overflow: "hidden" }}>
            <div style={{ padding: "9px 14px", borderBottom: `1px solid ${BC.bdr}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: BC.gold }}>{courses.length} COURSE{courses.length !== 1 ? "S" : ""}</span>
              <button onClick={() => { setSearching(!searching); setCourseSearch(""); setSearchResults([]); }} style={{ padding: "4px 10px", borderRadius: 6, background: "transparent", border: `1px solid ${BC.amber}66`, color: BC.amber, fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                {searching ? "Close" : "+ Add Course"}
              </button>
            </div>

            {courses.map((c, i) => (
              <div key={c.id} style={{ borderBottom: i < courses.length - 1 ? `1px solid ${BC.bdr}22` : "none" }}>
                <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
                  <button onClick={() => setExpandedCourse(expandedCourse === c.id ? null : c.id)} style={{ flex: 1, background: "transparent", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: BC.t1 }}>{c.name}</div>
                    <div style={{ fontSize: 10, color: BC.t3, marginTop: 1 }}>{[c.city, c.state].filter(Boolean).join(", ")} · Par {c.par} · Slope {c.slope}</div>
                  </button>
                  {/* Round assignment buttons */}
                  <div style={{ display: "flex", gap: 3 }}>
                    {[1,2,3,4].map(r => {
                      const tr = tRounds.find(t => t.round_number === r);
                      const isAssigned = tr?.course_id === c.id;
                      const otherCourse = tr?.course_id && tr.course_id !== c.id && courses.find(x => x.id === tr.course_id);
                      return (
                        <button key={r} onClick={async () => {
                          if (isAssigned) {
                            await onSetRound({ id: `bc_round_${r}`, tournament_id: TOURNAMENT_ID, round_number: r, course_id: null, format: tr?.format || "singles", tee_time: tr?.tee_time || "", nassau_front: tr?.nassau_front || 1, nassau_back: tr?.nassau_back || 1, nassau_overall: tr?.nassau_overall || 1 });
                          } else if (otherCourse) {
                            if (window.confirm(`Replace ${otherCourse.name} for Rd ${r}?`)) {
                              await onSetRound({ id: `bc_round_${r}`, tournament_id: TOURNAMENT_ID, round_number: r, course_id: c.id, format: tr?.format || "singles", tee_time: tr?.tee_time || "", nassau_front: tr?.nassau_front || 1, nassau_back: tr?.nassau_back || 1, nassau_overall: tr?.nassau_overall || 1 });
                            }
                          } else {
                            await onSetRound({ id: `bc_round_${r}`, tournament_id: TOURNAMENT_ID, round_number: r, course_id: c.id, format: tr?.format || "singles", tee_time: tr?.tee_time || "", nassau_front: tr?.nassau_front || 1, nassau_back: tr?.nassau_back || 1, nassau_overall: tr?.nassau_overall || 1 });
                          }
                        }} style={{
                          padding: "3px 6px", borderRadius: 4, fontSize: 9, fontWeight: 700, cursor: "pointer", minWidth: 24, textAlign: "center",
                          background: isAssigned ? BC.amber : "transparent",
                          color: isAssigned ? "#0a0804" : BC.t3,
                          border: `1px solid ${isAssigned ? BC.amber : BC.bdr}`,
                        }}>R{r}</button>
                      );
                    })}
                  </div>
                  <button onClick={() => { if (window.confirm(`Remove ${c.name}?`)) onAddCourse({ ...c, _delete: true }); }} style={{ background: "transparent", border: "none", color: BC.t3, cursor: "pointer", fontSize: 14, padding: "2px 4px" }}>✕</button>
                </div>
                {expandedCourse === c.id && (
                  <div style={{ padding: "0 14px 12px", background: BC.amber + "06" }}>
                    {(c.tee_boxes || []).sort((a,b) => (parseFloat(b.slope)||0) - (parseFloat(a.slope)||0)).map((tb, tbi) => (
                      <div key={tbi} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3, fontSize: 10 }}>
                        <span style={{ display:"inline-block", width:10, height:10, borderRadius:2, background:tb.color||"#888", flexShrink:0 }} />
                        <span style={{ color: BC.t2, fontWeight: 600, width: 50 }}>{tb.name}</span>
                        <span style={{ color: BC.t3 }}>Rating {tb.rating} · Slope {tb.slope} · Par {tb.par}</span>
                      </div>
                    ))}
                    {(c.tee_boxes || []).length === 0 && <div style={{ fontSize: 10, color: BC.t3, fontStyle: "italic" }}>No tee data</div>}
                  </div>
                )}
              </div>
            ))}
            {courses.length === 0 && <div style={{ padding: "16px 14px", color: BC.t3, fontSize: 12 }}>No courses yet. Add one below.</div>}
          </div>

          {/* Search panel */}
          {searching && (
            <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, padding: 14 }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <select value={courseStateFilter} onChange={e => { setCourseStateFilter(e.target.value); if (courseSearch.trim().length >= 2) doCourseSearch(courseSearch, e.target.value); }}
                  style={{ width: 64, padding: "9px 6px", background: BC.inp, border: `1px solid ${BC.amber}44`, borderRadius: 8, color: BC.t1, fontSize: 12, flexShrink: 0 }}>
                  <option value="">All</option>
                  {["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <input value={courseSearch} onChange={e => doCourseSearch(e.target.value)} placeholder="Search by course or city..." autoFocus
                  style={{ flex: 1, padding: "9px 12px", background: BC.inp, border: `1px solid ${BC.amber}44`, borderRadius: 8, color: BC.t1, fontSize: 13, outline: "none" }} />
              </div>

              {searchLoading && <div style={{ textAlign: "center", padding: 12, color: BC.t3, fontSize: 11 }}>Searching GolfCourseAPI...</div>}

              {!searchLoading && courseSearch.trim().length >= 2 && searchResults.length === 0 && (
                <div style={{ textAlign: "center", padding: "10px 0", color: BC.t3, fontSize: 11 }}>No courses found for "{courseSearch}"</div>
              )}

              {!searchLoading && searchResults.filter(c => !courses.find(ex => ex.name.toLowerCase() === c.name.toLowerCase())).map(c => (
                <button key={c.id} onClick={() => setCoursePreview({ ...c, hole_pars: c.hole_pars?.length ? c.hole_pars : Array(18).fill(4), hole_handicaps: c.hole_handicaps?.length ? c.hole_handicaps : Array(18).fill(0).map((_,i)=>i+1) })}
                  style={{ display: "block", width: "100%", background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 10, padding: "10px 14px", cursor: "pointer", textAlign: "left", color: BC.t1, marginBottom: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</span>
                        {c._incompleteData && <span style={{ fontSize: 8, background: "#ef444420", border: "1px solid #ef444440", color: "#ef4444", borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>⚠ incomplete</span>}
                        {c._source && <span style={{ fontSize: 8, background: `${BC.amber}15`, border: `1px solid ${BC.amber}30`, color: BC.amber, borderRadius: 4, padding: "1px 5px", fontWeight: 600 }}>{c._source}</span>}
                      </div>
                      <div style={{ fontSize: 10, color: BC.t3 }}>{[c.city, c.state].filter(Boolean).join(", ")}{c.par ? ` · Par ${c.par}` : ""}{c.slope && c.slope !== 113 ? ` · Slope ${c.slope}` : ""}</div>
                    </div>
                    <span style={{ color: BC.amber, fontSize: 11, fontWeight: 700 }}>Preview →</span>
                  </div>
                </button>
              ))}

              {!courseSearch.trim() && <div style={{ color: BC.t3, fontSize: 10, textAlign: "center", padding: 4 }}>Type at least 2 characters to search</div>}
              <div style={{ fontSize: 9, color: BC.t3, textAlign: "center", marginTop: 8 }}>Powered by GolfCourseAPI.com · 35,000+ courses</div>
            </div>
          )}

          {/* Course Preview / Edit Modal */}
          {coursePreview && (() => {
            const draft = coursePreview;
            const setDraft = fn => setCoursePreview(prev => fn(prev));
            const tbs = draft.tee_boxes || [];
            const ti = { background: BC.bg, border: `1px solid ${BC.amber}30`, borderRadius: 4, color: BC.t1, fontSize: 9, textAlign: "center", width: "100%", padding: "3px 2px", boxSizing: "border-box" };
            const tiL = { ...ti, textAlign: "left", padding: "3px 5px" };
            return (
              <div style={{ position: "fixed", top: 0, bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.85)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
                <div style={{ background: BC.card, borderRadius: 16, border: `1px solid ${BC.amber}44`, width: "100%", maxWidth: 420, maxHeight: "calc(100vh - 48px)", overflowY: "auto", padding: 0 }}>

                  {/* Header */}
                  <div style={{ padding: "14px 16px 10px", borderBottom: `1px solid ${BC.bdr}`, position: "sticky", top: 0, background: BC.card, zIndex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ flex: 1, marginRight: 8 }}>
                        <input value={draft.name} onChange={e => setDraft(p => ({...p, name: e.target.value}))}
                          style={{ background: "transparent", border: "none", borderBottom: `1px solid ${BC.amber}44`, color: BC.t1, fontSize: 14, fontWeight: 800, width: "100%", padding: "2px 0", outline: "none" }} />
                        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                          <input value={draft.city||""} onChange={e => setDraft(p => ({...p, city: e.target.value}))} placeholder="City"
                            style={{ ...tiL, fontSize: 10, flex: 1 }} />
                          <select value={draft.state||""} onChange={e => setDraft(p => ({...p, state: e.target.value}))}
                            style={{ ...ti, fontSize: 10, width: 52 }}>
                            <option value="">—</option>
                            {["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"].map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                      </div>
                      <button onClick={() => setCoursePreview(null)} style={{ background: "transparent", border: "none", color: BC.t3, fontSize: 18, cursor: "pointer", lineHeight: 1 }}>✕</button>
                    </div>
                    {draft._incompleteData && (
                      <div style={{ marginTop: 8, padding: "7px 10px", background: "#ef444410", border: "1px solid #ef444440", borderRadius: 8, fontSize: 9, color: "#ef4444" }}>
                        ⚠ Incomplete data — slope, rating, or tee boxes may be missing. Edit manually below.
                      </div>
                    )}
                  </div>

                  <div style={{ padding: "12px 16px" }}>
                    {/* Tee Boxes */}
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <div style={{ fontSize: 9, color: BC.t3, fontWeight: 700, textTransform: "uppercase" }}>Tee Boxes</div>
                        <button onClick={() => setDraft(p => ({ ...p, tee_boxes: [...(p.tee_boxes||[]), { name: "", color: "#888888", rating: 72.0, slope: 113, par: 72, yardage: 0 }] }))}
                          style={{ fontSize: 9, padding: "2px 7px", borderRadius: 4, background: "transparent", border: `1px solid ${BC.amber}60`, color: BC.amber, cursor: "pointer", fontWeight: 700 }}>+ Tee</button>
                      </div>
                      {tbs.length === 0 && <div style={{ fontSize: 10, color: BC.warn, marginBottom: 8, fontStyle: "italic" }}>⚠ No tees from API — add manually</div>}
                      <div style={{ display: "grid", gridTemplateColumns: "18px 1fr 44px 38px 30px 46px 18px", gap: "3px 4px", fontSize: 8, color: BC.t3, fontWeight: 600, marginBottom: 3 }}>
                        <div/><div>Name</div><div style={{textAlign:"center"}}>Rating</div><div style={{textAlign:"center"}}>Slope</div><div style={{textAlign:"center"}}>Par</div><div style={{textAlign:"center"}}>Yards</div><div/>
                      </div>
                      {tbs.map((tb, i) => (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "18px 1fr 44px 38px 30px 46px 18px", gap: "3px 4px", marginBottom: 4, alignItems: "center" }}>
                          <span style={{ display:"inline-block", width:18, height:18, borderRadius:3, background:tb.color||"#888", border:"1px solid #ffffff20", flexShrink:0 }} />
                          <input value={tb.name} onChange={e => setDraft(p => { const t=[...p.tee_boxes]; t[i]={...t[i],name:e.target.value}; return {...p,tee_boxes:t}; })} style={{...tiL}} placeholder="Name" />
                          <input value={tb.rating} onChange={e => setDraft(p => { const t=[...p.tee_boxes]; t[i]={...t[i],rating:e.target.value}; return {...p,tee_boxes:t}; })} style={ti} />
                          <input value={tb.slope} onChange={e => setDraft(p => { const t=[...p.tee_boxes]; t[i]={...t[i],slope:e.target.value}; return {...p,tee_boxes:t}; })} style={ti} />
                          <input value={tb.par} onChange={e => setDraft(p => { const t=[...p.tee_boxes]; t[i]={...t[i],par:e.target.value}; return {...p,tee_boxes:t}; })} style={ti} />
                          <input value={tb.yardage} onChange={e => setDraft(p => { const t=[...p.tee_boxes]; t[i]={...t[i],yardage:e.target.value}; return {...p,tee_boxes:t}; })} style={ti} />
                          <button onClick={() => setDraft(p => ({...p, tee_boxes: p.tee_boxes.filter((_,j) => j!==i)}))} style={{ background:"transparent", border:"none", color:BC.t3, fontSize:11, cursor:"pointer", padding:0 }}>✕</button>
                        </div>
                      ))}
                    </div>

                    {/* Scorecard */}
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 9, color: BC.t3, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Scorecard</div>
                      {[["Front", 0, 9], ["Back", 9, 9]].map(([lbl, start, count]) => {
                        const pars = (draft.hole_pars || Array(18).fill(4)).slice(start, start+count);
                        const hcps = (draft.hole_handicaps || Array(18).fill(0)).slice(start, start+count);
                        const activeTee = (draft.tee_boxes || [])[0];
                        const hy = (activeTee?.hole_yards || []).slice(start, start+count);
                        const hasYds = hy.some(y => y > 0);
                        return (
                          <div key={lbl} style={{ marginBottom: 6 }}>
                            <div style={{ display: "grid", gridTemplateColumns: `28px repeat(${count}, 1fr) 30px`, gap: 1, fontSize: 8 }}>
                              <div style={{ color: BC.t3, fontWeight: 600, padding: "2px 0" }}>Hole</div>
                              {Array.from({length:count},(_,i) => <div key={i} style={{ textAlign:"center", color:BC.t2, fontWeight:700, padding:"2px 0" }}>{start+i+1}</div>)}
                              <div style={{ textAlign:"center", color:BC.t3, fontSize:7, padding:"2px 0" }}>Tot</div>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: `28px repeat(${count}, 1fr) 30px`, gap: 1, fontSize: 8, background: BC.inp, borderRadius: 3, marginBottom: 1 }}>
                              <div style={{ color: BC.t3, fontWeight: 600, padding: "3px 2px" }}>Par</div>
                              {Array.from({length:count},(_,i) => (
                                <input key={i} value={pars[i]??""} onChange={e => setDraft(p => { const hp=[...(p.hole_pars||Array(18).fill(4))]; hp[start+i]=e.target.value; return {...p,hole_pars:hp}; })}
                                  style={{ background:"transparent", border:"none", color:BC.t1, fontSize:9, fontWeight:700, textAlign:"center", width:"100%", padding:"3px 0", outline:"none" }} />
                              ))}
                              <div style={{ textAlign:"center", color:BC.amber, fontWeight:800, padding:"3px 0", fontSize:9 }}>{pars.reduce((a,b)=>a+(parseInt(b)||0),0)}</div>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: `28px repeat(${count}, 1fr) 30px`, gap: 1, fontSize: 8, marginBottom: 1 }}>
                              <div style={{ color: BC.t3, fontWeight: 600, padding: "2px 2px" }}>HCP</div>
                              {Array.from({length:count},(_,i) => (
                                <input key={i} value={hcps[i]??""} onChange={e => setDraft(p => { const hh=[...(p.hole_handicaps||Array(18).fill(0))]; hh[start+i]=e.target.value; return {...p,hole_handicaps:hh}; })}
                                  style={{ background:"transparent", border:"none", color:BC.t3, fontSize:9, textAlign:"center", width:"100%", padding:"2px 0", outline:"none" }} />
                              ))}
                              <div />
                            </div>
                            {hasYds && (
                              <div style={{ display: "grid", gridTemplateColumns: `28px repeat(${count}, 1fr) 30px`, gap: 1, fontSize: 8 }}>
                                <div style={{ color: BC.t3, fontWeight: 600, padding: "2px 2px" }}>Yds</div>
                                {hy.map((y, i) => <div key={i} style={{ textAlign:"center", color:BC.t3, padding:"2px 0" }}>{y||"–"}</div>)}
                                <div style={{ textAlign:"center", color:BC.t3, padding:"2px 0" }}>{hy.reduce((a,b)=>a+(parseInt(b)||0),0)||""}</div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => setCoursePreview(null)} style={{ flex: 1, padding: "10px 0", borderRadius: 8, background: "transparent", border: `1px solid ${BC.bdr}`, color: BC.t3, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
                      <button onClick={async () => {
                        const firstTee = draft.tee_boxes?.[0];
                        const cid = `bc_course_${Date.now()}`;
                        const rawCourse = {
                          ...draft,
                          id: draft.id?.startsWith("rapid_") || draft.id?.startsWith("gc_") ? cid : (draft.id || cid),
                          tournament_id: TOURNAMENT_ID,
                          par: parseInt(firstTee?.par) || draft.par || 72,
                          slope: parseInt(firstTee?.slope) || draft.slope || 113,
                          rating: parseFloat(firstTee?.rating) || draft.rating || 72.0,
                          hole_pars: (draft.hole_pars||[]).map(v => parseInt(v)||4),
                          hole_handicaps: (draft.hole_handicaps||[]).map(v => parseInt(v)||0),
                          tee_boxes: (draft.tee_boxes||[]).map(tb => ({...tb, rating:parseFloat(tb.rating)||72.0, slope:parseInt(tb.slope)||113, par:parseInt(tb.par)||72, yardage:parseInt(tb.yardage)||0})),
                        };
                        // Strip all undefined fields — Firestore rejects them
                        const finalCourse = Object.fromEntries(Object.entries(rawCourse).filter(([_, v]) => v !== undefined));
                        await onAddCourse(finalCourse);
                        setCoursePreview(null);
                        setSearching(false);
                        notify(`${finalCourse.name} added!`, "success");
                      }} style={{ flex: 2, padding: "10px 0", borderRadius: 8, background: `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})`, border: "none", color: "#0a0804", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>✓ Add Course</button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}


// ── Betting View ──
function BettingView({ tPlayers, tRounds, courses, holeData, skinsData, ctpData, skinsPot, onSetSkin, onSetCtp, onUpdatePot, user, enrichedRounds }) {
  const [activeTab, setActiveTab] = useState("skins");
  const [activeRound, setActiveRound] = useState(1);
  const [editPot, setEditPot] = useState(false);
  const [potInput, setPotInput] = useState(String(skinsPot));
  const [grossMode, setGrossMode] = useState(false);

  const tr = tRounds.find(t => t.round_number === activeRound);
  const course = courses.find(c => c.id === tr?.course_id);
  const holePars = course?.hole_pars || Array(18).fill(4);
  const par3s = holePars.map((p, i) => ({ hole: i, par: p })).filter(h => h.par === 3);

  // Compute skins for a round
  const computeSkins = (round, gross) => {
    const tr2 = tRounds.find(t => t.round_number === round);
    const course2 = courses.find(c => c.id === tr2?.course_id);
    const pars = course2?.hole_pars || Array(18).fill(4);
    const hcps = course2?.hole_handicaps || Array(18).fill(9);

    const skins = [];
    for (let h = 0; h < 18; h++) {
      const scores = tPlayers.map(p => {
        const raw = (holeData[`${p.player_id}_${round}`] || {})[h];
        if (raw == null) return null;
        if (gross) return { pid: p.player_id, name: p.name, score: raw };
        // Net: simple stroke index
        const hi = parseFloat(p.handicap_index) || 0;
        const ch = calcCH(hi, course2?.slope || 113, course2?.rating || 72, course2?.par || 72);
        const sorted = hcps.map((hcp, i) => ({ idx: i, hcp })).sort((a, b) => a.hcp - b.hcp);
        let strokes = 0;
        let rem = Math.abs(ch);
        for (const s of sorted) { if (rem <= 0) break; if (s.idx === h) { strokes++; break; } rem--; }
        return { pid: p.player_id, name: p.name, score: raw - strokes };
      }).filter(Boolean);

      if (scores.length < 2) { skins.push({ hole: h, winner: null, tied: false }); continue; }
      const min = Math.min(...scores.map(s => s.score));
      const winners = scores.filter(s => s.score === min);
      if (winners.length === 1) skins.push({ hole: h, winner: winners[0], score: min, par: pars[h] });
      else skins.push({ hole: h, winner: null, tied: true, score: min });
    }
    return skins;
  };

  const allSkins = [1,2,3,4].flatMap(r => computeSkins(r, grossMode).filter(s => s.winner).map(s => ({ ...s, round: r })));
  const skinCount = {};
  allSkins.forEach(s => { skinCount[s.winner.pid] = (skinCount[s.winner.pid] || 0) + 1; });
  const totalSkins = allSkins.length;
  const perSkin = totalSkins > 0 ? (skinsPot / totalSkins).toFixed(2) : "0.00";

  return (
    <div style={{ fontFamily: "'Montserrat', sans-serif" }}>
      {/* Tab toggle */}
      <div style={{ display: "flex", background: BC.card, borderRadius: 20, padding: 3, marginBottom: 14, border: `1px solid ${BC.bdr}` }}>
        {[["skins","🎰 Skins"],["ctp","🎯 Closest to Pin"]].map(([k,lbl]) => (
          <button key={k} onClick={() => setActiveTab(k)} style={{
            flex: 1, padding: "8px 0", borderRadius: 16, fontSize: 12, fontWeight: 700, cursor: "pointer", border: "none",
            background: activeTab === k ? `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})` : "transparent",
            color: activeTab === k ? "#0a0804" : BC.t3,
          }}>{lbl}</button>
        ))}
      </div>

      {activeTab === "skins" && (
        <div>
          {/* Pot */}
          <div style={{ background: BC.card, borderRadius: 12, padding: "12px 14px", marginBottom: 12, border: `1px solid ${BC.bdr}`, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: BC.t3, fontWeight: 700, letterSpacing: 1 }}>SKINS POT</div>
              {editPot ? (
                <input autoFocus type="number" value={potInput} onChange={e => setPotInput(e.target.value)}
                  onBlur={() => { onUpdatePot(parseFloat(potInput)||0); setEditPot(false); }}
                  onKeyDown={e => { if (e.key === "Enter") { onUpdatePot(parseFloat(potInput)||0); setEditPot(false); }}}
                  style={{ fontSize: 20, fontWeight: 800, color: BC.gold, background: "transparent", border: "none", borderBottom: `1px solid ${BC.amber}`, outline: "none", width: 100, fontFamily: "'Montserrat', sans-serif" }} />
              ) : (
                <div onClick={() => user?.isDirector && setEditPot(true)} style={{ fontSize: 20, fontWeight: 800, color: BC.gold, cursor: user?.isDirector ? "pointer" : "default" }}>
                  ${skinsPot.toFixed(2)}
                </div>
              )}
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: BC.t3 }}>{totalSkins} skins won</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: BC.amber }}>${perSkin} / skin</div>
            </div>
          </div>

          {/* Gross/Net toggle */}
          <div style={{ display: "flex", background: BC.card, borderRadius: 16, padding: 3, marginBottom: 12, border: `1px solid ${BC.bdr}`, width: 160 }}>
            {[["Net", false],["Gross", true]].map(([lbl, val]) => (
              <button key={lbl} onClick={() => setGrossMode(val)} style={{
                flex: 1, padding: "5px 0", borderRadius: 12, fontSize: 10, fontWeight: 700, cursor: "pointer", border: "none",
                background: grossMode === val ? `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})` : "transparent",
                color: grossMode === val ? "#0a0804" : BC.t3,
              }}>{lbl}</button>
            ))}
          </div>

          {/* Leaderboard */}
          {Object.keys(skinCount).length > 0 && (
            <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, marginBottom: 12, overflow: "hidden" }}>
              <div style={{ padding: "8px 14px", borderBottom: `1px solid ${BC.bdr}`, fontSize: 10, fontWeight: 700, color: BC.gold, letterSpacing: 1 }}>SKINS LEADERS</div>
              {Object.entries(skinCount).sort((a,b) => b[1]-a[1]).map(([pid, count]) => {
                const p = tPlayers.find(t => t.player_id === pid);
                const team = p ? getTeam(p.team) : null;
                return (
                  <div key={pid} style={{ display: "flex", alignItems: "center", padding: "8px 14px", borderBottom: `1px solid ${BC.bdr}10`, gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: team?.accent || BC.t3, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: BC.t1 }}>{p?.name || pid}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: BC.amber }}>{count} skin{count !== 1 ? "s" : ""}</span>
                    <span style={{ fontSize: 11, color: BC.t3 }}>${(count * parseFloat(perSkin)).toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Round tabs */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {[1,2,3,4].map(r => (
              <button key={r} onClick={() => setActiveRound(r)} style={{
                flex: 1, padding: "7px 4px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
                background: activeRound === r ? `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})` : BC.card,
                border: `1px solid ${activeRound === r ? "transparent" : BC.bdr}`,
                color: activeRound === r ? "#0a0804" : BC.t2,
              }}>Rd {r}</button>
            ))}
          </div>

          {/* Hole-by-hole skins for active round */}
          {computeSkins(activeRound, grossMode).map(s => (
            <div key={s.hole} style={{ display: "flex", alignItems: "center", padding: "7px 12px", background: BC.card, borderRadius: 8, marginBottom: 4, border: `1px solid ${s.winner ? BC.amber + "44" : s.tied ? BC.bdr : BC.bdr}` }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: BC.t3, width: 40 }}>Hole {s.hole + 1}</span>
              <span style={{ fontSize: 10, color: BC.t3, width: 30 }}>Par {holePars[s.hole]}</span>
              <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: s.winner ? BC.amber : s.tied ? BC.t3 : BC.t3 }}>
                {s.winner ? `${s.winner.name} (${s.score})` : s.tied ? "Tied — pushed" : "—"}
              </span>
              {s.winner && <span style={{ fontSize: 10, color: BC.amber, fontWeight: 700 }}>🏆 Skin</span>}
            </div>
          ))}
        </div>
      )}

      {activeTab === "ctp" && (
        <div>
          <div style={{ fontSize: 11, color: BC.t3, marginBottom: 12 }}>Closest to the pin on all par 3s — director assigns winner per hole per round.</div>

          {[1,2,3,4].map(r => {
            const tr2 = tRounds.find(t => t.round_number === r);
            const course2 = courses.find(c => c.id === tr2?.course_id);
            const pars2 = course2?.hole_pars || [];
            const par3holes = pars2.map((p, i) => ({ hole: i, par: p })).filter(h => h.par === 3);
            if (par3holes.length === 0) return null;
            return (
              <div key={r} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: BC.gold, letterSpacing: 1, marginBottom: 8 }}>ROUND {r} — {course2?.name || "TBD"}</div>
                {par3holes.map(({ hole }) => {
                  const key = `${r}_${hole}`;
                  const winnerId = ctpData[key];
                  const winner = tPlayers.find(p => p.player_id === winnerId);
                  return (
                    <div key={hole} style={{ background: BC.card, borderRadius: 8, padding: "8px 12px", marginBottom: 4, border: `1px solid ${winner ? BC.amber + "44" : BC.bdr}`, display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: BC.t3, width: 44, flexShrink: 0 }}>Hole {hole + 1}</span>
                      {user?.isDirector ? (
                        <select value={winnerId || ""} onChange={e => onSetCtp(r, hole, e.target.value || null)}
                          style={{ flex: 1, background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 6, color: BC.t1, fontSize: 11, padding: "4px 6px", fontFamily: "'Montserrat', sans-serif" }}>
                          <option value="">-- Not set --</option>
                          {tPlayers.map(p => <option key={p.player_id} value={p.player_id}>{p.name}</option>)}
                        </select>
                      ) : (
                        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: winner ? BC.amber : BC.t3 }}>{winner ? winner.name : "Not set"}</span>
                      )}
                      {winner && <span style={{ fontSize: 10, color: BC.amber }}>📍</span>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Analytics View ──
function AnalyticsView({ tPlayers, matches, holeData, tRounds, courses, historicalData, user }) {
  const [analyticsTab, setAnalyticsTab] = useState("current");

  // Compute current year player stats from match results
  const playerStats = useMemo(() => {
    const stats = {};
    tPlayers.forEach(p => { stats[p.player_id] = { name: p.name, team: p.team, wins: 0, losses: 0, halves: 0, pts: 0, skinsWon: 0 }; });

    matches.forEach(m => {
      const fmt = tRounds.find(t => t.round_number === m.round)?.format || "singles";
      const res = computeMatchResult(m, holeData, courses, tRounds, tPlayers, fmt, {});
      const aTotal = res.totalPts.A, bTotal = res.totalPts.B;
      [...m.teamA].forEach(pid => {
        if (!stats[pid]) return;
        stats[pid].pts += aTotal;
        if (aTotal > bTotal) stats[pid].wins++;
        else if (bTotal > aTotal) stats[pid].losses++;
        else stats[pid].halves++;
      });
      [...m.teamB].forEach(pid => {
        if (!stats[pid]) return;
        stats[pid].pts += bTotal;
        if (bTotal > aTotal) stats[pid].wins++;
        else if (aTotal > bTotal) stats[pid].losses++;
        else stats[pid].halves++;
      });
    });
    return Object.values(stats).sort((a, b) => b.pts - a.pts);
  }, [tPlayers, matches, holeData, tRounds, courses]);

  return (
    <div style={{ fontFamily: "'Montserrat', sans-serif" }}>
      <div style={{ display: "flex", background: BC.card, borderRadius: 20, padding: 3, marginBottom: 14, border: `1px solid ${BC.bdr}` }}>
        {[["current","2026 Stats"],["history","History"]].map(([k,lbl]) => (
          <button key={k} onClick={() => setAnalyticsTab(k)} style={{
            flex: 1, padding: "8px 0", borderRadius: 16, fontSize: 12, fontWeight: 700, cursor: "pointer", border: "none",
            background: analyticsTab === k ? `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})` : "transparent",
            color: analyticsTab === k ? "#0a0804" : BC.t3,
          }}>{lbl}</button>
        ))}
      </div>

      {analyticsTab === "current" && (
        <div>
          <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 44px 44px 44px 52px", padding: "8px 12px", borderBottom: `1px solid ${BC.bdr}`, fontSize: 9, fontWeight: 700, color: BC.t3, letterSpacing: 1 }}>
              <div>PLAYER</div><div style={{textAlign:"center"}}>W</div><div style={{textAlign:"center"}}>L</div><div style={{textAlign:"center"}}>H</div><div style={{textAlign:"right"}}>PTS</div>
            </div>
            {playerStats.map((p, i) => {
              const team = getTeam(p.team);
              return (
                <div key={p.name} style={{ display: "grid", gridTemplateColumns: "1fr 44px 44px 44px 52px", padding: "9px 12px", borderBottom: i < playerStats.length-1 ? `1px solid ${BC.bdr}10` : "none", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: team?.accent || BC.t3, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: (p.team === "A" ? TEAM_A : TEAM_B).accent + "88" }}>{p.name}</span>
                  </div>
                  <div style={{ textAlign: "center", fontSize: 12, color: "#22c55e", fontWeight: 600 }}>{p.wins}</div>
                  <div style={{ textAlign: "center", fontSize: 12, color: BC.danger, fontWeight: 600 }}>{p.losses}</div>
                  <div style={{ textAlign: "center", fontSize: 12, color: BC.t3 }}>{p.halves}</div>
                  <div style={{ textAlign: "right", fontSize: 12, fontWeight: 700, color: BC.amber }}>{p.pts.toFixed(1)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {analyticsTab === "history" && (
        <div>
          {historicalData.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: BC.t3 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: BC.t2, marginBottom: 8 }}>No Historical Data Yet</div>
              <div style={{ fontSize: 12 }}>Past tournament results will appear here after each year's event is archived.</div>
            </div>
          ) : (
            historicalData.sort((a,b) => b.year - a.year).map(yr => (
              <div key={yr.id} style={{ background: BC.card, borderRadius: 12, padding: 14, marginBottom: 12, border: `1px solid ${BC.bdr}` }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: BC.gold, marginBottom: 8 }}>{yr.year} · {yr.location}</div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: BC.t1 }}><span style={{ color: TEAM_A.accent, fontWeight: 700 }}>{yr.teamAName}</span> {yr.teamAScore}</div>
                  <div style={{ fontSize: 12, color: BC.t1 }}><span style={{ color: TEAM_B.accent, fontWeight: 700 }}>{yr.teamBName}</span> {yr.teamBScore}</div>
                </div>
                {yr.winner && <div style={{ fontSize: 11, color: BC.amber, fontWeight: 700 }}>🏆 {yr.winner} won the Bourbon Cup</div>}
              </div>
            ))
          )}
          {user?.isDirector && (
            <div style={{ textAlign: "center", marginTop: 16 }}>
              <div style={{ fontSize: 10, color: BC.t3 }}>Historical data can be added by directors via Firestore directly for now.</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Slide-up Menu ──
// ─────────────────────────────────────────────────────────────────────────────
// PracticeView — Top-level component for test/practice events
// ─────────────────────────────────────────────────────────────────────────────
function PracticeView({ user, tPlayers, courses, notify }) {
  const [event, setEvent] = useState(null);
  const [scoresMap, setScoresMap] = useState({}); // {pid_h: score}
  const [ctps, setCtps] = useState({}); // {h: pid}
  const [subView, setSubView] = useState("setup"); // setup | scoring | leaderboard | betting
  const [showSetupConfirm, setShowSetupConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Subscribe to practice collections
  useEffect(() => {
    const f = [{ field: "tournament_id", op: "==", value: TOURNAMENT_ID }];
    const unsubs = [];
    unsubs.push(db.subscribe("bc_practice_event", f, rows => {
      setEvent(rows.find(r => r.id === "current") || null);
    }));
    unsubs.push(db.subscribe("bc_practice_scores", f, rows => {
      const sc = {};
      rows.forEach(r => { sc[`${r.player_id}_${r.hole_number - 1}`] = r.score; });
      setScoresMap(sc);
    }));
    unsubs.push(db.subscribe("bc_practice_ctp", f, rows => {
      const cp = {};
      rows.forEach(r => { cp[r.hole] = r.player_id; });
      setCtps(cp);
    }));
    return () => unsubs.forEach(u => u());
  }, []);

  const course = useMemo(() => courses.find(c => c.id === event?.course_id), [courses, event]);
  const eventPlayers = useMemo(() => {
    if (!event) return [];
    return (event.player_ids || []).map(pid => tPlayers.find(p => p.player_id === pid)).filter(Boolean);
  }, [event, tPlayers]);

  // Compute match results
  const matchResults = useMemo(() => {
    if (!event || !course || !event.matches) return [];
    return event.matches.map(m => ({
      match: m,
      result: computePracticeMatch({
        match: m,
        scores: scoresMap,
        course,
        players: tPlayers,
        hcpOverrides: event.hcp_overrides || {},
        hcpMode: event.hcp_mode || "low_man",
      }),
    }));
  }, [event, course, scoresMap, tPlayers]);

  const skins = useMemo(() => computePracticeSkins({
    scores: scoresMap,
    players: eventPlayers,
    course,
    hcpOverrides: event?.hcp_overrides || {},
  }), [scoresMap, eventPlayers, course, event]);

  // Save score
  const onSavePracticeScore = useCallback(async (pid, h, score) => {
    const id = `bc_ps_${pid}_h${h + 1}`;
    if (score == null || score === 0) {
      await db.delete("bc_practice_scores", id);
    } else {
      await db.upsert("bc_practice_scores", {
        id,
        tournament_id: TOURNAMENT_ID,
        player_id: pid,
        hole_number: h + 1,
        score,
      });
    }
    // Optimistic
    setScoresMap(prev => {
      const next = { ...prev };
      if (score == null || score === 0) delete next[`${pid}_${h}`];
      else next[`${pid}_${h}`] = score;
      return next;
    });
  }, []);

  // Save CTP
  const onSetCtp = useCallback(async (h, pid) => {
    const id = `bc_pctp_h${h + 1}`;
    if (pid) await db.upsert("bc_practice_ctp", { id, tournament_id: TOURNAMENT_ID, hole: h, player_id: pid });
    else await db.delete("bc_practice_ctp", id);
  }, []);

  // ── Setup Sub-view ──
  const SetupTab = () => {
    const [selPlayers, setSelPlayers] = useState(event?.player_ids || []);
    const [selCourse, setSelCourse] = useState(event?.course_id || (courses[0]?.id || ""));
    const [hcpMode, setHcpMode] = useState(event?.hcp_mode || "low_man");
    const [teamSlots, setTeamSlots] = useState(() => {
      if (event?.teams) {
        return event.teams.map(t => [t.player1, t.player2].filter(Boolean));
      }
      return [[], [], [], []];
    });
    const [activeSlot, setActiveSlot] = useState(0);

    const togglePlayer = (pid) => {
      if (selPlayers.includes(pid)) {
        setSelPlayers(selPlayers.filter(p => p !== pid));
        // Also remove from any team slot
        setTeamSlots(slots => slots.map(s => s.filter(p => p !== pid)));
      } else {
        if (selPlayers.length >= 8) { notify("Max 8 players", "warn"); return; }
        setSelPlayers([...selPlayers, pid]);
      }
    };

    const assignToSlot = (pid) => {
      // Remove from any other slot first
      const newSlots = teamSlots.map(s => s.filter(p => p !== pid));
      // Add to active slot if it has room
      if (newSlots[activeSlot].length >= 2) {
        notify("Team full — pick another team", "warn");
        return;
      }
      newSlots[activeSlot] = [...newSlots[activeSlot], pid];
      setTeamSlots(newSlots);
      // Auto-advance to next empty slot
      const nextEmpty = newSlots.findIndex((s, i) => i > activeSlot && s.length < 2);
      if (newSlots[activeSlot].length === 2 && nextEmpty !== -1) setActiveSlot(nextEmpty);
    };

    const findSlotOf = (pid) => teamSlots.findIndex(s => s.includes(pid));

    const allTeamsComplete = teamSlots.every(s => s.length === 2);
    const courseObj = courses.find(c => c.id === selCourse);

    const saveSetup = async () => {
      if (!allTeamsComplete) { notify("All 4 teams need 2 players", "warn"); return; }
      if (!selCourse) { notify("Pick a course", "warn"); return; }

      const teams = teamSlots.map((s, i) => ({
        id: `T${i + 1}`,
        name: `Team ${i + 1}`,
        player1: s[0],
        player2: s[1],
      }));
      const matches = [
        { id: "M1", team1: teams[0], team2: teams[1] },
        { id: "M2", team1: teams[2], team2: teams[3] },
      ];

      await db.upsert("bc_practice_event", {
        id: "current",
        tournament_id: TOURNAMENT_ID,
        course_id: selCourse,
        hcp_mode: hcpMode,
        hcp_overrides: event?.hcp_overrides || {},
        player_ids: selPlayers,
        teams,
        matches,
        created_at: event?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      notify("Practice event saved", "success");
      setSubView("scoring");
    };

    const resetEvent = async () => {
      // Wipe event + scores + ctp
      await db.delete("bc_practice_event", "current");
      // Clear all scores & ctp for this tournament
      const oldScores = await db.get("bc_practice_scores", [{ field: "tournament_id", op: "==", value: TOURNAMENT_ID }]);
      const oldCtps = await db.get("bc_practice_ctp", [{ field: "tournament_id", op: "==", value: TOURNAMENT_ID }]);
      for (const s of oldScores) await db.delete("bc_practice_scores", s.id);
      for (const c of oldCtps) await db.delete("bc_practice_ctp", c.id);
      setShowResetConfirm(false);
      setSelPlayers([]);
      setTeamSlots([[], [], [], []]);
      setActiveSlot(0);
      notify("Event reset", "success");
    };

    // Sort players: Mash Brothers first
    const sortedPlayers = [...tPlayers].sort((a, b) => {
      if (a.team !== b.team) return a.team === "A" ? -1 : 1;
      return (a.name || "").localeCompare(b.name || "");
    });

    return (
      <div>
        {/* Course + HCP Mode */}
        <div style={{ background: BC.card, borderRadius: 10, padding: 12, marginBottom: 12, border: `1px solid ${BC.bdr}` }}>
          <div style={{ fontSize: 10, color: BC.t3, marginBottom: 6, fontWeight: 700, letterSpacing: 1 }}>COURSE</div>
          <select value={selCourse} onChange={e => setSelCourse(e.target.value)} style={{
            width: "100%", padding: "8px 10px", background: BC.inp, border: `1px solid ${BC.bdr}`,
            borderRadius: 6, color: BC.t1, fontSize: 13, marginBottom: 10,
          }}>
            <option value="">— Select course —</option>
            {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <div style={{ fontSize: 10, color: BC.t3, marginBottom: 6, fontWeight: 700, letterSpacing: 1 }}>HANDICAP MODE</div>
          <div style={{ display: "flex", gap: 6 }}>
            {[["low_man", "Low Man"], ["full", "Full Strokes"]].map(([k, label]) => (
              <button key={k} onClick={() => setHcpMode(k)} style={{
                flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
                background: hcpMode === k ? BC.amber + "22" : BC.inp,
                border: `1px solid ${hcpMode === k ? BC.amber : BC.bdr}`,
                color: hcpMode === k ? BC.amber : BC.t2,
              }}>{label}</button>
            ))}
          </div>
        </div>

        {/* Player picker */}
        <div style={{ background: BC.card, borderRadius: 10, padding: 12, marginBottom: 12, border: `1px solid ${BC.bdr}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: BC.t3, fontWeight: 700, letterSpacing: 1 }}>SELECT 8 PLAYERS</div>
            <div style={{ fontSize: 11, color: selPlayers.length === 8 ? BC.green : BC.amber, fontWeight: 700 }}>{selPlayers.length}/8</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {sortedPlayers.map(p => {
              const isSel = selPlayers.includes(p.player_id);
              const teamColor = p.team === "A" ? TEAM_A.accent : TEAM_B.accent;
              const slotIdx = findSlotOf(p.player_id);
              return (
                <button key={p.player_id} onClick={() => togglePlayer(p.player_id)} style={{
                  padding: "8px 10px", borderRadius: 8,
                  background: isSel ? teamColor + "22" : BC.inp,
                  border: `1px solid ${isSel ? teamColor : BC.bdr}`,
                  color: isSel ? BC.t1 : BC.t2,
                  fontSize: 12, fontWeight: 600, cursor: "pointer", textAlign: "left",
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: teamColor, flexShrink: 0 }} />
                  <span style={{
                    fontSize: 9, fontWeight: 800, color: isSel ? BC.t1 : BC.t3, letterSpacing: 0.5,
                    background: isSel ? teamColor + "44" : BC.bdr + "60",
                    padding: "2px 5px", borderRadius: 4, flexShrink: 0,
                  }}>{getInitials(p.name)}</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                  {slotIdx !== -1 && (
                    <span style={{ fontSize: 9, fontWeight: 800, color: PRACTICE_TEAM_COLORS[slotIdx].accent, flexShrink: 0 }}>
                      T{slotIdx + 1}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Team builder */}
        {selPlayers.length === 8 && (
          <div style={{ background: BC.card, borderRadius: 10, padding: 12, marginBottom: 12, border: `1px solid ${BC.bdr}` }}>
            <div style={{ fontSize: 10, color: BC.t3, marginBottom: 10, fontWeight: 700, letterSpacing: 1 }}>BUILD 4 TEAMS OF 2</div>
            <div style={{ fontSize: 11, color: BC.t2, marginBottom: 10 }}>
              Tap a team slot to make it active, then tap players above to add them.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
              {teamSlots.map((slot, i) => {
                const isActive = i === activeSlot;
                const tc = PRACTICE_TEAM_COLORS[i];
                const filled = slot.length === 2;
                return (
                  <button key={i} onClick={() => setActiveSlot(i)} style={{
                    padding: "10px 12px", borderRadius: 10,
                    background: isActive ? tc.color + "55" : (filled ? tc.color + "20" : BC.inp),
                    border: `2px solid ${isActive ? tc.accent : (filled ? tc.accent + "55" : BC.bdr)}`,
                    color: BC.t1, fontSize: 11, fontWeight: 700, cursor: "pointer", textAlign: "left",
                    minHeight: 70,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ color: tc.accent, letterSpacing: 1 }}>TEAM {i + 1}</span>
                      <span style={{ fontSize: 9, color: BC.t3 }}>{slot.length}/2</span>
                    </div>
                    {slot.length === 0 && <div style={{ fontSize: 10, color: BC.t3, fontStyle: "italic" }}>(empty)</div>}
                    {slot.map(pid => {
                      const p = tPlayers.find(t => t.player_id === pid);
                      return (
                        <div key={pid} onClick={(e) => { e.stopPropagation(); setTeamSlots(s => s.map((sl, ix) => ix === i ? sl.filter(x => x !== pid) : sl)); }}
                          style={{ fontSize: 11, fontWeight: 600, color: BC.t1, marginBottom: 2, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
                          <span style={{
                            fontSize: 9, fontWeight: 800, color: tc.accent, letterSpacing: 0.5,
                            background: tc.color + "55", padding: "2px 4px", borderRadius: 3, flexShrink: 0,
                          }}>{getInitials(p?.name)}</span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p?.name || pid}</span>
                        </div>
                      );
                    })}
                  </button>
                );
              })}
            </div>
            {/* Player chips for assigning */}
            <div style={{ borderTop: `1px solid ${BC.bdr}`, paddingTop: 10 }}>
              <div style={{ fontSize: 9, color: BC.t3, fontWeight: 700, marginBottom: 6, letterSpacing: 1 }}>
                TAP TO ASSIGN TO TEAM {activeSlot + 1}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {selPlayers.map(pid => {
                  const p = tPlayers.find(t => t.player_id === pid);
                  const slotIdx = findSlotOf(pid);
                  const inActive = slotIdx === activeSlot;
                  const inOther = slotIdx !== -1 && slotIdx !== activeSlot;
                  const tc = slotIdx !== -1 ? PRACTICE_TEAM_COLORS[slotIdx] : null;
                  return (
                    <button key={pid} onClick={() => assignToSlot(pid)} style={{
                      padding: "6px 10px", borderRadius: 14,
                      background: inActive ? tc.accent + "33" : inOther ? BC.inp : BC.hover,
                      border: `1px solid ${inActive ? tc.accent : inOther ? tc.accent + "44" : BC.bdr}`,
                      color: inOther ? BC.t3 : BC.t1, fontSize: 11, fontWeight: 700, cursor: "pointer",
                      opacity: inOther && !inActive ? 0.55 : 1, letterSpacing: 0.5,
                    }}>
                      {getInitials(p?.name)}
                      {slotIdx !== -1 && <span style={{ marginLeft: 4, fontSize: 9, color: tc.accent, fontWeight: 800 }}>T{slotIdx + 1}</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Match preview */}
            {allTeamsComplete && (
              <div style={{ marginTop: 12, padding: 10, background: BC.amber + "10", borderRadius: 8, border: `1px solid ${BC.amber}33` }}>
                <div style={{ fontSize: 9, color: BC.amber, fontWeight: 800, letterSpacing: 1, marginBottom: 6 }}>MATCHUPS</div>
                {[[0, 1], [2, 3]].map(([a, b], mi) => (
                  <div key={mi} style={{ fontSize: 11, color: BC.t1, marginBottom: 4, display: "flex", gap: 4 }}>
                    <span style={{ color: BC.t3, marginRight: 4 }}>Match {mi + 1}:</span>
                    <span style={{ color: PRACTICE_TEAM_COLORS[a].accent, fontWeight: 700 }}>T{a + 1}</span>
                    <span style={{ color: BC.t3 }}>vs</span>
                    <span style={{ color: PRACTICE_TEAM_COLORS[b].accent, fontWeight: 700 }}>T{b + 1}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Save */}
        <button onClick={saveSetup} disabled={!allTeamsComplete || !selCourse} style={{
          width: "100%", padding: "12px 0", borderRadius: 10,
          background: allTeamsComplete && selCourse ? `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})` : BC.inp,
          border: `1px solid ${allTeamsComplete && selCourse ? BC.amber : BC.bdr}`,
          color: allTeamsComplete && selCourse ? "#0a0804" : BC.t3,
          fontSize: 13, fontWeight: 800, cursor: allTeamsComplete && selCourse ? "pointer" : "not-allowed",
          letterSpacing: 1, marginBottom: 10,
        }}>
          {event ? "UPDATE EVENT" : "SAVE EVENT"}
        </button>

        {/* Reset */}
        {event && (
          <button onClick={() => setShowResetConfirm(true)} style={{
            width: "100%", padding: "8px 0", borderRadius: 8, background: "transparent",
            border: `1px solid ${BC.danger}55`, color: BC.danger, fontSize: 11, fontWeight: 700, cursor: "pointer",
          }}>
            Reset Event (clear scores)
          </button>
        )}

        {showResetConfirm && (
          <>
            <div onClick={() => setShowResetConfirm(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200 }} />
            <div style={{
              position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
              background: BC.card, borderRadius: 12, padding: 20, border: `1px solid ${BC.danger}`,
              maxWidth: 320, width: "90%", zIndex: 201,
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: BC.t1, marginBottom: 8 }}>Reset Practice Event?</div>
              <div style={{ fontSize: 12, color: BC.t2, marginBottom: 16, lineHeight: 1.5 }}>
                This will delete the event, all scores, and all CTP entries. This can't be undone.
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setShowResetConfirm(false)} style={{ flex: 1, padding: "10px 0", background: BC.inp, border: `1px solid ${BC.bdr}`, color: BC.t2, borderRadius: 8, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
                <button onClick={resetEvent} style={{ flex: 1, padding: "10px 0", background: BC.danger, border: "none", color: "#fff", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>Reset</button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  // ── Scoring Sub-view ──
  const ScoringTab = () => {
    // Hooks first — must fire unconditionally on every render. Even when
    // event/course aren't loaded yet, we still call them so React's hook
    // counter stays consistent across renders.
    const [activeHole, setActiveHole] = useState(0);
    const [showScorecard, setShowScorecard] = useState(false);

    const holePars = course?.hole_pars || Array(18).fill(4);
    const holeHcps = course?.hole_handicaps || Array(18).fill(9);

    // Lock scoring to the user's own match. Switching to a different match is
    // intentionally not allowed — only players in a match should be entering its
    // scores. If the user isn't on any team in this event (e.g. a director who
    // didn't include themselves), we render an empty state below.
    const activeMatch = event?.matches?.find(m =>
      [m.team1.player1, m.team1.player2, m.team2.player1, m.team2.player2].includes(user?.player_id)
    );
    const matchPids = activeMatch ? [
      activeMatch.team1.player1, activeMatch.team1.player2,
      activeMatch.team2.player1, activeMatch.team2.player2,
    ].filter(Boolean) : [];

    const par = holePars[activeHole];
    const hcp = holeHcps[activeHole];
    const matchResult = activeMatch ? matchResults.find(mr => mr.match.id === activeMatch.id)?.result : null;

    // Stroke maps for the 4 players in this match. Mirrors the calculation used
    // in computePracticeMatch so the dots shown beside each player exactly match
    // the strokes used to compute the leaderboard. Memoized — useMemo always
    // fires (even when there's no match) so hook ordering stays stable.
    const strokeMaps = useMemo(() => {
      const maps = {};
      if (!event || !course || !activeMatch) return maps;
      const allPids = matchPids;
      const getHI = (pid) => {
        if (event.hcp_overrides?.[pid] !== undefined && event.hcp_overrides[pid] !== "") return parseFloat(event.hcp_overrides[pid]) || 0;
        const tp = tPlayers.find(p => p.player_id === pid);
        return parseFloat(tp?.handicap_index) || 0;
      };
      const getCH = (pid) => calcCH(getHI(pid), course.slope || 113, course.rating || 72, course.par || 72);
      const allCHs = allPids.map(getCH);
      const minCH = allCHs.length ? Math.min(...allCHs) : 0;
      const adjCH = (pid) => event.hcp_mode === "full" ? getCH(pid) : (getCH(pid) - minCH);
      const buildMap = (ch) => {
        const sorted = holeHcps.map((h, i) => ({ idx: i, hcp: h })).sort((a, b) => a.hcp - b.hcp);
        const map = {};
        let rem = Math.abs(ch);
        for (let pass = 0; pass < 3 && rem > 0; pass++) {
          for (const h of sorted) { if (rem <= 0) break; map[h.idx] = (map[h.idx] || 0) + 1; rem--; }
        }
        return map;
      };
      allPids.forEach(pid => { maps[pid] = buildMap(adjCH(pid)); });
      return maps;
    }, [activeMatch, event, course, holeHcps]);

    // ── No more hooks below this line — early returns are safe ─────────────
    if (!event || !course) {
      return <div style={{ textAlign: "center", padding: 40, color: BC.t3 }}>Set up an event first.</div>;
    }
    if (!activeMatch) {
      return (
        <div style={{ textAlign: "center", padding: 40, color: BC.t3, fontSize: 13 }}>
          You're not in a match for this Mash round.
        </div>
      );
    }

    const getStrokes = (pid, h) => strokeMaps[pid]?.[h] || 0;

    // Per-player running net "thru X" — sum of net scores up through and
    // including the active hole. Used in the "Net: +1 thru 4" right-hand
    // display on each card. Doesn't depend on opponent so it lives outside
    // computePracticeMatch (which is a team-level calculation).
    const getRunning = (pid) => {
      let net = 0, gross = 0, thru = 0, parThru = 0;
      for (let h = 0; h <= activeHole; h++) {
        const raw = scoresMap[`${pid}_${h}`];
        if (!raw) continue;
        gross += raw;
        net += raw - getStrokes(pid, h);
        parThru += holePars[h];
        thru++;
      }
      return { net, gross, thru, netVsPar: net - parThru };
    };

    // Score buttons: par-3 holes start at 1, par-4/5 start at 2. The displayed
    // range shifts up or down if the saved score falls outside [min, max] so
    // the active button is always visible without forcing the +/- adjusters.
    const baseBtns = par === 3 ? [1, 2, 3, 4, 5, 6, 7] : [2, 3, 4, 5, 6, 7, 8];

    // ── MNQ-style match status bar ─────────────────────────────────────────
    // Cumulative match status per hole (1..18) from the USER'S team's
    // perspective. Positive = your team is up by N going into that hole;
    // negative = down by N; 0 = AS; null = at least one earlier hole still
    // missing scores. The cumulative loop breaks on the first incomplete
    // hole, so a gap freezes the strip at that point — fix the missing
    // hole and the rest fills in.
    const userOnT1 = activeMatch
      ? (activeMatch.team1.player1 === user?.player_id || activeMatch.team1.player2 === user?.player_id)
      : true;
    const t1Pids = activeMatch ? [activeMatch.team1.player1, activeMatch.team1.player2].filter(Boolean) : [];
    const t2Pids = activeMatch ? [activeMatch.team2.player1, activeMatch.team2.player2].filter(Boolean) : [];
    const holeStatuses = Array.from({ length: 18 }, (_, i) => {
      let cum = 0, hasData = false;
      for (let h = 0; h <= i; h++) {
        let n1 = 0, n2 = 0, ok1 = true, ok2 = true;
        t1Pids.forEach(pid => { const s = scoresMap[`${pid}_${h}`]; if (!s) ok1 = false; else n1 += s - getStrokes(pid, h); });
        t2Pids.forEach(pid => { const s = scoresMap[`${pid}_${h}`]; if (!s) ok2 = false; else n2 += s - getStrokes(pid, h); });
        if (ok1 && ok2) {
          if (n1 < n2) cum += userOnT1 ? 1 : -1;
          else if (n2 < n1) cum += userOnT1 ? -1 : 1;
          hasData = true;
        } else { hasData = false; break; }
      }
      return hasData ? cum : null;
    });
    // Clinch hole — first hole where the lead exceeds the remaining holes.
    // 18-hole rule: must be < hole 18 (you can't clinch on the final hole;
    // a 1-up finish through 18 is "1UP", not "1&0").
    let clinchHole = null, clinchText = null;
    for (let h = 0; h < 18; h++) {
      if (holeStatuses[h] === null) break;
      const lead = Math.abs(holeStatuses[h]);
      const remaining = 17 - h;
      if (remaining > 0 && lead > remaining) {
        clinchHole = h;
        clinchText = `${lead}&${remaining}`;
        break;
      }
    }

    // Render a single status cell. Cells at positions 9 and 18 don't draw a
    // right border (end of row); all others do, for the divider rhythm.
    const renderStatusCell = (i) => {
      const st = holeStatuses[i];
      const isEndOfRow = (i + 1) % 9 === 0;
      const colBorder = !isEndOfRow ? { borderRight: `1px solid ${BC.bdr}40` } : {};
      const cellH = 22;
      // Clinch hole — show "X&Y" prominently in green (you won) or red (you lost)
      if (clinchHole !== null && i === clinchHole) {
        const color = st > 0 ? "#22c55e" : st < 0 ? BC.danger : BC.t3;
        return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 11, color, fontWeight: 800, lineHeight: `${cellH}px`, ...colBorder }}>{clinchText}</div>;
      }
      // Post-clinch holes don't render a status (match is mathematically over)
      if (clinchHole !== null && i > clinchHole) {
        return <div key={i} style={{ flex: 1, height: cellH, ...colBorder }} />;
      }
      // Unscored hole — empty cell
      if (st === null) {
        return <div key={i} style={{ flex: 1, height: cellH, ...colBorder }} />;
      }
      // All-square — small "TIED" label
      if (st === 0) {
        return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 8, fontWeight: 700, color: BC.t3, lineHeight: `${cellH}px`, letterSpacing: 0.5, ...colBorder }}>TIED</div>;
      }
      // Up or down — show the lead with arrow
      const color = st > 0 ? "#22c55e" : BC.danger;
      return (
        <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 11, fontWeight: 800, color, lineHeight: `${cellH}px`, ...colBorder }}>
          {st > 0 ? "▲" : "▼"}{Math.abs(st)}
        </div>
      );
    };

    return (
      <div>
        {/* Front 9 — hole strip */}
        <div style={{ display: "flex", gap: 3, marginBottom: 2 }}>
          {Array.from({ length: 9 }, (_, i) => {
            const cur = i === activeHole;
            const allScored = matchPids.every(pid => scoresMap[`${pid}_${i}`]);
            const partial = !allScored && matchPids.some(pid => scoresMap[`${pid}_${i}`]);
            return (
              <button key={i} onClick={() => setActiveHole(i)} style={{
                flex: 1, height: 28, borderRadius: cur ? 8 : 6,
                border: allScored && !cur ? `1.5px solid ${BC.amber}50` : "none",
                background: cur ? BC.amber : allScored ? BC.amber + "15" : partial ? BC.amber + "08" : BC.card,
                color: cur ? "#0a0804" : allScored ? BC.amber : BC.t3,
                fontSize: 13, fontWeight: 800, cursor: "pointer",
                outline: cur ? `2px solid ${BC.amber}` : "none", outlineOffset: 1,
              }}>{i + 1}</button>
            );
          })}
        </div>
        {/* Front 9 — match status row */}
        <div style={{ display: "flex", marginBottom: 6, background: BC.card, border: `1px solid ${BC.bdr}60`, borderRadius: 8, padding: "3px 0", alignItems: "center" }}>
          {Array.from({ length: 9 }, (_, i) => renderStatusCell(i))}
        </div>
        {/* Back 9 — hole strip */}
        <div style={{ display: "flex", gap: 3, marginBottom: 2 }}>
          {Array.from({ length: 9 }, (_, i) => {
            const h = i + 9;
            const cur = h === activeHole;
            const allScored = matchPids.every(pid => scoresMap[`${pid}_${h}`]);
            const partial = !allScored && matchPids.some(pid => scoresMap[`${pid}_${h}`]);
            return (
              <button key={h} onClick={() => setActiveHole(h)} style={{
                flex: 1, height: 28, borderRadius: cur ? 8 : 6,
                border: allScored && !cur ? `1.5px solid ${BC.amber}50` : "none",
                background: cur ? BC.amber : allScored ? BC.amber + "15" : partial ? BC.amber + "08" : BC.card,
                color: cur ? "#0a0804" : allScored ? BC.amber : BC.t3,
                fontSize: 13, fontWeight: 800, cursor: "pointer",
                outline: cur ? `2px solid ${BC.amber}` : "none", outlineOffset: 1,
              }}>{h + 1}</button>
            );
          })}
        </div>
        {/* Back 9 — match status row */}
        <div style={{ display: "flex", marginBottom: 6, background: BC.card, border: `1px solid ${BC.bdr}60`, borderRadius: 8, padding: "3px 0", alignItems: "center" }}>
          {Array.from({ length: 9 }, (_, i) => renderStatusCell(i + 9))}
        </div>

        {/* Hole nav banner — amber filled bar showing Par / Hole / HCP, with prev/next.
            Mirrors the MNQ scoring banner exactly. */}
        <div style={{
          background: BC.amber, borderRadius: 10, padding: "4px 8px", marginBottom: 6,
          display: "flex", alignItems: "center",
        }}>
          <button onClick={() => setActiveHole(h => Math.max(0, h - 1))} disabled={activeHole === 0} style={{
            width: 28, height: 36, borderRadius: 8, background: "none", border: "none",
            cursor: activeHole === 0 ? "default" : "pointer",
            color: activeHole === 0 ? "#0a080440" : "#0a0804", fontSize: 18, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>‹</button>
          <div style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 8px" }}>
            <div style={{ textAlign: "center", minWidth: 32 }}>
              <div style={{ fontSize: 8, color: "#0a0804", fontWeight: 600, opacity: 0.7 }}>Par</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0a0804" }}>{par}</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 8, color: "#0a0804", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, opacity: 0.7 }}>Hole</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: "#0a0804", lineHeight: 1 }}>{activeHole + 1}</div>
            </div>
            <div style={{ textAlign: "center", minWidth: 32 }}>
              <div style={{ fontSize: 8, color: "#0a0804", fontWeight: 600, opacity: 0.7 }}>HCP</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0a0804" }}>{hcp}</div>
            </div>
          </div>
          <button onClick={() => setActiveHole(h => Math.min(17, h + 1))} disabled={activeHole === 17} style={{
            width: 28, height: 36, borderRadius: 8, background: "none", border: "none",
            cursor: activeHole === 17 ? "default" : "pointer",
            color: activeHole === 17 ? "#0a080440" : "#0a0804", fontSize: 18, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>›</button>
        </div>

        {/* Player score cards — 4 in match, T1 (rows 0-1) on top, T2 (rows 2-3) below a divider.
            Each card shows: initials badge, name, (CH), stroke dots, "Net: ±X thru N",
            then a row of par-relative score buttons + manual −/+ adjusters at the end. */}
        {matchPids.map((pid, idx) => {
          const p = tPlayers.find(t => t.player_id === pid);
          if (!p) return null;
          const slotIdx = event.teams.findIndex(t => t.player1 === pid || t.player2 === pid);
          const tc = PRACTICE_TEAM_COLORS[slotIdx];
          const score = scoresMap[`${pid}_${activeHole}`] || 0;
          const strokes = getStrokes(pid, activeHole);
          const hi = (() => {
            if (event.hcp_overrides?.[pid] !== undefined && event.hcp_overrides[pid] !== "") return parseFloat(event.hcp_overrides[pid]) || 0;
            return parseFloat(p.handicap_index) || 0;
          })();
          const ch = calcCH(hi, course.slope || 113, course.rating || 72, course.par || 72);
          const run = getRunning(pid);

          // Shift the button range when the saved score falls outside [min, max].
          // E.g. saved a 9 on a par-4 (max button = 8) → shift right so [3..9] shows.
          const maxBtn = baseBtns[baseBtns.length - 1];
          const minBtn = baseBtns[0];
          let btns = baseBtns;
          if (score > maxBtn) {
            const shift = score - maxBtn;
            btns = baseBtns.map(b => b + shift);
          } else if (score > 0 && score < minBtn) {
            const shift = minBtn - score;
            btns = baseBtns.map(b => b - shift);
          }

          return (
            <div key={pid}>
              {idx === 2 && <div style={{ borderTop: `1px dashed ${BC.bdr}`, margin: "6px 0" }} />}
              <div style={{
                background: BC.card, borderRadius: 10, marginBottom: 4, padding: "6px 10px",
                border: `1px solid ${BC.bdr}`, borderLeft: `3px solid ${tc.accent}`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5, minWidth: 0 }}>
                  <span style={{
                    fontSize: 9, fontWeight: 800, color: tc.accent, letterSpacing: 0.5,
                    background: tc.color + "55", padding: "2px 4px", borderRadius: 3, flexShrink: 0,
                  }}>{getInitials(p.name)}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: BC.t1, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flexShrink: 1 }}>{p.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: BC.t3, flexShrink: 0 }}>({ch})</span>
                  {strokes > 0 && (
                    <span style={{ color: "#4ba3d4", fontSize: 12, letterSpacing: 1, flexShrink: 0, lineHeight: 1 }}>
                      {"●".repeat(strokes)}
                    </span>
                  )}
                  <div style={{ flex: 1 }} />
                  {run.thru > 0 && (
                    <span style={{ fontSize: 10, color: BC.t3, flexShrink: 0, whiteSpace: "nowrap" }}>
                      Net: <strong style={{ color: run.netVsPar < 0 ? "#22c55e" : run.netVsPar === 0 ? BC.t3 : BC.t1 }}>
                        {fmtScore(run.netVsPar)}
                      </strong> thru {run.thru}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 3 }}>
                  {btns.map(btn => {
                    const isCur = btn === score;
                    const sd = btn - par;
                    const boxSize = 32;
                    return (
                      <button key={btn} onClick={() => onSavePracticeScore(pid, activeHole, isCur ? null : btn)} style={{
                        flex: 1, height: 38, borderRadius: 8, cursor: "pointer", fontSize: 15, fontWeight: 800, border: "none",
                        background: isCur ? BC.amber : BC.inp, color: isCur ? "#0a0804" : BC.t2,
                        position: "relative", transition: "all .15s",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {/* Score-vs-par overlay shape: bogey = square outline, double = nested square,
                            birdie = circle outline, eagle = nested circle. Matches MNQ visualization. */}
                        {isCur && sd !== 0 && (
                          <div style={{ position: "absolute", width: boxSize, height: boxSize, left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}>
                            <div style={{
                              position: "absolute", inset: 0,
                              borderRadius: sd < 0 ? "50%" : 3,
                              border: `1.5px solid ${sd < 0 ? BC.danger : "#0a0804"}`,
                            }} />
                            {Math.abs(sd) >= 2 && (
                              <div style={{
                                position: "absolute", inset: 3,
                                borderRadius: sd < 0 ? "50%" : 2,
                                border: `1px solid ${sd < 0 ? BC.danger : "#0a0804"}`,
                              }} />
                            )}
                          </div>
                        )}
                        <span style={{ position: "relative", zIndex: 1 }}>{btn}</span>
                      </button>
                    );
                  })}
                  <button onClick={() => onSavePracticeScore(pid, activeHole, Math.max(1, (score || par) - 1))} style={{
                    width: 26, height: 38, borderRadius: 8, background: BC.inp, border: "none",
                    color: BC.t3, fontSize: 13, fontWeight: 700, cursor: "pointer", flexShrink: 0,
                  }}>−</button>
                  <button onClick={() => onSavePracticeScore(pid, activeHole, (score || par) + 1)} style={{
                    width: 26, height: 38, borderRadius: 8, background: BC.inp, border: "none",
                    color: BC.t3, fontSize: 13, fontWeight: 700, cursor: "pointer", flexShrink: 0,
                  }}>+</button>
                </div>
              </div>
            </div>
          );
        })}

        {/* Full Scorecard button — opens a modal showing the full hole-by-hole
            grid for both teams plus the running match status row. Mirrors MNQ's
            "Full Scorecard" button but stacks front 9 + back 9 vertically since
            18 columns is too cramped on mobile. */}
        <button onClick={() => setShowScorecard(true)} style={{
          width: "100%", padding: "9px 0", borderRadius: 8, marginTop: 6, cursor: "pointer",
          background: BC.card, border: `1px solid ${BC.bdr}60`,
          color: BC.t2, fontSize: 12, fontWeight: 700, letterSpacing: 0.5,
        }}>
          Full Scorecard
        </button>

        {showScorecard && (() => {
          // Extract the rendering pieces we need for either nine. Each section
          // shares the same header / par / hcp / player / team-net / match-row
          // structure — only the hole-index offset differs. We render the
          // section twice in the modal body.
          const t1Pids2 = [activeMatch.team1.player1, activeMatch.team1.player2].filter(Boolean);
          const t2Pids2 = [activeMatch.team2.player1, activeMatch.team2.player2].filter(Boolean);
          const t1Idx = event.teams.findIndex(t => t.id === activeMatch.team1.id);
          const t2Idx = event.teams.findIndex(t => t.id === activeMatch.team2.id);
          const tcA = PRACTICE_TEAM_COLORS[t1Idx];
          const tcB = PRACTICE_TEAM_COLORS[t2Idx];
          const matchIdx = event.matches.findIndex(m => m.id === activeMatch.id);
          const gridLine = `1px solid ${BC.bdr}25`;

          // Per-hole running cumulative status from T1's perspective (positive
          // = T1 leading). Independent from the user-perspective `holeStatuses`
          // computed above for the on-screen status bar — the scorecard always
          // shows from T1's perspective so the layout is symmetric (T1 above,
          // match row, T2 below).
          const t1Statuses = Array.from({ length: 18 }, (_, i) => {
            let cum = 0, hasData = false;
            for (let h = 0; h <= i; h++) {
              let n1 = 0, n2 = 0, ok1 = true, ok2 = true;
              t1Pids2.forEach(pid => { const s = scoresMap[`${pid}_${h}`]; if (!s) ok1 = false; else n1 += s - getStrokes(pid, h); });
              t2Pids2.forEach(pid => { const s = scoresMap[`${pid}_${h}`]; if (!s) ok2 = false; else n2 += s - getStrokes(pid, h); });
              if (ok1 && ok2) {
                if (n1 < n2) cum += 1;
                else if (n2 < n1) cum -= 1;
                hasData = true;
              } else { hasData = false; break; }
            }
            return hasData ? cum : null;
          });
          let t1ClinchHole = null, t1ClinchText = null;
          for (let h = 0; h < 18; h++) {
            if (t1Statuses[h] === null) break;
            const lead = Math.abs(t1Statuses[h]);
            const remaining = 17 - h;
            if (remaining > 0 && lead > remaining) {
              t1ClinchHole = h;
              t1ClinchText = `${lead}&${remaining}`;
              break;
            }
          }

          // Per-hole result for highlighting the team-net cell on holes won
          const t1WonHole = (h) => {
            const s = t1Statuses[h] === null ? null : (h === 0 ? t1Statuses[0] : t1Statuses[h] - t1Statuses[h - 1]);
            return s === 1;
          };
          const t2WonHole = (h) => {
            const s = t1Statuses[h] === null ? null : (h === 0 ? t1Statuses[0] : t1Statuses[h] - t1Statuses[h - 1]);
            return s === -1;
          };

          // Render a single 9-hole section. `offset` is 0 (front) or 9 (back).
          const renderSection = (offset) => {
            const sectionPars = holePars.slice(offset, offset + 9);
            const sectionHcps = holeHcps.slice(offset, offset + 9);
            const sectionParTotal = sectionPars.reduce((a, b) => a + b, 0);
            const labelW = 46;
            const totW = 32;
            const lblBase = { width: labelW, flexShrink: 0, fontSize: 9, fontWeight: 700, color: BC.t3, display: "flex", alignItems: "center", paddingLeft: 4, borderRight: gridLine, textTransform: "uppercase", letterSpacing: 0.3 };
            const totBase = { width: totW, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", borderLeft: gridLine };

            const renderPlayerRow = (pid) => {
              const p = tPlayers.find(t => t.player_id === pid);
              const slotIdx = event.teams.findIndex(t => t.player1 === pid || t.player2 === pid);
              const tc = PRACTICE_TEAM_COLORS[slotIdx];
              let grossTot = 0;
              return (
                <div key={pid} style={{ display: "flex", alignItems: "center", borderBottom: gridLine }}>
                  <div style={{ ...lblBase, height: 38, gap: 4, paddingTop: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: tc?.accent || BC.t1 }}>{getInitials(p?.name)}</span>
                  </div>
                  {Array.from({ length: 9 }, (_, i) => {
                    const h = i + offset;
                    const s = scoresMap[`${pid}_${h}`] || 0;
                    const st = strokeMaps[pid]?.[h] || 0;
                    if (s > 0) grossTot += s;
                    return (
                      <div key={i} style={{ flex: 1, height: 38, display: "flex", alignItems: "center", justifyContent: "center", borderRight: i < 8 ? gridLine : "none" }}>
                        <ScoreCell score={s} par={holePars[h]} strokes={st} size={13} />
                      </div>
                    );
                  })}
                  <div style={{ ...totBase, height: 38 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: BC.t1 }}>{grossTot || ""}</span>
                  </div>
                </div>
              );
            };

            const renderTeamNetRow = (pids, isT1Side) => {
              let netTot = 0;
              const tc = isT1Side ? tcA : tcB;
              return (
                <div style={{ display: "flex", alignItems: "center", borderBottom: gridLine, background: tc.color + "15" }}>
                  <div style={{ ...lblBase, height: 32, fontSize: 9, fontWeight: 800, color: tc.accent }}>NET</div>
                  {Array.from({ length: 9 }, (_, i) => {
                    const h = i + offset;
                    let tNet = 0, ok = true;
                    pids.forEach(pid => {
                      const s = scoresMap[`${pid}_${h}`];
                      if (!s) ok = false;
                      else tNet += s - (strokeMaps[pid]?.[h] || 0);
                    });
                    if (ok) netTot += tNet;
                    const won = isT1Side ? t1WonHole(h) : t2WonHole(h);
                    return (
                      <div key={i} style={{ flex: 1, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRight: i < 8 ? gridLine : "none" }}>
                        {won ? (
                          <div style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4, border: `1.5px solid ${tc.accent}`, background: tc.accent + "20" }}>
                            <span style={{ fontSize: 13, fontWeight: 800, color: BC.t1 }}>{ok ? tNet : "·"}</span>
                          </div>
                        ) : (
                          <span style={{ fontSize: 13, fontWeight: 800, color: ok ? BC.t1 : BC.t3 + "40" }}>{ok ? tNet : "·"}</span>
                        )}
                      </div>
                    );
                  })}
                  <div style={{ ...totBase, height: 32 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: BC.t1 }}>{netTot || ""}</span>
                  </div>
                </div>
              );
            };

            // Match status row (T1 perspective for this view — symmetric layout)
            const renderMatchRow = () => (
              <div style={{ display: "flex", alignItems: "center", background: BC.amber + "12", borderBottom: gridLine }}>
                <div style={{ ...lblBase, height: 28, color: BC.amber, fontWeight: 800, fontSize: 9 }}>MATCH</div>
                {Array.from({ length: 9 }, (_, i) => {
                  const h = i + offset;
                  const st = t1Statuses[h];
                  const colBdr = i < 8 ? { borderRight: gridLine } : {};
                  if (t1ClinchHole !== null && h === t1ClinchHole) {
                    const color = st > 0 ? "#22c55e" : st < 0 ? BC.danger : BC.t3;
                    return (
                      <div key={i} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", height: 28, ...colBdr }}>
                        <div style={{ border: `1.5px solid ${color}`, borderRadius: 4, padding: "0 4px", lineHeight: "20px" }}>
                          <span style={{ fontSize: 12, fontWeight: 800, color, whiteSpace: "nowrap" }}>{t1ClinchText}</span>
                        </div>
                      </div>
                    );
                  }
                  if (t1ClinchHole !== null && h > t1ClinchHole) {
                    return <div key={i} style={{ flex: 1, height: 28, ...colBdr }} />;
                  }
                  if (st === null) {
                    return <div key={i} style={{ flex: 1, height: 28, ...colBdr }} />;
                  }
                  const color = st > 0 ? "#22c55e" : st < 0 ? BC.danger : BC.t3;
                  return (
                    <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 12, fontWeight: 800, color, lineHeight: "28px", ...colBdr }}>
                      {st > 0 ? <><span style={{ fontSize: 12 }}>▲</span>{st}</> : st < 0 ? <><span style={{ fontSize: 12 }}>▼</span>{Math.abs(st)}</> : <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.5 }}>TIED</span>}
                    </div>
                  );
                })}
                <div style={{ ...totBase, height: 28, borderLeft: gridLine }} />
              </div>
            );

            return (
              <div style={{ marginBottom: 10, border: `1px solid ${BC.bdr}`, borderRadius: 10, overflow: "hidden" }}>
                {/* HOLE row — amber filled header */}
                <div style={{ display: "flex", background: BC.amber }}>
                  <div style={{ ...lblBase, height: 26, color: "#0a0804", opacity: 0.85, borderRight: "none", fontWeight: 800, fontSize: 10 }}>
                    {offset === 0 ? "FRONT" : "BACK"}
                  </div>
                  {Array.from({ length: 9 }, (_, i) => (
                    <div key={i} style={{ flex: 1, height: 26, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: "#0a0804" }}>{i + offset + 1}</span>
                    </div>
                  ))}
                  <div style={{ ...totBase, height: 26, borderLeft: "none" }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: "#0a0804" }}>TOT</span>
                  </div>
                </div>
                {/* PAR row */}
                <div style={{ display: "flex", borderBottom: gridLine, background: BC.amber + "18" }}>
                  <div style={{ ...lblBase, height: 22 }}>PAR</div>
                  {sectionPars.map((p, i) => (
                    <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 11, color: BC.t2, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", height: 22, borderRight: i < 8 ? gridLine : "none" }}>{p}</div>
                  ))}
                  <div style={{ ...totBase, height: 22 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: BC.t3 }}>{sectionParTotal}</span>
                  </div>
                </div>
                {/* HCP row */}
                <div style={{ display: "flex", borderBottom: gridLine, background: BC.inp }}>
                  <div style={{ ...lblBase, height: 20 }}>HCP</div>
                  {sectionHcps.map((h, i) => (
                    <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 10, color: BC.t3, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", height: 20, borderRight: i < 8 ? gridLine : "none" }}>{h}</div>
                  ))}
                  <div style={{ ...totBase, height: 20 }} />
                </div>
                {/* Team 1 player rows + team net */}
                {t1Pids2.map(pid => renderPlayerRow(pid))}
                {renderTeamNetRow(t1Pids2, true)}
                {/* Match status row */}
                {renderMatchRow()}
                {/* Team 2 player rows + team net (no border-bottom on the last row) */}
                {t2Pids2.map(pid => renderPlayerRow(pid))}
                {renderTeamNetRow(t2Pids2, false)}
              </div>
            );
          };

          return (
            <>
              {/* Backdrop — tap anywhere to close */}
              <div onClick={() => setShowScorecard(false)} style={{
                position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 400,
              }} />
              {/* Scrollable centering wrapper — tapping outside the card also closes */}
              <div onClick={() => setShowScorecard(false)} style={{
                position: "fixed", inset: 0, zIndex: 450,
                display: "flex", alignItems: "flex-start", justifyContent: "center",
                padding: 12, overflowY: "auto",
              }}>
                <div onClick={e => e.stopPropagation()} style={{
                  background: BC.bg, border: `1px solid ${BC.bdr}`, borderRadius: 14,
                  width: "100%", maxWidth: 440,
                  marginTop: 12, marginBottom: 12,
                  display: "flex", flexDirection: "column",
                  fontFamily: "'Montserrat', sans-serif",
                }}>
                  {/* Header */}
                  <div style={{ padding: "12px 14px", borderBottom: `1px solid ${BC.bdr}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: BC.amber, letterSpacing: 1 }}>SCORECARD</div>
                      <div style={{ fontSize: 10, color: BC.t3, marginTop: 2 }}>
                        Match {matchIdx + 1} · <span style={{ color: tcA.accent, fontWeight: 700 }}>T{t1Idx + 1}</span> vs <span style={{ color: tcB.accent, fontWeight: 700 }}>T{t2Idx + 1}</span>
                      </div>
                    </div>
                    <button onClick={() => setShowScorecard(false)} style={{
                      width: 28, height: 28, borderRadius: 6,
                      background: BC.inp, border: `1px solid ${BC.bdr}`,
                      color: BC.t2, fontSize: 14, fontWeight: 700, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>×</button>
                  </div>

                  {/* Body */}
                  <div style={{ padding: 10 }}>
                    {renderSection(0)}
                    {renderSection(9)}
                  </div>

                  {/* Footer */}
                  <button onClick={() => setShowScorecard(false)} style={{
                    display: "block", width: "calc(100% - 24px)", margin: "0 auto 12px",
                    padding: "10px 0", background: BC.inp, border: `1px solid ${BC.bdr}`,
                    borderRadius: 8, color: BC.t2, fontSize: 13, fontWeight: 600,
                    cursor: "pointer", letterSpacing: 0.4,
                  }}>
                    Close
                  </button>
                </div>
              </div>
            </>
          );
        })()}
      </div>
    );
  };

  // ── Leaderboard Sub-view ──
  const LeaderboardTab = () => {
    const [expandedMatch, setExpandedMatch] = useState(null);
    const holePars = course?.hole_pars || Array(18).fill(4);

    if (!event || !course) {
      return <div style={{ textAlign: "center", padding: 40, color: BC.t3 }}>No event yet.</div>;
    }

    return (
      <div>
        <div style={{ background: BC.card, borderRadius: 10, padding: "8px 12px", marginBottom: 10, border: `1px solid ${BC.bdr}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: BC.gold }}>{course.name}</div>
          <div style={{ fontSize: 9, color: BC.t3, marginTop: 2 }}>Team Total Match Play · {event.hcp_mode === "full" ? "Full Strokes" : "Low Man"}</div>
        </div>

        {matchResults.map((mr, i) => {
          const m = mr.match;
          const r = mr.result;
          const t1Idx = event.teams.findIndex(t => t.id === m.team1.id);
          const t2Idx = event.teams.findIndex(t => t.id === m.team2.id);
          const tc1 = PRACTICE_TEAM_COLORS[t1Idx];
          const tc2 = PRACTICE_TEAM_COLORS[t2Idx];
          const t1Players = [m.team1.player1, m.team1.player2].map(pid => tPlayers.find(p => p.player_id === pid));
          const t2Players = [m.team2.player1, m.team2.player2].map(pid => tPlayers.find(p => p.player_id === pid));
          const isExpanded = expandedMatch === m.id;
          const isT1Winning = r.winnerTeamId === m.team1.id;
          const isT2Winning = r.winnerTeamId === m.team2.id;

          return (
            <div key={m.id} style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, marginBottom: 10, overflow: "hidden" }}>
              <button onClick={() => setExpandedMatch(isExpanded ? null : m.id)} style={{
                width: "100%", padding: "12px 14px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 9, color: BC.t3, fontWeight: 800, letterSpacing: 1 }}>MATCH {i + 1}</div>
                  <div style={{ fontSize: 9, color: BC.t3 }}>Thru {r.thru}</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 10 }}>
                  {/* Team 1 */}
                  <div style={{ textAlign: "left", opacity: r.thru > 0 && !isT1Winning && !r.dormie ? 0.6 : 1 }}>
                    <div style={{ fontSize: 9, color: tc1.accent, fontWeight: 800, letterSpacing: 1, marginBottom: 2 }}>TEAM {t1Idx + 1}</div>
                    {t1Players.map(p => p && <div key={p.player_id} style={{ fontSize: 11, fontWeight: 600, color: BC.t1 }}>{p.name?.split(" ").slice(-1)[0]}</div>)}
                    <div style={{ fontSize: 18, fontWeight: 800, color: tc1.accent, marginTop: 4 }}>{r.holesWon1}</div>
                  </div>
                  {/* Status */}
                  <div style={{ textAlign: "center", padding: "4px 10px", background: BC.inp, borderRadius: 6, border: `1px solid ${BC.bdr}` }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: BC.amber, letterSpacing: 0.5 }}>{r.matchResultText}</div>
                  </div>
                  {/* Team 2 */}
                  <div style={{ textAlign: "right", opacity: r.thru > 0 && !isT2Winning && !r.dormie ? 0.6 : 1 }}>
                    <div style={{ fontSize: 9, color: tc2.accent, fontWeight: 800, letterSpacing: 1, marginBottom: 2 }}>TEAM {t2Idx + 1}</div>
                    {t2Players.map(p => p && <div key={p.player_id} style={{ fontSize: 11, fontWeight: 600, color: BC.t1 }}>{p.name?.split(" ").slice(-1)[0]}</div>)}
                    <div style={{ fontSize: 18, fontWeight: 800, color: tc2.accent, marginTop: 4 }}>{r.holesWon2}</div>
                  </div>
                </div>
                {/* Hole tracker */}
                <div style={{ display: "flex", gap: 1, marginTop: 8 }}>
                  {r.holes.map((h, hi) => {
                    const bg = h.result === 1 ? tc1.accent : h.result === -1 ? tc2.accent : h.result === 0 ? BC.t3 : BC.bdr;
                    return <div key={hi} style={{ flex: 1, height: 4, background: bg, borderRadius: 1 }} />;
                  })}
                </div>
              </button>

              {isExpanded && (
                <div style={{ padding: "10px 14px", borderTop: `1px solid ${BC.bdr}`, background: BC.inp }}>
                  <div style={{ fontSize: 9, color: BC.t3, fontWeight: 800, letterSpacing: 1, marginBottom: 8 }}>HOLE-BY-HOLE</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 2, fontSize: 9, marginBottom: 6 }}>
                    {Array.from({ length: 9 }, (_, h) => (
                      <div key={h} style={{ textAlign: "center", color: BC.t3, fontWeight: 700 }}>{h + 1}</div>
                    ))}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 2, marginBottom: 4 }}>
                    {r.holes.slice(0, 9).map((h, hi) => {
                      const bg = h.result === 1 ? tc1.accent + "44" : h.result === -1 ? tc2.accent + "44" : h.result === 0 ? BC.t3 + "44" : BC.bdr;
                      const txt = h.result === 1 ? tc1.accent : h.result === -1 ? tc2.accent : BC.t2;
                      return (
                        <div key={hi} style={{ background: bg, borderRadius: 3, padding: "3px 0", textAlign: "center", fontSize: 9, fontWeight: 700, color: txt }}>
                          {h.n1 != null && h.n2 != null ? `${h.n1}-${h.n2}` : "—"}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 2, fontSize: 9, marginBottom: 6, marginTop: 8 }}>
                    {Array.from({ length: 9 }, (_, h) => (
                      <div key={h} style={{ textAlign: "center", color: BC.t3, fontWeight: 700 }}>{h + 10}</div>
                    ))}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 2 }}>
                    {r.holes.slice(9, 18).map((h, hi) => {
                      const bg = h.result === 1 ? tc1.accent + "44" : h.result === -1 ? tc2.accent + "44" : h.result === 0 ? BC.t3 + "44" : BC.bdr;
                      const txt = h.result === 1 ? tc1.accent : h.result === -1 ? tc2.accent : BC.t2;
                      return (
                        <div key={hi} style={{ background: bg, borderRadius: 3, padding: "3px 0", textAlign: "center", fontSize: 9, fontWeight: 700, color: txt }}>
                          {h.n1 != null && h.n2 != null ? `${h.n1}-${h.n2}` : "—"}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // ── Betting Sub-view ──
  const BettingTab = () => {
    const [tab, setTab] = useState("skins"); // skins | ctp
    const holePars = course?.hole_pars || Array(18).fill(4);
    const par3Holes = holePars.map((p, i) => p === 3 ? i : -1).filter(i => i !== -1);

    // Skins counts — useMemo always fires, even when skins/eventPlayers
    // are empty during initial load. Guards inside keep it cheap.
    const skinsByPlayer = useMemo(() => {
      const counts = {};
      eventPlayers.forEach(p => { counts[p.player_id] = { gross: 0, net: 0 }; });
      for (let h = 0; h < 18; h++) {
        if (skins.gross[h]) counts[skins.gross[h]] = counts[skins.gross[h]] || { gross: 0, net: 0 };
        if (skins.gross[h]) counts[skins.gross[h]].gross++;
        if (skins.net[h]) counts[skins.net[h]] = counts[skins.net[h]] || { gross: 0, net: 0 };
        if (skins.net[h]) counts[skins.net[h]].net++;
      }
      return counts;
    }, [skins, eventPlayers]);

    if (!event || !course) {
      return <div style={{ textAlign: "center", padding: 40, color: BC.t3 }}>No event yet.</div>;
    }

    const renderPlayerTeamColor = (pid) => {
      const slotIdx = event.teams.findIndex(t => t.player1 === pid || t.player2 === pid);
      return slotIdx !== -1 ? PRACTICE_TEAM_COLORS[slotIdx] : null;
    };

    return (
      <div>
        {/* Sub-tabs */}
        <div style={{ display: "flex", background: BC.card, borderRadius: 20, padding: 3, marginBottom: 12, border: `1px solid ${BC.bdr}` }}>
          {[["skins", "Skins"], ["ctp", "CTP"]].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              flex: 1, padding: "8px 0", borderRadius: 16, fontSize: 12, fontWeight: 700, cursor: "pointer",
              background: tab === k ? `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})` : "transparent",
              color: tab === k ? "#0a0804" : BC.t3, border: "none",
            }}>{label}</button>
          ))}
        </div>

        {tab === "skins" && (
          <div>
            {/* Per-hole table */}
            <div style={{ background: BC.card, borderRadius: 10, padding: 12, marginBottom: 12, border: `1px solid ${BC.bdr}` }}>
              <div style={{ display: "grid", gridTemplateColumns: "30px 1fr 1fr", gap: 4, fontSize: 9, color: BC.t3, fontWeight: 800, letterSpacing: 1, marginBottom: 6 }}>
                <div>HOLE</div>
                <div>GROSS</div>
                <div>NET</div>
              </div>
              {Array.from({ length: 18 }, (_, h) => {
                const grossP = skins.gross[h];
                const netP = skins.net[h];
                const grossPlayer = grossP ? tPlayers.find(p => p.player_id === grossP) : null;
                const netPlayer = netP ? tPlayers.find(p => p.player_id === netP) : null;
                const grossTc = grossP ? renderPlayerTeamColor(grossP) : null;
                const netTc = netP ? renderPlayerTeamColor(netP) : null;
                return (
                  <div key={h} style={{ display: "grid", gridTemplateColumns: "30px 1fr 1fr", gap: 4, padding: "4px 0", borderTop: h ? `1px solid ${BC.bdr}33` : "none", fontSize: 11 }}>
                    <div style={{ color: BC.t3, fontWeight: 700 }}>{h + 1}</div>
                    <div style={{ color: grossTc?.accent || BC.t3, fontWeight: grossPlayer ? 700 : 400 }}>
                      {grossPlayer ? grossPlayer.name?.split(" ").slice(-1)[0] : "—"}
                    </div>
                    <div style={{ color: netTc?.accent || BC.t3, fontWeight: netPlayer ? 700 : 400 }}>
                      {netPlayer ? netPlayer.name?.split(" ").slice(-1)[0] : "—"}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Totals */}
            <div style={{ background: BC.card, borderRadius: 10, padding: 12, border: `1px solid ${BC.bdr}` }}>
              <div style={{ fontSize: 9, color: BC.t3, fontWeight: 800, letterSpacing: 1, marginBottom: 8 }}>SKINS TOTAL</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 6, fontSize: 11, marginBottom: 4, color: BC.t3, fontWeight: 700 }}>
                <div>PLAYER</div>
                <div style={{ width: 40, textAlign: "right" }}>GROSS</div>
                <div style={{ width: 40, textAlign: "right" }}>NET</div>
              </div>
              {eventPlayers.map(p => {
                const c = skinsByPlayer[p.player_id] || { gross: 0, net: 0 };
                if (c.gross === 0 && c.net === 0) return null;
                const tc = renderPlayerTeamColor(p.player_id);
                return (
                  <div key={p.player_id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 6, padding: "4px 0", borderTop: `1px solid ${BC.bdr}33`, fontSize: 12 }}>
                    <div style={{ color: BC.t1, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 4, height: 4, borderRadius: "50%", background: tc?.accent || BC.t3 }} />
                      {p.name}
                    </div>
                    <div style={{ width: 40, textAlign: "right", color: c.gross ? BC.gold : BC.t3, fontWeight: 700 }}>{c.gross}</div>
                    <div style={{ width: 40, textAlign: "right", color: c.net ? BC.gold : BC.t3, fontWeight: 700 }}>{c.net}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === "ctp" && (
          <div style={{ background: BC.card, borderRadius: 10, padding: 12, border: `1px solid ${BC.bdr}` }}>
            <div style={{ fontSize: 9, color: BC.t3, fontWeight: 800, letterSpacing: 1, marginBottom: 10 }}>CLOSEST TO PIN — PAR 3 HOLES</div>
            {par3Holes.length === 0 && (
              <div style={{ fontSize: 11, color: BC.t3, padding: 12, textAlign: "center" }}>
                No par 3s configured for this course. Set hole pars in Admin → Courses.
              </div>
            )}
            {par3Holes.map(h => {
              const winner = ctps[h];
              return (
                <div key={h} style={{ marginBottom: 14, paddingBottom: 10, borderBottom: `1px solid ${BC.bdr}33` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: BC.gold }}>Hole {h + 1}</div>
                    {winner && (
                      <button onClick={() => onSetCtp(h, null)} style={{
                        background: "transparent", border: `1px solid ${BC.danger}55`, color: BC.danger,
                        borderRadius: 4, padding: "2px 8px", fontSize: 9, fontWeight: 600, cursor: "pointer",
                      }}>Clear</button>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                    {event.player_ids.map(pid => {
                      const p = tPlayers.find(t => t.player_id === pid);
                      const tc = renderPlayerTeamColor(pid);
                      const isW = winner === pid;
                      return (
                        <button key={pid} onClick={() => onSetCtp(h, pid)} style={{
                          padding: "6px 8px", borderRadius: 6,
                          background: isW ? tc.color + "55" : BC.inp,
                          border: `1px solid ${isW ? tc.accent : BC.bdr}`,
                          color: isW ? BC.t1 : BC.t2, fontSize: 11, fontWeight: 600, cursor: "pointer", textAlign: "left",
                          display: "flex", alignItems: "center", gap: 4,
                        }}>
                          <span style={{ width: 4, height: 4, borderRadius: "50%", background: tc.accent, flexShrink: 0 }} />
                          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p?.name?.split(" ").slice(-1)[0] || pid}</span>
                          {isW && <span style={{ fontSize: 10 }}>🎯</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // ── Top of view ──
  // Setup is director-only — non-directors see only Scoring/Leaderboard/Betting.
  // Plain text labels mirror MNQ's pill-style ViewToggle (no emojis).
  const isDirector = !!user?.isDirector;
  const subTabs = [
    ...(isDirector ? [{ k: "setup", label: "Setup" }] : []),
    { k: "scoring", label: "Scoring" },
    { k: "leaderboard", label: "Leaderboard" },
    { k: "betting", label: "Betting" },
  ];

  // Default routing:
  //   - Directors with no event → land on Setup so they can configure
  //   - Non-directors (or directors with an event) → never on Setup
  //   - Anyone whose subView no longer exists in their visible tabs → Scoring
  useEffect(() => {
    if (!isDirector && subView === "setup") { setSubView("scoring"); return; }
    if (isDirector && !event && subView !== "setup") setSubView("setup");
  }, [event, isDirector, subView]);

  return (
    <div style={{ fontFamily: "'Montserrat', sans-serif" }}>
      {/* Header */}
      <div style={{ marginBottom: 12, padding: "10px 14px", background: BC.card, borderRadius: 10, border: `1px solid ${BC.amber}33` }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: BC.amber, letterSpacing: 1 }}>MASH ROUND</div>
        <div style={{ fontSize: 10, color: BC.t3, marginTop: 2 }}>
          {event ? `${course?.name || "Course TBD"} · ${event.player_ids?.length || 0} players · ${event.matches?.length || 0} matches` : "No event configured"}
        </div>
      </div>

      {/* Sub-tabs — MNQ-style pill toggle. Active tab fills with amber, others transparent. */}
      <div style={{ display: "flex", background: BC.inp, borderRadius: 20, border: `1px solid ${BC.bdr}`, padding: 3, marginBottom: 12 }}>
        {subTabs.map(t => {
          const isAct = subView === t.k;
          return (
            <button key={t.k} onClick={() => { if (!isAct) setSubView(t.k); }} style={{
              flex: 1, padding: "7px 8px", borderRadius: 17,
              fontSize: 11, fontWeight: 700, border: "none",
              background: isAct ? BC.amber : "transparent",
              color: isAct ? "#0a0804" : BC.t3,
              cursor: isAct ? "default" : "pointer",
              transition: "all .2s",
            }}>{t.label}</button>
          );
        })}
      </div>

      {subView === "setup" && isDirector && <SetupTab />}
      {subView === "scoring" && <ScoringTab />}
      {subView === "leaderboard" && <LeaderboardTab />}
      {subView === "betting" && <BettingTab />}
    </div>
  );
}

function SlideMenu({ open, onClose, onNavigate, onLogout, user, view, darkMode, onToggleTheme }) {
  const dragRef = useRef(null);
  const startYRef = useRef(null);
  const [dragY, setDragY] = useState(0);

  const handleTouchStart = (e) => { startYRef.current = e.touches[0].clientY; setDragY(0); };
  const handleTouchMove = (e) => {
    if (startYRef.current == null) return;
    const dy = e.touches[0].clientY - startYRef.current;
    if (dy > 0) setDragY(dy);
  };
  const handleTouchEnd = () => {
    if (dragY > 80) { onClose(); }
    setDragY(0);
    startYRef.current = null;
  };

  if (!open) return null;
  const items = [
    { key: "analytics", label: "Player Analytics", icon: "📊" },
    { key: "history",   label: "Historical Data",  icon: "📅" },
    { key: "photos",    label: "Photo Library",     icon: "📸", external: true },
    ...(user?.isDirector ? [{ key: "admin", label: "Admin Settings", icon: "⚙️" }] : []),
    { key: "logout", label: "Logout", icon: "🚪", onLogout: () => { onLogout(); onClose(); } },
  ];
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 200 }} />
      <div
        ref={dragRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          position: "fixed",
          bottom: "calc(56px + env(safe-area-inset-bottom, 16px))",
          right: "max(8px, calc(50vw - 252px))",
          transform: `translateY(${dragY}px)`,
          transition: dragY === 0 ? "transform 0.2s ease, opacity 0.15s ease" : "none",
          width: 220,
          background: BC.card,
          borderRadius: 12,
          border: `1px solid ${BC.bdr}`,
          boxShadow: "0 -4px 24px rgba(0,0,0,0.4)",
          zIndex: 201,
          overflow: "hidden",
        }}>

        {/* Menu items — no icons */}
        {items.filter(i => i.key !== "logout").map((item, idx) => {
          const isActive = item.key === view;
          return (
            <button key={item.key} onClick={() => {
              if (item.external) { window.open("https://thebourboncup.com/photos", "_blank"); onClose(); return; }
              onNavigate(item.key); onClose();
            }} style={{
              width: "100%", padding: "12px 16px",
              background: isActive ? BC.amber + "15" : "transparent",
              borderTop: idx === 0 ? "none" : `1px solid ${BC.bdr}22`,
              borderLeft: "none", borderRight: "none", borderBottom: "none",
              color: isActive ? BC.amber : BC.t1,
              fontSize: 13, fontWeight: isActive ? 700 : 500,
              cursor: "pointer", textAlign: "left",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <span>{item.label}</span>
              {isActive && <span style={{ width: 6, height: 6, borderRadius: "50%", background: BC.amber, flexShrink: 0 }} />}
            </button>
          );
        })}

        <div style={{ height: 1, background: BC.bdr + "55" }} />

        {/* Theme toggle — pill-style switch. Labelled "Dark Mode" because that's
            what the toggle controls; thumb-on-right = dark active, thumb-on-left
            = light. Tap anywhere on the row flips it. */}
        {onToggleTheme && (
          <button onClick={(e) => { e.stopPropagation(); onToggleTheme(); }} style={{
            width: "100%", padding: "12px 16px",
            background: "transparent",
            border: "none", borderTop: `1px solid ${BC.bdr}22`,
            color: BC.t1, fontSize: 13, fontWeight: 500,
            cursor: "pointer", textAlign: "left",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
          }}>
            <span>Dark Mode</span>
            {/* iOS-style toggle: track + thumb. On = amber track + thumb right. */}
            <span aria-hidden style={{
              position: "relative", width: 36, height: 20, borderRadius: 10,
              background: darkMode ? BC.amber : BC.bdr,
              transition: "background 0.2s ease", flexShrink: 0,
            }}>
              <span style={{
                position: "absolute", top: 2, left: darkMode ? 18 : 2,
                width: 16, height: 16, borderRadius: "50%",
                background: darkMode ? "#0a0804" : BC.card,
                transition: "left 0.2s ease",
                boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
              }} />
            </span>
          </button>
        )}

        <div style={{ height: 1, background: BC.bdr + "55" }} />

        {/* Logout */}
        {items.filter(i => i.key === "logout").map(item => (
          <button key={item.key} onClick={() => { item.onLogout && item.onLogout(); }} style={{
            width: "100%", padding: "12px 16px",
            background: "transparent",
            border: "none",
            color: BC.danger, fontSize: 13, fontWeight: 500,
            cursor: "pointer", textAlign: "left",
          }}>
            Logout
          </button>
        ))}
      </div>
    </>
  );
}


// ── Tee color helpers (from WBC) ──
const TEE_COLOR_MAP = {
  black: "#2c2c2c", blue: "#2d8fd4", white: "#e8e8e8", gold: "#d4a843", red: "#9b2335",
  green: "#2d8a4e", silver: "#a8b2bd", yellow: "#e6c619", orange: "#e67e22", purple: "#7b2d8b",
  maroon: "#6b1c2a", navy: "#1b2a4a", teal: "#1a8a7a", tan: "#c4a86b", copper: "#b87333",
  bronze: "#cd7f32", champagne: "#f7e7ce", crimson: "#b22234", burgundy: "#800020",
  platinum: "#c0c0c0", pewter: "#8e8e8e", sand: "#c2b280", coral: "#ff7f50",
  tournament: "#1a1a2e", championship: "#1a1a2e", tips: "#1a1a2e", pro: "#2d8fd4",
  ladies: "#c0392b", senior: "#d4a843", forward: "#d4a843", back: "#1a1a2e", middle: "#e8e8e8",
};
const resolveTeeColor = (tee, index) => {
  const key = (tee.name || "").toLowerCase().trim();
  if (TEE_COLOR_MAP[key]) return TEE_COLOR_MAP[key];
  for (const [word, clr] of Object.entries(TEE_COLOR_MAP)) { if (key.includes(word)) return clr; }
  if (tee.color && tee.color !== "#000" && tee.color !== "#000000") return tee.color;
  return ["#5b8fb9","#8b5e3c","#6b7b3a","#8e44ad","#2e86ab","#a84632"][index % 6];
};
const isLightTeeBC = (clr) => ["#e8e8e8","#a8b2bd","#c0c0c0","#f7e7ce","#c2b280","#c4a86b","#8e8e8e"].includes((clr||"").toLowerCase());
const isDarkTeeBC = (clr) => ["#1a1a2e","#000000","#111111","#0a0a0a","#1a1a1a","#222222","#2c2c2c","#2d2d2d","#0d0d0d","black"].includes((clr||"").toLowerCase());
const TeeCircle = ({ tee, index, size = 14, active }) => {
  const color = resolveTeeColor(tee, index || 0);
  const isDark = isDarkTeeBC(color);
  const isLight = isLightTeeBC(color);
  if (isDark) {
    return (
      <span style={{ width: size, height: size, borderRadius: "50%", background: "#a8b2bd", border: `2px solid ${active ? "#fff" : "#88888860"}`, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <span style={{ width: size * 0.45, height: size * 0.45, borderRadius: "50%", background: "#111", display: "block" }} />
      </span>
    );
  }
  return (
    <span style={{ width: size, height: size, borderRadius: "50%", background: color, border: `2px solid ${active ? "#fff" : (isLight ? "#99999960" : "#ffffff25")}`, display: "inline-block", flexShrink: 0 }} />
  );
};

// ── Main App ──
export default function App() {
  const [user, setUser] = useState(null);
  // Default landing view = Mash. For the test event tomorrow (and going
  // forward as long as Mash is the active feature), users land on the Mash
  // tab on first login and on every app restart. They can navigate away
  // during a session, but a reload puts them back on Mash. Change the
  // string below to "leaderboard" once the real tournament starts.
  const [view, setView] = useState("practice");
  const [menuOpen, setMenuOpen] = useState(false);
  const [skinsData, setSkinsData] = useState({}); // { "round_hole": pid }
  const [ctpData, setCtpData] = useState({});     // { "round_hole": pid }
  const [skinsPot, setSkinsPot] = useState(0);
  const [historicalData, setHistoricalData] = useState([]);
  const [teamNames, setTeamNames] = useState({ A: "Team Alpha", B: "Team Beta" });

  // Theme state — toggled via the More menu. The actual color values live in
  // the module-level BC object (mutated by applyBCTheme); this state's only
  // job is to trigger a top-level re-render so children re-read fresh BC
  // values inline. Initial value comes from localStorage so the saved
  // preference survives reloads.
  const [darkMode, setDarkMode] = useState(_bcSavedMode === "dark");
  const toggleTheme = useCallback(() => {
    const newMode = darkMode ? "light" : "dark";
    try { localStorage.setItem("bc_theme", newMode); } catch {}
    applyBCTheme(newMode);
    setDarkMode(!darkMode);
  }, [darkMode]);

  // Keep the global <style> tag's body bg in sync with the active theme.
  // Without this, the html/body fill behind the React tree stays whatever
  // color was painted on initial load — toggling the theme leaves a flash
  // of the old color around the safe areas / scroll bounce.
  useEffect(() => {
    const styleEl = document.getElementById("bc-global-style");
    if (styleEl) {
      styleEl.textContent = `
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body, #root { height: 100%; width: 100%; background: ${BC.bg}; overflow: hidden; }
        body { margin: 0; padding: 0; }
      `;
    }
  }, [darkMode]);

  // Keep TEAM_A/TEAM_B module vars in sync with state
  useEffect(() => {
    TEAM_A = { ...TEAM_A, name: teamNames.A };
    TEAM_B = { ...TEAM_B, name: teamNames.B };
  }, [teamNames]);
  const [tPlayers, setTPlayers] = useState([]);
  const [tRounds, setTRounds] = useState([]);
  const [courses, setCourses] = useState([]);
  const [matches, setMatches] = useState([]);
  const [holeData, setHoleData] = useState({});
  const [notif, setNotif] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [hcpOverridesData, setHcpOverridesData] = useState({}); // { round: { pid: value } }
  const [teeAssignmentsData, setTeeAssignmentsData] = useState({});

  const notify = useCallback((msg, type = "success") => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 2800);
  }, []);

  // Subscribe to Firestore
  useEffect(() => {
    const unsubs = [];
    const f = [{ field: "tournament_id", op: "==", value: TOURNAMENT_ID }];
    unsubs.push(db.subscribe("bc_players", f, setTPlayers));
    unsubs.push(db.subscribe("bc_settings", f, rows => {
      const tn = rows.find(r => r.id === "team_names");
      if (tn) setTeamNames({ A: tn.teamA || "Team Alpha", B: tn.teamB || "Team Beta" });
    }));
    unsubs.push(db.subscribe("bc_rounds", f, rows => setTRounds(rows)));
    unsubs.push(db.subscribe("bc_skins", f, rows => {
      const sd = {};
      rows.forEach(r => { sd[`${r.round}_${r.hole}`] = r.player_id; });
      setSkinsData(sd);
    }));
    unsubs.push(db.subscribe("bc_ctp", f, rows => {
      const cd = {};
      rows.forEach(r => { cd[`${r.round}_${r.hole}`] = r.player_id; });
      setCtpData(cd);
    }));
    unsubs.push(db.subscribe("bc_tournament_settings", f, rows => {
      const s = rows.find(r => r.id === "bc_settings_main");
      if (s?.skins_pot) setSkinsPot(s.skins_pot);
    }));
    unsubs.push(db.subscribe("bc_historical", [{ field: "type", op: "==", value: "year" }], setHistoricalData));
    unsubs.push(db.subscribe("bc_tee_assignments", f, rows => {
      const data = {};
      rows.forEach(r => { if (r.round_number) data[r.round_number] = r.assignments || {}; });
      // Pass to AdminView via prop
      setTeeAssignmentsData(data);
    }));
    unsubs.push(db.subscribe("bc_hcp_overrides", f, rows => {
      const data = {};
      rows.forEach(r => { if (r.round_number) data[r.round_number] = r.overrides || {}; });
      setHcpOverridesData(data);
    }));
    unsubs.push(db.subscribe("bc_courses", f, setCourses));
    unsubs.push(db.subscribe("bc_matches", f, setMatches));
    unsubs.push(db.subscribe("bc_hole_scores", f, rows => {
      const hd = {};
      rows.forEach(r => {
        const key = `${r.player_id}_${r.round_number}`;
        if (!hd[key]) hd[key] = {};
        hd[key][r.hole_number - 1] = r.score;
      });
      setHoleData(hd);
    }));
    return () => unsubs.forEach(u => u());
  }, []);

  // Enhance tRounds with nassau data
  const enrichedRounds = useMemo(() => tRounds.map(r => ({
    ...r,
    nassau: { front: r.nassau_front ?? 1, back: r.nassau_back ?? 1, overall: r.nassau_overall ?? 1 },
    handicap_mode: r.handicap_mode || (r.round_number === 4 ? 'full' : 'low_man'),
  })), [tRounds]);

  // Enhance matches with nassau from round
  const enrichedMatches = useMemo(() => matches.map(m => {
    const tr = enrichedRounds.find(t => t.round_number === m.round);
    return { ...m, nassau: m.nassau || tr?.nassau || NASSAU_DEFAULT };
  }), [matches, enrichedRounds]);

  const onSaveHole = useCallback(async (pid, rnd, holeIdx, score, courseId) => {
    setSyncing(true);
    const data = {
      id: `bc_hs_r${rnd}_${pid}_h${holeIdx + 1}`,
      tournament_id: TOURNAMENT_ID,
      player_id: pid,
      round_number: rnd,
      hole_number: holeIdx + 1,
      score,
      course_id: courseId || "",
    };
    // Optimistic update
    setHoleData(prev => {
      const key = `${pid}_${rnd}`;
      return { ...prev, [key]: { ...prev[key], [holeIdx]: score } };
    });
    await db.upsert("bc_hole_scores", data);
    setSyncing(false);
  }, []);

  const onAddPlayer = useCallback(async (p) => { await db.upsert("bc_players", p); }, []);
  const onUpdatePlayer = useCallback(async (p) => { await db.upsert("bc_players", p); }, []);
  const onRemovePlayer = useCallback(async (pid) => { await db.delete("bc_players", pid); }, []);
  const onAddCourse = useCallback(async (c) => { if (c._delete) { await db.delete("bc_courses", c.id); } else { await db.upsert("bc_courses", c); } }, []);
  const onSetSkin = useCallback(async (round, hole, pid) => {
    const id = `bc_skin_r${round}_h${hole+1}`;
    if (pid) await db.upsert("bc_skins", { id, tournament_id: TOURNAMENT_ID, round, hole, player_id: pid });
    else await db.delete("bc_skins", id);
  }, []);
  const onSetCtp = useCallback(async (round, hole, pid) => {
    const id = `bc_ctp_r${round}_h${hole+1}`;
    if (pid) await db.upsert("bc_ctp", { id, tournament_id: TOURNAMENT_ID, round, hole, player_id: pid });
    else await db.delete("bc_ctp", id);
  }, []);
  const onUpdatePot = useCallback(async (amt) => {
    setSkinsPot(amt);
    await db.upsert("bc_tournament_settings", { id: "bc_settings_main", tournament_id: TOURNAMENT_ID, skins_pot: amt });
  }, []);
  const onSetRound = useCallback(async (r) => { await db.upsert("bc_rounds", r); }, []);
  const onSetMatch = useCallback(async (m) => {
    if (m._delete) { await db.delete("bc_matches", m.id); }
    else { await db.upsert("bc_matches", m); }
  }, []);

  const availableRounds = useMemo(() => [...new Set(enrichedMatches.map(m => m.round))].sort(), [enrichedMatches]);

  if (!user) return <LoginScreen players={tPlayers} teamNames={teamNames} onLogin={p => { setUser({ ...p, isDirector: !!p.isDirector }); }} />;

  const navItems = [
    { key: "practice",    label: "Mash",        icon: "mash" },
    { key: "scoring",     label: "Scoring",     icon: "score" },
    { key: "groups",      label: "Matches",     icon: "groups" },
    { key: "leaderboard", label: "Leaderboard", icon: "trophy" },
    { key: "betting",     label: "Betting",     icon: "betting" },
    { key: "menu",        label: "More",        icon: "menu" },
  ];

  const renderIcon = (icon, active) => {
    const clr = active ? BC.amber : BC.t3;
    const sz = 20;
    if (icon === "trophy") return <img src={TROPHY_SILHOUETTE} alt="Board" style={{ width: sz, height: sz, objectFit: "contain", filter: active ? `brightness(0) saturate(100%) invert(65%) sepia(60%) saturate(500%) hue-rotate(5deg) brightness(105%)` : `brightness(0) saturate(100%) invert(40%) sepia(10%) saturate(400%) hue-rotate(185deg) brightness(80%)` }} />;
    if (icon === "groups") return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={clr} strokeWidth="2" strokeLinecap="round"><circle cx="9" cy="7" r="3"/><circle cx="17" cy="7" r="3"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/><path d="M21 21v-2a3 3 0 00-2-2.83"/></svg>;
    if (icon === "score") return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={clr} strokeWidth="2" strokeLinecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg>;
    if (icon === "betting") return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={clr} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v4c0 1.66 3.58 3 8 3s8-1.34 8-3V6"/><path d="M4 10v4c0 1.66 3.58 3 8 3s8-1.34 8-3v-4"/></svg>;
    if (icon === "menu") return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={clr} strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>;
    // Mash — flag on a pole, evoking the Mash Brothers logo without competing with their marks
    if (icon === "mash") return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={clr} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="22" x2="5" y2="3"/><path d="M5 4 C 10 2, 14 6, 20 4 L 20 13 C 14 15, 10 11, 5 13 Z" fill={active ? BC.amber + "55" : BC.t3 + "33"}/></svg>;
    if (icon === "admin") return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={clr} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
    return null;
  };

  return (
    <div style={{ height: "100svh", width: "100%", background: BC.bg, display: "flex", flexDirection: "column", position: "relative", fontFamily: "'Montserrat', sans-serif", overflow: "hidden" }}>
      <div style={{ maxWidth: 520, width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", height: "100%", position: "relative", padding: "0 4px" }}>
      <Notif notif={notif} />



      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "12px 10px 80px 10px" }}>
        {view === "leaderboard" && (
          <TeamLeaderboard
            matches={enrichedMatches}
            holeData={holeData}
            courses={courses}
            tRounds={enrichedRounds}
            tPlayers={tPlayers}
            rounds={availableRounds.length ? availableRounds : [1,2,3,4]}
            teamNames={teamNames}
            hcpOverridesFromDb={hcpOverridesData}
            teeAssignmentsFromDb={teeAssignmentsData}
          />
        )}
        {view === "scoring" && (
          <ScoreEntry
            user={user}
            matches={enrichedMatches}
            holeData={holeData}
            onSaveHole={onSaveHole}
            tPlayers={tPlayers}
            courses={courses}
            tRounds={enrichedRounds}
            notify={notify}
            teamNames={teamNames}
            hcpOverrides={hcpOverridesData}
          />
        )}
        {view === "groups" && (
          <GroupsView
            matches={enrichedMatches}
            tRounds={enrichedRounds}
            tPlayers={tPlayers}
            courses={courses}
            teamNames={teamNames}
          />
        )}
        {view === "betting" && (
          <BettingView
            tPlayers={tPlayers} tRounds={enrichedRounds} courses={courses}
            holeData={holeData} skinsData={skinsData} ctpData={ctpData}
            skinsPot={skinsPot} onSetSkin={onSetSkin} onSetCtp={onSetCtp}
            onUpdatePot={onUpdatePot} user={user} enrichedRounds={enrichedRounds}
          />
        )}
        {(view === "analytics" || view === "history") && (
          <AnalyticsView
            tPlayers={tPlayers} matches={enrichedMatches} holeData={holeData}
            tRounds={enrichedRounds} courses={courses} historicalData={historicalData} user={user}
          />
        )}
        {view === "practice" && (
          <PracticeView
            user={user}
            tPlayers={tPlayers}
            courses={courses}
            notify={notify}
          />
        )}
        {view === "admin" && (
          <AdminView
            user={user}
            tPlayers={tPlayers}
            tRounds={enrichedRounds}
            courses={courses}
            matches={enrichedMatches}
            onAddPlayer={onAddPlayer}
            onUpdatePlayer={onUpdatePlayer}
            onRemovePlayer={onRemovePlayer}
            onAddCourse={onAddCourse}
            onSetRound={onSetRound}
            onSetMatch={onSetMatch}
            teamNames={teamNames}
            onSaveTeamNames={async (names) => {
              setTeamNames(names);
              await db.upsert("bc_settings", { id: "team_names", tournament_id: TOURNAMENT_ID, teamA: names.A, teamB: names.B });
            }}
            notify={notify}
          />
        )}
      </div>

      <SlideMenu open={menuOpen} onClose={() => setMenuOpen(false)} onNavigate={setView} onLogout={() => setUser(null)} user={user} view={view} darkMode={darkMode} onToggleTheme={toggleTheme} />

      {/* Bottom Nav */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: BC.card, borderTop: `1px solid ${BC.bdr}`, zIndex: 100, paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)" }}>
      <div style={{ maxWidth: 520, margin: "0 auto", display: "flex" }}>
        {navItems.map(item => {
          const active = view === item.key;
          const clr = active ? BC.amber : BC.t3;
          return (
            <button key={item.key} onClick={() => {
              if (item.key === "menu") { setMenuOpen(true); return; }
              setView(item.key);
            }} style={{
              flex: 1, padding: "8px 4px 10px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 3,
              background: "transparent", border: "none", cursor: "pointer", minHeight: 56,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 24 }}>
                {renderIcon(item.icon, active)}
              </div>
              <span style={{ fontSize: 9, fontWeight: active ? 700 : 500, color: clr, lineHeight: 1 }}>{item.label}</span>
              {active && <div style={{ width: 16, height: 2, borderRadius: 1, background: BC.amber, marginTop: 2 }} />}
            </button>
          );
        })}
      </div>
      </div>
      </div>
    </div>
  );
}
