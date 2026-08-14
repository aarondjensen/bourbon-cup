// What scripts/undo-clone.mjs is allowed to delete out of a live tournament.
//
// The whole point of the split is that this half is testable: "which of these
// two Aaron Jensens did the clone write" is not a question to answer by eye
// against production, and the cost of getting it wrong is a roster row a
// scorecard still points at.
import { describe, it, expect } from "vitest";
import {
  clonedIdStamp, referencesId, planCloneRemoval, planDuplicateRemoval, contentKey,
  originalRows, duplicatedLogins, overwritableDocIds,
} from "./cloneAudit";

const STAMP = 1755093742318;
const clonedPlayer = (i, extra = {}) => ({
  id: `p_${STAMP}_${i}`, player_id: `p_${STAMP}_${i}`, tournament_id: "bc_2026", ...extra,
});

describe("clonedIdStamp", () => {
  it("reads the stamp and index off a cloned id", () => {
    expect(clonedIdStamp(`p_${STAMP}_0`)).toEqual({ stamp: STAMP, index: 0 });
    expect(clonedIdStamp(`bc_course_${STAMP}_3`)).toEqual({ stamp: STAMP, index: 3 });
  });

  it("does not claim ids the app minted", () => {
    // The difference is the trailing index and nothing else — the app's own
    // ids carry the same millisecond shape. If this ever starts matching,
    // the script deletes rows a director typed in.
    expect(clonedIdStamp("bc_player_1712345678901")).toBeNull();
    expect(clonedIdStamp("bc_course_1712345678901")).toBeNull();
    expect(clonedIdStamp("hist_2019_paulw")).toBeNull();
    expect(clonedIdStamp("bc_player_1712345678901_2")).toBeNull();
    expect(clonedIdStamp(undefined)).toBeNull();
  });
});

describe("referencesId", () => {
  it("finds an id wherever it sits in a document", () => {
    const id = `p_${STAMP}_2`;
    expect(referencesId({ player_id: id }, id)).toBe(true);              // a field
    expect(referencesId({ teamA: ["x", id], teamB: [] }, id)).toBe(true); // inside an array
    expect(referencesId({ players: { [id]: { ch: 9 } } }, id)).toBe(true); // as a KEY
    expect(referencesId({ note: `paid for ${id}` }, id)).toBe(true);      // in prose
  });

  it("does not let one id match inside a longer one", () => {
    // A sixteen-man roster has both `_1` and `_10`, and a bare substring test
    // would report the shorter as referenced and refuse to delete it.
    expect(referencesId({ player_id: `p_${STAMP}_10` }, `p_${STAMP}_1`)).toBe(false);
    expect(referencesId({ player_id: `p_${STAMP}_1` }, `p_${STAMP}_1`)).toBe(true);
  });

  it("is false for an absent id", () => {
    expect(referencesId({ player_id: "bc_player_1" }, `p_${STAMP}_0`)).toBe(false);
    expect(referencesId({ a: 1 }, "")).toBe(false);
  });
});

