// api/ask.js — Bourbon Cup stats chatbot endpoint (Vercel serverless function).
//
// Flow:  question → Claude writes SQL (schema in prompt) → validate (SELECT-only, single stmt,
//        forced LIMIT) → run read-only against SQLite → Claude turns rows into a plain answer.
//
// Setup:
//   npm i @libsql/client
//   Env vars:
//     ANTHROPIC_API_KEY   (required)
//     CLAUDE_MODEL        (optional, default below)
//     TURSO_DATABASE_URL  (optional) — e.g. libsql://your-db.turso.io  (recommended for prod)
//     TURSO_AUTH_TOKEN    (optional) — paired with the Turso URL
//   With no Turso vars it reads a local file at file:data/bourbon-cup.db (good for `vercel dev`).
//   If you bundle the .db instead of using Turso, ensure it ships with the function
//   (vercel.json → functions includeFiles "data/bourbon-cup.db").
//
// The data is static (one update a year), so the DB is opened read-only and answers in <1ms.

import { createClient } from "@libsql/client";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

let _db;
function getDb() {
  if (!_db) {
    _db = createClient(
      process.env.TURSO_DATABASE_URL
        ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
        : { url: "file:data/bourbon-cup.db" }
    );
  }
  return _db;
}

// ── schema shown to the model (accurate column list + the enums/conventions that trip up text-to-SQL) ──
const SCHEMA_DOC = `
You write SQLite queries against the Bourbon Cup golf database (a 16-player Ryder-Cup-style
match-play event, 4 rounds/year). All years 2016 through 2025 are present (no gaps). Every stat is
a query over atomic facts — never assume a precomputed column exists beyond those listed.

TABLES

players(id TEXT PK, name TEXT)                      -- id is canonical (e.g. 'nicks'); name is display ('Nick S')

player_hole(                                        -- one row per player per hole (finest grain)
  year, round, hole, seq, player,
  format, scoring_type, course,
  par, hole_index,                                  -- hole_index = stroke index, 1 = hardest
  segment,                                          -- 'front' | 'back'
  gross, net, strokes_received,
  net_vs_par,                                        -- net minus par: <0 under, 0 even, >0 over
  hole_result, status_after, contribution_counted, involves_ghost)

player_round(                                       -- one row per player per round (totals + metrics)
  year, round, player, format, scoring_type, course,
  course_handicap, gross_total, net_total, net_vs_par,
  net_pars_or_better, match_royale,
  eagles, birdies, pars, bogies, doubles)

match(                                              -- one row per PARTICIPANT per head-to-head match
  id, year, round, format, player,
  opponent,                                         -- opponent id; TEAM formats join ids with '+', e.g. 'andy+petec'; 'ghost' = borrowed slot
  team,
  after9, final, margin,                            -- in holes; + = up, - = down, 0 = halved (margin/final identical at end)
  won, halved,                                      -- 0/1
  involves_ghost, opponent_absent)                  -- 0/1; opponent_absent = singles forfeit

match_hole(match_id, hole, margin)                  -- match.trajectory exploded: running status after each hole
                                                    -- use this for comeback / blew-a-lead / lead-change questions

ENUMS
  scoring_type: 'match_status' (head-to-head: singles, best ball, hi-lo, scramble, pinehurst, shamble),
                'contribution' (team_best_ball, 8man_top4net), 'dots' (dirty_dozen, double_dot),
                'stableford', 'tilt'
  format: singles, 2man_best_ball, 2man_hi_lo, 2man_scramble, pinehurst, shamble,
          team_best_ball, 8man_top4net, dirty_dozen, double_dot, 2man_stableford, 2man_tilt
  Only scoring_type='match_status' rows appear in the match table.

CONVENTIONS
  - Join player/opponent ids to players.name for display.
  - "comeback win" = won=1 AND a match_hole row with margin<0 exists for that match.
  - For per-hole scoring questions, prefer scoring_type='match_status' rounds (real individual strokes);
    'dots'/'stableford'/'tilt' rounds store real strokes too but aren't head-to-head.
  - Team/year names (match.team) are uppercase and vary by year.
`;

// ── SQL guardrails ──────────────────────────────────────────────────────────
export { sanitizeSql };
function sanitizeSql(raw) {
  let s = String(raw).trim().replace(/^```(?:sql)?/i, "").replace(/```$/,"").trim();
  s = s.replace(/;+\s*$/, "");                       // drop trailing semicolons
  if (/;/.test(s)) throw new Error("Only a single statement is allowed.");
  if (!/^(select|with)\b/i.test(s)) throw new Error("Only SELECT/WITH queries are allowed.");
  if (/\b(insert|update|delete|drop|alter|create|attach|detach|pragma|replace|vacuum|reindex)\b/i.test(s))
    throw new Error("Write/DDL statements are not allowed.");
  if (!/\blimit\b/i.test(s)) s += "\nLIMIT 500";     // cap result size
  return s;
}

async function claude(system, user, maxTokens = 700) {
  const r = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  if (!r.ok) throw new Error(`Anthropic API ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const question = (req.body?.question || "").toString().trim();
  if (!question) return res.status(400).json({ error: "Missing 'question'." });

  let sql;
  try {
    // 1) natural language → SQL
    const rawSql = await claude(
      `${SCHEMA_DOC}\n\nReturn ONLY one SQLite SELECT (or WITH) query that answers the user's question. ` +
      `No markdown, no explanation, no trailing semicolon. If the question can't be answered from these tables, ` +
      `return: SELECT 'UNANSWERABLE' AS note;`,
      question, 600
    );
    if (/UNANSWERABLE/i.test(rawSql))
      return res.status(200).json({ answer: "I can't answer that from the tournament data.", sql: null, rows: [] });

    sql = sanitizeSql(rawSql);

    // 2) run read-only
    const result = await getDb().execute(sql);
    const rows = result.rows.map(r => ({ ...r }));

    // 3) rows → plain-language answer
    const answer = await claude(
      `You are the Bourbon Cup stats assistant. Answer the user's question from the SQL result rows only. ` +
      `Be concise and exact; cite the numbers. If rows are empty, say no matching data was found. Never invent figures.`,
      `Question: ${question}\n\nSQL:\n${sql}\n\nRows (JSON):\n${JSON.stringify(rows).slice(0, 12000)}`,
      600
    );

    return res.status(200).json({ answer, sql, rowCount: rows.length, rows });
  } catch (err) {
    return res.status(400).json({ error: err.message, sql: sql ?? null });
  }
}
