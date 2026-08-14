// ══════════════════════════════════════════════════════════════════
//  HeaderCountdown — how long until the field tees off
// ══════════════════════════════════════════════════════════════════
//
//  Ported from the WBC app's BellCountdown, which counts to the same instant
//  for two reasons at once — the tournament starting and its prediction
//  market shutting. There is no market here, so this one only ever means the
//  first, and the name says so.
//
//  IT WRAPS THE MARK rather than sitting beside it, taking the trophy as its
//  children and setting days and hours to its left, minutes and seconds to
//  its right. AppHeader's own note explains at length why the year and the
//  city do NOT flank the mark — "GAYLORD, MI" outweighs "2026" three to one,
//  so the cluster reads as leaning and every fix is a re-tune against whatever
//  the next tournament is called. Four two-digit cells cannot do that. Two
//  numeric pairs of identical width either side of a fixed 25px glyph are
//  symmetric BY CONSTRUCTION, and both flanks are `flex: 1 1 0`, so the trophy
//  holds the centre of the band no matter what the digits do.
//
//  That "identical width" is load-bearing and it is not free — see the note on
//  Unit below for why the cells are sized by their digits and the labels are
//  single letters. Both of those exist to keep this row a mirror.
//
//  It sits on the TROPHY's row, not the caption's. The band's two absolutely
//  positioned corners — the sync chip on the left, the header slot on the
//  right — are both bottom-aligned to the caption, so nothing here can print
//  through them, and the caption's own CHIP_GUTTER arithmetic is untouched.
//
//  IT OWNS ITS OWN CLOCK, deliberately. Holding `now` in App and passing it
//  down would re-render the whole tree once a second — every leaderboard row,
//  every scorecard, on a phone in somebody's bag on the 14th fairway. Here the
//  tick reaches eight spans.
//
//  At zero it renders the mark alone, so the header goes back to being exactly
//  the header it has always been and nothing is left behind announcing that
//  something used to be there.
import { useState, useEffect } from "react";
import { BC, FS } from "../theme";
import { countdown } from "../lib/countdown";

// ── One cell, and why the DIGITS carry the geometry ─────────────────────
// The cell is exactly as wide as its two digits; the label is centred beneath
// them in a zero-width box, so it is painted but cannot widen anything. Every
// cell is therefore the same width and the row is a mirror by construction.
//
// It used to be the other way round — the box took the width of its LABEL —
// and that one decision was behind every misalignment in the band. The four
// labels are four different widths (DAYS 21.3, HRS 17.0, MIN 14.6, SEC 17.0)
// over a `minWidth: 20` floor, so the cells were unequal, and the two ends
// were aligned outward while the middles were centred. Measured off the
// pixels, the left pair sat 6.3px apart and the right pair 11.2px, and the
// trophy had more room on one side than the other. Nothing about that could
// be tuned out; it came from letting four different words set the grid.
//
// The width is `2ch` — two zero-widths of this exact font — and NOT the
// digits' own advance, because Montserrat's webfont carries no `tnum` feature
// and `font-variant-numeric: tabular-nums` is therefore doing nothing here.
// Measured: "11" sets 12.69px against 13.36px for "00", "25", "34" and "88".
// The declaration below is kept because it costs nothing and starts working
// the day the font gains the feature, but it is not what holds the row still —
// this width is. It was safe to rely on before only because the cell took its
// size from the label, which was always the wider of the two; the moment the
// digits set the geometry, an unpinned cell would twitch every time a 1 came
// or went, which on the seconds is once a second.
//
// Ink is never allowed to set geometry either, for the same reason at a
// smaller scale: "11" PAINTS narrower than "34" no matter how it is spaced.
//
// The labels are single letters for the same reason. "DAYS" is one character
// wider than every other label, and while it was there the ends could not both
// be flush with the caption AND evenly spaced — every arrangement that kept it
// bottomed out around 4px of error. D/H/M/S are near enough the same width
// that the question stops existing, and none of them is wide enough to reach
// past its own digits.
function Unit({ value, label, urgent }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <span style={{
        fontSize: FS.small, fontWeight: 800, lineHeight: 1,
        fontVariantNumeric: "tabular-nums",
        width: "2ch", textAlign: "center",
        // amberInk rather than amber: this is TEXT, and in light mode the fill
        // amber does not clear contrast on the page. See theme.js.
        color: urgent ? BC.warn : BC.amberInk,
      }}>{String(value).padStart(2, "0")}</span>
      <div style={{ width: 0, display: "flex", justifyContent: "center", marginTop: 2 }}>
        <span style={{
          fontSize: FS.micro, fontWeight: 700, letterSpacing: 0.5,
          color: BC.t3, whiteSpace: "nowrap", flexShrink: 0,
        }}>{label}</span>
      </div>
    </div>
  );
}

// How wide a flank may grow before it stops reaching for the caption. The row
// spans the caption, which is right while the two are near the same length —
// but "GRAND RAPIDS, MICHIGAN" is nearly twice the clock's natural width, and
// stretching to meet it tore a hole either side of the trophy and left four
// numbers scattered across the band. Past this the flanks stop, the row
// centres, and the clock stays one object. Comfortably above what the real
// caption asks for (~42px), so a normal place name still lands flush.
const FLANK_MAX = 58;

// `space-between` puts the pair on the flank's two edges and `flex: 1 1 0`
// keeps the two flanks equal, which is what holds the trophy in the middle.
//
// The `gap` is a FLOOR, not the spacing — space-between overrides it whenever
// there is room, and there almost always is. It earns its place in the one
// case where there is not: a caption shorter than the clock's own width, where
// the flanks have no slack to distribute and the two numbers ran together into
// "3415". No `minWidth: 0` for the same reason — the automatic min-content
// floor is what stops a flank being squeezed below the pair inside it.
const FLANK = {
  flex: "1 1 0", maxWidth: FLANK_MAX,
  display: "flex", justifyContent: "space-between", gap: 10,
};

export function HeaderCountdown({ at, children }) {
  const [now, setNow] = useState(() => Date.now());
  const c = at == null ? null : countdown(at - now);
  const done = c == null || c.done;
  // Every second, all the way out, because the seconds cell is on screen the
  // whole time — a slower tick would leave it visibly frozen. It costs one
  // re-render of eight spans, which is what owning the clock down here rather
  // than lifting `now` into App buys.
  useEffect(() => {
    if (done) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [done]);

  if (done) return children;
  return (
    // Stretched to the MEASURE, not to the band. The parent column in
    // AppHeader shrink-wraps to the caption underneath, so `alignSelf:
    // stretch` here makes this row exactly as wide as "2026 · GAYLORD, MI"
    // and the clock and the caption share two edges.
    //
    // Inside it every gap is the same: `space-between` puts the outer digits
    // on the row's two edges, and `flex: 1 1 0` on both flanks holds the
    // trophy in the middle. Four equal cells and one gap means the row is its
    // own mirror, so there is nothing here to balance by hand and nothing to
    // re-tune when the tournament moves.
    <div style={{
      alignSelf: "stretch", display: "flex",
      alignItems: "center", justifyContent: "center", gap: 12,
    }}>
      <div style={FLANK}>
        <Unit value={c.days} label="D" urgent={c.urgent} />
        <Unit value={c.hours} label="H" urgent={c.urgent} />
      </div>
      {children}
      <div style={FLANK}>
        <Unit value={c.mins} label="M" urgent={c.urgent} />
        <Unit value={c.secs} label="S" urgent={c.urgent} />
      </div>
    </div>
  );
}

export default HeaderCountdown;
