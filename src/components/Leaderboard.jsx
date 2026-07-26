// ══════════════════════════════════════════════════════════════════
//  Leaderboard — the tournament scoreboard.
// ══════════════════════════════════════════════════════════════════
//  Replaces the old inline TeamLeaderboard/MatchScorecard that lived in
//  App.jsx. Structure follows the original Google-Sheet scoreboard the
//  Cup was run on for a decade — cup total on top, then round sections,
//  then one card per match with Front / Back / Overall and a hole strip
//  — but rebuilt for a phone.
//
//  Three ideas drive the layout:
//
//    1. ONE THING AT A TIME. Rounds are collapsible sections. A round
//       that has finished auto-collapses the moment a later round goes
//       live, so the screen is always focused on what's being played.
//       The collapsed bar still carries the round's point split, so
//       nothing is hidden — just folded.
//
//    2. POINTS ARE THE CURRENCY. Every level of the view answers "who
//       has how many, and how many are left": the cup bar up top, the
//       score split on each round bar, and a per-side points figure on
//       each match card.
//
//    3. PROGRESSIVE DETAIL. Collapsed match card = who, status, points,
//       hole strip. Tap it and the full net scorecard unfolds.
//
//  Everything here is presentational. All scoring math still comes from
//  scoring.js (computeMatchResult) — the only numbers computed locally
//  are display margins, which mirror calcSegment exactly.

import { useState, useMemo } from "react";
import { BC } from "../theme";
import {
  FORMATS, NASSAU_DEFAULT, DEFAULT_FORMAT,
  POINT_METHOD_TRADITIONAL, TROPHY_SILHOUETTE,
} from "../constants";
import { computeMatchResult, getRoundCourseCtx } from "../scoring";
import { isRoundFinal } from "../lib/roundLocks";

const FONT = "'Montserrat', sans-serif";
const ALL_ROUNDS = [1, 2, 3, 4];

// ── Small helpers ────────────────────────────────────────────────

