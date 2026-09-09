// ══════════════════════════════════════════════════════════════════
//  demoSeed — a tournament for testers, that is not the tournament.
// ══════════════════════════════════════════════════════════════════
//
// `docs/store-submission.md` §1.4 asks for a throwaway edition before either
// store submission, and the Play closed test needs the same thing for a
// different reason: a tester has to be able to USE the app, and one who can
// only look generates nothing. Internal testing takes up to a hundred with no
// minimum (play-store.md §7), so the field is sized to the CUP rather than to
// a tester count — see the note over FIELD.
//
// The alternative was a director building it by hand in Admin — a roster, two
// courses, four rounds, a draw and a few hundred hole scores, clicked in one
// at a time, with `AdminView` auto-saving to the live project on every edit.
// That is an hour of clicking next to the real cup, and it cannot be undone
// except by clicking again.
//
// ── PURE ────────────────────────────────────────────────────────────
// No Firebase and no React, like `historyImport.js` and for the same reason:
// firebase.js initializes an app at import time, so anything importing it
// cannot be unit-tested. `scripts/seed-demo.mjs` is the half that writes.
// `editionDocId` comes from historyImport rather than being restated a third
// time.
//
// ── Why every document is stamped ───────────────────────────────────
// `seeded_from: "demo-seed"` rides on all of them. It is what makes --undo
// exact — it deletes what this wrote and nothing else — and it is what lets
// the writer refuse an edition that has anything real in it. A demo that ate
// a tournament would be a very expensive convenience.
//
// ── What it deliberately does NOT create ────────────────────────────
// No dues document. A ledger would put "YOU OWE $150" on a tester's My
// Account, and a tester cannot tell a seeded debt from a real one — the whole
// point of the ledger is that the number is believed. Budget lines are seeded
// instead: same feature, director-only, nobody billed.
//
// No `bc_accounts` and no claimed rows. Membership is minted by presenting
// the tournament password (see firestore.rules) and claiming is a thing a
// person does; a roster row with an invented `auth_uid` would be a row nobody
// can claim and nobody can unclaim.
import { editionDocId } from "./historyImport.js";
import { todayISO, addDays } from "./dates.js";
import { allowanceDefaultFor, formatIsSharedBall, isSplitAllowance } from "../constants.js";

// Defined in lib/editionLock and re-exported here, so the seed and its tests
// go on reading one constant. It moved because firebase.js needs it — to
// decide where a store build starts — and firebase.js pulling this whole
// module in for one string would put the entire seed on the critical path for
// a leaderboard.
export { DEMO_EDITION_ID } from "./editionLock.js";
import { DEMO_EDITION_ID } from "./editionLock.js";

export const DEMO_MARK = "demo-seed";
// From the same clock as the dates below. Hardcoding it meant a demo seeded in
// January would file itself under last year while its rounds were dated this
// one — and the picker sorts on the year, so it would sit in the wrong place
// in the list of tournaments.
export const DEMO_YEAR = Number(todayISO().slice(0, 4));
export const DEMO_NAME = "DEMO — Testers";

// Collections this touches, in the order it writes them. Editions first so a
// half-finished run still shows up in the picker and can be deleted from the
// app rather than the console.
export const DEMO_COLLECTIONS = [
  "bc_editions", "bc_settings", "bc_tournament_settings", "bc_players",
  "bc_courses", "bc_rounds", "bc_matches", "bc_groups", "bc_hole_scores",
  "bc_ctp", "bc_budget",
];

const id = (bare) => editionDocId(bare, DEMO_EDITION_ID);
const stamp = (doc) => ({ ...doc, tournament_id: DEMO_EDITION_ID, seeded_from: DEMO_MARK });

