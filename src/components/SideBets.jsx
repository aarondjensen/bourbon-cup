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

import { useMemo, useState } from "react";
import { BC, FONT, ALPHA, FS, ON_AMBER, teamColor } from "../theme";
import { Popup } from "./Popup";
import { SegmentedToggle } from "./ui";
import {
  sideBetError, sortSideBets, sideBetTotals, canDeleteSideBet, inSideBet,
  settleState, hasSettled, MAX_DETAIL,
} from "../lib/sideBets";

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
// A total is whole money on a card whose header runs three numbers across a
// phone — the same call the skins pot makes, for the same reason.
const potMoney = (n) => `$${Math.round(Number(n) || 0).toLocaleString()}`;

export function SideBets({ players, bets, user, authUid, teams, onAddBet, onDeleteBet, onSettleBet, confirm }) {
  const [adding, setAdding] = useState(false);
  // ALL is the default and the left-hand option. The ledger is the field's,
  // not yours — and a player who has not made a bet yet would otherwise open
  // this tab to an empty list that looks like the feature is broken rather
  // than like they have nothing on.
  const [mineOnly, setMineOnly] = useState(false);
  // Which row is mid-write, and the last failure. A settlement mark is a
  // claim about money; if the write did not land, the row must not go on
  // showing it as though it did.
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState(null);

  const myPid = user?.player_id || null;
  const all = sortSideBets(bets);
  const rows = mineOnly ? all.filter(b => inSideBet(b, myPid)) : all;
  // The header counts the WHOLE tournament regardless of the filter. Me/All
  // changes which rows you are reading, not what is true — unlike Gross/Net
  // on the skins tab, which changes who actually won what and so moves the
  // numbers above it. `YOURS` is already the answer to "how much of this is
  // mine", so a headline that shrank when you filtered would be saying the
  // same thing twice and contradicting itself the first time.
  const totals = sideBetTotals(all, myPid);
  // No toggle for somebody with no roster row — a spectator's "Me" is empty
  // by construction, and an option that can only ever show nothing is worse
  // than no option.
  const canFilter = !!myPid;
  // The one side that has claimed it, when exactly one has. Null when both
  // have (it is settled and says so) or neither (there is nothing to name).
  const soleMarker = (b) => {
    const a = hasSettled(b, b.player_a), z = hasSettled(b, b.player_b);
    return a === z ? null : (a ? b.player_a : b.player_b);
  };
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

  // A "paid" mark is one tap and it is reversible, so it gets no confirm
  // dialog — a dialog on a tee box is friction on a claim you can withdraw by
  // tapping again. What it does need is a way to say the write failed, since
  // the whole point of the mark is that it was recorded.
  const settle = async (b) => {
    setBusyId(b.id);
    setErr(null);
    try {
      await onSettleBet(b, myPid);
    } catch (e) {
      console.error("side bet settle", e);
      setErr(e?.code === "permission-denied"
        ? "Couldn't record that — this account can't write to this tournament."
        : "Couldn't record that. Check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  };

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
      </div>

      {/* ITS OWN CARD, AND FILLED. As a strip under the totals it read as a
          footnote on them — the same weight the skins card gives BUY-INS,
          which is a disclosure and not the thing you came to do. Here it is
          the primary action of the whole tab, so it gets the accent fill the
          app reserves for exactly that (ON_AMBER ink, never BC.bg — which ink
          sits on amber is decided by the fill, not by the theme). */}
      {canAdd && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          style={{
            display: "block", width: "100%", padding: "13px 14px", marginBottom: 12,
            cursor: "pointer", border: "none", borderRadius: 12, background: BC.amber,
            fontFamily: FONT, fontSize: FS.body, fontWeight: 800, color: ON_AMBER,
            letterSpacing: 0.8,
          }}
        >
          + ADD BET
        </button>
      )}

      {/* Whose bets you are reading. The same control the skins tab uses for
          Gross/Net, in the same place and at the same width, because it is
          the same kind of question — one list, two ways of looking at it. */}
      {canFilter && all.length > 0 && (
        <SegmentedToggle
          options={[[false, "All"], [true, "Me"]]}
          value={mineOnly}
          onChange={setMineOnly}
          style={{ marginBottom: 10, width: 160, marginLeft: "auto", marginRight: "auto" }}
        />
      )}

      {err && (
        <div style={{
          background: BC.card, borderRadius: 12, border: `1px solid ${BC.danger}${ALPHA.line}`,
          padding: "10px 14px", marginBottom: 10, fontSize: FS.small, color: BC.danger,
          fontWeight: 600, lineHeight: 1.4,
        }}>
          {err}
        </div>
      )}

      {rows.length === 0 ? (
        <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, padding: "60px 20px", textAlign: "center" }}>
          <div style={{ fontSize: FS.jumbo, marginBottom: 12, opacity: 0.4 }}>🤝</div>
          {/* Filtered-to-empty is a different answer from nothing-exists, and
              saying "No side bets yet" over a tournament with nine of them
              reads as the tab having lost them. */}
          <div style={{ fontSize: FS.lead, fontWeight: 700, color: BC.t1, marginBottom: 6 }}>
            {mineOnly ? "None of these are yours" : "No side bets yet"}
          </div>
          <div style={{ fontSize: FS.small, color: BC.t3, maxWidth: 280, margin: "0 auto", lineHeight: 1.5 }}>
            {mineOnly
              ? "You are not in any of the bets on the board. Switch to All to see everybody else's."
              : canAdd
                ? "Anything you have going with somebody else — a press, long drive, first to break 85, cornhole, etc."
                : "Bets players have going with each other show up here."}
          </div>
        </div>
      ) : (
        <div style={{ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, overflow: "hidden" }}>
          {rows.map((b, i) => {
            const mine = inSideBet(b, myPid);
            const deletable = canDeleteSideBet(b, { uid: authUid, isDirector: user?.isDirector === true });
            const state = settleState(b, myPid);
            const done = state === "settled";
            return (
              <div key={b.id} style={{
                padding: "10px 14px",
                borderBottom: i < rows.length - 1 ? `1px solid ${BC.bdr}${ALPHA.hair}` : "none",
                // A bet you are in gets a rail down its edge. Sixteen people
                // making bets all weekend is a long list to read your own name
                // out of one row at a time. A SETTLED bet keeps the rail but
                // loses the row: it is history, and history should not compete
                // with what is still owed.
                borderLeft: mine ? `3px solid ${done ? BC.green : BC.amber}` : "3px solid transparent",
                opacity: done ? 0.6 : 1,
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
                <SettleStrip
                  state={state}
                  otherName={nameOf(b.player_a === myPid ? b.player_b : b.player_a)}
                  /* Only meaningful when exactly ONE side has claimed it —
                     which is the only time a name is what the row needs to
                     say. Both or neither, and the state itself says it. */
                  markerName={soleMarker(b) ? nameOf(soleMarker(b)) : null}
                  /* Acting on a bet needs to be IN it and signed in. A
                     spectator reading last year's ledger is neither. */
                  canAct={mine && !!authUid}
                  onToggle={() => settle(b)}
                  busy={busyId === b.id}
                />
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

// ── Where a bet has got to, and the one tap that moves it ─────────
// A bet is paid when BOTH players say so. One player marking it is a CLAIM;
// the other agreeing is the record. That is why this is two marks rather than
// a settled flag — a flag would let whoever tapped first close the bet on the
// other's behalf, and "I paid you" / "no you didn't" is the argument the
// whole feature exists to keep off the tee box.
//
// Only `confirm` gets a filled button, because it is the only state that asks
// the reader for something. Everything else is either a claim they already
// made or somebody else's business.
function SettleStrip({ state, otherName, markerName, canAct, onToggle, busy }) {
  const chip = (bg, fg, border) => ({
    fontSize: FS.micro, fontWeight: 800, letterSpacing: 0.6, padding: "4px 9px",
    borderRadius: 6, fontFamily: FONT, cursor: busy ? "default" : "pointer",
    background: bg, color: fg, border: border || "1px solid transparent",
    flexShrink: 0, opacity: busy ? 0.5 : 1,
  });

  // [ status text, button label, button style ] per state. `settled` is the
  // one state a bystander also sees, so its button is gated on canAct below
  // rather than on the state — a spectator must not be offered a REOPEN whose
  // write the rules would refuse.
  const [status, label, style] = {
    open:     ["", "MARK PAID", chip("transparent", BC.amberInk, `1px solid ${BC.bdr}`)],
    confirm:  [`${markerName} SAYS PAID`, "CONFIRM", chip(BC.amber, ON_AMBER)],
    waiting:  [`WAITING ON ${otherName}`, "UNDO", chip("transparent", BC.t3, `1px solid ${BC.bdr}`)],
    settled:  ["SETTLED ✓", "REOPEN", chip("transparent", BC.t3, `1px solid ${BC.bdr}`)],
    // Not your bet. You are told where it got to and asked for nothing —
    // including, when one side has claimed it, WHO claimed it, because that
    // is the half of the record an onlooker might be asked to remember.
    watching: [markerName ? `${markerName} SAYS PAID` : "", null, null],
  }[state] || ["", null, null];

  const showButton = canAct && !!label;
  if (!status && !showButton) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7 }}>
      <span style={{
        flex: 1, minWidth: 0, fontSize: FS.micro, fontWeight: 700, letterSpacing: 0.5,
        color: state === "settled" ? BC.green : BC.t3,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {status}
      </span>
      {showButton && (
        <button type="button" disabled={busy} onClick={onToggle} style={style}>
          {busy ? "…" : label}
        </button>
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
  // Alphabetical, not roster order. The roster is ordered by team and then by
  // whenever the director typed somebody in, which is an order nobody picking
  // a name off a list can predict — so finding a player meant reading all
  // sixteen. `localeCompare` rather than `<` so accented names sort where a
  // person would look for them.
  const byName = useMemo(
    () => [...players].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))),
    [players],
  );
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
    setErr(null);
    try {
      await onSave({ playerA, playerB, amount, detail });
    } catch (e) {
      // A REFUSED WRITE HAS TO SAY SO. The save deliberately keeps the sheet
      // open on a failure so the typing is not lost — but without this the
      // only thing that happened on screen was the button flickering back
      // from "Saving…", which reads as a dead button and not as a refusal.
      // A ledger that appears to accept a bet it never recorded is the one
      // failure this screen must not have, and a silent no-op is a quieter
      // version of exactly that.
      console.error("side bet save", e);
      setErr(e?.code === "permission-denied"
        ? "Couldn't save — this account can't write to this tournament."
        : "Couldn't save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const label = (t) => (
    <div style={{ fontSize: FS.label, color: BC.t3, fontWeight: 700, letterSpacing: 1, marginBottom: 5 }}>{t}</div>
  );
  // FS.lead, and it is not a style choice — see the note under the scale in
  // theme.js. A form control below 16px makes iOS Safari zoom the page on
  // focus and never zoom back out, so tapping the player picker left the
  // whole app enlarged. Condense these with padding if they ever need to be
  // shorter, never by dropping a rung.
  const field = {
    width: "100%", boxSizing: "border-box", fontFamily: FONT, fontSize: FS.lead,
    padding: "9px 10px", borderRadius: 8, border: `1px solid ${BC.bdr}`,
    background: BC.bg, color: BC.t1, outline: "none",
  };

  const picker = (value, onChange, exclude) => (
    <select value={value} onChange={e => { setErr(null); onChange(e.target.value); }} style={field}>
      <option value="">Select a player…</option>
      {byName.filter(p => p.player_id !== exclude).map(p => (
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
