// ══════════════════════════════════════════════════════════════════
//  betting — the three side games the app actually scores.
// ══════════════════════════════════════════════════════════════════
//
// Skins, closest-to-the-pin and low net were each worked out inline inside
// BettingView. They live here so the derivation has one author, and so a
// screen that lists the winners and a screen that counts them cannot come to
// different totals.
//
// Nothing here is stored. A skin is whoever is lowest on the hole, worked out
// from the cards every time it is asked for — see the note over onSetCtp in
// App about why there is no onSetSkin.
//
// The fourth Betting tab is not in this file and never will be: a side bet is
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