// Points print without a pointless ".0" — 3 → "3", 3.5 → "3.5".
const fmtPts = (n) => (n == null ? "—" : Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

const teamHex = (tid) => (tid === "A" ? BC.teamA : BC.teamB);

// Max points on offer in a single match.
const matchPot = (m) => {
  if ((m.point_method || "") === POINT_METHOD_TRADITIONAL) return m.traditional_points ?? 1;
  const n = m.nassau || NASSAU_DEFAULT;
  return (n.front || 0) + (n.back || 0) + (n.overall || 0);
};

// Has every point in this match been decided? A match can be "closed out"
// (3&2) while a Nassau segment is still live, so the result being final and
// the POINTS being final are two different questions — this asks the second.
const matchSettled = (m, r) => {
  if ((m.scoring_type || "match") === "stroke") return r.holesPlayed === 18;
  if ((m.point_method || "") === POINT_METHOD_TRADITIONAL) return r.overall.complete;
  const n = m.nassau || NASSAU_DEFAULT;
  return (!n.front || r.front.complete) && (!n.back || r.back.complete) && (!n.overall || r.overall.complete);
};

// Player initials for the compact scorecard row labels ("Andy", "KJ" → "AK").
const initialsOf = (names) => {
  const list = (names || []).filter(Boolean);
  if (!list.length) return null;
  return list.map((n) => String(n).trim()[0]?.toUpperCase() || "?").join("");
};

// ── Segment state ────────────────────────────────────────────────
// Display-side mirror of scoring.js's calcSegment. The engine already
// hands us the awarded points; this only derives the human-readable
// margin ("2 UP", "3&2", "AS") and whether the segment is settled.
//
// `stroke` matches are settled on net stroke totals, not holes won, so
// the margin means something different — the caller passes the flag and
// the returned `unit` tells the renderer which noun to use.
function segState(holes, stroke) {
  const played = holes.filter((h) => h.played);
  if (stroke) {
    const complete = holes.every((h) => h.aScore != null && h.bScore != null);
    const aTot = played.reduce((s, h) => s + (h.aScore ?? 0), 0);
    const bTot = played.reduce((s, h) => s + (h.bScore ?? 0), 0);
    const margin = bTot - aTot; // > 0 → A has fewer strokes → A leads
    return {
      complete, played: played.length, total: holes.length, remaining: holes.length - played.length,
      margin, clinched: false, unit: "stk",
      winner: complete ? (margin > 0 ? "A" : margin < 0 ? "B" : null) : null,
    };
  }
  const aW = played.filter((h) => h.winner === "A").length;
  const bW = played.filter((h) => h.winner === "B").length;
  const margin = aW - bW;
  const remaining = holes.length - played.length;
  const clinched = Math.abs(margin) > remaining && played.length > 0;
  return {
    complete: (played.length === holes.length && played.length > 0) || clinched,
    played: played.length, total: holes.length, remaining, margin, clinched, unit: "up",
    winner: clinched ? (margin > 0 ? "A" : "B") : played.length === holes.length && played.length > 0 ? (margin > 0 ? "A" : margin < 0 ? "B" : null) : null,
  };
}

// Golf-native result text. "3&2" when a match closes early, "2 UP" when
// it goes the distance, "AS" for all square, "—" before a ball is struck.
function statusText(st) {
  if (!st.played) return "—";
  const m = Math.abs(st.margin);
  if (st.unit === "stk") return m === 0 ? "TIED" : `${m} STK`;
  if (st.clinched && st.remaining > 0) return `${m}&${st.remaining}`;
  if (m === 0) return "AS";
  return `${m} UP`;
}

// ── Segment pill ─────────────────────────────────────────────────
// One of FRONT / BACK / OVERALL (or a single MATCH pill in Traditional).
// Settled segments fill with the winning team's color and show the points
// won; live segments stay hollow and show the running margin.
function SegmentPill({ label, pot, st, pts, bonus }) {
  const settled = st.complete;
  const halved = settled && !st.winner;
  const win = st.winner;
  const awarded = (pts?.A || 0) + (pts?.B || 0);
  const shown = settled ? (halved ? "½ – ½" : `${fmtPts(win === "A" ? pts.A : pts.B)}`) : statusText(st);
  const color = win ? teamHex(win) : BC.t2;

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{
        fontSize: 8, letterSpacing: 1, fontWeight: 800, color: BC.t3,
        textAlign: "center", marginBottom: 3, whiteSpace: "nowrap",
      }}>
        {label}{pot ? ` · ${fmtPts(pot)}` : ""}
      </div>
      <div style={{
        textAlign: "center", padding: "5px 2px", borderRadius: 7,
        fontSize: 12, fontWeight: 800, lineHeight: 1.1,
        background: settled && win ? `${color}26` : "transparent",
        border: `1px ${settled ? "solid" : "dashed"} ${settled ? (win ? `${color}66` : BC.bdr) : `${BC.bdr}`}`,
        color: settled ? (halved ? BC.t2 : color) : st.played ? color : BC.t3,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>
        {shown}
        {bonus && settled && awarded > pot && (
          <span style={{ fontSize: 8, marginLeft: 3, color: BC.amber, letterSpacing: 0.5 }}>+DD</span>
        )}
      </div>
    </div>
  );
}

// ── Hole strip ───────────────────────────────────────────────────
// 18 cells, one per hole, colored by who won it. A visible gap splits
// the front from the back so "thru 12" is readable without counting.
function HoleStrip({ holes, showNumbers = false }) {
  const cell = (h, i) => {
    const bg = !h.played
      ? "transparent"
      : h.winner === "A" ? BC.teamA
      : h.winner === "B" ? BC.teamB
      : `${BC.t3}55`;
    return (
      <div key={i} style={{
        flex: 1, minWidth: 0, height: 9, borderRadius: 2, background: bg,
        border: h.played ? "none" : `1px solid ${BC.bdr}`,
        boxSizing: "border-box",
      }} />
    );
  };
  const nums = (start, end) => (
    <div style={{ display: "flex", gap: 1.5, flex: 1, minWidth: 0 }}>
      {holes.slice(start, end).map((_, i) => (
        <div key={i} style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 7, color: BC.t3, fontWeight: 700 }}>
          {start + i + 1}
        </div>
      ))}
    </div>
  );

  return (
    <div>
      {showNumbers && (
        <div style={{ display: "flex", gap: 8, marginBottom: 2 }}>
          {nums(0, 9)}{nums(9, 18)}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ display: "flex", gap: 1.5, flex: 1, minWidth: 0 }}>{holes.slice(0, 9).map(cell)}</div>
        <div style={{ display: "flex", gap: 1.5, flex: 1, minWidth: 0 }}>{holes.slice(9, 18).map(cell)}</div>
      </div>
    </div>
  );
}

