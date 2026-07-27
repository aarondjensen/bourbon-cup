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
// Each team carries TWO shades: `accent` is the vivid one (text, rails,
// borders) and `color` is the deep fill behind it. Both — plus the glow,
// which is the accent at 20% — were brightened by theme.js's liftHex factor
// (RGB x 1.2). Pre-lift values were accent #009144 / color #004d24 for A and
// accent #3A96A0 / color #0d3235 for B. Lifting the literals here rather
// than at read time is required: components read `team.accent` straight off
// these objects, so a runtime-only lift would leave those uses behind.
export const TEAM_A = { id: "A", name: "Team Alpha", color: "#005c2b", accent: "#00ae52", glow: "rgba(0,174,82,0.2)", short: "α", logo: LOGO_TEAM_A };
export const TEAM_B = { id: "B", name: "Team Beta",  color: "#103c40", accent: "#46b4c0", glow: "rgba(70,180,192,0.2)", short: "β", logo: LOGO_TEAM_B };

export const getTeam = (tid) => tid === "A" ? TEAM_A : TEAM_B;
export const oppTeam = (tid) => tid === "A" ? TEAM_B : TEAM_A;

// ── Tournament identity ──
// The fixed name + location shown on the login screen. The YEAR is NOT here
// — it follows the active edition (see firebase.getTournamentYear) so the
// displayed year and the data you're looking at can never disagree.
// Both are FALLBACKS, not the source of truth: the live name and location
// are stored per edition in bc_settings/tournament and set by the director in
// Admin → Tournament. These are what the app shows before that doc exists —
// and what an empty field resolves back to — so a fresh edition still reads
// like the Bourbon Cup instead of a blank header.
export const TOURNAMENT_TITLE = "The Bourbon Cup";
export const TOURNAMENT_LOCATION = "Gaylord, MI";

// ── Points to win the cup ──
// Normally null: the leaderboard works the target out from the schedule —
// each round's format gives a match count against the roster, each round's
// Nassau split gives what a match is worth, and half of that total plus a
// half is what wins the cup. Rounds whose matches already exist are priced
// off those matches instead, so a hand-built draw is always counted as
// built rather than as predicted.
//
// Set a number here only to override that derivation — a cup with a rule
// the schedule can't express, or a year where the setup isn't fully
// entered and you want the real target showing anyway. Whatever is set
// here also decides the clinch, so the bar and the number stay in step.
export const CUP_POINTS_TO_WIN = null;

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
// `perSide` is how many players from each team make up one match. It exists
// so the leaderboard can work out how many matches a round WILL produce
// before the director has created them, which is what lets the cup target
// stand still through setup instead of climbing as matches get entered.
// `null` means the whole side plays as a single match. Only used for that
// projection — once a round's matches exist, they're counted directly.
//
// `allowance` is the third setting on every round, alongside format and point
// allocation — see the handicap-allowance block below for what the shapes mean.
//
// `counting` marks a format whose team score on a hole is the sum of the side's
// best N nets rather than a fixed shape — see the counting-scores block below.
// Only Team Best Ball has it, and its presence is what puts the F9/B9 count
// fields on the round form.
//
// Format defaults are baseline only — the director can override any value
// in the round setup form.
export const FORMATS = [
  { id: "singles",        label: "Singles",            desc: "Match play, 1v1 net comparison per hole.",                                              nassau: { front: 1, back: 1, overall: 1 }, perSide: 1, allowance: { pct: 100 } },
  { id: "best_ball",      label: "2-Man Best Ball",    desc: "Each player plays their own ball; team uses the better net score per hole.",            nassau: { front: 1, back: 1, overall: 2 }, perSide: 2, allowance: { pct: 90 } },
  { id: "team_total",     label: "Team Total",         desc: "Combined team net per hole vs combined team net. Lower combined wins the hole.",        nassau: { front: 1, back: 1, overall: 2 }, perSide: 2, allowance: { pct: 90 } },
  { id: "pinehurst",      label: "Pinehurst",          desc: "Partners each drive, swap balls, then choose best to finish as scramble.",              nassau: { front: 1, back: 1, overall: 2 }, perSide: 2, allowance: { low: 60, high: 40 } },
  { id: "team_best_ball", label: "Team Best Ball",     desc: "Whole side plays; each hole is the sum of the best N net scores, set per nine.",        nassau: { front: 1, back: 1, overall: 2 }, perSide: null, allowance: { pct: 75 }, counting: { front: 6, back: 7 } },
  { id: "double_dot",     label: "Double Dot",         desc: "2-man Hi/Lo. Each hole: a dot for the low ball, a dot for the high ball. Ties win nothing.", nassau: { front: 1, back: 1, overall: 2 }, perSide: 2, allowance: { pct: 90 } },
  { id: "shamble",        label: "Shamble",            desc: "All players drive, choose best drive, each plays their own ball in.",                   nassau: { front: 1, back: 1, overall: 2 }, perSide: 2, allowance: { pct: 90 } },
  { id: "scramble",       label: "2-Man Scramble",     desc: "Both hit every shot, choose best ball location, both play from there.",                 nassau: { front: 1, back: 1, overall: 2 }, perSide: 2, allowance: { low: 35, high: 15 }, sharedBall: true },
  { id: "tilt",           label: "2-Man Tilt",         desc: "2-man match play — net comparison per hole.",                                           nassau: { front: 1, back: 1, overall: 2 }, perSide: 2, allowance: { pct: 90 } },
  { id: "stableford",     label: "2-Man Stableford",   desc: "Points per hole: eagle=4, birdie=3, par=2, bogey=1. Higher segment points wins.",       nassau: { front: 1, back: 1, overall: 2 }, perSide: 2, allowance: { pct: 85 } },
];

