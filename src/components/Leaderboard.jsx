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
//       hole strip. Tap it and the full scorecard unfolds — the same
//       per-player card the Scoring tab's Full Scorecard button opens
//       (components/FullScorecard.jsx), so a match reads identically
//       whichever screen you came at it from.
//
//  Everything here is presentational. Every number comes from scoring.js —
//  computeMatchResult for the points, segmentState/statusText for the
//  margins. Nothing about a result is worked out locally, so this screen
//  cannot describe a match differently from how it was scored, or from how
//  the Scoring tab describes the same match.

import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { BC, FONT, ALPHA, FS, ink, teamColor } from "../theme";
import { playerLookup, realPlayers } from "../lib/players";
import {
  FORMATS, NASSAU_DEFAULT, DEFAULT_FORMAT,
  POINT_METHOD_TRADITIONAL, TROPHY_SILHOUETTE, CUP_POINTS_TO_WIN,
  isPointsPerHole, holePointsTotal, resolveScoring, SCORING_TYPE_TOTAL,
} from "../constants";
import {
  computeMatchResult, getRoundCourseCtx, holeFormatFor,
  segmentState, statusText, segmentLeader,
  segmentOptsFor,
} from "../scoring";
import { HoleStrip } from "./HoleStrip";
import { FullScorecard } from "./FullScorecard";
import { StickyTop } from "./ui";
import { isRoundFinal } from "../lib/roundLocks";
import { HOLE_COUNT, revealState, revealSummary, stepReveal, COUNTDOWN_HASH } from "../lib/reveal";
import { FinalCountdown } from "./FinalCountdown";

const ALL_ROUNDS = [1, 2, 3, 4];

// ── Small helpers ────────────────────────────────────────────────

// Points print without a pointless ".0" — 3 → "3", 3.5 → "3.5".
const fmtPts = (n) => (n == null ? "—" : Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

// Max points on offer in a single match. A points-per-hole match is worth
// every hole added up (9 + 18 = 27 at the usual 1-and-2), which is a different
// question from the Nassau pots — those aren't in play at all on such a round.
const matchPot = (m) => {
  if (isPointsPerHole(m.scoring_type)) return holePointsTotal(m.hole_points);
  if ((m.point_method || "") === POINT_METHOD_TRADITIONAL) return m.traditional_points ?? 1;
  const n = m.nassau || NASSAU_DEFAULT;
  return (n.front || 0) + (n.back || 0) + (n.overall || 0);
};

// Same question asked of a ROUND rather than a match: what is one match in
// this round worth? Falls back through the round's own Nassau split, then
// the format's default, so a round saved before a field existed still
// prices correctly.
const roundMatchPot = (tr) => {
  if (isPointsPerHole(tr.scoring_type)) return holePointsTotal(tr.hole_points);
  const d = FORMATS.find((f) => f.id === tr.format)?.nassau || NASSAU_DEFAULT;
  const n = tr.nassau || {};
  const nassauTotal =
    (n.front ?? tr.nassau_front ?? d.front ?? 0) +
    (n.back ?? tr.nassau_back ?? d.back ?? 0) +
    (n.overall ?? tr.nassau_overall ?? d.overall ?? 0);
  if ((tr.point_method || "") === POINT_METHOD_TRADITIONAL) {
    return tr.traditional_points ?? nassauTotal;
  }
  return nassauTotal;
};

// How many matches a round will produce once it's built, from the format's
// group size and the roster. A format with no group size (a full-team
// format) is one match however many players there are.
const roundMatchCount = (tr, playersPerSide) => {
  if (!playersPerSide) return 0;
  const per = FORMATS.find((f) => f.id === tr.format)?.perSide;
  if (per == null) return 1;
  return Math.max(1, Math.ceil(playersPerSide / per));
};

// ── Cup points on offer ──────────────────────────────────────────
// Total points the cup is worth, taken from the SCHEDULE rather than from
// whichever matches happen to have been created so far. That distinction is
// the whole point: sizing the cup by created matches meant the target
// climbed through setup — 8.5 with one round entered, higher with two —
// when the number everyone is playing for was fixed before a ball was hit.
//
// A round whose matches exist is priced off those matches, since the
// director may have built something the format's group size wouldn't
// predict. Only a round that hasn't been built yet gets projected.
function cupPointsOnOffer(matches, tRounds, playersPerSide) {
  const rounds = new Set([
    ...(tRounds || []).map((t) => t.round_number),
    ...(matches || []).map((m) => m.round),
  ]);
  let total = 0;
  rounds.forEach((rnd) => {
    const built = (matches || []).filter((m) => m.round === rnd);
    if (built.length) {
      total += built.reduce((sum, m) => sum + matchPot(m), 0);
      return;
    }
    const tr = (tRounds || []).find((t) => t.round_number === rnd);
    if (tr) total += roundMatchCount(tr, playersPerSide) * roundMatchPot(tr);
  });
  return total;
}

// Has every point in this match been decided? A match can be "closed out"
// (3&2) while a Nassau segment is still live, so the result being final and
// the POINTS being final are two different questions — this asks the second.
const matchSettled = (m, r) => {
  // Points are banked hole by hole, so the only thing that leaves a point
  // undecided is a hole nobody has played. A clinched lead does NOT settle it:
  // the remaining holes still pay out even once the round can't change hands.
  if (isPointsPerHole(m.scoring_type)) return r.holesPlayed === 18;
  if (resolveScoring(m).formOfPlay === SCORING_TYPE_TOTAL) return r.holesPlayed === 18;
  if ((m.point_method || "") === POINT_METHOD_TRADITIONAL) return r.overall.complete;
  const n = m.nassau || NASSAU_DEFAULT;
  return (!n.front || r.front.complete) && (!n.back || r.back.complete) && (!n.overall || r.overall.complete);
};

// Segment state and its result text now come from scoring.js — the same
// segmentState() the engine awards points from, so what this screen prints
// and what the match banked can't disagree. `segOpts` builds the flags that
// tell it how the round is settled.
const segOpts = segmentOptsFor;

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
  // Nothing is ever in flight on a points round: a played hole has already
  // paid, and an unplayed one is unplayed. Projecting the holes still to come
  // would be forecasting from no data, which is the same reason an untouched
  // segment isn't projected below.
  if (isPointsPerHole(m.scoring_type)) return out;
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
  // A points nine is split between the sides rather than won outright — six
  // holes to three is 6 and 3, not "6". Printing only the leader's figure the
  // way a Nassau pot does would read as a shutout, so both are shown, live and
  // finished alike, and the leading side carries the color.
  const perHole = st.unit === "points";
  const lead = segmentLeader(st);
  const shown = perHole
    ? `${fmtPts(pts.A)} – ${fmtPts(pts.B)}`
    : settled ? (halved ? "½ – ½" : `${fmtPts(win === "A" ? pts.A : pts.B)}`) : statusText(st);
  const color = (perHole ? lead : win) ? teamColor(perHole ? lead : win) : BC.t2;

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{
        fontSize: FS.micro, letterSpacing: 1, fontWeight: 800, color: BC.t3,
        textAlign: "center", marginBottom: 3, whiteSpace: "nowrap",
      }}>
        {label}{pot ? ` · ${fmtPts(pot)}` : ""}
      </div>
      <div style={{
        textAlign: "center", padding: "5px 2px", borderRadius: 7,
        fontSize: FS.small, fontWeight: 800, lineHeight: 1.1,
        background: settled && win ? `${color}${ALPHA.tint}` : "transparent",
        border: `1px ${settled ? "solid" : "dashed"} ${settled ? (win ? `${color}${ALPHA.line}` : BC.bdr) : `${BC.bdr}`}`,
        color: settled ? (halved ? BC.t2 : color) : st.played ? color : BC.t3,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>
        {shown}
      </div>
    </div>
  );
}

