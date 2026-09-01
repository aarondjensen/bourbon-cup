import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { BC, FONT, ON_ACCENT, SHADOW, ALPHA, ON_AMBER, HOLE_BANNER, FS, applyBCTheme, initialBCMode, bcGlobalCSS, teamColor, VP_BAND } from "./theme";
import { playerLookup, realPlayers } from "./lib/players";
import { db, writeFailure, TOURNAMENT_ID, getTournamentYear, getActiveTournamentId, getDefaultEditionId, editionDocId, setActiveTournamentId, readUserSession, writeUserSession, readTournamentIdentity, writeTournamentIdentity, BOOTSTRAP_DIRECTOR, SPECTATOR_ID } from "./firebase";
import { PROVIDERS, signIn, signOutUser, onAuthUser, consumeRedirectResult, isCancelled, whenAuthReady } from "./lib/auth";
import { claimPlayer, linkedPlayer, isClaimed, readMembership, isDirectorAccount, joinWithCode, setDirector, ACCOUNTS_COL, deleteAccount } from "./lib/accounts";
import { GUEST_USER, isGuest, readGuestMode, writeGuestMode } from "./lib/guest";
import {
  TROPHY_PHOTO, LOGO_TEAM_A, LOGO_TEAM_A_WHITE, LOGO_TEAM_B, TROPHY_SILHOUETTE,
  resolveTeams, DEFAULT_TEAM_NAMES, TOURNAMENT_TITLE, TOURNAMENT_LOCATION,
  FORMATS, NASSAU_DEFAULT, DEFAULT_FORMAT, DIRECTOR_CODE,
  describeAllowance, formatIsSharedBall, SCORING_TYPE_MATCH, SCORING_TYPE_TOTAL, SCORING_TYPE_POINTS,
  HOLE_SCORING_FORMAT, HOLE_SCORING_BEST_BALL, resolveScoring,
  HOLE_RULE_COUNTING, HOLE_RULE_FIXED,
  HOLE_METHOD_LABELS, HOLE_METHOD_DESCRIPTIONS,
  handicapModeFor, } from "./constants";
import {
  fmtScore,
  resolveHolePars, resolveHoleHcps,
  computeMatchResult,
  getRoundCH, lockForRound,
  totalUnit, segmentState, segmentOptsFor, holeFormatFor,
} from "./scoring";
import { holeFill } from "./lib/holeFill";
import {
  ROUND_LOCKS_COL, buildRoundLockDoc, refreshRoundLockDoc,
  markRoundFinal, unfinalizeRound, clearRoundLockDoc,
  roundLockState, currentRoundNumber, nextRoundNumber, lastFinalRoundNumber,
  LOCK_OPEN, LOCK_FINAL, LOCK_STATE_LABEL,
} from "./lib/roundLocks";
import {
  concealHoleData, revealState, revealSummary, HOLE_COUNT,
  COUNTDOWN_HASH,
} from "./lib/reveal";
import { usePullToRefresh } from "./lib/usePullToRefresh";
import { useFitDensity } from "./lib/useFitDensity";
import ErrorBoundary from "./components/ErrorBoundary";
import { AppHeader, HEADER_SLOT_ID, HEADER_TOAST_TOP } from "./components/AppHeader";
import { Popup, ConfirmModal } from "./components/Popup";
import { CtpPrompt } from "./components/CtpPrompt";
import { DirectorFinalizeAlert, FinalizeRoundSheet } from "./components/FinalizeRound";
import { MissingCardNote, SignCardSheet, SignedCardPanel } from "./components/CardSignature";
import { SideBets } from "./components/SideBets";
import { AccountView } from "./components/AccountView";
import { TripInfo } from "./components/TripInfo";
// ── Split off the main bundle ─────────────────────────────────────
// The gallery is the one screen whose weight nobody else should pay for: it
// carries the image pipeline, it is opened by a minority of the field, and it
// is never the screen somebody is standing on a tee holding. Its Firestore
// index is already subscribed on first open rather than at startup, for the
// same reason and with the same latch — this is that decision applied to the
// code as well as to the data.
const PhotosView = lazy(() =>
  import("./components/PhotosView").then(m => ({ default: m.PhotosView })));
// ── The big one ───────────────────────────────────────────────────
// Everything the director owns, and ~2,800 lines of it. Fifteen of sixteen
// people never open Admin, and until this boundary existed all fifteen
// downloaded it anyway — it was the single largest thing in the bundle that
// most of the field had no use for. See components/AdminView.
const AdminView = lazy(() =>
  import("./components/AdminView").then(m => ({ default: m.AdminView })));
// ── The Data tab ──────────────────────────────────────────────────
// Split for a second reason on top of the usual one: this chunk carries the
// ARCHIVE as well as the screen — ten finished years of matches and cards
// (data/bourbon-cup-archive.json, built by pipeline/archive.mjs). A phone
// that never opens the tab downloads neither. See lib/useArchive for why the
// history is a static asset rather than ten Firestore subscriptions.
const DataView = lazy(() => import("./components/DataView"));
import { photoUploadsAllowed, uploadsDisabledReason, CONFIG_COL, PHOTOS_CONFIG_ID } from "./lib/media";
import { REPORTS_COL, buildReport, reportsByMedia } from "./lib/mediaReports";
import { initForegroundNotifications, syncAppBadge } from "./lib/notifications";
import { tapFeedback, commitFeedback, applyNativeChrome } from "./lib/platform";
import { SegmentedToggle, SegRule, StickyTop, Banner, PlayerName, Toast, HoleNavigator, ScoreButtonRow } from "./components/ui";
import { GroupSwitcher } from "./components/GroupSwitcher";
import { useConfirm } from "./lib/useConfirm";
import { useStableCallback } from "./lib/useStableCallback";
import { EditionSwitcher } from "./components/EditionSwitcher";
import { EditionBanner } from "./components/EditionBanner";
import { GhinLinkButton, GhinSyncButton } from "./components/GhinLink";
import { TeamLeaderboard } from "./components/Leaderboard";
import { FullScorecard } from "./components/FullScorecard";
import { FieldCard } from "./components/FieldCard";
import { BuyInEditor } from "./components/BuyIns";
import { LowNetCard } from "./components/LowNetCard";
import { HolePotCard } from "./components/HolePotCard";
import { MatchSetup } from "./components/MatchSetup";
import {
  GROUPS_COL, groupsDocId, encodeGroups, decodeGroups,
  teeTimeForMatch, parseTeeTime, formatTeeTime, DEFAULT_TEE_INTERVAL, TEE_SLOTS,
  roundPlaySetup, orderMatchesForRound, numberMatches, groupIndexForMatch,
} from "./lib/groups";
import { firstTeeAt } from "./lib/countdown";
import { groupKey, tagAheadOfPlay } from "./lib/ctp";
import { roundScoreProgress, finalizeStage } from "./lib/scoreGuard";
import {
  allRounds, MAX_ROUND_COUNT,
} from "./lib/rounds";
import { summarizeEdition, sameSummary } from "./lib/editionSummary";
import {
  inField, roundSetup, strokeMapsFor, computeSkins, lowNetRows, ctpTags, ctpPinTotal,
  potHole, holePotRows, holePotWins,
} from "./lib/betting";
import { SIDE_BETS_COL, sideBetId, buildSideBet, toggleSettled } from "./lib/sideBets";
import {
  LEDGER_COL, DUES_SETTINGS_ID, paymentId, buildPayment, paymentError,
  balanceFor, owesMoney, round2,
} from "./lib/ledger";
import {
  BUDGET_COL, budgetLineId, buildBudgetLine, budgetLineError,
} from "./lib/budget";
import { EDITIONS_COL, isDemoEdition } from "./lib/editions";
import { lockNotice, isEditionLocked, demoOnlyAdmin } from "./lib/editionLock";
import { liveEdition } from "./lib/defaultEdition";
import { prefetchArchive } from "./lib/useArchive";
import { TRIP_SETTINGS_ID, houseFrom, tripSchedule, tripDates } from "./lib/tripInfo";
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


// Where a dismissed finalize notification is remembered, per edition —
// TOURNAMENT_ID is a live binding (firebase.js reassigns it when the edition
// changes), so this is read at call time, never captured once.
const finalizeSnoozeKey = () => `bc_finalize_snooze_${TOURNAMENT_ID}`;