// ── Handicap allowances ──
// The format decides how many balls a side plays. The ALLOWANCE decides how
// much of each player's Course Handicap actually comes to the tee, and it is
// a separate knob: a Four-Ball at 90% and the same Four-Ball at 100% are the
// same format scored two different ways, and the gap between them is whole
// matches. Two-man Scramble is the extreme case — a side playing one ball off
// both partners' full handicaps is unbeatable, which is why the recommended
// team allowance is 35% of the low man plus 15% of the high man.
//
// Two shapes cover everything golf actually uses:
//
//   { pct }        — every player plays off the same percentage of their CH.
//   { low, high }  — the LOW handicap on each side plays off `low`, their
//                    partner off `high`. This is the shape for the formats
//                    where a side effectively plays one ball.
//
// `sharedBall: true` marks a format where the side really does play a single
// ball, so the two allowance-adjusted handicaps SUM into one team handicap
// instead of each player carrying their own stroke map (see scoring.js).
//
// ── Off by default ──
// An allowance applies only when the director turns it ON for the round
// (`enabled: true` on the round doc). Off means 100% — everyone plays their
// whole Course Handicap, which is what the app did before allowances existed.
// Nothing is inferred from the format alone: the numbers above are what the
// prompt PREFILLS when the toggle is flipped, not what a round quietly scores
// with because nobody looked at it. Once a round locks, whatever was in force
// freezes with everything else that feeds stroke allocation.
//
// The prefills are the USGA's recommended allowances (Rules of Handicapping,
// Appendix C).
export const ALLOWANCE_DEFAULT = { pct: 100 };

// What the ON position prefills for a format — never what an untouched round
// scores with. See resolveAllowance for that.
export const allowanceDefaultFor = (formatId) =>
  FORMATS.find(f => f.id === formatId)?.allowance || ALLOWANCE_DEFAULT;

// A split allowance is one that treats the low and high handicap on a side
// differently. Asked of a spec (default or saved), never of a format id, so
// the same test works on both.
export const isSplitAllowance = (spec) => !!spec && spec.low != null;

