// ══════════════════════════════════════════════════════════════════
//  betting — the four side games the app actually scores.
// ══════════════════════════════════════════════════════════════════
//
// Skins, closest-to-the-pin and low net were each worked out inline inside
// BettingView. They live here so the derivation has one author, and so a
// screen that lists the winners and a screen that counts them cannot come to
// different totals. The money hole — one designated hole a round, ties split —
// was written here from the start for the same reason.
//
// Nothing here is stored. A skin is whoever is lowest on the hole, worked out
// from the cards every time it is asked for — see the note over onSetCtp in
// App about why there is no onSetSkin.
//
// The one Betting tab that is not in this file and never will be is Side Bet:
// a wager between two players on terms the app cannot read, so it is recorded
// rather than derived. See lib/sideBets.
//
// ── What a pot is worth ───────────────────────────────────────────────
// Two shapes:
//
//   COUNTED   a buy-in price is set, so the pot is the price times the number
//             of players in, and every player's stake is known.
//   TYPED     no price, just a figure somebody entered for the skins pot. It
//             is a real pot and it still pays out, but nobody's stake is
//             recorded.
import { getRoundCH, buildStrokeMap, resolveHolePars, resolveHoleHcps, lockForRound } from "../scoring";

export const HOLES = 18;

// A null buy-in list means the director never tagged anybody, and that means
// EVERYBODY — which is what every tournament played before buy-ins existed
// was. An empty array is the other answer (nobody), so the two must not be
// collapsed.
export const inField = (players, ids) =>
  ids == null ? players : players.filter(p => ids.includes(p.player_id));

// A round's course and hole tables, resolved through the round LOCK when there
// is one. A locked round froze its course, so reading the live round doc
// instead would re-par a settled hole if the director later re-pointed the
// round somewhere else.
export const roundSetup = ({ round, tRounds, courses, roundLocks }) => {
  const tr = tRounds?.find(t => t.round_number === round);
  const lock = lockForRound(roundLocks, round);
  const course = courses?.find(c => c.id === (lock?.course_id || tr?.course_id));
  return { tr, lock, course, pars: resolveHolePars(course, lock), hcps: resolveHoleHcps(course, lock) };
};

// Every player's stroke allocation for a round.
//
// Net skins are handicap-derived, so they answer to the round lock too — a
// settled skin must not change hands because somebody synced a GHIN index the
// next morning. Uses the canonical buildStrokeMap so handicaps over 18 wrap
// correctly; a hole can carry two strokes.
export const strokeMapsFor = ({ round, field, tPlayers, tRounds, courses, roundLocks, hcpOverrides, teeAssignments }) => {
  const { tr, course, hcps } = roundSetup({ round, tRounds, courses, roundLocks });
  const maps = {};
  field.forEach(p => {
    const ch = getRoundCH({
      roundLocks, round, pid: p.player_id, players: tPlayers,
      course, chOverrides: hcpOverrides, teeAssignments, roundTee: tr?.tee_box,
    });
    maps[p.player_id] = buildStrokeMap(ch, hcps);
  });
  return maps;
};

// ── Skins ─────────────────────────────────────────────────────────────
// One winner per hole or nobody. A hole with fewer than two cards on it is
// not a contest, and a tie carries — which is why the pot divides by skins
// WON rather than by holes played.
export const computeSkins = ({ round, gross, field, holeData, pars, maps }) => {
  const out = [];
  for (let h = 0; h < HOLES; h++) {
    const scores = field.map(p => {
      const raw = (holeData[`${p.player_id}_${round}`] || {})[h];
      if (raw == null) return null;
      const strokes = gross ? 0 : (maps?.[p.player_id]?.[h] || 0);
      return { pid: p.player_id, name: p.name, score: raw - strokes };
    }).filter(Boolean);

    if (scores.length < 2) { out.push({ hole: h, winner: null, tied: false, par: pars[h] }); continue; }
    const min = Math.min(...scores.map(s => s.score));
    const winners = scores.filter(s => s.score === min);
    out.push(winners.length === 1
      ? { hole: h, winner: winners[0], score: min, par: pars[h] }
      : { hole: h, winner: null, tied: true, score: min, par: pars[h] });
  }
  return out;
};

