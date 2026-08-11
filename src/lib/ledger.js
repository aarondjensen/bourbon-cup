// ══════════════════════════════════════════════════════════════════
//  The ledger — what each man owes the director for the trip
// ══════════════════════════════════════════════════════════════════
//
// Nothing to do with the golf. The cup costs money — rooms, greens fees, the
// cart, the bourbon — and one person fronts all of it months before anybody
// tees off. Most guys pay it back in pieces across the summer: a hundred in
// May, two hundred after the draw comes out, the rest in the parking lot.
// Until now that record lived in the director's texts, which is a record only
// one person can read and nobody can check.
//
// So this is a LEDGER in the same sense lib/sideBets is: it records what
// happened and settles nothing on its own. Two halves —
//
//   WHAT IS OWED   one number per player. There is a tournament-wide figure
//                  (bc_settings/dues) because in practice everybody owes the
//                  same, and a per-player override on the roster row for the
//                  years somebody comes for one night or gets comped.
//   WHAT WAS PAID  one document per payment in bc_ledger: amount, date,
//                  method, and a note. Installments are the normal case, so
//                  the shape is a list from the start rather than a paid flag
//                  that had to grow into one.
//
// Balance is the subtraction, and it is derived EVERY time rather than stored.
// A stored balance is a third number that can disagree with the two it came
// from, and the disagreement always surfaces as "the app says I owe $150 and
// the payments add to $700" — the exact argument the ledger exists to end.
//
// ── Who may write it ──────────────────────────────────────────────
// Directors only, and that is the whole authorization model. A player logging
// their own payment would be a claim, not a record — the director is the one
// who knows the money arrived. Reads are open like everything else in this
// project (see firestore.rules), so a member could read another man's balance
// by talking to Firestore directly. That is the same trade the roster, the
// handicaps and the side bets already make, and the screens still only ever
// show you your own.
//
// ── Money and floats ──────────────────────────────────────────────
// Amounts are dollars stored as numbers. Every sum here goes through round2,
// because three payments of 283.33 add to 849.9899999999999 and a balance of
// $0.01 owed by a man who has paid in full is a support call.
//
// Dates are `YYYY-MM-DD` strings and never Date objects — see lib/dates.js,
// which owns that decision for the whole app.

import { isISODate } from "./dates";

export const LEDGER_COL = "bc_ledger";

// The bc_settings document holding the tournament-wide figure. Edition-scoped
// by the caller through editionDocId, same as team_names and branding.
export const DUES_SETTINGS_ID = "dues";

// How the money actually arrives. Free text would be more flexible and less
// useful: the director's real question at the end is "did the Venmo ones all
// land", and that needs a value you can group by. `other` is the escape hatch
// and the note field carries the detail.
export const PAYMENT_METHODS = [
  { id: "venmo", label: "Venmo" },
  { id: "zelle", label: "Zelle" },
  { id: "cash", label: "Cash" },
  { id: "check", label: "Check" },
  { id: "paypal", label: "PayPal" },
  { id: "other", label: "Other" },
];

export const DEFAULT_METHOD = "venmo";

export const methodLabel = (id) =>
  PAYMENT_METHODS.find(m => m.id === id)?.label || "Other";

// Free text on a payment, capped for the same reason a side bet's terms are:
// a note that can grow without limit arrives as a wall on a phone.
export const MAX_NOTE = 140;

// Cents, not dollars, for anything that adds up. See the float note above.
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// One id per payment. Unlike a side bet these are only ever written by one
// person on one phone, so a collision is close to impossible — but the random
// tail costs nothing and makes "close to" unnecessary.
export const paymentId = (now, rand) =>
  `bc_pay_${now}_${Math.floor(rand * 1e6).toString(36)}`;

// "$850", "$412.50", "-$25". Cents are shown only when there are any, because
// almost every figure here is a round number and "$850.00" reads as a form
// field rather than as an amount.
export const money = (n) => {
  const v = round2(n);
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  const whole = Math.floor(abs);
  const cents = Math.round((abs - whole) * 100);
  const grouped = whole.toLocaleString("en-US");
  return `${sign}$${grouped}${cents ? `.${String(cents).padStart(2, "0")}` : ""}`;
};

// ── What a player owes ────────────────────────────────────────────
// The tournament figure unless that player carries an override. Zero IS a
// legitimate override — somebody comped, or the director themselves — so the
// test is whether a number was written, not whether it is truthy. A blank
// string, a null, or something unparseable all mean "no override", which is
// what an untouched roster row has.
export const hasDuesOverride = (player) => {
  const raw = player?.dues_amount;
  if (raw === null || raw === undefined || raw === "") return false;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0;
};

