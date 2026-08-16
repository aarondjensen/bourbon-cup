import { describe, it, expect } from "vitest";
import {
  buildDemo, countDemoDocs, demoWrites, DEMO_COLLECTIONS, DEMO_EDITION_ID, DEMO_MARK,
  demoPlayerId, DEMO_START, DEMO_END, DEMO_YEAR, buildDemoPlayer, SEEDED_PLAYER_IDS,
} from "./demoSeed";
import { todayISO, addDays } from "./dates";
import { isDemoEdition } from "./editions";
import { courseScorecard, coursePar } from "./tripInfo";
import { computeMatchResult } from "../scoring";

// ══════════════════════════════════════════════════════════════════
//  The demo edition — the two things that would ruin it.
// ══════════════════════════════════════════════════════════════════
//
// This seed is written to the LIVE Firebase project, beside the real cup, and
// handed to App Review and to a dozen testers. Two failures matter more than
// everything else here:
//
//   1. A document that lands outside `bc_demo`. Every id is namespaced and
//      every row carries tournament_id — if either slips, the demo's roster
//      appears inside bc_2025 and a director gets to find out by looking.
//   2. A document the app cannot read. A misspelled field does not throw; it
//      renders as a blank card or a zero, and nobody notices until a reviewer
//      opens the tab.
//
// So the tests below check containment first, then feed the built documents to
// the app's OWN readers rather than asserting on shapes this file made up.

const built = buildDemo();
const all = DEMO_COLLECTIONS.flatMap(c => built[c]);

describe("containment — nothing escapes the demo edition", () => {
  it("stamps every document with the demo tournament id", () => {
    // bc_editions is the edition itself and carries `id`, not tournament_id.
    const data = all.filter(d => d.id !== DEMO_EDITION_ID);
    expect(data.length).toBeGreaterThan(200);
    for (const d of data) expect(d.tournament_id).toBe(DEMO_EDITION_ID);
  });

  it("namespaces every document id under bc_demo", () => {
    // The edition is namespaced, so singleton and per-round ids are prefixed
    // (`bc_demo__team_names`). The exceptions are the edition document and the
    // roster rows, whose ids are their own player ids.
    for (const d of all) {
      const own = d.id === DEMO_EDITION_ID || d.id.startsWith("demo_");
      expect(own || d.id.startsWith(`${DEMO_EDITION_ID}__`), `${d.id} is not namespaced`).toBe(true);
    }
  });

  it("marks every document so --undo can be exact", () => {
    for (const d of all) expect(d.seeded_from).toBe(DEMO_MARK);
  });

  it("cannot collide with a hand-built or imported edition's ids", () => {
    // The app mints bc_player_<ms> and the history import mints
    // hist_<year>_<name>. Neither shape can be produced here, which is what
    // stops a demo row sitting beside a real one inside one edition.
    for (const d of all) {
      expect(d.id).not.toMatch(/^bc_player_\d+$/);
      expect(d.id).not.toMatch(/^hist_/);
    }
  });
});

describe("the field", () => {
  const players = built.bc_players;

  it("is twelve, six a side — one row per Play tester", () => {
    expect(players).toHaveLength(12);
    expect(players.filter(p => p.team === "A")).toHaveLength(6);
    expect(players.filter(p => p.team === "B")).toHaveLength(6);
  });

  it("leaves every row unclaimed and claimable", () => {
    // A tester reaching the claim screen has to find a free name. An invented
    // auth_uid would be a row nobody can claim and nobody can unclaim — the
    // rules only allow a claim that writes the CALLER's uid.
    for (const p of players) expect(p.auth_uid).toBeNull();
  });

  it("invents everybody", () => {
    // Guards against somebody "improving" the demo by pasting the real roster
    // in. This edition goes to Google, to Apple and to a dozen strangers.
    for (const p of players) expect(p.id).toMatch(/^demo_[a-z]+$/);
  });
});