// ── Low net ───────────────────────────────────────────────────────────
// One round, one card: gross for eighteen less the course handicap the round
// was played off. Only a FINISHED card is ranked — a player through fourteen
// is not leading on net, they are unfinished.
//
// Equal lowest cards are CO-WINNERS, not a push. A skin pushes because the
// hole carries; low net has nowhere to carry to, so the round's share splits.
export const lowNetRows = ({ round, field, holeData, tPlayers, tRounds, courses, roundLocks, hcpOverrides, teeAssignments }) => {
  const { tr, course } = roundSetup({ round, tRounds, courses, roundLocks });
  const rows = field.map(p => {
    const card = holeData[`${p.player_id}_${round}`] || {};
    const played = Object.keys(card).filter(h => card[h] > 0);
    const gross = played.reduce((a, h) => a + card[h], 0);
    const ch = getRoundCH({
      roundLocks, round, pid: p.player_id, players: tPlayers,
      course, chOverrides: hcpOverrides, teeAssignments, roundTee: tr?.tee_box,
    });
    return {
      pid: p.player_id, name: p.name, team: p.team,
      thru: played.length, complete: played.length === HOLES,
      gross, ch, net: gross - ch,
    };
  });
  const done = rows.filter(r => r.complete);
  const best = done.length ? Math.min(...done.map(r => r.net)) : null;
  rows.forEach(r => { r.won = r.complete && r.net === best; });
  return rows.sort((a, b) =>
    (b.complete ? 1 : 0) - (a.complete ? 1 : 0)
    || (a.complete ? a.net - b.net : b.thru - a.thru)
    || String(a.name).localeCompare(String(b.name)));
};

// ── CTP ───────────────────────────────────────────────────────────────
// Every standing tag, read through each round's OWN par table rather than
// straight off ctpData: a record left on a hole that is no longer a par 3 — a
// course re-pointed after the fact — must not keep counting on a hole the tab
// no longer shows.
//
// An unsettled tag still counts. The document is the hole's current answer and
// not a log of attempts, and a board that ignored pending tags would disagree
// with the rows underneath it.
export const ctpTags = ({ rounds, field, ctpData, tRounds, courses, roundLocks }) => {
  const inSet = new Set(field.map(p => p.player_id));
  return rounds.flatMap(r => {
    const { pars } = roundSetup({ round: r, tRounds, courses, roundLocks });
    return pars.flatMap((par, h) => {
      if (par !== 3) return [];
      const rec = ctpData[`${r}_${h}`];
      // A tag naming somebody not in the CTP game still shows on its hole —
      // the document is the hole's answer — but it does not score.
      return rec?.player_id && inSet.has(rec.player_id) ? [{ round: r, hole: h, ...rec }] : [];
    });
  });
};

// ── How many pins the tournament will play ────────────────────────────
// Every par 3 on every round's scorecard. This is what a CTP pot divides by,
// and it is a different question from how many pins have been TAKEN.
//
// The tab used to divide the pot by the tags standing, which made the first
// pin of the week worth the entire pot and then shrank every man's share each
// time somebody else took one. The number moved all weekend for a reason that
// had nothing to do with the money: the pot is fixed the moment the field is,
// and so is the number of par 3s, so a pin is worth the same on Friday morning
// as it is on Sunday afternoon and the tab should say so from the start.
//
// A round with NO COURSE contributes nothing rather than a guess.
// `resolveHolePars` falls back to eighteen par 4s when the course is missing,
// which would read as "no par 3s on this one" by accident; requiring the
// course makes it deliberate, and `scheduled` is what lets a screen say the
// count is not final yet — a draw with two courses picked is still going to
// grow pins when the other two are set.
export const ctpPinTotal = ({ rounds, tRounds, courses, roundLocks }) => {
  const list = rounds || [];
  const perRound = list.map(r => {
    const { course, pars } = roundSetup({ round: r, tRounds, courses, roundLocks });
    return { round: r, course, pins: course ? pars.filter(p => p === 3).length : null };
  });
  const scheduled = perRound.filter(x => x.pins != null);
  return {
    pins: scheduled.reduce((n, x) => n + x.pins, 0),
    scheduled: scheduled.length,
    rounds: list.length,
    // True while a round is still without a course, so the total can only go
    // up. A screen that prints a per-pin share off a provisional total is
    // printing a number that will fall, and should say which it has.
    partial: scheduled.length < list.length,
    perRound,
  };
};