// ── Deterministic scores ────────────────────────────────────────────
// mulberry32, seeded from a constant. The scores have to be the SAME on every
// run or the seed stops being idempotent: a re-run would rewrite three hundred
// hole documents with different numbers, and a tester who had started fixing
// one would watch it change under them. It also makes the fidelity of this
// file testable at all — a random demo has no expected output.
const rng = (seed) => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ── The field ───────────────────────────────────────────────────────
// Invented golfers, and they have to stay invented. This edition is handed to
// App Review, to Google, and to whoever is testing — seeding the real roster
// would put sixteen named men's handicaps in front of all of them for no
// benefit.
//
// SIXTEEN, eight a side — the size of the Bourbon Cup. It was twelve, which is
// WBC's field and was chosen when the destination was Play's CLOSED test and
// twelve was the number it wanted opted in. Internal testing retired that
// audience (play-store.md §7: up to 100 testers, no minimum), so the count was
// answering a question nobody asks any more.
//
// The size is not cosmetic on this app. The closing round is a Team Best Ball
// counting the side's best N, and the engine clamps N to the smaller roster —
// so a six-man side cannot demonstrate best-six-of-eight at all, and the tee
// sheet drew waves of three where the cup plays foursomes. A demo of a
// sixteen-man tournament has to be sixteen men or it is demonstrating a
// different tournament.
const FIELD = [
  { key: "dave",  name: "Dave R",  first: "Dave",  last: "Reyes",     team: "A", index: 8.4 },
  { key: "marty", name: "Marty K", first: "Marty", last: "Kowalski",  team: "A", index: 14.1 },
  { key: "chris", name: "Chris B", first: "Chris", last: "Bell",      team: "A", index: 3.2 },
  { key: "nick",  name: "Nick D",  first: "Nick",  last: "Duarte",    team: "A", index: 19.6 },
  { key: "sam",   name: "Sam O",   first: "Sam",   last: "Okafor",    team: "A", index: 11.0 },
  { key: "pete",  name: "Pete V",  first: "Pete",  last: "Vasquez",   team: "A", index: 22.3 },
  { key: "gil",   name: "Gil A",   first: "Gil",   last: "Andersen",  team: "B", index: 6.7 },
  { key: "ray",   name: "Ray M",   first: "Ray",   last: "Mullins",   team: "B", index: 16.8 },
  { key: "tom",   name: "Tom F",   first: "Tom",   last: "Fitzgerald",team: "B", index: 9.5 },
  { key: "wes",   name: "Wes L",   first: "Wes",   last: "Lindqvist", team: "B", index: 12.9 },
  { key: "alan",  name: "Alan P",  first: "Alan",  last: "Pryce",     team: "B", index: 20.4 },
  { key: "curt",  name: "Curt S",  first: "Curt",  last: "Solberg",   team: "B", index: 5.1 },
  { key: "hank",  name: "Hank B",  first: "Hank",  last: "Brennan",   team: "A", index: 17.2 },
  { key: "rudy",  name: "Rudy T",  first: "Rudy",  last: "Takahashi", team: "A", index: 7.8 },
  { key: "vic",   name: "Vic C",   first: "Vic",   last: "Calderon",  team: "B", index: 13.6 },
  { key: "owen",  name: "Owen H",  first: "Owen",  last: "Halloran",  team: "B", index: 21.1 },
];

export const demoPlayerId = (key) => `demo_${key}`;
const A = FIELD.filter(p => p.team === "A");
const B = FIELD.filter(p => p.team === "B");

// ── The courses ─────────────────────────────────────────────────────
// Invented, for the same reason the field is: publishing a made-up scorecard
// under a real club's name puts wrong yardages and wrong stroke indexes on the
// internet attached to somebody's actual golf course.
const COURSES = [
  {
    key: "pinecrest", name: "Pinecrest National", par: 72, rating: 71.8, slope: 130,
    pars: [4, 5, 4, 3, 4, 4, 5, 3, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4],
    sis:  [7, 3, 11, 17, 1, 9, 5, 15, 13, 8, 4, 18, 2, 10, 6, 16, 12, 14],
    yards: [402, 538, 385, 168, 441, 396, 512, 152, 377, 410, 428, 174, 545, 391, 433, 161, 505, 369],
  },
  {
    key: "harbor", name: "Harbor Dunes Links", par: 71, rating: 70.9, slope: 126,
    pars: [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4, 5, 4, 3, 4, 4],
    sis:  [5, 9, 15, 1, 11, 3, 17, 7, 13, 6, 16, 2, 10, 4, 8, 18, 12, 14],
    yards: [388, 415, 186, 521, 372, 447, 145, 404, 498, 396, 158, 462, 381, 533, 419, 132, 407, 390],
  },
];

export const demoCourseId = (key) => id(`bc_course_${key}`);

