// ══════════════════════════════════════════════════════════════════
//  editionSummary — what a finished cup reads as, in one row.
// ══════════════════════════════════════════════════════════════════
//
// The Data tab's Tournament half used to render `bc_historical`: one
// hand-typed document per year, carrying the two team names and the two
// scores, with the app telling its own director that "historical data can be
// added by directors via Firestore directly for now."
//
// That was a second answer to "who won 2019", and the weaker one. Every year
// from 2016 on now exists as a whole edition — the roster, the draw, the round
// setup and all sixty-four cards of it — and src/lib/historyVerify re-scores
// each of them against three independent records on every `npm test`. So the
// cards are checked and the summary was not, and nothing reconciled them: a
// typo in a hand-entered score would have shown one number on that tab
// and a different one on that year's own leaderboard, with nothing to say
// which was right.
//
// This computes the row from the cards, using the same engine the leaderboard
// uses. One source, and it cannot disagree with itself.
//
// ── Why it is stored at all ───────────────────────────────────────────
// Deriving ten years live would mean subscribing to ten editions — roughly a
// thousand documents each — every time somebody opened the tab. The app is
// careful about exactly this (see the note on the photo index in App), so the
// summary is written back onto the edition document and the tab reads that.
//
// It is a CACHE of the cards, not a parallel record of the result, and the
// difference shows in when it is written: only once a tournament is complete,
// from an edition that is fully loaded anyway, by the one person whose writes
// the rules accept. Nothing types it and nothing can edit it.
import { computeMatchResult } from "../scoring";
import { DEFAULT_FORMAT } from "../constants";
import { isRoundFinal } from "./roundLocks";
import { scheduledRounds } from "./rounds";

// The shape stored on a bc_editions document under `result`.
//
// Team NAMES are stored rather than looked up, because they are a property of
// the year: 2023 was TEES against WEEZ and 2016 was BIRDS against SHOOTERS,
// and a row that rendered them in this year's names would be quietly wrong
// about every year but this one.
export const summarizeEdition = ({
  matches = [], holeData = {}, courses = [], tRounds = [], tPlayers = [],
  hcpOverrides = {}, teeAssignments = {}, roundLocks = {},
  teamNames = {}, location = "",
} = {}) => {
  let A = 0, B = 0;
  matches.forEach((m) => {
    const fmt = tRounds.find((t) => t.round_number === m.round)?.format || DEFAULT_FORMAT;
    const res = computeMatchResult(
      m, holeData, courses, tRounds, tPlayers, fmt,
      hcpOverrides, undefined, teeAssignments, roundLocks,
    );
    A += res.totalPts.A;
    B += res.totalPts.B;
  });

  const rounds = scheduledRounds({ tRounds, matches, roundLocks });
  // Complete means every round somebody played has been signed off, and there
  // was at least one. A tournament mid-round has a score, but it does not yet
  // have a RESULT, and the difference is what decides whether this gets
  // written down at all.
  const complete = rounds.length > 0 && rounds.every((r) => isRoundFinal(roundLocks, r));

  return {
    teamA: teamNames.A || "",
    teamB: teamNames.B || "",
    scoreA: A,
    scoreB: B,
    // The name, not the letter. A row saying "A won" means nothing three years
    // later; a row saying "SHOT CALLERS won" is the thing anybody remembers.
    // Null on a halved cup, which is a real outcome and not a missing one.
    winner: A > B ? (teamNames.A || "A") : B > A ? (teamNames.B || "B") : null,
    halved: complete && A === B,
    rounds: rounds.length,
    complete,
    location: location || "",
  };
};

// Two summaries that say the same thing. Used to decide whether a stored row
// is worth rewriting — the scores are the only fields that can move once a
// cup is over, but a renamed team or a corrected venue should land too.
export const sameSummary = (a, b) =>
  !!a && !!b
  && a.scoreA === b.scoreA && a.scoreB === b.scoreB
  && a.teamA === b.teamA && a.teamB === b.teamB
  && a.location === b.location && a.rounds === b.rounds
  && a.complete === b.complete;