// ── The money hole ────────────────────────────────────────────────────
// One designated hole a round — Hole 18 here — with a pot of its own. Lowest
// NET on that hole takes it, and unlike a skin a TIE DOES NOT PUSH: it splits.
// Two men on net 3 with the field on 4 take half the round's share each.
//
// So it is a one-hole skins game with ties allowed, which makes it the fourth
// distinct answer this file holds to "what does equal-lowest mean":
//
//   skins        a tie pushes; the hole carries and the pot divides by skins WON.
//   low net      a tie splits the ROUND's share; there is nowhere to carry to.
//   CTP          there are no ties; one ball is nearer.
//   money hole   a tie splits, same as low net — one hole, one round, no carry.
//
// It is net off the same stroke maps the net skins use, so a man only gets a
// shot here if the hole's stroke index says he does. That is the game the
// field is playing; deriving it any other way would put a different winner on
// this tab than the card in somebody's pocket.
//
// WHICH hole is a stored number, one to eighteen, not the constant 18. The
// hole is the tournament's choice and the tab is named after it, so a director
// who moves the game to the ninth gets a tab called 9 rather than a tab called
// 18 scoring the ninth.
export const DEFAULT_MONEY_HOLE = 18;

// A stored hole, made safe to index with. Anything absent, unparseable or off
// the card falls back to the default rather than to hole zero — a bad number
// here would silently score a hole nobody designated.
export const moneyHole = (n) => {
  const h = Math.round(Number(n));
  return Number.isFinite(h) && h >= 1 && h <= HOLES ? h : DEFAULT_MONEY_HOLE;
};

// ── Why a par 3 is the wrong hole for it ──────────────────────────────
// Every par 3 in the tournament already carries the CTP pot, and the two games
// are decided by different things on the same green: CTP by the tee shot, this
// by the score. Put them on one hole and the group walks off it into two
// prompts, one asking how close and one that has just paid out — and a man who
// stiffs it to three feet, misses the putt and loses the money hole to a par is
// the argument that follows.
//
// It is a WARNING, not a refusal. The director sets the draw and might have a
// reason; what they must not do is set it by accident, which is what happens
// when the hole is chosen in February and the courses land in June. Which is
// also why this is asked per ROUND: four rounds are four courses, and the
// eighth is a par 3 on exactly one of them.
//
// A round with no course yet is `unknown` rather than fine. It cannot be
// checked, and reading "no par 3s here" off a course that does not exist is
// how a screen says something settled about a question still open — the same
// distinction ctpPinTotal draws with `partial`.
export const moneyHolePars = ({ rounds, hole, tRounds, courses, roundLocks }) => {
  const h = moneyHole(hole) - 1;
  const perRound = (rounds || []).map(r => {
    const { course, pars } = roundSetup({ round: r, tRounds, courses, roundLocks });
    return { round: r, course, par: course ? pars[h] : null };
  });
  return {
    hole: moneyHole(hole),
    perRound,
    par3: perRound.filter(x => x.par === 3),
    unknown: perRound.filter(x => x.par == null),
  };
};

// One round's table for the money hole.
//
// A player with no score on the hole is not losing it, he has not played it —
// so he ranks below everybody who has and prints a dash rather than a number
// somebody could be beaten by. `posted` counts the cards in, which is what
// lets a screen say a hole is still provisional: unlike low net, where a
// finished card is finished, a single hole can be taken by anyone still out
// on the course.
export const moneyHoleRows = ({ round, hole, field, holeData, maps }) => {
  const h = moneyHole(hole) - 1;
  const rows = field.map(p => {
    const raw = (holeData[`${p.player_id}_${round}`] || {})[h];
    const posted = raw != null && raw > 0;
    const strokes = maps?.[p.player_id]?.[h] || 0;
    return {
      pid: p.player_id, name: p.name, team: p.team,
      posted, strokes,
      gross: posted ? raw : null,
      net: posted ? raw - strokes : null,
    };
  });
  const inPlay = rows.filter(r => r.posted);
  const best = inPlay.length ? Math.min(...inPlay.map(r => r.net)) : null;
  rows.forEach(r => { r.won = r.posted && r.net === best; });
  rows.sort((a, b) =>
    (b.posted ? 1 : 0) - (a.posted ? 1 : 0)
    || (a.posted ? a.net - b.net || a.gross - b.gross : 0)
    || String(a.name).localeCompare(String(b.name)));
  return rows;
};

// Every round's winners, with what each one is owed.
//
// The pot divides by the ROUNDS, exactly as low net's does, and a tied round
// splits ITS share rather than paying out twice — so a tie cannot make one
// hole worth more than a clean one. A round nobody has posted yields nothing
// and is not counted as decided.
export const moneyHoleWins = ({ rounds, hole, field, holeData, mapsFor, pot }) => {
  const list = rounds || [];
  const share = list.length ? (pot || 0) / list.length : 0;
  return list.flatMap(r => {
    const winners = moneyHoleRows({ round: r, hole, field, holeData, maps: mapsFor?.(r) }).filter(x => x.won);
    return winners.map(w => ({ ...w, share: share / winners.length, round: r }));
  });
};
