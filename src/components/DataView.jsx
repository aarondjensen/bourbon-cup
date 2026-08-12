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
import { BC, FONT, FS, ALPHA, playerNameColor } from "../theme";
import { SegmentedToggle, StickyTop } from "./ui";
import { fmtPts, fmtScore } from "../scoring";
import { formatLabel } from "../constants";
import { switchEdition } from "../lib/editions";
import { useArchive } from "../lib/useArchive";

// ── Small shared furniture ────────────────────────────────────────
const card = { background: BC.card, borderRadius: 12, border: `1px solid ${BC.bdr}`, marginBottom: 12 };
const eyebrow = { fontSize: FS.label, fontWeight: 800, color: BC.t3, letterSpacing: 1 };
const hair = `1px solid ${BC.bdr}${ALPHA.hair}`;

const Section = ({ label, note, children, style }) => (
  <div style={{ ...card, padding: 14, ...style }}>
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
      <div style={eyebrow}>{String(label).toUpperCase()}</div>
      {note && <div style={{ fontSize: FS.micro, color: BC.t3, letterSpacing: 0.4, marginLeft: "auto" }}>{note}</div>}
    </div>
    {children}
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

const Empty = ({ icon = "📊", children }) => (
  <div style={{ textAlign: "center", padding: 40, color: BC.t3 }}>
    <div style={{ fontSize: FS.display, marginBottom: 12 }}>{icon}</div>
    <div style={{ fontSize: FS.body, fontWeight: 700, color: BC.t2 }}>{children}</div>
  </div>
);

// A row of chips that filters rather than navigates. Deliberately not a
// SegmentedToggle: that control is the tab switcher's language, and there is
// already one of those at the top of this screen.
const Chips = ({ options, value, onChange }) => (
  <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
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

// ══════════════════════════════════════════════════════════════════
//  TOURNAMENT
// ══════════════════════════════════════════════════════════════════

// ── One year ──────────────────────────────────────────────────────
// The row used to be the whole answer: two teams and two numbers. A final
// score says who won and nothing at all about whether it was over on Saturday
// morning, so the row now opens onto the running total after each round —
// which is where "2021 was done by lunchtime" and "2025 came down to the last
// group" stop being things people remember differently.
//
// Tapping OPENS rather than switches. Switching edition hard-reloads the whole
// app onto another tournament, and that is too big a thing to be what a tap on
// a summary row does; it is a button inside, named.
function YearRow({ e, live, teams, open, onToggle }) {
  const side = (name, score, accent, align, won) => (
    <div style={{ flex: 1, minWidth: 0, textAlign: align }}>
      <div style={{
        fontSize: FS.label, fontWeight: 800, color: accent, letterSpacing: 0.4,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>{name || "—"}</div>
      <div style={{ fontSize: FS.lead, fontWeight: 800, color: won ? BC.t1 : BC.t2 }}>{fmtPts(score)}</div>
    </div>
  );

  return (
    <div style={{ ...card, border: `1px solid ${live ? BC.amber + ALPHA.line : BC.bdr}` }}>
      <button onClick={onToggle} style={{
        display: "block", width: "100%", textAlign: "left", padding: 14,
        background: "transparent", border: "none", cursor: "pointer", fontFamily: FONT,
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: FS.body, fontWeight: 700, color: BC.gold }}>{e.year}</span>
          <span style={{
            flex: 1, minWidth: 0, fontSize: FS.label, color: BC.t3,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>{(e.location || "").toUpperCase()}</span>
          {live && <span style={{ fontSize: FS.micro, fontWeight: 800, color: BC.amberInk, letterSpacing: 0.6 }}>THIS YEAR</span>}
          <span style={{ fontSize: FS.small, color: BC.t3, transform: open ? "rotate(90deg)" : "none", display: "inline-block" }}>›</span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
          {side(e.teamA, e.scoreA, teams.A.accent, "left", e.winnerSide === "A")}
          {side(e.teamB, e.scoreB, teams.B.accent, "right", e.winnerSide === "B")}
        </div>
        <div style={{ fontSize: FS.small, fontWeight: 700, color: BC.amberInk, marginTop: 8 }}>
          {e.halved ? "🏆 The cup was halved"
            : !e.complete ? `In progress · ${e.rounds.length} round${e.rounds.length === 1 ? "" : "s"}`
              : e.winner ? `🏆 ${e.winner} won by ${fmtPts(e.margin)}` : "—"}
        </div>
      </button>

      {open && (
        <div style={{ borderTop: hair, padding: "10px 14px 14px" }}>
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
            <div key={r.round} style={{ display: "grid", gridTemplateColumns: "22px 1fr 62px 60px", gap: 6, alignItems: "center", padding: "5px 0", borderTop: hair }}>
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
                color: r.cumA > r.cumB ? teams.A.accent : r.cumB > r.cumA ? teams.B.accent : BC.t3,
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
  const never = data.editions.filter((e) => e.complete).length > 0
    && data.editions.every((e) => e.clinchedAfter == null);
  return (
    <Section label="Cup records" note={`${r.cupsPlayed} FINISHED`}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: r.hardest ? 12 : 0 }}>
        {r.closest && <Stat label="Closest" value={r.closest.year} sub={`${r.closest.winner} by ${fmtPts(r.closest.margin)}`} color={BC.amberInk} />}
        {r.biggest && <Stat label="Biggest" value={r.biggest.year} sub={`${r.biggest.winner} by ${fmtPts(r.biggest.margin)}`} />}
        {r.hardest && <Stat label="Hardest day" value={toParText(r.hardest.avgToPar)} sub={`${r.hardest.course} · ${r.hardest.year}`} color={BC.danger} />}
        {r.easiest && <Stat label="Kindest day" value={toParText(r.easiest.avgToPar)} sub={`${r.easiest.course} · ${r.easiest.year}`} color={BC.green} />}
      </div>
      {!!r.halved.length && (
        <div style={{ fontSize: FS.small, color: BC.t2, marginBottom: 6 }}>
          🏆 Halved: {r.halved.map((e) => e.year).join(", ")}
        </div>
      )}
      {never && (
        // True of all ten so far, and worth saying out loud: Round 4 is worth
        // more than the first three put together, so no lead has ever been
        // safe going into Sunday. If a cup is ever clinched early this line
        // disappears on its own rather than becoming a lie.
        <div style={{ fontSize: FS.small, color: BC.t2 }}>
          No cup has ever been decided before the final round.
        </div>
      )}
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
        <div key={r.round} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: r.round === rows[0].round ? "none" : hair }}>
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
  const rows = useMemo(() => {
    const xs = data.courses.filter((c) => c.course);
    return sort === "hard"
      ? [...xs].sort((a, b) => (b.avgToPar ?? -99) - (a.avgToPar ?? -99))
      : xs;
  }, [data.courses, sort]);
  const distinct = useMemo(() => new Set(rows.map((c) => c.course)).size, [rows]);

  return (
    <Section label="The courses" note={`${distinct} COURSES · ${rows.length} ROUNDS`}>
      <Chips options={[["year", "By year"], ["hard", "Hardest first"]]} value={sort} onChange={setSort} />
      {rows.map((c) => (
        <div key={`${c.year}_${c.round}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: hair }}>
          <div style={{ fontSize: FS.micro, fontWeight: 800, color: BC.t3, width: 46, letterSpacing: 0.4 }}>{c.year} R{c.round}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: FS.small, color: BC.t1, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.course}</div>
            <div style={{ fontSize: FS.micro, color: BC.t3, letterSpacing: 0.4 }}>
              PAR {c.par}{c.slope ? ` · ${c.rating}/${c.slope}` : ""}{c.low ? ` · LOW ${c.low}` : ""}
            </div>
          </div>
          <div style={{ fontSize: FS.small, fontWeight: 800, color: (c.avgToPar ?? 0) > 12 ? BC.danger : BC.t2, width: 44, textAlign: "right" }}>
            {toParText(c.avgToPar)}
          </div>
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

  if (!rows.length) return <Empty>No years yet</Empty>;

  return (
    <div>
      <CupRecords data={data} />
      {rows.map((e) => (
        <YearRow
          key={e.year} e={e} teams={teams}
          live={e.year === activeYear}
          open={open === e.year}
          onToggle={() => setOpen(open === e.year ? null : e.year)}
        />
      ))}
      <RoundDrama data={data} />
      <Passport data={data} />
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
  const partners = useMemo(() => data.partnersOf(p.id).slice(0, 6), [data, p.id]);
  const h2h = useMemo(() => data.h2hOf(p.id).filter((r) => r.matches).slice(0, 6), [data, p.id]);
  // Record only, no rate. Points per match is comparable BETWEEN PLAYERS and
  // not between formats — Round 4 is one team match worth twenty-seven points
  // and a singles is worth three — so a column of them down a page of formats
  // invites exactly the comparison it cannot support.
  const formats = useMemo(() => Object.entries(p.byFormat)
    .map(([f, v]) => ({ f, ...v }))
    .sort((a, b) => b.matches - a.matches), [p.byFormat]);

  const line = { display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderTop: hair, fontSize: FS.small };

  return (
    <div style={{ padding: "10px 14px 14px", borderTop: hair }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
        <Stat label="Cups" value={p.apps} sub={p.debut === p.last ? `${p.debut}` : `${p.debut}–${p.last}`} />
        <Stat label="Won" value={p.cupsWon} sub={p.cupsHalved ? `${p.cupsHalved} halved` : null} color={BC.green} />
        <Stat label="Pts/match" value={p.ppm == null ? "—" : p.ppm.toFixed(2)} />
        <Stat label="Avg round" value={toParText(p.avgToPar)} sub={`${p.rounds} RDS`} />
      </div>

      {p.best && (
        <div style={{ fontSize: FS.small, color: BC.t2, marginBottom: 12 }}>
          <strong style={{ color: BC.amberInk }}>Best round</strong> — {p.best.gross} ({fmtScore(p.best.toPar)})
          {p.best.course ? ` at ${p.best.course}` : ""} · {p.best.year} R{p.best.round}
        </div>
      )}

      {/* The card, not the match: birdies are his alone whatever format the
          round was played in. */}
      <div style={eyebrow}>THE CARD</div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "6px 0 14px", fontSize: FS.small, color: BC.t2 }}>
        <span>🦅 {p.e}</span>
        <span style={{ color: BC.birdieRed }}>● {p.b} birdies</span>
        <span>PAR {p.pr}</span>
        <span>BOGEY {p.bo}</span>
        <span>DBL+ {p.d}</span>
        {p.birdiesPerRound != null && <span style={{ color: BC.t3 }}>{p.birdiesPerRound.toFixed(1)}/RD</span>}
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
            <span style={{ width: 34, textAlign: "right", color: BC.t3 }}>{toParText(y.avgToPar)}</span>
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
function PlayerRecords({ data }) {
  const r = data.records;
  const list = (label, rows, render) => !!rows.length && (
    <div style={{ marginBottom: 12 }}>
      <div style={eyebrow}>{label}</div>
      {rows.map((x, i) => (
        <div key={i} style={{ display: "flex", gap: 8, padding: "4px 0", borderTop: i ? hair : "none", fontSize: FS.small }}>
          <span style={{ width: 14, color: BC.t3, fontWeight: 800 }}>{i + 1}</span>
          {render(x)}
        </div>
      ))}
    </div>
  );

  return (
    <Section label="Records" note="ALL YEARS">
      {list("LOW ROUNDS", r.lowRounds, (c) => (
        <>
          <span style={{ flex: 1, minWidth: 0, color: BC.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
          <span style={{ fontWeight: 800, color: BC.amberInk }}>{c.g}</span>
          <span style={{ width: 34, textAlign: "right", color: BC.t3 }}>{fmtScore(c.tp)}</span>
          <span style={{ width: 34, textAlign: "right", color: BC.t3 }}>{c.year}</span>
        </>
      ))}
      {list("BEST WEEK", r.bestWeeks, (w) => (
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
      {list("BIRDIES OR BETTER", r.mostBirdies, (p) => (
        <>
          <span style={{ flex: 1, minWidth: 0, color: BC.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
          <span style={{ fontWeight: 800, color: BC.birdieRed }}>{p.e + p.b}</span>
          <span style={{ width: 52, textAlign: "right", color: BC.t3 }}>{p.rounds} RDS</span>
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

// ── The career table ──────────────────────────────────────────────
// Two rows per player, not eight columns: eight numbers across a phone is
// either unreadable or a horizontal scroll, and the second row is the quieter
// half by design — the record is what people came for.
//
// `scope` is the one place a year gets to matter on this half. It is not the
// old NOW/THEN split coming back through the window: both scopes are about
// the same subject, and the default is the career, because that is the thing
// this tab could not say before.
function CareerTable({ rows, teamOf, myId, activeYear, data, open, setOpen }) {
  if (!rows.length) return <Empty>No players yet</Empty>;
  const COLS = "1fr 38px 38px 38px 50px";
  const head = { fontSize: FS.label, fontWeight: 700, color: BC.t3, letterSpacing: 1, textAlign: "center" };
  const cell = { fontSize: FS.small, fontWeight: 600, textAlign: "center" };

  return (
    <div style={{ ...card, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: COLS, padding: "8px 12px", borderBottom: `1px solid ${BC.bdr}`, ...head, textAlign: "left" }}>
        <div>PLAYER</div>
        <div style={head}>W</div><div style={head}>L</div><div style={head}>H</div>
        <div style={{ ...head, textAlign: "right" }}>PTS</div>
      </div>
      {rows.map((p, i) => {
        const isOpen = open === p.id;
        const mine = p.id === myId;
        return (
          <div key={p.id} style={{ borderBottom: i < rows.length - 1 ? hair : "none", background: mine ? BC.amber + ALPHA.wash : "transparent" }}>
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
                <div style={{ ...cell, color: BC.green }}>{p.w}</div>
                <div style={{ ...cell, color: BC.danger }}>{p.l}</div>
                <div style={{ ...cell, color: BC.t3 }}>{p.h}</div>
                <div style={{ ...cell, textAlign: "right", fontWeight: 700, color: BC.amberInk }}>{fmtPts(p.pts)}</div>
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 3, marginLeft: 12, fontSize: FS.micro, color: BC.t3, letterSpacing: 0.4 }}>
                <span>{p.apps ? `${p.apps} CUP${p.apps === 1 ? "" : "S"}` : "—"}</span>
                <span>{p.rounds ? `${p.rounds} RD${p.rounds === 1 ? "" : "S"}` : "NO CARD"}</span>
                {p.avgToPar != null && <span>AVG <strong style={{ color: BC.t2, fontWeight: 700 }}>{toParText(p.avgToPar)}</strong></span>}
                {p.best && <span>BEST <strong style={{ color: BC.t2, fontWeight: 700 }}>{p.best.gross}</strong> ({fmtScore(p.best.toPar)}) {p.best.year}</span>}
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
  const [open, setOpen] = useState(null);

  const thisYear = data.edition(activeYear);
  const teamOf = useMemo(() => {
    const m = new Map((thisYear?.roster || []).map((r) => [r.p, r.t === "B" ? teams.B.accent : teams.A.accent]));
    return (id) => m.get(id) || null;
  }, [thisYear, teams]);

  // Career, or this year's field with this year's numbers. The same rows
  // either way — a scope is which slice of a man's record you are reading,
  // not a different table.
  const rows = useMemo(() => {
    if (scope === "career") return data.career.filter((p) => p.apps || p.matches);
    return data.career
      .map((p) => {
        const y = p.byYear.find((x) => x.year === activeYear);
        if (!y) return null;
        return { ...p, ...y, apps: 1, byYear: p.byYear, best: y.best, avgToPar: y.avgToPar };
      })
      .filter(Boolean)
      .sort((a, b) => b.pts - a.pts || (a.avgToPar ?? Infinity) - (b.avgToPar ?? Infinity)
        || String(a.name).localeCompare(String(b.name)));
  }, [data.career, scope, activeYear]);

  // Yours first. Not a sort — the table's order is the standing and moving a
  // man up it would be a lie — so the row is highlighted where it belongs and
  // this scrolls nothing.
  return (
    <div>
      <Chips
        options={[["career", "Career"], ["year", String(activeYear)]]}
        value={scope} onChange={(v) => { setScope(v); setOpen(null); }}
      />
      <CareerTable
        rows={rows} teamOf={teamOf} myId={myId} activeYear={activeYear}
        data={data} open={open} setOpen={setOpen}
      />
      {scope === "career" && <PlayerRecords data={data} />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  The screen
// ══════════════════════════════════════════════════════════════════
export default function DataView({
  tPlayers, matches, holeData, tRounds, courses, hcpOverrides, teeAssignments,
  roundLocks, teamNames, editions, activeYear, teams, myPlayerId,
}) {
  const [tab, setTab] = useState("tournament");

  // The running edition, handed over raw. useArchive turns it into archive
  // rows itself, because that conversion needs the player registry and the
  // registry is inside the chunk it is fetching.
  const input = useMemo(() => ({
    year: activeYear, tPlayers, matches, holeData, tRounds, courses,
    hcpOverrides, teeAssignments, roundLocks, teamNames,
  }), [activeYear, tPlayers, matches, holeData, tRounds, courses,
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