const total = (yards) => yards.reduce((a, b) => a + b, 0);
// The forward tee, hole by hole rather than as a flat percentage of the total,
// so the White card's own OUT/IN/TOTAL add up the way a printed one does. Par
// 3s give up less than par 5s, which is how a real second set of tees is cut.
const shorter = (y) => Math.round(y * (y > 480 ? 0.93 : y < 200 ? 0.86 : 0.94) / 5) * 5;

// ── The week ────────────────────────────────────────────────────────
// Dates are YYYY-MM-DD strings end to end — see lib/dates, which owns that
// decision and supplies both helpers here, so nothing in this file constructs
// a Date of its own.
//
// AROUND TODAY, not a fixed weekend. The first cut pinned this to a date in
// July 2026 and argued that a seed whose output depends on the day it ran
// cannot be diffed. That was the wrong thing to optimise: July went past, and
// the demo then advertised a trip that had finished a month earlier, on the
// one screen a reviewer opens to ask "when is this". A stale demo reads as an
// abandoned one.
//
// The determinism that actually matters is the SCORES — 324 hole documents
// that must not churn on a re-run, and do not: they are seeded from the round
// and the player, never from the date. Three date fields refreshing when the
// seed is re-run is not drift, it is the demo staying current.
//
// The span is chosen so the seeded scores TELL THE TRUTH about it:
//
//   yesterday   round 1, played out
//   today       round 2, nine holes in — which is where a tester comes in
//               round 3, this afternoon, empty
//   tomorrow    round 4, empty
//
// A tournament in progress, which is both the most useful thing to hand a
// reviewer and the state that gives a tester something to finish. The header
// countdown stays dark because the first tee was yesterday; that is correct
// for a cup already under way, not a missing feature.
export const DEMO_START = addDays(todayISO(), -1);
export const DEMO_MIDDLE = todayISO();
export const DEMO_END = addDays(todayISO(), 1);

const ROUNDS = [
  { round: 1, format: "best_ball", course: "pinecrest", date: DEMO_START, tee: "8:00 AM", perSide: 2 },
  { round: 2, format: "scramble",  course: "harbor",    date: DEMO_MIDDLE,  tee: "8:30 AM", perSide: 2 },
  { round: 3, format: "pinehurst", course: "pinecrest", date: DEMO_MIDDLE,  tee: "2:00 PM", perSide: 2 },
  { round: 4, format: "singles",   course: "harbor",    date: DEMO_END,     tee: "9:00 AM", perSide: 1 },
];

// ── The dry run ─────────────────────────────────────────────────────
// `buildDemo({ countdown: true })` replaces round 4 with the closing round
// the real cup actually plays: a Team Best Ball, sealed, eighteen holes in
// the books and not one of them turned over. It exists so the Final Countdown
// can be rehearsed on a television with the room empty — the one thing that
// cannot be rehearsed on the night, and the one screen with an audience.
//
// It goes in the DEMO edition and nowhere else. Everything below writes
// through the same constant id, the same `seeded_from` mark and the same
// refusal to touch a document it did not write, so a dry run cannot reach
// bc_2026 by any argument anybody types. A plain re-seed puts the demo back
// to the state a store reviewer should meet.
//
// The cup's own counts: best SIX of eight on the front, seven of eight on the
// back. They were four and five, sized for a six-man side, because the engine
// clamps the count to the smaller roster and six of six would have made every
// ball count — with no dimmed "did not count" chips, which are half of what
// the countdown is for. A sixteen-man field takes the real numbers, so a
// rehearsal is a rehearsal of the round that gets played.
const COUNTDOWN_ROUND = {
  round: 4, format: "team_best_ball", course: "harbor", date: DEMO_END,
  tee: "9:00 AM|9:10 AM|9:20 AM|9:30 AM", perSide: null,
  scoring_type: "points",
  hole_points: { front: 1, back: 2 },
  counting_scores: { holes: [...Array(9).fill(6), ...Array(9).fill(7)] },
  sealed: true,
};

// A side split into even waves, never more than four in one. The same rule as
// `splitEvenly` in lib/groups, spelled out again here rather than imported:
// that module reaches Firebase, and this one is run from a Node script and
// unit-tested, so it holds no Firebase at all. Four lines is the cheaper half
// of that trade.
const waves = (players, size = 4) => {
  const count = Math.ceil(players.length / size);
  const out = [];
  let i = 0;
  for (let g = 0; g < count; g++) {
    const take = Math.ceil((players.length - i) / (count - g));
    out.push(players.slice(i, i + take));
    i += take;
  }
  return out;
};

