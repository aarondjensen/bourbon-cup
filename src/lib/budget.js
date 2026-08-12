// ══════════════════════════════════════════════════════════════════
//  The budget — what the trip COSTS, before anybody is billed for it
// ══════════════════════════════════════════════════════════════════
//
// The other half of Admin → Budget. The ledger next door records money coming IN
// from the field; this records what is going OUT, and it is the thing the
// director actually works out first: four nights of a house, sixteen greens
// fees, carts, the Saturday steaks, a trophy. Divide by the field and that is
// the number that goes on everybody's My Account.
//
// So the two halves are one question asked from both ends, and the join is the
// only interesting arithmetic here: `budgetVsDues` puts the per-man cost next
// to the trip cost currently being charged and says which way it is out. A
// director who has priced the trip at $850 and then books a bigger house has
// no way to notice the gap otherwise — the ledger will happily collect $850 a
// man against a $920 bill and only come up short in October.
//
// ── The shape ─────────────────────────────────────────────────────
// One document per LINE, in `bc_budget`, the same way one payment is one
// document in `bc_ledger`. Not a single document with an array of lines: two
// phones editing that document write the whole array each time and the last
// one wins, silently dropping whatever the other added. A line is small,
// independent, and deleted on its own.
//
// A line carries its category rather than living under one, so re-filing a
// line is a field edit rather than a move between collections.
//
// ── Total, or per man ─────────────────────────────────────────────
// A line is priced whichever way the director actually knows it. The house is
// a TOTAL — one number off a rental listing, divided by however many turn up.
// Golf is PER MAN — ninety dollars a round is what the course quotes, and the
// total depends on the field. Making the director do that multiplication in
// their head is how a budget ends up with "greens fees 1440" and nobody able
// to check it a month later.
//
// So `basis` says which number was typed and everything downstream expands it:
// `lineTotal` is what the line contributes to the trip, and it is the figure
// the screen shows, sorts by and adds up. The typed number is kept exactly as
// typed, so a per-man line stays readable as "$90 a man" when the field grows
// from fifteen to sixteen and its total changes on its own.
//
// An absent `basis` reads as a total, which is what every line written before
// this existed is.
//
// ── Estimates and actuals ─────────────────────────────────────────
// Deliberately NOT modelled. A line is one number, and the director decides
// whether it is a quote or a receipt. Two columns would double the typing on
// every line for a distinction that matters on maybe three of them, and a
// half-filled "actual" column reads as a budget that is under by the amount
// nobody has entered yet.
//
// Amounts are dollars as numbers, summed through round2 — same reasoning as
// lib/ledger, which owns `money` and the rounding for both halves.

import { round2 } from "./ledger";

export const BUDGET_COL = "bc_budget";

// What the money goes on. A fixed catalog for the same reason payment methods
// are one: the director's real question at the end of setup is "what is the
// golf costing us", and that needs a value you can group by rather than
// sixteen spellings of "greens fees".
//
// `icon` is carried here rather than in the component because the order and
// the mark are the same decision — this list IS the screen's grouping.
export const BUDGET_CATEGORIES = [
  { id: "lodging", label: "Lodging", icon: "🏡" },
  { id: "golf", label: "Golf", icon: "⛳" },
  { id: "food", label: "Food & Drink", icon: "🥃" },
  { id: "transport", label: "Travel", icon: "🚗" },
  { id: "prizes", label: "Prizes", icon: "🏆" },
  { id: "other", label: "Other", icon: "•" },
];

export const DEFAULT_CATEGORY = "lodging";

export const BASIS_TOTAL = "total";
export const BASIS_PER_MAN = "per_man";
export const BUDGET_BASES = [
  { id: BASIS_TOTAL, label: "Total" },
  { id: BASIS_PER_MAN, label: "Per man" },
];

export const normalizeBasis = (b) => (b === BASIS_PER_MAN ? BASIS_PER_MAN : BASIS_TOTAL);
export const isPerMan = (line) => normalizeBasis(line?.basis) === BASIS_PER_MAN;

// What this line contributes to the trip's total. A per-man line against an
// empty roster contributes nothing — there is nobody to multiply by, and
// guessing a field size would put an invented number in the total.
export const lineTotal = (line, playerCount) => {
  const amt = Number(line?.amount) || 0;
  return round2(isPerMan(line) ? amt * (playerCount || 0) : amt);
};

export const categoryLabel = (id) =>
  BUDGET_CATEGORIES.find(c => c.id === id)?.label || "Other";

export const categoryIcon = (id) =>
  BUDGET_CATEGORIES.find(c => c.id === id)?.icon || "•";

// Anything the catalog does not know is filed under Other rather than dropped
// — a line whose category was retired must not vanish off the screen with its
// money still in the total.
export const normalizeCategory = (id) =>
  BUDGET_CATEGORIES.some(c => c.id === id) ? id : "other";