describe("the courses read through the app's own scorecard", () => {
  it.each(["Pinecrest National", "Harbor Dunes Links"])("%s draws a full card", (name) => {
    const course = built.bc_courses.find(c => c.name === name);
    const card = courseScorecard(course, 0);
    expect(card, "courseScorecard returned null — hole_pars is missing or empty").not.toBeNull();
    expect(card.holes).toHaveLength(18);
    // Every hole has a par, a stroke index and a yardage. A zero in any of
    // them prints as a dash on a card a reviewer opens.
    for (const h of card.holes) {
      expect(h.par).toBeGreaterThan(2);
      expect(h.hcp, `hole ${h.hole} has no stroke index`).not.toBeNull();
      expect(h.yards, `hole ${h.hole} has no yardage`).toBeGreaterThan(100);
    }
  });

  it("indexes each course 1..18 exactly once", () => {
    // A duplicated stroke index silently changes who gets a shot where, which
    // is the one thing on a demo card that would be wrong rather than fake.
    for (const c of built.bc_courses) {
      expect([...c.hole_handicaps].sort((a, b) => a - b)).toEqual(
        Array.from({ length: 18 }, (_, i) => i + 1)
      );
    }
  });

  it("agrees with itself about par", () => {
    // coursePar prefers the scorecard over the stored `par` field precisely
    // because the two can disagree. Here they must not — that is the "Par 71
    // at the top, 72 at the bottom" failure the app already guards against.
    for (const c of built.bc_courses) {
      expect(coursePar(c), `${c.name}`).toBe(c.par);
    }
  });

  it("gives the forward tee its own shorter card", () => {
    for (const c of built.bc_courses) {
      const blue = courseScorecard(c, 0).totals.total.yards;
      const white = courseScorecard(c, 1).totals.total.yards;
      expect(white).toBeLessThan(blue);
      expect(white).toBeGreaterThan(blue * 0.85);
    }
  });
});

describe("the week", () => {
  it("dates every round inside the trip", () => {
    // The day picker on a round offers the days between the tournament's
    // start and end, so a round dated outside them is a round the director
    // could not have entered and Trip Info cannot place.
    for (const r of built.bc_rounds) {
      expect(r.date >= DEMO_START && r.date <= DEMO_END, `round ${r.round_number} on ${r.date}`).toBe(true);
    }
  });

  it("points every round at a course that exists", () => {
    const ids = new Set(built.bc_courses.map(c => c.id));
    for (const r of built.bc_rounds) expect(ids.has(r.course_id)).toBe(true);
  });

  it("puts the trip around today, so the demo is never stale", () => {
    // The first cut pinned this to a fixed weekend in July 2026, which went
    // past — and the demo then advertised a trip that had finished a month
    // earlier on the one screen a reviewer opens to ask "when is this".
    const today = todayISO();
    expect(DEMO_START).toBe(addDays(today, -1));
    expect(DEMO_END).toBe(addDays(today, 1));
    expect(DEMO_START < today && today < DEMO_END).toBe(true);
  });

  it("dates the rounds so the seeded scores tell the truth about them", () => {
    // R1 is complete and R2 is nine holes in (see SCORED). If R1 were dated
    // tomorrow the demo would show a finished round that has not been played,
    // and if R2 were dated yesterday it would show a round abandoned at the
    // turn rather than one in progress.
    const on = (n) => built.bc_rounds.find(r => r.round_number === n).date;
    expect(on(1)).toBe(addDays(todayISO(), -1));   // played out
    expect(on(2)).toBe(todayISO());                // half done — where a tester comes in
    expect(on(3)).toBe(todayISO());                // this afternoon, empty
    expect(on(4)).toBe(addDays(todayISO(), 1));    // tomorrow, empty
  });

  it("files the edition under the year its rounds are in", () => {
    // Hardcoding 2026 meant a demo seeded in January would sort into last year
    // in the picker while its rounds were dated this one.
    expect(String(DEMO_YEAR)).toBe(todayISO().slice(0, 4));
    expect(built.bc_editions[0].year).toBe(DEMO_YEAR);
  });

  it("keeps dates as strings, never Date objects", () => {
    // new Date("2026-07-17") is UTC midnight, which in Michigan is the evening
    // of the 16th. lib/dates owns this decision for the whole app.
    const t = built.bc_settings.find(s => s.id.endsWith("__tournament"));
    expect(typeof t.start_date).toBe("string");
    expect(typeof t.end_date).toBe("string");
    for (const r of built.bc_rounds) expect(typeof r.date).toBe("string");
  });
});

