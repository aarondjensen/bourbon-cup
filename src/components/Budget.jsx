// ══════════════════════════════════════════════════════════════════
//  Admin → Budget, the Budget sub-tab — what the trip costs
// ══════════════════════════════════════════════════════════════════
//
// The other half of the Money screen. Accounting next door is money coming IN
// from the field; this is what is going OUT, and it is the half a director
// works out first — the house, the greens fees, the carts, the steaks.
//
// The arithmetic is all in lib/budget. What this owns is the ORDER of the
// answer: the total and the per-man figure at the top, the comparison against
// what is actually being charged directly under it, and the lines themselves
// last. A director opening this in March wants "is $850 enough"; the lines are
// how they change the answer, not the answer.
import { useState, useMemo } from "react";
import { BC, FONT, ALPHA, FS, ON_AMBER } from "../theme";
import { Popup, ConfirmModal } from "./Popup";
import { useConfirm } from "../lib/useConfirm";
import { money } from "../lib/ledger";
import { SegmentedToggle } from "./ui";
import {
  BUDGET_CATEGORIES, DEFAULT_CATEGORY, MAX_LABEL,
  BUDGET_BASES, BASIS_PER_MAN, normalizeBasis, isPerMan, lineTitle,
  budgetGroups, budgetVsDues, budgetLineError,
} from "../lib/budget";

// Same reasoning as the ledger's: these are FUNCTIONS because `BC` is mutated
// in place by applyBCTheme, so a module-level object literal would freeze
// whatever theme happened to be active when this file was first imported.
const inputStyle = () => ({
  width: "100%", padding: "8px 10px", background: BC.inp,
  border: `1px solid ${BC.bdr}`, borderRadius: 8, color: BC.t1,
  fontSize: FS.lead, boxSizing: "border-box", outline: "none", fontFamily: FONT,
});

const fieldLabel = () => ({
  fontSize: FS.label, color: BC.t3, fontWeight: 700, letterSpacing: 1,
  marginBottom: 4, display: "block",
});

