// ══════════════════════════════════════════════════════════════════
//  CtpPrompt — the closest-to-the-pin tag popup.
// ══════════════════════════════════════════════════════════════════
//
//  Ported from MNQ (src/pages/Scoring.jsx, the `holeCtpPrompt` block).
//  The workflow it implements:
//
//    Every group that finishes a par 3 gets this popup on the device
//    that entered the last score for the hole. It shows the CTP that is
//    currently standing — tagged by an earlier group — so the group can
//    see the number they have to beat, then either
//      • tag one of their OWN four players at a measured distance, which
//        replaces the standing tag, or
//      • dismiss with "our group wasn't closer" and leave it alone.
//
//  Player-entered tags are provisional (`approved: false` on the record);
//  the director's Betting → CTP grid is the approval step, and an
//  approved hole stops prompting. Nothing here decides who wins — the
//  group with the tape measure does, and this is the form they fill in.
//
//  Distance is a scroll wheel rather than a text field on purpose: it is
//  entered standing on a green, one-handed, and a wheel never opens a
//  keyboard over the card.
// ══════════════════════════════════════════════════════════════════

import { useState } from "react";
import { Popup } from "./Popup";
import { BC, ALPHA, ON_AMBER, FS } from "../theme";

// Wheel geometry. WHEEL_H must leave a whole number of item slots above
// and below the selection band, hence the (WHEEL_H - WHEEL_ITEM) / 2
// padding on the scroller.
const WHEEL_ITEM = 36;
const WHEEL_H = 150;
const MAX_FT = 60;

const clampFeet = (ft) => Math.max(1, Math.min(MAX_FT, Math.round(ft) || 0)) || 10;

