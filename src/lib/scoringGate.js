// ══════════════════════════════════════════════════════════════════
//  scoringGate — which round a phone lands on, and when it may post.
// ══════════════════════════════════════════════════════════════════
//
// Ported from WBC, where the gate was written against a specific failure:
//
//   A phone that can post to any round at any moment will eventually post
//   Round 3 scores into Round 1, usually on the morning of Round 3 when
//   somebody opens the app before the pairings have moved.
//
// Those scores are real documents on a real leaderboard and somebody has to
// go and find them. This app was open to exactly that. The Scoring tab points
// at `currentRoundNumber` — the lowest round nobody has FINALIZED — so on the
// Saturday of a four-round week, with Friday's round still unfinalized because
// one group has not attested, every phone in the field opens on Round 1 and
// says so quietly at the top of the screen.
//
// ── Two halves, and the first one does most of the work ──
// WBC answers this by closing the door. That is right for WBC, whose rounds
// always carry a date. Closing it here would lock the field out of every
// edition that has no dates set — the ten imported years, the demo, and any
// tournament a director has drawn but not yet scheduled — so the shape is
// different:
//
//   roundForToday   picks the round SCHEDULED for today, and the Scoring tab
//                   prefers it over the oldest unfinalized one. This is the
//                   fix: the tab lands on the round being played, so the
//                   wrong-round score is never typed in the first place.
//   isScoringOpen   is the backstop, and it only ever engages on a round that
//                   HAS a date. An undated round is exactly as open as it has
//                   always been.
//
// Every "no" here is a closed door on a tee box, so the defaults fail toward
// the field rather than toward the rule. A round with no date, a tournament
// with no dates at all, a tee sheet nobody filled in — all open. The one case
// that closes is a round dated for a day that is not today, which is the case
// that cannot be anything but a mistake.
//
// Pure, and injectable: `today` and `now` are arguments so every branch is
// testable at a chosen moment, and every caller in the app omits them.
import { todayISO, isISODate } from "./dates";
import { teeTimeList, parseTeeTime } from "./groups";

// Minutes before the first tee time that scoring unlocks for non-directors.
// Half an hour is the range: a group is on the putting green by then and the
// first card is sometimes started before anybody reaches the tee.
export const SCORING_LEAD_MIN = 30;

// A round's scheduled day, or null. `bc_rounds.date` is a YYYY-MM-DD string
// end to end — see lib/dates for why this file never builds a Date from it.
export const roundDate = (tRounds, round) => {
  const tr = (tRounds || []).find(r => r.round_number === round);
  return isISODate(tr?.date) ? tr.date : null;
};

// Whether this tournament schedules its rounds at all. The gate below is
// inert until it does, so an edition that has never been dated behaves
// exactly as it did before this file existed.
export const hasRoundDates = (tRounds) =>
  (tRounds || []).some(r => isISODate(r?.date));

// The round scheduled for today, or null. This is what the Scoring tab should
// prefer over the lowest unfinalized round: on the morning of Round 3, Round 3
// is the answer even when Round 1 is still waiting on an attestation.
//
// `rounds` scopes it to the rounds that actually exist in this edition, so a
// stale round document left behind by a shortened week cannot pull the tab
// onto a round with no draw. Ties — two rounds dated the same day, which a
// 36-hole day is — go to the lowest, which is the one played first.
export function roundForToday({ tRounds, rounds, today = todayISO() } = {}) {
  const live = new Set(rounds || []);
  const dated = (tRounds || [])
    .filter(r => live.has(r?.round_number) && isISODate(r?.date) && r.date === today)
    .map(r => r.round_number)
    .sort((a, b) => a - b);
  return dated.length ? dated[0] : null;
}

// The earliest tee time on a round, in minutes past midnight, or null when
// the round has no tee sheet. The tee sheet is optional here — a round that
// nobody has timed is open all day rather than closed all day.
export const firstTeeMinutes = (tRounds, round) => {
  const tr = (tRounds || []).find(r => r.round_number === round);
  const mins = teeTimeList(tr).map(parseTeeTime).filter(n => Number.isFinite(n));
  return mins.length ? Math.min(...mins) : null;
};

// ── The gate ───────────────────────────────────────────────────────
// Returns { open, reason }, because the screen has to say WHY rather than
// present a dead grid. `reason` is null when the door is open.
//
//   director      always. They are the fix-it path — a phone died, a card was
//                 entered against the wrong name, a round has to be re-scored
//                 the next morning — and a gate that locks the director out
//                 locks out the only person who can repair it.
//   force-open    a director has flipped this round open in Admin. The escape
//                 hatch for a day that does not match the schedule: a rain
//                 delay, a shotgun start, a round moved forward.
//   undated       open. See the note at the top: this app has editions that
//                 will never carry a date, and closing them is a worse bug
//                 than the one being fixed.
//   wrong day     closed, and this is the only thing that closes.
//   too early     closed until SCORING_LEAD_MIN before the first tee time,
//                 and only when the round HAS a tee sheet.
export function isScoringOpen({
  round, tRounds, scoringOpen, isDirector = false,
  today = todayISO(), now = new Date(),
} = {}) {
  if (isDirector) return { open: true, reason: null };
  if (round == null) return { open: true, reason: null };
  if (scoringOpen && scoringOpen[round] === true) return { open: true, reason: null };

  const date = roundDate(tRounds, round);
  if (!date) return { open: true, reason: null };          // undated → unchanged behaviour

  if (date !== today) {
    return {
      open: false,
      reason: date > today ? "not-yet" : "past",
      date,
    };
  }

  const tee = firstTeeMinutes(tRounds, round);
  if (tee == null) return { open: true, reason: null };    // no tee sheet → open all day

  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins < tee - SCORING_LEAD_MIN) {
    return { open: false, reason: "too-early", date, teeMinutes: tee };
  }
  return { open: true, reason: null };
}

// What to put on screen. Pure so the wording is pinned by a test and cannot
// drift from the rule above.
export function scoringClosedMessage(verdict, round) {
  if (!verdict || verdict.open) return null;
  if (verdict.reason === "not-yet") {
    return {
      title: `Round ${round} hasn't started`,
      body: "Scoring opens on the day it's played. A director can open it early from Admin → Rounds.",
    };
  }
  if (verdict.reason === "past") {
    return {
      title: `Round ${round} was played earlier`,
      body: "Scoring for a past round is a director's job — ask one to open it or to enter the card.",
    };
  }
  return {
    title: `Round ${round} opens closer to your tee time`,
    body: "Scoring unlocks half an hour before the first group goes off.",
  };
}