const roundsFor = (countdown) =>
  countdown ? ROUNDS.map(r => (r.round === 4 ? COUNTDOWN_ROUND : r)) : ROUNDS;

// How much of the week is already played. R1 is complete so the leaderboard
// has something on it the moment a tester opens the app; R2 stops at the turn
// so there is something to DO — which is the entire reason this edition
// exists. R3 and R4 are drawn and empty.
const SCORED = { 1: 18, 2: 9 };

// ── The draw ────────────────────────────────────────────────────────
// Fixed partnerships, rotating opposition — which is a real format and, more
// usefully here, the only arrangement over three rounds in which nobody meets
// the same opponent twice. Each side is three pairs; pair g of A faces pair
// (g + round - 1) mod 3 of B, so across rounds 1–3 every A pair works through
// all three B pairs and therefore meets each of the six opposite men exactly
// once. Round 4 is singles down the order.
//
// The obvious alternative — shifting B by one PLAYER each round — looks like a
// rotation and is not: A0 draws B1 in round 1 and again in round 2. That is
// the bug the test in demoSeed.test.js exists to have caught, and did.
// Four pairs a side now rather than three. The rotation still holds: pair g of
// A faces pair (g + round - 1) mod 4 of B, so over rounds 1-3 no A pair meets
// the same B pair twice. With four pairs and three rounds one pairing is left
// unplayed each way, which is what a four-round cup does to a three-round
// rotation and is not a bug.
const A_PAIRS = [[0, 1], [2, 3], [4, 5], [6, 7]];
const B_PAIRS = [[0, 1], [2, 3], [4, 5], [6, 7]];

const pairsFor = (round, countdown = false) => {
  // A Team Best Ball is ONE match holding both whole sides — that is the
  // format, and it is what makes the countdown's "best N of the side" mean
  // anything.
  if (round === 4 && countdown) return [{ teamA: A.map(a => a.key), teamB: B.map(b => b.key) }];
  if (round === 4) return A.map((a, i) => ({ teamA: [a.key], teamB: [B[i].key] }));
  return A_PAIRS.map((ap, g) => {
    const bp = B_PAIRS[(g + round - 1) % B_PAIRS.length];
    return { teamA: ap.map(i => A[i].key), teamB: bp.map(i => B[i].key) };
  });
};

const matchBareId = (round, a, b) => `bc_match_r${round}_${a.join("_")}_vs_${b.join("_")}`;

// ── Scores ──────────────────────────────────────────────────────────
// Gross, and plausible rather than flattering: a 22 handicap makes a double
// now and then and a 3 makes the odd birdie. The distribution is not the point
// — what matters is that the leaderboard, the skins board and the scorecards
// all have real numbers to chew on, and that they are the same numbers twice.
const grossFor = (par, index, r) => {
  const skill = Math.max(0, Math.min(1, index / 24));
  const roll = r();
  // Bogey rate rides the index; the tails are deliberately short so nothing
  // reads as a typo on a scorecard a reviewer opens.
  if (roll < 0.06 - skill * 0.05) return Math.max(2, par - 1);       // birdie
  if (roll < 0.52 - skill * 0.30) return par;
  if (roll < 0.88 - skill * 0.13) return par + 1;
  if (roll < 0.98) return par + 2;
  return par + 3;
};

// ── A round that matches the handicap it was played off ─────────────
// Sampling eighteen holes independently gets the SHAPE of a round right and
// the TOTAL wrong often enough to matter: the first cut of this seed had a
// 16.8 shooting 76 and an 11.0 shooting 95, which is not a variance anybody
// would forgive on a card. Worse, it feeds the engine net scores that produce
// eight-up blowouts, so the demo leaderboard read as a broken app rather than
// as a tournament.
//
// So the round is re-rolled until its total lands near what that index would
// actually shoot, and the closest attempt wins if none does. Deterministic:
// the attempt number is folded into the seed, so the same player gets the same
// round every run, which is what keeps the seed idempotent.
//
// `index + 2` because a handicap is a measure of a golfer's GOOD rounds — the
// average player shoots a couple over their index — and ±4 because a demo
// where everybody shoots exactly to handicap reads as generated.
const targetFor = (par, index) => par + index + 2;
const TOLERANCE = 4;

