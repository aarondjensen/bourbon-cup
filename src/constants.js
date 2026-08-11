// ── App-wide constants ──
// Paths, team definitions, and the format catalog.
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
// Admin → Event. These are what the app shows before that doc exists —
// and what an empty field resolves back to — so a fresh edition still reads
// like the Bourbon Cup instead of a blank header.
export const TOURNAMENT_TITLE = "The Bourbon Cup";
export const TOURNAMENT_LOCATION = "Gaylord, MI";

// The tournament's own photo site — every year that was photographed before
// the app had a gallery of its own. The Photos tab links out to it rather than
// trying to be it; see src/components/PhotosView.jsx.
export const PHOTO_LIBRARY_URL = "https://thebourboncup.com/photos";

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
// ── Whose badge is that? ──────────────────────────────────────────
// The two logos above are Mash Brothers' and Shot Callers'. They are the
// DEFAULT because they are this cup's current teams, not because they belong
// to whichever side happens to be called A — and an edition with different
// teams must not wear them. 2023 was TEES against WEEZ, and it opened showing
// the Mash Brothers flag.
//
// So a team keeps the default logo only while it is still that team, by name.
// Anything else gets `logo: null`, and the screens that show one fall back to
// the team's name, which is the thing that is actually known. A logo of its
// own always wins: the branding doc is layered over this in App's `teams`
// memo, so an edition that uploaded one is unaffected.
const defaultLogoFor = (team, name) => (name === team.name ? team.logo : null);

export const resolveTeams = (teamNames) => {
  const nameA = teamNames?.A || TEAM_A.name;
  const nameB = teamNames?.B || TEAM_B.name;
  return {
    A: { ...TEAM_A, name: nameA, logo: defaultLogoFor(TEAM_A, nameA) },
    B: { ...TEAM_B, name: nameB, logo: defaultLogoFor(TEAM_B, nameB) },
  };
};

// ── The vocabulary a format is described in ─────────────────────────
// These sit above FORMATS because every entry in the catalog is written in
// their terms. They used to live beside the scoring-axis notes further down,
// which put them in the temporal dead zone for the catalog itself.

// FORM OF PLAY — how hole numbers turn into points.
export const SCORING_TYPE_MATCH = "match";
export const SCORING_TYPE_TOTAL = "stroke";     // stored value predates the label
export const SCORING_TYPE_POINTS = "points";    // every hole its own pot

// HOLE SCORING — how a side's number for a hole is made. `format` is the
// legacy "whatever this format's own rule is"; the other two name a concrete
// method that a format may offer as a genuine choice between them.
export const HOLE_SCORING_FORMAT = "format";
export const HOLE_SCORING_BEST_BALL = "best_ball";
export const HOLE_SCORING_TEAM_TOTAL = "team_total";

// What a format's per-hole number actually COUNTS. Decides which direction a
// comparison runs and what every screen calls the running total. Strokes count
// down; dots and points count up.
export const UNIT_STROKES = "strokes";
export const UNIT_DOTS = "dots";
export const UNIT_POINTS = "points";

