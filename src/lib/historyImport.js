// ══════════════════════════════════════════════════════════════════
//  historyImport — the past cups, as editions the app can run.
// ══════════════════════════════════════════════════════════════════
//
// Firestore holds the running Bourbon Cup. 2016–2024 live only in the repo:
// the spreadsheets under `data/historical sheets`, and the fact layer the
// pipeline builds off them. So a director switching to 2019 in Admin →
// Tournament → Editions lands in an empty tournament, even though every hole
// of it is sitting in this repository.
//
// This builds the documents that make those years real editions. Switch to one
// and the leaderboard, the scorecards, the match strip and the round detail all
// work, because they are ordinary editions with no special case anywhere in the
// app — the only thing marking them is an `imported_from` field nothing reads.
//
// PURE: no Firebase, no React. `scripts/import-history.mjs` is the half that
// talks to Firestore; everything deciding what a document should contain lives
// here, next to its tests. (firebase.js initializes an app at import time, so
// anything importing it can't be unit-tested — hence the split, and hence
// editionDocId being re-stated below rather than imported.)
//
// ── Where the data comes from ─────────────────────────────────────
//   data/bourbon-cup-editions.json   the tournament layer — teams, roster,
//                                    courses, round setup, the draw.
//                                    Built by pipeline/editions.mjs.
//   data/bourbon-cup-backbone.json   every hole of every round, already
//                                    reconciled against the cards by Phase 1.
//
// ── Why the course handicap is stored, not derived ────────────────
// The app derives a player's course handicap for a round from one index:
// calcCH(index, slope, rating, par), recomputed per round off the tee played.
// That is right for a tournament being played now.
//
// The old cups did not work that way. Handicaps came off The Grint, were
// pasted into the sheet AS VALUES per round, and were rounded, blended and
// hand-adjusted along the way — 2019's and 2021's sheets even label the column
// "Raw Course Handi" for the rounds where it was about to be blended again.
// There is no single index that reproduces all four rounds of most years, and
// a course handicap out by one stroke is a hole given away, which is a match,
// which is the cup in a year that finished 16½–15½.
//
// So the recorded course handicap is written into each round's LOCK, which is
// the app's own mechanism for exactly this: getRoundCH reads `lock.players[pid]
// .ch` ahead of everything else, precisely so a finished round can never be
// re-derived. An imported year arrives already locked and final, which is also
// true — those tournaments are over.
//
// The index still goes on the roster row because a roster shows one, and it is
// the index the sheet recorded. Nothing is scored from it.
//
// ── What is not imported ──────────────────────────────────────────
// Skins, CTPs, buy-ins, card signatures, tee times and groups. The sheets
// record none of them; inventing an empty pot or a group list would be
// inventing tournament facts. The screens that show them handle an edition
// that has none, because that is also what a tournament looks like before it
// starts.

// The document-id namespacing rule, re-stated from firebase.js (which cannot
// be imported here — see the note above). Every imported edition is namespaced,
// so this is always the prefixed form; the identity-function branch that the
// original bc_2025 edition uses is deliberately not reachable from here.
export const editionDocId = (bareId, tid) => `${tid}__${bareId}`;

export const editionIdForYear = (year) => `bc_${Number(year)}`;

// Stamped on EVERY document this import writes. Two jobs: it tells a director
// looking at 2019 in the console that the year was imported rather than
// played in the app, and it is what the import prunes by — a re-run deletes
// the documents IT wrote that the new build no longer contains, which is how
// a changed id (Telly turning out to be Ben T) cleans up after itself instead
// of leaving a second roster behind.
export const SOURCE = "data/historical sheets";

// A roster id for one golfer in one year. Year-scoped because the roster row
// IS the player document in this app — its id is the `player_id` that hole
// scores and matches point at — so one document cannot be shared by two
// editions the way a career id would want.
export const historyPlayerId = (year, canonicalId) => `hist_${year}_${canonicalId}`;

