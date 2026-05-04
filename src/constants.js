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

// ── Match-play format catalog ──
// `nassau` is the default point allocation for {front, back, overall}.
// `scoringType` flags non-Nassau formats:
//   - "tilt"   → fixed 4-point match, no Nassau decomposition
//   - "custom" → director-defined points (Team Best Ball)
//   - "nassau" → standard front/back/overall split
export const FORMATS = [
  { id: "singles",        label: "Singles",            desc: "Match play, 1v1. Nassau scored: front 9, back 9, overall.", nassau: { front: 1, back: 1, overall: 1 }, scoringType: "nassau" },
  { id: "best_ball",      label: "2-Man Best Ball",    desc: "Each player plays their own ball, team uses the better net score per hole. Nassau scored.", nassau: { front: 1, back: 1, overall: 2 }, scoringType: "nassau" },
  { id: "team_total",     label: "Team Total",         desc: "Combined team net per hole vs combined team net. Lower combined wins the hole. Nassau scored.", nassau: { front: 1, back: 1, overall: 2 }, scoringType: "nassau" },
  { id: "pinehurst",      label: "Pinehurst",          desc: "Partners each drive, swap balls, then choose best to finish as scramble. Nassau scored.", nassau: { front: 1, back: 1, overall: 2 }, scoringType: "nassau" },
  { id: "team_best_ball", label: "Team Best Ball",     desc: "Full team format — custom scoring applies. See director for point structure.", nassau: { front: 0, back: 0, overall: 0 }, scoringType: "custom" },
  { id: "double_dot",     label: "Double Dot",         desc: "Nassau with automatic press on the back 9 and last 3 holes.", nassau: { front: 1, back: 1, overall: 2 }, scoringType: "nassau" },
  { id: "shamble",        label: "Shamble",            desc: "All players drive, choose best drive, each plays their own ball in. Nassau scored.", nassau: { front: 1, back: 1, overall: 2 }, scoringType: "nassau" },
  { id: "scramble",       label: "2-Man Scramble",     desc: "Both hit every shot, choose best ball location, both play from there. Nassau scored.", nassau: { front: 1, back: 1, overall: 2 }, scoringType: "nassau" },
  { id: "tilt",           label: "2-Man Tilt",         desc: "4-point match: 1pt per side, 2pt overall. No individual Nassau components.", nassau: { front: 0, back: 0, overall: 4 }, scoringType: "tilt" },
  { id: "stableford",     label: "2-Man Stableford",   desc: "Points per hole: eagle=4, birdie=3, par=2, bogey=1. Nassau scored.", nassau: { front: 1, back: 1, overall: 2 }, scoringType: "nassau" },
];

export const NASSAU_DEFAULT = { front: 1, back: 1, overall: 1 };

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
