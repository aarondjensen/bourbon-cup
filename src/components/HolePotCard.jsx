// ══════════════════════════════════════════════════════════════════
//  HolePotCard — one round's table for the designated hole
// ══════════════════════════════════════════════════════════════════
//
//  The fourth side game, and the smallest: one hole a round — Hole 18 here —
//  played for a pot of its own. Lowest NET takes it.
//
//    AJ   4  −1   3   ← gross, the stroke he gets there, net
//    BK   3   —   3
//
//  A TIE SPLITS. That is the whole difference between this and a skin on the
//  same hole: a skin pushes and carries, and this has nowhere to carry to, so
//  two men on net 3 take half the round's share each. Which means the winning
//  row here is often more than one row, and the card has to say so out loud
//  rather than leaving somebody to count the highlights — hence the strip
//  under the header.
//
//  A PLAYER WITH NO SCORE has not lost the hole, he has not played it. He
//  ranks below every card that is in and prints a dash, because a blank in a
//  net column reads as a number somebody could be beaten by. While anyone is
//  still out there the result is provisional, and the header says that too:
//  unlike low net, where a finished card is finished, one hole can be taken
//  by the last group of the day.

import { BC, FONT, ALPHA, FS, ON_AMBER, teamColor } from "../theme";

export function HolePotCard({ rows, hole, share }) {
  if (rows.length === 0) {
    return (
      <div style={{ background: BC.card, borderRadius: 8, border: `1px solid ${BC.bdr}`, padding: "14px 12px", fontSize: FS.small, color: BC.t3, textAlign: "center", fontFamily: FONT }}>
        Nobody is in the hole {hole} game yet.
      </div>
    );
  }

  const winners = rows.filter(r => r.won);
  const posted = rows.filter(r => r.posted).length;
  const out = rows.length - posted;

  const head = (label, w) => (
    <div style={{ width: w, flexShrink: 0, textAlign: "center", fontSize: FS.micro, fontWeight: 800, letterSpacing: 0.6, color: BC.t3 }}>{label}</div>
  );

  return (
    <div style={{ background: BC.card, border: `1px solid ${BC.bdr}`, borderRadius: 8, overflow: "hidden", fontFamily: FONT }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderBottom: `1px solid ${BC.bdr}` }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: FS.micro, fontWeight: 800, letterSpacing: 0.6, color: BC.t3 }}>HOLE {hole}</div>
        {head("GROSS", 42)}
        {head("STK", 30)}
        {head("NET", 38)}
      </div>

      {/* Who is taking it and for how much. A tie is the ordinary case here,
          not an edge one, so the split is stated rather than implied by two
          highlighted rows — and while anybody is still out on the course it
          says that instead, because the answer can still change. */}
      <div style={{ padding: "6px 12px", borderBottom: `1px solid ${BC.bdr}${ALPHA.hair}`, fontSize: FS.label, fontWeight: 700, color: winners.length ? BC.amberInk : BC.t3, letterSpacing: 0.4 }}>
        {winners.length === 0
          ? "Nobody has posted this hole yet."
          : `${winners.map(w => w.name).join(" · ")} — net ${winners[0].net}`
            + (winners.length > 1 ? ` · ${winners.length}-way split` : "")
            + (share > 0 ? ` · $${(share / winners.length).toFixed(2)} each` : "")}
        {out > 0 && winners.length > 0 && (
          <span style={{ color: BC.t3, fontWeight: 600 }}>{` · ${out} still to play it`}</span>
        )}
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
          <span style={{ flex: 1, minWidth: 0, fontSize: FS.small, fontWeight: 600, color: r.posted ? BC.t1 : BC.t3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.name}
          </span>

          {r.posted ? (
            <>
              <div style={{ width: 42, flexShrink: 0, textAlign: "center", fontSize: FS.small, fontWeight: 700, color: BC.t2 }}>{r.gross}</div>
              {/* The shot he gets on THIS hole, not his handicap — a course
                  handicap in this column would read as a number coming off
                  the one beside it, and on one hole it does not. */}
              <div style={{ width: 30, flexShrink: 0, textAlign: "center", fontSize: FS.small, fontWeight: 700, color: r.strokes ? BC.hcpBlue : BC.t3 }}>
                {r.strokes ? `−${r.strokes}` : "—"}
              </div>
              <div style={{
                width: 38, flexShrink: 0, textAlign: "center", fontSize: FS.small, fontWeight: 800,
                color: r.won ? ON_AMBER : BC.t1,
                background: r.won ? BC.amber : "transparent",
                borderRadius: 4, padding: "1px 0",
              }}>{r.net}</div>
            </>
          ) : (
            <div style={{ width: 110, flexShrink: 0, textAlign: "right", fontSize: FS.label, fontWeight: 700, color: BC.t3 }}>
              not played
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
