// ══════════════════════════════════════════════════════════════════
//  Finalize → reopen → correct → re-finalize, end to end
// ══════════════════════════════════════════════════════════════════
//
// The pieces of this feature are each unit-tested and each one is pure, but
// they live on opposite sides of the wire: the lock and the edit rows are
// written by the app (src/lib), and the notification is built by a Cloud
// Function (functions/) that can never import them. The two halves agree on
// three things and nothing enforces that agreement at runtime —
//
//   amend_count   survives every write between the reopen and the re-finalize,
//                 because it is what the trigger fires on
//   amend_seq     on an edit row equals that same number, because it is what
//                 the query filters on
//   the row shape the app writes is the row shape the notice reads
//
// — and if any of them drifts the failure is SILENT: the round finalizes
// normally and nobody is told their card moved. That is the same class of
// failure the attestation exists to prevent, so it is walked here rather than
// left to the two sides' separate tests.
import { describe, it, expect } from "vitest";
import { buildRoundLockDoc, markRoundFinal, refreshRoundLockDoc } from "./roundLocks";
import { recordAmendment, describeRefreshImpact, describeSettingValue } from "./roundAmend";
import { unfinalizeRound } from "./roundLocks";
import {
  inAmendmentWindow, amendSeqOf, buildScoreEdit, buildHandicapEdit, buildSettingEdit,
  editsForAmendment,
} from "./scoreEdits";
import { amendmentNotices } from "../../functions/amendmentNotice.js";

const PARS = Array(18).fill(4);
const course = {
  id: "c1", name: "Treetops", par: 72, slope: 113, rating: 72,
  hole_pars: PARS, hole_handicaps: PARS.map((_, i) => i + 1),
  tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }],
};
const tPlayers = [
  { player_id: "a1", name: "Sam O", team: "A", handicap_index: 4 },
  { player_id: "b1", name: "Vic C", team: "B", handicap_index: 10 },
];
const tr = {
  round_number: 2, format: "singles", course_id: "c1", tee_box: "White",
  allowance: { enabled: true, pct: 100 },
};
const MATCHMATES = { a1: ["b1"], b1: ["a1"] };

const freshLock = () => buildRoundLockDoc({
  tournamentId: "bc_2026", round: 2, players: tPlayers, tRounds: [tr], courses: [course],
});

// The app's own write path, minus Firestore: build the row, then apply it to
// the local map the way App.recordScoreEdit does.
const applyEdit = (log, edit) => {
  if (!edit) return log;
  if (edit.revert) { const next = { ...log }; delete next[edit.id]; return next; }
  return { ...log, [edit.id]: { ...log[edit.id], ...edit } };
};

