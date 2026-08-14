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
import { db, getActiveTournamentId, setActiveTournamentId, editionDocId, writeUserSession, spectatorSession } from "../firebase";

export const EDITIONS_COL = "bc_editions";

const byYearDesc = (rows) => [...rows].sort((a, b) => (b.year || 0) - (a.year || 0));

// ── An edition's id, and why it needs more than a year ──────────────
//
// The id IS the tournament_id every other collection filters on, and it used
// to be a pure function of the year (`bc_${year}`). So a second edition for a
// year that already had one did not land beside it — it landed ON it. That is
// how a demo edition typed as 2026 walked into the 2026 that was already being
// built for the real tournament.
//
// Nothing was deleted, which made it worse rather than better. `db.upsert`
// merges, so the collision split two ways: the roster and courses arrived
// under FRESH ids against the same tournament_id, giving the year two of every
// player, while the documents whose ids ARE derived from the edition — the
// tournament settings, team names, each round's setup — were merged over by
// the source's copies. Half duplicated, half overwritten, and the app has no
// way to tell either apart from data a director typed.
//
// `label` is the fix at the naming end: an optional slug on the id, so a
// second tournament for an occupied year is `bc_2026_demo` and cannot reach
// `bc_2026`. `editionExists` is the fix at the writing end, and it is checked
// down here rather than in the picker, because the picker is not the thing
// that loses the data.
export const editionSlug = (s) =>
  String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24);

export const editionIdFor = (year, label) => {
  const y = String(year ?? "").replace(/\D/g, "");
  const slug = editionSlug(label);
  return `bc_${y}${slug ? `_${slug}` : ""}`;
};

// Is `id` already somebody's tournament? Both halves of this matter. The
// edition document is how the picker knows a year exists; the roster is what a
// write into an occupied id would actually corrupt. An edition whose document
// was removed by hand but whose data is still filed under it is exactly the
// case a document-only check would wave through.
export const editionExists = async (id) => {
  if (!id) return false;
  const rows = await db.get(EDITIONS_COL);
  if (rows.some((e) => e.id === id)) return true;
  const players = await db.get("bc_players", [{ field: "tournament_id", op: "==", value: id }]);
  return players.length > 0;
};

const TAKEN = (id) =>
  `${id} already exists. Nothing was written — give the new one a label so it gets an id of its own.`;

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
// Returns { ok, edition } or { ok: false, error } — it refuses to write into
// an id that is already a tournament, rather than merging into it.
export const createEdition = async ({ year, name, label, id }) => {
  const eid = id || editionIdFor(year, label);
  if (await editionExists(eid)) return { ok: false, error: TAKEN(eid) };
  const doc = {
    id: eid,
    year: Number(year),
    name: name?.trim() || `The Bourbon Cup ${year}`,
    status: "draft",
    namespaced: true,
    created_from: null,
  };
  await db.upsert(EDITIONS_COL, doc);
  return { ok: true, edition: doc };
};

// ── Renaming one ──────────────────────────────────────────────────
// The name and the status are the only two fields on an edition document a
// director has any business changing, and until this existed neither could be
// changed at all: an edition could be created and deleted, and nothing in
// between. That gap is not theoretical — a clone that landed in an occupied id
// merged its own name and status over the tournament that was there, so the
// real 2026 came back calling itself "2026 Demo" with no way to say otherwise
// short of a console edit.
//
// `id`, `year` and `namespaced` are deliberately NOT touchable. The id IS the
// tournament_id every other collection filters on, so editing it here would
// orphan every document in the edition while leaving the picker looking right
// — the exact shape of failure this whole area has already had once.
export const EDITION_STATUSES = ["draft", "published", "archived"];

export const updateEdition = async (id, { name, status }) => {
  if (!id) return { ok: false, error: "No edition to rename." };
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return { ok: false, error: "A tournament needs a name." };
  if (status && !EDITION_STATUSES.includes(status)) return { ok: false, error: `Unknown status \`${status}\`.` };
  const written = await db.upsert(EDITIONS_COL, { id, name: trimmed, ...(status ? { status } : {}) }, { loud: false });
  // db.upsert swallows a rejection and returns null, and bc_editions is
  // director-only in the rules — so a refused write must not come back as
  // success and leave the new name on screen until the next reload.
  if (!written) return { ok: false, error: "That didn't save. The security rules may not be deployed yet." };
  return { ok: true, edition: written };
};