describe("the draw", () => {
  const pidsOf = (m) => [...m.teamA, ...m.teamB];

  it("puts every player in exactly one match per round", () => {
    for (const round of [1, 2, 3, 4]) {
      const ms = built.bc_matches.filter(m => m.round === round);
      const pids = ms.flatMap(pidsOf);
      expect(new Set(pids).size, `round ${round} has somebody twice`).toBe(12);
    }
  });

  it("never puts a player against their own side", () => {
    const teamOf = Object.fromEntries(built.bc_players.map(p => [p.id, p.team]));
    for (const m of built.bc_matches) {
      for (const p of m.teamA) expect(teamOf[p]).toBe("A");
      for (const p of m.teamB) expect(teamOf[p]).toBe("B");
    }
  });

  it("never repeats an opponent across the team rounds", () => {
    // The rotation is the only reason the Matches tab is worth opening twice.
    const seen = new Set();
    for (const m of built.bc_matches.filter(x => x.round <= 3)) {
      for (const a of m.teamA) for (const b of m.teamB) {
        const key = `${a}|${b}`;
        expect(seen.has(key), `${key} meet twice`).toBe(false);
        seen.add(key);
      }
    }
  });

  it("sits everybody in a group in every round", () => {
    for (const g of built.bc_groups) {
      const pids = g.groups.flatMap(x => x.players);
      expect(new Set(pids).size, `round ${g.round_number} tee sheet`).toBe(12);
    }
  });
});

