// ══════════════════════════════════════════════════════════════════
//  The course library — one list, two doors
// ══════════════════════════════════════════════════════════════════
//
// The saved courses, the golf-API search, the round chips, edit and remove.
// It was inline in AdminView and reachable from exactly one place: Admin →
// Formats → the COURSE field, framed as "COURSE FOR RD n". That framing is
// right when you are setting a round up and wrong the rest of the year — a
// director correcting a stroke index in February had to pick a round he was
// not editing to get at the course.
//
// So the same list is now also a card on the Event tab, where courses are a
// thing the tournament HAS rather than a thing a round needs. Two modes off
// one component, because a second copy is how the round picker and the Event
// card come to disagree about what a course is:
//
//   mode="round"    — in the picker popup. A row TAP assigns the course to
//                     the round the picker was opened from and closes.
//   mode="library"  — on the Event tab. A row TAP opens the editor; the R
//                     chips still assign, so nothing the picker can do was
//                     lost by having a second door.
//
// The editor itself is not in here. It lives at AdminView's top level and is
// opened by setting one piece of state, which is what lets it survive the
// picker closing underneath it — and what lets both doors share it.
import { US_STATES } from "../constants";
import { ALPHA, BC, FONT, FS, ON_AMBER } from "../theme";

export function CourseLibrary({
  mode = "round",
  // The round the picker was opened from — mode="round" only.
  editRound = null,
  // Every round number the cup holds, for the assign chips. Not [1,2,3,4]:
  // the round count is a tournament setting and a five-round cup would lose
  // its last column.
  rounds = [1, 2, 3, 4],
  courses,
  tRounds,
  // The saved list already filtered by the query — the parent owns the search
  // state, because the API half of it is debounced and lives there too.
  libraryCourses,
  search,
  onSearch,
  stateFilter,
  onStateFilter,
  searchLoading,
  searchResults,
  // The primary row tap: assign-and-close in the picker, open the editor on
  // the Event tab. Separate from onAssign, which the chips use — the chip for
  // the round the picker was opened from is a toggle and must not close it.
  onRowTap,
  onAssign,
  onEdit,
  onDelete,
  onPreview,
  confirm,
  // Rendered above the search row and inside the same sticky block — the
  // picker's title and ✕ have to pin with the box they belong to, and two
  // stacked `top: 0` stickies overlap.
  header = null,
}) {
  const inRound = mode === "round";
  // Rows are inset from the popup's own edge; inside an Event card the card
  // is already padded, so they sit flush and only the dividers show.
  const rowPad = inRound ? "10px 14px" : "10px 0";
  const headPad = inRound ? "12px 14px" : "0 0 10px";

  return (
    <div>
      {/* Sticky in the popup so the search box stays reachable while a long
          library scrolls under it — the card itself is the scroll container.
          On the Event tab the page scrolls, so there is nothing to pin. */}
      <div style={{
        padding: headPad, borderBottom: `1px solid ${BC.bdr}`,
        ...(inRound ? { position: "sticky", top: 0, background: BC.card, zIndex: 1 } : null),
      }}>
        {header}
        <div style={{ display: "flex", gap: 6 }}>
          <select value={stateFilter} onChange={e => onStateFilter(e.target.value)}
            style={{ width: 64, padding: "9px 6px", background: BC.inp, border: `1px solid ${BC.amber}${ALPHA.line}`, borderRadius: 8, color: BC.t1, fontSize: FS.lead, flexShrink: 0 }}>
            <option value="">All</option>
            {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {/* FS.lead is 16px, which is what stops iOS Safari zooming the
              page on focus — under 16px it zooms in and never back. */}
          <input value={search} onChange={e => onSearch(e.target.value)} placeholder="Search courses…"
            style={{ flex: 1, minWidth: 0, padding: "9px 12px", background: BC.inp, border: `1px solid ${BC.amber}${ALPHA.line}`, borderRadius: 8, color: BC.t1, fontSize: FS.lead, outline: "none", boxSizing: "border-box" }} />
          {search !== "" && (
            <button onClick={() => onSearch("")} style={{ flexShrink: 0, padding: "0 10px", borderRadius: 8, background: "transparent", border: `1px solid ${BC.bdr}`, color: BC.t3, fontSize: FS.lead, cursor: "pointer" }}>✕</button>
          )}
        </div>
      </div>

      {libraryCourses.map((c, i) => {
        const onThisRound = inRound && tRounds.find(t => t.round_number === editRound)?.course_id === c.id;
        return (
        <div key={c.id} style={{ borderBottom: i < libraryCourses.length - 1 ? `1px solid ${BC.bdr}${ALPHA.hair}` : "none", padding: rowPad }}>
          {/* Two lines, because at popup width the name and six controls
              on one row left the name about 150px and wrapping. Line one
              is the primary action — in the picker it puts this course on
              the round the picker was opened from and closes; on the Event
              tab it opens the course. Line two is everything else: the
              rounds, and remove. */}
          <button onClick={() => onRowTap(c)}
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "transparent", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: FS.body, color: onThisRound ? BC.amberInk : BC.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {onThisRound && "✓ "}{c.name}
              </div>
              <div style={{ fontSize: FS.label, color: BC.t3, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{[c.city, c.state].filter(Boolean).join(", ")} · Par {c.par} · Slope {c.slope}</div>
            </div>
            {/* The chevron is the only thing saying the row opens something.
                In the picker an Edit button says it instead, because there
                the tap is an assignment. */}
            {!inRound && <span style={{ color: BC.t3, fontSize: FS.lead, flexShrink: 0 }}>›</span>}
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7 }}>
            <div style={{ display: "flex", gap: 3, flex: 1 }}>
              {rounds.map(r => {
                const tr = tRounds.find(t => t.round_number === r);
                const isAssigned = tr?.course_id === c.id;
                const otherCourse = tr?.course_id && tr.course_id !== c.id && courses.find(x => x.id === tr.course_id);
                return (
                  <button key={r} onClick={async () => {
                    if (isAssigned) {
                      await onAssign(r, null);
                    } else if (otherCourse) {
                      if (await confirm(`Replace ${otherCourse.name} for Rd ${r}?`)) await onAssign(r, c.id);
                    } else {
                      await onAssign(r, c.id);
                    }
                  }} style={{
                    padding: "3px 6px", borderRadius: 4, fontSize: FS.label, fontWeight: 700, cursor: "pointer", minWidth: 24, textAlign: "center",
                    background: isAssigned ? BC.amber : "transparent",
                    color: isAssigned ? ON_AMBER : BC.t3,
                    border: `1px solid ${isAssigned ? BC.amber : BC.bdr}`,
                    fontFamily: FONT,
                  }}>R{r}</button>
                );
              })}
            </div>
            {inRound && (
              <button onClick={() => onEdit(c)} title="Edit course name, tees & scorecard" style={{ background: "transparent", border: `1px solid ${BC.bdr}`, color: BC.t3, cursor: "pointer", fontSize: FS.label, fontWeight: 700, borderRadius: 4, padding: "3px 6px" }}>Edit</button>
            )}
            <button onClick={async () => { if (await confirm(`Remove ${c.name}?`)) onDelete(c); }} style={{ background: "transparent", border: "none", color: BC.t3, cursor: "pointer", fontSize: FS.body, padding: "2px 4px" }}>✕</button>
          </div>
        </div>
        );
      })}
      {courses.length === 0 && <div style={{ padding: inRound ? "16px 14px" : "12px 0", color: BC.t3, fontSize: FS.small }}>No courses yet — search above.</div>}
      {courses.length > 0 && libraryCourses.length === 0 && (
        <div style={{ padding: inRound ? "10px 14px" : "10px 0", color: BC.t3, fontSize: FS.label }}>Nothing saved matches “{search.trim()}”.</div>
      )}

      {/* The API half appears only once there is a query to answer. Always
          rendered, it left a bordered empty strip under the saved list — on
          the Event card, where the list is the whole card, that reads as a
          section that failed to load. */}
      {(searchLoading || search.trim().length >= 2) && (
      <div style={{ padding: inRound ? 14 : "12px 0 0", borderTop: `1px solid ${BC.bdr}` }}>
        {searchLoading && <div style={{ textAlign: "center", padding: 12, color: BC.t3, fontSize: FS.small }}>Searching…</div>}

        {!searchLoading && search.trim().length >= 2 && searchResults.length === 0 && (
          <div style={{ textAlign: "center", padding: "10px 0", color: BC.t3, fontSize: FS.small }}>Nothing found for “{search}”</div>
        )}

        {/* ── A broad search is not a broken one ──
            One query per search, deliberately: this box is used a few
            times a year, and fetching page after page on every keystroke
            spends real quota to make one-word searches exhaustive.
            See the note on fetchCourseResults.

            What that costs is this line. "Dunes" returns a page of
            courses with Dunes somewhere in the name — Kiva Dunes, Wild
            Dunes, clubs whose COURSE is called the Dunes — and Forest
            Dunes is simply not among the ones that came back. The
            screen showed twenty results, which reads as a search that
            cannot find your course rather than one that found too many.
            Saying the count and what to do about it is the whole fix.

            Only on a long list: on three results there is nothing to
            narrow and the line would be noise. */}
        {!searchLoading && searchResults.length >= 8 && (
          <div style={{ textAlign: "center", padding: "2px 0 10px", color: BC.t3, fontSize: FS.label, lineHeight: 1.45 }}>
            {searchResults.length} matches — add more of the name to narrow it.
          </div>
        )}

        {!searchLoading && searchResults.filter(c => !courses.find(ex => ex.name.toLowerCase() === c.name.toLowerCase())).map(c => (
          <button key={c.id} onClick={() => onPreview(c)}
            style={{ display: "block", width: "100%", background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 10, padding: "10px 14px", cursor: "pointer", textAlign: "left", color: BC.t1, marginBottom: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: FS.body }}>{c.name}</span>
                  {c._incompleteData && <span style={{ fontSize: FS.micro, background: `${BC.danger}${ALPHA.tint}`, border: `1px solid ${BC.danger}${ALPHA.hair}`, color: BC.danger, borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>⚠ incomplete</span>}
                  {c._source && <span style={{ fontSize: FS.micro, background: `${BC.amber}${ALPHA.wash}`, border: `1px solid ${BC.amber}${ALPHA.hair}`, color: BC.amberInk, borderRadius: 4, padding: "1px 5px", fontWeight: 600 }}>{c._source}</span>}
                </div>
                <div style={{ fontSize: FS.label, color: BC.t3 }}>{[c.city, c.state].filter(Boolean).join(", ")}{c.par ? ` · Par ${c.par}` : ""}{c.slope && c.slope !== 113 ? ` · Slope ${c.slope}` : ""}</div>
              </div>
              <span style={{ color: BC.amberInk, fontSize: FS.small, fontWeight: 700 }}>Preview →</span>
            </div>
          </button>
        ))}

      </div>
      )}
    </div>
  );
}
