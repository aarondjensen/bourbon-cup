import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { BC, applyBCTheme, initialBCMode, bcGlobalCSS, playerNameColor, teamColor } from "./theme";
import { db, TOURNAMENT_ID, getTournamentYear, editionDocId, setActiveTournamentId, readUserSession, writeUserSession } from "./firebase";
import {
  TROPHY_PHOTO, LOGO_TEAM_A, LOGO_TEAM_A_WHITE, LOGO_TEAM_B, TROPHY_SILHOUETTE,
  resolveTeams, DEFAULT_TEAM_NAMES, TOURNAMENT_TITLE, TOURNAMENT_LOCATION,
  FORMATS, NASSAU_DEFAULT, DEFAULT_FORMAT, PRACTICE_TEAM_COLORS, DIRECTOR_CODE,
  resolveAllowance, describeAllowance, allowanceDefaultFor,
} from "./constants";
import {
  calcCH, calcCHForCourse, fmtScore,
  getEffectiveHI, buildStrokeMap, resolveHolePars, resolveHoleHcps,
  computeMatchResult, computePracticeMatch, computePracticeSkins,
  getRoundCH, getRoundHI, getRoundTee, lockForRound,
  higherIsBetter, totalUnit, segmentState,
} from "./scoring";
import { holeFill } from "./lib/holeFill";
import {
  ROUND_LOCKS_COL, buildRoundLockDoc, refreshRoundLockDoc,
  markRoundFinal, unfinalizeRound, clearRoundLockDoc,
  roundLockState, describeHiChangeImpact,
  isRoundFinal, currentRoundNumber, nextRoundNumber, lastFinalRoundNumber,
  LOCK_OPEN, LOCK_FINAL,
} from "./lib/roundLocks";
import { usePullToRefresh } from "./lib/usePullToRefresh";
import { processLogo } from "./lib/logoBrand";
import ErrorBoundary from "./components/ErrorBoundary";
import { AppHeader } from "./components/AppHeader";
import { Popup, ConfirmModal } from "./components/Popup";
import { SegmentedToggle, Banner, Toast, ScoreButtonRow } from "./components/ui";
import { useConfirm } from "./lib/useConfirm";
import { useStableCallback } from "./lib/useStableCallback";
import { EditionSwitcher } from "./components/EditionSwitcher";
import { GhinLinkButton, GhinSyncButton } from "./components/GhinLink";
import { TeamLeaderboard, MatchScorecard } from "./components/Leaderboard";
import { MatchSetup } from "./components/MatchSetup";
import {
  GROUPS_COL, groupsDocId, encodeGroups, decodeGroups,
  autoBuildGroups, expandTeeTimes, teeTimeList,
  isFoursomeFormat, teeTimeForMatch, parseTeeTime, formatTeeTime,
  DEFAULT_TEE_INTERVAL,
} from "./lib/groups";

// ── Bottom-nav safe-area cushion ──────────────────────────────────
// Full iOS home-indicator inset (34pt on devices that have one) plus 8pt,
// applied as paddingBottom on the fixed nav bar so the labels clear the
// home indicator. This is the pre-2026-07-21 value: the interim "navfix"
// rework made the nav an in-flow flex child and clamped this to 10px, which
// left the bar mis-seated on real devices. Restoring the fixed bar (pinned
// to the viewport bottom) with the full inset is the known-good layout.
const NAV_SAFE_PAD = "calc(env(safe-area-inset-bottom, 0px) + 8px)";

// Views that start at the TOP of the scroll area instead of being centred
// in it. Both of these pin something to the top of the body (Admin's tab
// bar, the Leaderboard's header + cup total), and a sticky element only
// behaves if its view begins at the top — see the wrapper it's used on.
const TOP_ALIGNED_VIEWS = new Set(["admin", "leaderboard"]);

// ── TEMPORARY viewport diagnostic ─────────────────────────────────
// Delete VP_DEBUG, BUILD_TAG, the ViewportDebug component, navRef and the
// <ViewportDebug /> mount once the bottom-nav question is closed out.
//
// BUILD_TAG is the important one: it prints on screen, so a screenshot
// proves which bundle the device is actually running. An installed iOS
// home-screen app will happily serve a cached index.html for a long time,
// and there is no way to tell that apart from a CSS bug by looking at the
// layout alone — which is exactly the ambiguity that cost us a round trip.
const VP_DEBUG = false;
const BUILD_TAG = "navfix-4";