describe("the scores", () => {
  const holes = built.bc_hole_scores;

  it("finishes round 1 and stops round 2 at the turn", () => {
    // R1 complete so the leaderboard is not empty on first open; R2 half done
    // so a tester has something to actually DO, which is the whole point.
    expect(holes.filter(h => h.round_number === 1)).toHaveLength(12 * 18);
    expect(holes.filter(h => h.round_number === 2)).toHaveLength(12 * 9);
    expect(holes.filter(h => h.round_number > 2)).toHaveLength(0);
  });

  it("writes ids the app would write, so a tester's edit lands on the same doc", () => {
    // App.onSaveHole builds `bc_hs_r${rnd}_${pid}_h${holeIdx + 1}`. If the seed
    // used any other shape, a tester correcting a score would create a SECOND
    // document for that hole and the two would fight.
    const h = holes.find(x => x.round_number === 1 && x.player_id === demoPlayerId("dave") && x.hole_number === 7);
    expect(h.id).toBe(`${DEMO_EDITION_ID}__bc_hs_r1_${demoPlayerId("dave")}_h7`);
  });

  it("gives each man a round his handicap explains", () => {
    // THE test in this file. The first cut sampled eighteen holes
    // independently and had a 16.8 index shoot 76 while an 11.0 shot 95 —
    // which no golfer looking at the card would forgive, and which fed the
    // engine net scores that produced eight-up blowouts. The demo leaderboard
    // read as a broken app rather than as a tournament.
    const players = Object.fromEntries(built.bc_players.map(p => [p.id, p]));
    const course = built.bc_courses.find(c => c.name === "Pinecrest National");
    const totals = {};
    for (const h of holes.filter(x => x.round_number === 1)) {
      totals[h.player_id] = (totals[h.player_id] || 0) + h.score;
    }
    for (const [pid, gross] of Object.entries(totals)) {
      const target = course.par + players[pid].handicap_index + 2;
      expect(Math.abs(gross - target), `${players[pid].name} shot ${gross}, expected about ${Math.round(target)}`)
        .toBeLessThanOrEqual(6);
    }
  });

  it("puts the low indexes ahead of the high ones", () => {
    // Weaker than the band above and catches a different thing: a generator
    // that centred every round on the same number would pass the band test
    // for the mid handicaps and still rank the field at random.
    const players = Object.fromEntries(built.bc_players.map(p => [p.id, p]));
    const totals = {};
    for (const h of holes.filter(x => x.round_number === 1)) {
      totals[h.player_id] = (totals[h.player_id] || 0) + h.score;
    }
    const rows = Object.entries(totals).map(([pid, gross]) => ({ index: players[pid].handicap_index, gross }));
    const lowSix = rows.sort((a, b) => a.index - b.index).slice(0, 6);
    const highSix = rows.slice(6);
    const avg = (rs) => rs.reduce((n, r) => n + r.gross, 0) / rs.length;
    expect(avg(lowSix)).toBeLessThan(avg(highSix) - 4);
  });

  it("is plausible golf, not noise", () => {
    for (const h of holes) {
      expect(h.score).toBeGreaterThanOrEqual(2);
      expect(h.score).toBeLessThanOrEqual(9);
    }
    const avg = holes.reduce((n, h) => n + h.score, 0) / holes.length;
    expect(avg).toBeGreaterThan(4.0);
    expect(avg).toBeLessThan(5.6);
  });

  it("is the same on every run", () => {
    // Idempotency is the whole reason the PRNG is seeded. A re-run that
    // rewrote three hundred holes with new numbers would change a card a
    // tester had already started correcting.
    const again = buildDemo();
    expect(again.bc_hole_scores.map(h => h.score)).toEqual(holes.map(h => h.score));
    expect(countDemoDocs(again)).toBe(countDemoDocs(built));
  });
});

describe("it scores through the app's own engine", () => {
  // The strongest check available without a browser, and the same instinct as
  // historyVerify: do not seed a tournament you cannot prove renders. A demo
  // that produced an empty leaderboard would look exactly like a working one
  // until a reviewer opened it.
  //
  // holeData is keyed `${pid}_${round}` → { holeIndex: score }, ZERO-based on
  // the index — the store is one-based, and App builds this map on the way in.
  const holeData = {};
  for (const h of built.bc_hole_scores) {
    const key = `${h.player_id}_${h.round_number}`;
    (holeData[key] ||= {})[h.hole_number - 1] = h.score;
  }
  const rounds = built.bc_rounds;
  const courses = built.bc_courses;
  const players = built.bc_players;

  it("produces a real result for every completed round-1 match", () => {
    const r1 = built.bc_matches.filter(m => m.round === 1);
    expect(r1).toHaveLength(3);
    for (const m of r1) {
      const res = computeMatchResult(m, holeData, courses, rounds, players, "best_ball", {}, undefined, {}, []);
      // 18 holes scored means 18 holes played out, not a card that ran dry.
      expect(res.holes, `match ${m.id} scored no holes`).toHaveLength(18);
      expect(typeof res.status).toBe("string");
      expect(res.status.length).toBeGreaterThan(0);
      // The points a match is worth are per SIDE — { A, B } — and have to be
      // numbers. A NaN here is what a missing nassau or a broken handicap
      // looks like once it reaches the leaderboard.
      for (const k of ["frontPts", "backPts", "overallPts", "totalPts"]) {
        for (const side of ["A", "B"]) {
          expect(Number.isFinite(res[k][side]), `${m.id}.${k}.${side} is ${res[k][side]}`).toBe(true);
        }
      }
      // Somebody won something. Three matches all worth nothing to either side
      // is a scoring engine that ran and decided nothing.
      expect(res.totalPts.A + res.totalPts.B).toBeGreaterThan(0);
      // And the strokes were actually allocated — an empty stroke map means
      // every net score equalled its gross, which is not this app.
      expect(Object.keys(res.strokeMaps || {}).length).toBe(4);
    }
  });

  it("does not hand every match to one side", () => {
    // A demo where one team wins everything reads as broken scoring rather
    // than as a tournament, and it is what a mis-wired handicap produces.
    const statuses = built.bc_matches
      .filter(m => m.round === 1)
      .map(m => computeMatchResult(m, holeData, courses, rounds, players, "best_ball", {}, undefined, {}, []).status);
    expect(new Set(statuses).size).toBeGreaterThan(1);
  });

  it("scores the half-finished round 2 without falling over", () => {
    // Nine holes in is the state a tester finds it in, and a partial card is
    // where an engine is most likely to divide by something absent.
    for (const m of built.bc_matches.filter(x => x.round === 2)) {
      const res = computeMatchResult(m, holeData, courses, rounds, players, "scramble", {}, undefined, {}, []);
      expect(res.holes).toHaveLength(18);
      expect(res.holes.filter(h => h && h.decided).length).toBeLessThanOrEqual(9);
    }
  });
});

