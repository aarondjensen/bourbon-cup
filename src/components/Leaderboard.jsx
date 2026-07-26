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
//  Everything here is presentational. Every number comes from scoring.js —
//  computeMatchResult for the points, segmentState/statusText for the
//  margins. Nothing about a result is worked out locally, so this screen
//  cannot describe a match differently from how it was scored, or from how
//  the Scoring tab describes the same match.

import { useState, useMemo } from "react";
import { BC, ink, teamColor } from "../theme";
import {
  FORMATS, NASSAU_DEFAULT, DEFAULT_FORMAT,
  POINT_METHOD_TRADITIONAL, TROPHY_SILHOUETTE, CUP_POINTS_TO_WIN,
} from "../constants";
import {
  computeMatchResult, getRoundCourseCtx, higherIsBetter, totalUnit,
  segmentState, statusText, segmentLeader,
} from "../scoring";
import { HoleStrip } from "./HoleStrip";
import { isRoundFinal } from "../lib/roundLocks";

const FONT = "'Montserrat', sans-serif";
const ALL_ROUNDS = [1, 2, 3, 4];

// ── Small helpers ────────────────────────────────────────────────

// Points print without a pointless ".0" — 3 → "3", 3.5 → "3.5".
const fmtPts = (n) => (n == null ? "—" : Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

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

// Segment state and its result text now come from scoring.js — the same
// segmentState() the engine awards points from, so what this screen prints
// and what the match banked can't disagree. `segOpts` builds the flags that
// tell it how the round is settled.
const segOpts = (m, format) => ({
  total: (m.scoring_type || "match") === "stroke",
  higherWins: higherIsBetter(format),
});

// ── Pending points ───────────────────────────────────────────────
// What a match is currently ON COURSE to award: for every segment that has
// started but hasn't settled, hand its pot to whoever leads it right now,
// splitting it on a tie. computeMatchResult only banks a segment's points
// once it's decided, so these are exactly the points in flight.
//
// A segment nobody has teed off on is deliberately NOT projected — there's
// nothing to project from, and calling an untouched match a ½/½ split would
// dress up "no data" as a forecast. Those points stay simply unplayed.
function pendingPts(m, r, format) {
  const out = { A: 0, B: 0 };
  const opts = segOpts(m, format);
  const add = (holes, pot) => {
    if (!pot) return;
    const st = segmentState(holes, opts);
    if (st.complete || !st.played) return;
    if (st.margin > 0) out.A += pot;
    else if (st.margin < 0) out.B += pot;
    else { out.A += pot / 2; out.B += pot / 2; }
  };
  if ((m.point_method || "") === POINT_METHOD_TRADITIONAL) {
    add(r.holes, m.traditional_points ?? 1);
  } else {
    const n = m.nassau || NASSAU_DEFAULT;
    add(r.holes.slice(0, 9), n.front);
    add(r.holes.slice(9, 18), n.back);
    add(r.holes, n.overall);
  }
  return out;
}

// ── Segment pill ─────────────────────────────────────────────────
// One of FRONT / BACK / OVERALL (or a single MATCH pill in Traditional).
// Settled segments fill with the winning team's color and show the points
// won; live segments stay hollow and show the running margin.
function SegmentPill({ label, pot, st, pts }) {
  const settled = st.complete;
  const halved = settled && !st.winner;
  const win = st.winner;
  const shown = settled ? (halved ? "½ – ½" : `${fmtPts(win === "A" ? pts.A : pts.B)}`) : statusText(st);
  const color = win ? teamColor(win) : BC.t2;

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
      </div>
    </div>
  );
}

// ── Pending marker position ──────────────────────────────────────
// Where the "+N" sits: the midpoint of that side's faded bar segment,
// measured from its own edge of the bar. Clamped so a very small segment
// (or one starting near the far end) still keeps its label on the card.
const markerPct = (offset, width) => Math.min(94, Math.max(6, offset + width / 2));

