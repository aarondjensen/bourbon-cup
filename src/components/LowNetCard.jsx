// ══════════════════════════════════════════════════════════════════
//  LowNetCard — one round's low-net table
// ══════════════════════════════════════════════════════════════════
//
//  The third side game. Where skins are decided hole by hole and CTP on a
//  single swing, low net is decided by the whole card: gross for eighteen,
//  less the course handicap the round was played off, lowest wins.
//
//    AJ   72  −12   60   ← gross, CH, net
//    BK   78   −8   70
//
//  ONLY A FINISHED CARD CAN WIN. A player through fourteen holes is not
//  leading on net, they are unfinished — and a table that ranked them would
//  put whoever had played least at the top all afternoon. Incomplete cards
//  still show, below the finished ones, with what they are through, because
//  during a round that is the interesting part.
//
//  A TIE IS A SPLIT, not a push. Skins push because the hole carries no
//  further; low net has nowhere to carry to, so equal lowest cards are
//  co-winners and the round's share divides between them.

import { BC, FONT, ALPHA, FS, ON_AMBER, teamColor } from "../theme";

export function LowNetCard({ rows }) {
  if (rows.length === 0) {
    return (
      <div style={{ background: BC.card, borderRadius: 8, border: `1px solid ${BC.bdr}`, padding: "14px 12px", fontSize: FS.small, color: BC.t3, textAlign: "center", fontFamily: FONT }}>
        Nobody is in the low-net game yet.
      </div>
    );
  }

  const head = (label, w, align = "center") => (
    <div style={{ width: w, flexShrink: 0, textAlign: align, fontSize: FS.micro, fontWeight: 800, letterSpacing: 0.6, color: BC.t3 }}>{label}</div>
  );

  return (
    <div style={{ background: BC.card, border: `1px solid ${BC.bdr}`, borderRadius: 8, overflow: "hidden", fontFamily: FONT }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderBottom: `1px solid ${BC.bdr}` }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: FS.micro, fontWeight: 800, letterSpacing: 0.6, color: BC.t3 }}>PLAYER</div>
        {head("GROSS", 42)}
        {head("CH", 30)}
        {head("NET", 38)}
      </div>

      {rows.map(r => (
        <div
          key={r.pid}
          style={{
            display: "flex", alignItems: "center", gap: 8, padding: "7px 12px",
            borderBottom: `1px solid ${BC.bdr}${ALPHA.hair}`,
            background: r.won ? `${BC.amber}${ALPHA.wash}` : "transparent",
          }}
        >
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: teamColor(r.team), flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: FS.small, fontWeight: 600, color: r.complete ? BC.t1 : BC.t3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.name}
          </span>

          {/* An unfinished card prints what it is through instead of a total
              it does not have yet — the three number columns would otherwise
              read as a real score somebody could be beaten by. */}
          {r.complete ? (
            <>
              <div style={{ width: 42, flexShrink: 0, textAlign: "center", fontSize: FS.small, fontWeight: 700, color: BC.t2 }}>{r.gross}</div>
              <div style={{ width: 30, flexShrink: 0, textAlign: "center", fontSize: FS.small, fontWeight: 700, color: BC.hcpBlue }}>{r.ch}</div>
              <div style={{
                width: 38, flexShrink: 0, textAlign: "center", fontSize: FS.small, fontWeight: 800,
                color: r.won ? ON_AMBER : BC.t1,
                background: r.won ? BC.amber : "transparent",
                borderRadius: 4, padding: "1px 0",
              }}>{r.net}</div>
            </>
          ) : (
            <div style={{ width: 110, flexShrink: 0, textAlign: "right", fontSize: FS.label, fontWeight: 700, color: BC.t3 }}>
              {r.thru > 0 ? `thru ${r.thru}` : "—"}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