// ── What index a CARD plays to ──────────────────────────────────────
// One man's own, or — on a shared ball — the side's, taken off the allowance
// the format catalog already keeps for exactly this pair of numbers (35/15 on
// a scramble, 60/40 on a Pinehurst). Read from there rather than restated
// here, so a generated demo card and the handicap the app hands that same pair
// cannot drift apart. Two men who play to 9 and 19 post a scramble ball around
// a 6, which is what a scramble looks like.
const cardIndex = (format, men) => {
  const indexes = men.map(m => m.index);
  if (indexes.length === 1) return indexes[0];
  const spec = allowanceDefaultFor(format);
  const [low, high] = [...indexes].sort((a, b) => a - b);
  if (isSplitAllowance(spec)) return (low * spec.low + high * spec.high) / 100;
  const mean = indexes.reduce((a, b) => a + b, 0) / indexes.length;
  return mean * (spec.pct ?? 100) / 100;
};

const roundFor = (pars, index, seedBase) => {
  const target = targetFor(pars.reduce((a, b) => a + b, 0), index);
  let best = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    const r = rng(seedBase + attempt * 7919);
    const holes = pars.map(p => grossFor(p, index, r));
    const miss = Math.abs(holes.reduce((a, b) => a + b, 0) - target);
    if (miss <= TOLERANCE) return holes;
    if (!best || miss < best.miss) best = { holes, miss };
  }
  return best.holes;
};

