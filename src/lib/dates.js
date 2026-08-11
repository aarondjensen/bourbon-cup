// ══════════════════════════════════════════════════════════════════
//  Calendar dates — the ones the app writes down rather than measures
// ══════════════════════════════════════════════════════════════════
//
// Two different things in this app are called a date and only one of them
// lives here.
//
// A TIMESTAMP (`created_at`, the round lock's `locked_at`) is a moment —
// milliseconds since the epoch, ordered, compared, never displayed as a
// calendar day. Those stay where they are.
//
// A DATE is a day on a calendar: the day a payment was made, the day a round
// is played. It has no time in it and no timezone in it, and the moment it is
// put through a `Date` it acquires both. `new Date("2026-07-01")` is UTC
// midnight, which in Michigan is the evening of June 30th — so a round on the
// 1st reads as the last day of the previous month, on the phone of somebody
// standing on its first tee.
//
// So a date is a `YYYY-MM-DD` STRING here, start to finish. It is compared
// with `localeCompare` (which sorts correctly, because the format is
// big-endian), formatted by pulling the three numbers apart, and never parsed.
// The one place a Date object appears is `todayISO`, which asks the device
// what day it is locally and immediately turns the answer back into a string.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isISODate = (v) => ISO_DATE.test(String(v ?? ""));

// Today, in the reader's own timezone. `toISOString()` would be the obvious
// one-liner and is wrong for exactly the reason above: it converts to UTC
// first, so anybody east of Greenwich gets tomorrow after mid-afternoon and
// anybody west gets yesterday all evening.
export const todayISO = (d = new Date()) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// ── Calendar arithmetic ───────────────────────────────────────────
// The one place a Date object is allowed near a calendar date, and it is safe
// for a specific reason: both ends are UTC. `Date.UTC` builds from the three
// numbers with no timezone applied, and the getUTC* readers take them back
// out the same way, so the local zone never enters the calculation. The bug
// this file exists to prevent needs a LOCAL reading of a UTC instant (or the
// reverse), and there is not one here.
const DAY_MS = 86400000;

// `iso` shifted by n days. Returns "" for something it cannot read, so a
// caller never gets a plausible-looking wrong date out of a typo.
export const addDays = (iso, n) => {
  if (!isISODate(iso)) return "";
  const [y, m, d] = String(iso).split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + n * DAY_MS;
  const out = new Date(t);
  const pad = (v) => String(v).padStart(2, "0");
  return `${out.getUTCFullYear()}-${pad(out.getUTCMonth() + 1)}-${pad(out.getUTCDate())}`;
};

// Whole days from `from` to `to`, signed. Null when either end is unreadable.
export const daysBetween = (from, to) => {
  if (!isISODate(from) || !isISODate(to)) return null;
  const at = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((at(to) - at(from)) / DAY_MS);
};

// Every day from `from` to `to` inclusive, as ISO strings. This is what turns
// a trip's two dates into the list of days a round can be played on.
//
// `max` is a guard rather than a feature: a mistyped year ("2026" to "2126")
// would otherwise build thirty-six thousand strings to fill a dropdown with.
// A golf trip is a long weekend; anything past a month is a typo.
export const rangeDays = (from, to, { max = 31 } = {}) => {
  const span = daysBetween(from, to);
  if (span == null || span < 0 || span >= max) return isISODate(from) ? [from] : [];
  return Array.from({ length: span + 1 }, (_, i) => addDays(from, i));
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// The weekday, worked out arithmetically rather than by constructing a Date —
// same reason as everything else in this file. Sakamoto's method, which is
// exact for any date in the Gregorian calendar.
const dowIndex = (y, m, d) => {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const yy = m < 3 ? y - 1 : y;
  return (yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) + t[m - 1] + d) % 7;
};

// Pull a date into its three numbers, or null if it is not one. Every
// formatter below goes through here, so "something we cannot read" has one
// answer and it is never a thrown error on a screen.
const parts = (iso) => {
  if (!isISODate(iso)) return null;
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!MONTHS[m - 1] || d < 1 || d > 31) return null;
  return { y, m, d };
};

// "Jul 1" · "Jul 1, 2026" · "Thu, Jul 1". Anything unreadable comes back as
// itself rather than as "Invalid Date" — a screen showing the raw string is
// at least showing what is stored.
export const formatISODate = (iso, { withYear = false, weekday = false } = {}) => {
  const p = parts(iso);
  if (!p) return String(iso ?? "");
  const head = weekday ? `${DAYS[dowIndex(p.y, p.m, p.d)]}, ` : "";
  return `${head}${MONTHS[p.m - 1]} ${p.d}${withYear ? `, ${p.y}` : ""}`;
};

// A span, collapsed as far as it honestly can be:
//
//   Aug 14 – 17, 2026    same month
//   Aug 30 – Sep 2, 2026 same year
//   Dec 30, 2026 – Jan 2, 2027
//   Aug 14, 2026         one day, or both ends the same day
//
// The year rides on the END, always, because that is where a reader looks for
// it — and it is the only part of a range that can be wrong in a way nobody
// notices.
export const formatISORange = (from, to) => {
  const a = parts(from), b = parts(to);
  if (!a && !b) return "";
  if (!a || !b) return formatISODate(a ? from : to, { withYear: true });
  if (a.y === b.y && a.m === b.m && a.d === b.d) return formatISODate(from, { withYear: true });
  if (a.y === b.y && a.m === b.m) return `${MONTHS[a.m - 1]} ${a.d} – ${b.d}, ${b.y}`;
  if (a.y === b.y) return `${MONTHS[a.m - 1]} ${a.d} – ${MONTHS[b.m - 1]} ${b.d}, ${b.y}`;
  return `${formatISODate(from, { withYear: true })} – ${formatISODate(to, { withYear: true })}`;
};
