// ── App-wide constants ──
// Paths, team definitions, format catalog, and practice-event color palette.
// Kept separate from theme.js (which holds light/dark color tokens) because
// these values are tournament-identity, not visual chrome — they don't
// change between light and dark modes.

// ── Image paths ──
// All assets live in /public so the leading slash resolves at the site root.
// LOGO_TEAM_A has two variants because the white-bg version reads better
// when the login screen is in light mode (the "_on_white" version).
export const TROPHY_PHOTO       = "/trophy_photo.png";
export const LOGO_TEAM_A        = "/mash_brothers_logo_on_black.png";
export const LOGO_TEAM_A_WHITE  = "/mash_brothers_logo_on_white.png";
export const LOGO_TEAM_B        = "/shot_callers_logo.png";
export const TROPHY_SILHOUETTE  = "/trophy_logo_silhouette.png";

// ── Teams ──
// Mutated in place by App when team-name overrides come down from Firestore
// (the saved team_names doc). Object-property mutation (not reassignment)
// is required because ES module exports are read-only bindings — readers
// see the new `name` because the object reference is shared.
//
// Same pattern as `BC` in theme.js: the import gives you a stable handle
// to a mutable object; React re-renders propagate the visual change.
export const TEAM_A = { id: "A", name: "Team Alpha", color: "#004d24", accent: "#009144", glow: "rgba(0,145,68,0.2)", short: "α", logo: LOGO_TEAM_A };
export const TEAM_B = { id: "B", name: "Team Beta",  color: "#0d3235", accent: "#3A96A0", glow: "rgba(58,150,160,0.2)", short: "β", logo: LOGO_TEAM_B };

export const getTeam = (tid) => tid === "A" ? TEAM_A : TEAM_B;
export const oppTeam = (tid) => tid === "A" ? TEAM_B : TEAM_A;

// ── Tournament identity ──
// The fixed name + location shown on the login screen. The YEAR is NOT here
// — it follows the active edition (see firebase.getTournamentYear) so the
// displayed year and the data you're looking at can never disagree.
export const TOURNAMENT_TITLE = "The Bourbon Cup";
export const TOURNAMENT_LOCATION = "Gaylord, MI";

// Default team-name map, derived from the TEAM_A/TEAM_B definitions above so
// the fallback names live in exactly one place. Seed App's teamNames state
// with this instead of re-typing the literal strings.
export const DEFAULT_TEAM_NAMES = { A: TEAM_A.name, B: TEAM_B.name };

// Single source of truth for a "resolved" team object: the fixed visual
// identity (id, colors, glow, short, logo) from TEAM_A/TEAM_B, with the live
// display name layered on top from the saved team_names doc. Every view that
// needs {team + current name} should read from here (via App's `teams` memo)
// rather than re-merging `{ ...TEAM_A, name: teamNames?.A || TEAM_A.name }`
// inline — that merge used to be copy-pasted across five components.
export const resolveTeams = (teamNames) => ({
  A: { ...TEAM_A, name: teamNames?.A || TEAM_A.name },
  B: { ...TEAM_B, name: teamNames?.B || TEAM_B.name },
});

