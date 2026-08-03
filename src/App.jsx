import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { BC, FONT, ON_ACCENT, SHADOW, ALPHA, ON_AMBER, HOLE_BANNER, FS, segThumb, segTrack, applyBCTheme, initialBCMode, bcGlobalCSS, playerNameColor, teamColor, VP_BAND } from "./theme";
import { playerLookup } from "./lib/players";
import { db, TOURNAMENT_ID, getTournamentYear, editionDocId, setActiveTournamentId, readUserSession, writeUserSession, BOOTSTRAP_DIRECTOR } from "./firebase";
import { PROVIDERS, signIn, signOutUser, onAuthUser, consumeRedirectResult, isCancelled, whenAuthReady } from "./lib/auth";
import { claimPlayer, linkedPlayer, isClaimed, accountLabel, unlinkPatch, readMembership, isDirectorAccount, joinWithCode, setAccessCode, readAccessCode, setDirector, membershipFor, playerIsDirector, accountsUnreadable, ACCOUNTS_COL, deleteAccount } from "./lib/accounts";
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
  resolveParPoints, parPointsDefaultFor, formatUsesParPoints, parResultsFor, parResultLabel,
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
  LOCK_OPEN, LOCK_FINAL, LOCK_STATE_LABEL,
} from "./lib/roundLocks";
import {
  concealHoleData, revealState, sealDefaultFor, revealSummary, HOLE_COUNT,
  COUNTDOWN_HASH,
} from "./lib/reveal";
import { usePullToRefresh } from "./lib/usePullToRefresh";
import { useFitDensity } from "./lib/useFitDensity";
import { processLogo } from "./lib/logoBrand";
import ErrorBoundary from "./components/ErrorBoundary";
import { AppHeader, HEADER_SLOT_ID } from "./components/AppHeader";
import { Popup, ConfirmModal } from "./components/Popup";
import { CtpPrompt } from "./components/CtpPrompt";
import { DirectorFinalizeAlert, FinalizeRoundSheet } from "./components/FinalizeRound";
import { MissingCardNote, SignCardSheet, SignedCardPanel } from "./components/CardSignature";
import { AccountView } from "./components/AccountView";
import { initForegroundNotifications, syncAppBadge } from "./lib/notifications";
import { SegmentedToggle, SegRule, StickyTop, Banner, PlayerName, Toast, HoleNavigator, ScoreButtonRow } from "./components/ui";
import { GroupSwitcher } from "./components/GroupSwitcher";
import { useConfirm } from "./lib/useConfirm";
import { useStableCallback } from "./lib/useStableCallback";
import { EditionSwitcher } from "./components/EditionSwitcher";
import { GhinLinkButton, GhinSyncButton } from "./components/GhinLink";
import { TeamLeaderboard } from "./components/Leaderboard";
import { FullScorecard } from "./components/FullScorecard";
import { FieldCard } from "./components/FieldCard";
import { BuyInEditor } from "./components/BuyIns";
import { MatchSetup } from "./components/MatchSetup";
import {
  GROUPS_COL, groupsDocId, encodeGroups, decodeGroups,
  teeTimeForMatch, parseTeeTime, formatTeeTime, DEFAULT_TEE_INTERVAL, TEE_SLOTS,
  matchPlayers,
  roundPlaySetup, orderMatchesForRound, numberMatches,
  stripAMPM,
} from "./lib/groups";
import { holesEntered, roundScoreProgress } from "./lib/scoreGuard";
import {
  cardSigBareId, sigForMatch, cardComplete, missingForCard,
  nonSignerPids, isFullyAttested, cardState,
  roundCardProgress, pendingAttestations,
} from "./lib/cardSigs";
import { useHoleAdvance } from "./lib/useHoleAdvance";

// ── Landing straight on the Final Countdown ───────────────────────
// Read ONCE, at module load, before React has rendered anything: the
// television is pointed at `…/#countdown`, HDMI'd into the room, and it has
// to come up on the countdown by itself — including after the refresh
// somebody performs two minutes before everyone sits down. A constant
// rather than a live hash listener because this is the app's STARTING
// state; once it is running, opening and closing the countdown rewrites the
// hash itself (see components/Leaderboard).
const AUTO_COUNTDOWN =
  typeof window !== "undefined" && window.location.hash === COUNTDOWN_HASH;

// ── Bottom-nav safe-area cushion ──────────────────────────────────
// Padding under the nav labels, so they clear the home indicator.
//
// This is now the ONLY number involved in seating the bar, because the bar is
// an in-flow flex child of the shell (see the nav's own comment) rather than a
// second position:fixed element that the scroll area had to guess the height
// of. Nothing reads it back in JavaScript, nothing measures the bar, and there
// is no second copy of this arithmetic to drift out of step with it.
//
// The value is the plain inset with an 8px floor:
//
//   • The inset is what the platform says is unsafe, so honour all of it
//     rather than a fraction. The previous half-inset-plus-6 was invented to
//     claw back ~19px of screen, but the bar was over-tall for a different
//     reason — the button below already carries its own bottom padding — so
//     the fraction was treating a symptom in the wrong place. Trim the button,
//     not the inset.
//   • The floor covers every device that reports 0: a browser tab, a desktop
//     window, an older phone with a physical home button. Without it the
//     labels would sit flush against the bottom border on those.
//
// The bar's BACKGROUND still paints through the whole inset down to the glass,
// because the padding is inside the bar's own box. Only the labels and tap
// centres are held above the indicator, which is exactly the platform
// convention — the same shape as a native iOS tab bar.
//
// ── Minus the band, because that clearance already exists ─────────
// VP_BAND (theme.js) is the strip of screen BELOW the layout viewport on a
// webview that doesn't reach the glass. It is real, reserved, untouchable space
// sitting directly under this bar — which is exactly the clearance this padding
// buys — so paying for it twice just makes the bar taller for nothing.
//
// This was removed once, on the reasoning that the band only affects a
// home-screen icon snapshotted before index.html pinned status-bar-style to
// "black", and no newly-installed icon can land in that state. True, and beside
// the point: icons that are ALREADY installed stay in it forever, and on a
// sixteen-player tournament app most of the field is an already-installed icon.
// Measured on a real iPhone 17e (390x844pt) with a stale icon:
//
//   env(safe-area-inset-top)    47pt   ← would be 0 if "black" had taken
//   layout viewport               797pt   = 844 - 47
//   nav box                      93.6pt  = 59.6 chrome + 34 inset
//   nav top border                704pt   ← matches the screenshot to 0.6pt
//   white below the labels         87pt   ← 34 inset + 6 button + 47 band
//
// 34pt of home-indicator inset stacked on 47pt of dead space. Subtracting turns
// the total clearance from a SUM into a max(), which is what it should always
// have been. On a device whose webview does fill the screen VP_BAND is 0px and
// this is exactly the inset, so nothing changes there — which is why a 17 Pro
// looked right while the 17e did not.
//
// The floor is applied INSIDE the subtraction, not outside: max(8px, inset)
// first, then take the band off that. Outside, the 8px floor would survive on a
// device that already has 47pt of clearance and waste it.
//
// ── Why this nesting is safe to write now ─────────────────────────
// The comment this replaces warned against exactly this kind of nested CSS,
// because a function an engine refuses to parse takes its whole declaration
// with it, and the failure mode used to be content stranded under the bar with
// no scroll left to reach it. That failure mode is gone. The nav is an in-flow
// flex row, so the shell reserves its real height whatever this resolves to; if
// the declaration drops entirely the bar is simply 34pt shorter and the labels
// sit nearer its edge. Nothing can be stranded, so the arithmetic can live in
// CSS where it belongs instead of being duplicated in JS.
const NAV_MIN_PAD = 8;
const NAV_SAFE_PAD = `max(0px, calc(max(${NAV_MIN_PAD}px, env(safe-area-inset-bottom, 0px)) - ${VP_BAND}))`;


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


// ══════════════════════════════════════════════════════════════════
//  Getting in
// ══════════════════════════════════════════════════════════════════
//
// Two screens, in order, and most people see the second one once ever:
//
//   1. SignInScreen — Google or Apple. Firebase keeps that session in
//      IndexedDB, so it survives closing the app, which the old
//      tap-your-name screen (sessionStorage) never did.
//   2. ClaimScreen — the same roster grid as before, but now it BINDS the
//      account to that name (lib/accounts.js) instead of just setting a
//      variable. Names somebody else has claimed are shown locked.
//
// Both share the chrome — silhouette, tournament name, year and place —
// so the transition between them is just the panel changing.