// A course document for one ROUND of one year, frozen at the rating in force
// when it was played. Keyed by round as well as year on purpose: 2020 played
// Harbor Shores in rounds 2 and 3, and 2017 played the same club off two
// different tees — an id keyed on the name alone would make those one
// document, and the second round would silently inherit the first's card.
export const historyCourseId = (year, round, name) =>
  `hist_${year}_r${round}_${String(name ?? "").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;

export const isHistoryCourseId = (id) => String(id ?? "").startsWith("hist_");

// ── Form of play ──────────────────────────────────────────────────
// Which axis a round settles on: holes won, a running total, or points per
// hole. Taken from the SHEET's own scoring rather than from the format's
// default in the app's catalog, because the sheet is what the year was played
// under — Two-Man Scramble defaults to Total in the app, but every scramble
// round in the record was tracked as a match, hole by hole.
//
// The dots and points games settle on a TOTAL, and the scorecards say so:
// 2016's Hi/Lo match status moves by two on a hole one side sweeps, which a
// holes-won count cannot do. A nine goes to the bigger pile, not to whoever
// took more holes.
//
// The values are the app's (src/constants.js): "match" / "stroke" / "points".
const FORM_BY_SOURCE_FORMAT = {
  "2man_hi_lo": "stroke",
  double_dot: "stroke",
  dirty_dozen: "stroke",
  "2man_stableford": "stroke",
  "2man_tilt": "stroke",
  team_best_ball: "points",     // points per hole, not a Nassau
  "8man_top4net": "points",
};

export const formOfPlayFor = (sourceFormat) => FORM_BY_SOURCE_FORMAT[sourceFormat] || "match";

// ── The handicap allowance, and the one that is already spent ─────
// Everything except the shared-ball formats played off the full recorded
// handicap, so the allowance stays off and the app scores at 100% — which is
// what an absent allowance has always meant.
//
// Scramble and Pinehurst are the exception, and NOT in the way the format
// catalog would suggest. The app's Scramble allowance is 35% of the low man
// plus 15% of the high, which it applies to two raw handicaps and sums into
// the side's one figure. The sheets did that blend themselves, in a column
// headed "35% / 15%", and then wrote the RESULT onto both partners' rows —
// which is why in every shared-ball round on record the two partners carry the
// same number to a decimal place (2025 R3: Jensen 6.2 and Pete C 6.2, against
// DK 11.5 and Saugy 11.5).
//
// So the recorded handicap for those rounds is the SIDE's, not the player's,
// and applying the catalog's 35/15 to it blends an already-blended number —
// halving every team handicap in the round. It survived on four of the five
// such rounds because halving both sides usually leaves the difference
// pointing the same way; 2025's R3 is where it stopped surviving.
//
// 50/50 is what makes the app's own arithmetic reproduce the sheet: the side's
// figure is the sum of its players' allowance-adjusted handicaps, and half of
// T plus half of T is T. It reads oddly beside the other percentages, which is
// why it says so here — it is not an allowance anybody played off, it is the
// identity that undoes a double blend.
const ALLOWANCE_BY_FORMAT = {
  scramble: { enabled: true, low: 50, high: 50 },
  pinehurst: { enabled: true, low: 50, high: 50 },
};

export const allowanceFor = (format) => ALLOWANCE_BY_FORMAT[format] || null;

// ── The documents ─────────────────────────────────────────────────
// Each builder returns a plain object in the shape the app already writes, so
// an imported edition is not a new kind of thing anything has to understand.
// The shapes are taken from the write sites in App.jsx (onSaveHole,
// assignCourseToRound, the add-player form, MatchSetup.createMatch) and from
// lib/roundLocks.buildRoundLockDoc, rather than invented here.

// bc_editions — the row that makes a year appear in the Editions picker.
//
// `status: "archived"` is the picker's third state and the true one: these
// tournaments are over. The picker's delete confirms hard against it, and the
// switcher shows it in the muted colour rather than the live amber.
export const editionDocFor = ({ year, name }) => ({
  id: editionIdForYear(year),
  year: Number(year),
  name: String(name ?? "").trim() || `The Bourbon Cup ${year}`,
  status: "archived",
  // Every imported edition namespaces its doc ids. Only the original bc_2025
  // edition predates namespacing and keeps bare ones.
  namespaced: true,
  created_from: null,
  // Provenance, so a director looking at 2019 in the Firebase console can tell
  // an imported year from one that was played in the app.
  imported_from: SOURCE,
});

// bc_settings/team_names — the two team names, which changed every year and
// are half of what makes a past cup recognisable.
export const teamNamesDocFor = ({ year, teams }) => ({
  id: editionDocId("team_names", editionIdForYear(year)),
  tournament_id: editionIdForYear(year),
  teamA: String(teams?.A ?? "").trim() || "Team A",
  teamB: String(teams?.B ?? "").trim() || "Team B",
  imported_from: SOURCE,
});

// bc_settings/tournament — the name and location on the header.
export const tournamentDocFor = ({ year, name }) => ({
  id: editionDocId("tournament", editionIdForYear(year)),
  tournament_id: editionIdForYear(year),
  name: String(name ?? "").trim() || `The Bourbon Cup ${year}`,
  location: "",
  imported_from: SOURCE,
});

// bc_settings/branding — the team colours a year was played in.
//
// Read off the SCOREBOARD banner in the workbook (see pipeline/team-brand.mjs),
// which is the only place a sheet records them. A side with no colour is left
// OUT of the document rather than defaulted: the app falls back to its own
// palette for a side the branding doc says nothing about, and 2016–2018 played
// under no team colours at all.
//
// No logo. Only 2024's workbook has one embedded, and a logo is a decision
// about an edition rather than something to sweep in with the scores.
export const brandingDocFor = ({ year, brand }) => {
  const doc = {
    id: editionDocId("branding", editionIdForYear(year)),
    tournament_id: editionIdForYear(year),
    imported_from: SOURCE,
  };
  if (brand?.A?.color) doc.teamA = { color: brand.A.color };
  if (brand?.B?.color) doc.teamB = { color: brand.B.color };
  return (doc.teamA || doc.teamB) ? doc : null;
};

// bc_players — one roster row per golfer per year.
export const playerDocFor = ({ year, id, name, first, last, team, index, borrowed = false }) => {
  const pid = historyPlayerId(year, id);
  return {
    id: pid,
    player_id: pid,
    tournament_id: editionIdForYear(year),
    // `name` is the display form — first name, last initial — because that is
    // what every screen outside the admin console renders and what AdminView
    // stores here when a director adds somebody. first_name/last_name are the
    // source it is built from, and are what that console edits.
    name: String(name ?? id),
    ...(first ? { first_name: first } : {}),
    ...(last ? { last_name: last } : {}),
    team: team === "B" ? "B" : "A",
    handicap_index: Number.isFinite(Number(index)) ? Number(index) : 0,
    // 2020's compiled card. A roster row because Team Best Ball needs the ball
    // on the side, flagged because it is not a person — every screen that
    // lists PLAYERS filters it out through lib/players.isBorrowedBall.
    ...(borrowed ? { borrowed: true } : {}),
    // Explicitly null rather than absent: the roster row for a finished
    // tournament has no account behind it and never will have had one, and a
    // missing field reads as "not written yet" to the claim screen.
    auth_uid: null,
    imported_from: SOURCE,
  };
};

// bc_courses — frozen at the card that was played, not at the course as it is
// rated today. One tee box, because the sheet records one set of numbers per
// round and inventing a colour would be inventing a fact.
export const courseDocFor = ({ year, round, course }) => {
  const par = Number(course?.par) || (course?.hole_pars || []).reduce((a, b) => a + (Number(b) || 0), 0) || 72;
  const rating = Number(course?.rating) || par;
  const slope = Number(course?.slope) || 113;
  return {
    id: historyCourseId(year, round, course?.name),
    tournament_id: editionIdForYear(year),
    name: String(course?.name ?? "").trim() || `Round ${round}`,
    par, rating, slope,
    hole_pars: (course?.hole_pars || []).map((p) => Number(p) || 4),
    hole_handicaps: (course?.hole_handicaps || []).map((h) => Number(h) || 0),
    tee_boxes: [{ name: HISTORY_TEE, color: "#8b6b3d", rating, slope, par, yardage: 0 }],
    imported_from: SOURCE,
  };
};

// The one tee every imported round is played off. Named rather than left blank
// so the lock, the round and the course all point at the same string — a tee
// name that matches nothing falls through to the course's first box, which
// happens to be this one, but only by luck.
export const HISTORY_TEE = "Historical";

// bc_rounds — the round's setup: what was played, where, and what it was worth.
export const roundDocFor = ({ year, round }) => {
  const doc = {
    id: editionDocId(`bc_round_${round.round}`, editionIdForYear(year)),
    tournament_id: editionIdForYear(year),
    round_number: Number(round.round),
    format: round.format,
    course_id: historyCourseId(year, round.round, round.course?.name),
    tee_box: HISTORY_TEE,
    tee_time: "",
    scoring_type: formOfPlayFor(round.source_format),
    // What a match in this game was worth, straight off the sheet's points
    // table. A points-per-hole round (Team Best Ball) has no Nassau and vice
    // versa, so the absent one is left absent rather than defaulted — the app
    // reads whichever its form of play asks for.
    ...(round.nassau ? {
      nassau_front: Number(round.nassau.front) || 0,
      nassau_back: Number(round.nassau.back) || 0,
      nassau_overall: Number(round.nassau.overall) || 0,
    } : {}),
    ...(round.hole_points ? { hole_points: { front: Number(round.hole_points.front) || 1, back: Number(round.hole_points.back) || 1 } } : {}),
    ...(round.counting_scores ? { counting_scores: round.counting_scores } : {}),
    handicap_mode: round.handicap_mode,
    // Recorded for the audit trail even where it is the app's own default,
    // because a round document that names its allowance can be read without
    // knowing the format catalog.
    ...(allowanceFor(round.format) ? { allowance: allowanceFor(round.format) } : {}),
    // Not a field the app reads. It is here so a round whose game has no exact
    // counterpart in the catalog still says what was really played — Dirty
    // Dozen scored as Double Dot, 8-Man Top 4 Net as Team Best Ball.
    source_format: round.source_format,
    imported_from: SOURCE,
  };
  return doc;
};

// bc_matches — the draw. `teamANames` rides along because every screen that
// shows a match reads the names off the match rather than re-joining the
// roster, exactly as MatchSetup writes them.
export const matchDocFor = ({ year, match, nameOf }) => {
  const tid = editionIdForYear(year);
  const A = match.teamA.map((p) => historyPlayerId(year, p));
  const B = match.teamB.map((p) => historyPlayerId(year, p));
  return {
    id: editionDocId(`bc_match_r${match.round}_${A.join("_")}_vs_${B.join("_")}`, tid),
    tournament_id: tid,
    round: Number(match.round),
    teamA: A,
    teamB: B,
    teamANames: match.teamA.map(nameOf),
    teamBNames: match.teamB.map(nameOf),
    imported_from: SOURCE,
  };
};

// bc_hole_scores — one document per player, per round, per hole. `hole_number`
// is one-based in the store; App.onSaveHole builds the id off the zero-based
// index, which is where the `+ 1` in its own id string comes from.
export const holeDocFor = ({ year, round, playerId, hole, gross, courseName }) => {
  const tid = editionIdForYear(year);
  const pid = historyPlayerId(year, playerId);
  return {
    id: editionDocId(`bc_hs_r${round}_${pid}_h${hole}`, tid),
    tournament_id: tid,
    player_id: pid,
    round_number: Number(round),
    hole_number: Number(hole),
    score: Number(gross),
    course_id: historyCourseId(year, round, courseName),
    imported_from: SOURCE,
  };
};

// bc_round_locks — the snapshot, and the reason this import can be exact.
//
// Shaped to match lib/roundLocks.buildRoundLockDoc field for field, because
// scoring.js reads it back through the same accessors either way. Two fields
// differ in meaning rather than in shape:
//
//   locked_reason "import" rather than "auto" or "manual" — nobody pressed
//                 anything; the round was over before the app existed.
//   final: true   these tournaments are finished. It is what closes the round
//                 to score entry, hides the finalize prompt, and stops the
//                 snapshot being refreshed out from under a result.
export const roundLockDocFor = ({ year, round, players, ch, course }) => {
  const tid = editionIdForYear(year);
  const par = Number(course?.par) || 72;
  const rating = Number(course?.rating) || par;
  const slope = Number(course?.slope) || 113;
  const snapshot = {};
  for (const p of players) {
    const pid = historyPlayerId(year, p.id);
    const recorded = ch?.[p.id];
    snapshot[pid] = {
      name: p.name || p.id,
      team: p.team === "B" ? "B" : "A",
      hi: Number.isFinite(Number(p.index)) ? Number(p.index) : 0,
      base_hi: Number.isFinite(Number(p.index)) ? Number(p.index) : 0,
      // The recorded course handicap is not an override a director typed — it
      // is what the tournament was played off — so the flag that marks a
      // hand-set number stays false and the number itself goes in as the
      // frozen answer below.
      overridden: false,
      tee: HISTORY_TEE,
      slope, rating, par,
      // The whole point of the import. Null only if the sheet recorded no
      // handicap for that player that round, in which case the app falls back
      // to deriving one, which is the best available answer.
      ch: Number.isFinite(Number(recorded)) ? Number(recorded) : null,
    };
  }
  return {
    id: editionDocId(`bc_lock_r${round.round}`, tid),
    tournament_id: tid,
    round_number: Number(round.round),
    locked: true,
    final: true,
    locked_at: null,
    locked_by: null,
    locked_reason: "import",
    refreshed_at: null,
    refreshed_by: null,
    finalized_at: null,
    finalized_by: null,
    course_id: historyCourseId(year, round.round, round.course?.name),
    course_name: round.course?.name || null,
    handicap_mode: round.handicap_mode,
    format: round.format,
    allowance: allowanceFor(round.format),
    counting_scores: round.counting_scores || null,
    hole_pars: (round.course?.hole_pars || []).map((p) => Number(p) || 4),
    hole_handicaps: (round.course?.hole_handicaps || []).map((h) => Number(h) || 0),
    players: snapshot,
    imported_from: SOURCE,
  };
};

// ── buildEdition ──────────────────────────────────────────────────
// Everything one year needs, grouped by collection so the caller can write it,
// count it or print it without this module knowing which of those it is doing.
//
//   edition — one entry from data/bourbon-cup-editions.json
//   holes   — that year's playerHole rows from the backbone
//   handicapModeFor — passed in rather than imported, so this module stays
//                     free of src/constants.js and its FORMATS catalog; the
//                     caller already has the app's own answer.
//   counting — { [round]: {front, back} }, the calibrated Team Best Ball
//              contribution counts from lib/historyVerify. Absent, the sheet's
//              own dominant count per nine is used.
export const buildEdition = (edition, holes = [], { handicapModeFor, counting } = {}) => {
  const year = Number(edition.year);
  const tid = editionIdForYear(year);
  const onRoster = new Set(edition.players.map((p) => p.id));
  const nameOf = (id) => edition.players.find((p) => p.id === id)?.name || id;

  // The round setup, with the two things the sheet does not name: the handicap
  // mode (a property of the format, and the app is the authority on it) and
  // the scoring axis the fact layer recorded for that round.
  const rounds = edition.rounds.map((r) => ({
    ...r,
    source_scoring: holes.find((h) => h.round === r.round)?.scoring_type || null,
    handicap_mode: handicapModeFor ? handicapModeFor(r.format) : "low_man",
    ...(counting?.[r.round] ? { counting_scores: counting[r.round] } : {}),
  }));
  const roundByNumber = new Map(rounds.map((r) => [r.round, r]));

  // The borrowed ball's card rides in on the edition rather than the backbone,
  // which excludes it by design — see the note in pipeline/editions.mjs.
  const allHoles = [...holes, ...(edition.extra_holes || [])];
  const holeDocs = allHoles
    .filter((h) => onRoster.has(h.player))
    .filter((h) => Number.isFinite(Number(h.gross)) && Number(h.gross) > 0)
    .filter((h) => roundByNumber.has(h.round))
    .map((h) => holeDocFor({
      year, round: h.round, playerId: h.player, hole: h.hole, gross: h.gross,
      courseName: roundByNumber.get(h.round).course?.name,
    }));

  return {
    year,
    editionId: tid,
    bc_editions: [editionDocFor({ year, name: edition.name })],
    bc_settings: [
      teamNamesDocFor({ year, teams: edition.teams }),
      tournamentDocFor({ year, name: edition.name }),
      brandingDocFor({ year, brand: edition.brand }),
    ].filter(Boolean),
    bc_players: edition.players.map((p) => playerDocFor({ year, ...p })),
    bc_courses: rounds.map((r) => courseDocFor({ year, round: r.round, course: r.course })),
    bc_rounds: rounds.map((r) => roundDocFor({ year, round: r })),
    bc_matches: edition.matches
      .filter((m) => m.teamA.every((p) => onRoster.has(p)) && m.teamB.every((p) => onRoster.has(p)))
      .map((m) => matchDocFor({ year, match: m, nameOf })),
    bc_hole_scores: holeDocs,
    bc_round_locks: rounds.map((r) => roundLockDocFor({
      year, round: r, players: edition.players, ch: r.ch, course: r.course,
    })),
  };
};

// The collections an import writes, in the order it writes them. Ordered so a
// run interrupted part-way leaves an edition that is missing scores rather than
// one whose scores point at a roster that isn't there yet.
export const IMPORT_COLLECTIONS = [
  "bc_editions", "bc_settings", "bc_players", "bc_courses",
  "bc_rounds", "bc_matches", "bc_round_locks", "bc_hole_scores",
];

export const countDocs = (built) =>
  IMPORT_COLLECTIONS.reduce((n, c) => n + (built?.[c]?.length || 0), 0);
