// ══════════════════════════════════════════════════════════════════
//  archiveLive — the running year, in the archive's own row shapes.
// ══════════════════════════════════════════════════════════════════
//
// The archive holds the years that are over (pipeline/archive.mjs). This turns
// the edition the app is actually subscribed to into rows of exactly the same
// shape, so lib/archiveFold can add today to the record without knowing which
// of the two it is looking at.
//
// That is the whole trick of the Data tab: one definition of a win, one
// definition of a career, and a live match folded in by the same arithmetic
// that folded 2016. The alternative — precomputed career totals plus a second
// implementation to add this year to them — is how the two halves of a screen
// come to disagree about somebody's record.
//
// It imports the scoring engine, so it stays out of archiveFold.js, which is
// deliberately arithmetic-only.
//
// ── Which year this is ────────────────────────────────────────────
// Whichever edition is open. Switch to 2019 and the "live" year IS 2019, read
// out of Firestore rather than out of the archive — and `mergeLive` drops
// the archive's copy of that year so nothing is counted twice. The two agree
// (historyVerify proves it on every `npm test`), so which one wins is a
// question of freshness, not of truth: the live one can have a director's
// correction on it that the committed archive has not been rebuilt for.
import { computeMatchResult, getRoundCourseCtx } from "../scoring";
import { DEFAULT_FORMAT, SCORING_TYPE_MATCH } from "../constants";
import { isRoundFinal } from "./roundLocks";
import { realPlayers } from "./players";
import { scheduledRounds } from "./rounds";
import { aliasIndex, norm } from "./archiveFold";

export const HOLES_PER_ROUND = 18;

// ── Who this is, across ten years ─────────────────────────────────
// A roster row is a tournament ENTRY — one year of one golfer — and the ids
// are per-year by construction (`hist_2019_paulw`, `bc_player_1712...`). A
// career needs the golfer, so every row has to resolve to one canonical id.
//
// Four ways, most explicit first:
//
//   career_id       written on the row. Nothing writes it today; it is the
//                   escape hatch for the case the other three cannot solve —
//                   two men who genuinely share a display name.
//   hist_<y>_<id>   the imported years carry the canonical id in the id.
//   name            matched against the registry's every known spelling,
//                   including the handles the sheets changed to in 2022.
//   first + last    for a roster row whose display name was edited.
//
// Unresolved is not an error: somebody's first cup is a golfer the archive has
// never heard of. They get a `live:` id and a career one year long, which is
// exactly right.
export const canonicalId = (player, index) => {
  if (!player) return null;
  if (player.career_id) return player.career_id;
  const pid = String(player.player_id || player.id || "");
  const hist = pid.match(/^hist_\d{4}_(.+)$/);
  if (hist && index.has(norm(hist[1]))) return index.get(norm(hist[1]));
  const tries = [
    player.name,
    player.first_name && player.last_name ? `${player.first_name} ${player.last_name}` : null,
    player.first_name && player.last_name ? `${player.first_name} ${player.last_name[0]}` : null,
  ];
  for (const t of tries) {
    const hit = t && index.get(norm(t));
    if (hit) return hit;
  }
  return pid ? `live:${pid}` : null;
};

