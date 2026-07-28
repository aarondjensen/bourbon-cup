import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { BC, FONT, ON_ACCENT, SHADOW, ALPHA, ON_AMBER, FS, applyBCTheme, initialBCMode, bcGlobalCSS, playerNameColor, teamColor, VP_DROP, VP_DROP_BOTTOM } from "./theme";
import { playerLookup } from "./lib/players";
import { db, TOURNAMENT_ID, getTournamentYear, editionDocId, setActiveTournamentId, readUserSession, writeUserSession } from "./firebase";
import {
  TROPHY_PHOTO, LOGO_TEAM_A, LOGO_TEAM_A_WHITE, LOGO_TEAM_B, TROPHY_SILHOUETTE,
  resolveTeams, DEFAULT_TEAM_NAMES, TOURNAMENT_TITLE, TOURNAMENT_LOCATION,
  FORMATS, NASSAU_DEFAULT, DEFAULT_FORMAT, DIRECTOR_CODE,
  resolveAllowance, describeAllowance, allowanceDefaultFor,
  formatCountsScores, countingDefaultFor, resolveCounting, countingNine,
  resolveHolePoints, isPointsPerHole, holePointsTotal,
  SCORING_TYPE_MATCH, SCORING_TYPE_TOTAL, SCORING_TYPE_POINTS,
  HOLE_SCORING_FORMAT, HOLE_SCORING_BEST_BALL, resolveScoring,
  holeRuleFor, describeHoleScore, HOLE_RULE_COUNTING, HOLE_RULE_FIXED,
  holeOptionsFor, resolveHoleMethod, HOLE_METHOD_LABELS, HOLE_METHOD_DESCRIPTIONS,
  formsFor, formDefaultFor, resolveFormOfPlay, formOfPlayLabel, describeFormOfPlay,
  handicapModeFor, allowanceStartsOn,
  resolveParPoints, parPointsDefaultFor, formatUsesParPoints, PAR_RESULTS, PAR_RESULT_LABELS,
} from "./constants";
import {
  calcCH, calcCHForCourse, fmtScore,
  getEffectiveHI, buildStrokeMap, resolveHolePars, resolveHoleHcps,
  computeMatchResult,
  getRoundCH, getRoundHI, getRoundTee, lockForRound,
  totalUnit, segmentState, segmentOptsFor, holeFormatFor,
} from "./scoring";
import { holeFill } from "./lib/holeFill";
import {
  ROUND_LOCKS_COL, buildRoundLockDoc, refreshRoundLockDoc,
  markRoundFinal, unfinalizeRound, clearRoundLockDoc,
  roundLockState, describeHiChangeImpact,
  currentRoundNumber, nextRoundNumber, lastFinalRoundNumber,
  LOCK_OPEN, LOCK_FINAL,
} from "./lib/roundLocks";
import { usePullToRefresh } from "./lib/usePullToRefresh";
import { useFitDensity } from "./lib/useFitDensity";
import { processLogo } from "./lib/logoBrand";
import ErrorBoundary from "./components/ErrorBoundary";
import { AppHeader } from "./components/AppHeader";
import { Popup, ConfirmModal } from "./components/Popup";
import { CtpPrompt } from "./components/CtpPrompt";
import { DirectorFinalizeAlert, FinalizeRoundSheet } from "./components/FinalizeRound";
import { SegmentedToggle, StickyTop, Banner, Toast, HoleNavigator, ScoreButtonRow } from "./components/ui";
import { useConfirm } from "./lib/useConfirm";
import { useStableCallback } from "./lib/useStableCallback";
import { EditionSwitcher } from "./components/EditionSwitcher";
import { GhinLinkButton, GhinSyncButton } from "./components/GhinLink";
import { TeamLeaderboard } from "./components/Leaderboard";
import { FullScorecard } from "./components/FullScorecard";
import { MatchSetup } from "./components/MatchSetup";
import {
  GROUPS_COL, groupsDocId, encodeGroups, decodeGroups,
  teeTimeForMatch, parseTeeTime, formatTeeTime, DEFAULT_TEE_INTERVAL, TEE_SLOTS,
  roundPlaySetup, orderMatchesForRound, numberMatches,
  stripAMPM,
} from "./lib/groups";
import { holesEntered, roundScoreProgress } from "./lib/scoreGuard";
import { useHoleAdvance } from "./lib/useHoleAdvance";

// ── Bottom-nav safe-area cushion ──────────────────────────────────
// Full iOS home-indicator inset (34pt on devices that have one) plus 8pt,
// applied as paddingBottom on the fixed nav bar so the labels clear the
// home indicator. This is the pre-2026-07-21 value: the interim "navfix"
// rework made the nav an in-flow flex child and clamped this to 10px, which
// left the bar mis-seated on real devices. Restoring the fixed bar (pinned
// to the viewport bottom) with the full inset is the known-good layout.
const NAV_SAFE_PAD = "calc(env(safe-area-inset-bottom, 0px) + 8px)";

// Where a dismissed "ready to finalize" notification is remembered, per
// edition — TOURNAMENT_ID is a live binding (firebase.js reassigns it when
// the edition changes), so this is read at call time, never captured once.
const finalizeSnoozeKey = () => `bc_finalize_snooze_${TOURNAMENT_ID}`;

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
const ScoreCell = ({ score, par, strokes, size = FS.body, colorOverride }) => {
  const sh = size + 8;          // outer shape size (square or circle)
  const dotH = 10;              // height of stroke-dots row above the score
  const bc = colorOverride || BC.t2;
  const empty = !score || score <= 0;

  if (empty) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", height: dotH + sh, justifyContent: "flex-end" }}>
        <div style={{ height: dotH, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          {strokes > 0 && <span style={{ color: colorOverride || BC.hcpBlue, fontSize: FS.label, fontWeight: 900, letterSpacing: 1, lineHeight: 1 }}>{"•".repeat(strokes)}</span>}
        </div>
        <div style={{ width: sh, height: sh, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: BC.t3 + ALPHA.hair, fontSize: size, lineHeight: 1 }}>·</span>
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
        {strokes > 0 && <span style={{ color: colorOverride || BC.hcpBlue, fontSize: FS.label, fontWeight: 900, letterSpacing: 1, lineHeight: 1 }}>{"•".repeat(strokes)}</span>}
      </div>
      <div style={{ position: "relative", width: sh, height: sh, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {border}
        <span style={{ position: "relative", zIndex: 1, fontSize: size, fontWeight: 700, lineHeight: 1, color: colorOverride || BC.t1, transform: "translateY(0.5px)" }}>{score}</span>
      </div>
    </div>
  );
};


// ── Login Screen ──
function LoginScreen({ players, onLogin, teams, darkMode, tournamentName, tournamentLocation }) {
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (search === DIRECTOR_CODE) {
      onLogin({ player_id: "bootstrap_director", name: "Director (Setup)", team: null, isDirector: true });
    }
  }, [search]);

  // Mash Brothers has TWO logo variants — one designed to be displayed
  // on a black background (the original, with the green flag/white
  // type), and one designed for a white/light background. Picking the
  // right variant per theme is important: the on-black logo loses its
  // outline definition against the cream paper of light mode, and the
  // on-white logo's dark elements disappear against dark-mode charcoal.
  // Shot Callers ships a single logo so it isn't theme-swapped.
  // Names/logos come from the resolved `teams`. For team A's DEFAULT (Mash)
  // logo we swap in the light-bg variant in light mode; an imported custom
  // logo (a data URL) is used as-is in both modes.
  const customLogoA = typeof teams.A.logo === "string" && teams.A.logo.startsWith("data:");
  const teamA = { ...teams.A, logo: customLogoA ? teams.A.logo : (darkMode ? LOGO_TEAM_A : LOGO_TEAM_A_WHITE) };
  const teamB = teams.B;

  const teamAPlayers = players.filter(p => p.team === "A");
  const teamBPlayers = players.filter(p => p.team === "B");

  const filterPlayers = (list) => list;

  const PlayerBtn = ({ p, team }) => (
    <button onClick={() => onLogin(p)} style={{
      width: "100%", padding: "clamp(8px, 2.5vw, 12px) clamp(10px, 3vw, 14px)", background: team.color + ALPHA.tint,
      border: `1px solid ${team.accent}${ALPHA.hair}`, borderRadius: 6,
      color: BC.t2, fontSize: `clamp(${FS.small}px, 3.8vw, ${FS.body}px)`, fontWeight: 600, cursor: "pointer", textAlign: "center",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
    }}>
      <span style={{ flex: 1, lineHeight: 1.3 }}>{p.name}</span>
    </button>
  );

  return (
    <div style={{ height: "100dvh", background: BC.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 10px", fontFamily: FONT, position: "relative", overflow: "hidden" }}>
      {/* Silhouette — fixed full-screen background */}
      <img src={TROPHY_SILHOUETTE} alt="" style={{
        position: "fixed", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        width: "100%", height: "100%",
        objectFit: "contain", opacity: 0.28, filter: "brightness(1.4) contrast(1.2)", pointerEvents: "none", userSelect: "none", zIndex: 0,
      }} />

      {/* Title — sits above the silhouette, outside content card */}
      <div style={{ textAlign: "center", position: "relative", zIndex: 1, marginBottom: 14 }}>
        <div style={{ fontSize: `clamp(${FS.title}px, 8vw, ${FS.hero}px)`, fontWeight: 800, color: BC.gold, letterSpacing: 2 }}>{(tournamentName || TOURNAMENT_TITLE).toUpperCase()}</div>
        <div style={{ fontSize: `clamp(${FS.label}px, 3vw, ${FS.small}px)`, color: BC.t3, letterSpacing: "0.3em", marginTop: 3 }}>{getTournamentYear()} {(tournamentLocation || TOURNAMENT_LOCATION).toUpperCase()}</div>
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
              <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "clamp(3px, 1vw, 6px)", background: BC.card + ALPHA.panel, border: `1px solid ${team.accent}${ALPHA.line}`, borderTop: `2px solid ${team.accent}`, borderRadius: 10, padding: "clamp(4px, 1.5vw, 8px)" }}>
                {teamPlayers.length === 0
                  ? <div style={{ textAlign: "center", color: BC.t3, fontSize: FS.small, padding: "12px 4px" }}>No players</div>
                  : teamPlayers.map(p => <PlayerBtn key={p.player_id} p={p} team={team} />)
                }
              </div>
            </div>
          );
        })}
      </div>

      {players.length === 0 && (
        <div style={{ textAlign: "center", color: BC.t3, padding: 16, fontSize: FS.small, position: "relative", zIndex: 1, marginTop: 12 }}>
          No players yet. Type <span style={{ color: BC.amber, fontWeight: 700 }}>{DIRECTOR_CODE}</span> to set up.
        </div>
      )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  The round gate
// ══════════════════════════════════════════════════════════════════
//
// The Scoring tab accepts entries for exactly ONE round: the current one —
// the lowest round the director has not finalized (lib/roundLocks.
// currentRoundNumber). Every other round is closed, and the tab does not
// show them at all: a strip of chips that only ever answered a tap with a
// toast cost a row of vertical space on the screen where space is scarcest.
// The empty states below name the live round instead, which is the only
// part of that strip anybody needed.
//
// The problem is mundane and expensive. Four players stand on a tee with
// their phones out; the tab used to open on whichever of their matches
// sorted first and offered a Rd 1 / Rd 2 / Rd 3 selector next to it. A score
// typed into the wrong round does not announce itself — it lands in a round
// that finished yesterday, silently moves a hole, and the first anyone hears
// of it is a leaderboard that no longer matches the handshake on 18.
//
// A round leaves the current slot when a human says it is over, and for no
// other reason: the director finalizes it, which freezes it (roundLocks
// `final`) and opens the next one for everybody at once. Nothing here keys
// off the clock or off "all the scores look in" — that would put the gate
// back at the mercy of the same accident it exists to prevent.
//
// This gate is the client's. The Firestore rules are open to anyone inside
// the tournament window (see firestore.rules), so it stops accidents, not a
// determined writer — which is exactly the threat model the director
// described.

// The Finalize control is NOT on this screen. It used to be a card pinned
// under the player cards for the whole round; it now lives in an app-level
// notification plus a modal sheet — see components/FinalizeRound.jsx for
// what was wrong with the card and what replaced it.


// ── Score Entry ──
// The app's scoring vocabulary (hole strip, deep-green Par/Hole/HCP banner,
// two-row match status bar, vertically-stacked PlayerScoreCards with stroke
// dots and net display, par-relative score buttons with auto-shift,
// auto-advance with toast) on top of the per-round / per-match /
// multi-format data model. Receives `matches` (from bc_matches) and
// `holeData` (from bc_holes), and leans on computeMatchResult /
// calcCHForCourse for the math.
//
// The round selector this view used to carry is gone: entry is gated to the
// current round (see "The round gate" above), so there is nothing left to
// select between and no strip of rounds at the top either.
function ScoreEntry({ user, matches, holeData, onSaveHole, tPlayers, courses, tRounds, notify, teams, hcpOverrides, teeAssignments, roundLocks, rounds, currentRound, ctpData, onSetCtp }) {
  const userPid = user.player_id;
  // This screen is worked from, not read down — four players' scores have to
  // be reachable without scrolling to the one at the bottom. It measures the
  // room it has and sizes its parts to fit. See lib/useFitDensity.
  const fitRef = useRef(null);
  const { sizes: fit } = useFitDensity(fitRef);
  // THE GATE. Only the current round's matches exist as far as this screen
  // is concerned — a match from a finalized round is not merely hidden, it
  // is not reachable, so no stale selection can put a score in it.
  const myMatches = useMemo(
    () => matches.filter(m => m.round === currentRound && [...m.teamA, ...m.teamB].includes(userPid)),
    [matches, currentRound, userPid]
  );

  // ── Hooks (always fire, in stable order) ──
  const [activeMatchId, setActiveMatchId] = useState(null);
  const [showScorecard, setShowScorecard] = useState(false);
  // Closest-to-the-pin prompt — the 0-based index of the par 3 it is asking
  // about, or null. `promptedCtp` is the session guard that keeps it to ONE
  // automatic appearance per round+hole (see maybePromptCtp); tapping the
  // par-3 CTP chip re-opens it deliberately and ignores the guard.
  const [ctpPrompt, setCtpPrompt] = useState(null);
  const promptedCtp = useRef({});

  // Resolved, not stored — the selection is re-derived from the matches the
  // gate currently allows. When a round is finalized under a player's feet,
  // a held `activeMatchId` simply stops matching and the screen falls to the
  // new round's match instead of scoring into the closed one.
  const match = myMatches.find(m => m.id === activeMatchId) || myMatches[0] || null;
  const tr = match ? tRounds.find(t => t.round_number === match.round) : null;
  // Round handicap lock (src/lib/roundLocks.js). When present, the course
  // pointer and the hole tables come from the snapshot so this screen shows
  // exactly the strokes the leaderboard is scoring with — not a fresh
  // derivation off whatever the course/handicap data says right now.
  const lock = match ? lockForRound(roundLocks, match.round) : null;
  const course = (lock || tr) ? courses.find(c => c.id === (lock?.course_id || tr?.course_id)) : null;
  const format = tr?.format || DEFAULT_FORMAT;
  // Per-round default tee — used as a per-player fallback in stroke maps
  // below. Per-player assignments from `teeAssignments[round][pid]` take
  // precedence; this is the "everyone is on the same tee" default.
  const roundTee = tr?.tee_box;
  const holePars = resolveHolePars(course, lock);
  const holeHcps = resolveHoleHcps(course, lock);

  // The seam useHoleAdvance is built around. This screen keeps scores in
  // holeData under `pid_round`, but the hole machinery never sees that shape —
  // it gets a reader that reduces to "give me one player's gross on one hole",
  // which is the only thing it ever needed to know.
  const result = useMemo(
    () => match ? computeMatchResult(match, holeData, courses, tRounds, tPlayers, format, hcpOverrides, undefined, teeAssignments, roundLocks) : null,
    [match, holeData, courses, tRounds, tPlayers, format, hcpOverrides, teeAssignments, roundLocks]
  );

  // scoresAt takes the ROUND, not the match: the reader it returns is handed
  // to useHoleAdvance and kept in a ref there, and a closure over the whole
  // match object is enough for React Compiler to give up memoizing this
  // component. A round number cannot be mutated behind its back.
  const pidsOf = (m) => (m ? [...m.teamA, ...m.teamB] : []);
  const scoresAt = (rnd) => (pid, h) => (rnd == null ? 0 : (holeData[`${pid}_${rnd}`] || {})[h] || 0);
  const matchPids = pidsOf(match);
  const getScore = scoresAt(match?.round ?? null);

  // Which hole is showing, when it moves on by itself, and the toast during
  // the wait — see lib/useHoleAdvance.
  const { activeHole, goToHole, toast, positionOn } =
    useHoleAdvance({ matchId: match?.id ?? null, pids: matchPids, getScore });

  const par = holePars[activeHole];
  const hcp = holeHcps[activeHole];

  // Per-player stroke maps for this match come straight from the result the
  // leaderboard is computed with (computeMatchResult now exposes them), so the
  // dots on the scoring screen and the strokes in the leaderboard math can
  // never diverge — one allocation, one source.
  const strokeMaps = result?.strokeMaps || {};

  // No more hooks below this line.

  // `1 0 auto` — grow to fill the view, never shrink below content. The
  // screen therefore fills a tall phone and, if even the tight density can't
  // fit a short one, spills into a normal scroll rather than clipping a
  // player card off the bottom.
  //
  // Nothing director-only hangs off the bottom of this any more: the whole
  // height belongs to the four player cards. See the note above ScoreEntry.
  const shell = (children) => (
    <div ref={fitRef} style={{
      fontFamily: FONT,
      display: "flex", flexDirection: "column", flex: "1 0 auto", minHeight: 0,
    }}>
      {children}
      <Toast message={toast} />
    </div>
  );
  const empty = (icon, title, sub) => shell(
    <div style={{ textAlign: "center", padding: "40px 20px", color: BC.t3 }}>
      <div style={{ fontSize: FS.display, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: FS.body, fontWeight: 700, color: BC.t2, marginBottom: 4 }}>{title}</div>
      {sub && <div style={{ fontSize: FS.small, lineHeight: 1.45 }}>{sub}</div>}
    </div>
  );

  // Nothing is open for scoring: either the schedule hasn't been built yet,
  // or the director has finalized the last round and the event is over.
  if (currentRound == null) return rounds.length === 0
    ? empty("⛳", "No rounds set up yet", "The tournament schedule hasn't been built.")
    : empty("🏆", "The tournament is over", "Every round is final. Head to the Leaderboard for the result.");

  if (!match) return empty(
    "⛳",
    `You're not in a Round ${currentRound} match`,
    myMatches.length === 0 && matches.some(m => [...m.teamA, ...m.teamB].includes(userPid))
      ? `Scoring is open for Round ${currentRound} only. Your other rounds are on the Matches tab.`
      : "Check the Matches tab once the draw is made."
  );

  if (!course) return empty("⛳", `Round ${match.round} course not configured yet`);

  const { A: tA, B: tB } = teams;

  // ── Closest-to-the-pin ───────────────────────────────────────────────
  // The hole's standing tag, live from Firestore. `null` until some group
  // has claimed it.
  const ctpFor = (h) => ctpData?.[`${match.round}_${h}`] || null;

  // Ported from MNQ: when the score just entered completes a par 3 for THIS
  // group, pop the tag popup on the device that entered it. Every group gets
  // the prompt as they walk off the green — an earlier group's tag shows in
  // the popup as the number to beat, so a group either claims the hole or
  // dismisses with "our group wasn't closer" and leaves it standing.
  //
  // Guards, in the order they matter:
  //   • a real score on a par 3 — clearing a score never opens it
  //   • the write must be the incomplete→complete TRANSITION: the tapping
  //     player had nothing on the hole yet, and everyone else already did.
  //     Without this, every later correction on a finished par 3 re-prompts.
  //   • once per round+hole per session, so a cleared-and-re-entered score
  //     doesn't ask twice
  //   • never once the director has settled the hole (approved) — that tag
  //     is the result, not a running claim
  const maybePromptCtp = (pid, h, score, priorScore) => {
    if (score <= 0) return;
    if ((holePars[h] || 4) !== 3) return;
    if (priorScore > 0) return;
    const key = `${match.round}_${h}`;
    if (promptedCtp.current[key]) return;
    if (ctpFor(h)?.approved) return;
    if (!matchPids.every(p => p === pid || getScore(p, h) > 0)) return;
    promptedCtp.current[key] = true;
    setCtpPrompt(h);
  };

  // Provisional by definition — `approved: false`. The director settles the
  // hole from Betting → CTP, and only that write freezes it.
  const saveCtp = async (winnerPid, feet) => {
    const h = ctpPrompt;
    setCtpPrompt(null);
    await onSetCtp(match.round, h, winnerPid, { distanceFt: feet, approved: false, taggedBy: userPid });
    const nm = tPlayers.find(p => p.player_id === winnerPid)?.name || "";
    // Through notify(), not the hole-advance toast: tagging a CTP is ordinary
    // app feedback, not part of the "this hole is done" sequence.
    notify(`🎯 CTP tagged — hole ${h + 1} · ${nm} ${feet} ft`);
  };

  // ScoreButtonRow hands back the new gross directly (0 = cleared, which it
  // sends when the active button is tapped again), so no toggle logic here.
  const onTapScore = async (pid, score) => {
    // Read the hole and the player's existing score BEFORE the write —
    // the CTP trigger below needs to know this was a first entry, and
    // auto-advance can move activeHole while the save is in flight.
    const h = activeHole;
    const prior = getScore(pid, h);
    await onSaveHole(pid, match.round, h, score || null, tr?.course_id);
    maybePromptCtp(pid, h, score || 0, prior);
  };

  // Status cell rendering — for the two-row match status bar between
  // the front and back hole strips. Each cell says two things about its hole:
  //
  //   the FILL BAR — who took that hole, in team colors, drawn by the shared
  //     holeFill() the Leaderboard's hole strip uses. On Double Dot a hole
  //     can be split, and the diagonal says how: solid for both dots, half
  //     and half for one each, half against grey for a lone dot, grey when
  //     both were tied away.
  //   the GLYPH — where the match stands after that hole, from the reader's
  //     own team's perspective: ▲N ahead, ▼N behind, TIED level.
  //
  // The two are deliberately in different currencies. The bar is about one
  // hole and belongs to a team; the glyph is about the whole match so far and
  // belongs to you, which is why it stays green/red rather than team-colored.
  //
  // WHAT the glyph counts follows the round's scoring type, and comes from
  // the same segmentState() the engine awards points from — holes up on a
  // Match round, the lead on the running total on a Total one. It used to
  // count holes won unconditionally, so a Total round showed a match-play
  // state it wasn't being scored on.
  const userTeam = match.teamA.includes(userPid) ? "A" : "B";
  // The hole-scoring axis is read off `scoredFormat` below rather than from a
  // flag here: the badge names the METHOD a hole was scored by, and since a
  // format can now offer more than one, "was it best ball" is no longer the
  // question — "which of its methods" is.
  const { formOfPlay } = resolveScoring(match);
  const totalScored = formOfPlay === SCORING_TYPE_TOTAL;
  const perHoleScored = formOfPlay === SCORING_TYPE_POINTS;
  // The format the holes in `result` were ACTUALLY scored under. Anything that
  // reads a hole's numbers has to ask for this rather than the round format: a
  // best-ball override hands back net strokes whatever the format says, and
  // holeFill would read a Double Dot round's net 4 and 5 as "one dot each" —
  // painting every played hole as a split when nothing was split at all.
  const scoredFormat = holeFormatFor(match, format);
  // The same flags the engine scored with, from the same helper — the status
  // strip below counts whatever the round is actually settled on.
  const segOpts = segmentOptsFor({ ...match, hole_points: result?.holePoints }, format);
  const renderStatusCell = (i) => {
    // Same reasoning as the Leaderboard strip's cell height: the bar has to
    // be tall enough for a split hole's diagonal to read, and it stays that
    // height for every format so the strip never changes shape between rounds.
    const cellH = fit.statusCell, barH = fit.statusBar;
    const colBorder = { borderRight: i % 9 === 8 ? "none" : `1px solid ${BC.bdr}${ALPHA.hair}` };
    const shell = (children) => (
      <div key={i} style={{
        flex: 1, minWidth: 0, height: cellH, ...colBorder,
        display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, padding: "0 3px",
      }}>{children}</div>
    );
    if (!result || !result.holes[i]) return shell(null);

    const hr = result.holes[i];
    // Partial-score warning for non-active past holes
    if (!hr.played) {
      const someScored = matchPids.some(pid => getScore(pid, i) > 0);
      if (someScored && i !== activeHole) {
        return shell(<div title="Missing score" style={{ textAlign: "center", fontSize: FS.small, opacity: 0.55, lineHeight: 1 }}>⚠️</div>);
      }
      return shell(null);
    }

    const aLead = segmentState(result.holes.slice(0, i + 1), segOpts).margin;
    const fromUserView = userTeam === "A" ? aLead : -aLead;
    const color = fromUserView > 0 ? BC.green : fromUserView < 0 ? BC.danger : BC.t3;
    return shell(
      <>
        <div style={{ height: barH, borderRadius: 3, boxSizing: "border-box", ...holeFill(hr, scoredFormat) }} />
        <div style={{ textAlign: "center", fontSize: FS.body, fontWeight: 800, color, lineHeight: 1 }}>
          {fromUserView > 0 ? <>▲{fromUserView}</>
            : fromUserView < 0 ? <>▼{Math.abs(fromUserView)}</>
            : <span style={{ fontSize: FS.micro, fontWeight: 700, letterSpacing: 0.5 }}>TIED</span>}
        </div>
      </>
    );
  };

  // Hole-strip cell — geometry and states lifted from MNQ: 32px tall, the
  // completed state a tinted chip with an accent border (not a solid fill),
  // the current hole a solid accent chip with an outline ring. BC keeps one
  // extra state MNQ has no need for — `partial`, for a hole where some but
  // not all four players are in, which matters over 18 holes.
  const renderHoleCell = (h) => {
    const cur = h === activeHole;
    const allScored = matchPids.every(pid => getScore(pid, h) > 0);
    const partial = !allScored && matchPids.some(pid => getScore(pid, h) > 0);
    return (
      <button key={h} onClick={() => goToHole(h)} style={{
        flex: 1, height: fit.holeCell, borderRadius: allScored || cur ? 8 : 6,
        border: allScored && !cur ? `1.5px solid ${BC.amber}${ALPHA.line}` : "none",
        background: cur ? BC.amber : allScored ? BC.amber + ALPHA.wash : partial ? BC.amber + ALPHA.wash : BC.card,
        color: cur ? ON_AMBER : allScored ? BC.amber : BC.t3,
        fontSize: fit.holeFont, fontWeight: 700, cursor: "pointer",
        outline: cur ? `2px solid ${BC.amber}` : "none", outlineOffset: 1,
      }}>{h + 1}</button>
    );
  };

  return shell(
    <>
      {/* Match selector — for the rare format that draws a player into more
          than one match in the SAME round. It no longer crosses rounds; the
          strip above owns that axis and only one round of it is live. */}
      {/* Labelled with the cup's number for each match, not its position in
          this player's own list — two players in the same match have to be
          looking at the same name for it. Position the incoming match in the
          same render as the switch; leaving it to the effect below would paint
          the outgoing hole for a frame first, the same flash returning to the
          tab had. */}
      {myMatches.length > 1 && (
        <SegmentedToggle
          variant="pills"
          style={{ marginBottom: 10 }}
          options={myMatches.map((m, i) => [m.id, `Match ${m.matchNumber ?? i + 1}`])}
          value={match.id}
          onChange={(id) => {
            const m = myMatches.find(x => x.id === id);
            setActiveMatchId(id);
            if (m) positionOn(id, pidsOf(m), scoresAt(m.round));
          }}
        />
      )}

      {/* Front 9 — hole strip + status row. */}
      <div style={{ display: "flex", gap: 3, marginBottom: 2, flexShrink: 0 }}>
        {Array.from({ length: 9 }, (_, i) => renderHoleCell(i))}
      </div>
      <div style={{ display: "flex", marginBottom: fit.stack, flexShrink: 0, background: BC.card, border: `1px solid ${BC.bdr}${ALPHA.line}`, borderRadius: 8, padding: `${fit.statusPad}px 0`, alignItems: "center" }}>
        {Array.from({ length: 9 }, (_, i) => renderStatusCell(i))}
      </div>

      {/* Back 9 — hole strip + status row. */}
      <div style={{ display: "flex", gap: 3, marginBottom: 2, flexShrink: 0 }}>
        {Array.from({ length: 9 }, (_, i) => renderHoleCell(i + 9))}
      </div>
      <div style={{ display: "flex", marginBottom: fit.stack, flexShrink: 0, background: BC.card, border: `1px solid ${BC.bdr}${ALPHA.line}`, borderRadius: 8, padding: `${fit.statusPad}px 0`, alignItems: "center" }}>
        {Array.from({ length: 9 }, (_, i) => renderStatusCell(i + 9))}
      </div>

      {/* Full Scorecard — sits ABOVE the hole banner (MNQ's placement) so
          it's reachable without scrolling past four player cards. Slim
          bar styling keeps the vertical cost near zero. */}
      <button onClick={() => setShowScorecard(true)} style={{
        width: "100%", padding: fit.scorecardPad, borderRadius: 8, marginBottom: fit.stack,
        cursor: "pointer", flexShrink: 0,
        background: BC.card, border: `1px solid ${BC.bdr}${ALPHA.line}`, color: BC.t2,
        fontSize: FS.small, fontWeight: 700, letterSpacing: 0.5,
      }}>
        Full Scorecard
      </button>

      <HoleNavigator hole={activeHole} par={par} hcp={hcp} onGo={goToHole} sizes={fit.nav} />

      {/* Format / round badge — small sticker between banner and player cards.
          Tells the user what scoring format their entries are being judged
          against. Useful since this app supports multiple formats per round. */}
      <div style={{ fontSize: FS.label, color: BC.t3, fontWeight: 700, letterSpacing: 1, padding: "2px 4px", marginBottom: fit.stack, flexShrink: 0, display: fit.badge ? "block" : "none" }}>
        {(FORMATS.find(f => f.id === format)?.label || "MATCH PLAY").toUpperCase()}
        {" · "}
        {/* A best-ball override changes what the format's name means, so it is
            named FIRST when it applies — the row then reads in the order the
            round is actually scored: how a hole is made, then how it settles.
            The status strip above is counting whichever this says. */}
        {scoredFormat !== format && HOLE_METHOD_LABELS[scoredFormat]
          ? `${HOLE_METHOD_LABELS[scoredFormat].toUpperCase()} · ` : ""}
        {perHoleScored ? `${result?.holePoints ? (activeHole < 9 ? result.holePoints.front : result.holePoints.back) : "?"} PT HOLE`
          : totalScored ? `TOTAL ${totalUnit(scoredFormat).toUpperCase()}`
          : "MATCH PLAY"}
        {" · ROUND "}{match.round}
        {/* Which match of the week this is. Numbered across the whole
            schedule, so it is the one label that identifies this match
            without naming the players. */}
        {match.matchNumber ? ` · MATCH ${match.matchNumber}` : ""}
        {/* On Team Best Ball the badge is incomplete without the count: this
            card is worth posting because it might be one of the six that
            count, and how many that is can change hole to hole. Read off the
            result so it can't disagree with what the strip above is showing. */}
        {result?.counting && ` · BEST ${result.counting[activeHole]}`}
      </div>

      {/* Par-3 CTP chip — the standing closest-to-the-pin for this hole,
          and the way back into the tag popup. The automatic prompt fires
          once per hole per session, so without this a group that dismissed
          it (or measured a second ball after) would have no way to claim
          the hole. Reads as a plain badge, not a control, once the
          director has settled the hole. */}
      {par === 3 && (() => {
        const rec = ctpFor(activeHole);
        const nm = rec?.player_id ? (tPlayers.find(p => p.player_id === rec.player_id)?.name || "—") : null;
        const settled = rec?.approved === true;
        const label = nm
          ? `🎯 CTP — ${nm}${rec.distance_ft ? ` · ${rec.distance_ft} ft` : ""}${settled ? "" : " · tap to beat it"}`
          : "🎯 Tag closest to the pin";
        const style = {
          width: "100%", padding: "6px 10px", borderRadius: 8, marginBottom: fit.stack, textAlign: "left", flexShrink: 0,
          background: nm ? BC.amberGlow : BC.card,
          // One alpha, applied once. This used to read `${nm ? BC.amber +
          // "55" : BC.bdr}60`, which on the tagged branch concatenated both
          // bytes into a ten-character hex — not a colour, so that border
          // silently did not render at all.
          border: `1px solid ${nm ? BC.amber : BC.bdr}${ALPHA.line}`,
          color: nm ? BC.amber : BC.t3,
          fontSize: FS.label, fontWeight: 700, letterSpacing: 0.5,
        };
        return settled
          ? <div style={style}>{label}</div>
          : <button onClick={() => setCtpPrompt(activeHole)} style={{ ...style, cursor: "pointer" }}>{label}</button>;
      })()}

      {/* Player score cards — 4 stacked, T1 above dashed divider, T2 below.
          Each shows one header row — name, (CH), stroke dots on the left,
          "Net ±X thru N" right-aligned — then a row of par-relative score
          buttons. Tap a saved score again to clear. */}
      <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: fit.cardGap }}>
        {[...match.teamA, "DIVIDER", ...match.teamB].map((pid, idx) => {
          if (pid === "DIVIDER") return <div key="div" style={{ borderTop: `1px dashed ${BC.bdr}`, flexShrink: 0, margin: `${fit.cardGap}px 0` }} />;
          const tp = tPlayers.find(t => t.player_id === pid);
          const team = match.teamA.includes(pid) ? "A" : "B";
          const tc = team === "A" ? tA : tB;
          const cur = getScore(pid, activeHole);
          const strokes = strokeMaps[pid]?.[activeHole] || 0;
          // CH for display — per-player tee assignment overrides round default,
          // matching the strokeMaps memo above and computeMatchResult.
          const hi = getRoundHI({ roundLocks, round: match.round, pid, players: tPlayers });
          const playerTee = getRoundTee({ roundLocks, round: match.round, pid, teeAssignments, roundTee });
          const fullCH = getRoundCH({
            roundLocks, round: match.round, pid, players: tPlayers,
            course, chOverrides: hcpOverrides, teeAssignments, roundTee,
          });
          // Show the number the dots were actually allocated from. On a round
          // with a handicap allowance that is the reduced PLAYING handicap,
          // not the full Course Handicap — printing the full figure beside
          // three-quarters of the dots is how a player concludes the app has
          // shorted them. The full CH stays available on the tooltip.
          const playingCH = result?.playingCH?.[pid];
          const ch = playingCH ?? fullCH;
          const reduced = playingCH != null && playingCH !== fullCH;
          const chTitle = reduced
            ? `Playing handicap ${ch} — ${describeAllowance(result?.allowance)} allowance off a Course Handicap of ${fullCH}`
            : `Course Handicap ${ch}`;
          // Running net to par for this player thru holes scored
          let netToPar = 0, thru = 0;
          for (let h = 0; h < 18; h++) {
            const s = getScore(pid, h);
            if (s > 0) {
              const st = strokeMaps[pid]?.[h] || 0;
              netToPar += (s - st) - holePars[h];
              thru = h + 1;
            }
          }

          return (
            <div key={pid} style={{
              background: BC.card, borderRadius: 10, padding: fit.cardPad,
              flex: "1 1 0", minHeight: 0, maxHeight: fit.cardMax, display: "flex", flexDirection: "column",
              border: `1px solid ${BC.bdr}`,
            }}>
              {/* Header row — name + (CH) + stroke dots clustered tight on
                  the LEFT, so the handicap context reads as attached to the
                  player it describes, and the running Net pushed to the far
                  RIGHT of the same row. The Net used to sit on a line of its
                  own beneath; folding it up here buys back a row per card,
                  which over four cards is most of the difference between the
                  scoring screen fitting a phone and having to be scrolled. */}
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 3, minWidth: 0, flexShrink: 0 }}>
                <span style={{ fontSize: FS.body, fontWeight: 700, color: BC.t1, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flexShrink: 1 }}>{tp?.name || pid}</span>
                <span title={chTitle} style={{ fontSize: FS.small, fontWeight: 700, color: BC.hcpBlue, flexShrink: 0 }}>
                  ({ch}{reduced ? "*" : ""})
                </span>
                {strokes > 0 && (
                  <span style={{ color: BC.hcpBlue, fontSize: FS.small, letterSpacing: 1, flexShrink: 0, lineHeight: 1 }}>
                    {"●".repeat(strokes)}
                  </span>
                )}
                {thru > 0 && (
                  <span style={{ marginLeft: "auto", paddingLeft: 8, fontSize: FS.label, color: BC.t3, lineHeight: 1.1, whiteSpace: "nowrap", flexShrink: 0 }}>
                    Net <strong style={{ color: netToPar < 0 ? BC.danger : netToPar === 0 ? BC.t3 : BC.t1, fontWeight: 700 }}>
                      {fmtScore(netToPar)}
                    </strong> thru {thru}
                  </span>
                )}
              </div>
              {/* Takes the card's remaining height, so the tap targets are
                  as big as the device allows rather than a fixed 44. */}
              <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex" }}>
                <ScoreButtonRow
                  par={par} score={cur} onScore={(v) => onTapScore(pid, v)}
                  fill minHeight={fit.btnMin} fontSize={fit.btnFont} labels={fit.labels}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Scorecard modal — the MNQ-framed card (components/FullScorecard),
          not the Leaderboard's team-only grid: this one is opened by a
          player mid-round, so it shows the four GROSS lines in golf
          notation with their stroke dots, then how the side's number was
          made from them. */}
      {showScorecard && (
        <Popup onClose={() => setShowScorecard(false)} maxWidth={480} padding={0} outerPadding={12}
          innerStyle={{ background: BC.card, border: `1px solid ${BC.amber}${ALPHA.line}`, borderRadius: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: `1px solid ${BC.bdr}` }}>
            <div style={{ fontSize: FS.small, fontWeight: 800, color: BC.amber, letterSpacing: 1 }}>
              SCORECARD — RD {match.round}{match.matchNumber ? ` · MATCH ${match.matchNumber}` : ""}
            </div>
            <button onClick={() => setShowScorecard(false)} style={{
              background: "transparent", border: "none", color: BC.t2, fontSize: FS.title, cursor: "pointer", padding: "0 4px",
            }}>×</button>
          </div>
          <div style={{ padding: 12 }}>
            <FullScorecard
              match={match} result={result} format={format}
              holePars={holePars} holeHcps={holeHcps} course={course}
              teams={teams} tPlayers={tPlayers} getScore={getScore}
              viewer={userTeam}
            />
          </div>
          <button onClick={() => setShowScorecard(false)} style={{
            display: "block", width: "calc(100% - 24px)", margin: "0 auto 12px",
            padding: "10px 0", background: BC.inp, border: `1px solid ${BC.bdr}`,
            borderRadius: 8, color: BC.t2, fontSize: FS.body, fontWeight: 600,
            cursor: "pointer", letterSpacing: 0.4,
          }}>
            Close
          </button>
        </Popup>
      )}

      {/* Closest-to-the-pin — opens itself when this group finishes a par 3
          (see maybePromptCtp) and on demand from the chip above. The four
          names offered are this match's players; a group can only ever tag
          one of its own. */}
      {ctpPrompt != null && (() => {
        const rec = ctpFor(ctpPrompt);
        return (
          <CtpPrompt
            holeNumber={ctpPrompt + 1}
            players={matchPids.map(pid => tPlayers.find(p => p.player_id === pid) || { player_id: pid, name: pid })}
            teams={teams}
            leader={rec}
            leaderName={rec?.player_id ? (tPlayers.find(p => p.player_id === rec.player_id)?.name || "") : ""}
            onSave={saveCtp}
            onClose={() => setCtpPrompt(null)}
          />
        );
      })()}
    </>
  );
  // The auto-advance toast ("✓ Hole 4 saved — advancing…"), which also
  // carries the round strip's explanations, is rendered by `shell` above so
  // every branch of this view gets it.
}


