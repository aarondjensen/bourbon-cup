// ══════════════════════════════════════════════════════════════════
//  roundSummary — one round, everything it decided.
// ══════════════════════════════════════════════════════════════════
//
// The round-final push says "Round 3 is final" and names the pins, and that
// is all a notification body has room for (see functions/ctpNotice.js for the
// character budget it is written to). This is what the tap lands on: the
// matches, the points they moved, and every side game the round settled, on
// one screen instead of across the Leaderboard and two halves of the Betting
// tab.
//
// ── Nothing here is a second implementation ─────────────────────────
// Every number is produced by the builder that already owns it —
// computeMatchResult for the matches, lib/betting for the four side games —
// bound to exactly the inputs those screens bind them to. That is not a
// stylistic preference: a popup that computed its own skins would eventually
// disagree with the Betting tab about the same pot, in front of the men
// settling it, and there would be no way to tell which was right.
//
// Which also fixes what this can and cannot show. The Betting tab has a
// GROSS/net toggle for skins that is view state and is never stored, so this
// reads NET, which is the tab's own default and what a man sees when he opens
// it. The popup says so rather than leaving it to be inferred.
//
// PURE — no firebase, no React. Tested in roundSummary.test.js.
import { computeMatchResult, statusText } from "../scoring";
import { DEFAULT_FORMAT } from "../constants";
import { isRoundFinal } from "./roundLocks";
import { realPlayers, playerLookup, sideNames } from "./players";
import {
  inField, roundSetup, strokeMapsFor, computeSkins, lowNetRows, ctpTags,
  moneyHole, moneyHoleRows,
} from "./betting";

