// ══════════════════════════════════════════════════════════════════
//  archiveFold — rows in, answers out.
// ══════════════════════════════════════════════════════════════════
//
// The archive ships the normalized record — one row per round, per match, per
// card, for every year that is over (see pipeline/archive.mjs). This turns
// those rows into the things the Data tab actually shows: career records,
// partnerships, head-to-heads, cup records, the course passport.
//
// It is the ONLY place any of those are defined, and that is the point. The
// running year is not in the archive — it is live in Firestore, and
// src/lib/archiveLive.js converts it into rows of exactly this shape and appends
// them before calling in here. So this year's matches are added to last
// year's record by the same code that computed last year's record. There is no
// second implementation of "what is a win" to drift.
//
// Pure — no Firebase, no React, no scoring engine. Rows are arithmetic by the
// time they arrive.
//
// ── The row shapes ────────────────────────────────────────────────
//   players   { id, name, aka[] }        the registry; `aka` is how a live
//                                        roster row finds its canonical id
//   editions  { year, teamA, teamB, roster:[{p,t}], complete? }
//   rounds    { year, round, format, course, par, rating, slope }
//   matches   { year, round, A:[id], B:[id], ptsA, ptsB }
//   cards     { year, round, p, g, ch, tp, e, b, pr, bo, d, a9? }
//
// `complete: false` on an edition marks the year still being played. It is the
// one flag that changes an answer rather than adding to it: an unfinished cup
// is not a candidate for closest-ever or biggest-blowout, and a week that is
// two rounds old is not somebody's best week.

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const byNum = (f) => (a, b) => f(a) - f(b);
const pairKey = (a, b) => [a, b].sort().join("|");

// ── Identity ──────────────────────────────────────────────────────
// Normalized the same way pipeline/players.mjs normalizes, because the two
// halves of this have to agree on what "Paul W" is: the archive's `aka` list
// was built with that function, and this is what reads it.
export const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// canonical id ← anything a roster row can offer. Built once per archive.
export const aliasIndex = (players = []) => {
  const map = new Map();
  players.forEach((p) => {
    map.set(norm(p.id), p.id);
    map.set(norm(p.name), p.id);
    (p.aka || []).forEach((a) => map.set(norm(a), p.id));
  });
  return map;
};