// ── Match-play format catalog ──
// Format dictates how holes are compared (singles = 1v1 net, best ball =
// better-of-two net, team total = sum of nets, etc.). Point allocation is
// a SEPARATE concern — every format can be scored either as Nassau (front,
// back, overall as independent point pots) or Traditional (single pot for
// the overall match result, W/L/T only). The director picks both at round
// setup.
//
// `nassau` is the default point allocation for {front, back, overall} when
// the round is configured as Nassau. The Traditional default is computed as
// the sum of those three (singles → 3, all others → 4) so a director who
// flips a Nassau round to Traditional gets the same total points at stake.
//
// Format defaults are baseline only — the director can override any value
// in the round setup form.
export const FORMATS = [
  { id: "singles",        label: "Singles",            desc: "Match play, 1v1 net comparison per hole.",                                              nassau: { front: 1, back: 1, overall: 1 } },
  { id: "best_ball",      label: "2-Man Best Ball",    desc: "Each player plays their own ball; team uses the better net score per hole.",            nassau: { front: 1, back: 1, overall: 2 } },
  { id: "team_total",     label: "Team Total",         desc: "Combined team net per hole vs combined team net. Lower combined wins the hole.",        nassau: { front: 1, back: 1, overall: 2 } },
  { id: "pinehurst",      label: "Pinehurst",          desc: "Partners each drive, swap balls, then choose best to finish as scramble.",              nassau: { front: 1, back: 1, overall: 2 } },
  { id: "team_best_ball", label: "Team Best Ball",     desc: "Full team format — best of all team-member nets per hole.",                             nassau: { front: 1, back: 1, overall: 2 } },
  { id: "double_dot",     label: "Double Dot",         desc: "Match play with an automatic bonus point for winning the last 3 holes.",                nassau: { front: 1, back: 1, overall: 2 } },
  { id: "shamble",        label: "Shamble",            desc: "All players drive, choose best drive, each plays their own ball in.",                   nassau: { front: 1, back: 1, overall: 2 } },
  { id: "scramble",       label: "2-Man Scramble",     desc: "Both hit every shot, choose best ball location, both play from there.",                 nassau: { front: 1, back: 1, overall: 2 } },
  { id: "tilt",           label: "2-Man Tilt",         desc: "2-man match play — net comparison per hole.",                                           nassau: { front: 1, back: 1, overall: 2 } },
  { id: "stableford",     label: "2-Man Stableford",   desc: "Points per hole: eagle=4, birdie=3, par=2, bogey=1. Higher segment points wins.",       nassau: { front: 1, back: 1, overall: 2 } },
];

// ── Point-allocation methods ──
// Two ways to convert hole-by-hole results into match points:
//   - "nassau"      → independent points awarded for front-9, back-9, and
//                     overall match results (default; matches existing data).
//   - "traditional" → single pot awarded for the overall match result only;
//                     halved match splits the pot ½ / ½.
// Stored on both bc_rounds (round-level default) and bc_matches (per-match
// override; falls back to round when absent).
// Default match-play format id — used when a round hasn't had one set yet.
// One constant instead of the `?.format || "singles"` literal scattered
// across the app.
export const DEFAULT_FORMAT = "singles";

export const POINT_METHOD_NASSAU = "nassau";
export const POINT_METHOD_TRADITIONAL = "traditional";
export const POINT_METHODS = [
  { id: POINT_METHOD_NASSAU,      label: "Nassau" },
  { id: POINT_METHOD_TRADITIONAL, label: "Traditional" },
];

export const NASSAU_DEFAULT = { front: 1, back: 1, overall: 1 };

// Default Traditional point value for a given format = sum of its Nassau
// defaults (singles → 3, everything else → 4). Keeps the total points at
// stake constant when a director flips between methods on the same format.
export const traditionalDefaultFor = (formatId) => {
  const fmt = FORMATS.find(f => f.id === formatId);
  if (!fmt) return 1;
  const n = fmt.nassau || NASSAU_DEFAULT;
  return (n.front || 0) + (n.back || 0) + (n.overall || 0);
};

// ── Practice event colors ──
// 4 shades of green for the practice mode teams. All within the Mash Brothers
// identity. Avoiding teal (cyan-leaning greens) — every accent here reads as
// a true green. Differentiated by hue lean (yellow/pure/cool) AND by
// lightness so the four teams are easy to tell apart at a glance even
// when shown next to each other in a list.
//
// Team 1 = the actual Mash Brothers brand color, deliberately. Anchors the
// palette and keeps the tournament identity present even in practice events.
export const PRACTICE_TEAM_COLORS = [
  { color: "#004d24", accent: "#009144", glow: "rgba(0,145,68,0.2)" },     // brand green (Mash Brothers)
  { color: "#3a5b08", accent: "#65a30d", glow: "rgba(101,163,13,0.2)" },   // lime / chartreuse (yellow-green)
  { color: "#054a35", accent: "#15803d", glow: "rgba(21,128,61,0.2)" },    // forest (deep, darker than brand)
  { color: "#3f4a2a", accent: "#7a9d4e", glow: "rgba(122,157,78,0.2)" },   // sage (muted, lighter, dustier)
];

// ── Director auth ──
// Shared secret entered on the login screen to unlock director-only views
// (Admin, Practice setup). Not real auth; the app is private-link-shared
// among 16 players + the director, and Firebase rules can layer on top
// later if needed.
export const DIRECTOR_CODE = "bcdir2025";