// The add / edit sheet. One shape for both, because a line has four fields and
// a second read-only view of them would be a second thing to keep in step.
function BudgetLineSheet({ line, playerCount, onSave, onDelete, onClose, notify }) {
  const { confirm, confirmModal } = useConfirm();
  const editing = !!line?.id;
  const [category, setCategory] = useState(line?.category || DEFAULT_CATEGORY);
  const [label, setLabel] = useState(line?.label || "");
  const [amount, setAmount] = useState(line?.amount != null ? String(line.amount) : "");
  const [basis, setBasis] = useState(normalizeBasis(line?.basis));
  const [busy, setBusy] = useState(false);

  // What the line will actually cost the trip, worked out live under the
  // amount. A per-man figure is the one number a director cannot check in
  // their head against the total at the top, so the form does it for them.
  const perMan = basis === BASIS_PER_MAN;
  const typed = Number(amount);
  const expanded = Number.isFinite(typed) && perMan && playerCount ? typed * playerCount : null;

  const save = async () => {
    const err = budgetLineError({ amount });
    if (err) { notify?.(err, "error"); return; }
    setBusy(true);
    try {
      const res = await onSave({ id: line?.id, category, label, amount, basis });
      if (!res?.ok) { notify?.(res?.error || "Could not save that line — try again", "error"); return; }
      notify?.(editing ? "Line saved" : `${lineTitle({ label, category })} added`, "success");
      onClose();
    } finally { setBusy(false); }
  };

  const remove = async () => {
    const ok = await confirm({
      eyebrow: "Budget",
      title: `Delete ${lineTitle(line)}?`,
      message: `${money(line.amount)} comes off the trip's total. Nothing about what anybody has paid changes — that is the Accounting tab.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const done = await onDelete(line);
      notify?.(done?.ok ? "Line deleted" : (done?.error || "Could not delete that line — try again"),
        done?.ok ? "success" : "error");
      if (done?.ok) onClose();
    } finally { setBusy(false); }
  };

  return (
    <Popup onClose={busy ? undefined : onClose} maxWidth={380} padding={18} portal showClose={!busy}
      viewportFit align="start">
      <div style={{ fontFamily: FONT }}>
        <div style={{ fontSize: FS.label, fontWeight: 800, letterSpacing: 1.5, color: BC.amberInk, marginBottom: 10 }}>
          {editing ? "EDIT LINE" : "ADD A LINE"}
        </div>

        <div style={{ marginBottom: 8 }}>
          <label style={fieldLabel()} htmlFor="bc-budget-cat">CATEGORY</label>
          <select id="bc-budget-cat" style={inputStyle()} value={category} onChange={e => setCategory(e.target.value)}>
            {BUDGET_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        {/* ── Total, or per man ──
            Whichever way the director actually knows the price. The house is
            one number off a listing; golf is what the course quotes a man.
            Making them multiply in their head is how a budget ends up with
            "greens fees 1440" that nobody can check a month later. */}
        <div style={{ marginBottom: 8 }}>
          <label style={fieldLabel()}>AMOUNT IS A</label>
          <SegmentedToggle
            options={BUDGET_BASES.map(b => [b.id, b.label])}
            value={basis}
            onChange={setBasis}
          />
        </div>
        <div style={{ marginBottom: 8 }}>
          <label style={fieldLabel()} htmlFor="bc-budget-amount">
            {perMan ? "AMOUNT PER MAN" : "TOTAL AMOUNT"}
          </label>
          <input id="bc-budget-amount" style={inputStyle()} inputMode="decimal" placeholder="0.00"
            value={amount} onChange={e => setAmount(e.target.value)} />
          {perMan && (
            <div style={{ fontSize: FS.label, color: BC.t3, marginTop: 5, lineHeight: 1.4 }}>
              {playerCount
                ? expanded != null
                  ? `× ${playerCount} on the roster = ${money(expanded)} on the trip.`
                  : `Multiplied by the ${playerCount} on the roster.`
                : "Nobody on the roster yet, so this adds nothing to the total until there is."}
            </div>
          )}
        </div>
        {/* Optional, and that is the point of the rename. A Lodging line for
            the house needs no elaboration — its category is the whole story,
            and requiring one means typing "Lodging" twice. */}
        <div style={{ marginBottom: 12 }}>
          <label style={fieldLabel()} htmlFor="bc-budget-label">DETAIL (OPTIONAL)</label>
          <input id="bc-budget-label" style={inputStyle()} maxLength={MAX_LABEL}
            placeholder={`e.g. ${category === "golf" ? "Greens fees" : "4 nights"}`}
            value={label} onChange={e => setLabel(e.target.value)} />
        </div>

        <button onClick={save} disabled={busy} style={{
          width: "100%", padding: "11px 0", borderRadius: 10, border: "none",
          background: BC.amber, color: ON_AMBER, fontSize: FS.body, fontWeight: 800,
          letterSpacing: 0.5, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
          fontFamily: FONT,
        }}>
          {busy ? "Working…" : editing ? "Save Line" : "Add Line"}
        </button>

        {editing && (
          <button onClick={remove} disabled={busy} style={{
            width: "100%", padding: "9px 0", marginTop: 8, borderRadius: 8,
            background: "transparent", border: "none", color: BC.danger,
            fontSize: FS.small, fontWeight: 700, cursor: busy ? "default" : "pointer",
            fontFamily: FONT,
          }}>
            Delete this line
          </button>
        )}

        <ConfirmModal modal={confirmModal} />
      </div>
    </Popup>
  );
}

export function BudgetAdmin({ lines, playerCount, charged, duesAmount, onSaveLine, onDeleteLine, notify }) {
  const [open, setOpen] = useState(null);   // a line, or {} for a new one
  const groups = useMemo(() => budgetGroups(lines, playerCount), [lines, playerCount]);
  const v = useMemo(
    () => budgetVsDues({ lines, charged, playerCount }),
    [lines, charged, playerCount]
  );

  const short = v.comparable && v.gap < 0;
  const spare = v.comparable && v.gap > 0;

  return (
    <div style={{ fontFamily: FONT }}>
      {/* ── The answer ──
          Total and per-man, which is the pair a director came here for. The
          per-man figure is the one that ought to be the trip cost next door,
          so it is given the accent rather than the total. */}
      <div style={{
        background: BC.card, border: `1px solid ${BC.bdr}`, borderRadius: 12,
        padding: "12px 14px", marginBottom: 10,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          {[
            ["TRIP COSTS", money(v.total), BC.t1],
            ["A MAN", v.perPlayer == null ? "—" : money(v.perPlayer), BC.amberInk],
            ["BEING CHARGED", v.billed > 0 ? money(v.billed) : "—", BC.t1],
          ].map(([label, value, color]) => (
            <div key={label} style={{ minWidth: 0 }}>
              <div style={{ fontSize: FS.label, color: BC.t3, fontWeight: 700, letterSpacing: 0.5 }}>{label}</div>
              <div style={{ fontSize: FS.lead, fontWeight: 800, color, marginTop: 2 }}>{value}</div>
            </div>
          ))}
        </div>

        {/* ── The join between the two halves ──
            The reason Budget and Accounting are sub-tabs of one screen. A
            director who prices the trip at $850 and then books a bigger house
            has no way to notice the gap otherwise; the ledger would go on
            collecting the old figure and come up short in October. */}
        {v.comparable && (
          <div style={{
            marginTop: 10, padding: "8px 10px", borderRadius: 8,
            background: short ? `${BC.danger}${ALPHA.wash}` : spare ? `${BC.green}${ALPHA.wash}` : BC.inp,
            border: `1px solid ${short ? BC.danger + ALPHA.line : spare ? BC.green + ALPHA.line : BC.bdr}`,
            fontSize: FS.small, lineHeight: 1.45,
            color: short ? BC.danger : spare ? BC.green : BC.t2,
            fontWeight: 700,
          }}>
            {short
              ? `Short ${money(-v.gap)} — the trip costs ${money(v.perPlayer)} a man and you're charging ${money(duesAmount)}.`
              : spare
                ? `${money(v.gap)} to spare at ${money(duesAmount)} a man.`
                : `Covered exactly at ${money(duesAmount)} a man.`}
          </div>
        )}
      </div>

      <button onClick={() => setOpen({})} style={{
        width: "100%", padding: "10px 0", borderRadius: 10, marginBottom: 12,
        background: `${BC.amber}${ALPHA.wash}`, border: `1px solid ${BC.amber}${ALPHA.line}`,
        color: BC.amberInk, fontSize: FS.small, fontWeight: 800, letterSpacing: 0.5,
        cursor: "pointer", fontFamily: FONT,
      }}>
        + Add a line
      </button>

      {/* ── The lines ──
          Grouped in the catalog's order with the biggest line at the top of
          each group — see lib/budget. That order is what makes the screen
          answerable at a glance: the top of each group is the line worth
          arguing about. */}
      {groups.length === 0 ? (
        <div style={{
          background: BC.card, border: `1px dashed ${BC.bdr}`, borderRadius: 12,
          padding: "16px 14px", fontSize: FS.small, color: BC.t2, lineHeight: 1.5,
        }}>
          Nothing budgeted yet. Add the house, the greens fees and the carts and this
          works out what the weekend costs a man — which is the figure to charge in Accounting.
        </div>
      ) : groups.map(g => (
        <div key={g.id} style={{ marginBottom: 12 }}>
          <div style={{
            display: "flex", alignItems: "baseline", justifyContent: "space-between",
            gap: 8, marginBottom: 5, padding: "0 2px",
          }}>
            <span style={{ fontSize: FS.label, fontWeight: 800, letterSpacing: 1.2, color: BC.t3 }}>
              {g.icon} {g.label.toUpperCase()}
            </span>
            <span style={{ fontSize: FS.small, fontWeight: 800, color: BC.t2 }}>{money(g.total)}</span>
          </div>
          <div style={{ background: BC.card, border: `1px solid ${BC.bdr}`, borderRadius: 10, overflow: "hidden" }}>
            {g.lines.map((l, i) => (
              <button key={l.id} onClick={() => setOpen(l)} style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px", textAlign: "left", fontFamily: FONT,
                background: "transparent", border: "none",
                borderTop: i === 0 ? "none" : `1px solid ${BC.bdr}${ALPHA.hair}`,
                cursor: "pointer",
              }}>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{
                    display: "block", fontSize: FS.small, fontWeight: 700, color: BC.t1,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{lineTitle(l)}</span>
                  {/* A note typed before the form dropped that field. Still
                      shown so nothing anybody wrote disappears. */}
                  {l.note && (
                    <span style={{
                      display: "block", fontSize: FS.label, color: BC.t3, marginTop: 2,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{l.note}</span>
                  )}
                </span>
                {/* The line's cost TO THE TRIP, always — that is the figure
                    that is comparable across lines and that adds up to the
                    subtotal beside the group heading. A per-man line says
                    what was typed underneath, because "$90 × 16" is the thing
                    a director wants to check. */}
                <span style={{ flexShrink: 0, textAlign: "right" }}>
                  <span style={{ display: "block", fontSize: FS.small, fontWeight: 800, color: BC.t1 }}>
                    {money(l.total)}
                  </span>
                  {isPerMan(l) && (
                    <span style={{ display: "block", fontSize: FS.label, color: BC.t3, marginTop: 1 }}>
                      {money(l.amount)}/man
                    </span>
                  )}
                </span>
                <span style={{ flexShrink: 0, color: BC.t3, fontSize: FS.lead, fontWeight: 700 }}>›</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {open && (
        <BudgetLineSheet
          line={open.id ? open : null}
          playerCount={playerCount}
          onSave={onSaveLine}
          onDelete={onDeleteLine}
          onClose={() => setOpen(null)}
          notify={notify}
        />
      )}
    </div>
  );
}
