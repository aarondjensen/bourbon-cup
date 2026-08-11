// ══════════════════════════════════════════════════════════════════
//  Trip Info — the weekend at a glance, for everybody
// ══════════════════════════════════════════════════════════════════
//
// The three questions in the group text the week before: when is it, where
// are we staying, what are we playing. Every other tab in the app is about
// the golf as it is being played; this one is about the trip as it is being
// planned for, and it is the only screen a player can open in June.
//
// READ-ONLY, for a director as much as for anybody. Nothing on it is typed
// here — the dates and the house come off two settings documents and the
// courses off each round (see lib/tripInfo for why none of it is a copy).
// A director who wants to change something is told where, once, at the
// bottom, rather than being given an edit affordance on each section that
// would make this a second round-setup screen.
import { useState } from "react";
import { BC, FONT, ALPHA, FS } from "../theme";
import { FORMATS } from "../constants";
import { Popup } from "./Popup";
import {
  scheduleDayLabel, courseTees, courseScorecard, coursePar,
  courseYardage, courseWhere, hasHouse, hasTripInfo, linkHost,
} from "../lib/tripInfo";

const SectionLabel = ({ children, style }) => (
  <div style={{
    fontSize: FS.label, fontWeight: 800, letterSpacing: 1.5,
    color: BC.amberInk, marginBottom: 8, ...style,
  }}>{children}</div>
);

const Card = ({ children, style }) => (
  <div style={{
    background: BC.card, border: `1px solid ${BC.bdr}`, borderRadius: 10,
    padding: "14px 16px", marginBottom: 16, ...style,
  }}>{children}</div>
);

const formatLabel = (id) => FORMATS.find(f => f.id === id)?.label || "";