// Whether the field plays the difference off the lowest handicap in the match
// or each plays their own whole figure.
export const HANDICAP_MODE_LOW_MAN = "low_man";
export const HANDICAP_MODE_FULL = "full";

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
// `hole` is one line saying how a side's number for a hole is ACTUALLY made —
// what the engine does, not what the rules of the game are called (`desc` is
// that). The round form prints it so the director can read the rule instead of
// being asked to guess at it.
//
// `holeOptions` is the exception: the formats where that is genuinely still
// open, listed as the concrete methods on offer, FIRST ONE BEING THE DEFAULT.
// Two formats have it, and they offer the same pair in opposite orders — a
// Shamble is normally the better ball and a Team Total is normally the sum,
// but either can be played the other way.
//
// `forms` is which of Match / Total / Points the format offers and
// `formDefault` is where it opens. Points-per-hole is Team Best Ball's alone —
// it is how this event's closing round has always worked and it makes no sense
// anywhere else.
//
// `unit` is what the per-hole number counts, which decides both the direction
// of every comparison and what the screens call a running total ("Stroke" when
// it is strokes, "Total" when it is dots or points).
//
// `handicapMode` is where the Low Man / All toggle opens. The toggle is always
// OFFERED — even on the against-par formats where the engine ignores it — but
// those open on All, because a low-man difference means nothing when you are
// playing the course rather than the other side.
//
// `allowanceOn` marks the one format whose allowance the form seeds ON: a
// scramble side playing one ball off two full handicaps is unbeatable, so
// 35/15 is the round, not an adjustment to it.
//
// Format defaults are baseline only — the director can override any value
// in the round setup form.
export const FORMATS = [
  {
    id: "singles", label: "Singles",
    desc: "Match play, 1v1 net comparison per hole.",
    hole: "One ball a side — the player's own net score.",
    unit: UNIT_STROKES, perSide: 1,
    forms: [SCORING_TYPE_MATCH, SCORING_TYPE_TOTAL], formDefault: SCORING_TYPE_MATCH,
    nassau: { front: 1, back: 1, overall: 1 },
    allowance: { pct: 100 }, handicapMode: HANDICAP_MODE_LOW_MAN,
  },
  {
    id: "best_ball", label: "2-Man Best Ball",
    desc: "Each player plays their own ball; team uses the better net score per hole.",
    hole: "The better of the side's two net balls.",
    unit: UNIT_STROKES, perSide: 2,
    forms: [SCORING_TYPE_MATCH, SCORING_TYPE_TOTAL], formDefault: SCORING_TYPE_MATCH,
    nassau: { front: 1, back: 1, overall: 2 },
    allowance: { pct: 90 }, handicapMode: HANDICAP_MODE_LOW_MAN,
  },
  {
    id: "team_total", label: "Team Total",
    // Also known as 2-Man Aggregate, which is the name the engine's legacy
    // `"aggregate"` format id came from.
    desc: "Also called 2-Man Aggregate. Combined team net per hole vs combined team net. Lower combined wins the hole.",
    hole: "Both partners' nets added together.",
    holeOptions: [HOLE_SCORING_TEAM_TOTAL, HOLE_SCORING_BEST_BALL],
    unit: UNIT_STROKES, perSide: 2,
    forms: [SCORING_TYPE_MATCH, SCORING_TYPE_TOTAL], formDefault: SCORING_TYPE_MATCH,
    nassau: { front: 1, back: 1, overall: 2 },
    allowance: { pct: 90 }, handicapMode: HANDICAP_MODE_LOW_MAN,
  },
  {
    id: "pinehurst", label: "Pinehurst",
    desc: "Partners each drive, swap balls, then choose best to finish as scramble.",
    hole: "The side's one ball, net off the team handicap.",
    unit: UNIT_STROKES, perSide: 2, sharedBall: true,
    forms: [SCORING_TYPE_MATCH, SCORING_TYPE_TOTAL], formDefault: SCORING_TYPE_MATCH,
    nassau: { front: 1, back: 1, overall: 2 },
    allowance: { low: 60, high: 40 }, handicapMode: HANDICAP_MODE_LOW_MAN,
  },
  {
    id: "team_best_ball", label: "Team Best Ball",
    desc: "Whole side plays; each hole is the sum of the best N net scores, set per nine.",
    hole: "The sum of the side's best N nets.",
    unit: UNIT_STROKES, perSide: null, counting: { front: 6, back: 7 },
    forms: [SCORING_TYPE_MATCH, SCORING_TYPE_TOTAL, SCORING_TYPE_POINTS], formDefault: SCORING_TYPE_POINTS,
    nassau: { front: 1, back: 1, overall: 2 },
    allowance: { pct: 75 }, handicapMode: HANDICAP_MODE_FULL,
  },
  {
    id: "double_dot", label: "Double Dot",
    desc: "2-man Hi/Lo. Each hole: a dot for the low ball, a dot for the high ball. Ties win nothing.",
    hole: "Two dots a hole — one for the low ball, one for the high. A tied ball wins nothing.",
    unit: UNIT_DOTS, perSide: 2,
    forms: [SCORING_TYPE_MATCH, SCORING_TYPE_TOTAL], formDefault: SCORING_TYPE_MATCH,
    nassau: { front: 1, back: 1, overall: 2 },
    allowance: { pct: 90 }, handicapMode: HANDICAP_MODE_LOW_MAN,
  },
  {
    id: "shamble", label: "Shamble",
    desc: "All players drive, choose best drive, each plays their own ball in.",
    hole: "The better of the side's two net balls.",
    holeOptions: [HOLE_SCORING_BEST_BALL, HOLE_SCORING_TEAM_TOTAL],
    unit: UNIT_STROKES, perSide: 2,
    forms: [SCORING_TYPE_MATCH, SCORING_TYPE_TOTAL], formDefault: SCORING_TYPE_MATCH,
    nassau: { front: 1, back: 1, overall: 2 },
    allowance: { pct: 90 }, handicapMode: HANDICAP_MODE_LOW_MAN,
  },
  {
    id: "scramble", label: "2-Man Scramble",
    desc: "Both hit every shot, choose best ball location, both play from there.",
    hole: "The side's one ball, net off the team handicap.",
    unit: UNIT_STROKES, perSide: 2, sharedBall: true,
    forms: [SCORING_TYPE_MATCH, SCORING_TYPE_TOTAL], formDefault: SCORING_TYPE_TOTAL,
    nassau: { front: 1, back: 1, overall: 2 },
    allowance: { low: 35, high: 15 }, allowanceOn: true, handicapMode: HANDICAP_MODE_LOW_MAN,
  },
  {
    id: "tilt", label: "2-Man Tilt",
    desc: "Net points against par, doubled and redoubled while you keep making birdies.",
    hole: "Both partners' Tilt points added together.",
    unit: UNIT_POINTS, perSide: 2,
    forms: [SCORING_TYPE_MATCH, SCORING_TYPE_TOTAL], formDefault: SCORING_TYPE_TOTAL,
    nassau: { front: 1, back: 1, overall: 2 },
    allowance: { pct: 90 }, handicapMode: HANDICAP_MODE_FULL,
  },
  {
    id: "stableford", label: "2-Man Stableford",
    desc: "Net points against par. Higher segment points wins.",
    hole: "Both partners' Stableford points added together.",
    unit: UNIT_POINTS, perSide: 2,
    forms: [SCORING_TYPE_MATCH, SCORING_TYPE_TOTAL], formDefault: SCORING_TYPE_TOTAL,
    nassau: { front: 1, back: 1, overall: 2 },
    allowance: { pct: 85 }, handicapMode: HANDICAP_MODE_FULL,
  },
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

// ── The two axes of a round's scoring ──
// A round answers two independent questions, and for a while they shared one
// field — which is how selecting "Team" on a Team Best Ball round silently
// threw its counting scores away and scored each hole off one player.
//
//   HOLE SCORING — how a side's number for a hole is arrived at. Normally the
//                  format decides (a Four-Ball takes the better ball, a Team
//                  Total adds both). `best_ball` overrides that: whatever the
//                  format, a side's hole score is its best net ball.
//   FORM OF PLAY — how those hole numbers turn into points. Match on holes
//                  won, Medal on the running total, Points per hole.
//
// They are genuinely independent: best-ball holes settled on medal totals is a
// coherent round, and so is a Double Dot settled per hole. One field could not
// express either.

// ── Form of play (how points are awarded) ──
// The catalog. Which of these a round may actually pick is the FORMAT's call
// (`forms`), and Points is Team Best Ball's alone.
//
// The TOTAL label is deliberately absent here: it depends on what the format
// counts, so it is asked of formOfPlayLabel() rather than baked in. "Medal" is
// retired — it named the axis in nobody's vocabulary but golf's oldest.
export const FORMS_OF_PLAY = [SCORING_TYPE_MATCH, SCORING_TYPE_TOTAL, SCORING_TYPE_POINTS];

// What a format counts per hole, and therefore what a running total of it is
// called. Strokes count down and are a "Stroke" total; dots and points count
// up and are just a "Total".
export const formatUnit = (formatId) =>
  FORMATS.find(f => f.id === formatId)?.unit || UNIT_STROKES;

export const formOfPlayLabel = (id, formatId) => {
  if (id === SCORING_TYPE_MATCH) return "Match";
  if (id === SCORING_TYPE_POINTS) return "Points";
  return formatUnit(formatId) === UNIT_STROKES ? "Stroke" : "Total";
};

export const describeFormOfPlay = (id, formatId) => {
  if (id === SCORING_TYPE_MATCH) return "Each hole is won, lost or tied; the side that wins more holes takes each pot.";
  if (id === SCORING_TYPE_POINTS) return "Every hole is its own pot. Winner takes it, a halved hole splits it.";
  return `Each side accrues ${formatUnit(formatId)} through the match, compared when it ends — or at each Nassau segment.`;
};

// Which forms a format offers, and where it opens.
export const formsFor = (formatId) =>
  FORMATS.find(f => f.id === formatId)?.forms || [SCORING_TYPE_MATCH, SCORING_TYPE_TOTAL];

export const formDefaultFor = (formatId) =>
  FORMATS.find(f => f.id === formatId)?.formDefault || SCORING_TYPE_MATCH;

// A round's form of play, constrained to what its format actually offers — a
// round switched off Team Best Ball must not stay on Points, which only that
// format can score.
export const resolveFormOfPlay = (formatId, stored) =>
  formsFor(formatId).includes(stored) ? stored : formDefaultFor(formatId);

// ── Hole scoring (how a side's hole number is made) ──
// What the round form has to ASK about a hole, given the format. The best-ball
// override used to be offered on all nine non-counting formats, which is how a
// Double Dot round came to be asked whether it was a Best Ball round — a
// question its own name had already answered, and one whose "yes" throws the
// Hi/Lo dots away and re-scores the round in net strokes.
//
// Three answers, and the format picks its own:
//
//   COUNTING — Team Best Ball. Best ball is a given; the open question is how
//              many balls count, which the F9/B9 grid asks.
//   CHOICE   — the format genuinely leaves it open, and `holeOptions` names the
//              methods on offer. Two formats do: a Shamble is normally the
//              better ball and a Team Total normally the sum, but either side
//              can agree to play it the other way.
//   FIXED    — the format's name already answers it. The form STATES the rule
//              instead of asking.
export const HOLE_RULE_COUNTING = "counting";
export const HOLE_RULE_CHOICE = "choice";
export const HOLE_RULE_FIXED = "fixed";

export const holeOptionsFor = (formatId) =>
  FORMATS.find(f => f.id === formatId)?.holeOptions || null;

export const holeRuleFor = (formatId) => {
  const f = FORMATS.find(x => x.id === formatId);
  if (f?.counting) return HOLE_RULE_COUNTING;
  return f?.holeOptions?.length > 1 ? HOLE_RULE_CHOICE : HOLE_RULE_FIXED;
};

// The concrete method a round scores holes by, or null on a format that has no
// choice to make. `"format"` is the legacy way of saying "this format's own
// rule", so it lands on the first option — which is that rule.
export const resolveHoleMethod = (formatId, stored) => {
  const opts = holeOptionsFor(formatId);
  if (!opts) return null;
  return opts.includes(stored) ? stored : opts[0];
};

// What each named method is called on a pill, and what it does in a sentence.
export const HOLE_METHOD_LABELS = {
  [HOLE_SCORING_BEST_BALL]: "Best Ball",
  [HOLE_SCORING_TEAM_TOTAL]: "Team Total",
};
export const HOLE_METHOD_DESCRIPTIONS = {
  [HOLE_SCORING_BEST_BALL]: "The better of the side's two net balls.",
  [HOLE_SCORING_TEAM_TOTAL]: "Both partners' nets added together.",
};

// How a hole scores under a format, in one line. On a format that offers a
// choice this follows the METHOD rather than the format, since the method is
// what the round will actually be scored by. Empty for an unknown id so a
// caller can render nothing rather than a sentence about nothing.
export const describeHoleScore = (formatId, storedHoleScoring) => {
  const method = resolveHoleMethod(formatId, storedHoleScoring);
  if (method) return HOLE_METHOD_DESCRIPTIONS[method] || "";
  return FORMATS.find(f => f.id === formatId)?.hole || "";
};

// ── Handicap mode ──
// Where the Low Man / All toggle opens. Always offered, but the against-par
// formats open on All: a low-man difference is a match-play idea, and Tilt and
// Stableford are played against the course.
export const handicapModeFor = (formatId) =>
  FORMATS.find(f => f.id === formatId)?.handicapMode || HANDICAP_MODE_LOW_MAN;

// Does the form seed this format's allowance ON? Only the scramble, where a
// side playing one ball off two full handicaps is not a round anyone would
// choose. This is a FORM seed, never a scoring default — see resolveAllowance.
export const allowanceStartsOn = (formatId) =>
  !!FORMATS.find(f => f.id === formatId)?.allowanceOn;

// The legacy value. `scoring_type: "team"` meant BOTH halves at once — score
// every hole as best ball, then settle as match play — so it splits into one
// value on each axis. Kept only as a thing to read, never to write.
export const LEGACY_SCORING_TYPE_TEAM = "team";

// Both axes for a round or match, resolved from a document that may predate
// the split. Every consumer asks through here, so a round saved as "team"
// scores exactly as it always did without anything being migrated in place.
export const resolveScoring = (doc) => {
  const stored = doc?.scoring_type || SCORING_TYPE_MATCH;
  if (stored === LEGACY_SCORING_TYPE_TEAM) {
    return { formOfPlay: SCORING_TYPE_MATCH, holeScoring: HOLE_SCORING_BEST_BALL };
  }
  const hs = doc?.hole_scoring;
  return {
    formOfPlay: stored,
    // Anything that isn't a method this app knows reads as "the format's own
    // rule", which is what an absent field has always meant.
    holeScoring: (hs === HOLE_SCORING_BEST_BALL || hs === HOLE_SCORING_TEAM_TOTAL)
      ? hs : HOLE_SCORING_FORMAT,
  };
};

export const isPointsPerHole = (scoringType) =>
  resolveScoring({ scoring_type: scoringType }).formOfPlay === SCORING_TYPE_POINTS;

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

// ── Points against par ──
// Two formats score a hole by what it was against PAR rather than against the
// other side: Stableford and Tilt. They are different games with different
// tables — different rungs, different values, and in Tilt's case a multiplier
// that rides on top.
//
// The rungs run best-first so a table renders in the order a golfer thinks.
// This list is the finest grain any format cuts to; each format's own ladder
// below is a CONTIGUOUS slice of it, which is what lets a result be classified
// once and then collapsed onto whichever ladder is being scored.
const ALL_PAR_RESULTS = [
  "double_albatross", "albatross", "eagle", "birdie", "par", "bogey", "double", "triple",
];

// Each format's ladder.
//
// Stableford cuts finest: it prices a hole four under and it prices a triple
// bogey, so both ends carry their own rung. Tilt stops at albatross and at
// double bogey — its printed key ends "Dub +", so anything worse falls onto
// that rung, and nothing above an albatross is priced separately either.
export const PAR_RESULTS_BY_FORMAT = {
  stableford: ALL_PAR_RESULTS,
  tilt: ["albatross", "eagle", "birdie", "par", "bogey", "double"],
};

// The rungs a format's table actually has. Unknown formats get the full ladder
// so a caller never has to handle an empty one.
export const parResultsFor = (formatId) =>
  PAR_RESULTS_BY_FORMAT[formatId] || ALL_PAR_RESULTS;

const PAR_RESULT_NAMES = {
  double_albatross: "Dbl Alb", albatross: "Albatross", eagle: "Eagle", birdie: "Birdie",
  par: "Par", bogey: "Bogey", double: "Double", triple: "Triple",
};

// A rung's label, which depends on where the format's ladder ENDS: the bottom
// rung swallows everything below it, so it reads "+". That is why Tilt shows
// "Double +" and Stableford — which has a triple rung underneath — shows a
// plain "Double" and puts the "+" on "Triple".
export const parResultLabel = (formatId, rung) => {
  const ladder = parResultsFor(formatId);
  const suffix = rung === ladder[ladder.length - 1] ? " +" : "";
  return (PAR_RESULT_NAMES[rung] || rung) + suffix;
};

// Which rung a hole landed on, from its net score's difference to par, on the
// ladder the format being scored actually has. Classified at full grain and
// then clamped onto that ladder's ends — so on Tilt a five-under is an
// albatross and a quadruple bogey is a double, same as it has always scored.
export const parResultFor = (netVsPar, formatId) => {
  const fine = netVsPar <= -4 ? "double_albatross"
    : netVsPar === -3 ? "albatross"
      : netVsPar === -2 ? "eagle"
        : netVsPar === -1 ? "birdie"
          : netVsPar === 0 ? "par"
            : netVsPar === 1 ? "bogey"
              : netVsPar === 2 ? "double"
                : "triple";
  const ladder = parResultsFor(formatId);
  const at = (rung) => ALL_PAR_RESULTS.indexOf(rung);
  const i = Math.min(Math.max(at(fine), at(ladder[0])), at(ladder[ladder.length - 1]));
  return ALL_PAR_RESULTS[i];
};

// Each format's table, and the default a director starts from.
//
// Both are the Bourbon Cup key, off the printed cards, and both differ from
// what the app carried before: Tilt's albatross paid 16 where the card says 12,
// and Stableford's whole ladder was `max(0, 2 - d)` — the formula it used
// before the table was editable, which paid a par 2 and bottomed out at nought
// rather than taking points off a double bogey.
//
// Neither is the standard version of its game. That is the point: the field is
// scored against what it was handed on the tee, so the app agreeing with the
// sheet beats the app agreeing with its own history.
//
// Every rung on both is editable, negatives included: a table that can only
// ever pay is a table with no downside, which is the whole point of Tilt's.
export const PAR_POINTS_DEFAULTS = {
  stableford: {
    double_albatross: 10, albatross: 7, eagle: 5, birdie: 3,
    par: 1, bogey: 0, double: -2, triple: -3,
  },
  tilt: { albatross: 12, eagle: 8, birdie: 4, par: 2, bogey: 0, double: -4 },
};

export const formatUsesParPoints = (formatId) => !!PAR_POINTS_DEFAULTS[formatId];

export const parPointsDefaultFor = (formatId) => PAR_POINTS_DEFAULTS[formatId] || null;

// A round's table, resolved for scoring — null on a format that doesn't score
// against par, which is how every caller asks "does this apply?". A blank rung
// falls back to that format's default rather than to zero: an empty box is a
// box nobody filled in, not a rung worth nothing.
export const resolveParPoints = (formatId, saved) => {
  const def = parPointsDefaultFor(formatId);
  if (!def) return null;
  const num = (v, fallback) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const out = {};
  parResultsFor(formatId).forEach(k => { out[k] = num(saved?.[k], def[k]); });
  return out;
};

// ── Tilt's multiplier ──
// What the table alone cannot express, and the reason Tilt is the one format
// whose holes are not independent. See nolayingup.com/blog/tilt.
//
//   • a net birdie puts you on Tilt: the NEXT hole is worth double
//   • a second birdie in a row makes it triple, and it keeps climbing from
//     there — there is no cap
//   • an eagle counts as two birdies, so it jumps straight to triple, or
//     escalates a multiplier you were already carrying
//   • a net PAR OR WORSE takes you off Tilt entirely, back to face value
//   • it applies to negative scores too: a double bogey while on triple is
//     three times whatever the table says a double bogey costs
//   • it rides through the turn — the nines are a scoring boundary, not a
//     reset, so a birdie on 9 doubles the 10th
//
// The hole that EARNS a multiplier does not get it; "the subsequent hole" does.
// The rungs are the director's to set; these rules are not.

// How many birdies a result is worth toward the multiplier. Everything from a
// par down takes you off Tilt and is therefore worth none. Albatross is the top
// of Tilt's ladder, so a hole four under arrives here as one — there is no
// finer rung for this to answer for.
export const tiltBirdieValue = (result) =>
  result === "birdie" ? 1 : result === "eagle" ? 2 : result === "albatross" ? 3 : 0;

// The multiplier a hole is scored at, from the streak of birdies carried into
// it. One birdie doubles, two triples, and it keeps going — `streak + 1`.
export const tiltMultiplier = (streak) => (streak > 0 ? streak + 1 : 1);

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

// ── Director auth ──
// Shared secret entered on the login screen to unlock director-only views
// (Admin). Not real auth; the app is private-link-shared
// among 16 players + the director, and Firebase rules can layer on top
// later if needed.
export const DIRECTOR_CODE = "bcdir";