// ── One round, everything it decided ────────────────────────────────
// Returns a shape a component can render straight through, with every
// section allowed to be EMPTY rather than absent: a round whose skins nobody
// won is a fact about the round, and a section that vanishes reads as a
// screen that failed to load. The component decides what to draw for an empty
// one; this decides what is true.
//
// A null round yields a summary with nothing in it rather than throwing —
// the popup can be opened by a hash a phone kept from last week, and the
// round it names may since have been deleted off the schedule.
export const roundSummary = ({
  round,
  matches = [],
  holeData = {},
  tPlayers = [],
  tRounds = [],
  courses = [],
  roundLocks = {},
  ctpData = {},
  buyIns = null,
  hcpOverrides = {},
  teeAssignments = {},
  teamNames = {},
} = {}) => {
  const empty = {
    round, courseName: null, format: null, final: false,
    points: { A: 0, B: 0, teamA: teamNames.A || "Team A", teamB: teamNames.B || "Team B", leader: null },
    matches: [], ctp: [], skins: [], lowNet: [], moneyHole: null,
    played: false,
  };
  if (round == null) return empty;

  const ctx = { tPlayers, tRounds, courses, roundLocks, hcpOverrides, teeAssignments };
  const { tr, course, pars } = roundSetup({ round, tRounds, courses, roundLocks });
  const format = tr?.format || DEFAULT_FORMAT;
  const { nameOf } = playerLookup(tPlayers);

  // The buy-in fields, each read the way lib/betting reads it: a null list
  // means the director never opened the panel, and that means everybody.
  const roster = realPlayers(tPlayers);
  const skinsField = inField(roster, buyIns?.skinsIn);
  const ctpField = inField(roster, buyIns?.ctpIn);
  const lowNetField = inField(roster, buyIns?.lowNetIn);
  const moneyField = inField(roster, buyIns?.moneyHoleIn);

  // ── The matches ─────────────────────────────────────────────────
  // `statusText` off the engine, rather than the engine's own `status`
  // string. The two say the same thing except that `status` appends the
  // leading side's LETTER — "3&2 (A)" — which is what the Leaderboard wants
  // beside two team columns and is opaque on its own line here. The winner is
  // carried by `winner` instead, which is what colors the row.
  const roundMatches = (matches || []).filter((m) => m?.round === round);
  const matchRows = roundMatches.map((m) => {
    const res = computeMatchResult(
      m, holeData, courses, tRounds, tPlayers, format,
      hcpOverrides, undefined, teeAssignments, roundLocks,
    );
    // ── The one result shape that is not the result shape ─────────
    // A match whose round has NEITHER a course nor a lock bails out of the
    // engine early with a stub — `{ status: "AS", frontPts: 0, … }` — which
    // carries no `overall` segment and no `totalPts` at all. Reading either
    // off it throws, and a round set up but not yet given a course is a
    // perfectly ordinary state for this sheet to be opened on. So both are
    // read defensively, and the row says "—" rather than "AS": nothing was
    // played to a standstill, there is nothing to score against.
    const pts = res.totalPts || { A: 0, B: 0 };
    return {
      id: m.id,
      a: sideNames(m, "A", nameOf),
      b: sideNames(m, "B", nameOf),
      status: res.overall ? statusText(res.overall) : "—",
      pts: { A: pts.A || 0, B: pts.B || 0 },
      holesPlayed: res.holesPlayed || 0,
      // Who the points went to, for the color. Null on a halved match, which
      // is a result and not a missing one.
      winner: (pts.A || 0) > (pts.B || 0) ? "A"
        : (pts.B || 0) > (pts.A || 0) ? "B" : null,
    };
  });

  const A = matchRows.reduce((n, r) => n + r.pts.A, 0);
  const B = matchRows.reduce((n, r) => n + r.pts.B, 0);

  // ── The side games ──────────────────────────────────────────────
  // Skins NET, which is the Betting tab's default (see the note at the top).
  // A hole with a carry has no winner and is not listed — the pot divides by
  // skins won, so a carried hole is money nobody took.
  const maps = strokeMapsFor({ round, field: skinsField, ...ctx });
  const skins = computeSkins({ round, gross: false, field: skinsField, holeData, pars, maps })
    .filter((s) => s.winner)
    .map((s) => ({ hole: s.hole, pid: s.winner.pid, name: s.winner.name, score: s.score, par: s.par }));

  // One round's pins, read through THIS round's par table — a hole the
  // director re-pointed after the fact must not keep a tag on a screen that
  // no longer shows it as a par 3.
  const ctp = ctpTags({ rounds: [round], field: ctpField, ctpData, tRounds, courses, roundLocks })
    .map((t) => ({ hole: t.hole, pid: t.player_id, name: nameOf(t.player_id), distanceFt: t.distance_ft ?? null }))
    .sort((x, y) => x.hole - y.hole);

  // Only a FINISHED card is ranked, and equal lowest cards are co-winners —
  // low net has nowhere to carry to, so the round's share splits.
  const lowNet = lowNetRows({ round, field: lowNetField, holeData, ...ctx })
    .filter((r) => r.won)
    .map((r) => ({ pid: r.pid, name: r.name, gross: r.gross, ch: r.ch, net: r.net }));

  // The money hole is one designated hole a round, lowest net, ties split.
  const mhNumber = moneyHole(buyIns?.moneyHoleNumber);
  const mhWinners = moneyHoleRows({
    round, hole: mhNumber, field: moneyField, holeData,
    maps: strokeMapsFor({ round, field: moneyField, ...ctx }),
  }).filter((r) => r.won);

  return {
    round,
    courseName: course?.name || null,
    format,
    final: isRoundFinal(roundLocks, round),
    points: {
      A, B,
      teamA: teamNames.A || "Team A",
      teamB: teamNames.B || "Team B",
      leader: A > B ? "A" : B > A ? "B" : null,
    },
    matches: matchRows,
    ctp,
    skins,
    lowNet,
    moneyHole: {
      hole: mhNumber,
      par: pars?.[mhNumber - 1] ?? null,
      winners: mhWinners.map((r) => ({ pid: r.pid, name: r.name, gross: r.gross, net: r.net })),
    },
    // Whether anybody put a pencil to this round at all. A round with no
    // scores is not a round with nothing in it — it is a round that has not
    // happened, and the popup says a different thing about each.
    played: roundMatches.length > 0
      && roster.some((p) => Object.keys(holeData[`${p.player_id}_${round}`] || {}).length > 0),
  };
};
