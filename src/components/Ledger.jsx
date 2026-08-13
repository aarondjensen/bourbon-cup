// ══════════════════════════════════════════════════════════════════
//  The ledger on screen — one card for a player, one console for the
//  director.
// ══════════════════════════════════════════════════════════════════
//
// The arithmetic all lives in lib/ledger; nothing here computes a balance.
// What these two components own is the difference between the two readers:
//
//   BalanceCard   sits in My Account and answers ONE question — what do I
//                 still owe, and did the money I sent land. It is read by a
//                 man standing in a parking lot with his phone out, so the
//                 balance is the biggest thing on it and the history under it
//                 is a list of receipts.
//   LedgerAdmin   is Admin → Budget → Accounting, and answers the director's
//                 question, which is the opposite one: who has NOT paid. So
//                 it leads with three totals and a roster sorted by who owes
//                 the most, and logging a payment is two taps from any row.
//                 Its other half is BUDGET (components/Budget) — what the
//                 trip costs, which is where the figure it collects against
//                 comes from.
//
// Neither of them is a place to argue with. There is no "mark as paid" for a
// player, because a player saying they paid is a claim and the director
// receiving it is the record — see the authorization note in lib/ledger.
import { useState, useMemo } from "react";
import { BC, FONT, ALPHA, FS, ON_AMBER } from "../theme";
import { Popup, ConfirmModal } from "./Popup";
import { useConfirm } from "../lib/useConfirm";
import {
  PAYMENT_METHODS, DEFAULT_METHOD, MAX_NOTE, methodLabel, money,
  paymentsFor, balanceFor, owesMoney, hasLedger,
  ledgerRows, ledgerTotals, paymentError, hasDuesOverride, round2,
} from "../lib/ledger";
import { todayISO, formatISODate } from "../lib/dates";

const Card = ({ children, style }) => (
  <div style={{
    background: BC.card, border: `1px solid ${BC.bdr}`, borderRadius: 10,
    padding: "14px 16px", ...style,
  }}>{children}</div>
);

// Centred, and only BalanceCard uses it — which is My Account's screen, where
// every other head is centred too. LedgerAdmin's own headings are separate and
// stay where they are: Admin → Budget is a screen you operate, not one you
// read.
const SectionLabel = ({ children, style }) => (
  <div style={{
    fontSize: FS.label, fontWeight: 800, letterSpacing: 1.5,
    color: BC.amberInk, marginBottom: 10, textAlign: "center", ...style,
  }}>{children}</div>
);

// Every text input on this screen is at FS.lead. Below 16px iOS Safari zooms
// the page on focus, and a money form is the last place you want the layout
// jumping under a thumb — see the note on the FS scale in theme.js.
//
// FUNCTIONS, not object constants, and that is load-bearing rather than
// style. `BC` is a live object that applyBCTheme MUTATES in place; a
// module-level literal would read its colours once, when this file is first
// imported, and then hold them through every theme switch for the life of the
// tab. The dark input survived into light mode as a black box before these
// were called at render time. See the note on BC in theme.js.
const inputStyle = () => ({
  width: "100%", padding: "10px 12px", background: BC.inp,
  border: `1px solid ${BC.bdr}`, borderRadius: 8, color: BC.t1,
  fontSize: FS.lead, boxSizing: "border-box", outline: "none", fontFamily: FONT,
});

const fieldLabel = () => ({
  fontSize: FS.label, color: BC.t3, fontWeight: 700, letterSpacing: 1,
  marginBottom: 4, display: "block",
});

