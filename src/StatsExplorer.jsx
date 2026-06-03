// StatsExplorer.jsx — zero-cost, in-browser Bourbon Cup stats. No API, no server calls.
// Loads the bundled fact data and computes everything client-side. Matches the app theme
// (live BC tokens → auto light/dark, Montserrat, ~520px column, no emojis, under-par shown red).
//
// Setup:
//   - put bc-stats.json next to this file (Vite imports JSON natively)
//   - import StatsExplorer from "./StatsExplorer"; render it in a tab like AskTab
//
// Covers the most-asked questions with zero ongoing cost. Hole-level scoring questions
// (e.g. par-3 splits) aren't here — those live in the holes data; add a view if you want them.

import { useState, useMemo } from "react";
import { BC } from "./theme";
import DATA from "./bc-stats.json";

const FONT = "'Montserrat', system-ui, sans-serif";
const NAME = Object.fromEntries(DATA.players.map((p) => [p.id, p.name]));
const nm = (id) => NAME[id] ?? (id === "ghost" ? "Ghost" : id);
const oppNm = (s) => String(s ?? "").split("+").map(nm).join(" + ");
const YEARS = [...new Set(DATA.matches.map((m) => m.year))].sort();

const isLoss = (m) => !m.won && !m.halved;

export default function StatsExplorer() {
  const [view, setView] = useState("leaderboard");
  const [year, setYear] = useState("all");
  const [who, setWho] = useState(() => {
    // default head-to-head player = most-played in singles
    const c = {};
    for (const m of DATA.matches) if (m.format === "singles") c[m.player] = (c[m.player] || 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] ?? DATA.players[0].id;
  });

  // ── all-time / per-year match record (every head-to-head format) ──
  const leaderboard = useMemo(() => {
    const rows = {};
    for (const m of DATA.matches) {
      if (year !== "all" && m.year !== year) continue;
      const r = (rows[m.player] = rows[m.player] || { player: m.player, w: 0, l: 0, h: 0 });
      if (m.won) r.w++; else if (m.halved) r.h++; else r.l++;
    }
    return Object.values(rows)
      .map((r) => ({ ...r, gp: r.w + r.l + r.h, pct: (r.w + r.h * 0.5) / (r.w + r.l + r.h || 1) }))
      .sort((a, b) => b.w - a.w || b.pct - a.pct);
  }, [year]);

  // ── singles head-to-head for the selected player ──
  const h2h = useMemo(() => {
    const rows = {};
    for (const m of DATA.matches) {
      if (m.format !== "singles" || m.player !== who) continue;
      const r = (rows[m.opponent] = rows[m.opponent] || { opp: m.opponent, w: 0, l: 0, h: 0 });
      if (m.won) r.w++; else if (m.halved) r.h++; else r.l++;
    }
    return Object.values(rows).sort((a, b) => b.w + b.h * 0.5 - (a.w + a.h * 0.5));
  }, [who]);

  // ── records cards ──
  const records = useMemo(() => {
    const comeback = {};
    for (const m of DATA.matches)
      if (m.won && Array.isArray(m.trajectory) && m.trajectory.some((x) => x < 0))
        comeback[m.player] = (comeback[m.player] || 0) + 1;
    const topComeback = Object.entries(comeback).map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n).slice(0, 5);

    const birdies = {};
    for (const r of DATA.rounds) birdies[r.player] = (birdies[r.player] || 0) + (r.birdies || 0);
    const topBirdies = Object.entries(birdies).map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n).slice(0, 5);

    const lowNet = DATA.rounds
      .filter((r) => r.scoring_type === "match_status" && r.net_total != null)
      .sort((a, b) => a.net_total - b.net_total).slice(0, 5);

    return { topComeback, topBirdies, lowNet };
  }, []);

  const TABS = [["leaderboard", "Leaderboard"], ["h2h", "Head-to-Head"], ["records", "Records"]];
  const pct = (x) => (x * 100).toFixed(0) + "%";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", maxWidth: 520, margin: "0 auto", width: "100%", fontFamily: FONT, color: BC.t1 }}>
      {/* header + segmented control */}
      <div style={{ padding: "14px 16px 12px", borderBottom: `1px solid ${BC.bdr}` }}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>Stats</div>
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          {TABS.map(([k, label]) => (
            <button key={k} onClick={() => setView(k)}
              style={{ flex: 1, fontFamily: FONT, fontSize: 12.5, fontWeight: 600, padding: "8px 0", borderRadius: 9, cursor: "pointer",
                color: view === k ? "#fff" : BC.t2, background: view === k ? BC.amber : BC.inp, border: `1px solid ${view === k ? BC.amber : BC.bdr}` }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {/* LEADERBOARD */}
        {view === "leaderboard" && (
          <>
            <div style={{ marginBottom: 12 }}>
              <select value={year} onChange={(e) => setYear(e.target.value === "all" ? "all" : +e.target.value)}
                style={{ fontFamily: FONT, fontSize: 13, color: BC.t1, background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 8, padding: "7px 10px" }}>
                <option value="all">All years</option>
                {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <Table head={["Player", "W", "L", "H", "Win%"]} align={[0, 1, 1, 1, 1]}
              rows={leaderboard.map((r) => [nm(r.player), r.w, r.l, r.h, pct(r.pct)])} />
            <Caption>Record across all head-to-head formats (singles, best ball, hi-lo, scramble, pinehurst, shamble). Halves count as ½.</Caption>
          </>
        )}

        {/* HEAD-TO-HEAD */}
        {view === "h2h" && (
          <>
            <div style={{ marginBottom: 12 }}>
              <select value={who} onChange={(e) => setWho(e.target.value)}
                style={{ fontFamily: FONT, fontSize: 13, color: BC.t1, background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 8, padding: "7px 10px", maxWidth: "100%" }}>
                {DATA.players.filter((p) => DATA.matches.some((m) => m.format === "singles" && m.player === p.id))
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {h2h.length ? (
              <Table head={["Opponent", "W", "L", "H"]} align={[0, 1, 1, 1]}
                rows={h2h.map((r) => [oppNm(r.opp), r.w, r.l, r.h])} />
            ) : <Caption>No singles matches found for this player.</Caption>}
            <Caption>Singles matches only — true one-on-one record vs each opponent.</Caption>
          </>
        )}

        {/* RECORDS */}
        {view === "records" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <RecordCard title="Most comeback wins" sub="Won after trailing at some hole"
              rows={records.topComeback.map((r) => [nm(r.id), r.n])} />
            <RecordCard title="Most career birdies" sub="Across all rounds"
              rows={records.topBirdies.map((r) => [nm(r.id), r.n])} />
            <RecordCard title="Lowest single-round net" sub="Match-play rounds"
              rows={records.lowNet.map((r) => [`${nm(r.player)} · ${r.year} R${r.round}`, r.net_total])} />
          </div>
        )}
      </div>
    </div>
  );
}

function Table({ head, rows, align = [] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
      <thead>
        <tr>{head.map((h, i) => (
          <th key={i} style={{ textAlign: align[i] ? "right" : "left", padding: "7px 8px", color: BC.t3, fontWeight: 600, fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.4, borderBottom: `1px solid ${BC.bdr}` }}>{h}</th>
        ))}</tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri}>{r.map((c, ci) => (
            <td key={ci} style={{ textAlign: align[ci] ? "right" : "left", padding: "8px", borderBottom: `1px solid ${BC.bdr}`,
              color: typeof c === "number" && c < 0 ? BC.danger : BC.t1, fontWeight: ci === 0 ? 600 : 400, fontVariantNumeric: "tabular-nums" }}>{c}</td>
          ))}</tr>
        ))}
      </tbody>
    </table>
  );
}

function RecordCard({ title, sub, rows }) {
  return (
    <div style={{ background: BC.card, border: `1px solid ${BC.bdr}`, borderRadius: 12, padding: "13px 15px" }}>
      <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 11.5, color: BC.t3, marginTop: 1, marginBottom: 9 }}>{sub}</div>
      {rows.map(([label, val], i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderTop: i ? `1px solid ${BC.bdr}` : "none", fontSize: 13.5 }}>
          <span style={{ color: BC.t1, fontWeight: i === 0 ? 600 : 400 }}>{label}</span>
          <span style={{ color: typeof val === "number" && val < 0 ? BC.danger : BC.amber, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{val}</span>
        </div>
      ))}
    </div>
  );
}

function Caption({ children }) {
  return <div style={{ fontSize: 11.5, color: BC.t3, marginTop: 10, lineHeight: 1.5 }}>{children}</div>;
}