// ══════════════════════════════════════════════════════════════════
//  The course sheet — what a schedule row opens
// ══════════════════════════════════════════════════════════════════
//
// The same card the director edits in Admin → Courses, read-only, plus a tee
// picker. Every number on it was already in the app and had never been on a
// screen a player could reach: "what am I looking at on Saturday, and which
// hole is the stroke hole" is the question a golfer asks the night before, and
// until now the answer lived inside round setup.
//
// It costs nothing until a row is tapped, which is what lets it be the full
// eighteen rather than the summary a row could afford.
function CourseSheet({ course, rounds, onClose }) {
  const tees = courseTees(course);
  const [teeIndex, setTeeIndex] = useState(0);
  const card = courseScorecard(course, teeIndex);
  const where = courseWhere(course);

  // The grid: a label column, nine holes, a total. Shared by both nines so
  // the two line up exactly rather than approximately.
  const grid = { display: "grid", gridTemplateColumns: "30px repeat(9, 1fr) 32px", gap: 1 };
  const cell = { textAlign: "center", padding: "3px 0", fontSize: FS.micro };
  const rowLabel = { fontSize: FS.micro, color: BC.t3, fontWeight: 700, padding: "3px 2px" };

  const nine = (label, holes, totals) => (
    <div key={label} style={{ marginBottom: 8 }}>
      <div style={grid}>
        <div style={rowLabel}>Hole</div>
        {holes.map(h => (
          <div key={h.hole} style={{ ...cell, color: BC.t2, fontWeight: 700 }}>{h.hole}</div>
        ))}
        <div style={{ ...cell, color: BC.t3, fontWeight: 700 }}>{label}</div>
      </div>
      <div style={{ ...grid, background: BC.inp, borderRadius: 3, marginBottom: 1 }}>
        <div style={rowLabel}>Par</div>
        {holes.map(h => (
          <div key={h.hole} style={{ ...cell, color: BC.t1, fontWeight: 700 }}>{h.par || "–"}</div>
        ))}
        <div style={{ ...cell, color: BC.amberInk, fontWeight: 800 }}>{totals.par}</div>
      </div>
      {/* The stroke index, which is the row a golfer actually reads this card
          for — it is where their shots fall. Blank rather than 0 on a course
          whose source never recorded one. */}
      <div style={{ ...grid, marginBottom: 1 }}>
        <div style={rowLabel}>Hcp</div>
        {holes.map(h => (
          <div key={h.hole} style={{ ...cell, color: BC.t3 }}>{h.hcp ?? "–"}</div>
        ))}
        <div />
      </div>
      {totals.yards > 0 && (
        <div style={grid}>
          <div style={rowLabel}>Yds</div>
          {holes.map(h => (
            <div key={h.hole} style={{ ...cell, color: BC.t3 }}>{h.yards || "–"}</div>
          ))}
          <div style={{ ...cell, color: BC.t3 }}>{totals.yards || ""}</div>
        </div>
      )}
    </div>
  );

  return (
    <Popup onClose={onClose} maxWidth={420} padding={18} portal showClose viewportFit align="start">
      <div style={{ fontFamily: FONT }}>
        <div style={{ fontSize: FS.label, fontWeight: 800, letterSpacing: 1.5, color: BC.amberInk, marginBottom: 4 }}>
          {rounds}
        </div>
        <div style={{ fontSize: FS.lead, fontWeight: 800, color: BC.t1, lineHeight: 1.2 }}>
          {course.name}
        </div>
        <div style={{ fontSize: FS.small, color: BC.t2, marginTop: 4, marginBottom: 14 }}>
          {[where, coursePar(course) ? `Par ${coursePar(course)}` : "", courseYardage(course)].filter(Boolean).join(" · ")}
        </div>

        {/* Which tee. Only when there is a choice to make — one tee is a fact,
            not a control. The chosen tee drives the yardage row below and the
            rating/slope line under the buttons. */}
        {tees.length > 1 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {tees.map(t => {
              const on = t.index === teeIndex;
              return (
                <button key={t.index} onClick={() => setTeeIndex(t.index)} style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 10px", borderRadius: 999, cursor: "pointer",
                  background: on ? `${BC.amber}${ALPHA.wash}` : BC.inp,
                  border: `1px solid ${on ? BC.amber + ALPHA.line : BC.bdr}`,
                  color: on ? BC.amberInk : BC.t2,
                  fontSize: FS.small, fontWeight: on ? 800 : 600, fontFamily: FONT,
                }}>
                  {t.color && <span style={{
                    width: 9, height: 9, borderRadius: "50%", background: t.color,
                    border: `1px solid ${BC.bdr}`, flexShrink: 0,
                  }} />}
                  {t.name}
                </button>
              );
            })}
          </div>
        )}
        {card?.tee && (card.tee.rating || card.tee.slope || card.tee.yardage) && (
          <div style={{ fontSize: FS.label, color: BC.t3, marginBottom: 10 }}>
            {[
              card.tee.yardage ? `${card.tee.yardage.toLocaleString("en-US")} yds` : "",
              card.tee.rating ? `${card.tee.rating} rating` : "",
              card.tee.slope ? `${card.tee.slope} slope` : "",
            ].filter(Boolean).join(" · ")}
          </div>
        )}

        {card ? (
          <>
            {nine("Out", card.front, card.totals.out)}
            {nine("In", card.back, card.totals.in)}
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              borderTop: `1px solid ${BC.bdr}`, paddingTop: 8, marginTop: 2,
            }}>
              <span style={{ fontSize: FS.label, fontWeight: 800, letterSpacing: 1, color: BC.t3 }}>TOTAL</span>
              <span style={{ fontSize: FS.small, fontWeight: 800, color: BC.t1 }}>
                Par {card.totals.total.par}
                {card.totals.total.yards > 0 && (
                  <span style={{ color: BC.t3, fontWeight: 600 }}>
                    {" · "}{card.totals.total.yards.toLocaleString("en-US")} yds
                  </span>
                )}
              </span>
            </div>
          </>
        ) : (
          <div style={{ fontSize: FS.small, color: BC.t3, lineHeight: 1.5 }}>
            No scorecard saved for this course yet. The director can add the pars and
            stroke indexes in Admin → Rounds, on the course picker.
          </div>
        )}
      </div>
    </Popup>
  );
}