// ── Groups View ──
// The team name over each side of a match card. Small caps in the team's own
// color; `color` is supplied per side by the caller.
const teamTagStyle = {
  fontSize: FS.micro, fontWeight: 800, letterSpacing: 0.8, marginBottom: 3,
  textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden",
  textOverflow: "ellipsis",
};

// The player-facing "Matches" tab. Answers the two questions a player
// actually has on the morning of a round: who am I playing, and when do I
// tee off. The second one comes from the round's playing groups (see
// lib/groups.js) — group i goes off at slot i of the round's tee_time list.
function GroupsView({ matches, tRounds, tPlayers, courses, groups: groupsByRound, teams }) {
  // Every round the director set up in Admin belongs on this tab, drawn or
  // not. Listing only the rounds that already have pairings made a round
  // vanish between "the schedule is set" and "the draw is made", which is
  // exactly the window in which a player goes looking for it — "Round 3,
  // no pairings yet" is an answer; a missing tab is not. A round carrying
  // matches without a round document still shows, so a pairing can never
  // fall off the schedule either.
  const rounds = useMemo(() => {
    const seen = new Set([
      ...tRounds.map(t => t.round_number),
      ...matches.map(m => m.round),
    ]);
    return [...seen].filter(r => r != null).sort((a, b) => a - b);
  }, [tRounds, matches]);

  // The selection is RESOLVED rather than stored: the rounds arrive from
  // Firestore after the first render, so a `useState(rounds[0])` seed pins
  // the tab to whatever was known at mount — Round 1 on an empty cache,
  // even for a tournament whose schedule starts somewhere else. Holding the
  // director's tap and falling back to the first live round also survives a
  // round being deleted while it is on screen.
  const [pickedRound, setPickedRound] = useState(null);
  const activeRound = pickedRound != null && rounds.includes(pickedRound)
    ? pickedRound
    : (rounds[0] ?? 1);
  const rndMatches = matches.filter(m => m.round === activeRound);
  const tr = tRounds.find(t => t.round_number === activeRound);
  const course = courses.find(c => c.id === tr?.course_id);
  const fmt = FORMATS.find(f => f.id === tr?.format);
  // "Best 6 on the front, 7 on the back" — Team Best Ball only, and blank on
  // every other format (resolveCounting hands back null for them).
  const cnt = resolveCounting(tr?.format, tr?.counting_scores);
  // "Best 6 count on the front, 7 on the back" — and when a nine ramps, the
  // per-hole numbers spelled out, because on those years "how many count" is
  // a different answer on the 1st than on the 9th.
  const nineWords = (back) => {
    const flat = countingNine(cnt, back);
    const slice = back ? cnt.slice(9, 18) : cnt.slice(0, 9);
    return flat != null ? `best ${flat}` : `best ${slice.join("/")}`;
  };
  const countingLine = cnt
    ? `Scores that count — front nine: ${nineWords(false)} · back nine: ${nineWords(true)}`
    : null;
  // What a hole is worth, on a round settled hole by hole.
  const holePointsLine = isPointsPerHole(tr?.scoring_type)
    ? (() => {
        const hp = resolveHolePoints(tr?.hole_points);
        return `Every hole is a point — ${hp.front} on the front, ${hp.back} on the back · ${holePointsTotal(hp)} on the round`;
      })()
    : null;

  // Same fallback the admin tab uses: a 2-man format's match is its own
  // foursome, so a round nobody has grouped by hand still has tee times.
  const { groups, times: rawSlots } = roundPlaySetup({
    tr, matches: rndMatches, storedGroups: groupsByRound?.[activeRound],
  });
  const times = rawSlots
    .map(t => { const m = parseTeeTime(t); return m == null ? t : formatTeeTime(m, { ampm: true }); });
  const firstTee = times[0] || "";

  const { nameOf, teamOf } = playerLookup(tPlayers);

  // Matches read best in the order they go off — which is also the order
  // their numbers were handed out in, so the cards below count up.
  const ordered = orderMatchesForRound({ matches: rndMatches, groups, times });

  // A tee sheet only earns its space when the groups aren't just the
  // matches over again — Singles (two matches per foursome) and the team
  // formats (one match over several foursomes).
  const needsTeeSheet = groups.length > 0 && rndMatches.some(m => {
    const pids = [...m.teamA, ...m.teamB];
    const idxs = new Set(pids.map(p => groups.findIndex(g => g.includes(p))));
    return idxs.size > 1 || groups.some(g => g.length > pids.length && pids.every(p => g.includes(p)));
  });

  return (
    <div style={{ fontFamily: FONT }}>
      {/* Round selector — pill toggle, deep Mash green for active state.
          Mirrors the Mash visual language used on Scoring + Leaderboard.
          Pinned: this is the control the whole tab is steered from, and a
          reader scrolled deep into Round 2's tee sheet should be able to
          jump to Round 3 without scrolling back for the pills. Lands in the
          same spot as the Leaderboard's cup total and the Admin tab bar. */}
      <StickyTop>
        <SegmentedToggle
          variant="pills"
          options={rounds.map(r => [r, `Rd ${r}`])}
          value={activeRound}
          onChange={setPickedRound}
        />
      </StickyTop>

      {/* Course / format / tee-time banner — uses the TEAMS-banner style
          (Mash green fill, white centered text) for the section header,
          with details below. Anchors the round visually in the same
          visual language as the Leaderboard's TEAMS card. */}
      <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, marginBottom: 12, overflow: "hidden" }}>
        <Banner>ROUND {activeRound}</Banner>
        <div style={{ padding: "10px 14px" }}>
          <div style={{ fontSize: FS.body, fontWeight: 700, color: BC.t1 }}>{course?.name || "Course TBD"}</div>
          {fmt && <div style={{ fontSize: FS.small, color: BC.t3, marginTop: 2 }}>{fmt.label}{fmt.desc ? ` · ${fmt.desc}` : ""}</div>}
          {/* On Team Best Ball the format's own description can't say what the
              round actually counts — that number is per round. Stated here so a
              player reading the tee sheet knows whether their card has to be
              one of six or one of seven. */}
          {countingLine && <div style={{ fontSize: FS.small, color: BC.amber, marginTop: 2, fontWeight: 700 }}>{countingLine}</div>}
          {holePointsLine && <div style={{ fontSize: FS.small, color: BC.amber, marginTop: 2, fontWeight: 700 }}>{holePointsLine}</div>}
          {firstTee && <div style={{ fontSize: FS.small, color: BC.amber, marginTop: 4, fontWeight: 700 }}>First Tee: {firstTee}</div>}
        </div>
      </div>

      {/* A set-up round with no draw yet. The round's own card above still
          shows the course, format and first tee — the only thing missing is
          who plays who, so that is the only thing this says. */}
      {rndMatches.length === 0 && (
        <div style={{
          background: BC.card, borderRadius: 12, border: `1px dashed ${BC.bdr}`,
          padding: "28px 20px", textAlign: "center",
          fontSize: FS.small, fontWeight: 700, letterSpacing: 0.4, color: BC.t3,
        }}>
          No pairings yet
        </div>
      )}

      {/* Match cards — same visual identity as the Leaderboard cards: team A
          always the left column behind its own color rail, team B always the
          right. The rails and the team labels are the TEAM colors (which
          follow each team's logo — see theme.js `withBrand`), not the
          tournament chrome, so a player finds their side by color here the
          same way they do on the board. */}
      {ordered.map((m, i) => {
        const teeTime = teeTimeForMatch({ groups, times, match: m });
        return (
        <div key={m.id} style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, padding: "12px 14px", marginBottom: 8 }}>
          <div style={{ fontSize: FS.label, color: BC.t3, marginBottom: 8, fontWeight: 800, letterSpacing: 1 }}>
            MATCH {m.matchNumber ?? i + 1}{teeTime ? `  ·  ${teeTime}` : ""}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 10 }}>
            {/* Team A — its color rail LEFT */}
            <div style={{ minWidth: 0, textAlign: "left", borderLeft: `3px solid ${teamColor("A")}`, paddingLeft: 8 }}>
              <div style={{ ...teamTagStyle, color: teamColor("A") }}>{teams?.A?.name || "Team A"}</div>
              {m.teamA.map(pid => (
                <div key={pid} style={{ fontSize: FS.body, fontWeight: 600, color: BC.t1, lineHeight: 1.3 }}>{nameOf(pid)}</div>
              ))}
            </div>
            {/* vs */}
            <div style={{ fontSize: FS.small, color: BC.t3, fontWeight: 700, padding: "0 4px" }}>vs</div>
            {/* Team B — its color rail RIGHT */}
            <div style={{ minWidth: 0, textAlign: "right", borderRight: `3px solid ${teamColor("B")}`, paddingRight: 8 }}>
              <div style={{ ...teamTagStyle, color: teamColor("B") }}>{teams?.B?.name || "Team B"}</div>
              {m.teamB.map(pid => (
                <div key={pid} style={{ fontSize: FS.body, fontWeight: 600, color: BC.t1, lineHeight: 1.3 }}>{nameOf(pid)}</div>
              ))}
            </div>
          </div>
        </div>
        );
      })}

      {/* Tee sheet — who walks to the first tee together. */}
      {needsTeeSheet && (
        <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, marginTop: 14, overflow: "hidden" }}>
          <Banner>TEE SHEET</Banner>
          {groups.map((g, gi) => (
            <div key={gi} style={{ padding: "9px 14px", borderTop: gi ? `1px solid ${BC.bdr}${ALPHA.line}` : "none", display: "flex", gap: 10, alignItems: "baseline" }}>
              <div style={{ fontSize: FS.small, fontWeight: 800, color: BC.amber, flexShrink: 0, minWidth: 64 }}>{times[gi] || `G${gi + 1}`}</div>
              {/* A group mixes the two sides, so the names carry their own
                  team color as a dot rather than the row carrying one. Reads
                  the 2v2 split of a foursome at a glance. */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 10px", fontSize: FS.small, color: BC.t1, lineHeight: 1.4 }}>
                {g.map(pid => {
                  const tid = teamOf(pid);
                  return (
                    <span key={pid} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{
                        width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                        background: tid ? teamColor(tid) : BC.t3,
                      }} />
                      {nameOf(pid)}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Admin View ──

// ── Round form comparison ──────────────────────────────────────────────
// The Rounds tab auto-saves by diffing the form against Firestore, so both
// sides have to resolve their defaults identically or the tab would write
// on every visit. This mirrors scoring.getRoundHandicapMode, which reads the
// same default off the FORMAT — it used to be `round === 4 ? "full"`, a
// stand-in for "round 4 is the Team Best Ball round" that stopped being true
// the moment a director moved the format somewhere else.
const defaultHandicapMode = (format) => handicapModeFor(format);

// Blank entries are absences, not values: an override the director typed
// and then cleared has to compare equal to one that was never set, or the
// form would stay permanently "dirty" and rewrite itself forever.
const liveEntries = (map) =>
  Object.entries(map || {})
    .filter(([, v]) => v !== "" && v != null)
    .map(([k, v]) => [k, String(v)])
    .sort(([a], [b]) => a.localeCompare(b));

const sameRoundMap = (a, b) => JSON.stringify(liveEntries(a)) === JSON.stringify(liveEntries(b));

// The round's own settings, flattened to a comparable string. Kept apart
// from the two per-round maps because each lives in its own Firestore
// document and they echo back independently. `course_id` is deliberately
// absent — it is set in the Courses tab and only rides along on the write
// so a round save cannot drop it.
const roundSettingsSignature = (r) => JSON.stringify([
  r.format, r.handicap_mode, r.tee_time, r.scoring_type, r.hole_scoring,
  r.nassau_front, r.nassau_back, r.nassau_overall, r.allowance, r.counting_scores,
  r.hole_points, r.par_points,
]);

// The handicap allowance, normalized to the shape the round's FORMAT calls
// for. Both sides of the diff go through this, which is what stops a stale
// low/high pair left behind by a format change from reading as an edit — and
// what lets a round that has never been saved compare equal to its own
// recommended default, so merely opening a round does not write to it.
const roundAllowance = (format, raw) => {
  const a = resolveAllowance(format || DEFAULT_FORMAT, raw);
  if (!a.enabled) return { enabled: false };
  return a.split
    ? { enabled: true, low: a.low, high: a.high }
    : { enabled: true, pct: a.pct };
};

// Team Best Ball's counting scores, normalized the same way and for the same
// reason: `null` on every format that doesn't count, so switching away from
// Team Best Ball drops the counts rather than leaving them to read as an edit
// on a format that has no use for them.
// Stored as the 18-hole array the engine reads, wrapped in the `holes` key the
// document uses. Null on a format that doesn't count, so switching away from
// Team Best Ball drops the counts instead of leaving them to read as an edit
// on a format with no use for them.
const roundCounting = (format, raw) => {
  const counts = resolveCounting(format || DEFAULT_FORMAT, raw);
  return counts ? { holes: counts } : null;
};

// Hole values, normalized the same way, and only on a round that is actually
// settled hole by hole — a Match or Total round has no hole values to store.
const roundHolePoints = (scoringType, raw) =>
  isPointsPerHole(scoringType) ? resolveHolePoints(raw) : null;

// The points-against-par table, on the two formats that have one. Null
// everywhere else, for the same reason the counts are: a table left behind by
// a format change would read as an edit on a format with no use for it — and
// Stableford's rungs are not Tilt's, so carrying one into the other would be
// worse than useless.
const roundParPoints = (format, raw) => resolveParPoints(format, raw);

// The round's hole-scoring method, normalized against what its format actually
// offers, so switching away from a format that HAD a menu cannot leave a
// concrete method behind to read as an edit on one that doesn't.
//
// A format with no menu normally stores the legacy "format" — "its own rule" —
// with ONE exception: a best-ball override that arrived on such a format is
// kept verbatim. That is what a pre-split `scoring_type: "team"` document
// resolves to, and it is actively scoring the round; normalizing it away would
// silently re-score a stored round the moment a director looked at it.
const roundHoleScoring = (format, raw) => {
  const chosen = resolveHoleMethod(format || DEFAULT_FORMAT, raw);
  if (chosen) return chosen;
  return raw === HOLE_SCORING_BEST_BALL ? HOLE_SCORING_BEST_BALL : HOLE_SCORING_FORMAT;
};

// Everything the Rounds tab owns for one round.
const roundSignature = (r) => JSON.stringify([
  roundSettingsSignature(r), liveEntries(r.ch_overrides), liveEntries(r.tee_assignments),
]);

// Adopt a whole per-round document map, optionally holding one round's
// existing slice — see the hydration effects for when that applies.
const adoptRoundMap = (incoming, holdRound) => (prev) => {
  const next = { ...incoming };
  if (holdRound != null && prev[holdRound] !== undefined) next[holdRound] = prev[holdRound];
  return next;
};

// `round` when the arriving slice is exactly what our own last write sent
// for it, otherwise null. Anything else — another director, an edition
// switch — is a value we do not have and must adopt.
const echoedSlice = (written, round, key, incomingSlice) =>
  written && written.round === round && sameRoundMap(written.payload[key], incomingSlice)
    ? round : null;

// ── Rounds form section heading ──
// The round form asks the director six separable questions, and until they
// were grouped it read as one undifferentiated column of gold labels — FORMAT,
// TEE TIMES, COUNTING, SCORING, POINTS, HANDICAP — with nothing to say which
// belonged together or in what order they applied. Worse, two of those labels
// ("SCORING", "POINTS") named the same decision from different angles.
//
// So: a rule and a heading per group, in the order a round is actually
// decided — what is being played, how a hole is scored, how those holes
// settle, what is at stake, what strokes are given, and finally who plays.
// The names are the Rules of Golf's own where golf has one: "form of play" is
// genuinely the term for the match-vs-medal choice, and Medal, Nassau and
// Allowance are already how this app and the tournament's own sheets talk.
//
// `hint` carries the one-line "what does this section decide?" so the controls
// underneath don't each have to re-explain themselves.
//
// The six headings are the same six on every format — a form whose shape moves
// with the format cannot be learned — but what sits UNDER them follows from the
// format, and a section with nothing left to ask states its answer instead of
// going blank. That is the rule the sections are written to: never ask a
// question the format has already answered (Double Dot was being asked whether
// it was a Best Ball round), and never leave one answered off-screen (Medal's
// unit, and the format's recommended allowance, both lived in `title`
// tooltips — which a phone never shows).
function RoundSectionHeading({ children, hint, first }) {
  return (
    <div style={{
      marginTop: first ? 0 : 14, marginBottom: 8,
      paddingTop: first ? 0 : 12,
      borderTop: first ? "none" : `1px solid ${BC.bdr}`,
    }}>
      <div style={{ fontSize: FS.label, fontWeight: 800, letterSpacing: 1.4, color: BC.gold }}>{children}</div>
      {hint && (
        <div style={{ fontSize: FS.label, color: BC.t3, lineHeight: 1.5, marginTop: 3 }}>{hint}</div>
      )}
    </div>
  );
}

// ── CH Delta Popup ── shows stroke change when tee or index changes
function ChDeltaBadge({ delta }) {
  if (delta === undefined || delta === null || delta === 0) return null;
  const up = delta > 0;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 1,
      fontSize: FS.label, fontWeight: 800,
      color: up ? BC.green : BC.danger,
      animation: "fadeIn 0.2s ease",
    }}>
      {up ? "▲" : "▼"}{Math.abs(delta)}
    </span>
  );
}

function AdminView({ user, tPlayers, tRounds, courses, matches, onAddPlayer, onUpdatePlayer, onRemovePlayer, onAddCourse, onSetRound, onSetMatch, holeData, onDiscardRoundScores, teams, teamNames, onSaveTeamNames, brand, onSaveBranding, tournamentName, tournamentLocation, onSaveTournament, hcpOverridesFromDb, teeAssignmentsFromDb, groupsFromDb, onSaveGroups, notify, roundLocks }) {
  const [tab, setTab] = useState("players");
  const [editTeamNames, setEditTeamNames] = useState({ A: "", B: "" });
  const [editingTeam, setEditingTeam] = useState(null);
  // Themed confirmations (replaces window.confirm). Host rendered at the
  // bottom of this view; `confirm(...)` returns a Promise<boolean>.
  const { confirm, confirmModal } = useConfirm();

  useEffect(() => {
    setEditTeamNames({ A: teamNames.A, B: teamNames.B });
  }, [teamNames]);

  // ── Team brand colors (bc_settings/branding) ──
  // Editable hex per team, seeded from the saved branding doc. Empty = fall
  // back to the constants/theme default. Uploading a logo runs the same
  // extractor the theme uses (lib/logoBrand) and drops the dominant color in.
  const [brandEdit, setBrandEdit] = useState({ A: "", B: "" });        // hex color per team
  const [brandLogoEdit, setBrandLogoEdit] = useState({ A: null, B: null }); // uploaded logo data URL per team
  const [brandBusy, setBrandBusy] = useState(null); // team id mid-extraction
  const [editTournamentName, setEditTournamentName] = useState(tournamentName || "");
  const [editTournamentLocation, setEditTournamentLocation] = useState(tournamentLocation || "");
  useEffect(() => { setEditTournamentName(tournamentName || ""); }, [tournamentName]);
  useEffect(() => { setEditTournamentLocation(tournamentLocation || ""); }, [tournamentLocation]);
  useEffect(() => {
    setBrandEdit({ A: brand?.teamA?.color || "", B: brand?.teamB?.color || "" });
    setBrandLogoEdit({ A: brand?.teamA?.logo || null, B: brand?.teamB?.logo || null });
  }, [brand]);
  const isHex = (h) => /^#[0-9a-fA-F]{6}$/.test((h || "").trim());
  const brandSwatch = (tid) => (isHex(brandEdit[tid]) ? brandEdit[tid].trim() : (tid === "A" ? BC.teamA : BC.teamB));
  // Importing a logo both stores the (downscaled) image AND seeds the team
  // color from its dominant hue — one upload configures both.
  const pickLogo = async (tid, file) => {
    if (!file) return;
    setBrandBusy(tid);
    try {
      const { color, logo } = await processLogo(file);
      setBrandEdit(b => ({ ...b, [tid]: color }));
      setBrandLogoEdit(l => ({ ...l, [tid]: logo }));
    } catch { notify?.("Could not read that image", "error"); }
    setBrandBusy(null);
  };
  const brandKey = (tid) => (tid === "A" ? "teamA" : "teamB");
  const savedBrand = (tid) => brand?.[brandKey(tid)] || null;
  const teamBrandDoc = (tid) => {
    const color = isHex(brandEdit[tid]) ? brandEdit[tid].trim() : null;
    const logo = brandLogoEdit[tid] || null;
    return (color || logo) ? { color, logo } : null;
  };
  // The name a card would save: blank falls back to the current name rather
  // than wiping it, so an emptied box is not a change.
  const pendingTeamName = (tid) => (editTeamNames[tid] || "").trim() || teamNames[tid];
  // One Save per card, lit only when that card holds something unsaved. The
  // comparison is against the documents, not against the last save, so a
  // director who types and then undoes it by hand sees the light go out.
  const teamDirty = (tid) => (
    pendingTeamName(tid) !== teamNames[tid]
    || (brandEdit[tid] || "") !== (savedBrand(tid)?.color || "")
    || (brandLogoEdit[tid] || null) !== (savedBrand(tid)?.logo || null)
  );
  // Both teams share one branding document, so the other half is written back
  // from what is already saved rather than from its edit state — otherwise
  // saving one card would quietly commit the other card's pending edits and
  // put out its Save light.
  const saveTeam = async (tid) => {
    const name = pendingTeamName(tid);
    if (name !== teamNames[tid]) await onSaveTeamNames({ ...teamNames, [tid]: name });
    const other = tid === "A" ? "B" : "A";
    await onSaveBranding({
      [brandKey(tid)]: teamBrandDoc(tid),
      [brandKey(other)]: savedBrand(other),
    });
    notify?.(`${name} saved`);
  };

  // Every place outside this console shows "First LastInitial" (e.g. "Kevin J").
  // We persist that as the player's `name` so all existing display code keeps
  // working unchanged; first_name/last_name are the full source of truth,
  // edited only here. Falls back to first-name-only when no last name is set.
  const toDisplayName = (first, last) => {
    const f = (first || "").trim();
    const l = (last || "").trim();
    return l ? `${f} ${l[0].toUpperCase()}` : f;
  };
  const fullName = (p) =>
    (p.first_name || p.last_name)
      ? [p.first_name, p.last_name].filter(Boolean).join(" ").trim()
      : (p.name || "");
  const [courseSearch, setCourseSearch] = useState("");
  const [courseStateFilter, setCourseStateFilter] = useState("MI");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [refetchingTees, setRefetchingTees] = useState(false);
  const [coursePreview, setCoursePreview] = useState(null);
  const [expandedCourse, setExpandedCourse] = useState(null);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef(null);

  const [editRound, setEditRound] = useState(1);
  const [roundFormat, setRoundFormat] = useState("");
  const [roundTeeTime, setRoundTeeTime] = useState("");
  const [hcpOverrides, setHcpOverrides] = useState({});
  const [handicapMode, setHandicapMode] = useState({ 1: "low_man", 2: "low_man", 3: "low_man", 4: "full" }); // per round
  const [chDeltas, setChDeltas] = useState({});
  const [editingPlayer, setEditingPlayer] = useState(null); // { pid, first, last, nick, hi, ov, dir }
  const [teeAssignments, setTeeAssignments] = useState({}); // { round: { pid: teeName } }
  const [nassau, setNassau] = useState(NASSAU_DEFAULT);
  const [scoringType, setScoringType] = useState(SCORING_TYPE_MATCH);
  // The other scoring axis: how a side's number for a hole is made. "format"
  // on the formats that answer it themselves, otherwise the concrete method
  // the director picked off that format's menu ("best_ball", "team_total").
  const [holeScoring, setHoleScoring] = useState(HOLE_SCORING_FORMAT);
  // Raw saved allowance for the round being edited, or null to mean "the
  // format's default". Kept raw ({pct} / {low,high}) so a director who never
  // touches it stores nothing, and a later change to a format's recommended
  // allowance still reaches the rounds nobody edited.
  const [allowance, setAllowance] = useState(null);
  // Raw saved counting scores for the round being edited ({front, back}), or
  // null to mean "the format's default". Same reasoning as the allowance
  // above: a director who never touches it stores nothing.
  const [counting, setCounting] = useState(null);
  // What one hole is worth on each nine, when the round is settled hole by
  // hole. Null means "the default", same as the two above.
  const [holePoints, setHolePoints] = useState(null);
  // What each result against par pays, on the one format whose table is the
  // director's to set. Null means "the default", same as the three above.
  const [parPoints, setParPoints] = useState(null);
  // ── Handicap-lock state ──
  // Read-only here: locking is automatic on the first score of a round (see
  // ensureRoundLock in App). These flags only gate the round form's editing.
  const lockState = roundLockState(roundLocks, editRound);
  const roundIsLocked = lockState !== LOCK_OPEN;
  const roundIsFinal = lockState === LOCK_FINAL;
  // Popup replacement for the old always-visible lock banner: raised when a
  // control in the handicap section is touched on a locked/final round.
  // FINAL blocks the change and warns on every attempt; merely LOCKED lets
  // the change through (it's saved for reference, scoring stays on the
  // snapshot) and warns once per round per visit rather than on every tap.
  const lockWarnedRef = useRef({});
  const warnRoundLocked = () => {
    if (roundIsFinal) {
      confirm({
        title: `Round ${editRound} is final`,
        message: "These fields are read-only. Nothing recalculates a final round.",
        alert: true,
      });
      return true; // block the change
    }
    if (roundIsLocked && !lockWarnedRef.current[editRound]) {
      lockWarnedRef.current[editRound] = true;
      confirm({
        title: `Round ${editRound} is locked`,
        message: "Its handicaps are frozen. Changes here are saved for reference but will not affect its scoring.",
        alert: true,
      });
    }
    return false; // allow the change
  };

  const showChDelta = (key, delta) => {
    if (!delta) return;
    setChDeltas(prev => ({ ...prev, [key]: delta }));
    setTimeout(() => setChDeltas(prev => { const n = {...prev}; delete n[key]; return n; }), 3500);
  };

  // ══ Rounds tab: auto-save ═══════════════════════════════════════════
  // The round form has no Save button — every edit commits on its own.
  // Three rules keep that from becoming a write storm or a data-loss bug:
  //
  //   • Diffed, never fired blindly. `formRound` (what the director sees)
  //     is compared against `storedRound` (what Firestore holds) and a
  //     write happens only when the two disagree. Hydration, switching
  //     rounds and the echo of our own write all land on "equal" and do
  //     nothing — which is also what stops a feedback loop.
  //   • Debounced, and captured. A burst of typing (tee times, nassau
  //     values) collapses into one write, and the payload is snapshotted
  //     when the timer is armed — so leaving the round mid-burst still
  //     writes the round that was edited, not the one now on screen.
  //   • Hydration steps around its own echo, and nothing else. Firestore
  //     values are adopted as they arrive — including the first time,
  //     when an empty form legitimately differs from a document nobody
  //     has read yet — with one exception: a document that is byte-for-
  //     byte what we just sent is not re-applied, so it cannot snap an
  //     input back while the director is still typing into it. Gating
  //     hydration on "is the form dirty" instead would deadlock on that
  //     first load and then write the empty form over real data.
  //
  // A final round is closed: its handicaps are frozen in the snapshot, so
  // nothing is written and the status line says so.

  // What Firestore currently holds for `editRound`, with every default
  // resolved the same way the scoring path resolves it (see enrichedRounds).
  const storedRound = useMemo(() => {
    const tr = tRounds.find(t => t.round_number === editRound) || {};
    const fmt = tr.format || DEFAULT_FORMAT;
    // Both scoring axes read through resolveScoring, so a round still stored
    // with the pre-split `scoring_type: "team"` seeds the form as Match +
    // Best Ball, and rewrites itself into the two fields on the next save.
    // Reading `tr.scoring_type` raw here left "team" in the form, where no
    // Form of Play pill matched it and the Best Ball toggle read Off.
    //
    // A round that names no form of play takes its FORMAT's, which is the
    // whole point of having one — a scramble opens on Total, a Team Best Ball
    // on Points. A round that names one keeps it, unless its format cannot
    // score it (Points off Team Best Ball), in which case the format wins.
    const form = tr.scoring_type
      ? resolveFormOfPlay(fmt, resolveScoring(tr).formOfPlay)
      : formDefaultFor(fmt);
    return {
      course_id: tr.course_id || "",
      format: fmt,
      handicap_mode: tr.handicap_mode || defaultHandicapMode(fmt),
      tee_time: tr.tee_time || "",
      nassau_front: tr.nassau_front ?? 1,
      nassau_back: tr.nassau_back ?? 1,
      nassau_overall: tr.nassau_overall ?? 1,
      scoring_type: form,
      hole_scoring: roundHoleScoring(fmt, resolveScoring(tr).holeScoring),
      allowance: roundAllowance(fmt, tr.allowance),
      counting_scores: roundCounting(fmt, tr.counting_scores),
      hole_points: roundHolePoints(form, tr.hole_points),
      par_points: roundParPoints(fmt, tr.par_points),
      ch_overrides: hcpOverridesFromDb?.[editRound] || {},
      tee_assignments: teeAssignmentsFromDb?.[editRound] || {},
    };
  }, [tRounds, editRound, hcpOverridesFromDb, teeAssignmentsFromDb]);

  // The same shape, built from the form. `course_id` rides along unchanged
  // — it belongs to the Courses tab and is only here so a round write does
  // not drop it.
  const formRound = useMemo(() => {
    // Every derived field is normalized against the format the form is
    // CURRENTLY showing, so picking a new format re-shapes the allowance, the
    // counts, the hole-scoring method and the form of play in the same render
    // that changes it — rather than leaving a stale value to read as an edit.
    const fmt = roundFormat || storedRound.format;
    const form = resolveFormOfPlay(fmt, scoringType);
    return {
      course_id: storedRound.course_id,
      format: fmt,
      handicap_mode: handicapMode[editRound] || defaultHandicapMode(fmt),
      tee_time: roundTeeTime || storedRound.tee_time,
      nassau_front: nassau.front,
      nassau_back: nassau.back,
      nassau_overall: nassau.overall,
      scoring_type: form,
      hole_scoring: roundHoleScoring(fmt, holeScoring),
      allowance: roundAllowance(fmt, allowance),
      counting_scores: roundCounting(fmt, counting),
      hole_points: roundHolePoints(form, holePoints),
      par_points: roundParPoints(fmt, parPoints),
      ch_overrides: hcpOverrides[editRound] || {},
      tee_assignments: teeAssignments[editRound] || {},
    };
  }, [storedRound, roundFormat, handicapMode, editRound, roundTeeTime, nassau, scoringType, holeScoring, allowance, counting, holePoints, parPoints, hcpOverrides, teeAssignments]);

  const storedSettingsSig = roundSettingsSignature(storedRound);
  const hcpDocSig = JSON.stringify(hcpOverridesFromDb ?? null);
  const teeDocSig = JSON.stringify(teeAssignmentsFromDb ?? null);
  const formSig = roundSignature(formRound);
  const roundDirty = formSig !== roundSignature(storedRound);

  const saveTimerRef = useRef(null);
  const pendingSaveRef = useRef(null);  // { round, payload, sig } armed but not yet written
  const lastWrittenRef = useRef(null);  // { round, payload, sig } — the write whose echo to ignore

  // ── Hydration ──
  // Each of the three documents records the version it last adopted. That
  // is what makes "has the form caught up with Firestore?" answerable —
  // see `formSeeded` below — and it re-seeds on a round switch, on a fresh
  // document, and on nothing else.
  const [seed, setSeed] = useState(null);                     // { round, sig } — round settings
  const [mapSeed, setMapSeed] = useState({ hcp: null, tee: null });
  const seededRound = seed?.round === editRound;

  useEffect(() => {
    if (seededRound && seed.sig === storedSettingsSig) return;
    setSeed({ round: editRound, sig: storedSettingsSig });
    // A queued write owns the form — re-seeding would discard the very
    // edits it is about to send.
    if (pendingSaveRef.current?.round === editRound) return;
    const written = lastWrittenRef.current;
    if (written && written.round === editRound && roundSettingsSignature(written.payload) === storedSettingsSig) return;
    setRoundFormat(storedRound.format);
    setRoundTeeTime(storedRound.tee_time);
    setNassau({ front: storedRound.nassau_front, back: storedRound.nassau_back, overall: storedRound.nassau_overall });
    setScoringType(storedRound.scoring_type);
    setHoleScoring(storedRound.hole_scoring);
    setAllowance(storedRound.allowance);
    setCounting(storedRound.counting_scores);
    setHolePoints(storedRound.hole_points);
    setParPoints(storedRound.par_points);
    setHandicapMode(prev => ({ ...prev, [editRound]: storedRound.handicap_mode }));
  }, [seed, seededRound, editRound, storedSettingsSig, storedRound]);

  // The two per-round maps arrive as whole documents spanning every round,
  // so they are adopted wholesale — the Matches tab reads the other rounds'
  // slices for its CH preview. The slice being edited is held back in two
  // cases: the document is the echo of our own write, or a write for that
  // round is already queued (which happens when the arriving document is
  // the echo of an *earlier* round's write, landing while the director has
  // moved on). Everything else is a value we do not have, so it wins.
  useEffect(() => {
    if (mapSeed.hcp === hcpDocSig) return;
    setMapSeed(s => ({ ...s, hcp: hcpDocSig }));
    if (!hcpOverridesFromDb) return;
    const hold = pendingSaveRef.current?.round === editRound ? editRound
      : echoedSlice(lastWrittenRef.current, editRound, "ch_overrides", hcpOverridesFromDb[editRound]);
    setHcpOverrides(adoptRoundMap(hcpOverridesFromDb, hold));
  }, [hcpDocSig, mapSeed.hcp, hcpOverridesFromDb, editRound]);
  useEffect(() => {
    if (mapSeed.tee === teeDocSig) return;
    setMapSeed(s => ({ ...s, tee: teeDocSig }));
    if (!teeAssignmentsFromDb) return;
    const hold = pendingSaveRef.current?.round === editRound ? editRound
      : echoedSlice(lastWrittenRef.current, editRound, "tee_assignments", teeAssignmentsFromDb[editRound]);
    setTeeAssignments(adoptRoundMap(teeAssignmentsFromDb, hold));
  }, [teeDocSig, mapSeed.tee, teeAssignmentsFromDb, editRound]);

  // True once the form reflects every document currently in hand. Until it
  // is, "form differs from Firestore" means "hydration has not landed yet",
  // not "the director changed something" — and auto-saving on that reading
  // would write the pre-hydration form straight over the real data.
  const formSeeded = seededRound && seed.sig === storedSettingsSig
    && mapSeed.hcp === hcpDocSig && mapSeed.tee === teeDocSig;

  const AUTOSAVE_MS = 700;
  // Carries the round it refers to: the status line is per-round, and a
  // director who switches tabs should not be told the round they just
  // opened was saved.
  const [autoSave, setAutoSave] = useState(null); // { phase: "saving"|"saved"|"error", round }

  // The three documents the Save button used to write, in the same order.
  const writeRound = useStableCallback(async ({ round, payload, sig }) => {
    lastWrittenRef.current = { round, payload, sig };
    setAutoSave({ phase: "saving", round });
    try {
      await db.upsert("bc_hcp_overrides", { id: editionDocId(`bc_hcp_r${round}`), tournament_id: TOURNAMENT_ID, round_number: round, ch_overrides: payload.ch_overrides });
      await db.upsert("bc_tee_assignments", { id: editionDocId(`bc_tee_r${round}`), tournament_id: TOURNAMENT_ID, round_number: round, assignments: payload.tee_assignments });
      await onSetRound({
        id: editionDocId(`bc_round_${round}`),
        tournament_id: TOURNAMENT_ID,
        round_number: round,
        course_id: payload.course_id,
        format: payload.format,
        handicap_mode: payload.handicap_mode,
        tee_time: payload.tee_time,
        nassau_front: payload.nassau_front,
        nassau_back: payload.nassau_back,
        nassau_overall: payload.nassau_overall,
        scoring_type: payload.scoring_type,
        hole_scoring: payload.hole_scoring,
        allowance: payload.allowance,
        counting_scores: payload.counting_scores,
        hole_points: payload.hole_points,
        par_points: payload.par_points,
      });
      setAutoSave({ phase: "saved", round });
    } catch (err) {
      console.error("Round auto-save failed", err);
      lastWrittenRef.current = null;   // let the next edit retry
      setAutoSave({ phase: "error", round });
      notify(`Round ${round} could not be saved`, "error");
    }
  });

  const flushRoundSave = useStableCallback(() => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (pending) writeRound(pending);
  });

  // Arm the debounce. `formRound` only gets a new identity when something
  // it is built from actually changed, so a re-render mid-write does not
  // re-arm the timer and duplicate the write.
  useEffect(() => {
    if (!formSeeded) return;
    if (roundIsFinal || !roundDirty) { pendingSaveRef.current = null; return; }
    // Re-sending a payload we already wrote can only mean the two sides
    // disagree about something the diff cannot reconcile. Stop, rather
    // than trade writes with Firestore forever.
    const written = lastWrittenRef.current;
    if (written && written.round === editRound && written.sig === formSig) return;
    pendingSaveRef.current = { round: editRound, payload: formRound, sig: formSig };
    saveTimerRef.current = setTimeout(flushRoundSave, AUTOSAVE_MS);
    return () => { if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; } };
  }, [formSeeded, roundDirty, roundIsFinal, formRound, formSig, editRound, flushRoundSave]);

  // Leaving the round (or the console) commits whatever is still queued.
  // Declared after the debounce effect so its cleanup runs second: the
  // timer is cancelled first, then the captured payload is written.
  useEffect(() => () => flushRoundSave(), [editRound, flushRoundSave]);

  // Which round the Matches tab is editing. The builder's own selection
  // state lives in MatchSetup; this stays here so the chosen round survives
  // a trip to another admin tab.
  const [matchRound, setMatchRound] = useState(1);
  const [showEditions, setShowEditions] = useState(false);

  if (!user.isDirector) return (
    <div style={{ textAlign: "center", padding: 40 }}>
      <div style={{ fontSize: FS.jumbo, marginBottom: 12 }}>🔒</div>
      <div style={{ fontSize: FS.lead, fontWeight: 700, color: BC.t1 }}>Directors Only</div>
      <div style={{ fontSize: FS.small, color: BC.t3, marginTop: 8 }}>Only tournament directors can manage settings.</div>
    </div>
  );

  // ── Course Search (ported from WBC) ──
  // Tee colours (TEE_COLORS / resolveTeeColor / TeeSwatch) are module-level,
  // shared with the tee pickers on the Rounds tab.

  // Query the course APIs (RapidAPI + GolfCourseAPI) and return parsed
  // results. No state writes — shared by the debounced search box AND the
  // "re-fetch tees" action in the course editor.
  const fetchCourseResults = async (query, stateFilter) => {
    const q = (query || "").trim();
    if (q.length < 2) return [];
    try {
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

        return results.map(c => ({ ...c, _incompleteData: !hasRealSlope(c) }));
      } catch(err) { console.log("Course fetch failed:", err); return []; }
  };

  const doCourseSearch = (query, stateOverride) => {
    setCourseSearch(query);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!query.trim() || query.trim().length < 2) { setSearchResults([]); return; }
    searchTimerRef.current = setTimeout(async () => {
      setSearchLoading(true);
      const stateFilter = stateOverride !== undefined ? stateOverride : courseStateFilter;
      setSearchResults(await fetchCourseResults(query, stateFilter));
      setSearchLoading(false);
    }, 400);
  };

  const InputStyle = { width: "100%", padding: "10px 12px", background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 8, color: BC.t1, fontSize: FS.body, boxSizing: "border-box", outline: "none", fontFamily: FONT };
  const LabelStyle = { fontSize: FS.label, color: BC.t3, fontWeight: 700, letterSpacing: 1, marginBottom: 4, display: "block" };
  const BtnStyle = { padding: "10px 20px", borderRadius: 10, border: "none", fontSize: FS.body, fontWeight: 700, cursor: "pointer", background: `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})`, color: ON_AMBER };

  return (
    <div style={{ fontFamily: FONT }}>
      <EditionSwitcher open={showEditions} onClose={() => setShowEditions(false)} />
      {/* Tabs — pinned to the top of the scroll area so the bar stays in the
          SAME place on every sub-tab, regardless of that tab's content
          height, and in the same place the other views pin their own lead
          control. See StickyTop for how the seam is painted. */}
      <StickyTop style={{ marginBottom: 4 }}>
      <SegmentedToggle
        options={[["players","Players"],["rounds","Rounds"],["matches","Matches"],["courses","Courses"],["tournament","Tournament"]]}
        value={tab}
        onChange={setTab}
      />
      </StickyTop>

      {tab === "players" && (
        <div>
          {/* Right-aligned batch GHIN re-sync (prompt-gated). */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, padding: "0 9px", marginBottom: 8 }}>
            <span style={{ fontSize: FS.label, fontWeight: 800, letterSpacing: 0.6, color: BC.t3, textTransform: "uppercase", whiteSpace: "nowrap" }}>GHIN sync</span>
            <GhinSyncButton players={tPlayers} onUpdatePlayer={onUpdatePlayer} notify={notify} confirm={confirm} compact />
          </div>
          {[teams.A, teams.B].map(team => (
            <div key={team.id} style={{ marginBottom: 10 }}>
              {/* Team header with editable name */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "8px 12px", background: team.color + ALPHA.tint, borderRadius: 10, border: `1px solid ${team.accent}${ALPHA.line}` }}>
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
                        if (await confirm(`Rename to "${newName}"?`)) {
                          await onSaveTeamNames({ ...teamNames, [team.id]: newName });
                        }
                        setEditingTeam(null);
                      }
                      if (e.key === "Escape") setEditingTeam(null);
                    }}
                    style={{ flex: 1, background: "transparent", border: "none", borderBottom: `1px solid ${team.accent}`, color: team.accent, fontSize: FS.small, fontWeight: 800, letterSpacing: 1, outline: "none", textTransform: "uppercase" }}
                  />
                ) : (
                  <span
                    onClick={() => setEditingTeam(team.id)}
                    title="Click to edit team name"
                    style={{ fontSize: FS.small, fontWeight: 800, color: team.accent, letterSpacing: 1, flex: 1, cursor: "pointer" }}
                  >{teamNames[team.id].toUpperCase()}</span>
                )}
                {/* + Add button inline with team name */}
                <button
                  onClick={() => setEditingPlayer({ isNew: true, team: team.id, first: "", last: "", nick: "", hi: "", ov: "", dir: false })}
                  title="Add player"
                  style={{
                    padding: "3px 10px", borderRadius: 8, border: `1px solid ${team.accent}${ALPHA.line}`,
                    background: "transparent", color: team.accent,
                    fontSize: FS.lead, fontWeight: 700, cursor: "pointer", lineHeight: 1, flexShrink: 0,
                  }}>+</button>
              </div>

              {/* Player list */}
              {tPlayers.filter(p => p.team === team.id).map(p => {
                const overridden = p.hi_override != null && String(p.hi_override).trim() !== "";
                const effHI = overridden ? p.hi_override : p.handicap_index;
                const synced = !overridden && !!p.ghin_number;
                return (
                  <div key={p.player_id} style={{ background: BC.card, borderRadius: 6, padding: "4px 8px", border: `1px solid ${BC.bdr}`, display: "flex", flexDirection: "row", alignItems: "center", gap: 6, boxShadow: `inset 3px 0 0 ${team.accent}${ALPHA.line}`, marginBottom: 2 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, flexBasis: "52%", flexGrow: 0, flexShrink: 1, minWidth: 0 }}>
                      <span style={{ fontSize: FS.small, fontWeight: 600, color: playerNameColor(), minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fullName(p)}</span>
                      {p.isDirector && <span title="Tournament director" style={{ fontSize: FS.small, flexShrink: 0, lineHeight: 1 }}>👑</span>}
                    </div>
                    {/* Index column doubles as the sync-status glyph: amber * =
                        override, blue G = synced from GHIN, plain = manual. */}
                    <span title={overridden ? `Director override — GHIN/base index is ${p.handicap_index}` : (synced ? "Synced from GHIN" : "Manual index")}
                      style={{ display: "inline-flex", alignItems: "center", gap: 4, width: 56, flexShrink: 0 }}>
                      <span style={{ fontSize: FS.small, fontWeight: overridden ? 700 : 500, color: overridden ? BC.amber : playerNameColor() }}>
                        {effHI}{overridden ? "*" : ""}
                      </span>
                      {synced && <span style={{ fontSize: FS.micro, fontWeight: 800, letterSpacing: 0.2, color: BC.hcpBlue, border: `1px solid ${BC.hcpBlue}${ALPHA.line}`, background: BC.hcpBlue + ALPHA.tint, borderRadius: 3, padding: "1px 3px", lineHeight: 1 }}>G</span>}
                    </span>
                    <span style={{ flex: 1, minWidth: 8 }} />
                    <button onClick={() => setEditingPlayer({ pid: p.player_id, first: p.first_name || (p.last_name ? "" : (p.name || "")), last: p.last_name || "", nick: p.name || "", hi: String(p.handicap_index), ov: (p.hi_override != null && String(p.hi_override).trim() !== "") ? String(p.hi_override) : "", dir: !!p.isDirector })} style={{
                      fontSize: FS.label, padding: "2px 8px", borderRadius: 4, border: `1px solid ${BC.bdr}`, background: "transparent", color: BC.t3, cursor: "pointer", flexShrink: 0,
                    }}>Edit</button>
                  </div>
                );
              })}
              {tPlayers.filter(p => p.team === team.id).length === 0 && (
                <div style={{ color: BC.t3, fontSize: FS.small, padding: "6px 10px" }}>No players yet.</div>
              )}
            </div>
          ))}

          {/* Player edit — pop-out modal (portaled so the swipeable row's
              transform can't trap it). One place edits name, nickname, the
              handicap (index merged with the GHIN link), override and role. */}
          {editingPlayer && (() => {
            const isNew = !!editingPlayer.isNew;
            const p = isNew ? null : tPlayers.find(x => x.player_id === editingPlayer.pid);
            if (!isNew && !p) return null;
            const acc = ((isNew ? teams[editingPlayer.team] : teams[p.team]) || teams.A).accent;
            const defaultNick = toDisplayName(editingPlayer.first, editingPlayer.last);
            const linked = !!editingPlayer.ghin_number;
            const close = () => setEditingPlayer(null);
            const set = (patch) => setEditingPlayer(prev => prev ? { ...prev, ...patch } : prev);
            const lbl = { fontSize: FS.micro, fontWeight: 800, letterSpacing: 0.5, color: BC.t3, textTransform: "uppercase", marginBottom: 3, display: "block" };
            // Input font stays at FS.lead (16px) on purpose — anything
            // smaller makes iOS Safari zoom the page on focus. Height is
            // condensed via padding, not by dropping a rung.
            const inp = { fontSize: FS.lead, fontWeight: 600, color: BC.t1, width: "100%", boxSizing: "border-box", background: BC.inp, border: `1px solid ${acc}${ALPHA.line}`, borderRadius: 8, padding: "7px 10px", outline: "none", fontFamily: FONT };
            // GHIN link/sync/unlink writes ONLY into the form here (never the db
            // directly) — the whole modal commits on Save, so add & edit behave
            // identically and Cancel truly discards. `formPlayer` gives
            // GhinLinkButton the shape it expects, built from live form state.
            const formPlayer = {
              player_id: editingPlayer.pid || "new",
              name: (editingPlayer.nick || "").trim() || defaultNick,
              first_name: editingPlayer.first, last_name: editingPlayer.last,
              handicap_index: parseFloat(editingPlayer.hi) || 0,
              ghin_number: editingPlayer.ghin_number || null,
              ghin_name: editingPlayer.ghin_name || null,
              ghin_rev_date: editingPlayer.ghin_rev_date || null,
              ghin_synced_at: editingPlayer.ghin_synced_at || null,
            };
            const ghinWrap = async (updated) => {
              set({
                ...(Object.prototype.hasOwnProperty.call(updated, "handicap_index") ? { hi: String(updated.handicap_index ?? "") } : {}),
                ghin_number: updated.ghin_number ?? null,
                ghin_name: updated.ghin_name ?? null,
                ghin_rev_date: updated.ghin_rev_date ?? null,
                ghin_synced_at: updated.ghin_synced_at ?? null,
              });
            };
            const doSave = async () => {
              const first = (editingPlayer.first || "").trim(), last = (editingPlayer.last || "").trim();
              if (!first) { notify("Enter a first name", "error"); return; }
              const newName = (editingPlayer.nick || "").trim() || toDisplayName(first, last);
              const ovRaw = String(editingPlayer.ov ?? "").trim();
              const newOv = ovRaw === "" ? null : (parseFloat(ovRaw) || 0);
              const newDir = !!editingPlayer.dir;
              const ghinFields = {
                ghin_number: editingPlayer.ghin_number || null,
                ghin_name: editingPlayer.ghin_name || null,
                ghin_rev_date: editingPlayer.ghin_rev_date || null,
                ghin_synced_at: editingPlayer.ghin_synced_at || null,
              };
              if (isNew) {
                const pid = `bc_player_${Date.now()}`;
                await onAddPlayer({ id: pid, player_id: pid, tournament_id: TOURNAMENT_ID, team: editingPlayer.team,
                  name: newName, first_name: first, last_name: last,
                  handicap_index: parseFloat(editingPlayer.hi) || 0, hi_override: newOv, isDirector: newDir, ...ghinFields });
                notify(`Added ${newName}`, "success");
                close();
                return;
              }
              const changes = [];
              if (first !== (p.first_name||"") || last !== (p.last_name||"") || newName !== p.name)
                changes.push(`Name → ${fullName({ first_name: first, last_name: last })} (shows as "${newName}")`);
              const baseChanged = parseFloat(editingPlayer.hi) !== parseFloat(p.handicap_index);
              if (baseChanged) changes.push(`Index: ${p.handicap_index} → ${editingPlayer.hi}`);
              const oldOv = (p.hi_override != null && String(p.hi_override).trim() !== "") ? (parseFloat(p.hi_override) || 0) : null;
              if (newOv !== oldOv) changes.push(`Override: ${oldOv == null ? "—" : oldOv} → ${newOv == null ? "— (use index)" : newOv}`);
              const dirChanged = newDir !== !!p.isDirector;
              if (dirChanged) changes.push(`Director: ${p.isDirector ? "Yes" : "No"} → ${newDir ? "Yes" : "No"}`);
              if ((editingPlayer.ghin_number || null) !== (p.ghin_number || null))
                changes.push(editingPlayer.ghin_number ? `GHIN: linked #${editingPlayer.ghin_number}` : "GHIN: unlinked");
              if (changes.length === 0) { close(); return; }
              const oldEff = oldOv != null ? oldOv : (parseFloat(p.handicap_index) || 0);
              const newEff = newOv != null ? newOv : (parseFloat(editingPlayer.hi) || 0);
              let impact = oldEff !== newEff ? "\n\n" + describeHiChangeImpact(roundLocks, [1,2,3,4]).text : "";
              if (dirChanged && newDir) impact += "\n\nDirector access grants full admin control (setup, scoring, editions).";
              if (await confirm({ title: "Confirm changes", message: changes.join("\n") + impact })) {
                onUpdatePlayer({ ...p, name: newName, first_name: first, last_name: last, handicap_index: parseFloat(editingPlayer.hi) || 0, hi_override: newOv, isDirector: newDir, ...ghinFields });
              }
              close();
            };
            return (
              <Popup onClose={close} portal viewportFit align="start" maxWidth={420} padding={0} outerPadding={12}
                innerStyle={{ background: BC.card, borderRadius: 16, display: "flex", flexDirection: "column", fontFamily: FONT }}>
                <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", borderBottom: `1px solid ${BC.bdr}` }}>
                  <div style={{ flex: 1, fontSize: FS.body, fontWeight: 800, color: BC.t1 }}>{isNew ? "Add Player" : "Edit Player"}</div>
                  <button onClick={close} aria-label="Close" style={{ width: 32, height: 32, borderRadius: 9, border: `1px solid ${BC.bdr}`, background: "transparent", color: BC.t2, fontSize: FS.lead, cursor: "pointer", lineHeight: 1 }}>✕</button>
                </div>
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: 14, display: "flex", flexDirection: "column", gap: 11 }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <label style={{ flex: 1, minWidth: 0 }}><span style={lbl}>First name</span>
                      <input autoFocus value={editingPlayer.first} onChange={e => set({ first: e.target.value })} style={inp} /></label>
                    <label style={{ flex: 1, minWidth: 0 }}><span style={lbl}>Last name</span>
                      <input value={editingPlayer.last} onChange={e => set({ last: e.target.value })} style={inp} /></label>
                  </div>
                  {/* Nickname + Director paired on one row, like First/Last. */}
                  <div style={{ display: "flex", gap: 8 }}>
                    <label style={{ flex: 1, minWidth: 0 }}><span style={lbl}>Nickname</span>
                      <input value={editingPlayer.nick} placeholder={defaultNick} onChange={e => set({ nick: e.target.value })} style={inp} /></label>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={lbl}>Director</span>
                      <button type="button" onClick={() => set({ dir: !editingPlayer.dir })}
                        style={{ fontSize: FS.body, fontWeight: 700, padding: "7px 10px", borderRadius: 8, cursor: "pointer", width: "100%", boxSizing: "border-box", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          border: `1px solid ${editingPlayer.dir ? BC.amber : BC.bdr}`, background: editingPlayer.dir ? BC.amber + ALPHA.wash : "transparent", color: editingPlayer.dir ? BC.amber : BC.t2 }}>
                        {editingPlayer.dir ? "👑 Director" : "Player"}
                      </button>
                    </div>
                  </div>
                  {/* Index, the GHIN link, and Override on one row — all
                      handicap-related. GHIN fills/syncs the Index; Override
                      (amber) wins over both when set. */}
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={lbl}>Index</span>
                      <input type="number" inputMode="decimal" value={editingPlayer.hi} placeholder="—" onChange={e => set({ hi: e.target.value })} style={inp} />
                    </div>
                    <div style={{ flexShrink: 0 }}>
                      <span style={lbl}>GHIN</span>
                      <div style={{ height: 35, display: "flex", alignItems: "center", padding: "0 9px", borderRadius: 8, border: `1px solid ${(linked ? BC.green : BC.hcpBlue)}${ALPHA.line}`, background: (linked ? BC.green : BC.hcpBlue) + "12" }}>
                        <GhinLinkButton player={formPlayer} user={user} notify={notify} onUpdatePlayer={ghinWrap} />
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ ...lbl, color: BC.amber }}>Override</span>
                      <input type="number" inputMode="decimal" value={editingPlayer.ov} placeholder={String(p ? p.handicap_index : (editingPlayer.hi || ""))} onChange={e => set({ ov: e.target.value })}
                        style={{ ...inp, border: `1px solid ${BC.amber}${ALPHA.line}`, color: BC.amber }} />
                    </div>
                  </div>
                </div>
                <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderTop: `1px solid ${BC.bdr}` }}>
                  {!isNew && (
                    <button onClick={async () => {
                      // Same cascade as deleting a match, from the other end.
                      // The player document goes; their matches and their
                      // posted holes do not. A match keeps the name it was
                      // built with, but the roster row that carried the
                      // handicap is gone — so in any round not yet locked
                      // they'd be re-derived at scratch.
                      const inMatches = matches.filter(m => [...(m.teamA || []), ...(m.teamB || [])].includes(p.player_id));
                      const scored = [1, 2, 3, 4]
                        .map(r => ({ r, holes: holesEntered(holeData, p.player_id, r) }))
                        .filter(x => x.holes > 0);
                      const msg = ["This deletes the player from this edition."];
                      if (inMatches.length) {
                        msg.push("", `Still drawn into ${inMatches.length} match${inMatches.length === 1 ? "" : "es"} (${inMatches.map(m => `M${m.matchNumber ?? "?"}`).join(", ")}). Those matches keep the name but lose the handicap behind it — any round not yet locked would re-derive them at scratch. Delete or re-draw the matches too.`);
                      }
                      if (scored.length) {
                        msg.push("", `${scored.reduce((n, s) => n + s.holes, 0)} scored hole${scored.reduce((n, s) => n + s.holes, 0) === 1 ? "" : "s"} stay in the database (${scored.map(s => `Rd ${s.r}: ${s.holes}`).join(", ")}).`);
                      }
                      if (await confirm({ title: `Remove ${fullName(p)}?`, message: msg.join("\n"), confirmLabel: "Delete", destructive: true })) { onRemovePlayer(p.player_id); close(); } }}
                      title="Delete player" style={{ flexShrink: 0, padding: "9px 11px", borderRadius: 10, background: "transparent", border: `1px solid ${BC.danger}${ALPHA.line}`, color: BC.danger, fontSize: FS.body, fontWeight: 700, cursor: "pointer", lineHeight: 1 }}>🗑</button>
                  )}
                  <span style={{ flex: 1 }} />
                  <button onClick={close} style={{ padding: "10px 16px", borderRadius: 10, background: BC.inp, border: `1px solid ${BC.bdr}`, color: BC.t2, fontSize: FS.body, fontWeight: 700, cursor: "pointer" }}>Cancel</button>
                  <button onClick={doSave} style={{ padding: "10px 20px", borderRadius: 10, background: acc, border: "none", color: ON_AMBER, fontSize: FS.body, fontWeight: 800, cursor: "pointer" }}>{isNew ? "Add" : "Save"}</button>
                </div>
              </Popup>
            );
          })()}
        </div>
      )}

      {tab === "rounds" && (
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {/* Switching round is all these do. The hydration effect re-seeds
                the form from Firestore — including for a round with no
                document yet, which the old inline loader skipped, leaving
                the previous round's settings on screen. */}
            <SegmentedToggle
              variant="pills"
              options={[1,2,3,4].map(r => [r, `Rd ${r}`])}
              value={editRound}
              onChange={setEditRound}
              style={{ flex: 1 }}
            />
          </div>
          <div style={{ background: BC.card, borderRadius: 12, padding: "12px 12px", border: `1px solid ${BC.bdr}` }}>
            <RoundSectionHeading first hint="What is being played, where, and when it goes off.">
              THE ROUND
            </RoundSectionHeading>
            {/* Format + Course — 2 col compact, matched sizing */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: FS.small, fontWeight: 700, color: BC.gold, marginBottom: 6 }}>FORMAT</div>
                <select value={roundFormat} onChange={e => {
                  // Picking a format re-seeds every decision that follows from
                  // it. Nothing survives the change that the new format would
                  // not have chosen for itself — a Scramble's 35/15 means
                  // nothing on a Singles round, Points means nothing off Team
                  // Best Ball, and a Team Total's counts mean nothing anywhere.
                  const id = e.target.value;
                  const fmt = FORMATS.find(f => f.id === id);
                  setRoundFormat(id);
                  if (fmt?.nassau) setNassau(fmt.nassau);
                  setScoringType(formDefaultFor(id));
                  // The first option is the format's own rule; on a format with
                  // no menu this resolves to "format" and the section states it.
                  setHoleScoring(resolveHoleMethod(id, null) || HOLE_SCORING_FORMAT);
                  setHandicapMode(prev => ({ ...prev, [editRound]: handicapModeFor(id) }));
                  // Off unless the format is one that is not worth playing
                  // without its allowance — see FORMATS.allowanceOn. Either way
                  // it is the NEW format's answer, never the old one's.
                  setAllowance(allowanceStartsOn(id) ? { enabled: true, ...allowanceDefaultFor(id) } : null);
                  setCounting(null);
                  setHolePoints(null);
                  setParPoints(null);
                }} style={{ ...InputStyle, marginBottom: 0, fontSize: FS.small, padding: "8px 8px", height: 38 }}>
                  <option value="">Select...</option>
                  {FORMATS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: FS.small, fontWeight: 700, color: BC.gold, marginBottom: 6 }}>COURSE</div>
                {(() => {
                  const tr = tRounds.find(t => t.round_number === editRound);
                  const course = courses.find(c => c.id === tr?.course_id);
                  return (
                    <div style={{ padding: "8px 8px", background: BC.inp, borderRadius: 8, border: `1px solid ${BC.bdr}`, fontSize: FS.small, color: course ? BC.t1 : BC.t3, height: 38, display: "flex", alignItems: "center", overflow: "hidden" }}>
                      {course ? <span style={{ fontWeight: 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{course.name}</span> : <span>Set in Courses tab</span>}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* What the format IS, in its own words. The select shows a name
                and nothing else, so the game itself was the one thing the
                round form never said — and every section below is a
                consequence of it. FORMATS carries the sentence. */}
            {(() => {
              const fmt = FORMATS.find(f => f.id === formRound.format);
              if (!fmt) return null;
              return (
                <div style={{ fontSize: FS.label, color: BC.t3, lineHeight: 1.5, marginBottom: 10 }}>{fmt.desc}</div>
              );
            })()}

            {/* Tee Times */}

            {(() => {
              // Time parsing/formatting is shared with the Matches tab (see
              // lib/groups.js) so the two editors of this one field can never
              // disagree about what "830" means.
              const teeTimes = roundTeeTime ? roundTeeTime.split("|") : ["","","",""];
              // These boxes ARE the round's groups — G1 is who goes off first,
              // and the Matches tab fills them rather than inventing groups of
              // its own (see lib/groups.js). Four covers a sixteen-player
              // field; a round that already carries more keeps every one of
              // them, and gets a box for each.
              const slots = Math.max(teeTimes.length, TEE_SLOTS);
              // The spread to keep when the FIRST tee moves, measured from the
              // later slots. It cannot be measured from times[1] - times[0]:
              // the box writes through on every keystroke, so by the time this
              // runs times[0] is already the new value and that subtraction
              // measures the edit itself. (It did — typing 7:00 over an 8:30
              // first tee against an 8:45 second read as a 105-minute spread
              // and laid the field out to 12:15.)
              const laterSpread = (times) => {
                for (let i = 1; i + 1 < times.length; i++) {
                  const a = parseTeeTime(times[i]), b = parseTeeTime(times[i + 1]);
                  if (a != null && b != null && b > a) return b - a;
                }
                return DEFAULT_TEE_INTERVAL;
              };
              const commitTime = (idx, val) => {
                const times = [...teeTimes];
                while (times.length < slots) times.push("");
                const iv = laterSpread(times);
                const mins = parseTeeTime(val);
                times[idx] = mins != null ? formatTeeTime(mins) : val;
                // Editing the first tee moves the whole sheet; editing the
                // second sets the spread and re-lays everything after it.
                const t0 = parseTeeTime(times[0]);
                if (idx === 0 && t0 != null) {
                  for (let i = 1; i < slots; i++) times[i] = formatTeeTime(t0 + iv * i);
                } else if (idx === 1 && t0 != null) {
                  const t1 = parseTeeTime(times[1]);
                  if (t1 != null && t1 > t0) {
                    for (let i = 2; i < slots; i++) times[i] = formatTeeTime(t0 + (t1 - t0) * i);
                  }
                }
                setRoundTeeTime(times.join("|"));
              };
              const tt = roundTeeTime ? roundTeeTime.split("|") : ["","","",""];
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <div style={{ fontSize: FS.small, fontWeight: 700, color: BC.gold, flexShrink: 0 }}>TEE TIMES</div>
                  {Array.from({ length: slots }, (_, i) => (
                    <div key={i} style={{ flex: 1, display: "flex", alignItems: "center", gap: 3 }}>
                      <span style={{ fontSize: FS.label, color: BC.t3, flexShrink: 0, fontWeight: 600 }}>G{i + 1}</span>
                      <input
                        value={stripAMPM(tt[i] || "")}
                        onChange={e => { const times = [...tt]; times[i] = e.target.value; setRoundTeeTime(times.join("|")); }}
                        onBlur={e => commitTime(i, e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") { e.target.blur(); } }}
                        placeholder=""
                        inputMode="numeric"
                        style={{ ...InputStyle, marginBottom: 0, fontSize: FS.lead, padding: "4px 3px", textAlign: "center", minWidth: 0, transform: "scale(0.85)", transformOrigin: "center" }}
                      />
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* ══ HOLE SCORING ══════════════════════════════════════════
                The first of the two scoring axes: how a side's single number
                for a hole is arrived at. The FORMAT usually answers it outright
                — a Four-Ball takes the better ball, a Team Total adds both —
                so the section asks only where something is genuinely open, and
                otherwise STATES the rule rather than leaving the director to
                infer it. Three shapes, chosen by constants.holeRuleFor:

                  • COUNTING (Team Best Ball) → the count grid below. Best ball
                    is a given; the open question is how many balls count.
                  • CHOICE → the best-ball override, which throws the format's
                    own per-hole method away and takes each side's best net
                    ball instead.
                  • FIXED → one line of prose, no control.

                The override used to be offered on every format but Team Best
                Ball, which is how a Double Dot round came to be asked whether
                it was a Best Ball round — a question its own name answers, and
                whose "yes" silently discards the Hi/Lo dots and re-scores the
                round in net strokes. Same class of bug as offering it on a
                format that already sums the best N (which discarded the
                counts); the fix is the same one, applied to all of them. */}
            <RoundSectionHeading hint="How each side's number for a hole is arrived at.">
              HOLE SCORING
            </RoundSectionHeading>
            {(() => {
              const fmtId = formRound.format;
              // Team Best Ball answers this section with its counting grid
              // below, so the override would be both redundant and dangerous.
              if (holeRuleFor(fmtId) === HOLE_RULE_COUNTING) return null;
              const fmt = FORMATS.find(f => f.id === fmtId);
              const options = holeOptionsFor(fmtId);
              const fixed = holeRuleFor(fmtId) === HOLE_RULE_FIXED;
              // The legacy override: a pre-split `scoring_type: "team"` document
              // resolves to best-ball holes, and it can land on a format that
              // has no menu to show it in.
              const stray = fixed && holeScoring === HOLE_SCORING_BEST_BALL;
              const lbl = <div style={{ fontSize: FS.small, fontWeight: 700, color: BC.gold, flexShrink: 0 }}>HOLE SCORE</div>;
              // A fixed format states its rule and asks nothing — unless the
              // round arrived already overridden. Hiding the control there
              // would leave a setting that is actively scoring the round with
              // no way to see or clear it, so it stays, in amber, with a way
              // back. Every other fixed round never sees a control at all.
              if (fixed && !stray) {
                return (
                  <div style={{ marginBottom: 12, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                    {lbl}
                    <div style={{ fontSize: FS.label, color: BC.t3, lineHeight: 1.5 }}>{describeHoleScore(fmtId, holeScoring)}</div>
                  </div>
                );
              }
              // Pills name the METHODS on offer, not Off/On against a control
              // labelled with a format's name — "Best Ball: Off" read as a
              // claim about what the round IS, rather than as a choice between
              // two ways to score a hole.
              const pills = stray
                ? [{ id: fmtId, label: fmt?.label || "Format", value: HOLE_SCORING_FORMAT },
                   { id: HOLE_SCORING_BEST_BALL, label: "Best Ball", value: HOLE_SCORING_BEST_BALL }]
                : options.map(m => ({ id: m, label: HOLE_METHOD_LABELS[m] || m, value: m }));
              const current = stray ? HOLE_SCORING_BEST_BALL : resolveHoleMethod(fmtId, holeScoring);
              const bbPill = (active) => ({
                padding: "4px 12px", borderRadius: 16, fontSize: FS.label, fontWeight: 700, border: "none", cursor: "pointer",
                background: active ? `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})` : "transparent",
                color: active ? ON_AMBER : BC.t3,
              });
              return (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    {lbl}
                    <div style={{ display: "flex", background: BC.bg, borderRadius: 20, padding: 2, border: `1px solid ${BC.bdr}` }}>
                      {pills.map(p => (
                        <button key={p.id} onClick={() => setHoleScoring(p.value)}
                          title={HOLE_METHOD_DESCRIPTIONS[p.value] || describeHoleScore(fmtId, p.value)}
                          style={bbPill(current === p.value)}>{p.label}</button>
                      ))}
                    </div>
                  </div>
                  <div style={{ fontSize: FS.label, color: stray ? BC.amber : BC.t3, lineHeight: 1.5, marginTop: 5 }}>
                    {stray
                      ? `This round is overriding ${fmt?.label || "the format"} and scoring each hole as the side's best net ball. Pick ${fmt?.label || "the format"} to score it as its own name says.`
                      : describeHoleScore(fmtId, holeScoring)}
                  </div>
                </div>
              );
            })()}

            {/* ── Counting scores ─────────────────────────────────────────
                Team Best Ball only, and the setting that actually defines it.
                The whole side plays one match and a hole is the SUM of that
                side's best N nets.

                N is PER HOLE. The count has moved around for years — the front
                has run 5 and 6, the back 6 and 7 — and the old sheets ramped it
                up inside each nine rather than holding one figure across it. So
                the nine box is the shortcut (type once, set all nine) and the
                18-hole grid underneath is the truth.

                No off switch, unlike the allowance: a Team Best Ball round is
                always counting some number, so the only question is which.
                Shown only when the format asks for it (constants.FORMATS
                carries the `counting` prefill), so every other round's form is
                exactly as it was. */}
            {(() => {
              const fmtId = formRound.format;
              if (!formatCountsScores(fmtId)) return null;
              const prefill = countingDefaultFor(fmtId);
              const cur = resolveCounting(fmtId, counting);   // 18 numbers, always
              // How many a side actually fields, for the "of N" hint and the
              // over-count warning. Read off the round's matches when they
              // exist — that is the roster that will be scored — and off the
              // smaller team otherwise, so the hint is right during setup too.
              const rndMatches = matches.filter(m => m.round === editRound);
              const sideSize = rndMatches.length
                ? Math.max(...rndMatches.flatMap(m => [m.teamA?.length || 0, m.teamB?.length || 0]))
                : Math.min(
                    tPlayers.filter(p => p.team === "A").length,
                    tPlayers.filter(p => p.team === "B").length,
                  );
              const writeHoles = (holes) => setCounting({ holes });
              const setHole = (h, v) => {
                const n = parseInt(v, 10);
                const next = [...cur];
                next[h] = Number.isFinite(n) && n >= 1 ? n : prefill[h < 9 ? "front" : "back"];
                writeHoles(next);
              };
              // The nine box sets all nine of its holes at once. It shows the
              // shared count when the nine is flat and blanks (placeholder
              // "mixed") when it ramps, so it never claims a single figure the
              // holes below disagree with.
              const setNine = (back, v) => {
                const n = parseInt(v, 10);
                if (!Number.isFinite(n) || n < 1) return;
                const next = [...cur];
                for (let h = back ? 9 : 0; h < (back ? 18 : 9); h++) next[h] = n;
                writeHoles(next);
              };
              const nineBox = (back, lbl, hint) => {
                const flat = countingNine(cur, back);
                return (
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span title={hint} style={{ fontSize: FS.label, color: BC.t3, flexShrink: 0, fontWeight: 600 }}>{lbl}</span>
                    <input
                      type="number" step="1" min="1" max="20"
                      value={flat == null ? "" : String(flat)}
                      placeholder="—"
                      onChange={e => setNine(back, e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
                      style={{ ...InputStyle, marginBottom: 0, padding: "4px 4px", fontSize: FS.body, textAlign: "center", width: 44 }} />
                  </div>
                );
              };
              // Two rows of nine, on the same geometry as the hole strips
              // everywhere else in the app, so hole 1 is where hole 1 always is.
              const holeRow = (back) => (
                <div style={{ display: "flex", gap: 2, marginTop: 4 }}>
                  {Array.from({ length: 9 }, (_, i) => {
                    const h = back ? i + 9 : i;
                    const capped = sideSize > 0 && cur[h] > sideSize;
                    return (
                      <div key={h} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                        <span style={{ fontSize: FS.micro, color: BC.t3, fontWeight: 700 }}>{h + 1}</span>
                        <input
                          type="number" step="1" min="1" max="20"
                          value={String(cur[h])}
                          onChange={e => setHole(h, e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
                          style={{
                            ...InputStyle, marginBottom: 0, padding: "3px 0", fontSize: FS.body,
                            textAlign: "center", width: "100%", minWidth: 0,
                            color: capped ? BC.amber : undefined,
                            border: `1px solid ${capped ? BC.amber + ALPHA.line : BC.bdr}`,
                          }} />
                      </div>
                    );
                  })}
                </div>
              );
              // A count bigger than the side fields is scored at the side size
              // (see scoring.js) rather than stalling the hole — say so here,
              // because the numbers on screen would otherwise be a lie.
              const over = sideSize > 0 && cur.some(n => n > sideSize);
              return (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ fontSize: FS.small, fontWeight: 700, color: BC.gold, flexShrink: 0 }}>COUNTING</div>
                    {nineBox(false, "F9", "Set every front-nine hole at once")}
                    {nineBox(true, "B9", "Set every back-nine hole at once")}
                    {sideSize > 0 && (
                      <span style={{ fontSize: FS.label, color: BC.t3, fontWeight: 600 }}>of {sideSize} a side</span>
                    )}
                  </div>
                  {holeRow(false)}
                  {holeRow(true)}
                  <div style={{ fontSize: FS.label, color: over ? BC.amber : BC.t3, lineHeight: 1.5, marginTop: 5 }}>
                    {over
                      ? `Only ${sideSize} play${sideSize === 1 ? "s" : ""} a side — the holes above ${sideSize} score as all ${sideSize}.`
                      : "Each hole is the sum of the side's best N nets, where N is that hole's count."}
                  </div>
                </div>
              );
            })()}

            {/* ── Points against par ──────────────────────────────────────
                The two formats that score a hole by what it was against PAR
                rather than against the other side. Both sit under HOLE SCORING
                because that is the decision they make: the table IS how a
                hole's number is arrived at.

                Both tables are the director's to set, and they are different
                games: Stableford's defaults reproduce exactly what the engine
                computed before the table existed, Tilt's are the harsher ladder
                the format is named for. What Tilt's table cannot express — the
                multiplier that rides on a birdie streak — is stated underneath,
                because those rules are the game rather than a setting. */}
            {(() => {
              const fmtId = formRound.format;
              if (!formatUsesParPoints(fmtId)) return null;
              // Raw-backed like the allowance: clearing a box leaves it empty
              // rather than snapping back mid-keystroke, and an empty box
              // resolves to the format's default when the round is saved.
              const raw = parPoints || {};
              const prefill = parPointsDefaultFor(fmtId);
              const val = (k) => (raw[k] === undefined || raw[k] === null ? String(prefill[k]) : String(raw[k]));
              const setRung = (k, v) => setParPoints(prev => ({ ...(prev || {}), [k]: v }));
              return (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ fontSize: FS.small, fontWeight: 700, color: BC.gold, flexShrink: 0 }}>POINTS</div>
                    {PAR_RESULTS.map(k => (
                      <div key={k} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                        <span style={{ fontSize: FS.label, color: BC.t3, fontWeight: 600 }}>{PAR_RESULT_LABELS[k]}</span>
                        <input
                          type="number" step="1"
                          value={val(k)}
                          onChange={e => setRung(k, e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
                          style={{ ...InputStyle, marginBottom: 0, padding: "4px 3px", fontSize: FS.body, textAlign: "center", width: 40 }} />
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: FS.label, color: BC.t3, lineHeight: 1.5, marginTop: 5 }}>
                    What each result against par pays. Both partners' points are added together for the side's score on the hole.
                    {fmtId === "tilt" && " A net birdie then doubles your next hole, a second in a row triples it, and it keeps climbing — a par or worse drops you back to face value. The multiplier runs through the turn and applies to minus scores too."}
                  </div>
                </div>
              );
            })()}

            {/* ══ FORM OF PLAY + POINTS AT STAKE ════════════════════════
                The second scoring axis: how the hole numbers settled above
                turn into points. Three ways, and golf has names for all of
                them:
                  • Match  — the side that wins more holes takes each pot.
                  • Medal  — the running total over each segment takes it:
                             fewest net strokes, most dots on Double Dot, most
                             points on Stableford. Stored as "stroke", which
                             predates the label.
                  • Points — every HOLE is its own pot, worth what its nine is
                             worth. No segments and no pots to wait on; a hole
                             pays the moment it's played.

                Match and Medal split into Single vs Nassau and share the
                nassau {front,back,overall} pots:
                  • Nassau → three segments (F9 / B9 / OVR)
                  • Single → one 18-hole pot worth `value` (overall-only)
                Points has neither — it asks what a hole is worth on each nine
                instead, which is the Bourbon Cup's final round: 1 a hole out,
                2 a hole in, 27 on the round.

                Note there is no "Team" here any more. It used to sit on this
                row while actually deciding the OTHER axis, which is how a Team
                Best Ball round could be told to score each hole off one player
                and silently drop its counts. It now lives under HOLE SCORING,
                where it belongs, and rounds stored with the old combined value
                still read correctly (see constants.resolveScoring).

                Both fields live on the ROUND and nowhere else — App reads them
                off the round doc when enriching matches, so a change here takes
                effect on every match in the round immediately. */}
            {(() => {
              const isSingle = (nassau.front || 0) === 0 && (nassau.back || 0) === 0;
              const perHole = isPointsPerHole(scoringType);
              const hp = resolveHolePoints(holePoints);
              const pill = (active, disabled) => ({
                padding: "4px 12px", borderRadius: 16, fontSize: FS.label, fontWeight: 700, border: "none",
                cursor: disabled ? "not-allowed" : "pointer",
                background: active ? `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})` : "transparent",
                color: active ? ON_AMBER : (disabled ? BC.t3 + ALPHA.line : BC.t3),
              });
              const numField = (k, lbl) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <span style={{ fontSize: FS.label, color: BC.t3, flexShrink: 0 }}>{lbl}</span>
                  <input type="number" step="0.5" min="0" value={nassau[k]}
                    onChange={e => setNassau(n => ({ ...n, [k]: parseFloat(e.target.value) || 0 }))}
                    onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
                    style={{ ...InputStyle, marginBottom: 0, padding: "4px 4px", fontSize: FS.body, textAlign: "center", width: 44 }} />
                </div>
              );
              // Same box, pointed at the hole values instead of the pots.
              const holeField = (k, lbl, hint) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <span title={hint} style={{ fontSize: FS.label, color: BC.t3, flexShrink: 0 }}>{lbl}</span>
                  <input type="number" step="0.5" min="0" value={String(hp[k])}
                    onChange={e => setHolePoints({ ...hp, [k]: e.target.value })}
                    onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
                    style={{ ...InputStyle, marginBottom: 0, padding: "4px 4px", fontSize: FS.body, textAlign: "center", width: 44 }} />
                </div>
              );
              // Which forms this format offers, and what each MEANS on it.
              // Only the accrual axis changes with the format — its running
              // total is strokes on most, dots on Double Dot, points on
              // Stableford and Tilt — so the pill is called "Stroke" only where
              // that is what it counts, and "Total" everywhere else. A director
              // who read "Medal" on a Double Dot round had every reason to
              // think it meant strokes. None of that is optional detail, so it
              // is on the page rather than in a tooltip a phone never shows.
              const offered = formsFor(formRound.format);
              const current = resolveFormOfPlay(formRound.format, scoringType);
              return (
                <>
                  <RoundSectionHeading hint="How those hole scores turn into points.">
                    FORM OF PLAY
                  </RoundSectionHeading>
                  <div style={{ display: "flex", background: BC.bg, borderRadius: 20, padding: 2, border: `1px solid ${BC.bdr}`, alignSelf: "flex-start", width: "fit-content", marginBottom: 5 }}>
                    {offered.map(f => (
                      <button key={f} onClick={() => setScoringType(f)} title={describeFormOfPlay(f, formRound.format)}
                        style={pill(current === f, false)}>{formOfPlayLabel(f, formRound.format)}</button>
                    ))}
                  </div>
                  <div style={{ fontSize: FS.label, color: BC.t3, lineHeight: 1.5, marginBottom: 12 }}>{describeFormOfPlay(current, formRound.format)}</div>

                  <RoundSectionHeading hint={perHole
                    ? "What one hole is worth on each nine."
                    : "How many pots the round pays, and what each is worth."}>
                    POINTS AT STAKE
                  </RoundSectionHeading>
                  <div style={{ marginBottom: 12 }}>
                    {/* Single vs Nassau — pots only, so a Points round has no
                        use for it and it stands down rather than sitting there
                        offering a choice that changes nothing. */}
                    {!perHole && (
                      <div style={{ display: "flex", background: BC.bg, borderRadius: 20, padding: 2, border: `1px solid ${BC.bdr}`, width: "fit-content", marginBottom: 8 }}>
                        <button onClick={() => setNassau(n => ({ front: 0, back: 0, overall: n.overall || 1 }))} title="One pot for the 18-hole result" style={pill(isSingle, false)}>Single</button>
                        <button onClick={() => setNassau(n => ({ front: n.front || 1, back: n.back || 1, overall: n.overall || 1 }))} title="Three independent pots — front nine, back nine, and the overall match" style={pill(!isSingle, false)}>Nassau</button>
                      </div>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      {perHole
                        ? [
                            holeField("front", "F9", "What one front-nine hole is worth"),
                            holeField("back", "B9", "What one back-nine hole is worth"),
                            <span key="tot" style={{ fontSize: FS.label, color: BC.t3, fontWeight: 600 }}>
                              a hole · {holePointsTotal(hp)} on the round
                            </span>,
                          ]
                        : isSingle
                          ? numField("overall", "Value")
                          : [["front", "F9"], ["back", "B9"], ["overall", "OVR"]].map(([k, lbl]) => numField(k, lbl))}
                    </div>
                    {/* What the boxes above add up to. A Points round already
                        prints its round total beside the fields; the pots did
                        not, so the one number a director actually checks — what
                        this round is worth to the cup — had to be added up by
                        hand from two or three boxes. */}
                    {!perHole && (
                      <div style={{ fontSize: FS.label, color: BC.t3, lineHeight: 1.5, marginTop: 5 }}>
                        {isSingle
                          ? `One pot for the 18-hole result. ${nassau.overall || 0} on the round.`
                          : `Three pots — front nine, back nine and the overall. ${(nassau.front || 0) + (nassau.back || 0) + (nassau.overall || 0)} on the round.`}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}

            {/* ── Handicap ───────────────────────────────────────────────
                Every stroke in the round comes from this one row, in the
                order it reads: the ALLOWANCE decides how much of each
                player's Course Handicap comes to the tee at all, then LOW MAN
                / ALL decides whether they play the difference off the lowest
                figure in the match or the whole thing. Both are handicap
                terms; they belong on one line, in the order they're applied.

                The allowance is OFF until the director turns it on — one that
                switched itself on would be taking strokes off a round nobody
                configured, and the director would have no reason to go
                looking for it. Off means 100%: full handicaps, as before
                allowances existed.

                ON prefills what the FORMAT calls for, and the format decides
                what it even asks (see constants.FORMATS):
                  • ALL — one percentage, every player.
                  • LOW / HIGH — the low handicap on each side plays off the
                    first, their partner off the second. This is the shape for
                    the formats where a side effectively plays one ball.
                Both settings are stored on the round doc and frozen into the
                lock snapshot. */}
            <RoundSectionHeading hint="How much of each player's Course Handicap comes to the tee, and off whom.">
              HANDICAPS
            </RoundSectionHeading>
            {(() => {
              const fmtId = formRound.format;
              const fmt = FORMATS.find(f => f.id === fmtId);
              const prefill = allowanceDefaultFor(fmtId);       // what ON starts at
              const cur = resolveAllowance(fmtId, allowance);   // what the round scores with
              const on = cur.enabled;
              // Field values read from the RAW state when the director has
              // typed something, so clearing a box leaves it empty instead of
              // snapping back mid-keystroke. An empty box resolves to the
              // format's prefill when the round is saved.
              const fieldVal = (k) => {
                const v = allowance?.[k];
                return v === undefined || v === null ? String(prefill[k]) : String(v);
              };
              const setField = (k, v) => setAllowance(prev => ({ ...prefill, ...(prev || {}), enabled: true, [k]: v }));
              // Same pill as the SCORING toggles, so neither toggle on this
              // row changes shape by moving rows.
              const pctPill = (active, disabled = false) => ({
                padding: "4px 12px", borderRadius: 16, fontSize: FS.label, fontWeight: 700, border: "none",
                cursor: disabled ? "not-allowed" : "pointer",
                background: active ? `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})` : "transparent",
                color: active ? ON_AMBER : BC.t3,
              });
              const pctField = (k, lbl, hint) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span title={hint} style={{ fontSize: FS.label, color: BC.t3, flexShrink: 0, fontWeight: 600 }}>{lbl}</span>
                  <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                    <input
                      type="number" step="5" min="0" max="150"
                      disabled={roundIsFinal}
                      value={fieldVal(k)}
                      onChange={e => setField(k, e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
                      style={{
                        ...InputStyle, marginBottom: 0, padding: "4px 16px 4px 6px", fontSize: FS.body,
                        textAlign: "center", width: 58,
                        opacity: roundIsFinal ? 0.5 : 1, cursor: roundIsFinal ? "not-allowed" : "text",
                      }} />
                    <span style={{ position: "absolute", right: 6, fontSize: FS.label, color: BC.t3, pointerEvents: "none" }}>%</span>
                  </div>
                </div>
              );
              // ON adopts the format's recommended figures rather than an
              // empty form — a director who wants the standard terms is one
              // tap away, and one who doesn't has somewhere to type over.
              const setOn = (next) => {
                if (roundIsFinal) return;
                setAllowance(next ? { enabled: true, ...prefill } : { enabled: false });
              };
              return (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    {/* Named ALLOWANCE, not HANDICAP: the section heading
                        already says handicaps, and this control is specifically
                        the allowance — the percentage of Course Handicap that
                        comes to the tee. The pair beside it is the other half. */}
                    <div style={{ fontSize: FS.small, fontWeight: 700, color: BC.gold, flexShrink: 0 }}>ALLOWANCE</div>
                    {/* Allowance off/on. First on the row because it decides
                        whether the percentages beside it exist at all. */}
                    <div style={{ display: "flex", background: BC.bg, borderRadius: 20, padding: 2, border: `1px solid ${BC.bdr}` }}>
                      <button onClick={() => setOn(false)}
                        title={cur.shared
                          ? `No allowance — the side plays one ball off both partners' full Course Handicaps added together`
                          : "No allowance — every player plays their full Course Handicap"}
                        style={pctPill(!on, roundIsFinal)}>Off</button>
                      <button onClick={() => setOn(true)}
                        title={`Reduce handicaps — ${fmt?.label || "this format"} plays off ${describeAllowance(resolveAllowance(fmtId, { enabled: true, ...prefill }))}`}
                        style={pctPill(on, roundIsFinal)}>On</button>
                    </div>
                    {on && (cur.split
                      ? [
                          pctField("low", "LOW", "The lower Course Handicap on each side"),
                          pctField("high", "HIGH", "The higher Course Handicap on each side"),
                        ]
                      : pctField("pct", "ALL", "Applied to every player's Course Handicap"))}
                    {/* Low Man / All — the second half of the same decision,
                        sitting immediately after the percentages so the row
                        reads in the order the two are applied. Deliberately
                        NOT pushed to the right edge: a split allowance fills
                        the row and the toggle wraps, and a lone toggle
                        right-aligned on its own line reads as orphaned rather
                        than as the continuation it is. */}
                    <div style={{ display: "flex", background: BC.bg, borderRadius: 20, padding: 2, border: `1px solid ${BC.bdr}` }}>
                      {[["low_man", "Low Man"], ["full", "All"]].map(([val, lbl]) => (
                        <button key={val}
                          onClick={() => setHandicapMode(prev => ({ ...prev, [editRound]: val }))}
                          title={val === "low_man"
                            ? "Everyone plays the difference off the lowest Course Handicap in the match"
                            : "Everyone plays their full Course Handicap"}
                          style={pctPill((handicapMode[editRound] || "low_man") === val)}>{lbl}</button>
                      ))}
                    </div>
                  </div>
                  {/* The one case the tooltips can't carry on their own: a
                      side that plays ONE ball has a team handicap of its
                      partners added together, so leaving the allowance off
                      hands out a number nobody would have chosen. Said only
                      where it applies, and only while it applies. */}
                  {!on && cur.shared && (
                    <div style={{ fontSize: FS.label, color: BC.t3, lineHeight: 1.5, marginTop: 5 }}>
                      {fmt?.label || "This format"} plays one ball per side, so with no allowance the side's team handicap is both partners' full handicaps added together.
                    </div>
                  )}
                  {/* The format's recommended terms, on the page. Off is a
                      legitimate choice, but it was one made against a
                      recommendation that only existed inside the On button's
                      tooltip — invisible on every phone the director actually
                      sets a round up on. Silent where the recommendation is
                      100% (Singles), since "plays off 100%" is what Off
                      already means, and where the shared-ball line above is
                      already saying something stronger. */}
                  {!on && !cur.shared && describeAllowance(resolveAllowance(fmtId, { enabled: true, ...prefill })) !== "100%" && (
                    <div style={{ fontSize: FS.label, color: BC.t3, lineHeight: 1.5, marginTop: 5 }}>
                      Full Course Handicaps. {fmt?.label || "This format"} is normally played off {describeAllowance(resolveAllowance(fmtId, { enabled: true, ...prefill }))}.
                    </div>
                  )}
                  {roundIsLocked && (
                    <div style={{ fontSize: FS.label, color: roundIsFinal ? BC.danger : BC.amber, marginTop: 4 }}>
                      Round {editRound} is locked — the allowance it scored with is frozen in the snapshot, so a change here will not move it.
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Per-player handicap overrides and tee assignments. */}
            <RoundSectionHeading hint="Per-player exceptions for this round — a tee off the field's, or a Course Handicap set by hand.">
              PLAYERS
            </RoundSectionHeading>
            <div style={{ marginBottom: 14 }}>
              {/* Column headers carry the rest.
                  No lock banner here — touching a control on a locked/final
                  round raises warnRoundLocked's popup instead. */}
              {tPlayers.length === 0 && <div style={{ fontSize: FS.small, color: BC.t3 }}>No players added yet.</div>}
              {tPlayers.length > 0 && (() => {
                const tr2h = tRounds.find(t => t.round_number === editRound);
                const course2h = courses.find(c => c.id === tr2h?.course_id);
                const tees2h = course2h?.tee_boxes || [];
                // Grid: name | init | round-input | tee-dots... | delta
                const gridCols = `1fr 30px 58px ${tees2h.map(() => "22px").join(" ")} 22px`;
                const assignedH = teeAssignments[editRound] || {};
                const teeOf = (pid) => assignedH[pid] || tees2h[0]?.name;

                // ── Everyone plays ──
                // Sixteen players onto the White tees was sixteen taps, and
                // the round-by-round reality is that a field plays one tee and
                // a handful move off it. So the whole field is one tap and the
                // exceptions stay individual: this writes every player, and
                // any per-player dot below still overrides its own row after.
                //
                // Each player gets the same CH-delta badge a single tee tap
                // raises — a field-wide change moves everyone's strokes, which
                // is exactly when seeing the movement matters most.
                const assignAllTees = (teeName) => {
                  if (roundIsFinal) return;
                  const newTee = tees2h.find(t => t.name === teeName);
                  tPlayers.forEach(p => {
                    const oldTee = tees2h.find(t => t.name === teeOf(p.player_id));
                    if (!oldTee || !newTee || oldTee.name === newTee.name) return;
                    const hi = getEffectiveHI(p.player_id, tPlayers);
                    const chOf = (t) => calcCH(hi, t.slope || 113, t.rating || 72, t.par || 72);
                    showChDelta(`tee_${editRound}_${p.player_id}`, chOf(newTee) - chOf(oldTee));
                  });
                  setTeeAssignments(prev => {
                    const next = { ...(prev[editRound] || {}) };
                    tPlayers.forEach(p => { next[p.player_id] = teeName; });
                    return { ...prev, [editRound]: next };
                  });
                };

                return (
                  <div>
                    <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 4, padding: "0 2px", marginBottom: 4, alignItems: "center" }}>
                      <div />
                      <div style={{ fontSize: FS.micro, color: BC.t3, fontWeight: 700, textAlign: "center", lineHeight: 1.2 }}>HI</div>
                      <div style={{ fontSize: FS.micro, color: BC.t3, fontWeight: 700, textAlign: "center" }}>Round CH</div>
                      {tees2h.length > 0
                        ? <div style={{ fontSize: FS.micro, color: BC.t3, fontWeight: 700, textAlign: "center", gridColumn: `span ${tees2h.length}` }}>Tee</div>
                        : null}
                      <div />
                    </div>
                    {tees2h.length > 0 && (
                      <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 4, padding: "0 2px", marginBottom: 6, alignItems: "center" }}>
                        <div style={{ fontSize: FS.label, color: BC.t3, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          Everyone plays
                        </div>
                        <div />
                        <div />
                        {tees2h.map((tee, ti) => {
                          // Lit only when the whole field is genuinely on this
                          // tee — so the row doubles as the answer to "is
                          // anyone off the default?" without opening a row.
                          const allOn = tPlayers.every(p => teeOf(p.player_id) === tee.name);
                          return (
                            <button key={tee.name} disabled={roundIsFinal}
                              onClick={() => assignAllTees(tee.name)}
                              title={`Move every player to ${tee.name}`}
                              style={{
                                background: "transparent", border: "none", padding: 0,
                                cursor: roundIsFinal ? "not-allowed" : "pointer",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                opacity: roundIsFinal ? (allOn ? 0.55 : 0.2) : (allOn ? 1 : 0.35),
                                transform: allOn ? "scale(1.15)" : "scale(0.85)",
                                transition: "all 0.15s ease",
                              }}>
                              <TeeSwatch tee={tee} index={ti} size={14} round active={allOn} />
                            </button>
                          );
                        })}
                        <div />
                      </div>
                    )}
                  </div>
                );
              })()}
              {[teams.A, teams.B].map((team, teamIdx) => (
                <div key={team.id} style={{ marginBottom: 4 }}>
                  {teamIdx === 1 && <div style={{ height: 1, background: BC.bdr, margin: "6px 0 8px" }} />}
                  {tPlayers.filter(p => p.team === team.id).map(p => {
                    // Effective INDEX (player-level override ?? GHIN/base). Shown
                    // for reference; the per-round control below overrides the CH.
                    const hiOverridden = p.hi_override != null && String(p.hi_override).trim() !== "";
                    const effHI = hiOverridden ? p.hi_override : p.handicap_index;
                    const override = hcpOverrides[editRound]?.[p.player_id]; // per-round CH override
                    const hasOverride = override !== undefined && override !== "";
                    const tr2 = tRounds.find(t => t.round_number === editRound);
                    const course2 = courses.find(c => c.id === tr2?.course_id);
                    const tees2 = course2?.tee_boxes || [];
                    const assignments2 = teeAssignments[editRound] || {};
                    const currentTee2 = assignments2[p.player_id] || tees2[0]?.name;
                    // The CH the app WOULD calculate for this player/round from the
                    // effective index + assigned tee. Used as the input placeholder
                    // and as the baseline the override delta is measured against.
                    const calcedCH = course2 ? calcCHForCourse(parseFloat(effHI) || 0, course2, currentTee2) : null;
                    // A manual CH is a standing condition, not an event: for as
                    // long as one is in force, the arrow states how far the round
                    // is being played from the calculated handicap. So it is
                    // derived from the override itself and lives exactly as long
                    // as the override does — including across a reload, where a
                    // notification-style badge would have shown nothing at all.
                    const overrideCH = hasOverride ? parseFloat(override) : NaN;
                    const overrideDelta = (Number.isFinite(overrideCH) && calcedCH != null)
                      ? overrideCH - calcedCH
                      : null;
                    const assignTee2 = (teeName) => {
                      const oldTee = tees2.find(t => t.name === (assignments2[p.player_id] || tees2[0]?.name));
                      const newTee = tees2.find(t => t.name === teeName);
                      if (oldTee && newTee) {
                        const oldCH = calcCH(parseFloat(effHI)||0, oldTee.slope||113, oldTee.rating||72, oldTee.par||72);
                        const newCH = calcCH(parseFloat(effHI)||0, newTee.slope||113, newTee.rating||72, newTee.par||72);
                        showChDelta(`tee_${editRound}_${p.player_id}`, newCH - oldCH);
                      }
                      setTeeAssignments(prev => ({ ...prev, [editRound]: { ...(prev[editRound]||{}), [p.player_id]: teeName } }));
                    };
                    return (
                      <div key={p.player_id} style={{ display: "grid", gridTemplateColumns: `1fr 30px 58px ${tees2.map(() => "22px").join(" ")} 22px`, gap: 4, alignItems: "center", marginBottom: 3 }}>
                        <div style={{ fontSize: FS.small, color: playerNameColor(), fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                        <div title={hiOverridden ? `Index override (base ${p.handicap_index})` : undefined} style={{ fontSize: FS.label, color: hiOverridden ? BC.amber : BC.t3, fontWeight: hiOverridden ? 700 : 400, textAlign: "center" }}>{effHI}{hiOverridden ? "*" : ""}</div>
                        <input
                          type="number" step="1"
                          // readOnly (not disabled) when final so the tap still
                          // fires onFocus and the popup can explain the block.
                          readOnly={roundIsFinal}
                          onFocus={() => warnRoundLocked()}
                          value={hasOverride ? override : ""}
                          onChange={e => {
                            if (roundIsFinal) return;
                            setHcpOverrides(prev => ({ ...prev, [editRound]: { ...(prev[editRound]||{}), [p.player_id]: e.target.value } }));
                          }}
                          placeholder={calcedCH != null ? String(calcedCH) : "CH"}
                          style={{ padding: "5px 8px", background: hasOverride ? BC.amber + ALPHA.wash : BC.inp, border: `1px solid ${hasOverride ? BC.amber : BC.bdr}`, borderRadius: 6, color: hasOverride ? BC.amber : BC.t2, fontSize: FS.small, fontWeight: hasOverride ? 700 : 400, outline: "none", textAlign: "center", opacity: roundIsFinal ? 0.5 : 1, cursor: roundIsFinal ? "not-allowed" : "text" }}
                        />
                        {tees2.map((tee, ti) => {
                          const isAct = currentTee2 === tee.name;
                          // Not `disabled` when final — the tap must still land
                          // so warnRoundLocked can explain WHY nothing changes.
                          return (
                            <button key={tee.name} onClick={() => { if (warnRoundLocked()) return; assignTee2(tee.name); }} title={tee.name} style={{
                              background: "transparent", border: "none", cursor: roundIsFinal ? "not-allowed" : "pointer", padding: 0,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              opacity: roundIsFinal ? (isAct ? 0.55 : 0.2) : (isAct ? 1 : 0.35),
                              transform: isAct ? "scale(1.3)" : "scale(1)",
                              transition: "all 0.15s ease",
                            }}>
                              <TeeSwatch tee={tee} index={ti} size={14} round active={isAct} />
                            </button>
                          );
                        })}
                        {/* Standing override delta wins over the passing one a
                            tee change raises — once a manual CH is set the tee
                            no longer decides this player's strokes. */}
                        <div
                          title={overrideDelta != null ? `Manual CH ${overrideCH} — calculated is ${calcedCH}` : undefined}
                          style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {overrideDelta != null
                            ? <ChDeltaBadge delta={overrideDelta} />
                            : chDeltas[`tee_${editRound}_${p.player_id}`] !== undefined && (
                                <ChDeltaBadge delta={chDeltas[`tee_${editRound}_${p.player_id}`]} />
                              )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Auto-save status. Stands in for the old Save button: the
                only thing a director still needs from it is confidence
                that the edit landed. */}
            {(() => {
              const phase = autoSave?.round === editRound ? autoSave.phase : null;
              const [text, color] = roundIsFinal
                ? [`Round ${editRound} is final — changes are not saved`, BC.danger]
                : phase === "error"
                  ? [`Round ${editRound} could not be saved — retrying on your next edit`, BC.danger]
                  : phase === "saving" || (roundDirty && formSeeded)
                    ? ["Saving…", BC.amber]
                    : phase === "saved"
                      ? [`Round ${editRound} saved`, BC.t3]
                      : ["Changes save automatically", BC.t3];
              return (
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  padding: "8px 0 2px", fontSize: FS.label, fontWeight: 700, letterSpacing: 0.5, color,
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                    background: color, opacity: color === BC.t3 ? 0.5 : 1,
                  }} />
                  {text}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {tab === "matches" && (
        <MatchSetup
          round={matchRound}
          setRound={setMatchRound}
          tRounds={tRounds}
          courses={courses}
          tPlayers={tPlayers}
          matches={matches}
          teams={teams}
          teamNames={teamNames}
          hcpOverrides={hcpOverrides}
          teeAssignments={teeAssignments}
          roundLocks={roundLocks}
          storedGroups={groupsFromDb?.[matchRound] || null}
          onSaveGroups={onSaveGroups}
          onSetMatch={onSetMatch}
          notify={notify}
          confirm={confirm}
          holeData={holeData}
          onDiscardRoundScores={onDiscardRoundScores}
        />
      )}

      {tab === "courses" && (
        <div>
          {/* Course Library */}
          <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, marginBottom: 14, overflow: "hidden" }}>
            <div style={{ padding: "9px 14px", borderBottom: `1px solid ${BC.bdr}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: FS.small, fontWeight: 700, color: BC.gold }}>{courses.length} COURSE{courses.length !== 1 ? "S" : ""}</span>
              <button onClick={() => { setSearching(!searching); setCourseSearch(""); setSearchResults([]); }} style={{ padding: "4px 10px", borderRadius: 6, background: "transparent", border: `1px solid ${BC.amber}${ALPHA.line}`, color: BC.amber, fontSize: FS.label, fontWeight: 700, cursor: "pointer" }}>
                {searching ? "Close" : "+ Add Course"}
              </button>
            </div>

            {courses.map((c, i) => (
              <div key={c.id} style={{ borderBottom: i < courses.length - 1 ? `1px solid ${BC.bdr}${ALPHA.hair}` : "none" }}>
                <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
                  <button onClick={() => setExpandedCourse(expandedCourse === c.id ? null : c.id)} style={{ flex: 1, background: "transparent", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: FS.body, color: BC.t1 }}>{c.name}</div>
                    <div style={{ fontSize: FS.label, color: BC.t3, marginTop: 1 }}>{[c.city, c.state].filter(Boolean).join(", ")} · Par {c.par} · Slope {c.slope}</div>
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
                            await onSetRound({ id: editionDocId(`bc_round_${r}`), tournament_id: TOURNAMENT_ID, round_number: r, course_id: null, format: tr?.format || DEFAULT_FORMAT, tee_time: tr?.tee_time || "", nassau_front: tr?.nassau_front || 1, nassau_back: tr?.nassau_back || 1, nassau_overall: tr?.nassau_overall || 1 });
                          } else if (otherCourse) {
                            if (await confirm(`Replace ${otherCourse.name} for Rd ${r}?`)) {
                              await onSetRound({ id: editionDocId(`bc_round_${r}`), tournament_id: TOURNAMENT_ID, round_number: r, course_id: c.id, format: tr?.format || DEFAULT_FORMAT, tee_time: tr?.tee_time || "", nassau_front: tr?.nassau_front || 1, nassau_back: tr?.nassau_back || 1, nassau_overall: tr?.nassau_overall || 1 });
                            }
                          } else {
                            await onSetRound({ id: editionDocId(`bc_round_${r}`), tournament_id: TOURNAMENT_ID, round_number: r, course_id: c.id, format: tr?.format || DEFAULT_FORMAT, tee_time: tr?.tee_time || "", nassau_front: tr?.nassau_front || 1, nassau_back: tr?.nassau_back || 1, nassau_overall: tr?.nassau_overall || 1 });
                          }
                        }} style={{
                          padding: "3px 6px", borderRadius: 4, fontSize: FS.label, fontWeight: 700, cursor: "pointer", minWidth: 24, textAlign: "center",
                          background: isAssigned ? BC.amber : "transparent",
                          color: isAssigned ? ON_AMBER : BC.t3,
                          border: `1px solid ${isAssigned ? BC.amber : BC.bdr}`,
                        }}>R{r}</button>
                      );
                    })}
                  </div>
                  <button onClick={() => setCoursePreview(c)} title="Edit course name, tees & scorecard" style={{ background: "transparent", border: `1px solid ${BC.bdr}`, color: BC.t3, cursor: "pointer", fontSize: FS.label, fontWeight: 700, borderRadius: 4, padding: "3px 6px" }}>Edit</button>
                  <button onClick={async () => { if (await confirm(`Remove ${c.name}?`)) onAddCourse({ ...c, _delete: true }); }} style={{ background: "transparent", border: "none", color: BC.t3, cursor: "pointer", fontSize: FS.body, padding: "2px 4px" }}>✕</button>
                </div>
                {expandedCourse === c.id && (
                  <div style={{ padding: "0 14px 12px", background: BC.amber + ALPHA.wash }}>
                    {(c.tee_boxes || []).sort((a,b) => (parseFloat(b.slope)||0) - (parseFloat(a.slope)||0)).map((tb, tbi) => (
                      <div key={tbi} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3, fontSize: FS.label }}>
                        <TeeSwatch tee={tb} index={tbi} size={10} />
                        <span style={{ color: BC.t2, fontWeight: 600, width: 50 }}>{tb.name}</span>
                        <span style={{ color: BC.t3 }}>Rating {tb.rating} · Slope {tb.slope} · Par {tb.par}</span>
                      </div>
                    ))}
                    {(c.tee_boxes || []).length === 0 && <div style={{ fontSize: FS.label, color: BC.t3, fontStyle: "italic" }}>No tee data</div>}
                  </div>
                )}
              </div>
            ))}
            {courses.length === 0 && <div style={{ padding: "16px 14px", color: BC.t3, fontSize: FS.small }}>No courses yet. Add one below.</div>}
          </div>

          {/* Search panel */}
          {searching && (
            <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, padding: 14 }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                {/* fontSize 16 on both controls prevents iOS Safari's
                    zoom-on-focus (anything < 16px zooms the whole page in and
                    doesn't zoom back). The search input is autoFocused, so a
                    smaller size zoomed the view the instant the panel opened. */}
                <select value={courseStateFilter} onChange={e => { setCourseStateFilter(e.target.value); if (courseSearch.trim().length >= 2) doCourseSearch(courseSearch, e.target.value); }}
                  style={{ width: 64, padding: "9px 6px", background: BC.inp, border: `1px solid ${BC.amber}${ALPHA.line}`, borderRadius: 8, color: BC.t1, fontSize: FS.lead, flexShrink: 0 }}>
                  <option value="">All</option>
                  {["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <input value={courseSearch} onChange={e => doCourseSearch(e.target.value)} placeholder="Search by course or city..." autoFocus
                  style={{ flex: 1, padding: "9px 12px", background: BC.inp, border: `1px solid ${BC.amber}${ALPHA.line}`, borderRadius: 8, color: BC.t1, fontSize: FS.lead, outline: "none" }} />
              </div>

              {searchLoading && <div style={{ textAlign: "center", padding: 12, color: BC.t3, fontSize: FS.small }}>Searching GolfCourseAPI...</div>}

              {!searchLoading && courseSearch.trim().length >= 2 && searchResults.length === 0 && (
                <div style={{ textAlign: "center", padding: "10px 0", color: BC.t3, fontSize: FS.small }}>No courses found for "{courseSearch}"</div>
              )}

              {!searchLoading && searchResults.filter(c => !courses.find(ex => ex.name.toLowerCase() === c.name.toLowerCase())).map(c => (
                <button key={c.id} onClick={() => setCoursePreview({ ...c, hole_pars: c.hole_pars?.length ? c.hole_pars : Array(18).fill(4), hole_handicaps: c.hole_handicaps?.length ? c.hole_handicaps : Array(18).fill(0).map((_,i)=>i+1) })}
                  style={{ display: "block", width: "100%", background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 10, padding: "10px 14px", cursor: "pointer", textAlign: "left", color: BC.t1, marginBottom: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontWeight: 600, fontSize: FS.body }}>{c.name}</span>
                        {c._incompleteData && <span style={{ fontSize: FS.micro, background: `${BC.danger}${ALPHA.tint}`, border: `1px solid ${BC.danger}${ALPHA.hair}`, color: BC.danger, borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>⚠ incomplete</span>}
                        {c._source && <span style={{ fontSize: FS.micro, background: `${BC.amber}${ALPHA.wash}`, border: `1px solid ${BC.amber}${ALPHA.hair}`, color: BC.amber, borderRadius: 4, padding: "1px 5px", fontWeight: 600 }}>{c._source}</span>}
                      </div>
                      <div style={{ fontSize: FS.label, color: BC.t3 }}>{[c.city, c.state].filter(Boolean).join(", ")}{c.par ? ` · Par ${c.par}` : ""}{c.slope && c.slope !== 113 ? ` · Slope ${c.slope}` : ""}</div>
                    </div>
                    <span style={{ color: BC.amber, fontSize: FS.small, fontWeight: 700 }}>Preview →</span>
                  </div>
                </button>
              ))}

              {!courseSearch.trim() && <div style={{ color: BC.t3, fontSize: FS.label, textAlign: "center", padding: 4 }}>Type at least 2 characters to search</div>}
              <div style={{ fontSize: FS.label, color: BC.t3, textAlign: "center", marginTop: 8 }}>Powered by GolfCourseAPI.com · 35,000+ courses</div>
            </div>
          )}

          {/* Course Preview / Edit Modal */}
          {coursePreview && (() => {
            const draft = coursePreview;
            const setDraft = fn => setCoursePreview(prev => fn(prev));
            const tbs = draft.tee_boxes || [];
            // Existing (saved) course vs a fresh API search result.
            const isExisting = String(draft.id || "").startsWith("bc_course_");
            // Re-fetch tee data from the golf API by course name (+ state). Use
            // for recovery when tees were deleted/edited by mistake. Replaces the
            // whole tee list with the API's; the director reviews and Saves.
            const refetchTeesFromApi = async () => {
              if (!draft.name?.trim()) { notify("Add a course name first", "error"); return; }
              setRefetchingTees(true);
              try {
                const results = await fetchCourseResults(draft.name, draft.state || "");
                const withTees = results.filter(r => (r.tee_boxes || []).length);
                const nameLc = draft.name.trim().toLowerCase();
                const match = withTees.find(r => r.name.toLowerCase() === nameLc)
                  || withTees.find(r => r.name.toLowerCase().includes(nameLc.split(" ")[0]))
                  || withTees[0];
                if (!match) { notify("No tee data found from the golf API for this course", "error"); return; }
                setDraft(p => ({
                  ...p,
                  tee_boxes: match.tee_boxes,
                  hole_pars: (match.hole_pars?.length ? match.hole_pars : p.hole_pars),
                  hole_handicaps: (match.hole_handicaps?.length ? match.hole_handicaps : p.hole_handicaps),
                  _incompleteData: false,
                }));
                notify(`Loaded ${match.tee_boxes.length} tee${match.tee_boxes.length !== 1 ? "s" : ""} from ${match._source || "API"} — review & Save`, "success");
              } catch { notify("Re-fetch failed", "error"); }
              finally { setRefetchingTees(false); }
            };
            const ti = { background: BC.bg, border: `1px solid ${BC.amber}${ALPHA.hair}`, borderRadius: 4, color: BC.t1, fontSize: FS.label, textAlign: "center", width: "100%", padding: "3px 2px", boxSizing: "border-box" };
            const tiL = { ...ti, textAlign: "left", padding: "3px 5px" };
            return (
              <Popup onClose={() => setCoursePreview(null)} maxWidth={420} padding={0} innerStyle={{ background: BC.card, borderRadius: 16, border: `1px solid ${BC.amber}${ALPHA.line}` }}>

                  {/* Header */}
                  <div style={{ padding: "14px 16px 10px", borderBottom: `1px solid ${BC.bdr}`, position: "sticky", top: 0, background: BC.card, zIndex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ flex: 1, marginRight: 8 }}>
                        <input value={draft.name} onChange={e => setDraft(p => ({...p, name: e.target.value}))}
                          style={{ background: "transparent", border: "none", borderBottom: `1px solid ${BC.amber}${ALPHA.line}`, color: BC.t1, fontSize: FS.lead, fontWeight: 800, width: "100%", padding: "2px 0", outline: "none" }} />
                        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                          <input value={draft.city||""} onChange={e => setDraft(p => ({...p, city: e.target.value}))} placeholder="City"
                            style={{ ...tiL, fontSize: FS.label, flex: 1 }} />
                          <select value={draft.state||""} onChange={e => setDraft(p => ({...p, state: e.target.value}))}
                            style={{ ...ti, fontSize: FS.label, width: 52 }}>
                            <option value="">—</option>
                            {["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"].map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                      </div>
                      <button onClick={() => setCoursePreview(null)} style={{ background: "transparent", border: "none", color: BC.t3, fontSize: FS.title, cursor: "pointer", lineHeight: 1 }}>✕</button>
                    </div>
                    {draft._incompleteData && (
                      <div style={{ marginTop: 8, padding: "7px 10px", background: `${BC.danger}${ALPHA.wash}`, border: `1px solid ${BC.danger}${ALPHA.hair}`, borderRadius: 8, fontSize: FS.label, color: BC.danger }}>
                        ⚠ Incomplete data — slope, rating, or tee boxes may be missing. Edit manually below.
                      </div>
                    )}
                  </div>

                  <div style={{ padding: "12px 16px" }}>
                    {/* Tee Boxes */}
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, gap: 6 }}>
                        <div style={{ fontSize: FS.label, color: BC.t3, fontWeight: 700, textTransform: "uppercase" }}>Tee Boxes</div>
                        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                          {/* Recover tee data from the golf API — e.g. after a tee
                              was deleted by mistake. Replaces the tee list below. */}
                          <button onClick={refetchTeesFromApi} disabled={refetchingTees} title="Re-fetch tees from the golf API by course name"
                            style={{ fontSize: FS.label, padding: "2px 7px", borderRadius: 4, background: "transparent", border: `1px solid ${BC.hcpBlue}${ALPHA.line}`, color: BC.hcpBlue, cursor: refetchingTees ? "default" : "pointer", fontWeight: 700, opacity: refetchingTees ? 0.5 : 1 }}>
                            {refetchingTees ? "Fetching…" : "⟳ Re-fetch tees"}
                          </button>
                          <button onClick={() => setDraft(p => ({ ...p, tee_boxes: [...(p.tee_boxes||[]), { name: "", color: TEE_UNSET, rating: 72.0, slope: 113, par: 72, yardage: 0 }] }))}
                            style={{ fontSize: FS.label, padding: "2px 7px", borderRadius: 4, background: "transparent", border: `1px solid ${BC.amber}${ALPHA.line}`, color: BC.amber, cursor: "pointer", fontWeight: 700 }}>+ Tee</button>
                        </div>
                      </div>
                      {tbs.length === 0 && <div style={{ fontSize: FS.label, color: BC.warn, marginBottom: 8, fontStyle: "italic" }}>⚠ No tees from API — add manually</div>}
                      <div style={{ display: "grid", gridTemplateColumns: "18px 1fr 44px 38px 30px 46px 18px", gap: "3px 4px", fontSize: FS.micro, color: BC.t3, fontWeight: 600, marginBottom: 3 }}>
                        <div/><div>Name</div><div style={{textAlign:"center"}}>Rating</div><div style={{textAlign:"center"}}>Slope</div><div style={{textAlign:"center"}}>Par</div><div style={{textAlign:"center"}}>Yards</div><div/>
                      </div>
                      {tbs.map((tb, i) => (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "18px 1fr 44px 38px 30px 46px 18px", gap: "3px 4px", marginBottom: 4, alignItems: "center" }}>
                          <TeeSwatch tee={tb} index={i} size={18} />
                          <input value={tb.name} onChange={e => setDraft(p => { const t=[...p.tee_boxes]; t[i]={...t[i],name:e.target.value}; return {...p,tee_boxes:t}; })} style={{...tiL}} placeholder="Name" />
                          <input value={tb.rating} onChange={e => setDraft(p => { const t=[...p.tee_boxes]; t[i]={...t[i],rating:e.target.value}; return {...p,tee_boxes:t}; })} style={ti} />
                          <input value={tb.slope} onChange={e => setDraft(p => { const t=[...p.tee_boxes]; t[i]={...t[i],slope:e.target.value}; return {...p,tee_boxes:t}; })} style={ti} />
                          <input value={tb.par} onChange={e => setDraft(p => { const t=[...p.tee_boxes]; t[i]={...t[i],par:e.target.value}; return {...p,tee_boxes:t}; })} style={ti} />
                          <input value={tb.yardage} onChange={e => setDraft(p => { const t=[...p.tee_boxes]; t[i]={...t[i],yardage:e.target.value}; return {...p,tee_boxes:t}; })} style={ti} />
                          <button onClick={() => setDraft(p => ({...p, tee_boxes: p.tee_boxes.filter((_,j) => j!==i)}))} style={{ background:"transparent", border:"none", color:BC.t3, fontSize:FS.small, cursor:"pointer", padding:0 }}>✕</button>
                        </div>
                      ))}
                    </div>

                    {/* Scorecard */}
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: FS.label, color: BC.t3, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Scorecard</div>
                      {[["Front", 0, 9], ["Back", 9, 9]].map(([lbl, start, count]) => {
                        const pars = (draft.hole_pars || Array(18).fill(4)).slice(start, start+count);
                        const hcps = (draft.hole_handicaps || Array(18).fill(0)).slice(start, start+count);
                        const activeTee = (draft.tee_boxes || [])[0];
                        const hy = (activeTee?.hole_yards || []).slice(start, start+count);
                        const hasYds = hy.some(y => y > 0);
                        return (
                          <div key={lbl} style={{ marginBottom: 6 }}>
                            <div style={{ display: "grid", gridTemplateColumns: `28px repeat(${count}, 1fr) 30px`, gap: 1, fontSize: FS.micro }}>
                              <div style={{ color: BC.t3, fontWeight: 600, padding: "2px 0" }}>Hole</div>
                              {Array.from({length:count},(_,i) => <div key={i} style={{ textAlign:"center", color:BC.t2, fontWeight:700, padding:"2px 0" }}>{start+i+1}</div>)}
                              <div style={{ textAlign:"center", color:BC.t3, fontSize:FS.micro, padding:"2px 0" }}>Tot</div>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: `28px repeat(${count}, 1fr) 30px`, gap: 1, fontSize: FS.micro, background: BC.inp, borderRadius: 3, marginBottom: 1 }}>
                              <div style={{ color: BC.t3, fontWeight: 600, padding: "3px 2px" }}>Par</div>
                              {Array.from({length:count},(_,i) => (
                                <input key={i} value={pars[i]??""} onChange={e => setDraft(p => { const hp=[...(p.hole_pars||Array(18).fill(4))]; hp[start+i]=e.target.value; return {...p,hole_pars:hp}; })}
                                  style={{ background:"transparent", border:"none", color:BC.t1, fontSize:FS.micro, fontWeight:700, textAlign:"center", width:"100%", padding:"3px 0", outline:"none" }} />
                              ))}
                              <div style={{ textAlign:"center", color:BC.amber, fontWeight:800, padding:"3px 0", fontSize:FS.micro }}>{pars.reduce((a,b)=>a+(parseInt(b)||0),0)}</div>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: `28px repeat(${count}, 1fr) 30px`, gap: 1, fontSize: FS.micro, marginBottom: 1 }}>
                              <div style={{ color: BC.t3, fontWeight: 600, padding: "2px 2px" }}>HCP</div>
                              {Array.from({length:count},(_,i) => (
                                <input key={i} value={hcps[i]??""} onChange={e => setDraft(p => { const hh=[...(p.hole_handicaps||Array(18).fill(0))]; hh[start+i]=e.target.value; return {...p,hole_handicaps:hh}; })}
                                  style={{ background:"transparent", border:"none", color:BC.t3, fontSize:FS.micro, textAlign:"center", width:"100%", padding:"2px 0", outline:"none" }} />
                              ))}
                              <div />
                            </div>
                            {hasYds && (
                              <div style={{ display: "grid", gridTemplateColumns: `28px repeat(${count}, 1fr) 30px`, gap: 1, fontSize: FS.micro }}>
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
                      <button onClick={() => setCoursePreview(null)} style={{ flex: 1, padding: "10px 0", borderRadius: 8, background: "transparent", border: `1px solid ${BC.bdr}`, color: BC.t3, fontSize: FS.small, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
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
                        notify(`${finalCourse.name} ${isExisting ? "updated" : "added"}!`, "success");
                      }} style={{ flex: 2, padding: "10px 0", borderRadius: 8, background: `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})`, border: "none", color: ON_AMBER, fontSize: FS.body, fontWeight: 700, cursor: "pointer" }}>{isExisting ? "✓ Save Changes" : "✓ Add Course"}</button>
                    </div>
                  </div>
              </Popup>
            );
          })()}
        </div>
      )}

      {tab === "tournament" && (
        <div>
          {/* Active edition — switch year or create a new edition */}
          <div style={{ fontSize: FS.label, fontWeight: 700, color: BC.t3, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 8 }}>Active Edition</div>
          <button onClick={() => setShowEditions(true)} style={{
            width: "100%", marginBottom: 16, padding: "12px 14px", borderRadius: 10,
            background: BC.card, border: `1px solid ${BC.bdr}`, color: BC.t1,
            fontSize: FS.body, fontWeight: 700, letterSpacing: 0.3, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span>Edition · <span style={{ color: BC.amber }}>{TOURNAMENT_ID}</span></span>
            <span style={{ fontSize: FS.small, color: BC.t3 }}>Switch / new ›</span>
          </button>

          {/* Tournament identity — name and location.
              One card and one Save for both: they're the same sentence on
              every screen that shows them ("The Bourbon Cup · 2025 · Gaylord,
              MI"), and a director renaming the tournament for a new venue
              would otherwise have to remember two separate saves. An empty
              field falls back to its constant rather than saving blank, so
              the header can't end up with a hole in it. */}
          <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, padding: 14, marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: FS.label, fontWeight: 700, color: BC.t3, letterSpacing: 1.5, textTransform: "uppercase" }}>Tournament</div>
              <button
                onClick={() => onSaveTournament({
                  name: editTournamentName.trim() || TOURNAMENT_TITLE,
                  location: editTournamentLocation.trim() || TOURNAMENT_LOCATION,
                })}
                style={{ flexShrink: 0, fontSize: FS.small, fontWeight: 700, color: ON_AMBER, background: BC.amber, border: "none", borderRadius: 6, padding: "8px 14px", cursor: "pointer" }}
              >Save</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { key: "name", val: editTournamentName, set: setEditTournamentName, ph: TOURNAMENT_TITLE, lbl: "Name" },
                { key: "location", val: editTournamentLocation, set: setEditTournamentLocation, ph: TOURNAMENT_LOCATION, lbl: "Location" },
              ].map(f => (
                <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {/* 58 is the width of the longest label ("LOCATION") at
                      FS.label/700 with this tracking, rounded up. The gutter
                      is fixed so the two inputs share a left edge. */}
                  <span style={{ fontSize: FS.label, fontWeight: 700, color: BC.t3, letterSpacing: 0.5, width: 58, flexShrink: 0, textTransform: "uppercase" }}>{f.lbl}</span>
                  <input
                    value={f.val}
                    onChange={e => f.set(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
                    placeholder={f.ph}
                    style={{ flex: 1, minWidth: 0, boxSizing: "border-box", padding: "10px 12px", background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 8, color: BC.t1, fontSize: FS.body, fontWeight: 700, outline: "none", fontFamily: FONT }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Teams — name, imported logo, brand color */}
          <div style={{ fontSize: FS.label, fontWeight: 700, color: BC.t3, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 8 }}>Teams</div>
          {[teams.A, teams.B].map(team => {
            const previewLogo = brandLogoEdit[team.id] || team.logo;
            const dirty = teamDirty(team.id);
            return (
              <div key={team.id} style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, padding: 12, marginBottom: 10 }}>
                {/* Name row — the card's header, with its Save on the right */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 8, background: brandSwatch(team.id) + "22", border: `1px solid ${brandSwatch(team.id)}${ALPHA.line}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" }}>
                    {previewLogo
                      ? <img src={previewLogo} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      : <span style={{ fontSize: FS.body, fontWeight: 800, color: brandSwatch(team.id) }}>{team.id}</span>}
                  </div>
                  <input
                    value={editTeamNames[team.id]}
                    onChange={e => setEditTeamNames(n => ({ ...n, [team.id]: e.target.value }))}
                    onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
                    placeholder={`Team ${team.id}`}
                    style={{ flex: 1, minWidth: 0, boxSizing: "border-box", padding: "9px 10px", background: BC.inp, border: `1px solid ${brandSwatch(team.id)}${ALPHA.line}`, borderRadius: 8, color: BC.t1, fontSize: FS.body, fontWeight: 800, letterSpacing: 0.5, outline: "none", fontFamily: FONT }}
                  />
                  <button
                    onClick={() => saveTeam(team.id)}
                    disabled={!dirty}
                    style={{
                      flexShrink: 0, fontSize: FS.small, fontWeight: 700, borderRadius: 6, padding: "8px 14px", whiteSpace: "nowrap",
                      color: dirty ? ON_AMBER : BC.t3,
                      background: dirty ? BC.amber : BC.inp,
                      border: dirty ? "none" : `1px solid ${BC.bdr}`,
                      cursor: dirty ? "pointer" : "default",
                    }}
                  >Save</button>
                </div>

                {/* Logo import + color row */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 26, height: 26, borderRadius: "50%", background: brandSwatch(team.id), border: `2px solid ${BC.bdr}`, flexShrink: 0 }} />
                  <input
                    value={brandEdit[team.id]}
                    onChange={e => setBrandEdit(b => ({ ...b, [team.id]: e.target.value }))}
                    placeholder="#rrggbb"
                    style={{ width: 100, boxSizing: "border-box", padding: "8px 8px", background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 6, color: BC.t1, fontSize: FS.small, fontWeight: 600, outline: "none", fontFamily: FONT }}
                  />
                  <label style={{ marginLeft: "auto", fontSize: FS.small, fontWeight: 700, color: BC.t2, background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 6, padding: "8px 10px", cursor: "pointer", whiteSpace: "nowrap" }}>
                    {brandBusy === team.id ? "Reading…" : "Import logo"}
                    <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => { pickLogo(team.id, e.target.files?.[0]); e.target.value = ""; }} />
                  </label>
                </div>
                <div style={{ fontSize: FS.label, color: BC.t3, marginTop: 6, lineHeight: 1.4 }}>
                  Import a logo to set the team badge and auto-fill its color, or enter a hex. Save applies the name and branding live across the app.
                </div>
              </div>
            );
          })}
        </div>
      )}
      <ConfirmModal modal={confirmModal} />
    </div>
  );
}


// ── Betting View ──
function BettingView({ tPlayers, tRounds, courses, holeData, skinsData, ctpData, skinsPot, onSetSkin, onSetCtp, onUpdatePot, user, enrichedRounds, roundLocks, hcpOverrides, teeAssignments, teams }) {
  const [activeTab, setActiveTab] = useState("skins");
  const [activeRound, setActiveRound] = useState(1);
  const [editPot, setEditPot] = useState(false);
  const [potInput, setPotInput] = useState(String(skinsPot));
  const [grossMode, setGrossMode] = useState(false);

  const tr = tRounds.find(t => t.round_number === activeRound);
  const course = courses.find(c => c.id === tr?.course_id);
  const holePars = resolveHolePars(course);
  const par3s = holePars.map((p, i) => ({ hole: i, par: p })).filter(h => h.par === 3);

  // Compute skins for a round
  const computeSkins = (round, gross) => {
    const tr2 = tRounds.find(t => t.round_number === round);
    // Net skins are handicap-derived, so they answer to the round lock too —
    // a settled skin must not change hands because someone synced a GHIN
    // index the next morning.
    const bLock = lockForRound(roundLocks, round);
    const course2 = courses.find(c => c.id === (bLock?.course_id || tr2?.course_id));
    const pars = resolveHolePars(course2, bLock);
    const hcps = resolveHoleHcps(course2, bLock);

    const skins = [];
    for (let h = 0; h < 18; h++) {
      const scores = tPlayers.map(p => {
        const raw = (holeData[`${p.player_id}_${round}`] || {})[h];
        if (raw == null) return null;
        if (gross) return { pid: p.player_id, name: p.name, score: raw };
        // Net: strokes off the frozen CH when the round is locked. Uses the
        // canonical buildStrokeMap so handicaps over 18 wrap correctly (a hole
        // can get 2+ strokes) — the old inline lookup capped every hole at 1.
        const ch = getRoundCH({
          roundLocks, round, pid: p.player_id, players: tPlayers,
          course: course2, chOverrides: hcpOverrides, teeAssignments, roundTee: tr2?.tee_box,
        });
        const strokes = buildStrokeMap(ch, hcps)[h] || 0;
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
    <div style={{ fontFamily: FONT }}>
      {/* Tab toggle */}
      <SegmentedToggle
        options={[["skins", "🎰 Skins"], ["ctp", "🎯 Closest to Pin"]]}
        value={activeTab} onChange={setActiveTab} style={{ marginBottom: 14 }}
      />

      {activeTab === "skins" && (
        <div>
          {/* Pot */}
          <div style={{ background: BC.card, borderRadius: 12, padding: "12px 14px", marginBottom: 12, border: `1px solid ${BC.bdr}`, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: FS.label, color: BC.t3, fontWeight: 700, letterSpacing: 1 }}>SKINS POT</div>
              {editPot ? (
                <input autoFocus type="number" value={potInput} onChange={e => setPotInput(e.target.value)}
                  onBlur={() => { onUpdatePot(parseFloat(potInput)||0); setEditPot(false); }}
                  onKeyDown={e => { if (e.key === "Enter") { onUpdatePot(parseFloat(potInput)||0); setEditPot(false); }}}
                  style={{ fontSize: FS.title, fontWeight: 800, color: BC.gold, background: "transparent", border: "none", borderBottom: `1px solid ${BC.amber}`, outline: "none", width: 100, fontFamily: FONT }} />
              ) : (
                <div onClick={() => user?.isDirector && setEditPot(true)} style={{ fontSize: FS.title, fontWeight: 800, color: BC.gold, cursor: user?.isDirector ? "pointer" : "default" }}>
                  ${skinsPot.toFixed(2)}
                </div>
              )}
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: FS.label, color: BC.t3 }}>{totalSkins} skins won</div>
              <div style={{ fontSize: FS.body, fontWeight: 700, color: BC.amber }}>${perSkin} / skin</div>
            </div>
          </div>

          {/* Gross/Net toggle */}
          <SegmentedToggle
            options={[[false, "Net"], [true, "Gross"]]}
            value={grossMode}
            onChange={setGrossMode}
            style={{ marginBottom: 12, width: 160 }}
          />

          {/* Leaderboard */}
          {Object.keys(skinCount).length > 0 && (
            <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, marginBottom: 12, overflow: "hidden" }}>
              <div style={{ padding: "8px 14px", borderBottom: `1px solid ${BC.bdr}`, fontSize: FS.label, fontWeight: 700, color: BC.gold, letterSpacing: 1 }}>SKINS LEADERS</div>
              {Object.entries(skinCount).sort((a,b) => b[1]-a[1]).map(([pid, count]) => {
                const p = tPlayers.find(t => t.player_id === pid);
                const team = p ? teams[p.team] : null;
                return (
                  <div key={pid} style={{ display: "flex", alignItems: "center", padding: "8px 14px", borderBottom: `1px solid ${BC.bdr}${ALPHA.hair}`, gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: team?.accent || BC.t3, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: FS.body, fontWeight: 600, color: BC.t1 }}>{p?.name || pid}</span>
                    <span style={{ fontSize: FS.body, fontWeight: 700, color: BC.amber }}>{count} skin{count !== 1 ? "s" : ""}</span>
                    <span style={{ fontSize: FS.small, color: BC.t3 }}>${(count * parseFloat(perSkin)).toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Round tabs */}
          <SegmentedToggle
            variant="pills"
            style={{ marginBottom: 10 }}
            options={[1,2,3,4].map(r => [r, `Rd ${r}`])}
            value={activeRound}
            onChange={setActiveRound}
          />

          {/* Hole-by-hole skins for active round */}
          {computeSkins(activeRound, grossMode).map(s => (
            <div key={s.hole} style={{ display: "flex", alignItems: "center", padding: "7px 12px", background: BC.card, borderRadius: 8, marginBottom: 4, border: `1px solid ${s.winner ? BC.amber + ALPHA.line : s.tied ? BC.bdr : BC.bdr}` }}>
              <span style={{ fontSize: FS.small, fontWeight: 700, color: BC.t3, width: 40 }}>Hole {s.hole + 1}</span>
              <span style={{ fontSize: FS.label, color: BC.t3, width: 30 }}>Par {holePars[s.hole]}</span>
              <span style={{ flex: 1, fontSize: FS.small, fontWeight: 600, color: s.winner ? BC.amber : s.tied ? BC.t3 : BC.t3 }}>
                {s.winner ? `${s.winner.name} (${s.score})` : s.tied ? "Tied — pushed" : "—"}
              </span>
              {s.winner && <span style={{ fontSize: FS.label, color: BC.amber, fontWeight: 700 }}>🏆 Skin</span>}
            </div>
          ))}
        </div>
      )}

      {activeTab === "ctp" && (
        <div>
          <div style={{ fontSize: FS.small, color: BC.t3, marginBottom: 12 }}>Closest to the pin on all par 3s — groups tag their own on the Scoring tab as they play; the director settles the hole here.</div>

          {[1,2,3,4].map(r => {
            const tr2 = tRounds.find(t => t.round_number === r);
            const course2 = courses.find(c => c.id === tr2?.course_id);
            const pars2 = course2?.hole_pars || [];
            const par3holes = pars2.map((p, i) => ({ hole: i, par: p })).filter(h => h.par === 3);
            if (par3holes.length === 0) return null;
            return (
              <div key={r} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: FS.label, fontWeight: 700, color: BC.gold, letterSpacing: 1, marginBottom: 8 }}>ROUND {r} — {course2?.name || "TBD"}</div>
                {par3holes.map(({ hole }) => {
                  const key = `${r}_${hole}`;
                  const rec = ctpData[key];
                  const winnerId = rec?.player_id || null;
                  const winner = tPlayers.find(p => p.player_id === winnerId);
                  // A tag a group entered on the course is provisional until
                  // the director touches it here — picking a name from the
                  // dropdown (even re-picking the same one) is the approval.
                  const pending = !!winnerId && rec?.approved !== true;
                  return (
                    <div key={hole} style={{ background: BC.card, borderRadius: 8, padding: "8px 12px", marginBottom: 4, border: `1px solid ${winner ? BC.amber + ALPHA.line : BC.bdr}`, display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: FS.small, fontWeight: 700, color: BC.t3, width: 44, flexShrink: 0 }}>Hole {hole + 1}</span>
                      {user?.isDirector ? (
                        <select value={winnerId || ""}
                          onChange={e => onSetCtp(r, hole, e.target.value || null, { distanceFt: e.target.value === winnerId ? rec?.distance_ft ?? null : null, approved: true })}
                          style={{ flex: 1, background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 6, color: BC.t1, fontSize: FS.small, padding: "4px 6px", fontFamily: FONT }}>
                          <option value="">-- Not set --</option>
                          {tPlayers.map(p => <option key={p.player_id} value={p.player_id}>{p.name}</option>)}
                        </select>
                      ) : (
                        <span style={{ flex: 1, fontSize: FS.small, fontWeight: 600, color: winner ? BC.amber : BC.t3 }}>{winner ? winner.name : "Not set"}</span>
                      )}
                      {rec?.distance_ft ? <span style={{ fontSize: FS.label, fontWeight: 700, color: BC.amber, flexShrink: 0 }}>{rec.distance_ft} ft</span> : null}
                      {pending && <span title="Tagged on the course — not settled yet" style={{ fontSize: FS.label, fontWeight: 700, color: BC.t3, border: `1px solid ${BC.bdr}`, borderRadius: 4, padding: "1px 4px", flexShrink: 0 }}>Pending</span>}
                      {winner && <span style={{ fontSize: FS.label, color: BC.amber }}>📍</span>}
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
function AnalyticsView({ tPlayers, matches, holeData, tRounds, courses, historicalData, user, hcpOverrides, teeAssignments, roundLocks, teams }) {
  const [analyticsTab, setAnalyticsTab] = useState("current");

  // Compute current year player stats from match results
  const playerStats = useMemo(() => {
    const stats = {};
    tPlayers.forEach(p => { stats[p.player_id] = { name: p.name, team: p.team, wins: 0, losses: 0, halves: 0, pts: 0, skinsWon: 0 }; });

    matches.forEach(m => {
      const fmt = tRounds.find(t => t.round_number === m.round)?.format || DEFAULT_FORMAT;
      const res = computeMatchResult(m, holeData, courses, tRounds, tPlayers, fmt, hcpOverrides || {}, undefined, teeAssignments, roundLocks);
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
  }, [tPlayers, matches, holeData, tRounds, courses, hcpOverrides, teeAssignments, roundLocks]);

  return (
    <div style={{ fontFamily: FONT }}>
      {/* Stats / History switch — pinned, same as every other tab's lead
          control, so it sits where the eye already expects a tab switcher. */}
      <StickyTop padBottom={14}>
        <SegmentedToggle
          options={[["current", `${getTournamentYear()} Stats`], ["history", "History"]]}
          value={analyticsTab} onChange={setAnalyticsTab}
        />
      </StickyTop>

      {analyticsTab === "current" && (
        <div>
          <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 44px 44px 44px 52px", padding: "8px 12px", borderBottom: `1px solid ${BC.bdr}`, fontSize: FS.label, fontWeight: 700, color: BC.t3, letterSpacing: 1 }}>
              <div>PLAYER</div><div style={{textAlign:"center"}}>W</div><div style={{textAlign:"center"}}>L</div><div style={{textAlign:"center"}}>H</div><div style={{textAlign:"right"}}>PTS</div>
            </div>
            {playerStats.map((p, i) => {
              const team = teams[p.team];
              return (
                <div key={p.name} style={{ display: "grid", gridTemplateColumns: "1fr 44px 44px 44px 52px", padding: "9px 12px", borderBottom: i < playerStats.length-1 ? `1px solid ${BC.bdr}${ALPHA.hair}` : "none", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: team?.accent || BC.t3, flexShrink: 0 }} />
                    <span style={{ fontSize: FS.small, fontWeight: 600, color: playerNameColor() }}>{p.name}</span>
                  </div>
                  <div style={{ textAlign: "center", fontSize: FS.small, color: BC.green, fontWeight: 600 }}>{p.wins}</div>
                  <div style={{ textAlign: "center", fontSize: FS.small, color: BC.danger, fontWeight: 600 }}>{p.losses}</div>
                  <div style={{ textAlign: "center", fontSize: FS.small, color: BC.t3 }}>{p.halves}</div>
                  <div style={{ textAlign: "right", fontSize: FS.small, fontWeight: 700, color: BC.amber }}>{p.pts.toFixed(1)}</div>
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
              <div style={{ fontSize: FS.display, marginBottom: 12 }}>📊</div>
              <div style={{ fontSize: FS.body, fontWeight: 700, color: BC.t2, marginBottom: 8 }}>No Historical Data Yet</div>
              <div style={{ fontSize: FS.small }}>Past tournament results will appear here after each year's event is archived.</div>
            </div>
          ) : (
            historicalData.sort((a,b) => b.year - a.year).map(yr => (
              <div key={yr.id} style={{ background: BC.card, borderRadius: 12, padding: 14, marginBottom: 12, border: `1px solid ${BC.bdr}` }}>
                <div style={{ fontSize: FS.body, fontWeight: 700, color: BC.gold, marginBottom: 8 }}>{yr.year} · {yr.location}</div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontSize: FS.small, color: BC.t1 }}><span style={{ color: teams.A.accent, fontWeight: 700 }}>{yr.teamAName}</span> {yr.teamAScore}</div>
                  <div style={{ fontSize: FS.small, color: BC.t1 }}><span style={{ color: teams.B.accent, fontWeight: 700 }}>{yr.teamBName}</span> {yr.teamBScore}</div>
                </div>
                {yr.winner && <div style={{ fontSize: FS.small, color: BC.amber, fontWeight: 700 }}>🏆 {yr.winner} won the Bourbon Cup</div>}
              </div>
            ))
          )}
          {user?.isDirector && (
            <div style={{ textAlign: "center", marginTop: 16 }}>
              <div style={{ fontSize: FS.label, color: BC.t3 }}>Historical data can be added by directors via Firestore directly for now.</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Slide-up Menu ──
// `finalize` is the director's always-available route to the Finalize sheet:
// { label, ready, onOpen }, or null for a player / an event with no rounds.
// The notification only fires on a COMPLETE round, so this is the path to
// finalizing early — a withdrawal or a conceded match leaves holes the
// notification would wait forever for.
// `navH` is the bottom nav's MEASURED height — the menu seats itself on the
// bar, and the bar is not a constant: its labels grow with the OS text-size
// setting, and its padding grows with the home-indicator inset. The 62px
// that used to be hardcoded here was only ever right at the default text
// size on a phone whose nav was exactly that tall; anywhere else the menu
// sank into the bar or floated off it.
function SlideMenu({ open, onClose, onNavigate, onLogout, user, view, darkMode, onToggleTheme, finalize, navH }) {
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
    // Finalize leads: it is the only item here that is an ACTION on the live
    // tournament rather than a place to go, and the only one that is ever
    // time-critical.
    ...(finalize ? [{ key: "finalize", label: finalize.label, icon: "🏁", action: finalize.onOpen, flag: finalize.ready }] : []),
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
          // Flush with the top of the bar: -1px so the menu's bottom border
          // and the bar's top border stay the single hairline they are now.
          // VP_DROP is the band an old home-screen icon leaves below the
          // layout viewport — the bar drops into it, so the menu does too.
          bottom: `calc(${navH - 1}px - ${VP_DROP})`,
          right: "max(8px, calc(50vw - 252px))",
          transform: `translateY(${dragY}px)`,
          transition: dragY === 0 ? "transform 0.2s ease, opacity 0.15s ease" : "none",
          width: 220,
          background: BC.card,
          borderRadius: 12,
          border: `1px solid ${BC.bdr}`,
          boxShadow: `0 -4px 24px ${SHADOW}`,
          zIndex: 201,
          overflow: "hidden",
        }}>

        {/* Menu items — no icons */}
        {items.filter(i => i.key !== "logout").map((item, idx) => {
          const isActive = item.key === view;
          return (
            <button key={item.key} onClick={() => {
              // An action item settles here and never navigates — there is no
              // `finalize` view to route to, only a sheet to raise.
              if (item.action) { item.action(); onClose(); return; }
              if (item.external) { window.open("https://thebourboncup.com/photos", "_blank"); onClose(); return; }
              onNavigate(item.key); onClose();
            }} style={{
              width: "100%", padding: "12px 16px",
              background: isActive ? BC.amber + ALPHA.wash : "transparent",
              borderTop: idx === 0 ? "none" : `1px solid ${BC.bdr}${ALPHA.hair}`,
              borderLeft: "none", borderRight: "none", borderBottom: "none",
              color: isActive || item.flag ? BC.amber : BC.t1,
              fontSize: FS.body, fontWeight: isActive || item.flag ? 700 : 500,
              cursor: "pointer", textAlign: "left",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <span>{item.label}</span>
              {(isActive || item.flag) && <span style={{ width: 6, height: 6, borderRadius: "50%", background: BC.amber, flexShrink: 0 }} />}
            </button>
          );
        })}

        <div style={{ height: 1, background: BC.bdr + ALPHA.hair }} />

        {/* Theme toggle — pill-style switch. Labelled "Dark Mode" because that's
            what the toggle controls; thumb-on-right = dark active, thumb-on-left
            = light. Tap anywhere on the row flips it. */}
        {onToggleTheme && (
          <button onClick={(e) => { e.stopPropagation(); onToggleTheme(); }} style={{
            width: "100%", padding: "12px 16px",
            background: "transparent",
            border: "none", borderTop: `1px solid ${BC.bdr}${ALPHA.hair}`,
            color: BC.t1, fontSize: FS.body, fontWeight: 500,
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
                background: darkMode ? ON_AMBER : BC.card,
                transition: "left 0.2s ease",
                boxShadow: `0 1px 2px ${SHADOW}`,
              }} />
            </span>
          </button>
        )}

        <div style={{ height: 1, background: BC.bdr + ALPHA.hair }} />

        {/* Logout */}
        {items.filter(i => i.key === "logout").map(item => (
          <button key={item.key} onClick={() => { item.onLogout && item.onLogout(); }} style={{
            width: "100%", padding: "12px 16px",
            background: "transparent",
            border: "none",
            color: BC.danger, fontSize: FS.body, fontWeight: 500,
            cursor: "pointer", textAlign: "left",
          }}>
            Logout
          </button>
        ))}
      </div>
    </>
  );
}


// ── Tee colours ───────────────────────────────────────────────────
// One map, one resolver, one ring rule, one component. There used to be two
// of each: this set, and a second copy inside AdminView with a shorter map
// and a differently-worded resolver. Both rendered on the same screen, so a
// "Championship" tee was navy in the tee picker and grey in the list of tee
// boxes three inches below it — the pickers knew seventeen names the list
// did not.
//
// Keys are matched whole first, then as substrings, so "Back Tees" finds
// `back` and "Blue/White" finds `blue`.
const TEE_COLORS = {
  black: "#2c2c2c", blue: "#2d8fd4", white: "#e8e8e8", gold: "#d4a843", red: "#9b2335",
  green: "#2d8a4e", silver: "#a8b2bd", yellow: "#e6c619", orange: "#e67e22", purple: "#7b2d8b",
  maroon: "#6b1c2a", navy: "#1b2a4a", teal: "#1a8a7a", tan: "#c4a86b", copper: "#b87333",
  bronze: "#cd7f32", champagne: "#f7e7ce", crimson: "#b22234", burgundy: "#800020",
  platinum: "#c0c0c0", pewter: "#8e8e8e", sand: "#c2b280", coral: "#ff7f50",
  tournament: "#1a1a2e", championship: "#1a1a2e", tips: "#1a1a2e", pro: "#2d8fd4",
  ladies: "#c0392b", senior: "#d4a843", forward: "#d4a843", back: "#1a1a2e", middle: "#e8e8e8",
};
// The colour of a tee nobody has named or coloured. A neutral mid-grey, so it
// reads as "unset" rather than as a thirty-third tee colour.
const TEE_UNSET = "#888888";
const resolveTeeColor = (tee, index = 0) => {
  const key = (tee?.name || "").toLowerCase().trim();
  if (TEE_COLORS[key]) return TEE_COLORS[key];
  for (const [word, clr] of Object.entries(TEE_COLORS)) if (key.includes(word)) return clr;
  const c = tee?.color || "";
  if (c && c !== "#000" && c !== "#000000" && c !== "black") return c;
  return key || c ? ["#5b8fb9","#8b5e3c","#6b7b3a","#8e44ad","#2e86ab","#a84632"][index % 6] : TEE_UNSET;
};
// Computed, not listed. The old code carried two hand-maintained arrays of
// "which hexes count as pale" and "which count as dark" — seventeen literals
// that silently failed on any colour a director picked themselves. Perceived
// luminance answers the same question for every colour there is.
const isPaleTee = (hex) => {
  const h = String(hex).replace("#", "");
  if (h.length < 6) return false;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
};
// A swatch has to separate from the card behind it, and the two ways that
// fails pull opposite ways: a white or silver tee dissolves into light mode,
// a black one into dark. So the ring runs against the fill's own luminance.
// `active` overrides both with the theme's brightest ink — which is why it is
// BC.t1 and not ON_ACCENT: on the light card a white ring is no ring.
const teeRing = (color, active) =>
  active ? BC.t1 : isPaleTee(color) ? `#000000${ALPHA.hair}` : `#ffffff${ALPHA.line}`;
// `round` is the tee PICKER's affordance (a ball you tap); square is the
// swatch that labels a row. Same colour, same ring, different silhouette.
const TeeSwatch = ({ tee, index = 0, size = 12, round = false, active = false }) => {
  const color = resolveTeeColor(tee, index);
  return (
    <span title={tee?.name || undefined} style={{
      display: "inline-block", width: size, height: size, flexShrink: 0,
      borderRadius: round ? "50%" : 3, background: color,
      border: `${round ? 2 : 1}px solid ${teeRing(color, active)}`,
      boxSizing: "border-box",
    }} />
  );
};

// ── Main App ──
export default function App() {
  // Restore the signed-in user from sessionStorage so a reload (pull-to-refresh
  // picking up a new bundle, or an edition switch) doesn't kick them to login.
  const [user, setUser] = useState(() => readUserSession());
  // Default landing view. Leaderboard is the right home base — the
  // most-glanced screen during a round, and the natural place for a
  // user reopening the app to check current state.
  const [view, setView] = useState("leaderboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [skinsData, setSkinsData] = useState({}); // { "round_hole": pid }
  const [ctpData, setCtpData] = useState({});     // { "round_hole": pid }
  const [skinsPot, setSkinsPot] = useState(0);
  const [historicalData, setHistoricalData] = useState([]);
  // The saved team-name overrides (from the bc_settings/team_names doc).
  // Defaults come from constants so the fallback names live in one place.
  const [teamNames, setTeamNames] = useState(DEFAULT_TEAM_NAMES);
  // Director-set tournament identity (bc_settings/tournament). Both fall back
  // to their constants, so the login screen always has a name and a place
  // even before an edition has been through Admin → Tournament. The YEAR is
  // deliberately not one of these — it follows the active edition (see
  // firebase.getTournamentYear), so it can't disagree with the data on screen.
  const [tournamentName, setTournamentName] = useState(TOURNAMENT_TITLE);
  const [tournamentLocation, setTournamentLocation] = useState(TOURNAMENT_LOCATION);
  // Theme state — toggled via the More menu. The actual color values live in
  // the module-level BC object (mutated by applyBCTheme); this state's only
  // job is to trigger a top-level re-render so children re-read fresh BC
  // values inline. Initial value comes from localStorage so the saved
  // preference survives reloads.
  const [darkMode, setDarkMode] = useState(initialBCMode === "dark");
  // Branding doc (bc_settings/branding): per-edition team colors (extracted
  // from uploaded logos) + optional tournament accent. null = use the
  // constants/theme fallback, so the app looks identical until configured.
  // A mode ref lets async Firestore callbacks apply the theme with the
  // CURRENT light/dark mode without capturing a stale closure.
  const [brand, setBrand] = useState(null);
  const modeRef = useRef(darkMode);
  modeRef.current = darkMode;
  const toggleTheme = useCallback(() => {
    const newMode = darkMode ? "light" : "dark";
    try { localStorage.setItem("bc_theme", newMode); } catch {}
    applyBCTheme(newMode, brand);
    setDarkMode(!darkMode);
  }, [darkMode, brand]);

  // Single resolved-teams source: fixed identity (id/short/logo) + live name
  // (from the team_names doc) + live colors (from the active branding doc via
  // the BC theme tokens). Every view reads its team objects from here, so
  // team name AND color have exactly one origin. Recomputes when names,
  // branding, or light/dark mode change (all of which move BC.teamA/teamB).
  const teams = useMemo(() => {
    const base = resolveTeams(teamNames);
    return {
      A: { ...base.A, accent: BC.teamA, color: BC.teamADim, glow: BC.teamAGlow, logo: brand?.teamA?.logo || base.A.logo },
      B: { ...base.B, accent: BC.teamB, color: BC.teamBDim, glow: BC.teamBGlow, logo: brand?.teamB?.logo || base.B.logo },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamNames, brand, darkMode]);

  // Keep the global <style> tag's body bg in sync with the active theme.
  // Without this, the html/body fill behind the React tree stays whatever
  // color was painted on initial load — toggling the theme leaves a flash
  // of the old color around the safe areas / scroll bounce.
  useEffect(() => {
    const styleEl = document.getElementById("bc-global-style");
    // bcGlobalCSS() is the single source of truth for the document-level
    // rules (see theme.js). Re-emitting the whole sheet here — rather than
    // a hand-maintained copy of it — is what keeps the app-height layout
    // contract intact across a theme toggle.
    if (styleEl) styleEl.textContent = bcGlobalCSS(BC.bg);
  }, [darkMode]);

  const [tPlayers, setTPlayers] = useState([]);
  const [tRounds, setTRounds] = useState([]);
  const [courses, setCourses] = useState([]);
  const [matches, setMatches] = useState([]);
  const [holeData, setHoleData] = useState({});
  const [notif, setNotif] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [hcpOverridesData, setHcpOverridesData] = useState({}); // { round: { pid: value } }
  const [teeAssignmentsData, setTeeAssignmentsData] = useState({});
  // ── Playing groups ── { round: [ [pid, …], … ] }. Who tees off together;
  // group i goes off at slot i of the round's tee_time list. See lib/groups.js.
  const [groupsData, setGroupsData] = useState({});
  // ── Round handicap locks ── { round: lockDoc }. See src/lib/roundLocks.js.
  // Once a round is locked, its scoring reads frozen handicaps and ignores
  // every later edit to a player's index, override, tee, or the course.
  const [roundLocksData, setRoundLocksData] = useState({});

  // ── Finalize: the sheet, and the notification's snooze ────────────
  // `finalizeOpen` raises components/FinalizeRound's sheet. `finalizeSnoozed`
  // is the round whose ready-to-finalize notification the director has
  // dismissed — a round number, not a boolean, so the next round's
  // notification is a NEW one and shows on its own merits.
  //
  // Persisted, because the alternative is nagging: the director who taps ✕
  // has decided to finalize later, and a refresh (or the pull-to-refresh
  // this app encourages, or an iOS PWA reloading itself in the background)
  // would otherwise put the bar straight back. The dot on More survives the
  // dismissal, so nothing is actually lost by remembering it.
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizeSnoozed, setFinalizeSnoozed] = useState(() => {
    try {
      const v = localStorage.getItem(finalizeSnoozeKey());
      return v == null ? null : Number(v);
    } catch { return null; }
  });
  const snoozeFinalizeAlert = useCallback((rnd) => {
    setFinalizeSnoozed(rnd);
    try { localStorage.setItem(finalizeSnoozeKey(), String(rnd)); } catch { /* private mode */ }
  }, []);

  // Refs mirroring the live data the auto-lock needs. The save path runs
  // outside React's render cycle and must snapshot what is true RIGHT NOW —
  // reading these through state would capture whatever the callback closed
  // over, which is exactly the kind of staleness this feature exists to
  // prevent. Refs are always current.
  const roundLocksRef = useRef({});
  const lockInputsRef = useRef({ players: [], tRounds: [], courses: [], hcpOverrides: {}, teeAssignments: {} });
  const lockInFlightRef = useRef({}); // { round: true } — de-dupes concurrent auto-locks in this client

  // ── Pull-to-refresh ── the gesture machinery lives in the shared
  // usePullToRefresh hook (src/lib/usePullToRefresh.js); it's wired up
  // below, after hasNewBundle. popupOpenRef stays here because the
  // caller owns it and passes it into the hook.
  // popupOpenRef = true whenever a top-level modal/menu is showing. Read
  // synchronously by the touch handlers (refs don't trigger re-renders
  // and are always up-to-date). Updated via the effect below whenever
  // menuOpen changes.
  const popupOpenRef = useRef(false);

  // The bottom nav, measured by the effect below, which feeds the scroll
  // area's bottom clearance.
  const navRef = useRef(null);

  // ── Bottom clearance for the fixed nav ───────────────────────────
  // The nav is position:fixed over the bottom of the viewport, so the
  // scroll area has to reserve room or its last rows sit behind the bar
  // with no way to scroll them into view. That clearance used to be the
  // constant 64px + safe-area, which is only correct while the nav is
  // exactly the height it is at the default text size. It is not: the
  // labels grow with the OS text-size setting (iOS text-size-adjust scales
  // them on a page that never opted out), and once the bar is taller than
  // 64px the tail of every long screen becomes unreachable — the "won't
  // scroll" report. Measuring is the only thing that stays true.
  const [navH, setNavH] = useState(64);
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const measure = () => setNavH(Math.ceil(el.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // `user` is in the deps because the nav only exists once past the login
    // screen — without it the ref is null on mount and never measured.
  }, [user]);

  const notify = useCallback((msg, type = "success") => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 2800);
  }, []);

  // Keep popupOpenRef in sync with menuOpen so touch handlers see
  // "popup is open" without having to participate in React's render cycle.
  // If additional top-level modals get added later, OR them in here.
  useEffect(() => { popupOpenRef.current = menuOpen || finalizeOpen; }, [menuOpen, finalizeOpen]);

  // Reconcile the edition doc-id namespacing flag from the canonical edition
  // doc, in case localStorage (which seeds it synchronously in firebase.js)
  // was cleared. Cheap insurance so writes use the right doc-id scheme.
  useEffect(() => {
    (async () => {
      try {
        const eds = await db.get("bc_editions", []);
        const active = eds.find(e => e.id === TOURNAMENT_ID);
        if (active) setActiveTournamentId(TOURNAMENT_ID, !!active.namespaced);
      } catch { /* ignore */ }
    })();
  }, []);

  // hasNewBundle — checks whether a new app build has been deployed since
  // the running client loaded. Vite produces hashed asset URLs on each
  // build, so comparing the script/stylesheet paths in a freshly-fetched
  // index.html against what's currently in the DOM tells us if the user
  // is running stale code. When a mismatch is detected, the pull-to-
  // refresh handler force-reloads the page so the user picks up the
  // newest version. Wrapped in AbortController + 4s timeout so a flaky
  // network can't hang the refresh gesture.
  const hasNewBundle = useCallback(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const html = await fetch(`/index.html?t=${Date.now()}`, {
        cache: 'no-store', signal: controller.signal,
      }).then(r => r.text());
      const fresh = [];
      let m;
      const scriptRe = /<script[^>]+src="([^"]+)"/g;
      while ((m = scriptRe.exec(html)) !== null) fresh.push(m[1]);
      const linkRe = /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g;
      while ((m = linkRe.exec(html)) !== null) fresh.push(m[1]);
      const linkRe2 = /<link[^>]+href="([^"]+)"[^>]+rel="stylesheet"/g;
      while ((m = linkRe2.exec(html)) !== null) fresh.push(m[1]);
      const toPath = (u) => { try { return new URL(u, location.href).pathname; } catch { return u; } };
      const current = new Set([
        ...Array.from(document.querySelectorAll('script[src]')).map(s => toPath(s.src)),
        ...Array.from(document.querySelectorAll('link[rel="stylesheet"][href]')).map(l => toPath(l.href)),
      ]);
      return fresh.some(a => !current.has(toPath(a)));
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }, []);

  // Pull-to-refresh gesture — the touch-handler machinery lives in the
  // shared hook (src/lib/usePullToRefresh.js), preserving BC's exact
  // behavior (2px at-top tolerance, iOS bounce fix, 0.4x damp, 120px
  // max, 80px threshold). Data is live via onSnapshot, so no onRefresh
  // is passed — a new build reloads, otherwise the gesture shows a
  // brief confirmation spin. pullY / refreshing / PULL_THRESHOLD feed
  // the indicator render below.
  const { pullY, refreshing, PULL_THRESHOLD } = usePullToRefresh({ popupOpenRef, hasNewBundle });

  // Subscribe to Firestore
  useEffect(() => {
    const unsubs = [];
    const f = [{ field: "tournament_id", op: "==", value: TOURNAMENT_ID }];
    unsubs.push(db.subscribe("bc_players", f, setTPlayers));
    unsubs.push(db.subscribe("bc_settings", f, rows => {
      const tn = rows.find(r => r.id === editionDocId("team_names"));
      if (tn) setTeamNames({ A: tn.teamA || DEFAULT_TEAM_NAMES.A, B: tn.teamB || DEFAULT_TEAM_NAMES.B });
      const tourn = rows.find(r => r.id === editionDocId("tournament"));
      setTournamentName(tourn?.name?.trim() || TOURNAMENT_TITLE);
      setTournamentLocation(tourn?.location?.trim() || TOURNAMENT_LOCATION);
      // Branding: apply to the live BC theme immediately (using the current
      // mode via ref), then store it so a later theme toggle re-applies it.
      const br = rows.find(r => r.id === editionDocId("branding"));
      const b = br
        ? { teamA: br.teamA || null, teamB: br.teamB || null, tournamentAccent: br.tournamentAccent || null }
        : null;
      applyBCTheme(modeRef.current ? "dark" : "light", b);
      setBrand(b);
    }));
    unsubs.push(db.subscribe("bc_rounds", f, rows => setTRounds(rows)));
    unsubs.push(db.subscribe("bc_skins", f, rows => {
      const sd = {};
      rows.forEach(r => { sd[`${r.round}_${r.hole}`] = r.player_id; });
      setSkinsData(sd);
    }));
    unsubs.push(db.subscribe("bc_ctp", f, rows => {
      const cd = {};
      // The value is the RECORD, not just the winner's id: the scoring
      // tab's par-3 prompt needs the standing distance to show the group
      // the number to beat, and whether the director has already settled
      // the hole (`approved`), which stops the prompt from re-opening.
      // Legacy docs predate both fields and simply read as undefined.
      rows.forEach(r => {
        cd[`${r.round}_${r.hole}`] = {
          player_id: r.player_id || null,
          distance_ft: r.distance_ft ?? null,
          approved: r.approved === true,
          tagged_by: r.tagged_by || null,
        };
      });
      setCtpData(cd);
    }));
    unsubs.push(db.subscribe("bc_tournament_settings", f, rows => {
      const s = rows.find(r => r.id === editionDocId("bc_settings_main"));
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
      // `ch_overrides` = per-round DIRECT Course-Handicap overrides (current
      // model). The legacy `overrides` field held per-round HI overrides and is
      // intentionally ignored so old values can't be misread as CH.
      rows.forEach(r => { if (r.round_number) data[r.round_number] = r.ch_overrides || {}; });
      setHcpOverridesData(data);
    }));
    unsubs.push(db.subscribe(GROUPS_COL, f, rows => {
      const data = {};
      rows.forEach(r => { if (r.round_number) data[r.round_number] = decodeGroups(r.groups); });
      setGroupsData(data);
    }));
    unsubs.push(db.subscribe(ROUND_LOCKS_COL, f, rows => {
      const data = {};
      rows.forEach(r => { if (r.round_number) data[r.round_number] = r; });
      roundLocksRef.current = data;   // keep the ref hot for the save path
      setRoundLocksData(data);
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
    // Both scoring axes, normalized here so nothing downstream has to know
    // that a legacy round packed them into one field.
    scoring_type: resolveScoring(r).formOfPlay,
    hole_scoring: resolveScoring(r).holeScoring,
  })), [tRounds]);

  // Enhance matches with nassau + scoring type from their round.
  //
  // The ROUND wins. These are round-level settings — the admin console only
  // ever offers them per round, there is no per-match editor — so the round
  // doc is their single source of truth. Older match docs have a copy baked
  // in from whenever they were created (saveMatch used to write one), and
  // reading that copy first is what made a round edit look like it did
  // nothing: flip Round 1 to Double Dot / Total, and every match already
  // carrying `scoring_type: "match"` quietly kept scoring as match play on
  // both the Scoring tab and the Leaderboard. The stale copy is now only a
  // fallback for a match whose round doc is missing entirely.
  //
  // `matchNumber` rides along for the same reason: a match's number counts
  // every match played before it (see numberMatches), so it can only be
  // worked out with the WHOLE schedule in hand — here, not inside any one
  // view. Every surface then reads the one number instead of numbering the
  // matches it happens to be showing, which is what let the Matches tab and
  // the Leaderboard call the same match by two different names.
  const matchNumbers = useMemo(
    () => numberMatches({ matches, tRounds: enrichedRounds, groupsByRound: groupsData }),
    [matches, enrichedRounds, groupsData]
  );
  const enrichedMatches = useMemo(() => matches.map(m => {
    const tr = enrichedRounds.find(t => t.round_number === m.round);
    return {
      ...m,
      nassau: tr?.nassau || m.nassau || NASSAU_DEFAULT,
      scoring_type: tr?.scoring_type || m.scoring_type || SCORING_TYPE_MATCH,
      hole_scoring: tr?.hole_scoring || m.hole_scoring || HOLE_SCORING_FORMAT,
      matchNumber: matchNumbers[m.id] ?? null,
      // Rides along for the same reason the Nassau pots do: the Leaderboard
      // prices a match off the match object, and on a points round the price
      // is the hole values rather than any pot.
      hole_points: tr?.hole_points || m.hole_points || null,
    };
  }), [matches, enrichedRounds, matchNumbers]);

  // Keep the auto-lock's source data current without rebuilding onSaveHole.
  useEffect(() => {
    lockInputsRef.current = {
      players: tPlayers,
      tRounds: enrichedRounds,
      courses,
      hcpOverrides: hcpOverridesData,
      teeAssignments: teeAssignmentsData,
    };
  }, [tPlayers, enrichedRounds, courses, hcpOverridesData, teeAssignmentsData]);

  const userRef = useRef(null);
  useEffect(() => { userRef.current = user; }, [user]);

  // ── ensureRoundLock ──────────────────────────────────────────────────
  // THE guarantee. Called before every score write: the first score in a
  // round freezes that round's handicaps, tees, handicap mode and course
  // tables. Nobody has to remember to press anything — by the time a hole
  // exists, the round is already immune to later handicap edits.
  //
  // Three layers of protection against writing a lock twice:
  //   1. the subscribed ref (covers the normal case),
  //   2. an in-flight flag (covers two saves racing inside this client),
  //   3. a read-before-write against Firestore (covers two DEVICES racing —
  //      four players entering scores at once is the expected case here).
  // A lock is never overwritten once it exists; that is what makes this
  // safe to call on every single hole.
  const ensureRoundLock = useCallback(async (rnd) => {
    if (!rnd) return null;
    const existing = roundLocksRef.current?.[rnd];
    if (existing?.locked) return existing;
    if (lockInFlightRef.current[rnd]) return null;
    lockInFlightRef.current[rnd] = true;
    try {
      // Another device may have locked this round moments ago.
      const rows = await db.get(ROUND_LOCKS_COL, [
        { field: "tournament_id", op: "==", value: TOURNAMENT_ID },
        { field: "round_number", op: "==", value: rnd },
      ]);
      const remote = rows.find(r => r.locked);
      if (remote) {
        roundLocksRef.current = { ...roundLocksRef.current, [rnd]: remote };
        setRoundLocksData(prev => ({ ...prev, [rnd]: remote }));
        return remote;
      }
      const { players, tRounds: rds, courses: crs, hcpOverrides, teeAssignments } = lockInputsRef.current;
      // Nothing meaningful to freeze yet — no roster. Leave the round open
      // so the real snapshot happens once setup exists.
      if (!players?.length) return null;
      const lock = buildRoundLockDoc({
        tournamentId: TOURNAMENT_ID,
        round: rnd,
        players,
        tRounds: rds,
        courses: crs,
        chOverrides: hcpOverrides,
        teeAssignments,
        lockedBy: userRef.current?.name || null,
        reason: "auto",
      });
      await db.upsert(ROUND_LOCKS_COL, lock);
      roundLocksRef.current = { ...roundLocksRef.current, [rnd]: lock };
      setRoundLocksData(prev => ({ ...prev, [rnd]: lock }));
      return lock;
    } catch (e) {
      console.error("ensureRoundLock", e);
      return null;
    } finally {
      lockInFlightRef.current[rnd] = false;
    }
  }, []);

  const onSaveHole = useCallback(async (pid, rnd, holeIdx, score, courseId) => {
    setSyncing(true);
    // Freeze BEFORE the score lands, so the very first hole of a round is
    // already scoring off the snapshot.
    await ensureRoundLock(rnd);
    // ── Edition scoping ──
    // Scores and matches were the last two collections still building their
    // document ids by hand instead of through editionDocId. Nothing has
    // actually collided, and the reason is luck rather than design: both ids
    // embed player ids, and player ids are minted from a clock
    // (`bc_player_<ms>`, or `p_<stamp>_<i>` for a cloned roster), so no two
    // editions have ever generated the same one. Any edition seeded from a
    // backup, a hand-written fixture, or a future id scheme that isn't
    // clock-based would put two editions' scores on ONE document — and since
    // db.upsert merges, the second edition's write would take the first
    // edition's document over, tournament_id and all. Every other collection
    // is already scoped this way; these two now are too.
    //
    // For the original (un-namespaced) edition editionDocId is the identity
    // function, so this is byte-identical to the old id and nothing stored
    // today moves.
    const bareId = `bc_hs_r${rnd}_${pid}_h${holeIdx + 1}`;
    const id = editionDocId(bareId);
    const data = {
      id,
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
    // A namespaced edition that already has scores has them under the OLD
    // bare id, and this writer rebuilds the id from scratch every save rather
    // than reusing the stored one — so without this the same hole would exist
    // as two documents, and the subscription (which maps both onto
    // `${pid}_${round}`) would show whichever Firestore happened to hand back
    // last. Dropping the superseded document first means there is never a
    // moment where both exist. Safe against other editions because the id
    // embeds this edition's player id, which no other edition uses.
    if (id !== bareId) await db.delete("bc_hole_scores", bareId);
    await db.upsert("bc_hole_scores", data);
    setSyncing(false);
  }, [ensureRoundLock]);

  const onAddPlayer = useCallback(async (p) => { await db.upsert("bc_players", p); }, []);
  const onUpdatePlayer = useCallback(async (p) => { await db.upsert("bc_players", p); }, []);
  const onRemovePlayer = useCallback(async (pid) => { await db.delete("bc_players", pid); }, []);
  const onAddCourse = useCallback(async (c) => { if (c._delete) { await db.delete("bc_courses", c.id); } else { await db.upsert("bc_courses", c); } }, []);
  const onSetSkin = useCallback(async (round, hole, pid) => {
    const id = editionDocId(`bc_skin_r${round}_h${hole+1}`);
    if (pid) await db.upsert("bc_skins", { id, tournament_id: TOURNAMENT_ID, round, hole, player_id: pid });
    else await db.delete("bc_skins", id);
  }, []);
  // One document per round+hole — the hole's STANDING closest-to-the-pin.
  // A later group that gets inside the current tag overwrites it, which is
  // the whole point: the doc is the current answer, not a log of attempts.
  //
  // `approved` is the director's settle flag. Players tagging from the
  // Scoring tab write false (provisional); the Betting → CTP grid, which
  // only the director can operate, writes true and freezes the hole.
  // Every field is written on every call because db.upsert merges — a
  // director reassignment that omitted distance_ft would otherwise leave
  // the previous group's measurement attached to a different player.
  const onSetCtp = useCallback(async (round, hole, pid, opts = {}) => {
    const { distanceFt = null, approved = true, taggedBy = null } = opts;
    const id = editionDocId(`bc_ctp_r${round}_h${hole+1}`);
    if (pid) {
      await db.upsert("bc_ctp", {
        id, tournament_id: TOURNAMENT_ID, round, hole, player_id: pid,
        distance_ft: distanceFt, approved, tagged_by: taggedBy,
      });
    } else {
      await db.delete("bc_ctp", id);
    }
  }, []);
  const onUpdatePot = useCallback(async (amt) => {
    setSkinsPot(amt);
    await db.upsert("bc_tournament_settings", { id: editionDocId("bc_settings_main"), tournament_id: TOURNAMENT_ID, skins_pot: amt });
  }, []);
  const onSetRound = useCallback(async (r) => { await db.upsert("bc_rounds", r); }, []);
  // Groups are written whole — the document is one round's list, and a
  // partial update of an array has no meaning here.
  const onSaveGroups = useCallback(async (round, groups) => {
    await db.upsert(GROUPS_COL, {
      id: groupsDocId(round), tournament_id: TOURNAMENT_ID, round_number: round,
      groups: encodeGroups(groups),
    });
  }, []);
  const onSetMatch = useCallback(async (m) => {
    if (m._delete) { await db.delete("bc_matches", m.id); }
    else { await db.upsert("bc_matches", m); }
  }, []);

  // Erase one player's card for one round, and the only call in the app that
  // destroys a posted score. It is the counterpart to deleting a match:
  // because scores are keyed by player+round rather than by match (see
  // lib/scoreGuard), deleting a match only HIDES them, and without a way to
  // take a stale card out of a round the only route back from a bad draw is a
  // new pairing that silently inherits somebody else's holes.
  //
  // Queried rather than rebuilt from the id scheme so it clears whatever is
  // actually stored, with the reconstructed id as the fallback for any
  // document written without its own `id` field.
  const onDiscardRoundScores = useCallback(async (round, pid) => {
    const rows = await db.get("bc_hole_scores", [
      { field: "tournament_id", op: "==", value: TOURNAMENT_ID },
      { field: "player_id", op: "==", value: pid },
      { field: "round_number", op: "==", value: round },
    ]);
    for (const r of rows) {
      // The stored id first, so this clears whatever scheme the document was
      // actually written under — bare or edition-prefixed (see onSaveHole).
      await db.delete("bc_hole_scores", r.id || editionDocId(`bc_hs_r${round}_${pid}_h${r.hole_number}`));
    }
    // The subscription will say the same thing a moment later; this keeps the
    // panel that raised the action from re-rendering with the stale card.
    setHoleData(prev => { const n = { ...prev }; delete n[`${pid}_${round}`]; return n; });
    return rows.length;
  }, []);

  // ── Director lock actions ────────────────────────────────────────────
  // Deliberate counterparts to the automatic lock. `refresh` re-takes the
  // snapshot against current values and is the ONLY way a locked round's
  // handicaps can move; it is blocked outright on a final round.
  //
  // Finalize is reachable from the Scoring tab's director card; `refresh` and
  // release are not surfaced anywhere (the Admin › Rounds lock card was
  // removed) and are retained as the data layer behind those actions.
  // Locking itself still happens automatically in ensureRoundLock.
  const onLockRound = useCallback(async (rnd, { refresh = false } = {}) => {
    const prev = roundLocksRef.current?.[rnd];
    if (prev?.final && refresh) return null; // final rounds are never refreshed
    const { players, tRounds: rds, courses: crs, hcpOverrides, teeAssignments } = lockInputsRef.current;
    const args = {
      tournamentId: TOURNAMENT_ID,
      round: rnd,
      players,
      tRounds: rds,
      courses: crs,
      chOverrides: hcpOverrides,
      teeAssignments,
      lockedBy: userRef.current?.name || null,
    };
    const lock = refresh && prev?.locked
      ? refreshRoundLockDoc({ ...args, previous: prev })
      : buildRoundLockDoc({ ...args, previous: prev?.locked ? prev : null, reason: "manual" });
    await db.upsert(ROUND_LOCKS_COL, lock);
    roundLocksRef.current = { ...roundLocksRef.current, [rnd]: lock };
    setRoundLocksData(p => ({ ...p, [rnd]: lock }));
    return lock;
  }, []);

  // Finalize / un-finalize. This is what ADVANCES THE TOURNAMENT: the
  // Scoring tab's gate reads the current round off the lock docs
  // (currentRoundNumber = lowest non-final round), so marking round N final
  // is the single act that closes N to entry and opens N+1, on every device
  // at once. See "The round gate" above ScoreEntry.
  const onFinalizeRound = useCallback(async (rnd, final) => {
    let lock = roundLocksRef.current?.[rnd];
    // Finalizing a round nobody locked (all scores entered elsewhere, say)
    // still needs a snapshot — take one now rather than leaving it open.
    if (!lock?.locked && final) lock = await onLockRound(rnd);
    if (!lock) return null;
    const next = final
      ? markRoundFinal(lock, userRef.current?.name || null)
      : unfinalizeRound(lock, userRef.current?.name || null);
    await db.upsert(ROUND_LOCKS_COL, next);
    roundLocksRef.current = { ...roundLocksRef.current, [rnd]: next };
    setRoundLocksData(p => ({ ...p, [rnd]: next }));
    return next;
  }, [onLockRound]);

  // Hand a round back to live handicaps. Only for a round locked by a stray
  // score before the event actually started — never reachable while final.
  // eslint-disable-next-line no-unused-vars
  const onClearRoundLock = useCallback(async (rnd) => {
    const lock = roundLocksRef.current?.[rnd];
    if (lock?.final) return null;
    const cleared = clearRoundLockDoc(lock, rnd, TOURNAMENT_ID, userRef.current?.name || null);
    await db.upsert(ROUND_LOCKS_COL, cleared);
    roundLocksRef.current = { ...roundLocksRef.current, [rnd]: cleared };
    setRoundLocksData(p => ({ ...p, [rnd]: cleared }));
    return cleared;
  }, []);

  const availableRounds = useMemo(() => [...new Set(enrichedMatches.map(m => m.round))].sort(), [enrichedMatches]);

  // ── Tournament progression ───────────────────────────────────────────
  // Every round the director has set up OR drawn matches for — the same
  // union the Matches tab lists, so a round can't be live for scoring and
  // missing from the schedule, or the other way round.
  //
  // Plus every round that has ever been LOCKED, which is the load-bearing
  // one. A lock is written by the first score of a round, so a locked round
  // is a round somebody has played. Without that term a round defined only
  // by its matches — no bc_rounds document — disappeared from the schedule
  // the moment its last match was deleted, and since currentRound is the
  // lowest non-final round in this list, the whole field was silently moved
  // on to the next round while scores sat in the one they were standing on.
  // A round with scores in it stays on the schedule until somebody finalizes
  // it, which is the only way out that anybody chose.
  const tournamentRounds = useMemo(() => {
    const seen = new Set([
      ...tRounds.map(t => t.round_number),
      ...enrichedMatches.map(m => m.round),
      ...Object.keys(roundLocksData).filter(r => roundLocksData[r]?.locked).map(Number),
    ]);
    return [...seen].filter(r => r != null && !Number.isNaN(r)).sort((a, b) => a - b);
  }, [tRounds, enrichedMatches, roundLocksData]);
  // The one round open for score entry. null = nothing open (no schedule
  // yet, or the last round has been finalized).
  const currentRound = useMemo(
    () => currentRoundNumber(roundLocksData, tournamentRounds),
    [roundLocksData, tournamentRounds]
  );

  // ── Ready to finalize ────────────────────────────────────────────────
  // Lives at the app level, not inside a tab, because that is the whole
  // point of the change: the director learns the round is done wherever
  // they happen to be standing. Computed over EVERY match in the round —
  // see components/FinalizeRound's roundScoreProgress.
  const roundProgress = useMemo(
    () => roundScoreProgress(enrichedMatches, holeData, currentRound),
    [enrichedMatches, holeData, currentRound]
  );
  const isDirector = !!user?.isDirector;
  // "Ready" is the blunt, complete-round definition, and deliberately so: a
  // notification that fired on a guess ("looks about done") would be the
  // same accident the round gate exists to prevent, pointed at the one
  // action that moves the whole field. Everything else goes through More.
  const finalizeReady = isDirector && currentRound != null && roundProgress.complete;
  const finalizeNextRound = useMemo(
    () => nextRoundNumber(roundLocksData, tournamentRounds),
    [roundLocksData, tournamentRounds]
  );
  const finalizeLastFinal = useMemo(
    () => lastFinalRoundNumber(roundLocksData, tournamentRounds),
    [roundLocksData, tournamentRounds]
  );

  if (!user) return <LoginScreen players={tPlayers} teams={teams} darkMode={darkMode} tournamentName={tournamentName} tournamentLocation={tournamentLocation} onLogin={p => { const u = { ...p, isDirector: !!p.isDirector }; writeUserSession(u); setUser(u); }} />;

  // Which side of the cup the reader is on. This is a two-team event, so a
  // player belongs to one team for its whole length and the answer holds for
  // every match on every screen — which is what lets a scorecard's running
  // MATCH row read ▲ / ▼ from the reader's own side. Taken from the live
  // roster rather than the stored session, which predates any team change.
  const viewerTeam = tPlayers.find(p => p.player_id === user.player_id)?.team || user.team || "A";

  // The director's always-available route to the sheet, surfaced in More.
  // Null for a player, and for an event with no rounds to finalize.
  const finalizeMenu = isDirector && tournamentRounds.length > 0 ? {
    label: currentRound != null ? `Finalize Round ${currentRound}` : "Reopen last round",
    ready: finalizeReady,
    onOpen: () => setFinalizeOpen(true),
  } : null;
  // The notification itself: only when the round is genuinely ready, and
  // only until the director puts it away for that round.
  const showFinalizeAlert = finalizeReady && finalizeSnoozed !== currentRound;

  // Bottom-nav items.
  const navItems = [
    { key: "scoring",     label: "Scoring",     icon: "score" },
    { key: "groups",      label: "Matches",     icon: "groups" },
    { key: "leaderboard", label: "Leaderboard", icon: "trophy" },
    { key: "betting",     label: "Betting",     icon: "betting" },
    { key: "menu",        label: "More",        icon: "menu" },
  ];

  const renderIcon = (icon, active) => {
    const clr = active ? BC.amber : BC.t3;
    const sz = 20;
    // Trophy silhouette is a PNG, not an SVG, so we can't simply stroke it
    // with `clr` like the other icons. Filter chains can approximate one
    // color but not arbitrary theme colors, which is why the inactive
    // trophy used to read as a different hue from its tab-mates. Switching
    // to a CSS mask + solid background means the icon takes the EXACT
    // BC.t3 / BC.amber currently in use, with zero color drift.
    if (icon === "trophy") return <div style={{
      width: sz, height: sz, background: clr,
      WebkitMask: `url(${TROPHY_SILHOUETTE}) center/contain no-repeat`,
      mask: `url(${TROPHY_SILHOUETTE}) center/contain no-repeat`,
    }} />;
    if (icon === "groups") return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={clr} strokeWidth="2" strokeLinecap="round"><circle cx="9" cy="7" r="3"/><circle cx="17" cy="7" r="3"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/><path d="M21 21v-2a3 3 0 00-2-2.83"/></svg>;
    if (icon === "score") return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={clr} strokeWidth="2" strokeLinecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg>;
    if (icon === "betting") return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={clr} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v4c0 1.66 3.58 3 8 3s8-1.34 8-3V6"/><path d="M4 10v4c0 1.66 3.58 3 8 3s8-1.34 8-3v-4"/></svg>;
    if (icon === "menu") return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={clr} strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>;
    // Mash — flag on a pole, evoking the Mash Brothers logo without competing with their marks
    if (icon === "mash") return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={clr} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="22" x2="5" y2="3"/><path d="M5 4 C 10 2, 14 6, 20 4 L 20 13 C 14 15, 10 11, 5 13 Z" fill={active ? BC.amber + ALPHA.line : BC.t3 + ALPHA.hair}/></svg>;
    if (icon === "admin") return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={clr} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
    return null;
  };

  // App shell — position:fixed, pinned to all four edges. The fixed
  // containing block is the ONE bottom-edge signal iOS reports honestly:
  // in an installed home-screen app window.visualViewport.height subtracts
  // env(safe-area-inset-top) (812 reported for a genuinely 874pt iPhone 16
  // Pro webview), so any JS-measured height leaves a black band exactly one
  // Dynamic Island tall under the nav. Don't reintroduce one. Safari also
  // re-pins fixed elements above its own toolbar for free.
  //
  // The bottom is VP_DROP_BOTTOM rather than 0 because that containing block
  // is honest in every case but one: a home-screen icon installed before the
  // status-bar meta was fixed still gets a viewport one status bar short of
  // the screen. VP_DROP is 0px everywhere else, so this reads as bottom: 0
  // on every other device. See theme.js.
  return (
    <div style={{ position: "fixed", top: 0, right: 0, bottom: VP_DROP_BOTTOM, left: 0, width: "100%", background: BC.bg, display: "flex", flexDirection: "column", fontFamily: FONT, overflow: "hidden", boxSizing: "border-box", paddingTop: "env(safe-area-inset-top, 0px)", paddingLeft: "env(safe-area-inset-left, 0px)", paddingRight: "env(safe-area-inset-right, 0px)" }}>
      <div style={{ maxWidth: 520, width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", flex: 1, minHeight: 0, position: "relative", padding: "0 4px" }}>
      {/* Top-level feedback from notify(). The scoring screens render
          their own <Toast> lower down for the auto-advance message —
          same component, different owner of when it shows. */}
      <Toast message={notif?.msg} type={notif?.type} top={16} />

      {/* Pull-to-refresh indicator — circular badge with the trophy
          silhouette inside, fixed-positioned and overlaid above the
          content. Slides down from the top as the user pulls; rotates
          proportionally to the pull distance for tactile feedback;
          highlights the border when the threshold is crossed; and
          spins continuously with a glow pulse while the actual refresh
          is in flight. The trophy icon doubles as both the visual
          identity (BC's logo mark) and the spinner — there's no need
          for a separate progress glyph. */}
      {pullY > 0 && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 999,
          display: "flex", justifyContent: "center",
          paddingTop: Math.min(pullY, 100) - 20,
          transition: refreshing ? "all .3s" : "none",
          pointerEvents: "none",
        }}>
          <style>{`
            @keyframes bcPullSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            @keyframes bcPullGlow { 0%,100% { box-shadow: 0 0 8px ${BC.amber}${ALPHA.line}; } 50% { box-shadow: 0 0 18px ${BC.amber}${ALPHA.panel}; } }
          `}</style>
          <div style={{
            width: 44, height: 44, borderRadius: "50%", background: BC.card,
            border: `2.5px solid ${pullY >= PULL_THRESHOLD ? BC.amber : BC.bdr}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: pullY >= PULL_THRESHOLD ? `0 0 12px ${BC.amber}${ALPHA.line}` : `0 2px 12px ${SHADOW}`,
            transition: "border-color .2s, box-shadow .3s", overflow: "hidden",
            animation: refreshing ? "bcPullGlow 1s ease-in-out infinite" : "none",
          }}>
            {/* Trophy mask — same technique as the leaderboard nav icon
                so the silhouette can be tinted any color and rotated
                cleanly. Opacity ramps from 30% → 100% as the user pulls
                to give a "loading energy" feeling. */}
            <div style={{
              width: 26, height: 26, background: BC.amber,
              WebkitMask: `url(${TROPHY_SILHOUETTE}) center/contain no-repeat`,
              mask: `url(${TROPHY_SILHOUETTE}) center/contain no-repeat`,
              opacity: pullY >= PULL_THRESHOLD ? 1 : 0.3 + (pullY / PULL_THRESHOLD) * 0.7,
              transform: refreshing ? "none" : `rotate(${pullY * 3}deg)`,
              animation: refreshing ? "bcPullSpin .8s linear infinite" : "none",
              transition: refreshing ? "none" : "opacity .2s",
            }} />
          </div>
        </div>
      )}



      {/* App header — the cup mark over YEAR · CITY, on every tab.
          Deliberately OUTSIDE the scroll area rather than inside each view:
          it renders once instead of five times (five ways for one header to
          drift), it never scrolls away, and the leaderboard's sticky cup
          total pins directly beneath it instead of fighting it for the top
          of the screen. flexShrink is pinned on the header itself so a tall
          tab can't squeeze it. */}
      <AppHeader location={tournamentLocation} />

      {/* Ready-to-finalize notification — app chrome, like the header above
          it, so it reaches the director on whichever tab they are on rather
          than only at the bottom of Scoring. Outside the scroll area for the
          same reason the header is: it must not scroll away, and it must not
          be a fifth copy of itself inside five views. Costs nothing at all
          when there is nothing to act on. */}
      {showFinalizeAlert && (
        <DirectorFinalizeAlert
          round={currentRound}
          nextRound={finalizeNextRound}
          progress={roundProgress}
          onOpen={() => setFinalizeOpen(true)}
          onDismiss={() => snoozeFinalizeAlert(currentRound)}
        />
      )}

      {/* Content */}
      <div className="bc-app-body" style={{
        flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden",
        // Bottom clearance for the FIXED nav bar. The nav is position:fixed
        // over the viewport bottom, so the scroll area must reserve room or
        // its last rows hide behind the bar with nothing left to scroll.
        // `navH` is the bar's MEASURED height (safe-area padding included) —
        // see the ResizeObserver above for why a constant isn't enough.
        padding: `12px 10px ${navH + 8}px 10px`,
        // Every view starts at the TOP of the scroll area. Short views used
        // to be centred vertically here (flexbox auto margins on the inner
        // wrapper), with Admin and Leaderboard opting out because they pin a
        // control to the top — but that is exactly the inconsistency: the
        // same round pills sat mid-screen on a thin round and at the top on
        // a full one, and no two tabs agreed on where their content began.
        // Top alignment is also the only thing a sticky lead control can
        // hold against (see StickyTop), and every tab now has one.
        display: "flex",
        flexDirection: "column",
        // overscroll-behavior-y: contain blocks the browser's native
        // overscroll bounce at the boundaries of THIS scroll container.
        // Without it, iOS Safari starts a bounce animation the moment
        // the user pulls down past scrollTop=0 — and once that bounce
        // is in flight, our touchmove preventDefault gets ignored, so
        // the custom pull visual fights with the native bounce and
        // the gesture feels broken/sticky. With `contain`, the native
        // bounce is suppressed and our handler has full control.
        overscrollBehaviorY: "contain",
      }}>
        {/* View wrapper. Full width, no vertical margins: the content of
            every tab begins immediately under the app header, so the round
            pills / tab bar / mode toggle each tab leads with land on the
            same line as each other. A pinned element that starts halfway
            down the screen is the one thing that defeats pinning it — it
            would sit mid-screen on a thin round, then jump to the top the
            moment the content grew past the fold. */}
        {/* Scoring is worked from rather than read down, so it fills the
            view instead of flowing at its natural height — see ScoreEntry's
            shell. Every other tab keeps the plain block wrapper. */}
        <div style={{
          width: "100%",
          ...(view === "scoring" ? { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } : null),
        }}>
        {/* Keyed ErrorBoundary: keying on `view` remounts the boundary
            whenever the tab changes, so a crashed screen self-heals the
            moment the user navigates away instead of showing a blank
            white page. */}
        <ErrorBoundary key={view}>
        {view === "leaderboard" && (
          <TeamLeaderboard
            matches={enrichedMatches}
            holeData={holeData}
            courses={courses}
            tRounds={enrichedRounds}
            tPlayers={tPlayers}
            rounds={availableRounds.length ? availableRounds : [1,2,3,4]}
            teams={teams}
            hcpOverrides={hcpOverridesData}
            teeAssignments={teeAssignmentsData}
            roundLocks={roundLocksData}
            viewer={viewerTeam}
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
            teams={teams}
            hcpOverrides={hcpOverridesData}
            teeAssignments={teeAssignmentsData}
            roundLocks={roundLocksData}
            rounds={tournamentRounds}
            currentRound={currentRound}
            ctpData={ctpData}
            onSetCtp={onSetCtp}
          />
        )}
        {view === "groups" && (
          <GroupsView
            matches={enrichedMatches}
            tRounds={enrichedRounds}
            tPlayers={tPlayers}
            courses={courses}
            groups={groupsData}
            teams={teams}
          />
        )}
        {view === "betting" && (
          // Main-app betting view is parked behind a placeholder until
          // the real tournament betting flow is finalized (skins/CTP at
          // the Bourbon Cup level — multi-round, multi-pot, with the
          // skins-pot accumulator). This placeholder matches the rest of
          // the app's styling (TEAMS-banner-style header, neutral "no
          // data" body) so when real betting data lands, the visual
          // scaffold is already consistent.
          <div style={{ fontFamily: FONT }}>
            {/* Skins/CTP toggle scaffold — disabled visual. Communicates
                "this section will have these two modes" without
                committing to data the user can't act on. Pinned so this
                tab's lead control sits exactly where every other tab's
                does, and so the real skins grid can grow underneath it
                without the toggle scrolling away. */}
            <StickyTop>
              <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: 0.5, pointerEvents: "none" }}>
                <SegmentedToggle
                  options={[["skins", "Skins"], ["ctp", "CTP"]]}
                  value="skins" variant="flat" letterSpacing={0.5} style={{ flex: 1 }}
                />
              </div>
            </StickyTop>

            <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, overflow: "hidden" }}>
              <Banner>SKINS</Banner>
              <div style={{
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                padding: "60px 20px", textAlign: "center",
              }}>
                <div style={{ fontSize: FS.jumbo, marginBottom: 12, opacity: 0.4 }}>🥃</div>
                <div style={{ fontSize: FS.lead, fontWeight: 700, color: BC.t1, marginBottom: 6, letterSpacing: 0.3 }}>
                  No bets yet
                </div>
                <div style={{ fontSize: FS.small, color: BC.t3, maxWidth: 280, lineHeight: 1.5 }}>
                  Tournament betting will open closer to game time.
                </div>
              </div>
            </div>
          </div>
        )}
        {(view === "analytics" || view === "history") && (
          <AnalyticsView
            tPlayers={tPlayers} matches={enrichedMatches} holeData={holeData}
            tRounds={enrichedRounds} courses={courses} historicalData={historicalData} user={user}
            hcpOverrides={hcpOverridesData} teeAssignments={teeAssignmentsData}
            roundLocks={roundLocksData} teams={teams}
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
            holeData={holeData}
            onDiscardRoundScores={onDiscardRoundScores}
            teams={teams}
            teamNames={teamNames}
            onSaveTeamNames={async (names) => {
              setTeamNames(names);
              await db.upsert("bc_settings", { id: editionDocId("team_names"), tournament_id: TOURNAMENT_ID, teamA: names.A, teamB: names.B });
            }}
            brand={brand}
            onSaveBranding={async (b) => {
              // Optimistically apply to the live theme, then persist. The
              // bc_settings subscription will re-apply the same doc — the
              // single source of truth for team colors.
              applyBCTheme(darkMode ? "dark" : "light", b);
              setBrand(b);
              await db.upsert("bc_settings", { id: editionDocId("branding"), tournament_id: TOURNAMENT_ID, teamA: b.teamA, teamB: b.teamB });
            }}
            tournamentName={tournamentName}
            tournamentLocation={tournamentLocation}
            onSaveTournament={async ({ name, location }) => {
              setTournamentName(name);
              setTournamentLocation(location);
              await db.upsert("bc_settings", { id: editionDocId("tournament"), tournament_id: TOURNAMENT_ID, name, location });
            }}
            hcpOverridesFromDb={hcpOverridesData}
            teeAssignmentsFromDb={teeAssignmentsData}
            groupsFromDb={groupsData}
            onSaveGroups={onSaveGroups}
            roundLocks={roundLocksData}
            notify={notify}
          />
        )}
        </ErrorBoundary>
        </div>
      </div>

      <SlideMenu open={menuOpen} onClose={() => setMenuOpen(false)} onNavigate={setView} onLogout={() => { writeUserSession(null); setUser(null); }} user={user} view={view} darkMode={darkMode} onToggleTheme={toggleTheme} finalize={finalizeMenu} navH={navH} />

      {/* The Finalize sheet — everything the removed Scoring card held, at
          zero cost until it is opened. */}
      {finalizeOpen && finalizeMenu && (
        <FinalizeRoundSheet
          round={currentRound}
          nextRound={finalizeNextRound}
          lastFinal={finalizeLastFinal}
          progress={roundProgress}
          tPlayers={tPlayers}
          onFinalizeRound={onFinalizeRound}
          notify={notify}
          onClose={() => setFinalizeOpen(false)}
        />
      )}
      </div>

      {/* Bottom Nav — FIXED to the viewport bottom (restored pre-2026-07-21
          layout). Being position:fixed, it pins to the true viewport bottom
          regardless of how the app shell is sized — which is why this is the
          robust approach: even if the shell's computed bottom edge is off (as
          it was on real devices with the in-flow "navfix" version), the bar
          still seats on the physical bottom. The full safe-area inset as
          paddingBottom keeps the labels clear of the home indicator. The
          scroll area reserves matching clearance so content never hides
          behind the bar. */}
      <div ref={navRef} style={{ position: "fixed", bottom: VP_DROP_BOTTOM, left: 0, right: 0, background: BC.card, borderTop: `1px solid ${BC.bdr}`, zIndex: 100, paddingBottom: NAV_SAFE_PAD }}>
      <div style={{ maxWidth: 520, margin: "0 auto", display: "flex" }}>
        {navItems.map(item => {
          const active = view === item.key;
          const clr = active ? BC.amber : BC.t3;
          // The notification's persistent half. The bar above can be
          // dismissed; this dot cannot, and it stays lit until the round is
          // actually finalized — pointing at More, which is where the sheet
          // is. Dismissing a reminder should quiet it, not delete the fact.
          const badge = item.key === "menu" && finalizeReady;
          return (
            <button key={item.key} onClick={() => {
              if (item.key === "menu") { setMenuOpen(true); return; }
              setView(item.key);
            }} style={{
              flex: 1, padding: "8px 4px 10px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 3,
              background: "transparent", border: "none", cursor: "pointer", minHeight: 56,
            }}>
              <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", height: 24 }}>
                {renderIcon(item.icon, active)}
                {badge && <span style={{
                  position: "absolute", top: 1, right: "50%", marginRight: -14,
                  width: 8, height: 8, borderRadius: "50%", background: BC.amber,
                  border: `1.5px solid ${BC.card}`, boxSizing: "content-box",
                }} />}
              </div>
              <span style={{ fontSize: FS.label, fontWeight: active ? 700 : 500, color: clr, lineHeight: 1 }}>{item.label}</span>
              {active && <div style={{ width: 16, height: 2, borderRadius: 1, background: BC.amber, marginTop: 2 }} />}
            </button>
          );
        })}
      </div>
      </div>
    </div>
  );
}