// ── The fold ──────────────────────────────────────────────────────
export const foldArchive = ({ players = [], editions = [], rounds = [], matches = [], cards = [] } = {}) => {
  const nameOf = new Map(players.map((p) => [p.id, p.name]));
  const roundKey = (r) => `${r.year}_${r.round}`;
  const roundIx = new Map(rounds.map((r) => [roundKey(r), r]));

  // ── Editions, round by round ────────────────────────────────────
  // The running total after each round is the whole reason a year row is
  // worth opening: a final score says who won and says nothing at all about
  // whether it was over on Saturday morning.
  const editionRows = editions.map((e) => {
    const mine = matches.filter((m) => m.year === e.year);
    const myCards = cards.filter((c) => c.year === e.year);
    let cumA = 0, cumB = 0;
    const rows = [...new Set(mine.map((m) => m.round))].sort((a, b) => a - b).map((round) => {
      const rm = mine.filter((m) => m.round === round);
      const ptsA = sum(rm.map((m) => m.ptsA));
      const ptsB = sum(rm.map((m) => m.ptsB));
      cumA += ptsA; cumB += ptsB;
      const rc = myCards.filter((c) => c.round === round);
      const meta = roundIx.get(`${e.year}_${round}`) || {};
      return {
        round, ptsA, ptsB, cumA, cumB,
        format: meta.format || "",
        course: meta.course || "",
        par: meta.par ?? null,
        // What the field shot. The honest measure of a day: a course that
        // played +14 across sixteen men was hard, whoever won the match on it.
        avgToPar: rc.length ? sum(rc.map((c) => c.tp)) / rc.length : null,
        cards: rc.length,
      };
    });

    const scoreA = cumA, scoreB = cumB;
    const complete = e.complete !== false;
    // Clinched: the lead was bigger than everything still on the table. The
    // points available in a round are known after the fact, which is exactly
    // what makes this answerable for the years that are over and honestly
    // unanswerable for the one being played.
    let clinchedAfter = null;
    if (complete) {
      for (let i = 0; i < rows.length - 1; i++) {
        const left = sum(rows.slice(i + 1).map((r) => r.ptsA + r.ptsB));
        if (Math.abs(rows[i].cumA - rows[i].cumB) > left) { clinchedAfter = rows[i].round; break; }
      }
    }
    const halved = complete && scoreA === scoreB;
    return {
      year: e.year,
      name: e.name || "",
      teamA: e.teamA, teamB: e.teamB,
      scoreA, scoreB, complete, halved,
      winner: !complete || halved ? null : scoreA > scoreB ? e.teamA : e.teamB,
      winnerSide: !complete || halved ? null : scoreA > scoreB ? "A" : "B",
      margin: Math.abs(scoreA - scoreB),
      rounds: rows,
      clinchedAfter,
      field: (e.roster || []).length,
      avgToPar: myCards.length ? sum(myCards.map((c) => c.tp)) / myCards.length : null,
      roster: e.roster || [],
    };
  }).sort((a, b) => b.year - a.year);

  const edIx = new Map(editionRows.map((e) => [e.year, e]));

  // ── Career ──────────────────────────────────────────────────────
  const career = new Map();
  const row = (id) => {
    if (!career.has(id)) {
      career.set(id, {
        id, name: nameOf.get(id) || id,
        years: [], apps: 0,
        w: 0, l: 0, h: 0, pts: 0, matches: 0,
        rounds: 0, toPar: 0, holesToPar: 0,
        e: 0, b: 0, pr: 0, bo: 0, d: 0,
        best: null, byFormat: {}, byYear: [],
        cupsWon: 0, cupsLost: 0, cupsHalved: 0,
        comebacks: 0, collapses: 0,
      });
    }
    return career.get(id);
  };

  // Appearances and which side of which year, off the roster rather than off
  // the matches: 2020's borrowed ball plays matches and is not a person, and
  // somebody who travelled and never got a game still came.
  editionRows.forEach((e) => {
    e.roster.forEach(({ p, t }) => {
      const r = row(p);
      r.apps += 1;
      r.years.push(e.year);
      r.byYear.push({
        year: e.year, team: t,
        teamName: t === "A" ? e.teamA : e.teamB,
        w: 0, l: 0, h: 0, pts: 0, matches: 0, rounds: 0, toPar: 0, best: null,
      });
      if (e.complete) {
        if (e.halved) r.cupsHalved += 1;
        else if (e.winnerSide === t) r.cupsWon += 1;
        else r.cupsLost += 1;
      }
    });
  });
  const yearRow = (id, year) => row(id).byYear.find((y) => y.year === year);

  // ── Matches ─────────────────────────────────────────────────────
  // A match result is the SIDE's, credited to everyone on it — a four-ball is
  // won by two people and both of them won it. That is how a cup record has
  // always been read, and it is what the leaderboard's own totals sum to.
  const partners = new Map();
  const h2h = new Map();
  const matchOf = new Map();   // `${year}_${round}_${pid}` → the match he was in

  matches.forEach((m) => {
    const fmt = roundIx.get(roundKey(m))?.format || "";
    const side = (ids, mine, theirs) => {
      const won = mine > theirs, lost = theirs > mine;
      ids.forEach((id) => {
        const r = row(id);
        r.matches += 1; r.pts += mine;
        if (won) r.w += 1; else if (lost) r.l += 1; else r.h += 1;
        const f = (r.byFormat[fmt] ||= { matches: 0, w: 0, l: 0, h: 0, pts: 0 });
        f.matches += 1; f.pts += mine;
        if (won) f.w += 1; else if (lost) f.l += 1; else f.h += 1;
        const y = yearRow(id, m.year);
        if (y) {
          y.matches += 1; y.pts += mine;
          if (won) y.w += 1; else if (lost) y.l += 1; else y.h += 1;
        }
        matchOf.set(`${m.year}_${m.round}_${id}`, { won, lost, mine, theirs });
      });
      // Partnerships are counted for TWO-MAN sides only. Round 4 puts seven
      // men on a side against seven, and calling all twenty-one of those pairs
      // a partnership would bury the four-ball record it is meant to describe
      // under a pile of teammates who never shared a hole.
      if (ids.length === 2) {
        const k = pairKey(ids[0], ids[1]);
        const p = partners.get(k) || { a: ids.slice().sort()[0], b: ids.slice().sort()[1], matches: 0, w: 0, l: 0, h: 0, pts: 0 };
        p.matches += 1; p.pts += mine;
        if (won) p.w += 1; else if (lost) p.l += 1; else p.h += 1;
        partners.set(k, p);
      }
    };
    side(m.A, m.ptsA, m.ptsB);
    side(m.B, m.ptsB, m.ptsA);

    // Head-to-head is SINGLES only. It is the one format where the two names
    // on the card are the whole story; in a four-ball "he beat me" is a claim
    // about somebody else's ball as much as his own.
    if (m.A.length === 1 && m.B.length === 1) {
      const [a] = m.A, [b] = m.B;
      const k = pairKey(a, b);
      const rec = h2h.get(k) || { a: [a, b].sort()[0], b: [a, b].sort()[1], matches: 0, aw: 0, bw: 0, h: 0 };
      const first = rec.a === a;
      rec.matches += 1;
      if (m.ptsA === m.ptsB) rec.h += 1;
      else if ((m.ptsA > m.ptsB) === first) rec.aw += 1;
      else rec.bw += 1;
      h2h.set(k, rec);
    }
  });

  // ── Cards ───────────────────────────────────────────────────────
  cards.forEach((c) => {
    const r = row(c.p);
    const meta = roundIx.get(roundKey(c)) || {};
    r.rounds += 1; r.toPar += c.tp;
    r.e += c.e || 0; r.b += c.b || 0; r.pr += c.pr || 0; r.bo += c.bo || 0; r.d += c.d || 0;
    const shot = { year: c.year, round: c.round, gross: c.g, toPar: c.tp, course: meta.course || "", par: meta.par ?? null };
    // Ranked on to par, not on gross: a 78 at a par 71 is not the better round
    // and every course here is a different one — thirty-six of them, none
    // played twice.
    if (!r.best || c.tp < r.best.toPar || (c.tp === r.best.toPar && c.g < r.best.gross)) r.best = shot;
    const y = yearRow(c.p, c.year);
    if (y) {
      y.rounds += 1; y.toPar += c.tp;
      if (!y.best || c.tp < y.best.toPar) y.best = shot;
    }
    // Clutch, off the status at the turn. Down three with nine to play and
    // won it is a fact nobody could recover from a final margin, which is why
    // `a9` is the one hole-level number the archive carries.
    const res = matchOf.get(`${c.year}_${c.round}_${c.p}`);
    if (res && c.a9 != null) {
      if (c.a9 <= -3 && res.won) r.comebacks += 1;
      if (c.a9 >= 3 && res.lost) r.collapses += 1;
    }
  });

  const careerRows = [...career.values()].map((r) => ({
    ...r,
    years: r.years.slice().sort((a, b) => a - b),
    byYear: r.byYear.slice().sort((a, b) => b.year - a.year)
      .map((y) => ({ ...y, avgToPar: y.rounds ? y.toPar / y.rounds : null })),
    avgToPar: r.rounds ? r.toPar / r.rounds : null,
    ppm: r.matches ? r.pts / r.matches : null,
    birdiesPerRound: r.rounds ? (r.e + r.b) / r.rounds : null,
    debut: r.years.length ? Math.min(...r.years) : null,
    last: r.years.length ? Math.max(...r.years) : null,
  })).sort((a, b) => b.pts - a.pts || (a.avgToPar ?? Infinity) - (b.avgToPar ?? Infinity)
    || String(a.name).localeCompare(String(b.name)));

  const careerIx = new Map(careerRows.map((r) => [r.id, r]));
  const named = (id) => careerIx.get(id)?.name || nameOf.get(id) || id;

  const partnerRows = [...partners.values()]
    .map((p) => ({ ...p, aName: named(p.a), bName: named(p.b), ppm: p.matches ? p.pts / p.matches : 0 }))
    .sort((a, b) => b.matches - a.matches || b.ppm - a.ppm);

  const h2hRows = [...h2h.values()]
    .map((r) => ({ ...r, aName: named(r.a), bName: named(r.b) }))
    .sort((a, b) => b.matches - a.matches);

  // ── The course passport ─────────────────────────────────────────
  // One row per ROUND. Thirty-six courses over forty rounds — four weekends
  // played one of them twice — and no course has ever been played in two
  // different years. Ranked by what the field shot, because with nothing
  // repeated across years there is no other comparison available.
  const courseRows = rounds.map((r) => {
    const rc = cards.filter((c) => c.year === r.year && c.round === r.round);
    return {
      ...r,
      avgToPar: rc.length ? sum(rc.map((c) => c.tp)) / rc.length : null,
      avgGross: rc.length ? sum(rc.map((c) => c.g)) / rc.length : null,
      low: rc.length ? Math.min(...rc.map((c) => c.g)) : null,
      cards: rc.length,
    };
  }).sort((a, b) => b.year - a.year || a.round - b.round);

  // ── Where the cup turns ─────────────────────────────────────────
  // Measured from a fixed side of each year, so a swing is a swing whichever
  // team happened to be listed first. A lead change is the margin crossing
  // zero — the thing everybody remembers and nobody writes down.
  const roundNumbers = [...new Set(rounds.map((r) => r.round))].sort((a, b) => a - b);
  const roundDrama = roundNumbers.map((round) => {
    let swing = 0, changes = 0, n = 0, clinchers = 0;
    editionRows.filter((e) => e.complete).forEach((e) => {
      const i = e.rounds.findIndex((r) => r.round === round);
      if (i < 0) return;
      const before = i === 0 ? 0 : e.rounds[i - 1].cumA - e.rounds[i - 1].cumB;
      const after = e.rounds[i].cumA - e.rounds[i].cumB;
      swing += Math.abs(after - before); n += 1;
      if (i > 0 && Math.sign(before) !== 0 && Math.sign(after) !== 0 && Math.sign(before) !== Math.sign(after)) changes += 1;
      if (e.clinchedAfter === round) clinchers += 1;
    });
    return { round, avgSwing: n ? swing / n : 0, leadChanges: changes, clinchers, years: n };
  });

  // ── Records ─────────────────────────────────────────────────────
  // Computed here rather than baked into the archive, which is what lets the
  // running year hold one: a 68 shot this morning is the low round of all
  // time the moment it is posted, not next February when somebody rebuilds.
  const finished = editionRows.filter((e) => e.complete);
  const played = careerRows.filter((r) => r.matches > 0 || r.rounds > 0);
  const weeks = [];
  played.forEach((r) => r.byYear.forEach((y) => {
    if (y.rounds >= 4) weeks.push({ id: r.id, name: r.name, year: y.year, toPar: y.toPar, rounds: y.rounds });
  }));
  const rankedCards = cards
    .map((c) => ({ ...c, name: named(c.p), course: roundIx.get(roundKey(c))?.course || "" }))
    .sort(byNum((c) => c.tp));

  const top = (xs, n = 5) => xs.slice(0, n);
  const records = {
    lowRounds: top(rankedCards),
    bestWeeks: top(weeks.slice().sort(byNum((w) => w.toPar))),
    mostPoints: top(played.flatMap((r) => r.byYear.filter((y) => y.matches).map((y) => ({ id: r.id, name: r.name, ...y })))
      .sort((a, b) => b.pts - a.pts)),
    mostApps: top(played.slice().sort((a, b) => b.apps - a.apps || String(a.name).localeCompare(String(b.name)))),
    // A rate needs a denominator worth trusting. Twelve matches is three
    // cups' worth — below that one hot weekend tops the list forever.
    bestRate: top(played.filter((r) => r.matches >= 12).sort((a, b) => b.ppm - a.ppm)),
    mostBirdies: top(played.filter((r) => r.rounds).slice().sort((a, b) => (b.e + b.b) - (a.e + a.b))),
    comebacks: top(played.filter((r) => r.comebacks).sort((a, b) => b.comebacks - a.comebacks)),
    closest: finished.filter((e) => !e.halved).slice().sort(byNum((e) => e.margin))[0] || null,
    biggest: finished.slice().sort((a, b) => b.margin - a.margin)[0] || null,
    halved: finished.filter((e) => e.halved),
    hardest: courseRows.filter((c) => c.cards).slice().sort((a, b) => b.avgToPar - a.avgToPar)[0] || null,
    easiest: courseRows.filter((c) => c.cards).slice().sort(byNum((c) => c.avgToPar))[0] || null,
    cupsPlayed: finished.length,
  };

  return {
    years: editionRows.map((e) => e.year),
    editions: editionRows,
    edition: (year) => edIx.get(year) || null,
    career: careerRows,
    careerOf: (id) => careerIx.get(id) || null,
    partners: partnerRows,
    partnersOf: (id) => partnerRows.filter((p) => p.a === id || p.b === id)
      .map((p) => ({ ...p, with: p.a === id ? p.b : p.a, withName: p.a === id ? p.bName : p.aName })),
    h2h: h2hRows,
    h2hOf: (id) => h2hRows.filter((r) => r.a === id || r.b === id).map((r) => {
      const mine = r.a === id;
      return {
        ...r,
        against: mine ? r.b : r.a,
        againstName: mine ? r.bName : r.aName,
        w: mine ? r.aw : r.bw,
        l: mine ? r.bw : r.aw,
      };
    }).sort((a, b) => b.matches - a.matches),
    courses: courseRows,
    roundDrama,
    records,
  };
};