describe("the whole correction, from finalize to notification", () => {
  it("tells the man whose hole moved, and the opponent who attested it", () => {
    // Friday: the round is played and closed.
    let lock = markRoundFinal(freshLock(), "Aaron J");
    expect(inAmendmentWindow(lock)).toBe(false);

    // Sunday: a wrong hole is found and the round is reopened.
    lock = recordAmendment(unfinalizeRound(lock, "Aaron J"), {
      by: "Aaron J", reason: "Hole 7 posted to the wrong player",
    });
    expect(inAmendmentWindow(lock)).toBe(true);
    const seq = amendSeqOf(lock);
    expect(seq).toBe(1);

    // The correction — typed wrong once, then right.
    let log = {};
    log = applyEdit(log, buildScoreEdit({
      tournamentId: "bc_2026", round: 2, amendSeq: seq, playerId: "a1",
      hole: 7, from: 7, to: 5, by: "Aaron J", previous: null,
    }));
    const firstId = Object.keys(log)[0];
    log = applyEdit(log, buildScoreEdit({
      tournamentId: "bc_2026", round: 2, amendSeq: seq, playerId: "a1",
      hole: 7, from: 5, to: 4, by: "Aaron J", previous: log[firstId],
    }));

    // Monday: it is finalized again. This is the edge the trigger fires on.
    const refinalized = markRoundFinal(lock, "Aaron J");
    expect(refinalized.final).toBe(true);
    // The number the Cloud Function keys on, and the number it queries with.
    expect(refinalized.amend_count).toBe(seq);

    const edits = editsForAmendment(log, 2, refinalized.amend_count);
    const notices = amendmentNotices({ round: 2, edits, matchmates: MATCHMATES });

    expect(notices.map(n => n.playerId).sort()).toEqual(["a1", "b1"]);
    // The original 7, not the mistyped 5 — the whole point of the previous
    // chain surviving the round trip.
    expect(notices.find(n => n.playerId === "a1").body).toBe("Round 2: hole 7 now 4 (was 7).");
    expect(notices.find(n => n.playerId === "b1").body).toMatch(/A card in your Round 2 match/);
  });

  // The other half of a correction, and the one nobody would think to check:
  // not a number on the card, but the strokes underneath it.
  //
  // A CORRECTED ALLOWANCE MOVES NO STORED HANDICAP. `ch` in the snapshot is
  // raw; the allowance is applied downstream of it in scoring.js. So diffing
  // only the players reports nothing at all for a change that re-scores the
  // entire round — which is why describeRefreshImpact reports the round's
  // frozen settings as well, and why this walk asserts on those.
  it("tells the field when the round's own terms moved, with no handicap moving", () => {
    let lock = markRoundFinal(freshLock(), "Aaron J");
    lock = recordAmendment(unfinalizeRound(lock, "Aaron J"), { by: "Aaron J", reason: "wrong allowance" });
    const seq = amendSeqOf(lock);

    // The director corrects the allowance and recalculates.
    const corrected = { ...tr, allowance: { enabled: true, pct: 50 } };
    const next = refreshRoundLockDoc({
      tournamentId: "bc_2026", round: 2, players: tPlayers,
      tRounds: [corrected], courses: [course], previous: lock,
    });
    const impact = describeRefreshImpact({ locks: { 2: lock }, round: 2, nextLock: next });
    expect(impact.changed).toBe(0);              // not one stored CH moves
    expect(impact.settingsChanged).toBe(1);      // and the round still re-scores
    expect(impact.settings[0].key).toBe("allowance");

    // A recalculate rebuilds the snapshot from scratch — the amendment marks
    // have to ride through it or the trigger never fires.
    expect(next.amend_count).toBe(seq);

    let log = {};
    impact.settings.forEach(d => {
      const e = buildSettingEdit({
        tournamentId: "bc_2026", round: 2, amendSeq: seq, field: d.key, label: d.label,
        from: describeSettingValue(d.from), to: describeSettingValue(d.to), by: "Aaron J",
      });
      log = applyEdit(log, e);
    });

    const refinalized = markRoundFinal(next, "Aaron J");
    const notices = amendmentNotices({
      round: 2,
      edits: editsForAmendment(log, 2, refinalized.amend_count),
      matchmates: MATCHMATES,
    });
    // Everybody who played hears, because everybody's strokes moved.
    expect(notices.map(n => n.playerId).sort()).toEqual(["a1", "b1"]);
    expect(notices[0].body).toBe("Round 2: Handicap allowance 100% → 50%. Your strokes may have moved.");
  });

  // A handicap that genuinely moves — a re-synced index — still reports per
  // player, which is the case the settings path must not have displaced.
  it("still names the man whose own handicap moved", () => {
    let lock = markRoundFinal(freshLock(), "Aaron J");
    lock = recordAmendment(unfinalizeRound(lock, "Aaron J"), { by: "Aaron J", reason: "wrong index" });
    const seq = amendSeqOf(lock);

    const resynced = [tPlayers[0], { ...tPlayers[1], handicap_index: 20 }];
    const next = refreshRoundLockDoc({
      tournamentId: "bc_2026", round: 2, players: resynced,
      tRounds: [tr], courses: [course], previous: lock,
    });
    const impact = describeRefreshImpact({ locks: { 2: lock }, round: 2, nextLock: next });
    expect(impact.changed).toBe(1);
    expect(impact.rows[0].pid).toBe("b1");

    let log = {};
    impact.rows.forEach(row => {
      log = applyEdit(log, buildHandicapEdit({
        tournamentId: "bc_2026", round: 2, amendSeq: seq, playerId: row.pid,
        from: row.from, to: row.to, by: "Aaron J", previous: null,
      }));
    });

    const refinalized = markRoundFinal(next, "Aaron J");
    const notices = amendmentNotices({
      round: 2,
      edits: editsForAmendment(log, 2, refinalized.amend_count),
      matchmates: MATCHMATES,
    });
    expect(notices.find(n => n.ownCard).playerId).toBe("b1");
    expect(notices.find(n => n.ownCard).body).toMatch(/handicap \d+ → \d+/);
  });

  // The most common amendment there is: reopened to fix a Nassau pot, which
  // moves nobody's card. Silence is the correct outcome.
  it("says nothing when the amendment moved no card", () => {
    let lock = markRoundFinal(freshLock(), "Aaron J");
    lock = recordAmendment(unfinalizeRound(lock, "Aaron J"), { by: "Aaron J", reason: "Nassau pots" });
    const refinalized = markRoundFinal(lock, "Aaron J");
    const edits = editsForAmendment({}, 2, refinalized.amend_count);
    expect(amendmentNotices({ round: 2, edits, matchmates: MATCHMATES })).toEqual([]);
  });

  // A hole corrected and then put back. The card reads as signed, so the man
  // must not be told it moved.
  it("says nothing when every correction was undone before finalizing", () => {
    let lock = markRoundFinal(freshLock(), "Aaron J");
    lock = recordAmendment(unfinalizeRound(lock, "Aaron J"), { by: "Aaron J", reason: "wrong card" });
    const seq = amendSeqOf(lock);

    let log = {};
    const one = buildScoreEdit({
      tournamentId: "bc_2026", round: 2, amendSeq: seq, playerId: "a1",
      hole: 7, from: 5, to: 4, by: "Aaron J", previous: null,
    });
    log = applyEdit(log, one);
    expect(Object.keys(log)).toHaveLength(1);

    log = applyEdit(log, buildScoreEdit({
      tournamentId: "bc_2026", round: 2, amendSeq: seq, playerId: "a1",
      hole: 7, from: 4, to: 5, by: "Aaron J", previous: log[one.id],
    }));
    expect(Object.keys(log)).toHaveLength(0);

    const refinalized = markRoundFinal(lock, "Aaron J");
    expect(amendmentNotices({
      round: 2, edits: editsForAmendment(log, 2, refinalized.amend_count), matchmates: MATCHMATES,
    })).toEqual([]);
  });

  // A round reopened twice was corrected twice. Replaying the first
  // correction's holes on the second finalize tells a man his card moved when
  // this time it did not.
  it("keeps a second amendment's notification clear of the first's edits", () => {
    let lock = markRoundFinal(freshLock(), "Aaron J");
    lock = recordAmendment(unfinalizeRound(lock, "Aaron J"), { by: "Aaron J", reason: "first" });

    let log = applyEdit({}, buildScoreEdit({
      tournamentId: "bc_2026", round: 2, amendSeq: amendSeqOf(lock), playerId: "a1",
      hole: 7, from: 5, to: 4, by: "Aaron J", previous: null,
    }));
    lock = markRoundFinal(lock, "Aaron J");
    expect(editsForAmendment(log, 2, lock.amend_count)).toHaveLength(1);

    // Reopened again, this time only to fix a setting.
    lock = recordAmendment(unfinalizeRound(lock, "Aaron J"), { by: "Aaron J", reason: "second" });
    const second = markRoundFinal(lock, "Aaron J");
    expect(second.amend_count).toBe(2);
    expect(editsForAmendment(log, 2, second.amend_count)).toEqual([]);
    expect(amendmentNotices({
      round: 2, edits: editsForAmendment(log, 2, second.amend_count), matchmates: MATCHMATES,
    })).toEqual([]);
  });

  // The gate. An ordinary round taking its first scores must never write a
  // single row through this path.
  it("is inert for a round nobody ever finalized", () => {
    const open = freshLock();
    expect(inAmendmentWindow(open)).toBe(false);
    expect(amendSeqOf(open)).toBe(0);
    expect(markRoundFinal(open, "Aaron J").amend_count).toBe(0);
  });
});