export const buildDemo = ({ countdown = false } = {}) => {
  const rounds = roundsFor(countdown);
  // R1 complete, R2 stopped at the turn — plus a whole round 4 on a dry run,
  // which is the only way there is anything to turn over.
  const scored = countdown ? { ...SCORED, 4: 18 } : SCORED;
  const out = Object.fromEntries(DEMO_COLLECTIONS.map(c => [c, []]));
  const courseOf = (key) => COURSES.find(c => c.key === key);
  const nameOf = (key) => FIELD.find(p => p.key === key)?.name || key;

  // The edition itself. `namespaced: true` is what keeps every singleton doc
  // id prefixed (`bc_demo__team_names`) and therefore out of bc_2025's way.
  out.bc_editions.push({
    id: DEMO_EDITION_ID,
    year: DEMO_YEAR,
    name: DEMO_NAME,
    status: "published",
    namespaced: true,
    created_from: null,
    // The flag that keeps the invented field out of the real record. Both
    // places the app reaches across editions read it — the Data tab's fold
    // and cloneEdition — see `isDemoEdition` in lib/editions. Without it a
    // tester switching to the demo would see Dave R in the career table
    // beside ten years of the actual field, and a 2026 cup that was never
    // played sitting in the tournament records.
    is_demo: true,
    // Said out loud, though false is already the default everywhere (see
    // isEditionLocked and firestore.rules). A locked demo is a demo nobody can
    // test in — every tester would find their scores refused, and the one
    // person who could not reproduce it is the director, who is exempt from
    // the lock. `bulkLockVerdict` now leaves demos alone for the same reason;
    // this is the belt to that brace.
    locked: false,
    seeded_from: DEMO_MARK,
  });

  out.bc_settings.push(stamp({
    id: id("tournament"),
    name: DEMO_NAME,
    location: "Gaylord, Michigan",
    start_date: DEMO_START,
    end_date: DEMO_END,
  }));
  out.bc_settings.push(stamp({ id: id("team_names"), teamA: "Mash Brothers", teamB: "Shot Callers" }));
  // Trip Info's one genuinely new fact. A generic search URL rather than a
  // listing that will 404 in six months in front of a reviewer.
  out.bc_settings.push(stamp({
    id: id("trip"),
    house_name: "The Lodge on Otsego Lake",
    house_url: "https://www.vrbo.com/vacation-rentals/usa/michigan/gaylord",
  }));

  // The Betting tab, with something in it. Small round numbers so nothing
  // reads as a real pot somebody owes into.
  out.bc_tournament_settings.push(stamp({
    id: id("bc_settings_main"),
    skins_pot: 240,
    skins_buyin: 20,
    ctp_buyin: 10,
    lownet_buyin: 10,
    // The money hole, on the hole the cup actually plays it. Written rather
    // than left to default so a reviewer opening the tab finds a pot on it
    // and not an empty game.
    money_hole_buyin: 10,
    money_hole_number: 18,
  }));

  FIELD.forEach((p) => {
    out.bc_players.push(stamp({
      id: demoPlayerId(p.key),
      player_id: demoPlayerId(p.key),
      name: p.name,
      first_name: p.first,
      last_name: p.last,
      team: p.team,
      handicap_index: p.index,
      // Explicitly null: unclaimed and claimable, which is what a tester needs
      // to find when they reach the claim screen.
      auth_uid: null,
    }));
  });

  COURSES.forEach((c) => {
    out.bc_courses.push(stamp({
      id: demoCourseId(c.key),
      name: c.name,
      par: c.par,
      rating: c.rating,
      slope: c.slope,
      hole_pars: c.pars,
      hole_handicaps: c.sis,
      // Per-hole yardage hangs off the TEE, not off the course — see
      // `courseTees` in lib/tripInfo, which reads `hole_yards` per box. Two
      // tees, because the scorecard behind a Trip Info row has a tee picker
      // and one box gives it nothing to pick between.
      tee_boxes: [
        {
          name: "Blue", color: "#2f6fd0", rating: c.rating, slope: c.slope, par: c.par,
          yardage: total(c.yards), hole_yards: c.yards,
        },
        {
          name: "White", color: "#d9d9d9", rating: c.rating - 2.1, slope: c.slope - 6, par: c.par,
          yardage: total(c.yards.map(shorter)), hole_yards: c.yards.map(shorter),
        },
      ],
    }));
  });

  rounds.forEach((r) => {
    out.bc_rounds.push(stamp({
      id: id(`bc_round_${r.round}`),
      round_number: r.round,
      format: r.format,
      course_id: demoCourseId(r.course),
      tee_box: "Blue",
      tee_time: r.tee,
      date: r.date,
      // Only the countdown round carries these, and only the keys it set —
      // an undefined would be written as a missing field on every other
      // round and read back as "the director never chose", which is true.
      ...(r.scoring_type ? { scoring_type: r.scoring_type } : null),
      ...(r.hole_points ? { hole_points: r.hole_points } : null),
      ...(r.counting_scores ? { counting_scores: r.counting_scores } : null),
      ...(r.sealed ? { sealed: true, reveal_through: 0 } : null),
    }));

    const draw = pairsFor(r.round, countdown);
    draw.forEach((m) => {
      const a = m.teamA.map(demoPlayerId);
      const b = m.teamB.map(demoPlayerId);
      out.bc_matches.push(stamp({
        id: id(matchBareId(r.round, a, b)),
        round: r.round,
        teamA: a,
        teamB: b,
        teamANames: m.teamA.map(nameOf),
        teamBNames: m.teamB.map(nameOf),
      }));
    });

    // Tee sheet: one group per match in the team rounds, and the singles
    // paired up two matches to a group so nobody walks eighteen holes alone.
    const groups = r.round === 4 && countdown
      // Nobody rides with an opponent on a Team Best Ball: each side splits
      // into waves, which is what the Scoring tab's tee groups read (see
      // scoringUnits in lib/groups) and what the real round 4 looks like.
      ? [...waves(A.map(a => a.key)), ...waves(B.map(b => b.key))]
          .map(players => ({ players: players.map(demoPlayerId) }))
      : r.round === 4
        // Singles, paired up two matches to a group so nobody walks alone.
        // Counted off the draw rather than hardcoded: it was [0, 2, 4], which
        // is three groups whatever the field is, and silently left the last
        // four men off the tee sheet the moment there were sixteen.
        ? draw.reduce((out, _m, i) => (i % 2 ? out : [...out, i]), [])
            .map(i => ({
              players: [draw[i], draw[i + 1]].filter(Boolean)
                .flatMap(m => [...m.teamA, ...m.teamB]).map(demoPlayerId),
            }))
        : draw.map(m => ({ players: [...m.teamA, ...m.teamB].map(demoPlayerId) }));
    out.bc_groups.push(stamp({ id: id(`bc_groups_r${r.round}`), round_number: r.round, groups }));
  });

  // Hole scores. Seeded per (round, card) so adding a round later cannot
  // shift the numbers in the rounds before it.
  rounds.forEach((r) => {
    const holes = scored[r.round] || 0;
    if (!holes) return;
    const course = courseOf(r.course);
    // ── One ball, one card ──
    // A scramble or Pinehurst side plays a SINGLE ball, so both partners'
    // documents have to carry the same number. That is what the engine scores
    // off (scoring.sharedBallScore) and what the scoring screen writes
    // (App.onTapScore) — but this generated a card per MAN whatever the
    // format, which put two different scores on one ball. The scorecard then
    // printed one partner's gross over a net taken off the other's, and every
    // hole the partner had beaten him on read as a handicap stroke that no dot
    // on the row accounted for. A reviewer opening round 2 met a scramble
    // whose arithmetic did not work.
    //
    // Non-shared rounds are one card per man, in FIELD order, which is what
    // this always did — round 1 and the countdown round are untouched.
    const cards = formatIsSharedBall(r.format)
      ? pairsFor(r.round, countdown).flatMap(m => [m.teamA, m.teamB])
      : FIELD.map(p => [p.key]);
    cards.forEach((keys, ci) => {
      const men = keys.map(k => FIELD.find(p => p.key === k));
      // The whole round is generated even when only the front nine is kept:
      // a nine sampled against an eighteen-hole target would come out twice as
      // far under it, and round 2's half-finished cards would show everybody
      // four under through the turn.
      const full = roundFor(course.pars, cardIndex(r.format, men), r.round * 9973 + ci * 131);
      keys.forEach((key) => {
        for (let h = 1; h <= holes; h++) {
          out.bc_hole_scores.push(stamp({
            id: id(`bc_hs_r${r.round}_${demoPlayerId(key)}_h${h}`),
            player_id: demoPlayerId(key),
            round_number: r.round,
            hole_number: h,
            score: full[h - 1],
            course_id: demoCourseId(r.course),
          }));
        }
      });
    });
  });

  // One settled closest-to-the-pin, so the CTP board is not empty and the
  // Betting tab has a name on it. Round 1's first par 3.
  //
  // `hole` is ZERO-BASED here while the document id is one-based — that is
  // what `onSetCtp` writes (`bc_ctp_r${round}_h${hole+1}`) and what the reader
  // keys on (`${r.round}_${r.hole}`). Getting it one out puts the tag on the
  // wrong hole on screen while the id still looks right, which is the kind of
  // wrong that survives a glance.
  const r1 = courseOf("pinecrest");
  const parThree = r1.pars.findIndex(p => p === 3);
  out.bc_ctp.push(stamp({
    id: id(`bc_ctp_r1_h${parThree + 1}`),
    round: 1,
    hole: parThree,
    player_id: demoPlayerId("chris"),
    distance_ft: 14,
    // Settled, so the on-course prompt does not reopen it at a tester.
    approved: true,
    tagged_by: demoPlayerId("chris"),
    tagged_group_key: null,
    tagged_group_order: null,
    confirmed_by: [],
  }));

  // Admin → Budget, so a director reviewer sees the feature rather than an
  // empty tab. Priced the way a director actually knows each line — the house
  // as one number, the golf per man.
  [
    { key: "house", category: "lodging", label: "The Lodge on Otsego Lake — 3 nights", amount: 4200, basis: "total" },
    { key: "golf", category: "golf", label: "4 rounds with carts", amount: 340, basis: "per_man" },
    { key: "food", category: "food", label: "Saturday dinner", amount: 780, basis: "total" },
    { key: "prizes", category: "prizes", label: "Trophy engraving and skins pot", amount: 300, basis: "total" },
  ].forEach((l) => {
    out.bc_budget.push(stamp({
      id: id(`bc_budget_${l.key}`),
      category: l.category,
      label: l.label,
      amount: l.amount,
      basis: l.basis,
      created_by: null,
      created_at: 0,
    }));
  });

  return out;
};

