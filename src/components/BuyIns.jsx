// ══════════════════════════════════════════════════════════════════
//  BuyInEditor — who is in a side game, and for how much
// ══════════════════════════════════════════════════════════════════
//
//  Skins and CTP are separate games with separate money, so a player is in
//  one, the other, both or neither. The director tags that here; everything
//  else follows from it — who can win a hole, who appears on the leaderboard,
//  and what the pot is worth.
//
//  THE THREE STATES OF `ids`, which is the whole design:
//
//    null   — never configured. EVERYBODY is in. This is what every
//             tournament played before buy-ins existed looks like, and it is
//             why the feature is inert until a director opens this panel.
//    [...]  — exactly these players.
//    []     — nobody. A real, sayable answer, and the reason a missing field
//             and an empty array must not be collapsed into each other.
//
//  The first toggle materialises `null` into the full roster minus one, so
//  turning a single player off can never be read back as "the list is empty,
//  therefore everybody is in" — which would silently put the player straight
//  back into the game they were just removed from.

import { useState } from "react";
import { BC, FONT, ALPHA, FS, ON_AMBER, teamColor } from "../theme";

export function BuyInEditor({ players, amount, ids, onChange }) {
  // Local while typing; committed on blur, like the pot field. Seeded from
  // the live value each time the panel mounts, which is each time it opens.
  const [amt, setAmt] = useState(amount ? String(amount) : "");

  const list = ids ?? players.map(p => p.player_id);
  const inSet = new Set(list);

  const toggle = (pid) => {
    const next = inSet.has(pid) ? list.filter(x => x !== pid) : [...list, pid];
    onChange({ ids: next });
  };

  const commitAmount = () => {
    const v = parseFloat(amt);
    onChange({ amount: Number.isFinite(v) && v > 0 ? v : 0 });
  };

  const btn = (on) => ({
    fontSize: FS.label, fontWeight: 800, letterSpacing: 0.5,
    padding: "4px 10px", borderRadius: 6, cursor: "pointer",
    border: `1px solid ${on ? "transparent" : BC.bdr}`,
    background: on ? BC.amber : "transparent",
    color: on ? ON_AMBER : BC.t3,
    fontFamily: FONT, flexShrink: 0,
  });

  return (
    <div style={{ background: BC.card, border: `1px solid ${BC.amber}${ALPHA.line}`, borderRadius: 8, marginBottom: 8, overflow: "hidden", fontFamily: FONT }}>

      {/* What one seat costs. Zero means the pot is not being counted from
          buy-ins at all, and whatever was typed into the pot stands. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${BC.bdr}` }}>
        <span style={{ fontSize: FS.label, fontWeight: 800, color: BC.t3, letterSpacing: 0.8 }}>BUY-IN</span>
        <span style={{ fontSize: FS.body, fontWeight: 800, color: BC.gold }}>$</span>
        <input
          type="number" inputMode="decimal" value={amt} placeholder="0"
          onChange={e => setAmt(e.target.value)}
          onBlur={commitAmount}
          onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
          style={{
            width: 70, fontSize: FS.body, fontWeight: 800, color: BC.gold,
            background: "transparent", border: "none", borderBottom: `1px solid ${BC.amber}`,
            outline: "none", fontFamily: FONT,
          }}
        />
        <span style={{ flex: 1, fontSize: FS.small, color: BC.t3, textAlign: "right" }}>
          {list.length} in · ${(list.length * (parseFloat(amt) || 0)).toFixed(2)}
        </span>
      </div>

      {/* Bulk, because tagging sixteen people one at a time is the actual
          job on a Friday morning. */}
      <div style={{ display: "flex", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${BC.bdr}${ALPHA.hair}` }}>
        <button type="button" onClick={() => onChange({ ids: players.map(p => p.player_id) })} style={btn(false)}>ALL IN</button>
        <button type="button" onClick={() => onChange({ ids: [] })} style={btn(false)}>NONE</button>
      </div>

      {players.map(p => {
        const on = inSet.has(p.player_id);
        return (
          <button
            key={p.player_id}
            type="button"
            role="switch"
            aria-checked={on}
            onClick={() => toggle(p.player_id)}
            style={{
              display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
              padding: "7px 12px", borderBottom: `1px solid ${BC.bdr}${ALPHA.hair}`,
              width: "100%", textAlign: "left", background: "transparent",
              border: "none", borderRadius: 0, fontFamily: FONT,
            }}
          >
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: teamColor(p.team), flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, fontSize: FS.small, fontWeight: 600, color: on ? BC.t1 : BC.t3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {p.name}
            </span>
            <span style={btn(on)}>{on ? "IN" : "OUT"}</span>
          </button>
        );
      })}
    </div>
  );
}
