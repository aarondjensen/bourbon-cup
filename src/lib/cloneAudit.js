// ══════════════════════════════════════════════════════════════════
//  cloneAudit — finding what a clone left inside somebody else's
//  tournament, and deciding what is safe to take back out.
// ══════════════════════════════════════════════════════════════════
//
// An edition's id used to be `bc_${year}` and nothing else, so a second
// edition for a year that already had one did not land beside it — it landed
// on it (see the note above `editionIdFor` in lib/editions.js). `db.upsert`
// merges, so the collision split two ways, and only one of them is repairable
// from here:
//
//   DUPLICATED — the roster and courses were written under FRESH ids against
//                the existing tournament_id. Both sets survive, so the year
//                comes back with two of every player. Those rows carry the
//                clone's own id shape, which is what this module reads.
//
//   OVERWRITTEN — the documents whose ids are DERIVED from the edition (the
//                 tournament settings, team names, branding, each round's
//                 setup) were merged over by the source's copies. Same id,
//                 same document: there is no second row to find and no record
//                 of what the field held before. `overwritableDocIds` names
//                 them so a report can say so out loud rather than implying a
//                 clean undo.
//
// Pure — no Firebase, no node, no I/O — so the decision about which rows to
// delete from a live tournament is unit-tested rather than trusted. The script
// (scripts/undo-clone.mjs) reads, prints and deletes.

// ── Recognising a cloned row ──────────────────────────────────────
// `cloneEdition` mints ids from one `Date.now()` taken once per run, plus the
// row's index: `p_<stamp>_<i>` for players, `bc_course_<stamp>_<i>` for
// courses. Two things follow, and both are load-bearing.
//
// The trailing index is what separates these from the app's own ids. A
// director adding a player gets `bc_player_<ms>` and a course `bc_course_<ms>`
// — same millisecond shape, no `_<i>` — so the index is the only difference
// between "the clone wrote this" and "somebody typed this in". The patterns
// below require it, which is why `bc_course_1712345678901` is never a match.
//
// The shared stamp is what groups a run. Every row from one clone carries the
// same one, so a batch is exactly "the rows one Clone tap created" — and the
// stamp is a millisecond epoch, so a report can print WHEN, which is how the
// director confirms it is the run they remember and not something older.
const ID_SHAPES = [
  { col: "bc_players", re: /^p_(\d{10,})_(\d+)$/ },
  { col: "bc_courses", re: /^bc_course_(\d{10,})_(\d+)$/ },
];

// { stamp, index } for a row a clone minted, else null.
export const clonedIdStamp = (id) => {
  for (const { re } of ID_SHAPES) {
    const m = re.exec(String(id ?? ""));
    if (m) return { stamp: Number(m[1]), index: Number(m[2]) };
  }
  return null;
};

export const CLONE_ID_COLLECTIONS = ID_SHAPES.map((s) => s.col);

// ── Does anything point at this row? ──────────────────────────────
// The ids are scanned for as text rather than by field name, and that is
// deliberate. A player id turns up in a dozen shapes across the project —
// `player_id` on a hole score, inside the `teamA`/`teamB` arrays on a match,
// as a KEY in the `players` map on a round lock, on a card signature, a tee
// assignment, a group, a push token. Naming each field is a list that goes
// stale silently, and the failure mode of a stale list is deleting a roster
// row that a scorecard still points at.
//
// The boundary is what makes the text scan safe: ids are `[a-z0-9_]`, so
// `p_1712_1` would otherwise match inside `p_1712_10`. A run of sixteen
// players has both.
export const referencesId = (doc, id) => {
  if (!id) return false;
  const esc = String(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])${esc}([^A-Za-z0-9_]|$)`).test(JSON.stringify(doc));
};

// ── The documents a clone overwrites in place ─────────────────────
// Mirrors what `cloneEdition` copies into `editionDocId(key, tid, true)`. No
// row of these is "the clone's" — it merged into the one that was there — so
// they are reported, never deleted. `rounds` is the count the tournament is
// set up for; four is the cup's own.
export const overwritableDocIds = (tid, roundCount = 4) => [
  ...["tournament", "team_names", "branding"].map((k) => ({ col: "bc_settings", id: `${tid}__${k}`, key: k })),
  ...Array.from({ length: roundCount }, (_, i) => ({
    col: "bc_rounds", id: `${tid}__bc_round_${i + 1}`, key: `round ${i + 1}`,
  })),
];

// ── The plan ──────────────────────────────────────────────────────
// `rows` are the tournament's documents by collection; `scan` is every
// document in the project that could point at one, already narrowed by the
// caller. Returns one batch per clone run, each row marked.
//
// A cloned row that something REFERENCES is not deleted. That is not caution
// for its own sake: a clone made into an occupied edition and then actually
// played on — somebody opened the demo and posted a score — has cards keyed to
// those ids, and deleting the roster row underneath them strands the card
// while leaving it on screen. Refusing and naming it is the only outcome that
// does not lie about what happened.
export const planCloneRemoval = ({ rows = {}, scan = [] }) => {
  const batches = new Map();

  for (const col of CLONE_ID_COLLECTIONS) {
    for (const row of rows[col] || []) {
      const mark = clonedIdStamp(row.id);
      if (!mark) continue;
      if (!batches.has(mark.stamp)) batches.set(mark.stamp, { stamp: mark.stamp, rows: [] });
      const refs = scan.filter((d) => d.id !== row.id && referencesId(d.doc, row.id));
      batches.get(mark.stamp).rows.push({
        col, id: row.id, index: mark.index, row,
        refs: refs.map((r) => ({ col: r.col, id: r.id })),
        safe: refs.length === 0,
      });
    }
  }

  const out = [...batches.values()].sort((a, b) => a.stamp - b.stamp);
  for (const b of out) {
    b.rows.sort((x, y) => x.col.localeCompare(y.col) || x.index - y.index);
    b.safeRows = b.rows.filter((r) => r.safe);
    b.heldRows = b.rows.filter((r) => !r.safe);
  }
  return out;
};

// The rows the tournament had BEFORE any clone — everything without a clone id
// shape. Printed beside the batches so "8 originals + 8 clones" is on screen
// rather than arithmetic the reader does themselves.
export const originalRows = (rows = {}) =>
  CLONE_ID_COLLECTIONS.flatMap((col) =>
    (rows[col] || []).filter((r) => !clonedIdStamp(r.id)).map((row) => ({ col, id: row.id, row })));

// Which sign-ins ended up on two roster rows at once. The clone copies
// `auth_uid`, so the duplicate carries the same account as the original — and
// that is exactly why the two are indistinguishable in Admin → Players: same
// name, same handicap, same crown, same link icon.
export const duplicatedLogins = (players = []) => {
  const byUid = new Map();
  for (const p of players) {
    if (!p.auth_uid) continue;
    if (!byUid.has(p.auth_uid)) byUid.set(p.auth_uid, []);
    byUid.get(p.auth_uid).push(p);
  }
  return [...byUid.entries()]
    .filter(([, ps]) => ps.length > 1)
    .map(([uid, ps]) => ({ uid, players: ps }));
};
