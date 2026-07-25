import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { BC, applyBCTheme, initialBCMode } from "./theme";
import { db, TOURNAMENT_ID, getTournamentYear } from "./firebase";
import {
  TROPHY_PHOTO, LOGO_TEAM_A, LOGO_TEAM_A_WHITE, LOGO_TEAM_B, TROPHY_SILHOUETTE,
  resolveTeams, DEFAULT_TEAM_NAMES, TOURNAMENT_TITLE, TOURNAMENT_LOCATION,
  FORMATS, NASSAU_DEFAULT, DEFAULT_FORMAT, PRACTICE_TEAM_COLORS, DIRECTOR_CODE,
} from "./constants";
import {
  calcCH, calcCHForCourse, fmtScore,
  getEffectiveHI, buildStrokeMap, resolveHolePars, resolveHoleHcps,
  computeMatchResult, computePracticeMatch, computePracticeSkins,
  getRoundCH, getRoundHI, getRoundTee, getRoundHandicapMode, lockForRound,
} from "./scoring";
import {
  ROUND_LOCKS_COL, buildRoundLockDoc, refreshRoundLockDoc,
  markRoundFinal, unfinalizeRound, clearRoundLockDoc,
  isRoundFinal, roundLockState, describeLock,
  describeHiChangeImpact, lockedPlayerEntry,
  LOCK_OPEN, LOCK_FINAL, LOCK_STATE_LABEL,
} from "./lib/roundLocks";
import { usePullToRefresh } from "./lib/usePullToRefresh";
import { processLogo } from "./lib/logoBrand";
import ErrorBoundary from "./components/ErrorBoundary";
import { Popup, ConfirmModal } from "./components/Popup";
import { SegmentedToggle, Banner, Toast } from "./components/ui";
import { useConfirm } from "./lib/useConfirm";
import { EditionSwitcher } from "./components/EditionSwitcher";
import { GhinLinkButton, GhinSyncButton } from "./components/GhinLink";

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
function LoginScreen({ players, onLogin, teams, darkMode, tournamentName }) {
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
        <div style={{ fontSize: "clamp(10px, 3vw, 12px)", color: BC.t3, letterSpacing: "0.3em", marginTop: 3 }}>{getTournamentYear()} {TOURNAMENT_LOCATION.toUpperCase()}</div>
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

// ── Team Scoreboard (main leaderboard) ──
// ── Team Leaderboard — Mash-style ──
// Rewritten using Mash UI patterns on top of the main app's per-round /
// per-match data model. Top of view: a TEAMS banner (Mash green fill,
// white text, centered) showing tournament-wide team totals (Nassau
// points). Below: matches grouped by round with a round selector. Each
// match card uses the Mash visual: vertical green/brown stripes flanking
// player names, score-status pill in the middle with the green leader
// triangle, and a two-row hole-by-hole tracker with diagonal-tied-hole
// splits. Tap a card to expand the full scorecard.
function TeamLeaderboard({ matches, holeData, courses, tRounds, tPlayers, rounds, teams, hcpOverrides, teeAssignments, roundLocks }) {
  const [expandedMatch, setExpandedMatch] = useState(null);
  const [activeRound, setActiveRound] = useState(null); // null = show all rounds

  const { A: tA, B: tB } = teams;

  // Pre-compute every match's result once so we can use it across the
  // tournament-totals banner, the per-round headers, and the per-match
  // cards without recomputing.
  const matchResults = useMemo(() => {
    return matches.map(m => {
      const fmt = tRounds.find(t => t.round_number === m.round)?.format || DEFAULT_FORMAT;
      const res = computeMatchResult(m, holeData, courses, tRounds, tPlayers, fmt, hcpOverrides, undefined, teeAssignments, roundLocks);
      return { match: m, result: res, format: fmt };
    });
  }, [matches, holeData, courses, tRounds, tPlayers, hcpOverrides, teeAssignments, roundLocks]);

  // Tournament totals — Nassau points summed across all matches and rounds.
  const tourneyTotals = useMemo(() => {
    const tot = { A: 0, B: 0 };
    matchResults.forEach(({ result }) => {
      tot.A += result.totalPts.A;
      tot.B += result.totalPts.B;
    });
    return tot;
  }, [matchResults]);

  const totalAvail = matches.reduce((s, m) => {
    const n = m.nassau || NASSAU_DEFAULT;
    return s + (n.front || 0) + (n.back || 0) + (n.overall || 0);
  }, 0);

  // Group matches by round
  const roundsWithMatches = [1, 2, 3, 4].filter(r => matches.some(m => m.round === r));
  const displayRounds = activeRound ? [activeRound] : roundsWithMatches;

  // Triangle indicator — used by per-match cards to point at the leading
  // team. Hollow during play, filled when the match is final.
  const Triangle = ({ direction, isFinal }) => (
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
    <div style={{ fontFamily: "'Montserrat', sans-serif" }}>
      {/* TEAMS banner — top-of-view summary card. Mash green header
          strip with centered white text; below it, one row per team
          with their Nassau total. The team that is currently leading
          gets the deeper text color; the team behind gets a muted
          variant. The numeric to-win is always available. */}
      <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, marginBottom: 10, overflow: "hidden" }}>
        <Banner>TEAMS</Banner>
        {[
          { team: tA, pts: tourneyTotals.A },
          { team: tB, pts: tourneyTotals.B },
        ].map(({ team, pts }, i) => {
          const leading = i === 0 ? tourneyTotals.A > tourneyTotals.B : tourneyTotals.B > tourneyTotals.A;
          const stripeColor = i === 0 ? BC.amber : BC.gold;
          return (
            <div key={team.id} style={{
              display: "flex", alignItems: "center", padding: "10px 14px",
              borderBottom: i === 0 ? `1px solid ${BC.bdr}40` : "none",
              borderLeft: `4px solid ${stripeColor}`,
              gap: 10,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: BC.t1 }}>{team.name}</div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: leading ? BC.t1 : BC.t2, lineHeight: 1 }}>{pts}</div>
                <div style={{ fontSize: 9, color: BC.t3, marginTop: 3 }}>of {totalAvail}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Round selector — pill toggle. "All" shows every round's
          matches; tap a specific round to filter. Active state uses
          deep Mash green + white per the design language. */}
      {roundsWithMatches.length > 1 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <button onClick={() => setActiveRound(null)} style={{
            flex: 1, padding: "8px 4px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
            background: activeRound === null ? BC.amberDim : BC.card,
            border: `1px solid ${activeRound === null ? BC.amberDim : BC.bdr}`,
            color: activeRound === null ? "#fff" : BC.t2,
          }}>All</button>
          {roundsWithMatches.map(r => {
            const active = r === activeRound;
            return (
              <button key={r} onClick={() => setActiveRound(r)} style={{
                flex: 1, padding: "8px 4px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
                background: active ? BC.amberDim : BC.card,
                border: `1px solid ${active ? BC.amberDim : BC.bdr}`,
                color: active ? "#fff" : BC.t2,
              }}>Rd {r}</button>
            );
          })}
        </div>
      )}

      {/* Per-round sections — each round shows its course/format header
          followed by the match cards for that round. */}
      {displayRounds.map(rnd => {
        const tr = tRounds.find(t => t.round_number === rnd);
        const course = courses.find(c => c.id === tr?.course_id);
        const fmt = FORMATS.find(f => f.id === tr?.format);
        const rndMatchResults = matchResults.filter(mr => mr.match.round === rnd);

        return (
          <div key={rnd} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px 6px" }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: BC.amber, letterSpacing: 1 }}>ROUND {rnd}</div>
                <div style={{ fontSize: 10, color: BC.t3 }}>{course?.name || "TBD"}{fmt ? ` · ${fmt.label}` : ""}</div>
              </div>
            </div>

            {rndMatchResults.length === 0 && (
              <div style={{ padding: 20, textAlign: "center", color: BC.t3, fontSize: 11, background: BC.card, borderRadius: 10, border: `1px solid ${BC.bdr}` }}>
                No matches set up for this round.
              </div>
            )}

            {rndMatchResults.map(({ match: m, result: r, format }) => {
              const t1Players = m.teamA.map(pid => tPlayers.find(p => p.player_id === pid));
              const t2Players = m.teamB.map(pid => tPlayers.find(p => p.player_id === pid));
              const isExpanded = expandedMatch === m.id;
              const aWins = r.holes.filter(h => h.winner === "A").length;
              const bWins = r.holes.filter(h => h.winner === "B").length;
              const isT1Leading = r.holesPlayed > 0 && aWins > bWins;
              const isT2Leading = r.holesPlayed > 0 && bWins > aWins;
              const isFinal = r.overall?.complete || r.holesPlayed >= 18;

              return (
                <div key={m.id} style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, marginBottom: 10, overflow: "hidden" }}>
                  <button onClick={() => setExpandedMatch(isExpanded ? null : m.id)} style={{
                    width: "100%", padding: "12px 14px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left", position: "relative",
                  }}>
                    <div style={{ position: "absolute", top: 8, right: 12, fontSize: 12, color: BC.t3 }}>
                      {isExpanded ? "▴" : "▾"}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 10 }}>
                      {/* Team A — Mash green stripe on LEFT edge */}
                      <div style={{ textAlign: "left", borderLeft: `3px solid ${BC.amber}`, paddingLeft: 8 }}>
                        {t1Players.map(p => p && <div key={p.player_id} style={{ fontSize: 14, fontWeight: 600, color: BC.t1, lineHeight: 1.3 }}>{p.name}</div>)}
                      </div>
                      {/* Status — pill with triangles flanking, "Thru N" below */}
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                        <div style={{ position: "relative", textAlign: "center", padding: "4px 10px", background: BC.inp, borderRadius: 6, border: `1px solid ${BC.bdr}` }}>
                          {isT1Leading && (
                            <div style={{ position: "absolute", right: "100%", top: "50%", transform: "translateY(-50%)", marginRight: 6 }}>
                              <Triangle direction="left" isFinal={isFinal} />
                            </div>
                          )}
                          {isT2Leading && (
                            <div style={{ position: "absolute", left: "100%", top: "50%", transform: "translateY(-50%)", marginLeft: 6 }}>
                              <Triangle direction="right" isFinal={isFinal} />
                            </div>
                          )}
                          <div style={{ fontSize: 14, fontWeight: 800, color: BC.amber, letterSpacing: 0.5 }}>{r.status || "AS"}</div>
                        </div>
                        <div style={{ fontSize: 9, color: BC.t3, fontWeight: 600 }}>Thru {r.holesPlayed}</div>
                      </div>
                      {/* Team B — bourbon brown stripe on RIGHT edge */}
                      <div style={{ textAlign: "right", borderRight: `3px solid ${BC.gold}`, paddingRight: 8 }}>
                        {t2Players.map(p => p && <div key={p.player_id} style={{ fontSize: 14, fontWeight: 600, color: BC.t1, lineHeight: 1.3 }}>{p.name}</div>)}
                      </div>
                    </div>

                    {/* Hole-by-hole tracker — two-row "battleship" layout
                        with per-letter initials column, hole numbers
                        across the top, and team-color rows below. Tied
                        holes render as a diagonal green/brown split on
                        BOTH rows. */}
                    <div style={{ marginTop: 10, display: "flex", gap: 6, alignItems: "stretch" }}>
                      <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 2, paddingTop: 13 }}>
                        <div style={{ display: "flex", gap: 1 }}>
                          {(t1Players.length ? t1Players : [null, null]).map((p, idx) => (
                            <div key={`a-${idx}`} style={{ width: 12, fontSize: 9, color: BC.amber, fontWeight: 800, lineHeight: "10px", textAlign: "center" }}>
                              {p?.name?.trim().split(/\s+/).slice(-1)[0]?.[0]?.toUpperCase() || "?"}
                            </div>
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: 1 }}>
                          {(t2Players.length ? t2Players : [null, null]).map((p, idx) => (
                            <div key={`b-${idx}`} style={{ width: 12, fontSize: 9, color: BC.gold, fontWeight: 800, lineHeight: "10px", textAlign: "center" }}>
                              {p?.name?.trim().split(/\s+/).slice(-1)[0]?.[0]?.toUpperCase() || "?"}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", gap: 1, marginBottom: 2 }}>
                          {Array.from({ length: 18 }, (_, i) => (
                            <div key={i} style={{ flex: 1, fontSize: 7, color: BC.t3, textAlign: "center", fontWeight: 700, lineHeight: "10px" }}>
                              {i + 1}
                            </div>
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: 1, marginBottom: 2 }}>
                          {r.holes.map((h, hi) => {
                            const won = h.winner === "A";
                            const tied = h.played && h.winner == null;
                            const unscored = !h.played;
                            const tiedGradient = `linear-gradient(135deg, ${BC.amber} 50%, ${BC.gold} 50%)`;
                            return <div key={hi} style={{
                              flex: 1, height: 10, borderRadius: 2,
                              background: won ? BC.amber : tied ? tiedGradient : unscored ? "transparent" : BC.inp,
                              border: unscored ? `1px solid ${BC.bdr}80` : "none",
                              boxSizing: "border-box",
                            }} />;
                          })}
                        </div>
                        <div style={{ display: "flex", gap: 1 }}>
                          {r.holes.map((h, hi) => {
                            const won = h.winner === "B";
                            const tied = h.played && h.winner == null;
                            const unscored = !h.played;
                            const tiedGradient = `linear-gradient(135deg, ${BC.amber} 50%, ${BC.gold} 50%)`;
                            return <div key={hi} style={{
                              flex: 1, height: 10, borderRadius: 2,
                              background: won ? BC.gold : tied ? tiedGradient : unscored ? "transparent" : BC.inp,
                              border: unscored ? `1px solid ${BC.bdr}80` : "none",
                              boxSizing: "border-box",
                            }} />;
                          })}
                        </div>
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div style={{ padding: 10, borderTop: `1px solid ${BC.bdr}`, background: BC.bg }}>
                      <MatchScorecard match={m} result={r} format={format} courses={courses} tRounds={tRounds} teams={teams} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {displayRounds.length === 0 && (
        // Empty state fills the remaining viewport height and centers its
        // message vertically, so an unstarted tournament doesn't leave a
        // large dead gap between the TEAMS card and the bottom nav. The
        // minHeight subtracts a rough allowance for the TEAMS card, the
        // body's top padding, and the fixed nav clearance.
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          minHeight: "calc(100svh - 250px)", textAlign: "center", padding: "0 24px", gap: 10,
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
      )}
    </div>
  );
}


// ── Match Scorecard ──
function MatchScorecard({ match, result, format, courses, tRounds, teams }) {
  const tA = teams.A, tB = teams.B;
  const tr = tRounds.find(t => t.round_number === match.round);
  const course = courses.find(c => c.id === tr?.course_id);
  const holePars = resolveHolePars(course);
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
            color: h.winner === "A" ? tA.accent : h.winner === "B" ? BC.t3 : BC.t2,
            background: h.winner === "A" ? tA.color + "33" : "transparent", borderRadius: 4, padding: "1px 0" }}>
            {h.aScore != null ? h.aScore : "·"}
          </div>
        ))}
        <div style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: tA.accent }}>
          {holes.slice(start, end).filter(h => h.winner === "A").length}
        </div>

        {/* Team B scores */}
        {holes.slice(start, end).map((h, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 10, fontWeight: 700,
            color: h.winner === "B" ? tB.accent : h.winner === "A" ? BC.t3 : BC.t2,
            background: h.winner === "B" ? tB.color + "33" : "transparent", borderRadius: 4, padding: "1px 0" }}>
            {h.bScore != null ? h.bScore : "·"}
          </div>
        ))}
        <div style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: tB.accent }}>
          {holes.slice(start, end).filter(h => h.winner === "B").length}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ padding: "0 14px 14px", borderTop: `1px solid ${BC.bdr}` }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 8, marginTop: 10, justifyContent: "space-between" }}>
        <span style={{ fontSize: 9, color: tA.accent, fontWeight: 700 }}>{match.teamANames?.join(" / ")}</span>
        <span style={{ fontSize: 9, color: BC.t3 }}>vs</span>
        <span style={{ fontSize: 9, color: tB.accent, fontWeight: 700 }}>{match.teamBNames?.join(" / ")}</span>
      </div>
      {renderSegment(0, 9, "FRONT NINE")}
      {renderSegment(9, 18, "BACK NINE")}
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
// matches the rest of the app. Round selector at the top supports the multi-
// round structure that the original Mash sub-app didn't have.
function ScoreEntry({ user, matches, holeData, onSaveHole, tPlayers, courses, tRounds, notify, teams, hcpOverrides, teeAssignments, roundLocks }) {
  const userPid = user.player_id;
  const myMatches = matches.filter(m => [...m.teamA, ...m.teamB].includes(userPid));

  // ── Hooks (always fire, in stable order) ──
  const [activeMatchId, setActiveMatchId] = useState(myMatches[0]?.id || null);
  const [activeHole, setActiveHole] = useState(0);
  const [editing, setEditing] = useState(false);
  const [showScorecard, setShowScorecard] = useState(false);
  const [toast, setToast] = useState(null);
  const initialJump = useRef(false);

  const match = activeMatchId ? matches.find(m => m.id === activeMatchId) : myMatches[0];
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
  useEffect(() => {
    if (!match) return;
    if (!holeComplete || activeHole >= 17 || editing || allComplete) return;
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
  useEffect(() => {
    initialJump.current = false;
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

  // No more hooks below this line.
  if (!match) return (
    <div style={{ textAlign: "center", padding: 40, color: BC.t3, fontFamily: "'Montserrat', sans-serif" }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>⛳</div>
      <div>You're not in any matches yet.</div>
    </div>
  );
  if (!course) return (
    <div style={{ textAlign: "center", padding: 40, color: BC.t3, fontFamily: "'Montserrat', sans-serif" }}>
      Round {match.round} course not configured yet.
    </div>
  );

  // Live edge — first hole where not everyone has scored. Used to detect
  // "editing past hole" navigation so auto-advance stays suppressed
  // while the user fixes a missed score.
  let liveEdge = 17;
  for (let h = 0; h < 18; h++) {
    if (!matchPids.every(pid => getScore(pid, h) > 0)) { liveEdge = h; break; }
  }
  const goToHole = (h) => { setActiveHole(h); setEditing(h < liveEdge); };

  const { A: tA, B: tB } = teams;

  const onTapScore = async (pid, score) => {
    const cur = getScore(pid, activeHole);
    const newScore = cur === score ? 0 : score; // Tapping the active button clears
    await onSaveHole(pid, match.round, activeHole, newScore || null, tr?.course_id);
  };

  // Status cell rendering — for the two-row match status bar between
  // the front and back hole strips. From the user's team perspective:
  // ▲N when their team is up, ▼N when down, "AS" tied, "X&Y" if clinched.
  const userTeam = match.teamA.includes(userPid) ? "A" : "B";
  const renderStatusCell = (i) => {
    const cellH = 22;
    const colBorder = { borderRight: i % 9 === 8 ? "none" : `1px solid ${BC.bdr}33` };
    if (!result || !result.holes[i]) {
      return <div key={i} style={{ flex: 1, height: cellH, ...colBorder }} />;
    }
    const hr = result.holes[i];
    const aWins = result.holes.slice(0, i + 1).filter(r => r.winner === "A").length;
    const bWins = result.holes.slice(0, i + 1).filter(r => r.winner === "B").length;
    const upTeam = aWins > bWins ? "A" : bWins > aWins ? "B" : null;
    const upN = Math.abs(aWins - bWins);
    const fromUserView = upTeam === userTeam ? upN : upTeam == null ? 0 : -upN;
    // Partial-score warning for non-active past holes
    if (!hr.played) {
      const someScored = matchPids.some(pid => getScore(pid, i) > 0);
      if (someScored && i !== activeHole) {
        return <div key={i} title="Missing score" style={{ flex: 1, textAlign: "center", fontSize: 13, lineHeight: `${cellH}px`, ...colBorder }}>⚠️</div>;
      }
      return <div key={i} style={{ flex: 1, height: cellH, ...colBorder }} />;
    }
    let label, color;
    if (fromUserView > 0) { label = `▲${fromUserView}`; color = BC.amber; }
    else if (fromUserView < 0) { label = `▼${Math.abs(fromUserView)}`; color = BC.danger; }
    else { label = "AS"; color = BC.t3; }
    return (
      <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 9, fontWeight: 800, color, lineHeight: `${cellH}px`, ...colBorder }}>
        {label}
      </div>
    );
  };

  // Score buttons — par-relative range. par-3: 1-7, par-4/5: 2-8.
  // Auto-shift if the saved score is outside the standard range.
  const baseBtns = par === 3 ? [1, 2, 3, 4, 5, 6, 7] : [2, 3, 4, 5, 6, 7, 8];

  return (
    <div style={{ fontFamily: "'Montserrat', sans-serif" }}>
      {/* Round selector — visible only when user is in matches across
          multiple rounds (typical mid-tournament scenario). Uses the
          deep-green active-tab styling consistent with the Mash visual
          language. */}
      {myMatches.length > 1 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {myMatches.map(m => {
            const active = m.id === match.id;
            return (
              <button key={m.id} onClick={() => { setActiveMatchId(m.id); setActiveHole(0); initialJump.current = false; }} style={{
                flex: 1, padding: "8px 4px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
                background: active ? BC.amberDim : BC.card,
                border: `1px solid ${active ? BC.amberDim : BC.bdr}`,
                color: active ? "#fff" : BC.t2,
              }}>Rd {m.round}</button>
            );
          })}
        </div>
      )}

      {/* Front 9 — hole strip. Three-state hierarchy: current (bright
          green + outline), completed all-scored (deep green + white
          text), partial (light tint), untouched (card bg). */}
      <div style={{ display: "flex", gap: 3, marginBottom: 2 }}>
        {Array.from({ length: 9 }, (_, i) => {
          const cur = i === activeHole;
          const allScored = matchPids.every(pid => getScore(pid, i) > 0);
          const partial = !allScored && matchPids.some(pid => getScore(pid, i) > 0);
          return (
            <button key={i} onClick={() => goToHole(i)} style={{
              flex: 1, height: 28, borderRadius: cur ? 8 : 6, border: "none",
              background: cur ? BC.amber : allScored ? BC.amberDim : partial ? BC.amber + "20" : BC.card,
              color: cur ? "#0a0804" : allScored ? "#fff" : BC.t3,
              fontSize: 13, fontWeight: 800, cursor: "pointer",
              outline: cur ? `2px solid ${BC.amber}` : "none", outlineOffset: 1,
            }}>{i + 1}</button>
          );
        })}
      </div>
      <div style={{ display: "flex", marginBottom: 6, background: BC.card, border: `1px solid ${BC.bdr}60`, borderRadius: 8, padding: "3px 0", alignItems: "center" }}>
        {Array.from({ length: 9 }, (_, i) => renderStatusCell(i))}
      </div>

      {/* Back 9 — hole strip + status row. */}
      <div style={{ display: "flex", gap: 3, marginBottom: 2 }}>
        {Array.from({ length: 9 }, (_, i) => {
          const h = i + 9;
          const cur = h === activeHole;
          const allScored = matchPids.every(pid => getScore(pid, h) > 0);
          const partial = !allScored && matchPids.some(pid => getScore(pid, h) > 0);
          return (
            <button key={h} onClick={() => goToHole(h)} style={{
              flex: 1, height: 28, borderRadius: cur ? 8 : 6, border: "none",
              background: cur ? BC.amber : allScored ? BC.amberDim : partial ? BC.amber + "20" : BC.card,
              color: cur ? "#0a0804" : allScored ? "#fff" : BC.t3,
              fontSize: 13, fontWeight: 800, cursor: "pointer",
              outline: cur ? `2px solid ${BC.amber}` : "none", outlineOffset: 1,
            }}>{h + 1}</button>
          );
        })}
      </div>
      <div style={{ display: "flex", marginBottom: 6, background: BC.card, border: `1px solid ${BC.bdr}60`, borderRadius: 8, padding: "3px 0", alignItems: "center" }}>
        {Array.from({ length: 9 }, (_, i) => renderStatusCell(i + 9))}
      </div>

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
        {(FORMATS.find(f => f.id === format)?.label || "MATCH PLAY").toUpperCase()} · ROUND {match.round}
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
          const hi = getRoundHI({ roundLocks, round: match.round, pid, players: tPlayers, hcpOverrides });
          const playerTee = getRoundTee({ roundLocks, round: match.round, pid, teeAssignments, roundTee });
          const ch = getRoundCH({
            roundLocks, round: match.round, pid, players: tPlayers,
            course, hcpOverrides, teeAssignments, roundTee,
          });
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

          // Score-button range — auto-shift if saved score is out of base range.
          const maxBtn = baseBtns[baseBtns.length - 1];
          const minBtn = baseBtns[0];
          let btns = baseBtns;
          if (cur > maxBtn) {
            const shift = cur - maxBtn;
            btns = baseBtns.map(b => b + shift);
          } else if (cur > 0 && cur < minBtn) {
            const shift = minBtn - cur;
            btns = baseBtns.map(b => Math.max(1, b - shift));
          }

          return (
            <div key={pid} style={{
              background: BC.card, borderRadius: 10, marginBottom: 4, padding: "6px 10px",
              border: `1px solid ${BC.bdr}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: BC.t1, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flexShrink: 1 }}>{tp?.name || pid}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: BC.hcpBlue, flexShrink: 0 }}>({ch})</span>
                {strokes > 0 && (
                  <span style={{ color: BC.hcpBlue, fontSize: 12, letterSpacing: 1, flexShrink: 0, lineHeight: 1 }}>
                    {"●".repeat(strokes)}
                  </span>
                )}
                <div style={{ flex: 1 }} />
                {thru > 0 && (
                  <span style={{ fontSize: 10, color: BC.t3, flexShrink: 0, whiteSpace: "nowrap" }}>
                    Net: <strong style={{ color: netToPar < 0 ? BC.danger : netToPar === 0 ? BC.t3 : BC.t1 }}>
                      {fmtScore(netToPar)}
                    </strong> thru {thru}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 3 }}>
                {btns.map(btn => {
                  const isCur = btn === cur;
                  const sd = btn - par;
                  const boxSize = 32;
                  return (
                    <button key={btn} onClick={() => onTapScore(pid, btn)} style={{
                      flex: 1, height: 38, borderRadius: 8, cursor: "pointer", fontSize: 15, fontWeight: 800, border: "none",
                      background: isCur ? BC.amber : BC.inp, color: isCur ? "#0a0804" : BC.t2,
                      position: "relative",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {/* Score-shape overlays — circle for birdie, nested
                          circle for eagle, square for bogey, nested square
                          for double-bogey+. Mirrors ScoreCell's iconography. */}
                      {sd === -1 && <div style={{ position: "absolute", inset: 3, border: `1.5px solid ${isCur ? "#0a0804" : BC.t2}`, borderRadius: "50%", pointerEvents: "none" }} />}
                      {sd <= -2 && <>
                        <div style={{ position: "absolute", inset: 3, border: `1.5px solid ${isCur ? "#0a0804" : BC.t2}`, borderRadius: "50%", pointerEvents: "none" }} />
                        <div style={{ position: "absolute", inset: 6, border: `1.5px solid ${isCur ? "#0a0804" : BC.t2}`, borderRadius: "50%", pointerEvents: "none" }} />
                      </>}
                      {sd === 1 && <div style={{ position: "absolute", inset: 4, border: `1.5px solid ${isCur ? "#0a0804" : BC.t2}`, pointerEvents: "none" }} />}
                      {sd >= 2 && <>
                        <div style={{ position: "absolute", inset: 4, border: `1.5px solid ${isCur ? "#0a0804" : BC.t2}`, pointerEvents: "none" }} />
                        <div style={{ position: "absolute", inset: 7, border: `1.5px solid ${isCur ? "#0a0804" : BC.t2}`, pointerEvents: "none" }} />
                      </>}
                      <span style={{ position: "relative", zIndex: 1 }}>{btn}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Full Scorecard button — opens a modal showing both teams x 18 holes. */}
      <button onClick={() => setShowScorecard(true)} style={{
        width: "100%", marginTop: 8, padding: "10px 0", background: BC.card, border: `1px solid ${BC.bdr}`,
        borderRadius: 10, color: BC.t2, fontSize: 12, fontWeight: 700, cursor: "pointer", letterSpacing: 0.5,
      }}>
        Full Scorecard
      </button>

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
            <MatchScorecard match={match} result={result} format={format} courses={courses} tRounds={tRounds} teams={teams} />
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

      {/* Auto-advance toast — slides down from the top during the 1.8s
          wait between "all scores in" and the screen advance. Mirrors
          the Mash toast styling for cross-app visual consistency. */}
      <Toast message={toast} />
    </div>
  );
}


// ── Groups View ──
function GroupsView({ matches, tRounds, tPlayers, courses }) {
  const rounds = [...new Set(matches.map(m => m.round))].sort();
  const [activeRound, setActiveRound] = useState(rounds[0] || 1);
  const rndMatches = matches.filter(m => m.round === activeRound);
  const tr = tRounds.find(t => t.round_number === activeRound);
  const course = courses.find(c => c.id === tr?.course_id);
  const fmt = FORMATS.find(f => f.id === tr?.format);

  return (
    <div style={{ fontFamily: "'Montserrat', sans-serif" }}>
      {/* Round selector — pill toggle, deep Mash green for active state.
          Mirrors the Mash visual language used on Scoring + Leaderboard. */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {rounds.map(r => {
          const active = r === activeRound;
          return (
            <button key={r} onClick={() => setActiveRound(r)} style={{
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
          {tr?.tee_time && <div style={{ fontSize: 11, color: BC.amber, marginTop: 4, fontWeight: 700 }}>First Tee: {tr.tee_time}</div>}
        </div>
      </div>

      {rndMatches.length === 0 && <div style={{ textAlign: "center", color: BC.t3, padding: 32, fontSize: 12 }}>No matches scheduled.</div>}

      {/* Match cards — same visual identity as the Leaderboard cards
          (vertical green/brown stripes flanking each team) so the
          "this is a Match X" element is recognizable across tabs. */}
      {rndMatches.map((m, i) => (
        <div key={m.id} style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, padding: "12px 14px", marginBottom: 8 }}>
          <div style={{ fontSize: 9, color: BC.t3, marginBottom: 8, fontWeight: 800, letterSpacing: 1 }}>MATCH {i + 1}{m.teeTime ? `  ·  ${m.teeTime}` : ""}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 10 }}>
            {/* Team A — Mash green stripe LEFT */}
            <div style={{ textAlign: "left", borderLeft: `3px solid ${BC.amber}`, paddingLeft: 8 }}>
              {m.teamA.map(pid => {
                const tp = tPlayers.find(t => t.player_id === pid);
                return <div key={pid} style={{ fontSize: 13, fontWeight: 600, color: BC.t1, lineHeight: 1.3 }}>{tp?.name || pid}</div>;
              })}
            </div>
            {/* vs */}
            <div style={{ fontSize: 11, color: BC.t3, fontWeight: 700, padding: "0 4px" }}>vs</div>
            {/* Team B — bourbon brown stripe RIGHT */}
            <div style={{ textAlign: "right", borderRight: `3px solid ${BC.gold}`, paddingRight: 8 }}>
              {m.teamB.map(pid => {
                const tp = tPlayers.find(t => t.player_id === pid);
                return <div key={pid} style={{ fontSize: 13, fontWeight: 600, color: BC.t1, lineHeight: 1.3 }}>{tp?.name || pid}</div>;
              })}
            </div>
          </div>
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

function AdminView({ user, tPlayers, tRounds, courses, matches, onAddPlayer, onUpdatePlayer, onRemovePlayer, onAddCourse, onSetRound, onSetMatch, teams, teamNames, onSaveTeamNames, brand, onSaveBranding, tournamentName, onSaveTournamentName, hcpOverridesFromDb, teeAssignmentsFromDb, notify, roundLocks, onLockRound, onFinalizeRound, onClearRoundLock }) {
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
  useEffect(() => { setEditTournamentName(tournamentName || ""); }, [tournamentName]);
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
  const [newPlayerFirst, setNewPlayerFirst] = useState("");
  const [newPlayerLast, setNewPlayerLast] = useState("");

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
  const [teeAssignments, setTeeAssignments] = useState({}); // { round: { pid: teeName } }
  // ── Handicap-lock UI state ──
  const [showLockDetail, setShowLockDetail] = useState(false);
  const [unlockText, setUnlockText] = useState("");   // typed confirmation for un-finalizing
  const lockState = roundLockState(roundLocks, editRound);
  const roundIsLocked = lockState !== LOCK_OPEN;
  const roundIsFinal = lockState === LOCK_FINAL;
  const activeLock = roundLocks?.[editRound]?.locked ? roundLocks[editRound] : null;

  const showChDelta = (key, delta) => {
    if (!delta) return;
    setChDeltas(prev => ({ ...prev, [key]: delta }));
    setTimeout(() => setChDeltas(prev => { const n = {...prev}; delete n[key]; return n; }), 3500);
  };
  // Hydrate from Firestore once the parent's subscriptions resolve. Without
  // these effects, the local state starts empty and a director opening the
  // Admin tab would see "no overrides set" / "no tees assigned" for rounds
  // that actually have data — and any save would overwrite the real values
  // with the empty form state. Stringify-deps is a structural-equality
  // shortcut: cheap because these maps stay small.
  useEffect(() => { if (hcpOverridesFromDb) setHcpOverrides(hcpOverridesFromDb); }, [JSON.stringify(hcpOverridesFromDb)]);
  useEffect(() => { if (teeAssignmentsFromDb) setTeeAssignments(teeAssignmentsFromDb); }, [JSON.stringify(teeAssignmentsFromDb)]);
  const [nassau, setNassau] = useState(NASSAU_DEFAULT);

  // Match builder
  const [matchRound, setMatchRound] = useState(1);
  const [matchTeamA, setMatchTeamA] = useState([]);
  const [matchTeamB, setMatchTeamB] = useState([]);
  const [showEditions, setShowEditions] = useState(false);

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
    // A final round is closed. Its overrides, tees and handicap mode are
    // already frozen in the snapshot, so writing them back would only
    // create a confusing mismatch between what the form shows and what the
    // round actually scored with. Refuse rather than pretend.
    if (isRoundFinal(roundLocks, editRound)) {
      notify(`Round ${editRound} is final — unlock it first`, "error");
      return;
    }
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
      format: roundFormat || tr.format || DEFAULT_FORMAT,
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
      <EditionSwitcher open={showEditions} onClose={() => setShowEditions(false)} />
      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, background: BC.card, borderRadius: 12, padding: 4, border: `1px solid ${BC.bdr}` }}>
        {[["players","Players"],["rounds","Rounds"],["matches","Matches"],["courses","Courses"],["tournament","Tournament"]].map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            flex: 1, padding: "8px 4px", borderRadius: 8, fontSize: 10, fontWeight: 700, cursor: "pointer", border: "none",
            background: tab === k ? `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})` : "transparent",
            color: tab === k ? "#0a0804" : BC.t3,
          }}>{lbl}</button>
        ))}
      </div>

      {tab === "players" && (
        <div>
          <div style={{ marginBottom: 12, display: "flex", justifyContent: "flex-end" }}>
            <GhinSyncButton players={tPlayers} onUpdatePlayer={onUpdatePlayer} notify={notify} />
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
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                    <input
                      autoFocus
                      value={newPlayerFirst}
                      onChange={e => setNewPlayerFirst(e.target.value)}
                      placeholder="First name"
                      style={{ flex: 1, minWidth: 0, boxSizing: "border-box", padding: "9px 10px", background: "#1e1c18", border: `1px solid ${team.accent}55`, borderRadius: 8, color: "#ffffff", fontSize: 16, outline: "none", fontFamily: "'Montserrat', sans-serif" }}
                    />
                    <input
                      value={newPlayerLast}
                      onChange={e => setNewPlayerLast(e.target.value)}
                      placeholder="Last name"
                      style={{ flex: 1, minWidth: 0, boxSizing: "border-box", padding: "9px 10px", background: "#1e1c18", border: `1px solid ${team.accent}55`, borderRadius: 8, color: "#ffffff", fontSize: 16, outline: "none", fontFamily: "'Montserrat', sans-serif" }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      value={newPlayerHI}
                      onChange={e => setNewPlayerHI(e.target.value)}
                      placeholder="HI"
                      type="number"
                      inputMode="decimal"
                      style={{ width: 76, flexShrink: 0, boxSizing: "border-box", padding: "9px 8px", background: "#1e1c18", border: `1px solid ${team.accent}55`, borderRadius: 8, color: "#ffffff", fontSize: 16, outline: "none", fontFamily: "'Montserrat', sans-serif" }}
                    />
                    <span style={{ flex: 1 }} />
                    <button onClick={async () => {
                      const first = newPlayerFirst.trim(), last = newPlayerLast.trim();
                      if (!first) { notify("Enter a first name", "error"); return; }
                      const pid = `bc_player_${Date.now()}`;
                      await onAddPlayer({ id: pid, player_id: pid, tournament_id: TOURNAMENT_ID, name: toDisplayName(first, last), first_name: first, last_name: last, team: team.id, handicap_index: parseFloat(newPlayerHI) || 0 });
                      setNewPlayerFirst(""); setNewPlayerLast(""); setNewPlayerHI(""); setNewPlayerTeam(null);
                      notify(`Added!`, "success");
                    }} style={{ padding: "9px 16px", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer", background: team.color, border: `1px solid ${team.accent}`, color: team.accent, flexShrink: 0 }}>Add</button>
                    <button onClick={() => { setNewPlayerTeam(null); setNewPlayerFirst(""); setNewPlayerLast(""); setNewPlayerHI(""); }} style={{
                      padding: "9px 12px", borderRadius: 8, border: `1px solid ${BC.bdr}`, background: "transparent", color: BC.t3, fontSize: 12, cursor: "pointer", flexShrink: 0,
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
                      onTouchStart={e => { if (isEditing) return; swipeStartX.current = e.touches[0].clientX; setSwipePid(p.player_id); setSwipeX(0); }}
                      onTouchMove={e => { if (isEditing || swipeStartX.current == null) return; const dx2 = e.touches[0].clientX - swipeStartX.current; setSwipeX(Math.min(0, dx2)); }}
                      onTouchEnd={async () => { if (isEditing) return; const shouldAsk = swipeX < -80; setSwipePid(null); setSwipeX(0); swipeStartX.current = null; if (shouldAsk && await confirm(`Remove ${fullName(p)}?`)) onRemovePlayer(p.player_id); }}
                      style={{ background: BC.card, borderRadius: 6, padding: isEditing ? "8px" : "4px 8px", border: `1px solid ${BC.bdr}`, display: "flex", flexDirection: isEditing ? "column" : "row", alignItems: isEditing ? "stretch" : "center", gap: 6, boxShadow: `inset 3px 0 0 ${team.accent}55`, position: "relative", transform: `translateX(${dx}px)`, transition: isSwiping ? "none" : "transform 0.2s ease" }}>
                      {isEditing ? (
                        <>
                          <input autoFocus placeholder="First name" value={editingPlayer.first} onChange={e => setEditingPlayer(prev => ({...prev, first: e.target.value}))}
                            style={{ fontSize: 16, fontWeight: 600, color: BC.t1, width: "100%", boxSizing: "border-box", background: BC.inp, border: `1px solid ${team.accent}66`, borderRadius: 6, padding: "8px 10px", outline: "none", fontFamily: "'Montserrat', sans-serif" }} />
                          <input placeholder="Last name" value={editingPlayer.last} onChange={e => setEditingPlayer(prev => ({...prev, last: e.target.value}))}
                            style={{ fontSize: 16, fontWeight: 600, color: BC.t1, width: "100%", boxSizing: "border-box", background: BC.inp, border: `1px solid ${team.accent}66`, borderRadius: 6, padding: "8px 10px", outline: "none", fontFamily: "'Montserrat', sans-serif" }} />
                          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                            <input type="number" inputMode="decimal" placeholder="HI" value={editingPlayer.hi} onChange={e => setEditingPlayer(prev => ({...prev, hi: e.target.value}))}
                              style={{ fontSize: 16, color: BC.t1, width: 76, flexShrink: 0, boxSizing: "border-box", background: BC.inp, border: `1px solid ${team.accent}66`, borderRadius: 6, padding: "8px 8px", outline: "none", fontFamily: "'Montserrat', sans-serif" }} />
                            <span style={{ flex: 1 }} />
                            <button onClick={async () => {
                              const first = (editingPlayer.first || "").trim(), last = (editingPlayer.last || "").trim();
                              if (!first) { notify("Enter a first name", "error"); return; }
                              const newName = toDisplayName(first, last);
                              const changes = [];
                              if (newName !== p.name || first !== (p.first_name||"") || last !== (p.last_name||"")) changes.push(`Name → "${fullName({ first_name: first, last_name: last })}" (shows as "${newName}")`);
                              const hiChanged = parseFloat(editingPlayer.hi) !== parseFloat(p.handicap_index);
                              if (hiChanged) changes.push(`HI: ${p.handicap_index} → ${editingPlayer.hi}`);
                              if (changes.length === 0) { setEditingPlayer(null); return; }
                              // Spell out the blast radius. A handicap edit mid-event
                              // is safe by construction — locked rounds ignore it —
                              // but the director should see that stated, not assume it.
                              const impact = hiChanged
                                ? "\n\n" + describeHiChangeImpact(roundLocks, [1, 2, 3, 4]).text
                                : "";
                              if (await confirm({ title: "Confirm changes", message: changes.join("\n") + impact })) {
                                onUpdatePlayer({ ...p, name: newName, first_name: first, last_name: last, handicap_index: parseFloat(editingPlayer.hi) || 0 });
                              }
                              setEditingPlayer(null);
                            }} style={{ fontSize: 12, padding: "8px 16px", borderRadius: 6, border: "none", background: team.accent, color: "#0a0804", fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>Save</button>
                            <button onClick={() => setEditingPlayer(null)} style={{ fontSize: 12, padding: "8px 12px", borderRadius: 6, border: `1px solid ${BC.bdr}`, background: "transparent", color: BC.t3, cursor: "pointer", flexShrink: 0 }}>✕</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <span style={{ fontSize: 12, fontWeight: 600, color: team.accent + "88", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fullName(p)}</span>
                          <span style={{ fontSize: 11, fontWeight: 400, color: BC.t1, width: 36, flexShrink: 0, textAlign: "right" }}>{p.handicap_index}</span>
                          <button onClick={() => setEditingPlayer({ pid: p.player_id, first: p.first_name || (p.last_name ? "" : (p.name || "")), last: p.last_name || "", hi: String(p.handicap_index) })} style={{
                            fontSize: 9, padding: "1px 5px", borderRadius: 4, border: `1px solid ${BC.bdr}`, background: "transparent", color: BC.t3, cursor: "pointer", flexShrink: 0,
                          }}>Edit</button>
                          <button onClick={() => onUpdatePlayer({ ...p, isDirector: !p.isDirector })} style={{
                            fontSize: 7, padding: "1px 3px", borderRadius: 3, border: `1px solid ${p.isDirector ? BC.amber : BC.bdr}`,
                            background: p.isDirector ? BC.amber + "22" : "transparent", color: p.isDirector ? BC.amber : BC.t3, cursor: "pointer", fontWeight: 700, flexShrink: 0,
                          }}>DIR</button>
                          <GhinLinkButton player={p} user={user} onUpdatePlayer={onUpdatePlayer} notify={notify} />
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
                  setRoundFormat(tr.format || DEFAULT_FORMAT);
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

            {/* ── Handicap lock ──────────────────────────────────────────
                The control surface for src/lib/roundLocks.js. A locked round
                has frozen every input to stroke allocation — handicap index,
                per-round override, tee, low_man/full, course and hole tables.
                Editing a player's handicap after this point changes future
                rounds only. */}
            <div style={{
              marginBottom: 12, borderRadius: 10, overflow: "hidden",
              background: BC.bg,
              border: `1px solid ${roundIsFinal ? BC.danger + "66" : roundIsLocked ? BC.amber + "66" : BC.bdr}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: BC.gold, letterSpacing: 0.5 }}>HANDICAP LOCK</div>
                <span style={{
                  fontSize: 8, fontWeight: 800, letterSpacing: 1, padding: "2px 7px", borderRadius: 10,
                  background: roundIsFinal ? BC.danger : roundIsLocked ? BC.amber : "transparent",
                  color: roundIsLocked ? "#0a0804" : BC.t3,
                  border: roundIsLocked ? "none" : `1px solid ${BC.bdr}`,
                }}>{LOCK_STATE_LABEL[lockState]}</span>
                <span style={{ flex: 1 }} />
                {activeLock && (
                  <button onClick={() => setShowLockDetail(v => !v)} style={{
                    fontSize: 9, padding: "2px 7px", borderRadius: 5, border: `1px solid ${BC.bdr}`,
                    background: "transparent", color: BC.t3, cursor: "pointer",
                  }}>{showLockDetail ? "Hide" : "Frozen values"}</button>
                )}
              </div>

              <div style={{ padding: "0 10px 10px" }}>
                <div style={{ fontSize: 10, color: BC.t3, lineHeight: 1.55, marginBottom: 8 }}>
                  {!roundIsLocked &&
                    `Round ${editRound} is scoring off live handicaps. It locks by itself the moment the first score is entered, so nothing here needs remembering.`}
                  {roundIsLocked && !roundIsFinal &&
                    `${describeLock(activeLock)}. Handicap edits made from now on will not touch this round.`}
                  {roundIsFinal &&
                    `${describeLock(activeLock)}. This round is closed — nothing recalculates it.`}
                </div>

                {/* OPEN → offer a deliberate pre-lock */}
                {!roundIsLocked && (
                  <button onClick={async () => {
                    if (!(await confirm({
                      title: `Lock handicaps for Round ${editRound}?`,
                      message: `Every player's index, override, tee and the low-man setting will be frozen for this round. ` +
                        `Later handicap changes will apply to other rounds only.`,
                      confirmLabel: "Lock",
                    }))) return;
                    await onLockRound(editRound);
                    notify(`Round ${editRound} handicaps locked`, "success");
                  }} style={{ ...BtnStyle, padding: "7px 14px", fontSize: 11 }}>Lock handicaps now</button>
                )}

                {/* LOCKED, not final → refresh / finalize / release */}
                {roundIsLocked && !roundIsFinal && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button onClick={async () => {
                      if (!(await confirm({
                        title: `Re-take the Round ${editRound} snapshot?`,
                        message: `This is the ONLY thing that changes a locked round's handicaps. ` +
                          `Every player's strokes for Round ${editRound} will be recalculated from current values. ` +
                          `Only do this if the round has not really been played yet.`,
                        confirmLabel: "Refresh",
                      }))) return;
                      await onLockRound(editRound, { refresh: true });
                      notify(`Round ${editRound} snapshot refreshed`, "success");
                    }} style={{
                      padding: "6px 12px", borderRadius: 8, border: `1px solid ${BC.amber}`, background: "transparent",
                      color: BC.amber, fontSize: 10, fontWeight: 700, cursor: "pointer",
                    }}>Refresh snapshot</button>

                    <button onClick={async () => {
                      if (!(await confirm({
                        title: `Mark Round ${editRound} final?`,
                        message: `Its handicaps can no longer be refreshed. Scores stay editable.`,
                        confirmLabel: "Mark final",
                      }))) return;
                      await onFinalizeRound(editRound, true);
                      notify(`Round ${editRound} marked final`, "success");
                    }} style={{ ...BtnStyle, padding: "6px 12px", fontSize: 10 }}>Mark round final</button>

                    <button onClick={async () => {
                      if (!(await confirm({
                        title: `Release the Round ${editRound} lock?`,
                        message: `The round goes back to live handicaps. Use this only if the round was locked by a stray score before play began.`,
                        confirmLabel: "Release",
                      }))) return;
                      await onClearRoundLock(editRound);
                      notify(`Round ${editRound} lock released`, "success");
                    }} style={{
                      padding: "6px 12px", borderRadius: 8, border: `1px solid ${BC.bdr}`, background: "transparent",
                      color: BC.t3, fontSize: 10, fontWeight: 700, cursor: "pointer",
                    }}>Release lock</button>
                  </div>
                )}

                {/* FINAL → typed confirmation, deliberately awkward */}
                {roundIsFinal && (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      value={unlockText}
                      onChange={e => setUnlockText(e.target.value)}
                      placeholder="Type UNLOCK"
                      style={{
                        ...InputStyle, marginBottom: 0, width: 130, padding: "6px 8px", fontSize: 11,
                        borderColor: unlockText === "UNLOCK" ? BC.danger : BC.bdr,
                      }} />
                    <button
                      disabled={unlockText !== "UNLOCK"}
                      onClick={async () => {
                        await onFinalizeRound(editRound, false);
                        setUnlockText("");
                        notify(`Round ${editRound} reopened — snapshot still in place`, "success");
                      }}
                      style={{
                        padding: "6px 12px", borderRadius: 8, border: `1px solid ${BC.danger}`,
                        background: unlockText === "UNLOCK" ? BC.danger : "transparent",
                        color: unlockText === "UNLOCK" ? "#fff" : BC.t3,
                        fontSize: 10, fontWeight: 700,
                        cursor: unlockText === "UNLOCK" ? "pointer" : "not-allowed",
                        opacity: unlockText === "UNLOCK" ? 1 : 0.5,
                      }}>Unlock round</button>
                    <span style={{ fontSize: 9, color: BC.t3 }}>
                      Reopening alone changes nothing — you would still have to refresh the snapshot.
                    </span>
                  </div>
                )}
              </div>

              {/* Frozen values — what this round is ACTUALLY scoring with */}
              {showLockDetail && activeLock && (
                <div style={{ borderTop: `1px solid ${BC.bdr}`, background: BC.card, padding: "8px 10px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 42px 60px 34px", gap: 4, marginBottom: 4 }}>
                    {["PLAYER", "HI", "TEE", "CH"].map((h, i) => (
                      <div key={h} style={{
                        fontSize: 7, fontWeight: 700, color: BC.t3, letterSpacing: 0.5,
                        textAlign: i === 0 ? "left" : "center",
                      }}>{h}</div>
                    ))}
                  </div>
                  {tPlayers.map(p => {
                    const e = lockedPlayerEntry(roundLocks, editRound, p.player_id);
                    const tm = teams[p.team];
                    return (
                      <div key={p.player_id} style={{ display: "grid", gridTemplateColumns: "1fr 42px 60px 34px", gap: 4, alignItems: "center", marginBottom: 2 }}>
                        <div style={{ fontSize: 10, color: tm.accent + "aa", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                        <div style={{ fontSize: 10, color: e?.overridden ? BC.amber : BC.t2, textAlign: "center", fontWeight: e?.overridden ? 700 : 400 }}>
                          {e ? e.hi : "—"}
                        </div>
                        <div style={{ fontSize: 9, color: BC.t3, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {e?.tee || "—"}
                        </div>
                        <div style={{ fontSize: 11, color: e ? BC.t1 : BC.t3, textAlign: "center", fontWeight: 700 }}>
                          {e ? e.ch : "—"}
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ fontSize: 9, color: BC.t3, marginTop: 6, lineHeight: 1.5 }}>
                    Mode: {activeLock.handicap_mode === "full" ? "All handicaps" : "Low man"} ·
                    {" "}Course: {activeLock.course_name || "—"}
                    {tPlayers.some(p => !lockedPlayerEntry(roundLocks, editRound, p.player_id)) && (
                      <span style={{ color: BC.amber }}>
                        {" "}· Players showing — joined after the lock and will use live handicaps.
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

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
                    ? `Round ${editRound} is final. These fields are read-only.`
                    : `Round ${editRound} is locked. Changes here are saved for reference but will not affect its scoring until you refresh the snapshot above.`}
                </div>
              )}
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
              {[teams.A, teams.B].map((team, teamIdx) => (
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
                        <div style={{ fontSize: 11, color: teams[p.team].accent + "88", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                        <div style={{ fontSize: 10, color: BC.t3, textAlign: "center" }}>{baseHI}</div>
                        <input
                          type="number" step="0.1"
                          disabled={roundIsFinal}
                          value={hasOverride ? override : ""}
                          onChange={e => {
                            if (roundIsFinal) return;
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
        const mLock = lockForRound(roundLocks, matchRound);
        const course = courses.find(c => c.id === (mLock?.course_id || tr?.course_id));
        const hcpMode = getRoundHandicapMode({ roundLocks, round: matchRound, tRounds });

        // CH preview for the match builder. Routed through the same resolver
        // the scoring engine uses, so once a round is locked this panel shows
        // the strokes that will ACTUALLY be played — not a live re-derivation
        // that would disagree with the leaderboard.
        const getPlayerCH = (pid) => getRoundCH({
          roundLocks, round: matchRound, pid, players: tPlayers,
          course, hcpOverrides, teeAssignments, roundTee: tr?.tee_box,
        });

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
              const team = teams[tid];
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
                  const team = teams[p?.team] || teams.B;
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
                      <span style={{ color: teams.A.accent+"99", fontWeight: 600 }}>{m.teamANames?.join(" / ")}</span>
                      <span style={{ color: BC.t3 }}> vs </span>
                      <span style={{ color: teams.B.accent+"99", fontWeight: 600 }}>{m.teamBNames?.join(" / ")}</span>
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
                            await onSetRound({ id: `bc_round_${r}`, tournament_id: TOURNAMENT_ID, round_number: r, course_id: null, format: tr?.format || DEFAULT_FORMAT, tee_time: tr?.tee_time || "", nassau_front: tr?.nassau_front || 1, nassau_back: tr?.nassau_back || 1, nassau_overall: tr?.nassau_overall || 1 });
                          } else if (otherCourse) {
                            if (await confirm(`Replace ${otherCourse.name} for Rd ${r}?`)) {
                              await onSetRound({ id: `bc_round_${r}`, tournament_id: TOURNAMENT_ID, round_number: r, course_id: c.id, format: tr?.format || DEFAULT_FORMAT, tee_time: tr?.tee_time || "", nassau_front: tr?.nassau_front || 1, nassau_back: tr?.nassau_back || 1, nassau_overall: tr?.nassau_overall || 1 });
                            }
                          } else {
                            await onSetRound({ id: `bc_round_${r}`, tournament_id: TOURNAMENT_ID, round_number: r, course_id: c.id, format: tr?.format || DEFAULT_FORMAT, tee_time: tr?.tee_time || "", nassau_front: tr?.nassau_front || 1, nassau_back: tr?.nassau_back || 1, nassau_overall: tr?.nassau_overall || 1 });
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
              <Popup onClose={() => setCoursePreview(null)} maxWidth={420} padding={0} innerStyle={{ background: BC.card, borderRadius: 16, border: `1px solid ${BC.amber}44` }}>

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

          {/* Tournament name */}
          <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, padding: 14, marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: BC.t3, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 8 }}>Tournament Name</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={editTournamentName}
                onChange={e => setEditTournamentName(e.target.value)}
                placeholder={TOURNAMENT_TITLE}
                style={{ flex: 1, minWidth: 0, boxSizing: "border-box", padding: "10px 12px", background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 8, color: BC.t1, fontSize: 14, fontWeight: 700, outline: "none", fontFamily: "'Montserrat', sans-serif" }}
              />
              <button
                onClick={() => onSaveTournamentName(editTournamentName.trim() || TOURNAMENT_TITLE)}
                style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, color: "#0a0804", background: BC.amber, border: "none", borderRadius: 8, padding: "0 16px", cursor: "pointer" }}
              >Save</button>
            </div>
            <div style={{ fontSize: 11, color: BC.t3, marginTop: 8, lineHeight: 1.5 }}>
              Shown on the login screen. The year and location come from the active edition.
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
          course: course2, hcpOverrides, teeAssignments, roundTee: tr2?.tee_box,
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
                    <span style={{ fontSize: 12, fontWeight: 600, color: teams[p.team].accent + "88" }}>{p.name}</span>
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
  useEffect(() => {
    if (!activeMatch) return;
    if (!holeComplete || activeHole >= 17 || editing || allComplete) return;
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
        return <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 13, lineHeight: `${cellH}px`, ...colBorder }} title="Missing score">⚠️</div>;
      }
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

  return (
    <div>
      {/* Front 9 — hole strip. Three-state visual hierarchy:
          - Current hole: bright BC.amber with dark text — "this is
            the live one, you're entering it now"
          - Completed hole (all 4 players have scores): deep
            BC.amberDim with white text — "locked in, done"
          - Partial (some players have scored): subtle amber tint
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
        {Array.from({ length: 9 }, (_, i) => {
          const cur = i === activeHole;
          const allScored = matchPids.every(pid => scoresMap[`${pid}_${i}`]);
          const partial = !allScored && matchPids.some(pid => scoresMap[`${pid}_${i}`]);
          return (
            <button key={i} onClick={() => goToHole(i)} style={{
              flex: 1, height: 28, borderRadius: cur ? 8 : 6,
              border: "none",
              background: cur ? BC.amber : allScored ? BC.amberDim : partial ? BC.amber + "20" : BC.card,
              color: cur ? "#0a0804" : allScored ? "#fff" : BC.t3,
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
      {/* Back 9 — hole strip. Same three-state hierarchy as front 9. */}
      <div style={{ display: "flex", gap: 3, marginBottom: 2 }}>
        {Array.from({ length: 9 }, (_, i) => {
          const h = i + 9;
          const cur = h === activeHole;
          const allScored = matchPids.every(pid => scoresMap[`${pid}_${h}`]);
          const partial = !allScored && matchPids.some(pid => scoresMap[`${pid}_${h}`]);
          return (
            <button key={h} onClick={() => goToHole(h)} style={{
              flex: 1, height: 28, borderRadius: cur ? 8 : 6,
              border: "none",
              background: cur ? BC.amber : allScored ? BC.amberDim : partial ? BC.amber + "20" : BC.card,
              color: cur ? "#0a0804" : allScored ? "#fff" : BC.t3,
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
              border: `1px solid ${BC.bdr}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: BC.t1, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flexShrink: 1 }}>{p.name}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: BC.hcpBlue, flexShrink: 0 }}>({ch})</span>
                {strokes > 0 && (
                  <span style={{ color: BC.hcpBlue, fontSize: 12, letterSpacing: 1, flexShrink: 0, lineHeight: 1 }}>
                    {"●".repeat(strokes)}
                  </span>
                )}
                <div style={{ flex: 1 }} />
                {run.thru > 0 && (
                  <span style={{ fontSize: 10, color: BC.t3, flexShrink: 0, whiteSpace: "nowrap" }}>
                    {/* PGA-leaderboard color convention: red for under par,
                        neutral text color for even/over par. The brand
                        green was reading as "good news" in the wrong
                        register — golfers are trained to scan red. */}
                    Net: <strong style={{ color: run.netVsPar < 0 ? BC.danger : run.netVsPar === 0 ? BC.t3 : BC.t1 }}>
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
                      position: "relative",
                      // No CSS transition — when the active hole changes
                      // (auto-advance) or a score is corrected, the four
                      // selected buttons should swap state instantly. With
                      // a fade transition they all cross-fade through a
                      // half-amber state, which reads as "ghost selections
                      // flashing" rather than a clean state change.
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
  // Director-set tournament name (bc_settings/tournament). Falls back to the
  // TOURNAMENT_TITLE constant, so the login screen always has a name.
  const [tournamentName, setTournamentName] = useState(TOURNAMENT_TITLE);
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
    if (styleEl) {
      styleEl.textContent = `
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body, #root { height: 100dvh; width: 100%; background: ${BC.bg}; overflow: hidden; }
        body { margin: 0; padding: 0; }
      `;
    }
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

  const notify = useCallback((msg, type = "success") => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 2800);
  }, []);

  // Keep popupOpenRef in sync with menuOpen so touch handlers see
  // "popup is open" without having to participate in React's render cycle.
  // If additional top-level modals get added later, OR them in here.
  useEffect(() => { popupOpenRef.current = menuOpen; }, [menuOpen]);

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
      const tn = rows.find(r => r.id === "team_names");
      if (tn) setTeamNames({ A: tn.teamA || DEFAULT_TEAM_NAMES.A, B: tn.teamB || DEFAULT_TEAM_NAMES.B });
      const tourn = rows.find(r => r.id === "tournament");
      setTournamentName(tourn?.name?.trim() || TOURNAMENT_TITLE);
      // Branding: apply to the live BC theme immediately (using the current
      // mode via ref), then store it so a later theme toggle re-applies it.
      const br = rows.find(r => r.id === "branding");
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
  })), [tRounds]);

  // Enhance matches with nassau from round
  const enrichedMatches = useMemo(() => matches.map(m => {
    const tr = enrichedRounds.find(t => t.round_number === m.round);
    return { ...m, nassau: m.nassau || tr?.nassau || NASSAU_DEFAULT };
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
        hcpOverrides,
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

  // ── Director lock actions ────────────────────────────────────────────
  // Deliberate counterparts to the automatic lock. `refresh` re-takes the
  // snapshot against current values and is the ONLY way a locked round's
  // handicaps can move; it is blocked outright on a final round.
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
      hcpOverrides,
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

  if (!user) return <LoginScreen players={tPlayers} teams={teams} darkMode={darkMode} tournamentName={tournamentName} onLogin={p => { setUser({ ...p, isDirector: !!p.isDirector }); }} />;

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

  return (
    <div style={{ height: "100dvh", width: "100%", background: BC.bg, display: "flex", flexDirection: "column", position: "relative", fontFamily: "'Montserrat', sans-serif", overflow: "hidden", boxSizing: "border-box", paddingTop: "env(safe-area-inset-top, 0px)", paddingLeft: "env(safe-area-inset-left, 0px)", paddingRight: "env(safe-area-inset-right, 0px)" }}>
      <div style={{ maxWidth: 520, width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", height: "100%", position: "relative", padding: "0 4px" }}>
      <Notif notif={notif} />

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



      {/* Content */}
      <div className="bc-app-body" style={{
        flex: 1, overflowY: "auto", overflowX: "hidden",
        // The nav is now an in-flow sibling below this scroll area, so no
        // nav-clearance padding is needed — just normal content padding.
        padding: "12px 10px 16px 10px",
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
            the content starts at the top and scrolls normally. */}
        <div style={{ width: "100%", marginTop: "auto", marginBottom: "auto" }}>
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
          />
        )}
        {view === "groups" && (
          <GroupsView
            matches={enrichedMatches}
            tRounds={enrichedRounds}
            tPlayers={tPlayers}
            courses={courses}
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
              await db.upsert("bc_settings", { id: "team_names", tournament_id: TOURNAMENT_ID, teamA: names.A, teamB: names.B });
            }}
            brand={brand}
            onSaveBranding={async (b) => {
              // Optimistically apply to the live theme, then persist. The
              // bc_settings subscription will re-apply the same doc — the
              // single source of truth for team colors.
              applyBCTheme(darkMode ? "dark" : "light", b);
              setBrand(b);
              await db.upsert("bc_settings", { id: "branding", tournament_id: TOURNAMENT_ID, teamA: b.teamA, teamB: b.teamB });
            }}
            tournamentName={tournamentName}
            onSaveTournamentName={async (name) => {
              setTournamentName(name);
              await db.upsert("bc_settings", { id: "tournament", tournament_id: TOURNAMENT_ID, name });
            }}
            hcpOverridesFromDb={hcpOverridesData}
            teeAssignmentsFromDb={teeAssignmentsData}
            roundLocks={roundLocksData}
            onLockRound={onLockRound}
            onFinalizeRound={onFinalizeRound}
            onClearRoundLock={onClearRoundLock}
            notify={notify}
          />
        )}
        </ErrorBoundary>
        </div>
      </div>

      <SlideMenu open={menuOpen} onClose={() => setMenuOpen(false)} onNavigate={setView} onLogout={() => setUser(null)} user={user} view={view} darkMode={darkMode} onToggleTheme={toggleTheme} />

      {/* Bottom Nav — an IN-FLOW flex child at the end of the full-height
          (100dvh) column, so it always rests on the true bottom of the
          visible screen. (It used to be position:fixed, which on mobile
          pinned to the small-viewport bottom and left a strip of page-bg
          showing beneath it.) paddingBottom is JUST the home-indicator safe
          area — 0 on non-notch devices / in-browser. */}
      <div style={{ flexShrink: 0, background: BC.card, borderTop: `1px solid ${BC.bdr}`, zIndex: 100, paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <div style={{ maxWidth: 520, margin: "0 auto", display: "flex" }}>
        {navItems.map(item => {
          const active = view === item.key;
          const clr = active ? BC.amber : BC.t3;
          return (
            <button key={item.key} onClick={() => {
              if (item.key === "menu") { setMenuOpen(true); return; }
              setView(item.key);
            }} style={{
              flex: 1, padding: "7px 4px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
              background: "transparent", border: "none", cursor: "pointer", minHeight: 52,
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