// ── Freeze a year against everybody but a director ──────────────────
// The one stored flag on an edition that something actually reads, and what
// reads it is firestore.rules — see canWriteEdition() there, and
// lib/editionLock.js for why a lock is stored and why it is not `status`.
//
// A single-field merge, deliberately: rewriting the whole document would mean
// reading it first, and a stale read would put back a name or a status
// somebody else had just changed. Nothing else on the row is this caller's
// business.
//
// Only a director can land this — `bc_editions` has been director-only since
// before the flag existed — so there is no client-side guard here. The picker
// hides the control from a member so they are not offered a tap that comes
// back refused, which is the same division of labour as everywhere else in
// this app: the rules decide, the UI declines to lie about it.
export const setEditionLocked = async (id, locked) => {
  if (!id) return { ok: false, error: "No edition to lock." };
  const written = await db.upsert(EDITIONS_COL, { id: String(id), locked: locked === true });
  if (!written) return { ok: false, error: "That didn't save. The security rules may not be deployed yet." };
  return { ok: true, edition: written };
};

// ── Clone an existing edition into a new (namespaced) draft ──────────
// Copies only the STRUCTURAL data the caller opts into; never the actual
// results (scores, matches, skins/ctp, round locks, handicap overrides, tee
// assignments) — those always start fresh. options = { players, teams,
// tournamentName, courses, rounds } booleans.
export const cloneEdition = async (sourceId, { year, name, label, id }, options = {}) => {
  const newTid = id || editionIdFor(year, label);
  const f = (tid) => [{ field: "tournament_id", op: "==", value: tid }];
  const stamp = Date.now();

  // Before anything is written. A clone into an occupied id is the one way
  // this module can damage a tournament nobody asked it to touch, and the
  // damage is invisible on screen — see the note above editionIdFor.
  if (await editionExists(newTid)) return { ok: false, error: TAKEN(newTid) };

  await db.upsert(EDITIONS_COL, {
    id: newTid,
    year: Number(year),
    name: name?.trim() || `The Bourbon Cup ${year}`,
    status: "draft",
    namespaced: true,
    created_from: sourceId,
  });

  // Players — fresh unique ids (id === player_id), roster/team/HI/GHIN kept.
  //
  // `dues_amount` is the one field deliberately dropped. It is a per-player
  // override on THIS trip's cost (see lib/ledger) — last year's "$400,
  // coming Saturday only" carried into a new edition would bill that man
  // wrong on a screen nobody would think to re-check, which is precisely the
  // kind of quiet wrongness the ledger exists to end. A cloned roster starts
  // everybody on the new tournament's figure.
  if (options.players) {
    const players = await db.get("bc_players", f(sourceId));
    for (let i = 0; i < players.length; i++) {
      const pid = `p_${stamp}_${i}`;
      const { dues_amount: _dues, ...player } = players[i];
      await db.upsert("bc_players", { ...player, id: pid, player_id: pid, tournament_id: newTid });
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
    // `start_date` / `end_date` are dropped from the tournament document for
    // the same reason `dues_amount` is dropped from a roster row: they are
    // facts about THIS trip, and last year's weekend carried into a new
    // edition would date every round wrong on a screen nobody would re-check.
    // bc_settings/<edition>__trip — the house — is not copied at all.
    const DROP = { tournament: ["start_date", "end_date"] };
    const copy = async (key) => {
      const s = find(key);
      if (!s) return;
      const { id: _old, ...rest } = s;
      (DROP[key] || []).forEach(field => { delete rest[field]; });
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

  return { ok: true, edition: { id: newTid, year: Number(year), name, namespaced: true, created_from: sourceId } };
};

// Every tournament-scoped collection — purged when an edition is deleted.
// The edition document itself goes last (below), and its `result` summary
// rides along with it, because that summary is a cache of these very cards
// rather than a record that outlives them.
const EDITION_DATA_COLS = [
  "bc_players", "bc_courses", "bc_settings", "bc_rounds", "bc_matches",
  "bc_hole_scores", "bc_ctp", "bc_round_locks",
  "bc_hcp_overrides", "bc_tee_assignments", "bc_groups",
  "bc_tournament_settings", "bc_card_sigs", "bc_side_bets", "bc_ledger",
  "bc_budget",
];
// bc_notification_tokens is deliberately NOT in that list. A push token is a
// property of a player's DEVICE, not of an edition — deleting last year's
// tournament should not unsubscribe everyone's phone from this year's.

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
//
// The identity written across the reload is the SPECTATOR (see firebase.js):
// player-less, edition-scoped, granting nothing. It is what stops the switch
// dropping somebody on the claim screen of an edition their account has no
// roster row in — which is every year before this one, and also a brand-new
// edition with an empty roster.
//
// It used to write the bootstrap director here, back when switching was a
// director-only action. Admin access never came from that identity anyway —
// it comes from the membership flag the rules read — so the only thing the
// change costs is a label that said "Director (Setup)" to a player looking at
// 2019.
export const switchEdition = (id, { reload = true, namespaced = false } = {}) => {
  setActiveTournamentId(id, namespaced);
  writeUserSession(spectatorSession(id));
  if (reload && typeof window !== "undefined") window.location.reload();
};
