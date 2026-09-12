// ══════════════════════════════════════════════════════════════════
//  TeamBestBallScoreboard — Round 4's points-per-hole tally.
// ══════════════════════════════════════════════════════════════════
//
//  Round 4 has no man-to-man matches — the whole side plays as one team
//  (see constants.js FORMATS' `team_best_ball`, `perSide: null`), so the
//  usual per-match "who's up" reading doesn't apply. What the field
//  actually wants off this round is the old scoring sheet's own view,
//  found in the 2024 spreadsheet's "SCOREBOARD" tab: hole numbers down
//  the middle, each team's NET score relative to par flanking it, and
//  each team's POINTS for that hole outside of that — with a total at
//  the bottom.
//
//  Nothing here is computed independently of the engine. `result` is the
//  same computeMatchResult() output every other card on this board reads;
//  this component only reads two numbers per hole that the engine already
//  treats as canonical (`aScore`/`bScore`, `winner`) and derives the two
//  presentational figures the sheet showed that computeMatchResult has no
//  reason to expose on its own:
//
//    net-to-par   a side's summed net strokes minus (par × how many of its
//                 players' nets counted) — `counted.<side>.length` IS that
//                 count, already on the hole result, so nothing is re-derived
//                 about who contributed, only "how many pars is that against".
//    points       the same win-takes-the-pot, tie-splits-it-in-half rule
//                 computeMatchResult already applies once per NINE (see its
//                 frontPts/backPts accumulation) — read out per HOLE instead.
//
//  Highlighting the hole's winner reuses the app's own existing language
//  for "this side took it" (see FullScorecard's SideRow: a team-colored
//  border and a light team-colored wash around the cell, never a solid
//  fill) rather than inventing a new one — team colors are director-
//  branded and arbitrary, so a solid fill would need its own contrast
//  logic this app has never needed before. A small triangle beside the
//  hole number, pointing at whichever side won, is the one new mark.
import { BC, FONT, ALPHA, FS, teamColor } from "../theme";
import { fmtScore, fmtPts } from "../scoring";

// A hole's point pot — front nine and back nine can be priced differently
// (the old sheet's "1 Pt/Hole Front, 2 Pt/Hole Back"), so which nine a hole
// falls in decides its pot, not a flat per-hole value.
const potFor = (holePoints, h) => (h < 9 ? holePoints?.front : holePoints?.back) || 0;

// The cell for one side's number on one hole — plain in its team's color
// when it didn't win, wrapped in that same color's tint+border when it did.
// `won` is already resolved by the caller (it differs for the net cell vs
// the points cell only in that a 0-value points pot is never highlighted).
function Cell({ value, won, side, align }) {
  const col = teamColor(side);
  if (value == null) {
    return <span style={{ fontSize: FS.small, color: `${BC.t3}${ALPHA.hair}`, minWidth: 30, textAlign: align, display: "inline-block" }}>·</span>;
  }
  const digit = (
    <span style={{ fontSize: FS.small, fontWeight: 800, color: col }}>{value}</span>
  );
  if (!won) {
    return <span style={{ minWidth: 30, textAlign: align, display: "inline-block" }}>{digit}</span>;
  }
  return (
    <span style={{
      minWidth: 30, textAlign: align, display: "inline-flex", justifyContent: "center",
      padding: "1px 6px", borderRadius: 5,
      border: `1.5px solid ${col}`, background: `${col}${ALPHA.tint}`,
    }}>
      {digit}
    </span>
  );
}

// The hole-number column, with a triangle riding beside it pointing at
// whichever side won — pure reinforcement of the highlighted cells either
// side, not a second source of truth. Both slots are always reserved so the
// hole numbers stay in one straight column whether or not either fires.
function HoleMark({ h, winner }) {
  const col = winner ? teamColor(winner) : null;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, flexShrink: 0 }}>
      <span style={{ width: 10, textAlign: "center", fontSize: FS.micro, color: col || "transparent" }}>
        {winner === "A" ? "◀" : ""}
      </span>
      <span style={{ fontSize: FS.small, fontWeight: 700, color: BC.t2, width: 16, textAlign: "center" }}>{h + 1}</span>
      <span style={{ width: 10, textAlign: "center", fontSize: FS.micro, color: col || "transparent" }}>
        {winner === "B" ? "▶" : ""}
      </span>
    </div>
  );
}

