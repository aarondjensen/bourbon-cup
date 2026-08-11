import { describe, it, expect } from "vitest";
import {
  paymentId, paymentError, buildPayment, MAX_NOTE,
  round2, money, todayISO, formatPaymentDate,
  hasDuesOverride, duesFor, paymentsFor, paidBy, balanceFor,
  owesMoney, hasLedger, ledgerRows, ledgerTotals, methodLabel,
} from "./ledger";

const pay = (over = {}) => ({
  id: "pay1", tournament_id: "bc_2026", player_id: "p1",
  amount: 100, date: "2026-06-01", method: "venmo", note: "",
  created_by: "uid_a", created_at: 1000, ...over,
});

const player = (over = {}) => ({ player_id: "p1", name: "Aaron J", ...over });

describe("paymentId", () => {
  it("does not collide for the same timestamp", () => {
    expect(paymentId(1700, 0.1)).not.toBe(paymentId(1700, 0.9));
  });
  it("is a plain document id", () => {
    expect(paymentId(1700, 0.5)).toMatch(/^bc_pay_1700_[0-9a-z]+$/);
  });
});

describe("round2 and money", () => {
  // The reason round2 exists at all: three even installments against $850.
  it("keeps three thirds from adding to 849.9899999999999", () => {
    expect(round2(283.33 + 283.33 + 283.34)).toBe(850);
  });
  it("drops cents when there are none", () => {
    expect(money(850)).toBe("$850");
  });
  it("shows cents when there are some", () => {
    expect(money(412.5)).toBe("$412.50");
    expect(money(0.05)).toBe("$0.05");
  });
  it("groups thousands", () => {
    expect(money(1234.5)).toBe("$1,234.50");
  });
  it("signs an overpayment refund", () => {
    expect(money(-25)).toBe("-$25");
  });
});

describe("dates", () => {
  it("stamps today in local time, not UTC", () => {
    // 11pm on the 1st in a negative-offset zone is still the 1st. A Date
    // round-trip through toISOString would say the 2nd.
    expect(todayISO(new Date(2026, 6, 1, 23, 30))).toBe("2026-07-01");
  });
  it("formats without dragging the day backwards", () => {
    expect(formatPaymentDate("2026-07-01")).toBe("Jul 1");
    expect(formatPaymentDate("2026-07-01", { withYear: true })).toBe("Jul 1, 2026");
  });
  it("leaves something it cannot read alone", () => {
    expect(formatPaymentDate("")).toBe("");
    expect(formatPaymentDate("later")).toBe("later");
  });
});

describe("duesFor", () => {
  it("falls back to the tournament figure", () => {
    expect(duesFor(player(), 850)).toBe(850);
  });
  it("honours an override", () => {
    expect(duesFor(player({ dues_amount: 400 }), 850)).toBe(400);
  });
  // A comped player is the whole reason the test is "was a number written",
  // not "is the number truthy".
  it("honours an override of zero", () => {
    expect(hasDuesOverride(player({ dues_amount: 0 }))).toBe(true);
    expect(duesFor(player({ dues_amount: 0 }), 850)).toBe(0);
  });
  it("treats blank, null and nonsense as no override", () => {
    expect(duesFor(player({ dues_amount: "" }), 850)).toBe(850);
    expect(duesFor(player({ dues_amount: null }), 850)).toBe(850);
    expect(duesFor(player({ dues_amount: "lots" }), 850)).toBe(850);
    expect(duesFor(player({ dues_amount: -50 }), 850)).toBe(850);
  });
});

describe("paymentsFor", () => {
  const rows = [
    pay({ id: "a", date: "2026-05-01" }),
    pay({ id: "b", date: "2026-07-04" }),
    pay({ id: "c", date: "2026-06-15" }),
    pay({ id: "d", player_id: "p2" }),
  ];
  it("is that player's only, newest first", () => {
    expect(paymentsFor(rows, "p1").map(r => r.id)).toEqual(["b", "c", "a"]);
  });
  it("breaks a same-day tie on when it was typed", () => {
    const same = [
      pay({ id: "x", date: "2026-06-01", created_at: 1 }),
      pay({ id: "y", date: "2026-06-01", created_at: 2 }),
    ];
    expect(paymentsFor(same, "p1").map(r => r.id)).toEqual(["y", "x"]);
  });
  it("adds up only that player's", () => {
    expect(paidBy(rows, "p1")).toBe(300);
    expect(paidBy(rows, "p2")).toBe(100);
    expect(paidBy(rows, "nobody")).toBe(0);
  });
});

