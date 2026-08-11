// ══════════════════════════════════════════════════════════════════
//  DateRangePicker — the trip's two dates, picked on one calendar
// ══════════════════════════════════════════════════════════════════
//
// The hotel/airline gesture: one calendar, first tap is the day you arrive,
// second is the day you leave, and the days in between fill in so the length
// of the trip is something you can see rather than something you work out.
//
// It replaces two `<input type="date">` boxes, which were wrong here for
// three separate reasons and only the first is cosmetic:
//
//   • THE PAIR IS ONE FACT. Two boxes with "to" between them is a range
//     drawn as two unrelated questions, and each one opens its own calendar
//     that knows nothing about the other — so the end picker happily offered
//     days before the start, and the four-day weekend everybody is actually
//     choosing was never on screen at once.
//   • THE NATIVE CONTROL IS NOT ONE CONTROL. `type="date"` renders as a
//     wheel on iOS, a dropdown grid on Android, a text field with a
//     spin-button on desktop Firefox. Sizing it to fit beside a label meant
//     dropping it to 12px, which is the mobile-Safari zoom trap CLAUDE.md
//     names: a focused input under 16px zooms the page in and does not zoom
//     back out. This is a button, so nothing focuses and nothing zooms.
//   • IT COULD NOT SHOW ITS OWN CONSTRAINT. `min` on the end box greys out
//     the illegal days but says nothing, so a director whose taps did not
//     register learned it from a toast after Save.
//
// The dates themselves stay `YYYY-MM-DD` strings from the tap to the write —
// nothing here constructs a Date. All of the arithmetic (the grid, the month
// paging, the two-tap state machine) is in lib/dates, where it is tested; this
// file is the drawing of it.
import { useState } from "react";
import { BC, FONT, ALPHA, FS, ON_AMBER } from "../theme";
import { Popup } from "./Popup";
import {
  isISODate, monthOf, addMonths, monthGrid, formatMonthYear, formatISORange,
  formatISODate, nextRangeSelection, rangePosition, todayISO, daysBetween,
  WEEKDAY_INITIALS,
} from "../lib/dates";

const CELL = 38;

// The band behind a day inside the range. Drawn on a wrapper rather than on
// the day itself so the fill runs edge to edge between cells — a rounded pill
// per day leaves seven gaps across a week and reads as seven separate
// selections instead of one span.
const bandStyle = (pos) => {
  if (!pos || pos === "only") return {};
  const tint = `${BC.amber}${ALPHA.tint}`;
  if (pos === "between") return { background: tint };
  return {
    background: `linear-gradient(to ${pos === "start" ? "right" : "left"}, ` +
      `transparent 50%, ${tint} 50%)`,
  };
};

function Day({ cell, start, end, onPick }) {
  const pos = rangePosition(cell.iso, start, end);
  const filled = pos === "start" || pos === "end" || pos === "only";
  const today = cell.iso === todayISO();
  return (
    <div style={{ ...bandStyle(pos), display: "flex", justifyContent: "center" }}>
      <button
        type="button"
        onClick={() => onPick(cell.iso)}
        aria-label={formatISODate(cell.iso, { withYear: true })}
        aria-pressed={filled}
        style={{
          width: CELL, height: CELL, borderRadius: "50%", cursor: "pointer",
          fontFamily: FONT, fontSize: FS.body,
          fontWeight: filled ? 800 : cell.inMonth ? 600 : 500,
          background: filled ? BC.amber : "transparent",
          color: filled ? ON_AMBER : cell.inMonth ? BC.t1 : BC.t3,
          // The spill days from the neighbouring months are legal to tap —
          // greying them out and then refusing the tap is how you make
          // somebody page back and forth to reach the 31st. They are dimmed
          // only so the month being drawn still reads as the month.
          opacity: cell.inMonth ? 1 : 0.45,
          border: today && !filled ? `1px solid ${BC.amber}${ALPHA.line}` : "1px solid transparent",
          padding: 0,
        }}
      >{Number(cell.iso.slice(8, 10))}</button>
    </div>
  );
}