// ── One team's column in a collapsed match row ──
// The pair's names stack vertically on their own side of the row, with the
// team's color as a rail on the OUTER edge — so the two rails bracket the
// score sitting between them. That's deliberately the same left/right
// geometry as the cup total card at the top of the board: team A is always
// the left column, team B always the right, in every match of every round.
// A player is therefore always found on their own team's side of the screen,
// and "which side am I reading?" never has to be re-answered per row.
//
// The leading side gets the brighter, heavier treatment; the trailing side
// stays grey. That's the whole leader signal — no tint, no pill.
function MatchTeamColumn({ tid, names, isLeader, settled }) {
  const left = tid === "A";
  const railColor = ink(teamColor(tid), settled);
  const rail = left
    ? { borderLeft: `3px solid ${railColor}`, paddingLeft: 8 }
    : { borderRight: `3px solid ${railColor}`, paddingRight: 8 };
  return (
    <div style={{
      minWidth: 0, display: "flex", flexDirection: "column", gap: 2,
      textAlign: left ? "left" : "right", ...rail,
    }}>
      {names.map((nm, i) => (
        <div key={i} style={{
          fontSize: 13, fontWeight: isLeader ? 700 : 600,
          color: isLeader ? BC.t1 : BC.t2, lineHeight: 1.3,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{nm}</div>
      ))}
    </div>
  );
}

// ── Per-nine result, flanking the overall on a Nassau round ──
// Two lines so it sits on the same rhythm as the centre column it flanks:
// the nine's name over its match state. Colored in the leading team's hue,
// which is what ties it to a side — it sits between the two name columns,
// so it must not be readable as belonging to whichever one it's nearer.
// Each nine carries its OWN settled state, not the match's — a front nine
// can be in the books while the back is still being played, and that's
// precisely the distinction worth drawing here.
const nineColor = (st) => {
  const lead = segmentLeader(st);
  return ink(lead ? teamColor(lead) : st.played ? BC.t2 : BC.t3, st.complete);
};

// Cells of the centre cluster. minWidth on each keeps the columns from
// jumping as the text inside changes width ("AS" → "3&2" → "—"); lineHeight
// is pinned to 1 so the two rows sit a predictable distance apart once the
// grid has aligned them on their baselines.
const NINE_LABEL = {
  fontSize: 8, fontWeight: 800, letterSpacing: 0.6, color: BC.t3,
  lineHeight: 1, minWidth: 24, textAlign: "center",
};
const NINE_VALUE = {
  fontSize: 11, fontWeight: 800, lineHeight: 1, whiteSpace: "nowrap",
  minWidth: 24, textAlign: "center",
};

// ══════════════════════════════════════════════════════════════════
//  Match card
// ══════════════════════════════════════════════════════════════════
function MatchCard({
  index, first, match, result, format, teams, tPlayers,
  courses, tRounds, roundLocks, expanded, onToggle,
}) {
  const total = (match.scoring_type || "match") === "stroke";
  const opts = segOpts(match, format);
  const traditional = (match.point_method || "") === POINT_METHOD_TRADITIONAL;
  const n = match.nassau || NASSAU_DEFAULT;

  const overallSt = segmentState(result.holes, opts);
  const nameOf = (pid) => tPlayers.find((p) => p.player_id === pid)?.name || pid;
  const aNames = (match.teamA || []).map(nameOf);
  const bNames = (match.teamB || []).map(nameOf);

  const ptsA = result.totalPts.A, ptsB = result.totalPts.B;
  const leader = segmentLeader(overallSt);
  const done = matchSettled(match, result);

  // Per-nine state, computed once and shared by the collapsed row's F9/B9
  // flanks and the expanded segment pills — so the two can never disagree.
  const frontSt = segmentState(result.holes.slice(0, 9), opts);
  const backSt = segmentState(result.holes.slice(9, 18), opts);

  const segments = traditional
    ? [{ key: "o", label: "MATCH", pot: match.traditional_points ?? 1, st: overallSt, pts: result.overallPts }]
    : [
        n.front ? { key: "f", label: "FRONT", pot: n.front, st: frontSt, pts: result.frontPts } : null,
        n.back ? { key: "b", label: "BACK", pot: n.back, st: backSt, pts: result.backPts } : null,
        n.overall ? { key: "o", label: "OVERALL", pot: n.overall, st: overallSt, pts: result.overallPts } : null,
      ].filter(Boolean);

  // In a Nassau round the front and back nines are matches in their own
  // right, each carrying its own point, so the collapsed row shows all
  // three results: F9 to the left of the overall, B9 to the right. A nine
  // with no point on it isn't being played as a match and stays hidden, and
  // a Traditional round has only the single pot — so neither flank appears.
  const showFront = !traditional && n.front > 0;
  const showBack = !traditional && n.back > 0;

  // A completed match that finished level is a HALVE, worth a half point to
  // each side. statusText would call that "AS", which reads as a live state —
  // "½" says it's over and how it was settled. Total matches keep their own
  // "TIED" wording, so this only applies to match play.
  const halved = done && !total && overallSt.margin === 0;
  const statusLabel = halved ? "½" : statusText(overallSt);
  const statusBase = leader ? teamColor(leader) : overallSt.played ? BC.t2 : BC.t3;
  const statusColor = ink(statusBase, done);
  // Sub-line under the status. An unplayed match has no progress to report,
  // so it shows its tee time instead — the only thing about it that's news.
  const subLabel = done ? "FINAL"
    : result.holesPlayed ? `THRU ${result.holesPlayed}`
    : match.teeTime || "—";

  return (
    <div style={{
      borderTop: first ? "none" : `1px solid ${BC.bdr}66`,
      background: expanded ? `${BC.amber}0a` : "transparent",
    }}>
      <button onClick={onToggle} style={{
        width: "100%", padding: "9px 12px 10px", background: "transparent",
        border: "none", cursor: "pointer", textAlign: "left", display: "block", fontFamily: FONT,
      }}>
        {/* Team A | status | team B — the cup card's geometry, one row down.
            `1fr auto 1fr` keeps the centre column exactly as wide as its
            content, so the two name columns stay equal to each other no
            matter how long the status text gets. */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 9 }}>
          <MatchTeamColumn tid="A" names={aNames} isLeader={leader === "A"} settled={done} />
          {/* F9 · overall · B9 as a real two-row grid rather than three
              self-contained stacks. `alignItems: baseline` makes each row
              sit on one shared baseline, so F9 / status / B9 line up along
              the bottoms of their text despite the 8px-vs-17px size gap,
              and the same for the per-nine results against THRU below.
              Column count follows what's actually shown, so a Traditional
              round collapses to the single centre column. The tighter
              internal gap groups the three as one cluster, so they read
              together rather than drifting toward whichever name column
              each one happens to sit near. */}
          <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(${1 + (showFront ? 1 : 0) + (showBack ? 1 : 0)}, auto)`,
            alignItems: "baseline", justifyItems: "center",
            columnGap: 7, rowGap: 3,
          }}>
            {/* Top row — the three match states. */}
            {showFront && <div style={NINE_LABEL}>F9</div>}
            <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1, minWidth: 52, textAlign: "center", color: statusColor }}>
              {statusLabel}
            </div>
            {showBack && <div style={NINE_LABEL}>B9</div>}

            {/* Bottom row — each one's detail, directly beneath it. The
                chevron rides on THRU rather than taking a row of its own,
                so the expand affordance costs no vertical space. */}
            {showFront && <div style={{ ...NINE_VALUE, color: nineColor(frontSt) }}>{statusText(frontSt)}</div>}
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.9, lineHeight: 1, minWidth: 52, textAlign: "center", color: BC.t3 }}>
              {subLabel} {expanded ? "▴" : "▾"}
            </div>
            {showBack && <div style={{ ...NINE_VALUE, color: nineColor(backSt) }}>{statusText(backSt)}</div>}
          </div>
          <MatchTeamColumn tid="B" names={bNames} isLeader={leader === "B"} settled={done} />
        </div>

        {/* Hole-by-hole — the match's shape, on its own line at full width. */}
        <div style={{ marginTop: 8 }}>
          <HoleStrip holes={result.holes} format={format} settled={done} />
        </div>
      </button>

      {expanded && (
        <div style={{ borderTop: `1px solid ${BC.bdr}`, background: BC.bg }}>
          {/* Points detail lives here rather than in the collapsed row: the
              banked total per side and the Front / Back / Overall split are
              what you open a match to find, not what you scan a board for. */}
          <div style={{ padding: "10px 12px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ flex: 1, fontSize: 9, fontWeight: 800, letterSpacing: 1, color: BC.t3 }}>
                MATCH {index + 1}{match.teeTime ? ` · ${match.teeTime}` : ""}
              </span>
              <span style={{ fontSize: 15, fontWeight: 800, color: BC.teamA }}>{fmtPts(ptsA)}</span>
              <span style={{ fontSize: 11, color: BC.t3 }}>–</span>
              <span style={{ fontSize: 15, fontWeight: 800, color: BC.teamB }}>{fmtPts(ptsB)}</span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {segments.map((s) => (
                <SegmentPill key={s.key} label={s.label} pot={s.pot} st={s.st} pts={s.pts} />
              ))}
            </div>
          </div>
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
  meta, results, open, onToggle, teams, tPlayers,
  courses, tRounds, roundLocks, expandedMatch, setExpandedMatch,
}) {
  const { course, fmt, tee, pts, state, scoring } = meta;

  // The round header is a plain row, not a card. Four match rows plus a
  // boxed header per round was two levels of container for one level of
  // information; dropping the wrapper is most of what buys the room for
  // the hole strips below.
  return (
    <div style={{ marginBottom: 12 }}>
      <button onClick={onToggle} style={{
        width: "100%", padding: "2px 2px 0", background: "transparent",
        border: "none", cursor: "pointer", textAlign: "left", display: "block", fontFamily: FONT,
      }}>
        {/* The round is named by where and what it is, not by its number —
            "Treetops · 2-Man Best Ball" tells a player which round this is
            far more directly than "ROUND 3" does. The live/final chip is
            gone with it: every match row already carries its own THRU or
            FINAL, so a round-level repeat was chrome. */}
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 10, color: BC.t3, width: 10, flexShrink: 0 }}>{open ? "▾" : "▸"}</span>
          <span style={{
            fontSize: 12, fontWeight: 800, letterSpacing: 1.2, color: BC.t1,
            minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {[course?.name || "Course TBD", fmt?.label].filter(Boolean).join(" · ").toUpperCase()}
          </span>
          <span style={{ flex: 1, minWidth: 6 }} />
          <span style={{ fontSize: 15, fontWeight: 800, flexShrink: 0, color: pts.A >= pts.B ? BC.teamA : `${BC.teamA}99` }}>{fmtPts(pts.A)}</span>
          <span style={{ fontSize: 11, color: BC.t3, flexShrink: 0 }}>–</span>
          <span style={{ fontSize: 15, fontWeight: 800, flexShrink: 0, color: pts.B >= pts.A ? BC.teamB : `${BC.teamB}99` }}>{fmtPts(pts.B)}</span>
        </div>
        {/* The tee, and how the round is settled. The scoring type earns its
            place on a header otherwise stripped to essentials: the same format
            plays completely differently as a match and on totals, and a round
            showing nothing about which one is in force is exactly how a Double
            Dot / Total round went on looking like match play on this screen. */}
        {(tee || scoring) && (
          <div style={{
            fontSize: 10, color: BC.t3, marginTop: 3, paddingLeft: 17,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {[tee, scoring].filter(Boolean).join(" · ")}
          </div>
        )}
      </button>

      {open && (
        results.length === 0 ? (
          <div style={{ padding: "16px 0", textAlign: "center", color: BC.t3, fontSize: 11 }}>
            No matches set up for this round.
          </div>
        ) : (
          /* One container per round, matches separated by hairlines — so the
             round reads as a single scoreboard rather than a stack of cards. */
          <div style={{
            marginTop: 8, background: BC.card, borderRadius: 12, overflow: "hidden",
            border: `1px solid ${state === "live" ? `${BC.amber}44` : BC.bdr}`,
          }}>
            {results.map(({ match: m, result: r, format }, i) => (
              <MatchCard
                key={m.id}
                index={i}
                first={i === 0}
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
        )
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
      // Treat the pot as a floor rather than a ceiling: a legacy match that
      // banked more than its round's current pot (an older point setup, or a
      // format bonus that has since been retired) must never render as
      // "-0.5 pts left".
      avail = Math.max(avail, pts.A + pts.B);
      const { tr, course } = getRoundCourseCtx({ roundLocks, round: rnd, tRounds, courses });
      const settled = results.length > 0
        && (isRoundFinal(roundLocks, rnd) || results.every(({ match: m, result: r }) => matchSettled(m, r)));
      out[rnd] = {
        results, pts, avail, holesPlayed, course,
        tee: tr?.tee_box || null,
        fmt: FORMATS.find((f) => f.id === tr?.format) || null,
        // Spelled out on the round bar because format alone doesn't tell you
        // how the round is settled — the same Double Dot round plays as a
        // match or on total dots depending on this one setting.
        scoring: (tr?.scoring_type || "match") === "stroke"
          ? `Total ${totalUnit(tr?.format)}` : "Match play",
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

  // Cup totals — banked points only. A segment's points don't land here
  // until it's decided, which is what makes the pending figure below a
  // genuinely separate quantity rather than a restatement.
  const totals = useMemo(() => {
    const t = { A: 0, B: 0 };
    matchResults.forEach(({ result }) => { t.A += result.totalPts.A; t.B += result.totalPts.B; });
    return t;
  }, [matchResults]);

  // Points currently in flight: every started-but-undecided segment handed
  // to whoever leads it right now. Add these to `totals` and you have the
  // score if every match on the course ended this second.
  const pending = useMemo(() => {
    const t = { A: 0, B: 0 };
    matchResults.forEach(({ match, result, format }) => {
      const p = pendingPts(match, result, format);
      t.A += p.A; t.B += p.B;
    });
    return t;
  }, [matchResults]);

  const totalAvail = useMemo(
    () => Math.max(matches.reduce((s, m) => s + matchPot(m), 0), totals.A + totals.B),
    [matches, totals]
  );
  // The configured target wins over the derived one — see CUP_POINTS_TO_WIN.
  // The fallback still applies when it's unset, and it's also what decides
  // a clinch below, so the bar and the number can't tell different stories.
  const toWin = CUP_POINTS_TO_WIN ?? (totalAvail ? totalAvail / 2 + 0.5 : 0);
  const clincher = totals.A >= toWin ? "A" : totals.B >= toWin ? "B" : null;

  // The bar has to be scaled to the same cup the "to win" number describes,
  // or its centre tick stops meaning the clinch line. A configured target
  // implies a total of twice-the-target-minus-the-half, and the real pot
  // still wins if the schedule turns out bigger than that.
  const barScale = Math.max(totalAvail, CUP_POINTS_TO_WIN ? toWin * 2 - 1 : 0);
  const pct = (v) => (barScale ? Math.min(100, (v / barScale) * 100) : 0);

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

        {/* Pending markers — each sits centred over its own faded bar
            segment, so the number and the length it describes are the same
            object rather than two things to correlate. Clamped away from
            the ends so a tiny segment's label can't overhang the card. */}
        <div style={{ position: "relative", height: 11, marginTop: 8 }}>
          {pending.A > 0 && (
            <span style={{
              position: "absolute", left: `${markerPct(pct(totals.A), pct(pending.A))}%`,
              transform: "translateX(-50%)", whiteSpace: "nowrap",
              fontSize: 9, fontWeight: 800, letterSpacing: 0.3, lineHeight: 1,
              color: ink(BC.teamA, false),
            }}>+{fmtPts(pending.A)}</span>
          )}
          {pending.B > 0 && (
            <span style={{
              position: "absolute", right: `${markerPct(pct(totals.B), pct(pending.B))}%`,
              transform: "translateX(50%)", whiteSpace: "nowrap",
              fontSize: 9, fontWeight: 800, letterSpacing: 0.3, lineHeight: 1,
              color: ink(BC.teamB, false),
            }}>+{fmtPts(pending.B)}</span>
          )}
        </div>

        <div style={{
          position: "relative", height: 10, borderRadius: 5,
          background: BC.inp, overflow: "hidden",
        }}>
          {/* Banked points fill solid from each edge; points in flight
              continue inboard at reduced strength. Read the solid length
              against the centre tick for "who has won it", and the solid
              plus faded length for "who is winning it". */}
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct(totals.A)}%`, background: BC.teamA }} />
          <div style={{
            position: "absolute", left: `${pct(totals.A)}%`, top: 0, bottom: 0,
            width: `${pct(pending.A)}%`, background: `${BC.teamA}5c`,
          }} />
          <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: `${pct(totals.B)}%`, background: BC.teamB }} />
          <div style={{
            position: "absolute", right: `${pct(totals.B)}%`, top: 0, bottom: 0,
            width: `${pct(pending.B)}%`, background: `${BC.teamB}5c`,
          }} />
          <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 2, marginLeft: -1, background: BC.bg, opacity: 0.9 }} />
        </div>

        {clincher && (
          <div style={{ textAlign: "center", marginTop: 7, fontSize: 9, fontWeight: 700, letterSpacing: 1, color: teamColor(clincher) }}>
            {(clincher === "A" ? tA.name : tB.name).toUpperCase()} WIN THE CUP
          </div>
        )}
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
//  Rows per nine: HOLE / PAR / team A / team B / running state. The team
//  rows carry whatever the match was actually decided on — net scores for
//  most formats, dots for Double Dot — and the winning side's cell is
//  tinted. The last row is the running match state on a Match round, and
//  the running lead on a Total one.
export function MatchScorecard({ match, result, format, courses, tRounds, teams, roundLocks }) {
  const { course, holePars } = getRoundCourseCtx({ roundLocks, round: match.round, tRounds, courses });
  const total = (match.scoring_type || "match") === "stroke";
  const higherWins = higherIsBetter(format);
  const unit = totalUnit(format);
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

    // Running margin from A's perspective, cumulative from hole 1 — holes up
    // on a Match round, lead on the running total on a Total one.
    const running = [];
    let m = 0, ra = 0, rb = 0;
    holes.forEach((h, i) => {
      if (total) {
        ra += h.aScore ?? 0; rb += h.bScore ?? 0;
        m = higherWins ? ra - rb : rb - ra;
      } else if (h.winner === "A") m += 1;
      else if (h.winner === "B") m -= 1;
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
          <div style={{ ...cellBase, color: BC.teamA }}>{total ? aTot || "·" : aWon}</div>

          {/* Team B nets */}
          <div style={{ ...lab, color: BC.teamB }}>{bLabel}</div>
          {slice.map((h, i) => (
            <div key={`b${i}`} style={{
              ...cellBase,
              color: h.winner === "B" ? BC.teamB : h.bScore == null ? BC.t3 : BC.t2,
              background: h.winner === "B" ? `${BC.teamB}26` : "transparent",
            }}>{h.bScore ?? "·"}</div>
          ))}
          <div style={{ ...cellBase, color: BC.teamB }}>{total ? bTot || "·" : bWon}</div>

          {/* Running state — holes up on a Match round, the leader's margin
              on the running total on a Total one. Both are colored by who
              holds the lead, so the row reads the same way either way. */}
          <div style={lab}>{total ? "LEAD" : "MTCH"}</div>
          {slice.map((h, i) => {
            const v = running[start + i];
            return (
              <div key={`m${i}`} style={{
                ...cellBase, fontSize: 8, fontWeight: 800,
                color: v == null ? BC.t3 : v > 0 ? BC.teamA : v < 0 ? BC.teamB : BC.t3,
              }}>
                {v == null ? "" : v === 0 ? (total ? "—" : "AS") : `${total ? "+" : ""}${Math.abs(v)}`}
              </div>
            );
          })}
          <div />
        </div>
      </div>
    );
  };

  // Double Dot side note — how the dots have been shared out so far. The
  // cells above show a hole's dots; this says what they add up to, which is
  // the number the round is actually settled on when it's Total-scored.
  const dd = format === "double_dot"
    ? segmentState(holes, { total: true, higherWins: true })
    : null;

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
        {[
          course?.name,
          FORMATS.find((f) => f.id === format)?.label,
          higherWins ? unit : "net scores",
          total ? `total ${unit}` : "match play",
        ].filter(Boolean).join(" · ")}
      </div>

      {nine(0, 9, "FRONT NINE")}
      {nine(9, 18, "BACK NINE")}

      {dd && (
        <div style={{
          marginTop: 2, padding: "7px 10px", borderRadius: 8,
          background: `${BC.amber}14`, border: `1px solid ${BC.amber}33`,
          fontSize: 10, color: BC.t2, display: "flex", alignItems: "center", gap: 6,
        }}>
          <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 1, color: BC.amber }}>DOTS</span>
          <span style={{ flex: 1 }} />
          {!dd.played ? (
            <span style={{ fontWeight: 700, color: BC.t3 }}>low ball + high ball, 2 per hole</span>
          ) : (
            <span style={{ fontWeight: 700 }}>
              <span style={{ color: BC.teamA }}>{dd.aTot}</span>
              <span style={{ color: BC.t3 }}>{" – "}</span>
              <span style={{ color: BC.teamB }}>{dd.bTot}</span>
              <span style={{ color: dd.margin === 0 ? BC.t3 : teamColor(dd.margin > 0 ? "A" : "B") }}>
                {dd.margin === 0 ? " · level" : ` · ${statusText(dd)}`}
              </span>
              <span style={{ color: BC.t3 }}>{dd.complete ? "" : ` thru ${dd.played}`}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default TeamLeaderboard;