export function TripInfo({ tournamentName, tournamentLocation, house, schedule, dates, isDirector }) {
  // Which round's course sheet is open, by round number rather than by course
  // id — the same course can be played twice and the sheet says which round
  // you opened it from.
  const [openRound, setOpenRound] = useState(null);
  const anything = hasTripInfo({ house, schedule }) || !!dates?.label;
  const openRow = schedule.find(r => r.round === openRound && r.course) || null;

  return (
    <div style={{ fontFamily: FONT, padding: "4px 2px 20px" }}>
      {/* ── The header ──
          Name, place and dates, in the order somebody would say them out
          loud. The dates are the tournament's own pair, set in Admin →
          Tournament — the source of truth every other date in the app reads
          down from, including the day picker on each round. */}
      <Card style={{ borderColor: `${BC.amber}${ALPHA.line}` }}>
        <div style={{ fontSize: FS.lead, fontWeight: 800, color: BC.t1, lineHeight: 1.2 }}>
          {tournamentName}
        </div>
        {tournamentLocation && (
          <div style={{ fontSize: FS.small, color: BC.t2, marginTop: 3 }}>{tournamentLocation}</div>
        )}
        <div style={{
          fontSize: FS.body, fontWeight: 800, marginTop: 8,
          color: dates.label ? BC.amberInk : BC.t3,
        }}>
          {dates.label || "Dates not set yet"}
        </div>
      </Card>

      {/* ── The house ──
          Only when there is one. A section reading "no house yet" is chrome
          about nothing, and the director is told at the bottom where to put
          it. `href` is lib/tripInfo's safeHouseUrl, which is null for
          anything that is not an http(s) link — so the button below either
          points somewhere real or is not a link at all. */}
      {hasHouse(house) && (
        <>
          <SectionLabel>THE HOUSE</SectionLabel>
          <Card>
            <div style={{ fontSize: FS.body, fontWeight: 800, color: BC.t1, overflowWrap: "anywhere" }}>
              {house.label}
            </div>
            {house.url && (
              <>
                {/* rel is load-bearing, not boilerplate: a target=_blank link
                    hands the opened page a `window.opener` handle to this one
                    unless noopener says otherwise. */}
                <a href={house.url} target="_blank" rel="noopener noreferrer" style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                  marginTop: 10, padding: "10px 12px", borderRadius: 8,
                  background: `${BC.amber}${ALPHA.wash}`, border: `1px solid ${BC.amber}${ALPHA.line}`,
                  color: BC.amberInk, fontSize: FS.small, fontWeight: 800,
                  textDecoration: "none", fontFamily: FONT,
                }}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    Open the listing
                  </span>
                  <span style={{ color: BC.t3, fontWeight: 500, flexShrink: 0 }}>{linkHost(house.url)} ↗</span>
                </a>
              </>
            )}
          </Card>
        </>
      )}

      {/* ── The schedule ──
          ONE section, not two. Schedule and Courses used to be separate, and
          the second was the first restated: every course on it was already
          named on a schedule row, and a reader had to hold "Round 2 is The
          Loop" in their head to join the two. Now the round row IS the course
          row — day, course, format, first tee — and the detail the Courses
          cards carried moved behind a tap, where it can be the whole card
          instead of one line.

          One row per round the tournament HAS, including the ones nobody has
          set up yet: a row that vanished would read as a shorter trip. Their
          own tee time is per-group and lives on Matches.

          `anything` gates the whole section, not just its rows. A tournament
          nobody has set up would otherwise print four "course not set yet"
          rows directly above a card explaining that nothing is set up — the
          same fact twice, the second time as a list. */}
      {anything && schedule.length > 0 && (
        <>
          <SectionLabel>SCHEDULE</SectionLabel>
          <div style={{
            background: BC.card, border: `1px solid ${BC.bdr}`, borderRadius: 10,
            overflow: "hidden", marginBottom: 16,
          }}>
            {schedule.map((row, i) => {
              // A row is a button only when there is a card behind it. A
              // chevron on a round with no course would promise a screen that
              // has nothing on it.
              const tappable = !!row.course;
              // Format and par only. The town was here too and it was the
              // first thing to get ellipsised on a phone — it is also the
              // least useful of the three on a row, and it is on the card
              // behind the tap in full.
              const meta = row.course
                ? [formatLabel(row.format), coursePar(row.course) ? `Par ${coursePar(row.course)}` : ""]
                  .filter(Boolean).join(" · ")
                : formatLabel(row.format);
              return (
                <button
                  key={row.round}
                  onClick={tappable ? () => setOpenRound(row.round) : undefined}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 14px", textAlign: "left", fontFamily: FONT,
                    background: "transparent", border: "none",
                    borderTop: i === 0 ? "none" : `1px solid ${BC.bdr}${ALPHA.hair}`,
                    cursor: tappable ? "pointer" : "default",
                  }}
                >
                  {/* 74 is "Thu, Aug 13" at FS.label — measured with
                      Montserrat loaded, not the fallback. nowrap is what makes
                      that a real constraint: without it the date wrapped to a
                      second line and the row grew a row taller than its
                      neighbours. */}
                  <span style={{ flexShrink: 0, width: 74 }}>
                    <span style={{ display: "block", fontSize: FS.label, fontWeight: 800, letterSpacing: 0.5, color: BC.amberInk }}>
                      RD {row.round}
                    </span>
                    <span style={{
                      display: "block", fontSize: FS.label, marginTop: 2, whiteSpace: "nowrap",
                      color: row.date ? BC.t2 : BC.t3,
                    }}>
                      {scheduleDayLabel(row) || "—"}
                    </span>
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{
                      display: "block", fontSize: FS.small, fontWeight: 700,
                      color: row.courseName ? BC.t1 : BC.t3,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {row.courseName || "Course not set yet"}
                    </span>
                    {meta && (
                      <span style={{
                        display: "block", fontSize: FS.label, color: BC.t3, marginTop: 2,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{meta}</span>
                    )}
                  </span>
                  {row.teeTime && (
                    <span style={{ flexShrink: 0, textAlign: "right" }}>
                      <span style={{ display: "block", fontSize: FS.small, fontWeight: 800, color: BC.t1 }}>{row.teeTime}</span>
                      <span style={{ display: "block", fontSize: FS.label, color: BC.t3 }}>first tee</span>
                    </span>
                  )}
                  <span style={{
                    flexShrink: 0, width: 8, textAlign: "right",
                    color: BC.t3, fontSize: FS.lead, fontWeight: 700,
                    visibility: tappable ? "visible" : "hidden",
                  }}>›</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {openRow && (
        <CourseSheet
          course={openRow.course}
          rounds={`ROUND ${openRow.round}`}
          onClose={() => setOpenRound(null)}
        />
      )}

      {/* Nothing set up at all. Two different sentences, because the person
          who can fix it and the person who cannot need different ones. */}
      {!anything && (
        <Card style={{ borderStyle: "dashed" }}>
          <div style={{ fontSize: FS.small, color: BC.t2, lineHeight: 1.5 }}>
            {isDirector
              ? "Nothing to show yet. Set the dates and the house in Admin → Event, and each round's course in Admin → Rounds."
              : "The director hasn't set the trip up yet. Dates, courses and the house will show up here once they do."}
          </div>
        </Card>
      )}

      {/* Where it comes from, said once, at the bottom, and only to somebody
          who can act on it. Every fact above is edited somewhere else on
          purpose (see lib/tripInfo); without this line a director would look
          for an edit button on this screen and not find one. */}
      {isDirector && anything && (
        <div style={{ fontSize: FS.label, color: BC.t3, lineHeight: 1.6, padding: "0 2px" }}>
          The dates and the house come from Admin → Event; the courses and each
          round&apos;s day from Admin → Rounds. Nothing here is typed twice.
        </div>
      )}
    </div>
  );
}