// ── Status chip ──────────────────────────────────────────────────
function Chip({ text, color = BC.t3, filled = false }) {
  return (
    <span style={{
      fontSize: 8, fontWeight: 800, letterSpacing: 1, padding: "2px 6px",
      borderRadius: 4, whiteSpace: "nowrap",
      background: filled ? color : `${color}1f`,
      color: filled ? "#0a0804" : color,
    }}>
      {text}
    </span>
  );
}

// ── One side of a match ──
// Colored rail, the player name(s), and the points that side has banked.
// The leading side gets the brighter, heavier name treatment.
function MatchSide({ tid, names, pts, align, isLeader }) {
  const color = teamHex(tid);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      flexDirection: align === "right" ? "row-reverse" : "row",
      flex: 1, minWidth: 0,
    }}>
      <div style={{ width: 3, alignSelf: "stretch", borderRadius: 2, background: color, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0, textAlign: align }}>
        {names.map((nm, i) => (
          <div key={i} style={{
            fontSize: 13, fontWeight: isLeader ? 800 : 600,
            color: isLeader ? BC.t1 : BC.t2, lineHeight: 1.35,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>{nm}</div>
        ))}
      </div>
      <div style={{ flexShrink: 0, textAlign: align, minWidth: 26 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: pts > 0 ? color : BC.t3, lineHeight: 1 }}>
          {fmtPts(pts)}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  Match card
// ══════════════════════════════════════════════════════════════════
function MatchCard({
  index, match, result, format, teams, tPlayers,
  courses, tRounds, roundLocks, expanded, onToggle,
}) {
  const stroke = (match.scoring_type || "match") === "stroke";
  const traditional = (match.point_method || "") === POINT_METHOD_TRADITIONAL;
  const n = match.nassau || NASSAU_DEFAULT;

  const overallSt = segState(result.holes, stroke);
  const nameOf = (pid) => tPlayers.find((p) => p.player_id === pid)?.name || pid;
  const aNames = (match.teamA || []).map(nameOf);
  const bNames = (match.teamB || []).map(nameOf);

  const ptsA = result.totalPts.A, ptsB = result.totalPts.B;
  const leader = overallSt.margin > 0 ? "A" : overallSt.margin < 0 ? "B" : null;
  const done = matchSettled(match, result);

  const segments = traditional
    ? [{ key: "o", label: "MATCH", pot: match.traditional_points ?? 1, st: overallSt, pts: result.overallPts }]
    : [
        n.front ? { key: "f", label: "FRONT", pot: n.front, st: segState(result.holes.slice(0, 9), stroke), pts: result.frontPts } : null,
        n.back ? { key: "b", label: "BACK", pot: n.back, st: segState(result.holes.slice(9, 18), stroke), pts: result.backPts } : null,
        n.overall ? { key: "o", label: "OVERALL", pot: n.overall, st: overallSt, pts: result.overallPts, bonus: format === "double_dot" } : null,
      ].filter(Boolean);

  return (
    <div style={{
      background: BC.card, borderRadius: 12, marginBottom: 8, overflow: "hidden",
      border: `1px solid ${expanded ? `${BC.amber}55` : BC.bdr}`,
    }}>
      <button onClick={onToggle} style={{
        width: "100%", padding: "10px 12px", background: "transparent",
        border: "none", cursor: "pointer", textAlign: "left", display: "block", fontFamily: FONT,
      }}>
        {/* Header line — match number, format note, progress */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: BC.t3 }}>
            MATCH {index + 1}
          </span>
          {match.teeTime && <span style={{ fontSize: 9, color: BC.t3 }}>· {match.teeTime}</span>}
          <span style={{ flex: 1 }} />
          {done
            ? <Chip text="FINAL" color={BC.t2} />
            : <span style={{ fontSize: 9, fontWeight: 700, color: BC.t3, letterSpacing: 0.5 }}>
                {result.holesPlayed ? `THRU ${result.holesPlayed}` : "NOT STARTED"}
              </span>}
          <span style={{ fontSize: 10, color: BC.t3, marginLeft: 2 }}>{expanded ? "▴" : "▾"}</span>
        </div>

        {/* Names + status */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <MatchSide tid="A" names={aNames} pts={ptsA} align="left" isLeader={leader === "A"} />
          <div style={{
            flexShrink: 0, minWidth: 58, textAlign: "center", padding: "5px 6px",
            borderRadius: 8, background: leader ? `${teamHex(leader)}1f` : BC.inp,
            border: `1px solid ${leader ? `${teamHex(leader)}55` : BC.bdr}`,
          }}>
            <div style={{
              fontSize: 13, fontWeight: 800, lineHeight: 1.1,
              color: leader ? teamHex(leader) : BC.t2,
            }}>
              {statusText(overallSt)}
            </div>
          </div>
          <MatchSide tid="B" names={bNames} pts={ptsB} align="right" isLeader={leader === "B"} />
        </div>

        {/* Front / Back / Overall */}
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          {segments.map((s) => (
            <SegmentPill key={s.key} label={s.label} pot={s.pot} st={s.st} pts={s.pts} bonus={s.bonus} />
          ))}
        </div>

        {/* Hole-by-hole */}
        <div style={{ marginTop: 9 }}>
          <HoleStrip holes={result.holes} />
        </div>
      </button>

      {expanded && (
        <div style={{ borderTop: `1px solid ${BC.bdr}`, background: BC.bg }}>
          <MatchScorecard
            match={match} result={result} format={format}
            courses={courses} tRounds={tRounds} teams={teams} roundLocks={roundLocks}
          />
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  Round section
// ══════════════════════════════════════════════════════════════════
function RoundSection({
  round, meta, results, open, onToggle, teams, tPlayers,
  courses, tRounds, roundLocks, expandedMatch, setExpandedMatch,
}) {
  const { course, fmt, tee, pts, avail, state } = meta;
  const stateChip =
    state === "live" ? <Chip text="LIVE" color={BC.amber} filled />
    : state === "final" ? <Chip text="FINAL" color={BC.t2} />
    : <Chip text="UPCOMING" color={BC.t3} />;

  return (
    <div style={{
      background: BC.card, borderRadius: 12, marginBottom: 10, overflow: "hidden",
      border: `1px solid ${state === "live" ? `${BC.amber}44` : BC.bdr}`,
    }}>
      <button onClick={onToggle} style={{
        width: "100%", padding: "11px 12px", background: state === "live" ? `${BC.amber}0f` : "transparent",
        border: "none", cursor: "pointer", textAlign: "left", display: "block", fontFamily: FONT,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 10, color: BC.t3, width: 10, flexShrink: 0 }}>{open ? "▾" : "▸"}</span>
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.2, color: BC.t1 }}>ROUND {round}</span>
          {stateChip}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 15, fontWeight: 800, color: pts.A >= pts.B ? BC.teamA : `${BC.teamA}99` }}>{fmtPts(pts.A)}</span>
          <span style={{ fontSize: 11, color: BC.t3 }}>–</span>
          <span style={{ fontSize: 15, fontWeight: 800, color: pts.B >= pts.A ? BC.teamB : `${BC.teamB}99` }}>{fmtPts(pts.B)}</span>
        </div>
        <div style={{
          fontSize: 10, color: BC.t3, marginTop: 3, paddingLeft: 17,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {[course?.name || "Course TBD", tee, fmt?.label].filter(Boolean).join(" · ")}
          {avail ? ` · ${fmtPts(avail - pts.A - pts.B)} pts left` : ""}
        </div>
      </button>

      {open && (
        <div style={{ padding: "0 8px 8px" }}>
          {results.length === 0 ? (
            <div style={{ padding: "16px 0", textAlign: "center", color: BC.t3, fontSize: 11 }}>
              No matches set up for this round.
            </div>
          ) : results.map(({ match: m, result: r, format }, i) => (
            <MatchCard
              key={m.id}
              index={i}
              match={m}
              result={r}
              format={format}
              teams={teams}
              tPlayers={tPlayers}
              courses={courses}
              tRounds={tRounds}
              roundLocks={roundLocks}
              expanded={expandedMatch === m.id}
              onToggle={() => setExpandedMatch(expandedMatch === m.id ? null : m.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  TeamLeaderboard
// ══════════════════════════════════════════════════════════════════
export function TeamLeaderboard({
  matches, holeData, courses, tRounds, tPlayers, rounds, teams,
  hcpOverrides, teeAssignments, roundLocks,
}) {
  const [expandedMatch, setExpandedMatch] = useState(null);
  // Round open/closed. Absent key = follow the automatic rule below;
  // a tap writes an explicit override so the user always wins.
  const [openOverrides, setOpenOverrides] = useState({});

  const { A: tA, B: tB } = teams;

  // Every match scored once, reused by the cup bar, the round bars and
  // the match cards.
  const matchResults = useMemo(() => matches.map((m) => {
    const fmt = tRounds.find((t) => t.round_number === m.round)?.format || DEFAULT_FORMAT;
    const res = computeMatchResult(m, holeData, courses, tRounds, tPlayers, fmt, hcpOverrides, undefined, teeAssignments, roundLocks);
    return { match: m, result: res, format: fmt };
  }), [matches, holeData, courses, tRounds, tPlayers, hcpOverrides, teeAssignments, roundLocks]);

  const roundNumbers = useMemo(
    () => ALL_ROUNDS.filter((r) => matches.some((m) => m.round === r)),
    [matches]
  );

  // Per-round rollup: points, points on offer, and play state.
  const roundMeta = useMemo(() => {
    const out = {};
    roundNumbers.forEach((rnd) => {
      const results = matchResults.filter((mr) => mr.match.round === rnd);
      const pts = { A: 0, B: 0 };
      let avail = 0, holesPlayed = 0;
      results.forEach(({ match: m, result: r }) => {
        pts.A += r.totalPts.A; pts.B += r.totalPts.B;
        avail += matchPot(m);
        holesPlayed += r.holesPlayed;
      });
      // Double Dot bonuses can push awarded past the base pot — the pot
      // is a floor, never a ceiling.
      avail = Math.max(avail, pts.A + pts.B);
      const { tr, course } = getRoundCourseCtx({ roundLocks, round: rnd, tRounds, courses });
      const settled = results.length > 0
        && (isRoundFinal(roundLocks, rnd) || results.every(({ match: m, result: r }) => matchSettled(m, r)));
      out[rnd] = {
        results, pts, avail, holesPlayed, course,
        tee: tr?.tee_box || null,
        fmt: FORMATS.find((f) => f.id === tr?.format) || null,
        state: settled ? "final" : holesPlayed > 0 ? "live" : "upcoming",
      };
    });
    return out;
  }, [roundNumbers, matchResults, tRounds, courses, roundLocks]);

  // Which rounds open by default: every live round. With nothing live,
  // fall back to the furthest round that has been played (so a finished
  // tournament opens on the last round) or the first scheduled round.
  const defaultOpen = useMemo(() => {
    const live = roundNumbers.filter((r) => roundMeta[r].state === "live");
    if (live.length) return new Set(live);
    const played = roundNumbers.filter((r) => roundMeta[r].holesPlayed > 0);
    if (played.length) return new Set([played[played.length - 1]]);
    return new Set(roundNumbers.slice(0, 1));
  }, [roundNumbers, roundMeta]);

  // Cup totals.
  const totals = useMemo(() => {
    const t = { A: 0, B: 0 };
    matchResults.forEach(({ result }) => { t.A += result.totalPts.A; t.B += result.totalPts.B; });
    return t;
  }, [matchResults]);

  const totalAvail = useMemo(
    () => Math.max(matches.reduce((s, m) => s + matchPot(m), 0), totals.A + totals.B),
    [matches, totals]
  );
  const toWin = totalAvail ? totalAvail / 2 + 0.5 : 0;
  const remaining = Math.max(0, totalAvail - totals.A - totals.B);
  const clincher = totals.A >= toWin ? "A" : totals.B >= toWin ? "B" : null;

  const pct = (v) => (totalAvail ? Math.min(100, (v / totalAvail) * 100) : 0);

  if (roundNumbers.length === 0) {
    return (
      <div style={{
        fontFamily: FONT, display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", minHeight: "calc(100svh - 250px)", textAlign: "center",
        padding: "0 24px", gap: 10,
      }}>
        <div style={{
          width: 40, height: 40, background: BC.amber,
          WebkitMask: `url(${TROPHY_SILHOUETTE}) center/contain no-repeat`,
          mask: `url(${TROPHY_SILHOUETTE}) center/contain no-repeat`,
          opacity: 0.3,
        }} />
        <div style={{ fontSize: 15, fontWeight: 700, color: BC.t1, letterSpacing: 0.3 }}>No matches yet</div>
        <div style={{ fontSize: 12, color: BC.t3, maxWidth: 260, lineHeight: 1.5 }}>
          Matches will appear here once the tournament schedule is set.
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: FONT }}>
      {/* ── Cup total ──
          Team names, the two totals in team colors, and a single bar
          that fills inward from both edges. The tick in the middle is
          the clinch line, so "who's actually winning" is one glance. */}
      <div style={{
        background: BC.card, borderRadius: 14, border: `1px solid ${BC.bdr}`,
        padding: "13px 14px 12px", marginBottom: 12,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 10, fontWeight: 800, letterSpacing: 0.8, color: BC.teamA,
              textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>{tA.name}</div>
            <div style={{ fontSize: 32, fontWeight: 800, color: BC.teamA, lineHeight: 1.1, marginTop: 1 }}>
              {fmtPts(totals.A)}
            </div>
          </div>
          <div style={{ textAlign: "center", flexShrink: 0, paddingTop: 6 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: BC.t1, lineHeight: 1 }}>{fmtPts(toWin)}</div>
            <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: 1, color: BC.t3, marginTop: 3 }}>TO WIN</div>
          </div>
          <div style={{ flex: 1, minWidth: 0, textAlign: "right" }}>
            <div style={{
              fontSize: 10, fontWeight: 800, letterSpacing: 0.8, color: BC.teamB,
              textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>{tB.name}</div>
            <div style={{ fontSize: 32, fontWeight: 800, color: BC.teamB, lineHeight: 1.1, marginTop: 1 }}>
              {fmtPts(totals.B)}
            </div>
          </div>
        </div>

        <div style={{
          position: "relative", height: 10, borderRadius: 5,
          background: BC.inp, overflow: "hidden", marginTop: 10,
        }}>
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct(totals.A)}%`, background: BC.teamA }} />
          <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: `${pct(totals.B)}%`, background: BC.teamB }} />
          <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 2, marginLeft: -1, background: BC.bg, opacity: 0.9 }} />
        </div>

        <div style={{ textAlign: "center", marginTop: 7, fontSize: 9, fontWeight: 700, letterSpacing: 1, color: BC.t3 }}>
          {clincher
            ? <span style={{ color: teamHex(clincher) }}>
                {(clincher === "A" ? tA.name : tB.name).toUpperCase()} WIN THE CUP
              </span>
            : `${fmtPts(remaining)} OF ${fmtPts(totalAvail)} POINTS REMAINING`}
        </div>
      </div>

      {/* ── Rounds ── */}
      {roundNumbers.map((rnd) => (
        <RoundSection
          key={rnd}
          round={rnd}
          meta={roundMeta[rnd]}
          results={roundMeta[rnd].results}
          open={openOverrides[rnd] ?? defaultOpen.has(rnd)}
          onToggle={() => setOpenOverrides((p) => ({ ...p, [rnd]: !(p[rnd] ?? defaultOpen.has(rnd)) }))}
          teams={teams}
          tPlayers={tPlayers}
          courses={courses}
          tRounds={tRounds}
          roundLocks={roundLocks}
          expandedMatch={expandedMatch}
          setExpandedMatch={setExpandedMatch}
        />
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  MatchScorecard — the expanded detail
// ══════════════════════════════════════════════════════════════════
//  Also mounted standalone from the Score Entry "Full Scorecard" modal,
//  so it stays self-sufficient: it re-resolves its own course context
//  (honouring a round lock's frozen hole tables when one exists).
//
//  Rows per nine: HOLE / PAR / team A net / team B net / running match
//  state. Net scores are what the match was actually decided on, so
//  those are what get shown — the winning side's cell is tinted.
export function MatchScorecard({ match, result, format, courses, tRounds, teams, roundLocks }) {
  const { course, holePars } = getRoundCourseCtx({ roundLocks, round: match.round, tRounds, courses });
  const stroke = (match.scoring_type || "match") === "stroke";
  const holes = result.holes;

  const aLabel = initialsOf(match.teamANames) || teams.A.short || "A";
  const bLabel = initialsOf(match.teamBNames) || teams.B.short || "B";

  const nine = (start, end, label) => {
    const slice = holes.slice(start, end);
    const parTotal = holePars.slice(start, end).reduce((a, b) => a + b, 0);
    const aTot = slice.reduce((s, h) => s + (h.aScore ?? 0), 0);
    const bTot = slice.reduce((s, h) => s + (h.bScore ?? 0), 0);
    const aWon = slice.filter((h) => h.winner === "A").length;
    const bWon = slice.filter((h) => h.winner === "B").length;

    // Running margin from A's perspective, cumulative from hole 1.
    const running = [];
    let m = 0;
    holes.forEach((h, i) => {
      if (h.winner === "A") m += 1; else if (h.winner === "B") m -= 1;
      running[i] = h.played ? m : null;
    });

    const cellBase = {
      textAlign: "center", fontSize: 10, fontWeight: 700, padding: "3px 0",
      borderRadius: 4, lineHeight: 1.2,
    };
    const lab = { fontSize: 8, fontWeight: 800, letterSpacing: 0.5, color: BC.t3, display: "flex", alignItems: "center" };

    return (
      <div style={{ marginBottom: 10 }}>
        <div style={{
          fontSize: 8, fontWeight: 800, letterSpacing: 1.4, color: BC.t3, marginBottom: 4,
        }}>{label}</div>
        <div style={{ display: "grid", gridTemplateColumns: `26px repeat(${end - start}, 1fr) 26px`, gap: 2 }}>
          {/* Hole numbers */}
          <div />
          {slice.map((_, i) => (
            <div key={`h${i}`} style={{ ...cellBase, fontSize: 8, color: BC.t3, fontWeight: 800 }}>{start + i + 1}</div>
          ))}
          <div style={{ ...cellBase, fontSize: 8, color: BC.t3, fontWeight: 800 }}>{start === 0 ? "OUT" : "IN"}</div>

          {/* Par */}
          <div style={lab}>PAR</div>
          {slice.map((_, i) => (
            <div key={`p${i}`} style={{ ...cellBase, fontSize: 9, color: BC.t3, fontWeight: 600 }}>{holePars[start + i]}</div>
          ))}
          <div style={{ ...cellBase, fontSize: 9, color: BC.t3, fontWeight: 700 }}>{parTotal}</div>

          {/* Team A nets */}
          <div style={{ ...lab, color: BC.teamA }}>{aLabel}</div>
          {slice.map((h, i) => (
            <div key={`a${i}`} style={{
              ...cellBase,
              color: h.winner === "A" ? BC.teamA : h.aScore == null ? BC.t3 : BC.t2,
              background: h.winner === "A" ? `${BC.teamA}26` : "transparent",
            }}>{h.aScore ?? "·"}</div>
          ))}
          <div style={{ ...cellBase, color: BC.teamA }}>{stroke ? aTot || "·" : aWon}</div>

          {/* Team B nets */}
          <div style={{ ...lab, color: BC.teamB }}>{bLabel}</div>
          {slice.map((h, i) => (
            <div key={`b${i}`} style={{
              ...cellBase,
              color: h.winner === "B" ? BC.teamB : h.bScore == null ? BC.t3 : BC.t2,
              background: h.winner === "B" ? `${BC.teamB}26` : "transparent",
            }}>{h.bScore ?? "·"}</div>
          ))}
          <div style={{ ...cellBase, color: BC.teamB }}>{stroke ? bTot || "·" : bWon}</div>

          {/* Running match state */}
          {!stroke && <div style={lab}>MTCH</div>}
          {!stroke && slice.map((h, i) => {
            const v = running[start + i];
            return (
              <div key={`m${i}`} style={{
                ...cellBase, fontSize: 8, fontWeight: 800,
                color: v == null ? BC.t3 : v > 0 ? BC.teamA : v < 0 ? BC.teamB : BC.t3,
              }}>{v == null ? "" : v === 0 ? "AS" : Math.abs(v)}</div>
            );
          })}
          {!stroke && <div />}
        </div>
      </div>
    );
  };

  // Double Dot side note — the bonus point for the last three holes.
  const dd = format === "double_dot" ? segState(holes.slice(15, 18), false) : null;

  return (
    <div style={{ padding: "12px 12px 14px", fontFamily: FONT }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: BC.teamA, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {(match.teamANames || []).join(" / ")}
        </span>
        <span style={{ fontSize: 9, color: BC.t3, flexShrink: 0 }}>vs</span>
        <span style={{ fontSize: 10, fontWeight: 800, color: BC.teamB, textAlign: "right", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {(match.teamBNames || []).join(" / ")}
        </span>
      </div>

      <div style={{ fontSize: 9, color: BC.t3, marginBottom: 10 }}>
        {[course?.name, FORMATS.find((f) => f.id === format)?.label, "net scores"].filter(Boolean).join(" · ")}
      </div>

      {nine(0, 9, "FRONT NINE")}
      {nine(9, 18, "BACK NINE")}

      {dd && (
        <div style={{
          marginTop: 2, padding: "7px 10px", borderRadius: 8,
          background: `${BC.amber}14`, border: `1px solid ${BC.amber}33`,
          fontSize: 10, color: BC.t2, display: "flex", alignItems: "center", gap: 6,
        }}>
          <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 1, color: BC.amber }}>DOUBLE DOT</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontWeight: 700, color: dd.winner ? teamHex(dd.winner) : BC.t3 }}>
            {!dd.played ? "holes 16–18 to play"
              : !dd.complete ? `${statusText(dd)} thru ${15 + dd.played}`
              : dd.winner ? `+1 pt · ${dd.winner === "A" ? teams.A.name : teams.B.name}`
              : "halved · no bonus"}
          </span>
        </div>
      )}
    </div>
  );
}

export default TeamLeaderboard;