// ── Pending marker position ──────────────────────────────────────
// Where the "+N" sits: the exact midpoint of that side's faded bar segment,
// measured from its own edge of the bar. The label is centred on this point,
// so it lines up with the shading it describes and nothing else.
//
// This used to be clamped to [6%, 94%] to keep a label from overhanging the
// card. The clamp was the one thing stopping it from lining up: it only
// binds when a side's banked total is under ~6% of the bar — which is
// exactly the start of the cup, when everything IS pending — and there it
// pushed the label 14-18px off its shading. It also wasn't buying anything.
// A segment's midpoint is at least half its own width from the edge, so a
// wide label implies a wide segment to sit over; the card's 14px of side
// padding absorbs the rest, and this row doesn't clip.
const markerPct = (offset, width) => offset + width / 2;

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
          fontSize: FS.body, fontWeight: isLeader ? 700 : 600,
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
  fontSize: FS.micro, fontWeight: 800, letterSpacing: 0.6, color: BC.t3,
  lineHeight: 1, minWidth: 24, textAlign: "center",
};
const NINE_VALUE = {
  fontSize: FS.small, fontWeight: 800, lineHeight: 1, whiteSpace: "nowrap",
  minWidth: 24, textAlign: "center",
};

// ══════════════════════════════════════════════════════════════════
//  Match card
// ══════════════════════════════════════════════════════════════════
function MatchCard({
  index, first, match, result, format, tPlayers,
  courses, tRounds, roundLocks, holeData, viewer, expanded, onToggle,
}) {
  const total = resolveScoring(match).formOfPlay === SCORING_TYPE_TOTAL;
  const opts = segOpts(match, format);
  // What the holes were actually scored as — see the note on holeFormatFor. The
  // strip below paints a hole from its two numbers, and on a best-ball override
  // those are net strokes, not the round format's own units.
  const scoredFormat = holeFormatFor(match, format);
  const traditional = (match.point_method || "") === POINT_METHOD_TRADITIONAL;
  const n = match.nassau || NASSAU_DEFAULT;
  // Course context and gross-score reader for the expanded scorecard. Cheap
  // enough to resolve on every row — both are lookups, not scoring — and
  // keeping them out of the `expanded` branch keeps the hooks-free component
  // readable. `holeData` is keyed `pid_round`, the shape bc_holes stores.
  const cardCtx = getRoundCourseCtx({ roundLocks, round: match.round, tRounds, courses });
  const getScore = (pid, h) => (holeData?.[`${pid}_${match.round}`] || {})[h] || 0;

  const overallSt = segmentState(result.holes, opts);
  const { nameOf } = playerLookup(tPlayers);
  const aNames = (match.teamA || []).map(nameOf);
  const bNames = (match.teamB || []).map(nameOf);

  const ptsA = result.totalPts.A, ptsB = result.totalPts.B;
  const leader = segmentLeader(overallSt);
  const done = matchSettled(match, result);

  // Per-nine state, computed once and shared by the collapsed row's F9/B9
  // flanks and the expanded segment pills — so the two can never disagree.
  const frontSt = segmentState(result.holes.slice(0, 9), opts);
  const backSt = segmentState(result.holes.slice(9, 18), opts);

  // On a points round the two nines ARE the whole accounting — every point in
  // the round is banked into one or the other — so they're the two pills, and
  // the pot each shows is what that nine is worth in total (9 holes × its hole
  // value) rather than a segment prize. There is no OVERALL pill: an 18-hole
  // pot on top would be paying for the same holes a second time.
  const perHole = isPointsPerHole(match.scoring_type);
  const hp = result.holePoints;
  const segments = perHole
    ? [
        { key: "f", label: "FRONT", pot: (hp?.front ?? 0) * 9, st: frontSt, pts: result.frontPts },
        { key: "b", label: "BACK", pot: (hp?.back ?? 0) * 9, st: backSt, pts: result.backPts },
      ].filter((s) => s.pot)
    : traditional
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
  // A points round flanks too — its nines are where the points live.
  const showFront = perHole ? (hp?.front ?? 0) > 0 : !traditional && n.front > 0;
  const showBack = perHole ? (hp?.back ?? 0) > 0 : !traditional && n.back > 0;

  // A completed match that finished level is a HALVE, worth a half point to
  // each side. statusText would call that "AS", which reads as a live state —
  // "½" says it's over and how it was settled. Total matches keep their own
  // "TIED" wording, so this only applies to match play.
  const halved = done && !total && !perHole && overallSt.margin === 0;
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
      borderTop: first ? "none" : `1px solid ${BC.bdr}${ALPHA.line}`,
      background: expanded ? `${BC.amber}${ALPHA.wash}` : "transparent",
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
            <div style={{ fontSize: FS.lead, fontWeight: 800, lineHeight: 1, minWidth: 52, textAlign: "center", color: statusColor }}>
              {statusLabel}
            </div>
            {showBack && <div style={NINE_LABEL}>B9</div>}

            {/* Bottom row — each one's detail, directly beneath it. The
                chevron rides on THRU rather than taking a row of its own,
                so the expand affordance costs no vertical space. */}
            {showFront && <div style={{ ...NINE_VALUE, color: nineColor(frontSt) }}>{statusText(frontSt)}</div>}
            <div style={{ fontSize: FS.label, fontWeight: 700, letterSpacing: 0.9, lineHeight: 1, minWidth: 52, textAlign: "center", color: BC.t3 }}>
              {subLabel} {expanded ? "▴" : "▾"}
            </div>
            {showBack && <div style={{ ...NINE_VALUE, color: nineColor(backSt) }}>{statusText(backSt)}</div>}
          </div>
          <MatchTeamColumn tid="B" names={bNames} isLeader={leader === "B"} settled={done} />
        </div>

        {/* Hole-by-hole — the match's shape, on its own line at full width. */}
        <div style={{ marginTop: 8 }}>
          <HoleStrip holes={result.holes} format={scoredFormat} settled={done} />
        </div>
      </button>

      {expanded && (
        <div style={{ borderTop: `1px solid ${BC.bdr}`, background: BC.bg }}>
          {/* Points detail lives here rather than in the collapsed row: the
              banked total per side and the Front / Back / Overall split are
              what you open a match to find, not what you scan a board for. */}
          <div style={{ padding: "10px 12px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ flex: 1, fontSize: FS.label, fontWeight: 800, letterSpacing: 1, color: BC.t3 }}>
                {/* The match's number in the tournament, not its position in
                    this round — Round 2's opener is Match 5 when Round 1 had
                    four. Falls back to the row index only for a match the
                    numbering never reached. */}
                MATCH {match.matchNumber ?? index + 1}{match.teeTime ? ` · ${match.teeTime}` : ""}
              </span>
              <span style={{ fontSize: FS.lead, fontWeight: 800, color: BC.teamA }}>{fmtPts(ptsA)}</span>
              <span style={{ fontSize: FS.small, color: BC.t3 }}>–</span>
              <span style={{ fontSize: FS.lead, fontWeight: 800, color: BC.teamB }}>{fmtPts(ptsB)}</span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {segments.map((s) => (
                <SegmentPill key={s.key} label={s.label} pot={s.pot} st={s.st} pts={s.pts} />
              ))}
            </div>
          </div>
          {/* The same card the Scoring tab's Full Scorecard opens. It needs
              the round's course context and a reader for the gross scores,
              neither of which it re-derives — resolved here off the same
              lock-aware helper computeMatchResult scored the match with. */}
          <div style={{ padding: "12px 12px 14px" }}>
            <FullScorecard
              match={match} result={result} format={format}
              holePars={cardCtx.holePars} holeHcps={cardCtx.holeHcps} course={cardCtx.course}
              tPlayers={tPlayers} getScore={getScore} viewer={viewer}
              showHeader={false}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  Sealed round — the blackout, and the reveal that lifts it
// ══════════════════════════════════════════════════════════════════
//  See lib/reveal.js for what a sealed round is and why. What lands on
//  this screen is three things, in this order:
//
//    • the BANNER, saying the round is sealed and how much of it is out.
//    • YOUR SIDE, hole by hole, for every hole your team has posted. This
//      is the half of the feature that is not a subtraction: the board is
//      scored off the revealed holes only (App hands this component hole
//      data that genuinely stops at the reveal), so a team watching its
//      own round needs its own numbers handed to it separately.
//    • the REVEAL, for a director — one tap a hole, and every phone in
//      the room follows.
//
//  Nothing here reads the other side. The one prop that could — the
//  reader's own match result, computed off unsealed data — is indexed by
//  `viewer` at the top of the component and never re-derived below it.

// One nine of the reader's own side. `key` is aScore/bScore, resolved by
// the caller; this block cannot address the other column.
function OwnNine({ holes, start, label, sideKey, through, countLabel }) {
  const idx = Array.from({ length: 9 }, (_, i) => start + i);
  let sum = 0, any = false;
  idx.forEach((h) => {
    const v = holes?.[h]?.[sideKey];
    if (v != null) { sum += v; any = true; }
  });
  const cell = (i) => ({
    flex: 1, minWidth: 0, textAlign: "center",
    borderRight: i < 8 ? `1px solid ${BC.bdr}${ALPHA.hair}` : "none",
  });
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        {idx.map((h, i) => (
          <div key={h} style={{ ...cell(i), fontSize: FS.micro, fontWeight: 800, color: BC.t3, paddingBottom: 2 }}>
            {h + 1}
          </div>
        ))}
        <div style={{ width: 46, flexShrink: 0, textAlign: "center", fontSize: FS.micro, fontWeight: 800, color: BC.t3, letterSpacing: 0.5 }}>
          {label}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "stretch" }}>
        {idx.map((h, i) => {
          const v = holes?.[h]?.[sideKey];
          // A hole the room has already seen is tinted. Your own numbers
          // are shown either way — the tint says what is PUBLIC, which is
          // the one thing a player at the house cannot work out by looking.
          const out = h < through;
          return (
            <div key={h} style={{
              ...cell(i), padding: "3px 0", borderRadius: 4,
              background: out ? `${BC.amber}${ALPHA.wash}` : "transparent",
              fontSize: FS.small, fontWeight: 800,
              color: v == null ? `${BC.t3}${ALPHA.hair}` : out ? BC.amberInk : BC.t1,
            }}>
              {v == null ? "·" : v}
            </div>
          );
        })}
        <div style={{ width: 46, flexShrink: 0, textAlign: "center", padding: "3px 0", fontSize: FS.small, fontWeight: 800, color: BC.t1 }}>
          {any ? sum : ""}
        </div>
      </div>
      {countLabel && (
        <div style={{ textAlign: "right", fontSize: FS.micro, fontWeight: 700, letterSpacing: 0.5, color: BC.t3, marginTop: 1 }}>
          {countLabel}
        </div>
      )}
    </div>
  );
}

// The reader's own side of one sealed match — the card a team watches
// itself on while the round is dark.
function OwnSideCard({ result, viewer, teamName, through }) {
  const sideKey = viewer === "A" ? "aScore" : "bScore";
  const holes = result?.holes || [];
  let thru = 0, total = 0, any = false;
  holes.forEach((h, i) => {
    const v = h?.[sideKey];
    if (v == null) return;
    total += v; any = true; thru = i + 1;
  });
  // Team Best Ball counts a different number of balls on each nine, and the
  // sums in the rows above are meaningless without it.
  const counting = result?.counting || null;
  const col = teamColor(viewer);

  return (
    <div style={{ padding: "10px 12px 8px", borderTop: `1px solid ${BC.bdr}${ALPHA.line}` }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <span style={{
          minWidth: 0, fontSize: FS.label, fontWeight: 800, letterSpacing: 0.8, color: col,
          textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{teamName}</span>
        <span style={{ fontSize: FS.micro, fontWeight: 800, letterSpacing: 1, color: BC.t3 }}>YOUR SIDE ONLY</span>
        <span style={{ marginLeft: "auto", flexShrink: 0, fontSize: FS.label, fontWeight: 700, color: BC.t3, letterSpacing: 0.5 }}>
          {thru ? `THRU ${thru}` : "NOT STARTED"}
        </span>
      </div>
      <OwnNine holes={holes} start={0} label="OUT" sideKey={sideKey} through={through}
        countLabel={counting ? `best ${counting[0]} of the side` : null} />
      <OwnNine holes={holes} start={9} label="IN" sideKey={sideKey} through={through}
        countLabel={counting ? `best ${counting[9]} of the side` : null} />
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 4 }}>
        <span style={{ fontSize: FS.micro, fontWeight: 800, letterSpacing: 1, color: BC.t3 }}>YOUR TOTAL</span>
        <span style={{ marginLeft: "auto", fontSize: FS.lead, fontWeight: 800, color: col }}>{any ? total : "—"}</span>
      </div>
    </div>
  );
}

// ── The reveal control ───────────────────────────────────────────
// Directors only, and it is the whole ceremony: one tap turns over one
// hole for every phone in the room. Back steps one hole the other way —
// which is also the way out of a tap nobody meant to make, since 0 is the
// round fully sealed again.
//
// REVEAL ALL takes two taps. It is the one control here that can end the
// evening in a single press, and a thumb resting on a phone being passed
// around the room is exactly how that would happen.
function RevealControl({ through, onSet }) {
  const [armAll, setArmAll] = useState(false);
  const done = through >= HOLE_COUNT;
  const btn = (extra) => ({
    padding: "8px 10px", borderRadius: 8, cursor: "pointer", fontFamily: FONT,
    fontSize: FS.label, fontWeight: 800, letterSpacing: 0.6,
    background: BC.inp, border: `1px solid ${BC.bdr}`, color: BC.t2, ...extra,
  });
  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 6, padding: "8px 12px 12px" }}>
      <button
        onClick={() => { setArmAll(false); onSet(stepReveal(through, -1)); }}
        disabled={through <= 0}
        style={btn({ flexShrink: 0, opacity: through <= 0 ? 0.4 : 1, cursor: through <= 0 ? "not-allowed" : "pointer" })}
      >◀ BACK</button>
      <button
        onClick={() => { setArmAll(false); onSet(stepReveal(through, 1)); }}
        disabled={done}
        style={btn({
          flex: 1, fontSize: FS.body,
          background: done ? BC.inp : BC.amberGlow,
          border: `1px solid ${done ? BC.bdr : BC.amber}${done ? "" : ALPHA.line}`,
          color: done ? BC.t3 : BC.amberInk,
          cursor: done ? "not-allowed" : "pointer",
        })}
      >{done ? "ALL 18 REVEALED" : `REVEAL HOLE ${through + 1} ▸`}</button>
      {!done && (
        <button
          onClick={() => { if (armAll) { setArmAll(false); onSet(HOLE_COUNT); } else setArmAll(true); }}
          onBlur={() => setArmAll(false)}
          style={btn({
            flexShrink: 0,
            background: armAll ? `${BC.danger}${ALPHA.tint}` : BC.inp,
            border: `1px solid ${armAll ? BC.danger : BC.bdr}`,
            color: armAll ? BC.danger : BC.t2,
          })}
        >{armAll ? "SURE?" : "ALL"}</button>
      )}
    </div>
  );
}