describe("planCloneRemoval", () => {
  const rows = {
    bc_players: [
      { id: "bc_player_1712345678901", name: "Aaron J" },   // the original
      clonedPlayer(0, { name: "Aaron J" }),                 // its duplicate
      clonedPlayer(1, { name: "Pete C" }),
    ],
    bc_courses: [{ id: `bc_course_${STAMP}_0`, name: "Treetops" }],
  };

  it("groups by the stamp of the run that made them", () => {
    const [batch, ...rest] = planCloneRemoval({ rows });
    expect(rest).toHaveLength(0);
    expect(batch.stamp).toBe(STAMP);
    expect(batch.rows.map((r) => r.id)).toEqual([
      `bc_course_${STAMP}_0`, `p_${STAMP}_0`, `p_${STAMP}_1`,
    ]);
    expect(batch.safeRows).toHaveLength(3);
    expect(batch.heldRows).toHaveLength(0);
  });

  it("separates two clone runs into two batches", () => {
    const later = STAMP + 90000;
    const [a, b] = planCloneRemoval({
      rows: { bc_players: [clonedPlayer(0), { id: `p_${later}_0`, name: "x" }] },
    });
    expect([a.stamp, b.stamp]).toEqual([STAMP, later]);
  });

  it("holds a row a hole score still points at", () => {
    const plan = planCloneRemoval({
      rows,
      scan: [{ col: "bc_hole_scores", id: "h1", doc: { player_id: `p_${STAMP}_1`, strokes: 4 } }],
    });
    const held = plan[0].heldRows;
    expect(held).toHaveLength(1);
    expect(held[0].id).toBe(`p_${STAMP}_1`);
    expect(held[0].refs).toEqual([{ col: "bc_hole_scores", id: "h1" }]);
    // And the others are still deletable — one played-on row does not freeze
    // the whole batch.
    expect(plan[0].safeRows.map((r) => r.id)).toEqual([`bc_course_${STAMP}_0`, `p_${STAMP}_0`]);
  });

  it("holds a row named only inside a match's team array", () => {
    const plan = planCloneRemoval({
      rows,
      scan: [{ col: "bc_matches", id: "m1", doc: { teamA: ["bc_player_x", `p_${STAMP}_0`], teamB: [] } }],
    });
    expect(plan[0].heldRows.map((r) => r.id)).toEqual([`p_${STAMP}_0`]);
  });

  it("does not count a row as a reference to itself", () => {
    // Every roster row carries its own id in `player_id`; without this the
    // plan would hold every row and delete nothing.
    const plan = planCloneRemoval({ rows, scan: [{ col: "bc_players", id: `p_${STAMP}_0`, doc: rows.bc_players[1] }] });
    expect(plan[0].safeRows.map((r) => r.id)).toContain(`p_${STAMP}_0`);
  });

  it("never marks an app-minted row at all", () => {
    const plan = planCloneRemoval({ rows });
    const ids = plan.flatMap((b) => b.rows.map((r) => r.id));
    expect(ids).not.toContain("bc_player_1712345678901");
  });

  it("is empty for an edition no clone landed in", () => {
    expect(planCloneRemoval({ rows: { bc_players: [{ id: "bc_player_1" }] } })).toEqual([]);
  });
});

describe("originalRows", () => {
  it("is everything the clone did not write", () => {
    const out = originalRows({
      bc_players: [{ id: "bc_player_1" }, clonedPlayer(0)],
      bc_courses: [{ id: "bc_course_1712345678901" }],
    });
    expect(out.map((r) => r.id)).toEqual(["bc_player_1", "bc_course_1712345678901"]);
  });
});