export const countDemoDocs = (built) =>
  DEMO_COLLECTIONS.reduce((n, c) => n + (built?.[c]?.length || 0), 0);

// ── What the writer stores, and why the id stays on the document ────
// Each built document paired with the id it is filed under — and it is the
// SAME object, not a copy with `id` taken off it.
//
// The writer used to destructure the id out to name the Firestore document
// (`const { id, ...rest } = doc`), which is the one place an id is not needed
// as a field, and stored the rest. That is not how anything else in this
// project is written: `db.get` and `db.subscribe` hand back `d.data()` and
// nothing else, so EVERY document in this app carries its own id as a field,
// and `scripts/import-history.mjs` writes the whole document for that reason.
//
// A demo written without it is a tournament the app cannot identify. The
// picker's Open button calls `switchEdition(e.id)` — `undefined` for the demo
// row, so `setActiveTournamentId` bailed on the falsy id and the reload landed
// back on the edition you were already in. Behind that, every settings, round,
// course and match lookup is `rows.find(r => r.id === …)` and would have
// missed as well: no tournament name, no rounds, no draw.
//
// Pure and exported so the payload the writer commits is the thing under test,
// rather than the builder's output that was always right.
export const demoWrites = (built) =>
  DEMO_COLLECTIONS.flatMap((col) => (built?.[col] || []).map((doc) => ({ col, id: doc.id, doc })));

