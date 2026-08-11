// ══════════════════════════════════════════════════════════════════
//  AdminView — everything the director owns.
// ══════════════════════════════════════════════════════════════════
//
// The roster, the rounds, the draw, the courses, the groups and tee sheet,
// the team names and colours, the tournament identity, the editions and the
// password. Four tabs, and between them every write in the app that a player
// on a tee box cannot make.
//
// ── Why it is a file of its own ───────────────────────────────────────
// It lived in App.jsx, where it was ~2,800 of that file's ~7,600 lines, and
// fifteen of sixteen people never open it. React.lazy needs a module
// boundary to split on, so this file IS the split: App loads it only when
// somebody taps Admin, and everybody else stops paying to download it.
//
// Nothing about the code changed in the move. This is a lift — the same
// functions in the same order, with the imports they were already using
// re-pointed one directory up. That was deliberate: the Rounds tab
// auto-saves to the live tournament on every keystroke, so a refactor and a
// relocation in one commit would leave no way to tell which of them broke a
// write.
//
// ── The tee colours came too ──────────────────────────────────────────
// One map, one resolver, one ring rule, one component — and all four are
// used only by this screen, which is why they sit at the top of this file
// rather than in the shared theme. They were in App.jsx purely because
// AdminView was.

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  DEFAULT_FORMAT,
  FORMATS,
  HOLE_METHOD_DESCRIPTIONS,
  HOLE_METHOD_LABELS,
  HOLE_RULE_COUNTING,
  HOLE_RULE_FIXED,
  HOLE_SCORING_BEST_BALL,
  HOLE_SCORING_FORMAT,
  NASSAU_DEFAULT,
  SCORING_TYPE_MATCH,
  TOURNAMENT_LOCATION,
  TOURNAMENT_TITLE,
  allowanceDefaultFor,
  allowanceStartsOn,
  countingDefaultFor,
  countingNine,
  describeAllowance,
  describeFormOfPlay,
  describeHoleScore,
  formDefaultFor,
  formOfPlayLabel,
  formatCountsScores,
  formatUsesParPoints,
  formsFor,
  handicapModeFor,
  holeOptionsFor,
  holePointsTotal,
  holeRuleFor,
  isPointsPerHole,
  parPointsDefaultFor,
  parResultLabel,
  parResultsFor,
  resolveAllowance,
  resolveCounting,
  resolveFormOfPlay,
  resolveHoleMethod,
  resolveHolePoints,
  resolveParPoints,
  resolveScoring,
} from "../constants";
import {
  TOURNAMENT_ID,
  db,
  editionDocId,
} from "../firebase";
import {
  accountLabel,
  accountsUnreadable,
  isClaimed,
  membershipFor,
  playerIsDirector,
  readAccessCode,
  setAccessCode,
  unlinkPatch,
} from "../lib/accounts";
import {
  DEFAULT_TEE_INTERVAL,
  TEE_SLOTS,
  formatTeeTime,
  matchPlayers,
  parseTeeTime,
  stripAMPM,
} from "../lib/groups";
import {
  processLogo,
} from "../lib/logoBrand";
import {
  realPlayers,
} from "../lib/players";
import {
  COUNTDOWN_HASH,
  revealState,
  revealSummary,
  sealDefaultFor,
} from "../lib/reveal";
import {
  LOCK_FINAL,
  LOCK_OPEN,
  describeHiChangeImpact,
  roundLockState,
} from "../lib/roundLocks";
import {
  MAX_ROUND_COUNT,
  clampRoundCount,
  resolveRoundCount,
  roundsBeyondCount,
} from "../lib/rounds";
import {
  holesEntered,
} from "../lib/scoreGuard";
import {
  safeHouseUrl, tripDateFields, tripDatesError, tripDayOptions,
} from "../lib/tripInfo";
import {
  formatISODate,
} from "../lib/dates";
import {
  useConfirm,
} from "../lib/useConfirm";
import {
  useStableCallback,
} from "../lib/useStableCallback";
import {
  calcCH,
  calcCHForCourse,
  getEffectiveHI,
} from "../scoring";
import {
  ALPHA,
  BC,
  FONT,
  FS,
  ON_AMBER,
  playerNameColor,
  segThumb,
  segTrack,
} from "../theme";
import {
  EditionSwitcher,
} from "./EditionSwitcher";
import {
  GhinLinkButton,
  GhinSyncButton,
} from "./GhinLink";
import {
  MatchSetup,
} from "./MatchSetup";
import {
  ConfirmModal,
  Popup,
} from "./Popup";
import {
  SegRule,
  SegmentedToggle,
  StickyTop,
} from "./ui";
import { LedgerAdmin } from "./Ledger";

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
  r.format, r.handicap_mode, r.date, r.tee_time, r.scoring_type, r.hole_scoring,
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