// The stored value is `${round}:${stage}` — see the two-stage note in
// components/FinalizeRound. Dismissal has to be remembered per STAGE, not
// per round: putting away "all scores are in" must not also swallow "the
// round is ready" twenty minutes later, because they are answers to
// different questions.
//
// A bare number is what this key held before stages existed, and it meant a
// dismissed READY alert. Reading it as such costs one line and stops a
// director mid-tournament from being re-prompted about a round they already
// put away.
const finalizeSnoozeTag = (round, stage) => `${round}:${stage}`;
const normalizeSnooze = (raw) =>
  raw == null || raw === "" ? null : (/^\d+$/.test(raw) ? `${raw}:ready` : raw);

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
// Two providers and a guest door. The guest door is deliberately the
// quietest thing on the screen — a link under a hairline, not a third
// button of the same weight — because it is not the way in for anybody
// playing in the tournament, and a player who takes it lands somewhere
// they cannot post a score from. See lib/guest.js for why it grants
// nothing at all and needs no rules of its own.
function SignInScreen({ tournamentName, tournamentLocation, initialError, onGuest }) {
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

      {/* ── The guest door ────────────────────────────────────────────
          Not disabled by `ready`: that flag is about whether a popup can
          be opened yet, and this opens nothing. It is a local flag and a
          re-render, so it works the instant the screen is painted.

          The line under it is the whole contract, said before the tap
          rather than discovered after it. "Read-only" is not a policy this
          screen is choosing — a guest has no Firebase account, so every
          write rule in the project refuses them at `request.auth != null`
          without ever reaching a membership check. */}
      <div style={{ width: "100%", maxWidth: 340, marginTop: 2, paddingTop: 14, borderTop: `1px solid ${BC.bdr}${ALPHA.hair}`, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <button onClick={onGuest} disabled={!!busy} style={{
          background: "transparent", border: "none", color: BC.t2,
          fontFamily: FONT, fontSize: FS.small, fontWeight: 700, letterSpacing: 0.3,
          textDecoration: "underline", textUnderlineOffset: 3,
          cursor: busy ? "default" : "pointer", padding: "4px 8px",
        }}>Look around as a guest</button>
        <div style={{ textAlign: "center", fontSize: FS.label, color: BC.t3, lineHeight: 1.45, maxWidth: 300 }}>
          No account, read-only. Nothing you tap can change the tournament.
        </div>
      </div>
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
//
// It also carries the guest door a second time, and that is the point of
// putting it here: the two provider buttons are the biggest thing on the
// sign-in screen and the guest link is deliberately not, so a tester who
// took the obvious one arrives HERE — at a password they were never given,
// with "Sign out" as the only way forward. That is the dead end this
// screen would otherwise be for everybody the guest door was built for.
function GateScreen({ tournamentName, tournamentLocation, authUser, onPassed, onSignOut, onGuest }) {
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
        {/* Which account, because the way out of a wrong one is the Sign out
            below. "Enter the tournament password" used to follow it, over a
            box placeheld Password. */}
        <div style={{ textAlign: "center", fontSize: FS.small, color: BC.t3, lineHeight: 1.4 }}>
          Signed in as {authUser?.email || "your account"}.
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

      {/* Two ways back, on one line. Signing out returns to the providers;
          the guest link signs out AND takes the guest door in one tap, so
          somebody without the password never has to work out that the way
          forward is backwards. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        <button onClick={onSignOut} style={{
          background: "transparent", border: "none", color: BC.t3,
          fontSize: FS.small, fontFamily: FONT, textDecoration: "underline", cursor: "pointer", padding: "4px",
        }}>Sign out</button>
        <span aria-hidden="true" style={{ color: BC.t3, fontSize: FS.small, opacity: 0.5 }}>·</span>
        <button onClick={onGuest} style={{
          background: "transparent", border: "none", color: BC.t3,
          fontSize: FS.small, fontFamily: FONT, textDecoration: "underline", cursor: "pointer", padding: "4px",
        }}>Look around as a guest</button>
      </div>
    </LoginChrome>
  );
}

// ── Screen 3: claim your name ───────────────────────────────────────
// Shown to a signed-in account that no roster document points at. Tapping
// a name selects it; a second tap on the confirm bar commits, because the
// link is meant to be permanent and a mis-tap on a 12-name grid is not.
// ── Claiming into a LOCKED edition ──────────────────────────────────
// A locked edition refuses the claim write — `bc_players`'s rule starts at
// canWriteEdition(), which is `isMember() && (editionOpen() || isDirector())`.
// So the roster grid was offering twelve names that could not be tapped into,
// and the refusal only arrived after the tap.
//
// This is the lock's blind spot from the far end. A director writes through
// locks, so the person who set one cannot see what it did to everybody else;
// the first person to meet it is a member who is not a director, which on this
// app means a new player, a Play tester, or a store reviewer. All three of
// them arrive at this exact screen.
//
// It matters most on a fresh install, which lands on DEFAULT_TOURNAMENT_ID
// rather than on anything a director chose — so somebody handed the app can
// open it, present the password, and find a roster they are not allowed to
// join, with no hint that another tournament exists.
//
// Hence both halves: say so BEFORE the tap, and offer the way out. The
// switcher is here for everyone, not only when locked, because "I am in the
// wrong year" is the same problem arriving quietly.
// Height of the claim screen's confirm bar, held open whether or not the
// button is in it — see the slot below. A plain number rather than a clamp
// because the space has to be reserved before anybody has picked a name,
// and 44 is the tap target the button wants anyway.
const CONFIRM_BAR_H = 44;

function ClaimScreen({ players, teams, darkMode, tournamentName, tournamentLocation, authUser, onClaimed, onDirector, onSignOut, editionLocked = false }) {
  const [code, setCode] = useState("");
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [switcherOpen, setSwitcherOpen] = useState(false);

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
  // A team with no logo at all is an edition whose teams are not these teams —
  // an imported year, where the badge above the column would be somebody
  // else's (see resolveTeams). The theme swap only applies to the Mash logo it
  // was written for, so it happens INSIDE the branch that has one.
  const customLogoA = typeof teams.A.logo === "string" && teams.A.logo.startsWith("data:");
  const teamA = {
    ...teams.A,
    logo: customLogoA ? teams.A.logo : (teams.A.logo ? (darkMode ? LOGO_TEAM_A : LOGO_TEAM_A_WHITE) : null),
  };
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
    // Two different reasons a name can't be tapped, and they must not share a
    // sentence. A locked edition greys the WHOLE roster, so telling somebody
    // that all sixteen names are "already linked to an account" is sixteen
    // false statements on a screen whose banner has just told them the truth —
    // and it points the one person who might fix it at the wrong problem.
    const claimed = isClaimed(p);
    const taken = claimed || editionLocked;
    const sel = picked?.player_id === p.player_id;
    return (
      <button
        onClick={() => !taken && setPicked(sel ? null : p)}
        disabled={taken || busy}
        title={claimed ? `${p.name} is already linked to an account`
          : editionLocked ? "This tournament isn't taking new players" : undefined}
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
      {players.length > 0 && !editionLocked && (
        <div style={{ textAlign: "center", marginBottom: 10, fontSize: FS.body, fontWeight: 700, color: BC.t1 }}>
          Select Your Name
        </div>
      )}

      {/* Said before the tap, not after it. The write would be refused either
          way; the difference is whether somebody learns that from a sentence
          or from a button that appears to do nothing. */}
      {editionLocked && (
        <div style={{
          width: "100%", maxWidth: 480, marginBottom: 10, padding: "10px 12px", borderRadius: 10,
          background: BC.card + ALPHA.panel, border: `1px solid ${BC.bdr}`,
          textAlign: "center", position: "relative", zIndex: 1,
        }}>
          <div style={{ fontSize: FS.body, fontWeight: 700, color: BC.t1, marginBottom: 4 }}>
            This tournament is closed
          </div>
          <div style={{ fontSize: FS.small, color: BC.t3, lineHeight: 1.45 }}>
            {tournamentName || "It"} isn&rsquo;t taking new players, so you can&rsquo;t claim a name here.
            Open a different tournament, or ask the director to unlock this one.
          </div>
          <button onClick={() => setSwitcherOpen(true)} style={{
            marginTop: 8, padding: "8px 14px", borderRadius: 8,
            background: BC.gold, border: "none", color: ON_AMBER,
            fontFamily: FONT, fontSize: FS.small, fontWeight: 800, cursor: "pointer",
          }}>Choose a tournament</button>
        </div>
      )}

      {/* Two-column layout with logos above each column */}
      <div style={{ width: "100%", maxWidth: 480, display: "flex", gap: "clamp(6px, 2vw, 12px)", position: "relative", zIndex: 1, alignItems: "flex-start" }}>
        {[teamA, teamB].map((team) => {
          const teamPlayers = players.filter(p => p.team === team.id);
          return (
            <div key={team.id} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
              {/* Logo centered above column — or the team's NAME, on a year
                  whose teams have no logo. The old cups had names and nothing
                  else, and the name is the thing that identifies the side. */}
              {team.logo ? (
                <img src={team.logo} alt={team.name} style={{ width: "clamp(60px, 32vw, 90px)", height: "clamp(44px, 22vw, 64px)", objectFit: "contain", marginBottom: 6 }} />
              ) : (
                <div style={{
                  width: "100%", height: "clamp(44px, 22vw, 64px)", marginBottom: 6,
                  display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center",
                  color: team.accent, fontSize: `clamp(${FS.body}px, 4.6vw, ${FS.title}px)`,
                  fontWeight: 800, letterSpacing: 0.5, lineHeight: 1.15, textTransform: "uppercase",
                  overflowWrap: "anywhere",
                }}>{team.name}</div>
              )}
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

      {/* ── Confirm bar ──
          The SLOT is always here; only the button inside it comes and goes.
          LoginChrome centres the whole panel with `margin: auto`, so a
          control that materialises out of nowhere grows the panel and walks
          every name up the screen — under the thumb that just tapped one,
          which is how you tap a name, watch the grid jump, and land on the
          wrong confirmation. Holding the height is the same trick LoginNote
          below has always used for its error line.

          Reserved only when there is a roster to pick from: on the empty
          bootstrap screen nothing can ever appear in it, so it would be
          44px of dead space above the director-code row.

          The label never wraps — a second line would overflow the reserved
          height and put the shift straight back. It shrinks with the
          viewport instead, which fits the longest name on the roster down
          to a 320px phone, and ellipsises rather than wrapping past that. */}
      {players.length > 0 && (
        <div style={{ width: "100%", maxWidth: 480, height: CONFIRM_BAR_H, marginTop: 10, flexShrink: 0 }}>
          {picked && (
            <button onClick={doClaim} disabled={busy} style={{
              width: "100%", height: "100%", padding: "0 14px", borderRadius: 12,
              background: BC.gold, border: "none", color: ON_AMBER,
              fontFamily: FONT, fontSize: `clamp(11px, 3.4vw, ${FS.body}px)`, fontWeight: 800,
              cursor: busy ? "default" : "pointer",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {busy ? "Linking…" : `I'm ${picked.name} — link this account`}
            </button>
          )}
        </div>
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
        {/* Not only for the locked case: "I am in the wrong year" is the same
            problem arriving without a notice to explain it. */}
        {!editionLocked && (
          <button onClick={() => setSwitcherOpen(true)} style={{
            background: "transparent", border: "none", color: BC.t3,
            fontSize: FS.small, fontFamily: FONT, textDecoration: "underline", cursor: "pointer", padding: "7px 4px",
          }}>Switch tournament</button>
        )}
        <button onClick={onSignOut} style={{
          background: "transparent", border: "none", color: BC.t3,
          fontSize: FS.small, fontFamily: FONT, textDecoration: "underline", cursor: "pointer", padding: "7px 4px",
        }}>Not you? Sign out</button>
      </div>

      {/* canManage=false deliberately: this screen belongs to somebody who has
          not claimed a name yet, and creating or cloning an edition from here
          is not a thing they should be able to reach.

          spectate=false for the same reason: the switch CLEARS the session
          rather than writing the spectator (lib/editions), so the app comes up
          on the new edition and asks the claim question again against ITS
          roster. With the spectator it would land past that question, and
          claimPlayer has no other call site — the door would open onto a room
          with no exit. */}
      <EditionSwitcher open={switcherOpen} onClose={() => setSwitcherOpen(false)} canManage={false} spectate={false} />
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

function ScoreEntry({ user, matches, holeData, onSaveHole, tPlayers, courses, tRounds, notify, teams, hcpOverrides, teeAssignments, roundLocks, rounds, currentRound, groups, ctpData, onSetCtp, onConfirmCtp, cardSigs, onSignCard, onAttestCard, onUnsignCard }) {
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
    useHoleAdvance({ matchId: match?.id ?? null, pids: matchPids, getScore, hold: ctpPrompt != null });

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
      {/* Pinned to the app header band and kept to one line, because
          everything below that band on this screen is a tappable hole — see
          AppHeader's HEADER_TOAST_TOP and ui's Toast. */}
      <Toast message={toast} top={HEADER_TOAST_TOP} oneLine />
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

  // A guest is nobody on the roster, so they are in no match and never will
  // be — telling them they are "not in a Round 2 match" reads as something
  // the draw could fix. It cannot; they have no account. Said once, here,
  // rather than as a banner on every tab, because this is the only screen
  // in the app a guest cannot use.
  if (!match && isGuest(user)) return empty(
    "👀",
    "Scoring needs an account",
    "You're looking around as a guest, so there's no card with your name on it. Everything else is live — the Leaderboard, the draw on Matches, and ten years of it under More → Data."
  );

  if (!match) return empty(
    "⛳",
    `You're not in a Round ${viewRound} match`,
    myMatches.length === 0 && matches.some(m => [...m.teamA, ...m.teamB].includes(userPid))
      ? `Scoring is open for Round ${viewRound} only. Your other rounds are on the Matches tab.${viaCrown}`
      : `Check the Matches tab once the draw is made.${viaCrown}`
  );

  if (!course) return empty("⛳", `Round ${match.round} course not configured yet`);

  // ── Closest-to-the-pin ───────────────────────────────────────────────
  // The hole's standing tag, live from Firestore. `null` until some group
  // has claimed it.
  const ctpFor = (h) => ctpData?.[`${match.round}_${h}`] || null;

  // Where this match sits in the round's draw, and who its group is. Both
  // ride along on any tag this device makes, so the NEXT group to be asked
  // can be told whether the number in front of them came from behind them —
  // see lib/ctp. A match nobody has grouped, or one spread across two
  // groups, has no place in the order and says so with a null: unknown must
  // never read as "off first".
  const myGroupIdx = (() => {
    const gs = groups?.[match.round];
    if (!gs?.length) return null;
    const i = groupIndexForMatch({ groups: gs, match });
    return i < 0 ? null : i;
  })();
  const myGroupKey = myGroupIdx == null ? null : groupKey(groups[match.round][myGroupIdx]);

  // When the score just entered completes a par 3 for THIS group, pop the tag
  // popup on the device that entered it. Every group gets the prompt as they
  // walk off the green — an earlier group's tag shows in the popup as the
  // number to beat, so a group either claims the hole with a shorter distance
  // or passes and leaves it standing.
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
  const maybePromptCtp = (pids, h, score, priorScore) => {
    if (score <= 0) return;
    if ((holePars[h] || 4) !== 3) return;
    if (priorScore > 0) return;
    const key = `${match.round}_${h}`;
    if (promptedCtp.current[key]) return;
    if (ctpFor(h)?.approved) return;
    if (!matchPids.every(p => pids.includes(p) || getScore(p, h) > 0)) return;
    promptedCtp.current[key] = true;
    setCtpPrompt(h);
  };

  // Provisional by definition — `approved: false`. The director settles the
  // hole from Betting → CTP, and only that write freezes it.
  const saveCtp = async (winnerPid, feet) => {
    const h = ctpPrompt;
    setCtpPrompt(null);
    await onSetCtp(match.round, h, winnerPid, {
      distanceFt: feet, approved: false, taggedBy: userPid,
      groupKey: myGroupKey, groupOrder: myGroupIdx,
    });
    const nm = tPlayers.find(p => p.player_id === winnerPid)?.name || "";
    // Through notify(), not the hole-advance toast: tagging a CTP is ordinary
    // app feedback, not part of the "this hole is done" sequence.
    notify(`🎯 CTP tagged — hole ${h + 1} · ${nm} ${feet} ft`);
  };

  // The other answer the prompt takes. A group that walks off a par 3 without
  // getting inside the standing tag is not saying nothing — they are saying
  // the tag is right, and that is the only thing that turns "nobody has been
  // asked" into "everybody has been asked and it stands". Recorded against
  // the reader's own player id, so a hole cannot be confirmed by a phone
  // nobody is holding.
  const confirmCtp = async () => {
    const h = ctpPrompt;
    if (h == null || !userPid) return;
    await onConfirmCtp?.(match.round, h, userPid);
  };

  // ScoreButtonRow hands back the new gross directly (0 = cleared, which it
  // sends when the active button is tapped again), so no toggle logic here.
  //
  // `pids` is every player this one tap writes to — one, except on a
  // shared-ball side (scramble, pinehurst), where it is both partners: they
  // play one ball, so one tap posts the same gross to both of their
  // individual bc_hole_scores docs (see the card-group render below). The
  // per-player doc shape stays untouched — lib/scoreGuard is explicit that a
  // card belongs to the player who shot it — this just writes it twice.
  const onTapScore = async (pids, score) => {
    // A signed card is not editable. In practice this is unreachable — the
    // signed view replaces the score buttons entirely — but it is the write
    // path, and the screen it defends against is one another device can put
    // it into mid-tap. Cheap, and the alternative is a score that lands in a
    // card somebody has already sworn to.
    if (signed) return;
    // Read the hole and the (representative) existing score BEFORE the
    // write — the CTP trigger below needs to know this was a first entry,
    // and auto-advance can move activeHole while the save is in flight.
    const h = activeHole;
    const prior = getScore(pids[0], h);
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
      const ok = await confirmEdit(pids, h, prior, score);
      if (!ok) return;
      setArmedMatchId(match.id);
    }
    // A stroke landing, felt rather than only seen. No-op on the web, and
    // never awaited — the score posts whether or not the taptic engine
    // answered. See lib/platform.
    tapFeedback();
    await Promise.all(pids.map(pid => onSaveHole(pid, match.round, h, score || null, tr?.course_id)));
    maybePromptCtp(pids, h, score || 0, prior);
  };

  // What a tap asks. Lifted out of onTapScore only to keep the write path
  // readable — the banner's Edit button asks its own, shorter question, since
  // it is arming deliberately rather than intercepting a tap and has no score
  // to name.
  const confirmEdit = async (pids, h, prior, next) => {
    const who = pids.map(pid => tPlayers.find(p => p.player_id === pid)?.name || pid).join(" / ");
    const state = LOCK_STATE_LABEL[roundLockState(roundLocks, match.round)];
    const was = prior > 0 ? String(prior) : "no score";
    const now = next > 0 ? String(next) : "no score";
    return confirm({
      eyebrow: `Round ${match.round} · ${state}`,
      title: "Change a score in a closed round?",
      // The eyebrow says which round and that it is closed; the title says
      // it again. "This is not the round being played" made three.
      message: [
        `${who}, hole ${h + 1}: ${was} → ${now}.`,
        "",
        "It posts immediately and moves the leaderboard. The players in this match are not asked.",
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
                "Anything you change posts immediately and moves the leaderboard. The players in this match are not asked.",
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
        // A card-coloured bar with a neutral edge sat flat against the strips
        // above it and read as a caption. It keeps its footprint — a hint of
        // the accent on the edge, full-strength ink, and a shadow to lift it
        // off the background is enough to read as something to tap.
        border: `1px solid ${canSign ? BC.amber + ALPHA.line : BC.amber + ALPHA.hair}`,
        boxShadow: `0 1px 2px ${SHADOW}`,
        color: canSign ? BC.amberInk : BC.t1,
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

      {/* No CTP row rides above the players on a par 3. The prompt that
          fires once the hole is scored asks the question and shows the
          standing distance, so a second copy of it here only bought a row —
          and on a par 3 that row pushed the last player's score buttons
          down behind the tab bar. The prompt is the whole story. */}

      {/* Player score cards — 4 stacked, T1 above dashed divider, T2 below.
          Each shows one header row — name, (CH), stroke dots on the left,
          "Net ±X thru N" right-aligned — then a row of par-relative score
          buttons. Tap a saved score again to clear.
          On a shared-ball format (scramble, pinehurst) each SIDE gets one
          card instead of one per player — the side plays one ball, so it
          gets one input, joined names, and the team's summed-then-rounded
          handicap. See onTapScore for the write side of this. */}
      <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: fit.cardGap }}>
        {(() => {
          const shared = formatIsSharedBall(format);
          const teamACards = shared ? [match.teamA] : match.teamA.map(pid => [pid]);
          const teamBCards = shared ? [match.teamB] : match.teamB.map(pid => [pid]);
          return [...teamACards, "DIVIDER", ...teamBCards];
        })().map((pids) => {
          if (pids === "DIVIDER") return <div key="div" style={{ borderTop: `1px dashed ${BC.bdr}`, flexShrink: 0, margin: `${fit.cardGap}px 0` }} />;
          const team = match.teamA.includes(pids[0]) ? "A" : "B";
          const cur = getScore(pids[0], activeHole);
          const strokes = strokeMaps[pids[0]]?.[activeHole] || 0;
          // CH for display — per-player tee assignment overrides round default,
          // matching the strokeMaps memo above and computeMatchResult. Fetched
          // per pid even on a shared card: the tooltip below names each
          // partner's own Course Handicap alongside the team's summed figure.
          const fullCHs = pids.map(pid => getRoundCH({
            roundLocks, round: match.round, pid, players: tPlayers,
            course, chOverrides: hcpOverrides, teeAssignments, roundTee,
          }));

          let ch, chTitle, reduced;
          if (pids.length > 1) {
            // A side that plays one ball has one handicap: computeMatchResult's
            // own sum-then-round figure (scoring.js "Shared-ball team
            // handicaps"), never either partner's individually-rounded
            // playingCH. exactCH is the unrounded per-player share that sum
            // was taken from — dividing it back by each partner's own raw CH
            // reads off the allowance percentage that was actually applied,
            // without re-deriving the low/high split here.
            ch = result?.teamCH?.[team] ?? 0;
            reduced = true;
            const exactCH = result?.exactCH || {};
            const terms = pids.map((pid, i) => {
              const full = fullCHs[i];
              const pct = full > 0 ? Math.round(((exactCH[pid] ?? 0) / full) * 100) : 0;
              return `${pct}% of ${full}`;
            }).join(" + ");
            chTitle = `Team playing handicap ${ch} — ${terms}`;
          } else {
            // Show the number the dots were actually allocated from. On a
            // round with a handicap allowance that is the reduced PLAYING
            // handicap, not the full Course Handicap — printing the full
            // figure beside three-quarters of the dots is how a player
            // concludes the app has shorted them. The full CH stays
            // available on the tooltip.
            const fullCH = fullCHs[0];
            const playingCH = result?.playingCH?.[pids[0]];
            ch = playingCH ?? fullCH;
            reduced = playingCH != null && playingCH !== fullCH;
            chTitle = reduced
              ? `Playing handicap ${ch} — ${describeAllowance(result?.allowance)} allowance off a Course Handicap of ${fullCH}`
              : `Course Handicap ${ch}`;
          }
          // Running net to par thru holes scored — one shared line for a
          // shared-ball side, since both partners' scores and strokes are
          // identical by construction.
          let netToPar = 0, thru = 0;
          for (let h = 0; h < 18; h++) {
            const s = getScore(pids[0], h);
            if (s > 0) {
              const st = strokeMaps[pids[0]]?.[h] || 0;
              netToPar += (s - st) - holePars[h];
              thru = h + 1;
            }
          }

          return (
            <div key={pids.join("_")} style={{
              background: BC.card, borderRadius: 10, padding: fit.cardPad,
              flex: "1 1 0", minHeight: 0, maxHeight: fit.cardMax, display: "flex", flexDirection: "column",
              border: `1px solid ${BC.bdr}`,
            }}>
              {/* Header row — name(s) + (CH) + stroke dots clustered tight on
                  the LEFT, so the handicap context reads as attached to the
                  player(s) it describes, and the running Net pushed to the far
                  RIGHT of the same row. The Net used to sit on a line of its
                  own beneath; folding it up here buys back a row per card,
                  which over four cards is most of the difference between the
                  scoring screen fitting a phone and having to be scrolled. */}
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 3, minWidth: 0, flexShrink: 0 }}>
                {/* `team` here is the side of THIS match, not the roster row —
                    they agree in every real draw, and the match is the thing
                    on screen. */}
                <span style={{ fontSize: FS.body, fontWeight: 700, color: BC.t1, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flexShrink: 1 }}>
                  {pids.map((pid, i) => (
                    <span key={pid}>
                      {i > 0 && " / "}
                      <PlayerName name={tPlayers.find(t => t.player_id === pid)?.name || pid} team={team} />
                    </span>
                  ))}
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
                  par={par} score={cur} onScore={(v) => onTapScore(pids, v)}
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
            outOfOrder={rec ? tagAheadOfPlay({
              leaderOrder: rec.tagged_group_order,
              leaderKey: rec.tagged_group_key,
              myOrder: myGroupIdx,
              myKey: myGroupKey,
            }) : null}
            onSave={saveCtp}
            onPass={confirmCtp}
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



// ── Betting View ──
//
// The two side games that run across the whole tournament instead of inside
// any one match. They are built on opposite principles, deliberately:
//
// SKINS ARE DERIVED, never stored. Low score on a hole takes it, a tie pushes
// it, and the pot divides by however many were won. There is no skins editor
// anywhere in the app on purpose — a stored winner is a second answer that can
// disagree with the card, and the card is the one the field signed. (There was
// once a `bc_skins` collection; it was only ever written, never read, and it
// has been retired — see the note on the subscription list in App.)
//
// CTP IS CAPTURED, because it is the one thing here the card does not record.
// Groups tag their own par 3s from the Scoring tab as they walk off the green
// — provisional, `approved: false` — and the director settles each hole from
// this screen. See onSetCtp for why that split exists.
//
// SIDE BETS ARE NEITHER. The fourth tab is a ledger of wagers the app does not
// run and cannot score — see components/SideBets. It replaced Settle, which
// summed the three scored games into a net position per player; that was
// arithmetic already readable off the three tabs it summarised, and the thing
// with genuinely nowhere to live was the bet two players make on the first
// tee.
function BettingView({ tPlayers, tRounds, rounds, currentRound, courses, holeData, ctpData, skinsPot, buyIns, onSetCtp, onUpdatePot, onUpdateBuyIns, user, authUid, sideBets, onAddSideBet, onDeleteSideBet, onSettleSideBet, confirm, roundLocks, hcpOverrides, teeAssignments, teams }) {
  const [activeTab, setActiveTab] = useState("skins");
  const [activeRound, setActiveRound] = useState(null);
  const [editPot, setEditPot] = useState(false);
  const [potInput, setPotInput] = useState("");
  // NET is the default. Skins here are played off the handicaps, so net is the
  // game and gross is the deviation — the tab used to open on gross and every
  // player had to tap across before the board showed the money they were
  // actually playing for.
  //
  // Gross stays the LEFT-hand option even though it is no longer the default:
  // the pair reads gross-then-net everywhere else in golf, and reordering a
  // two-way toggle to match its default is how somebody taps the side they
  // have always tapped and gets the other answer.
  const [grossMode, setGrossMode] = useState(false);
  // The CTP tab keeps its own round and its own open state. Sharing them with
  // the skins card would mean opening one tab silently rearranged the other.
  const [ctpRound, setCtpRound] = useState(null);
  const [lowNetRound, setLowNetRound] = useState(null);
  const [holePotRound, setHolePotRound] = useState(null);
  const [editBuyIns, setEditBuyIns] = useState(null); // "skins" | "ctp" | "lownet" | "holepot" | null

  // ── Who is playing for what ──
  // A null list means the director has never tagged anybody, and that means
  // EVERYBODY — so a tournament that never opens the buy-in panel behaves
  // exactly as it did before buy-ins existed. See lib/betting.
  const roster = realPlayers(tPlayers);
  const skinsField = inField(roster, buyIns?.skinsIn);
  const ctpField = inField(roster, buyIns?.ctpIn);

  // The pot is COUNTED from the buy-ins once a buy-in price exists. Until one
  // does, the hand-typed pot stands and stays editable — which is the only
  // thing a tournament already under way has.
  const skinsCounted = (buyIns?.skinsAmount || 0) > 0;
  const skinsPotValue = skinsCounted ? skinsField.length * buyIns.skinsAmount : skinsPot;
  const ctpPotValue = (buyIns?.ctpAmount || 0) > 0 ? ctpField.length * buyIns.ctpAmount : 0;
  const lowNetField = inField(roster, buyIns?.lowNetIn);
  const lowNetPotValue = (buyIns?.lowNetAmount || 0) > 0 ? lowNetField.length * buyIns.lowNetAmount : 0;
  // ── The hole pot ──
  // One designated hole a round, lowest net, ties SPLIT. `potHole` normalises
  // the stored number, so an absent or nonsense value scores the eighteenth
  // rather than the first — see lib/betting.
  const holePotField = inField(roster, buyIns?.holePotIn);
  const holePotPotValue = (buyIns?.holePotAmount || 0) > 0 ? holePotField.length * buyIns.holePotAmount : 0;
  const holeNum = potHole(buyIns?.holePotHole);

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
  // Every derivation below is lib/betting's, bound to this view's data once.
  // They used to be defined inline here, which was fine while the only
  // question was "who is winning this one" — the Settle tab asks a question
  // that needs the same numbers, and two copies of a payout is how a board and
  // a settlement come to disagree about the same pot.
  const ctx = { tPlayers, tRounds, courses, roundLocks, hcpOverrides, teeAssignments };
  const setupFor = (round) => roundSetup({ round, tRounds, courses, roundLocks });
  const strokeMapsForRound = (round) => strokeMapsFor({ round, field: skinsField, ...ctx });

  const skinsFor = (round, gross) => computeSkins({
    round, gross, field: skinsField, holeData,
    pars: setupFor(round).pars,
    maps: gross ? null : strokeMapsForRound(round),
  });

  const allSkins = roundList.flatMap(r => skinsFor(r, grossMode).filter(s => s.winner).map(s => ({ ...s, round: r })));
  const skinCount = {};
  allSkins.forEach(s => { skinCount[s.winner.pid] = (skinCount[s.winner.pid] || 0) + 1; });
  const totalSkins = allSkins.length;
  // Exact, and rounded only where it prints. It used to be rounded to the cent
  // HERE and then multiplied by a player's skin count, which is how this row
  // came to disagree with the Settle tab about the same money: a $80 pot over
  // 36 skins is $2.2222 a skin, and ten of them are $22.22 — not ten times
  // $2.22, which is $22.20.
  const perSkin = totalSkins > 0 ? skinsPotValue / totalSkins : 0;

  // ── What the field card is drawn from ──
  // The shown round's setup, skins and stroke maps, resolved once. Every one
  // of these is safe with a null round (no schedule yet): roundSetup falls
  // back to a par-4 course, and a scoreless round yields no skins.
  const shownSetup = setupFor(shownRound);
  const shownSkins = skinsFor(shownRound, grossMode);
  // Gross mode draws no dots, so it needs no maps.
  const shownStrokeMaps = grossMode ? {} : strokeMapsForRound(shownRound);
  // Team, then name. Skins is an individual game and the sides mean nothing
  // to it, but the roster is grouped this way on every other screen, and a
  // player looking for their own row among sixteen finds it faster in the
  // order they already know than in one sorted by a number that moves.
  const fieldPlayers = [...skinsField].sort((a, b) =>
    String(a.team || "").localeCompare(String(b.team || "")) ||
    String(a.name || "").localeCompare(String(b.name || ""))
  );

  // ── Low net ──
  // One round, one card: gross for eighteen less the course handicap the round
  // was played off. Only a FINISHED card is ranked — a player through fourteen
  // is not leading on net, they are unfinished, and ranking them would put
  // whoever had played least on top all afternoon.
  //
  // Equal lowest cards are CO-WINNERS, not a push. A skin pushes because the
  // hole carries; low net has nowhere to carry to, so the round's share splits.
  const lowNetFor = (round) => lowNetRows({ round, field: lowNetField, holeData, ...ctx });

  // The pot is divided by the ROUNDS, not by the wins. Each round is worth the
  // same share, and a tied round splits ITS share between the co-winners — so
  // a tie cannot make one round pay out more in total than a clean one, which
  // dividing by wins would have done.
  const lowNetRoundShare = roundList.length ? lowNetPotValue / roundList.length : 0;
  const lowNetWins = roundList.flatMap(r => {
    const winners = lowNetFor(r).filter(x => x.won);
    return winners.map(w => ({ ...w, round: r, share: lowNetRoundShare / winners.length }));
  });
  const lowNetDecided = new Set(lowNetWins.map(w => w.round)).size;
  const lowNetLeaders = Object.values(lowNetWins.reduce((acc, w) => {
    const e = acc[w.pid] || (acc[w.pid] = { pid: w.pid, count: 0, best: null, money: 0 });
    e.count += 1;
    e.money += w.share;
    if (e.best == null || w.net < e.best) e.best = w.net;
    return acc;
  }, {})).sort((a, b) => b.count - a.count || (a.best ?? Infinity) - (b.best ?? Infinity));

  // ── The hole pot ──
  // Its own stroke maps, because its field is its own: a man in on skins and
  // out of this one must not be handed a stroke allocation here, and the maps
  // are what decide the net score the hole is won on.
  const holePotMapsFor = (round) => strokeMapsFor({ round, field: holePotField, ...ctx });
  const holePotFor = (round) =>
    holePotRows({ round, hole: holeNum, field: holePotField, holeData, maps: holePotMapsFor(round) });

  // The pot divides by the ROUNDS and a tied hole splits ITS share — the same
  // shape as low net, and for the same reason: a tie must not make one hole
  // pay out more in total than a clean one. See lib/betting.
  const holePotRoundShare = roundList.length ? holePotPotValue / roundList.length : 0;
  const holePotWinners = holePotWins({
    rounds: roundList, hole: holeNum, field: holePotField, holeData,
    mapsFor: holePotMapsFor, pot: holePotPotValue,
  });
  const holePotDecided = new Set(holePotWinners.map(w => w.round)).size;
  const holePotLeaders = Object.values(holePotWinners.reduce((acc, w) => {
    const e = acc[w.pid] || (acc[w.pid] = { pid: w.pid, count: 0, best: null, money: 0 });
    e.count += 1;
    e.money += w.share;
    if (e.best == null || w.net < e.best) e.best = w.net;
    return acc;
  }, {})).sort((a, b) => b.count - a.count || (a.best ?? Infinity) - (b.best ?? Infinity));

  // ── The CTP tab ──
  const ctpShownRound = roundList.includes(ctpRound) ? ctpRound : defaultRound;
  const lowNetShownRound = roundList.includes(lowNetRound) ? lowNetRound : defaultRound;
  const holePotShownRound = roundList.includes(holePotRound) ? holePotRound : defaultRound;

  // How many pins the WEEK holds, off the rounds' own scorecards — see
  // lib/betting. It is what the pot divides by, and it is also the answer to
  // "how many of these are there" on a Friday morning when none have been
  // taken yet. `noPar3s` is read off the same count, so the empty state and
  // the arithmetic can never disagree about whether there is a game here.
  const ctpPins = ctpPinTotal({ rounds: roundList, tRounds, courses, roundLocks });
  const noPar3s = ctpPins.pins === 0;
  const perPin = ctpPins.pins > 0 ? ctpPotValue / ctpPins.pins : 0;

  // Every standing tag, read through each round's OWN par table rather than
  // straight off ctpData: a record left on a hole that is no longer a par 3 —
  // a course re-pointed after the fact — would otherwise keep counting for
  // somebody on a hole the tab no longer shows.
  //
  // An unsettled tag still counts. The document is the hole's current answer
  // and not a log of attempts, which is exactly what the rows below display;
  // a leaderboard that ignored pending tags would disagree with them.
  const tags = ctpTags({ rounds: roundList, field: ctpField, ctpData, tRounds, courses, roundLocks });

  const ctpLeaders = Object.values(tags.reduce((acc, t) => {
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

  // A POT is always whole money — a buy-in times a head count — so its cents
  // are two characters of noise on the largest figure on the screen, and the
  // header now runs three numbers across a phone. A SHARE of one is not
  // whole: $250 across seven skins is $35.71, and rounding that would be
  // rounding somebody's money. Display only — the editor still seeds from,
  // and writes, the exact value.
  const potMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;

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
        {/* `dividers` because five games do not fit the shape four did: the
            unselected segments ran together into one grey strip with nothing
            between them but the space between two words, and "Low Net 18"
            reads as one label. A hairline between them is the delineation —
            see SegmentedToggle, which hides the two beside the thumb.

            The hole pot's tab is named after ITS HOLE rather than after the
            game, because the game has no name anybody uses: the field calls
            it eighteen. A director who moves it to the ninth gets a tab
            called 9, which is still what the field will call it. */}
        <SegmentedToggle
          options={[["skins", "Skins"], ["ctp", "CTP"], ["lownet", "Low Net"], ["holepot", String(holeNum)], ["sidebet", "Side Bet"]]}
          value={activeTab} onChange={setActiveTab} letterSpacing={0.5} dividers snug
        />
      </StickyTop>

      {/* Side bets are exempt: the three scored games need a round to score,
          but a wager gets made on the first tee — often before anybody has
          put a round on the schedule — and telling somebody to come back
          later is how it ends up on a napkin instead. */}
      {roundList.length === 0 && activeTab !== "sidebet" && empty("🥃", "No bets yet", "The scored games open once the tournament has a round on the schedule.")}

      {roundList.length > 0 && activeTab === "skins" && (
        <div>
          {/* Pot */}
          <div style={{ background: BC.card, borderRadius: 12, marginBottom: editBuyIns === "skins" ? 0 : 12, border: `1px solid ${BC.bdr}`, overflow: "hidden" }}>
            <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: FS.label, color: BC.t3, fontWeight: 700, letterSpacing: 1 }}>POT</div>
                {/* Once a buy-in price is set the pot is COUNTED, not typed, so
                    the inline editor gives way — the way to change it is to
                    change who is in. A tournament with no buy-in price keeps
                    the hand-typed pot exactly as it was. */}
                {skinsCounted ? (
                  <div style={{ fontSize: FS.title, fontWeight: 800, color: BC.gold }}>{potMoney(skinsPotValue)}</div>
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
                  <button
                    type="button"
                    disabled={!user?.isDirector}
                    aria-label={user?.isDirector ? "Edit the skins pot" : undefined}
                    onClick={() => { setPotInput(String(skinsPot)); setEditPot(true); }}
                    style={{
                      fontSize: FS.title, fontWeight: 800, color: BC.gold, fontFamily: FONT,
                      background: "transparent", border: "none", padding: 0, textAlign: "left",
                      cursor: user?.isDirector ? "pointer" : "default",
                    }}>
                    {potMoney(skinsPot)}
                  </button>
                )}
              </div>
              {/* THREE COLUMNS, because skins has three numbers of equal
                  standing rather than one headline and one derived figure:
                  the pot, how many were won, and what one is worth. Stacked
                  in a right-hand corner, "12 skins won / $20.83 / skin" made
                  the middle number read as a caption on the third. The pot
                  keeps the left column so the inline editor and the gold stay
                  where they were, and the three tracks run left, centre,
                  right so none of them reads as a stray beside the others. */}
              <div style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
                <div style={{ fontSize: FS.label, color: BC.t3, fontWeight: 700, letterSpacing: 1 }}>SKINS</div>
                <div style={{ fontSize: FS.title, fontWeight: 800, color: BC.amberInk, overflow: "hidden", textOverflow: "ellipsis" }}>{totalSkins}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0, textAlign: "right" }}>
                <div style={{ fontSize: FS.label, color: BC.t3, fontWeight: 700, letterSpacing: 1 }}>EACH</div>
                <div style={{ fontSize: FS.title, fontWeight: 800, color: BC.amberInk, overflow: "hidden", textOverflow: "ellipsis" }}>${perSkin.toFixed(2)}</div>
              </div>
            </div>
            {user?.isDirector && (
              <button
                type="button"
                aria-expanded={editBuyIns === "skins"}
                onClick={() => setEditBuyIns(v => (v === "skins" ? null : "skins"))}
                style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "8px 14px", borderTop: `1px solid ${BC.bdr}`, width: "100%", background: "transparent", borderLeft: "none", borderRight: "none", borderBottom: "none", fontFamily: FONT }}
              >
                <span style={{ flex: 1, fontSize: FS.label, fontWeight: 700, color: BC.t3, letterSpacing: 0.6 }}>
                  {skinsField.length} IN{skinsCounted ? ` · $${buyIns.skinsAmount} EACH` : ""}
                </span>
                <span style={{ fontSize: FS.label, fontWeight: 700, color: BC.amberInk, letterSpacing: 0.6 }}>
                  BUY-INS {editBuyIns === "skins" ? "▾" : "▸"}
                </span>
              </button>
            )}
          </div>

          {user?.isDirector && editBuyIns === "skins" && (
            <BuyInEditor
              players={realPlayers(tPlayers)}
              amount={buyIns?.skinsAmount || 0}
              ids={buyIns?.skinsIn ?? null}
              onChange={patch => onUpdateBuyIns(
                "amount" in patch ? { skins_buyin: patch.amount } : { skins_in: patch.ids }
              )}
            />
          )}

          {/* Gross/Net toggle */}
          <SegmentedToggle
            options={[[true, "Gross"], [false, "Net"]]}
            value={grossMode}
            onChange={setGrossMode}
            style={{ marginBottom: 12, width: 160, marginLeft: "auto", marginRight: "auto" }}
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
                    <span style={{ fontSize: FS.small, color: BC.t3 }}>${(count * perSkin).toFixed(2)}</span>
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
            ? empty("🎯", "No par 3s yet", "CTP holes appear once a round has a course with a par 3 on it.")
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
                    {/* N OF M, and the share divided by M — the par 3s the
                        week actually holds, not the ones already won. See
                        ctpPinTotal: dividing by the tags standing made a pin
                        worth less every time somebody else took one, and made
                        the first one of the week worth the whole pot. */}
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: FS.label, color: BC.t3 }}>
                        {tags.length} of {ctpPins.pins} pin{ctpPins.pins !== 1 ? "s" : ""} taken
                      </div>
                      <div style={{ fontSize: FS.body, fontWeight: 700, color: BC.amberInk }}>
                        ${perPin.toFixed(2)} / pin
                      </div>
                    </div>
                  </div>

                  {/* A round with no course yet holds pins nobody has counted,
                      so the total above can only go up and the share can only
                      come down. Said out loud, because a director who prices
                      the pot in February off six pins and plays eight has told
                      the field a number that was never going to hold. */}
                  {ctpPins.partial && (
                    <div style={{ padding: "0 14px 10px", fontSize: FS.label, color: BC.t3, lineHeight: 1.4 }}>
                      {ctpPins.rounds - ctpPins.scheduled} round{ctpPins.rounds - ctpPins.scheduled !== 1 ? "s" : ""} without a course yet — more pins to come.
                    </div>
                  )}

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
                    players={realPlayers(tPlayers)}
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
                  const { course: course2, pars: pars2 } = setupFor(ctpShownRound);
                  const par3holes = course2 ? pars2.map((p, i) => ({ hole: i, par: p })).filter(h => h.par === 3) : [];
                  if (par3holes.length === 0) {
                    return (
                      <div style={{ background: BC.card, borderRadius: 8, border: `1px solid ${BC.bdr}`, padding: "14px 12px", fontSize: FS.small, color: BC.t3, textAlign: "center" }}>
                        {/* "No par 3s on this course" was said of a round with
                            no course at all, because resolveHolePars hands back
                            eighteen par 4s when there is nothing to read. That
                            reads as a course with no short holes on it, which
                            is a different and settled answer — this one is
                            waiting on the draw. */}
                        {course2
                          ? `No par 3s on ${course2.name}.`
                          : `Round ${ctpShownRound} has no course yet.`}
                      </div>
                    );
                  }
                  return (
                    <>
                      {/* The round's own par-3 count beside its course, and
                          the week's beside it on a multi-round draw. Both come
                          off the scorecards, so this is the same number the
                          pot is divided by rather than a second count of it. */}
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: FS.label, fontWeight: 700, color: BC.t3, letterSpacing: 1, marginBottom: 6 }}>
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {(course2?.name || "TBD").toUpperCase()} · {par3holes.length} PAR 3{par3holes.length !== 1 ? "S" : ""}
                        </span>
                        {roundList.length > 1 && (
                          <span style={{ flexShrink: 0, color: BC.amberInk }}>{ctpPins.pins} ALL WEEK</span>
                        )}
                      </div>
                      {par3holes.map(({ hole }) => {
                        const rec = ctpData[`${ctpShownRound}_${hole}`];
                        const winnerId = rec?.player_id || null;
                        const winner = tPlayers.find(p => p.player_id === winnerId);
                        // A tag a group entered on the course is provisional until
                        // the director touches it here — picking a name from the
                        // dropdown (even re-picking the same one) is the approval.
                        const pending = !!winnerId && rec?.approved !== true;
                        // How many groups have walked off this hole agreeing
                        // the tag stands (the pass answer in the on-course
                        // prompt). It is the difference between a tag nobody
                        // has been past yet and one the whole field has seen,
                        // which is exactly what a director is weighing when
                        // deciding whether to settle it.
                        const agreed = (rec?.confirmed_by || []).length;
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
                            {pending && (
                              <span
                                title={agreed
                                  ? `Tagged on the course — not settled yet. ${agreed} later ${agreed === 1 ? "group has" : "groups have"} confirmed it stands.`
                                  : "Tagged on the course — not settled yet"}
                                style={{ fontSize: FS.label, fontWeight: 700, color: BC.t3, border: `1px solid ${BC.bdr}`, borderRadius: 4, padding: "1px 4px", flexShrink: 0, whiteSpace: "nowrap" }}
                              >
                                Pending{agreed ? ` · ✓${agreed}` : ""}
                              </span>
                            )}
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

      {roundList.length > 0 && activeTab === "lownet" && (
        <div>
          {/* LOW NET POT — counted from buy-ins, like CTP. */}
          {(lowNetPotValue > 0 || user?.isDirector) && (
            <div style={{ background: BC.card, borderRadius: 12, marginBottom: editBuyIns === "lownet" ? 0 : 12, border: `1px solid ${BC.bdr}`, overflow: "hidden" }}>
              <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: FS.label, color: BC.t3, fontWeight: 700, letterSpacing: 1 }}>LOW NET POT</div>
                  <div style={{ fontSize: FS.title, fontWeight: 800, color: BC.gold }}>${lowNetPotValue.toFixed(2)}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: FS.label, color: BC.t3 }}>{lowNetDecided} of {roundList.length} decided</div>
                  <div style={{ fontSize: FS.body, fontWeight: 700, color: BC.amberInk }}>${lowNetRoundShare.toFixed(2)} / round</div>
                </div>
              </div>
              {user?.isDirector && (
                <div
                  onClick={() => setEditBuyIns(v => (v === "lownet" ? null : "lownet"))}
                  style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "8px 14px", borderTop: `1px solid ${BC.bdr}` }}
                >
                  <span style={{ flex: 1, fontSize: FS.label, fontWeight: 700, color: BC.t3, letterSpacing: 0.6 }}>
                    {lowNetField.length} IN{(buyIns?.lowNetAmount || 0) > 0 ? ` · $${buyIns.lowNetAmount} EACH` : ""}
                  </span>
                  <span style={{ fontSize: FS.label, fontWeight: 700, color: BC.amberInk, letterSpacing: 0.6 }}>
                    BUY-INS {editBuyIns === "lownet" ? "▾" : "▸"}
                  </span>
                </div>
              )}
            </div>
          )}

          {user?.isDirector && editBuyIns === "lownet" && (
            <BuyInEditor
              players={tPlayers}
              amount={buyIns?.lowNetAmount || 0}
              ids={buyIns?.lowNetIn ?? null}
              onChange={patch => onUpdateBuyIns(
                "amount" in patch ? { lownet_buyin: patch.amount } : { lownet_in: patch.ids }
              )}
            />
          )}

          {/* LOW NET LEADERS — rounds won, then the best card among equals. */}
          {lowNetLeaders.length > 0 && (
            <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, marginBottom: 12, overflow: "hidden" }}>
              <div style={{ padding: "8px 14px", borderBottom: `1px solid ${BC.bdr}`, fontSize: FS.label, fontWeight: 700, color: BC.gold, letterSpacing: 1 }}>LOW NET LEADERS</div>
              {lowNetLeaders.map(({ pid, count, money }) => {
                const p = tPlayers.find(t => t.player_id === pid);
                const team = p ? teams[p.team] : null;
                return (
                  <div key={pid} style={{ display: "flex", alignItems: "center", padding: "8px 14px", borderBottom: `1px solid ${BC.bdr}${ALPHA.hair}`, gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: team?.accent || BC.t3, flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: FS.body, fontWeight: 600, color: BC.t1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p?.name || pid}</span>
                    <span style={{ fontSize: FS.body, fontWeight: 700, color: BC.amberInk }}>{count} round{count !== 1 ? "s" : ""}</span>
                    <span style={{ fontSize: FS.small, color: BC.t3 }}>${money.toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
          )}

          <SegmentedToggle
            variant="pills"
            style={{ marginBottom: 8 }}
            options={roundList.map(r => [r, `Rd ${r}`])}
            value={lowNetShownRound}
            onChange={setLowNetRound}
          />

          <LowNetCard rows={lowNetFor(lowNetShownRound)} />
        </div>
      )}

      {roundList.length > 0 && activeTab === "holepot" && (
        <div>
          {/* THE HOLE POT — counted from buy-ins, like CTP and low net.
              Hidden from players until there is one; the director keeps it
              either way, because this card is where the hole and the buy-in
              are set. */}
          {(holePotPotValue > 0 || user?.isDirector) && (
            <div style={{ background: BC.card, borderRadius: 12, marginBottom: editBuyIns === "holepot" ? 0 : 12, border: `1px solid ${BC.bdr}`, overflow: "hidden" }}>
              <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: FS.label, color: BC.t3, fontWeight: 700, letterSpacing: 1 }}>HOLE {holeNum} POT</div>
                  <div style={{ fontSize: FS.title, fontWeight: 800, color: BC.gold }}>${holePotPotValue.toFixed(2)}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: FS.label, color: BC.t3 }}>{holePotDecided} of {roundList.length} decided</div>
                  <div style={{ fontSize: FS.body, fontWeight: 700, color: BC.amberInk }}>${holePotRoundShare.toFixed(2)} / round</div>
                </div>
              </div>

              {/* WHICH HOLE, on the pot card rather than inside the buy-in
                  panel: it is the one thing about this game a player might
                  want to check without opening anything, and it is what the
                  tab above is named after. A select rather than a number
                  field — there are eighteen answers and a typo would move the
                  game rather than be refused. */}
              {user?.isDirector && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderTop: `1px solid ${BC.bdr}` }}>
                  <span style={{ flex: 1, fontSize: FS.label, fontWeight: 700, color: BC.t3, letterSpacing: 0.6 }}>THE HOLE</span>
                  <select
                    value={holeNum}
                    onChange={e => onUpdateBuyIns({ hole_pot_hole: Number(e.target.value) })}
                    style={{ background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 6, color: BC.t1, fontSize: FS.small, fontWeight: 700, padding: "4px 6px", fontFamily: FONT }}
                  >
                    {Array.from({ length: HOLE_COUNT }, (_, i) => i + 1).map(h => (
                      <option key={h} value={h}>Hole {h}</option>
                    ))}
                  </select>
                </label>
              )}

              {user?.isDirector && (
                <button
                  type="button"
                  aria-expanded={editBuyIns === "holepot"}
                  onClick={() => setEditBuyIns(v => (v === "holepot" ? null : "holepot"))}
                  style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "8px 14px", borderTop: `1px solid ${BC.bdr}`, width: "100%", background: "transparent", borderLeft: "none", borderRight: "none", borderBottom: "none", fontFamily: FONT }}
                >
                  <span style={{ flex: 1, fontSize: FS.label, fontWeight: 700, color: BC.t3, letterSpacing: 0.6, textAlign: "left" }}>
                    {holePotField.length} IN{(buyIns?.holePotAmount || 0) > 0 ? ` \u00b7 $${buyIns.holePotAmount} EACH` : ""}
                  </span>
                  <span style={{ fontSize: FS.label, fontWeight: 700, color: BC.amberInk, letterSpacing: 0.6 }}>
                    BUY-INS {editBuyIns === "holepot" ? "\u25be" : "\u25b8"}
                  </span>
                </button>
              )}
            </div>
          )}

          {user?.isDirector && editBuyIns === "holepot" && (
            <BuyInEditor
              players={realPlayers(tPlayers)}
              amount={buyIns?.holePotAmount || 0}
              ids={buyIns?.holePotIn ?? null}
              onChange={patch => onUpdateBuyIns(
                "amount" in patch ? { hole_pot_buyin: patch.amount } : { hole_pot_in: patch.ids }
              )}
            />
          )}

          {/* HOLE POT LEADERS — holes won, then the best net among equals.
              A man who has halved two of them shows two, because a split is a
              win here rather than a push. */}
          {holePotLeaders.length > 0 && (
            <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, marginBottom: 12, overflow: "hidden" }}>
              <div style={{ padding: "8px 14px", borderBottom: `1px solid ${BC.bdr}`, fontSize: FS.label, fontWeight: 700, color: BC.gold, letterSpacing: 1 }}>HOLE {holeNum} LEADERS</div>
              {holePotLeaders.map(({ pid, count, money }) => {
                const p = tPlayers.find(t => t.player_id === pid);
                const team = p ? teams[p.team] : null;
                return (
                  <div key={pid} style={{ display: "flex", alignItems: "center", padding: "8px 14px", borderBottom: `1px solid ${BC.bdr}${ALPHA.hair}`, gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: team?.accent || BC.t3, flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: FS.body, fontWeight: 600, color: BC.t1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p?.name || pid}</span>
                    <span style={{ fontSize: FS.body, fontWeight: 700, color: BC.amberInk }}>{count} hole{count !== 1 ? "s" : ""}</span>
                    <span style={{ fontSize: FS.small, color: BC.t3 }}>${money.toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
          )}

          <SegmentedToggle
            variant="pills"
            style={{ marginBottom: 8 }}
            options={roundList.map(r => [r, `Rd ${r}`])}
            value={holePotShownRound}
            onChange={setHolePotRound}
          />

          <HolePotCard
            rows={holePotFor(holePotShownRound)}
            hole={holeNum}
            share={holePotRoundShare}
          />
        </div>
      )}

      {activeTab === "sidebet" && (
        <SideBets
          players={roster}
          bets={sideBets}
          user={user}
          /* The AUTH UID, not the roster id. It is what the security rules
             pin `created_by` to and what the delete rule compares against, so
             the screen has to decide who may remove a bet off the same field
             the rules will judge it by. */
          authUid={authUid}
          teams={teams}
          onAddBet={onAddSideBet}
          onDeleteBet={onDeleteSideBet}
          onSettleBet={onSettleSideBet}
          confirm={confirm}
        />
      )}
    </div>
  );
}

// What a lazily-loaded screen shows while its chunk arrives. Deliberately
// quiet and deliberately the full height of the content area: a spinner that
// reflows the page when it resolves reads as a glitch, and on a fast
// connection this is one frame.
function LoadingPanel({ label }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "80px 20px", color: BC.t3, fontFamily: FONT,
      fontSize: FS.small, letterSpacing: 1, fontWeight: 700,
    }}>
      {(label || "").toUpperCase()}…
    </div>
  );
}

// ── Slide-up Menu ──
// Every row here is a PLACE TO GO. It held one exception for a while — a
// Finalize Round N action that raised a sheet and navigated nowhere — and
// that row is gone: finalizing is the one act on the live tournament, only a
// director can do it, and it now lives with the rest of that in Admin →
// Rounds. What prompts a director at the right moment is the alert bar in the
// app shell (components/FinalizeRound), which is a better answer than a row
// buried two taps deep that nobody would open on spec.
//
// `alerts` is what the menu has to BADGE: { finalize, balance }, both
// booleans. A badge here is never decoration — it is the trail from the dot
// on the More tab to the row that answers it, so every flag set must lead
// somewhere that resolves it.
// `navH` is the bottom nav's MEASURED height — the menu seats itself on the
// bar, and the bar is not a constant: its labels grow with the OS text-size
// setting, and its padding grows with the home-indicator inset. The 62px
// that used to be hardcoded here was only ever right at the default text
// size on a phone whose nav was exactly that tall; anywhere else the menu
// sank into the bar or floated off it.
function SlideMenu({ open, onClose, onNavigate, user, view, alerts, onEditions, navH }) {
  const dragRef = useRef(null);
  const startYRef = useRef(null);
  const [dragY, setDragY] = useState(0);

  // The way out for anybody not using a thumb. The menu is dismissed by a
  // swipe down or by tapping the scrim, and both of those want a finger — on
  // the laptop or the television this thing also runs on, there was no way to
  // close it but to find the 8px of page beside it with a mouse.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

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
    // Trip Info leads: it is the one row here that answers a question asked
    // BEFORE the tournament — when is it, where are we staying, what are we
    // playing — and the only one anybody opens in June.
    { key: "trip",      label: "Trip Info",        icon: "🏡" },
    // One row, two subjects. This was Player Analytics and Historical Data,
    // and the split was along the wrong axis: it cut NOW from THEN, so the
    // same question — how has this player done — lived on one row for this
    // year and nowhere at all for the other ten. Data cuts by SUBJECT
    // instead, the cup or the people, and each side is free to span every
    // year the cup has been played. See DataView.
    { key: "data",      label: "Data",             icon: "📊" },
    // Every year the cup has been played, each one a whole tournament you can
    // open — the leaderboard, the draw and all sixty-four cards of it. It sits
    // under Data because they answer the same question from two sides: that
    // row is the summary of the past, this one walks into it.
    // The active year rides on the row so the menu says which tournament is on
    // screen without opening anything.
    { key: "editions",  label: "Tournaments",      icon: "🏆", action: onEditions, value: String(getTournamentYear()) },
    // Was a link out to thebourboncup.com/photos. It is now a tab in the app,
    // because a photo taken on the tee has to be able to go somewhere from the
    // phone that took it. The site is still where the older years live, and
    // the tab links out to it — see components/PhotosView.
    { key: "photos",    label: "Photos",            icon: "📸" },
    // Admin carries the finalize flag now that the Finalize row is gone: the
    // sheet lives under Admin → Rounds, so the trail from the amber dot on
    // the More tab has to end there rather than at a row that no longer
    // exists.
    ...(user?.isDirector ? [{ key: "admin", label: "Admin Settings", icon: "⚙️", flag: alerts?.finalize }] : []),
    // Last, and set apart below: everything above is the EVENT, this is the
    // person. Notifications, the theme switch and Logout all used to be
    // rows in this menu; they are now sections of that one screen, so a
    // preference has one home instead of two.
    // The balance badge is RED rather than amber, and deliberately not the
    // same mark as the finalize flag above: one is a thing to do this
    // afternoon, the other is money owed since May.
    { key: "account",   label: "My Account",        icon: "👤", due: alerts?.balance },
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
              onNavigate(item.key); onClose();
            }} style={{
              width: "100%", padding: "12px 16px",
              background: isActive ? BC.amber + ALPHA.wash : "transparent",
              // A full-weight rule above My Account, a hairline between the
              // rest: the break is what says "this one isn't the event".
              borderTop: idx === 0 ? "none" : `1px solid ${BC.bdr}${item.key === "account" ? "" : ALPHA.hair}`,
              borderLeft: "none", borderRight: "none", borderBottom: "none",
              color: item.due ? BC.danger : (isActive || item.flag) ? BC.amberInk : BC.t1,
              fontSize: FS.body, fontWeight: isActive || item.flag || item.due ? 700 : 500,
              cursor: "pointer", textAlign: "left",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <span>{item.label}</span>
              {item.value && <span style={{ fontSize: FS.small, fontWeight: 700, color: BC.t3 }}>{item.value}</span>}
              {(isActive || item.flag || item.due) && <span style={{
                width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                background: item.due ? BC.danger : BC.amber,
              }} />}
            </button>
          );
        })}
      </div>
    </>
  );
}



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
  // NOT signed in, and deliberately so — somebody who took the guest door on
  // the sign-in screen. It is a local flag rather than a fourth auth layer
  // because that is exactly what it is: a guest has no Firebase session, no
  // uid and no membership, which is what makes them structurally read-only.
  // See lib/guest.js. Read from localStorage at mount so a tester who opened
  // the app last week arrives back inside it.
  const [guestMode, setGuestMode] = useState(readGuestMode);
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
      // A real account always wins over the guest flag. This is the tester
      // who looked around first and then signed in properly, and the phone
      // that was handed to somebody who did — leaving the flag set would
      // hold the app in guest mode behind a perfectly good session.
      if (u) { writeGuestMode(false); setGuestMode(false); }
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
  const [editionsOpen, setEditionsOpen] = useState(false);
  const [ctpData, setCtpData] = useState({});     // { "round_hole": record }
  const [skinsPot, setSkinsPot] = useState(0);
  // Side-game buy-ins, from bc_settings_main. Each `*In` is an ARRAY of player
  // ids, or NULL when no director has ever touched it — and null means
  // everybody, which is what every tournament played before this existed was.
  // An empty array is a different answer (nobody), so the two must not be
  // collapsed. See components/BuyIns.
  const [buyIns, setBuyIns] = useState({ skinsAmount: 0, skinsIn: null, ctpAmount: 0, ctpIn: null, lowNetAmount: 0, lowNetIn: null, holePotAmount: 0, holePotIn: null, holePotHole: null });
  // Player-to-player wagers the app records but does not run. One document
  // per bet; see lib/sideBets for why nothing here scores or settles them.
  const [sideBets, setSideBets] = useState([]);
  // What each man owes the director for the trip, and what he has paid so far.
  // Two pieces, because they come from two places: `duesAmount` is the
  // tournament-wide figure off bc_settings/dues (a per-player override lives on
  // the roster row), and `payments` is one document per installment. Nothing
  // here is a balance — that is derived every time, in lib/ledger, for the
  // reason set out at the top of that file.
  const [payments, setPayments] = useState([]);
  const [duesAmount, setDuesAmount] = useState(0);
  // What the trip COSTS, one document per line — the other half of Admin →
  // $. Director-only to read on screen, but subscribed here like everything
  // else because there is one subscription block and one place state lives.
  const [budgetLines, setBudgetLines] = useState([]);
  // The house, and the ONLY thing Trip Info stores of its own — its dates and
  // its courses are read off the rounds. See lib/tripInfo for why that is a
  // constraint rather than an economy.
  const [tripDoc, setTripDoc] = useState(null);
  // The trip's first and last day, off bc_settings/tournament. Separate from
  // tripDoc above because they live on different documents for different
  // reasons — the dates belong to the tournament's identity, the house is
  // the one thing a cloned edition must not inherit.
  const [tripDates_, setTripDates] = useState({ start_date: "", end_date: "" });
  // Every year the cup has been played — the SAME collection the Tournaments
  // picker reads, which is what makes Data → Tournament and the edition
  // switcher two views of one list instead of two lists. Tiny (one document a year) and
  // not tournament-scoped, because it IS the index of tournaments.
  const [editions, setEditions] = useState([]);
  // The saved team-name overrides (from the bc_settings/team_names doc).
  // Defaults come from constants so the fallback names live in one place.
  const [teamNames, setTeamNames] = useState(DEFAULT_TEAM_NAMES);
  // Director-set tournament identity (bc_settings/tournament). Seeded from
  // what this device last saw for THIS edition, so a cold start opens on the
  // right place instead of lettering the splash from the constants and then
  // correcting itself when the document lands (see firebase.identityKey).
  // The constants are the last resort — an edition never opened here, or one
  // that has never been through Admin → Event. The YEAR is deliberately
  // not one of these: it follows the active edition (see
  // firebase.getTournamentYear), so it can't disagree with the data on screen.
  const [tournamentName, setTournamentName] = useState(() => readTournamentIdentity()?.name || TOURNAMENT_TITLE);
  const [tournamentLocation, setTournamentLocation] = useState(() => readTournamentIdentity()?.location || TOURNAMENT_LOCATION);
  // How many rounds this tournament is, set in Admin → Event. Null until
  // the document lands (or forever, on an edition set up before the field
  // existed) — lib/rounds reads the schedule instead in that case, so an
  // existing tournament is unchanged and nobody has to re-enter a number they
  // already implied by building the rounds.
  const [roundCount, setRoundCount] = useState(null);
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
    try { localStorage.setItem("bc_theme", newMode); } catch { /* private mode */ }
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

  // ── Admin inside the demo ─────────────────────────────────────────
  // Every member administers a DEMO edition, and nothing else. The rules say
  // the same thing (canAdminEdition in firestore.rules), which is the only
  // reason this can be offered at all — an Admin tab the rules would refuse is
  // the one thing this file has always refused to draw.
  //
  // It exists for the store queues: App Review and the twelve Play testers get
  // no account of their own and no password, so the roster, the draw and the
  // courses would otherwise be a tab that says Directors Only. The blast radius
  // is an invented tournament that `npm run seed:demo --undo --write` removes.
  //
  // `membership` is undefined while it is being read and null when there is
  // none, so a truthy check is the membership test — and a guest, who has no
  // account at all, is neither this nor a director.
  const demoAdmin = demoOnlyAdmin({
    isDirector: isDirectorUser,
    isMember: !!membership,
    edition: editions.find(e => e.id === TOURNAMENT_ID),
  });
  // What every screen means by "can open Admin". The REAL flag stays
  // `isDirectorUser` and is what the three project-wide things below still ask
  // for; this is the edition-scoped one.
  const adminHere = isDirectorUser || demoAdmin;

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
    // The guest, before anything else. It is the only identity here that
    // does NOT come from an account, so it is resolved without one — and
    // resolved first, so a cold start goes straight into the app rather than
    // through the splash that waits for Firebase to answer about a session
    // a guest does not have.
    if (guestMode && !authUser) return GUEST_USER;
    if (!authUser) return null;
    const linked = linkedPlayer(tPlayers, authUser.uid);
    if (linked) return { ...linked, isDirector: adminHere };

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
      return { ...BOOTSTRAP_DIRECTOR, isDirector: adminHere };
    }
    // Looking at another year. Written by an edition switch and good only for
    // the edition it names (see firebase.spectatorSession), so a player who
    // has never claimed a name still meets the claim screen on the tournament
    // being played. The crown is not trusted from the cache here either.
    if (mine?.player_id === SPECTATOR_ID && mine.edition === getActiveTournamentId()) {
      return { ...mine, isDirector: adminHere };
    }
    // Roster still in flight: hold the last known identity rather than
    // flash the claim screen at somebody who claimed a name months ago.
    // The cached crown is not trusted either — same reason.
    if (!playersLoaded && mine) return { ...mine, isDirector: adminHere };
    return null;
  }, [authUser, tPlayers, playersLoaded, bootstrapDirector, adminHere, guestMode]);

  // Is the app running as a guest right now? Derived from the identity rather
  // than from the flag, so there is one answer and it is the same one every
  // screen below is drawing from.
  const guesting = isGuest(user);

  // Keep that cache current. What gets written is the live roster row, so
  // it can never be staler than what is on screen — and it is cleared the
  // moment the roster says this account has no name, which is how a
  // director's unlink reaches a phone that is not looking.
  useEffect(() => {
    // `undefined` is "Firebase has not answered yet", not "signed out" — the
    // same distinction `member` makes just above. Treating them alike wiped
    // the cache on EVERY cold start, in the first effect pass, before the
    // session it exists to cover had a chance to be used. That made the whole
    // thing dead code, and one thing it covers is not a flicker: an edition
    // switch writes the SPECTATOR marker and then hard-reloads (lib/editions),
    // so the marker was destroyed a frame into the reload it was written for.
    // The result was that opening any edition your account has no roster row
    // in — the demo, and all ten old cups — dropped you on that edition's
    // claim screen instead of into it read-only, asking a director to bind
    // their account to a roster row on a finished tournament.
    if (authUser === undefined) return;
    if (!authUser) { writeUserSession(null); cachedSession.current = null; return; }
    if (!user) {
      if (playersLoaded) { writeUserSession(null); cachedSession.current = null; }
      return;
    }
    const entry = { ...user, auth_uid: authUser.uid };
    cachedSession.current = entry;
    writeUserSession(entry);
  }, [user, authUser, playersLoaded]);

  // Leaving, whoever you are. `toGuest` is what the password screen's guest
  // link needs: dropping a session and taking the guest door has to happen in
  // ONE act, because doing it as two would sign out, render the sign-in
  // screen for a frame, and only then flip the flag.
  //
  // The flag is set here rather than left alone deliberately — a plain logout
  // clears it, so My Account's exit button and a real sign-out are the same
  // control and both land on the sign-in screen, which is the only place
  // either of them has to go.
  //
  // Called straight from onClick in two places, so the first argument may be
  // a click event; destructuring a default off it reads as false, which is
  // the answer a logout wants.
  const doSignOut = useCallback(async ({ toGuest = false } = {}) => {
    writeUserSession(null);
    cachedSession.current = null;
    setBootstrapDirector(false);
    writeGuestMode(toGuest);
    setGuestMode(toGuest);
    if (toGuest) setView("leaderboard");
    await signOutUser();
  }, []);

  // Taking the guest door from the sign-in screen, where there is no session
  // to drop. Nothing is signed in and nothing is written to Firestore — the
  // flag and a re-render are the whole of it.
  const enterGuest = useCallback(() => {
    writeGuestMode(true);
    setGuestMode(true);
    setView("leaderboard");
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
  // The photo library's index for the active edition. See src/lib/media.js —
  // these documents point at the photos, they do not contain them.
  const [media, setMedia] = useState([]);
  // bc_config/photos — the budget circuit breaker's flag. Null until read.
  const [photoConfig, setPhotoConfig] = useState(null);
  // Every edition, from the one subscription — eleven small documents. Two
  // things read it: `locked` on the row this device has open, and the row that
  // says which year IS the cup (see liveEdition). Empty until the subscription
  // lands, and both consumers are written to render nothing in that moment —
  // a strip that flashed "this year is frozen", or "you're viewing 2019", on
  // every cold start would train people to ignore it.
  const [editionRows, setEditionRows] = useState([]);
  // Derived rather than a second piece of state: two states filled from one
  // callback can disagree for a frame, and one of them decides whether the app
  // says the year is locked.
  const activeEdition = useMemo(
    () => editionRows.find(r => r.id === TOURNAMENT_ID) || null,
    [editionRows],
  );
  // Where "Back to <year>" goes, and whether there is such a row at all: null
  // once this device is already on the cup, which is the ordinary case.
  const liveEditionRow = useMemo(() => {
    const id = liveEdition(editionRows, getDefaultEditionId());
    return id && id !== TOURNAMENT_ID ? editionRows.find(r => r.id === id) || null : null;
  }, [editionRows]);
  const [notif, setNotif] = useState(null);
  // ── What the app owes the database ───────────────────────────────────
  // `pending` is writes queued but not yet acknowledged by the server —
  // normally zero for the length of a heartbeat, and a growing number for as
  // long as a phone is out of signal. `failed` is writes the server REFUSED,
  // which is a different and much worse thing: those are not coming back.
  //
  // This replaces a `syncing` boolean that was set on every save and rendered
  // nowhere at all, so the app had no way to say either of these out loud.
  // See trackWrite below, and the chip in components/AppHeader.
  const [writeState, setWriteState] = useState({ pending: 0, failed: 0 });
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
  // is the `round:stage` tag the director has dismissed — a tag rather than a
  // boolean so that the next round's notification is a NEW one and shows on
  // its own merits, and rather than a bare round number so that dismissing
  // the early "all scores are in" bar does not also swallow the "ready to
  // finalize" one that follows it. See finalizeSnoozeTag above.
  //
  // Persisted, because the alternative is nagging: the director who taps ✕
  // has decided to deal with it later, and a refresh (or the pull-to-refresh
  // this app encourages, or an iOS PWA reloading itself in the background)
  // would otherwise put the bar straight back. The dot on More survives the
  // dismissal, so nothing is actually lost by remembering it.
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizeSnoozed, setFinalizeSnoozed] = useState(() => {
    try { return normalizeSnooze(localStorage.getItem(finalizeSnoozeKey())); }
    catch { return null; }
  });
  const snoozeFinalizeAlert = useCallback((rnd, stage) => {
    const tag = finalizeSnoozeTag(rnd, stage);
    setFinalizeSnoozed(tag);
    try { localStorage.setItem(finalizeSnoozeKey(), tag); } catch { /* private mode */ }
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
  // And for the cards themselves, so the save path can name the score a
  // failed write is reverting FROM without reading through React state.
  const holeDataRef = useRef({});
  // And for the CTP records, which confirming appends to the same way.
  const ctpDataRef = useRef({});
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

  // ── trackWrite ───────────────────────────────────────────────────────
  // Wrap a write that must not fail quietly. Hand it a promise that REJECTS
  // on refusal (db.upsertStrict, not db.upsert) and a line to say if it does.
  //
  // Two states come out of it, and keeping them apart is the point:
  //
  //   pending  queued, unacknowledged. Offline this is every write since the
  //            signal went, and every one of them is fine — Firestore replays
  //            them on reconnect. The chip says so rather than claiming a
  //            problem, because "3 saving" on the 14th tee is not an error,
  //            it is the phone telling the truth about where it is.
  //   failed   refused outright. Firestore rolls its own local mutation back,
  //            so the subscription repaints the cell with what is really
  //            stored; all this adds is somebody being TOLD.
  //
  // A success clears `failed`, because a write getting through is proof the
  // path works and whatever refused the last one is no longer refusing.
  const trackWrite = useCallback((promise, failMessage) => {
    setWriteState(s => ({ ...s, pending: s.pending + 1 }));
    promise.then(
      () => setWriteState(s => ({ pending: Math.max(0, s.pending - 1), failed: 0 })),
      (e) => {
        console.error("[write refused]", failMessage, e);
        setWriteState(s => ({ pending: Math.max(0, s.pending - 1), failed: s.failed + 1 }));
        notify(`${failMessage} — tap it again.`, "error");
      },
    );
    return promise;
  }, [notify]);

  // Keep popupOpenRef in sync with the non-<Popup> overlays so touch
  // handlers see "an overlay is open" without having to participate in
  // React's render cycle. A new modal built on <Popup> needs nothing here;
  // only another bespoke full-screen overlay would.
  useEffect(() => { popupOpenRef.current = menuOpen || finalizeOpen; }, [menuOpen, finalizeOpen]);

  // Reconcile the edition doc-id namespacing flag from the canonical edition
  // doc, in case localStorage (which seeds it synchronously in firebase.js)
  // was cleared. Cheap insurance so writes use the right doc-id scheme.
  // Off the subscription above rather than a read of its own — same documents,
  // one fewer round trip, and it re-runs if the edition doc is corrected while
  // the app is open.
  useEffect(() => {
    const active = editions.find(e => e.id === TOURNAMENT_ID);
    if (active) setActiveTournamentId(TOURNAMENT_ID, !!active.namespaced);
  }, [editions]);

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
      const tName = tourn?.name?.trim() || TOURNAMENT_TITLE;
      const tLocation = tourn?.location?.trim() || TOURNAMENT_LOCATION;
      setTournamentName(tName);
      setTournamentLocation(tLocation);
      setRoundCount(tourn?.round_count ?? null);
      // The trip's first and last day — the source of truth for every date
      // in the app. Trip Info's banner is this pair, and Admin → Rounds
      // offers the days between them. See lib/tripInfo.
      setTripDates({ start_date: tourn?.start_date || "", end_date: tourn?.end_date || "" });
      // Remember it for the next cold start, so the splash opens on this.
      writeTournamentIdentity({ name: tName, location: tLocation });
      // Branding: apply to the live BC theme immediately (using the current
      // mode via ref), then store it so a later theme toggle re-applies it.
      const br = rows.find(r => r.id === editionDocId("branding"));
      const b = br
        ? { teamA: br.teamA || null, teamB: br.teamB || null, tournamentAccent: br.tournamentAccent || null }
        : null;
      applyBCTheme(modeRef.current ? "dark" : "light", b);
      setBrand(b);
      // The trip cost, one number for the whole field. Absent means no ledger
      // has ever been set up, which resolves to 0 and takes the BALANCE DUE
      // card off every My Account screen — see lib/ledger's hasLedger.
      const dues = rows.find(r => r.id === editionDocId(DUES_SETTINGS_ID));
      setDuesAmount(round2(dues?.amount ?? 0));
      setTripDoc(rows.find(r => r.id === editionDocId(TRIP_SETTINGS_ID)) || null);
    }));
    unsubs.push(db.subscribe("bc_rounds", f, rows => setTRounds(rows)));
    // No skins listener, because skins are not stored: they are derived from
    // the cards in BettingView every time they are shown (see lib/betting).
    // There was a `bc_skins` collection that was only ever written and never
    // read; it held nothing in production and has been retired from the rules
    // and from the edition teardown list.
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
          // WHICH GROUP tagged it, and where that group tees off. The player
          // id above says who typed; this says where they were in the field,
          // which is the only way a group entering late can be told that the
          // number in front of them came from BEHIND them. Null on a
          // director's pick and on any tag written before this was recorded —
          // see lib/ctp, where an unknown order deliberately says nothing.
          tagged_group_key: r.tagged_group_key || null,
          tagged_group_order: Number.isInteger(r.tagged_group_order) ? r.tagged_group_order : null,
          // Who has walked off the hole agreeing the tag stands. See
          // onConfirmCtp — a pass in the on-course prompt is an answer,
          // and this is where it lands.
          confirmed_by: Array.isArray(r.confirmed_by) ? r.confirmed_by : [],
        };
      });
      ctpDataRef.current = cd;   // keep the ref hot for the confirm append
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
        lowNetAmount: s?.lownet_buyin || 0,
        lowNetIn: Array.isArray(s?.lownet_in) ? s.lownet_in : null,
        holePotAmount: s?.hole_pot_buyin || 0,
        holePotIn: Array.isArray(s?.hole_pot_in) ? s.hole_pot_in : null,
        // WHICH hole the pot is on. Left raw and normalised where it is read
        // (lib/betting's potHole), so a tournament that has never opened the
        // panel reads as the default 18 rather than being written one.
        holePotHole: s?.hole_pot_hole ?? null,
      });
    }));
    // The edition index. Subscribed rather than fetched once because it now
    // feeds two things — the doc-id namespacing reconcile below, and the
    // Tournament half of Data — and because a summary this app writes back
    // should appear on the tab that asked for it without a reload.
    //
    // withId for the same reason bc_accounts uses it: the first edition
    // document can be typed into the Firebase console by hand, and a document
    // made that way has whatever fields whoever typed it thought to add.
    unsubs.push(db.subscribe(EDITIONS_COL, [], setEditions, { withId: true }));
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
    // Side bets. Bounded like everything else here — a bet per pair of players
    // at most, and in practice a handful a weekend — so it belongs in this
    // block rather than being deferred like the photo index.
    unsubs.push(db.subscribe(SIDE_BETS_COL, f, setSideBets));
    // The payment ledger. Bounded the same way — a handful of installments per
    // man across one summer — and every phone needs it, because the balance
    // badge on More has to be right before anybody opens a menu.
    unsubs.push(db.subscribe(LEDGER_COL, f, setPayments));
    unsubs.push(db.subscribe(BUDGET_COL, f, setBudgetLines));
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
      holeDataRef.current = hd;   // keep the ref hot for the save path
      setHoleData(hd);
    }));
    // Whether photo uploads are switched on. One tiny document, subscribed
    // with the rest because every phone needs it and it never changes — see
    // onBudgetAlert in functions/index.js, which only writes it on a
    // transition precisely so this listener stays quiet. NOT edition-scoped:
    // the budget is the project's, not a year's.
    unsubs.push(db.subscribe(CONFIG_COL, [], rows => {
      setPhotoConfig(rows.find(r => r.id === PHOTOS_CONFIG_ID) || null);
    }, { withId: true }));
    // The editions themselves, for two fields across them: `locked` on the one
    // this device has open, and `status` on all of them — which is what says
    // which year is the cup and therefore where "Back to <year>" goes.
    // Subscribed rather than fetched so a director freezing the year, or
    // publishing next year's, reaches every phone in the field without a
    // reload — which matters for the first of those, because from that moment
    // their writes are being refused and the strip is the only thing that says
    // so. Eleven small documents; bc_editions is not tournament-scoped (it IS
    // the index of tournaments) so there is no filter to apply.
    unsubs.push(db.subscribe(EDITIONS_COL, [], rows => setEditionRows(rows || [])));
    return () => unsubs.forEach(u => u());
  }, []);

  // ── The photo index, subscribed only once somebody opens Photos ──
  // Deliberately NOT in the block above. Every other subscription there is
  // bounded by the shape of a tournament — sixteen players, four rounds,
  // eighteen holes — but this one grows with however many photos get posted,
  // and Firestore bills a read per document each time a listener attaches.
  //
  // The app has no persistent cache, so every cold start re-reads everything
  // it subscribes to. Attaching this on load would mean a phone that never
  // opens the gallery still paying for the whole index on each launch, times
  // a dozen phones, times however often a phone reloads over a cup weekend.
  // Mounting it on first open instead makes the cost proportional to people
  // actually looking at photos.
  //
  // `photosOpened` latches: once opened, the subscription stays for the rest
  // of the session, so coming back to the gallery is instant and somebody
  // else's photo still shows up live on every phone that has it open.
  const [photosOpened, setPhotosOpened] = useState(false);
  useEffect(() => { if (view === "photos") setPhotosOpened(true); }, [view]);
  // Reports are DIRECTOR-ONLY to read, in the rules and here: in a group of
  // sixteen, "who reported whose photo" is not a fact to hand around. Nobody
  // else subscribes, so nobody else can be shown it by a UI mistake either.
  const [photoReports, setPhotoReports] = useState([]);
  useEffect(() => {
    if (!photosOpened || !isDirectorUser) return;
    return db.subscribe(REPORTS_COL, [{ field: "tournament_id", op: "==", value: TOURNAMENT_ID }], setPhotoReports);
  }, [photosOpened, isDirectorUser]);
  const reportCounts = useMemo(() => reportsByMedia(photoReports), [photoReports]);
  useEffect(() => {
    if (!photosOpened) return;
    return db.subscribe("bc_media", [{ field: "tournament_id", op: "==", value: TOURNAMENT_ID }], setMedia);
  }, [photosOpened]);

  // Enhance tRounds with nassau data
  const enrichedRounds = useMemo(() => tRounds.map(r => ({
    ...r,
    nassau: { front: r.nassau_front ?? 1, back: r.nassau_back ?? 1, overall: r.nassau_overall ?? 1 },
    // The FORMAT's default, not the round number's. This used to read
    // `r.round_number === 4 ? 'full' : 'low_man'` — the same stand-in
    // scoring.getRoundHandicapMode retired, on the grounds that it was only
    // ever shorthand for "round 4 is the Team Best Ball round" and went
    // silently wrong the moment a director moved the format.
    //
    // Worse than a stale copy: it was the copy that WON. Every scoring path
    // reads rounds through this memo, so `tr.handicap_mode` was always filled
    // by the time getRoundHandicapMode looked at it, and the corrected
    // format-derived fallback underneath was unreachable. A Team Best Ball
    // round anywhere but 4 scored off the low man, and a Singles round on 4
    // gave everybody their whole figure.
    handicap_mode: r.handicap_mode || handicapModeFor(r.format),
    // Both scoring axes, normalized here so nothing downstream has to know
    // that a legacy round packed them into one field.
    scoring_type: resolveScoring(r).formOfPlay,
    hole_scoring: resolveScoring(r).holeScoring,
    // Whether the round is in the books. Not a stored field on bc_rounds —
    // finality lives in bc_round_locks — but folded on here because the
    // reveal needs it and every reader already has the round rather than the
    // lock. It is what stops the seal's format fallback from reaching a
    // finished year (see resolveSealed in lib/reveal).
    //
    // Derived, never written: the round auto-save builds an explicit payload
    // (see AdminView), so this cannot ride back into the document.
    final: !!lockForRound(roundLocksData, r.round_number)?.final,
  })), [tRounds, roundLocksData]);

  // ── The blackout, applied once, at the source ────────────────────
  // Every hole past a sealed round's reveal, removed (see lib/reveal.js).
  // The read-only surfaces — the scoreboard and the Data tab — are
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
  //
  // ── Nothing here waits on the network ─────────────────────────────
  // The lock's own write is NOT awaited, and that is load-bearing. Firestore
  // does not settle a setDoc promise until the SERVER acknowledges it, so in
  // a dead spot an awaited write simply never returns — and this function is
  // awaited by the score path. The symptom was one lost hole per round, and
  // only ever the first one: the very first tap of a round hung here, so its
  // optimistic paint and its own score write never ran, while every later tap
  // sailed past on the in-flight flag. On a course with holes out of signal
  // that is exactly the tap nobody would think to check.
  //
  // Not awaiting costs nothing that matters. The snapshot is built from live
  // data synchronously, the local refs are updated the moment it exists, and
  // Firestore queues the write and replays it on reconnect. A lock is a
  // record of what was frozen, not a permission the score has to wait for.
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
      // Deliberately not awaited — see the note above. The refs below are what
      // the next tap reads, and they are true the moment the doc is built.
      db.upsert(ROUND_LOCKS_COL, lock);
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

  // ── Saving a hole ────────────────────────────────────────────────────
  // The order below is the whole point, and it is not the order this used to
  // run in.
  //
  //   1. PAINT. The optimistic update happens first, before anything that can
  //      touch the network. A tap on a score button is answered by the screen
  //      in the same frame, in a dead spot or not.
  //   2. FREEZE. The round lock, which no longer blocks on its own write.
  //   3. WRITE, and watch it. The write is queued, not awaited: Firestore
  //      applies it to the local cache immediately and replays it on
  //      reconnect, so awaiting it would mean waiting for signal to answer a
  //      tap. What IS attached is a rejection handler, because a write that
  //      is REFUSED — rules, quota, a malformed document — is a different
  //      thing entirely from one that is merely queued.
  //
  // That last distinction is what this function exists to make honest. It
  // used to write through `db.upsert`, which swallows its error and returns
  // null, and then ignore the return — so a refused score stayed on screen,
  // looking saved, until somebody reloaded and found the hole empty. A
  // scoreboard that shows a number nobody stored is the one failure this app
  // cannot recover from on its own, because there is nothing to see.
  //
  // On a rejection Firestore rolls its own local mutation back and the
  // subscription re-fires with the truth, which repaints the cell by itself.
  // All this has to do is say so, loudly enough to be acted on.
  const onSaveHole = useCallback(async (pid, rnd, holeIdx, score, courseId) => {
    // Freeze BEFORE the score lands, so the very first hole of a round is
    // already scoring off the snapshot.
    ensureRoundLock(rnd);
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
    // Optimistic update — the ref as well as the state, so a second tap on
    // the same hole knows what it is replacing even before Firestore has
    // echoed the first one back.
    const key = `${pid}_${rnd}`;
    holeDataRef.current = {
      ...holeDataRef.current,
      [key]: { ...holeDataRef.current[key], [holeIdx]: score },
    };
    setHoleData(prev => ({ ...prev, [key]: { ...prev[key], [holeIdx]: score } }));
    // A namespaced edition that already has scores has them under the OLD
    // bare id, and this writer rebuilds the id from scratch every save rather
    // than reusing the stored one — so without this the same hole would exist
    // as two documents, and the subscription (which maps both onto
    // `${pid}_${round}`) would show whichever Firestore happened to hand back
    // last. Dropping the superseded document first means there is never a
    // moment where both exist. Safe against other editions because the id
    // embeds this edition's player id, which no other edition uses.
    if (id !== bareId) db.delete("bc_hole_scores", bareId);
    // `upsertStrict` rather than `upsert`: same merge write, rejection left
    // in. The id is passed separately by its signature and also rides in
    // `data`, which is what keeps `r.id` readable by onDiscardRoundScores.
    trackWrite(
      db.upsertStrict("bc_hole_scores", id, data),
      `Hole ${holeIdx + 1} didn't save`,
    );
  }, [ensureRoundLock, trackWrite]);

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
  // the previous group's measurement attached to a different player. The
  // tagging GROUP is written the same way and for the same reason: a
  // director's pick off the Betting tab carries no group, and inheriting the
  // last group's tee order would have the prompt telling the next group the
  // field is out of order on the strength of a stale field.
  //
  // `confirmed_by` is CLEARED rather than merged. A confirmation was
  // agreement with a distance that has just been beaten; carrying it onto
  // the new tag would show the field agreeing with a number it has never
  // seen.
  const onSetCtp = useCallback(async (round, hole, pid, opts = {}) => {
    const { distanceFt = null, approved = true, taggedBy = null, groupKey: gKey = null, groupOrder = null } = opts;
    const id = editionDocId(`bc_ctp_r${round}_h${hole+1}`);
    if (pid) {
      await db.upsert("bc_ctp", {
        id, tournament_id: TOURNAMENT_ID, round, hole, player_id: pid,
        distance_ft: distanceFt, approved, tagged_by: taggedBy,
        tagged_group_key: gKey,
        tagged_group_order: Number.isInteger(groupOrder) ? groupOrder : null,
        confirmed_by: [],
      });
    } else {
      await db.delete("bc_ctp", id);
    }
  }, []);
  // ── Confirming a standing CTP ────────────────────────────────────────
  // The pass answer from the on-course prompt. Additive and idempotent, so
  // two phones in the same group confirming at once converge instead of
  // racing, and a group re-answering its own hole doesn't stack duplicates.
  //
  // A merge write of ONLY this field, deliberately: the winner, the distance
  // and who tagged it belong to whoever tagged it, and a confirmation must
  // never be able to overwrite them. It reads the record it is appending to
  // out of the live map rather than the document, which is the same snapshot
  // the prompt showed the group — confirming what they were actually looking
  // at. Nothing to confirm on an untagged hole.
  const onConfirmCtp = useCallback(async (round, hole, pid) => {
    const rec = ctpDataRef.current[`${round}_${hole}`];
    if (!rec?.player_id || !pid) return;
    if ((rec.confirmed_by || []).includes(pid)) return;
    await db.upsert("bc_ctp", {
      id: editionDocId(`bc_ctp_r${round}_h${hole+1}`),
      tournament_id: TOURNAMENT_ID,
      confirmed_by: [...new Set([...(rec.confirmed_by || []), pid])],
    });
  }, []);

  // ── Side bets ────────────────────────────────────────────────────────
  // A ledger, not a game: the app records the wager and scores nothing. See
  // lib/sideBets for the shape and for what the rules can and cannot check.
  //
  // `db.create` rather than `db.upsert`, and the rejection is left in. Every
  // other write here is a correction to something already on screen, where
  // swallowing a failure and letting the next snapshot win is the right
  // trade. This one is a person tapping Add and watching for their bet to
  // appear — a silent failure there is the app agreeing to a bet it did not
  // record, which is the one thing a ledger must never do. The sheet stays
  // open on a throw so the typing is not lost.
  //
  // NOT edition-namespaced through editionDocId: the id is minted fresh with
  // a random tail, so it cannot collide with a cloned edition's the way a
  // derived id like `bc_ctp_r1_h7` would. `tournament_id` is what scopes it.
  const onAddSideBet = useCallback(async ({ playerA, playerB, amount, detail }) => {
    const uid = authUser?.uid;
    // Throws rather than returning quietly. The button is hidden without a
    // uid so this is unreachable from the UI — but a silent return here would
    // close the sheet on a bet that was never written, which is the one thing
    // this screen must never do.
    if (!uid) throw new Error("Not signed in");
    await db.create(SIDE_BETS_COL, buildSideBet({
      id: sideBetId(Date.now(), Math.random()),
      tournamentId: TOURNAMENT_ID,
      createdBy: uid,
      playerA, playerB, amount, detail,
      now: Date.now(),
    }));
  }, [authUser]);

  const onDeleteSideBet = useCallback(async (bet) => {
    if (bet?.id) await db.delete(SIDE_BETS_COL, bet.id);
  }, []);

  // A player's own "paid" mark, toggled. Both players marking is what settles
  // a bet; see lib/sideBets.
  //
  // `upsertStrict` rather than `upsert`, and that is load-bearing: the rule
  // that lets the OTHER player write to a bet they do not own allows exactly
  // one key to change, and `upsert`'s habit of writing `id` into the document
  // as well would put a second key in the diff and get the whole write
  // refused. Same reason the director appointment uses it.
  //
  // The rejection is left in for the same reason the create leaves it in: the
  // screen has to be able to say a claim was not recorded.
  const onSettleSideBet = useCallback(async (bet, pid) => {
    if (!bet?.id || !pid) return;
    await db.upsertStrict(SIDE_BETS_COL, bet.id, { settled_by: toggleSettled(bet, pid) });
  }, []);

  // ── The trip ledger ──────────────────────────────────────────────────
  // Director-only, all four of these, and that is the authorization model in
  // full — a player logging their own payment would be a claim rather than a
  // record. The rules say the same thing; see bc_ledger in firestore.rules.
  //
  // Every one returns a boolean rather than throwing, because the caller is a
  // form with a Save button on it: the screen has to be able to say "that
  // didn't save" and leave the typing where it is. Same reason the side-bet
  // create leaves its rejection in, arrived at from the other direction.
  //
  // NOT edition-namespaced through editionDocId, for the same reason a side
  // bet isn't: the id is minted fresh with a random tail, so it cannot collide
  // with a cloned edition's. `tournament_id` is what scopes it — which also
  // means a new edition starts with an empty ledger rather than inheriting
  // last year's balances, which is the right answer.
  // Same shape and same reasoning as onSaveBudgetLine below: the form's
  // object goes through whole so no field can be dropped in the middle, and
  // the rejection is left in so "the rules aren't deployed" does not reach
  // the director as "try again".
  const onLogPayment = useCallback(async (form) => {
    if (paymentError(form)) return { ok: false };
    const now = Date.now();
    try {
      await db.upsert(LEDGER_COL, buildPayment({
        ...form,
        id: paymentId(now, Math.random()),
        tournamentId: TOURNAMENT_ID,
        createdBy: authUser?.uid || null,
        now,
      }), { loud: true });
      return { ok: true };
    } catch (e) {
      console.error("payment save", e);
      return { ok: false, error: writeFailure(e, "Could not log that payment — try again") };
    }
  }, [authUser]);

  const onDeletePayment = useCallback(async (payment) => {
    if (!payment?.id) return { ok: false };
    const done = await db.delete(LEDGER_COL, payment.id);
    return done ? { ok: true } : { ok: false, error: "Could not delete that payment — try again" };
  }, []);

  // ── The house ────────────────────────────────────────────────────────
  // Trip Info's one stored fact. Its own settings document rather than a
  // couple of fields on bc_settings/tournament, and deliberately: cloneEdition
  // copies that document when the director asks for the tournament name, and
  // last year's rental link on this year's Trip Info would send the field to
  // the wrong house.
  const onSaveTrip = useCallback(async ({ houseName, houseUrl }) => {
    const res = await db.upsert("bc_settings", {
      id: editionDocId(TRIP_SETTINGS_ID), tournament_id: TOURNAMENT_ID,
      house_name: String(houseName || "").trim(),
      house_url: String(houseUrl || "").trim(),
    });
    return !!res;
  }, []);

  // ── The budget ───────────────────────────────────────────────────────
  // Director-only, same as the ledger beside it and for a simpler reason:
  // what the trip costs is not a thing a player has an opinion about.
  //
  // One handler for add AND edit. A line is four fields; a separate update
  // path would be a second place to normalize them, and `buildBudgetLine` is
  // where that decision lives. An existing id is reused so the edit lands on
  // the same document; a new one is minted with a random tail so two phones
  // adding a line in the same millisecond cannot collide.
  // THE FORM'S OBJECT GOES THROUGH WHOLE, and that is deliberate rather than
  // lazy. This used to name each field — `{ id, category, label, amount }` —
  // and when the form grew a `basis` toggle this layer silently dropped it:
  // the sheet worked out "$90 x 16 = $1,440 on the trip" in front of the
  // director and then stored a flat $90 total. The screen said one thing and
  // the database held another, which is the one class of bug a director
  // cannot catch by looking.
  //
  // Spreading closes it for good. `buildBudgetLine` picks the fields it
  // knows and ignores the rest, so a field can be added to the form and to
  // the builder without this middle layer being a place it can fall out of.
  //
  // `loud` so the rejection reaches the form. This collection is new, its
  // rules are deployed by hand, and "could not save — try again" is a lie
  // when the answer is "and it never will until the rules land".
  const onSaveBudgetLine = useCallback(async (form) => {
    if (budgetLineError(form)) return { ok: false };
    const now = Date.now();
    try {
      await db.upsert(BUDGET_COL, buildBudgetLine({
        ...form,
        id: form.id || budgetLineId(now, Math.random()),
        tournamentId: TOURNAMENT_ID,
        createdBy: authUser?.uid || null,
        now,
      }), { loud: true });
      return { ok: true };
    } catch (e) {
      console.error("budget line save", e);
      return { ok: false, error: writeFailure(e, "Could not save that line — try again") };
    }
  }, [authUser]);

  const onDeleteBudgetLine = useCallback(async (line) => {
    if (!line?.id) return { ok: false };
    const done = await db.delete(BUDGET_COL, line.id);
    return done ? { ok: true } : { ok: false, error: "Could not delete that line — try again" };
  }, []);

  const onSaveDues = useCallback(async (amount) => {
    try {
      await db.upsert("bc_settings", {
        id: editionDocId(DUES_SETTINGS_ID), tournament_id: TOURNAMENT_ID,
        amount: round2(amount),
      }, { loud: true });
      return { ok: true };
    } catch (e) {
      console.error("dues save", e);
      return { ok: false, error: writeFailure(e, "Could not save that — try again") };
    }
  }, []);

  // A single player's own figure, or null to put them back on the tournament
  // one. Null rather than a delete: `db.upsert` merges, so removing the field
  // entirely would need a different write, and lib/ledger already reads null
  // as "no override" — which is also what an untouched roster row has.
  const onSetPlayerDues = useCallback(async (player, amount) => {
    if (!player?.player_id) return { ok: false };
    try {
      await db.upsert("bc_players", { id: player.player_id, dues_amount: amount }, { loud: true });
      return { ok: true };
    } catch (e) {
      console.error("player dues save", e);
      return { ok: false, error: writeFailure(e, "Could not save that — try again") };
    }
  }, []);

  // ── The photo library's two writes ───────────────────────────────────
  // Both go through lib/mediaUpload.js, which owns the canvas work and the
  // bucket; this pair owns the Firestore side, because `db` lives here and a
  // second write path into bc_media is how two of them drift apart.
  //
  // The order matters in both directions and is the opposite each time:
  //
  //   uploading  bytes first, then the index document. A document pointing at
  //              a photo that failed to upload is a broken tile in the grid;
  //              bytes with no document are invisible and cost 250KB.
  //   deleting   document first, then the bytes. The document is what makes
  //              the photo exist in the app, so removing it is what the person
  //              tapping Remove actually asked for — and if the byte delete
  //              then fails, the result is a hidden orphan rather than a photo
  //              that is still on screen after being deleted.
  //
  // `db.upsert` and `db.delete` swallow their errors, which is right for a
  // score and wrong here: the gallery counts what failed and says so. Hence
  // the null / false check on each.
  //
  // useStableCallback rather than useCallback: the signed-in account and the
  // roster row it claimed both change after mount, so a [] dependency list
  // would freeze the first render's values and attribute every photo of the
  // session to whoever the app thought you were on load — which, on a cold
  // start, is nobody.
  const onUploadPhoto = useStableCallback(async (file, onProgress) => {
    const uid = authUser?.uid;
    if (!uid) throw new Error("You need to be signed in to add photos.");
    const { uploadPhoto } = await import("./lib/mediaUpload");
    const row = await uploadPhoto({
      file,
      tid: getActiveTournamentId(),
      uid,
      uploaderName: user?.name || "",
      // Passed straight through to the tile the gallery already drew for this
      // photo. It is the screen's own progress, so the screen owns what it
      // looks like; this layer only forwards it.
      onProgress,
    });
    if (!(await db.upsert("bc_media", row))) throw new Error("Couldn't save that photo.");
  });

  const onDeletePhoto = useCallback(async (item) => {
    if (!item?.id) return;
    if (!(await db.delete("bc_media", item.id))) throw new Error("Couldn't remove that photo.");
    const { deletePhotoBytes } = await import("./lib/mediaUpload");
    await deletePhotoBytes(item);
  }, []);
  // Flagging somebody else's photo for the director. `loud` because this one
  // has to throw rather than swallow: PhotosView tells the reporter it was
  // sent and then remembers it locally, and both of those would be lies if the
  // write was refused. See lib/mediaReports for the shape and the collection.
  const onReportPhoto = useCallback(async (item) => {
    if (!item?.id || !authUser?.uid) throw new Error("Sign in to report a photo.");
    await db.upsert(REPORTS_COL, buildReport({
      mediaId: item.id,
      tid: TOURNAMENT_ID,
      uid: authUser.uid,
      name: user?.name || "",
    }), { loud: true });
  }, [authUser?.uid, user?.name]);
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
    // A signature is the one act on this screen that the next tap cannot
    // undo, so it gets the heavier of the two haptics. Web: nothing.
    commitFeedback();
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
      ...("lownet_buyin" in patch ? { lowNetAmount: patch.lownet_buyin } : {}),
      ...("lownet_in" in patch ? { lowNetIn: patch.lownet_in } : {}),
      ...("hole_pot_buyin" in patch ? { holePotAmount: patch.hole_pot_buyin } : {}),
      ...("hole_pot_in" in patch ? { holePotIn: patch.hole_pot_in } : {}),
      ...("hole_pot_hole" in patch ? { holePotHole: patch.hole_pot_hole } : {}),
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
  const tournamentRounds = useMemo(
    () => allRounds({ roundCount, tRounds, matches: enrichedMatches, roundLocks: roundLocksData }),
    [roundCount, tRounds, enrichedMatches, roundLocksData]
  );
  // The one round open for score entry. null = nothing open (no schedule
  // yet, or the last round has been finalized).
  const currentRound = useMemo(
    () => currentRoundNumber(roundLocksData, tournamentRounds),
    [roundLocksData, tournamentRounds]
  );

  // ── This edition's row in the archive ────────────────────────────────
  // Computed from the cards by the same engine the leaderboard uses (see
  // lib/editionSummary) and written back onto the edition document, which is
  // what Data → Tournament reads.
  //
  // Three conditions, and each one is doing a job:
  //
  //   complete    only a FINISHED tournament is written down. A cup mid-round
  //               has a score but not a result, and writing on every hole
  //               would put a Firestore write behind every score the director
  //               is standing next to.
  //   revealed    nothing is still sealed. See below — this one is the one
  //               that could do damage.
  //   isDirector  bc_editions is director-write in the rules, so nobody else
  //               could land this anyway. Asking first keeps a player's phone
  //               from firing a write it will only be refused.
  //   changed     a row that already says the right thing is left alone.
  //
  // Which together mean this fires roughly once per tournament, plus once the
  // first time a director opens each imported year — the data is already
  // subscribed by then, so the summary costs a single write and no reads.
  //
  // ── The seal, twice over ──────────────────────────────────────────
  // Computed off the CONCEALED map, like the scoreboard and the Data tab,
  // because this is one more surface that can state a sealed round's
  // result — and a spoiler on Data → Tournament would be exactly the kind
  // nobody thinks to check for.
  //
  // But concealed is not enough on its own here, and this is the subtle part.
  // A round can be FINAL and still sealed: that is what the Final Countdown
  // is, a finished round turned over hole by hole in front of the room. So
  // `complete` can be true while the scores this is reading are blanked, and
  // writing then would archive a half-scored cup as the year's result — and
  // unlike a screen, a stored row does not correct itself when the reveal
  // finishes.
  //
  // `concealHoleData` returns the map UNCHANGED when nothing is sealed, so
  // reference equality is the whole test, and it is exact.
  const nothingSealed = revealedHoleData === holeData;
  const editionSummary = useMemo(() => summarizeEdition({
    matches: enrichedMatches, holeData: revealedHoleData, courses, tRounds: enrichedRounds,
    tPlayers, hcpOverrides: hcpOverridesData, teeAssignments: teeAssignmentsData,
    roundLocks: roundLocksData, teamNames, location: tournamentLocation,
  }), [enrichedMatches, revealedHoleData, courses, enrichedRounds, tPlayers,
    hcpOverridesData, teeAssignmentsData, roundLocksData, teamNames, tournamentLocation]);

  useEffect(() => {
    if (!isDirectorUser || !editionSummary.complete || !nothingSealed) return;
    const row = editions.find(e => e.id === TOURNAMENT_ID);
    if (!row || sameSummary(row.result, editionSummary)) return;
    db.upsert(EDITIONS_COL, { id: TOURNAMENT_ID, result: editionSummary });
  }, [isDirectorUser, editionSummary, editions, nothingSealed]);

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

  // ── The native status bar ────────────────────────────────────────────
  // index.html's `apple-mobile-web-app-status-bar-style` block is a Safari
  // home-screen mechanism and does nothing inside the iOS app's WKWebView —
  // see lib/platform. This is the same decision restated where the native
  // build can hear it, and it re-runs on the theme pill because light text
  // on the light theme's near-white bar is a status bar with nothing
  // readable in it. A no-op in every browser.
  useEffect(() => { applyNativeChrome(darkMode); }, [darkMode]);

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

  // ── What this reader owes the director ───────────────────────────────
  // Derived, never stored — see the top of lib/ledger. It feeds three things
  // that must agree: the BALANCE DUE card on My Account, the red dot on the
  // My Account row in More, and the red dot on More itself. One computation
  // means they cannot disagree with each other or with Admin → Budget.
  //
  // It needs a REAL ROSTER ROW, not just an identity with a player id. The
  // three player-less identities — a guest, a spectator on a year they are
  // not in, a director bootstrapping an empty edition — all carry an id that
  // matches nobody, and the invented `{ player_id }` row this used to fall
  // back to picked up the tournament's default dues and read as a debt. The
  // BALANCE DUE card is drawn from the linked roster row and renders nothing
  // without one, so the dot was the half that could be wrong: a red mark on
  // More telling a guest they owe $800, with no card behind it to say what
  // for. Requiring the row is what makes the three agree, which is the whole
  // point of computing this once.
  const myLedger = useMemo(() => {
    const row = user?.player_id ? tPlayers.find(p => p.player_id === user.player_id) : null;
    return row ? balanceFor({ player: row, payments, defaultAmount: duesAmount }) : null;
  }, [tPlayers, payments, duesAmount, user?.player_id]);
  const balanceDue = owesMoney(myLedger);

  // ── Trip Info ────────────────────────────────────────────────────────
  // Assembled here rather than inside the view, because both of its halves
  // are things this component already holds and neither is its own record:
  // the schedule is the rounds crossed with the courses, and the house is one
  // settings document. See lib/tripInfo.
  const house = useMemo(() => houseFrom(tripDoc), [tripDoc]);
  const schedule = useMemo(
    () => tripSchedule({ rounds: tournamentRounds, tRounds, courses }),
    [tournamentRounds, tRounds, courses]
  );
  // The banner's dates. The stored pair wins; the round dates are only the
  // fallback for an edition set up before that pair existed. See lib/tripInfo.
  const dates = useMemo(
    () => tripDates({ trip: tripDates_, schedule }),
    [tripDates_, schedule]
  );

  const isDirector = !!user?.isDirector;
  // Which of the two finalize prompts, if either, this round has earned.
  // "Ready" is still the blunt, fully-settled definition — every card
  // ATTESTED, not merely every score typed, because the round is over when
  // the field agrees it is. What is new is the rung below it: every score in
  // with cards outstanding, which is the state a director can actually do
  // something about. See lib/scoreGuard's finalizeStage for both, and the
  // header of components/FinalizeRound for why it fires twice.
  const roundStage = currentRound == null ? null : finalizeStage({ progress: roundProgress, cards: roundCards });
  const finalizeReady = isDirector && roundStage === "ready";
  const finalizeNextRound = useMemo(
    () => nextRoundNumber(roundLocksData, tournamentRounds),
    [roundLocksData, tournamentRounds]
  );
  const finalizeLastFinal = useMemo(
    () => lastFinalRoundNumber(roundLocksData, tournamentRounds),
    [roundLocksData, tournamentRounds]
  );

  // ── The countdown in the header ───────────────────────────────────
  // When the field tees off — round one's date and the earliest slot on its
  // tee sheet, off lib/countdown. Null until the director has set both, which
  // is what keeps a clock off a tournament nobody has scheduled yet, and null
  // again the moment the first group goes out.
  //
  // Derived here rather than inside AppHeader because the header is handed
  // what it draws: it has no rounds and no business subscribing to any.
  const countdownAt = useMemo(() => firstTeeAt(tRounds), [tRounds]);

  // ── The ways in ───────────────────────────────────────────────────
  // Sign in → password → claim a name, each one skipped once it has been
  // answered, which for almost everybody means none of them appear again
  // after the first time. Ordered by what is still unknown, and the splash
  // covers every unknown — Firebase restoring its session, the door, and
  // the roster that says which player this account is — because any of
  // them resolving to "no" too early puts a signed-in player back on a
  // login screen, which is the bug this whole feature exists to kill.
  //
  // A GUEST skips all three, because all three are questions about an
  // account and a guest does not have one (lib/guest.js). Not a fourth
  // screen and not a shortcut past the password: the password gates
  // WRITING, which a guest cannot do at all — every write rule in
  // firestore.rules begins at `request.auth != null`, and a guest has no
  // auth token to satisfy it with. Skipping the splash too is deliberate:
  // there is no persisted session to wait for, so waiting would only mean
  // "…" on screen for the length of a Firebase round trip.
  const chrome = { tournamentName, tournamentLocation };
  if (!guesting) {
    if (authUser === undefined || (authUser && member === undefined) || (authUser && member && !user && !playersLoaded)) return <LoginSplash {...chrome} />;
    if (!authUser) return <SignInScreen {...chrome} initialError={authError} onGuest={enterGuest} />;
    if (!member) return (
      // Re-read rather than assume: the membership document that was just
      // created is also where Admin access is read from, and a director flag
      // set in the console before the first sign-in would be missed by a
      // locally-invented one.
      <GateScreen {...chrome} authUser={authUser} onSignOut={doSignOut}
        onGuest={() => doSignOut({ toGuest: true })}
        onPassed={async () => { const { doc } = await loadMembership(authUser.uid); setMembership(doc || { uid: authUser.uid }); }} />
    );
    if (!user) return (
      <ClaimScreen
        {...chrome}
        players={realPlayers(tPlayers)} teams={teams} darkMode={darkMode} authUser={authUser}
        // A director is exempt from the lock, so the roster stays tappable for
        // them — matching the rule, which lets their claim through.
        editionLocked={isEditionLocked(activeEdition) && !isDirectorUser}
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
  }

  // Which side of the cup the reader is on. This is a two-team event, so a
  // player belongs to one team for its whole length and the answer holds for
  // every match on every screen — which is what lets a scorecard's running
  // MATCH row read ▲ / ▼ from the reader's own side. Taken from the live
  // roster rather than the stored session, which predates any team change.
  const viewerTeam = tPlayers.find(p => p.player_id === user.player_id)?.team || user.team || "A";

  // Whether there is a round to finalize at all. Was a More-menu row; it is
  // now only the guard on the sheet and on Admin → Rounds' control, since
  // More is where a PLAYER goes and finalizing is the one act on the
  // tournament that only a director can perform.
  const canFinalize = isDirector && tournamentRounds.length > 0;
  // The notification itself: whichever stage the round has reached, and only
  // until the director puts THAT STAGE away. Dismissing "all scores are in"
  // leaves the "ready to finalize" bar still to come.
  const alertStage = isDirector && roundStage ? roundStage : null;
  const showFinalizeAlert = !!alertStage
    && finalizeSnoozed !== finalizeSnoozeTag(currentRound, alertStage);

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
      <AppHeader
        location={tournamentLocation}
        pendingWrites={writeState.pending}
        failedWrites={writeState.failed}
        countdownAt={countdownAt}
      />

      {/* ── The frozen-year strip ──
          A write that will never land has to say so BEFORE somebody spends a
          round typing into it. A locked edition refuses members in
          firestore.rules, so this is not the enforcement — it is the only
          place the enforcement is visible.

          App chrome rather than a banner inside Scoring, for the same reason
          the header is: the refusal reaches signing, betting and photos too.

          Not shown to a director, who is exempt and would be reading a wall
          that is not there for them, and not to a guest, who has no Firebase
          account at all and is already refused at `request.auth != null`
          without a membership check ever running. */}
      {!isGuest(user) && lockNotice(activeEdition, { isDirector: isDirectorUser }) && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "7px 20px",
          background: BC.t3 + ALPHA.wash, borderBottom: `1px solid ${BC.t3}${ALPHA.hair}`,
        }}>
          <span aria-hidden style={{ flexShrink: 0, fontSize: FS.label }}>🔒</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: FS.label, fontWeight: 600, color: BC.t2, lineHeight: 1.4 }}>
            {lockNotice(activeEdition, { isDirector: isDirectorUser })}
          </span>
        </div>
      )}

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
          stage={alertStage}
          onOpen={() => setFinalizeOpen(true)}
          onDismiss={() => snoozeFinalizeAlert(currentRound, alertStage)}
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
            groups={groupsData}
            ctpData={ctpData}
            onSetCtp={onSetCtp}
            onConfirmCtp={onConfirmCtp}
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
            /* Concealed hole data, same as the scoreboard and the Data
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
            /* The auth uid, separate from the roster identity above: it is
               what the side-bet rules pin authorship to, and a spectator or a
               signed-out reader has one without the other. */
            authUid={authUser?.uid || null}
            sideBets={sideBets}
            onAddSideBet={onAddSideBet}
            onDeleteSideBet={onDeleteSideBet}
            onSettleSideBet={onSettleSideBet}
            confirm={confirm}
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
            // No account to sign out of, delete, or take a push token —
            // this screen is about the person, and a guest is the one
            // reader it has almost nothing to say to. See lib/guest.js.
            isGuest={guesting}
            teams={teams}
            /* The trip ledger's player-facing half. Both halves of the
               subtraction go down, not the balance: My Account has to be able
               to show the working, because "what do I still owe" is only
               believable next to the payments it was worked out from. */
            payments={payments}
            duesAmount={duesAmount}
            darkMode={darkMode}
            onToggleTheme={toggleTheme}
            onLogout={() => { doSignOut(); setView("leaderboard"); }}
            onDeleteAccount={onDeleteAccount}
            notify={notify}
          />
        )}
        {view === "trip" && (
          /* Read-only for everybody, director included — every fact on it is
             edited where it already lived. See components/TripInfo. */
          <TripInfo
            tournamentName={tournamentName}
            tournamentLocation={tournamentLocation}
            house={house}
            schedule={schedule}
            dates={dates}
            isDirector={isDirector}
          />
        )}
        {view === "data" && (
          /* Concealed hole data, same as the scoreboard: this tab's per-player
             W/L/PTS is the cup total sliced a different way, so a sealed round
             left in it would give the ending away from a tab nobody thought to
             check. The ten finished years are not concealable and do not need
             to be — a sealed round is this year's, and this year is the only
             one the tab computes rather than reads. */
          <Suspense fallback={<LoadingPanel label="Data" />}>
          <DataView
            tPlayers={tPlayers} matches={enrichedMatches} holeData={revealedHoleData}
            tRounds={enrichedRounds} courses={courses}
            hcpOverrides={hcpOverridesData} teeAssignments={teeAssignmentsData}
            roundLocks={roundLocksData} teams={teams} teamNames={teamNames}
            editions={editions}
            activeYear={getTournamentYear()}
            /* A demo tournament contributes nothing to the record. Its field
               and its courses are invented, so folding it would put twelve
               golfers who do not exist into the career table beside the real
               ones — see isDemoEdition in lib/editions. */
            isDemo={isDemoEdition(editions.find(e => e.id === TOURNAMENT_ID))}
            /* Which row on the career table is yours. Resolved to a canonical
               golfer inside the tab — a roster row is one year of one man. */
            myPlayerId={user?.player_id || null}
          />
          </Suspense>
        )}
        {view === "photos" && (
          /* `canPost` is membership, not a role: everybody who has been through
             the password screen posts photos, the same way everybody scores.
             The one identity held back is the spectator — somebody who opened a
             finished year they are not in. The rules would take that write, since
             they only ask for a membership; not offering it is the same judgement
             the claim screen makes, that a year you are only looking at is not
             one you add to. */
          <Suspense fallback={<LoadingPanel label="Photos" />}>
          <PhotosView
            items={media}
            year={getTournamentYear()}
            uid={authUser?.uid || null}
            /* The REAL flag, not the demo's. This one is "may delete somebody
               else's photo", and bc_media keeps that director-only in the
               rules: a photo graduated out of the bucket to the public library
               is no longer edition-scoped, so `is_demo` cannot contain it. A
               demo administrator still deletes their own, like any member. */
            isDirector={isDirectorUser}
            canPost={!!authUser?.uid && user?.player_id !== SPECTATOR_ID && photoUploadsAllowed(photoConfig)}
            uploadsBlockedReason={photoUploadsAllowed(photoConfig) ? "" : uploadsDisabledReason(photoConfig)}
            onUpload={onUploadPhoto}
            onDelete={onDeletePhoto}
            onReport={onReportPhoto}
            reportCounts={reportCounts}
            notify={notify}
          />
          </Suspense>
        )}
        {view === "admin" && (
          <Suspense fallback={<LoadingPanel label="Admin" />}>
          <AdminView
            user={user}
            /* Administering the demo on a membership alone. Three cards come
               off for them — Editions, Access and the crown — because those
               three are project-wide rather than scoped to a tournament, so no
               `is_demo` flag could contain them. See canAdminEdition in
               firestore.rules and lib/editionLock. */
            isDemoAdmin={demoAdmin}
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
            roundCount={roundCount}
            tournamentRounds={tournamentRounds}
            /* Returns whether it landed, and applies nothing until it has.
               It used to set all four pieces of local state FIRST and then
               fire the write — which meant a rejected write (no membership,
               offline, rules) left the whole app showing the new name, the
               new dates and the new round count, with the old ones still in
               Firestore. Nothing on screen disagreed with anything, so the
               only way to find out was to reload and watch it revert. */
            onSaveTournament={async ({ name, location, rounds, startDate, endDate }) => {
              const res = await db.upsert("bc_settings", {
                id: editionDocId("tournament"), tournament_id: TOURNAMENT_ID,
                name, location, round_count: rounds,
                // Written even when blank: clearing the dates has to be a real
                // edit, and `upsert` merges — an omitted field would leave the
                // old pair standing while the form showed empty boxes.
                start_date: startDate || "", end_date: endDate || "",
              });
              if (!res) return false;
              // The subscription will deliver the same values a moment later;
              // these are only so the header changes on the tap rather than on
              // the round trip.
              setTournamentName(name);
              setTournamentLocation(location);
              setRoundCount(rounds);
              setTripDates({ start_date: startDate || "", end_date: endDate || "" });
              return true;
            }}
            hcpOverridesFromDb={hcpOverridesData}
            teeAssignmentsFromDb={teeAssignmentsData}
            groupsFromDb={groupsData}
            onSaveGroups={onSaveGroups}
            roundLocks={roundLocksData}
            /* Admin → Budget. Director-only by construction: this whole view
               is, and the rules say the same thing for bc_ledger. */
            payments={payments}
            duesAmount={duesAmount}
            onLogPayment={onLogPayment}
            onDeletePayment={onDeletePayment}
            onSaveDues={onSaveDues}
            onSetPlayerDues={onSetPlayerDues}
            budgetLines={budgetLines}
            onSaveBudgetLine={onSaveBudgetLine}
            onDeleteBudgetLine={onDeleteBudgetLine}
            /* Admin → Rounds' route to the Finalize sheet — the early-finalize
               path that used to be a row in the More menu. Null when there is
               no round to finalize, which is what hides the control. */
            onOpenFinalize={canFinalize ? () => setFinalizeOpen(true) : null}
            finalizeRound={currentRound}
            finalizeReady={finalizeReady}
            /* The RAW trip document, not the normalized house: a link
               lib/tripInfo would refuse still has to appear in the box so the
               director can see what they pasted. */
            trip={tripDoc}
            onSaveTrip={onSaveTrip}
            /* The trip's dates, which Admin → Event owns and Admin →
               Rounds reads down from for its per-round day picker. */
            startDate={tripDates_.start_date}
            endDate={tripDates_.end_date}
            notify={notify}
          />
          </Suspense>
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

      <SlideMenu open={menuOpen} onClose={() => setMenuOpen(false)} onNavigate={setView} user={user} view={view}
        alerts={{ finalize: finalizeReady, balance: balanceDue }}
        onEditions={() => setEditionsOpen(true)} navH={navH} />

      {/* Every year the cup has been played. Opened from the menu by anybody;
          `canManage` is what adds the create/delete half for a director, who
          also reaches the same modal from Admin → Event. */}
      <EditionSwitcher open={editionsOpen} onClose={() => setEditionsOpen(false)} canManage={isDirectorUser} />

      {/* The Finalize sheet — everything the removed Scoring card held, at
          zero cost until it is opened. */}
      {finalizeOpen && canFinalize && (
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
      {/* ── The way back from a year that is over ──────────────────────
          Inside the nav's box, not above it, on purpose. `navH` is this box
          measured, and the slide menu seats itself on that figure — a sibling
          row would be covered by the menu the moment it opened. Being in here
          also means it is reserved by the same flex layout as the bar, so the
          scroll area shortens by exactly its height with nothing to predict.
          Null while this device is on the cup, which is nearly always. */}
      <EditionBanner viewing={activeEdition} live={liveEditionRow} />
      {/* padding matches the content column's `0 4px` so the five tabs line up
          with the cards above them instead of being 4px wider on each side. */}
      <div style={{ maxWidth: 520, margin: "0 auto", display: "flex", padding: "0 4px" }}>
        {navItems.map(item => {
          const active = view === item.key;
          const clr = active ? BC.amberInk : BC.t3;
          // The notification's persistent half, and the balance's only half.
          // The bar above can be dismissed; this dot cannot, and it stays lit
          // until the fact behind it changes — the round is finalized, or the
          // money is paid. Dismissing a reminder should quiet it, not delete
          // the fact.
          //
          // Two facts, one dot, and finalize wins when both are true: it is
          // the one with a deadline, and the money will still be owed after
          // the round is in. Both trails end inside this menu — finalize on
          // the Admin row, the balance on My Account — so the colour is what
          // says which row to look for.
          const badge = item.key === "menu" && (finalizeReady || balanceDue);
          const badgeColor = finalizeReady ? BC.amber : BC.danger;
          return (
            <button key={item.key} onClick={() => {
              // Opening the menu warms the Data tab's chunk — the component
              // and ten years of archive in one file. By the time a thumb has
              // travelled from the bar to the row it is usually already there.
              // A hint, not a dependency: if it fails the tab shows a spinner
              // and fetches it itself.
              if (item.key === "menu") { setMenuOpen(true); prefetchArchive(); return; }
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
                  width: 8, height: 8, borderRadius: "50%", background: badgeColor,
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