export const MAX_LABEL = 60;

export const budgetLineId = (now, rand) =>
  `bc_budget_${now}_${Math.floor(rand * 1e6).toString(36)}`;

// ── One line ──────────────────────────────────────────────────────
// The DETAIL is optional. A Lodging line for the house needs no elaboration —
// its category is the whole story — and demanding one means typing the word
// "Lodging" twice. Only the amount is required, because a line without one is
// not a budget line.
export const budgetLineError = ({ amount }) => {
  // An EMPTY box is checked before the number is, because `Number("")` is 0
  // and 0 is a legal amount here — without this an untouched field would save
  // as a free line rather than being refused.
  if (String(amount ?? "").trim() === "") return "Enter an amount.";
  const amt = Number(amount);
  // Zero is allowed and negative is not. A $0 line is a real thing to write
  // down — something comped, or a placeholder for a quote that has not come
  // back — and it costs nothing in the total. A negative is somebody trying
  // to model a refund, which belongs in the ledger.
  if (!Number.isFinite(amt) || amt < 0) return "Enter an amount.";
  return null;
};

// `note` is deliberately not written. It was a second optional free-text field
// beside the label, which is one more than a budget line has ever needed —
// the label IS the note now that it is optional. Not writing it means a note
// typed before this change survives the next edit (db.upsert merges) instead
// of being blanked by a form that no longer offers it.
export const buildBudgetLine = ({
  id, tournamentId, category, label, amount, basis, createdBy, now,
}) => ({
  id,
  tournament_id: tournamentId,
  category: normalizeCategory(category),
  label: String(label || "").trim().slice(0, MAX_LABEL),
  amount: round2(amount),
  basis: normalizeBasis(basis),
  created_by: createdBy || null,
  created_at: now,
});

// What a line is called on screen. The detail if there is one, the category if
// there is not — a Lodging line with no detail reads "Lodging", which is true
// and is what the director meant by leaving it blank.
export const lineTitle = (line) =>
  String(line?.label || "").trim() || categoryLabel(normalizeCategory(line?.category));

// ── The screen ────────────────────────────────────────────────────
// Lines grouped into the catalog's own order, biggest line first inside each
// group, and a category with nothing in it left out. That order is what makes
// the screen answerable at a glance: the top of each group is the line worth
// arguing about.
// Sorted by what each line COSTS THE TRIP, not by the number typed on it — a
// $90-a-man line is bigger than a $350 cleaning fee and has to sort like it.
export const budgetGroups = (lines, playerCount) =>
  BUDGET_CATEGORIES
    .map(cat => {
      const rows = (lines || [])
        .filter(l => l && normalizeCategory(l.category) === cat.id)
        .map(l => ({ ...l, total: lineTotal(l, playerCount) }))
        .sort((a, b) => b.total - a.total || lineTitle(a).localeCompare(lineTitle(b)));
      return { ...cat, lines: rows, total: round2(rows.reduce((n, l) => n + l.total, 0)) };
    })
    .filter(g => g.lines.length > 0);

export const budgetTotal = (lines, playerCount) =>
  round2((lines || []).reduce((n, l) => n + lineTotal(l, playerCount), 0));

// What the trip costs a man, which is the number the dues figure ought to be.
// Null rather than zero for an empty roster — dividing by nobody has no answer
// and "$0 a man" would read as a free trip.
export const budgetPerPlayer = (lines, playerCount) => {
  if (!playerCount) return null;
  return round2(budgetTotal(lines, playerCount) / playerCount);
};

// ── The join between the two halves ───────────────────────────────
// The one piece of arithmetic that spans Budget and Accounting, and the reason
// they are sub-tabs of one screen rather than two places.
//
// `charged` is what the field is actually being billed in total — the ledger's
// own `billed`, which already accounts for per-player overrides, so a comped
// player is correctly counted as contributing nothing rather than as an
// average. Passing it in keeps this module from having to know about dues.
//
// `gap` is what is left over: positive means the trip is funded with money to
// spare, negative means it is short. Named for the direction a reader cares
// about — "am I short" — rather than for the subtraction.
export const budgetVsDues = ({ lines, charged, playerCount }) => {
  const total = budgetTotal(lines, playerCount);
  const perPlayer = budgetPerPlayer(lines, playerCount);
  const billed = round2(charged);
  return {
    total,
    perPlayer,
    billed,
    gap: round2(billed - total),
    // Nothing to compare when one side is empty. A tournament with a budget
    // and no dues set, or dues and no budget, is mid-setup rather than wrong,
    // and a screaming "SHORT $6,400" on it would be noise.
    comparable: total > 0 && billed > 0,
  };
};
