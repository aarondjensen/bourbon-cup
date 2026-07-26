// ══════════════════════════════════════════════════════════════════
//  Hole strip — one hole, one cell.
// ══════════════════════════════════════════════════════════════════
//  18 cells, one per hole, coloured by who took it. A visible gap splits
//  the front from the back so "thru 12" is readable without counting.
//
//  What a cell looks like is decided by lib/holeFill — shared with the
//  Scoring tab's status bar, which lays its cells out differently but
//  speaks the same colour vocabulary.

import { BC } from "../theme";
import { holeFill } from "../lib/holeFill";

export function HoleStrip({ holes, format, showNumbers = false, settled = true }) {
  const cell = (h, i) => (
    <div key={i} style={{
      flex: 1, minWidth: 0, height: 9, borderRadius: 2,
      boxSizing: "border-box", ...holeFill(h, format, settled),
    }} />
  );
  const nums = (start, end) => (
    <div style={{ display: "flex", gap: 1.5, flex: 1, minWidth: 0 }}>
      {holes.slice(start, end).map((_, i) => (
        <div key={i} style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 7, color: BC.t3, fontWeight: 700 }}>
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
