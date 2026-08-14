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
//  city do NOT flank the mark — "GAYLORD, MI" outweighs "2025" three to one,
//  so the cluster reads as leaning and every fix is a re-tune against whatever
//  the next tournament is called. Four two-digit cells cannot do that. Two
//  numeric pairs of near-identical ink either side of a fixed 25px glyph are
//  symmetric BY CONSTRUCTION, and both flanks are `flex: 1 1 0`, so the trophy
//  holds the centre of the band no matter what the digits do.
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

// One cell. Zero-padded and tabular so the row does not breathe in and out as
// the seconds turn over — the one thing that makes a running clock in a fixed
// header look broken. `minWidth` holds the cell open at "09" so the trophy
// does not shuffle sideways when a two-digit value drops to one.
function Unit({ value, label, urgent }) {
  return (
    <div style={{ textAlign: "center", minWidth: 20 }}>
      <div style={{
        fontSize: FS.small, fontWeight: 800, lineHeight: 1,
        fontVariantNumeric: "tabular-nums",
        // amberInk rather than amber: this is TEXT, and in light mode the fill
        // amber does not clear contrast on the page. See theme.js.
        color: urgent ? BC.warn : BC.amberInk,
      }}>{String(value).padStart(2, "0")}</div>
      <div style={{
        fontSize: FS.micro, fontWeight: 700, letterSpacing: 0.5,
        color: BC.t3, marginTop: 2,
      }}>{label}</div>
    </div>
  );
}

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
    // stretch` here makes this row exactly as wide as "2025 · GAYLORD, MI"
    // and the clock and the caption share two edges.
    //
    // Which is why the flanks push OUTWARD — flex-start on the left, flex-end
    // on the right — rather than hugging the trophy: DAYS lands on the
    // caption's first character and SEC on its last. The cells were kept
    // tight against the mark when this row spanned the whole band, where
    // spreading them would have run SEC into the band's padding on a 320px
    // phone. Against the caption there is no such edge to hit, and the
    // alignment is what makes the two lines read as one block.
    //
    // Both flanks stay `flex: 1 1 0`, so the trophy still holds the centre no
    // matter what the digits do.
    <div style={{
      alignSelf: "stretch", display: "flex",
      alignItems: "center", justifyContent: "center", gap: 8,
    }}>
      <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", justifyContent: "flex-start", gap: 6 }}>
        <Unit value={c.days} label="DAYS" urgent={c.urgent} />
        <Unit value={c.hours} label="HRS" urgent={c.urgent} />
      </div>
      {children}
      <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", justifyContent: "flex-end", gap: 6 }}>
        <Unit value={c.mins} label="MIN" urgent={c.urgent} />
        <Unit value={c.secs} label="SEC" urgent={c.urgent} />
      </div>
    </div>
  );
}

export default HeaderCountdown;