describe("duplicatedLogins", () => {
  it("finds the account that ended up on two roster rows", () => {
    const out = duplicatedLogins([
      { id: "bc_player_1", name: "Aaron J", auth_uid: "uid-a" },
      { id: `p_${STAMP}_0`, name: "Aaron J", auth_uid: "uid-a" },
      { id: "bc_player_2", name: "Andy H", auth_uid: "uid-b" },
      { id: "bc_player_3", name: "Jim H" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].uid).toBe("uid-a");
    expect(out[0].players.map((p) => p.id)).toEqual(["bc_player_1", `p_${STAMP}_0`]);
  });

  it("ignores rows nobody has claimed", () => {
    expect(duplicatedLogins([{ id: "a" }, { id: "b" }])).toEqual([]);
  });
});

describe("contentKey", () => {
  it("ignores the three fields two copies of a row must differ on", () => {
    expect(contentKey({ id: "a", tournament_id: "bc_2026", player_id: "a", name: "Aaron J" }))
      .toBe(contentKey({ id: "b", tournament_id: "bc_2026", player_id: "b", name: "Aaron J" }));
  });

  it("does not care what order Firestore hands back the keys", () => {
    expect(contentKey({ name: "Treetops", par: 72, tees: [{ name: "Blue", yards: 6800 }] }))
      .toBe(contentKey({ tees: [{ yards: 6800, name: "Blue" }], par: 72, name: "Treetops" }));
  });

  it("separates rows that genuinely differ", () => {
    expect(contentKey({ id: "a", name: "Treetops", par: 72 }))
      .not.toBe(contentKey({ id: "b", name: "Treetops", par: 71 }));
  });
});

describe("planDuplicateRemoval", () => {
  // The 2026 shape: the clone copied the courses AND the rounds, and the round
  // documents merged in place, so they came out pointing at the COPIES. Two
  // courses called Gaylord CC, and the wired-in one is the clone.
  const rows = {
    bc_courses: [
      { id: "bc_course_1712345678901", tournament_id: "bc_2026", name: "Gaylord CC", par: 72 },
      { id: `bc_course_${STAMP}_0`, tournament_id: "bc_2026", name: "Gaylord CC", par: 72 },
    ],
  };
  const scan = [{ col: "bc_rounds", id: "r1", doc: { course_id: `bc_course_${STAMP}_0` } }];

  it("keeps the copy something points at and drops the spare", () => {
    const [t] = planDuplicateRemoval({ rows, scan });
    expect(t.keep.id).toBe(`bc_course_${STAMP}_0`);
    expect(t.drop.map((d) => d.id)).toEqual(["bc_course_1712345678901"]);
    expect(t.blocked).toHaveLength(0);
  });

  it("prefers the app's own id when neither twin is referenced", () => {
    const [t] = planDuplicateRemoval({ rows });
    expect(t.keep.id).toBe("bc_course_1712345678901");
    expect(t.drop.map((d) => d.id)).toEqual([`bc_course_${STAMP}_0`]);
  });

  it("never drops a row something points at", () => {
    // Two referenced twins is a merge decision, not a tidy-up: something
    // points at each, and picking one silently repoints the other's reference.
    const [t] = planDuplicateRemoval({
      rows,
      scan: [...scan, { col: "bc_rounds", id: "r2", doc: { course_id: "bc_course_1712345678901" } }],
    });
    expect(t.drop).toHaveLength(0);
    expect(t.blocked.map((b) => b.id)).toEqual([`bc_course_${STAMP}_0`]);
  });

  it("picks the same keeper whichever order the rows arrive in", () => {
    // The rank is explicit for this reason — Firestore's ordering is not part
    // of the decision, so a dry run and the write after it always agree.
    const forward = planDuplicateRemoval({ rows, scan })[0];
    const backward = planDuplicateRemoval({ rows: { bc_courses: [...rows.bc_courses].reverse() }, scan })[0];
    expect(backward.keep.id).toBe(forward.keep.id);
    expect(backward.drop.map((d) => d.id)).toEqual(forward.drop.map((d) => d.id));
  });

  it("leaves rows that only look alike alone", () => {
    const out = planDuplicateRemoval({
      rows: {
        bc_courses: [
          { id: "a", name: "Gaylord CC", par: 72 },
          { id: "b", name: "Gaylord CC", par: 71 },   // a director corrected one
        ],
      },
    });
    expect(out).toEqual([]);
  });

  it("finds a duplicated roster row the same way", () => {
    const [t] = planDuplicateRemoval({
      rows: {
        bc_players: [
          { id: "bc_player_1", player_id: "bc_player_1", name: "Aaron J", auth_uid: "uid-a" },
          { id: `p_${STAMP}_0`, player_id: `p_${STAMP}_0`, name: "Aaron J", auth_uid: "uid-a" },
        ],
      },
      scan: [{ col: "bc_ledger", id: "l1", doc: { player_id: "bc_player_1", amount: 200 } }],
    });
    // The money is on the original, so the original stays.
    expect(t.keep.id).toBe("bc_player_1");
    expect(t.drop.map((d) => d.id)).toEqual([`p_${STAMP}_0`]);
  });

  it("is empty when nothing is duplicated", () => {
    expect(planDuplicateRemoval({ rows: { bc_courses: [{ id: "a", name: "Gaylord CC" }] } })).toEqual([]);
  });
});

describe("overwritableDocIds", () => {
  it("names exactly what cloneEdition merges over in place", () => {
    expect(overwritableDocIds("bc_2026", 2).map((o) => o.id)).toEqual([
      "bc_2026__tournament", "bc_2026__team_names", "bc_2026__branding",
      "bc_2026__bc_round_1", "bc_2026__bc_round_2",
    ]);
  });
});
