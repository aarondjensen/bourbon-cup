// ══════════════════════════════════════════════════════════════════
//  Trip Info — the weekend at a glance
// ══════════════════════════════════════════════════════════════════
//
// Everything a player asks in the group text the week before: when is it,
// where are we staying, and what are we playing. All three answers already
// existed in the app and none of them were on a screen a player could open —
// the courses were inside the director's round setup, the dates were nowhere,
// and the house was in somebody's email.
//
// ── Nothing here is a second copy ─────────────────────────────────
// That is the whole design constraint. A Trip Info screen with its own fields
// for the dates and the courses would be a second place to type them and
// therefore a second place for them to be wrong, and the wrong one would be
// the one players read. So:
//
//   COURSES  come off the rounds (`bc_rounds.course_id` → `bc_courses`), which
//            is where the director already picks them, one per round.
//   DATES    come off the rounds too — a `date` field on the round document,
//            set in Admin → Rounds beside its course and its tee times. The
//            TRIP's dates are then the first and last of them, derived rather
//            than entered, so a schedule that moves cannot disagree with a
//            banner that did not.
//   THE HOUSE is the one genuinely new fact, and the only thing a director
//            types for this screen. It lives in bc_settings/<edition>__trip.
//
// Deliberately NOT cloned into a new edition (see lib/editions cloneEdition,
// which copies team_names, branding and tournament and nothing else): last
// year's rental link on this year's Trip Info would send the field to the
// wrong house, which is exactly the kind of quiet wrongness nobody checks.

import { formatISODate, formatISORange, isISODate } from "./dates";

// The bc_settings document id, edition-scoped by the caller through
// editionDocId — same as team_names, branding and dues.
export const TRIP_SETTINGS_ID = "trip";

export const MAX_HOUSE_NAME = 80;

// ── The house link ────────────────────────────────────────────────
// A link a director pastes becomes an anchor every player taps, so what
// counts as a link is a decision this module makes rather than the browser.
// Only http and https: a `javascript:` URL in an href is a script that runs
// with the app's own origin, and while only a director can write this field,
// "only a trusted person can set it" is the argument behind every stored-XSS
// there has ever been.
//
// A bare "vrbo.com/12345" is what somebody actually pastes off a phone, so it
// is accepted and https:// is put on the front — refusing it would only teach
// the director to give up.
export const safeHouseUrl = (raw) => {
  const s = String(raw || "").trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    // A hostname with no dot is not a public address — it is somebody's typo,
    // or "localhost", and neither is a rental listing.
    if (!u.hostname.includes(".")) return null;
    return u.href;
  } catch { return null; }
};

// "vrbo.com" — what a link says when it has no name in front of it. The
// alternative is printing the whole URL, and a VRBO link is 140 characters of
// tracking parameters.
export const linkHost = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url || ""; }
};

// The stored document, normalized. `url` is null unless it is a link this
// module would let a player tap.
export const houseFrom = (doc) => {
  const url = safeHouseUrl(doc?.house_url);
  return {
    name: String(doc?.house_name || "").trim().slice(0, MAX_HOUSE_NAME),
    url,
    // What the button should SAY. The name if there is one, the host if there
    // is only a link, and nothing if there is neither.
    label: String(doc?.house_name || "").trim().slice(0, MAX_HOUSE_NAME) || (url ? linkHost(url) : ""),
  };
};

export const hasHouse = (house) => !!(house?.name || house?.url);

// ── The schedule ──────────────────────────────────────────────────
// One row per round the tournament actually has, in round order, carrying
// whatever is known about it. Rounds with nothing set still appear: a player
// reading "Round 3 — course not set yet" learns something true, and a row
// that vanished would read as a three-round trip.
//
// `rounds` is the ROUND NUMBERS the tournament holds (lib/rounds allRounds),
// not the documents — a round nobody has opened in Admin has no document at
// all, and it is still a round that is going to be played.
export const tripSchedule = ({ rounds, tRounds, courses }) =>
  (rounds || []).map(n => {
    const doc = (tRounds || []).find(r => r.round_number === n) || null;
    const course = doc?.course_id
      ? (courses || []).find(c => c.id === doc.course_id) || null
      : null;
    return {
      round: n,
      date: isISODate(doc?.date) ? doc.date : null,
      course,
      courseName: course?.name || "",
      // The raw format id; the screen turns it into a label off the catalog
      // in constants. Null on a round nobody has set up, which is what stops
      // "Singles" being printed under a course that has not been chosen —
      // the round form's default is not a decision anybody has made yet.
      format: doc?.format || null,
      // The FIRST tee time of the round, which is the one a player needs the
      // night before. The rest of the sheet is per-group and lives on the
      // Matches tab, where a player can find their own.
      teeTime: String(doc?.tee_time || "").split("|")[0].trim(),
    };
  });

// The trip's own dates: the first and last round dates that exist. Derived,
// never entered — see the header. `label` is the span as a reader would say
// it, and empty when no round carries a date yet.
export const tripDates = (schedule) => {
  const dates = (schedule || []).map(r => r.date).filter(Boolean).sort();
  const from = dates[0] || null;
  const to = dates[dates.length - 1] || null;
  return { from, to, label: from ? formatISORange(from, to) : "", count: dates.length };
};

// How a schedule row says its own day. "Thu, Aug 13" — the weekday is the
// half a golfer actually plans around, and the month is what makes it real.
export const scheduleDayLabel = (row) =>
  row?.date ? formatISODate(row.date, { weekday: true }) : "";

// The DISTINCT courses across the trip, each carrying the rounds played on
// it. A trip that plays the same course twice is one card saying "Rounds 1 &
// 3", not the same card printed twice.
export const tripCourses = (schedule) => {
  const out = [];
  (schedule || []).forEach(row => {
    if (!row.course) return;
    const seen = out.find(c => c.course.id === row.course.id);
    if (seen) seen.rounds.push(row.round);
    else out.push({ course: row.course, rounds: [row.round] });
  });
  return out;
};

// A course's yardage, taken across its tee boxes — "5,912 – 6,845 yds", or the
// single figure when there is only one tee. Zero-yardage boxes are dropped
// rather than shown as 0: a course imported without a scorecard has them, and
// "0 – 6,845" is worse than saying nothing.
export const courseYardage = (course) => {
  const yards = (course?.tee_boxes || [])
    .map(t => parseInt(t.yardage, 10))
    .filter(y => Number.isFinite(y) && y > 0)
    .sort((a, b) => a - b);
  if (!yards.length) return "";
  const fmt = (y) => y.toLocaleString("en-US");
  const lo = yards[0], hi = yards[yards.length - 1];
  return lo === hi ? `${fmt(lo)} yds` : `${fmt(lo)} – ${fmt(hi)} yds`;
};

// "Gaylord, MI" off a course document, either half missing.
export const courseWhere = (course) =>
  [course?.city, course?.state].map(s => String(s || "").trim()).filter(Boolean).join(", ");

// Is there anything to show at all? A tournament with no dates, no house and
// no courses has an empty screen, and the screen should say so plainly rather
// than render three empty sections.
export const hasTripInfo = ({ house, schedule }) =>
  hasHouse(house)
  || (schedule || []).some(r => r.date || r.course || r.teeTime);