// Does a side play one ball between them? Drives both the team-handicap math
// in the engine and the wording of the admin prompt.
export const formatIsSharedBall = (formatId) =>
  !!FORMATS.find(f => f.id === formatId)?.sharedBall;

// A round's allowance, fully resolved for scoring.
//
// `enabled` must be explicitly true — an absent or half-written value is OFF,
// which resolves to a flat 100%. That is deliberate: the one thing an
// allowance must never do is quietly take strokes off a round nobody
// configured.
//
// When it IS on, the shape follows the FORMAT rather than what happens to be
// stored, so a round switched from Scramble to Singles drops the stale
// low/high pair instead of trying to honour it, and a field left blank falls
// back to that format's prefill.
export const resolveAllowance = (formatId, saved) => {
  const shared = formatIsSharedBall(formatId);
  if (!saved?.enabled) return { enabled: false, split: false, shared, pct: 100 };

  const def = allowanceDefaultFor(formatId);
  const num = (v, fallback) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  if (isSplitAllowance(def)) {
    return { enabled: true, split: true, shared, low: num(saved.low, def.low), high: num(saved.high, def.high) };
  }
  return { enabled: true, split: false, shared, pct: num(saved.pct, def.pct) };
};

// Short human string — "90%" or "35% / 15%". Used anywhere a round's handicap
// terms are summarised. An off allowance has no terms to state, hence "none".
export const describeAllowance = (spec) => {
  if (spec && spec.enabled === false) return "none";
  return spec?.split || spec?.low != null ? `${spec.low}% / ${spec.high}%` : `${spec?.pct ?? 100}%`;
};

// ── Counting scores (Team Best Ball) ──
// Every other format in this app has a shape fixed by its name: a Four-Ball
// takes the better of two, a Team Total adds both. Team Best Ball doesn't —
// it is this event's own format, and the thing that defines it is a NUMBER
// the director sets: how many of the side's net scores count on a hole.
//
// Eight players a side, and on each hole the best N of those eight nets are
// added up; that sum is the side's score for the hole and the two sums are
// compared like any other.
//
// N IS PER HOLE, not per nine. The tournament has moved this number around for
// years — the front has run 5 and 6, the back 6 and 7 — and the old scoring
// sheets did not hold one figure across a nine either: they walked it up
// inside the nine (4,4,4,4,4,4,5,5,5 on the front; 5,5,5,6,6,6,6,6,6 on the
// back), so more of the side has to show up as the nine goes on. A per-nine
// pair could not express that, so the stored shape is one count per hole:
//
//   { holes: [n, n, … ] }   — 18 whole numbers, at least 1 each.
//
// The round form still leads with a per-nine box, because "the front counts 6"
// is how a director thinks and setting nine holes at once is one keystroke;
// the per-hole grid underneath is there for the years that ramp.
//
// Unlike the allowance there is no off switch: a Team Best Ball round is
// always counting SOME number of scores, so the only question is which.
//
// A count larger than the side actually fields is clamped at scoring time to
// the smaller of the two rosters (see scoring.js) — eight-man counts on a
// six-man side would otherwise stop the hole from ever scoring, and counting
// a different number for each side would make the two sums incomparable.
export const COUNTING_DEFAULT = { front: 6, back: 7 };

// Does this format score by counting the best N of a side's nets? Asked of a
// format id; drives both the engine branch and whether the round form shows
// the count fields at all.
export const formatCountsScores = (formatId) => !!FORMATS.find(f => f.id === formatId)?.counting;

// What the count fields PREFILL for a format ({front, back}), or null when the
// format doesn't count scores at all.
export const countingDefaultFor = (formatId) =>
  FORMATS.find(f => f.id === formatId)?.counting || null;

