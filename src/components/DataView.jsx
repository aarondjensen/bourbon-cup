// ══════════════════════════════════════════════════════════════════
//  DataView — the cup and the people in it, across every year.
// ══════════════════════════════════════════════════════════════════
//
// One More-menu row, two subjects. It was two rows — Player Analytics and
// Historical Data — split NOW vs THEN, which meant "how has Weezy done" was
// answered for this year on one row and nowhere at all for the other ten.
//
//   TOURNAMENT   the cup itself. Cup records, every year round by round, and
//                the thirty-six courses it has been played on.
//   PLAYER       the people. A career table, and a card per man behind it.
//
// ── Where the numbers come from ───────────────────────────────────
// lib/useArchive, which lazily imports the ten finished years
// (pipeline/archive.mjs) as a chunk of their own — about 12 KB over the wire,
// content-hashed, and separate from this file so restyling the tab does not
// invalidate a decade of cached history. A phone that never opens the tab
// downloads neither; one that opens it twice downloads neither twice.
// Firestore is not read at all for the history — see the note in useArchive
// for the three more expensive ways this could have been done.
//
// The RUNNING year is not in that file and never will be. It comes off the
// live subscriptions the app already holds, is turned into rows of the same
// shape by lib/archiveLive, and is folded in by the same arithmetic that
// folds 2016. So a match that finishes moves a career record on the next
// render, without a rebuild and without a second definition of a win.
import { useMemo, useState } from "react";
import { BC, FONT, FS, ALPHA, playerNameColor, themedStyle, brandAccent } from "../theme";
import { SegmentedToggle, StickyTop } from "./ui";
import { fmtPts, fmtScore } from "../scoring";
import { formatLabel } from "../constants";
import { switchEdition } from "../lib/editions";
import { useArchive } from "../lib/useArchive";
import { RECENT_CUPS, RECENT_MIN } from "../lib/archiveFold";
import { streakWhere } from "../lib/streaks";
import { royaleHoles } from "../lib/matchRoyale";

// ── Small shared furniture ────────────────────────────────────────
const card = themedStyle(() => ({ background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, marginBottom: 12 }));
const eyebrow = themedStyle(() => ({ fontSize: FS.label, fontWeight: 800, color: BC.t3, letterSpacing: 1 }));
const hair = () => `1px solid ${BC.bdr}${ALPHA.hair}`;

// Strokes gained, always signed. A bare "0.4" beside a "-1.2" reads as a
// score; the plus is what says this is a margin over somebody.
const fmtSg = (n) => n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
const sgColor = (n) => n == null ? BC.t1 : n > 0 ? BC.green : n < 0 ? BC.danger : BC.t1;

const Section = ({ label, note, action, children, style }) => (
  <div style={{ ...card, padding: 14, ...style }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <div style={eyebrow}>{String(label).toUpperCase()}</div>
      {note && <div style={{ fontSize: FS.micro, color: BC.t3, letterSpacing: 0.4, marginLeft: "auto" }}>{note}</div>}
      {action && <div style={{ marginLeft: note ? 0 : "auto" }}>{action}</div>}
    </div>
    {children}
  </div>
);

// ── How far back ──────────────────────────────────────────────────
// Two buttons rather than a chip per depth: Last 2, Last 3, Last 4 and Last 5
// as four chips is most of a phone's width spent on one question, and it caps
// the answer at whatever set somebody thought of.
//
// It only appears when the scope it belongs to is the one selected — there is
// nothing for it to step while the table is showing a career — and each end
// goes flat at its limit rather than disappearing, so the control does not
// change shape under a thumb.
const Stepper = ({ value, min, max, onChange, label }) => {
  const btn = (delta, glyph, at) => (
    <button
      onClick={() => !at && onChange(value + delta)}
      disabled={at} aria-label={`${label} ${delta > 0 ? "more" : "fewer"}`}
      style={{
        width: 26, height: 26, borderRadius: 999, cursor: at ? "default" : "pointer",
        fontFamily: FONT, fontSize: FS.small, fontWeight: 800, lineHeight: 1,
        background: "transparent", border: `1px solid ${BC.bdr}`,
        color: at ? BC.bdr : BC.t2,
      }}
    >{glyph}</button>
  );
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      {btn(-1, "−", value <= min)}
      {btn(1, "+", value >= max)}
    </div>
  );
};

// ── Gross or net, on the card it applies to ───────────────────────
// Small enough to live in a card's own header, because that is where the
// question belongs: whether LOW ROUNDS is reading gross or net is a fact
// about LOW ROUNDS, and a single control at the top of a long screen answers
// it for boards that have scrolled out of sight.
//
// Each card keeps its own, so the answer can differ between them. That is the
// point rather than an oversight — the low rounds are worth reading net and
// the birdies gross, and one switch made that a choice between them.
//
// Cards with only one reading do not get one: the streak boards are net by
// construction, read off the net marks with no gross version to offer.
const BasisToggle = ({ value, onChange }) => (
  <div style={{ display: "flex", gap: 1, borderRadius: 999, overflow: "hidden", border: `1px solid ${BC.bdr}` }}>
    {[["gross", "GROSS"], ["net", "NET"]].map(([v, label]) => {
      const on = v === value;
      return (
        <button
          key={v} onClick={() => onChange(v)} aria-pressed={on} style={{
            padding: "3px 8px", cursor: "pointer", fontFamily: FONT, border: "none",
            background: on ? BC.amber + ALPHA.wash : "transparent",
            color: on ? BC.amberInk : BC.t3,
            fontSize: FS.micro, fontWeight: on ? 800 : 600, letterSpacing: 0.6,
          }}
        >{label}</button>
      );
    })}
  </div>
);

// A fact and what it is. Used everywhere a number wants a caption under it
// rather than a column head above it.
const Stat = ({ label, value, sub, color }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ fontSize: FS.lead, fontWeight: 800, color: color || BC.t1, lineHeight: 1.1 }}>{value}</div>
    <div style={{ fontSize: FS.micro, color: BC.t3, letterSpacing: 0.6, marginTop: 3 }}>{String(label).toUpperCase()}</div>
    {sub && <div style={{ fontSize: FS.micro, color: BC.t3, marginTop: 1 }}>{sub}</div>}
  </div>
);

// A ranked list under a label: 1, 2, 3 down the left and whatever the record
// is across the row. Every board on this tab is one of these.
const RecordList = ({ label, rows = [], render }) => !!rows.length && (
  <div style={{ marginBottom: 12 }}>
    <div style={eyebrow}>{label}</div>
    {rows.map((x, i) => (
      <div key={i} style={{ display: "flex", gap: 8, padding: "4px 0", borderTop: i ? hair() : "none", fontSize: FS.small }}>
        <span style={{ width: 14, color: BC.t3, fontWeight: 800 }}>{i + 1}</span>
        {render(x)}
      </div>
    ))}
  </div>
);

const Empty = ({ icon = "📊", children }) => (
  <div style={{ textAlign: "center", padding: 40, color: BC.t3 }}>
    <div style={{ fontSize: FS.display, marginBottom: 12 }}>{icon}</div>
    <div style={{ fontSize: FS.body, fontWeight: 700, color: BC.t2 }}>{children}</div>
  </div>
);

