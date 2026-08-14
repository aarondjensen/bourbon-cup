// ══════════════════════════════════════════════════════════════════
//  demoSeed — a tournament for testers, that is not the tournament.
// ══════════════════════════════════════════════════════════════════
//
// `docs/store-submission.md` §1.4 asks for a throwaway edition before either
// store submission, and the Play closed test needs the same thing for a
// different reason: twelve people have to USE the app for fourteen days, and
// Google now refuses production access when they demonstrably did not. A
// tester who can only look is a tester who generates nothing.
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

export const DEMO_EDITION_ID = "bc_demo";
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
// App Review, to Google, and to whoever fills the closed test out to twelve —
// seeding the real roster would put sixteen named men's handicaps in front of
// all of them for no benefit.
//
// Twelve, because that is the number Play wants opted in, so there is a row
// for each tester to claim and nobody is left spectating.
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
const A_PAIRS = [[0, 1], [2, 3], [4, 5]];
const B_PAIRS = [[0, 1], [2, 3], [4, 5]];

const pairsFor = (round) => {
  if (round === 4) return A.map((a, i) => ({ teamA: [a.key], teamB: [B[i].key] }));
  return A_PAIRS.map((ap, g) => {
    const bp = B_PAIRS[(g + round - 1) % 3];
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

export const buildDemo = () => {
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
    // test in — the twelve testers would find every score refused, and the one
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

  ROUNDS.forEach((r) => {
    out.bc_rounds.push(stamp({
      id: id(`bc_round_${r.round}`),
      round_number: r.round,
      format: r.format,
      course_id: demoCourseId(r.course),
      tee_box: "Blue",
      tee_time: r.tee,
      date: r.date,
    }));

    const draw = pairsFor(r.round);
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
    const groups = r.round === 4
      ? [0, 2, 4].map(i => ({ players: [...draw[i].teamA, ...draw[i].teamB, ...draw[i + 1].teamA, ...draw[i + 1].teamB].map(demoPlayerId) }))
      : draw.map(m => ({ players: [...m.teamA, ...m.teamB].map(demoPlayerId) }));
    out.bc_groups.push(stamp({ id: id(`bc_groups_r${r.round}`), round_number: r.round, groups }));
  });

  // Hole scores. Seeded per (round, player) so adding a round later cannot
  // shift the numbers in the rounds before it.
  ROUNDS.forEach((r) => {
    const holes = SCORED[r.round] || 0;
    if (!holes) return;
    const course = courseOf(r.course);
    FIELD.forEach((p, pi) => {
      // The whole round is generated even when only the front nine is kept:
      // a nine sampled against an eighteen-hole target would come out twice as
      // far under it, and round 2's half-finished cards would show everybody
      // four under through the turn.
      const full = roundFor(course.pars, p.index, r.round * 9973 + pi * 131);
      for (let h = 1; h <= holes; h++) {
        out.bc_hole_scores.push(stamp({
          id: id(`bc_hs_r${r.round}_${demoPlayerId(p.key)}_h${h}`),
          player_id: demoPlayerId(p.key),
          round_number: r.round,
          hole_number: h,
          score: full[h - 1],
          course_id: demoCourseId(r.course),
        }));
      }
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

// ── Adding a tester ─────────────────────────────────────────────────
// The twelve seeded golfers are enough for the Play closed test, but a real
// tester often wants to see their OWN name on the leaderboard rather than
// claim "Pete V" — and a thirteenth man is one row, not a re-seed.
//
// A director can do the same thing from Admin → Players while switched to the
// demo, and that is the easier path for one person. This exists for a handful
// at once, and because a row added here is STAMPED — so `--undo` takes it back
// out with everything else, and the writer's "does this edition hold anything
// I did not write" check keeps passing.
//
// The row lands unclaimed, like the seeded twelve: claiming is something the
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
// from one of the twelve and refuse to overwrite the wrong thing.
export const SEEDED_PLAYER_IDS = FIELD.map(p => demoPlayerId(p.key));
