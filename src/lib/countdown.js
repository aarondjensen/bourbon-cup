// ══════════════════════════════════════════════════════════════════
//  countdown — how long until the field tees off
// ══════════════════════════════════════════════════════════════════
//
//  Ported from the WBC app (lib/market.js), where the same instant does
//  double duty as the prediction market's opening bell. There is no market
//  here, so this is only the first half of that file: the moment, and the
//  arithmetic for how far away it is.
//
//  A deadline printed as a time of day makes a player do arithmetic against
//  their own watch. A countdown answers the only question anybody actually
//  has in February, which is how long until the trip.

import { teeTimeList, parseTeeTime } from "./groups";
import { isISODate } from "./dates";

// ── The moment ─────────────────────────────────────────────────────
//  THE ONE PLACE IN THE APP THAT TURNS A STORED DATE INTO A `Date`, and it
//  does it in LOCAL time on purpose — which is the exact opposite of the rule
//  lib/dates.js sets for everything else.
//
//  The difference is what the value means. Everywhere else a date is a label:
//  "Round 2 is on the 14th" is the same sentence in every timezone, so
//  parsing it at all is how the 14th becomes the evening of the 13th on a
//  phone in Michigan. Here it is an INSTANT — a group is standing on a tee
//  box at 8:30 in the morning — and an instant has to be pinned to a wall
//  clock somewhere. `new Date(y, m, d, h, min)` pins it to the reading
//  phone's zone, which is the course's zone for everybody who is actually
//  going. Somebody counting down from another timezone is off by their
//  offset, and that is the right trade: the fifteen men driving to Gaylord
//  get it exactly right, and the one checking from Denver is out by two
//  hours on a number that reads "3 DAYS".
//
//  Null unless there is BOTH a date and at least one readable tee time —
//  which is what keeps a countdown off a tournament nobody has scheduled
//  yet, rather than showing one that counts to midnight.
export function teeOffAt(dateStr, minutesList) {
  if (!isISODate(dateStr)) return null;
  const mins = (minutesList || []).filter((m) => Number.isFinite(m));
  if (mins.length === 0) return null;
  const [y, m, d] = String(dateStr).split("-").map(Number);
  const first = Math.min(...mins);
  return new Date(y, m - 1, d, Math.floor(first / 60), first % 60).getTime();
}

// The round's own tee sheet, off the round document. `tee_time` is the
// pipe-delimited list of slots the director types in Admin → Rounds
// ("8:30|8:40|8:50"), so the EARLIEST of them is when the field goes out —
// not the first in the string, which is only the first group the director
// happened to type.
export function firstTeeAt(tRounds, roundNumber = 1) {
  const tr = (tRounds || []).find((r) => r?.round_number === roundNumber);
  if (!tr) return null;
  return teeOffAt(tr.date, teeTimeList(tr).map(parseTeeTime));
}

// ── The clock on the wall ──────────────────────────────────────────
// How long is left, broken into cells the header can print one per box.
//
// Rounded UP to the second, so the last tick reads 1 and not 0 — a clock that
// says the field has gone out while it is still standing on the tee is wrong
// about the more interesting of the two.
//
// `urgent` is the last hour. By then it has stopped being information and
// started being a countdown, and the header says so in a different colour.
const HOUR = 3600;
export function countdown(msLeft) {
  const total = Math.max(0, Math.ceil((msLeft ?? 0) / 1000));
  return {
    total,
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / HOUR),
    mins: Math.floor((total % HOUR) / 60),
    secs: total % 60,
    urgent: total > 0 && total <= HOUR,
    done: total <= 0,
  };
}