// A row of chips that filters rather than navigates. Deliberately not a
// SegmentedToggle: that control is the tab switcher's language, and there is
// already one of those at the top of this screen.
const Chips = ({ options, value, onChange, style }) => (
  <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", ...style }}>
    {options.map(([v, label]) => {
      const on = v === value;
      return (
        <button key={v} onClick={() => onChange(v)} style={{
          padding: "6px 12px", borderRadius: 999, cursor: "pointer", fontFamily: FONT,
          background: on ? BC.amber + ALPHA.wash : "transparent",
          border: `1px solid ${on ? BC.amber + ALPHA.line : BC.bdr}`,
          color: on ? BC.amberInk : BC.t3,
          fontSize: FS.small, fontWeight: on ? 800 : 600, letterSpacing: 0.4,
        }}>{label}</button>
      );
    })}
  </div>
);

const toParText = (n) => (n == null ? "—" : fmtScore(Math.round(n * 10) / 10));

// One shared empty set, so a fold without one does not hand a NEW set to a
// memo on every render and re-filter every board for nothing.
const NO_CORE = new Set();

// ── The colours a year was actually played in ─────────────────────
// Each edition's own, off its SCOREBOARD banner and shipped on the archive
// row (pipeline/team-brand.mjs). Without this the tab drew a decade of teams
// in whatever colours the CURRENT edition happens to use — the Sautering
// Irons' navy came out in 2026's green, and every winner on the year-by-year
// table was the same two colours whoever they were.
//
// Resolved through theme.brandAccent, which is the same treatment a branding
// doc gets when you switch INTO that year — so a year reads the same colour on
// this tab as it does on its own leaderboard. A side the banner says nothing
// about — 2016 to 2018 had no colour at all, and 2023 and 2024 wrote their
// second team in black on white — keeps the app's palette, which is what
// `teams` already holds.
const editionAccent = (edition, side, teams) =>
  brandAccent(edition?.brand?.[side]?.color) || teams[side].accent;
const NO_YEARS = [];

// ══════════════════════════════════════════════════════════════════
//  TOURNAMENT
// ══════════════════════════════════════════════════════════════════

// ── One year ──────────────────────────────────────────────────────
// A ROW in one table, not a card of its own. Eleven cards is eleven screens of
// scrolling to answer "which year was closest", and the answer was never on
// any one of them — a comparison needs the years next to each other, which is
// what a card with its own border is built to prevent.
//
// What the row lost is the losing side's name and the two big numbers. Neither
// was carrying its width: the score reads 42.5–40.5 in the same place, and
// the loser is the other team, which the winner's own colour already says.
//
// Tapping OPENS rather than switches. Switching edition hard-reloads the whole
// app onto another tournament, and that is too big a thing to be what a tap on
// a summary row does; it is a button inside, named.
const YEAR_COLS = "44px 1fr 74px 40px 14px";

