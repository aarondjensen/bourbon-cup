// ══════════════════════════════════════════════════════════════════
//  editions — the top-level list of tournament years.
// ══════════════════════════════════════════════════════════════════
//
// `bc_editions` is deliberately NOT tournament-scoped — it IS the index of
// tournaments. Each doc: { id, year, name, status, namespaced, created_from }.
//   status:     "draft" | "published" | "archived"
//   id:         the tournament_id every other collection filters on (bc_2025)
//   namespaced: true for editions created from now on — their per-edition
//               singleton/round doc ids are prefixed with the edition id so
//               editions don't clobber each other (see firebase.editionDocId).
//               Absent/false for the original bc_2025 edition (bare doc ids).
//   created_from: source edition id when this one was cloned, else null.
//
// Switching editions flips the active-edition pointer in firebase.js and
// hard-reloads, so every subscription and piece of state rebuilds cleanly
// against the new tournament_id (a live db.subscribe captures its filter
// value at creation, so a reload is the simplest correct re-init).
import { db, getActiveTournamentId, setActiveTournamentId, editionDocId } from "../firebase";

export const EDITIONS_COL = "bc_editions";

const byYearDesc = (rows) => [...rows].sort((a, b) => (b.year || 0) - (a.year || 0));

export const loadEditions = async () => byYearDesc(await db.get(EDITIONS_COL));

export const subscribeEditions = (cb) =>
  db.subscribe(EDITIONS_COL, [], (rows) => cb(byYearDesc(rows)));

// Seed the currently-active edition into the collection if it isn't there
// yet, so the picker always shows at least the running year. Idempotent —
// safe to call on every open. Derives the year from the id (bc_2025 → 2025).
// Deliberately does NOT set `namespaced`: the running edition predates
// namespacing and keeps its bare doc ids.
export const ensureActiveEditionDoc = async (name = "The Bourbon Cup") => {
  const id = getActiveTournamentId();
  const rows = await db.get(EDITIONS_COL);
  if (rows.some((e) => e.id === id)) return byYearDesc(rows);
  const year = parseInt(String(id).replace(/\D/g, ""), 10) || new Date().getFullYear();
  await db.upsert(EDITIONS_COL, { id, year, name: `${name} ${year}`, status: "published", created_from: null });
  return byYearDesc(await db.get(EDITIONS_COL));
};

// Create a new (namespaced) draft edition — empty. Cloning is `cloneEdition`.
export const createEdition = async ({ year, name, id }) => {
  const eid = id || `bc_${year}`;
  const doc = {
    id: eid,
    year: Number(year),
    name: name?.trim() || `The Bourbon Cup ${year}`,
    status: "draft",
    namespaced: true,
    created_from: null,
  };
  await db.upsert(EDITIONS_COL, doc);
  return doc;
};

// ── Clone an existing edition into a new (namespaced) draft ──────────
// Copies only the STRUCTURAL data the caller opts into; never the actual
// results (scores, matches, skins/ctp, round locks, handicap overrides, tee
// assignments) — those always start fresh. options = { players, teams,
// tournamentName, courses, rounds } booleans.
export const cloneEdition = async (sourceId, { year, name, id }, options = {}) => {
  const newTid = id || `bc_${year}`;
  const f = (tid) => [{ field: "tournament_id", op: "==", value: tid }];
  const stamp = Date.now();

  await db.upsert(EDITIONS_COL, {
    id: newTid,
    year: Number(year),
    name: name?.trim() || `The Bourbon Cup ${year}`,
    status: "draft",
    namespaced: true,
    created_from: sourceId,
  });

  // Players — fresh unique ids (id === player_id), roster/team/HI/GHIN kept.
  if (options.players) {
    const players = await db.get("bc_players", f(sourceId));
    for (let i = 0; i < players.length; i++) {
      const pid = `p_${stamp}_${i}`;
      await db.upsert("bc_players", { ...players[i], id: pid, player_id: pid, tournament_id: newTid });
    }
  }

  // Courses — fresh ids; remember old→new so cloned rounds can remap.
  const courseMap = {};
  if (options.courses) {
    const courses = await db.get("bc_courses", f(sourceId));
    for (let i = 0; i < courses.length; i++) {
      const cid = `bc_course_${stamp}_${i}`;
      courseMap[courses[i].id] = cid;
      await db.upsert("bc_courses", { ...courses[i], id: cid, tournament_id: newTid });
    }
  }

  // Settings singletons (team names / branding / tournament name).
  if (options.teams || options.tournamentName) {
    const settings = await db.get("bc_settings", f(sourceId));
    const find = (key) => settings.find((s) => s.id === key || String(s.id).endsWith(`__${key}`));
    const copy = async (key) => {
      const s = find(key);
      if (!s) return;
      const { id: _old, ...rest } = s;
      await db.upsert("bc_settings", { ...rest, id: editionDocId(key, newTid, true), tournament_id: newTid });
    };
    if (options.teams) { await copy("team_names"); await copy("branding"); }
    if (options.tournamentName) await copy("tournament");
  }

  // Round setup (format / course / tee time / Nassau) — course_id remapped
  // to the cloned course when courses were also copied, else cleared.
  if (options.rounds) {
    const rounds = await db.get("bc_rounds", f(sourceId));
    for (const r of rounds) {
      const { id: _old, ...rest } = r;
      await db.upsert("bc_rounds", {
        ...rest,
        id: editionDocId(`bc_round_${r.round_number}`, newTid, true),
        tournament_id: newTid,
        course_id: r.course_id ? (courseMap[r.course_id] || null) : null,
      });
    }
  }

  return { id: newTid, year: Number(year), name, namespaced: true, created_from: sourceId };
};

// Every tournament-scoped collection — purged when an edition is deleted.
// bc_historical (cross-year stats) and the practice sandbox are global and
// left alone.
const EDITION_DATA_COLS = [
  "bc_players", "bc_courses", "bc_settings", "bc_rounds", "bc_matches",
  "bc_hole_scores", "bc_skins", "bc_ctp", "bc_round_locks",
  "bc_hcp_overrides", "bc_tee_assignments", "bc_tournament_settings",
];

// Delete an edition AND all of its data. Irreversible. Refuses to delete the
// active edition (switch away first) so the running app never loses its data
// out from under it.
export const deleteEdition = async (id) => {
  if (!id || id === getActiveTournamentId()) return false;
  const f = [{ field: "tournament_id", op: "==", value: id }];
  for (const col of EDITION_DATA_COLS) {
    const rows = await db.get(col, f);
    for (const r of rows) if (r.id) await db.delete(col, r.id);
  }
  await db.delete(EDITIONS_COL, id);
  return true;
};

// Flip the active pointer (with its namespacing flag), then hard-reload.
export const switchEdition = (id, { reload = true, namespaced = false } = {}) => {
  setActiveTournamentId(id, namespaced);
  if (reload && typeof window !== "undefined") window.location.reload();
};