// One payment, as a row. Same shape on both screens so a receipt reads
// identically to the man who owes it and the man who banked it.
function PaymentRow({ payment, onDelete }) {
  return (
    <div style={{
      display: "flex", alignItems: "baseline", gap: 10, padding: "7px 0",
      borderTop: `1px solid ${BC.bdr}${ALPHA.hair}`,
    }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: FS.small, color: BC.t1, fontWeight: 700 }}>
          {formatISODate(payment.date)}
          <span style={{ color: BC.t3, fontWeight: 500 }}> · {methodLabel(payment.method)}</span>
        </div>
        {payment.note && (
          <div style={{
            fontSize: FS.label, color: BC.t3, lineHeight: 1.4, marginTop: 2,
            overflowWrap: "anywhere",
          }}>{payment.note}</div>
        )}
      </div>
      <div style={{ fontSize: FS.small, fontWeight: 800, color: BC.green, flexShrink: 0 }}>
        {money(payment.amount)}
      </div>
      {onDelete && (
        <button onClick={() => onDelete(payment)} aria-label="Delete payment" style={{
          background: "transparent", border: "none", color: BC.t3,
          fontSize: FS.small, fontWeight: 700, cursor: "pointer",
          padding: "0 2px", flexShrink: 0, fontFamily: FONT,
        }}>✕</button>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  BALANCE DUE — the player's half, mounted inside My Account
// ══════════════════════════════════════════════════════════════════
//
// Shown only when there is something to show (lib/ledger's hasLedger): a
// tournament that never set a figure has no accounts, and an empty card about
// nothing is worse than no card.
export function BalanceCard({ player, payments, duesAmount }) {
  const row = balanceFor({ player, payments, defaultAmount: duesAmount });
  const mine = useMemo(() => paymentsFor(payments, player?.player_id), [payments, player?.player_id]);
  if (!player || !hasLedger(row)) return null;

  const owes = owesMoney(row);
  const overpaid = row.balance < 0;
  // Three states, three colours, and the wording changes with them — "BALANCE
  // DUE $0" is a true sentence that reads like a bill.
  const tone = owes ? BC.danger : BC.green;
  const heading = owes ? "BALANCE DUE" : overpaid ? "OVERPAID" : "PAID IN FULL";

  return (
    <>
      <SectionLabel style={{ color: owes ? BC.danger : BC.amberInk }}>{heading}</SectionLabel>
      <Card style={{ marginBottom: 16, border: `1px solid ${tone}${ALPHA.line}` }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: FS.display, fontWeight: 800, color: tone, lineHeight: 1.05 }}>
            {money(Math.abs(row.balance))}
          </div>
          <div style={{ fontSize: FS.label, color: BC.t3, textAlign: "right", lineHeight: 1.6 }}>
            <div>Trip cost <span style={{ color: BC.t1, fontWeight: 700 }}>{money(row.due)}</span></div>
            <div>Paid <span style={{ color: BC.t1, fontWeight: 700 }}>{money(row.paid)}</span></div>
          </div>
        </div>

        {/* Only the state the numbers can't state. BALANCE DUE over a red
            figure says "you owe this" and PAID IN FULL over a green zero says
            "you don't"; both used to carry a sentence saying it again.
            OVERPAID is the one that doesn't speak for itself — it is the only
            one where the money moves back the other way. */}
        {overpaid && (
          <div style={{ fontSize: FS.small, color: BC.t2, lineHeight: 1.5, marginTop: 10 }}>
            You have sent more than the trip cost. The director owes you the difference back.
          </div>
        )}

        {mine.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: FS.label, fontWeight: 700, letterSpacing: 1, color: BC.t3, marginBottom: 2 }}>
              PAYMENTS
            </div>
            {mine.map(p => <PaymentRow key={p.id} payment={p} />)}
          </div>
        )}
        {mine.length === 0 && row.due > 0 && (
          <div style={{ fontSize: FS.label, color: BC.t3, marginTop: 10 }}>
            No payments logged yet.
          </div>
        )}
      </Card>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════
//  ADMIN → MONEY — the director's console
// ══════════════════════════════════════════════════════════════════

// The per-player sheet: their position, their receipts, the form that adds
// one, and the override that says this man's trip costs something different.
function PlayerLedgerSheet({
  row, payments, duesAmount, teams, onLogPayment, onDeletePayment, onSetPlayerDues, onClose, notify,
}) {
  const { confirm, confirmModal } = useConfirm();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => todayISO());
  const [method, setMethod] = useState(DEFAULT_METHOD);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [dueEdit, setDueEdit] = useState(() =>
    hasDuesOverride(row.player) ? String(round2(row.player.dues_amount)) : "");

  const pid = row.player_id;
  const mine = paymentsFor(payments, pid);
  const team = row.player?.team ? teams?.[row.player.team] : null;
  const accent = team?.accent || BC.amber;

  const save = async () => {
    const err = paymentError({ playerId: pid, amount, date });
    if (err) { notify?.(err, "error"); return; }
    setBusy(true);
    try {
      const res = await onLogPayment({ playerId: pid, amount, date, method, note });
      if (!res?.ok) { notify?.(res?.error || "Could not log that payment — try again", "error"); return; }
      notify?.(`${money(amount)} logged for ${row.player?.name || "player"}`, "success");
      // The form stays open and only the amount and note clear: the director
      // is usually working down a stack of Venmos, and re-picking the date and
      // the method for each one is the difference between this being used and
      // being abandoned halfway.
      setAmount("");
      setNote("");
    } finally { setBusy(false); }
  };

  const remove = async (p) => {
    const ok = await confirm({
      eyebrow: row.player?.name || "Payment",
      title: `Delete this ${money(p.amount)} payment?`,
      message: [
        `${formatISODate(p.date, { withYear: true })} · ${methodLabel(p.method)}`,
        "",
        "It comes straight off their balance. A refund is its own conversation, not a deletion.",
      ].join("\n"),
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    const done = await onDeletePayment(p);
    notify?.(done?.ok ? "Payment deleted" : (done?.error || "Could not delete that payment — try again"),
      done?.ok ? "success" : "error");
  };

  // Blank means "no override, use the tournament figure", which is why an
  // emptied box is a real edit rather than a no-op.
  const dueDirty = dueEdit.trim() !== (hasDuesOverride(row.player) ? String(round2(row.player.dues_amount)) : "");
  const saveDue = async () => {
    const raw = dueEdit.trim();
    if (raw !== "") {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) { notify?.("Enter a trip cost, or leave it blank.", "error"); return; }
    }
    setBusy(true);
    try {
      const res = await onSetPlayerDues(row.player, raw === "" ? null : round2(raw));
      notify?.(res?.ok
        ? (raw === "" ? "Back on the tournament figure" : `Trip cost set to ${money(raw)}`)
        : (res?.error || "Could not save that — try again"), res?.ok ? "success" : "error");
    } finally { setBusy(false); }
  };

  return (
    <Popup onClose={busy ? undefined : onClose} maxWidth={400} padding={18} portal showClose={!busy}
      viewportFit align="start">
      <div style={{ fontFamily: FONT }}>
        <div style={{ fontSize: FS.label, fontWeight: 800, letterSpacing: 1.5, color: accent, marginBottom: 4 }}>
          {team?.name || "ROSTER"}
        </div>
        <div style={{ fontSize: FS.lead, fontWeight: 800, color: BC.t1, marginBottom: 12 }}>
          {row.player?.name || "Player"}
        </div>

        {/* Where they stand — the same three numbers the player sees, in the
            same order, so the two screens cannot be read as disagreeing. */}
        <div style={{
          display: "flex", justifyContent: "space-between", gap: 8,
          background: BC.inp, borderRadius: 10, padding: "10px 12px", marginBottom: 14,
        }}>
          {[
            ["TRIP COST", money(row.due), BC.t1],
            ["PAID", money(row.paid), BC.green],
            [row.balance < 0 ? "OVERPAID" : "BALANCE", money(Math.abs(row.balance)),
              owesMoney(row) ? BC.danger : BC.green],
          ].map(([label, value, color]) => (
            <div key={label} style={{ minWidth: 0 }}>
              <div style={{ fontSize: FS.label, color: BC.t3, fontWeight: 700, letterSpacing: 0.5 }}>{label}</div>
              <div style={{ fontSize: FS.lead, fontWeight: 800, color, marginTop: 2 }}>{value}</div>
            </div>
          ))}
        </div>

        {/* ── Log a payment ── */}
        <div style={{ fontSize: FS.label, fontWeight: 800, letterSpacing: 1.2, color: BC.amberInk, marginBottom: 8 }}>
          LOG A PAYMENT
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          <div>
            <label style={fieldLabel()} htmlFor="bc-pay-amount">AMOUNT</label>
            <input id="bc-pay-amount" style={inputStyle()} inputMode="decimal" placeholder="0.00"
              value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
          <div>
            <label style={fieldLabel()} htmlFor="bc-pay-date">DATE</label>
            <input id="bc-pay-date" style={inputStyle()} type="date"
              value={date} onChange={e => setDate(e.target.value)} />
          </div>
        </div>
        <div style={{ marginBottom: 8 }}>
          <label style={fieldLabel()} htmlFor="bc-pay-method">METHOD</label>
          <select id="bc-pay-method" style={inputStyle()} value={method} onChange={e => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={fieldLabel()} htmlFor="bc-pay-note">NOTE (OPTIONAL)</label>
          <input id="bc-pay-note" style={inputStyle()} maxLength={MAX_NOTE} placeholder="second installment"
            value={note} onChange={e => setNote(e.target.value)} />
        </div>
        <button onClick={save} disabled={busy} style={{
          width: "100%", padding: "12px 0", borderRadius: 10, border: "none",
          background: BC.amber, color: ON_AMBER, fontSize: FS.body, fontWeight: 800,
          letterSpacing: 0.5, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
          fontFamily: FONT, marginBottom: 16,
        }}>
          {busy ? "Working…" : "Log Payment"}
        </button>

        {/* ── The receipts ── */}
        <div style={{ fontSize: FS.label, fontWeight: 800, letterSpacing: 1.2, color: BC.t3, marginBottom: 2 }}>
          PAYMENTS ({mine.length})
        </div>
        {mine.length === 0
          ? <div style={{ fontSize: FS.small, color: BC.t3, padding: "8px 0" }}>Nothing logged yet.</div>
          : mine.map(p => <PaymentRow key={p.id} payment={p} onDelete={remove} />)}

        {/* ── This player's own figure ──
            Last, because it is the rare edit. Blank means the tournament
            figure, and the placeholder says what that is rather than
            pre-filling it — a pre-filled box would save an override on every
            player the moment anybody opened the sheet. */}
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${BC.bdr}` }}>
          <label style={fieldLabel()} htmlFor="bc-pay-due">THIS PLAYER&apos;S TRIP COST</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input id="bc-pay-due" style={{ ...inputStyle(), flex: 1 }} inputMode="decimal"
              placeholder={`${money(duesAmount)} (tournament)`}
              value={dueEdit} onChange={e => setDueEdit(e.target.value)} />
            <button onClick={saveDue} disabled={busy || !dueDirty} style={{
              padding: "0 16px", borderRadius: 8, flexShrink: 0,
              background: dueDirty ? `${BC.amber}${ALPHA.wash}` : "transparent",
              border: `1px solid ${dueDirty ? BC.amber + ALPHA.line : BC.bdr}`,
              color: dueDirty ? BC.amberInk : BC.t3,
              fontSize: FS.small, fontWeight: 800, fontFamily: FONT,
              cursor: busy || !dueDirty ? "default" : "pointer",
            }}>Save</button>
          </div>
          {/* The placeholder already reads "$800 (tournament)", so blank
              explains itself. The 0 does not — a written zero is an override,
              not an absence, and it is the only way to comp somebody. */}
          <div style={{ fontSize: FS.label, color: BC.t3, lineHeight: 1.5, marginTop: 6 }}>
            0 means they&apos;re not paying.
          </div>
        </div>

        <ConfirmModal modal={confirmModal} />
      </div>
    </Popup>
  );
}

// The console itself.
export function LedgerAdmin({
  tPlayers, teams, payments, duesAmount, onSaveDues, onLogPayment, onDeletePayment,
  onSetPlayerDues, notify,
}) {
  const [openPid, setOpenPid] = useState(null);
  const [duesEdit, setDuesEdit] = useState(() => (duesAmount > 0 ? String(duesAmount) : ""));
  const [savingDues, setSavingDues] = useState(false);

  const rows = useMemo(
    () => ledgerRows({ players: tPlayers, payments, defaultAmount: duesAmount }),
    [tPlayers, payments, duesAmount]
  );
  const totals = useMemo(() => ledgerTotals(rows), [rows]);
  const open = rows.find(r => r.player_id === openPid) || null;

  const duesDirty = duesEdit.trim() !== (duesAmount > 0 ? String(duesAmount) : "");
  const saveDues = async () => {
    const n = Number(duesEdit.trim() || 0);
    if (!Number.isFinite(n) || n < 0) { notify?.("Enter a trip cost.", "error"); return; }
    setSavingDues(true);
    try {
      const res = await onSaveDues(round2(n));
      notify?.(res?.ok ? `Trip cost set to ${money(n)} a man` : (res?.error || "Could not save that — try again"),
        res?.ok ? "success" : "error");
    } finally { setSavingDues(false); }
  };

  return (
    <div style={{ fontFamily: FONT }}>
      {/* ── The three numbers ──
          Outstanding leads and is the only one ever coloured: it is the
          number the director opens this tab to find, and the other two are
          the context that makes it believable. */}
      <div style={{
        display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 12,
        background: BC.card, border: `1px solid ${BC.bdr}`, borderRadius: 12, padding: "12px 14px",
      }}>
        {[
          ["OUTSTANDING", money(totals.outstanding), totals.outstanding > 0 ? BC.danger : BC.green],
          ["COLLECTED", money(totals.collected), BC.t1],
          ["BILLED", money(totals.billed), BC.t1],
        ].map(([label, value, color]) => (
          <div key={label} style={{ minWidth: 0 }}>
            <div style={{ fontSize: FS.label, color: BC.t3, fontWeight: 700, letterSpacing: 0.5 }}>{label}</div>
            <div style={{ fontSize: FS.lead, fontWeight: 800, color, marginTop: 2 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── The tournament figure ──
          Everything else on this tab is derived from it, so it sits above the
          roster rather than behind a settings link. */}
      <div style={{ background: BC.card, border: `1px solid ${BC.bdr}`, borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
        <label style={fieldLabel()} htmlFor="bc-dues">TRIP COST PER PLAYER</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input id="bc-dues" style={{ ...inputStyle(), flex: 1 }} inputMode="decimal" placeholder="0.00"
            value={duesEdit} onChange={e => setDuesEdit(e.target.value)} />
          <button onClick={saveDues} disabled={savingDues || !duesDirty} style={{
            padding: "0 18px", borderRadius: 8, flexShrink: 0,
            background: duesDirty ? BC.amber : "transparent",
            border: duesDirty ? "none" : `1px solid ${BC.bdr}`,
            color: duesDirty ? ON_AMBER : BC.t3,
            fontSize: FS.small, fontWeight: 800, fontFamily: FONT,
            cursor: savingDues || !duesDirty ? "default" : "pointer",
          }}>Save</button>
        </div>
        {/* The field's own label says what it is, and the roster under it
            demonstrates the per-player override. This is the only part the
            screen cannot show: the figure is also the ledger's on/off switch. */}
        <div style={{ fontSize: FS.label, color: BC.t3, lineHeight: 1.5, marginTop: 6 }}>
          Set it to 0 and the ledger disappears from everyone&apos;s My Account.
        </div>
      </div>

      {/* ── The roster ──
          Sorted by who owes the most (lib/ledger's ledgerRows), because the
          only thing anybody does with this list is work down it. */}
      <div style={{ fontSize: FS.label, fontWeight: 800, letterSpacing: 1.2, color: BC.t3, marginBottom: 6 }}>
        {totals.owing > 0
          ? `${totals.owing} OF ${totals.total} STILL OWING`
          : totals.total > 0 ? "EVERYBODY IS SQUARE" : "NO PLAYERS ON THE ROSTER"}
      </div>
      <div style={{ background: BC.card, border: `1px solid ${BC.bdr}`, borderRadius: 12, overflow: "hidden" }}>
        {rows.map((r, i) => {
          const team = r.player?.team ? teams?.[r.player.team] : null;
          const owes = owesMoney(r);
          return (
            <button key={r.player_id} onClick={() => setOpenPid(r.player_id)} style={{
              width: "100%", display: "flex", alignItems: "center", gap: 10,
              padding: "11px 14px", background: "transparent", cursor: "pointer",
              border: "none", borderTop: i === 0 ? "none" : `1px solid ${BC.bdr}${ALPHA.hair}`,
              textAlign: "left", fontFamily: FONT,
            }}>
              <span style={{
                width: 3, alignSelf: "stretch", borderRadius: 2, flexShrink: 0,
                background: team?.accent || BC.bdr,
              }} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{
                  display: "block", fontSize: FS.body, fontWeight: 700, color: BC.t1,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{r.player?.name || r.player_id}</span>
                <span style={{ display: "block", fontSize: FS.label, color: BC.t3, marginTop: 2 }}>
                  {money(r.paid)} of {money(r.due)}
                  {r.count > 0 && ` · ${r.count} payment${r.count === 1 ? "" : "s"}`}
                </span>
              </span>
              <span style={{
                flexShrink: 0, fontSize: FS.small, fontWeight: 800,
                padding: "3px 9px", borderRadius: 999,
                background: owes ? `${BC.danger}${ALPHA.wash}` : `${BC.green}${ALPHA.wash}`,
                color: owes ? BC.danger : BC.green,
              }}>
                {owes ? money(r.balance) : r.balance < 0 ? `+${money(-r.balance)}` : "Paid"}
              </span>
            </button>
          );
        })}
      </div>

      {open && (
        <PlayerLedgerSheet
          row={open}
          payments={payments}
          duesAmount={duesAmount}
          teams={teams}
          onLogPayment={onLogPayment}
          onDeletePayment={onDeletePayment}
          onSetPlayerDues={onSetPlayerDues}
          onClose={() => setOpenPid(null)}
          notify={notify}
        />
      )}
    </div>
  );
}