function YearRow({ e, live, teams, open, onToggle }) {
  const teamA = editionAccent(e, "A", teams);
  const teamB = editionAccent(e, "B", teams);
  const accent = e.winnerSide === "A" ? teamA : e.winnerSide === "B" ? teamB : BC.t3;
  const result = e.halved ? "HALVED"
    : !e.complete ? (e.rounds.length ? "IN PROGRESS" : "NOT STARTED")
      : e.winner || "—";

  return (
    <div style={{ borderTop: hair(), background: live ? BC.amber + ALPHA.wash : "transparent" }}>
      <button onClick={onToggle} style={{
        display: "grid", gridTemplateColumns: YEAR_COLS, gap: 6, alignItems: "center",
        width: "100%", textAlign: "left", padding: "9px 14px",
        background: "transparent", border: "none", cursor: "pointer", fontFamily: FONT,
      }}>
        <span style={{ fontSize: FS.small, fontWeight: 800, color: BC.gold }}>{e.year}</span>
        <span style={{
          minWidth: 0, fontSize: FS.small, fontWeight: 700, color: accent, letterSpacing: 0.3,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{result}</span>
        <span style={{ fontSize: FS.small, fontWeight: 700, color: BC.t2, textAlign: "right" }}>
          {e.complete || e.rounds.length ? `${fmtPts(e.scoreA)}–${fmtPts(e.scoreB)}` : "—"}
        </span>
        <span style={{ fontSize: FS.small, fontWeight: 800, color: e.halved ? BC.t3 : BC.amberInk, textAlign: "right" }}>
          {e.halved ? "—" : e.complete ? fmtPts(e.margin) : ""}
        </span>
        <span style={{ fontSize: FS.small, color: BC.t3, transform: open ? "rotate(90deg)" : "none", display: "inline-block" }}>›</span>
      </button>

      {open && (
        <div style={{ borderTop: hair(), padding: "10px 14px 14px", background: BC.inp + ALPHA.wash }}>
          {/* The two sides in full, which the row above deliberately does not
              carry — and the location, which used to sit on the card head. */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8, fontSize: FS.small }}>
            <span style={{ fontWeight: 800, color: teamA }}>{e.teamA || "—"} {fmtPts(e.scoreA)}</span>
            <span style={{ color: BC.t3 }}>vs</span>
            <span style={{ fontWeight: 800, color: teamB }}>{e.teamB || "—"} {fmtPts(e.scoreB)}</span>
            <span style={{
              flex: 1, minWidth: 0, textAlign: "right", fontSize: FS.micro, color: BC.t3, letterSpacing: 0.4,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>{(e.location || "").toUpperCase()}</span>
          </div>
          {!e.rounds.length && (
            <div style={{ fontSize: FS.small, color: BC.t3 }}>Nothing played yet.</div>
          )}
          {/* Round by round, with the running total beside each — the column
              that turns four results into a story. */}
          {!!e.rounds.length && (
          <div style={{ display: "grid", gridTemplateColumns: "22px 1fr 62px 60px", gap: 6, alignItems: "center", ...eyebrow, marginBottom: 6 }}>
            <div>R</div><div>COURSE</div><div style={{ textAlign: "right" }}>ROUND</div><div style={{ textAlign: "right" }}>RUNNING</div>
          </div>
          )}
          {e.rounds.map((r) => (
            <div key={r.round} style={{ display: "grid", gridTemplateColumns: "22px 1fr 62px 60px", gap: 6, alignItems: "center", padding: "5px 0", borderTop: hair() }}>
              <div style={{ fontSize: FS.small, fontWeight: 800, color: BC.t3 }}>{r.round}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: FS.small, color: BC.t1, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.course || "—"}</div>
                <div style={{ fontSize: FS.micro, color: BC.t3, letterSpacing: 0.4 }}>
                  {formatLabel(r.format).toUpperCase()}{r.avgToPar != null ? ` · FIELD ${toParText(r.avgToPar)}` : ""}
                </div>
              </div>
              <div style={{ fontSize: FS.small, fontWeight: 700, textAlign: "right", color: BC.t2 }}>
                {fmtPts(r.ptsA)}–{fmtPts(r.ptsB)}
              </div>
              <div style={{
                fontSize: FS.small, fontWeight: 800, textAlign: "right",
                color: r.cumA > r.cumB ? teamA : r.cumB > r.cumA ? teamB : BC.t3,
              }}>{fmtPts(r.cumA)}–{fmtPts(r.cumB)}</div>
            </div>
          ))}

          {!live && (
            <button onClick={() => switchEdition(e.id, { namespaced: !!e.namespaced })} style={{
              width: "100%", marginTop: 12, padding: "10px 12px", borderRadius: 10,
              background: BC.amber + ALPHA.wash, border: `1px solid ${BC.amber + ALPHA.line}`,
              color: BC.amberInk, fontFamily: FONT, fontSize: FS.small, fontWeight: 800,
              letterSpacing: 0.6, cursor: "pointer",
            }}>OPEN {e.year} — LEADERBOARD, DRAW AND CARDS →</button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Cup records ───────────────────────────────────────────────────
// The half-dozen facts about the cup itself that nobody can get from a single
// year, computed over every year including the one being played.
function CupRecords({ data }) {
  const r = data.records;
  return (
    <Section label="Cup records" note={`${r.cupsPlayed} FINISHED`}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: r.hardest ? 12 : 0 }}>
        {r.closest && <Stat label="Closest" value={r.closest.year} sub={`${r.closest.winner} by ${fmtPts(r.closest.margin)}`} color={BC.amberInk} />}
        {r.biggest && <Stat label="Biggest" value={r.biggest.year} sub={`${r.biggest.winner} by ${fmtPts(r.biggest.margin)}`} />}
        {/* The WEEK, which the course passport cannot answer — it ranks
            rounds, and eight shots separate the hardest cup from the
            easiest. Own-ball rounds only, like the days below it. */}
        {r.hardestWeek && <Stat label="Hardest week" value={r.hardestWeek.year} sub={`FIELD ${toParText(r.hardestWeek.avgOwnToPar)}`} color={BC.danger} />}
        {r.easiestWeek && <Stat label="Easiest week" value={r.easiestWeek.year} sub={`FIELD ${toParText(r.easiestWeek.avgOwnToPar)}`} color={BC.green} />}
        {/* Ranked against the course's own rating rather than its par — see
            avgDiff in archiveFold. The number is how far over the rating the
            field went, which is the same shape as a to-par and a fairer one
            when no two rounds were played on the same course.
            The two pairs are the two kinds of day, ranked apart: a scramble
            field comes in around level and would take both ends of one
            board. */}
        {r.hardest && <Stat label="Hardest day" value={toParText(r.hardest.difficulty)} sub={`${r.hardest.course} · ${r.hardest.year}`} color={BC.danger} />}
        {r.easiest && <Stat label="Easiest day" value={toParText(r.easiest.difficulty)} sub={`${r.easiest.course} · ${r.easiest.year}`} color={BC.green} />}
        {r.hardestShared && <Stat label="Hardest shared ball" value={toParText(r.hardestShared.difficulty)} sub={`${formatLabel(r.hardestShared.format).toUpperCase()} · ${r.hardestShared.year}`} color={BC.danger} />}
        {r.easiestShared && <Stat label="Easiest shared ball" value={toParText(r.easiestShared.difficulty)} sub={`${formatLabel(r.easiestShared.format).toUpperCase()} · ${r.easiestShared.year}`} color={BC.green} />}
      </div>
      {!!r.halved.length && (
        <div style={{ fontSize: FS.small, color: BC.t2, marginBottom: 6 }}>
          🏆 Halved: {r.halved.map((e) => e.year).join(", ")}
        </div>
      )}
      {/* The exact complement of the comeback board below: between them they
          sort every cup ever played into one of two kinds. A line rather than
          a board because the years are the whole answer. */}
      {!!r.wireToWire?.length && (
        <div style={{ fontSize: FS.small, color: BC.t2, marginBottom: 12 }}>
          🏁 Wire to wire: {r.wireToWire.map((e) => e.year).sort().join(", ")}
        </div>
      )}
      <RecordList label="BIGGEST COMEBACK" rows={r.cupComebacks} render={(e) => (
        <>
          <span style={{ width: 34, color: BC.gold, fontWeight: 700 }}>{e.year}</span>
          <span style={{ flex: 1, minWidth: 0, color: BC.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.winner}</span>
          <span style={{ fontWeight: 800, color: BC.green }}>{fmtPts(e.deficit)} DN</span>
          <span style={{ width: 64, textAlign: "right", color: BC.t3 }}>AFTER R{e.after}</span>
        </>
      )} />
    </Section>
  );
}

// ── Where the cup turns ───────────────────────────────────────────
// Measured from a fixed side of each year so a swing is a swing whichever
// team was listed first. It answers the oldest argument in the group text:
// Round 4 is worth more than the rest and it is where the lead changes hands.
function RoundDrama({ data }) {
  const rows = data.roundDrama.filter((r) => r.years);
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.avgSwing), 1);
  return (
    <Section label="Where the cup turns" note="AVERAGE SWING PER ROUND">
      {rows.map((r) => (
        <div key={r.round} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: r.round === rows[0].round ? "none" : hair() }}>
          <div style={{ fontSize: FS.small, fontWeight: 800, color: BC.t3, width: 24 }}>R{r.round}</div>
          <div style={{ flex: 1, height: 8, background: BC.inp, borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${(r.avgSwing / max) * 100}%`, height: "100%", background: BC.amber, borderRadius: 4 }} />
          </div>
          <div style={{ fontSize: FS.small, fontWeight: 700, color: BC.t1, width: 34, textAlign: "right" }}>
            {r.avgSwing.toFixed(1)}
          </div>
          <div style={{ fontSize: FS.micro, color: BC.t3, width: 74, textAlign: "right", letterSpacing: 0.4 }}>
            {r.leadChanges ? `${r.leadChanges} LEAD CHG` : ""}
          </div>
        </div>
      ))}

      <div style={{ height: 14 }} />

      {/* The bars above count lead changes per ROUND NUMBER, averaged over
          ten years. These are the YEARS they happened in, which is the form
          anybody actually argues about. */}
      <RecordList label="LEAD CHANGES" rows={data.records.leadChanges} render={(e) => (
        <>
          <span style={{ width: 34, color: BC.gold, fontWeight: 700 }}>{e.year}</span>
          <span style={{ flex: 1, minWidth: 0, color: BC.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.winner || "—"}</span>
          <span style={{ fontWeight: 800, color: BC.amberInk }}>{e.changes}</span>
        </>
      )} />

      <RecordList label="BIGGEST ROUND" rows={data.records.roundRouts} render={(x) => (
        <>
          <span style={{ width: 34, color: BC.gold, fontWeight: 700 }}>{x.year}</span>
          <span style={{ flex: 1, minWidth: 0, color: BC.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.winner}</span>
          <span style={{ fontWeight: 800, color: BC.amberInk }}>{fmtPts(x.won)}–{fmtPts(x.lost)}</span>
          <span style={{ width: 28, textAlign: "right", color: BC.t3 }}>R{x.round}</span>
        </>
      )} />

      {/* A fact about the cup rather than about a team, and the other end of
          the same list. */}
      {!!data.records.roundsPlayed && (
        <div style={{ fontSize: FS.small, color: BC.t2 }}>
          ⚖️ {data.records.levelRounds} of {data.records.roundsPlayed} rounds finished level
        </div>
      )}
    </Section>
  );
}

// ── Ten years in one card ─────────────────────────────────────────
// The totals nobody can get from a board, and the thing people screenshot.
function CupTotals({ data }) {
  const t = data.records.totals;
  if (!t || !t.cards) return null;
  const n = (x) => x.toLocaleString();
  return (
    <Section label="The cup in numbers" note="EVERY YEAR">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
        <Stat label="Cups" value={n(t.cups)} />
        <Stat label="Matches" value={n(t.matches)} />
        <Stat label="Courses" value={n(t.courses)} />
        <Stat label="Cards" value={n(t.cards)} />
        <Stat label="Holes" value={n(t.holes)} />
        <Stat label="Birdies+" value={n(t.birdies)} color={BC.birdieRed} />
      </div>
    </Section>
  );
}

// ── The course passport ───────────────────────────────────────────
// A row per ROUND, not per course, because a day is what has a score: four
// weekends played the same course twice (2020's Harbor Shores among them) and
// the two days were nothing alike. No course has ever been played in two
// different YEARS, which is the fact about this trip worth putting on a
// screen — and the reason the ranking is what the field shot, since with
// nothing repeated there is no other comparison to make.
function Passport({ data }) {
  const [sort, setSort] = useState("year");
  const rows = useMemo(() => data.courses.filter((c) => c.course), [data.courses]);
  // Hardest first is two boards, not one. A scramble field comes in around
  // level and a shamble a few shots over, so ranked together the shared-ball
  // days take the whole bottom of the list and the reader is being told that
  // The Dream in 2024 played easier than anywhere else in ten years, when
  // what happened there is that two men played one ball. Same rule the
  // records use — see rankedDays in archiveFold.
  //
  // By year stays one list: that sort is a chronology, and nothing in it is
  // being compared with anything.
  const groups = useMemo(() => {
    if (sort !== "hard") return [{ key: "all", label: "", rows }];
    const byHard = (xs) => xs.slice().sort((a, b) => (b.avgToPar ?? -99) - (a.avgToPar ?? -99));
    return [
      { key: "own", label: "Own ball", rows: byHard(rows.filter((c) => c.ownBall)) },
      { key: "shared", label: "Shared ball", rows: byHard(rows.filter((c) => !c.ownBall)) },
    ].filter((g) => g.rows.length);
  }, [rows, sort]);
  const distinct = useMemo(() => new Set(rows.map((c) => c.course)).size, [rows]);

  return (
    <Section label="The courses" note={`${distinct} COURSES · ${rows.length} ROUNDS`}>
      <Chips options={[["year", "By year"], ["hard", "Hardest first"]]} value={sort} onChange={setSort} />
      {groups.map((g, gi) => (
        <div key={g.key}>
          {groups.length > 1 && (
            <div style={{ ...eyebrow, marginTop: gi ? 14 : 0, marginBottom: 2 }}>{g.label.toUpperCase()}</div>
          )}
          {g.rows.map((c) => (
            <div key={`${c.year}_${c.round}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: hair() }}>
              <div style={{ fontSize: FS.micro, fontWeight: 800, color: BC.t3, width: 46, letterSpacing: 0.4 }}>{c.year} R{c.round}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: FS.small, color: BC.t1, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.course}</div>
                <div style={{ fontSize: FS.micro, color: BC.t3, letterSpacing: 0.4 }}>
                  {/* The format on a shared-ball day only. It is what the
                      number under it means — the side's ball, not a man's —
                      and the own-ball days are the norm this tab already
                      assumes everywhere else. */}
                  {!c.ownBall && `${formatLabel(c.format).toUpperCase()} · `}
                  PAR {c.par}{c.slope ? ` · ${c.rating}/${c.slope}` : ""}{c.low ? ` · LOW ${c.low}` : ""}
                </div>
              </div>
              <div style={{ fontSize: FS.small, fontWeight: 800, color: (c.avgToPar ?? 0) > 12 ? BC.danger : BC.t2, width: 44, textAlign: "right" }}>
                {toParText(c.avgToPar)}
              </div>
            </div>
          ))}
        </div>
      ))}
    </Section>
  );
}

