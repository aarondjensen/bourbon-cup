// ══════════════════════════════════════════════════════════════════
//  betting — the three side games, and what everybody ends up owing.
// ══════════════════════════════════════════════════════════════════
//
// Skins, closest-to-the-pin and low net were each worked out inline inside
// BettingView, which was fine while the only question was "who is winning
// this one". It stopped being fine at the question the trip actually ends on:
// what does each player NET across all three.
//
// Nothing here is stored. A skin is whoever is lowest on the hole, worked out
// from the cards every time it is asked for — see the note over onSetCtp in
// App about why there is no onSetSkin. This module is that derivation, moved
// somewhere two screens can share it, so the tab that lists the skins and the
// tab that pays them out cannot come to different totals.
//
// ── What a pot is worth ───────────────────────────────────────────────
// Two shapes, and the difference matters at settlement:
//
//   COUNTED   a buy-in price is set, so the pot is the price times the number
//             of players in. Every player's stake is known, so the game can be
//             settled — won minus paid.
//   TYPED     no price, just a figure somebody entered for the skins pot. It
//             is a real pot and it still pays out, but nobody's stake is
//             recorded, so a net position cannot be computed and this module
//             says so rather than assuming everybody put in an equal share.
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

// ── Settlement ────────────────────────────────────────────────────────
// One row per player: what they staked, what each game paid them, and the
// difference. This is the number the trip actually ends on.
//
// The three games are summed but never mixed — a player can be up on skins and
// down overall, and the row shows both — and a game with no buy-in price
// contributes winnings without a stake, which is flagged rather than guessed
// at. See the note on pot shapes at the top.
//
// Money is carried as exact numbers and rounded only where it is printed. A
// pot divided three ways does not come out even, and rounding each share on
// the way in is how a settlement ends up a cent short of its own pot.
export const settle = ({
  players, rounds, holeData, ctpData, tPlayers, tRounds, courses, roundLocks,
  hcpOverrides, teeAssignments, buyIns = {}, skinsPot = 0, grossSkins = true,
}) => {
  const skinsField = inField(players, buyIns.skinsIn);
  const ctpField = inField(players, buyIns.ctpIn);
  const lowNetField = inField(players, buyIns.lowNetIn);

  const skinsPriced = (buyIns.skinsAmount || 0) > 0;
  const skinsPotValue = skinsPriced ? skinsField.length * buyIns.skinsAmount : skinsPot;
  const ctpPotValue = (buyIns.ctpAmount || 0) > 0 ? ctpField.length * buyIns.ctpAmount : 0;
  const lowNetPotValue = (buyIns.lowNetAmount || 0) > 0 ? lowNetField.length * buyIns.lowNetAmount : 0;

  // Skins won, across every round.
  const skinsWon = {};
  let totalSkins = 0;
  rounds.forEach(round => {
    const { pars } = roundSetup({ round, tRounds, courses, roundLocks });
    const maps = grossSkins ? null : strokeMapsFor({
      round, field: skinsField, tPlayers, tRounds, courses, roundLocks, hcpOverrides, teeAssignments,
    });
    computeSkins({ round, gross: grossSkins, field: skinsField, holeData, pars, maps })
      .filter(s => s.winner)
      .forEach(s => { skinsWon[s.winner.pid] = (skinsWon[s.winner.pid] || 0) + 1; totalSkins += 1; });
  });
  const perSkin = totalSkins ? skinsPotValue / totalSkins : 0;

  // Pins taken.
  const pins = {};
  const tags = ctpTags({ rounds, field: ctpField, ctpData, tRounds, courses, roundLocks });
  tags.forEach(t => { pins[t.player_id] = (pins[t.player_id] || 0) + 1; });
  const perPin = tags.length ? ctpPotValue / tags.length : 0;

  // Low net, a share per ROUND rather than per win — so a tied round cannot
  // pay out more in total than a clean one, which dividing by wins would do.
  const lowNetMoney = {};
  const lowNetWins = {};
  const roundShare = rounds.length ? lowNetPotValue / rounds.length : 0;
  rounds.forEach(round => {
    const winners = lowNetRows({
      round, field: lowNetField, holeData, tPlayers, tRounds, courses, roundLocks,
      hcpOverrides, teeAssignments,
    }).filter(r => r.won);
    winners.forEach(w => {
      lowNetMoney[w.pid] = (lowNetMoney[w.pid] || 0) + roundShare / winners.length;
      lowNetWins[w.pid] = (lowNetWins[w.pid] || 0) + 1;
    });
  });

  const has = (field, pid) => field.some(p => p.player_id === pid);
  const rows = players.map(p => {
    const pid = p.player_id;
    const inSkins = has(skinsField, pid), inCtp = has(ctpField, pid), inLowNet = has(lowNetField, pid);
    const won = {
      skins: (skinsWon[pid] || 0) * perSkin,
      ctp: (pins[pid] || 0) * perPin,
      lowNet: lowNetMoney[pid] || 0,
    };
    const paid =
      (inSkins && skinsPriced ? buyIns.skinsAmount : 0)
      + (inCtp ? (buyIns.ctpAmount || 0) : 0)
      + (inLowNet ? (buyIns.lowNetAmount || 0) : 0);
    const total = won.skins + won.ctp + won.lowNet;
    return {
      pid, name: p.name, team: p.team,
      skins: skinsWon[pid] || 0, pins: pins[pid] || 0, lowNet: lowNetWins[pid] || 0,
      won, total, paid, net: total - paid,
      // In the settlement means having money in it — a stake down or a
      // payout coming — NOT merely being in a field.
      //
      // Those come apart because an untagged buy-in list means everybody, so
      // a tournament that priced only skins still has all sixteen players
      // "in" CTP and low net at nought a head. Reading membership would have
      // listed the whole roster on a card about money, most of them with no
      // money in it.
      playing: paid > 0 || total > 0,
    };
  })
    // Up first, then down — a settlement is read from the top by whoever is
    // owed, and by everybody else to find out what they owe.
    .sort((a, b) => b.net - a.net || String(a.name || "").localeCompare(String(b.name || "")));

  return {
    rows,
    pots: { skins: skinsPotValue, ctp: ctpPotValue, lowNet: lowNetPotValue },
    // Whether every game in play has a recorded stake. False means the skins
    // pot was typed rather than bought into, so `paid` is incomplete and the
    // screen has to say so instead of showing a net that is quietly wrong.
    staked: !skinsPotValue || skinsPriced,
    totalSkins, totalPins: tags.length,
  };
};