// A round's counting scores as 18 per-hole numbers — or null when the format
// doesn't count, which is how every caller asks "does this apply?".
//
// Reads three shapes so no round has to be migrated: the per-hole array, the
// per-nine {front, back} pair the field was first stored as, and nothing at
// all (the format's prefill). A blank or nonsense entry falls back rather than
// counting zero scores, since a hole counting nothing has no score.
export const resolveCounting = (formatId, saved) => {
  const def = countingDefaultFor(formatId);
  if (!def) return null;
  const num = (v, fallback) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 1 ? n : fallback;
  };
  const nine = (h) => num(h < 9 ? saved?.front : saved?.back, h < 9 ? def.front : def.back);
  const holes = Array.isArray(saved?.holes) ? saved.holes : null;
  return Array.from({ length: 18 }, (_, h) => num(holes?.[h], nine(h)));
};

// The one count a nine is played off, or null when it isn't uniform. Lets the
// per-nine box show a real value on the ordinary case and stand back on the
// ramped one.
export const countingNine = (counts, back = false) => {
  if (!counts) return null;
  const slice = back ? counts.slice(9, 18) : counts.slice(0, 9);
  return slice.every(n => n === slice[0]) ? slice[0] : null;
};

// What a nine reads as: "6" when it's flat, "5–6" when it ramps.
const nineText = (counts, back) => {
  const flat = countingNine(counts, back);
  if (flat != null) return String(flat);
  const slice = back ? counts.slice(9, 18) : counts.slice(0, 9);
  return `${Math.min(...slice)}–${Math.max(...slice)}`;
};

// Short human string — "best 6 / 7", or "best 6" when both nines match.
// Used anywhere a round's format needs stating in full.
export const describeCounting = (counts) => {
  if (!counts) return "";
  const f = nineText(counts, false), b = nineText(counts, true);
  return f === b ? `best ${f}` : `best ${f} / ${b}`;
};

// ── Per-hole points ──
// A third way to settle a round, alongside Match and Total. Every HOLE is its
// own pot: win it and you bank its value, halve it and the two sides split it.
// Nothing waits for a segment to close, because there is no segment — 18 holes
// are 18 settlements.
//
// This is how the Bourbon Cup's final round has always actually worked, and no
// amount of Nassau expresses it: the front nine's holes are worth 1 point each
// and the back nine's are worth 2, so the closing nine is worth double and a
// side four down at the turn is still very much alive. A round at these
// defaults is worth 27 points — 9 + 18.
//
//   { front, back }   — what one hole is worth on each nine. Halves and
//                       decimals are allowed; a hole worth 0 is simply not
//                       being played for points.
export const HOLE_POINTS_DEFAULT = { front: 1, back: 2 };

export const SCORING_TYPE_MATCH = "match";
export const SCORING_TYPE_TOTAL = "stroke";     // stored value predates the "Total" label
export const SCORING_TYPE_POINTS = "points";

export const isPointsPerHole = (scoringType) => scoringType === SCORING_TYPE_POINTS;

// A round's hole values, resolved for scoring. Zero is a legitimate answer
// here (unlike a counting score), so only a missing or unreadable field falls
// back to the default.
export const resolveHolePoints = (saved) => {
  const num = (v, fallback) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    front: num(saved?.front, HOLE_POINTS_DEFAULT.front),
    back: num(saved?.back, HOLE_POINTS_DEFAULT.back),
  };
};

// What the whole round is worth: every hole's value added up.
export const holePointsTotal = (spec) => {
  const hp = resolveHolePoints(spec);
  return hp.front * 9 + hp.back * 9;
};

// Short human string — "1 / 2 per hole", or "1 per hole" when the nines agree.
export const describeHolePoints = (spec) => {
  const hp = resolveHolePoints(spec);
  return hp.front === hp.back ? `${hp.front} per hole` : `${hp.front} / ${hp.back} per hole`;
};

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
export const DIRECTOR_CODE = "bcdir";