function LoginChrome({ tournamentName, tournamentLocation, children }) {
  return (
    // Centred while it fits, scrolls when it doesn't. The claim screen is
    // the tall one — twelve names, a confirm bar and the director row clear
    // an iPhone SE by a few pixels, and a fourteen-man field would not.
    // `overflow: hidden` here (what the old single-purpose login screen
    // used) would hide the overflow rather than let anyone reach it, and
    // html/body are locked by the theme so the page itself cannot scroll.
    // A lone `margin: auto` child does both jobs: flexbox centres it with
    // room to spare, and the scroll container takes over without it.
    // `position: fixed` on all four edges, NOT height:100dvh. dvh is the
    // DYNAMIC viewport unit: on iOS Safari it tracks the collapsing address
    // bar, so this container grew and shrank by ~60px while somebody was
    // mid-tap on a name, and the whole centred panel walked up the screen
    // under their finger. The fixed box is pinned to the layout viewport,
    // which does not move, and it is the same pattern the signed-in shell
    // uses — one anchoring rule for both screens.
    <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, left: 0, background: BC.bg, display: "flex", flexDirection: "column", padding: "0 10px", fontFamily: FONT, overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain" }}>
      {/* Silhouette — fixed full-screen background */}
      <img src={TROPHY_SILHOUETTE} alt="" style={{
        position: "fixed", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        width: "100%", height: "100%",
        objectFit: "contain", opacity: 0.28, filter: "brightness(1.4) contrast(1.2)", pointerEvents: "none", userSelect: "none", zIndex: 0,
      }} />

      <div style={{
        margin: "auto", width: "100%", flexShrink: 0,
        display: "flex", flexDirection: "column", alignItems: "center",
        padding: "calc(env(safe-area-inset-top, 0px) + 12px) 0 calc(env(safe-area-inset-bottom, 0px) + 12px)",
      }}>
        {/* Title — sits above the silhouette, outside content card */}
        <div style={{ textAlign: "center", position: "relative", zIndex: 1, marginBottom: 14 }}>
          <div style={{ fontSize: `clamp(${FS.title}px, 8vw, ${FS.hero}px)`, fontWeight: 800, color: BC.gold, letterSpacing: 2 }}>{(tournamentName || TOURNAMENT_TITLE).toUpperCase()}</div>
          <div style={{ fontSize: `clamp(${FS.label}px, 3vw, ${FS.small}px)`, color: BC.t3, letterSpacing: "0.3em", marginTop: 3 }}>{getTournamentYear()} {(tournamentLocation || TOURNAMENT_LOCATION).toUpperCase()}</div>
        </div>

        {/* Desktop centering wrapper */}
        <div style={{ width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", alignItems: "center", position: "relative", zIndex: 1 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// A one-line error/notice under the buttons. Its height is held even when
// empty so tapping a provider doesn't shove the buttons up the screen.
const LoginNote = ({ text, tone = "error" }) => (
  <div style={{ minHeight: 34, marginTop: 10, textAlign: "center", fontSize: FS.small, lineHeight: 1.35, color: tone === "error" ? BC.danger : BC.t3, maxWidth: 360 }}>
    {text || ""}
  </div>
);

// Both marks are inlined as SVG rather than pulled from a CDN or drawn
// with a text glyph: the Apple  is a font character that only renders on
// Apple devices, and Google's brand guidance for the button is the
// four-colour G, not a letter.
const GoogleMark = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.3h12.1c-.2 2-1.6 5-4.5 7l-.1.3 6.5 5 .5.1c4.1-3.8 6.6-9.4 6.6-15.7z" />
    <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.4c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-.3.02-6.8 5.2-.1.3C7.9 41 15.4 46 24 46z" />
    <path fill="#FBBC05" d="M11.5 28.4c-.5-1.4-.8-2.9-.8-4.4 0-1.5.3-3 .7-4.4v-.3l-6.9-5.3-.2.1A22 22 0 0 0 2 24c0 3.5.9 6.9 2.3 9.9l7.2-5.5z" />
    <path fill="#EB4335" d="M24 9.5c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 3.4 29.9 1 24 1 15.4 1 7.9 6 4.3 13.3l7.2 5.6C13.3 13.6 18.2 9.5 24 9.5z" />
  </svg>
);

const AppleMark = ({ size = 18, color = "#FFFFFF" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true">
    <path d="M16.37 1.43c0 1.14-.47 2.25-1.24 3.06-.79.85-2.07 1.5-3.12 1.42-.13-1.1.41-2.27 1.15-3.02.79-.85 2.19-1.47 3.21-1.46zM20.5 17.02c-.55 1.27-.82 1.84-1.53 2.96-.98 1.56-2.37 3.5-4.09 3.51-1.53.02-1.93-1-4-.99-2.08.01-2.51 1.01-4.04.99-1.72-.02-3.03-1.77-4.02-3.33C.05 15.8-.24 10.68 1.47 7.96 2.68 6.03 4.6 4.9 6.4 4.9c1.84 0 3 1.01 4.52 1.01 1.48 0 2.38-1.01 4.5-1.01 1.61 0 3.32.88 4.53 2.39-3.98 2.18-3.34 7.85.55 9.73z" />
  </svg>
);

// ── Screen 1: sign in ───────────────────────────────────────────────
function SignInScreen({ tournamentName, tournamentLocation, initialError }) {
  const [busy, setBusy] = useState(null);
  // Whether a popup can actually be opened yet — see lib/auth.js. On a
  // fresh home-screen install the auth iframe is a cold network fetch, and
  // a tap that lands before it finishes gets a window Safari refuses. A
  // button disabled for that moment is a better answer than one that looks
  // ready and silently does nothing, which is what this cost twice.
  const [ready, setReady] = useState(false);
  useEffect(() => { let live = true; whenAuthReady().then(() => { if (live) setReady(true); }); return () => { live = false; }; }, []);
  // Two sources, no effect syncing them: `initialError` is what a redirect
  // sign-in failed with on the far side (iOS home-screen installs take that
  // route), which would otherwise be invisible — the app just reappears
  // here. `err` is this screen's own attempt failing, and wins once made.
  const [err, setErr] = useState("");
  const shownErr = err || initialError || "";

  const go = async (id) => {
    setErr(""); setBusy(id);
    try {
      // Resolves null when the browser is navigating away to the provider;
      // leaving `busy` set is right in that case — the screen is about to
      // be replaced, and a re-armed button would just invite a second tap.
      await signIn(id);
    } catch (e) {
      if (!isCancelled(e)) setErr(e?.message || "Sign-in failed. Try again.");
      setBusy(null);
    }
  };

  const btn = (p) => (
    <button key={p.id} onClick={() => go(p.id)} disabled={!!busy || !ready} style={{
      width: "100%", padding: "13px 16px", borderRadius: 12,
      background: p.brand, color: p.ink,
      border: p.id === "google" ? "1px solid rgba(0,0,0,0.16)" : "1px solid rgba(255,255,255,0.22)",
      fontFamily: FONT, fontSize: FS.body, fontWeight: 700, letterSpacing: 0.2,
      cursor: (busy || !ready) ? "default" : "pointer",
      opacity: !ready ? 0.55 : (busy && busy !== p.id ? 0.5 : 1),
      transition: "opacity .2s",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
      boxShadow: `0 2px 10px ${SHADOW}`,
    }}>
      {p.id === "google" ? <GoogleMark /> : <AppleMark color={p.ink} />}
      <span>{busy === p.id ? "Opening…" : p.label}</span>
    </button>
  );

  return (
    <LoginChrome tournamentName={tournamentName} tournamentLocation={tournamentLocation}>
      <div style={{ width: "100%", maxWidth: 340, display: "flex", flexDirection: "column", gap: 10 }}>
        {PROVIDERS.map(btn)}
      </div>
      <LoginNote text={shownErr} />
    </LoginChrome>
  );
}

// ── Screen 2: the password ──────────────────────────────────────────
// Signing in proves who you are; it does not prove you were invited. This
// is where the second half happens, and it is checked by the security
// rules rather than here — the submit below writes a membership document
// carrying the typed code, and the database rejects it if the code is
// wrong (see lib/accounts.js and firestore.rules). Nothing on this screen
// knows the password, so nothing on this screen can leak it.
function GateScreen({ tournamentName, tournamentLocation, authUser, onPassed, onSignOut }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    setBusy(true); setErr("");
    const res = await joinWithCode(authUser, code);
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    onPassed();
  };

  return (
    <LoginChrome tournamentName={tournamentName} tournamentLocation={tournamentLocation}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 340, display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
        <div style={{ textAlign: "center", fontSize: FS.small, color: BC.t3, lineHeight: 1.4 }}>
          Signed in as {authUser?.email || "your account"}.<br />Enter the tournament password.
        </div>
        <input
          value={code}
          onChange={e => setCode(e.target.value)}
          // Not type="password": there is no privacy to protect from
          // somebody standing on the same tee box, and a masked field on a
          // phone keyboard is how you get three failed attempts.
          type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          autoComplete="one-time-code" autoFocus
          placeholder="Password"
          style={{
            width: "100%", boxSizing: "border-box", background: BC.inp,
            border: `1px solid ${err ? BC.danger : BC.bdr}`, borderRadius: 10,
            padding: "12px 14px", color: BC.t1, textAlign: "center",
            // 16px, or iOS Safari zooms the page on focus.
            fontSize: FS.lead, fontWeight: 700, fontFamily: FONT, outline: "none",
          }} />
        <button type="submit" disabled={busy} style={{
          width: "100%", padding: "12px 16px", borderRadius: 12,
          background: BC.gold, border: "none", color: ON_AMBER,
          fontFamily: FONT, fontSize: FS.body, fontWeight: 800, cursor: busy ? "default" : "pointer",
        }}>{busy ? "Checking…" : "Continue"}</button>
      </form>

      <LoginNote text={err} />

      <button onClick={onSignOut} style={{
        background: "transparent", border: "none", color: BC.t3,
        fontSize: FS.small, fontFamily: FONT, textDecoration: "underline", cursor: "pointer", padding: "4px",
      }}>Sign out</button>
    </LoginChrome>
  );
}

// ── Screen 3: claim your name ───────────────────────────────────────
// Shown to a signed-in account that no roster document points at. Tapping
// a name selects it; a second tap on the confirm bar commits, because the
// link is meant to be permanent and a mis-tap on a 12-name grid is not.
function ClaimScreen({ players, teams, darkMode, tournamentName, tournamentLocation, authUser, onClaimed, onDirector, onSignOut }) {
  const [code, setCode] = useState("");
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Checked as it is typed rather than in an effect on the value: the
  // director typing the code is an event, and modelling it as one keeps
  // the parent's state change out of this component's render cycle.
  const onCode = (v) => {
    setCode(v);
    if (v.trim().toLowerCase() === DIRECTOR_CODE) onDirector();
  };

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

  const doClaim = async () => {
    if (!picked || busy) return;
    setBusy(true); setErr("");
    const res = await claimPlayer(picked, authUser);
    setBusy(false);
    if (!res.ok) { setErr(res.error); setPicked(null); return; }
    onClaimed(res.player);
  };

  const PlayerBtn = ({ p, team }) => {
    const taken = isClaimed(p);
    const sel = picked?.player_id === p.player_id;
    return (
      <button
        onClick={() => !taken && setPicked(sel ? null : p)}
        disabled={taken || busy}
        title={taken ? `${p.name} is already linked to an account` : undefined}
        style={{
          width: "100%", padding: "clamp(8px, 2.5vw, 12px) clamp(10px, 3vw, 14px)",
          background: sel ? team.accent : (taken ? "transparent" : team.color + ALPHA.tint),
          border: `1px solid ${team.accent}${sel ? "" : ALPHA.hair}`, borderRadius: 6,
          color: sel ? ON_ACCENT : (taken ? BC.t3 : BC.t2),
          fontSize: `clamp(${FS.small}px, 3.8vw, ${FS.body}px)`, fontWeight: sel ? 800 : 600,
          cursor: taken ? "default" : "pointer", textAlign: "center", opacity: taken ? 0.45 : 1,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
        }}>
        <span style={{ flex: 1, lineHeight: 1.3 }}>{p.name}</span>
        {taken && <span aria-hidden="true" style={{ fontSize: FS.label, flexShrink: 0 }}>🔒</span>}
      </button>
    );
  };

  return (
    <LoginChrome tournamentName={tournamentName} tournamentLocation={tournamentLocation}>
      {/* Nobody to tap on an empty roster — the instruction there is the
          director-code line below the columns instead. */}
      {players.length > 0 && (
        <div style={{ textAlign: "center", marginBottom: 10, fontSize: FS.body, fontWeight: 700, color: BC.t1 }}>
          Select Your Name
        </div>
      )}

      {/* Two-column layout with logos above each column */}
      <div style={{ width: "100%", maxWidth: 480, display: "flex", gap: "clamp(6px, 2vw, 12px)", position: "relative", zIndex: 1, alignItems: "flex-start" }}>
        {[teamA, teamB].map((team) => {
          const teamPlayers = players.filter(p => p.team === team.id);
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

      {/* Confirm bar — only once a name is picked. */}
      {picked && (
        <button onClick={doClaim} disabled={busy} style={{
          width: "100%", maxWidth: 480, marginTop: 10, padding: "12px 16px", borderRadius: 12,
          background: BC.gold, border: "none", color: ON_AMBER,
          fontFamily: FONT, fontSize: FS.body, fontWeight: 800, cursor: busy ? "default" : "pointer",
        }}>
          {busy ? "Linking…" : `I'm ${picked.name} — link this account`}
        </button>
      )}

      <LoginNote text={err} />

      {players.length === 0 && (
        <div style={{ textAlign: "center", color: BC.t3, fontSize: FS.small, marginTop: -22, marginBottom: 8, maxWidth: 360 }}>
          No players yet. Enter the director code below to set the tournament up.
        </div>
      )}

      {/* The director's way in, and the way back out.
          The code field appears ONLY on an empty roster, which is the only
          situation it is for: bootstrapping an edition with no name to tap.
          DIRECTOR_CODE is a constant in the bundle, so anyone who reads the
          JavaScript knows it — leaving the field on a set-up tournament
          would hand full Admin to any signed-in stranger. On an empty
          roster there is nothing yet to take.
          (It was referenced by the old login screen's hint without ever
          being rendered at all, so the documented escape hatch could not be
          typed into. It is a real input now, just a narrower one.) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, width: "100%", maxWidth: 480, justifyContent: "center" }}>
        {players.length === 0 && (
          <input
            value={code}
            onChange={e => onCode(e.target.value)}
            placeholder="Director code"
            autoCapitalize="none" autoCorrect="off" spellCheck={false}
            style={{
              // Wide enough for the placeholder, which the theme uppercases.
              width: 175, boxSizing: "border-box", background: BC.inp, border: `1px solid ${BC.bdr}`,
              borderRadius: 8, padding: "7px 10px", color: BC.t2,
              // 16px keeps iOS Safari from zooming the page on focus.
              fontSize: FS.lead, fontFamily: FONT, outline: "none", textAlign: "center",
            }} />
        )}
        <button onClick={onSignOut} style={{
          background: "transparent", border: "none", color: BC.t3,
          fontSize: FS.small, fontFamily: FONT, textDecoration: "underline", cursor: "pointer", padding: "7px 4px",
        }}>Not you? Sign out</button>
      </div>
    </LoginChrome>
  );
}

// Shown for the moment between "the app started" and "we know who you
// are" — Firebase restoring its session, then the roster arriving. Without
// it a cold start flashes the sign-in screen at somebody who is signed in.
function LoginSplash({ tournamentName, tournamentLocation }) {
  return (
    <LoginChrome tournamentName={tournamentName} tournamentLocation={tournamentLocation}>
      <div style={{ color: BC.t3, fontSize: FS.small, letterSpacing: 1 }}>…</div>
    </LoginChrome>
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
//
// ── The director's way past it ────────────────────────────────────
// A DIRECTOR can point this screen at any round, not just the live one. The
// gate above was total, and being total it also closed the only door for
// fixing what it could not prevent: a card entered against the wrong hole and
// signed over, a score nobody queried until the next morning. Once that round
// was finalized there was no way to correct it from inside the app — the fix
// was a Firebase console edit, by hand, on the document ids.
//
// So the gate is now the DEFAULT rather than the boundary, and only for a
// director. What it still guarantees is that nobody arrives on a closed round
// by accident:
//
//   • it opens on the current round, every time. `pickedRound` starts null and
//     a director who never touches the switcher sees exactly what they saw
//     before this existed.
//   • leaving the current round takes a deliberate act — picking a group out
//     of a labelled round in the switcher. There is no way to drift there.
//   • being off it is stated three times over, because a score typed into the
//     wrong round is precisely what this whole section exists to stop: the
//     round header in the switcher list, the warn-tinted chip in the app
//     header, and a banner across the top of the scoring screen with the way
//     back on it.
//   • and a closed round OPENS READ-ONLY. Arriving somewhere is not the same
//     as being able to change it: the score buttons are a grid of large
//     targets covering most of the screen, so a director who came to LOOK at
//     Round 1 is one brushed thumb from moving it. The first tap asks instead
//     of writing, naming the player, the hole and both numbers, and saying yes
//     applies that tap and arms the group — so correcting a card is one
//     question, not eighteen. Walking to another group drops the arming.
//
// Everyone who is not a director is unchanged, down to the empty states.

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

// The ring drawn around the current hole. Its look is the OFFSET — a
// hairline of page showing between the amber chip and the amber ring — so
// closing that gap does not shrink the ring, it deletes it. Width plus
// offset is how far the thing reaches past the cell, and since an outline
// is invisible to layout, that reach is also what the strip has to leave
// under itself. See renderHoleCell.
const HOLE_RING = { width: 2, offset: 1 };
const HOLE_RING_REACH = HOLE_RING.width + HOLE_RING.offset;

function ScoreEntry({ user, matches, holeData, onSaveHole, tPlayers, courses, tRounds, notify, teams, hcpOverrides, teeAssignments, roundLocks, rounds, currentRound, ctpData, onSetCtp, cardSigs, onSignCard, onAttestCard, onUnsignCard }) {
  const userPid = user.player_id;
  // This screen is worked from, not read down — four players' scores have to
  // be reachable without scrolling to the one at the bottom. It measures the
  // room it has and sizes its parts to fit. See lib/useFitDensity.
  const fitRef = useRef(null);
  const { sizes: fit } = useFitDensity(fitRef);
  const isDirector = !!user.isDirector;

  // ── Hooks (always fire, in stable order) ──
  const [activeMatchId, setActiveMatchId] = useState(null);
  // A director's explicit choice of round. null means "follow the tournament",
  // which is what everybody starts on and what everybody who is not a director
  // is pinned to. Held here rather than lifted, for the same reason the match
  // selection is: it is which round THIS SCREEN is pointed at, not a fact about
  // the tournament, and two directors' phones may honestly be on different ones.
  const [pickedRound, setPickedRound] = useState(null);
  // ── The safety catch on a closed round ──
  // The match id editing has been ARMED for, or null. An off-round screen opens
  // read-only: a director who came to look at Round 1 can brush a score button
  // and nothing happens. Arming takes a confirmation that names the change,
  // and it is per MATCH — walking to another group, or back to the live round,
  // drops it (see the effect below), so it can never be left on behind you.
  const [armedMatchId, setArmedMatchId] = useState(null);
  const { confirm, confirmModal } = useConfirm();
  const [showScorecard, setShowScorecard] = useState(false);
  // Closest-to-the-pin prompt — the 0-based index of the par 3 it is asking
  // about, or null. `promptedCtp` is the session guard that keeps it to ONE
  // automatic appearance per round+hole (see maybePromptCtp); tapping the
  // par-3 CTP chip re-opens it deliberately and ignores the guard.
  const [ctpPrompt, setCtpPrompt] = useState(null);
  const promptedCtp = useRef({});
  // The sign sheet. Only reachable from the promoted Full Scorecard button,
  // which only promotes on a complete card — see components/CardSignature.
  const [showSign, setShowSign] = useState(false);
  // The header's right-hand slot, which the director's group chip portals
  // into (components/AppHeader). Read in an effect rather than during render:
  // the header and this screen commit together, so the box is not in the
  // document yet the first time this renders. One extra render on mount, and
  // null on any screen where the header isn't mounted.
  const [headerSlot, setHeaderSlot] = useState(null);
  useEffect(() => { setHeaderSlot(document.getElementById(HEADER_SLOT_ID)); }, []);

  // THE GATE, resolved. The round this screen is pointed at: the tournament's
  // current round unless a director has deliberately picked another one, and
  // only ever a round that still exists — a pick left standing while the round
  // it named was deleted falls back rather than pointing at nothing.
  const viewRound = (isDirector && pickedRound != null && rounds.includes(pickedRound))
    ? pickedRound
    : currentRound;
  // Off the round everybody else is on. Every warning below keys off this one
  // value, so there is no state where the screen is somewhere unexpected and
  // one of the three tells has been forgotten.
  //
  // A null currentRound — every round finalized, the event over — counts as
  // off-round for anything the director opens. There is no live round to be
  // ON, and that is the state where a stray edit is LEAST likely to be
  // noticed, so it is the last state that should go unmarked.
  const offRound = viewRound != null && viewRound !== currentRound;

  // Only the viewed round's matches exist as far as the scoring surface is
  // concerned — a match from another round is not merely hidden, it is not
  // reachable, so no stale selection can put a score in it.
  const roundMatches = useMemo(
    () => matches.filter(m => m.round === viewRound),
    [matches, viewRound]
  );
  const myMatches = useMemo(
    () => roundMatches.filter(m => [...m.teamA, ...m.teamB].includes(userPid)),
    [roundMatches, userPid]
  );
  // What the switcher lists, which is the one place that DOES cross rounds:
  // every match in the tournament for a director, nothing for anybody else.
  const switchable = useMemo(
    () => (isDirector ? [...matches].sort((a, b) => (a.round - b.round) || ((a.matchNumber ?? 0) - (b.matchNumber ?? 0))) : []),
    [isDirector, matches]
  );
  // A director can score ANY group in the round on screen.
  const scorable = isDirector ? roundMatches : myMatches;

  // Resolved, not stored — the selection is re-derived from the matches the
  // gate currently allows. When a round is finalized under a player's feet,
  // a held `activeMatchId` simply stops matching and the screen falls to the
  // new round's match instead of scoring into the closed one.
  // Own match first when there is one, so the tab still opens where it always
  // did for a director who is also playing; `scorable[0]` only carries a
  // director who is not in this round's draw at all.
  const match = scorable.find(m => m.id === activeMatchId) || myMatches[0] || scorable[0] || null;
  // Read-only until armed, and only ever on a closed round. `armedMatchId` is
  // compared against the match ACTUALLY on screen rather than the one that was
  // armed, so a selection that resolves elsewhere — a match deleted, a round
  // finalized under the director's feet — lands read-only rather than carrying
  // an arming that was granted for something else.
  const editLocked = offRound && armedMatchId !== match?.id;
  // Dropping the arming is a state update in an effect rather than a
  // derivation, because it has to survive the round going back to live: the
  // condition that would clear it (`offRound`) stops being true at the same
  // moment, so nothing derived would ever fire.
  useEffect(() => {
    if (armedMatchId != null && armedMatchId !== match?.id) setArmedMatchId(null);
  }, [armedMatchId, match?.id]);
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

  // ── Signature state for the card on screen ──
  // Derived, never stored: `sig` is looked up out of the live subscription
  // every render, so a signature landing on another player's phone locks
  // this one's score buttons in the same beat it appears on theirs.
  const sig = match ? sigForMatch(cardSigs, match.id) : null;
  const signState = match ? cardState(match, sig) : "open";
  const signed = signState !== "open";
  const complete = match ? cardComplete(match, holeData) : false;
  // Whether the Full Scorecard button is allowed to promote to the sign CTA.
  // A signature is a claim by somebody IN the match — `signed_by` lands on the
  // card and every attestation is checked against the roster of that match —
  // so a director looking at another group's card gets the read-only
  // scorecard, however complete it is. Attesting is already gated the same way
  // inside SignedCardPanel.
  const canSign = complete && matchPids.includes(userPid);
  const missingCard = match && !complete && !signed ? missingForCard(match, holeData) : [];

  // No more hooks below this line.

  // Switching, wherever it is offered from. Positions the incoming match in
  // the SAME render as the selection — leaving it to the effect below paints
  // the outgoing hole for a frame first, the same flash returning to the tab
  // used to have.
  //
  // Picking across rounds moves the ROUND too, in the same call: the switcher
  // is the only door out of the current round, and a selection that set the
  // match without setting the round would be resolved straight back by the
  // gate above. A pick landing back on the live round clears the override
  // rather than pinning it, so a director who wanders off and comes back is
  // following the tournament again instead of holding a round that happens to
  // match today.
  const switchToMatch = (id) => {
    const m = (isDirector ? switchable : scorable).find(x => x.id === id);
    if (!m) return;
    setPickedRound(m.round === currentRound ? null : m.round);
    setActiveMatchId(id);
    positionOn(id, pidsOf(m), scoresAt(m.round));
  };

  // A director gets one control covering every group in every round, which
  // subsumes the multi-match case below — so the pills never render for one.
  // It lives in the app header's right-hand slot (components/AppHeader): it
  // is chrome, not part of the scoring flow, and up there it costs this
  // screen nothing at all — not a row, not a corner of one. Portaled rather
  // than lifted into the header, because what it switches is this screen's
  // own selection and that state has no business moving up two components to
  // be rendered in a band that has no idea a round is being scored.
  //
  // Rendered inside `shell` rather than in the two full-screen returns, so it
  // survives the empty states as well. That is what keeps "the tournament is
  // over" from being a dead end for the one person who still has work to do
  // in it — the crown is up there on that screen too, and it is the way back
  // into a finished round.
  const directorSwitching = isDirector && switchable.length > 1;
  const groupSwitcher = directorSwitching && headerSlot ? createPortal(
    <GroupSwitcher
      matches={switchable} current={match} currentRound={currentRound}
      roundLocks={roundLocks} tPlayers={tPlayers}
      userPid={userPid} onPick={switchToMatch}
    />, headerSlot,
  ) : null;

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
      {/* Portals to the app header's right-hand slot — occupies nothing here,
          on any branch. */}
      {groupSwitcher}
      {children}
      <Toast message={toast} />
      {/* The closed-round catch asks through this. On `shell` rather than in
          the branches, so the question can be asked from anywhere on the
          screen — including the banner, which renders above the fold on the
          signed card too. */}
      <ConfirmModal modal={confirmModal} />
    </div>
  );
  const empty = (icon, title, sub) => shell(
    <div style={{ textAlign: "center", padding: "40px 20px", color: BC.t3 }}>
      <div style={{ fontSize: FS.display, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: FS.body, fontWeight: 700, color: BC.t2, marginBottom: 4 }}>{title}</div>
      {sub && <div style={{ fontSize: FS.small, lineHeight: 1.45 }}>{sub}</div>}
    </div>
  );
  // What a director is told on an empty state that is only empty for them:
  // the crown is in the header and it is the way out. Everybody else is told
  // nothing extra, because for them these screens really are the end of it.
  const viaCrown = directorSwitching ? " Use 👑 in the header to open any round." : "";

  // Nothing is open for scoring: either the schedule hasn't been built yet,
  // or the director has finalized the last round and the event is over.
  if (viewRound == null) return rounds.length === 0
    ? empty("⛳", "No rounds set up yet", "The tournament schedule hasn't been built.")
    : empty("🏆", "The tournament is over", `Every round is final. Head to the Leaderboard for the result.${viaCrown}`);

  if (!match) return empty(
    "⛳",
    `You're not in a Round ${viewRound} match`,
    myMatches.length === 0 && matches.some(m => [...m.teamA, ...m.teamB].includes(userPid))
      ? `Scoring is open for Round ${viewRound} only. Your other rounds are on the Matches tab.${viaCrown}`
      : `Check the Matches tab once the draw is made.${viaCrown}`
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
    // A signed card is not editable. In practice this is unreachable — the
    // signed view replaces the score buttons entirely — but it is the write
    // path, and the screen it defends against is one another device can put
    // it into mid-tap. Cheap, and the alternative is a score that lands in a
    // card somebody has already sworn to.
    if (signed) return;
    // Read the hole and the player's existing score BEFORE the write —
    // the CTP trigger below needs to know this was a first entry, and
    // auto-advance can move activeHole while the save is in flight.
    const h = activeHole;
    const prior = getScore(pid, h);
    // ── The catch on a closed round ──
    // The first tap does not enter a score, it asks. And it asks about THIS
    // tap by name — who, which hole, what it says now and what it would say —
    // because "are you sure?" is a question a thumb answers yes to without
    // reading, and the whole point here is the tap nobody meant to make.
    //
    // Saying yes applies that tap AND arms the match, so a director correcting
    // a card does not confirm eighteen times; the banner turns loud for as long
    // as it stays armed, and walking away from the match drops it. Saying no
    // leaves the round exactly as it was.
    if (editLocked) {
      const ok = await confirmEdit(pid, h, prior, score);
      if (!ok) return;
      setArmedMatchId(match.id);
    }
    await onSaveHole(pid, match.round, h, score || null, tr?.course_id);
    maybePromptCtp(pid, h, score || 0, prior);
  };

  // What a tap asks. Lifted out of onTapScore only to keep the write path
  // readable — the banner's Edit button asks its own, shorter question, since
  // it is arming deliberately rather than intercepting a tap and has no score
  // to name.
  const confirmEdit = async (pid, h, prior, next) => {
    const who = tPlayers.find(p => p.player_id === pid)?.name || pid;
    const state = LOCK_STATE_LABEL[roundLockState(roundLocks, match.round)];
    const was = prior > 0 ? String(prior) : "no score";
    const now = next > 0 ? String(next) : "no score";
    return confirm({
      eyebrow: `Round ${match.round} · ${state}`,
      title: "Change a score in a closed round?",
      message: [
        `${who}, hole ${h + 1}: ${was} → ${now}.`,
        "",
        "This is not the round being played. The change posts immediately and moves the leaderboard, and the players in this match are not asked.",
        "",
        "Editing stays on for this group until you leave it.",
      ].join("\n"),
      confirmLabel: "Change it",
      destructive: true,
    });
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
  // Whose side the ▲/▼ is read from. Normally that is settled by the match
  // itself, but a director scoring somebody else's group is in neither side
  // of it — and falling through to "B" would silently invert every glyph on
  // screen. Their roster team answers it instead, so the strip reads from the
  // same side it does on their own card.
  const inMatch = matchPids.includes(userPid);
  const userTeam = inMatch
    ? (match.teamA.includes(userPid) ? "A" : "B")
    : (tPlayers.find(p => p.player_id === userPid)?.team === "B" ? "B" : "A");
  // ── The blackout, on the phone doing the scoring ─────────────────
  // A sealed round (lib/reveal.js) is entered exactly as it always was —
  // this screen keeps every score, including the two opponents in a mixed
  // foursome, because somebody has to write them down. What it stops
  // printing is what they COME TO: the running match state under each hole,
  // and, on the card behind the Full Scorecard button, the other side's
  // numbers and the running line. Those are the round, and the round is not
  // known until the cards are turned over at the house.
  const roundSeal = revealState(tRounds, match.round);
  const conceal = roundSeal.concealing ? { through: roundSeal.through, side: userTeam } : null;
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
  // ── Where the group has definitely been ──────────────────────────
  // The furthest hole EVERY player in the match has finished. It is the line
  // the missing-score badge below is drawn against: a hole before it is
  // behind the group, so a gap in it is a skipped player. A hole at or past
  // it is one they are on or have not reached, and a gap there is just a
  // score nobody has typed yet.
  //
  // Every player, not `hr.played` — that one asks whether both SIDES have a
  // number, and on a best-ball hole one player carries their side. Measuring
  // the frontier that way would advance it while the group is still entering
  // the hole they are on, which is the very thing this is here to stop.
  let lastFullHole = -1;
  if (matchPids.length) {
    for (let h = 0; h < 18; h++) {
      if (matchPids.every(pid => getScore(pid, h) > 0)) lastFullHole = h;
    }
  }
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
    // Sealed: the bar says who took the hole and the glyph says where the
    // match stands, so both go. The hole strip above still shows which holes
    // this group has posted — that is progress, not the result.
    if (conceal && i >= conceal.through) {
      return shell(
        <div title="Sealed until the reveal" style={{ textAlign: "center", fontSize: FS.small, opacity: 0.4, lineHeight: 1 }}>🔒</div>
      );
    }

    const hr = result.holes[i];
    // ── Somebody got skipped back there ──
    // Only for a hole BEHIND the group (see lastFullHole). It used to be any
    // partially-scored hole that wasn't the active one, which made it fire
    // while the scorer was still typing: enter the first player's score on
    // the hole they are standing on, glance away to a different hole, and
    // that hole — still being worked — was suddenly flagged. It also stuck a
    // permanent warning on any hole ahead of the group that had picked up a
    // stray tap.
    //
    // The evidence that a hole is behind the group is a LATER hole they have
    // finished; a gap in it is then a skipped player worth chasing. Anything
    // at or past the frontier is not yet a gap, just a score nobody has
    // typed. The active hole stays excluded on top of that, for navigating
    // back INTO a gap to fix it — the cell being worked on does not need to
    // warn about itself.
    if (!hr.played) {
      const someScored = matchPids.some(pid => getScore(pid, i) > 0);
      if (someScored && i !== activeHole && i < lastFullHole) {
        return shell(<div title="Missing score" style={{ textAlign: "center", fontSize: FS.small, opacity: 0.55, lineHeight: 1 }}>⚠️</div>);
      }
      return shell(null);
    }

    const aLead = segmentState(result.holes.slice(0, i + 1), segOpts).margin;
    const fromUserView = userTeam === "A" ? aLead : -aLead;
    // Coloured by the team that's ahead, not by whether that team is yours.
    // The bar directly above this number is painted in team colours — on a
    // Double Dot split hole it's literally half of each — so running the
    // number off a separate good-news/bad-news palette put two greens 2px
    // apart, BC.teamA under BC.green, saying nearly the same thing in two
    // different hues. The ▲/▼ still points from the reader's own side, which
    // is the part of "is this me" that a colour was never needed for.
    const leader = aLead > 0 ? "A" : aLead < 0 ? "B" : null;
    const color = leader ? teamColor(leader) : BC.t3;
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
  //
  // The ring on the current hole is an OUTLINE, which means it paints
  // outside the cell's box and takes up no room in the layout — so the
  // strip has to leave it some. It reaches three pixels into what was a
  // two-pixel gap, and what it reached into was the match-status row
  // directly below: the ring around 10 cut through the top of the back-nine
  // status card. Both the ring and that gap now come off HOLE_RING_REACH,
  // so they cannot drift apart again.
  const renderHoleCell = (h) => {
    const cur = h === activeHole;
    const allScored = matchPids.every(pid => getScore(pid, h) > 0);
    const partial = !allScored && matchPids.some(pid => getScore(pid, h) > 0);
    // The current hole wears the hole banner's colours — same fill, same
    // ink, ring included. They are the same claim made twice on one screen,
    // "this is the hole you are on", and saying it in a bright amber chip up
    // here and a deep one down there read as two different states rather
    // than one. Taken from HOLE_BANNER rather than copied off it, so the
    // pair cannot come apart the way it just did.
    const banner = HOLE_BANNER;
    return (
      <button key={h} onClick={() => goToHole(h)} style={{
        flex: 1, height: fit.holeCell, borderRadius: allScored || cur ? 8 : 6,
        border: allScored && !cur ? `1.5px solid ${BC.amber}${ALPHA.line}` : "none",
        background: cur ? banner.fill : allScored ? BC.amber + ALPHA.wash : partial ? BC.amber + ALPHA.wash : BC.card,
        color: cur ? banner.ink : allScored ? BC.amberInk : BC.t3,
        fontSize: fit.holeFont, fontWeight: 700, cursor: "pointer",
        outline: cur ? `${HOLE_RING.width}px solid ${banner.fill}` : "none",
        outlineOffset: HOLE_RING.offset,
      }}>{h + 1}</button>
    );
  };

  /* Which match this screen is pointed at. Two controls, because there are
     two reasons to move:

     PILLS, for the rare format that draws a player into more than one match
     in the SAME round. Labelled with the cup's number for each match, not
     its position in this player's own list — two players in the same match
     have to be looking at the same name for it.

     GROUP SWITCHER, for a director, over every group in every round. A row of
     pills does not survive eight matches, and the thing a director needs to
     find is not a number but a foursome, so it is a button that opens a list
     naming who is in each. It is kept SEPARATE from the pills below because
     it does not get a row of its own on this screen — it is a badge that
     rides on the app header, so the one director on the course does not cost
     every phone that is one 26px of score-button height all round.
     See components/GroupSwitcher. It is built further up, next to `shell`,
     because the empty states need it too.

     The pills do not cross rounds. The switcher does, and it is the only
     thing in the app that does — see "The director's way past it" above. */

  // Gated on `directorSwitching`, NOT on the portal: the slot is null for the
  // first render, and keying off that would flash a row of pills at a
  // director for one frame before the chip took over.
  const matchSelector = directorSwitching ? null : myMatches.length > 1 ? (
    <SegmentedToggle
      variant="pills"
      style={{ marginBottom: 10 }}
      options={myMatches.map((m, i) => [m.id, `Match ${m.matchNumber ?? i + 1}`])}
      value={match.id}
      onChange={switchToMatch}
    />
  ) : null;

  // ── The off-round banner ─────────────────────────────────────────────
  // The loudest of the three tells, and the only one that costs this screen
  // any height — which it is worth, because it is the one in the eyeline of
  // somebody typing. It renders ONLY when the screen is off the live round,
  // so a director working the round everybody is playing pays nothing for it
  // and sees exactly what they saw before this existed.
  //
  // The row says which state the screen is in and carries both moves a
  // director can want from it, as two separate hit targets:
  //
  //   the TEXT, left — back to the round the tournament is on. Somebody who
  //     opened Round 1 to fix one hole should not have to find the crown again
  //     to leave. When there is no live round to return to it is a plain span
  //     rather than a control that looks like it goes somewhere and does
  //     nothing.
  //   the BUTTON, right — the safety catch. Off, it reads Edit and arms the
  //     match; on, it reads Done and drops the arming. Tapping a score while
  //     it is off asks the same question, so this is the deliberate way in
  //     rather than the only one.
  //
  // Two buttons rather than one row that does both, because a nested button is
  // not a thing, and because "leave" and "start editing" are opposite enough
  // that sharing a hit target would be its own accident.
  const offRoundBanner = offRound ? (() => {
    const canReturn = currentRound != null;
    const state = LOCK_STATE_LABEL[roundLockState(roundLocks, match.round)];
    // Read-only is the resting state and it is stated in grey; armed is the
    // exception and it is the only one that gets the warn colour. The two must
    // not look alike at a glance — that glance is the whole feature.
    const tone = editLocked ? BC.t2 : BC.warn;
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 6, width: "100%",
        marginBottom: 8, padding: "5px 6px 5px 10px", borderRadius: 8, flexShrink: 0,
        background: editLocked ? BC.card : `${BC.warn}${ALPHA.wash}`,
        border: `1px solid ${editLocked ? `${BC.bdr}${ALPHA.line}` : `${BC.warn}${ALPHA.line}`}`,
        fontFamily: FONT,
      }}>
        <span aria-hidden="true" style={{ fontSize: FS.small, lineHeight: 1 }}>
          {editLocked ? "🔒" : "⚠️"}
        </span>
        {(() => {
          const inner = (
            <>
              <span style={{ display: "block", fontSize: FS.small, fontWeight: 800, letterSpacing: 0.5, color: tone }}>
                {editLocked ? `ROUND ${match.round} — ${state} · READ-ONLY` : `EDITING ROUND ${match.round} — ${state}`}
              </span>
              <span style={{ display: "block", fontSize: FS.label, color: BC.t3, lineHeight: 1.35 }}>
                {editLocked
                  ? (canReturn ? `Not the live round. Tap for Round ${currentRound}.` : "The event is over.")
                  : (canReturn
                    ? `Changes post straight away. Tap for Round ${currentRound}.`
                    : "Changes post straight away and move the final result.")}
              </span>
            </>
          );
          return canReturn ? (
            <button
              onClick={() => { setPickedRound(null); setActiveMatchId(null); }}
              style={{
                minWidth: 0, flex: 1, textAlign: "left", padding: "2px 0",
                background: "transparent", border: "none", cursor: "pointer", fontFamily: FONT,
              }}>
              {inner}
            </button>
          ) : (
            <span style={{ minWidth: 0, flex: 1 }}>{inner}</span>
          );
        })()}
        <button
          onClick={async () => {
            if (!editLocked) { setArmedMatchId(null); return; }
            const ok = await confirm({
              eyebrow: `Round ${match.round} · ${state}`,
              title: "Edit scores in a closed round?",
              message: [
                "This is not the round being played. Anything you change posts immediately and moves the leaderboard, and the players in this match are not asked.",
                "",
                "Editing stays on for this group until you tap Done or leave it.",
              ].join("\n"),
              confirmLabel: "Edit scores",
              destructive: true,
            });
            if (ok) setArmedMatchId(match.id);
          }}
          style={{
            flexShrink: 0, padding: "6px 10px", borderRadius: 6, cursor: "pointer", fontFamily: FONT,
            fontSize: FS.label, fontWeight: 800, letterSpacing: 0.5,
            background: editLocked ? BC.inp : `${BC.warn}${ALPHA.line}`,
            border: `1px solid ${editLocked ? BC.bdr : BC.warn}`,
            color: editLocked ? BC.t2 : BC.warn,
          }}>
          {editLocked ? "Edit" : "Done"}
        </button>
      </div>
    );
  })() : null;

  // ── The sealed-round banner ──────────────────────────────────────
  // Costs this screen a row, and only on the one round that is sealed. It is
  // worth it: without a line saying so, a status strip full of padlocks reads
  // as an app that has broken rather than a round that is being kept. It also
  // states the one thing a player on the 7th needs to know — keep entering
  // scores, the numbers are landing, you just aren't being shown the answer.
  const sealedBanner = conceal ? (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, width: "100%",
      marginBottom: 8, padding: "5px 10px", borderRadius: 8, flexShrink: 0,
      background: `${BC.amber}${ALPHA.wash}`, border: `1px solid ${BC.amber}${ALPHA.line}`,
      fontFamily: FONT,
    }}>
      <span aria-hidden="true" style={{ fontSize: FS.small, lineHeight: 1 }}>🔒</span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontSize: FS.small, fontWeight: 800, letterSpacing: 0.5, color: BC.amberInk }}>
          SEALED ROUND — {revealSummary(conceal.through)}
        </span>
        <span style={{ display: "block", fontSize: FS.label, color: BC.t3, lineHeight: 1.35 }}>
          Keep posting scores. Nobody sees the match until the reveal.
        </span>
      </span>
    </div>
  ) : null;

  // ── Signed: the card replaces the scoring screen ──
  // Not a banner over the score buttons — the buttons are gone, because a
  // signed card has no scores left to enter and the screen's whole budget
  // (see useFitDensity) is better spent showing the card that was signed.
  if (signed) return shell(
    <>
      {offRoundBanner}
      {sealedBanner}
      {matchSelector}
      <SignedCardPanel
        match={match} sig={sig} result={result} format={format}
        holePars={holePars} holeHcps={holeHcps} course={course}
        tPlayers={tPlayers} getScore={getScore} viewer={userTeam}
        userPid={userPid} notify={notify} isDirector={isDirector} conceal={conceal}
        onAttest={() => onAttestCard(match, userPid)}
        onUnsign={() => onUnsignCard(match)}
      />
    </>
  );

  return shell(
    <>
      {offRoundBanner}
      {sealedBanner}
      {matchSelector}

      {/* Front 9 — hole strip + status row. */}
      <div style={{ display: "flex", gap: 3, marginBottom: HOLE_RING_REACH + 1, flexShrink: 0 }}>
        {Array.from({ length: 9 }, (_, i) => renderHoleCell(i))}
      </div>
      {/* The one gap the ring reaches UP into: the back-nine strip follows
          this row, so on the densest phones — where fit.stack is 3 — the
          ring around 10 would rest on this card's border. */}
      <div style={{ display: "flex", marginBottom: Math.max(fit.stack, HOLE_RING_REACH + 1), flexShrink: 0, background: BC.card, border: `1px solid ${BC.bdr}${ALPHA.line}`, borderRadius: 8, padding: `${fit.statusPad}px 0`, alignItems: "center" }}>
        {Array.from({ length: 9 }, (_, i) => renderStatusCell(i))}
      </div>

      {/* Back 9 — hole strip + status row. */}
      <div style={{ display: "flex", gap: 3, marginBottom: HOLE_RING_REACH + 1, flexShrink: 0 }}>
        {Array.from({ length: 9 }, (_, i) => renderHoleCell(i + 9))}
      </div>
      <div style={{ display: "flex", marginBottom: fit.stack, flexShrink: 0, background: BC.card, border: `1px solid ${BC.bdr}${ALPHA.line}`, borderRadius: 8, padding: `${fit.statusPad}px 0`, alignItems: "center" }}>
        {Array.from({ length: 9 }, (_, i) => renderStatusCell(i + 9))}
      </div>

      {/* Full Scorecard — sits ABOVE the hole banner (MNQ's placement) so
          it's reachable without scrolling past four player cards. Slim
          bar styling keeps the vertical cost near zero.

          It is also the sign entry point. Once every player in the match has
          all eighteen, this same button promotes to the amber "Complete —
          Sign Card" CTA and opens the sign sheet instead of the read-only
          scorecard. One button doing two jobs is deliberate: a second,
          permanent Sign button would cost the score buttons a row for the
          entire round to be tappable at the end of it, which is the exact
          trade the Finalize card lost. */}
      <button onClick={() => (canSign ? setShowSign(true) : setShowScorecard(true))} style={{
        width: "100%", padding: canSign ? "9px 0" : fit.scorecardPad, borderRadius: 8,
        marginBottom: fit.stack, cursor: "pointer", flexShrink: 0, fontFamily: FONT,
        background: canSign ? BC.amberGlow : BC.card,
        border: `1px solid ${canSign ? BC.amber : BC.bdr}${ALPHA.line}`,
        color: canSign ? BC.amberInk : BC.t2,
        fontSize: canSign ? FS.body : FS.small,
        fontWeight: canSign ? 800 : 700, letterSpacing: 0.5,
      }}>
        {canSign ? "Complete — Sign Card" : "Full Scorecard"}
      </button>

      {/* Why the button hasn't promoted — but only for holes the group has
          actually played (lib/cardSigs missingForCard). A hole nobody has
          posted is a hole ahead of them, not a gap behind them, so this
          stays quiet through a normal round and speaks up when somebody has
          genuinely been skipped. The "has anyone started" guard this used to
          carry is now implied: with no played holes there is nothing to
          report. */}
      {missingCard.length > 0 && (
        <MissingCardNote missing={missingCard} nameOf={(pid) => tPlayers.find(p => p.player_id === pid)?.name || pid} />
      )}

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
          color: nm ? BC.amberInk : BC.t3,
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
                {/* `team` here is the side of THIS match, not the roster row —
                    they agree in every real draw, and the match is the thing
                    on screen. */}
                <span style={{ fontSize: FS.body, fontWeight: 700, color: BC.t1, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flexShrink: 1 }}>
                  <PlayerName name={tp?.name || pid} team={team} />
                </span>
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

      {/* The sign sheet — the card in full, then one button. Handed the
          same resolved pieces the scorecard modal below gets, so what a
          player signs is exactly what they have been looking at. */}
      {showSign && (
        <SignCardSheet
          match={match} result={result} format={format}
          holePars={holePars} holeHcps={holeHcps} course={course}
          tPlayers={tPlayers} getScore={getScore} viewer={userTeam} conceal={conceal}
          onClose={() => setShowSign(false)}
          onSign={async () => {
            const res = await onSignCard(match, userPid);
            if (res) {
              setShowSign(false);
              notify("Card signed — waiting on the others to attest", "success");
            } else {
              notify("Could not sign the card — try again", "error");
            }
          }}
        />
      )}

      {/* Scorecard modal — the MNQ-framed card (components/FullScorecard),
          not the Leaderboard's team-only grid: this one is opened by a
          player mid-round, so it shows the four GROSS lines in golf
          notation with their stroke dots, then how the side's number was
          made from them. */}
      {showScorecard && (
        <Popup onClose={() => setShowScorecard(false)} maxWidth={480} padding={0} outerPadding={12}
          innerStyle={{ background: BC.card, border: `1px solid ${BC.amber}${ALPHA.line}`, borderRadius: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: `1px solid ${BC.bdr}` }}>
            <div style={{ fontSize: FS.small, fontWeight: 800, color: BC.amberInk, letterSpacing: 1 }}>
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
              tPlayers={tPlayers} getScore={getScore}
              viewer={userTeam} conceal={conceal}
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

  // Same fallback the admin tab uses: a 2-man format's match is its own
  // foursome, so a round nobody has grouped by hand still has tee times.
  const { groups, times: rawSlots } = roundPlaySetup({
    tr, matches: rndMatches, storedGroups: groupsByRound?.[activeRound],
  });
  const times = rawSlots
    .map(t => { const m = parseTeeTime(t); return m == null ? t : formatTeeTime(m, { ampm: true }); });

  const { nameOf } = playerLookup(tPlayers);

  // Matches read best in the order they go off — which is also the order
  // their numbers were handed out in, so the cards below count up.
  const ordered = orderMatchesForRound({ matches: rndMatches, groups, times });

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

      {/* Round banner — named by where and what it is, the same way the
          Leaderboard names its rounds ("Treetops · 2-Man Best Ball"). The
          round number is already the pill the reader just tapped, and the
          setup detail that used to sit under it — format blurb, counting
          rule, hole points, first tee — is either on the Rounds tab or
          repeated below: every match card carries its own tee time, and so
          does every row of the tee sheet. */}
      <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, marginBottom: 12, overflow: "hidden" }}>
        <Banner>{[course?.name || "Course TBD", fmt?.label].filter(Boolean).join(" · ").toUpperCase()}</Banner>
      </div>

      {/* A set-up round with no draw yet. The banner above still names the
          course and format — the only thing missing is who plays who, so
          that is the only thing this says. */}
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
  r.hole_points, r.par_points, r.sealed,
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

// What the blackout switch OPENS AT on a round that has never carried it —
// on for the one format the reveal exists for, off for every other. See
// lib/reveal.js.
//
// Unlike the allowance and the counting scores above, this one is deliberately
// NOT applied to both sides of the auto-save diff. Those are read back through
// their normalizer everywhere they matter, so an unwritten default is a real
// default. This isn't: the leaderboard reads `sealed` off the round DOCUMENT,
// and a default that only exists inside a form the field never opens is not a
// default, it is a form that disagrees with the board. So the seeded value
// lands on the form, differs from the empty document, and is written — which
// is also what makes the switch mean something the first time a director
// looks at it.
//
// `final` is the guard on the other end: a round already in the books seeds
// OFF, so opening a finished tournament's Rounds tab can never black out a
// result the field has already seen. It only applies to the SEED — once the
// flag is stored the stored value wins, which is what keeps a sealed round
// from un-sealing itself the moment it is finalized. The reveal happens after
// the round is over; that is the entire point of it.
const roundSealedSeed = (format, raw, final) =>
  raw == null ? (!final && sealDefaultFor(format)) : !!raw;

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
// The Rounds tab's player grid: name | HI | Round CH | tee | delta. Declared
// once because the header row, and every player row under it, have to agree —
// they were built from the same template string in three places, which is how
// the header and the rows drifted apart the last time a column moved.
const ROUND_PLAYER_COLS = "1fr 30px 58px 30px 22px";

// A rule and a name, nothing else. Each of these used to carry a sentence
// underneath it — "How each side's number for a hole is arrived at." under a
// heading reading HOLE SCORING — and six of them stacked down the round form,
// pushing the controls they were describing off the screen.
// Always a divider now. There was a `first` variant that dropped the rule and
// the spacing, for the one heading that opened the card — that heading is gone
// (the round pills above it already name the round), so every remaining one is
// separating a group of settings from the group before it.
function RoundSectionHeading({ children }) {
  return (
    <div style={{ marginTop: 14, marginBottom: 8, paddingTop: 12, borderTop: `1px solid ${BC.bdr}` }}>
      <div style={{ fontSize: FS.label, fontWeight: 800, letterSpacing: 1.4, color: BC.gold }}>{children}</div>
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

function AdminView({ user, tPlayers, memberships, onSetDirector, tRounds, courses, matches, onAddPlayer, onUpdatePlayer, onRemovePlayer, onAddCourse, onSetRound, onSetMatch, holeData, onDiscardRoundScores, teams, teamNames, onSaveTeamNames, brand, onSaveBranding, tournamentName, tournamentLocation, onSaveTournament, hcpOverridesFromDb, teeAssignmentsFromDb, groupsFromDb, onSaveGroups, notify, roundLocks }) {
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
  // The input always starts empty and always means "the NEW one" — unlike
  // its neighbours it is never seeded from the saved value, because typing
  // over a pre-filled password is how you change it by accident. The
  // current code is shown separately, and only when asked for.
  const [editAccessCode, setEditAccessCode] = useState("");
  const [savedAccessCode, setSavedAccessCode] = useState(null);
  const [accessCodeError, setAccessCodeError] = useState("");
  const [showAccessCode, setShowAccessCode] = useState(false);
  const loadAccessCode = useCallback(async () => {
    const res = await readAccessCode();
    setSavedAccessCode(res.ok ? res.code : null);
    setAccessCodeError(res.ok ? "" : res.error);
    setShowAccessCode(true);
  }, []);
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
  // The course library, opened from the round it is about to be assigned to.
  const [coursePicker, setCoursePicker] = useState(false);
  const searchTimerRef = useRef(null);

  const [editRound, setEditRound] = useState(1);
  const [roundFormat, setRoundFormat] = useState("");
  const [roundTeeTime, setRoundTeeTime] = useState("");
  const [hcpOverrides, setHcpOverrides] = useState({});
  const [handicapMode, setHandicapMode] = useState({ 1: "low_man", 2: "low_man", 3: "low_man", 4: "full" }); // per round
  const [chDeltas, setChDeltas] = useState({});
  const [editingPlayer, setEditingPlayer] = useState(null); // { pid, first, last, nick, hi, ov, dir }
  const [teeAssignments, setTeeAssignments] = useState({}); // { round: { pid: teeName } }
  // Which player's row is open for a tee of their own. One at a time: two open
  // rows is two lists of the same swatches on screen with nothing saying which
  // belongs to whom.
  const [teeRowOpen, setTeeRowOpen] = useState(null); // player_id | null
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
  // Whether the round is sealed (lib/reveal.js). A concrete boolean rather
  // than the null-means-default the four above use: "is this round shown to
  // the field" is not a scoring detail with a recommended value, it is a yes
  // or a no, and the seeding that picks the opening answer happens once in
  // roundSealed rather than on every read.
  const [sealed, setSealed] = useState(false);
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
      // Raw, so the auto-save diff compares the form against what Firestore
      // actually holds. `sealed_seed` is what an unwritten round OPENS at and
      // is never part of the signature — see roundSealedSeed.
      sealed: !!tr.sealed,
      sealed_seed: roundSealedSeed(fmt, tr.sealed, roundIsFinal),
      ch_overrides: hcpOverridesFromDb?.[editRound] || {},
      tee_assignments: teeAssignmentsFromDb?.[editRound] || {},
    };
  }, [tRounds, editRound, hcpOverridesFromDb, teeAssignmentsFromDb, roundIsFinal]);

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
      sealed,
      ch_overrides: hcpOverrides[editRound] || {},
      tee_assignments: teeAssignments[editRound] || {},
    };
  }, [storedRound, roundFormat, handicapMode, editRound, roundTeeTime, nassau, scoringType, holeScoring, allowance, counting, holePoints, parPoints, sealed, hcpOverrides, teeAssignments]);

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
    setSealed(storedRound.sealed_seed);
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
        // `reveal_through` is deliberately absent — the reveal is driven from
        // the scoreboard and must never move because somebody edited a tee
        // time. See onSetReveal in App and lib/reveal.js.
        sealed: payload.sealed,
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

  // Assigning a course rewrites the round document, so every field it already
  // carries has to ride along — a bare course_id write would blank the format
  // and the tee times with it.
  const assignCourseToRound = async (r, courseId) => {
    const tr = tRounds.find(t => t.round_number === r);
    await onSetRound({
      id: editionDocId(`bc_round_${r}`), tournament_id: TOURNAMENT_ID,
      round_number: r, course_id: courseId,
      format: tr?.format || DEFAULT_FORMAT, tee_time: tr?.tee_time || "",
      nassau_front: tr?.nassau_front || 1, nassau_back: tr?.nassau_back || 1,
      nassau_overall: tr?.nassau_overall || 1,
    });
  };

  // The saved library, filtered by the same box that queries the API — so a
  // course you already have surfaces above the search results rather than
  // being added a second time.
  const courseQuery = courseSearch.trim().toLowerCase();
  const libraryCourses = courseQuery.length >= 2
    ? courses.filter(c => (c.name || "").toLowerCase().includes(courseQuery) || (c.city || "").toLowerCase().includes(courseQuery))
    : courses;

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
        options={[["players","Players"],["rounds","Rounds"],["matches","Matches"],["tournament","Tournament"]]}
        value={tab}
        onChange={setTab}
      />
      </StickyTop>

      {tab === "players" && (
        <div>
          {[teams.A, teams.B].map(team => (
            <div key={team.id} style={{ marginBottom: 10 }}>
              {/* Team header, laid out on the PLAYER ROW's columns rather than
                  on its own: same 8px gutters, same 52% name block, same 56px
                  slot after it. That is what lets the GHIN control below sit
                  over the numbers it acts on instead of merely near them. */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, padding: "8px 8px", background: team.color + ALPHA.tint, borderRadius: 10, border: `1px solid ${team.accent}${ALPHA.line}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, flexBasis: "52%", flexGrow: 0, flexShrink: 1, minWidth: 0 }}>
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
                    style={{ fontSize: FS.small, fontWeight: 800, color: team.accent, letterSpacing: 1, flex: 1, minWidth: 0, cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  >{teamNames[team.id].toUpperCase()}</span>
                )}
                </div>
                {/* The handicap column's head. The batch GHIN re-sync is the
                    only thing that acts on that whole column, so it IS the
                    header — a dedicated row for one icon was a row of mostly
                    nothing. It syncs every linked player in the tournament,
                    not team A's: it is over the column, not inside the team,
                    and the prompt it raises says so before anything is
                    written. Team B's header keeps the empty slot so both
                    headers stay on the same columns as the rows. */}
                <span style={{ display: "inline-flex", alignItems: "center", width: 56, flexShrink: 0 }}>
                  {team.id === "A" && (
                    <GhinSyncButton players={tPlayers} onUpdatePlayer={onUpdatePlayer} notify={notify} confirm={confirm} compact />
                  )}
                </span>
                <span style={{ flex: 1, minWidth: 8 }} />
                {/* + Add button, over the rows' Edit */}
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
                      {/* Drawn from the membership document, which is the
                          flag the security rules check. Not from the
                          roster, which cannot be checked by them and would
                          be free to disagree. */}
                      {playerIsDirector(memberships, p) && <span title="Tournament director" style={{ fontSize: FS.small, flexShrink: 0, lineHeight: 1 }}>👑</span>}
                      {/* Whether this name has been claimed by a sign-in.
                          The director is the only person who can answer
                          "why can't I pick my own name" (somebody else
                          claimed it, or they claimed it on a different
                          account), so the answer lives where they are. */}
                      {isClaimed(p) && <span title={`Signed in as ${accountLabel(p)}`} style={{ fontSize: FS.label, flexShrink: 0, lineHeight: 1, opacity: 0.75 }}>🔗</span>}
                    </div>
                    {/* Index column doubles as the sync-status glyph: amber * =
                        override, blue G = synced from GHIN, plain = manual. */}
                    <span title={overridden ? `Director override — GHIN/base index is ${p.handicap_index}` : (synced ? "Synced from GHIN" : "Manual index")}
                      style={{ display: "inline-flex", alignItems: "center", gap: 4, width: 56, flexShrink: 0 }}>
                      <span style={{ fontSize: FS.small, fontWeight: overridden ? 700 : 500, color: overridden ? BC.amberInk : playerNameColor() }}>
                        {effHI}{overridden ? "*" : ""}
                      </span>
                      {synced && <span style={{ fontSize: FS.micro, fontWeight: 800, letterSpacing: 0.2, color: BC.hcpBlue, border: `1px solid ${BC.hcpBlue}${ALPHA.line}`, background: BC.hcpBlue + ALPHA.tint, borderRadius: 3, padding: "1px 3px", lineHeight: 1 }}>G</span>}
                    </span>
                    <span style={{ flex: 1, minWidth: 8 }} />
                    <button onClick={() => setEditingPlayer({ pid: p.player_id, team: p.team, first: p.first_name || (p.last_name ? "" : (p.name || "")), last: p.last_name || "", nick: p.name || "", hi: String(p.handicap_index), ov: (p.hi_override != null && String(p.hi_override).trim() !== "") ? String(p.hi_override) : "", dir: playerIsDirector(memberships, p) })} style={{
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
            // Follows the form, not the saved document, so switching team in
            // the editor recolours the sheet as you tap rather than after Save.
            const acc = (teams[editingPlayer.team] || teams[p?.team] || teams.A).accent;
            const defaultNick = toDisplayName(editingPlayer.first, editingPlayer.last);
            const linked = !!editingPlayer.ghin_number;
            // Who this row's crown can be changed by, and why not.
            // Mirrors the rules exactly (firestore.rules, bc_accounts
            // update) so the button is never offered for a write that
            // would come back refused.
            const theirMembership = isNew ? null : membershipFor(memberships, p);
            const isSelf = !!theirMembership && theirMembership.uid === user?.auth_uid;
            const canGrantDirector = !isNew && !!theirMembership && !isSelf;
            // Four different reasons the toggle can be unavailable, and
            // they want four different actions from the director. Telling
            // them apart matters most for the last one: an empty accounts
            // list looks exactly like "nobody has signed in", and the fix
            // is nothing to do with the player on screen.
            const directorHint = isNew
              ? "Add them first, then they sign in and claim this name."
              : accountsUnreadable(memberships)
                ? "Can't read the accounts list, so no crown can be changed. The rules deployed to Firebase are probably older than this app — re-publish firestore.rules, then reopen this."
                : !theirMembership
                  ? (isClaimed(p)
                      ? "They've claimed this name but haven't been through the password screen on this build yet — ask them to open the app once."
                      : "They need to sign in and claim this name first.")
                  : isSelf
                    ? "You can't change your own — that's what stops the last director locking everyone out. Ask the other director, or edit it in the Firebase console."
                    // The toggle is available and says Director. Every other
                    // branch above explains why it ISN'T; this one was just
                    // describing what the word means.
                    : null;
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
                  handicap_index: parseFloat(editingPlayer.hi) || 0, hi_override: newOv, ...ghinFields });
                notify(`Added ${newName}`, "success");
                close();
                return;
              }
              const changes = [];
              const newTeam = editingPlayer.team || p.team;
              const teamChanged = newTeam !== p.team;
              if (teamChanged) changes.push(`Team: ${teamNames[p.team]} → ${teamNames[newTeam]}`);
              if (first !== (p.first_name||"") || last !== (p.last_name||"") || newName !== p.name)
                changes.push(`Name → ${fullName({ first_name: first, last_name: last })} (shows as "${newName}")`);
              const baseChanged = parseFloat(editingPlayer.hi) !== parseFloat(p.handicap_index);
              if (baseChanged) changes.push(`Index: ${p.handicap_index} → ${editingPlayer.hi}`);
              const oldOv = (p.hi_override != null && String(p.hi_override).trim() !== "") ? (parseFloat(p.hi_override) || 0) : null;
              if (newOv !== oldOv) changes.push(`Override: ${oldOv == null ? "—" : oldOv} → ${newOv == null ? "— (use index)" : newOv}`);
              const wasDir = playerIsDirector(memberships, p);
              const dirChanged = canGrantDirector && newDir !== wasDir;
              if (dirChanged) changes.push(`Director: ${wasDir ? "Yes" : "No"} → ${newDir ? "Yes" : "No"}`);
              if ((editingPlayer.ghin_number || null) !== (p.ghin_number || null))
                changes.push(editingPlayer.ghin_number ? `GHIN: linked #${editingPlayer.ghin_number}` : "GHIN: unlinked");
              const cutSignIn = !!editingPlayer.unlink && isClaimed(p);
              if (cutSignIn) changes.push(`Sign-in: unlink ${accountLabel(p)} — they'll pick their name again next time they open the app`);
              if (changes.length === 0) { close(); return; }
              const oldEff = oldOv != null ? oldOv : (parseFloat(p.handicap_index) || 0);
              const newEff = newOv != null ? newOv : (parseFloat(editingPlayer.hi) || 0);
              let impact = oldEff !== newEff ? "\n\n" + describeHiChangeImpact(roundLocks, [1,2,3,4]).text : "";
              // The half of a team move this console cannot do for you. A match
              // holds its players in teamA/teamB arrays of its own, so a player
              // already drawn stays on the side they were drawn into no matter
              // what their roster row says — and nothing on screen would tell
              // the director that until the scoring looked wrong.
              if (teamChanged) {
                const drawn = [...new Set((matches || [])
                  .filter(m => matchPlayers(m).includes(p.player_id))
                  .map(m => m.round))].sort((a, b) => a - b);
                impact += drawn.length
                  ? `\n\nRound ${drawn.join(", ")} already has them drawn into a match on their old side. Moving them here does not redraw it — sort that out on the Matches tab.`
                  : "\n\nNo match has been drawn for them yet, so there is nothing else to change.";
              }
              if (dirChanged) impact += newDir
                ? "\n\nA director can do everything in Admin: the roster, rounds, matches, courses, groups, tee times, settings, editions and the access password."
                : "\n\nThey keep their name and everything a player does — scores, skins, signatures. They lose the Admin tab.";
              if (await confirm({ title: "Confirm changes", message: changes.join("\n") + impact })) {
                onUpdatePlayer({ ...p, team: newTeam, name: newName, first_name: first, last_name: last, handicap_index: parseFloat(editingPlayer.hi) || 0, hi_override: newOv, ...ghinFields, ...(cutSignIn ? unlinkPatch() : {}) });
                // A separate document, and one the rules police, so it is
                // reported separately: the roster edit above can succeed
                // while this is refused.
                if (dirChanged) {
                  const res = await onSetDirector(theirMembership.uid, newDir);
                  if (!res.ok) notify(res.error, "error");
                  else notify(newDir ? `${newName} is a director` : `${newName} is no longer a director`, "success");
                }
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
                  {/* ── Team ──
                      The one thing about a player this console could not
                      change. Moving somebody between sides meant deleting them
                      from one and adding them to the other — which mints a new
                      player_id, so it cut their sign-in and stranded every
                      score already keyed to the old id.

                      Here it is one tap and the id never moves, so scores,
                      signatures and their sign-in all come with them.

                      Not drag-and-drop: the roster rows already own the swipe
                      gesture, and a long-press-drag between two lists on a
                      phone is the fiddliest way to answer an A-or-B question. */}
                  <div>
                    <span style={lbl}>Team</span>
                    <div style={{ display: "flex", gap: 8 }}>
                      {[teams.A, teams.B].map(t => {
                        const on = editingPlayer.team === t.id;
                        return (
                          <button key={t.id} type="button" onClick={() => set({ team: t.id })}
                            style={{
                              flex: 1, minWidth: 0, fontSize: FS.body, fontWeight: 700,
                              padding: "7px 10px", borderRadius: 8, cursor: "pointer",
                              boxSizing: "border-box", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                              border: `1px solid ${on ? t.accent : BC.bdr}`,
                              background: on ? t.accent + ALPHA.wash : "transparent",
                              color: on ? t.accent : BC.t2,
                            }}>
                            {teamNames[t.id]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {/* Nickname + Director paired on one row, like First/Last. */}
                  <div style={{ display: "flex", gap: 8 }}>
                    <label style={{ flex: 1, minWidth: 0 }}><span style={lbl}>Nickname</span>
                      <input value={editingPlayer.nick} placeholder={defaultNick} onChange={e => set({ nick: e.target.value })} style={inp} /></label>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* This IS the grant — it writes is_director on their
                          membership document, which is the only flag the
                          security rules honour. Two things it cannot do,
                          both enforced by those rules rather than here:
                          appoint somebody who has never signed in (there is
                          no membership document to flag), and change your
                          own (so the last director can never remove
                          themselves). */}
                      <span style={lbl}>Director</span>
                      <button type="button"
                        disabled={!canGrantDirector}
                        title={directorHint}
                        onClick={() => set({ dir: !editingPlayer.dir })}
                        style={{ fontSize: FS.body, fontWeight: 700, padding: "7px 10px", borderRadius: 8, cursor: canGrantDirector ? "pointer" : "default", width: "100%", boxSizing: "border-box", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: canGrantDirector ? 1 : 0.5,
                          border: `1px solid ${editingPlayer.dir ? BC.amber : BC.bdr}`, background: editingPlayer.dir ? BC.amber + ALPHA.wash : "transparent", color: editingPlayer.dir ? BC.amberInk : BC.t2 }}>
                        {editingPlayer.dir ? "👑 Director" : "Player"}
                      </button>
                    </div>
                  </div>
                  {!isNew && !canGrantDirector && (
                    <div style={{ fontSize: FS.label, color: BC.t3, marginTop: -6, lineHeight: 1.4 }}>{directorHint}</div>
                  )}
                  {/* The sign-in bound to this name. Read-only apart from
                      cutting it: there is nothing to type here, because the
                      link is made by the player signing in and tapping
                      their own name, never by the director assigning one.
                      Unlinking is the fix for the two things that do go
                      wrong — somebody claimed the wrong name, or somebody
                      changed phones and lost the account they used. Like
                      the GHIN link above, it only writes into the form;
                      Save commits it. */}
                  {!isNew && isClaimed(p) && (
                    <div>
                      <span style={lbl}>Signed in as</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, background: BC.inp, border: `1px solid ${editingPlayer.unlink ? BC.danger : BC.bdr}${ALPHA.line}` }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: FS.small, fontWeight: 600, color: editingPlayer.unlink ? BC.t3 : BC.t2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: editingPlayer.unlink ? "line-through" : "none" }}>
                          {accountLabel(p)}
                        </span>
                        <button type="button" onClick={() => set({ unlink: !editingPlayer.unlink })}
                          style={{ flexShrink: 0, fontSize: FS.label, fontWeight: 700, padding: "4px 9px", borderRadius: 6, cursor: "pointer",
                            border: `1px solid ${editingPlayer.unlink ? BC.amber : BC.danger}${ALPHA.line}`, background: "transparent", color: editingPlayer.unlink ? BC.amberInk : BC.danger }}>
                          {editingPlayer.unlink ? "Keep" : "Unlink"}
                        </button>
                      </div>
                    </div>
                  )}
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
                      <span style={{ ...lbl, color: BC.amberInk }}>Override</span>
                      <input type="number" inputMode="decimal" value={editingPlayer.ov} placeholder={String(p ? p.handicap_index : (editingPlayer.hi || ""))} onChange={e => set({ ov: e.target.value })}
                        style={{ ...inp, border: `1px solid ${BC.amber}${ALPHA.line}`, color: BC.amberInk }} />
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
            {/* No heading on the first section. The round pills sit directly
                above this card and already say which round it is — "THE ROUND"
                under them named the thing you had just selected. The sections
                further down still carry headings, because those separate one
                group of settings from the next. */}
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
                  {FORMATS.map(f => <option key={f.id} value={f.id} title={f.desc}>{f.label}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: FS.small, fontWeight: 700, color: BC.gold, marginBottom: 6 }}>COURSE</div>
                {/* Was a dead read-only box saying "Set in Courses tab". Picking
                    a course is a ROUND decision, so it is made here now, in the
                    round it acts on — the library opens over this field instead
                    of living in a tab of its own. */}
                {(() => {
                  const tr = tRounds.find(t => t.round_number === editRound);
                  const course = courses.find(c => c.id === tr?.course_id);
                  return (
                    <button onClick={() => setCoursePicker(true)} style={{
                      width: "100%", padding: "8px 8px", background: BC.inp, borderRadius: 8,
                      border: `1px solid ${course ? BC.bdr : BC.amber + ALPHA.line}`,
                      fontSize: FS.small, color: course ? BC.t1 : BC.amberInk, height: 38,
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4,
                      overflow: "hidden", cursor: "pointer", textAlign: "left", fontFamily: FONT,
                    }}>
                      <span style={{ fontWeight: course ? 400 : 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {course ? course.name : "Choose..."}
                      </span>
                      <span style={{ color: BC.t3, flexShrink: 0 }}>›</span>
                    </button>
                  );
                })()}
              </div>
            </div>

            {/* The format's own sentence (FORMATS.desc) used to print here, in
                full, on every round. It is still on each <option>'s title for
                anyone who wants it — but a director choosing "Four-Ball" knows
                what a four-ball is, and a paragraph restating it sat between
                the format and the tee times on every visit. */}

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
            <RoundSectionHeading>
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
              // A fixed format decides this itself, so there is nothing here to
              // set. It used to print the rule anyway, under a label, with no
              // control beside it — a row that could not be acted on. A section
              // holding no decision is not on the page at all now.
              //
              // The exception is a round that arrived already overridden:
              // hiding the control there would leave a setting that is actively
              // scoring the round with no way to see or clear it, so it stays,
              // in amber, with a way back.
              if (fixed && !stray) return null;
              // Pills name the METHODS on offer, not Off/On against a control
              // labelled with a format's name — "Best Ball: Off" read as a
              // claim about what the round IS, rather than as a choice between
              // two ways to score a hole.
              const pills = stray
                ? [{ id: fmtId, label: fmt?.label || "Format", value: HOLE_SCORING_FORMAT },
                   { id: HOLE_SCORING_BEST_BALL, label: "Best Ball", value: HOLE_SCORING_BEST_BALL }]
                : options.map(m => ({ id: m, label: HOLE_METHOD_LABELS[m] || m, value: m }));
              const current = stray ? HOLE_SCORING_BEST_BALL : resolveHoleMethod(fmtId, holeScoring);
              // Same selected-segment object the tab bars use, at the inline
              // size — see theme.segThumb. These rows are the same control as the
              // tab bar above them and used to be drawn three separate ways.
              const bbPill = (active) => ({
                padding: "4px 12px 6px", fontSize: FS.label, fontWeight: 700, cursor: "pointer",
                ...segThumb(active, { compact: true }),
              });
              return (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    {lbl}
                    <div style={segTrack({ compact: true })}>
                      {pills.map(p => (
                        <button key={p.id} onClick={() => setHoleScoring(p.value)}
                          title={HOLE_METHOD_DESCRIPTIONS[p.value] || describeHoleScore(fmtId, p.value)}
                          style={bbPill(current === p.value)}>{p.label}{current === p.value && <SegRule compact />}</button>
                      ))}
                    </div>
                  </div>
                  {/* The pills name the methods, so the sentence restating the
                      selected one is gone. What stays is the override warning:
                      that is not a description of a control, it is the round
                      not scoring the way its format's name says. */}
                  {stray && (
                    <div style={{ fontSize: FS.label, color: BC.amberInk, lineHeight: 1.5, marginTop: 5 }}>
                      Overriding {fmt?.label || "the format"} — holes score as each side's best net ball.
                    </div>
                  )}
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
                            color: capped ? BC.amberInk : undefined,
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
                  {/* Only the over-count case says anything now. What the grid
                      DOES ("the sum of the side's best N nets") is what a grid
                      of per-hole counts under a heading reading COUNTING
                      already shows; what it can't show is that some of those
                      numbers are higher than there are players to honour them. */}
                  {over && (
                    <div style={{ fontSize: FS.label, color: BC.amberInk, lineHeight: 1.5, marginTop: 5 }}>
                      Only {sideSize} play{sideSize === 1 ? "s" : ""} a side — anything above {sideSize} scores as {sideSize}.
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── Points against par ──────────────────────────────────────
                The two formats that score a hole by what it was against PAR
                rather than against the other side. Both sit under HOLE SCORING
                because that is the decision they make: the table IS how a
                hole's number is arrived at.

                Both tables are the director's to set, and they are different
                games — different RUNGS as well as different values, which is
                why the row is built from the format's own ladder rather than
                one shared list. Stableford prices a hole four under and a
                triple bogey; Tilt's harsher ladder stops at albatross and
                double, and the bottom rung of each carries the "+" that says
                it swallows everything below it. What Tilt's table cannot
                express — the multiplier that rides on a birdie streak — is
                stated underneath, because those rules are the game rather than
                a setting. */}
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
                    {parResultsFor(fmtId).map(k => (
                      <div key={k} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                        <span style={{ fontSize: FS.label, color: BC.t3, fontWeight: 600 }}>{parResultLabel(fmtId, k)}</span>
                        <input
                          type="number" step="1"
                          value={val(k)}
                          onChange={e => setRung(k, e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
                          style={{ ...InputStyle, marginBottom: 0, padding: "4px 3px", fontSize: FS.body, textAlign: "center", width: 40 }} />
                      </div>
                    ))}
                  </div>
                  {/* The rungs are labelled Eagle/Birdie/Par/… and hold the
                      number each pays — the sentence that used to restate that
                      is gone, and so is Tilt's escalating-multiplier rule,
                      which belongs to the format rather than to these boxes. */}
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
                padding: "4px 12px 6px", fontSize: FS.label, fontWeight: 700,
                cursor: disabled ? "not-allowed" : "pointer",
                ...segThumb(active, { compact: true }),
                ...(disabled && !active ? { color: BC.t3 + ALPHA.line } : null),
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
              // Which forms this format offers. Only the accrual axis changes
              // with the format — the running total is strokes on most, dots on
              // Double Dot, points on Stableford and Tilt — so the pill is
              // called "Stroke" only where that is what it counts, and "Total"
              // everywhere else. A director who read "Medal" on a Double Dot
              // round had every reason to think it meant strokes.
              //
              // That naming is why the sentence that used to sit under these
              // pills is gone: the label is the explanation now. Keep it that
              // way — a pill that needs a paragraph is a pill with the wrong
              // name on it.
              const offered = formsFor(formRound.format);
              const current = resolveFormOfPlay(formRound.format, scoringType);
              return (
                <>
                  <RoundSectionHeading>
                    FORM OF PLAY
                  </RoundSectionHeading>
                  <div style={{ ...segTrack({ compact: true }), alignSelf: "flex-start", width: "fit-content", marginBottom: 5 }}>
                    {offered.map(f => (
                      <button key={f} onClick={() => setScoringType(f)} title={describeFormOfPlay(f, formRound.format)}
                        style={pill(current === f, false)}>{formOfPlayLabel(f, formRound.format)}{current === f && <SegRule compact />}</button>
                    ))}
                  </div>

                  <RoundSectionHeading>
                    POINTS AT STAKE
                  </RoundSectionHeading>
                  <div style={{ marginBottom: 12 }}>
                    {/* Single vs Nassau — pots only, so a Points round has no
                        use for it and it stands down rather than sitting there
                        offering a choice that changes nothing. */}
                    {!perHole && (
                      <div style={{ ...segTrack({ compact: true }), width: "fit-content", marginBottom: 8 }}>
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
                          ? `${nassau.overall || 0} on the round`
                          : `${(nassau.front || 0) + (nassau.back || 0) + (nassau.overall || 0)} on the round`}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}

            {/* ── The Final Countdown ────────────────────────────────────
                The Bourbon Cup's closing round is played in the dark: scored
                live on the course like any other, shown to nobody until
                everyone is back at the house and the holes are turned over
                one at a time on the television. See lib/reveal.js and
                components/FinalCountdown.

                It is a per-round switch rather than a property of the format
                because sealing a round is a decision about the DAY, not about
                how a hole is scored — and because a director needs to be able
                to turn it off in the year somebody wants the last round live.
                It opens ON for Team Best Ball and OFF for everything else.

                What is NOT here: how far the countdown has got. That is driven
                from the Leaderboard, in front of the room, and putting it on
                a tab that auto-saves would make giving the ending away a
                side effect of editing a tee time. */}
            <RoundSectionHeading>
              THE FINAL COUNTDOWN
            </RoundSectionHeading>
            {(() => {
              const seal = revealState(tRounds, editRound);
              const pill = (active) => ({
                padding: "4px 12px 6px", fontSize: FS.label, fontWeight: 700, cursor: "pointer",
                ...segThumb(active, { compact: true }),
              });
              // The one control on this tab that still writes on a FINAL
              // round. Everything else here allocates strokes or prices a
              // match, and a finished round answers to its snapshot for all
              // of that — but the seal decides only whether a result has been
              // SHOWN, and by the time the reveal matters the round is always
              // over. Locking it with the rest would mean a director who left
              // round 4 open had no way back but the Firebase console.
              //
              // It writes directly rather than through the auto-save, because
              // that path stands down entirely on a final round.
              const setSeal = (next) => {
                setSealed(next);
                if (!roundIsFinal) return;
                onSetRound({
                  id: editionDocId(`bc_round_${editRound}`),
                  tournament_id: TOURNAMENT_ID,
                  round_number: editRound,
                  sealed: next,
                });
              };
              return (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ ...segTrack({ compact: true }), width: "fit-content", marginBottom: 8 }}>
                    <button onClick={() => setSeal(false)} title="Scored and shown live, like every other round" style={pill(!sealed)}>
                      Off{!sealed && <SegRule compact />}
                    </button>
                    <button onClick={() => setSeal(true)} title="Sealed all day, revealed hole by hole at the house" style={pill(sealed)}>
                      On{sealed && <SegRule compact />}
                    </button>
                  </div>
                  {/* What ON actually does, stated as the three separate
                      guarantees it makes rather than as "it hides things" —
                      a director turning this on is promising the field a
                      blackout, and needs to know exactly how wide it is. */}
                  {sealed ? (
                    <div style={{ fontSize: FS.label, color: BC.t3, lineHeight: 1.6 }}>
                      <div style={{ color: BC.amberInk, fontWeight: 800, letterSpacing: 0.5, marginBottom: 3 }}>
                        ACTIVE — this round is sealed
                      </div>
                      · Each side sees only its own numbers, on the board and on the scoring screen.<br />
                      · The leaderboard does not move — the cup total leaves this round out until it is revealed.<br />
                      · The countdown is queued up: a director opens it from the Leaderboard and turns the holes over one at a time.
                    </div>
                  ) : (
                    <div style={{ fontSize: FS.label, color: BC.t3, lineHeight: 1.5 }}>
                      Scored and shown live, like every other round.
                    </div>
                  )}
                  {/* Only once the round is actually sealed in Firestore — a
                      toggle flipped a second ago has not been saved yet, and
                      reporting a countdown state off the unsaved form would be
                      reporting on a round that does not exist. */}
                  {seal.sealed && (
                    <div style={{ fontSize: FS.label, marginTop: 6, color: BC.amberInk, fontWeight: 700, lineHeight: 1.5 }}>
                      🔒 {revealSummary(seal.through)} — driven from the Leaderboard, or from
                      the television at {COUNTDOWN_HASH}.
                    </div>
                  )}
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
            <RoundSectionHeading>
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
                padding: "4px 12px 6px", fontSize: FS.label, fontWeight: 700,
                cursor: disabled ? "not-allowed" : "pointer",
                ...segThumb(active, { compact: true }),
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
                    <div style={segTrack({ compact: true })}>
                      <button onClick={() => setOn(false)}
                        title={cur.shared
                          ? `No allowance — the side plays one ball off both partners' full Course Handicaps added together`
                          : "No allowance — every player plays their full Course Handicap"}
                        style={pctPill(!on, roundIsFinal)}>Off{!on && <SegRule compact />}</button>
                      <button onClick={() => setOn(true)}
                        title={`Reduce handicaps — ${fmt?.label || "this format"} plays off ${describeAllowance(resolveAllowance(fmtId, { enabled: true, ...prefill }))}`}
                        style={pctPill(on, roundIsFinal)}>On{on && <SegRule compact />}</button>
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
                    <div style={segTrack({ compact: true })}>
                      {[["low_man", "Low Man"], ["full", "All"]].map(([val, lbl]) => (
                        <button key={val}
                          onClick={() => setHandicapMode(prev => ({ ...prev, [editRound]: val }))}
                          title={val === "low_man"
                            ? "Everyone plays the difference off the lowest Course Handicap in the match"
                            : "Everyone plays their full Course Handicap"}
                          style={pctPill((handicapMode[editRound] || "low_man") === val)}>{lbl}{(handicapMode[editRound] || "low_man") === val && <SegRule compact />}</button>
                      ))}
                    </div>
                  </div>
                  {/* The one case the tooltips can't carry on their own: a
                      side that plays ONE ball has a team handicap of its
                      partners added together, so leaving the allowance off
                      hands out a number nobody would have chosen. Said only
                      where it applies, and only while it applies. */}
                  {!on && cur.shared && (
                    <div style={{ fontSize: FS.label, color: BC.amberInk, lineHeight: 1.5, marginTop: 5 }}>
                      One ball per side — with no allowance each side plays both partners' handicaps added together.
                    </div>
                  )}
                  {/* The "normally played off 90%" recommendation that used to
                      print here when the allowance was Off is gone. Off is a
                      legitimate choice, and a line second-guessing it appeared
                      on most rounds — the On button's own default still puts
                      the recommended figure one tap away.

                      The shared-ball line above is NOT this and stays: it
                      reports what the round will actually do (add both
                      partners' full handicaps together), which no control on
                      the page shows. */}
                  {roundIsLocked && (
                    <div style={{ fontSize: FS.label, color: roundIsFinal ? BC.danger : BC.amberInk, marginTop: 4 }}>
                      Round {editRound} is locked — its allowance is frozen, so a change here will not move it.
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Per-player handicap overrides and tee assignments. */}
            <RoundSectionHeading>
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
                // Grid: name | HI | round-CH input | one tee swatch | delta.
                // Fixed width now — it used to widen by one column per tee on
                // the course, so a five-tee course pushed the name to nothing.
                const gridCols = ROUND_PLAYER_COLS;
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
                    {/* ── Everyone plays ───────────────────────────────────
                        The field-wide tee is the CONTROL now, not a shortcut
                        sitting above sixteen identical rows of dots. A field
                        plays one tee and a handful move off it, so this is the
                        decision; the exceptions are made per player, behind a
                        tap, on the row they belong to.

                        Shaped like WBC's: swatch, name and the slope/rating
                        that is the reason to pick one tee over another. It was
                        a row of bare dots, which asked the director to know
                        which colour meant which tee before they could choose. */}
                    {tees2h.length > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: FS.micro, color: BC.t3, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>Everyone plays</div>
                        <div style={{ display: "flex", gap: 4 }}>
                          {tees2h.map((tee, ti) => {
                            // Lit only when the whole field is genuinely on this
                            // tee — so the row doubles as the answer to "is
                            // anyone off the default?" without opening a row.
                            const allOn = tPlayers.length > 0 && tPlayers.every(p => teeOf(p.player_id) === tee.name);
                            return (
                              <button key={tee.name} disabled={roundIsFinal}
                                onClick={() => assignAllTees(tee.name)}
                                style={{
                                  flex: 1, minWidth: 0, padding: "7px 3px", borderRadius: 8,
                                  cursor: roundIsFinal ? "not-allowed" : "pointer",
                                  background: allOn ? BC.amber + ALPHA.wash : BC.inp,
                                  border: `1px solid ${allOn ? BC.amber : BC.bdr}`,
                                  opacity: roundIsFinal ? 0.5 : 1,
                                  display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                                  transition: "background 0.15s ease, border-color 0.15s ease",
                                }}>
                                <TeeSwatch tee={tee} index={ti} size={16} round active={allOn} />
                                <span style={{ fontSize: FS.micro, fontWeight: 700, color: allOn ? BC.amberInk : BC.t2, maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tee.name}</span>
                                <span style={{ fontSize: FS.micro, color: BC.t3, lineHeight: 1 }}>{tee.slope}/{tee.rating}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 4, padding: "0 2px", marginBottom: 4, alignItems: "center" }}>
                      <div />
                      <div style={{ fontSize: FS.micro, color: BC.t3, fontWeight: 700, textAlign: "center", lineHeight: 1.2 }}>HI</div>
                      <div style={{ fontSize: FS.micro, color: BC.t3, fontWeight: 700, textAlign: "center" }}>Round CH</div>
                      {tees2h.length > 0
                        ? <div style={{ fontSize: FS.micro, color: BC.t3, fontWeight: 700, textAlign: "center" }}>Tee</div>
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
                    // Is this player off whatever the field is playing? The
                    // collapsed row shows one swatch, so an exception has to
                    // look different from the default or it disappears.
                    //
                    // Measured against the most-played tee rather than "does
                    // everyone match" — the latter marks the whole field amber
                    // the moment one person moves, which says the opposite of
                    // what it should. On an even split nothing is the minority
                    // and nothing is marked.
                    const teeCounts = {};
                    tPlayers.forEach(x => {
                      const t = assignments2[x.player_id] || tees2[0]?.name;
                      if (t) teeCounts[t] = (teeCounts[t] || 0) + 1;
                    });
                    const maxTeeCount = Math.max(0, ...Object.values(teeCounts));
                    const offField = tees2.length > 0 && (teeCounts[currentTee2] || 0) < maxTeeCount;
                    const teeOpen = teeRowOpen === p.player_id;
                    return (
                      <div key={p.player_id}>
                      <div style={{ display: "grid", gridTemplateColumns: ROUND_PLAYER_COLS, gap: 4, alignItems: "center", marginBottom: 3 }}>
                        <div style={{ fontSize: FS.small, color: playerNameColor(), fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                        <div title={hiOverridden ? `Index override (base ${p.handicap_index})` : undefined} style={{ fontSize: FS.label, color: hiOverridden ? BC.amberInk : BC.t3, fontWeight: hiOverridden ? 700 : 400, textAlign: "center" }}>{effHI}{hiOverridden ? "*" : ""}</div>
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
                          style={{ padding: "5px 8px", background: hasOverride ? BC.amber + ALPHA.wash : BC.inp, border: `1px solid ${hasOverride ? BC.amber : BC.bdr}`, borderRadius: 6, color: hasOverride ? BC.amberInk : BC.t2, fontSize: FS.small, fontWeight: hasOverride ? 700 : 400, outline: "none", textAlign: "center", opacity: roundIsFinal ? 0.5 : 1, cursor: roundIsFinal ? "not-allowed" : "text" }}
                        />
                        {/* One swatch: the tee this player is actually on, and
                            the way in to change it. A row of every tee on the
                            course, repeated down sixteen players, was the same
                            question asked sixteen times when the answer is
                            almost always "whatever the field is playing". */}
                        {tees2.length > 0 ? (
                          <button
                            onClick={() => setTeeRowOpen(teeOpen ? null : p.player_id)}
                            title={`${currentTee2 || "No tee"} — tap to change`}
                            style={{
                              background: "transparent", border: "none", padding: 0, cursor: "pointer",
                              display: "flex", alignItems: "center", justifyContent: "center", gap: 1,
                              opacity: roundIsFinal ? 0.55 : 1,
                            }}>
                            <TeeSwatch
                              tee={tees2.find(t => t.name === currentTee2) || tees2[0]}
                              index={Math.max(0, tees2.findIndex(t => t.name === currentTee2))}
                              size={14} round active />
                            <span style={{
                              fontSize: FS.micro, lineHeight: 1,
                              // Amber only when this player is genuinely off
                              // whatever everyone else is on.
                              color: offField ? BC.amberInk : BC.t3,
                              transform: teeOpen ? "rotate(180deg)" : "none",
                              transition: "transform 0.15s ease",
                            }}>▾</span>
                          </button>
                        ) : <div />}
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

                      {/* Expanded: this player's own tee. Same buttons as the
                          field-wide row above, so choosing a tee looks the same
                          whether it is for everyone or for one person — and it
                          carries the slope/rating, which is the whole reason
                          somebody is being moved off the field's tee. */}
                      {teeOpen && tees2.length > 0 && (
                        // Right-aligned and sized to its contents, so the
                        // options land under the tee column they came out of
                        // rather than stretching the full width of the card.
                        // Stretched, each button was a third of the row wide
                        // and the group read as a new section instead of as
                        // this player's swatch, opened.
                        <div style={{ display: "flex", justifyContent: "flex-end", margin: "-1px 0 7px" }}>
                          <div style={{
                            display: "flex", gap: 3, maxWidth: "100%",
                            padding: "5px 6px", background: BC.inp, borderRadius: 8,
                            border: `1px solid ${BC.bdr}`,
                          }}>
                            {tees2.map((tee, ti) => {
                              const isAct = currentTee2 === tee.name;
                              // Not `disabled` when final — the tap must still
                              // land so warnRoundLocked can explain WHY nothing
                              // changes.
                              return (
                                <button key={tee.name}
                                  onClick={() => { if (warnRoundLocked()) return; assignTee2(tee.name); setTeeRowOpen(null); }}
                                  style={{
                                    // Content-width, shrinking only if a course
                                    // carries more tees than the row can hold.
                                    flex: "0 1 auto", minWidth: 0,
                                    padding: "4px 7px", borderRadius: 6,
                                    cursor: roundIsFinal ? "not-allowed" : "pointer",
                                    background: isAct ? BC.amber + ALPHA.wash : "transparent",
                                    border: `1px solid ${isAct ? BC.amber : BC.bdr}`,
                                    opacity: roundIsFinal ? 0.5 : 1,
                                    display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                                  }}>
                                  <TeeSwatch tee={tee} index={ti} size={13} round active={isAct} />
                                  <span style={{ fontSize: FS.micro, fontWeight: 700, lineHeight: 1.1, color: isAct ? BC.amberInk : BC.t2, maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tee.name}</span>
                                  <span style={{ fontSize: FS.micro, color: BC.t3, lineHeight: 1, whiteSpace: "nowrap" }}>{tee.slope}/{tee.rating}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
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
                    ? ["Saving…", BC.amberInk]
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

      {/* ── Course library ───────────────────────────────────────────
          Was a top-level "Courses" tab. Assigning a course is a ROUND
          decision, so the library opens over the round it acts on: the old
          flow made you leave the round you were setting up, work an R1–R4
          grid against a flat list, and navigate back. Nothing it could do was
          lost — the row chips still assign to any round, and search, add,
          edit and remove are all still here.

          One search box, always open, covering both halves. "Do I already
          have this one?" and "can I find it?" are the same typing, and the
          "+ Add Course" toggle hid the second question behind a control you
          had to know to press. */}
      {coursePicker && (
        <Popup onClose={() => setCoursePicker(false)} maxWidth={460} padding={0} outerPadding={12} portal zIndex={450}
          innerStyle={{ background: BC.card, border: `1px solid ${BC.amber}${ALPHA.line}`, borderRadius: 16 }}>
          <div>
            {/* Sticky so the search box stays reachable while a long library
                scrolls under it — the card itself is the scroll container. */}
            <div style={{ padding: "12px 14px", borderBottom: `1px solid ${BC.bdr}`, position: "sticky", top: 0, background: BC.card, zIndex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: FS.small, fontWeight: 700, color: BC.gold }}>COURSE FOR RD {editRound}</span>
                <button onClick={() => setCoursePicker(false)} style={{ background: "transparent", border: "none", color: BC.t3, fontSize: FS.title, cursor: "pointer", lineHeight: 1, padding: 0 }}>✕</button>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <select value={courseStateFilter} onChange={e => { setCourseStateFilter(e.target.value); if (courseSearch.trim().length >= 2) doCourseSearch(courseSearch, e.target.value); }}
                  style={{ width: 64, padding: "9px 6px", background: BC.inp, border: `1px solid ${BC.amber}${ALPHA.line}`, borderRadius: 8, color: BC.t1, fontSize: FS.lead, flexShrink: 0 }}>
                  <option value="">All</option>
                  {["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                {/* FS.lead is 16px, which is what stops iOS Safari zooming the
                    page on focus — under 16px it zooms in and never back. */}
                <input value={courseSearch} onChange={e => doCourseSearch(e.target.value)} placeholder="Search courses…"
                  style={{ flex: 1, minWidth: 0, padding: "9px 12px", background: BC.inp, border: `1px solid ${BC.amber}${ALPHA.line}`, borderRadius: 8, color: BC.t1, fontSize: FS.lead, outline: "none", boxSizing: "border-box" }} />
                {courseSearch !== "" && (
                  <button onClick={() => doCourseSearch("")} style={{ flexShrink: 0, padding: "0 10px", borderRadius: 8, background: "transparent", border: `1px solid ${BC.bdr}`, color: BC.t3, fontSize: FS.lead, cursor: "pointer" }}>✕</button>
                )}
              </div>
            </div>

            {libraryCourses.map((c, i) => {
              const onThisRound = tRounds.find(t => t.round_number === editRound)?.course_id === c.id;
              return (
              <div key={c.id} style={{ borderBottom: i < libraryCourses.length - 1 ? `1px solid ${BC.bdr}${ALPHA.hair}` : "none", padding: "10px 14px" }}>
                {/* Two lines, because at popup width the name and six controls
                    on one row left the name about 150px and wrapping. Line one
                    is the primary action — it puts this course on the round the
                    picker was opened from and closes. Line two is everything
                    else: the other rounds, edit, remove. */}
                <button onClick={async () => { await assignCourseToRound(editRound, c.id); setCoursePicker(false); }}
                  style={{ display: "block", width: "100%", background: "transparent", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: FS.body, color: onThisRound ? BC.amberInk : BC.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {onThisRound && "✓ "}{c.name}
                  </div>
                  <div style={{ fontSize: FS.label, color: BC.t3, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{[c.city, c.state].filter(Boolean).join(", ")} · Par {c.par} · Slope {c.slope}</div>
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7 }}>
                  <div style={{ display: "flex", gap: 3, flex: 1 }}>
                    {[1,2,3,4].map(r => {
                      const tr = tRounds.find(t => t.round_number === r);
                      const isAssigned = tr?.course_id === c.id;
                      const otherCourse = tr?.course_id && tr.course_id !== c.id && courses.find(x => x.id === tr.course_id);
                      return (
                        <button key={r} onClick={async () => {
                          if (isAssigned) {
                            await assignCourseToRound(r, null);
                          } else if (otherCourse) {
                            if (await confirm(`Replace ${otherCourse.name} for Rd ${r}?`)) await assignCourseToRound(r, c.id);
                          } else {
                            await assignCourseToRound(r, c.id);
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
              </div>
              );
            })}
            {courses.length === 0 && <div style={{ padding: "16px 14px", color: BC.t3, fontSize: FS.small }}>No courses yet — search above.</div>}
            {courses.length > 0 && libraryCourses.length === 0 && (
              <div style={{ padding: "10px 14px", color: BC.t3, fontSize: FS.label }}>Nothing saved matches “{courseSearch.trim()}”.</div>
            )}

            <div style={{ padding: 14, borderTop: `1px solid ${BC.bdr}` }}>
              {searchLoading && <div style={{ textAlign: "center", padding: 12, color: BC.t3, fontSize: FS.small }}>Searching…</div>}

              {!searchLoading && courseSearch.trim().length >= 2 && searchResults.length === 0 && (
                <div style={{ textAlign: "center", padding: "10px 0", color: BC.t3, fontSize: FS.small }}>Nothing found for “{courseSearch}”</div>
              )}

              {!searchLoading && searchResults.filter(c => !courses.find(ex => ex.name.toLowerCase() === c.name.toLowerCase())).map(c => (
                <button key={c.id} onClick={() => setCoursePreview({ ...c, hole_pars: c.hole_pars?.length ? c.hole_pars : Array(18).fill(4), hole_handicaps: c.hole_handicaps?.length ? c.hole_handicaps : Array(18).fill(0).map((_,i)=>i+1) })}
                  style={{ display: "block", width: "100%", background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 10, padding: "10px 14px", cursor: "pointer", textAlign: "left", color: BC.t1, marginBottom: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontWeight: 600, fontSize: FS.body }}>{c.name}</span>
                        {c._incompleteData && <span style={{ fontSize: FS.micro, background: `${BC.danger}${ALPHA.tint}`, border: `1px solid ${BC.danger}${ALPHA.hair}`, color: BC.danger, borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>⚠ incomplete</span>}
                        {c._source && <span style={{ fontSize: FS.micro, background: `${BC.amber}${ALPHA.wash}`, border: `1px solid ${BC.amber}${ALPHA.hair}`, color: BC.amberInk, borderRadius: 4, padding: "1px 5px", fontWeight: 600 }}>{c._source}</span>}
                      </div>
                      <div style={{ fontSize: FS.label, color: BC.t3 }}>{[c.city, c.state].filter(Boolean).join(", ")}{c.par ? ` · Par ${c.par}` : ""}{c.slope && c.slope !== 113 ? ` · Slope ${c.slope}` : ""}</div>
                    </div>
                    <span style={{ color: BC.amberInk, fontSize: FS.small, fontWeight: 700 }}>Preview →</span>
                  </div>
                </button>
              ))}

            </div>
          </div>
        </Popup>
      )}

      {/* Course editor — opened from a library row's Edit, or from an API
          result to review it before it is saved. Rendered outside the picker
          so it survives the picker closing underneath it. */}
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
            // `portal` below is load-bearing, not decoration. This editor
            // opens from a row inside the course picker, and the picker IS
            // portaled to <body>. Rendered inline, the editor sits inside the
            // app tree instead, under an ancestor that caps its stacking
            // context — so its higher z-index counted only against its
            // siblings, and the picker's backdrop painted straight over it.
            // With both on <body> the ladder in Popup.jsx actually applies:
            // picker 450 < editor 500 (content) < ConfirmModal 900 (modal).
            return (
              <Popup onClose={() => setCoursePreview(null)} maxWidth={420} padding={0} portal innerStyle={{ background: BC.card, borderRadius: 16, border: `1px solid ${BC.amber}${ALPHA.line}` }}>

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
                            style={{ fontSize: FS.label, padding: "2px 7px", borderRadius: 4, background: "transparent", border: `1px solid ${BC.amber}${ALPHA.line}`, color: BC.amberInk, cursor: "pointer", fontWeight: 700 }}>+ Tee</button>
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
                              <div style={{ textAlign:"center", color:BC.amberInk, fontWeight:800, padding:"3px 0", fontSize:FS.micro }}>{pars.reduce((a,b)=>a+(parseInt(b)||0),0)}</div>
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
                        // A course added while picking one for a round was
                        // added FOR that round — putting it there is the whole
                        // reason the search was open, and leaving the director
                        // to then find it in the list and tap it again is a
                        // step with no decision in it.
                        if (!isExisting && coursePicker) {
                          await assignCourseToRound(editRound, finalCourse.id);
                          setCoursePicker(false);
                        }
                        setCoursePreview(null);
                        doCourseSearch("");
                        notify(`${finalCourse.name} ${isExisting ? "updated" : "added"}!`, "success");
                      }} style={{ flex: 2, padding: "10px 0", borderRadius: 8, background: `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})`, border: "none", color: ON_AMBER, fontSize: FS.body, fontWeight: 700, cursor: "pointer" }}>{isExisting ? "✓ Save Changes" : "✓ Add Course"}</button>
                    </div>
                  </div>
              </Popup>
            );
          })()}

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
            <span>Edition · <span style={{ color: BC.amberInk }}>{TOURNAMENT_ID}</span></span>
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
                    // FS.lead for the same reason as the Access field
                    // below — these are free-text inputs, and under 16px
                    // iOS zooms in on focus and never comes back out.
                    style={{ flex: 1, minWidth: 0, boxSizing: "border-box", padding: "10px 12px", background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 8, color: BC.t1, fontSize: FS.lead, fontWeight: 700, outline: "none", fontFamily: FONT }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Access — the password that stands between "signed in with
              Google" and "can change the tournament". The current code is
              behind a tap rather than on screen: this panel gets shown to
              other people often enough (handicaps, tee times) that leaving
              a password sitting on it would undo the point of having one.
              Saving an empty field takes the password off. */}
          <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, padding: 14, marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: FS.label, fontWeight: 700, color: BC.t3, letterSpacing: 1.5, textTransform: "uppercase" }}>Access</div>
              <button
                onClick={async () => {
                  const next = editAccessCode.trim();
                  const ok = await confirm({
                    title: next ? "Change the password?" : "Remove the password?",
                    message: next
                      ? `Anyone signing in from now on needs "${next}" before they can claim a name or post a score.\n\nNobody already through the door is affected — this does not sign anybody out.`
                      : "Anybody who signs in with Google or Apple will be able to claim a name and post scores.",
                    destructive: !next,
                  });
                  if (!ok) return;
                  const res = await setAccessCode(next);
                  if (!res.ok) { notify(res.error, "error"); return; }
                  setEditAccessCode("");
                  setSavedAccessCode(next || null);
                  setAccessCodeError("");
                  notify(next ? "Password changed" : "Password removed", "success");
                }}
                style={{ flexShrink: 0, fontSize: FS.small, fontWeight: 700, color: ON_AMBER, background: BC.amber, border: "none", borderRadius: 6, padding: "8px 14px", cursor: "pointer" }}
              >Save</button>
            </div>

            {/* The current one. Fetched on demand — the read is a members-
                only round trip to Firestore, so there is no reason to make
                it on every visit to this tab. */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, minHeight: 34 }}>
              <span style={{ fontSize: FS.label, fontWeight: 700, color: BC.t3, letterSpacing: 0.5, width: 58, flexShrink: 0, textTransform: "uppercase" }}>Current</span>
              {showAccessCode ? (
                <span style={{ flex: 1, minWidth: 0, fontSize: accessCodeError ? FS.label : FS.body, fontWeight: accessCodeError ? 600 : 800, lineHeight: 1.35, color: accessCodeError ? BC.danger : (savedAccessCode ? BC.amberInk : BC.t3), wordBreak: "break-all" }}>
                  {accessCodeError || savedAccessCode || "None"}
                </span>
              ) : (
                <button type="button" onClick={loadAccessCode} style={{
                  fontSize: FS.small, fontWeight: 700, padding: "6px 12px", borderRadius: 6,
                  border: `1px solid ${BC.bdr}`, background: "transparent", color: BC.t2, cursor: "pointer",
                }}>Show</button>
              )}
              {showAccessCode && (
                <button type="button" onClick={() => setShowAccessCode(false)} style={{
                  flexShrink: 0, fontSize: FS.small, fontWeight: 700, padding: "6px 12px", borderRadius: 6,
                  border: `1px solid ${BC.bdr}`, background: "transparent", color: BC.t3, cursor: "pointer",
                }}>Hide</button>
              )}
            </div>

            <input
              value={editAccessCode}
              onChange={e => setEditAccessCode(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
              placeholder="New password"
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
              // FS.lead, not FS.body: iOS Safari zooms the page when a
              // focused input is under 16px and does not zoom back out on
              // blur, leaving the director stranded at 2x on a form they
              // have to finish. See the note on the scale in theme.js.
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 8, color: BC.t1, fontSize: FS.lead, fontWeight: 700, outline: "none", fontFamily: FONT }}
            />
            {/* All that survives of a four-sentence explanation. The other
                three described what a password is; this one is the only thing
                the field cannot show — that emptying it is how you remove it,
                which nobody would try on a control called "New password". */}
            <div style={{ fontSize: FS.label, color: BC.t3, marginTop: 6, lineHeight: 1.4 }}>
              Save blank to remove.
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
//
// The two side games that run across the whole tournament instead of inside
// any one match. They are built on opposite principles, deliberately:
//
// SKINS ARE DERIVED, never stored. Low score on a hole takes it, a tie pushes
// it, and the pot divides by however many were won. There is no skins editor
// anywhere in the app on purpose — a stored winner is a second answer that can
// disagree with the card, and the card is the one the field signed. (`bc_skins`
// predates this; nothing writes it and nothing reads it.)
//
// CTP IS CAPTURED, because it is the one thing here the card does not record.
// Groups tag their own par 3s from the Scoring tab as they walk off the green
// — provisional, `approved: false` — and the director settles each hole from
// this screen. See onSetCtp for why that split exists.
function BettingView({ tPlayers, tRounds, rounds, currentRound, courses, holeData, ctpData, skinsPot, buyIns, onSetCtp, onUpdatePot, onUpdateBuyIns, user, roundLocks, hcpOverrides, teeAssignments, teams }) {
  const [activeTab, setActiveTab] = useState("skins");
  const [activeRound, setActiveRound] = useState(null);
  const [editPot, setEditPot] = useState(false);
  const [potInput, setPotInput] = useState("");
  const [grossMode, setGrossMode] = useState(false);
  // The CTP tab keeps its own round and its own open state. Sharing them with
  // the skins card would mean opening one tab silently rearranged the other.
  const [ctpRound, setCtpRound] = useState(null);
  const [editBuyIns, setEditBuyIns] = useState(null); // "skins" | "ctp" | null

  // ── Who is playing for what ──
  // A null list means the director has never tagged anybody, and that means
  // EVERYBODY — so a tournament that never opens the buy-in panel behaves
  // exactly as it did before buy-ins existed.
  const inField = (ids) => (ids == null ? tPlayers : tPlayers.filter(p => ids.includes(p.player_id)));
  const skinsField = inField(buyIns?.skinsIn);
  const ctpField = inField(buyIns?.ctpIn);
  const ctpInSet = new Set(ctpField.map(p => p.player_id));

  // The pot is COUNTED from the buy-ins once a buy-in price exists. Until one
  // does, the hand-typed pot stands and stays editable — which is the only
  // thing a tournament already under way has.
  const skinsCounted = (buyIns?.skinsAmount || 0) > 0;
  const skinsPotValue = skinsCounted ? skinsField.length * buyIns.skinsAmount : skinsPot;
  const ctpPotValue = (buyIns?.ctpAmount || 0) > 0 ? ctpField.length * buyIns.ctpAmount : 0;

  // The rounds that actually exist, not a hardcoded 1-4: a two-round
  // tournament used to get two empty tabs, and a fifth round never appeared
  // at all.
  const roundList = rounds?.length ? rounds : [];

  // ── Which round this tab lands on ──
  // The most recent round that has actually been played, which is not the same
  // question as which round is open. `currentRound` is the lowest round nobody
  // has finalized yet, so it is null once the tournament is over — landing the
  // tab back on Round 1 the moment the last round was signed off — and on the
  // morning of Round 2 it points at a round with nothing in it while Round 1's
  // results sit one tap away.
  //
  // So: the open round if anyone has entered a score in it, otherwise the last
  // round that has scores, otherwise wherever the schedule has got to. A
  // finished tournament lands on its final round; a tournament that has not
  // started lands on its first.
  //
  // It follows the play on its own until somebody taps a round, and from then
  // on that choice stands.
  const playedRounds = roundList.filter(r =>
    tPlayers.some(p => Object.keys(holeData[`${p.player_id}_${r}`] || {}).length > 0));
  const lastPlayed = playedRounds.length ? playedRounds[playedRounds.length - 1] : null;
  const defaultRound =
      (currentRound != null && playedRounds.includes(currentRound)) ? currentRound
    : lastPlayed != null ? lastPlayed
    : (currentRound != null && roundList.includes(currentRound)) ? currentRound
    : (roundList[roundList.length - 1] ?? null);

  // Never leave a round toggle pointing at a round that has since been deleted
  // off the schedule.
  const shownRound = roundList.includes(activeRound) ? activeRound : defaultRound;

  // A round's course and hole tables, resolved the way every other scoring
  // surface resolves them: through the round LOCK when there is one. A locked
  // round froze its course, so reading the live round doc instead would re-par
  // a settled hole if the director later re-pointed the round somewhere else.
  //
  // Both tabs go through this. The CTP grid used to read `course.hole_pars`
  // raw, which meant it could offer a different set of par 3s than the ones
  // the Scoring tab actually prompted on.
  const roundSetup = (round) => {
    const tr2 = tRounds.find(t => t.round_number === round);
    const bLock = lockForRound(roundLocks, round);
    const course2 = courses.find(c => c.id === (bLock?.course_id || tr2?.course_id));
    return {
      tr: tr2, lock: bLock, course: course2,
      pars: resolveHolePars(course2, bLock),
      hcps: resolveHoleHcps(course2, bLock),
    };
  };

  // Every player's stroke allocation for a round, built once.
  //
  // Net skins are handicap-derived, so they answer to the round lock too — a
  // settled skin must not change hands because someone synced a GHIN index the
  // next morning. Uses the canonical buildStrokeMap so handicaps over 18 wrap
  // correctly (a hole can get 2+ strokes); the old inline lookup capped every
  // hole at 1.
  //
  // The field card reads the SAME maps to draw its stroke dots, so a dot
  // printed on a cell is always the stroke the skin was decided with.
  const strokeMapsFor = (round) => {
    const { tr: tr2, course: course2, hcps } = roundSetup(round);
    const maps = {};
    skinsField.forEach(p => {
      const ch = getRoundCH({
        roundLocks, round, pid: p.player_id, players: tPlayers,
        course: course2, chOverrides: hcpOverrides, teeAssignments, roundTee: tr2?.tee_box,
      });
      maps[p.player_id] = buildStrokeMap(ch, hcps);
    });
    return maps;
  };

  // Compute skins for a round
  const computeSkins = (round, gross) => {
    const { pars } = roundSetup(round);
    const maps = gross ? null : strokeMapsFor(round);

    const skins = [];
    for (let h = 0; h < 18; h++) {
      const scores = skinsField.map(p => {
        const raw = (holeData[`${p.player_id}_${round}`] || {})[h];
        if (raw == null) return null;
        if (gross) return { pid: p.player_id, name: p.name, score: raw };
        const strokes = maps[p.player_id]?.[h] || 0;
        return { pid: p.player_id, name: p.name, score: raw - strokes };
      }).filter(Boolean);

      if (scores.length < 2) { skins.push({ hole: h, winner: null, tied: false, par: pars[h] }); continue; }
      const min = Math.min(...scores.map(s => s.score));
      const winners = scores.filter(s => s.score === min);
      if (winners.length === 1) skins.push({ hole: h, winner: winners[0], score: min, par: pars[h] });
      else skins.push({ hole: h, winner: null, tied: true, score: min, par: pars[h] });
    }
    return skins;
  };

  const allSkins = roundList.flatMap(r => computeSkins(r, grossMode).filter(s => s.winner).map(s => ({ ...s, round: r })));
  const skinCount = {};
  allSkins.forEach(s => { skinCount[s.winner.pid] = (skinCount[s.winner.pid] || 0) + 1; });
  const totalSkins = allSkins.length;
  const perSkin = totalSkins > 0 ? (skinsPotValue / totalSkins).toFixed(2) : "0.00";

  // ── What the field card is drawn from ──
  // The shown round's setup, skins and stroke maps, resolved once. Every one
  // of these is safe with a null round (no schedule yet): roundSetup falls
  // back to a par-4 course, and a scoreless round yields no skins.
  const shownSetup = roundSetup(shownRound);
  const shownSkins = computeSkins(shownRound, grossMode);
  // Gross mode draws no dots, so it needs no maps.
  const shownStrokeMaps = grossMode ? {} : strokeMapsFor(shownRound);
  // Team, then name. Skins is an individual game and the sides mean nothing
  // to it, but the roster is grouped this way on every other screen, and a
  // player looking for their own row among sixteen finds it faster in the
  // order they already know than in one sorted by a number that moves.
  const fieldPlayers = [...skinsField].sort((a, b) =>
    String(a.team || "").localeCompare(String(b.team || "")) ||
    String(a.name || "").localeCompare(String(b.name || ""))
  );

  // ── The CTP tab ──
  const ctpShownRound = roundList.includes(ctpRound) ? ctpRound : defaultRound;
  const noPar3s = roundList.every(r => !roundSetup(r).pars.some(p => p === 3));

  // Every standing tag, read through each round's OWN par table rather than
  // straight off ctpData: a record left on a hole that is no longer a par 3 —
  // a course re-pointed after the fact — would otherwise keep counting for
  // somebody on a hole the tab no longer shows.
  //
  // An unsettled tag still counts. The document is the hole's current answer
  // and not a log of attempts, which is exactly what the rows below display;
  // a leaderboard that ignored pending tags would disagree with them.
  const ctpTags = roundList.flatMap(r => {
    const { pars } = roundSetup(r);
    return pars.flatMap((p, h) => {
      if (p !== 3) return [];
      const rec = ctpData[`${r}_${h}`];
      // A tag naming somebody who is not in the CTP game does not score. It
      // still shows on its hole — the document is the hole's answer — but the
      // board and the payout are for the players who bought in.
      return rec?.player_id && ctpInSet.has(rec.player_id) ? [{ round: r, hole: h, ...rec }] : [];
    });
  });
  const ctpLeaders = Object.values(ctpTags.reduce((acc, t) => {
    const e = acc[t.player_id] || (acc[t.player_id] = { pid: t.player_id, count: 0, best: null });
    e.count += 1;
    if (t.distance_ft != null && (e.best == null || t.distance_ft < e.best)) e.best = t.distance_ft;
    return acc;
  }, {}))
    // Most pins, then the closest single shot among equals — the tiebreak the
    // players would use themselves.
    .sort((a, b) => b.count - a.count || (a.best ?? Infinity) - (b.best ?? Infinity));

  // One commit path for the pot, reached by blur — Enter just blurs the
  // field. Committing on both fired two Firestore writes for one edit.
  const commitPot = () => {
    setEditPot(false);
    const amt = parseFloat(potInput);
    onUpdatePot(Number.isFinite(amt) && amt > 0 ? amt : 0);
  };

  const empty = (icon, title, sub) => (
    <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, overflow: "hidden" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 20px", textAlign: "center" }}>
        <div style={{ fontSize: FS.jumbo, marginBottom: 12, opacity: 0.4 }}>{icon}</div>
        <div style={{ fontSize: FS.lead, fontWeight: 700, color: BC.t1, marginBottom: 6, letterSpacing: 0.3 }}>{title}</div>
        <div style={{ fontSize: FS.small, color: BC.t3, maxWidth: 280, lineHeight: 1.5 }}>{sub}</div>
      </div>
    </div>
  );

  return (
    <div style={{ fontFamily: FONT }}>
      {/* Tab toggle. Pinned so this tab's lead control sits exactly where
          every other tab's does, and so the skins list scrolls under it
          rather than taking it away. */}
      <StickyTop>
        <SegmentedToggle
          options={[["skins", "Skins"], ["ctp", "Closest to Pin"]]}
          value={activeTab} onChange={setActiveTab} letterSpacing={0.5}
        />
      </StickyTop>

      {roundList.length === 0 && empty("🥃", "No bets yet", "Skins and closest-to-the-pin open once the tournament has a round on the schedule.")}

      {roundList.length > 0 && activeTab === "skins" && (
        <div>
          {/* Pot */}
          <div style={{ background: BC.card, borderRadius: 12, marginBottom: editBuyIns === "skins" ? 0 : 12, border: `1px solid ${BC.bdr}`, overflow: "hidden" }}>
            <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: FS.label, color: BC.t3, fontWeight: 700, letterSpacing: 1 }}>SKINS POT</div>
                {/* Once a buy-in price is set the pot is COUNTED, not typed, so
                    the inline editor gives way — the way to change it is to
                    change who is in. A tournament with no buy-in price keeps
                    the hand-typed pot exactly as it was. */}
                {skinsCounted ? (
                  <div style={{ fontSize: FS.title, fontWeight: 800, color: BC.gold }}>${skinsPotValue.toFixed(2)}</div>
                ) : editPot ? (
                  <input autoFocus type="number" inputMode="decimal" value={potInput} onChange={e => setPotInput(e.target.value)}
                    onBlur={commitPot}
                    onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
                    style={{ fontSize: FS.title, fontWeight: 800, color: BC.gold, background: "transparent", border: "none", borderBottom: `1px solid ${BC.amber}`, outline: "none", width: 100, fontFamily: FONT }} />
                ) : (
                  // Seed the field from the LIVE pot at the moment editing opens,
                  // not at mount: the value arrives from Firestore after the
                  // first render, and another director can change it while this
                  // screen is open. Seeding at mount meant a director who tapped
                  // in and straight back out saved a stale pot over the real one.
                  <div onClick={() => { if (user?.isDirector) { setPotInput(String(skinsPot)); setEditPot(true); } }}
                    style={{ fontSize: FS.title, fontWeight: 800, color: BC.gold, cursor: user?.isDirector ? "pointer" : "default" }}>
                    ${skinsPot.toFixed(2)}
                  </div>
                )}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: FS.label, color: BC.t3 }}>{totalSkins} skins won</div>
                <div style={{ fontSize: FS.body, fontWeight: 700, color: BC.amberInk }}>${perSkin} / skin</div>
              </div>
            </div>
            {user?.isDirector && (
              <div
                onClick={() => setEditBuyIns(v => (v === "skins" ? null : "skins"))}
                style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "8px 14px", borderTop: `1px solid ${BC.bdr}` }}
              >
                <span style={{ flex: 1, fontSize: FS.label, fontWeight: 700, color: BC.t3, letterSpacing: 0.6 }}>
                  {skinsField.length} IN{skinsCounted ? ` · $${buyIns.skinsAmount} EACH` : ""}
                </span>
                <span style={{ fontSize: FS.label, fontWeight: 700, color: BC.amberInk, letterSpacing: 0.6 }}>
                  BUY-INS {editBuyIns === "skins" ? "▾" : "▸"}
                </span>
              </div>
            )}
          </div>

          {user?.isDirector && editBuyIns === "skins" && (
            <BuyInEditor
              players={tPlayers}
              amount={buyIns?.skinsAmount || 0}
              ids={buyIns?.skinsIn ?? null}
              onChange={patch => onUpdateBuyIns(
                "amount" in patch ? { skins_buyin: patch.amount } : { skins_in: patch.ids }
              )}
            />
          )}

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
                    <span style={{ fontSize: FS.body, fontWeight: 700, color: BC.amberInk }}>{count} skin{count !== 1 ? "s" : ""}</span>
                    <span style={{ fontSize: FS.small, color: BC.t3 }}>${(count * parseFloat(perSkin)).toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Round tabs. The card below is always open, so these pick which
              round it shows rather than whether there is one — and the
              selected pill doubles as the label saying which round is on
              screen, which is why it renders even for a one-round
              tournament. */}
          <SegmentedToggle
            variant="pills"
            style={{ marginBottom: 8 }}
            options={roundList.map(r => [r, `Rd ${r}`])}
            value={shownRound}
            onChange={setActiveRound}
          />

          <FieldCard
            players={fieldPlayers}
            pars={shownSetup.pars}
            hcps={shownSetup.hcps}
            scoreFor={(pid, h) => (holeData[`${pid}_${shownRound}`] || {})[h] || 0}
            strokesFor={(pid, h) => shownStrokeMaps[pid]?.[h] || 0}
            skins={shownSkins}
            gross={grossMode}
          />
        </div>
      )}

      {roundList.length > 0 && activeTab === "ctp" && (
        <div>
          {noPar3s
            ? empty("🎯", "No par 3s yet", "Closest-to-the-pin holes come from the course. They appear here once a round has a course with a par 3 on it.")
            : (
              <>
                {/* CTP POT — the same card as the skins pot, minus the typed
                    fallback. CTP never had a hand-entered pot to preserve, so
                    it is counted from the buy-ins or it is nothing.
                    Hidden from players until there IS one: this card is new,
                    and "$0.00" is not worth a row on a tournament whose
                    director has not set a CTP buy-in. The director keeps it
                    either way — it is where they set one. */}
                {(ctpPotValue > 0 || user?.isDirector) && (
                <div style={{ background: BC.card, borderRadius: 12, marginBottom: editBuyIns === "ctp" ? 0 : 12, border: `1px solid ${BC.bdr}`, overflow: "hidden" }}>
                  <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: FS.label, color: BC.t3, fontWeight: 700, letterSpacing: 1 }}>CTP POT</div>
                      <div style={{ fontSize: FS.title, fontWeight: 800, color: BC.gold }}>${ctpPotValue.toFixed(2)}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: FS.label, color: BC.t3 }}>{ctpTags.length} pin{ctpTags.length !== 1 ? "s" : ""} taken</div>
                      <div style={{ fontSize: FS.body, fontWeight: 700, color: BC.amberInk }}>
                        ${(ctpTags.length > 0 ? ctpPotValue / ctpTags.length : 0).toFixed(2)} / pin
                      </div>
                    </div>
                  </div>
                  {user?.isDirector && (
                    <div
                      onClick={() => setEditBuyIns(v => (v === "ctp" ? null : "ctp"))}
                      style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "8px 14px", borderTop: `1px solid ${BC.bdr}` }}
                    >
                      <span style={{ flex: 1, fontSize: FS.label, fontWeight: 700, color: BC.t3, letterSpacing: 0.6 }}>
                        {ctpField.length} IN{(buyIns?.ctpAmount || 0) > 0 ? ` · $${buyIns.ctpAmount} EACH` : ""}
                      </span>
                      <span style={{ fontSize: FS.label, fontWeight: 700, color: BC.amberInk, letterSpacing: 0.6 }}>
                        BUY-INS {editBuyIns === "ctp" ? "▾" : "▸"}
                      </span>
                    </div>
                  )}
                </div>
                )}

                {user?.isDirector && editBuyIns === "ctp" && (
                  <BuyInEditor
                    players={tPlayers}
                    amount={buyIns?.ctpAmount || 0}
                    ids={buyIns?.ctpIn ?? null}
                    onChange={patch => onUpdateBuyIns(
                      "amount" in patch ? { ctp_buyin: patch.amount } : { ctp_in: patch.ids }
                    )}
                  />
                )}

                {/* CTP LEADERS, the same shape as SKINS LEADERS. Where skins
                    print money, this prints the closest the player has been
                    all week — the only other number a CTP has. */}
                {ctpLeaders.length > 0 && (
                  <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, marginBottom: 12, overflow: "hidden" }}>
                    <div style={{ padding: "8px 14px", borderBottom: `1px solid ${BC.bdr}`, fontSize: FS.label, fontWeight: 700, color: BC.gold, letterSpacing: 1 }}>CTP LEADERS</div>
                    {ctpLeaders.map(({ pid, count, best }) => {
                      const p = tPlayers.find(t => t.player_id === pid);
                      const team = p ? teams[p.team] : null;
                      return (
                        <div key={pid} style={{ display: "flex", alignItems: "center", padding: "8px 14px", borderBottom: `1px solid ${BC.bdr}${ALPHA.hair}`, gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: team?.accent || BC.t3, flexShrink: 0 }} />
                          <span style={{ flex: 1, fontSize: FS.body, fontWeight: 600, color: BC.t1 }}>{p?.name || pid}</span>
                          <span style={{ fontSize: FS.body, fontWeight: 700, color: BC.amberInk }}>{count} CTP{count !== 1 ? "s" : ""}</span>
                          <span style={{ fontSize: FS.small, color: BC.t3 }}>{best != null ? `${best} ft` : "—"}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Same opener as the skins card: the round pill IS the
                    control, and it reveals that round's par 3s rather than
                    every round's stacked into one list. */}
                <SegmentedToggle
                  variant="pills"
                  style={{ marginBottom: 8 }}
                  options={roundList.map(r => [r, `Rd ${r}`])}
                  value={ctpShownRound}
                  onChange={setCtpRound}
                />

                {(() => {
                  const { course: course2, pars: pars2 } = roundSetup(ctpShownRound);
                  const par3holes = pars2.map((p, i) => ({ hole: i, par: p })).filter(h => h.par === 3);
                  if (par3holes.length === 0) {
                    return (
                      <div style={{ background: BC.card, borderRadius: 8, border: `1px solid ${BC.bdr}`, padding: "14px 12px", fontSize: FS.small, color: BC.t3, textAlign: "center" }}>
                        No par 3s on {course2?.name || "this course"}.
                      </div>
                    );
                  }
                  return (
                    <>
                      <div style={{ fontSize: FS.label, fontWeight: 700, color: BC.t3, letterSpacing: 1, marginBottom: 6 }}>
                        {(course2?.name || "TBD").toUpperCase()}
                      </div>
                      {par3holes.map(({ hole }) => {
                        const rec = ctpData[`${ctpShownRound}_${hole}`];
                        const winnerId = rec?.player_id || null;
                        const winner = tPlayers.find(p => p.player_id === winnerId);
                        // A tag a group entered on the course is provisional until
                        // the director touches it here — picking a name from the
                        // dropdown (even re-picking the same one) is the approval.
                        const pending = !!winnerId && rec?.approved !== true;
                        return (
                          <div key={hole} style={{ background: BC.card, borderRadius: 8, padding: "8px 12px", marginBottom: 4, border: `1px solid ${winner ? BC.amber + ALPHA.line : BC.bdr}`, display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: FS.small, fontWeight: 700, color: BC.t3, width: 54, flexShrink: 0, whiteSpace: "nowrap" }}>Hole {hole + 1}</span>
                            {user?.isDirector ? (
                              <select value={winnerId || ""}
                                onChange={e => onSetCtp(ctpShownRound, hole, e.target.value || null, { distanceFt: e.target.value === winnerId ? rec?.distance_ft ?? null : null, approved: true })}
                                style={{ flex: 1, minWidth: 0, background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 6, color: BC.t1, fontSize: FS.small, padding: "4px 6px", fontFamily: FONT }}>
                                <option value="">-- Not set --</option>
                                {/* Only players who bought into CTP are offered.
                                    A hole already tagged to somebody since taken
                                    out still shows their name in the row below —
                                    that is what the document says — but they
                                    cannot be picked again. */}
                                {ctpField.map(p => <option key={p.player_id} value={p.player_id}>{p.name}</option>)}
                              </select>
                            ) : (
                              <span style={{ flex: 1, minWidth: 0, fontSize: FS.small, fontWeight: 600, color: winner ? BC.amberInk : BC.t3 }}>{winner ? winner.name : "Not set"}</span>
                            )}
                            {rec?.distance_ft ? <span style={{ fontSize: FS.label, fontWeight: 700, color: BC.amberInk, flexShrink: 0 }}>{rec.distance_ft} ft</span> : null}
                            {pending && <span title="Tagged on the course — not settled yet" style={{ fontSize: FS.label, fontWeight: 700, color: BC.t3, border: `1px solid ${BC.bdr}`, borderRadius: 4, padding: "1px 4px", flexShrink: 0 }}>Pending</span>}
                            {winner && <span style={{ fontSize: FS.label, color: BC.amberInk, flexShrink: 0 }}>📍</span>}
                          </div>
                        );
                      })}
                    </>
                  );
                })()}
              </>
            )}
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
                  <div style={{ textAlign: "right", fontSize: FS.small, fontWeight: 700, color: BC.amberInk }}>{p.pts.toFixed(1)}</div>
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
                {yr.winner && <div style={{ fontSize: FS.small, color: BC.amberInk, fontWeight: 700 }}>🏆 {yr.winner} won the Bourbon Cup</div>}
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
function SlideMenu({ open, onClose, onNavigate, user, view, finalize, navH }) {
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
    // Last, and set apart below: everything above is the EVENT, this is the
    // person. Notifications, the theme switch and Logout all used to be
    // rows in this menu; they are now sections of that one screen, so a
    // preference has one home instead of two.
    { key: "account",   label: "My Account",        icon: "👤" },
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
          // Nothing to compensate for below that — the bar is seated on the
          // viewport's bottom edge, not hanging past it.
          bottom: navH - 1,
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
        {items.map((item, idx) => {
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
              // A full-weight rule above My Account, a hairline between the
              // rest: the break is what says "this one isn't the event".
              borderTop: idx === 0 ? "none" : `1px solid ${BC.bdr}${item.key === "account" ? "" : ALPHA.hair}`,
              borderLeft: "none", borderRight: "none", borderBottom: "none",
              color: isActive || item.flag ? BC.amberInk : BC.t1,
              fontSize: FS.body, fontWeight: isActive || item.flag ? 700 : 500,
              cursor: "pointer", textAlign: "left",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <span>{item.label}</span>
              {(isActive || item.flag) && <span style={{ width: 6, height: 6, borderRadius: "50%", background: BC.amber, flexShrink: 0 }} />}
            </button>
          );
        })}
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
  // ── Who is using the app ──────────────────────────────────────────
  // Three layers, resolving in this order on a cold start:
  //
  //   authUser  Firebase Auth's persisted session — WHICH ACCOUNT. Held as
  //             `undefined` until the SDK has read it back off disk, so
  //             "not signed in" and "not known yet" stay distinguishable;
  //             conflating them is what flashes the sign-in screen at
  //             somebody who is already signed in.
  //   tPlayers  the roster, which carries the account → player link
  //             (bc_players.auth_uid, see lib/accounts.js).
  //   user      what the rest of the app means by "you", derived from both
  //             just below the roster state.
  //
  // Nothing here is authoritative locally: the roster is, so a director
  // unlinking an account takes effect on that phone at the next snapshot
  // rather than at its next logout.
  const [authUser, setAuthUser] = useState(undefined);
  const [authError, setAuthError] = useState("");
  // Signed in and deliberately not on the roster: the director bootstrapping
  // an edition that has no players to tap yet.
  const [bootstrapDirector, setBootstrapDirector] = useState(false);
  // Whether the roster subscription has delivered anything at all. "No link
  // found" means nothing until it has.
  const [playersLoaded, setPlayersLoaded] = useState(false);
  // Last known account → player pairing, read once at startup. It covers the
  // gap between Firebase answering and Firestore answering; see firebase.js.
  const cachedSession = useRef(readUserSession());

  // The membership document, for an account that has presented the
  // tournament password — and the only place Admin access comes from, via
  // its `is_director` flag. `undefined` while the answer is in flight, for
  // the same reason authUser is: showing the password screen to somebody
  // who is already through it, because a read had not landed yet, would be
  // its own bug. null means signed in but not a member.
  const [membership, setMembership] = useState(undefined);
  const member = membership === undefined ? undefined : !!membership;

  useEffect(() => {
    // The far side of the redirect flow (lib/auth.js). A SUCCESSFUL redirect
    // needs nothing here — the state listener fires with the new user like
    // any other sign-in — but a failed one has no other way to be seen: the
    // app would simply come back to the sign-in screen with no explanation.
    consumeRedirectResult().then(({ error }) => { if (error) setAuthError(error); });
    return onAuthUser(u => {
      setAuthUser(u || null);
      if (!u) setBootstrapDirector(false);
    });
  }, []);

  // Ask the door. A FAILED read is not a "no" — a phone coming up on bad
  // signal must not be told its password is needed again — so it retries
  // before giving an answer, and the splash holds meanwhile. If it still
  // cannot tell, it falls to the password screen rather than hanging
  // forever: that screen re-checks membership on submit, so somebody who
  // is already through gets waved past as soon as the network returns.
  const loadMembership = useCallback(async (uid) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return { ok: true, doc: await readMembership(uid) }; }
      catch (e) {
        console.error("[gate] membership check", e);
        await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    return { ok: false, doc: null };
  }, []);

  useEffect(() => {
    if (authUser === undefined) return;
    if (!authUser) { setMembership(null); return; }
    let live = true;
    setMembership(undefined);
    (async () => {
      const { doc } = await loadMembership(authUser.uid);
      if (live) setMembership(doc);
    })();
    return () => { live = false; };
  }, [authUser, loadMembership]);
  // Default landing view. Leaderboard is the right home base — the
  // most-glanced screen during a round, and the natural place for a
  // user reopening the app to check current state.
  const [view, setView] = useState("leaderboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [ctpData, setCtpData] = useState({});     // { "round_hole": record }
  const [skinsPot, setSkinsPot] = useState(0);
  // Side-game buy-ins, from bc_settings_main. Each `*In` is an ARRAY of player
  // ids, or NULL when no director has ever touched it — and null means
  // everybody, which is what every tournament played before this existed was.
  // An empty array is a different answer (nobody), so the two must not be
  // collapsed. See components/BuyIns.
  const [buyIns, setBuyIns] = useState({ skinsAmount: 0, skinsIn: null, ctpAmount: 0, ctpIn: null });
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
    if (styleEl) styleEl.textContent = bcGlobalCSS(BC.bg, BC.card);
  }, [darkMode]);

  const [tPlayers, setTPlayers] = useState([]);

  // ── "You" ───────────────────────────────────────────────────────────
  // The roster row this account has claimed, with the director flag it
  // carries. Everything downstream — the admin tab, whose card is whose,
  // the attest badge — reads this, exactly as it read the tapped player
  // before there were accounts, so nothing else had to change.
  // Admin access rides on the MEMBERSHIP flag, never on the roster's crown.
  // The crown is a label the director sets in Admin → Players; the flag is
  // set in the Firebase console and is the only thing the security rules
  // will honour. Reading the same source the rules read is what stops the
  // app from ever offering an Admin tab whose every write would be refused.
  const isDirectorUser = isDirectorAccount(membership);

  // Every membership, but only for a director — the rules allow the listing
  // to nobody else, and nobody else has a screen that needs it. It is what
  // draws the crown in Admin → Players, so that badge shows the same flag
  // the rules check rather than a field on the roster that could disagree
  // with it. Subscribed rather than fetched so appointing somebody updates
  // the row you just tapped.
  const [memberships, setMemberships] = useState([]);
  useEffect(() => {
    if (!isDirectorUser) { setMemberships([]); return; }
    // withId, because the membership whose flag started all this — the
    // first director's — is typed into the Firebase console by hand, and
    // a document made that way has whatever fields the person thought to
    // add. Matching on the id instead of a `uid` field means the crown
    // still finds it.
    return db.subscribe(ACCOUNTS_COL, [], setMemberships, { withId: true });
  }, [isDirectorUser]);

  const onSetDirector = useCallback(async (uid, on) => {
    const res = await setDirector(uid, on);
    return res;
  }, []);

  const user = useMemo(() => {
    if (!authUser) return null;
    const linked = linkedPlayer(tPlayers, authUser.uid);
    if (linked) return { ...linked, isDirector: isDirectorUser };

    // The cache is only usable if it belongs to THIS account. The one
    // exception is the marker an edition switch writes just before
    // reloading (lib/editions.js), which predates knowing the uid.
    const cached = cachedSession.current;
    const mine = cached && (!cached.auth_uid || cached.auth_uid === authUser.uid) ? cached : null;
    // The bootstrap identity carries isDirector: true — it predates there
    // being anywhere else to get the answer. It does not get to grant
    // anything now: typing the director code on an empty roster gets you
    // into the app, and the console flag decides whether Admin is there
    // when you arrive. Otherwise the code would offer a tab whose every
    // write the rules would refuse.
    if (bootstrapDirector || mine?.player_id === BOOTSTRAP_DIRECTOR.player_id) {
      return { ...BOOTSTRAP_DIRECTOR, isDirector: isDirectorUser };
    }
    // Roster still in flight: hold the last known identity rather than
    // flash the claim screen at somebody who claimed a name months ago.
    // The cached crown is not trusted either — same reason.
    if (!playersLoaded && mine) return { ...mine, isDirector: isDirectorUser };
    return null;
  }, [authUser, tPlayers, playersLoaded, bootstrapDirector, isDirectorUser]);

  // Keep that cache current. What gets written is the live roster row, so
  // it can never be staler than what is on screen — and it is cleared the
  // moment the roster says this account has no name, which is how a
  // director's unlink reaches a phone that is not looking.
  useEffect(() => {
    if (!authUser) { writeUserSession(null); cachedSession.current = null; return; }
    if (!user) {
      if (playersLoaded) { writeUserSession(null); cachedSession.current = null; }
      return;
    }
    const entry = { ...user, auth_uid: authUser.uid };
    cachedSession.current = entry;
    writeUserSession(entry);
  }, [user, authUser, playersLoaded]);

  const doSignOut = useCallback(async () => {
    writeUserSession(null);
    cachedSession.current = null;
    setBootstrapDirector(false);
    await signOutUser();
  }, []);

  const [tRounds, setTRounds] = useState([]);
  const [courses, setCourses] = useState([]);
  const [matches, setMatches] = useState([]);
  const [holeData, setHoleData] = useState({});
  // One signature document per signed card — see lib/cardSigs. Kept as the
  // raw row array rather than keyed by match, because every consumer either
  // looks one match up (sigForMatch) or folds the whole round at once
  // (roundCardProgress), and a second shape would just be a third thing to
  // keep honest.
  const [cardSigs, setCardSigs] = useState([]);
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
  // Same reasoning for the signature rows: attesting is read-modify-write
  // against the CURRENT document (append this player to `attested_by`), and
  // a useCallback that closed over the state array would append to whatever
  // it saw when it was created — silently dropping the attestation that
  // landed in between.
  const cardSigsRef = useRef([]);
  const lockInputsRef = useRef({ players: [], tRounds: [], courses: [], hcpOverrides: {}, teeAssignments: {} });
  const lockInFlightRef = useRef({}); // { round: true } — de-dupes concurrent auto-locks in this client

  // ── Pull-to-refresh ── the gesture machinery lives in the shared
  // usePullToRefresh hook (src/lib/usePullToRefresh.js); it's wired up
  // below, after hasNewBundle. popupOpenRef stays here because the
  // caller owns it and passes it into the hook.
  //
  // It no longer has to list every modal in the app: anything rendered
  // through <Popup> stamps `data-popup` on its backdrop and the hook
  // suppresses on that by itself. What is left here is the overlays that
  // are NOT popups — the slide-up menu, and the finalize sheet that opens
  // from it. Read synchronously by the touch handlers (refs don't trigger
  // re-renders and are always up to date).
  const popupOpenRef = useRef(false);

  const navRef = useRef(null);

  // ── The nav's height, for the slide-up menu ONLY ──────────────────
  // This used to feed the scroll area's bottom clearance as well, and that was
  // the whole problem. The nav was a SECOND position:fixed element, a sibling
  // of the shell rather than a row inside it, so the shell had no idea it
  // existed and the scroll area had to reserve space for a bar it could not
  // see. Every "the last row is stuck under the bar" and "the bar floats above
  // the bottom" report was that reservation being briefly, or permanently,
  // the wrong number:
  //
  //   • On the first paint it is literally a guess — the state below seeded 64
  //     while the real bar is 56 plus the inset, so the very first frame of
  //     every cold start was wrong by up to 30px.
  //   • Montserrat is fetched at runtime (theme.js injects the <link>), so the
  //     10px labels re-metric when it lands. The bar changes height a beat
  //     after the app is interactive, and the reservation jumps with it.
  //   • Raising the OS text size scales the labels, so the bar grows and the
  //     reservation is short until an observer callback catches up.
  //
  // The nav is now an in-flow flex child of the shell, which means the SHELL
  // reserves the space, in layout, with no number at all. What is left here
  // feeds one consumer: the slide-up menu, which is an overlay that seats
  // itself on top of the bar and therefore genuinely needs a pixel figure.
  // That is a safe place for a measurement, and the reason it is the only one
  // left: if this is briefly stale the menu sits a couple of pixels off the
  // bar for one frame. It can no longer strand content behind anything.
  //
  // Still a BORDER-box observer. A ResizeObserver defaults to the content box
  // and this bar's height moves mostly through its padding — NAV_SAFE_PAD is
  // an env() inset, and iOS reports 0 for it while Safari's bottom toolbar is
  // expanded and the home-indicator figure once it collapses. A content-box
  // observer never fires on any of that.
  const [navH, setNavH] = useState(64);
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const measure = () => setNavH(Math.ceil(el.getBoundingClientRect().height));
    measure();
    // Viewport events as well as the observer: a safe-area inset can change
    // without the observed box changing at all on some engines, and these are
    // the moments it does. `measure` is idempotent — setNavH to the same
    // number is a no-op re-render.
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    window.visualViewport?.addEventListener("resize", measure);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el, { box: "border-box" });
    // Fonts are the other thing that changes this without a viewport event.
    document.fonts?.ready?.then(measure).catch(() => {});
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      ro?.disconnect();
    };
    // `user` is in the deps because the nav only exists once past the login
    // screen — without it the ref is null on mount and never measured.
  }, [user]);

  // ── Put the shell back on the top edge after the keyboard ─────────
  // The shell is position:fixed to the layout viewport, so it cannot be
  // scrolled — except that iOS does it anyway. When a field near the bottom
  // takes focus, WKWebView scrolls the LAYOUT viewport to bring it above the
  // keyboard, and it does that whether or not html/body say overflow:hidden.
  // Everything fixed goes up with it, which is exactly the "the header slides
  // off the top and the bar isn't at the bottom any more" report: the app is
  // fine, the window is offset. Worse, dismissing the keyboard does not always
  // put the offset back, so the app can sit permanently a few dozen pixels
  // high until something forces a scroll.
  //
  // This is NOT the banned viewport measurement. It never asks how tall
  // anything is and never sizes anything — it reads two offsets and, if either
  // is non-zero, sets it to zero. There is no value it can get wrong.
  //
  // Ordered so the common case costs nothing: bail immediately unless there is
  // actually an offset to clear.
  useEffect(() => {
    const reset = () => {
      if (window.scrollY !== 0 || window.pageYOffset !== 0) window.scrollTo(0, 0);
      const doc = document.scrollingElement || document.documentElement;
      if (doc && doc.scrollTop !== 0) doc.scrollTop = 0;
    };
    // On blur, and one frame later: iOS restores its own offset asynchronously
    // after the keyboard animation, so a single synchronous reset can be undone
    // by the platform a moment after it runs.
    const onFocusOut = () => { reset(); requestAnimationFrame(reset); setTimeout(reset, 150); };
    // The keyboard closing shows up as a visualViewport resize with no focus
    // change at all — e.g. the user hits the keyboard's own dismiss key.
    const onVvChange = () => { if ((window.visualViewport?.offsetTop || 0) === 0) reset(); };
    window.addEventListener("focusout", onFocusOut);
    window.addEventListener("orientationchange", onFocusOut);
    window.visualViewport?.addEventListener("resize", onVvChange);
    window.visualViewport?.addEventListener("scroll", onVvChange);
    return () => {
      window.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("orientationchange", onFocusOut);
      window.visualViewport?.removeEventListener("resize", onVvChange);
      window.visualViewport?.removeEventListener("scroll", onVvChange);
    };
  }, []);

  const notify = useCallback((msg, type = "success") => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 2800);
  }, []);

  // Keep popupOpenRef in sync with the non-<Popup> overlays so touch
  // handlers see "an overlay is open" without having to participate in
  // React's render cycle. A new modal built on <Popup> needs nothing here;
  // only another bespoke full-screen overlay would.
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
    unsubs.push(db.subscribe("bc_players", f, rows => { setTPlayers(rows); setPlayersLoaded(true); }));
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
    // No bc_skins listener: skins are derived from the cards in BettingView,
    // never stored. The collection is legacy — it was only ever written, and
    // subscribing to it cost a live listener to fill a map nothing read.
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
      if (s?.skins_pot != null) setSkinsPot(s.skins_pot);
      // `Array.isArray` is the whole test: an absent field reads as null
      // (everybody in), a stored [] reads as [] (nobody in).
      setBuyIns({
        skinsAmount: s?.skins_buyin || 0,
        skinsIn: Array.isArray(s?.skins_in) ? s.skins_in : null,
        ctpAmount: s?.ctp_buyin || 0,
        ctpIn: Array.isArray(s?.ctp_in) ? s.ctp_in : null,
      });
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
    unsubs.push(db.subscribe("bc_card_sigs", f, rows => {
      cardSigsRef.current = rows;   // keep the ref hot for the attest path
      setCardSigs(rows);
    }));
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

  // ── The blackout, applied once, at the source ────────────────────
  // Every hole past a sealed round's reveal, removed (see lib/reveal.js).
  // The read-only surfaces — the scoreboard and the analytics tab — are
  // handed THIS map rather than the real one, so a round nobody has turned
  // over yet is not a round they are trusted to draw carefully: it is a
  // round with no scores in it, and every point, strip, status and total
  // they compute follows from that on its own.
  //
  // The identity is returned untouched when nothing is sealed, which is
  // every round of every other day, so the memo chains downstream of this
  // are unaffected outside the one round it exists for.
  const revealedHoleData = useMemo(
    () => concealHoleData(holeData, enrichedRounds),
    [holeData, enrichedRounds]
  );

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
  // ── Delete Account (My Account → Delete Account) ──
  // The teardown itself is a Cloud Function on the admin SDK, because every
  // step of it is something the rules deny a client on purpose — see
  // lib/accounts.deleteAccount for the argument. What is left here is what
  // only this component knows: which player id owns the push tokens, and
  // where to put the app afterwards.
  //
  // A bootstrap director has no roster row and so no player id; there is
  // nothing to unsubscribe and the function finds nothing to unlink, which
  // is the right outcome rather than a special case.
  const onDeleteAccount = useCallback(async () => {
    if (!authUser) return { success: false, error: "Not signed in" };
    const pid = user?.player_id && user.player_id !== BOOTSTRAP_DIRECTOR.player_id
      ? user.player_id : null;

    const res = await deleteAccount({ playerId: pid });
    if (!res.ok) return { success: false, error: res.error };

    // The auth listener will fire with null on its own — the user record is
    // gone — but signing out locally makes the transition immediate rather
    // than dependent on the SDK noticing, and clears the cached identity.
    await doSignOut();
    // Home, not wherever we were. Both exits from My Account land on the
    // sign-in screen, and the next person to sign in on this device should
    // arrive at the leaderboard rather than at the settings screen the last
    // one happened to be standing on.
    setView("leaderboard");
    return { success: true };
  }, [authUser, user?.player_id, doSignOut]);
  const onAddCourse = useCallback(async (c) => { if (c._delete) { await db.delete("bc_courses", c.id); } else { await db.upsert("bc_courses", c); } }, []);
  // There is no onSetSkin. A skin is whoever is lowest on the hole, worked
  // out from the cards every time it is shown — see BettingView. Storing a
  // winner would create a second answer that can disagree with the scorecard
  // the field signed, and no screen ever offered a way to correct it.
  //
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
  // ── Card signature / attestation ─────────────────────────────────────
  // Three writes against bc_card_sigs, and the whole workflow is these
  // three plus the director's force-attest below. See lib/cardSigs for the
  // model and why signatures live in their own collection.
  //
  // Every field is written on every call, for the same reason onSetCtp does
  // it: db.upsert MERGES, so an update that omitted `attested_by` would
  // leave the previous list attached to a card that no longer has it.
  const onSignCard = useCallback(async (match, pid) => {
    if (!match || !pid) return null;
    // A match whose only member is the signer has nobody left to attest.
    // Rather than leaving it stuck at "waiting on 0 players" forever, it
    // attests itself at signing time — with `attested_by` populated, not
    // just the boolean, so the FINAL badge and the attester chips can never
    // disagree about the same card. (MnQ learned this one the hard way.)
    const others = nonSignerPids(match, { signed_by: pid });
    const doc = {
      id: editionDocId(cardSigBareId(match.round, match.id)),
      tournament_id: TOURNAMENT_ID,
      round_number: match.round,
      match_id: match.id,
      signed_by: pid,
      signed_at: new Date().toISOString(),
      // Empty in both branches — when `others` is empty there is nobody to
      // list, so the auto-attested card's chip row and its FINAL badge agree
      // by construction rather than by a second field being kept in step.
      attested_by: [],
      attested: others.length === 0,
    };
    return db.upsert("bc_card_sigs", doc);
  }, []);

  // Additive: an attester is appended, and the card flips to `attested`
  // only on the one that completes the set. Recomputed from the document
  // rather than from a count so two players attesting at once converge on
  // the same answer instead of racing to a stale total.
  const onAttestCard = useCallback(async (match, pid) => {
    if (!match || !pid) return null;
    const sig = sigForMatch(cardSigsRef.current, match.id);
    if (!sig) return null;
    const attested_by = [...new Set([...(sig.attested_by || []), pid])];
    const done = nonSignerPids(match, sig).every(p => attested_by.includes(p));
    return db.upsert("bc_card_sigs", { ...sig, attested_by, attested: done });
  }, []);

  // Unsign deletes the document outright rather than blanking its fields.
  // "No signature" and "a signature that has been withdrawn" are the same
  // state — the card is a draft again — and one of them is a row that has
  // to be filtered out of every count downstream.
  const onUnsignCard = useCallback(async (match) => {
    const sig = match ? sigForMatch(cardSigsRef.current, match.id) : null;
    if (!sig) return null;
    return db.delete("bc_card_sigs", sig.id || editionDocId(cardSigBareId(match.round, match.id)));
  }, []);

  // The director's escape hatch, ported from MnQ's handleAttestAllWeek: the
  // normal loop needs every non-signer to tap Attest, and a group that has
  // driven home without doing it blocks the round for everybody else. This
  // bypasses the second signature for every signed-but-unattested card in
  // one round. It cannot invent a signature — an unsigned card is still
  // unsigned afterwards, which is deliberate: force-attesting a card nobody
  // signed would be the app inventing the whole ritual, not just the reply.
  const onAttestAllInRound = useCallback(async (round, roundMatches) => {
    const pending = (roundMatches || []).filter(m => {
      const sig = sigForMatch(cardSigsRef.current, m.id);
      return sig && !isFullyAttested(m, sig);
    });
    for (const m of pending) {
      const sig = sigForMatch(cardSigsRef.current, m.id);
      await db.upsert("bc_card_sigs", {
        ...sig,
        attested_by: nonSignerPids(m, sig),
        attested: true,
        attested_forced_at: new Date().toISOString(),
      });
    }
    return pending.length;
  }, []);

  const onUpdatePot = useCallback(async (amt) => {
    setSkinsPot(amt);
    await db.upsert("bc_tournament_settings", { id: editionDocId("bc_settings_main"), tournament_id: TOURNAMENT_ID, skins_pot: amt });
  }, []);
  // Buy-ins, onto the same settings document — which the rules already make
  // director-write and everybody-read, so none of this needs a rules deploy.
  //
  // A MERGE of only the named fields, deliberately: writing the whole shape
  // every time would materialise `skins_in: null` as a stored field and
  // destroy the distinction between "never configured" and "nobody in".
  // Applied locally first so sixteen taps down a roster feel immediate.
  const onUpdateBuyIns = useCallback(async (patch) => {
    setBuyIns(b => ({
      ...b,
      ...("skins_buyin" in patch ? { skinsAmount: patch.skins_buyin } : {}),
      ...("skins_in" in patch ? { skinsIn: patch.skins_in } : {}),
      ...("ctp_buyin" in patch ? { ctpAmount: patch.ctp_buyin } : {}),
      ...("ctp_in" in patch ? { ctpIn: patch.ctp_in } : {}),
    }));
    await db.upsert("bc_tournament_settings", { id: editionDocId("bc_settings_main"), tournament_id: TOURNAMENT_ID, ...patch });
  }, []);
  const onSetRound = useCallback(async (r) => { await db.upsert("bc_rounds", r); }, []);
  // ── Turning a hole over ──────────────────────────────────────────
  // A merge write of ONE field on the round document, deliberately kept off
  // the Rounds tab's auto-save path (see lib/reveal.js): the reveal is a live
  // act performed in front of the room, and it must not be something a
  // director can trigger by editing a tee time. `bc_rounds` is director-only
  // in the rules, so who may do this is already settled there.
  const onSetReveal = useCallback(async (round, through) => {
    await db.upsert("bc_rounds", {
      id: editionDocId(`bc_round_${round}`),
      tournament_id: TOURNAMENT_ID,
      round_number: round,
      reveal_through: Math.max(0, Math.min(HOLE_COUNT, Math.round(through) || 0)),
    });
  }, []);
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
  // The same round counted the other way: how many of its cards have been
  // signed, and how many of those every non-signer has attested. See
  // lib/cardSigs.
  const roundCards = useMemo(
    () => roundCardProgress(enrichedMatches, cardSigs, currentRound),
    [enrichedMatches, cardSigs, currentRound]
  );
  // ── Push: foreground rendering and the app badge ─────────────────────
  // FCM does not display anything while the tab is focused, so the
  // foreground handler has to be attached for "a push always shows a
  // notification" to be true. Idempotent, and a no-op on a device that
  // never enabled push.
  useEffect(() => { initForegroundNotifications(); }, []);

  // The badge counts what this player still OWES — cards signed by someone
  // else in their match and not yet attested by them. That is why it is
  // computed here from live data rather than incremented by notifications:
  // a badge driven by pushes counts messages, and messages are not
  // obligations. Attesting on any device clears it on this one.
  // Scoped to the CURRENT round, which is the only one the Scoring tab will
  // let anybody act on (see "The round gate"). Normally that costs nothing —
  // a round cannot go final until its cards are attested — but the director
  // can finalize over an unattested card, and a badge counting something
  // with no reachable button would never clear.
  const myPendingAttest = useMemo(
    () => pendingAttestations(
      enrichedMatches.filter(m => m.round === currentRound),
      cardSigs, user?.player_id,
    ),
    [enrichedMatches, cardSigs, currentRound, user?.player_id]
  );
  useEffect(() => { syncAppBadge(myPendingAttest.length); }, [myPendingAttest.length]);

  const isDirector = !!user?.isDirector;
  // "Ready" is the blunt, complete-round definition, and deliberately so: a
  // notification that fired on a guess ("looks about done") would be the
  // same accident the round gate exists to prevent, pointed at the one
  // action that moves the whole field. Everything else goes through More.
  //
  // What counts as complete moved with the signature workflow: every card
  // ATTESTED, not merely every score typed. All eighteen holes being in is
  // now the condition for the last card being signable, not for the round
  // being over — the round is over when the field agrees it is. Attestation
  // implies completeness (a card cannot be signed with a hole missing) with
  // one exception, the director's force-attest, and that is a deliberate
  // human override rather than a gap.
  const finalizeReady = isDirector && currentRound != null && roundCards.complete;
  const finalizeNextRound = useMemo(
    () => nextRoundNumber(roundLocksData, tournamentRounds),
    [roundLocksData, tournamentRounds]
  );
  const finalizeLastFinal = useMemo(
    () => lastFinalRoundNumber(roundLocksData, tournamentRounds),
    [roundLocksData, tournamentRounds]
  );

  // ── The ways in ───────────────────────────────────────────────────
  // Sign in → password → claim a name, each one skipped once it has been
  // answered, which for almost everybody means none of them appear again
  // after the first time. Ordered by what is still unknown, and the splash
  // covers every unknown — Firebase restoring its session, the door, and
  // the roster that says which player this account is — because any of
  // them resolving to "no" too early puts a signed-in player back on a
  // login screen, which is the bug this whole feature exists to kill.
  const chrome = { tournamentName, tournamentLocation };
  if (authUser === undefined || (authUser && member === undefined) || (authUser && member && !user && !playersLoaded)) return <LoginSplash {...chrome} />;
  if (!authUser) return <SignInScreen {...chrome} initialError={authError} />;
  if (!member) return (
    // Re-read rather than assume: the membership document that was just
    // created is also where Admin access is read from, and a director flag
    // set in the console before the first sign-in would be missed by a
    // locally-invented one.
    <GateScreen {...chrome} authUser={authUser} onSignOut={doSignOut}
      onPassed={async () => { const { doc } = await loadMembership(authUser.uid); setMembership(doc || { uid: authUser.uid }); }} />
  );
  if (!user) return (
    <ClaimScreen
      {...chrome}
      players={tPlayers} teams={teams} darkMode={darkMode} authUser={authUser}
      onClaimed={p => {
        // The roster snapshot delivers this write back to us immediately
        // (Firestore fires listeners on local mutations), so `user` is
        // about to resolve on its own. Priming the cache here is for the
        // NEXT cold start, not for this render.
        const entry = { ...p, isDirector: !!p.isDirector, auth_uid: authUser.uid };
        cachedSession.current = entry;
        writeUserSession(entry);
      }}
      onDirector={() => setBootstrapDirector(true)}
      onSignOut={doSignOut}
    />
  );

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
    // amberInk, not amber: an active tab is an icon, a label and a rule
    // reading as ONE mark, and the label is 10px — so the whole mark takes
    // the colour the label needs. In dark mode the two are the same value.
    const clr = active ? BC.amberInk : BC.t3;
    const sz = 20;
    // Trophy silhouette is a PNG, not an SVG, so we can't simply stroke it
    // with `clr` like the other icons. Filter chains can approximate one
    // color but not arbitrary theme colors, which is why the inactive
    // trophy used to read as a different hue from its tab-mates. Switching
    // to a CSS mask + solid background means the icon takes the EXACT
    // BC.t3 / BC.amberInk currently in use, with zero color drift.
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

  // ══ App shell ══════════════════════════════════════════════════════
  // position:fixed, pinned to all four edges, and it is the ONLY thing in the
  // app that decides where the top and bottom edges are.
  //
  // ── Why fixed and not a measured height ──────────────────────────
  // The fixed containing block is the one bottom-edge signal iOS reports
  // honestly. In an installed home-screen app window.visualViewport.height
  // silently subtracts env(safe-area-inset-top) — 812 reported for a genuinely
  // 874pt iPhone 16 Pro webview — so any JS-measured height leaves a black band
  // exactly one Dynamic Island tall under the nav. Don't reintroduce one.
  // Safari also re-pins fixed elements above its own toolbar for free.
  //
  // ── Why the bottom is a plain 0 with NO padding ───────────────────
  // Two reasons, and they are the change that fixes the bar.
  //
  // 1. It has to stay 0 because nothing can paint below the viewport's bottom
  //    edge. A home-screen icon installed before the status-bar meta was fixed
  //    does get a viewport one status bar short of the screen, and this used to
  //    hang past the bottom edge to cover the difference. It cannot: the webview
  //    clips there, so reaching past it painted nothing and only cost the nav
  //    the labels it pushed down. That strip is coloured by the canvas instead —
  //    see bcGlobalCSS in theme.js.
  //
  // 2. No paddingBottom means the shell's CONTENT box bottom is the viewport
  //    bottom, which is what lets the nav be the last in-flow child of this
  //    flex column instead of a second position:fixed element. Those two
  //    resolve to the identical y-coordinate — same containing block, same
  //    edge — so in-flow costs nothing geometrically and buys the thing the
  //    fixed bar could never have: the shell KNOWS the bar is there. The scroll
  //    area is sized by flexbox around it, so there is no height to measure, no
  //    spacer to keep in step, and no frame on which the two disagree.
  //
  //    (An earlier "navfix" pass moved the nav in-flow and the bar came out
  //    mis-seated, which is why it went back to fixed. Two things were wrong in
  //    that pass and neither was the in-flow part: it also clamped the bar's
  //    bottom padding to a flat 10px, which is what actually mis-seated the
  //    labels, and index.html still said black-translucent, so the layout
  //    viewport genuinely ended one status bar above the glass and NO layout
  //    mode could have reached it.)
  //
  // ── Insets ────────────────────────────────────────────────────────
  // Left and right stay here: they apply to every row, and a landscape notch
  // has to inset the nav exactly as much as the content — being in-flow, the
  // nav now gets that for free instead of running under the rounded corner on
  // its own left:0/right:0.
  //
  // The TOP inset moved out, down into AppHeader. It was here, which meant one
  // gap above the trophy was the sum of three separate paddings in three
  // different components; and the strip it reserves was painted by the shell,
  // so a translucent status bar had page background sliding under it. The
  // header owns its own top spacing now. See AppHeader.
  //
  // `width` is gone too. left:0 + right:0 + width:100% is over-constrained, so
  // the browser drops one of them (`right`, in LTR) — the shell and the nav
  // were nominally agreeing about the right edge via two different properties.
  return (
    <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, left: 0, background: BC.bg, display: "flex", flexDirection: "column", fontFamily: FONT, overflow: "hidden", boxSizing: "border-box", paddingLeft: "env(safe-area-inset-left, 0px)", paddingRight: "env(safe-area-inset-right, 0px)" }}>
      <div style={{ maxWidth: 520, width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", flex: 1, minHeight: 0, position: "relative", padding: "0 4px" }}>
      {/* Top-level feedback from notify(). The scoring screens render
          their own <Toast> lower down for the auto-advance message —
          same component, different owner of when it shows. */}
      {/* `top` is an inset-aware string, not a number. The toast is
          position:fixed, so it was never affected by the shell's padding even
          when the shell had some — a plain 16 put it under the Dynamic Island
          on an installed app and under the status bar on Android edge-to-edge.
          Toast spreads `top` straight into its style, so a calc() works here
          with no change to the component. */}
      <Toast message={notif?.msg} type={notif?.type} top="calc(env(safe-area-inset-top, 0px) + 16px)" />

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
          // Same reason as the toast above: this is position:fixed at top:0, so
          // it starts at the physical top of the viewport and has to clear the
          // status bar / island itself.
          paddingTop: `calc(env(safe-area-inset-top, 0px) + ${Math.min(pullY, 100) - 20}px)`,
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
          cards={roundCards}
          onOpen={() => setFinalizeOpen(true)}
          onDismiss={() => snoozeFinalizeAlert(currentRound)}
        />
      )}

      {/* Content */}
      <div className="bc-app-body" style={{
        flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden",
        // Bottom stays 0 here. There is no nav clearance to reserve any more —
        // the nav is a sibling row below this box, not an overlay on top of it,
        // so this box's bottom edge IS the top of the bar and flexbox keeps it
        // there at every bar height. The small breathing gap is a real element
        // at the end of the content rather than padding on this container; see
        // the spacer below for why that distinction still matters.
        padding: "12px 10px 0 10px",
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
            holeData={revealedHoleData}
            ownHoleData={holeData}
            courses={courses}
            tRounds={enrichedRounds}
            tPlayers={tPlayers}
            rounds={availableRounds.length ? availableRounds : [1,2,3,4]}
            teams={teams}
            hcpOverrides={hcpOverridesData}
            teeAssignments={teeAssignmentsData}
            roundLocks={roundLocksData}
            viewer={viewerTeam}
            canReveal={isDirector}
            onSetReveal={onSetReveal}
            autoCountdown={AUTO_COUNTDOWN}
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
            cardSigs={cardSigs}
            onSignCard={onSignCard}
            onAttestCard={onAttestCard}
            onUnsignCard={onUnsignCard}
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
          <BettingView
            tPlayers={tPlayers}
            tRounds={enrichedRounds}
            rounds={tournamentRounds}
            currentRound={currentRound}
            courses={courses}
            /* Concealed hole data, same as the scoreboard and the analytics
               tab: skins are derived hole by hole off these scores, so the
               real map here would read out a sealed round's card one skin at
               a time from a tab nobody thought to check. */
            holeData={revealedHoleData}
            ctpData={ctpData}
            skinsPot={skinsPot}
            buyIns={buyIns}
            onSetCtp={onSetCtp}
            onUpdatePot={onUpdatePot}
            onUpdateBuyIns={onUpdateBuyIns}
            user={user}
            roundLocks={roundLocksData}
            hcpOverrides={hcpOverridesData}
            teeAssignments={teeAssignmentsData}
            teams={teams}
          />
        )}
        {view === "account" && (
          <AccountView
            user={user}
            // Both halves of "who you are", deliberately separate: the
            // ACCOUNT (which Google/Apple login this is) and the roster row
            // it claimed. Deleting the first unlinks the second, so the
            // screen has to be able to name each one.
            authUser={authUser}
            // The LIVE roster row, not the cached session entry, which was
            // written at the last snapshot and does not know about a rename
            // or a team change the director has made since.
            player={linkedPlayer(tPlayers, authUser?.uid)}
            teams={teams}
            darkMode={darkMode}
            onToggleTheme={toggleTheme}
            onLogout={() => { doSignOut(); setView("leaderboard"); }}
            onDeleteAccount={onDeleteAccount}
            notify={notify}
          />
        )}
        {(view === "analytics" || view === "history") && (
          /* Concealed hole data, same as the scoreboard: this tab's per-player
             W/L/PTS is the cup total sliced a different way, so a sealed round
             left in it would give the ending away from a tab nobody thought to
             check. */
          <AnalyticsView
            tPlayers={tPlayers} matches={enrichedMatches} holeData={revealedHoleData}
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
            memberships={memberships}
            onSetDirector={onSetDirector}
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

        {/* ── Breathing gap at the end of the content ───────────────────
            A CONSTANT 12px, and no longer clearance for anything.

            It used to be `max(navH + 8, 56 + navPadPx(...) + 8)` — the whole
            reservation for a bar the shell couldn't see. That is gone: the nav
            is a flex row below the scroll container now, so the space is
            reserved by layout and this is only the gap that keeps the last card
            off the bar's top border.

            Still an ELEMENT rather than padding on the scroll container, which
            is worth keeping for the reason it was introduced: a scroll
            container's bottom padding has a long history of being left out of
            scrollHeight (block containers in older Blink, and WebKit in cases
            this flex layout was meant to cover), and when it is dropped the
            reservation is invisible to scrolling. In-flow content has no such
            exemption — a box with a height is in the scrollable area in every
            engine. The stake is now 12px of whitespace rather than access to
            the last row, but there is no reason to reintroduce the hazard. */}
        <div className="bc-nav-spacer" aria-hidden="true" style={{ flexShrink: 0, height: 12 }} />
      </div>

      <SlideMenu open={menuOpen} onClose={() => setMenuOpen(false)} onNavigate={setView} user={user} view={view} finalize={finalizeMenu} navH={navH} />

      {/* The Finalize sheet — everything the removed Scoring card held, at
          zero cost until it is opened. */}
      {finalizeOpen && finalizeMenu && (
        <FinalizeRoundSheet
          round={currentRound}
          nextRound={finalizeNextRound}
          lastFinal={finalizeLastFinal}
          progress={roundProgress}
          cards={roundCards}
          tPlayers={tPlayers}
          onFinalizeRound={onFinalizeRound}
          onAttestAll={() => onAttestAllInRound(
            currentRound,
            enrichedMatches.filter(m => m.round === currentRound),
          )}
          notify={notify}
          onClose={() => setFinalizeOpen(false)}
        />
      )}
      </div>

      {/* ══ Bottom Nav ══════════════════════════════════════════════════
          The LAST IN-FLOW ROW of the shell's flex column. Not position:fixed.

          Those two land on the same pixel — the shell is fixed to all four
          edges with no bottom padding, so its content box bottom already IS the
          viewport bottom, and a `bottom: 0` fixed bar has the same containing
          block and the same edge. There is no geometric difference to gain or
          lose here, which is the point: in-flow is free, and it is the only
          version where the shell knows the bar exists.

          That is the whole fix for the bar. As a fixed sibling, the bar was
          invisible to the layout — flexbox sized the scroll area as if the
          bottom of the screen were empty, and the only thing keeping content
          from disappearing behind the bar was a JS-measured spacer trying to
          predict a height that changes with the safe-area inset, the OS text
          size, and whether Montserrat has finished downloading. Predicting it
          correctly on every frame of every device is not a solvable problem.
          As a flex row it isn't a prediction: `flexShrink: 0` here plus
          `flex: 1; minHeight: 0` on the scroll area above is the entire
          contract, resolved by the layout engine, on every frame, for free.

          flexShrink: 0 is load-bearing. Without it a tall enough scroll area
          could compress the bar rather than scroll, and the shell's
          overflow: hidden would clip the labels off the bottom.

          position: relative is what makes zIndex apply to an in-flow box —
          z-index is ignored on `position: static`. It stays at 100 so it keeps
          sitting under the slide menu's backdrop (200), which is what lets a
          tap on the bar dismiss the menu.

          paddingBottom is the home-indicator cushion, NAV_SAFE_PAD. It is
          inside the bar's box, so the card background still paints all the way
          down to the glass and only the labels are held clear. See the constant
          at the top of this file. */}
      <div ref={navRef} style={{ flexShrink: 0, position: "relative", background: BC.card, borderTop: `1px solid ${BC.bdr}`, zIndex: 100, paddingBottom: NAV_SAFE_PAD }}>
      {/* padding matches the content column's `0 4px` so the five tabs line up
          with the cards above them instead of being 4px wider on each side. */}
      <div style={{ maxWidth: 520, margin: "0 auto", display: "flex", padding: "0 4px" }}>
        {navItems.map(item => {
          const active = view === item.key;
          const clr = active ? BC.amberInk : BC.t3;
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
              // 6px at the bottom, not 10. The bar's excess height was here, not
              // in the safe-area inset: this padding and the inset were both
              // buying the same clearance below the labels, which is why the
              // inset previously got scaled to half. Trimming this instead means
              // the inset can be honoured in full — the platform figure, not a
              // fraction of it — and the bar still comes out shorter than before.
              flex: 1, padding: "8px 4px 6px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 3,
              background: "transparent", border: "none", cursor: "pointer", minHeight: 52,
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
              {active && <div style={{ width: 16, height: 2, borderRadius: 1, background: clr, marginTop: 2 }} />}
            </button>
          );
        })}
      </div>
      </div>
    </div>
  );
}