// The calendar itself. Kept separate from the field below so the popup can be
// opened from anywhere else that ever needs a range.
export function DateRangeCalendar({ start, end, onChange }) {
  // Which month is on screen. Seeded ONCE, from the range, so re-opening a
  // saved trip lands on it rather than on today — the popup unmounts on close,
  // so "once" is per opening.
  //
  // Nothing re-seeds it afterwards, deliberately. A tap can only land on the
  // month being drawn or on the spill from either side of it, so the start is
  // never more than one month off screen; paging the view out from under
  // somebody who just tapped the 31st of the previous month would be the
  // calendar arguing with them about where they are.
  const [month, setMonth] = useState(() => monthOf(start) || monthOf(end) || monthOf(todayISO()));

  const pick = (iso) => onChange(nextRangeSelection({ start, end, pick: iso }));
  const nights = daysBetween(start, end);
  const arrow = {
    width: 34, height: 34, borderRadius: 9, cursor: "pointer", fontFamily: FONT,
    fontSize: FS.lead, fontWeight: 800, color: BC.t1, background: BC.inp,
    border: `1px solid ${BC.bdr}`, padding: 0, flexShrink: 0,
  };

  return (
    <div>
      {/* What has been chosen so far, and what is being asked for next. The
          prompt is the whole reason the two-tap gesture is learnable: without
          it, a calendar that took one tap and is waiting for a second looks
          identical to one that is finished. */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: FS.lead, fontWeight: 800, color: BC.t1, minHeight: 22 }}>
          {isISODate(start) ? formatISORange(start, end || start) : "Pick the first day"}
        </div>
        <div style={{ fontSize: FS.label, fontWeight: 700, letterSpacing: 0.5, color: BC.t3, marginTop: 2 }}>
          {!isISODate(start) ? "Then pick the last day"
            : !isISODate(end) ? "NOW PICK THE LAST DAY"
            : nights === 0 ? "ONE DAY"
            : `${nights + 1} DAYS · ${nights} ${nights === 1 ? "NIGHT" : "NIGHTS"}`}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <button type="button" onClick={() => setMonth(m => addMonths(m, -1))} aria-label="Previous month" style={arrow}>‹</button>
        <div style={{ fontSize: FS.body, fontWeight: 800, color: BC.t1, letterSpacing: 0.3 }}>
          {formatMonthYear(month)}
        </div>
        <button type="button" onClick={() => setMonth(m => addMonths(m, 1))} aria-label="Next month" style={arrow}>›</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
        {WEEKDAY_INITIALS.map((d, i) => (
          <div key={i} style={{
            textAlign: "center", fontSize: FS.label, fontWeight: 800, letterSpacing: 0.5,
            color: BC.t3, paddingBottom: 4,
          }}>{d}</div>
        ))}
        {/* Flattened into the one grid rather than a row per week: the
            connecting band has to run across a cell boundary, and a wrapper
            per week puts a border-box between Saturday and Sunday. */}
        {monthGrid(month).flat().map(cell => (
          <Day key={cell.iso} cell={cell} start={start} end={end} onPick={pick} />
        ))}
      </div>
    </div>
  );
}

// The field that stands in the Event form: a button showing the range, and the
// calendar behind it. It reports up on every tap rather than holding a draft
// and handing it back on Done — the form's own Save is the commit, and a
// second commit inside it is the thing that makes people ask which button
// actually saved.
export function DateRangeField({ start, end, onChange, placeholder = "Pick the dates", style }) {
  const [open, setOpen] = useState(false);
  const set = isISODate(start) || isISODate(end);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          flex: 1, minWidth: 0, boxSizing: "border-box", padding: "6px 10px",
          background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 7,
          color: set ? BC.t1 : BC.t3, fontSize: FS.lead, fontWeight: 600,
          fontFamily: FONT, textAlign: "left", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
          ...style,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {set ? formatISORange(start, end || start) : placeholder}
        </span>
        <span aria-hidden style={{ fontSize: FS.body, color: BC.t3, flexShrink: 0 }}>▾</span>
      </button>

      {open && (
        <Popup onClose={() => setOpen(false)} maxWidth={360} padding={16} portal>
          <DateRangeCalendar start={start} end={end} onChange={onChange} />
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              type="button"
              onClick={() => onChange({ start: "", end: "" })}
              style={{
                flex: 1, padding: "9px 0", borderRadius: 8, cursor: "pointer",
                background: BC.inp, border: `1px solid ${BC.bdr}`, color: BC.t2,
                fontFamily: FONT, fontSize: FS.small, fontWeight: 800, letterSpacing: 0.5,
              }}
            >CLEAR</button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                flex: 2, padding: "9px 0", borderRadius: 8, cursor: "pointer",
                background: BC.amber, border: "none", color: ON_AMBER,
                fontFamily: FONT, fontSize: FS.small, fontWeight: 800, letterSpacing: 0.5,
              }}
            >DONE</button>
          </div>
        </Popup>
      )}
    </>
  );
}