function TournamentHalf({ data, editions, activeYear, teams }) {
  // The running year opens on arrival — it is the one somebody is most likely
  // to have come for — unless it has nothing in it yet, in which case opening
  // it just shows an empty panel.
  const [open, setOpen] = useState(
    () => (data.edition(activeYear)?.rounds.length ? activeYear : null));
  // The archive knows the years that have been PLAYED; bc_editions knows the
  // years that EXIST, including one a director created this morning with
  // nothing in it. Joined here rather than in the fold, so a new edition shows
  // up on the tab the moment it is made.
  const rows = useMemo(() => {
    const meta = new Map((editions || []).filter((e) => e.year).map((e) => [e.year, e]));
    const seen = new Set(data.editions.map((e) => e.year));
    const extra = [...meta.values()].filter((e) => !seen.has(e.year)).map((e) => ({
      year: e.year, teamA: "", teamB: "", scoreA: 0, scoreB: 0, complete: false, halved: false,
      winner: null, winnerSide: null, margin: 0, rounds: [], field: 0, roster: [],
    }));
    return [...data.editions, ...extra]
      .map((e) => ({ ...e, id: meta.get(e.year)?.id || `bc_${e.year}`, namespaced: !!meta.get(e.year)?.namespaced,
        location: meta.get(e.year)?.result?.location || "" }))
      .sort((a, b) => b.year - a.year);
  }, [data.editions, editions]);

  // Year or margin. Two chips rather than tappable column heads: a head that
  // sorts has to say so, and saying so costs more width than this table has.
  //
  // Margin runs BIGGEST first, which is the reading of "sort by margin" — and
  // the closest year is already a Stat at the top of Cup records, so the one
  // this order buries is the one that is hardest to miss.
  const [sort, setSort] = useState("year");
  const sorted = useMemo(() => rows.slice().sort((a, b) => {
    if (sort === "year") return b.year - a.year;
    // An unfinished cup has no margin of victory — nobody has won by
    // anything yet — so it sits under the years that do rather than being
    // ranked on a number that is still moving.
    const am = a.complete && !a.halved ? a.margin : -1;
    const bm = b.complete && !b.halved ? b.margin : -1;
    return bm - am || b.year - a.year;
  }), [rows, sort]);

  if (!rows.length) return <Empty>No years yet</Empty>;

  return (
    <div>
      <CupRecords data={data} />
      <div style={{ ...card, overflow: "hidden" }}>
        <div style={{ padding: "14px 14px 0" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
            <div style={eyebrow}>YEAR BY YEAR</div>
            <div style={{ fontSize: FS.micro, color: BC.t3, letterSpacing: 0.4, marginLeft: "auto" }}>
              {rows.length} CUPS
            </div>
          </div>
          <Chips
            options={[["year", "Year"], ["margin", "Margin"]]}
            value={sort} onChange={setSort}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: YEAR_COLS, gap: 6, padding: "0 14px 8px", ...eyebrow }}>
          <div>YEAR</div><div>WINNER</div>
          <div style={{ textAlign: "right" }}>SCORE</div>
          <div style={{ textAlign: "right" }}>MGN</div><div />
        </div>
        {sorted.map((e) => (
          <YearRow
            key={e.year} e={e} teams={teams}
            live={e.year === activeYear}
            open={open === e.year}
            onToggle={() => setOpen(open === e.year ? null : e.year)}
          />
        ))}
      </div>
      <RoundDrama data={data} />
      <Passport data={data} />
      <CupTotals data={data} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  PLAYER
// ══════════════════════════════════════════════════════════════════

const WLH = ({ w, l, h }) => (
  <span>
    <span style={{ color: BC.green }}>{w}</span>
    <span style={{ color: BC.t3 }}>–</span>
    <span style={{ color: BC.danger }}>{l}</span>
    <span style={{ color: BC.t3 }}>–{h}</span>
  </span>
);

// ── One man's card ────────────────────────────────────────────────
// Everything about him that needed ten years to be worth saying. Behind a tap
// because eight numbers across a phone is either unreadable or a sideways
// scroll — the same reason the table above it is two rows per player rather
// than eight columns.
function PlayerCard({ p, data, activeYear }) {
  // The basis lives here rather than on the table's header, because the table
  // no longer shows a gross or net number — this card is the only thing left
  // that does, and a control belongs with what it controls.
  const [basis, setBasis] = useState("gross");
  const net = basis === "net";
  const partners = useMemo(() => data.partnersOf(p.id).slice(0, 6), [data, p.id]);
  const h2h = useMemo(() => data.h2hOf(p.id).filter((r) => r.matches).slice(0, 6), [data, p.id]);
  // Record only, no rate. Points per match is comparable BETWEEN PLAYERS and
  // not between formats — Round 4 is one team match worth twenty-seven points
  // and a singles is worth three — so a column of them down a page of formats
  // invites exactly the comparison it cannot support.
  const formats = useMemo(() => Object.entries(p.byFormat)
    .map(([f, v]) => ({ f, ...v }))
    .sort((a, b) => b.matches - a.matches), [p.byFormat]);

  const line = { display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderTop: hair(), fontSize: FS.small };
  const bestRound = net ? p.bestNet : p.best;
  const rate = net ? p.birdiesPerRoundNet : p.birdiesPerRound;

  return (
    <div style={{ padding: "10px 14px 14px", borderTop: hair() }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <BasisToggle value={basis} onChange={setBasis} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
        <Stat label="Cups" value={p.apps} sub={p.debut === p.last ? `${p.debut}` : `${p.debut}–${p.last}`} />
        <Stat label="Won" value={p.cupsWon} sub={p.cupsHalved ? `${p.cupsHalved} halved` : null} color={BC.green} />
        <Stat label="Pts/match" value={p.ppm == null ? "—" : p.ppm.toFixed(2)} sub={`${p.rounds} RDS`} />
        <Stat
          label={net ? "Avg net" : "Avg round"}
          value={toParText(net ? p.avgNetToPar : p.avgToPar)}
          sub={`${net ? p.netRounds : p.rounds} RDS`}
        />
      </div>

      {/* Both, never one. Gross is who plays the best golf and net is who
          plays best to his number, and they answer differently often enough
          that showing either alone picks a side in the argument. */}
      {(p.sg != null || p.sgNetPer != null) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 14 }}>
          <Stat
            label="SG gross / rd" value={fmtSg(p.sg)} sub={`${p.sgRounds} RDS · VS FIELD`}
            color={sgColor(p.sg)}
          />
          <Stat
            label="SG net / rd" value={fmtSg(p.sgNetPer)} sub={`${p.sgNets} RDS · VS FIELD`}
            color={sgColor(p.sgNetPer)}
          />
        </div>
      )}

      {/* 9.0 is average, so the colour turns on nine rather than on zero. */}
      {p.matRoy != null && (
        <div style={{ fontSize: FS.small, color: BC.t2, marginBottom: 12 }}>
          <strong style={{ color: BC.amberInk }}>Match Royale</strong>
          {" — "}{royaleHoles(p.matRoy).toFixed(1)} of 18 holes' worth of the field beaten
          <span style={{ color: royaleHoles(p.matRoy) >= 9 ? BC.green : BC.danger, fontWeight: 700 }}>
            {` (${royaleHoles(p.matRoy) >= 9 ? "+" : ""}${(royaleHoles(p.matRoy) - 9).toFixed(1)})`}
          </span>
        </div>
      )}

      {bestRound && (
        <div style={{ fontSize: FS.small, color: BC.t2, marginBottom: 12 }}>
          <strong style={{ color: BC.amberInk }}>{net ? "Best net round" : "Best round"}</strong>
          {" — "}{net ? bestRound.net : bestRound.gross} ({fmtScore(net ? bestRound.netToPar : bestRound.toPar)})
          {bestRound.course ? ` at ${bestRound.course}` : ""} · {bestRound.year} R{bestRound.round}
        </div>
      )}

      {/* The card, not the match: birdies are his alone whatever format the
          round was played in. Net counts come off the per-hole marks, gross
          off the round summary — see netOf in lib/archiveFold. */}
      <div style={eyebrow}>{net ? "THE CARD · NET" : "THE CARD · GROSS"}</div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "6px 0 14px", fontSize: FS.small, color: BC.t2 }}>
        <span>🦅 {net ? p.nE : p.e}</span>
        <span style={{ color: BC.birdieRed }}>● {net ? p.nB : p.b} birdies</span>
        <span>PAR {net ? p.nP : p.pr}</span>
        <span>BOGEY {net ? p.nBo : p.bo}</span>
        <span>DBL+ {net ? p.nD : p.d}</span>
        {rate != null && <span style={{ color: BC.t3 }}>{rate.toFixed(1)}/RD</span>}
      </div>

      {(p.comebacks > 0 || p.collapses > 0) && (
        <div style={{ fontSize: FS.small, color: BC.t2, marginBottom: 14 }}>
          <strong style={{ color: BC.amberInk }}>At the turn</strong> — won {p.comebacks} from three down
          {p.collapses ? `, lost ${p.collapses} from three up` : ""}.
        </div>
      )}

      <div style={eyebrow}>BY YEAR</div>
      <div style={{ marginBottom: 14 }}>
        {p.byYear.map((y) => (
          <div key={y.year} style={line}>
            <span style={{ width: 34, fontWeight: 800, color: y.year === activeYear ? BC.amberInk : BC.t3 }}>{y.year}</span>
            <span style={{ flex: 1, minWidth: 0, color: BC.t3, fontSize: FS.micro, letterSpacing: 0.4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {(y.teamName || "").toUpperCase()}
            </span>
            <span style={{ width: 62, textAlign: "right" }}><WLH w={y.w} l={y.l} h={y.h} /></span>
            <span style={{ width: 42, textAlign: "right", fontWeight: 700, color: BC.amberInk }}>{fmtPts(y.pts)}</span>
            <span style={{ width: 34, textAlign: "right", color: BC.t3 }}>{toParText(net ? y.avgNetToPar : y.avgToPar)}</span>
          </div>
        ))}
      </div>

      {!!formats.length && (
        <>
          <div style={eyebrow}>BY FORMAT</div>
          <div style={{ marginBottom: 14 }}>
            {formats.map((f) => (
              <div key={f.f} style={line}>
                <span style={{ flex: 1, minWidth: 0, color: BC.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{formatLabel(f.f)}</span>
                <span style={{ width: 62, textAlign: "right" }}><WLH w={f.w} l={f.l} h={f.h} /></span>
                <span style={{ width: 46, textAlign: "right", color: BC.t3 }}>{f.matches} M</span>
              </div>
            ))}
          </div>
        </>
      )}

      {!!partners.length && (
        <>
          {/* Two-man sides only. Round 4 puts seven men against seven, and
              calling all twenty-one of those pairs a partnership would bury
              the four-ball record under teammates who never shared a hole. */}
          <div style={eyebrow}>PARTNERS</div>
          <div style={{ marginBottom: 14 }}>
            {partners.map((x) => (
              <div key={x.with} style={line}>
                <span style={{ flex: 1, minWidth: 0, color: BC.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.withName}</span>
                <span style={{ width: 62, textAlign: "right" }}><WLH w={x.w} l={x.l} h={x.h} /></span>
                <span style={{ width: 46, textAlign: "right", color: BC.t3 }}>{x.matches} M</span>
              </div>
            ))}
          </div>
        </>
      )}

      {!!h2h.length && (
        <>
          {/* Singles only — the one format where the two names on the card are
              the whole story. */}
          <div style={eyebrow}>SINGLES, HEAD TO HEAD</div>
          <div>
            {h2h.map((x) => (
              <div key={x.against} style={line}>
                <span style={{ flex: 1, minWidth: 0, color: BC.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.againstName}</span>
                <span style={{ width: 62, textAlign: "right" }}><WLH w={x.w} l={x.l} h={x.h} /></span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Personal records ──────────────────────────────────────────────
function PlayerRecords({ data, note = "ALL YEARS" }) {
  const [basis, setBasis] = useState("gross");
  const net = basis === "net";
  const r = data.records;
  const list = (label, rows, render) => <RecordList label={label} rows={rows} render={render} />;

  return (
    <Section label="Records" note={note} action={<BasisToggle value={basis} onChange={setBasis} />}>
      {/* OWN BALL is the whole qualification, and it belongs on the label:
          without it the list silently drops a scramble 62 that two men still
          talk about, and nothing on the screen says why. */}
      {list("LOW ROUNDS · OWN BALL", net ? r.lowRoundsNet : r.lowRounds, (c) => (
        <>
          <span style={{ flex: 1, minWidth: 0, color: BC.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
          <span style={{ fontWeight: 800, color: BC.amberInk }}>{net ? c.net : c.g}</span>
          <span style={{ width: 34, textAlign: "right", color: BC.t3 }}>{fmtScore(net ? c.netToPar : c.tp)}</span>
          <span style={{ width: 34, textAlign: "right", color: BC.t3 }}>{c.year}</span>
        </>
      ))}
      {/* One row a round, numbered by ROUND rather than by rank — the round
          number is what the row is about, and 1..4 down the left would read
          as a leaderboard of four men. */}
      {!!(net ? r.bestByRoundNet : r.bestByRound)?.length && (
        <div style={{ marginBottom: 12 }}>
          <div style={eyebrow}>BEST BY ROUND · OWN BALL</div>
          {(net ? r.bestByRoundNet : r.bestByRound).map((c, i) => (
            <div key={c.round} style={{ display: "flex", gap: 8, padding: "4px 0", borderTop: i ? hair() : "none", fontSize: FS.small }}>
              <span style={{ width: 20, color: BC.t3, fontWeight: 800 }}>R{c.round}</span>
              <span style={{ flex: 1, minWidth: 0, color: BC.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
              <span style={{ fontWeight: 800, color: BC.amberInk }}>{net ? c.net : c.g}</span>
              <span style={{ width: 34, textAlign: "right", color: BC.t3 }}>{fmtScore(net ? c.netToPar : c.tp)}</span>
              <span style={{ width: 34, textAlign: "right", color: BC.t3 }}>{c.year}</span>
            </div>
          ))}
        </div>
      )}
      {list("BEST WEEK", net ? r.bestWeeksNet : r.bestWeeks, (w) => (
        <>
          <span style={{ flex: 1, minWidth: 0, color: BC.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.name}</span>
          <span style={{ fontWeight: 800, color: BC.amberInk }}>{fmtScore(w.toPar)}</span>
          <span style={{ width: 34, textAlign: "right", color: BC.t3 }}>{w.year}</span>
        </>
      ))}
      {list("MOST POINTS IN A CUP", r.mostPoints, (y) => (
        <>
          <span style={{ flex: 1, minWidth: 0, color: BC.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{y.name}</span>
          <span style={{ fontWeight: 800, color: BC.amberInk }}>{fmtPts(y.pts)}</span>
          <span style={{ width: 34, textAlign: "right", color: BC.t3 }}>{y.year}</span>
        </>
      ))}
      {/* The workbook's own metric, in the form it printed it: holes' worth of
          the field beaten. 9.0 is dead average — half of fifteen opponents
          over eighteen holes — which is why it is worth a label rather than a
          bare fraction nobody can place. */}
      {list("MATCH ROYALE · HOLES OF THE FIELD BEATEN", r.matRoy, (p) => (
        <>
          <span style={{ flex: 1, minWidth: 0, color: BC.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
          {/* Two places. A career average over forty rounds regresses hard
              toward nine, so one decimal prints the whole core board as 9.3,
              9.3, 9.2, 9.2, 9.2 — a ranking nobody can read. */}
          <span style={{ width: 38, textAlign: "right", fontWeight: 800, color: BC.amberInk }}>{royaleHoles(p.matRoy).toFixed(2)}</span>
          <span style={{ width: 52, textAlign: "right", color: BC.t3 }}>{p.mrRounds} RDS</span>
        </>
      ))}
      {list("MATCH ROYALE · BEST ROUND · OWN BALL", r.matRoyRounds, (c) => (
        <>
          <span style={{ flex: 1, minWidth: 0, color: BC.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
          <span style={{ width: 38, textAlign: "right", fontWeight: 800, color: BC.amberInk }}>{royaleHoles(c.mr).toFixed(1)}</span>
          <span style={{ width: 52, textAlign: "right", color: BC.t3 }}>{c.year} R{c.round}</span>
        </>
      ))}
      {list("BIRDIES OR BETTER", net ? r.mostBirdiesNet : r.mostBirdies, (p) => (
        <>
          <span style={{ flex: 1, minWidth: 0, color: BC.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
          <span style={{ fontWeight: 800, color: BC.birdieRed }}>{net ? p.nE + p.nB : p.e + p.b}</span>
          <span style={{ width: 52, textAlign: "right", color: BC.t3 }}>{net ? p.netRounds : p.rounds} RDS</span>
        </>
      ))}
      {/* Twelve matches is three cups' worth. Below that one hot weekend tops
          the list forever, which is a record about sample size. */}
      {list("POINTS PER MATCH", r.bestRate, (p) => (
        <>
          <span style={{ flex: 1, minWidth: 0, color: BC.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
          <span style={{ fontWeight: 800, color: BC.amberInk }}>{p.ppm.toFixed(2)}</span>
          <span style={{ width: 52, textAlign: "right", color: BC.t3 }}>{p.matches} M</span>
        </>
      ))}
      {list("BACK FROM THREE DOWN", r.comebacks, (p) => (
        <>
          <span style={{ flex: 1, minWidth: 0, color: BC.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
          <span style={{ fontWeight: 800, color: BC.green }}>{p.comebacks}</span>
        </>
      ))}
    </Section>
  );
}

// ── Strokes gained ────────────────────────────────────────────────
// Against the field, which the note says because "strokes gained" with no
// benchmark named is not a number anybody can read. See archiveFold: this is
// SG Total — the field's average less his own, inside one round so the course
// and the day cancel — and deliberately not the shot-level split, which a
// scorecard cannot support because it does not know where the ball was.
function StrokesGained({ data, note = "" }) {
  const [basis, setBasis] = useState("gross");
  const net = basis === "net";
  const sg = data.strokesGained;
  if (!sg) return null;
  // One basis, the one the chip asks for. It used to draw both boards, on the
  // argument that gross is who plays the best golf and net is who plays best
  // to his handicap and showing either alone picks a side — which was right
  // while nothing on screen let anybody choose. A chip is the better answer
  // to it: the reader picks, and the section is half as long.
  const perRound = net ? sg.net : sg.gross;
  const bestRound = net ? sg.bestNet : sg.best;
  if (!(perRound.length || bestRound.length)) return null;
  const rate = (key, rounds) => (p) => (
    <>
      <span style={{ flex: 1, minWidth: 0, color: BC.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
      <span style={{ width: 48, textAlign: "right", fontWeight: 800, color: sgColor(p[key]) }}>{fmtSg(p[key])}</span>
      <span style={{ width: 52, textAlign: "right", color: BC.t3 }}>{p[rounds]} RDS</span>
    </>
  );

  return (
    <Section
      label="Strokes gained" note={`${note ? `${note} · ` : ""}VS FIELD`}
      action={<BasisToggle value={basis} onChange={setBasis} />}
    >
      {/* OWN BALL rides the board labels — it is a fact about which rounds
          counted, and the boards are what it is a fact about. The BASIS does
          not: the toggle in the header above says which, and repeating it on
          every label is the restatement the house style keeps off a phone. */}
      <RecordList
        label="PER ROUND · OWN BALL" rows={perRound}
        render={net ? rate("sgNetPer", "sgNets") : rate("sg", "sgRounds")}
      />
      <RecordList label="BEST ROUND · OWN BALL" rows={bestRound} render={(r) => (
        <>
          <span style={{ flex: 1, minWidth: 0, color: BC.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
          <span style={{ width: 48, textAlign: "right", fontWeight: 800, color: sgColor(r.sg) }}>{fmtSg(r.sg)}</span>
          <span style={{ width: 52, textAlign: "right", color: BC.t3 }}>{r.year} R{r.round}</span>
        </>
      )} />
    </Section>
  );
}

// ── Streaks ───────────────────────────────────────────────────────
// Two cards rather than one, because nine boards in a single card is a wall
// and the split does the grouping that a sentence would otherwise have to.
// The hole streaks are all inside one cup (see archiveFold), so the span on
// the right is always a week somebody could go and check.
function Streaks({ data, note = "ALL YEARS" }) {
  const s = data.streaks;
  const row = (color) => (x) => (
    <>
      <span style={{ flex: 1, minWidth: 0, color: BC.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.name}</span>
      <span style={{ width: 26, textAlign: "right", fontWeight: 800, color }}>{x.len}</span>
      <span style={{ width: 84, textAlign: "right", color: BC.t3, fontSize: FS.micro }}>{streakWhere(x)}</span>
    </>
  );
  const hot = row(BC.amberInk);
  const cold = row(BC.danger);
  const any = (...boards) => boards.some((b) => b && b.length);

  if (!any(s.cupsWon, s.cupsWonNow, s.matchWins, s.holesWon, s.netPar, s.noDouble,
    s.cupsLost, s.cupsLostNow, s.winless, s.holesLost, s.noPar)) return null;

  return (
    <>
      {any(s.cupsWon, s.cupsWonNow, s.matchWins, s.holesWon, s.netPar, s.noDouble) && (
        <Section label="Streaks" note={note}>
          <RecordList label="CUPS WON IN A ROW" rows={s.cupsWon} render={hot} />
          {/* The run still going, beside the best there has ever been. */}
          <RecordList label="CUPS WON IN A ROW · CURRENT" rows={s.cupsWonNow} render={hot} />
          <RecordList label="MATCHES WON IN A ROW" rows={s.matchWins} render={hot} />
          <RecordList label="HOLES WON IN A ROW" rows={s.holesWon} render={hot} />
          {/* OWN BALL, like LOW ROUNDS above and for the same reason — a net
              par on a scramble ball is a par the side made. */}
          <RecordList label="NET PAR OR BETTER · OWN BALL" rows={s.netPar} render={hot} />
          <RecordList label="HOLES WITHOUT A NET DOUBLE" rows={s.noDouble} render={hot} />
        </Section>
      )}
      {any(s.cupsLost, s.cupsLostNow, s.winless, s.holesLost, s.noPar) && (
        <Section label="Cold streaks" note={note}>
          <RecordList label="CUPS LOST IN A ROW" rows={s.cupsLost} render={cold} />
          <RecordList label="CUPS LOST IN A ROW · CURRENT" rows={s.cupsLostNow} render={cold} />
          <RecordList label="MATCHES WITHOUT A WIN" rows={s.winless} render={cold} />
          <RecordList label="HOLES LOST IN A ROW" rows={s.holesLost} render={cold} />
          <RecordList label="HOLES WITHOUT A NET PAR" rows={s.noPar} render={cold} />
        </Section>
      )}
    </>
  );
}

// ── The career table ──────────────────────────────────────────────
// Two rows per player, not eight columns: eight numbers across a phone is
// either unreadable or a horizontal scroll, and the second row is the quieter
// half by design — the record is what people came for.
//
// `scope` is the one place a year gets to matter on this half. It is not the
// old NOW/THEN split coming back through the window: both scopes are about
// the same subject, and the default is the career, because that is the thing
// this tab could not say before.
// ── The standing ──────────────────────────────────────────────────
// Two records and the points they add up to. It used to carry a sub-line as
// well — rounds, scoring average, best round, form — which is four more
// numbers on the row a man reads to find his own name, and every one of them
// is on the card behind the tap where there is room to label it.
//
// Cups as a record rather than a count, because "10 CUPS" says he turned up
// and 5–4–1 says how it went. The same shape as the match record beside it
// and as the head-to-heads on the card, so one reading serves all three.
function CareerTable({ rows, teamOf, myId, activeYear, data, open, setOpen }) {
  if (!rows.length) return <Empty>No players yet</Empty>;
  const COLS = "1fr 56px 68px 50px";
  const head = { fontSize: FS.label, fontWeight: 700, color: BC.t3, letterSpacing: 1, textAlign: "center" };

  return (
    <div style={{ ...card, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: COLS, padding: "8px 12px", borderBottom: `1px solid ${BC.bdr}`, ...head, textAlign: "left" }}>
        <div>PLAYER</div>
        <div style={head}>CUPS</div>
        <div style={head}>MATCHES</div>
        <div style={{ ...head, textAlign: "right" }}>PTS</div>
      </div>
      {rows.map((p, i) => {
        const isOpen = open === p.id;
        const mine = p.id === myId;
        return (
          <div key={p.id} style={{ borderBottom: i < rows.length - 1 ? hair() : "none", background: mine ? BC.amber + ALPHA.wash : "transparent" }}>
            <button onClick={() => setOpen(isOpen ? null : p.id)} style={{
              display: "block", width: "100%", textAlign: "left", padding: "8px 12px",
              background: "transparent", border: "none", cursor: "pointer", fontFamily: FONT,
            }}>
              <div style={{ display: "grid", gridTemplateColumns: COLS, alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: teamOf(p.id) || BC.t3, flexShrink: 0 }} />
                  <span style={{
                    fontSize: FS.small, fontWeight: mine ? 800 : 600, color: playerNameColor(),
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>{p.name}</span>
                  <span style={{ fontSize: FS.small, color: BC.t3, transform: isOpen ? "rotate(90deg)" : "none", display: "inline-block" }}>›</span>
                </div>
                <div style={{ fontSize: FS.small, fontWeight: 600, textAlign: "center" }}>
                  <WLH w={p.cupsWon} l={p.cupsLost} h={p.cupsHalved} />
                </div>
                <div style={{ fontSize: FS.small, fontWeight: 600, textAlign: "center" }}>
                  <WLH w={p.w} l={p.l} h={p.h} />
                </div>
                <div style={{ fontSize: FS.small, fontWeight: 700, textAlign: "right", color: BC.amberInk }}>{fmtPts(p.pts)}</div>
              </div>
            </button>
            {isOpen && <PlayerCard p={p} data={data} activeYear={activeYear} />}
          </div>
        );
      })}
    </div>
  );
}

function PlayerHalf({ data, activeYear, myId, teams }) {
  const [scope, setScope] = useState("career");
  // ── Who is in the table ──────────────────────────────────────────
  // The core sixteen by default, because the other eight are men who came
  // once and the standing is a ten-year standing: a table sorted on points
  // puts a one-cup guest among the regulars with a tenth of their golf behind
  // him, and there is no column that says so.
  //
  // It filters the RECORD BOARDS as well as the table, which is the only
  // reading that holds together — a Core 16 table above an all-time low round
  // by a man the table has just hidden is two answers to one question. Every
  // section says which set it is showing, because the chips are at the top of
  // a long screen and a board halfway down it has to stand on its own.
  //
  // ALL is one tap away, and it is where the whole record lives: John S's 64
  // is the lowest round anybody has played here and he played two cups.
  const [field, setField] = useState("core");
  const [open, setOpen] = useState(null);

  const core = data.core || NO_CORE;
  // How many cups back "recent" reaches. Three to begin with, because that is
  // the answer most people want, and a stepper because which of two, three or
  // four is a question about what the reader is looking for.
  const [back, setBack] = useState(RECENT_CUPS);
  const recentMax = data.recentMax || RECENT_CUPS;
  const depth = Math.min(Math.max(RECENT_MIN, back), recentMax);
  const recentYears = useMemo(
    () => (data.recentYears ? data.recentYears(depth) : NO_YEARS),
    [data, depth],
  );
  const onlyCore = field === "core" && core.size > 0;
  // Asked of the fold rather than filtered here, because a board has to be
  // cut to the field BEFORE it is cut to five: filtering a finished top five
  // down to the core leaves LOW ROUNDS with one line on it, the other four
  // being John S, who played two cups and holds the four lowest rounds here.
  const boards = useMemo(
    () => (onlyCore && data.boards ? data.boards(core) : data),
    [data, core, onlyCore],
  );
  const fieldNote = onlyCore
    ? `CORE ${core.size}`
    : `ALL ${data.career.filter((p) => p.apps || p.matches).length}`;


  const thisYear = data.edition(activeYear);
  const teamOf = useMemo(() => {
    const m = new Map((thisYear?.roster || []).map((r) => [r.p, r.t === "B" ? teams.B.accent : teams.A.accent]));
    return (id) => m.get(id) || null;
  }, [thisYear, teams]);

  // Career, or this year's field with this year's numbers. The same rows
  // either way — a scope is which slice of a man's record you are reading,
  // not a different table.
  const rows = useMemo(() => {
    const mine = (p) => (p.apps || p.matches) && (!onlyCore || core.has(p.id));
    if (scope === "career") return data.career.filter(mine);
    // Both slices go through the same re-totaller. A single year used to be
    // stitched together here from `byYear`, which carried no cup result — so
    // the CUPS column would have shown a man's whole decade beside one year's
    // matches. careerOver re-asks the edition, so it cannot.
    const years = scope === "recent" ? recentYears : [activeYear];
    return (data.careerOver?.(years) || []).filter(mine);
  }, [data, core, onlyCore, scope, activeYear, recentYears]);

  // Yours first. Not a sort — the table's order is the standing and moving a
  // man up it would be a lie — so the row is highlighted where it belongs and
  // this scrolls nothing.
  return (
    <div>
      {/* Two axes, one line. Which slice of a man's record on the left, which
          men on the right — they are different questions and a single row of
          four chips would read as one. */}
      <div style={{ display: "flex", gap: 8, justifyContent: "space-between", flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <Chips
            options={[["career", "Career"], ["recent", `Last ${recentYears.length}`], ["year", String(activeYear)]]}
            value={scope} onChange={(v) => { setScope(v); setOpen(null); }}
            style={{ marginBottom: 0 }}
          />
          {scope === "recent" && (
            <Stepper
              value={depth} min={RECENT_MIN} max={recentMax} label="Cups back"
              onChange={(v) => { setBack(v); setOpen(null); }}
            />
          )}
        </div>
        {core.size > 0 && (
          <Chips
            options={[["core", `Core ${core.size}`], ["all", "All"]]}
            value={field} onChange={(v) => { setField(v); setOpen(null); }}
            style={{ marginBottom: 0 }}
          />
        )}
      </div>
      <CareerTable
        rows={rows} teamOf={teamOf} myId={myId} activeYear={activeYear}
        data={data} open={open} setOpen={setOpen}
      />
      {scope === "career" && <PlayerRecords data={boards} note={fieldNote} />}
      {scope === "career" && <StrokesGained data={boards} note={fieldNote} />}
      {/* Not the basis. NET PAR OR BETTER and HOLES WITHOUT A NET DOUBLE are
          net by construction — they are read off the net marks and there is
          no gross reading of them to offer. The labels say so themselves. */}
      {scope === "career" && <Streaks data={boards} note={fieldNote} />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  The screen
// ══════════════════════════════════════════════════════════════════
export default function DataView({
  tPlayers, matches, holeData, tRounds, courses, hcpOverrides, teeAssignments,
  roundLocks, teamNames, editions, activeYear, teams, myPlayerId, isDemo = false,
}) {
  const [tab, setTab] = useState("tournament");

  // The running edition, handed over raw. useArchive turns it into archive
  // rows itself, because that conversion needs the player registry and the
  // registry is inside the chunk it is fetching.
  //
  // NULL ON A DEMO TOURNAMENT, which switches the fold off entirely and leaves
  // this tab showing the ten real years alone. A demo's field and courses are
  // invented (lib/demoSeed), and folding it would add twelve golfers who do
  // not exist to the career table, two courses nobody has played to the
  // passport, and a cup to the tournament records that was never contested.
  // The record is the one screen in the app where a made-up row is not
  // recoverable by looking — every number on it is an aggregate, so a wrong
  // one just reads as history.
  const input = useMemo(() => (isDemo ? null : {
    year: activeYear, tPlayers, matches, holeData, tRounds, courses,
    hcpOverrides, teeAssignments, roundLocks, teamNames,
  }), [isDemo, activeYear, tPlayers, matches, holeData, tRounds, courses,
    hcpOverrides, teeAssignments, roundLocks, teamNames]);

  const { data, live, loading, error } = useArchive(input);
  // Which row is yours. A roster row is one year of one golfer; the career
  // table is keyed on the golfer, so it has to go through the same resolver
  // everything else does.
  const myId = live?.ids?.get(myPlayerId) || null;

  return (
    <div style={{ fontFamily: FONT }}>
      {/* Tournament / Player switch — pinned, same as every other tab's lead
          control, so it sits where the eye already expects a tab switcher.
          The labels name a SUBJECT, not a year. */}
      <StickyTop padBottom={14}>
        <SegmentedToggle
          options={[["tournament", "Tournament"], ["player", "Player"]]}
          value={tab} onChange={setTab}
        />
      </StickyTop>

      {loading && <Empty icon="⏳">Loading ten years…</Empty>}

      {/* Said, rather than left as an absence. A director on the demo who
          posts a round and then finds it nowhere in the records would
          reasonably read that as the tab being broken. One line is cheaper
          than that support question, and it is only ever on screen for
          somebody who is deliberately inside a demo. */}
      {isDemo && !loading && !error && (
        <div style={{
          margin: "0 0 14px", padding: "9px 12px", borderRadius: 8,
          background: `${BC.bg}${ALPHA.panel}`, border: `1px solid ${BC.bdr}`,
          fontSize: FS.label, color: BC.t3, lineHeight: 1.45, textAlign: "center",
        }}>
          You&apos;re in a demo tournament. Nothing played here counts towards these records.
        </div>
      )}

      {error && (
        <Empty icon="📵">
          Couldn&apos;t load the archive
          <div style={{ fontSize: FS.small, fontWeight: 500, marginTop: 6, color: BC.t3 }}>
            It is part of the app, not the tournament — reopening the tab will try again.
          </div>
        </Empty>
      )}

      {data && tab === "tournament" && (
        <TournamentHalf data={data} editions={editions} activeYear={activeYear} teams={teams} />
      )}

      {data && tab === "player" && (
        <PlayerHalf data={data} activeYear={activeYear} myId={myId} teams={teams} />
      )}
    </div>
  );
}