// One nine's worth of rows — a pure rendering slice, so the 1-9/10-18 gap
// the old sheet drew is just two calls of this rather than a branch inside
// a single 18-row loop.
function NineBlock({ start, result, holePars }) {
  const rows = Array.from({ length: 9 }, (_, i) => start + i);
  return (
    <div>
      {rows.map((h) => {
        const hr = result.holes[h];
        const played = !!hr?.played && hr.aScore != null && hr.bScore != null;
        const pot = potFor(result.holePoints, h);
        const need = (side) => hr?.counted?.[side]?.length || 0;
        const netToPar = (side) => {
          if (!played) return null;
          const score = side === "A" ? hr.aScore : hr.bScore;
          return fmtScore(score - holePars[h] * need(side));
        };
        const pointsFor = (side) => {
          if (!played || !pot) return played ? 0 : null;
          if (hr.winner === side) return pot;
          if (hr.winner) return 0;
          return pot / 2;
        };
        const wonNet = (side) => played && hr.winner === side;
        const wonPts = (side) => wonNet(side) && pot > 0;
        return (
          <div key={h} style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            padding: "5px 0", borderBottom: `1px solid ${BC.bdr}${ALPHA.hair}`,
          }}>
            <Cell value={pointsFor("A") == null ? null : fmtPts(pointsFor("A"))} won={wonPts("A")} side="A" align="right" />
            <Cell value={netToPar("A")} won={wonNet("A")} side="A" align="right" />
            <HoleMark h={h} winner={played ? hr.winner : null} />
            <Cell value={netToPar("B")} won={wonNet("B")} side="B" align="left" />
            <Cell value={pointsFor("B") == null ? null : fmtPts(pointsFor("B"))} won={wonPts("B")} side="B" align="left" />
          </div>
        );
      })}
    </div>
  );
}

// `holePars` is the round's 18 pars (same shape MatchCard already resolves
// for FullScorecard via getRoundCourseCtx) — passed in rather than re-derived,
// so this can never disagree with the card it sits inside.
export function TeamBestBallScoreboard({ result, holePars }) {
  const ptsA = result.totalPts.A, ptsB = result.totalPts.B;
  return (
    <div style={{ fontFamily: FONT }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 4 }}>
        <span style={{ width: 30, textAlign: "right", fontSize: FS.micro, fontWeight: 700, color: BC.t3 }}>PTS</span>
        <span style={{ width: 30, textAlign: "right", fontSize: FS.micro, fontWeight: 700, color: BC.t3 }}>NET</span>
        <span style={{ width: 34, textAlign: "center", fontSize: FS.micro, fontWeight: 700, color: BC.t3 }}>HOLE</span>
        <span style={{ width: 30, textAlign: "left", fontSize: FS.micro, fontWeight: 700, color: BC.t3 }}>NET</span>
        <span style={{ width: 30, textAlign: "left", fontSize: FS.micro, fontWeight: 700, color: BC.t3 }}>PTS</span>
      </div>
      <NineBlock start={0} result={result} holePars={holePars} />
      {/* The one gap in the middle — nothing else marks the turn, same as
          the sheet this is modeled on. */}
      <div style={{ height: 10 }} />
      <NineBlock start={9} result={result} holePars={holePars} />
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
        marginTop: 8, paddingTop: 8, borderTop: `1px solid ${BC.bdr}`,
      }}>
        <span style={{ width: 30, textAlign: "right", fontSize: FS.body, fontWeight: 800, color: teamColor("A") }}>{fmtPts(ptsA)}</span>
        <span style={{ width: 30 }} />
        <span style={{ width: 34, textAlign: "center", fontSize: FS.micro, fontWeight: 800, letterSpacing: 0.5, color: BC.t3 }}>TOTAL</span>
        <span style={{ width: 30 }} />
        <span style={{ width: 30, textAlign: "left", fontSize: FS.body, fontWeight: 800, color: teamColor("B") }}>{fmtPts(ptsB)}</span>
      </div>
    </div>
  );
}