describe("balanceFor", () => {
  const payments = [pay({ id: "a", amount: 300 }), pay({ id: "b", amount: 250 })];
  it("subtracts what was paid from what is owed", () => {
    const row = balanceFor({ player: player(), payments, defaultAmount: 850 });
    expect(row).toMatchObject({ due: 850, paid: 550, balance: 300, count: 2 });
  });
  it("goes negative on an overpayment rather than clamping", () => {
    const row = balanceFor({ player: player(), payments, defaultAmount: 500 });
    expect(row.balance).toBe(-50);
    expect(owesMoney(row)).toBe(false);
  });
  it("is square at exactly zero", () => {
    const row = balanceFor({ player: player(), payments, defaultAmount: 550 });
    expect(row.balance).toBe(0);
    expect(owesMoney(row)).toBe(false);
  });
});

describe("hasLedger", () => {
  it("is false for a tournament that never set a figure", () => {
    expect(hasLedger(balanceFor({ player: player(), payments: [], defaultAmount: 0 }))).toBe(false);
  });
  it("is true once there is a figure", () => {
    expect(hasLedger(balanceFor({ player: player(), payments: [], defaultAmount: 850 }))).toBe(true);
  });
  // A comped player who nonetheless chipped in still has a record to read.
  it("is true for a payment against no dues", () => {
    expect(hasLedger(balanceFor({ player: player({ dues_amount: 0 }), payments: [pay()], defaultAmount: 0 }))).toBe(true);
  });
});

describe("ledgerRows", () => {
  const players = [
    player({ player_id: "p1", name: "Aaron J" }),
    player({ player_id: "p2", name: "Ben T" }),
    player({ player_id: "p3", name: "Cal W" }),
  ];
  const payments = [
    pay({ id: "a", player_id: "p1", amount: 850 }),   // square
    pay({ id: "b", player_id: "p2", amount: 100 }),   // owes 750
    pay({ id: "c", player_id: "p3", amount: 500 }),   // owes 350
  ];
  const rows = ledgerRows({ players, payments, defaultAmount: 850 });

  it("puts the people who owe at the top, biggest first", () => {
    expect(rows.map(r => r.player_id)).toEqual(["p2", "p3", "p1"]);
  });
  it("totals what is billed, collected and still out", () => {
    expect(ledgerTotals(rows)).toEqual({
      billed: 2550, collected: 1450, outstanding: 1100, owing: 2, total: 3,
    });
  });
  // An overpayment must not quietly cover somebody else's debt — the director
  // would read "$0 outstanding" with a man still owing $200.
  it("does not net an overpayment against another player's balance", () => {
    const over = ledgerRows({
      players: players.slice(0, 2),
      payments: [pay({ id: "a", player_id: "p1", amount: 1050 }), pay({ id: "b", player_id: "p2", amount: 650 })],
      defaultAmount: 850,
    });
    const t = ledgerTotals(over);
    expect(t.outstanding).toBe(200);
    expect(t.collected).toBe(1700);
    expect(t.owing).toBe(1);
  });
  it("handles an empty roster", () => {
    expect(ledgerTotals(ledgerRows({ players: [], payments: [], defaultAmount: 850 })))
      .toMatchObject({ billed: 0, outstanding: 0, owing: 0, total: 0 });
  });
});

describe("paymentError", () => {
  const ok = { playerId: "p1", amount: "100", date: "2026-06-01" };
  it("accepts a complete payment", () => {
    expect(paymentError(ok)).toBeNull();
  });
  it("wants a player", () => {
    expect(paymentError({ ...ok, playerId: "" })).toMatch(/player/i);
  });
  it("wants a positive amount", () => {
    expect(paymentError({ ...ok, amount: "" })).toMatch(/amount/i);
    expect(paymentError({ ...ok, amount: "0" })).toMatch(/amount/i);
    expect(paymentError({ ...ok, amount: "-20" })).toMatch(/amount/i);
    expect(paymentError({ ...ok, amount: "cash" })).toMatch(/amount/i);
  });
  it("wants a real date", () => {
    expect(paymentError({ ...ok, date: "" })).toMatch(/date/i);
    expect(paymentError({ ...ok, date: "6/1/26" })).toMatch(/date/i);
  });
});

describe("buildPayment", () => {
  const built = buildPayment({
    id: "pay1", tournamentId: "bc_2026", playerId: "p1", amount: "250.005",
    date: "2026-06-01", method: "zelle", note: "  first installment  ",
    createdBy: "uid_a", now: 1000,
  });
  it("stores a rounded number, not the typed string", () => {
    expect(built.amount).toBe(250.01);
  });
  it("trims the note", () => {
    expect(built.note).toBe("first installment");
  });
  it("caps the note", () => {
    const long = buildPayment({ ...built, note: "x".repeat(500) });
    expect(long.note.length).toBe(MAX_NOTE);
  });
  it("falls back to other on a method it does not know", () => {
    expect(buildPayment({ ...built, method: "gold bars" }).method).toBe("other");
    expect(methodLabel("gold bars")).toBe("Other");
  });
  it("keeps the payment date apart from when it was typed", () => {
    expect(built.date).toBe("2026-06-01");
    expect(built.created_at).toBe(1000);
  });
});
