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
//   DATES    come off the TOURNAMENT — one pair, `start_date` / `end_date` on
//            bc_settings/<edition>__tournament, set in Admin → Event.
//            Everything downstream reads from it: the round date picker offers
//            the days between them, so a round cannot be dated outside the
//            trip, and this screen's banner is that pair.
//   THE HOUSE is the one genuinely new fact, and the only thing a director
//            types for this screen. It lives in bc_settings/<edition>__trip.
//
// Neither the house nor the dates survive into a new edition — cloneEdition
// does not copy the trip document at all, and it strips `start_date` /
// `end_date` off the tournament document it does copy. Last year's rental
// link and last year's weekend on this year's Trip Info are exactly the kind
// of quiet wrongness nobody thinks to re-check.

import { formatISODate, formatISORange, isISODate, rangeDays, daysBetween } from "./dates";

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

// ── The trip's dates ──────────────────────────────────────────────
// THE TOURNAMENT'S OWN PAIR IS THE SOURCE OF TRUTH — `start_date` and
// `end_date` on bc_settings/<edition>__tournament, set in Admin → Event.
// Everything else that shows a date reads down from it: the round picker in
// Admin → Rounds offers the days between them, and Trip Info's banner is them.
//
// They were derived from the round dates first, and that was the wrong way
// round. A director knows the weekend before they know which course is on
// which day — the trip is booked in February and the draw happens in July —
// so deriving made the app unable to answer "when is it" until the schedule
// was built, which is exactly the stretch of months when people ask.
//
// Falling back to the round dates when the pair is unset is not a second
// source of truth; it is what an edition set up before this field existed
// still reads as, and it goes away the moment a director saves the pair.
export const tripDates = ({ trip, schedule } = {}) => {
  const stored = {
    from: isISODate(trip?.start_date) ? trip.start_date : null,
    to: isISODate(trip?.end_date) ? trip.end_date : null,
  };
  if (stored.from || stored.to) {
    // One end alone is a real answer — a director who has only typed the
    // first day should see the first day, not nothing.
    const from = stored.from || stored.to;
    const to = stored.to || stored.from;
    return { from, to, label: formatISORange(from, to), count: 2, derived: false };
  }
  const dates = (schedule || []).map(r => r.date).filter(Boolean).sort();
  const from = dates[0] || null;
  const to = dates[dates.length - 1] || null;
  return {
    from, to,
    label: from ? formatISORange(from, to) : "",
    count: dates.length,
    derived: dates.length > 0,
  };
};

// The days a round can be played on: every date from the trip's first to its
// last. This is what "Rounds pulls from Tournament" means concretely — the
// round date picker offers these rather than the whole calendar, so a round
// cannot be dated outside the trip it belongs to.
//
// Empty when the trip has no dates set, which is what tells the round form to
// fall back to a plain date box rather than showing an empty dropdown.
export const tripDayOptions = (trip) => {
  const from = isISODate(trip?.start_date) ? trip.start_date : null;
  const to = isISODate(trip?.end_date) ? trip.end_date : from;
  return from ? rangeDays(from, to) : [];
};

// The two dates as the director typed them, for the form that edits them —
// never normalized to a fallback, so an end date the director has not filled
// in yet stays an empty box instead of quietly becoming the start date.
export const tripDateFields = (trip) => ({
  start: isISODate(trip?.start_date) ? trip.start_date : "",
  end: isISODate(trip?.end_date) ? trip.end_date : "",
});

// What the form has to say no to. An end before the start is the one mistake
// worth catching — it makes the day list empty and the banner read backwards.
export const tripDatesError = ({ start, end }) => {
  if (start && !isISODate(start)) return "Pick a start date.";
  if (end && !isISODate(end)) return "Pick an end date.";
  if (start && end && daysBetween(start, end) < 0) return "The last day is before the first.";
  return null;
};

// How a schedule row says its own day. "Thu, Aug 13" — the weekday is the
// half a golfer actually plans around, and the month is what makes it real.
export const scheduleDayLabel = (row) =>
  row?.date ? formatISODate(row.date, { weekday: true }) : "";

// ── The scorecard behind a course ─────────────────────────────────
// Trip Info's schedule rows open this. It is the same card the director
// edits in Admin → Courses, read-only and with the tees a player can choose
// between — "what am I looking at on Saturday" is a question the app already
// held the answer to and never showed anybody.

// A course's tees, in the order they are stored, with the ones that carry no
// identity at all dropped. `hole_yards` is normalized to 18 numbers so the
// grid never has to guess at a short array.
export const courseTees = (course) =>
  (course?.tee_boxes || [])
    .map((t, i) => ({
      index: i,
      name: String(t?.name || "").trim() || `Tee ${i + 1}`,
      color: t?.color || null,
      rating: Number(t?.rating) || null,
      slope: parseInt(t?.slope, 10) || null,
      yardage: parseInt(t?.yardage, 10) || 0,
      holeYards: Array.from({ length: 18 }, (_, h) => parseInt(t?.hole_yards?.[h], 10) || 0),
    }));

// Eighteen holes with their par, stroke index and — for the chosen tee — their
// yardage, plus the three totals a card prints. Null when the course carries no
// hole data at all, which is what an imported course with no scorecard looks
// like: the sheet says so rather than drawing a grid of dashes.
//
// A stroke index of 0 is "not recorded" rather than a real rung — that is what
// the import writes when the source had none — so it reads as blank.
export const courseScorecard = (course, teeIndex = 0) => {
  const pars = (course?.hole_pars || []).map(p => parseInt(p, 10) || 0);
  if (!pars.some(p => p > 0)) return null;
  const hcps = (course?.hole_handicaps || []).map(h => parseInt(h, 10) || 0);
  const tee = courseTees(course)[teeIndex] || null;

  const holes = Array.from({ length: 18 }, (_, i) => ({
    hole: i + 1,
    par: pars[i] || 0,
    hcp: hcps[i] > 0 ? hcps[i] : null,
    yards: tee?.holeYards[i] || 0,
  }));
  const sum = (rows, key) => rows.reduce((n, r) => n + (r[key] || 0), 0);
  const front = holes.slice(0, 9), back = holes.slice(9);
  return {
    holes, front, back, tee,
    totals: {
      out: { par: sum(front, "par"), yards: sum(front, "yards") },
      in: { par: sum(back, "par"), yards: sum(back, "yards") },
      // The tee's OWN stored yardage wins over the sum of its holes when it
      // has one: a course imported with a total but no per-hole breakdown
      // would otherwise print a real total as zero.
      total: {
        par: sum(holes, "par"),
        yards: sum(holes, "yards") || tee?.yardage || 0,
      },
    },
  };
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

// A course's par, taken from its CARD when it has one and from the stored
// summary only when it does not.
//
// The two can disagree — `par` is a number the import wrote from whatever the
// source said, and `hole_pars` is the scorecard a director may have corrected
// hole by hole since. Showing both is how a sheet ends up saying "Par 71" at
// the top and totalling 72 at the bottom, which reads as a bug in the app
// rather than as a stale field. The card wins because it is the thing that
// scores the round.
export const coursePar = (course) => {
  const summed = (course?.hole_pars || [])
    .reduce((n, p) => n + (parseInt(p, 10) || 0), 0);
  if (summed > 0) return summed;
  const stored = parseInt(course?.par, 10);
  return Number.isFinite(stored) && stored > 0 ? stored : null;
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