function ViewportDebug({ navRef }) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    const read = () => {
      // Probe element: the only way to read env(safe-area-inset-*) from JS
      // is to apply it to something and ask for the computed value back.
      const probe = document.createElement("div");
      probe.style.cssText =
        "position:fixed;visibility:hidden;pointer-events:none;top:0;left:0;" +
        "padding-top:env(safe-area-inset-top,0px);" +
        "padding-bottom:env(safe-area-inset-bottom,0px);";
      document.body.appendChild(probe);
      const cs = getComputedStyle(probe);
      const safeT = cs.paddingTop, safeB = cs.paddingBottom;
      probe.remove();

      const vv = window.visualViewport;
      const navBottom = navRef?.current
        ? Math.round(navRef.current.getBoundingClientRect().bottom)
        : null;
      const modes = [];
      if (window.navigator.standalone) modes.push("nav.standalone");
      if (window.matchMedia("(display-mode: standalone)").matches) modes.push("dm.standalone");

      setInfo({
        build: BUILD_TAG,
        screen: `${window.screen.width}x${window.screen.height}`,
        inner: `${window.innerWidth}x${window.innerHeight}`,
        clientH: document.documentElement.clientHeight,
        vv: vv ? `${Math.round(vv.width)}x${Math.round(vv.height)} @${Math.round(vv.offsetTop)}` : "none",
        safe: `${safeT} / ${safeB}`,
        navBottom,
        mode: modes.join(" ") || "browser",
      });
    };
    read();
    // Re-read once the browser has settled (toolbar animations, orientation).
    const t = setTimeout(read, 500);
    window.addEventListener("resize", read);
    window.addEventListener("orientationchange", read);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", read);
      window.removeEventListener("orientationchange", read);
    };
  }, [navRef]);

  if (!info) return null;
  const rows = [
    ["build", info.build],
    ["screen", info.screen],
    ["innerW x H", info.inner],
    ["docEl.clientH", info.clientH],
    ["visualViewport", info.vv],
    ["safe top / bot", info.safe],
    ["NAV rect.bottom", info.navBottom],
    ["mode", info.mode],
  ];
  return (
    <div style={{
      position: "fixed", top: "calc(env(safe-area-inset-top, 0px) + 4px)", left: 6,
      zIndex: 100000, background: "rgba(0,0,0,0.88)", border: "1px solid #e0a93c",
      borderRadius: 6, padding: "6px 8px", pointerEvents: "none",
      font: "600 10px/1.4 ui-monospace, Menlo, monospace", color: "#e0a93c",
    }}>
      {rows.map(([k, v]) => (
        <div key={k}>{k}: <span style={{ color: "#f5f4f2" }}>{String(v)}</span></div>
      ))}
    </div>
  );
}

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
          {strokes > 0 && <span style={{ color: colorOverride || BC.hcpBlue, fontSize: 10, fontWeight: 900, letterSpacing: 1, lineHeight: 1 }}>{"•".repeat(strokes)}</span>}
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
        {strokes > 0 && <span style={{ color: colorOverride || BC.hcpBlue, fontSize: 10, fontWeight: 900, letterSpacing: 1, lineHeight: 1 }}>{"•".repeat(strokes)}</span>}
      </div>
      <div style={{ position: "relative", width: sh, height: sh, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {border}
        <span style={{ position: "relative", zIndex: 1, fontSize: size, fontWeight: 700, lineHeight: 1, color: colorOverride || BC.t1, transform: "translateY(0.5px)" }}>{score}</span>
      </div>
    </div>
  );
};


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
      width: "100%", padding: "clamp(8px, 2.5vw, 12px) clamp(10px, 3vw, 14px)", background: team.color + "22",
      border: `1px solid ${team.accent}33`, borderRadius: 6,
      color: BC.t2, fontSize: "clamp(13px, 3.8vw, 14px)", fontWeight: 600, cursor: "pointer", textAlign: "center",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
    }}>
      <span style={{ flex: 1, lineHeight: 1.3 }}>{p.name}</span>
    </button>
  );

  return (
    <div style={{ height: "100dvh", background: BC.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 10px", fontFamily: "'Montserrat', sans-serif", position: "relative", overflow: "hidden" }}>
      {/* Silhouette — fixed full-screen background */}
      <img src={TROPHY_SILHOUETTE} alt="" style={{
        position: "fixed", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        width: "100%", height: "100%",
        objectFit: "contain", opacity: 0.28, filter: "brightness(1.4) contrast(1.2)", pointerEvents: "none", userSelect: "none", zIndex: 0,
      }} />

      {/* Title — sits above the silhouette, outside content card */}
      <div style={{ textAlign: "center", position: "relative", zIndex: 1, marginBottom: 14 }}>
        <div style={{ fontSize: "clamp(20px, 8vw, 28px)", fontWeight: 800, color: BC.gold, letterSpacing: 2 }}>{(tournamentName || TOURNAMENT_TITLE).toUpperCase()}</div>
        <div style={{ fontSize: "clamp(10px, 3vw, 12px)", color: BC.t3, letterSpacing: "0.3em", marginTop: 3 }}>{getTournamentYear()} {(tournamentLocation || TOURNAMENT_LOCATION).toUpperCase()}</div>
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
// currentRoundNumber). Every other round is visible on the tab, and closed.
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

// Round-wide score progress. Counts EVERY player in EVERY match of the
// round, not just the reader's own match: the director deciding whether to
// finalize needs to know who is still out, by name.
function roundScoreProgress(matches, holeData, round) {
  const rndMatches = round == null ? [] : matches.filter(m => m.round === round);
  const pids = [...new Set(rndMatches.flatMap(m => [...m.teamA, ...m.teamB]))];
  const missingBy = [];
  let entered = 0;
  pids.forEach(pid => {
    const scores = holeData[`${pid}_${round}`] || {};
    let missing = 0;
    for (let h = 0; h < 18; h++) { if (scores[h] > 0) entered++; else missing++; }
    if (missing) missingBy.push({ pid, missing });
  });
  const total = pids.length * 18;
  return {
    total, entered, missing: total - entered,
    missingBy: missingBy.sort((a, b) => b.missing - a.missing),
    // An empty round is not a finished one — a round with no matches drawn
    // has nothing to be complete about.
    complete: total > 0 && entered === total,
  };
}

// ── Round strip ──
// Every round of the tournament across the top of the Scoring tab, with only
// the current one lit. Its job is to answer the question the gate raises
// ("where did Round 1 go?") before a player has to ask it, so tapping a
// closed chip says WHY it is closed rather than doing nothing at all.
function RoundGateStrip({ rounds, currentRound, roundLocks, onExplain }) {
  if (rounds.length < 2) return null;
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
      {rounds.map(r => {
        const live = r === currentRound;
        const done = isRoundFinal(roundLocks, r);
        return (
          <button
            key={r}
            onClick={() => onExplain(
              live ? `Round ${r} is open for scoring`
                : done ? `Round ${r} is final — see the Leaderboard`
                : currentRound == null ? `The tournament is over — Round ${r} never opened`
                : `Round ${r} opens when Round ${currentRound} is finalized`
            )}
            style={{
              flex: 1, padding: "8px 4px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
              background: live ? BC.amberDim : BC.card,
              border: `1px solid ${live ? BC.amberDim : BC.bdr}`,
              color: live ? "#fff" : done ? BC.t2 : BC.t3,
              opacity: live || done ? 1 : 0.55,
            }}
          >
            {done ? "✓ " : ""}Rd {r}
          </button>
        );
      })}
    </div>
  );
}

// ── Finalize card ──
// Director-only, and the other half of the gate: the gate is only tolerable
// because there is one obvious control that moves it forward. It sits at the
// bottom of the Scoring tab because that is where a director lands after
// typing the round's last score.
//
// Finalizing with scores missing is ALLOWED, behind a confirm that names who
// is out. A hard block reads as safer than it is — a withdrawal or a
// conceded match leaves holes that will never be filled, and a gate with no
// way past it strands the whole field on a round nobody is playing. The
// director is trusted; they are just not allowed to do it by accident.
function FinalizeRoundCard({ round, nextRound, lastFinal, progress, tPlayers, onFinalizeRound, notify }) {
  const { confirm, confirmModal } = useConfirm();
  const [busy, setBusy] = useState(false);
  const nameOf = (pid) => tPlayers.find(t => t.player_id === pid)?.name || pid;

  const outList = progress.missingBy
    .slice(0, 6)
    .map(({ pid, missing }) => `• ${nameOf(pid)} — ${missing} hole${missing === 1 ? "" : "s"}`)
    .join("\n")
    + (progress.missingBy.length > 6 ? `\n• …and ${progress.missingBy.length - 6} more` : "");

  const doFinalize = async () => {
    const ok = await confirm({
      eyebrow: `Round ${round}`,
      title: progress.complete ? `Finalize Round ${round}?` : `Finalize Round ${round} with scores missing?`,
      message: [
        progress.complete
          ? `All ${progress.total} scores are in.`
          : `${progress.missing} score${progress.missing === 1 ? " is" : "s are"} still missing:\n${outList}`,
        "",
        `Finalizing freezes Round ${round}'s handicaps and results, and ${nextRound ? `opens Round ${nextRound} for scoring.` : "closes out the tournament."}`,
        "You can reopen it afterwards if you need to.",
      ].join("\n"),
      confirmLabel: progress.complete ? "Finalize" : "Finalize anyway",
      destructive: !progress.complete,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await onFinalizeRound(round, true);
      if (res) {
        notify(nextRound
          ? `Round ${round} is final — Round ${nextRound} is now open`
          : `Round ${round} is final — that's the tournament`, "success");
      } else {
        notify("Could not finalize the round — try again", "error");
      }
    } catch {
      notify("Could not finalize the round — try again", "error");
    } finally { setBusy(false); }
  };

  const doReopen = async () => {
    const ok = await confirm({
      eyebrow: `Round ${lastFinal}`,
      title: `Reopen Round ${lastFinal}?`,
      message: [
        `Scoring moves back to Round ${lastFinal}${round != null && round !== lastFinal ? `, and Round ${round} closes until Round ${lastFinal} is finalized again.` : "."}`,
        "",
        "Handicaps stay frozen exactly as they are — reopening changes what can be typed, not a stroke already allocated.",
      ].join("\n"),
      confirmLabel: "Reopen",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await onFinalizeRound(lastFinal, false);
      notify(res ? `Round ${lastFinal} reopened for scoring` : "Could not reopen the round — try again", res ? "success" : "error");
    } catch {
      notify("Could not reopen the round — try again", "error");
    } finally { setBusy(false); }
  };

  const pct = progress.total ? Math.round((progress.entered / progress.total) * 100) : 0;

  return (
    <div style={{
      background: BC.card, border: `1px solid ${BC.bdr}`, borderRadius: 12,
      padding: "10px 12px", marginTop: 12,
    }}>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.5, color: BC.amber, marginBottom: 8 }}>
        DIRECTOR
      </div>

      {round != null && (
        <>
          {/* Progress — the number that decides whether Finalize is the
              routine end of a round or an override. */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 11, color: BC.t2, marginBottom: 4 }}>
            <span style={{ fontWeight: 700 }}>Round {round} scores</span>
            <span style={{ color: progress.complete ? BC.green : BC.t3, fontWeight: 700 }}>
              {progress.entered} / {progress.total || 0}
            </span>
          </div>
          <div style={{ height: 5, borderRadius: 3, background: BC.inp, overflow: "hidden", marginBottom: 6 }}>
            <div style={{ width: `${pct}%`, height: "100%", background: progress.complete ? BC.green : BC.amber }} />
          </div>
          <div style={{ fontSize: 10, color: BC.t3, lineHeight: 1.35, marginBottom: 8, minHeight: 13 }}>
            {progress.total === 0
              ? "No matches drawn for this round yet."
              : progress.complete
                ? "Every score is in. Finalize to open the next round."
                : `Still out: ${progress.missingBy.slice(0, 3).map(({ pid, missing }) => `${nameOf(pid)} (${missing})`).join(", ")}${progress.missingBy.length > 3 ? `, +${progress.missingBy.length - 3} more` : ""}`}
          </div>
          <button onClick={doFinalize} disabled={busy} style={{
            width: "100%", padding: "11px 0", borderRadius: 10, cursor: busy ? "default" : "pointer",
            border: progress.complete ? "none" : `1px solid ${BC.amber}66`,
            background: progress.complete ? BC.amber : "transparent",
            color: progress.complete ? "#0a0804" : BC.amber,
            fontSize: 13, fontWeight: 800, letterSpacing: 0.5, opacity: busy ? 0.6 : 1,
          }}>
            {busy ? "Working…" : `Finalize Round ${round}`}
          </button>
        </>
      )}

      {round == null && (
        <div style={{ fontSize: 11, color: BC.t2, lineHeight: 1.4, marginBottom: lastFinal != null ? 8 : 0 }}>
          Every round is final. Scoring is closed for the tournament.
        </div>
      )}

      {/* The way back. Without it, one mistimed tap locks the whole field
          out of the round they are standing on. */}
      {lastFinal != null && (
        <button onClick={doReopen} disabled={busy} style={{
          width: "100%", padding: "8px 0", marginTop: 8, borderRadius: 8,
          background: "transparent", border: "none", color: BC.t3,
          fontSize: 11, fontWeight: 700, cursor: busy ? "default" : "pointer",
          textDecoration: "underline", textUnderlineOffset: 3,
        }}>
          Reopen Round {lastFinal}
        </button>
      )}

      <ConfirmModal modal={confirmModal} />
    </div>
  );
}

// ── Score Entry ──
// ── Score Entry — Mash-style ──
// Rewritten to use the Mash UI patterns (hole strip, deep-green Par/Hole/HCP
// banner, two-row match status bar, vertically-stacked PlayerScoreCards with
// stroke dots and net display, par-relative score buttons with auto-shift,
// auto-advance with toast) on top of the main-app's per-round / per-match /
// multi-format data model. The legacy ScoreEntry data flow stays — this view
// still receives `matches` (from bc_matches), `holeData` (from bc_holes), and
// uses computeMatchResult/calcCHForCourse — but the visual presentation now
// matches the rest of the app.
//
// The round selector this view used to carry is gone: entry is gated to the
// current round (see "The round gate" above), and the strip at the top now
// SHOWS the tournament's rounds rather than offering them.
function ScoreEntry({ user, matches, holeData, onSaveHole, tPlayers, courses, tRounds, notify, teams, hcpOverrides, teeAssignments, roundLocks, rounds, currentRound, onFinalizeRound }) {
  const userPid = user.player_id;
  // THE GATE. Only the current round's matches exist as far as this screen
  // is concerned — a match from a finalized round is not merely hidden, it
  // is not reachable, so no stale selection can put a score in it.
  const myMatches = useMemo(
    () => matches.filter(m => m.round === currentRound && [...m.teamA, ...m.teamB].includes(userPid)),
    [matches, currentRound, userPid]
  );

  // ── Hooks (always fire, in stable order) ──
  const [activeMatchId, setActiveMatchId] = useState(null);
  const [activeHole, setActiveHole] = useState(0);
  const [editing, setEditing] = useState(false);
  const [showScorecard, setShowScorecard] = useState(false);
  const [toast, setToast] = useState(null);
  const initialJump = useRef(false);
  // Auto-advance arming, keyed `matchId:hole`. A hole is armed only once we
  // have seen it INCOMPLETE while mounted — see the auto-advance effect.
  const advanceArmed = useRef({});

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
  const par = holePars[activeHole];
  const hcp = holeHcps[activeHole];

  const matchPids = match ? [...match.teamA, ...match.teamB] : [];

  const result = useMemo(
    () => match ? computeMatchResult(match, holeData, courses, tRounds, tPlayers, format, hcpOverrides, undefined, teeAssignments, roundLocks) : null,
    [match, holeData, courses, tRounds, tPlayers, format, hcpOverrides, teeAssignments, roundLocks]
  );

  // Read a player's gross score for the active hole. holeData is keyed
  // \\`pid_round\\` and inner-keyed by hole index.
  const getScore = (pid, h = activeHole) => {
    if (!match) return 0;
    return (holeData[`${pid}_${match.round}`] || {})[h] || 0;
  };

  // Per-player stroke maps for this match come straight from the result the
  // leaderboard is computed with (computeMatchResult now exposes them), so the
  // dots on the scoring screen and the strokes in the leaderboard math can
  // never diverge — one allocation, one source.
  const strokeMaps = result?.strokeMaps || {};

  // ── Auto-advance state derivations ──
  const holeComplete = matchPids.length > 0 && matchPids.every(pid => getScore(pid, activeHole) > 0);
  const allComplete = matchPids.length > 0 && matchPids.every(pid => {
    for (let h = 0; h < 18; h++) if (!(getScore(pid, h) > 0)) return false;
    return true;
  });
  const curHoleScoreSig = matchPids.map(pid => getScore(pid, activeHole)).join(",");

  // Auto-advance — when all 4 players have scored the active hole, after
  // 1.8s show toast and jump to next unscored hole. Clean-up cancels on
  // edit/navigation. Same pattern as Mash PracticeScoringTab.
  //
  // The arming gate exists because this view is unmounted when the user
  // leaves the Scoring tab and remounts with activeHole back at 0. Come back
  // mid-round and hole 1 has long since been completed, so without the gate
  // the effect fired on the first render and flashed "Hole 1 saved —
  // advancing..." every single time. Arming a hole only after we have seen it
  // incomplete means the toast marks a hole we actually watched get finished,
  // never one that was already full when we arrived.
  useEffect(() => {
    if (!match) return;
    const armKey = `${match.id}:${activeHole}`;
    // Arm before the suppression checks — a hole the user is mid-edit on
    // still needs to arm so finishing it advances as usual.
    if (!holeComplete) { advanceArmed.current[armKey] = true; return; }
    if (activeHole >= 17 || editing || allComplete) return;
    if (!advanceArmed.current[armKey]) return;
    setToast(`✓ Hole ${activeHole + 1} saved — advancing...`);
    const timer = setTimeout(() => {
      setToast(null);
      let next = activeHole + 1;
      while (next < 17 && matchPids.every(pid => getScore(pid, next) > 0)) next++;
      setActiveHole(next);
      setEditing(false);
    }, 1800);
    return () => { clearTimeout(timer); setToast(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holeComplete, activeHole, editing, allComplete, curHoleScoreSig, match?.id]);

  // Safety net — clear toast after 3s in case the cleanup misses an edge case.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Initial-jump on mount per match — fast-forward to first unscored hole.
  // The hole resets with the match, which matters most when the match
  // changes out from under the player: finalizing a round swaps this screen
  // to the next round's match, and a held hole 14 would otherwise carry over
  // onto a card that hasn't teed off. A fresh round has no scores, so the
  // fast-forward below won't move it — the reset is the only thing that does.
  useEffect(() => {
    initialJump.current = false;
    setActiveHole(0);
    setEditing(false);
  }, [match?.id]);
  useEffect(() => {
    if (initialJump.current) return;
    if (!match) return;
    const t = setTimeout(() => {
      if (initialJump.current) return;
      initialJump.current = true;
      let edge = 18;
      for (let h = 0; h < 18; h++) {
        if (!matchPids.every(pid => getScore(pid, h) > 0)) { edge = h; break; }
      }
      const hasAny = matchPids.some(pid => {
        for (let h = 0; h < 18; h++) if (getScore(pid, h) > 0) return true;
        return false;
      });
      if (hasAny && edge > 0 && edge < 18) setActiveHole(edge);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.id, holeData]);

  // Whole-round progress, for the director's Finalize card. Computed over
  // every match in the round, not the reader's own.
  const roundProgress = useMemo(
    () => roundScoreProgress(matches, holeData, currentRound),
    [matches, holeData, currentRound]
  );

  // No more hooks below this line.

  // ── The gate's chrome ──
  // Both of these belong on EVERY branch below, including the ones a player
  // who isn't drawn in this round lands on: the strip is how anyone works out
  // which round is live, and the Finalize card has to reach a director who
  // is running the event without playing in it.
  const gateStrip = (
    <RoundGateStrip rounds={rounds} currentRound={currentRound} roundLocks={roundLocks} onExplain={setToast} />
  );
  const directorCard = user.isDirector && (rounds.length > 0) ? (
    <FinalizeRoundCard
      round={currentRound}
      nextRound={nextRoundNumber(roundLocks, rounds)}
      lastFinal={lastFinalRoundNumber(roundLocks, rounds)}
      progress={roundProgress}
      tPlayers={tPlayers}
      onFinalizeRound={onFinalizeRound}
      notify={notify}
    />
  ) : null;
  const shell = (children) => (
    <div style={{ fontFamily: "'Montserrat', sans-serif" }}>
      {gateStrip}
      {children}
      {directorCard}
      <Toast message={toast} />
    </div>
  );
  const empty = (icon, title, sub) => shell(
    <div style={{ textAlign: "center", padding: "40px 20px", color: BC.t3 }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: BC.t2, marginBottom: 4 }}>{title}</div>
      {sub && <div style={{ fontSize: 12, lineHeight: 1.45 }}>{sub}</div>}
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

  // Live edge — first hole where not everyone has scored. Used to detect
  // "editing past hole" navigation so auto-advance stays suppressed
  // while the user fixes a missed score.
  let liveEdge = 17;
  for (let h = 0; h < 18; h++) {
    if (!matchPids.every(pid => getScore(pid, h) > 0)) { liveEdge = h; break; }
  }
  const goToHole = (h) => { setActiveHole(h); setEditing(h < liveEdge); };

  const { A: tA, B: tB } = teams;

  // ScoreButtonRow hands back the new gross directly (0 = cleared, which it
  // sends when the active button is tapped again), so no toggle logic here.
  const onTapScore = async (pid, score) => {
    await onSaveHole(pid, match.round, activeHole, score || null, tr?.course_id);
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
  const totalScored = (match.scoring_type || "match") === "stroke";
  const segOpts = { total: totalScored, higherWins: higherIsBetter(format) };
  const renderStatusCell = (i) => {
    // Same reasoning as the Leaderboard strip's cell height: the bar has to
    // be tall enough for a split hole's diagonal to read, and it stays that
    // height for every format so the strip never changes shape between rounds.
    const cellH = 29, barH = 8;
    const colBorder = { borderRight: i % 9 === 8 ? "none" : `1px solid ${BC.bdr}33` };
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
        return shell(<div title="Missing score" style={{ textAlign: "center", fontSize: 12, opacity: 0.55, lineHeight: 1 }}>⚠️</div>);
      }
      return shell(null);
    }

    const aLead = segmentState(result.holes.slice(0, i + 1), segOpts).margin;
    const fromUserView = userTeam === "A" ? aLead : -aLead;
    const color = fromUserView > 0 ? BC.green : fromUserView < 0 ? BC.danger : BC.t3;
    return shell(
      <>
        <div style={{ height: barH, borderRadius: 3, boxSizing: "border-box", ...holeFill(hr, format) }} />
        <div style={{ textAlign: "center", fontSize: 13, fontWeight: 800, color, lineHeight: 1 }}>
          {fromUserView > 0 ? <>▲{fromUserView}</>
            : fromUserView < 0 ? <>▼{Math.abs(fromUserView)}</>
            : <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.5 }}>TIED</span>}
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
        flex: 1, height: 32, borderRadius: allScored || cur ? 8 : 6,
        border: allScored && !cur ? `1.5px solid ${BC.amber}50` : "none",
        background: cur ? BC.amber : allScored ? BC.amber + "15" : partial ? BC.amber + "0a" : BC.card,
        color: cur ? "#0a0804" : allScored ? BC.amber : BC.t3,
        fontSize: 15, fontWeight: 700, cursor: "pointer",
        outline: cur ? `2px solid ${BC.amber}` : "none", outlineOffset: 1,
      }}>{h + 1}</button>
    );
  };

  return shell(
    <>
      {/* Match selector — for the rare format that draws a player into more
          than one match in the SAME round. It no longer crosses rounds; the
          strip above owns that axis and only one round of it is live. */}
      {myMatches.length > 1 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {myMatches.map((m, i) => {
            const active = m.id === match.id;
            return (
              <button key={m.id} onClick={() => { setActiveMatchId(m.id); setActiveHole(0); initialJump.current = false; }} style={{
                flex: 1, padding: "8px 4px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
                background: active ? BC.amberDim : BC.card,
                border: `1px solid ${active ? BC.amberDim : BC.bdr}`,
                color: active ? "#fff" : BC.t2,
              }}>Match {i + 1}</button>
            );
          })}
        </div>
      )}

      {/* Front 9 — hole strip + status row. */}
      <div style={{ display: "flex", gap: 3, marginBottom: 2 }}>
        {Array.from({ length: 9 }, (_, i) => renderHoleCell(i))}
      </div>
      <div style={{ display: "flex", marginBottom: 4, background: BC.card, border: `1px solid ${BC.bdr}60`, borderRadius: 8, padding: "4px 0", alignItems: "center" }}>
        {Array.from({ length: 9 }, (_, i) => renderStatusCell(i))}
      </div>

      {/* Back 9 — hole strip + status row. */}
      <div style={{ display: "flex", gap: 3, marginBottom: 2 }}>
        {Array.from({ length: 9 }, (_, i) => renderHoleCell(i + 9))}
      </div>
      <div style={{ display: "flex", marginBottom: 4, background: BC.card, border: `1px solid ${BC.bdr}60`, borderRadius: 8, padding: "4px 0", alignItems: "center" }}>
        {Array.from({ length: 9 }, (_, i) => renderStatusCell(i + 9))}
      </div>

      {/* Full Scorecard — sits ABOVE the hole banner (MNQ's placement) so
          it's reachable without scrolling past four player cards. Slim
          bar styling keeps the vertical cost near zero. */}
      <button onClick={() => setShowScorecard(true)} style={{
        width: "100%", padding: "5px 0", borderRadius: 8, marginBottom: 4, cursor: "pointer",
        background: BC.card, border: `1px solid ${BC.bdr}60`, color: BC.t2,
        fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
      }}>
        Full Scorecard
      </button>

      {/* Hole nav banner — deep Mash green with white text, mirroring the
          Mash design system's "established/chrome" surface. */}
      <div style={{
        background: BC.amberDim, borderRadius: 10, padding: "4px 8px", marginBottom: 6,
        display: "flex", alignItems: "center",
      }}>
        <button onClick={() => goToHole(Math.max(0, activeHole - 1))} disabled={activeHole === 0} style={{
          width: 28, height: 36, borderRadius: 8, background: "none", border: "none",
          cursor: activeHole === 0 ? "default" : "pointer",
          color: activeHole === 0 ? "rgba(255,255,255,0.35)" : "#fff", fontSize: 18, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>‹</button>
        <div style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 8px" }}>
          <div style={{ textAlign: "center", minWidth: 32 }}>
            <div style={{ fontSize: 8, color: "#fff", fontWeight: 600, opacity: 0.75 }}>Par</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#fff" }}>{par}</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 8, color: "#fff", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, opacity: 0.75 }}>Hole</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: "#fff", lineHeight: 1 }}>{activeHole + 1}</div>
          </div>
          <div style={{ textAlign: "center", minWidth: 32 }}>
            <div style={{ fontSize: 8, color: "#fff", fontWeight: 600, opacity: 0.75 }}>HCP</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#fff" }}>{hcp}</div>
          </div>
        </div>
        <button onClick={() => goToHole(Math.min(17, activeHole + 1))} disabled={activeHole === 17} style={{
          width: 28, height: 36, borderRadius: 8, background: "none", border: "none",
          cursor: activeHole === 17 ? "default" : "pointer",
          color: activeHole === 17 ? "rgba(255,255,255,0.35)" : "#fff", fontSize: 18, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>›</button>
      </div>

      {/* Format / round badge — small sticker between banner and player cards.
          Tells the user what scoring format their entries are being judged
          against. Useful since this app supports multiple formats per round. */}
      <div style={{ fontSize: 9, color: BC.t3, fontWeight: 700, letterSpacing: 1, padding: "2px 4px", marginBottom: 4 }}>
        {(FORMATS.find(f => f.id === format)?.label || "MATCH PLAY").toUpperCase()}
        {" · "}
        {/* The scoring type sits next to the format because the same format
            plays completely differently under the two — and the status strip
            above is counting whichever one this says. */}
        {totalScored ? `TOTAL ${totalUnit(format).toUpperCase()}` : "MATCH PLAY"}
        {" · ROUND "}{match.round}
      </div>

      {/* Player score cards — 4 stacked, T1 above dashed divider, T2 below.
          Each shows: name, (CH), stroke dots, "Net: ±X thru N", then a row
          of par-relative score buttons. Tap a saved score again to clear. */}
      <div>
        {[...match.teamA, "DIVIDER", ...match.teamB].map((pid, idx) => {
          if (pid === "DIVIDER") return <div key="div" style={{ borderTop: `1px dashed ${BC.bdr}`, margin: "8px 0" }} />;
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
              background: BC.card, borderRadius: 10, marginBottom: 4, padding: "6px 10px",
              border: `1px solid ${BC.bdr}`,
            }}>
              {/* Top row — name + (CH) + stroke dots clustered tight on the
                  LEFT, so the handicap context reads as attached to the
                  player it describes. MNQ's layout. */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: BC.t1, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flexShrink: 1 }}>{tp?.name || pid}</span>
                <span title={chTitle} style={{ fontSize: 11, fontWeight: 700, color: BC.hcpBlue, flexShrink: 0 }}>
                  ({ch}{reduced ? "*" : ""})
                </span>
                {strokes > 0 && (
                  <span style={{ color: BC.hcpBlue, fontSize: 12, letterSpacing: 1, flexShrink: 0, lineHeight: 1 }}>
                    {"●".repeat(strokes)}
                  </span>
                )}
              </div>
              {/* Net / thru sub-line on its own row beneath the name, as in
                  MNQ. minHeight reserves the slot before scoring starts so
                  the card doesn't grow on the first entry. */}
              <div style={{ fontSize: 10, color: BC.t3, marginBottom: 3, lineHeight: 1.1, minHeight: 10 }}>
                {thru > 0 && (
                  <>Net <strong style={{ color: netToPar < 0 ? BC.danger : netToPar === 0 ? BC.t3 : BC.t1, fontWeight: 700 }}>
                    {fmtScore(netToPar)}
                  </strong> thru {thru}</>
                )}
              </div>
              <ScoreButtonRow par={par} score={cur} onScore={(v) => onTapScore(pid, v)} />
            </div>
          );
        })}
      </div>

      {/* Scorecard modal — uses the existing MatchScorecard component
          which already renders both teams and 18 holes for the main app. */}
      {showScorecard && (
        <Popup onClose={() => setShowScorecard(false)} maxWidth={480} padding={0} outerPadding={12}
          innerStyle={{ background: BC.card, border: `1px solid ${BC.amber}44`, borderRadius: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: `1px solid ${BC.bdr}` }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: BC.amber, letterSpacing: 1 }}>SCORECARD — RD {match.round}</div>
            <button onClick={() => setShowScorecard(false)} style={{
              background: "transparent", border: "none", color: BC.t2, fontSize: 18, cursor: "pointer", padding: "0 4px",
            }}>×</button>
          </div>
          <div style={{ padding: 12 }}>
            <MatchScorecard match={match} result={result} format={format} courses={courses} tRounds={tRounds} teams={teams} roundLocks={roundLocks} />
          </div>
          <button onClick={() => setShowScorecard(false)} style={{
            display: "block", width: "calc(100% - 24px)", margin: "0 auto 12px",
            padding: "10px 0", background: BC.inp, border: `1px solid ${BC.bdr}`,
            borderRadius: 8, color: BC.t2, fontSize: 13, fontWeight: 600,
            cursor: "pointer", letterSpacing: 0.4,
          }}>
            Close
          </button>
        </Popup>
      )}
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
  fontSize: 8, fontWeight: 800, letterSpacing: 0.8, marginBottom: 3,
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

  // Same fallback the admin tab uses: a 2-man format's match is its own
  // foursome, so a round nobody has grouped by hand still has tee times.
  const stored = groupsByRound?.[activeRound];
  const groups = stored || (isFoursomeFormat(tr?.format)
    ? autoBuildGroups({ formatId: tr?.format, matches: rndMatches })
    : []);
  const rawTimes = teeTimeList(tr);
  const times = expandTeeTimes(rawTimes, Math.max(groups.length, 1))
    .map(t => { const m = parseTeeTime(t); return m == null ? t : formatTeeTime(m, { ampm: true }); });
  const firstTee = times[0] || "";

  const nameOf = (pid) => tPlayers.find(t => t.player_id === pid)?.name || pid;
  const teamOf = (pid) => tPlayers.find(t => t.player_id === pid)?.team || null;

  // Matches read best in the order they go off.
  const ordered = [...rndMatches].sort((a, b) => {
    const ta = parseTeeTime(teeTimeForMatch({ groups, times, match: a }));
    const tb = parseTeeTime(teeTimeForMatch({ groups, times, match: b }));
    if (ta == null && tb == null) return 0;
    if (ta == null) return 1;
    if (tb == null) return -1;
    return ta - tb;
  });

  // A tee sheet only earns its space when the groups aren't just the
  // matches over again — Singles (two matches per foursome) and the team
  // formats (one match over several foursomes).
  const needsTeeSheet = groups.length > 0 && rndMatches.some(m => {
    const pids = [...m.teamA, ...m.teamB];
    const idxs = new Set(pids.map(p => groups.findIndex(g => g.includes(p))));
    return idxs.size > 1 || groups.some(g => g.length > pids.length && pids.every(p => g.includes(p)));
  });

  return (
    <div style={{ fontFamily: "'Montserrat', sans-serif" }}>
      {/* Round selector — pill toggle, deep Mash green for active state.
          Mirrors the Mash visual language used on Scoring + Leaderboard. */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {rounds.map(r => {
          const active = r === activeRound;
          return (
            <button key={r} onClick={() => setPickedRound(r)} style={{
              flex: 1, padding: "8px 4px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
              background: active ? BC.amberDim : BC.card,
              border: `1px solid ${active ? BC.amberDim : BC.bdr}`,
              color: active ? "#fff" : BC.t2,
            }}>Rd {r}</button>
          );
        })}
      </div>

      {/* Course / format / tee-time banner — uses the TEAMS-banner style
          (Mash green fill, white centered text) for the section header,
          with details below. Anchors the round visually in the same
          visual language as the Leaderboard's TEAMS card. */}
      <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, marginBottom: 12, overflow: "hidden" }}>
        <Banner>ROUND {activeRound}</Banner>
        <div style={{ padding: "10px 14px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: BC.t1 }}>{course?.name || "Course TBD"}</div>
          {fmt && <div style={{ fontSize: 11, color: BC.t3, marginTop: 2 }}>{fmt.label}{fmt.desc ? ` · ${fmt.desc}` : ""}</div>}
          {firstTee && <div style={{ fontSize: 11, color: BC.amber, marginTop: 4, fontWeight: 700 }}>First Tee: {firstTee}</div>}
        </div>
      </div>

      {/* A set-up round with no draw yet. The round's own card above still
          shows the course, format and first tee — the only thing missing is
          who plays who, so that is the only thing this says. */}
      {rndMatches.length === 0 && (
        <div style={{
          background: BC.card, borderRadius: 12, border: `1px dashed ${BC.bdr}`,
          padding: "28px 20px", textAlign: "center",
          fontSize: 12, fontWeight: 700, letterSpacing: 0.4, color: BC.t3,
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
          <div style={{ fontSize: 9, color: BC.t3, marginBottom: 8, fontWeight: 800, letterSpacing: 1 }}>
            MATCH {i + 1}{teeTime ? `  ·  ${teeTime}` : ""}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 10 }}>
            {/* Team A — its color rail LEFT */}
            <div style={{ minWidth: 0, textAlign: "left", borderLeft: `3px solid ${teamColor("A")}`, paddingLeft: 8 }}>
              <div style={{ ...teamTagStyle, color: teamColor("A") }}>{teams?.A?.name || "Team A"}</div>
              {m.teamA.map(pid => (
                <div key={pid} style={{ fontSize: 13, fontWeight: 600, color: BC.t1, lineHeight: 1.3 }}>{nameOf(pid)}</div>
              ))}
            </div>
            {/* vs */}
            <div style={{ fontSize: 11, color: BC.t3, fontWeight: 700, padding: "0 4px" }}>vs</div>
            {/* Team B — its color rail RIGHT */}
            <div style={{ minWidth: 0, textAlign: "right", borderRight: `3px solid ${teamColor("B")}`, paddingRight: 8 }}>
              <div style={{ ...teamTagStyle, color: teamColor("B") }}>{teams?.B?.name || "Team B"}</div>
              {m.teamB.map(pid => (
                <div key={pid} style={{ fontSize: 13, fontWeight: 600, color: BC.t1, lineHeight: 1.3 }}>{nameOf(pid)}</div>
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
            <div key={gi} style={{ padding: "9px 14px", borderTop: gi ? `1px solid ${BC.bdr}44` : "none", display: "flex", gap: 10, alignItems: "baseline" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: BC.amber, flexShrink: 0, minWidth: 64 }}>{times[gi] || `G${gi + 1}`}</div>
              {/* A group mixes the two sides, so the names carry their own
                  team color as a dot rather than the row carrying one. Reads
                  the 2v2 split of a foursome at a glance. */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 10px", fontSize: 12, color: BC.t1, lineHeight: 1.4 }}>
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
// on every visit. `defaultHandicapMode` mirrors enrichedRounds: Round 4
// plays all handicaps, everything else low man.
const defaultHandicapMode = (round) => (round === 4 ? "full" : "low_man");

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
  r.format, r.handicap_mode, r.tee_time, r.scoring_type,
  r.nassau_front, r.nassau_back, r.nassau_overall, r.allowance,
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

function AdminView({ user, tPlayers, tRounds, courses, matches, onAddPlayer, onUpdatePlayer, onRemovePlayer, onAddCourse, onSetRound, onSetMatch, teams, teamNames, onSaveTeamNames, brand, onSaveBranding, tournamentName, tournamentLocation, onSaveTournament, hcpOverridesFromDb, teeAssignmentsFromDb, groupsFromDb, onSaveGroups, notify, roundLocks }) {
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
  const teamBrandDoc = (tid) => {
    const color = isHex(brandEdit[tid]) ? brandEdit[tid].trim() : null;
    const logo = brandLogoEdit[tid] || null;
    return (color || logo) ? { color, logo } : null;
  };
  const saveBranding = async () => {
    await onSaveBranding({ teamA: teamBrandDoc("A"), teamB: teamBrandDoc("B") });
    notify?.("Team branding saved");
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
  const [scoringType, setScoringType] = useState("match"); // "match" | "stroke"
  // Raw saved allowance for the round being edited, or null to mean "the
  // format's default". Kept raw ({pct} / {low,high}) so a director who never
  // touches it stores nothing, and a later change to a format's recommended
  // allowance still reaches the rounds nobody edited.
  const [allowance, setAllowance] = useState(null);
  // ── Handicap-lock state ──
  // Read-only here: locking is automatic on the first score of a round (see
  // ensureRoundLock in App). These flags only gate the round form's editing.
  const lockState = roundLockState(roundLocks, editRound);
  const roundIsLocked = lockState !== LOCK_OPEN;
  const roundIsFinal = lockState === LOCK_FINAL;

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
    return {
      course_id: tr.course_id || "",
      format: tr.format || DEFAULT_FORMAT,
      handicap_mode: tr.handicap_mode || defaultHandicapMode(editRound),
      tee_time: tr.tee_time || "",
      nassau_front: tr.nassau_front ?? 1,
      nassau_back: tr.nassau_back ?? 1,
      nassau_overall: tr.nassau_overall ?? 1,
      scoring_type: tr.scoring_type || "match",
      allowance: roundAllowance(tr.format || DEFAULT_FORMAT, tr.allowance),
      ch_overrides: hcpOverridesFromDb?.[editRound] || {},
      tee_assignments: teeAssignmentsFromDb?.[editRound] || {},
    };
  }, [tRounds, editRound, hcpOverridesFromDb, teeAssignmentsFromDb]);

  // The same shape, built from the form. `course_id` rides along unchanged
  // — it belongs to the Courses tab and is only here so a round write does
  // not drop it.
  const formRound = useMemo(() => ({
    course_id: storedRound.course_id,
    format: roundFormat || storedRound.format,
    handicap_mode: handicapMode[editRound] || defaultHandicapMode(editRound),
    tee_time: roundTeeTime || storedRound.tee_time,
    nassau_front: nassau.front,
    nassau_back: nassau.back,
    nassau_overall: nassau.overall,
    scoring_type: scoringType,
    // Normalized against the format the form is CURRENTLY showing, so picking
    // a new format re-shapes the allowance in the same render that changes it.
    allowance: roundAllowance(roundFormat || storedRound.format, allowance),
    ch_overrides: hcpOverrides[editRound] || {},
    tee_assignments: teeAssignments[editRound] || {},
  }), [storedRound, roundFormat, handicapMode, editRound, roundTeeTime, nassau, scoringType, allowance, hcpOverrides, teeAssignments]);

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
    setAllowance(storedRound.allowance);
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
        allowance: payload.allowance,
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
      <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: BC.t1 }}>Directors Only</div>
      <div style={{ fontSize: 12, color: BC.t3, marginTop: 8 }}>Only tournament directors can manage settings.</div>
    </div>
  );

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

  const InputStyle = { width: "100%", padding: "10px 12px", background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 8, color: BC.t1, fontSize: 13, boxSizing: "border-box", outline: "none", fontFamily: "'Montserrat', sans-serif" };
  const LabelStyle = { fontSize: 10, color: BC.t3, fontWeight: 700, letterSpacing: 1, marginBottom: 4, display: "block" };
  const BtnStyle = { padding: "10px 20px", borderRadius: 10, border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer", background: `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})`, color: "#0a0804" };

  return (
    <div style={{ fontFamily: "'Montserrat', sans-serif" }}>
      <EditionSwitcher open={showEditions} onClose={() => setShowEditions(false)} />
      {/* Tabs — sticky to the top of the scroll area so the bar stays in the
          SAME place on every tab, regardless of that tab's content height.
          (Before: the body's vertical centering placed short tabs mid-screen,
          so the bar floated to a different spot per tab.) The sticky wrapper
          is painted in the page bg and carries the bottom gap as padding, so
          content scrolls cleanly UNDER it with nothing peeking through. */}
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: BC.bg, paddingBottom: 12, marginBottom: 4 }}>
      <div style={{ display: "flex", gap: 4, background: BC.card, borderRadius: 12, padding: 4, border: `1px solid ${BC.bdr}` }}>
        {[["players","Players"],["rounds","Rounds"],["matches","Matches"],["courses","Courses"],["tournament","Tournament"]].map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            flex: 1, padding: "8px 4px", borderRadius: 8, fontSize: 10, fontWeight: 700, cursor: "pointer", border: "none",
            background: tab === k ? `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})` : "transparent",
            color: tab === k ? "#0a0804" : BC.t3,
          }}>{lbl}</button>
        ))}
      </div>
      </div>

      {tab === "players" && (
        <div>
          {/* Right-aligned batch GHIN re-sync (prompt-gated). */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, padding: "0 9px", marginBottom: 8 }}>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.6, color: BC.t3, textTransform: "uppercase", whiteSpace: "nowrap" }}>GHIN sync</span>
            <GhinSyncButton players={tPlayers} onUpdatePlayer={onUpdatePlayer} notify={notify} confirm={confirm} compact />
          </div>
          {[teams.A, teams.B].map(team => (
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
                        if (await confirm(`Rename to "${newName}"?`)) {
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
                  onClick={() => setEditingPlayer({ isNew: true, team: team.id, first: "", last: "", nick: "", hi: "", ov: "", dir: false })}
                  title="Add player"
                  style={{
                    padding: "3px 10px", borderRadius: 8, border: `1px solid ${team.accent}66`,
                    background: "transparent", color: team.accent,
                    fontSize: 16, fontWeight: 700, cursor: "pointer", lineHeight: 1, flexShrink: 0,
                  }}>+</button>
              </div>

              {/* Player list */}
              {tPlayers.filter(p => p.team === team.id).map(p => {
                const overridden = p.hi_override != null && String(p.hi_override).trim() !== "";
                const effHI = overridden ? p.hi_override : p.handicap_index;
                const synced = !overridden && !!p.ghin_number;
                return (
                  <div key={p.player_id} style={{ background: BC.card, borderRadius: 6, padding: "4px 8px", border: `1px solid ${BC.bdr}`, display: "flex", flexDirection: "row", alignItems: "center", gap: 6, boxShadow: `inset 3px 0 0 ${team.accent}55`, marginBottom: 2 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, flexBasis: "52%", flexGrow: 0, flexShrink: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: playerNameColor(), minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fullName(p)}</span>
                      {p.isDirector && <span title="Tournament director" style={{ fontSize: 11, flexShrink: 0, lineHeight: 1 }}>👑</span>}
                    </div>
                    {/* Index column doubles as the sync-status glyph: amber * =
                        override, blue G = synced from GHIN, plain = manual. */}
                    <span title={overridden ? `Director override — GHIN/base index is ${p.handicap_index}` : (synced ? "Synced from GHIN" : "Manual index")}
                      style={{ display: "inline-flex", alignItems: "center", gap: 4, width: 56, flexShrink: 0 }}>
                      <span style={{ fontSize: 12, fontWeight: overridden ? 700 : 500, color: overridden ? BC.amber : playerNameColor() }}>
                        {effHI}{overridden ? "*" : ""}
                      </span>
                      {synced && <span style={{ fontSize: 7, fontWeight: 800, letterSpacing: 0.2, color: BC.hcpBlue, border: `1px solid ${BC.hcpBlue}66`, background: BC.hcpBlue + "1f", borderRadius: 3, padding: "1px 3px", lineHeight: 1 }}>G</span>}
                    </span>
                    <span style={{ flex: 1, minWidth: 8 }} />
                    <button onClick={() => setEditingPlayer({ pid: p.player_id, first: p.first_name || (p.last_name ? "" : (p.name || "")), last: p.last_name || "", nick: p.name || "", hi: String(p.handicap_index), ov: (p.hi_override != null && String(p.hi_override).trim() !== "") ? String(p.hi_override) : "", dir: !!p.isDirector })} style={{
                      fontSize: 9, padding: "2px 8px", borderRadius: 4, border: `1px solid ${BC.bdr}`, background: "transparent", color: BC.t3, cursor: "pointer", flexShrink: 0,
                    }}>Edit</button>
                  </div>
                );
              })}
              {tPlayers.filter(p => p.team === team.id).length === 0 && (
                <div style={{ color: BC.t3, fontSize: 11, padding: "6px 10px" }}>No players yet.</div>
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
            const lbl = { fontSize: 8, fontWeight: 800, letterSpacing: 0.5, color: BC.t3, textTransform: "uppercase", marginBottom: 3, display: "block" };
            // Input font stays 16px on purpose — anything smaller makes iOS
            // Safari zoom the page on focus. Height is condensed via padding.
            const inp = { fontSize: 16, fontWeight: 600, color: BC.t1, width: "100%", boxSizing: "border-box", background: BC.inp, border: `1px solid ${acc}55`, borderRadius: 8, padding: "7px 10px", outline: "none", fontFamily: "'Montserrat', sans-serif" };
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
                innerStyle={{ background: BC.card, borderRadius: 16, display: "flex", flexDirection: "column", fontFamily: "'Montserrat', sans-serif" }}>
                <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", borderBottom: `1px solid ${BC.bdr}` }}>
                  <div style={{ flex: 1, fontSize: 14, fontWeight: 800, color: BC.t1 }}>{isNew ? "Add Player" : "Edit Player"}</div>
                  <button onClick={close} aria-label="Close" style={{ width: 32, height: 32, borderRadius: 9, border: `1px solid ${BC.bdr}`, background: "transparent", color: BC.t2, fontSize: 16, cursor: "pointer", lineHeight: 1 }}>✕</button>
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
                        style={{ fontSize: 14, fontWeight: 700, padding: "7px 10px", borderRadius: 8, cursor: "pointer", width: "100%", boxSizing: "border-box", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          border: `1px solid ${editingPlayer.dir ? BC.amber : BC.bdr}`, background: editingPlayer.dir ? BC.amber + "18" : "transparent", color: editingPlayer.dir ? BC.amber : BC.t2 }}>
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
                      <div style={{ height: 35, display: "flex", alignItems: "center", padding: "0 9px", borderRadius: 8, border: `1px solid ${(linked ? BC.green : BC.hcpBlue)}44`, background: (linked ? BC.green : BC.hcpBlue) + "12" }}>
                        <GhinLinkButton player={formPlayer} user={user} notify={notify} onUpdatePlayer={ghinWrap} />
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ ...lbl, color: BC.amber }}>Override</span>
                      <input type="number" inputMode="decimal" value={editingPlayer.ov} placeholder={String(p ? p.handicap_index : (editingPlayer.hi || ""))} onChange={e => set({ ov: e.target.value })}
                        style={{ ...inp, border: `1px solid ${BC.amber}66`, color: BC.amber }} />
                    </div>
                  </div>
                </div>
                <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderTop: `1px solid ${BC.bdr}` }}>
                  {!isNew && (
                    <button onClick={async () => { if (await confirm({ title: `Remove ${fullName(p)}?`, message: "This deletes the player from this edition.", confirmLabel: "Delete", destructive: true })) { onRemovePlayer(p.player_id); close(); } }}
                      title="Delete player" style={{ flexShrink: 0, padding: "9px 11px", borderRadius: 10, background: "transparent", border: `1px solid ${BC.danger}55`, color: BC.danger, fontSize: 14, fontWeight: 700, cursor: "pointer", lineHeight: 1 }}>🗑</button>
                  )}
                  <span style={{ flex: 1 }} />
                  <button onClick={close} style={{ padding: "10px 16px", borderRadius: 10, background: BC.inp, border: `1px solid ${BC.bdr}`, color: BC.t2, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Cancel</button>
                  <button onClick={doSave} style={{ padding: "10px 20px", borderRadius: 10, background: acc, border: "none", color: "#0a0804", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>{isNew ? "Add" : "Save"}</button>
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
            {[1,2,3,4].map(r => (
              <button key={r} onClick={() => setEditRound(r)} style={{
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
                  // Allowances are format-specific — a Scramble's 35/15 means
                  // nothing on a Singles round. Changing format puts the
                  // allowance back to off, so the new format's terms are a
                  // decision rather than an inheritance.
                  setAllowance(null);
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
              // Time parsing/formatting is shared with the Matches tab (see
              // lib/groups.js) so the two editors of this one field can never
              // disagree about what "830" means.
              const stripAMPM = (s) => s ? s.replace(/\s*(AM|PM)/gi, "").trim() : s;
              const teeTimes = roundTeeTime ? roundTeeTime.split("|") : ["","","",""];
              // The Matches tab can add groups beyond the four shown here.
              // Their times live in the same list and must survive an edit.
              const slots = Math.max(teeTimes.length, 4);
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

            {/* ── Scoring ──────────────────────────────────────────────────
                Match (win/halve holes) vs Total (the running total decides it:
                fewest net strokes, or most dots on Double Dot, or most points
                on Stableford), then Single vs Nassau. Both share the nassau
                {front,back,overall} pots:
                  • Nassau → three segments (F9 / B9 / OVR)
                  • Single → one 18-hole pot worth `value` (overall-only)
                `scoring_type` lives on the ROUND and nowhere else — App reads
                it off the round doc when enriching matches, so changing it
                here takes effect on every match in the round immediately.
                The Total branch lives in scoring.js computeMatchResult. */}
            {(() => {
              const isSingle = (nassau.front || 0) === 0 && (nassau.back || 0) === 0;
              const pill = (active, disabled) => ({
                padding: "4px 12px", borderRadius: 16, fontSize: 10, fontWeight: 700, border: "none",
                cursor: disabled ? "not-allowed" : "pointer",
                background: active ? `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})` : "transparent",
                color: active ? "#0a0804" : (disabled ? BC.t3 + "66" : BC.t3),
              });
              const numField = (k, lbl) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <span style={{ fontSize: 9, color: BC.t3, flexShrink: 0 }}>{lbl}</span>
                  <input type="number" step="0.5" min="0" value={nassau[k]}
                    onChange={e => setNassau(n => ({ ...n, [k]: parseFloat(e.target.value) || 0 }))}
                    onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
                    style={{ ...InputStyle, marginBottom: 0, padding: "4px 4px", fontSize: 14, textAlign: "center", width: 44 }} />
                </div>
              );
              return (
                <div style={{ marginBottom: 12 }}>
                  {/* How the round is settled, and into how many pots. Both are
                      the same question asked twice, so they share a row; the
                      pot VALUES get their own line below because they're the
                      only thing here you type rather than tap. Low Man / All
                      used to sit on this row — it's a handicap term, and now
                      lives with the allowance it's applied after. */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: BC.gold, flexShrink: 0 }}>SCORING</div>
                    {/* Match / Stroke */}
                    <div style={{ display: "flex", background: BC.bg, borderRadius: 20, padding: 2, border: `1px solid ${BC.bdr}` }}>
                      <button onClick={() => setScoringType("match")} title="Match play — the side that wins more holes takes each pot" style={pill(scoringType === "match", false)}>Match</button>
                      <button onClick={() => setScoringType("stroke")} title={`Total ${totalUnit(roundFormat || tRounds.find(t => t.round_number === editRound)?.format || DEFAULT_FORMAT)} — the running total over each segment decides the pot, not holes won`} style={pill(scoringType === "stroke", false)}>Total</button>
                    </div>
                    {/* Single vs Nassau */}
                    <div style={{ display: "flex", background: BC.bg, borderRadius: 20, padding: 2, border: `1px solid ${BC.bdr}` }}>
                      <button onClick={() => setNassau(n => ({ front: 0, back: 0, overall: n.overall || 1 }))} style={pill(isSingle, false)}>Single</button>
                      <button onClick={() => setNassau(n => ({ front: n.front || 1, back: n.back || 1, overall: n.overall || 1 }))} style={pill(!isSingle, false)}>Nassau</button>
                    </div>
                  </div>
                  {/* What each pot is worth. */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: BC.gold, flexShrink: 0 }}>POINTS</div>
                    {isSingle
                      ? numField("overall", "Value")
                      : [["front", "F9"], ["back", "B9"], ["overall", "OVR"]].map(([k, lbl]) => numField(k, lbl))}
                  </div>
                </div>
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
            {(() => {
              const fmtId = roundFormat || tRounds.find(t => t.round_number === editRound)?.format || DEFAULT_FORMAT;
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
                padding: "4px 12px", borderRadius: 16, fontSize: 10, fontWeight: 700, border: "none",
                cursor: disabled ? "not-allowed" : "pointer",
                background: active ? `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})` : "transparent",
                color: active ? "#0a0804" : BC.t3,
              });
              const pctField = (k, lbl, hint) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span title={hint} style={{ fontSize: 9, color: BC.t3, flexShrink: 0, fontWeight: 600 }}>{lbl}</span>
                  <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                    <input
                      type="number" step="5" min="0" max="150"
                      disabled={roundIsFinal}
                      value={fieldVal(k)}
                      onChange={e => setField(k, e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
                      style={{
                        ...InputStyle, marginBottom: 0, padding: "4px 16px 4px 6px", fontSize: 14,
                        textAlign: "center", width: 58,
                        opacity: roundIsFinal ? 0.5 : 1, cursor: roundIsFinal ? "not-allowed" : "text",
                      }} />
                    <span style={{ position: "absolute", right: 6, fontSize: 10, color: BC.t3, pointerEvents: "none" }}>%</span>
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
                    <div style={{ fontSize: 11, fontWeight: 700, color: BC.gold, flexShrink: 0 }}>HANDICAP</div>
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
                    <div style={{ fontSize: 9, color: BC.t3, lineHeight: 1.5, marginTop: 5 }}>
                      {fmt?.label || "This format"} plays one ball per side, so with no allowance the side's team handicap is both partners' full handicaps added together.
                    </div>
                  )}
                  {roundIsLocked && (
                    <div style={{ fontSize: 9, color: roundIsFinal ? BC.danger : BC.amber, marginTop: 4 }}>
                      Round {editRound} is locked — the allowance it scored with is frozen in the snapshot, so a change here will not move it.
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Handicap Overrides */}
            <div style={{ marginBottom: 14 }}>
              {/* PLAYER DETAILS header already in column headers */}
              {roundIsLocked && (
                <div style={{
                  fontSize: 9, color: roundIsFinal ? BC.danger : BC.amber, lineHeight: 1.5,
                  marginBottom: 6, padding: "5px 7px", borderRadius: 6,
                  background: (roundIsFinal ? BC.danger : BC.amber) + "12",
                  border: `1px solid ${(roundIsFinal ? BC.danger : BC.amber)}33`,
                }}>
                  {roundIsFinal
                    ? `Round ${editRound} is final. These fields are read-only and nothing here is saved.`
                    : `Round ${editRound} is locked — its handicaps are frozen. Changes here are saved for reference but will not affect its scoring.`}
                </div>
              )}
              {tPlayers.length === 0 && <div style={{ fontSize: 11, color: BC.t3 }}>No players added yet.</div>}
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
                      <div style={{ fontSize: 11, fontWeight: 700, color: BC.gold }}>PLAYER DETAILS</div>
                      <div style={{ fontSize: 7, color: BC.t3, fontWeight: 700, textAlign: "center", lineHeight: 1.2 }}>HI</div>
                      <div style={{ fontSize: 7, color: BC.t3, fontWeight: 700, textAlign: "center" }}>Round CH</div>
                      {tees2h.length > 0
                        ? <div style={{ fontSize: 7, color: BC.t3, fontWeight: 700, textAlign: "center", gridColumn: `span ${tees2h.length}` }}>Tee</div>
                        : null}
                      <div />
                    </div>
                    {tees2h.length > 0 && (
                      <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 4, padding: "0 2px", marginBottom: 6, alignItems: "center" }}>
                        <div style={{ fontSize: 9, color: BC.t3, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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
                              <TeeCircle tee={tee} index={ti} size={14} active={allOn} />
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
                        <div style={{ fontSize: 11, color: playerNameColor(), fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                        <div title={hiOverridden ? `Index override (base ${p.handicap_index})` : undefined} style={{ fontSize: 10, color: hiOverridden ? BC.amber : BC.t3, fontWeight: hiOverridden ? 700 : 400, textAlign: "center" }}>{effHI}{hiOverridden ? "*" : ""}</div>
                        <input
                          type="number" step="1"
                          disabled={roundIsFinal}
                          value={hasOverride ? override : ""}
                          onChange={e => {
                            if (roundIsFinal) return;
                            setHcpOverrides(prev => ({ ...prev, [editRound]: { ...(prev[editRound]||{}), [p.player_id]: e.target.value } }));
                          }}
                          placeholder={calcedCH != null ? String(calcedCH) : "CH"}
                          style={{ padding: "5px 8px", background: hasOverride ? BC.amber+"15" : BC.inp, border: `1px solid ${hasOverride ? BC.amber : BC.bdr}`, borderRadius: 6, color: hasOverride ? BC.amber : BC.t2, fontSize: 12, fontWeight: hasOverride ? 700 : 400, outline: "none", textAlign: "center", opacity: roundIsFinal ? 0.5 : 1, cursor: roundIsFinal ? "not-allowed" : "text" }}
                        />
                        {tees2.map((tee, ti) => {
                          const isAct = currentTee2 === tee.name;
                          return (
                            <button key={tee.name} disabled={roundIsFinal} onClick={() => { if (roundIsFinal) return; assignTee2(tee.name); }} title={tee.name} style={{
                              background: "transparent", border: "none", cursor: roundIsFinal ? "not-allowed" : "pointer", padding: 0,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              opacity: roundIsFinal ? (isAct ? 0.55 : 0.2) : (isAct ? 1 : 0.35),
                              transform: isAct ? "scale(1.3)" : "scale(1)",
                              transition: "all 0.15s ease",
                            }}>
                              <TeeCircle tee={tee} index={ti} size={14} active={isAct} />
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
                  padding: "8px 0 2px", fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color,
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
          onSetRound={onSetRound}
          onSetMatch={onSetMatch}
          notify={notify}
          confirm={confirm}
        />
      )}

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
                            await onSetRound({ id: editionDocId(`bc_round_${r}`), tournament_id: TOURNAMENT_ID, round_number: r, course_id: null, format: tr?.format || DEFAULT_FORMAT, tee_time: tr?.tee_time || "", nassau_front: tr?.nassau_front || 1, nassau_back: tr?.nassau_back || 1, nassau_overall: tr?.nassau_overall || 1 });
                          } else if (otherCourse) {
                            if (await confirm(`Replace ${otherCourse.name} for Rd ${r}?`)) {
                              await onSetRound({ id: editionDocId(`bc_round_${r}`), tournament_id: TOURNAMENT_ID, round_number: r, course_id: c.id, format: tr?.format || DEFAULT_FORMAT, tee_time: tr?.tee_time || "", nassau_front: tr?.nassau_front || 1, nassau_back: tr?.nassau_back || 1, nassau_overall: tr?.nassau_overall || 1 });
                            }
                          } else {
                            await onSetRound({ id: editionDocId(`bc_round_${r}`), tournament_id: TOURNAMENT_ID, round_number: r, course_id: c.id, format: tr?.format || DEFAULT_FORMAT, tee_time: tr?.tee_time || "", nassau_front: tr?.nassau_front || 1, nassau_back: tr?.nassau_back || 1, nassau_overall: tr?.nassau_overall || 1 });
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
                  <button onClick={() => setCoursePreview(c)} title="Edit course name, tees & scorecard" style={{ background: "transparent", border: `1px solid ${BC.bdr}`, color: BC.t3, cursor: "pointer", fontSize: 9, fontWeight: 700, borderRadius: 4, padding: "3px 6px" }}>Edit</button>
                  <button onClick={async () => { if (await confirm(`Remove ${c.name}?`)) onAddCourse({ ...c, _delete: true }); }} style={{ background: "transparent", border: "none", color: BC.t3, cursor: "pointer", fontSize: 14, padding: "2px 4px" }}>✕</button>
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
                {/* fontSize 16 on both controls prevents iOS Safari's
                    zoom-on-focus (anything < 16px zooms the whole page in and
                    doesn't zoom back). The search input is autoFocused, so a
                    smaller size zoomed the view the instant the panel opened. */}
                <select value={courseStateFilter} onChange={e => { setCourseStateFilter(e.target.value); if (courseSearch.trim().length >= 2) doCourseSearch(courseSearch, e.target.value); }}
                  style={{ width: 64, padding: "9px 6px", background: BC.inp, border: `1px solid ${BC.amber}44`, borderRadius: 8, color: BC.t1, fontSize: 16, flexShrink: 0 }}>
                  <option value="">All</option>
                  {["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <input value={courseSearch} onChange={e => doCourseSearch(e.target.value)} placeholder="Search by course or city..." autoFocus
                  style={{ flex: 1, padding: "9px 12px", background: BC.inp, border: `1px solid ${BC.amber}44`, borderRadius: 8, color: BC.t1, fontSize: 16, outline: "none" }} />
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
            const ti = { background: BC.bg, border: `1px solid ${BC.amber}30`, borderRadius: 4, color: BC.t1, fontSize: 9, textAlign: "center", width: "100%", padding: "3px 2px", boxSizing: "border-box" };
            const tiL = { ...ti, textAlign: "left", padding: "3px 5px" };
            return (
              <Popup onClose={() => setCoursePreview(null)} maxWidth={420} padding={0} innerStyle={{ background: BC.card, borderRadius: 16, border: `1px solid ${BC.amber}44` }}>

                  {/* Header */}
                  <div style={{ padding: "14px 16px 10px", borderBottom: `1px solid ${BC.bdr}`, position: "sticky", top: 0, background: BC.card, zIndex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ flex: 1, marginRight: 8 }}>
                        <input value={draft.name} onChange={e => setDraft(p => ({...p, name: e.target.value}))}
                          style={{ background: "transparent", border: "none", borderBottom: `1px solid ${BC.amber}44`, color: BC.t1, fontSize: 16, fontWeight: 800, width: "100%", padding: "2px 0", outline: "none" }} />
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
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, gap: 6 }}>
                        <div style={{ fontSize: 9, color: BC.t3, fontWeight: 700, textTransform: "uppercase" }}>Tee Boxes</div>
                        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                          {/* Recover tee data from the golf API — e.g. after a tee
                              was deleted by mistake. Replaces the tee list below. */}
                          <button onClick={refetchTeesFromApi} disabled={refetchingTees} title="Re-fetch tees from the golf API by course name"
                            style={{ fontSize: 9, padding: "2px 7px", borderRadius: 4, background: "transparent", border: `1px solid ${BC.hcpBlue}60`, color: BC.hcpBlue, cursor: refetchingTees ? "default" : "pointer", fontWeight: 700, opacity: refetchingTees ? 0.5 : 1 }}>
                            {refetchingTees ? "Fetching…" : "⟳ Re-fetch tees"}
                          </button>
                          <button onClick={() => setDraft(p => ({ ...p, tee_boxes: [...(p.tee_boxes||[]), { name: "", color: "#888888", rating: 72.0, slope: 113, par: 72, yardage: 0 }] }))}
                            style={{ fontSize: 9, padding: "2px 7px", borderRadius: 4, background: "transparent", border: `1px solid ${BC.amber}60`, color: BC.amber, cursor: "pointer", fontWeight: 700 }}>+ Tee</button>
                        </div>
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
                        notify(`${finalCourse.name} ${isExisting ? "updated" : "added"}!`, "success");
                      }} style={{ flex: 2, padding: "10px 0", borderRadius: 8, background: `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})`, border: "none", color: "#0a0804", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{isExisting ? "✓ Save Changes" : "✓ Add Course"}</button>
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
          <div style={{ fontSize: 10, fontWeight: 700, color: BC.t3, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 8 }}>Active Edition</div>
          <button onClick={() => setShowEditions(true)} style={{
            width: "100%", marginBottom: 16, padding: "12px 14px", borderRadius: 10,
            background: BC.card, border: `1px solid ${BC.bdr}`, color: BC.t1,
            fontSize: 13, fontWeight: 700, letterSpacing: 0.3, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span>Edition · <span style={{ color: BC.amber }}>{TOURNAMENT_ID}</span></span>
            <span style={{ fontSize: 11, color: BC.t3 }}>Switch / new ›</span>
          </button>

          {/* Tournament identity — name and location.
              One card and one Save for both: they're the same sentence on
              every screen that shows them ("The Bourbon Cup · 2025 · Gaylord,
              MI"), and a director renaming the tournament for a new venue
              would otherwise have to remember two separate saves. An empty
              field falls back to its constant rather than saving blank, so
              the header can't end up with a hole in it. */}
          <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, padding: 14, marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: BC.t3, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 8 }}>Tournament</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { key: "name", val: editTournamentName, set: setEditTournamentName, ph: TOURNAMENT_TITLE, lbl: "Name" },
                { key: "location", val: editTournamentLocation, set: setEditTournamentLocation, ph: TOURNAMENT_LOCATION, lbl: "Location" },
              ].map(f => (
                <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: BC.t3, letterSpacing: 0.5, width: 52, flexShrink: 0, textTransform: "uppercase" }}>{f.lbl}</span>
                  <input
                    value={f.val}
                    onChange={e => f.set(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
                    placeholder={f.ph}
                    style={{ flex: 1, minWidth: 0, boxSizing: "border-box", padding: "10px 12px", background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 8, color: BC.t1, fontSize: 14, fontWeight: 700, outline: "none", fontFamily: "'Montserrat', sans-serif" }}
                  />
                </div>
              ))}
              <button
                onClick={() => onSaveTournament({
                  name: editTournamentName.trim() || TOURNAMENT_TITLE,
                  location: editTournamentLocation.trim() || TOURNAMENT_LOCATION,
                })}
                style={{ alignSelf: "flex-end", fontSize: 12, fontWeight: 700, color: "#0a0804", background: BC.amber, border: "none", borderRadius: 8, padding: "9px 18px", cursor: "pointer" }}
              >Save</button>
            </div>
            <div style={{ fontSize: 11, color: BC.t3, marginTop: 8, lineHeight: 1.5 }}>
              Both show on the login screen; the location also sits under the cup mark on the leaderboard. The year follows the active edition.
            </div>
          </div>

          {/* Teams — name, imported logo, brand color */}
          <div style={{ fontSize: 10, fontWeight: 700, color: BC.t3, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 8 }}>Teams</div>
          {[teams.A, teams.B].map(team => {
            const previewLogo = brandLogoEdit[team.id] || team.logo;
            return (
              <div key={team.id} style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, padding: 12, marginBottom: 10 }}>
                {/* Name row */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 8, background: brandSwatch(team.id) + "22", border: `1px solid ${brandSwatch(team.id)}55`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" }}>
                    {previewLogo
                      ? <img src={previewLogo} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      : <span style={{ fontSize: 14, fontWeight: 800, color: brandSwatch(team.id) }}>{team.id}</span>}
                  </div>
                  <input
                    value={editTeamNames[team.id]}
                    onChange={e => setEditTeamNames(n => ({ ...n, [team.id]: e.target.value }))}
                    placeholder={`Team ${team.id}`}
                    style={{ flex: 1, minWidth: 0, boxSizing: "border-box", padding: "9px 10px", background: BC.inp, border: `1px solid ${brandSwatch(team.id)}55`, borderRadius: 8, color: BC.t1, fontSize: 13, fontWeight: 800, letterSpacing: 0.5, outline: "none", fontFamily: "'Montserrat', sans-serif" }}
                  />
                  <button
                    onClick={() => onSaveTeamNames({ ...teamNames, [team.id]: (editTeamNames[team.id] || "").trim() || teamNames[team.id] })}
                    style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: BC.t2, background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 6, padding: "9px 12px", cursor: "pointer", whiteSpace: "nowrap" }}
                  >Rename</button>
                </div>

                {/* Logo import + color row */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 26, height: 26, borderRadius: "50%", background: brandSwatch(team.id), border: `2px solid ${BC.bdr}`, flexShrink: 0 }} />
                  <input
                    value={brandEdit[team.id]}
                    onChange={e => setBrandEdit(b => ({ ...b, [team.id]: e.target.value }))}
                    placeholder="#rrggbb"
                    style={{ width: 100, boxSizing: "border-box", padding: "8px 8px", background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 6, color: BC.t1, fontSize: 12, fontWeight: 600, outline: "none", fontFamily: "'Montserrat', sans-serif" }}
                  />
                  <label style={{ fontSize: 11, fontWeight: 700, color: BC.t2, background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 6, padding: "8px 10px", cursor: "pointer", whiteSpace: "nowrap" }}>
                    {brandBusy === team.id ? "Reading…" : "Import logo"}
                    <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => { pickLogo(team.id, e.target.files?.[0]); e.target.value = ""; }} />
                  </label>
                  <button onClick={saveBranding} style={{ marginLeft: "auto", flexShrink: 0, fontSize: 11, fontWeight: 700, color: "#0a0804", background: BC.amber, border: "none", borderRadius: 6, padding: "8px 14px", cursor: "pointer" }}>Save</button>
                </div>
                <div style={{ fontSize: 10, color: BC.t3, marginTop: 6, lineHeight: 1.4 }}>
                  Import a logo to set the team badge and auto-fill its color, or enter a hex. Save applies it live across the app.
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
    <div style={{ fontFamily: "'Montserrat', sans-serif" }}>
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
                const team = p ? teams[p.team] : null;
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
    <div style={{ fontFamily: "'Montserrat', sans-serif" }}>
      <SegmentedToggle
        options={[["current", `${getTournamentYear()} Stats`], ["history", "History"]]}
        value={analyticsTab} onChange={setAnalyticsTab} style={{ marginBottom: 14 }}
      />

      {analyticsTab === "current" && (
        <div>
          <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 44px 44px 44px 52px", padding: "8px 12px", borderBottom: `1px solid ${BC.bdr}`, fontSize: 9, fontWeight: 700, color: BC.t3, letterSpacing: 1 }}>
              <div>PLAYER</div><div style={{textAlign:"center"}}>W</div><div style={{textAlign:"center"}}>L</div><div style={{textAlign:"center"}}>H</div><div style={{textAlign:"right"}}>PTS</div>
            </div>
            {playerStats.map((p, i) => {
              const team = teams[p.team];
              return (
                <div key={p.name} style={{ display: "grid", gridTemplateColumns: "1fr 44px 44px 44px 52px", padding: "9px 12px", borderBottom: i < playerStats.length-1 ? `1px solid ${BC.bdr}10` : "none", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: team?.accent || BC.t3, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: playerNameColor() }}>{p.name}</span>
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
                  <div style={{ fontSize: 12, color: BC.t1 }}><span style={{ color: teams.A.accent, fontWeight: 700 }}>{yr.teamAName}</span> {yr.teamAScore}</div>
                  <div style={{ fontSize: 12, color: BC.t1 }}><span style={{ color: teams.B.accent, fontWeight: 700 }}>{yr.teamBName}</span> {yr.teamBScore}</div>
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
// ── Scoring Sub-view ── (extracted to top level so its function reference
// stays stable across PracticeView re-renders. When defined inline, every
// score that updated `scoresMap` caused PracticeView to re-render, which
// produced a fresh `ScoringTab` function reference — React then treated
// it as a different component, unmounted the old one and mounted a new
// one. Consequence: every score wiped activeHole/toast/editing state and
// killed any pending auto-advance setTimeout, so the toast never appeared
// and the screen seemed to "instantly" advance (the freshly-mounted
// instance ran its initial-jump effect, which jumped to the next unscored
// hole during the same render cycle as the auto-advance was being set up).
// Keeping the component top-level means React preserves the same instance
// across parent re-renders, state survives, and timers run to completion.
function PracticeScoringTab({
  event, course, user, scoresMap, matchResults,
  onSavePracticeScore, getStrokeMapsForMatch,
  renderMatchScorecardBody, tPlayers,
}) {
  // Hooks first — must fire unconditionally on every render. Even when
  // event/course aren't loaded yet, we still call them so React's hook
  // counter stays consistent across renders.
  const [activeHole, setActiveHole] = useState(0);
  const [showScorecard, setShowScorecard] = useState(false);
  // `editing` = true when the user has navigated BACK to a previously-
  // completed hole to fix a score. While editing, auto-advance is
  // suppressed so a corrective tap doesn't jump the screen away. Reset
  // to false whenever they reach the live edge (first unscored hole).
  const [editing, setEditing] = useState(false);
  // Initial-jump bookkeeping. On first arrival at the scoring view (after
  // Firestore scores load), we jump activeHole forward to the first
  // unscored hole — so a user joining mid-round doesn't have to flip
  // through holes 1..N to reach the action. Only fires once per mount.
  const initialJump = useRef(false);
  // Auto-advance arming, keyed `matchId:hole`. A hole is armed only once we
  // have seen it INCOMPLETE while mounted — see the auto-advance effect.
  const advanceArmed = useRef({});
  // Auto-advance toast — surfaced as a fixed-position banner during the
  // 1.8s pause between "all scores in for this hole" and the screen
  // jump. Without this, the wait feels like dead time and the eventual
  // jump feels abrupt. Mirrors MNQ's `setToast(...)` UX.
  const [toast, setToast] = useState(null);

  const holePars = resolveHolePars(course);
  const holeHcps = resolveHoleHcps(course);

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
    return getStrokeMapsForMatch(activeMatch);
  }, [activeMatch, event, course]);

  // ── Auto-advance derivations ────────────────────────────────────────────
  // Whether every player in the match has a score on the active hole.
  // When this flips true (after the 4th player's score is entered), we
  // start a timer to jump to the next unscored hole.
  const holeComplete = matchPids.length > 0 && matchPids.every(pid => (scoresMap[`${pid}_${activeHole}`] || 0) > 0);
  // Whether every player has scores on every hole — if so, the round is
  // done and we shouldn't auto-advance off the last hole.
  const allComplete = matchPids.length > 0 && matchPids.every(pid => {
    for (let h = 0; h < 18; h++) {
      if (!(scoresMap[`${pid}_${h}`] > 0)) return false;
    }
    return true;
  });
  // Signature of the current hole's scores — flips whenever ANY score on
  // this hole changes, even if the hole stays "complete" through the edit
  // (e.g. correcting a 5 to a 4). Used as a useEffect dep so editing
  // within the 1.8s auto-advance window restarts the timer rather than
  // letting it lock in at the moment of first completion.
  const curHoleScoreSig = matchPids.map(pid => scoresMap[`${pid}_${activeHole}`] || 0).join(",");

  // Auto-advance effect — fires the timer when the active hole becomes
  // fully scored. Surfaces a toast during the 1.8s wait so the screen
  // jump feels intentional, not abrupt. Cleanup clears the pending
  // timer AND the toast if the hole changes, the user starts editing,
  // or scores are edited again before the timer fires. Always called
  // (even when match is missing) to keep hook ordering consistent.
  //
  // The arming gate exists because this tab is unmounted when the user
  // switches sub-tabs and remounts with activeHole back at 0. Return to
  // scoring mid-round and hole 1 has long since been completed, so without
  // the gate the effect fired on the first render and flashed "Hole 1 saved —
  // advancing..." every single time. Arming a hole only after we have seen it
  // incomplete means the toast marks a hole we actually watched get finished,
  // never one that was already full when we arrived.
  useEffect(() => {
    if (!activeMatch) return;
    const armKey = `${activeMatch.id}:${activeHole}`;
    // Arm before the suppression checks — a hole the user is mid-edit on
    // still needs to arm so finishing it advances as usual.
    if (!holeComplete) { advanceArmed.current[armKey] = true; return; }
    if (activeHole >= 17 || editing || allComplete) return;
    if (!advanceArmed.current[armKey]) return;
    // Fire the toast immediately so users see "saving — advancing..."
    // throughout the wait, not just after the jump.
    setToast(`✓ Hole ${activeHole + 1} saved — advancing...`);
    const timer = setTimeout(() => {
      setToast(null);
      // Skip past any holes that are already fully scored (e.g. user
      // back-filled a missing hole and the live edge has now leapfrogged
      // forward). Land on the first hole that still needs entry.
      let next = activeHole + 1;
      while (next < 17 && matchPids.every(pid => (scoresMap[`${pid}_${next}`] || 0) > 0)) next++;
      setActiveHole(next);
      setEditing(false);
    }, 1800);
    return () => {
      clearTimeout(timer);
      // If the effect re-runs because the user edited a score within the
      // window, the next pass will set the toast again. If the effect
      // re-runs because the user navigated away from the completed hole,
      // we want the toast cleared — which this catch-all handles.
      setToast(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holeComplete, activeHole, editing, allComplete, curHoleScoreSig, activeMatch]);

  // Safety net — always clear the toast after 3s even if some edge case
  // misses cleanup. Mirrors MNQ's safety useEffect.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Initial-jump effect — runs once on mount per match. Waits a brief
  // moment for Firestore's cached snapshot to land, then reads the latest
  // scoresMap via a ref and jumps activeHole forward to the live edge if
  // there's pre-existing data. The previous version listened on
  // [activeMatch, scoresMap] and re-fired each time scoresMap changed —
  // which meant the user's FIRST score (a scoresMap change with
  // hasAnyScores newly true) triggered a same-frame jump that raced with
  // the auto-advance effect and pre-empted the 1.8s toast wait. Listening
  // only on activeMatch.id and reading scoresMap via a ref makes this
  // strictly a "joining mid-round" UX feature; live scoring is left to
  // the auto-advance effect.
  const scoresMapRef = useRef(scoresMap);
  scoresMapRef.current = scoresMap;
  useEffect(() => {
    if (initialJump.current) return;
    if (!activeMatch) return;
    const t = setTimeout(() => {
      if (initialJump.current) return;
      initialJump.current = true; // lock regardless of outcome
      const sMap = scoresMapRef.current;
      const pids = [activeMatch.team1.player1, activeMatch.team1.player2, activeMatch.team2.player1, activeMatch.team2.player2].filter(Boolean);
      if (pids.length === 0) return;
      let edge = 18;
      for (let h = 0; h < 18; h++) {
        if (!pids.every(pid => (sMap[`${pid}_${h}`] || 0) > 0)) { edge = h; break; }
      }
      const hasAnyScores = pids.some(pid => {
        for (let h = 0; h < 18; h++) if ((sMap[`${pid}_${h}`] || 0) > 0) return true;
        return false;
      });
      if (hasAnyScores && edge > 0 && edge < 18) setActiveHole(edge);
    }, 400);
    return () => clearTimeout(t);
  }, [activeMatch?.id]);

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
    const cellH = 24;
    // Clinch hole — show "X&Y" prominently in green (you won) or red (you lost)
    if (clinchHole !== null && i === clinchHole) {
      const color = st > 0 ? BC.green : st < 0 ? BC.danger : BC.t3;
      return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 14, color, fontWeight: 800, lineHeight: `${cellH}px`, ...colBorder }}>{clinchText}</div>;
    }
    // Post-clinch holes don't render a status (match is mathematically over)
    if (clinchHole !== null && i > clinchHole) {
      return <div key={i} style={{ flex: 1, height: cellH, ...colBorder }} />;
    }
    // Unscored hole — could be either "completely untouched" OR
    // "some players have scored but not all". Distinguishing matters:
    // a fully-untouched hole is normal (it's ahead of where play is),
    // but a hole with some-but-not-all scores is a data integrity
    // problem — somebody navigated past without entering everyone's
    // score, and the match math can't compute a result for it. Surface
    // those with a yellow warning triangle so they don't get
    // overlooked when reviewing the round. The currently-active hole
    // is excluded from this check — partial state on the active hole
    // is normal mid-entry behavior, not a problem.
    if (st === null) {
      const someScored = matchPids.some(pid => (scoresMap[`${pid}_${i}`] || 0) > 0);
      const isActive = i === activeHole;
      if (someScored && !isActive) {
        return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 12, opacity: 0.55, lineHeight: `${cellH}px`, ...colBorder }} title="Missing score">⚠️</div>;
      }
      return <div key={i} style={{ flex: 1, height: cellH, ...colBorder }} />;
    }
    // All-square — small "TIED" label
    if (st === 0) {
      return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 8, fontWeight: 700, color: BC.t3, lineHeight: `${cellH}px`, letterSpacing: 0.5, ...colBorder }}>TIED</div>;
    }
    // Up or down — show the lead with arrow
    const color = st > 0 ? BC.green : BC.danger;
    return (
      <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 14, fontWeight: 800, color, lineHeight: `${cellH}px`, ...colBorder }}>
        {st > 0 ? "▲" : "▼"}{Math.abs(st)}
      </div>
    );
  };

  // "Live edge" — first hole where not all players have scored yet. Anything
  // earlier than this is a past hole the user might be editing. Used to
  // suppress auto-advance when the user has navigated back to fix a score.
  let liveEdge = 17;
  for (let h = 0; h < 18; h++) {
    if (!matchPids.every(pid => (scoresMap[`${pid}_${h}`] || 0) > 0)) { liveEdge = h; break; }
  }
  // Centralizes the "set hole + flip editing flag" pattern. Direct calls to
  // setActiveHole alone would leak stale editing state — e.g. user fixes
  // hole 3, then taps hole 5 (the live edge) but editing stays true and
  // auto-advance never fires when they finish hole 5.
  const goToHole = (h) => {
    setActiveHole(h);
    setEditing(h < liveEdge);
  };

  // Hole-strip cell — same geometry as the tournament Scoring tab, which
  // takes it from MNQ: 32px tall, completed rendered as a tinted chip with
  // an accent border rather than a solid fill, current as a solid accent
  // chip with an outline ring.
  const renderHoleCell = (h) => {
    const cur = h === activeHole;
    const allScored = matchPids.every(pid => scoresMap[`${pid}_${h}`]);
    const partial = !allScored && matchPids.some(pid => scoresMap[`${pid}_${h}`]);
    return (
      <button key={h} onClick={() => goToHole(h)} style={{
        flex: 1, height: 32, borderRadius: allScored || cur ? 8 : 6,
        border: allScored && !cur ? `1.5px solid ${BC.amber}50` : "none",
        background: cur ? BC.amber : allScored ? BC.amber + "15" : partial ? BC.amber + "0a" : BC.card,
        color: cur ? "#0a0804" : allScored ? BC.amber : BC.t3,
        fontSize: 15, fontWeight: 700, cursor: "pointer",
        outline: cur ? `2px solid ${BC.amber}` : "none", outlineOffset: 1,
      }}>{h + 1}</button>
    );
  };

  return (
    <div>
      {/* Front 9 — hole strip. Three-state visual hierarchy:
          - Current hole: solid BC.amber with dark ink — "this is
            the live one, you're entering it now"
          - Completed hole (all 4 players have scores): amber-tinted
            chip with an amber border — "locked in, done"
          - Partial (some players have scored): faint amber wash
          - Untouched: card background
          The deep-green-on-white "completed" state mirrors the
          gross/net toggle's deeper-green active treatment, which
          creates visual consistency: anywhere on the Mash UI where
          something is "the firm/established/locked-in option", it
          uses the deep BC.amberDim + white pairing. Bright BC.amber
          stays reserved for "currently active / interactive".
          The three states give a clear at-a-glance read of round
          progress: scan the strip and you immediately see which
          holes are done (solid deep green), which are in flight
          (current + bright), and which are still ahead (faint). */}
      <div style={{ display: "flex", gap: 3, marginBottom: 2 }}>
        {Array.from({ length: 9 }, (_, i) => renderHoleCell(i))}
      </div>
      {/* Front 9 — match status row */}
      <div style={{ display: "flex", marginBottom: 4, background: BC.card, border: `1px solid ${BC.bdr}60`, borderRadius: 8, padding: "4px 0", alignItems: "center" }}>
        {Array.from({ length: 9 }, (_, i) => renderStatusCell(i))}
      </div>
      {/* Back 9 — hole strip. Same three-state hierarchy as front 9. */}
      <div style={{ display: "flex", gap: 3, marginBottom: 2 }}>
        {Array.from({ length: 9 }, (_, i) => renderHoleCell(i + 9))}
      </div>
      {/* Back 9 — match status row */}
      <div style={{ display: "flex", marginBottom: 4, background: BC.card, border: `1px solid ${BC.bdr}60`, borderRadius: 8, padding: "4px 0", alignItems: "center" }}>
        {Array.from({ length: 9 }, (_, i) => renderStatusCell(i + 9))}
      </div>

      {/* Full Scorecard — opens a modal with the full hole-by-hole grid for
          both teams plus the running match status row (front 9 and back 9
          stacked, since 18 columns is too cramped on mobile). Sits ABOVE
          the hole banner, MNQ's placement, so it's reachable without
          scrolling past four player cards. */}
      <button onClick={() => setShowScorecard(true)} style={{
        width: "100%", padding: "5px 0", borderRadius: 8, marginBottom: 4, cursor: "pointer",
        background: BC.card, border: `1px solid ${BC.bdr}60`,
        color: BC.t2, fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
      }}>
        Full Scorecard
      </button>

      {/* Hole nav banner — deep Mash green filled bar showing
          Par / Hole / HCP, with prev/next arrows. Uses BC.amberDim
          (the deep brand-green) with white text — the SAME treatment
          as the betting Gross/Net toggle's active state, the
          completed hole-strip cells above, and any other "this is
          the firm/established surface" element across the Mash UI.
          Bright BC.amber stays reserved for "currently active /
          interactive" surfaces (active sub-tabs, the active hole on
          the strip, score-button selection, etc.); deep BC.amberDim
          is for the chrome and reference surfaces.
          The banner is the most prominent always-visible element on
          the scoring screen, so this color treatment immediately
          signals the visual hierarchy of the Mash design system to
          anyone landing on this view. */}
      <div style={{
        background: BC.amberDim, borderRadius: 10, padding: "4px 8px", marginBottom: 6,
        display: "flex", alignItems: "center",
      }}>
        <button onClick={() => goToHole(Math.max(0, activeHole - 1))} disabled={activeHole === 0} style={{
          width: 28, height: 36, borderRadius: 8, background: "none", border: "none",
          cursor: activeHole === 0 ? "default" : "pointer",
          color: activeHole === 0 ? "rgba(255,255,255,0.35)" : "#fff", fontSize: 18, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>‹</button>
        <div style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 8px" }}>
          <div style={{ textAlign: "center", minWidth: 32 }}>
            <div style={{ fontSize: 8, color: "#fff", fontWeight: 600, opacity: 0.75 }}>Par</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#fff" }}>{par}</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 8, color: "#fff", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, opacity: 0.75 }}>Hole</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: "#fff", lineHeight: 1 }}>{activeHole + 1}</div>
          </div>
          <div style={{ textAlign: "center", minWidth: 32 }}>
            <div style={{ fontSize: 8, color: "#fff", fontWeight: 600, opacity: 0.75 }}>HCP</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#fff" }}>{hcp}</div>
          </div>
        </div>
        <button onClick={() => goToHole(Math.min(17, activeHole + 1))} disabled={activeHole === 17} style={{
          width: 28, height: 36, borderRadius: 8, background: "none", border: "none",
          cursor: activeHole === 17 ? "default" : "pointer",
          color: activeHole === 17 ? "rgba(255,255,255,0.35)" : "#fff", fontSize: 18, fontWeight: 700,
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
        const ch = calcCHForCourse(hi, course, event.tee_box);
        const run = getRunning(pid);

        return (
          <div key={pid}>
            {idx === 2 && <div style={{ borderTop: `1px dashed ${BC.bdr}`, margin: "6px 0" }} />}
            <div style={{
              background: BC.card, borderRadius: 10, marginBottom: 4, padding: "6px 10px",
              border: `1px solid ${BC.bdr}`,
            }}>
              {/* Top row — name + (CH) + stroke dots clustered on the LEFT,
                  with the Net line on its own row below. MNQ's layout. */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: BC.t1, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flexShrink: 1 }}>{p.name}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: BC.hcpBlue, flexShrink: 0 }}>({ch})</span>
                {strokes > 0 && (
                  <span style={{ color: BC.hcpBlue, fontSize: 12, letterSpacing: 1, flexShrink: 0, lineHeight: 1 }}>
                    {"●".repeat(strokes)}
                  </span>
                )}
              </div>
              {/* PGA-leaderboard color convention: red for under par, neutral
                  text color for even/over par. The brand green was reading as
                  "good news" in the wrong register — golfers scan for red.
                  minHeight reserves the slot before scoring starts. */}
              <div style={{ fontSize: 10, color: BC.t3, marginBottom: 3, lineHeight: 1.1, minHeight: 10 }}>
                {run.thru > 0 && (
                  <>Net <strong style={{ color: run.netVsPar < 0 ? BC.danger : run.netVsPar === 0 ? BC.t3 : BC.t1, fontWeight: 700 }}>
                    {fmtScore(run.netVsPar)}
                  </strong> thru {run.thru}</>
                )}
              </div>
              <ScoreButtonRow par={par} score={score} onScore={(v) => onSavePracticeScore(pid, activeHole, v)} />
            </div>
          </div>
        );
      })}

      {showScorecard && (() => {
        // The body of the scorecard is rendered by the shared helper —
        // we just provide the modal chrome (backdrop, header with team
        // labels, close button) here.
        const t1Idx = event.teams.findIndex(t => t.id === activeMatch.team1.id);
        const t2Idx = event.teams.findIndex(t => t.id === activeMatch.team2.id);
        const tcA = PRACTICE_TEAM_COLORS[t1Idx];
        const tcB = PRACTICE_TEAM_COLORS[t2Idx];
        const matchIdx = event.matches.findIndex(m => m.id === activeMatch.id);
        return (
          <Popup onClose={() => setShowScorecard(false)} maxWidth={440} padding={0} outerPadding={12} innerStyle={{ display: "flex", flexDirection: "column", fontFamily: "'Montserrat', sans-serif" }}>
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

                {/* Body — front 9 + back 9 sections via shared helper */}
                <div style={{ padding: 10 }}>
                  {renderMatchScorecardBody(activeMatch, strokeMaps)}
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
          </Popup>
        );
      })()}

      {/* Auto-advance toast — slides down from the top during the 1.8s
          wait between "all scores in" and the screen advance. Lives at
          the highest z-index so it sits above the hole nav, scorecard
          modal, and bottom nav. Mirrors MNQ's toast styling exactly so
          the two apps feel consistent for users who switch between. */}
      <Toast message={toast} />
    </div>
  );
}

function PracticeView({ user, tPlayers, courses, notify, teams }) {
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
        teeName: event.tee_box,
      }),
    }));
  }, [event, course, scoresMap, tPlayers]);

  const skins = useMemo(() => computePracticeSkins({
    scores: scoresMap,
    players: eventPlayers,
    course,
    hcpOverrides: event?.hcp_overrides || {},
    teeName: event?.tee_box,
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

  // ─────────────────────────────────────────────────────────────────────────
  // Shared scorecard helpers — used by both ScoringTab's modal and the
  // LeaderboardTab's expanded-match view. Defined at PracticeView scope so
  // both sub-tabs see them, and they close over event/course/tPlayers/
  // scoresMap from the surrounding render.
  // ─────────────────────────────────────────────────────────────────────────

  // Stroke allocation for the 4 players in a match. Mirrors the calculation
  // in computePracticeMatch so the dots/strokes shown on the scorecard
  // exactly match what the leaderboard math used.
  const getStrokeMapsForMatch = (match) => {
    const maps = {};
    if (!match || !course || !event) return maps;
    const allPids = [match.team1.player1, match.team1.player2, match.team2.player1, match.team2.player2].filter(Boolean);
    const holeHcps = resolveHoleHcps(course);
    const overrides = event.hcp_overrides || {};
    const getCH = (pid) => calcCHForCourse(
      getEffectiveHI(pid, tPlayers, overrides),
      course,
      event.tee_box
    );
    const allCHs = allPids.map(getCH);
    const minCH = allCHs.length ? Math.min(...allCHs) : 0;
    const adjCH = (pid) => event.hcp_mode === "full" ? getCH(pid) : (getCH(pid) - minCH);
    allPids.forEach(pid => { maps[pid] = buildStrokeMap(adjCH(pid), holeHcps); });
    return maps;
  };

  // Renders the full hole-by-hole scorecard JSX for a match — front 9 + back 9
  // stacked, with team-1 player rows / NET / MATCH row / team-2 player rows /
  // NET. The match row is always shown from T1's perspective so the layout
  // stays symmetric (T1 on top, T2 on bottom). Used both inline in the
  // leaderboard's expanded match view and inside the scoring modal.
  const renderMatchScorecardBody = (match, strokeMaps) => {
    if (!match || !course || !event) return null;
    const t1Pids = [match.team1.player1, match.team1.player2].filter(Boolean);
    const t2Pids = [match.team2.player1, match.team2.player2].filter(Boolean);
    const t1Idx = event.teams.findIndex(t => t.id === match.team1.id);
    const t2Idx = event.teams.findIndex(t => t.id === match.team2.id);
    const tcA = PRACTICE_TEAM_COLORS[t1Idx];
    const tcB = PRACTICE_TEAM_COLORS[t2Idx];
    const gridLine = `1px solid ${BC.bdr}25`;
    const holePars = resolveHolePars(course);
    const holeHcps = resolveHoleHcps(course);
    const getStrokes = (pid, h) => strokeMaps[pid]?.[h] || 0;

    // Per-hole running cumulative status from T1's perspective
    const t1Statuses = Array.from({ length: 18 }, (_, i) => {
      let cum = 0, hasData = false;
      for (let h = 0; h <= i; h++) {
        let n1 = 0, n2 = 0, ok1 = true, ok2 = true;
        t1Pids.forEach(pid => { const s = scoresMap[`${pid}_${h}`]; if (!s) ok1 = false; else n1 += s - getStrokes(pid, h); });
        t2Pids.forEach(pid => { const s = scoresMap[`${pid}_${h}`]; if (!s) ok2 = false; else n2 += s - getStrokes(pid, h); });
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
          <div style={{ display: "flex", borderBottom: gridLine, background: BC.amber + "18" }}>
            <div style={{ ...lblBase, height: 22 }}>PAR</div>
            {sectionPars.map((p, i) => (
              <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 11, color: BC.t2, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", height: 22, borderRight: i < 8 ? gridLine : "none" }}>{p}</div>
            ))}
            <div style={{ ...totBase, height: 22 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: BC.t3 }}>{sectionParTotal}</span>
            </div>
          </div>
          <div style={{ display: "flex", borderBottom: gridLine, background: BC.inp }}>
            <div style={{ ...lblBase, height: 20 }}>HCP</div>
            {sectionHcps.map((h, i) => (
              <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 10, color: BC.t3, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", height: 20, borderRight: i < 8 ? gridLine : "none" }}>{h}</div>
            ))}
            <div style={{ ...totBase, height: 20 }} />
          </div>
          {t1Pids.map(pid => renderPlayerRow(pid))}
          {renderTeamNetRow(t1Pids, true)}
          {renderMatchRow()}
          {t2Pids.map(pid => renderPlayerRow(pid))}
          {renderTeamNetRow(t2Pids, false)}
        </div>
      );
    };

    return (
      <>
        {renderSection(0)}
        {renderSection(9)}
      </>
    );
  };

  // ── Setup Sub-view ──
  const SetupTab = () => {
    const [selPlayers, setSelPlayers] = useState(event?.player_ids || []);
    const [selCourse, setSelCourse] = useState(event?.course_id || (courses[0]?.id || ""));
    // Tee selection — Mash practice events assume all 4 players in a match
    // play the same tee (consistent with how the team rounds back at home
    // course actually run). The selected tee's slope/rating/par are what
    // get fed into calcCHForCourse, which is what fixes the "CH always
    // equals HI" symptom on courses where the tee data lives only on
    // tee_boxes and not at the top level.
    const [selTee, setSelTee] = useState(event?.tee_box || "");
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
    const courseTees = courseObj?.tee_boxes || [];
    // When the user picks a different course (or this is a fresh setup),
    // pre-select a sensible default tee so the dropdown isn't blank. Pick
    // the first tee_box if no selection exists yet, OR if the previously-
    // selected tee name doesn't exist on the new course. Don't clobber a
    // valid existing selection on re-renders.
    useEffect(() => {
      if (!courseTees.length) { if (selTee !== "") setSelTee(""); return; }
      const stillValid = courseTees.some(t => t.name === selTee);
      if (!stillValid) setSelTee(courseTees[0].name || "");
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selCourse, courseTees.length]);

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
        tee_box: selTee || "",
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

          {/* Tee selector — appears once a course with tee_boxes is chosen.
              All four players in a practice match play the same tee (matches
              real-world team-round behavior), so this is a single event-level
              setting rather than per-player. The label includes slope and
              rating in parens so the director picking the tee can see at a
              glance that they're picking real numeric values, not arbitrary
              tee names. */}
          {courseTees.length > 0 && (
            <>
              <div style={{ fontSize: 10, color: BC.t3, marginBottom: 6, fontWeight: 700, letterSpacing: 1 }}>TEE BOX</div>
              <select value={selTee} onChange={e => setSelTee(e.target.value)} style={{
                width: "100%", padding: "8px 10px", background: BC.inp, border: `1px solid ${BC.bdr}`,
                borderRadius: 6, color: BC.t1, fontSize: 13, marginBottom: 10,
              }}>
                {courseTees.map(t => {
                  const slope = parseFloat(t.slope) || 113;
                  const rating = parseFloat(t.rating) || 72;
                  const par = parseFloat(t.par) || 72;
                  return (
                    <option key={t.name} value={t.name}>
                      {t.name} — slope {slope}, rating {rating}, par {par}
                    </option>
                  );
                })}
              </select>
            </>
          )}

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
              const teamColor = teams[p.team].accent;
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

        <ConfirmModal
          modal={showResetConfirm ? {
            title: "Reset Practice Event?",
            message: "This will delete the event, all scores, and all CTP entries. This can't be undone.",
            confirmLabel: "Reset",
            destructive: true,
            onConfirm: resetEvent,
            onCancel: () => setShowResetConfirm(false),
          } : null}
        />
      </div>
    );
  };


  // ── Leaderboard Sub-view ──
  const LeaderboardTab = () => {
    const [expandedMatch, setExpandedMatch] = useState(null);
    const holePars = resolveHolePars(course);

    // Stroke maps for each match — keyed by match.id. Each value is the same
    // shape as ScoringTab's strokeMaps (player_id → { hole: strokes }).
    // Memoized on event/course because the allocation is per-match (low-man
    // is computed within each match's 4 players, not across all 8).
    const allMatchStrokeMaps = useMemo(() => {
      const out = {};
      if (!event || !course) return out;
      event.matches.forEach(m => { out[m.id] = getStrokeMapsForMatch(m); });
      return out;
    }, [event, course]);

    if (!event || !course) {
      return <div style={{ textAlign: "center", padding: 40, color: BC.t3 }}>No event yet.</div>;
    }

    // Per-team running totals — for the team-totals card at the top. For each
    // team we walk the 18 holes contiguously from hole 1 and stop at the
    // first hole where either teammate's score is missing. The "to par"
    // figure is the SUM of each player's net-to-par contribution on each
    // completed hole, which is equivalent to (combined_net − 2 × par_total).
    const teamTotals = event.teams.map((team, idx) => {
      const teamPids = [team.player1, team.player2].filter(Boolean);
      // Look up which match this team is in, so we can use the right strokeMaps
      const matchOfTeam = event.matches.find(m => m.team1.id === team.id || m.team2.id === team.id);
      const sm = matchOfTeam ? (allMatchStrokeMaps[matchOfTeam.id] || {}) : {};
      let toPar = 0, thru = 0;
      for (let h = 0; h < 18; h++) {
        let allOk = true, holeContrib = 0;
        teamPids.forEach(pid => {
          const s = scoresMap[`${pid}_${h}`];
          if (!s) allOk = false;
          else {
            const strokes = sm[pid]?.[h] || 0;
            holeContrib += (s - strokes - holePars[h]);
          }
        });
        if (allOk) {
          toPar += holeContrib;
          thru = h + 1;
        } else { break; }
      }
      return { team, idx, teamPids, toPar, thru };
    });

    return (
      <div>
        {/* TEAMS — combined net to par + thru hole, one row per team.
            Header banner is filled with Mash brand green (BC.amber under
            the active palette) to anchor the leaderboard as a Mash team
            artifact. Title is centered and singular ("TEAMS" — the word
            "TOTALS" was redundant since the to-par column already
            communicates "this is summed up"). */}
        <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, marginBottom: 10, overflow: "hidden" }}>
          <Banner>TEAMS</Banner>
          {teamTotals.map(({ team, idx, teamPids, toPar, thru }, rowIdx) => {
            const tc = PRACTICE_TEAM_COLORS[idx];
            const teamPlayers = teamPids.map(pid => tPlayers.find(p => p.player_id === pid)).filter(Boolean);
            // PGA-leaderboard color convention: red ink for under par
            // (the "good news" color for a golfer scanning a board), and
            // muted neutral for at/over par. The previous `#22c55e`
            // green for under-par read as inverted on a green-themed
            // app — the under-par signal got confused with the brand
            // accent. Red is unambiguous regardless of theme.
            const parColor = thru === 0 ? BC.t3 : toPar < 0 ? BC.danger : toPar === 0 ? BC.t1 : BC.t2;
            return (
              <div key={team.id} style={{
                display: "flex", alignItems: "center", padding: "10px 14px",
                borderBottom: rowIdx < teamTotals.length - 1 ? `1px solid ${BC.bdr}40` : "none",
                gap: 10,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: BC.t1, lineHeight: 1.3 }}>
                    {teamPlayers.map(p => p.name).join(" / ")}
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: parColor, lineHeight: 1 }}>
                    {thru === 0 ? "—" : fmtScore(toPar)}
                  </div>
                  <div style={{ fontSize: 9, color: BC.t3, marginTop: 3 }}>Thru {thru}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Match cards — one per match, with full scorecard available on expand. */}
        {matchResults.map((mr) => {
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
          // Leading = ahead on holes-won count, regardless of whether the match
          // is final yet. Drives the triangle indicator (hollow during play,
          // filled when final). Tie = neither team leading, no triangle shown.
          const isT1Leading = r.thru > 0 && r.holesWon1 > r.holesWon2;
          const isT2Leading = r.thru > 0 && r.holesWon2 > r.holesWon1;
          // A match is "final" when it's been clinched (lead > remaining
          // holes — match ended early) or all 18 holes have been played.
          const isFinal = r.clinched || r.thru >= 18;

          // Triangle indicator — renders inline as SVG so we can do hollow
          // (in-progress) vs filled (final) cleanly. CSS border-triangles
          // can't go hollow without stacking tricks.
          const Triangle = ({ direction }) => (
            <svg width={11} height={14} viewBox="0 0 11 14" style={{ display: "block" }}>
              <polygon
                points={direction === "left" ? "1,7 10,1.5 10,12.5" : "10,7 1,1.5 1,12.5"}
                fill={isFinal ? "#22c55e" : "transparent"}
                stroke="#22c55e"
                strokeWidth={1.5}
                strokeLinejoin="round"
              />
            </svg>
          );

          return (
            <div key={m.id} style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, marginBottom: 10, overflow: "hidden" }}>
              <button onClick={() => setExpandedMatch(isExpanded ? null : m.id)} style={{
                width: "100%", padding: "12px 14px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left",
                position: "relative",
              }}>
                {/* Chevron — anchored to the top-right corner via absolute
                    positioning. Was previously sharing a row with the
                    "Thru N" label, but Thru moves down to under the
                    match-status pill so it's spatially associated with
                    score data instead of being a header element. The
                    chevron remains the obvious "this card expands" cue. */}
                <div style={{ position: "absolute", top: 8, right: 12, fontSize: 12, color: BC.t3 }}>
                  {isExpanded ? "▴" : "▾"}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 10 }}>
                  {/* Team 1 — full names with a vertical Mash-green stripe
                      on the LEFT edge to identify this team as the green
                      (top) row in the per-hole tracker below. Names use
                      solid BC.t1 (no opacity dimming) — the "who's
                      leading" signal is now carried entirely by the
                      green-triangle indicator and the matchResultText
                      pill, so dimming losing names was both visually
                      busy and redundant. The big holes-won number that
                      previously sat below each team is also gone since
                      the same info lives in the pill + tracker. */}
                  <div style={{
                    textAlign: "left",
                    borderLeft: `3px solid ${BC.amber}`,
                    paddingLeft: 8,
                  }}>
                    {t1Players.map(p => p && <div key={p.player_id} style={{ fontSize: 14, fontWeight: 600, color: BC.t1, lineHeight: 1.3 }}>{p.name}</div>)}
                  </div>
                  {/* Status column — vertical stack: matchResultText pill
                      on top, "Thru N" subtitle below it. Triangles flank
                      the pill (not the whole stack) so they sit at pill-
                      height, not in the dead space between pill and
                      subtitle. Hollow triangle during play, filled when
                      the match goes final (clinched or 18 holes done). */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                    <div style={{ position: "relative", textAlign: "center", padding: "4px 10px", background: BC.inp, borderRadius: 6, border: `1px solid ${BC.bdr}` }}>
                      {isT1Leading && (
                        <div style={{ position: "absolute", right: "100%", top: "50%", transform: "translateY(-50%)", marginRight: 6 }}>
                          <Triangle direction="left" />
                        </div>
                      )}
                      {isT2Leading && (
                        <div style={{ position: "absolute", left: "100%", top: "50%", transform: "translateY(-50%)", marginLeft: 6 }}>
                          <Triangle direction="right" />
                        </div>
                      )}
                      <div style={{ fontSize: 14, fontWeight: 800, color: BC.amber, letterSpacing: 0.5 }}>{r.matchResultText}</div>
                    </div>
                    <div style={{ fontSize: 9, color: BC.t3, fontWeight: 600 }}>Thru {r.thru}</div>
                  </div>
                  {/* Team 2 — full names with a vertical bourbon-brown
                      stripe on the RIGHT edge to identify this team as
                      the brown (bottom) row in the per-hole tracker
                      below. Mirror layout to T1 — stripe on the outside
                      edge of each name block produces a balanced visual
                      frame around the score column in the middle. */}
                  <div style={{
                    textAlign: "right",
                    borderRight: `3px solid ${BC.gold}`,
                    paddingRight: 8,
                  }}>
                    {t2Players.map(p => p && <div key={p.player_id} style={{ fontSize: 14, fontWeight: 600, color: BC.t1, lineHeight: 1.3 }}>{p.name}</div>)}
                  </div>
                </div>
                {/* Hole-by-hole tracker — two-row "battleship" layout.
                    Each row is one team's per-hole results: tile fills
                    with that team's signature color when they win, gray
                    when tied, faint outline when not yet played. Triple
                    redundancy in identifying which team is which:
                    (1) row position — top vs bottom,
                    (2) row color — Mash green vs bourbon brown
                        (deliberately chosen for high cross-channel
                        contrast; the previous tracker used two similar
                        green shades that bled together at a glance), and
                    (3) leading-edge initials label — last-name initials
                        of each player on that team.
                    The colors don't index on PRACTICE_TEAM_COLORS for
                    this widget — using BC.amber/BC.gold means every
                    match card uses the same green-vs-brown pairing, so
                    a glance at any tracker bar instantly maps to the
                    initials shown on the left, regardless of which two
                    teams are facing off. */}
                <div style={{ marginTop: 10, display: "flex", gap: 6, alignItems: "stretch" }}>
                  {/* Initials column — each player's last-name initial
                      gets ITS OWN sub-cell (instead of two letters
                      smushed into one block). Two sub-cells per row;
                      since both teams in a match always have two
                      players, the columns line up perfectly between
                      rows visually. So if T1 = "Jensen + Williams" and
                      T2 = "Jones + Clark", the user sees:
                          J  W
                          J  C
                      with the J's stacked over each other and the W
                      above C — easy to scan vertically as well as
                      horizontally. The fixed sub-cell width (12px)
                      keeps alignment consistent regardless of the
                      letter shapes. */}
                  <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 2, paddingTop: 13 }}>
                    <div style={{ display: "flex", gap: 1 }}>
                      {(t1Players.length ? t1Players : [null, null]).map((p, idx) => (
                        <div key={`t1-${idx}`} style={{ width: 12, fontSize: 9, color: BC.amber, fontWeight: 800, lineHeight: "10px", textAlign: "center" }}>
                          {p?.name?.trim().split(/\s+/).slice(-1)[0]?.[0]?.toUpperCase() || "?"}
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 1 }}>
                      {(t2Players.length ? t2Players : [null, null]).map((p, idx) => (
                        <div key={`t2-${idx}`} style={{ width: 12, fontSize: 9, color: BC.gold, fontWeight: 800, lineHeight: "10px", textAlign: "center" }}>
                          {p?.name?.trim().split(/\s+/).slice(-1)[0]?.[0]?.toUpperCase() || "?"}
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Tracker grid — hole numbers above, then T1 row, then T2 row. */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Hole numbers — ALL 18 shown so the user can pick
                        out any specific hole at a glance. Each number
                        sits centered above its corresponding bar cell
                        (matching `flex: 1` on each column means they
                        share the available width equally). Font is
                        sized small enough that even two-digit numbers
                        (10-18) fit cleanly within their cell width. */}
                    <div style={{ display: "flex", gap: 1, marginBottom: 2 }}>
                      {Array.from({ length: 18 }, (_, i) => (
                        <div key={i} style={{ flex: 1, fontSize: 7, color: BC.t3, textAlign: "center", fontWeight: 700, lineHeight: "10px" }}>
                          {i + 1}
                        </div>
                      ))}
                    </div>
                    {/* T1 row */}
                    <div style={{ display: "flex", gap: 1, marginBottom: 2 }}>
                      {r.holes.map((h, hi) => {
                        const won = h.result === 1;
                        const tied = h.result === 0;
                        const unscored = h.result == null;
                        // Tied holes render in a LIGHT version of this
                        // row's team color (BC.amber + "40" = ~25% alpha
                        // green for T1, BC.gold + "40" for T2). Each row
                        // continues to "speak its own language" so the
                        // tracker reads vertically per team — green-ish
                        // on top whenever T1 has any presence in a hole
                        // (full saturation = won, faded = tied), brown-
                        // ish on bottom for T2. The faded-tone treatment
                        // visually says "this team got something here,
                        // but didn't take it outright". Distinct from
                        // unscored cells (transparent with faint outline)
                        // and from "lost" cells (BC.inp neutral fill).
                        return <div key={hi} style={{
                          flex: 1, height: 10, borderRadius: 2,
                          background: won ? BC.amber : tied ? BC.amber + "40" : unscored ? "transparent" : BC.inp,
                          border: unscored ? `1px solid ${BC.bdr}80` : "none",
                          boxSizing: "border-box",
                        }} />;
                      })}
                    </div>
                    {/* T2 row */}
                    <div style={{ display: "flex", gap: 1 }}>
                      {r.holes.map((h, hi) => {
                        const won = h.result === -1;
                        const tied = h.result === 0;
                        const unscored = h.result == null;
                        return <div key={hi} style={{
                          flex: 1, height: 10, borderRadius: 2,
                          background: won ? BC.gold : tied ? BC.gold + "40" : unscored ? "transparent" : BC.inp,
                          border: unscored ? `1px solid ${BC.bdr}80` : "none",
                          boxSizing: "border-box",
                        }} />;
                      })}
                    </div>
                  </div>
                </div>
              </button>

              {/* Expanded view — full scorecard via the shared helper. Same
                  rendering as the scoring modal so anyone viewing the
                  leaderboard sees the exact same hole-by-hole detail. */}
              {isExpanded && (
                <div style={{ padding: 10, borderTop: `1px solid ${BC.bdr}`, background: BC.bg }}>
                  {renderMatchScorecardBody(m, allMatchStrokeMaps[m.id] || {})}
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
    // Skins display mode — toggles which skin type is rendered in the
    // hole grids. Showing both at the same time (the previous behavior)
    // forced the user to mentally separate two sets of highlights on a
    // single canvas; the gross-vs-net toggle keeps each view focused
    // on one signal at a time. The Totals card below the grids still
    // shows both columns since its tabular layout makes the gross/net
    // distinction obvious without crowding.
    const [skinsMode, setSkinsMode] = useState("gross"); // gross | net
    const holePars = resolveHolePars(course);
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
        {/* Toggles row — Skins/CTP on the left (primary section
            switcher), Gross/Net on the right (sub-control for the
            Skins grids). The Gross/Net toggle is ALWAYS rendered so
            the row layout doesn't shift when toggling between Skins
            and CTP — it just gets a disabled visual state when CTP
            is the active section, since gross/net only applies to
            skins. The disabled state uses opacity + pointer-events
            so taps fall through harmlessly. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <SegmentedToggle
            options={[["skins", "Skins"], ["ctp", "CTP"]]}
            value={tab} onChange={setTab} variant="flat" letterSpacing={0.5} style={{ flex: 1 }}
          />
          <div style={{
            display: "inline-flex", background: BC.inp, borderRadius: 10, padding: 2,
            border: `1px solid ${BC.bdr}`, flexShrink: 0,
            opacity: tab === "skins" ? 1 : 0.35,
            pointerEvents: tab === "skins" ? "auto" : "none",
            transition: "opacity .15s",
          }}>
            {[["gross", "Gross"], ["net", "Net"]].map(([k, label]) => (
              <button key={k} onClick={() => setSkinsMode(k)} style={{
                padding: "5px 10px", borderRadius: 8, fontSize: 10, fontWeight: 700, cursor: "pointer",
                background: skinsMode === k ? BC.amberDim : "transparent",
                color: skinsMode === k ? "#fff" : BC.t3, border: "none",
                letterSpacing: 0.4,
              }}>{label}</button>
            ))}
          </div>
        </div>

        {tab === "skins" && (
          <div>
            {/* Two-card layout — front 9 and back 9 stacked. Each card is
                a CSS grid of (2 + N) rows × 10 columns: HOLE / PAR header
                rows, then one row per event player. The 28px first column
                holds the player's two-letter initials (e.g., "AJ"); the
                remaining 9 columns are equal-width hole cells. Skin wins
                are encoded in cell appearance, not a separate column —
                the player-by-hole matrix reads top-to-bottom so the user
                can scan a single hole vertically (who won this hole?) or
                a single player horizontally (which holes did they take?). */}
            {[[0, "FRONT 9"], [9, "BACK 9"]].map(([startHole, title]) => {
              const holes = Array.from({ length: 9 }, (_, i) => startHole + i);
              return (
                <div key={title} style={{ background: BC.card, borderRadius: 10, padding: 8, marginBottom: 10, border: `1px solid ${BC.bdr}` }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: BC.amber, letterSpacing: 1.5, marginBottom: 6, padding: "2px 4px 4px" }}>
                    {title}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: `28px repeat(9, 1fr)`, gap: 2 }}>
                    {/* HOLE row — header strip with hole numbers, tinted to
                        sit visually above the data rows. */}
                    <div style={{ fontSize: 8, color: BC.t3, fontWeight: 800, padding: "5px 0", textAlign: "right", paddingRight: 4, letterSpacing: 0.5 }}>HOLE</div>
                    {holes.map(h => (
                      <div key={`hole-${h}`} style={{ fontSize: 11, fontWeight: 800, color: BC.t1, padding: "5px 0", textAlign: "center", background: BC.inp, borderRadius: 3 }}>
                        {h + 1}
                      </div>
                    ))}
                    {/* PAR row — secondary reference, lighter weight than HOLE. */}
                    <div style={{ fontSize: 8, color: BC.t3, fontWeight: 700, padding: "3px 0", textAlign: "right", paddingRight: 4, letterSpacing: 0.5 }}>PAR</div>
                    {holes.map(h => (
                      <div key={`par-${h}`} style={{ fontSize: 10, color: BC.t3, fontWeight: 600, padding: "3px 0", textAlign: "center" }}>
                        {holePars[h]}
                      </div>
                    ))}
                    {/* Player rows — one per event player, with two-letter
                        initials at the left edge. Each cell holds that
                        player's gross score for that hole, with a single
                        skin-state highlight: filled with Mash green if
                        this player won the active mode's skin on this
                        hole, plain otherwise. The toggle above selects
                        which mode (gross/net) drives the highlight. */}
                    {eventPlayers.flatMap((p) => {
                      const cells = [];
                      cells.push(
                        <div key={`init-${p.player_id}`} style={{
                          fontSize: 10, fontWeight: 800, color: BC.t1,
                          padding: "5px 0", textAlign: "right", paddingRight: 4,
                          alignSelf: "center", letterSpacing: 0.3,
                        }}>
                          {getInitials(p.name)}
                        </div>
                      );
                      holes.forEach(h => {
                        const score = scoresMap[`${p.player_id}_${h}`];
                        const strokes = skins.strokeMaps?.[p.player_id]?.[h] || 0;
                        const netScore = score ? score - strokes : null;
                        const skinWin = skins[skinsMode]?.[h] === p.player_id;
                        const cellBG = skinWin ? BC.amber : "transparent";
                        const cellColor = skinWin ? "#fff" : score ? BC.t1 : BC.t3;
                        const cellBorder = skinWin ? "1px solid transparent" : `1px solid ${BC.bdr}40`;
                        // Stroke-dot color follows the cell-state contrast:
                        // standard blue on neutral cells (matches the
                        // scorecard treatment used in ScoreCell elsewhere),
                        // white on green skin-winning cells so dots stay
                        // visible against the saturated fill.
                        const dotColor = skinWin ? "#fff" : BC.hcpBlue;
                        // Mode-specific layout — but cell DIMENSIONS are
                        // identical between modes. Both modes reserve
                        // the same minHeight and the same 8px dot row;
                        // in gross mode the dot row is rendered empty
                        // (transparent) so the layout doesn't shift
                        // between toggle states. This keeps the grid
                        // visually stable when the user flips between
                        // Gross and Net — same number of cells, same
                        // sizes, just the central number changes (and
                        // the dot row populates with strokes in net).
                        const isGross = skinsMode === "gross";
                        cells.push(
                          <div key={`${p.player_id}-${h}`} style={{
                            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                            padding: "4px 0",
                            background: cellBG, color: cellColor,
                            border: cellBorder, borderRadius: 3,
                            boxSizing: "border-box",
                            minHeight: 32,
                          }}>
                            <div style={{ height: 8, display: "flex", alignItems: "center", fontSize: 8, fontWeight: 900, letterSpacing: 1, lineHeight: 1, color: dotColor }}>
                              {!isGross && strokes > 0 ? "•".repeat(strokes) : ""}
                            </div>
                            <div style={{ fontSize: 12, fontWeight: skinWin ? 800 : 700, lineHeight: "14px" }}>
                              {isGross ? (score || "—") : (score ? netScore : "—")}
                            </div>
                          </div>
                        );
                      });
                      return cells;
                    })}
                  </div>
                </div>
              );
            })}

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
                          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(() => {
                            // First name + last initial — "Aaron Jensen" → "Aaron J".
                            // The previous rendering (split + slice(-1)[0]) returned
                            // the LAST WORD, which on full names produced "Jensen"
                            // and on single-token names produced the whole name —
                            // not what we want for a tight CTP picker. Single-name
                            // entries (e.g. "TJSC") render as-is since there's no
                            // first/last to split.
                            const nm = p?.name || pid;
                            const parts = nm.trim().split(/\s+/).filter(Boolean);
                            if (parts.length <= 1) return nm;
                            return `${parts[0]} ${parts[parts.length - 1][0]}`;
                          })()}</span>
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
      {/* Header — centered. The MASH ROUND mark functions as the
          tournament banner for this view. Reads from BC.amber (the
          primary brand accent, currently Mash green per the active
          palette) so it tunes automatically between light and dark
          modes — full brand green #009144 on white in light, brightened
          #16a34a for visibility on the dark green-tinted bg. */}
      <div style={{ marginBottom: 12, padding: "10px 14px", background: BC.card, borderRadius: 10, border: `1px solid ${BC.amber}33`, textAlign: "center" }}>
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
      {subView === "scoring" && (
        <PracticeScoringTab
          event={event}
          course={course}
          user={user}
          scoresMap={scoresMap}
          matchResults={matchResults}
          onSavePracticeScore={onSavePracticeScore}
          getStrokeMapsForMatch={getStrokeMapsForMatch}
          renderMatchScorecardBody={renderMatchScorecardBody}
          tPlayers={tPlayers}
        />
      )}
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
    // Practice tab — was the standalone "Mash" bottom-nav tab while
    // we were validating the new UI patterns. Now that the same
    // patterns drive the main Scoring/Leaderboard/Betting tabs against
    // tournament data, the standalone Mash event becomes a director-
    // only sandbox for off-tournament team rehearsals (single round,
    // single course, 8 guys). Hidden from regular players to keep
    // their menu uncluttered with an internal-tooling option.
    ...(user?.isDirector ? [{ key: "practice", label: "Practice Round", icon: "🥃" }] : []),
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
          bottom: `calc(62px + ${NAV_SAFE_PAD})`,
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
  // Restore the signed-in user from sessionStorage so a reload (pull-to-refresh
  // picking up a new bundle, or an edition switch) doesn't kick them to login.
  const [user, setUser] = useState(() => readUserSession());
  // Default landing view. Was "practice" while the standalone Mash tab
  // was the focus of validation; now that the Mash UI patterns power
  // the tournament tabs, Leaderboard is the right home base — the
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

  // The bottom nav. Measured by ViewportDebug (temporary, remove with the
  // debug block) and — permanently — by the effect below, which feeds the
  // scroll area's bottom clearance.
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
  useEffect(() => { popupOpenRef.current = menuOpen; }, [menuOpen]);

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
      rows.forEach(r => { cd[`${r.round}_${r.hole}`] = r.player_id; });
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
    scoring_type: r.scoring_type || "match",
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
  const enrichedMatches = useMemo(() => matches.map(m => {
    const tr = enrichedRounds.find(t => t.round_number === m.round);
    return {
      ...m,
      nassau: tr?.nassau || m.nassau || NASSAU_DEFAULT,
      scoring_type: tr?.scoring_type || m.scoring_type || "match",
    };
  }), [matches, enrichedRounds]);

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
  const onSetCtp = useCallback(async (round, hole, pid) => {
    const id = editionDocId(`bc_ctp_r${round}_h${hole+1}`);
    if (pid) await db.upsert("bc_ctp", { id, tournament_id: TOURNAMENT_ID, round, hole, player_id: pid });
    else await db.delete("bc_ctp", id);
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
  const tournamentRounds = useMemo(() => {
    const seen = new Set([
      ...tRounds.map(t => t.round_number),
      ...enrichedMatches.map(m => m.round),
    ]);
    return [...seen].filter(r => r != null).sort((a, b) => a - b);
  }, [tRounds, enrichedMatches]);
  // The one round open for score entry. null = nothing open (no schedule
  // yet, or the last round has been finalized).
  const currentRound = useMemo(
    () => currentRoundNumber(roundLocksData, tournamentRounds),
    [roundLocksData, tournamentRounds]
  );

  if (!user) return <LoginScreen players={tPlayers} teams={teams} darkMode={darkMode} tournamentName={tournamentName} tournamentLocation={tournamentLocation} onLogin={p => { const u = { ...p, isDirector: !!p.isDirector }; writeUserSession(u); setUser(u); }} />;

  // Bottom-nav items. The Practice tab (formerly "Mash") was relocated
  // to the More menu and is gated to directors only — practice rounds
  // are an internal team-rehearsal artifact, not a tournament feature.
  // The Mash UI patterns themselves (hole strip, status bar, auto-
  // advance toast, two-row tracker, skins grid) live on across the
  // Scoring / Leaderboard / Betting tabs which now use them on the
  // tournament's per-round / per-course / multi-format data model.
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
    if (icon === "mash") return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={clr} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="22" x2="5" y2="3"/><path d="M5 4 C 10 2, 14 6, 20 4 L 20 13 C 14 15, 10 11, 5 13 Z" fill={active ? BC.amber + "55" : BC.t3 + "33"}/></svg>;
    if (icon === "admin") return <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke={clr} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
    return null;
  };

  // App shell — position:fixed; inset:0. The fixed containing block is the
  // full webview, which is the ONE bottom-edge signal iOS reports honestly:
  // in an installed home-screen app window.visualViewport.height subtracts
  // env(safe-area-inset-top) (812 reported for a genuinely 874pt iPhone 16
  // Pro webview), so any JS-measured height leaves a black band exactly one
  // Dynamic Island tall under the nav. Don't reintroduce one. Safari also
  // re-pins fixed elements above its own toolbar for free.
  return (
    <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, left: 0, width: "100%", background: BC.bg, display: "flex", flexDirection: "column", fontFamily: "'Montserrat', sans-serif", overflow: "hidden", boxSizing: "border-box", paddingTop: "env(safe-area-inset-top, 0px)", paddingLeft: "env(safe-area-inset-left, 0px)", paddingRight: "env(safe-area-inset-right, 0px)" }}>
      <div style={{ maxWidth: 520, width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", flex: 1, minHeight: 0, position: "relative", padding: "0 4px" }}>
      <Notif notif={notif} />
      {VP_DEBUG && <ViewportDebug navRef={navRef} />}

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
            @keyframes bcPullGlow { 0%,100% { box-shadow: 0 0 8px ${BC.amber}40; } 50% { box-shadow: 0 0 18px ${BC.amber}80; } }
          `}</style>
          <div style={{
            width: 44, height: 44, borderRadius: "50%", background: BC.card,
            border: `2.5px solid ${pullY >= PULL_THRESHOLD ? BC.amber : BC.bdr}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: pullY >= PULL_THRESHOLD ? `0 0 12px ${BC.amber}50` : "0 2px 12px rgba(0,0,0,.3)",
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

      {/* Content */}
      <div className="bc-app-body" style={{
        flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden",
        // Bottom clearance for the FIXED nav bar. The nav is position:fixed
        // over the viewport bottom, so the scroll area must reserve room or
        // its last rows hide behind the bar with nothing left to scroll.
        // `navH` is the bar's MEASURED height (safe-area padding included) —
        // see the ResizeObserver above for why a constant isn't enough.
        padding: `12px 10px ${navH + 8}px 10px`,
        // Vertical centering for short views (affects EVERY tab). This was
        // previously `display:grid; align-content:safe center`, but Safari
        // doesn't support the `safe` overflow-alignment keyword — it drops
        // the whole declaration, grid falls back to top alignment, and the
        // dead gap comes back. Flexbox auto margins (on the inner wrapper
        // below) are universally supported and are inherently overflow-safe:
        // auto margins only consume FREE space, so when content is taller
        // than the viewport they resolve to 0 and nothing scrolls out of
        // reach — the exact behavior `safe center` was meant to provide.
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
        {/* Auto-margin wrapper — does the vertical centering. When the view
            is shorter than the body, the auto margins split the leftover
            space evenly (content sits centered, no dead gap dumped at the
            bottom). When the view is taller, auto margins compute to 0 and
            the content starts at the top and scrolls normally.

            Two views opt OUT of the centering because they pin something to
            the top of the scroll area: Admin (its tab bar) and Leaderboard
            (its header + cup total). A pinned element that starts halfway
            down the screen is the one thing that defeats pinning it — on a
            short board it would sit mid-screen, then jump to the top the
            moment the content grew past the fold. */}
        <div style={{ width: "100%", marginTop: TOP_ALIGNED_VIEWS.has(view) ? 0 : "auto", marginBottom: TOP_ALIGNED_VIEWS.has(view) ? 0 : "auto" }}>
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
            onFinalizeRound={onFinalizeRound}
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
          // skins-pot accumulator). The Practice Round view in More
          // menu still has its own fully-working betting grid for
          // internal team rounds. This placeholder uses Mash UI styling
          // (TEAMS-banner-style header, neutral "no data" body) so when
          // real betting data lands, the visual scaffold is already
          // consistent with the rest of the app.
          <div style={{ fontFamily: "'Montserrat', sans-serif" }}>
            {/* Skins/CTP toggle scaffold — disabled visual, identical
                shape to the working Practice Round version. Communicates
                "this section will have these two modes" without
                committing to data the user can't act on. */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, opacity: 0.5, pointerEvents: "none" }}>
              <SegmentedToggle
                options={[["skins", "Skins"], ["ctp", "CTP"]]}
                value="skins" variant="flat" letterSpacing={0.5} style={{ flex: 1 }}
              />
            </div>

            <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, overflow: "hidden" }}>
              <Banner>SKINS</Banner>
              <div style={{
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                padding: "60px 20px", textAlign: "center",
              }}>
                <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.4 }}>🥃</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: BC.t1, marginBottom: 6, letterSpacing: 0.3 }}>
                  No bets yet
                </div>
                <div style={{ fontSize: 12, color: BC.t3, maxWidth: 280, lineHeight: 1.5 }}>
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
        {view === "practice" && (
          <PracticeView
            user={user}
            tPlayers={tPlayers}
            courses={courses}
            notify={notify}
            teams={teams}
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

      <SlideMenu open={menuOpen} onClose={() => setMenuOpen(false)} onNavigate={setView} onLogout={() => { writeUserSession(null); setUser(null); }} user={user} view={view} darkMode={darkMode} onToggleTheme={toggleTheme} />
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
      <div ref={navRef} style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: BC.card, borderTop: `1px solid ${BC.bdr}`, zIndex: 100, paddingBottom: NAV_SAFE_PAD }}>
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
  );
}
