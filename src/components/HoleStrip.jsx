// ══════════════════════════════════════════════════════════════════
//  Hole strip — one hole, one cell.
// ══════════════════════════════════════════════════════════════════
//  18 cells, one per hole, coloured by who took it. A visible gap splits
//  the front from the back so "thru 12" is readable without counting.
//
//  What a cell looks like is decided by lib/holeFill — shared with the
//  Scoring tab's status bar, which lays its cells out differently but
//  speaks the same colour vocabulary. `format` is the one holeFill wants:
//  the format the holes were SCORED under, not the round's own.

import { BC, FS } from "../theme";
import { holeFill } from "../lib/holeFill";

// Cell height, one value for every format.
//
// Sized for the hardest thing a cell has to say: a Double Dot hole split
// between the two sides, which is a diagonal and needs enough vertical room
// to read as one. A cell is ~17px wide on a phone, so this lands it near
// square and the seam is unmistakable. Every other format only ever fills a
// cell solid, and would be legible at any height — but a strip that changed
// height with the round would make two rounds of the same board incomparable
// at a glance, which costs more than the few pixels this spends.
const CELL_H = 14;

export function HoleStrip({ holes, format, showNumbers = false, settled = true }) {
  const cell = (h, i) => (
    <div key={i} style={{
      flex: 1, minWidth: 0, height: CELL_H, borderRadius: 3,
      boxSizing: "border-box", ...holeFill(h, format, settled),
    }} />
  );
  const nums = (start, end) => (
    <div style={{ display: "flex", gap: 1.5, flex: 1, minWidth: 0 }}>
      {holes.slice(start, end).map((_, i) => (
        <div key={i} style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: FS.micro, color: BC.t3, fontWeight: 700 }}>
          {start + i + 1}
        </div>
      ))}
    </div>
  );

  return (
    <div>
      {showNumbers && (
        <div style={{ display: "flex", gap: 8, marginBottom: 2 }}>
          {nums(0, 9)}{nums(9, 18)}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ display: "flex", gap: 1.5, flex: 1, minWidth: 0 }}>{holes.slice(0, 9).map(cell)}</div>
        <div style={{ display: "flex", gap: 1.5, flex: 1, minWidth: 0 }}>{holes.slice(9, 18).map(cell)}</div>
      </div>
    </div>
  );
}

export default HoleStrip;