describe("the test golfers cannot reach a real tournament", () => {
  // The guarantee, and it is NOT the tournament_id filter — that only covers
  // the screens that read one edition. The two places the app deliberately
  // reaches ACROSS editions are where invented golfers would surface:
  //
  //   the Data tab   folds whichever edition is open into ten years of career
  //                  records (lib/archiveLive), so Dave R would appear in the
  //                  career table beside the real field and a 2026 cup that
  //                  was never played would join the tournament records.
  //   cloneEdition   copies a roster forward, so next year's real tournament
  //                  would open with twelve men nobody invited.
  //
  // Both read `isDemoEdition`, and the edition document is what carries it.
  it("marks the edition as a demo", () => {
    const edition = built.bc_editions[0];
    expect(edition.is_demo).toBe(true);
    expect(isDemoEdition(edition)).toBe(true);
  });

  it("does not mark a real edition by accident", () => {
    // The flag has to be opt-in, or a missing field somewhere turns a real
    // tournament into one that contributes nothing to its own records.
    expect(isDemoEdition({ id: "bc_2025", year: 2025 })).toBe(false);
    expect(isDemoEdition({ id: "bc_2026", is_demo: false })).toBe(false);
    expect(isDemoEdition(null)).toBe(false);
    expect(isDemoEdition(undefined)).toBe(false);
    // Not truthiness — a stray string would otherwise silently qualify.
    expect(isDemoEdition({ is_demo: "yes" })).toBe(false);
  });
});

