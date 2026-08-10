// ══════════════════════════════════════════════════════════════════
//  SideBets — the wagers the app does not run
// ══════════════════════════════════════════════════════════════════
//
//  The other three Betting tabs are games the app SCORES. This one is a
//  ledger: two players agree something on the first tee, one of them writes
//  it down here, and the app settles nothing. See src/lib/sideBets.js for why
//  the terms are free text and why nothing accepts or declines.
//
//  It replaced Settle, which summed the three scored games into a net
//  position per player. That was arithmetic anybody could already read off
//  the three tabs it summarised; this is the thing that genuinely had nowhere
//  to live but a napkin.

import { useState } from "react";
import { BC, FONT, ALPHA, FS, ON_AMBER, teamColor } from "../theme";
import { Popup } from "./Popup";
import {
  sideBetError, sortSideBets, sideBetTotals, canDeleteSideBet, inSideBet, MAX_DETAIL,
} from "../lib/sideBets";

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
// A total is whole money on a card whose header runs three numbers across a
// phone — the same call the skins pot makes, for the same reason.
const potMoney = (n) => `$${Math.round(Number(n) || 0).toLocaleString()}`;

export function SideBets({ players, bets, user, authUid, teams, onAddBet, onDeleteBet, confirm }) {
  const [adding, setAdding] = useState(false);

  const myPid = user?.player_id || null;
  const rows = sortSideBets(bets);
  const totals = sideBetTotals(rows, myPid);
  const byId = (pid) => players.find(p => p.player_id === pid) || null;
  const nameOf = (pid) => byId(pid)?.name || "—";
  const dotColor = (pid) => {
    const p = byId(pid);
    return (p && teams?.[p.team]?.accent) || teamColor(p?.team) || BC.t3;
  };

  // Whether this reader can log a bet at all. A member can; a spectator
  // looking at 2019 from the Tournaments picker cannot, and gets told that
  // rather than a button whose write the rules would refuse.
  const canAdd = !!authUid;

  const remove = async (b) => {
    const ok = await confirm({
      title: "Delete this bet?",
      message: `${nameOf(b.player_a)} vs ${nameOf(b.player_b)} · ${money(b.amount)}. This removes the record for everybody.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) await onDeleteBet(b);
  };

  return (
    <div style={{ fontFamily: FONT }}>
      {/* The same three-column header the skins pot carries, because a side
          bet ledger has the same shape of question: what is out there, how
          many of them, and how much of it is mine. `YOURS` is EXPOSURE — what
          this player has riding either way — not a net, because nothing here
          knows who won. */}
      <div style={{ background: BC.card, borderRadius: 12, marginBottom: 12, border: `1px solid ${BC.bdr}`, overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: FS.label, color: BC.t3, fontWeight: 700, letterSpacing: 1 }}>AT STAKE</div>
            <div style={{ fontSize: FS.title, fontWeight: 800, color: BC.gold }}>{potMoney(totals.atStake)}</div>
          </div>
          <div style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
            <div style={{ fontSize: FS.label, color: BC.t3, fontWeight: 700, letterSpacing: 1 }}>BETS</div>
            <div style={{ fontSize: FS.title, fontWeight: 800, color: BC.amberInk, overflow: "hidden", textOverflow: "ellipsis" }}>{totals.count}</div>
          </div>
          <div style={{ flex: 1, minWidth: 0, textAlign: "right" }}>
            <div style={{ fontSize: FS.label, color: BC.t3, fontWeight: 700, letterSpacing: 1 }}>YOURS</div>
            <div style={{ fontSize: FS.title, fontWeight: 800, color: BC.amberInk, overflow: "hidden", textOverflow: "ellipsis" }}>{potMoney(totals.mine)}</div>
          </div>
        </div>
        {canAdd && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            style={{
              display: "block", width: "100%", padding: "9px 14px", cursor: "pointer",
              borderTop: `1px solid ${BC.bdr}`, borderLeft: "none", borderRight: "none",
              borderBottom: "none", background: "transparent", fontFamily: FONT,
              fontSize: FS.label, fontWeight: 700, color: BC.amberInk, letterSpacing: 0.6,
            }}
          >
            + ADD BET
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, padding: "60px 20px", textAlign: "center" }}>
          <div style={{ fontSize: FS.jumbo, marginBottom: 12, opacity: 0.4 }}>🤝</div>
          <div style={{ fontSize: FS.lead, fontWeight: 700, color: BC.t1, marginBottom: 6 }}>No side bets yet</div>
          <div style={{ fontSize: FS.small, color: BC.t3, maxWidth: 280, margin: "0 auto", lineHeight: 1.5 }}>
            {canAdd
              ? "Anything you have going with somebody else — a press, closest on 17, first to break 90. Write it down here and everybody can see the terms."
              : "Bets players have going with each other show up here."}
          </div>
        </div>
      ) : (
        <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, overflow: "hidden" }}>
          {rows.map((b, i) => {
            const mine = inSideBet(b, myPid);
            const deletable = canDeleteSideBet(b, { uid: authUid, isDirector: user?.isDirector === true });
            return (
              <div key={b.id} style={{
                padding: "10px 14px",
                borderBottom: i < rows.length - 1 ? `1px solid ${BC.bdr}${ALPHA.hair}` : "none",
                // A bet you are in gets a rail down its edge. Sixteen people
                // making bets all weekend is a long list to read your own name
                // out of one row at a time.
                borderLeft: mine ? `3px solid ${BC.amber}` : "3px solid transparent",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor(b.player_a), flexShrink: 0 }} />
                      <span style={{ fontSize: FS.small, fontWeight: 700, color: BC.t1 }}>{nameOf(b.player_a)}</span>
                    </span>
                    <span style={{ fontSize: FS.micro, color: BC.t3, fontWeight: 700, letterSpacing: 0.5 }}>VS</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor(b.player_b), flexShrink: 0 }} />
                      <span style={{ fontSize: FS.small, fontWeight: 700, color: BC.t1 }}>{nameOf(b.player_b)}</span>
                    </span>
                  </div>
                  <span style={{ fontSize: FS.body, fontWeight: 800, color: BC.gold, flexShrink: 0 }}>{money(b.amount)}</span>
                  {deletable && (
                    <button
                      type="button"
                      aria-label="Delete this bet"
                      onClick={() => remove(b)}
                      style={{
                        flexShrink: 0, background: "transparent", border: "none", padding: "2px 0 2px 6px",
                        cursor: "pointer", fontFamily: FONT, fontSize: FS.small, color: BC.t3, lineHeight: 1,
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
                {/* The terms, which are the whole point of writing it down —
                    an amount and two names is the part everybody already
                    remembers. `pre-wrap` because somebody will type a list. */}
                {b.detail && (
                  <div style={{ fontSize: FS.small, color: BC.t2, marginTop: 3, lineHeight: 1.4, whiteSpace: "pre-wrap" }}>
                    {b.detail}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {adding && (
        <AddBetSheet
          players={players}
          me={myPid}
          onCancel={() => setAdding(false)}
          onSave={async (form) => { await onAddBet(form); setAdding(false); }}
        />
      )}
    </div>
  );
}

// ── The form ──────────────────────────────────────────────────────
// Side A defaults to whoever is logged in, because the overwhelming case is a
// player writing down their own bet. It stays a picker rather than a fixed
// label so the case that would otherwise dead-end still works: a director
// with no roster row, or a player writing down two other people's bet at the
// bar. Somebody has to be able to record it or it goes back on the napkin.
function AddBetSheet({ players, me, onCancel, onSave }) {
  const [playerA, setPlayerA] = useState(me || "");
  const [playerB, setPlayerB] = useState("");
  const [amount, setAmount] = useState("");
  const [detail, setDetail] = useState("");
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const problem = sideBetError({ playerA, playerB, amount });
    if (problem) { setErr(problem); return; }
    setSaving(true);
    try { await onSave({ playerA, playerB, amount, detail }); }
    finally { setSaving(false); }
  };

  const label = (t) => (
    <div style={{ fontSize: FS.label, color: BC.t3, fontWeight: 700, letterSpacing: 1, marginBottom: 5 }}>{t}</div>
  );
  const field = {
    width: "100%", boxSizing: "border-box", fontFamily: FONT, fontSize: FS.body,
    padding: "9px 10px", borderRadius: 8, border: `1px solid ${BC.bdr}`,
    background: BC.bg, color: BC.t1, outline: "none",
  };

  const picker = (value, onChange, exclude) => (
    <select value={value} onChange={e => { setErr(null); onChange(e.target.value); }} style={field}>
      <option value="">Select a player…</option>
      {players.filter(p => p.player_id !== exclude).map(p => (
        <option key={p.player_id} value={p.player_id}>{p.name}</option>
      ))}
    </select>
  );

  return (
    // viewportFit + align start, because this form has a text field on a phone
    // and the classic centred overlay sits under the keyboard.
    <Popup onClose={saving ? undefined : onCancel} maxWidth={400} padding={16} portal viewportFit align="start">
      <div style={{ fontFamily: FONT }}>
        <div style={{ fontSize: FS.lead, fontWeight: 800, color: BC.t1, marginBottom: 14 }}>New side bet</div>

        <div style={{ marginBottom: 12 }}>
          {label("BETWEEN")}
          {picker(playerA, setPlayerA, playerB)}
        </div>
        <div style={{ marginBottom: 12 }}>
          {label("AND")}
          {picker(playerB, setPlayerB, playerA)}
        </div>

        <div style={{ marginBottom: 12 }}>
          {label("AMOUNT")}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: FS.lead, fontWeight: 800, color: BC.gold }}>$</span>
            <input
              type="number" inputMode="decimal" value={amount} placeholder="0.00"
              onChange={e => { setErr(null); setAmount(e.target.value); }}
              style={{ ...field, fontWeight: 800, color: BC.gold }}
            />
          </div>
        </div>

        <div style={{ marginBottom: 4 }}>
          {label("DETAIL")}
          <textarea
            value={detail} rows={3} maxLength={MAX_DETAIL}
            placeholder="The terms — what has to happen, and who pays."
            onChange={e => setDetail(e.target.value)}
            style={{ ...field, resize: "vertical", lineHeight: 1.4 }}
          />
        </div>
        <div style={{ fontSize: FS.micro, color: BC.t3, textAlign: "right", marginBottom: 12 }}>
          {detail.length}/{MAX_DETAIL}
        </div>

        {err && (
          <div style={{ fontSize: FS.small, color: BC.danger, marginBottom: 10, fontWeight: 600 }}>{err}</div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button" onClick={onCancel} disabled={saving}
            style={{
              flex: 1, padding: "10px 0", borderRadius: 8, cursor: "pointer", fontFamily: FONT,
              fontSize: FS.body, fontWeight: 700, border: `1px solid ${BC.bdr}`,
              background: "transparent", color: BC.t2,
            }}
          >
            Cancel
          </button>
          <button
            type="button" onClick={submit} disabled={saving}
            style={{
              flex: 1, padding: "10px 0", borderRadius: 8, cursor: "pointer", fontFamily: FONT,
              fontSize: FS.body, fontWeight: 800, border: "none",
              background: BC.amber, color: ON_AMBER, opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Saving…" : "Add bet"}
          </button>
        </div>
      </div>
    </Popup>
  );
}