// ── The running year as rows ──────────────────────────────────────
export const liveFacts = ({
  year, tPlayers = [], matches = [], holeData = {}, tRounds = [], courses = [],
  hcpOverrides = {}, teeAssignments = {}, roundLocks = {}, teamNames = {},
  players: registry = [],
} = {}) => {
  if (!year) return null;
  const index = aliasIndex(registry);
  const roster = realPlayers(tPlayers).filter((p) => p.player_id);
  const idOf = new Map(roster.map((p) => [p.player_id, canonicalId(p, index)]));
  const cid = (pid) => idOf.get(pid) || null;

  const roundNumbers = scheduledRounds({ tRounds, matches, roundLocks });
  const ctxFor = {};
  const ctx = (round) => (ctxFor[round] ||= getRoundCourseCtx({ roundLocks, round, tRounds, courses }));
  const formatOf = (round) => tRounds.find((t) => t.round_number === round)?.format || DEFAULT_FORMAT;

  const roundRows = roundNumbers.map((round) => {
    const c = ctx(round);
    const course = courses.find((x) => x.id === tRounds.find((t) => t.round_number === round)?.course_id) || null;
    return {
      year, round,
      format: formatOf(round),
      course: course?.name || "",
      // Summed off the holes, like everywhere else on this tab and for the
      // reason lib/tripInfo gives: a stored `par` and a scorecard can disagree.
      par: (c.holePars || []).reduce((a, b) => a + b, 0) || null,
      rating: course?.rating ?? null,
      slope: course?.slope ?? null,
    };
  });

  // Matches, scored by the app's engine — the same call the leaderboard makes,
  // so a live row and an archived one are the same kind of fact.
  const front = {};
  const matchRows = matches
    .filter((m) => roundNumbers.includes(m.round))
    .map((m) => {
      const fmt = formatOf(m.round);
      const res = computeMatchResult(
        m, holeData, courses, tRounds, tPlayers, fmt,
        hcpOverrides, undefined, teeAssignments, roundLocks,
      );
      // The status at the turn, banked per player so a card row can carry it.
      // Only on a match-play round: "down three" is a sentence about holes,
      // and a Total round has no such thing to be down by.
      const scoring = tRounds.find((t) => t.round_number === m.round)?.scoring_type;
      const turn = (scoring == null || scoring === SCORING_TYPE_MATCH) && res.front?.played === 9
        ? res.front.margin : null;
      if (turn != null) {
        (m.teamA || []).forEach((p) => { front[`${m.round}_${p}`] = turn; });
        (m.teamB || []).forEach((p) => { front[`${m.round}_${p}`] = -turn; });
      }
      return {
        year, round: m.round,
        A: (m.teamA || []).map(cid).filter(Boolean).sort(),
        B: (m.teamB || []).map(cid).filter(Boolean).sort(),
        ptsA: res.totalPts.A,
        ptsB: res.totalPts.B,
      };
    })
    .filter((m) => m.A.length && m.B.length);

  // Cards — COMPLETE rounds only. A man through fourteen is not having a good
  // week, he is unfinished, and folding his card into an average would put
  // whoever had played least on top — the same trap the Low Net board avoids
  // for the same reason.
  const cardRows = [];
  roster.forEach((p) => {
    roundNumbers.forEach((round) => {
      const card = holeData[`${p.player_id}_${round}`] || {};
      const played = Object.keys(card).filter((h) => card[h] > 0).map(Number);
      if (played.length !== HOLES_PER_ROUND) return;
      const pars = ctx(round).holePars || [];
      const gross = played.reduce((s, h) => s + card[h], 0);
      const parSum = played.reduce((s, h) => s + (pars[h] ?? 4), 0);
      let e = 0, b = 0, pr = 0, bo = 0, d = 0;
      played.forEach((h) => {
        const v = card[h] - (pars[h] ?? 4);
        if (v <= -2) e += 1; else if (v === -1) b += 1; else if (v === 0) pr += 1;
        else if (v === 1) bo += 1; else d += 1;
      });
      const turn = front[`${round}_${p.player_id}`];
      cardRows.push({
        year, round, p: cid(p.player_id),
        g: gross,
        ch: roundLocks?.[round]?.players?.[p.player_id]?.ch ?? null,
        tp: gross - parSum,
        e, b, pr, bo, d,
        ...(turn != null ? { a9: turn } : {}),
      });
    });
  });

  const complete = roundNumbers.length > 0 && roundNumbers.every((r) => isRoundFinal(roundLocks, r));

  return {
    // pid → canonical id, for the caller that needs to point at a golfer it
    // only knows by roster row (the Data tab highlighting your own line).
    ids: idOf,
    // Only golfers the registry has never heard of are added — everyone else
    // is already in it under the name the archive knows them by, and a second
    // entry would rename them for every year they have ever played.
    players: roster
      .filter((p) => String(cid(p.player_id) || "").startsWith("live:"))
      .map((p) => ({ id: cid(p.player_id), name: p.name || "", aka: [] })),
    edition: {
      year,
      teamA: teamNames.A || "",
      teamB: teamNames.B || "",
      complete,
      roster: roster.map((p) => ({ p: cid(p.player_id), t: p.team === "B" ? "B" : "A" }))
        .filter((r) => r.p),
    },
    rounds: roundRows,
    matches: matchRows,
    cards: cardRows,
  };
};

// ── Archive + today ───────────────────────────────────────────────
// The live year REPLACES the archive's copy of itself. Both exist for a year
// the app is open on — the archive was built from the same sheets the import
// wrote — and counting a man's four rounds twice would double his career and
// halve his scoring average with no error anywhere to find.
//
// Unless the live year has no matches yet, in which case it does not replace
// anything. That is not a nicety: the app's subscriptions arrive over several
// frames, so for the first of them the running edition looks like a
// tournament nobody has played, and replacing a finished year with THAT would
// blank a decade of records on screen and then fill them back in. A live year
// the archive has never heard of is still added — a draft edition a director
// made this morning is genuinely a year with nothing in it.
export const mergeLive = (archive, live) => {
  if (!archive) return null;
  if (!live) return archive;
  const y = live.edition.year;
  const known = (archive.editions || []).some((e) => e.year === y);
  if (known && !live.matches.length) return archive;
  const drop = (rows) => (rows || []).filter((r) => r.year !== y);
  return {
    players: [...(archive.players || []), ...(live.players || [])],
    editions: [...drop(archive.editions), live.edition],
    rounds: [...drop(archive.rounds), ...live.rounds],
    matches: [...drop(archive.matches), ...live.matches],
    cards: [...drop(archive.cards), ...live.cards],
  };
};