describe("adding a tester", () => {
  it("builds a claimable row scoped to the demo", () => {
    const { ok, player } = buildDemoPlayer({ name: "Aaron J", team: "A", index: 12.4 });
    expect(ok).toBe(true);
    expect(player.id).toBe("demo_aaronj");
    expect(player.tournament_id).toBe(DEMO_EDITION_ID);
    expect(player.seeded_from).toBe(DEMO_MARK);   // so --undo still gets them
    expect(player.auth_uid).toBeNull();           // so they can claim it
    expect(player.team).toBe("A");
    expect(player.handicap_index).toBe(12.4);
  });

  it("defaults to team A rather than inventing a third side", () => {
    expect(buildDemoPlayer({ name: "X Y", team: "", index: 5 }).player.team).toBe("A");
    expect(buildDemoPlayer({ name: "X Y", team: "b", index: 5 }).player.team).toBe("B");
    expect(buildDemoPlayer({ name: "X Y", team: "purple", index: 5 }).player.team).toBe("A");
  });

  it("refuses input that would write a broken row", () => {
    expect(buildDemoPlayer({ name: "", index: 5 }).ok).toBe(false);
    expect(buildDemoPlayer({ name: "   ", index: 5 }).ok).toBe(false);
    // A name with nothing to slug would collide on `demo_` with the next one.
    expect(buildDemoPlayer({ name: "!!!", index: 5 }).ok).toBe(false);
    expect(buildDemoPlayer({ name: "A B", index: "abc" }).ok).toBe(false);
    expect(buildDemoPlayer({ name: "A B", index: 99 }).ok).toBe(false);
  });

  it("accepts a plus handicap, which this app stores negative", () => {
    // GHIN writes "+2.1" for better than scratch and the app models it as
    // -2.1 (see lib/ghin). A validator that rejected negatives would refuse
    // the best golfer in the field.
    expect(buildDemoPlayer({ name: "Scratch M", index: -2.1 }).ok).toBe(true);
  });

  it("cannot silently replace one of the seeded twelve", () => {
    // The script refuses this, but the ids have to be knowable for it to.
    expect(SEEDED_PLAYER_IDS).toContain("demo_dave");
    expect(SEEDED_PLAYER_IDS).toHaveLength(12);
    expect(buildDemoPlayer({ name: "dave", index: 5 }).player.id).toBe("demo_dave");
  });
});

describe("what it deliberately leaves out", () => {
  it("creates no dues document, so nobody is told they owe money", () => {
    // A tester cannot tell a seeded debt from a real one, and the ledger only
    // works because the number is believed.
    expect(built.bc_settings.some(s => s.id.endsWith("__dues"))).toBe(false);
    expect(DEMO_COLLECTIONS).not.toContain("bc_ledger");
  });

  it("creates no memberships and no signed cards", () => {
    expect(DEMO_COLLECTIONS).not.toContain("bc_accounts");
    expect(DEMO_COLLECTIONS).not.toContain("bc_card_sigs");
  });

  it("creates no round locks, so every round stays editable", () => {
    // An imported year is locked because it is over. This one is a sandbox —
    // a locked round would make the first thing a tester tries fail.
    expect(DEMO_COLLECTIONS).not.toContain("bc_round_locks");
  });
});

// ══════════════════════════════════════════════════════════════════
//  What actually gets stored
// ══════════════════════════════════════════════════════════════════
//
// Everything above tests the BUILDER, and the builder was never wrong. The
// writer was: it used each document's id to name the Firestore document and
// stored the rest, so the demo landed in the live project with no `id` field
// on a single row. Nothing here could see that, because nothing here looked at
// the payload the writer commits.
//
// `db.get` and `db.subscribe` hand back the document's data, so the id field
// IS how the app identifies a document — the picker opens `switchEdition(e.id)`
// and every settings and round lookup is `rows.find(r => r.id === …)`. A demo
// written without it could not be opened at all.
describe("the documents the writer commits", () => {
  const writes = demoWrites(built);

  it("stores every document under its own id, id field included", () => {
    expect(writes).toHaveLength(countDemoDocs(built));
    for (const { col, id, doc } of writes) {
      expect(id, `${col} document has no id`).toBeTruthy();
      // The two must agree: the field is what the app reads, the id is where
      // Firestore files it, and a document whose field names a different
      // document is worse than one missing the field.
      expect(doc.id, `${col}/${id} is stored without its id`).toBe(id);
    }
  });

  it("files the edition document where the picker looks for it", () => {
    // The one that was found by hand: `bc_editions/bc_demo` with no `id`,
    // which made every Open tap a `switchEdition(undefined)` no-op.
    const edition = writes.find(w => w.col === "bc_editions");
    expect(edition.id).toBe(DEMO_EDITION_ID);
    expect(edition.doc.id).toBe(DEMO_EDITION_ID);
  });

  it("writes nothing outside the collections it declares", () => {
    for (const { col } of writes) expect(DEMO_COLLECTIONS).toContain(col);
  });
});
