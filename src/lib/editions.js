// ══════════════════════════════════════════════════════════════════
//  editions — the top-level list of tournament years.
// ══════════════════════════════════════════════════════════════════
//
// `bc_editions` is deliberately NOT tournament-scoped — it IS the index of
// tournaments. Each doc: { id, year, name, status, created_from }.
//   status: "draft" | "published" | "archived"
//   id:     the tournament_id every other collection filters on (bc_2025)
//
// Switching editions flips the active-edition pointer in firebase.js and
// hard-reloads, so every subscription and piece of state rebuilds cleanly
// against the new tournament_id (a live db.subscribe captures its filter
// value at creation, so a reload is the simplest correct re-init). Edition
// switching is a rare director action, so the reload cost is a non-issue.
import { db, getActiveTournamentId, setActiveTournamentId } from "../firebase";

export const EDITIONS_COL = "bc_editions";

const byYearDesc = (rows) => [...rows].sort((a, b) => (b.year || 0) - (a.year || 0));

export const loadEditions = async () => byYearDesc(await db.get(EDITIONS_COL));

export const subscribeEditions = (cb) =>
  db.subscribe(EDITIONS_COL, [], (rows) => cb(byYearDesc(rows)));

// Seed the currently-active edition into the collection if it isn't there
// yet, so the picker always shows at least the running year. Idempotent —
// safe to call on every open. Derives the year from the id (bc_2025 → 2025).
export const ensureActiveEditionDoc = async (name = "The Bourbon Cup") => {
  const id = getActiveTournamentId();
  const rows = await db.get(EDITIONS_COL);
  if (rows.some((e) => e.id === id)) return byYearDesc(rows);
  const year = parseInt(String(id).replace(/\D/g, ""), 10) || new Date().getFullYear();
  await db.upsert(EDITIONS_COL, { id, year, name: `${name} ${year}`, status: "published", created_from: null });
  return byYearDesc(await db.get(EDITIONS_COL));
};

// Create a new draft edition. Clone (copying a prior edition's docs under
// the new id) is a separate routine — this just registers the edition.
export const createEdition = async ({ year, name, id }) => {
  const eid = id || `bc_${year}`;
  const doc = {
    id: eid,
    year: Number(year),
    name: name?.trim() || `The Bourbon Cup ${year}`,
    status: "draft",
    created_from: null,
  };
  await db.upsert(EDITIONS_COL, doc);
  return doc;
};

// Flip the active pointer, then hard-reload for a clean rebuild.
export const switchEdition = (id, { reload = true } = {}) => {
  setActiveTournamentId(id);
  if (reload && typeof window !== "undefined") window.location.reload();
};
