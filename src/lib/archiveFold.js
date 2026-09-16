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
//   editions  { year, teamA, teamB, roster:[{p,t}], complete?, brand? }
//   rounds    { year, round, format, course, par, rating, slope }
//   matches   { year, round, A:[id], B:[id], ptsA, ptsB }
//   cards     { year, round, p, g, ch, tp, e, b, pr, bo, d, a9?, np?, hr?, mr? }
//
// `np` and `hr` are the eighteen-character streak marks — the net card and the
// hole results, one letter a hole. See src/lib/streaks.js, which owns what a
// letter means; a card written before they existed simply has no streaks.
//
// `complete: false` on an edition marks the year still being played. It is the
// one flag that changes an answer rather than adding to it: an unfinished cup
// is not a candidate for closest-ever or biggest-blowout, and a week that is
// two rounds old is not somebody's best week.

import { formatOwnBall } from "../constants";
import {
  HOLES_PER_ROUND, NET_BOGEY_OR_WORSE, NET_DOUBLE_OR_WORSE, NET_MARKS,
  NET_PAR_OR_BETTER, longestRun,
} from "./streaks";

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

// ── The core sixteen ──────────────────────────────────────────────
// The men who keep coming. Four cups is the cut, and it is not a number
// somebody picked to land on sixteen — the record has a hole in it exactly
// there. Sixteen golfers have played seven cups or more; the next man down
// has played three. Nobody has ever played four, five or six.
//
// So any cut between four and seven names the same sixteen, which is what
// makes this worth having as a rule rather than a hand-kept list: it does not
// sit on a knife edge, and it maintains itself. A man on his fourth cup joins
// on the day he tees off, and the label counts whoever is in rather than
// saying "16" and being wrong the first year somebody does.
//
// Four rather than a top-sixteen-by-appearances, because a rate is a rule and
// a rank is an arbitration: two men tied on the boundary would leave one of
// them in and one out with nothing to say why.
export const CORE_MIN_APPS = 4;

// ── Recent form ───────────────────────────────────────────────────
// The last N cups PLAYED, not a man's own last N appearances. "How has he
// been going lately" is a question about the same weekends for everybody —
// measuring one man over 2023-25 and another over 2017-25 because he missed
// seven of them is not a comparison, and the table would put the two side by
// side as though it were.
//
// Three is where the chip STARTS, not what it is stuck on: one cup is a hot
// weekend, two cannot tell a trend from a coincidence, and past four you are
// reading most of the record of a man who started in 2022. Which of those a
// reader wants is a question about what he is looking for, so the screen asks
// him rather than answering for him — see the stepper on the scope chip.
export const RECENT_CUPS = 3;

// Two is the floor. One cup is not form, it is a year, and the scope chip
// beside this one already offers a single year by name.
export const RECENT_MIN = 2;

