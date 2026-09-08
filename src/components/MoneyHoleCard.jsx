// ══════════════════════════════════════════════════════════════════
//  MoneyHoleCard — one round's table for the money hole
// ══════════════════════════════════════════════════════════════════
//
//  The fourth side game, and the smallest: one hole a round — Hole 18 here —
//  played for a pot of its own. Lowest NET takes it.
//
//    AJ (12)   4   3   ← the round's handicap, gross, net
//    BK  (4)    3   3
//
//  THE HANDICAP SITS WITH THE NAME, in parentheses and in the scorecard's
//  blue, which is where every other card in the app puts it. It is the whole
//  round's course handicap, not the stroke this one hole gives: the hole's
//  stroke was a column of its own headed STK, then a dot beside the gross,
//  and both were a second thing to read for a number that only ever explains
//  ONE row's arithmetic. The handicap explains the man, and the gap between
//  the two columns beside him is the hole.
//
//  A TIE SPLITS. That is the whole difference between this and a skin on the
//  same hole: a skin pushes and carries, and this has nowhere to carry to, so
//  two men on net 3 take half the round's share each — which is why more than
//  one row is highlighted here more often than not.
//
//  WHAT IT PAYS IS NOT ON THIS CARD. The pot card at the top of the tab holds
//  the pot, the round's share and how many rounds are decided; a strip here
//  naming the winners, their net and their money was the same three facts a
//  thumb's width lower, and the highlighted rows underneath said the first two
//  a third time.
//
//  A PLAYER WITH NO SCORE has not lost the hole, he has not played it. He
//  ranks below every card that is in and says "not played", because a blank in
//  a net column reads as a number somebody could be beaten by — and it is his
//  own row that has to say so, since unlike low net, where a finished card is
//  finished, one hole can still be taken by the last group of the day.

import { BC, FONT, ALPHA, FS, ON_AMBER, teamColor } from "../theme";

// The two number columns, named because three places have to agree on them —
// the header, the row, and the width the "not played" line spans.
const GROSS_W = 42;
const NET_W = 38;

export function MoneyHoleCard({ rows, hole, par, index }) {
  if (rows.length === 0) {
    return (
      <div style={{ background: BC.card, borderRadius: 8, border: `1px solid ${BC.bdr}`, padding: "14px 12px", fontSize: FS.small, color: BC.t3, textAlign: "center", fontFamily: FONT }}>
        Nobody is in the money hole yet.
      </div>
    );
  }

  const head = (label, w) => (
    <div style={{ width: w, flexShrink: 0, textAlign: "center", fontSize: FS.micro, fontWeight: 800, letterSpacing: 0.6, color: BC.t3 }}>{label}</div>
  );

  return (
    <div style={{ background: BC.card, border: `1px solid ${BC.bdr}`, borderRadius: 8, overflow: "hidden", fontFamily: FONT }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderBottom: `1px solid ${BC.bdr}` }}>
        {/* PAR is what makes a 4 a good hole or a poor one, and INDEX is
            what explains the dots in the column below — both were on the
            course's scorecard and nowhere on this card, so a man reading it
            had to leave the tab to know whether he had a shot coming. Each
            is dropped rather than guessed at when the round has no course
            yet: an em dash here would read as par nothing. */}
        <div style={{ flex: 1, minWidth: 0, fontSize: FS.micro, fontWeight: 800, letterSpacing: 0.6, color: BC.t3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          HOLE {hole}{par ? ` · PAR ${par}` : ""}{index ? ` · INDEX ${index}` : ""}
        </div>
        {head("GROSS", GROSS_W)}
        {head("NET", NET_W)}
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
          {/* The handicap is its own span, outside the ellipsis, so a long
              name is what gets truncated rather than the number explaining
              the two columns to its right. */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 4 }}>
            <span style={{ minWidth: 0, fontSize: FS.small, fontWeight: 600, color: r.posted ? BC.t1 : BC.t3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.name}
            </span>
            {r.ch != null && (
              <span style={{ flexShrink: 0, fontSize: FS.micro, fontWeight: 700, color: BC.hcpBlue }}>({r.ch})</span>
            )}
          </div>

          {r.posted ? (
            <>
              <div style={{ width: GROSS_W, flexShrink: 0, textAlign: "center", fontSize: FS.small, fontWeight: 700, color: BC.t2 }}>{r.gross}</div>
              <div style={{
                width: NET_W, flexShrink: 0, textAlign: "center", fontSize: FS.small, fontWeight: 800,
                color: r.won ? ON_AMBER : BC.t1,
                background: r.won ? BC.amber : "transparent",
                borderRadius: 4, padding: "1px 0",
              }}>{r.net}</div>
            </>
          ) : (
            <div style={{ width: GROSS_W + NET_W + 8, flexShrink: 0, textAlign: "right", fontSize: FS.label, fontWeight: 700, color: BC.t3 }}>
              not played
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