// The banner, the own-side card and (for a director) the control, as one
// panel that sits where the match rows would be.
function SealedPanel({ through, ownCards, remaining, canReveal, onSetReveal, onOpenCountdown }) {
  return (
    <div style={{
      marginTop: 8, background: BC.card, borderRadius: 12, overflow: "hidden",
      border: `1px solid ${BC.amber}${ALPHA.line}`,
    }}>
      <div style={{ padding: "11px 12px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span aria-hidden="true" style={{ fontSize: FS.small, lineHeight: 1 }}>🔒</span>
          <span style={{ fontSize: FS.label, fontWeight: 800, letterSpacing: 1, color: BC.amberInk }}>
            THE FINAL COUNTDOWN · SEALED
          </span>
          <span style={{ marginLeft: "auto", fontSize: FS.label, fontWeight: 800, color: BC.t3, letterSpacing: 0.5 }}>
            {through} / {HOLE_COUNT}
          </span>
        </div>
        <div style={{ fontSize: FS.label, color: BC.t3, lineHeight: 1.5 }}>
          {revealSummary(through)}. Nobody sees the other side, and this board does
          not move, until the cards are turned over
          {remaining > 0 ? ` — ${fmtPts(remaining)} still to come` : ""}.
        </div>
        {/* The way onto the television. Offered to EVERYBODY, not just the
            director: the screen the room watches is signed in as whoever
            happened to be holding the laptop, and a countdown only a director
            could open would be a countdown nobody could put on the TV. The
            controls inside it are still director-only. */}
        <button onClick={onOpenCountdown} style={{
          width: "100%", marginTop: 9, padding: "9px 0", borderRadius: 8,
          background: BC.amberGlow, border: `1px solid ${BC.amber}${ALPHA.line}`,
          color: BC.amberInk, fontFamily: FONT, fontSize: FS.body, fontWeight: 800,
          letterSpacing: 1, cursor: "pointer",
        }}>
          📺 OPEN THE FINAL COUNTDOWN
        </button>
      </div>
      {ownCards}
      {canReveal && <RevealControl through={through} onSet={onSetReveal} />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  Round section
// ══════════════════════════════════════════════════════════════════
function RoundSection({
  meta, results, open, onToggle, tPlayers,
  courses, tRounds, roundLocks, holeData, viewer, expandedMatch, setExpandedMatch,
  sealPanel,
}) {
  const { course, fmt, pts, state, seal } = meta;

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
          <span style={{ fontSize: FS.label, color: BC.t3, width: 10, flexShrink: 0 }}>{open ? "▾" : "▸"}</span>
          <span style={{
            fontSize: FS.small, fontWeight: 800, letterSpacing: 1.2, color: BC.t1,
            minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {[course?.name || "Course TBD", fmt?.label].filter(Boolean).join(" · ").toUpperCase()}
          </span>
          {/* The one round-level chip left on this bar. It earns the room the
              live/final chip lost: a collapsed round showing 0–0 is otherwise
              indistinguishable from one nobody has teed off on, and those are
              very different things on the last day. */}
          {seal?.concealing && (
            <span style={{
              flexShrink: 0, fontSize: FS.micro, fontWeight: 800, letterSpacing: 0.8,
              padding: "2px 5px", borderRadius: 4, whiteSpace: "nowrap",
              background: `${BC.amber}${ALPHA.wash}`, border: `1px solid ${BC.amber}${ALPHA.line}`,
              color: BC.amberInk,
            }}>🔒 {seal.through}/{HOLE_COUNT}</span>
          )}
          <span style={{ flex: 1, minWidth: 6 }} />
          <span style={{ fontSize: FS.lead, fontWeight: 800, flexShrink: 0, color: pts.A >= pts.B ? BC.teamA : `${BC.teamA}${ALPHA.held}` }}>{fmtPts(pts.A)}</span>
          <span style={{ fontSize: FS.small, color: BC.t3, flexShrink: 0 }}>–</span>
          <span style={{ fontSize: FS.lead, fontWeight: 800, flexShrink: 0, color: pts.B >= pts.A ? BC.teamB : `${BC.teamB}${ALPHA.held}` }}>{fmtPts(pts.B)}</span>
        </div>
        {/* Nothing under the header. The tee, the handicap terms, the scoring
            type and the counting rule all used to sit here; all of it is setup
            detail, and this is a board players read for the score. The Rounds
            tab is where a round's terms belong. */}
      </button>

      {open && (
        results.length === 0 ? (
          <div style={{ padding: "16px 0", textAlign: "center", color: BC.t3, fontSize: FS.small }}>
            No matches set up for this round.
          </div>
        ) : (
          <>
          {sealPanel}
          {/* A sealed round with nothing turned over yet has no match rows to
              draw — every one of them would say "THRU 0" against a tee time,
              which reads as a round that hasn't started rather than one being
              held back. The panel above says what is actually true. */}
          {seal?.concealing && seal.through === 0 ? null : (
          /* One container per round, matches separated by hairlines — so the
             round reads as a single scoreboard rather than a stack of cards. */
          <div style={{
            marginTop: 8, background: BC.card, borderRadius: 12, overflow: "hidden",
            border: `1px solid ${state === "live" ? `${BC.amber}${ALPHA.line}` : BC.bdr}`,
          }}>
            {results.map(({ match: m, result: r, format }, i) => (
              <MatchCard
                key={m.id}
                index={i}
                first={i === 0}
                match={m}
                result={r}
                format={format}
                tPlayers={tPlayers}
                courses={courses}
                tRounds={tRounds}
                roundLocks={roundLocks}
                holeData={holeData}
                viewer={viewer}
                expanded={expandedMatch === m.id}
                onToggle={() => setExpandedMatch(expandedMatch === m.id ? null : m.id)}
              />
            ))}
          </div>
          )}
          </>
        )
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  TeamLeaderboard
// ══════════════════════════════════════════════════════════════════
// `viewer` is the side of the cup the reader is on ("A" | "B"). Every player
// belongs to one team for the whole tournament, so it is defined on every
// match on this board — which is what lets an expanded scorecard's running
// MATCH row read ▲ / ▼ from the reader's own side rather than an arbitrary
// one. See components/FullScorecard.jsx on the two currencies of color.
//
// ── The two hole maps ────────────────────────────────────────────
// `holeData` is the CONCEALED map — App has already removed every hole past
// a sealed round's reveal (see lib/reveal.concealHoleData), so everything
// this board computes from it is scored off the revealed holes and nothing
// else. There is no branch anywhere below that has the sealed numbers and
// chooses not to draw them; it does not have them.
//
// `ownHoleData` is the unsealed one, and it feeds exactly one thing: the
// reader's own side of a sealed round (OwnSideCard). A team is allowed to
// watch itself — that is the ask — so the one component that needs the real
// numbers gets them, indexes them by `viewer`, and never looks at the other
// column. Everything else on this screen is handed `holeData`.
export function TeamLeaderboard({
  matches, holeData, ownHoleData, courses, tRounds, tPlayers, rounds, teams,
  hcpOverrides, teeAssignments, roundLocks, viewer,
  canReveal = false, onSetReveal, autoCountdown = false,
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
      // Numbered order, which is the order they go off — so the rows count
      // up rather than following whatever order Firestore delivered. A round
      // whose matches carry no numbers keeps its arrival order (stable sort).
      const results = matchResults
        .filter((mr) => mr.match.round === rnd)
        .sort((a, b) => (a.match.matchNumber ?? 0) - (b.match.matchNumber ?? 0));
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
      const seal = revealState(tRounds, rnd);
      // A sealed round is never "final" on this board, however finished it is
      // on the course: its points are still coming. Saying FINAL over a round
      // whose result nobody has seen would be the board's own spoiler — it
      // would mean the numbers beside it are the whole story, and they aren't.
      const settled = results.length > 0 && !seal.concealing
        && (isRoundFinal(roundLocks, rnd) || results.every(({ match: m, result: r }) => matchSettled(m, r)));
      out[rnd] = {
        results, pts, avail, holesPlayed, course, seal,
        fmt: FORMATS.find((f) => f.id === tr?.format) || null,
        state: settled ? "final" : holesPlayed > 0 ? "live" : "upcoming",
      };
    });
    return out;
  }, [roundNumbers, matchResults, tRounds, courses, roundLocks]);

  // ── The reader's own side of a sealed round ──────────────────────
  // The ONE place the unsealed hole data is used, and it is used a column at
  // a time: computeMatchResult fills both sides, `viewer` picks one, and
  // OwnSideCard below reads nothing else off it. Only sealed rounds are
  // computed at all, so an ordinary tournament pays nothing for this.
  const ownResults = useMemo(() => {
    const out = {};
    roundNumbers.forEach((rnd) => {
      if (!roundMeta[rnd]?.seal?.concealing) return;
      const fmt = tRounds.find((t) => t.round_number === rnd)?.format || DEFAULT_FORMAT;
      out[rnd] = matches
        .filter((m) => m.round === rnd)
        .sort((a, b) => (a.matchNumber ?? 0) - (b.matchNumber ?? 0))
        .map((m) => ({
          match: m,
          result: computeMatchResult(m, ownHoleData || {}, courses, tRounds, tPlayers, fmt, hcpOverrides, undefined, teeAssignments, roundLocks),
        }));
    });
    return out;
  }, [roundNumbers, roundMeta, matches, ownHoleData, courses, tRounds, tPlayers, hcpOverrides, teeAssignments, roundLocks]);

  // Which rounds open by default: every live round, plus any round still
  // being revealed — that one IS the screen everybody is looking at, and its
  // revealed-holes-only view reads as "upcoming" until the first hole is
  // turned over, which would have folded it away at exactly the wrong moment.
  const defaultOpen = useMemo(() => {
    const live = roundNumbers.filter((r) => roundMeta[r].state === "live" || roundMeta[r].seal?.concealing);
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

  // Roster size per side, which is what turns a format into a match count.
  // Takes the smaller side so an in-progress roster can't inflate the cup;
  // falls back to the larger one when only one side has been entered.
  const playersPerSide = useMemo(() => {
    // Golfers, not balls: 2020's compiled card sits on a side so Team Best
    // Ball has something to count, but it never made a match of its own, so
    // counting it here would price the cup a match too high.
    const roster = realPlayers(tPlayers);
    const a = roster.filter((p) => p.team === "A").length;
    const b = roster.filter((p) => p.team === "B").length;
    return Math.min(a, b) || Math.max(a, b);
  }, [tPlayers]);

  const totalAvail = useMemo(
    () => Math.max(cupPointsOnOffer(matches, tRounds, playersPerSide), totals.A + totals.B),
    [matches, tRounds, playersPerSide, totals]
  );

  // ── What the cup total is NOT counting ───────────────────────────
  // The totals above are banked points, and a sealed round banks nothing
  // past its reveal. That is correct — but a cup bar that silently leaves a
  // whole round out is the one place this feature could mislead rather than
  // withhold, so the board says so, and says how much. The figure is the
  // sealed rounds' pot less whatever the reveal has already paid out.
  const sealedOut = useMemo(() => {
    const conceal = roundNumbers.filter((r) => roundMeta[r]?.seal?.concealing);
    if (!conceal.length) return null;
    let pot = 0, banked = 0;
    conceal.forEach((rnd) => {
      roundMeta[rnd].results.forEach(({ match: m, result: r }) => {
        pot += matchPot(m);
        banked += r.totalPts.A + r.totalPts.B;
      });
    });
    return { rounds: conceal, remaining: Math.max(0, pot - banked) };
  }, [roundNumbers, roundMeta]);
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

  // ── The Final Countdown ──────────────────────────────────────────
  // Which round's countdown is on screen, or null. It renders as a portal
  // onto document.body rather than inside this tab, because it is a
  // television screen and it has no business inheriting the app's phone
  // shell, its bottom nav or its scroll container.
  //
  // `autoCountdown` is App's reading of the #countdown hash at startup: the
  // television is pointed at one URL and has to land on the countdown by
  // itself, since nobody is going to walk over and tap the button after
  // every refresh. Resolved during render rather than in an effect so the
  // scoreboard never paints for a frame first — see the same pattern, for
  // the same reason, in FinalCountdown's stagger.
  const [countdownRound, setCountdownRound] = useState(null);
  const [autoOpened, setAutoOpened] = useState(!autoCountdown);
  if (!autoOpened) {
    const rnd = roundNumbers.find((r) => roundMeta[r]?.seal?.sealed);
    if (rnd != null) { setAutoOpened(true); setCountdownRound(rnd); }
  }
  // The hash follows the screen, so a refresh in front of sixteen people
  // comes back to where it was.
  const setHash = (on) => {
    try {
      const { pathname, search } = window.location;
      window.history.replaceState(null, "", on ? `${pathname}${search}${COUNTDOWN_HASH}` : `${pathname}${search}`);
    } catch { /* a browser that refuses to rewrite its own URL still runs the countdown */ }
  };
  const openCountdown = (rnd) => { setCountdownRound(rnd); setHash(true); };
  const closeCountdown = () => { setCountdownRound(null); setHash(false); };

  const countdown = countdownRound != null && (() => {
    const rnd = countdownRound;
    const meta = roundMeta[rnd];
    const entry = meta?.results?.[0];
    if (!entry) return null;
    const { course, holePars, holeHcps } = getRoundCourseCtx({ roundLocks, round: rnd, tRounds, courses });
    return createPortal(
      <FinalCountdown
        match={entry.match}
        result={entry.result}
        getScore={(pid, h) => (holeData?.[`${pid}_${rnd}`] || {})[h] || 0}
        holePars={holePars}
        holeHcps={holeHcps}
        tPlayers={tPlayers}
        teams={teams}
        courseName={course?.name || null}
        formatLabel={meta.fmt?.label || null}
        through={meta.seal?.through ?? HOLE_COUNT}
        totals={totals}
        toWin={toWin}
        clincher={clincher}
        canAdvance={canReveal && !!onSetReveal}
        onAdvance={(n) => onSetReveal(rnd, n)}
        onClose={closeCountdown}
      />,
      document.body,
    );
  })();

  // What a round's section carries above its match rows. Three states, and
  // the third is the one that is easy to leave out: once the last hole is
  // turned over there is no panel left, but a DIRECTOR still needs the
  // control — it is the only way back from a hole revealed by a stray tap,
  // and from the dry run somebody walks to 18 the week before.
  const sealPanelFor = (rnd) => {
    const seal = roundMeta[rnd]?.seal;
    if (!seal?.sealed) return null;
    const drive = canReveal && onSetReveal ? (n) => onSetReveal(rnd, n) : null;
    if (!seal.concealing) {
      return drive ? (
        <div style={{ marginTop: 8, background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}` }}>
          <RevealControl through={seal.through} onSet={drive} />
        </div>
      ) : null;
    }
    return (
      <SealedPanel
        through={seal.through}
        remaining={sealedOut?.remaining ?? 0}
        canReveal={!!drive}
        onSetReveal={drive || (() => {})}
        onOpenCountdown={() => openCountdown(rnd)}
        ownCards={(ownResults[rnd] || []).map(({ match: m, result: r }) => (
          <OwnSideCard
            key={m.id}
            result={r}
            viewer={viewer}
            teamName={viewer === "A" ? tA.name : tB.name}
            through={seal.through}
          />
        ))}
      />
    );
  };

  if (roundNumbers.length === 0) {
    return (
      <div style={{
        fontFamily: FONT, display: "flex", flexDirection: "column", alignItems: "center",
        // `flex: 1` against the scroll container, NOT `calc(100svh - 250px)`.
        // svh measures the SCREEN, and this box lives inside the shell's scroll
        // area — which is the screen minus the app header, minus the nav, minus
        // the body's own padding. Subtracting a hardcoded 250 was a guess at
        // that chrome, and any device where the guess ran long made this empty
        // state taller than the space available and put a scrollbar on a screen
        // with nothing to scroll. `flex: 1` asks the container instead of the
        // screen, so it is exactly right at every chrome height.
        justifyContent: "center", flex: 1, minHeight: 220, textAlign: "center",
        padding: "0 24px", gap: 10,
      }}>
        <div style={{
          width: 40, height: 40, background: BC.amber,
          WebkitMask: `url(${TROPHY_SILHOUETTE}) center/contain no-repeat`,
          mask: `url(${TROPHY_SILHOUETTE}) center/contain no-repeat`,
          opacity: 0.3,
        }} />
        <div style={{ fontSize: FS.lead, fontWeight: 700, color: BC.t1, letterSpacing: 0.3 }}>No matches yet</div>
        <div style={{ fontSize: FS.small, color: BC.t3, maxWidth: 260, lineHeight: 1.5 }}>
          Matches will appear here once the tournament schedule is set.
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: FONT }}>
      {/* ── The pinned board ──
          The cup total, stuck to the top of the scroll area, directly under
          the app header. Everything below it — the rounds, every match — is
          detail you read AGAINST the cup score, so the cup score should
          never be the thing you have to scroll back up to find. Same
          StickyTop every other tab pins its lead control with. */}
      <StickyTop padTop={6}>
      {/* ── Cup total ──
          Team names, the two totals in team colors, and a single bar
          that fills inward from both edges. The tick in the middle is
          the clinch line, so "who's actually winning" is one glance. */}
      <div style={{
        background: BC.card, borderRadius: 14, border: `1px solid ${BC.bdr}`,
        padding: "13px 14px 12px",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: FS.label, fontWeight: 800, letterSpacing: 0.8, color: BC.teamA,
              textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>{tA.name}</div>
            <div style={{ fontSize: FS.display, fontWeight: 800, color: BC.teamA, lineHeight: 1.1, marginTop: 1 }}>
              {fmtPts(totals.A)}
            </div>
          </div>
          <div style={{ textAlign: "center", flexShrink: 0, paddingTop: 6 }}>
            <div style={{ fontSize: FS.lead, fontWeight: 800, color: BC.t1, lineHeight: 1 }}>{fmtPts(toWin)}</div>
            <div style={{ fontSize: FS.micro, fontWeight: 800, letterSpacing: 1, color: BC.t3, marginTop: 3 }}>TO WIN</div>
          </div>
          <div style={{ flex: 1, minWidth: 0, textAlign: "right" }}>
            <div style={{
              fontSize: FS.label, fontWeight: 800, letterSpacing: 0.8, color: BC.teamB,
              textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>{tB.name}</div>
            <div style={{ fontSize: FS.display, fontWeight: 800, color: BC.teamB, lineHeight: 1.1, marginTop: 1 }}>
              {fmtPts(totals.B)}
            </div>
          </div>
        </div>

        {/* Pending markers — each sits centred over its own faded bar
            segment, so the number and the length it describes are the same
            object rather than two things to correlate. */}
        <div style={{ position: "relative", height: 11, marginTop: 8 }}>
          {pending.A > 0 && (
            <span style={{
              position: "absolute", left: `${markerPct(pct(totals.A), pct(pending.A))}%`,
              transform: "translateX(-50%)", whiteSpace: "nowrap",
              fontSize: FS.label, fontWeight: 800, letterSpacing: 0.3, lineHeight: 1,
              color: ink(BC.teamA, false),
            }}>+{fmtPts(pending.A)}</span>
          )}
          {pending.B > 0 && (
            <span style={{
              position: "absolute", right: `${markerPct(pct(totals.B), pct(pending.B))}%`,
              transform: "translateX(50%)", whiteSpace: "nowrap",
              fontSize: FS.label, fontWeight: 800, letterSpacing: 0.3, lineHeight: 1,
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
            width: `${pct(pending.A)}%`, background: `${BC.teamA}${ALPHA.line}`,
          }} />
          <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: `${pct(totals.B)}%`, background: BC.teamB }} />
          <div style={{
            position: "absolute", right: `${pct(totals.B)}%`, top: 0, bottom: 0,
            width: `${pct(pending.B)}%`, background: `${BC.teamB}${ALPHA.line}`,
          }} />
          <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 2, marginLeft: -1, background: BC.bg, opacity: 0.9 }} />
        </div>

        {/* Said before the clinch line, deliberately: a cup that reads as won
            while a sealed round is still holding points is a cup that has not
            been won yet, and the reader needs that in the same glance. */}
        {sealedOut && (
          <div style={{
            marginTop: 7, textAlign: "center", fontSize: FS.label, fontWeight: 700,
            letterSpacing: 0.5, color: BC.amberInk, lineHeight: 1.4,
          }}>
            🔒 Round{sealedOut.rounds.length > 1 ? "s" : ""} {sealedOut.rounds.join(", ")} sealed
            {sealedOut.remaining > 0 ? ` — ${fmtPts(sealedOut.remaining)} not yet revealed` : ""}
          </div>
        )}

        {clincher && (
          <div style={{ textAlign: "center", marginTop: 7, fontSize: FS.label, fontWeight: 700, letterSpacing: 1, color: teamColor(clincher) }}>
            {(clincher === "A" ? tA.name : tB.name).toUpperCase()} WIN THE CUP
          </div>
        )}
      </div>
      </StickyTop>

      {countdown}

      {/* ── Rounds ── */}
      {roundNumbers.map((rnd) => (
        <RoundSection
          key={rnd}
          round={rnd}
          meta={roundMeta[rnd]}
          results={roundMeta[rnd].results}
          sealPanel={sealPanelFor(rnd)}
          open={openOverrides[rnd] ?? defaultOpen.has(rnd)}
          onToggle={() => setOpenOverrides((p) => ({ ...p, [rnd]: !(p[rnd] ?? defaultOpen.has(rnd)) }))}
          tPlayers={tPlayers}
          courses={courses}
          tRounds={tRounds}
          roundLocks={roundLocks}
          holeData={holeData}
          viewer={viewer}
          expandedMatch={expandedMatch}
          setExpandedMatch={setExpandedMatch}
        />
      ))}
    </div>
  );
}

export default TeamLeaderboard;