// ── What a re-seed has to take back out ─────────────────────────────
// The writer uses `set(…, { merge: true })`, which corrects a changed field
// and CANNOT remove a document that has stopped existing. That gap is
// invisible and it scores.
//
// The case that found it: `--countdown` replaces round 4's six singles matches
// with one Team Best Ball. Merge-writing over an older seed leaves the six in
// place — same round, same players, summing the same hole scores — so round 4
// holds seven matches and the Final Countdown opens whichever one sorts first.
// Nothing errors. The dry run just quietly rehearses the wrong thing.
//
// So a full seed prunes, and the line it draws is the one `--undo` draws:
// ONLY documents carrying this seed's mark. A card a tester signed in the demo
// is theirs, not the seed's to tidy away.
//
// `existing` is `[{ col, id, mark }]` read back from Firestore. Returns the
// subset to delete, as `{ col, id }`.
export const stalePaths = (existing, built) => {
  const wanted = new Set(demoWrites(built).map(({ col, id }) => `${col}/${id}`));
  return (existing || [])
    .filter(d => d.mark === DEMO_MARK && !wanted.has(`${d.col}/${d.id}`))
    .map(({ col, id }) => ({ col, id }));
};

// ── Adding a tester ─────────────────────────────────────────────────
// The seeded field is enough for testing, but a real tester often wants to see
// their OWN name on the leaderboard rather than claim "Pete V" — and one more
// man is one row, not a re-seed.
//
// A director can do the same thing from Admin → Players while switched to the
// demo, and that is the easier path for one person. This exists for a handful
// at once, and because a row added here is STAMPED — so `--undo` takes it back
// out with everything else, and the writer's "does this edition hold anything
// I did not write" check keeps passing.
//
// The row lands unclaimed, like the rest of the field: claiming is something the
// person does on the claim screen, and a row carrying somebody else's uid is
// a row they cannot claim and the director cannot unclaim.
export const demoPlayerSlug = (name) =>
  String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24);

export const buildDemoPlayer = ({ name, team, index }) => {
  const clean = String(name || "").trim();
  if (!clean) return { ok: false, error: "A player needs a name." };
  const slug = demoPlayerSlug(clean);
  if (!slug) return { ok: false, error: `\`${clean}\` has no letters or digits in it to build an id from.` };
  const side = String(team || "").toUpperCase() === "B" ? "B" : "A";
  const hi = Number(index);
  if (!Number.isFinite(hi) || hi < -10 || hi > 54) {
    return { ok: false, error: `\`${index}\` is not a handicap index. Plus handicaps are negative here (see lib/ghin).` };
  }
  // The display form the whole app renders — first name, last initial — is
  // whatever was typed; there is no roster to reconcile against on a demo.
  const [first, ...rest] = clean.split(/\s+/);
  return {
    ok: true,
    player: stamp({
      id: `demo_${slug}`,
      player_id: `demo_${slug}`,
      name: clean,
      first_name: first,
      ...(rest.length ? { last_name: rest.join(" ") } : {}),
      team: side,
      handicap_index: hi,
      auth_uid: null,
    }),
  };
};

// The ids the seed itself owns, so the writer can tell a tester's added row
// from one of the seeded field and refuse to overwrite the wrong thing.
export const SEEDED_PLAYER_IDS = FIELD.map(p => demoPlayerId(p.key));
