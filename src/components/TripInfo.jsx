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
// here — the courses and dates come off the rounds and the house off one
// settings document (see lib/tripInfo for why none of it is a second copy).
// A director who wants to change something is told where, once, at the
// bottom, rather than being given an edit affordance on each section that
// would make this a second round-setup screen.
import { BC, FONT, ALPHA, FS } from "../theme";
import { FORMATS } from "../constants";
import {
  tripDates, scheduleDayLabel, tripCourses,
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

// "Round 2" · "Rounds 1 & 3" · "Rounds 1, 2 & 4". The ampersand rather than a
// third comma because this is read as a sentence fragment on a card, not as a
// list of values.
const roundsPhrase = (rounds) => {
  const head = `Round${rounds.length === 1 ? "" : "s"} `;
  if (rounds.length === 1) return head + rounds[0];
  return head + rounds.slice(0, -1).join(", ") + " & " + rounds[rounds.length - 1];
};

export function TripInfo({ tournamentName, tournamentLocation, house, schedule, isDirector }) {
  const dates = tripDates(schedule);
  const courses = tripCourses(schedule);
  const anything = hasTripInfo({ house, schedule });

  return (
    <div style={{ fontFamily: FONT, padding: "4px 2px 20px" }}>
      {/* ── The header ──
          Name, place and dates, in the order somebody would say them out
          loud. The dates are DERIVED from the rounds below, so this line and
          that list can never disagree — which is the reason there is no pair
          of trip-date fields anywhere in Admin. */}
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
          One row per round the tournament HAS, including the ones nobody has
          set up yet — a row that vanished would read as a shorter trip. Each
          says the day, the course and the first tee time, which is the set of
          facts somebody packs against. Their own tee time is per-group and
          lives on Matches. */}
      {/* `anything` gates the whole section, not just its rows. A tournament
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
            {schedule.map((row, i) => (
              <div key={row.round} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "11px 14px",
                borderTop: i === 0 ? "none" : `1px solid ${BC.bdr}${ALPHA.hair}`,
              }}>
                <div style={{ flexShrink: 0, width: 62 }}>
                  <div style={{ fontSize: FS.label, fontWeight: 800, letterSpacing: 0.5, color: BC.amberInk }}>
                    RD {row.round}
                  </div>
                  <div style={{ fontSize: FS.label, color: row.date ? BC.t2 : BC.t3, marginTop: 2 }}>
                    {scheduleDayLabel(row) || "—"}
                  </div>
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontSize: FS.small, fontWeight: 700, color: row.courseName ? BC.t1 : BC.t3,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {row.courseName || "Course not set yet"}
                  </div>
                  {formatLabel(row.format) && (
                    <div style={{ fontSize: FS.label, color: BC.t3, marginTop: 2 }}>
                      {formatLabel(row.format)}
                    </div>
                  )}
                </div>
                {row.teeTime && (
                  <div style={{ flexShrink: 0, textAlign: "right" }}>
                    <div style={{ fontSize: FS.small, fontWeight: 800, color: BC.t1 }}>{row.teeTime}</div>
                    <div style={{ fontSize: FS.label, color: BC.t3 }}>first tee</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── The courses ──
          Distinct, so a course played twice is one card that says so rather
          than the same card printed twice. */}
      {courses.length > 0 && (
        <>
          <SectionLabel>COURSES</SectionLabel>
          {courses.map(({ course, rounds }) => (
            <Card key={course.id} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontSize: FS.body, fontWeight: 800, color: BC.t1, minWidth: 0 }}>
                  {course.name}
                </div>
                <div style={{ fontSize: FS.label, fontWeight: 700, color: BC.amberInk, flexShrink: 0 }}>
                  {roundsPhrase(rounds)}
                </div>
              </div>
              <div style={{ fontSize: FS.small, color: BC.t2, marginTop: 4 }}>
                {[courseWhere(course), course.par ? `Par ${course.par}` : "", courseYardage(course)]
                  .filter(Boolean).join(" · ")}
              </div>
            </Card>
          ))}
          <div style={{ height: 6 }} />
        </>
      )}

      {/* Nothing set up at all. Two different sentences, because the person
          who can fix it and the person who cannot need different ones. */}
      {!anything && (
        <Card style={{ borderStyle: "dashed" }}>
          <div style={{ fontSize: FS.small, color: BC.t2, lineHeight: 1.5 }}>
            {isDirector
              ? "Nothing to show yet. Set each round's date and course in Admin → Rounds, and the house in Admin → Tournament."
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
          Dates and courses come from Admin → Rounds; the house from Admin → Tournament.
          Nothing here is typed twice.
        </div>
      )}
    </div>
  );
}