export function AdminView({ user, tPlayers, memberships, onSetDirector, tRounds, courses, matches, onAddPlayer, onUpdatePlayer, onRemovePlayer, onAddCourse, onSetRound, onSetMatch, holeData, onDiscardRoundScores, teams, teamNames, onSaveTeamNames, brand, onSaveBranding, tournamentName, tournamentLocation, roundCount, tournamentRounds, onSaveTournament, hcpOverridesFromDb, teeAssignmentsFromDb, groupsFromDb, onSaveGroups, notify, roundLocks, payments, duesAmount, onLogPayment, onDeletePayment, onSaveDues, onSetPlayerDues, onOpenFinalize, finalizeRound, finalizeReady, trip, onSaveTrip, startDate, endDate }) {
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
  // The house, seeded from what is STORED rather than from the normalized
  // form: a link lib/tripInfo would refuse still has to be visible in the
  // box so the director can see what they pasted and fix it.
  // The trip's first and last day — the SOURCE OF TRUTH for every date in
  // the app (see lib/tripInfo). Seeded from what is stored, never from a
  // fallback, so an end date the director has not filled in yet stays an
  // empty box rather than quietly becoming the start date.
  const [editStartDate, setEditStartDate] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editHouseName, setEditHouseName] = useState("");
  const [editHouseUrl, setEditHouseUrl] = useState("");
  const [editTournamentName, setEditTournamentName] = useState(tournamentName || "");
  const [editTournamentLocation, setEditTournamentLocation] = useState(tournamentLocation || "");
  // Seeded from the RESOLVED count, not the raw setting, so an edition that
  // predates the field opens showing the four rounds it already has rather
  // than an empty box.
  const [editRoundCount, setEditRoundCount] = useState("");
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
  useEffect(() => { setEditStartDate(tripDateFields({ start_date: startDate }).start); }, [startDate]);
  useEffect(() => { setEditEndDate(tripDateFields({ end_date: endDate }).end); }, [endDate]);
  useEffect(() => { setEditHouseName(trip?.house_name || ""); }, [trip?.house_name]);
  useEffect(() => { setEditHouseUrl(trip?.house_url || ""); }, [trip?.house_url]);
  useEffect(() => { setEditTournamentName(tournamentName || ""); }, [tournamentName]);
  useEffect(() => { setEditTournamentLocation(tournamentLocation || ""); }, [tournamentLocation]);
  useEffect(() => {
    setEditRoundCount(String(resolveRoundCount({ roundCount, tRounds, matches, roundLocks })));
  }, [roundCount, tRounds, matches, roundLocks]);
  // Rounds the schedule would hold on to at the number CURRENTLY TYPED, so
  // the hint answers while the director is still typing rather than after
  // they save and wonder why the pills did not change.
  const heldRounds = roundsBeyondCount({
    roundCount: clampRoundCount(editRoundCount), tRounds, matches, roundLocks,
  });
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
  // A director who shortens the tournament while standing on the round they
  // just removed would otherwise be editing a round with no pill to return
  // to. Falls back to the last one that is left.
  useEffect(() => {
    if (tournamentRounds.length && !tournamentRounds.includes(editRound)) {
      setEditRound(tournamentRounds[tournamentRounds.length - 1]);
    }
  }, [tournamentRounds, editRound]);
  const [roundFormat, setRoundFormat] = useState("");
  const [roundTeeTime, setRoundTeeTime] = useState("");
  // The day this round is played, YYYY-MM-DD. Trip Info derives the whole
  // weekend's dates from these — see lib/tripInfo — so this is the only
  // place a date is typed and there is no trip-level pair to drift from it.
  const [roundDate, setRoundDate] = useState("");
  const [hcpOverrides, setHcpOverrides] = useState({});
  // Per round, and seeded EMPTY. It used to open as
  // `{1:"low_man",2:"low_man",3:"low_man",4:"full"}` — the retired
  // `round === 4 ? "full"` heuristic written out longhand, which was only ever
  // a stand-in for "round 4 is the Team Best Ball round" and stopped being
  // true the moment a director moved that format somewhere else. An absent
  // entry falls through to defaultHandicapMode(format), which asks the format
  // itself; see the hydration effect and formRound below.
  const [handicapMode, setHandicapMode] = useState({}); // per round
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
      date: tr.date || "",
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
      // Straight through, unlike tee_time above: a date has to be CLEARABLE,
      // and `|| storedRound.date` would make an emptied box read as no edit.
      // Safe because the auto-save is gated on `formSeeded`, so the blank
      // this state holds before hydration is never diffed against Firestore.
      date: roundDate,
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
  }, [storedRound, roundFormat, handicapMode, editRound, roundDate, roundTeeTime, nassau, scoringType, holeScoring, allowance, counting, holePoints, parPoints, sealed, hcpOverrides, teeAssignments]);

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
    setRoundDate(storedRound.date);
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
        date: payload.date,
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
          } catch { /* a fallback search that fails simply adds nothing */ }
          try {
            const r4 = await fetch(`/api/courses?search=${encodeURIComponent(q)}`);
            if (r4.ok) { const d4 = await r4.json(); const gc4 = parseGolfCourseAPI(d4).filter(c => stateMatches(c.state, stateFilter)); for (const gc of gc4) { if (!results.find(r => r.name.toLowerCase() === gc.name.toLowerCase())) results.push(gc); } }
          } catch { /* likewise — the results already gathered still stand */ }
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

  // ── The Tournament tab's fields ──────────────────────────────────
  // Condensed by PADDING and WEIGHT, not by dropping a type rung. The tab was
  // five cards of chunky boxes and took two screens of scrolling to read; it
  // is now about two thirds the height.
  //
  // The 16px is load-bearing and stays: mobile Safari zooms the whole page in
  // when a focused input's font-size is under 16px, and it does not zoom back
  // out — so a smaller box here would trade a scroll for a viewport the
  // director has to pinch their way out of on every field. See the note on
  // the FS scale in theme.js, which says the same thing.
  const TournFieldStyle = { flex: 1, minWidth: 0, boxSizing: "border-box", padding: "6px 10px", background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 7, color: BC.t1, fontSize: FS.lead, fontWeight: 600, outline: "none", fontFamily: FONT };
  const TournLabelStyle = { fontSize: FS.label, fontWeight: 700, color: BC.t3, letterSpacing: 0.5, width: 52, flexShrink: 0, textTransform: "uppercase" };
  const TournCardStyle = { background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, padding: "10px 12px", marginBottom: 10 };
  const TournHeadStyle = { fontSize: FS.label, fontWeight: 700, color: BC.t3, letterSpacing: 1.5, textTransform: "uppercase" };
  const TournSaveStyle = { flexShrink: 0, fontSize: FS.label, fontWeight: 800, color: ON_AMBER, background: BC.amber, border: "none", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontFamily: FONT };

  const InputStyle = { width: "100%", padding: "10px 12px", background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 8, color: BC.t1, fontSize: FS.body, boxSizing: "border-box", outline: "none", fontFamily: FONT };
  const LabelStyle = { fontSize: FS.label, color: BC.t3, fontWeight: 700, letterSpacing: 1, marginBottom: 4, display: "block" };
  const BtnStyle = { padding: "10px 20px", borderRadius: 10, border: "none", fontSize: FS.body, fontWeight: 700, cursor: "pointer", background: `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})`, color: ON_AMBER };

  return (
    <div style={{ fontFamily: FONT }}>
      <EditionSwitcher open={showEditions} onClose={() => setShowEditions(false)} canManage />
      {/* Tabs — pinned to the top of the scroll area so the bar stays in the
          SAME place on every sub-tab, regardless of that tab's content
          height, and in the same place the other views pin their own lead
          control. See StickyTop for how the seam is painted. */}
      <StickyTop style={{ marginBottom: 4 }}>
      <SegmentedToggle
        options={[["players","Players"],["rounds","Rounds"],["matches","Matches"],["money","Money"],["tournament","Tournament"]]}
        value={tab}
        onChange={setTab}
        /* Five tabs since Money arrived, and "Tournament" is wider than a
           fifth of a phone. Without this the flex row refuses to shrink it and
           the whole bar runs past the right edge. */
        fit
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
                    <GhinSyncButton players={realPlayers(tPlayers)} onUpdatePlayer={onUpdatePlayer} notify={notify} confirm={confirm} compact />
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

              {/* Player list. `realPlayers` drops 2020's compiled card — it is a
                  roster row so Team Best Ball has a ball on that side, not a
                  golfer anybody can edit. See lib/players.isBorrowedBall. */}
              {realPlayers(tPlayers).filter(p => p.team === team.id).map(p => {
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
              {realPlayers(tPlayers).filter(p => p.team === team.id).length === 0 && (
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
          {/* ── Finalize ──
              The director's always-available route to the Finalize sheet, and
              the ONLY one that does not wait for the round to be ready: a
              withdrawal or a conceded match leaves holes that will never be
              filled, so the notification in the app shell — which fires on a
              complete round — would never fire for it. It is also the way
              back, since the sheet carries Reopen.

              It sits above the round pills rather than inside the form below
              them because it acts on the round the FIELD is playing, not on
              the round this form happens to be editing. Those are different
              questions and putting the button inside the form would conflate
              them.

              This used to be a row in the More menu. It moved here because
              More is a place a player goes, and this is the one act on the
              live tournament that only a director can perform. */}
          {onOpenFinalize && (
            <button onClick={onOpenFinalize} style={{
              width: "100%", marginBottom: 12, padding: "11px 14px", borderRadius: 10,
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
              background: finalizeReady ? BC.amberGlow : BC.card,
              border: `1px solid ${BC.amber}${finalizeReady ? ALPHA.line : ALPHA.hair}`,
              color: finalizeReady ? BC.amberInk : BC.t1,
              fontSize: FS.body, fontWeight: 700, cursor: "pointer", fontFamily: FONT,
              textAlign: "left",
            }}>
              <span style={{ minWidth: 0 }}>
                {finalizeRound != null ? `Finalize Round ${finalizeRound}` : "Reopen last round"}
                <span style={{ display: "block", fontSize: FS.label, fontWeight: 500, color: BC.t3, marginTop: 2 }}>
                  {finalizeRound == null
                    ? "Every round is final — scoring is closed"
                    : finalizeReady
                      ? "Every card is in and attested"
                      : "Freeze it early, or reopen the last one"}
                </span>
              </span>
              <span style={{ color: finalizeReady ? BC.amberInk : BC.t3, fontSize: FS.lead, flexShrink: 0 }}>›</span>
            </button>
          )}
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {/* Switching round is all these do. The hydration effect re-seeds
                the form from Firestore — including for a round with no
                document yet, which the old inline loader skipped, leaving
                the previous round's settings on screen. */}
            <SegmentedToggle
              variant="pills"
              options={tournamentRounds.map(r => [r, `Rd ${r}`])}
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

            {/* Date — WHICH DAY OF THE TRIP this round is played.
                It PULLS FROM Admin → Tournament rather than opening the whole
                calendar: the trip's first and last day are set there and are
                the source of truth, so this offers the days between them and a
                round cannot be dated outside the trip it belongs to. Set the
                trip's dates and this becomes a four-tap decision instead of a
                date picker per round.

                It falls back to a plain date box when the tournament has no
                dates yet — an empty dropdown would be a dead end, and an
                edition set up before that field existed still has to be
                editable. Clearing is a real edit either way; an undated round
                reads as undated. */}
            {(() => {
              const days = tripDayOptions({ start_date: startDate, end_date: endDate });
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <div style={{ fontSize: FS.small, fontWeight: 700, color: BC.gold, flexShrink: 0 }}>DATE</div>
                  {days.length ? (
                    <select
                      value={days.includes(roundDate) ? roundDate : ""}
                      onChange={e => setRoundDate(e.target.value)}
                      style={{ ...InputStyle, marginBottom: 0, fontSize: FS.small, padding: "6px 8px", flex: 1, minWidth: 0 }}
                    >
                      <option value="">Not set</option>
                      {days.map(d => (
                        <option key={d} value={d}>{formatISODate(d, { weekday: true })}</option>
                      ))}
                      {/* A round dated outside the trip — the trip moved after
                          the schedule was built. Kept as an option so it shows
                          what is actually stored instead of silently reading
                          as "Not set". */}
                      {roundDate && !days.includes(roundDate) && (
                        <option value={roundDate}>{formatISODate(roundDate, { weekday: true, withYear: true })} — outside the trip</option>
                      )}
                    </select>
                  ) : (
                    <input
                      type="date"
                      value={roundDate || ""}
                      onChange={e => setRoundDate(e.target.value)}
                      style={{ ...InputStyle, marginBottom: 0, fontSize: FS.small, padding: "6px 8px", flex: 1, minWidth: 0 }}
                    />
                  )}
                </div>
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
                    realPlayers(tPlayers).filter(p => p.team === "A").length,
                    realPlayers(tPlayers).filter(p => p.team === "B").length,
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
                  {realPlayers(tPlayers).filter(p => p.team === team.id).map(p => {
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
          tournamentRounds={tournamentRounds}
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
                        const finalCourse = Object.fromEntries(Object.entries(rawCourse).filter(([, v]) => v !== undefined));
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

      {/* ── Money ──
          The trip ledger: what each man owes for the weekend and what he has
          paid so far. Nothing to do with the golf, and nothing to do with the
          betting tab either — skins and side bets are settled between players,
          this is what is owed to the DIRECTOR, who fronted the whole cost
          months ago. See lib/ledger. */}
      {tab === "money" && (
        <LedgerAdmin
          tPlayers={realPlayers(tPlayers)}
          teams={teams}
          payments={payments || []}
          duesAmount={duesAmount || 0}
          onSaveDues={onSaveDues}
          onLogPayment={onLogPayment}
          onDeletePayment={onDeletePayment}
          onSetPlayerDues={onSetPlayerDues}
          notify={notify}
        />
      )}

      {tab === "tournament" && (
        <div>
          {/* Active edition — switch year or create a new edition */}
          <div style={{ ...TournHeadStyle, marginBottom: 6 }}>Active Edition</div>
          <button onClick={() => setShowEditions(true)} style={{
            width: "100%", marginBottom: 10, padding: "9px 12px", borderRadius: 10,
            background: BC.card, border: `1px solid ${BC.bdr}`, color: BC.t1,
            fontSize: FS.small, fontWeight: 700, letterSpacing: 0.3, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            fontFamily: FONT,
          }}>
            <span>Edition · <span style={{ color: BC.amberInk }}>{TOURNAMENT_ID}</span></span>
            <span style={{ fontSize: FS.label, color: BC.t3 }}>Switch / new ›</span>
          </button>

          {/* Tournament identity — name, location, dates, length.
              One card and one Save for all of it: they're the same sentence on
              every screen that shows them ("The Bourbon Cup · 2025 · Grand
              Rapids, MI"), and a director renaming the tournament for a venue
              would otherwise have to remember two separate saves. An empty
              name or location falls back to its constant rather than saving
              blank, so the header can't end up with a hole in it.

              ── The dates are the SOURCE OF TRUTH ─────────────────────
              Not derived from the rounds, which is how they started. A
              director knows the weekend in February and the draw in July, so
              deriving made the app unable to answer "when is it" for exactly
              the months everybody asks. Everything downstream reads from this
              pair: the round date picker below offers the days between them,
              and Trip Info's banner is them. See lib/tripInfo. */}
          <div style={TournCardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <div style={TournHeadStyle}>Tournament</div>
              <button
                onClick={() => {
                  const err = tripDatesError({ start: editStartDate, end: editEndDate });
                  if (err) { notify?.(err, "error"); return; }
                  onSaveTournament({
                    name: editTournamentName.trim() || TOURNAMENT_TITLE,
                    location: editTournamentLocation.trim() || TOURNAMENT_LOCATION,
                    // Clamped rather than refused. A blank box or a slipped
                    // keystroke should not be able to fail a save that also
                    // carries the name and the venue, so it lands on the nearest
                    // legal number and the row below says what that is.
                    rounds: clampRoundCount(editRoundCount),
                    startDate: editStartDate,
                    endDate: editEndDate,
                  });
                }}
                style={TournSaveStyle}
              >Save</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { key: "name", val: editTournamentName, set: setEditTournamentName, ph: TOURNAMENT_TITLE, lbl: "Name" },
                { key: "location", val: editTournamentLocation, set: setEditTournamentLocation, ph: TOURNAMENT_LOCATION, lbl: "Location" },
              ].map(f => (
                <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={TournLabelStyle}>{f.lbl}</span>
                  <input
                    value={f.val}
                    onChange={e => f.set(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
                    placeholder={f.ph}
                    style={TournFieldStyle}
                  />
                </div>
              ))}
              {/* First and last day of the trip. Two boxes on one row because
                  they are one fact — nobody sets an end date without a start. */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={TournLabelStyle}>Dates</span>
                <input
                  type="date"
                  value={editStartDate}
                  onChange={e => setEditStartDate(e.target.value)}
                  style={{ ...TournFieldStyle, fontSize: FS.small }}
                />
                <span style={{ fontSize: FS.label, color: BC.t3, flexShrink: 0 }}>to</span>
                <input
                  type="date"
                  value={editEndDate}
                  min={editStartDate || undefined}
                  onChange={e => setEditEndDate(e.target.value)}
                  style={{ ...TournFieldStyle, fontSize: FS.small }}
                />
              </div>
              {/* ── How long the tournament is ──────────────────────────
                  It used to be four everywhere it was asked, in four
                  different files. It belongs here: how many rounds a trip is
                  is something the director knows before anybody packs a bag,
                  not something the app should infer from what has been
                  entered so far.

                  The list it drives can only ever GROW past this number, never
                  shrink below a round somebody has played — see lib/rounds. */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={TournLabelStyle}>Rounds</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_ROUND_COUNT}
                  value={editRoundCount}
                  onChange={e => setEditRoundCount(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
                  style={{ ...TournFieldStyle, flex: "0 0 58px", width: 58 }}
                />
                <span style={{ fontSize: FS.label, color: BC.t3, lineHeight: 1.35, minWidth: 0 }}>
                  {heldRounds.length
                    ? `Round ${heldRounds.join(", ")} ${heldRounds.length === 1 ? "has" : "have"} been played, so the schedule keeps ${heldRounds.length === 1 ? "it" : "them"}.`
                    : "Sets the round pills on every tab."}
                </span>
              </div>
            </div>
          </div>

          {/* ── The house ──
              The one fact Trip Info stores of its own. Its dates come from the
              card above and its courses off each round, which is why there is
              nothing else to fill in here. Its own settings document rather
              than a couple more fields above, and deliberately: cloneEdition
              copies the tournament document, and last year's rental link on
              this year's Trip Info would send the field to the wrong house.

              The link is checked before it saves, not after: a director who
              pastes something that will not open should hear about it here,
              standing in front of the box, rather than from a player tapping a
              dead button in June. */}
          <div style={TournCardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <div style={TournHeadStyle}>The House</div>
              <button
                onClick={async () => {
                  const url = editHouseUrl.trim();
                  if (url && !safeHouseUrl(url)) {
                    notify?.("That link doesn't look like a web address", "error");
                    return;
                  }
                  const ok = await onSaveTrip({ houseName: editHouseName, houseUrl: url });
                  notify?.(ok ? "The house is saved" : "Could not save that — try again", ok ? "success" : "error");
                }}
                style={TournSaveStyle}
              >Save</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { key: "name", val: editHouseName, set: setEditHouseName, ph: "The lake house", lbl: "Name" },
                { key: "link", val: editHouseUrl, set: setEditHouseUrl, ph: "vrbo.com/1234567", lbl: "Link" },
              ].map(f => (
                <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={TournLabelStyle}>{f.lbl}</span>
                  <input
                    value={f.val}
                    onChange={e => f.set(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
                    placeholder={f.ph}
                    inputMode={f.key === "link" ? "url" : "text"}
                    autoCapitalize={f.key === "link" ? "none" : undefined}
                    autoCorrect={f.key === "link" ? "off" : undefined}
                    style={TournFieldStyle}
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
          <div style={TournCardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <div style={TournHeadStyle}>Access</div>
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
                style={TournSaveStyle}
              >Save</button>
            </div>

            {/* The current one. Fetched on demand — the read is a members-
                only round trip to Firestore, so there is no reason to make
                it on every visit to this tab. */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, minHeight: 28 }}>
              <span style={TournLabelStyle}>Current</span>
              {showAccessCode ? (
                <span style={{ flex: 1, minWidth: 0, fontSize: accessCodeError ? FS.label : FS.body, fontWeight: accessCodeError ? 600 : 800, lineHeight: 1.35, color: accessCodeError ? BC.danger : (savedAccessCode ? BC.amberInk : BC.t3), wordBreak: "break-all" }}>
                  {accessCodeError || savedAccessCode || "None"}
                </span>
              ) : (
                <button type="button" onClick={loadAccessCode} style={{
                  fontSize: FS.label, fontWeight: 700, padding: "5px 10px", borderRadius: 6, fontFamily: FONT,
                  border: `1px solid ${BC.bdr}`, background: "transparent", color: BC.t2, cursor: "pointer",
                }}>Show</button>
              )}
              {showAccessCode && (
                <button type="button" onClick={() => setShowAccessCode(false)} style={{
                  flexShrink: 0, fontSize: FS.label, fontWeight: 700, padding: "5px 10px", borderRadius: 6, fontFamily: FONT,
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
              style={{ ...TournFieldStyle, width: "100%", flex: "none" }}
            />
            {/* All that survives of a four-sentence explanation. The other
                three described what a password is; this one is the only thing
                the field cannot show — that emptying it is how you remove it,
                which nobody would try on a control called "New password". */}
            <div style={{ fontSize: FS.label, color: BC.t3, marginTop: 5, lineHeight: 1.4 }}>
              Save blank to remove.
            </div>
          </div>

          {/* Teams — name, imported logo, brand color */}
          <div style={{ ...TournHeadStyle, marginBottom: 6 }}>Teams</div>
          {[teams.A, teams.B].map(team => {
            const previewLogo = brandLogoEdit[team.id] || team.logo;
            const dirty = teamDirty(team.id);
            return (
              <div key={team.id} style={{ ...TournCardStyle, padding: "10px 10px" }}>
                {/* Name row — the card's header, with its Save on the right */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: brandSwatch(team.id) + "22", border: `1px solid ${brandSwatch(team.id)}${ALPHA.line}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" }}>
                    {previewLogo
                      ? <img src={previewLogo} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      : <span style={{ fontSize: FS.body, fontWeight: 800, color: brandSwatch(team.id) }}>{team.id}</span>}
                  </div>
                  <input
                    value={editTeamNames[team.id]}
                    onChange={e => setEditTeamNames(n => ({ ...n, [team.id]: e.target.value }))}
                    onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
                    placeholder={`Team ${team.id}`}
                    style={{ ...TournFieldStyle, border: `1px solid ${brandSwatch(team.id)}${ALPHA.line}`, fontWeight: 700, letterSpacing: 0.3 }}
                  />
                  <button
                    onClick={() => saveTeam(team.id)}
                    disabled={!dirty}
                    style={{
                      flexShrink: 0, fontSize: FS.label, fontWeight: 800, borderRadius: 6, padding: "6px 12px", whiteSpace: "nowrap", fontFamily: FONT,
                      color: dirty ? ON_AMBER : BC.t3,
                      background: dirty ? BC.amber : BC.inp,
                      border: dirty ? "none" : `1px solid ${BC.bdr}`,
                      cursor: dirty ? "pointer" : "default",
                    }}
                  >Save</button>
                </div>

                {/* Logo import + color row */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: brandSwatch(team.id), border: `2px solid ${BC.bdr}`, flexShrink: 0 }} />
                  <input
                    value={brandEdit[team.id]}
                    onChange={e => setBrandEdit(b => ({ ...b, [team.id]: e.target.value }))}
                    placeholder="#rrggbb"
                    style={{ ...TournFieldStyle, flex: "0 0 96px", width: 96, fontSize: FS.small, padding: "5px 8px" }}
                  />
                  <label style={{ marginLeft: "auto", fontSize: FS.label, fontWeight: 700, color: BC.t2, background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 6, padding: "6px 10px", cursor: "pointer", whiteSpace: "nowrap", fontFamily: FONT }}>
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