// How far back the chip can reach: everything but the earliest cup, so the
// last position is still a slice and not the whole record. Never below the
// floor, for a project with two cups in it.
export const recentMax = (cups) => Math.max(RECENT_MIN, cups - 1);

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
      // The colours that year was actually played in, where its own workbook
      // recorded them. Absent is not an error — 2016 to 2018 had no banner
      // colour at all, and a side the banner says nothing about keeps the
      // app's palette.
      brand: e.brand || null,
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
        best: null, bestNet: null, byFormat: {}, byYear: [],
        netRounds: 0, netToPar: 0, nE: 0, nB: 0, nP: 0, nBo: 0, nD: 0,
        mrSum: 0, mrRounds: 0,
        sgGross: 0, sgNet: 0, sgRounds: 0, sgNets: 0, bestSg: null, bestSgNet: null,
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
        netRounds: 0, netToPar: 0, bestNet: null, mrSum: 0, mrRounds: 0,
        sgGross: 0, sgNet: 0, sgRounds: 0, sgNets: 0,
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

  // ── Strokes gained ──────────────────────────────────────────────
  // Against the FIELD, which is the only benchmark this data can support and
  // is also the standard one: SG Total is defined as the field's average score
  // less the player's, and that is exactly what this is. It is NOT shot-level
  // SG — off the tee, approach, around the green, putting — and it never can
  // be from a scorecard, because a scorecard does not know where the ball was.
  //
  // Every comparison is inside ONE round, so the course, the tees, the weather
  // and the pin sheet are the same for everybody being compared and cancel.
  // That is what makes it safe to average across thirty-six courses afterwards
  // when nothing else on this tab is: +2.4 at Bay Harbor and +2.4 at Harbor
  // Point are the same claim about the same field.
  //
  // Gross says who played the best golf. NET says who played best to his
  // handicap, which is the argument the cup actually settles — and the two
  // answer differently often enough that showing one alone picks a side in it.
  //
  // Own-ball rounds only (formatOwnBall), for the third time and the same
  // reason: on a scramble the field average is a field of shared balls, and a
  // man's "score" is his partner's as much as his.
  const fieldAvg = new Map();
  cards.forEach((c) => {
    const k = roundKey(c);
    if (!formatOwnBall(roundIx.get(k)?.format)) return;
    const f = fieldAvg.get(k) || { g: 0, n: 0, cards: 0, nets: 0 };
    f.g += c.g; f.cards += 1;
    if (c.ch != null) { f.n += c.g - c.ch; f.nets += 1; }
    fieldAvg.set(k, f);
  });

  // A field of one is not a field. It is a man compared with himself, which is
  // zero strokes gained by construction and would put anybody who played a
  // round nobody else did on top of the board.
  const gainOn = (c) => {
    const f = fieldAvg.get(roundKey(c));
    if (!f || f.cards < 2) return null;
    const gross = (f.g / f.cards) - c.g;
    const net = c.ch != null && f.nets >= 2 ? (f.n / f.nets) - (c.g - c.ch) : null;
    return { gross, net };
  };

  // ── Net, beside gross ───────────────────────────────────────────
  // Every figure below has two readings, and until the Gross/Net toggle the
  // tab only ever showed one of them. That was not neutral: a gross board is
  // a board about who has the lowest handicap, and on a record where the
  // field runs from scratch to thirty-three it is the same four names on
  // everything. Paul S has ten gross birdies and two hundred and two net.
  //
  // The round figure is exact arithmetic — `tp` is gross against par and `ch`
  // is the handicap the round was played off, so net against par is `tp - ch`
  // and net score is `g - ch`. The same net card lib/scoresExport prints.
  //
  // The hole COUNTS come off the `np` marks instead (lib/streaks), because
  // eagles, birdies and pars are per hole and no round total can recover
  // them. This is what CLAUDE.md's "two definitions of a birdie on one screen
  // is worse than either" was protecting, and the answer it was waiting for:
  // one at a time, with a chip that says which. Net was uncomputable for the
  // running year until the marks shipped; now both halves of the tab can say
  // it, which was the actual objection.
  const netOf = (c) => {
    if (c.ch == null) return null;
    const marks = String(c.np || "");
    const n = (set) => [...marks].filter((m) => set.has(m)).length;
    return {
      score: c.g - c.ch,
      toPar: c.tp - c.ch,
      e: n(new Set(["E"])), b: n(new Set(["B"])), pr: n(new Set(["P"])),
      bo: n(new Set(["1"])), d: n(NET_DOUBLE_OR_WORSE),
    };
  };

  // ── Cards ───────────────────────────────────────────────────────
  cards.forEach((c) => {
    const r = row(c.p);
    const meta = roundIx.get(roundKey(c)) || {};
    r.rounds += 1; r.toPar += c.tp;
    r.e += c.e || 0; r.b += c.b || 0; r.pr += c.pr || 0; r.bo += c.bo || 0; r.d += c.d || 0;
    // ── Match Royale ────────────────────────────────────────────
    // The workbook's own metric (lib/matchRoyale), averaged over his rounds
    // the way the workbook averaged it — over ALL FOUR, a shared ball
    // included. That is the one place this half of the tab does not apply
    // formatOwnBall, and deliberately: this is the sheets' number, it was
    // computed that way for ten years, and a Match Royale that quietly
    // covered three rounds would not be the figure anybody remembers.
    if (c.mr != null) {
      r.mrSum += c.mr; r.mrRounds += 1;
    }
    const net = netOf(c);
    if (net) {
      r.netRounds += 1; r.netToPar += net.toPar;
      r.nE += net.e; r.nB += net.b; r.nP += net.pr; r.nBo += net.bo; r.nD += net.d;
    }
    const shot = {
      year: c.year, round: c.round, gross: c.g, toPar: c.tp,
      net: net ? net.score : null, netToPar: net ? net.toPar : null,
      course: meta.course || "", par: meta.par ?? null,
    };
    // Ranked on to par, not on gross: a 78 at a par 71 is not the better round
    // and every course here is a different one — thirty-six of them, none
    // played twice.
    //
    // A shared ball is not his best round, by the same rule that keeps it out
    // of LOW ROUNDS (see formatOwnBall). Both halves have to agree or the tab
    // contradicts itself on one screen: a player's card reading "Best round —
    // 62" above an all-time list whose lowest is his 64.
    const own = formatOwnBall(meta.format);
    if (own && (!r.best || c.tp < r.best.toPar || (c.tp === r.best.toPar && c.g < r.best.gross))) r.best = shot;
    if (own && net && (!r.bestNet || net.toPar < r.bestNet.netToPar
      || (net.toPar === r.bestNet.netToPar && net.score < r.bestNet.net))) r.bestNet = shot;
    const y = yearRow(c.p, c.year);
    if (y) {
      y.rounds += 1; y.toPar += c.tp;
      if (net) { y.netRounds += 1; y.netToPar += net.toPar; }
      if (c.mr != null) { y.mrSum += c.mr; y.mrRounds += 1; }
      if (own && (!y.best || c.tp < y.best.toPar)) y.best = shot;
      if (own && net && (!y.bestNet || net.toPar < y.bestNet.netToPar)) y.bestNet = shot;
    }
    const sg = own ? gainOn(c) : null;
    if (sg) {
      r.sgRounds += 1; r.sgGross += sg.gross;
      if (sg.net != null) { r.sgNets += 1; r.sgNet += sg.net; }
      if (!r.bestSg || sg.gross > r.bestSg.sg) r.bestSg = { ...shot, sg: sg.gross };
      if (sg.net != null && (!r.bestSgNet || sg.net > r.bestSgNet.sg)) r.bestSgNet = { ...shot, sg: sg.net };
      if (y) {
        y.sgRounds += 1; y.sgGross += sg.gross;
        if (sg.net != null) { y.sgNets += 1; y.sgNet += sg.net; }
      }
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
      .map((y) => ({
        ...y,
        avgToPar: y.rounds ? y.toPar / y.rounds : null,
        avgNetToPar: y.netRounds ? y.netToPar / y.netRounds : null,
        matRoy: y.mrRounds ? y.mrSum / y.mrRounds : null,
        sg: y.sgRounds ? y.sgGross / y.sgRounds : null,
        sgNetPer: y.sgNets ? y.sgNet / y.sgNets : null,
      })),
    avgToPar: r.rounds ? r.toPar / r.rounds : null,
    avgNetToPar: r.netRounds ? r.netToPar / r.netRounds : null,
    matRoy: r.mrRounds ? r.mrSum / r.mrRounds : null,
    // Per ROUND rather than totalled: a total is a record about turning up,
    // and this board already sits next to MOST APPEARANCES.
    sg: r.sgRounds ? r.sgGross / r.sgRounds : null,
    sgNetPer: r.sgNets ? r.sgNet / r.sgNets : null,
    ppm: r.matches ? r.pts / r.matches : null,
    birdiesPerRound: r.rounds ? (r.e + r.b) / r.rounds : null,
    birdiesPerRoundNet: r.netRounds ? (r.nE + r.nB) / r.netRounds : null,
    debut: r.years.length ? Math.min(...r.years) : null,
    last: r.years.length ? Math.max(...r.years) : null,
  })).sort((a, b) => b.pts - a.pts || (a.avgToPar ?? Infinity) - (b.avgToPar ?? Infinity)
    || String(a.name).localeCompare(String(b.name)));

  const careerIx = new Map(careerRows.map((r) => [r.id, r]));
  const named = (id) => careerIx.get(id)?.name || nameOf.get(id) || id;

  // ── A career, over a chosen set of years ────────────────────────
  // The same row shape the table already draws, re-totalled over some of a
  // man's years instead of all of them — which is what "recent form" is.
  //
  // Summed off `byYear` rather than re-walked off the cards, because byYear
  // is where every per-year total already lives and a second pass over the
  // cards would be a second definition of a win to drift.
  //
  // What it cannot slice is the hole counts and the partnerships: those are
  // career-wide on the row and stay so. The table does not draw them, and the
  // panel that does says CAREER on nothing it shows — the same compromise the
  // single-year scope has always made.
  const careerOver = (years) => {
    const want = new Set(years);
    return careerRows.map((r) => {
      const ys = r.byYear.filter((y) => want.has(y.year));
      if (!ys.length) return null;
      const sum = (k) => ys.reduce((acc, y) => acc + (y[k] || 0), 0);
      const pick = (key, cmp) => ys.map((y) => y[key]).filter(Boolean).slice().sort(cmp)[0] || null;
      const rounds = sum("rounds"), matches = sum("matches");
      const netRounds = sum("netRounds"), sgRounds = sum("sgRounds"), sgNets = sum("sgNets");
      const mrRounds = sum("mrRounds");
      // A cup won is the edition's own answer, not something byYear carries —
      // and it has to be re-asked per year or a three-cup slice would report
      // a decade of them.
      const cups = ys.reduce((acc, y) => {
        const e = edIx.get(y.year);
        if (!e || !e.complete) return acc;
        if (e.halved) acc.cupsHalved += 1;
        else if (e.winnerSide === y.team) acc.cupsWon += 1;
        else acc.cupsLost += 1;
        return acc;
      }, { cupsWon: 0, cupsLost: 0, cupsHalved: 0 });
      return {
        ...r, ...cups,
        apps: ys.length,
        years: ys.map((y) => y.year).sort((a, b) => a - b),
        debut: Math.min(...ys.map((y) => y.year)),
        last: Math.max(...ys.map((y) => y.year)),
        w: sum("w"), l: sum("l"), h: sum("h"), pts: sum("pts"), matches, rounds,
        toPar: sum("toPar"), netToPar: sum("netToPar"), netRounds,
        sgRounds, sgNets, mrRounds,
        matRoy: mrRounds ? sum("mrSum") / mrRounds : null,
        best: pick("best", (a, b) => a.toPar - b.toPar || a.gross - b.gross),
        bestNet: pick("bestNet", (a, b) => a.netToPar - b.netToPar || a.net - b.net),
        avgToPar: rounds ? sum("toPar") / rounds : null,
        avgNetToPar: netRounds ? sum("netToPar") / netRounds : null,
        ppm: matches ? sum("pts") / matches : null,
        sg: sgRounds ? sum("sgGross") / sgRounds : null,
        sgNetPer: sgNets ? sum("sgNet") / sgNets : null,
        // What the slice is being read AGAINST. The whole point of a form
        // table is the comparison, and a number with nothing beside it is
        // just a smaller version of the career table.
        careerPpm: r.ppm,
        careerMatRoy: r.matRoy,
        careerSg: r.sg,
        careerSgNetPer: r.sgNetPer,
        careerAvgToPar: r.avgToPar,
        careerAvgNetToPar: r.avgNetToPar,
      };
    }).filter(Boolean)
      .sort((a, b) => b.pts - a.pts || (a.avgToPar ?? Infinity) - (b.avgToPar ?? Infinity)
        || String(a.name).localeCompare(String(b.name)));
  };

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
      // ── How hard the day was, allowing for the course ───────────
      // To par says what the field SHOT; the differential says how they
      // played, which is a different question when no two rounds were on the
      // same course. Thirty-six courses over forty rounds and none repeated,
      // so a par 73 off 74.8/145 and a par 70 off 68/120 are not comparable
      // on to par at all: the harder course collects a bigger number for
      // being harder, which is what the number was supposed to measure.
      //
      // The USGA's own arithmetic — (gross - rating) x 113 / slope — which is
      // what a handicap differential is. Null when a round has no rating, and
      // the boards fall back to to par for those.
      avgDiff: rc.length && r.rating && r.slope
        ? sum(rc.map((c) => (c.g - r.rating) * 113 / r.slope)) / rc.length
        : null,
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
  const netWeeks = [];
  played.forEach((r) => r.byYear.forEach((y) => {
    if (y.rounds >= 4) weeks.push({ id: r.id, name: r.name, year: y.year, toPar: y.toPar, rounds: y.rounds });
    if (y.netRounds >= 4) netWeeks.push({ id: r.id, name: r.name, year: y.year, toPar: y.netToPar, rounds: y.netRounds });
  }));
  // A low round is a round somebody SHOT, so a card is only a candidate when
  // he played his own ball from the tee to the hole — see formatOwnBall. The
  // shared-ball days are still everywhere else on this tab: they count towards
  // a career, a week and the course passport, where the side is the subject.
  const rankedCards = cards
    .filter((c) => formatOwnBall(roundIx.get(roundKey(c))?.format))
    // `id` as well as `p`: it is the card's golfer either way, and every other
    // board on the tab names him `id`. A screen filtering boards by player
    // should not have to know which kind of row it is holding.
    .map((c) => ({
      ...c, id: c.p, name: named(c.p), course: roundIx.get(roundKey(c))?.course || "",
      net: c.ch == null ? null : c.g - c.ch,
      netToPar: c.ch == null ? null : c.tp - c.ch,
    }));

  // Two rankings of the same cards. Gross settles ties on the lower score and
  // so does net, because a 71 at a par 71 is the better round than a 74 at a
  // par 74 to nobody, but two men level against par are separated by the one
  // who took fewer shots to get there.
  const byGross = rankedCards.slice().sort((a, b) => a.tp - b.tp || a.g - b.g);
  const byNet = rankedCards.filter((c) => c.netToPar != null)
    .sort((a, b) => a.netToPar - b.netToPar || a.net - b.net);

  // ── Streaks ─────────────────────────────────────────────────────
  // What happened on consecutive holes, which is the one question a round
  // summary cannot answer: a card ships its birdies as a COUNT, and a count
  // has thrown away the order they came in. The marks are per hole and per
  // card (lib/streaks); the job here is to lay one man's cards end to end in
  // the order he played them and find the longest run.
  //
  // Across ROUNDS, because the run that ends a Saturday and opens a Sunday is
  // one run and it is the one people remember. Not across CUPS: this event is
  // played once a year, so a run carried over the New Year is a claim about
  // two holes twelve months apart, and the men it would flatter most are the
  // ones who happened to par the 18th. Worse, a man who played 2019 and next
  // played 2023 has no card in between for it to break on — his last hole of
  // one cup and his first of the other would read as consecutive. So a cup
  // starts every hole streak fresh, and each one is locatable to a week
  // somebody could go and check.
  //
  // Match and cup streaks DO cross years, because that is what those records
  // are: "he has won his last seven" is a sentence about matches, and a cup
  // defended is a cup defended.
  //
  // Nor can a run cross a hole with no mark on it: an unplayed hole, a match
  // the other side never finished, or a shared-ball round. See longestRun.
  const cardsByPlayer = new Map();
  cards.slice()
    .sort((a, b) => a.year - b.year || a.round - b.round)
    .forEach((c) => {
      if (!cardsByPlayer.has(c.p)) cardsByPlayer.set(c.p, []);
      cardsByPlayer.get(c.p).push(c);
    });

  // `ownBall` is the LOW ROUNDS rule again, and for the same reason: a net par
  // on a scramble ball is a par the side made. A shared-ball round is not
  // skipped over, it is eighteen gaps — there is no evidence either way about
  // holes he did not play by himself, so a run cannot be carried through them.
  const holeSeq = (cs, key, ownBall) => {
    const out = [];
    let lastYear = null;
    cs.forEach((c) => {
      // The break between one cup and the next, as a gap like any other.
      if (lastYear != null && c.year !== lastYear) out.push({ v: null, year: c.year, round: null, hole: 0 });
      lastYear = c.year;
      const marks = ownBall && !formatOwnBall(roundIx.get(roundKey(c))?.format)
        ? "" : String(c[key] || "");
      for (let h = 0; h < HOLES_PER_ROUND; h++) {
        out.push({ v: marks[h] || null, year: c.year, round: c.round, hole: h + 1 });
      }
    });
    return out;
  };

  // Cups in the order he PLAYED them, not in calendar order. A man cannot
  // defend a cup he did not travel to, and ending his run on the year he was
  // at somebody's wedding would be a record about attendance. Only finished
  // cups, like every other record here, and a halved cup is neither won nor
  // lost so it ends both runs.
  const cupsOrdered = editionRows.slice().sort((a, b) => a.year - b.year).filter((e) => e.complete);
  const cupSeq = (id) => cupsOrdered
    .filter((e) => e.roster.some((r) => r.p === id))
    .map((e) => {
      const t = e.roster.find((r) => r.p === id).t;
      return { v: e.halved ? "H" : e.winnerSide === t ? "W" : "L", year: e.year, round: null };
    });

  const matchesOrdered = matches.slice().sort((a, b) => a.year - b.year || a.round - b.round);
  const matchSeq = (id) => matchesOrdered
    .filter((m) => m.A.includes(id) || m.B.includes(id))
    .map((m) => {
      const mine = m.A.includes(id) ? m.ptsA : m.ptsB;
      const theirs = m.A.includes(id) ? m.ptsB : m.ptsA;
      return { v: mine > theirs ? "W" : mine < theirs ? "L" : "H", year: m.year, round: m.round };
    });

  const streakRows = careerRows.map((r) => {
    const cs = cardsByPlayer.get(r.id) || [];
    const res = holeSeq(cs, "hr", false);
    const net = holeSeq(cs, "np", true);
    const cup = cupSeq(r.id);
    const mat = matchSeq(r.id);
    return {
      id: r.id, name: r.name,
      cupsWon: longestRun(cup, (v) => v === "W"),
      cupsLost: longestRun(cup, (v) => v === "L"),
      matchWins: longestRun(mat, (v) => v === "W"),
      // Literally without a WIN — a halve continues it. It is the run a man
      // wants to end, and he does not end it by halving.
      winless: longestRun(mat, (v) => v !== "W"),
      holesWon: longestRun(res, (v) => v === "W"),
      holesLost: longestRun(res, (v) => v === "L"),
      netPar: longestRun(net, (v) => NET_PAR_OR_BETTER.has(v)),
      noDouble: longestRun(net, (v) => NET_MARKS.has(v) && !NET_DOUBLE_OR_WORSE.has(v)),
      noPar: longestRun(net, (v) => NET_BOGEY_OR_WORSE.has(v)),
    };
  });

  // ── The player boards ───────────────────────────────────────────
  // A FUNCTION of which golfers are in, not a list, because the Data tab can
  // ask for the core sixteen (see CORE_MIN_APPS) and a board has to be cut to
  // the field BEFORE it is cut to five. Filtering a finished top five down to
  // the core leaves LOW ROUNDS with one line on it — the other four were John
  // S, who played two cups and holds the four lowest rounds in the record.
  //
  // `ids` is a Set, or null for everybody.
  // Eight own-ball rounds is three cups' worth — the same floor `bestRate`
  // puts on a rate, for the same reason. Below it one calm morning in a gale
  // tops the board forever, which is a record about the weather.
  const SG_MIN_ROUNDS = 8;

  const playerBoards = (ids) => {
    const mine = (x) => !ids || ids.has(x.id ?? x.p);
    const top = (xs, n = 5) => xs.filter(mine).slice(0, n);
    const some = (xs) => (ids ? xs.filter(mine) : xs);

    // Two is the floor. A run of one is not a streak, it is a thing that
    // happened once, and a board of them would be every golfer who has ever
    // won a hole. Ties go to the older run, then to the name, so the list is
    // the same on every phone.
    const board = (key, n = 3) => some(streakRows)
      .map((s) => (s[key] ? { id: s.id, name: s.name, ...s[key] } : null))
      .filter((s) => s && s.len >= 2)
      .sort((a, b) => b.len - a.len || a.from.year - b.from.year
        || String(a.name).localeCompare(String(b.name)))
      .slice(0, n);

    // The lowest card in each round number, one row each.
    const bestPerRound = (list) => roundNumbers
      .map((rd) => top(list.filter((c) => c.round === rd), 1)[0] || null)
      .filter(Boolean);

    const sgBoard = (key, rounds) => top(played
      .filter((r) => r[key] != null && r[rounds] >= SG_MIN_ROUNDS)
      .sort((a, b) => b[key] - a[key]));

    return {
      records: {
        lowRounds: top(byGross),
        lowRoundsNet: top(byNet),
        // One row per round NUMBER rather than a board each: four boards of
        // five is twenty rows to answer "who owns Sunday", and the answer is
        // one name. The round number is the interesting axis because the
        // format follows it — R2 has been singles every year of the cup and
        // R4 team best ball every year.
        bestByRound: bestPerRound(byGross),
        bestByRoundNet: bestPerRound(byNet),
        bestWeeks: top(weeks.slice().sort(byNum((w) => w.toPar))),
        bestWeeksNet: top(netWeeks.slice().sort(byNum((w) => w.toPar))),
        mostPoints: top(played.flatMap((r) => r.byYear.filter((y) => y.matches).map((y) => ({ id: r.id, name: r.name, ...y })))
          .sort((a, b) => b.pts - a.pts)),
        mostApps: top(played.slice().sort((a, b) => b.apps - a.apps || String(a.name).localeCompare(String(b.name)))),
        // A rate needs a denominator worth trusting. Twelve matches is three
        // cups' worth — below that one hot weekend tops the list forever.
        bestRate: top(played.filter((r) => r.matches >= 12).sort((a, b) => b.ppm - a.ppm)),
        mostBirdies: top(played.filter((r) => r.rounds).slice().sort((a, b) => (b.e + b.b) - (a.e + a.b))),
        // Eight rounds, the same floor the strokes gained boards use — it is
        // a rate, and a rate needs a denominator worth trusting.
        matRoy: top(played.filter((r) => r.matRoy != null && r.mrRounds >= SG_MIN_ROUNDS)
          .sort((a, b) => b.matRoy - a.matRoy)),
        // The best single round of it, and this one IS own-ball — a shared
        // ball gives both partners the identical figure, so a pinehurst pair
        // would take two lines of the board with one performance, which is
        // the LOW ROUNDS problem exactly. The career average above is left
        // over all four rounds because that is the workbook's own metric and
        // the workbook averaged all four.
        matRoyRounds: top(rankedCards.filter((c) => c.mr != null)
          .slice().sort((a, b) => b.mr - a.mr)),
        mostBirdiesNet: top(played.filter((r) => r.netRounds).slice().sort((a, b) => (b.nE + b.nB) - (a.nE + a.nB))),
        comebacks: top(played.filter((r) => r.comebacks).sort((a, b) => b.comebacks - a.comebacks)),
      },
      strokesGained: {
        gross: sgBoard("sg", "sgRounds"),
        net: sgBoard("sgNetPer", "sgNets"),
        // One round, not an average: the most dominant day anybody has had.
        best: top(played.filter((r) => r.bestSg)
          .map((r) => ({ id: r.id, name: r.name, ...r.bestSg }))
          .sort((a, b) => b.sg - a.sg)),
        bestNet: top(played.filter((r) => r.bestSgNet)
          .map((r) => ({ id: r.id, name: r.name, ...r.bestSgNet }))
          .sort((a, b) => b.sg - a.sg)),
        minRounds: SG_MIN_ROUNDS,
      },
      streaks: {
        cupsWon: board("cupsWon"),
        matchWins: board("matchWins"),
        holesWon: board("holesWon"),
        netPar: board("netPar"),
        noDouble: board("noDouble"),
        cupsLost: board("cupsLost"),
        winless: board("winless"),
        holesLost: board("holesLost"),
        noPar: board("noPar"),
      },
    };
  };

  const allBoards = playerBoards(null);

  // Each round's own result, one row per round of every cup.
  const roundResults = editionRows.flatMap((e) => e.rounds.map((r) => ({
    year: e.year,
    round: r.round,
    ptsA: r.ptsA,
    ptsB: r.ptsB,
    margin: Math.abs(r.ptsA - r.ptsB),
    winner: r.ptsA > r.ptsB ? e.teamA : r.ptsB > r.ptsA ? e.teamB : null,
    won: Math.max(r.ptsA, r.ptsB),
    lost: Math.min(r.ptsA, r.ptsB),
  })));

  // The margin crossing zero between one round and the next.
  const leadChangesIn = (e) => e.rounds.reduce((n, r, i) => {
    if (i === 0) return n;
    const before = Math.sign(e.rounds[i - 1].cumA - e.rounds[i - 1].cumB);
    const after = Math.sign(r.cumA - r.cumB);
    return before && after && before !== after ? n + 1 : n;
  }, 0);

  // A day ranks on its differential where the round has a rating and on to
  // par where it does not — never a mix inside one comparison, so the board
  // cannot put a differential above a to-par and call it harder.
  const rated = courseRows.filter((c) => c.cards && c.avgDiff != null);
  const rankedDays = (rated.length ? rated : courseRows.filter((c) => c.cards))
    .map((c) => ({ ...c, difficulty: c.avgDiff ?? c.avgToPar, rated: c.avgDiff != null }));

  const playedCups = finished.filter((e) => e.avgToPar != null);

  // ── The cup's own records ───────────────────────────────────────
  // Not a player board and not filtered by one: which year was closest is the
  // same answer whoever is being listed.
  const top = (xs, n = 5) => xs.slice(0, n);
  const cupRecords = {
    closest: finished.filter((e) => !e.halved).slice().sort(byNum((e) => e.margin))[0] || null,
    biggest: finished.slice().sort((a, b) => b.margin - a.margin)[0] || null,
    halved: finished.filter((e) => e.halved),
    // Ranked on the differential where a round has a rating, which reorders
    // the hard end: the field shot worse at Harbor Shores in 2020, but
    // Glenoaks in 2017 is where they played worst for what the course was.
    hardest: rankedDays.slice().sort((a, b) => b.difficulty - a.difficulty)[0] || null,
    easiest: rankedDays.slice().sort(byNum((c) => c.difficulty))[0] || null,
    // ── The week, not the day ───────────────────────────────────
    // The course passport ranks rounds and nothing ranks cups. Twelve and a
    // half shots separate the hardest week from the easiest, which is most of
    // a round.
    hardestWeek: playedCups.slice().sort((a, b) => b.avgToPar - a.avgToPar)[0] || null,
    easiestWeek: playedCups.slice().sort(byNum((e) => e.avgToPar))[0] || null,
    cupsPlayed: finished.length,
    // ── A round somebody swept ──────────────────────────────────
    // Every match in a round taken, or near enough. The 2024 Silver Foxes won
    // Round 1 sixteen to nothing and nothing on this tab has ever said so.
    roundRouts: top(roundResults.filter((r) => r.margin > 0)
      .sort((a, b) => b.margin - a.margin || a.year - b.year)),
    // And the other end of the same list, which is a fact about the cup
    // rather than about a team: three of forty rounds have finished level.
    levelRounds: roundResults.filter((r) => r.margin === 0).length,
    roundsPlayed: roundResults.length,
    // ── Led from the front ──────────────────────────────────────
    // Never behind at any boundary. It is the exact complement of the
    // comeback board below, so the two together sort every cup ever played
    // into one of two kinds.
    wireToWire: finished.filter((e) => !e.halved && e.winnerSide
      && e.rounds.every((r) => (e.winnerSide === "A" ? r.cumA - r.cumB : r.cumB - r.cumA) >= 0)),
    // ── The lead crossing zero ──────────────────────────────────
    // roundDrama counts these per ROUND, averaged over the years. This names
    // the years, which is the form anybody actually argues about.
    leadChanges: top(editionRows
      .map((e) => ({ ...e, changes: leadChangesIn(e) }))
      .filter((e) => e.changes > 0)
      .sort((a, b) => b.changes - a.changes || b.year - a.year)),
    // ── Ten years in one line ───────────────────────────────────
    totals: {
      cups: finished.length,
      matches: matches.length,
      cards: cards.length,
      holes: cards.length * HOLES_PER_ROUND,
      birdies: sum(cards.map((c) => (c.e || 0) + (c.b || 0))),
      courses: new Set(rounds.map((r) => r.course).filter(Boolean)).size,
    },
    // ── The deepest hole a winner climbed out of ──────────────────
    // Measured at EVERY round boundary, not just the last one. It started as
    // "trailing going into the final round", which is the most dramatic
    // version of the question and also the narrowest: it found three cups in
    // ten years and it called 2016 and 2018 one-point comebacks when both
    // sides had been five down on Friday night. A deficit is a deficit
    // whenever it was faced.
    //
    // Five of the ten cups now qualify, and the two the old measure could not
    // see are the 2017 G-MEN (eight down after R1) and 2022's HileDrivers
    // (seven). The round is named beside the number, because eight down with
    // three rounds left and eight down with one are not the same afternoon
    // and the reader is better placed to weigh that than a formula is.
    //
    // A tie goes to the LATER round — the same deficit with less left to fix
    // it is the harder hole — which is why 2025 still reads after R3 rather
    // than after R2, having been eleven down at both.
    cupComebacks: top(finished
      .filter((e) => !e.halved && e.winnerSide && e.rounds.length > 1)
      .map((e) => {
        const deepest = e.rounds.slice(0, -1).reduce((worst, r) => {
          const deficit = e.winnerSide === "A" ? r.cumB - r.cumA : r.cumA - r.cumB;
          return !worst || deficit >= worst.deficit ? { deficit, after: r.round } : worst;
        }, null);
        return { ...e, ...deepest };
      })
      .filter((e) => e.deficit > 0)
      .sort((a, b) => b.deficit - a.deficit || b.after - a.after || b.margin - a.margin)),
  };

  // The cup's records and the unfiltered player boards, as one object — the
  // shape every caller before the Core/All toggle read, and still the default.
  const records = { ...cupRecords, ...allBoards.records };
  const { strokesGained, streaks } = allBoards;

  const allYears = editionRows.map((e) => e.year);

  return {
    years: allYears,
    // The last N cups played, newest first. A function rather than a list,
    // because how far back is the reader's to choose — and one place, so the
    // chip and the table cannot disagree about which weekends it means.
    //
    // Never all of them: the top of this same chip group already says Career,
    // and a "Last 10" that is the career under another name is a control
    // whose last position does nothing.
    recentYears: (n = RECENT_CUPS) =>
      allYears.slice(0, Math.min(Math.max(RECENT_MIN, n), recentMax(allYears.length))),
    recentMax: recentMax(allYears.length),
    careerOver,
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
    // Who is in the core, as ids — the shape a screen filtering a board by
    // player actually needs. Counted off appearances, which include the year
    // being played: a man's fourth cup counts from the day he tees off in it.
    core: new Set(careerRows.filter((r) => r.apps >= CORE_MIN_APPS).map((r) => r.id)),
    roundDrama,
    records,
    strokesGained,
    streaks,
    // The same three, over whichever golfers are asked for — a Set of ids, or
    // null for everybody. The cup's own records ride along unchanged so a
    // caller can hand the result to the same screens.
    boards: (ids) => {
      const b = playerBoards(ids || null);
      return { records: { ...cupRecords, ...b.records }, strokesGained: b.strokesGained, streaks: b.streaks };
    },
    streakOf: (id) => streakRows.find((s) => s.id === id) || null,
  };
};