export const duesFor = (player, defaultAmount) =>
  hasDuesOverride(player) ? round2(player.dues_amount) : round2(defaultAmount);

// ── What a player has paid ────────────────────────────────────────
// Newest first. A ledger is read from the most recent payment backwards —
// "did the one I sent Tuesday land" — and the summer's first installment is
// never the row anybody is looking for.
export const paymentsFor = (payments, pid) =>
  (payments || [])
    .filter(p => p && p.player_id === pid)
    .sort((a, b) =>
      String(b.date || "").localeCompare(String(a.date || ""))
      || (b.created_at || 0) - (a.created_at || 0));

export const paidBy = (payments, pid) =>
  round2(paymentsFor(payments, pid).reduce((sum, p) => sum + (Number(p.amount) || 0), 0));

// One player's whole position. `balance` is what is still owed and goes
// NEGATIVE on an overpayment rather than clamping at zero — a man who sent
// $900 against $850 is owed fifty dollars back, and hiding that would make
// the ledger lie in the one direction the director cannot see from a total.
export const balanceFor = ({ player, payments, defaultAmount }) => {
  const due = duesFor(player, defaultAmount);
  const paid = paidBy(payments, player?.player_id);
  return {
    player_id: player?.player_id || null,
    due,
    paid,
    balance: round2(due - paid),
    count: paymentsFor(payments, player?.player_id).length,
  };
};

// Is this player behind? The one predicate the badges read, so "owes money"
// has a single definition. An overpayment is not a balance due.
export const owesMoney = (row) => !!row && row.balance > 0;

// Whether this player's ledger is worth showing them at all. A tournament
// that never set a figure and never logged a payment has nothing to say, and
// an empty BALANCE DUE card on My Account would be chrome about nothing.
export const hasLedger = (row) => !!row && (row.due > 0 || row.paid > 0 || row.count > 0);

// ── The director's table ──────────────────────────────────────────
// Every player's position, ordered by what the director is actually doing
// with the screen: chase the people who owe. Outstanding first, largest
// balance at the top, then everybody square, alphabetically.
export const ledgerRows = ({ players, payments, defaultAmount }) =>
  (players || [])
    .map(p => ({ ...balanceFor({ player: p, payments, defaultAmount }), player: p }))
    .sort((a, b) =>
      (owesMoney(a) ? 0 : 1) - (owesMoney(b) ? 0 : 1)
      || b.balance - a.balance
      || String(a.player?.name || "").localeCompare(String(b.player?.name || "")));

// The three numbers across the top. `outstanding` counts only what is OWED —
// an overpayment does not cancel out somebody else's debt, and a total that
// nets them would tell the director they were $50 short when two men owe $200
// and one is $150 ahead.
export const ledgerTotals = (rows) => {
  let billed = 0, collected = 0, outstanding = 0, owing = 0;
  (rows || []).forEach(r => {
    billed += r.due;
    collected += r.paid;
    if (r.balance > 0) { outstanding += r.balance; owing += 1; }
  });
  return {
    billed: round2(billed),
    collected: round2(collected),
    outstanding: round2(outstanding),
    owing,
    total: (rows || []).length,
  };
};

// ── Writing one ───────────────────────────────────────────────────
// What the form has to be able to say no to, in the order it is filled in.
// One message at a time, same as sideBetError — a short form showing three
// errors at once is a form somebody closes.
export const paymentError = ({ playerId, amount, date }) => {
  if (!playerId) return "Pick a player.";
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return "Enter an amount.";
  if (!isISODate(date)) return "Pick a date.";
  return null;
};

// The document, built from a validated form. Kept here rather than in the
// component so the shape has one author and the tests can see it.
export const buildPayment = ({
  id, tournamentId, playerId, amount, date, method, note, createdBy, now,
}) => ({
  id,
  tournament_id: tournamentId,
  player_id: playerId,
  amount: round2(amount),
  // The date the MONEY moved, which is not the date it was typed in — the
  // director logs a stack of Venmos on a Sunday night and each one has its
  // own date. `created_at` below is the typing; this is the payment.
  date: String(date),
  method: PAYMENT_METHODS.some(m => m.id === method) ? method : "other",
  note: String(note || "").trim().slice(0, MAX_NOTE),
  // The uid, not the roster id. Same reasoning as bc_side_bets.created_by:
  // it is the only identity the rules could ever check.
  created_by: createdBy || null,
  created_at: now,
});