export function CtpPrompt({ holeNumber, players, teams, leader, leaderName, onSave, onClose }) {
  const [pid, setPid] = useState("");
  const [feet, setFeet] = useState(() => (leader?.distance_ft ? clampFeet(leader.distance_ft) : 10));
  const [saving, setSaving] = useState(false);

  // Seed the wheel's scroll position exactly once, when the scroller
  // mounts. A useEffect would fight the user's own scrolling on every
  // re-render; the dataset flag makes it a one-shot.
  const wheelRef = (el) => {
    if (el && !el.dataset.init) {
      el.dataset.init = "1";
      el.scrollTop = (feet - 1) * WHEEL_ITEM;
    }
  };
  const onWheelScroll = (e) => {
    const v = Math.max(1, Math.min(MAX_FT, Math.round(e.currentTarget.scrollTop / WHEEL_ITEM) + 1));
    setFeet(prev => (prev === v ? prev : v));
  };

  const leaderDist = leader?.distance_ft ? `${leader.distance_ft} ft` : "";

  const save = async () => {
    if (!pid || saving) return;
    setSaving(true);
    await onSave(pid, feet);
  };

  return (
    <Popup onClose={onClose} maxWidth={360} padding={20} portal>
      <div style={{ fontSize: FS.label, fontWeight: 800, color: BC.amber, letterSpacing: 1.5, marginBottom: 6, textAlign: "center" }}>
        Hole {holeNumber} · Par 3
      </div>
      <div style={{ fontSize: FS.lead, fontWeight: 800, color: BC.t1, letterSpacing: 1.2, marginBottom: 14, textAlign: "center" }}>
        Closest to the Pin
      </div>

      {/* Standing tag — the number to beat. Absent on the first group
          through, which is why the heading below changes with it. */}
      {leader?.player_id && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
          background: BC.amberGlow, border: `1px solid ${BC.amber}${ALPHA.line}`, borderRadius: 10, padding: "8px 10px",
        }}>
          <span style={{ fontSize: FS.lead }}>🎯</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: FS.label, fontWeight: 800, color: BC.gold, letterSpacing: 1.4 }}>
              {leader.approved ? "CTP — Final" : "Current CTP"}
            </span>
            <span style={{ display: "block", fontSize: FS.body, fontWeight: 700, color: BC.t1, letterSpacing: 0.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {leaderName || "—"}
            </span>
          </span>
          {leaderDist && <span style={{ fontSize: FS.body, fontWeight: 800, color: BC.amber, flexShrink: 0 }}>{leaderDist}</span>}
        </div>
      )}

      <div style={{ fontSize: FS.label, fontWeight: 800, color: BC.t3, letterSpacing: 1.4, marginBottom: 6 }}>
        {leader?.player_id ? "Who was closer?" : "Who was closest?"}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 14 }}>
        {players.map(p => {
          const sel = pid === p.player_id;
          const accent = teams?.[p.team]?.accent || BC.amber;
          return (
            <button
              key={p.player_id}
              onClick={() => setPid(sel ? "" : p.player_id)}
              style={{
                display: "flex", alignItems: "center", gap: 5, padding: "11px 8px", borderRadius: 10,
                background: sel ? BC.amberGlow : BC.inp,
                border: `1px solid ${sel ? BC.amber : BC.bdr}`,
                color: sel ? BC.amber : BC.t2,
                fontSize: FS.small, fontWeight: 700, letterSpacing: 0.4, cursor: "pointer", textAlign: "left",
              }}
            >
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: accent, flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.name || p.player_id}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: FS.label, fontWeight: 800, color: BC.t3, letterSpacing: 1.4, marginBottom: 6 }}>Approx. distance</div>
      <div style={{ position: "relative", height: WHEEL_H, background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
        {/* Selection band + unit label, both click-through so the wheel
            underneath still takes the drag. */}
        <div style={{
          position: "absolute", left: 10, right: 10, top: "50%", height: WHEEL_ITEM + 2,
          transform: "translateY(-50%)", borderTop: `1.5px solid ${BC.amber}`, borderBottom: `1.5px solid ${BC.amber}`,
          borderRadius: 4, background: BC.amberGlow, pointerEvents: "none", zIndex: 2,
        }} />
        <div style={{
          position: "absolute", right: 46, top: "50%", transform: "translateY(-50%)",
          fontSize: FS.small, fontWeight: 800, color: BC.amber, letterSpacing: 1.2, pointerEvents: "none", zIndex: 2,
        }}>FT</div>
        <div
          ref={wheelRef}
          onScroll={onWheelScroll}
          style={{
            height: "100%", overflowY: "scroll", scrollSnapType: "y mandatory",
            padding: `${(WHEEL_H - WHEEL_ITEM) / 2}px 0`,
            WebkitOverflowScrolling: "touch", scrollbarWidth: "none",
          }}
        >
          {Array.from({ length: MAX_FT }, (_, i) => i + 1).map(ft => (
            <div key={ft} style={{
              height: WHEEL_ITEM, lineHeight: `${WHEEL_ITEM}px`, textAlign: "center",
              fontSize: ft === feet ? FS.title : FS.lead, fontWeight: ft === feet ? 800 : 700,
              color: ft === feet ? BC.t1 : BC.t3, scrollSnapAlign: "center",
            }}>{ft}</div>
          ))}
        </div>
        {/* Edge fades — sell the strip as a physical dial. */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 46, background: `linear-gradient(${BC.inp}, transparent)`, pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 46, background: `linear-gradient(transparent, ${BC.inp})`, pointerEvents: "none" }} />
      </div>

      <button
        onClick={save}
        disabled={!pid || saving}
        style={{
          width: "100%", padding: 13, borderRadius: 10,
          background: pid ? BC.amber : BC.inp,
          border: pid ? "none" : `1px solid ${BC.bdr}`,
          color: pid ? ON_AMBER : BC.t3,
          fontSize: FS.body, fontWeight: 800, letterSpacing: 0.8,
          cursor: pid && !saving ? "pointer" : "default",
          opacity: saving ? 0.7 : 1,
        }}
      >
        {leader?.player_id ? "Tag New CTP" : "Tag CTP"}
      </button>
      <button
        onClick={onClose}
        style={{
          width: "100%", marginTop: 7, padding: 13, borderRadius: 10,
          background: BC.inp, border: `1px solid ${BC.bdr}`, color: BC.t2,
          fontSize: FS.small, fontWeight: 700, letterSpacing: 0.8, cursor: "pointer",
        }}
      >
        {leader?.player_id ? "Our group wasn't closer" : "Nobody hit the green"}
      </button>
    </Popup>
  );
}
