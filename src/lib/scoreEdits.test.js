import { describe, it, expect } from "vitest";
import {
  inAmendmentWindow, amendSeqOf,
  buildScoreEdit, buildHandicapEdit,
  scoreEditDocId, handicapEditDocId,
  editsForAmendment, playersAffected,
} from "./scoreEdits";

const args = (over = {}) => ({
  tournamentId: "bc_2026", round: 2, amendSeq: 1, playerId: "a1", hole: 7,
  from: 5, to: 4, by: "Aaron J", ...over,
});

describe("inAmendmentWindow", () => {
  // The gate that keeps a whole weekend of ordinary scoring out of the log.
  it("is false for every round nobody reopened", () => {
    expect(inAmendmentWindow(null)).toBe(false);
    expect(inAmendmentWindow({ locked: false })).toBe(false);
    expect(inAmendmentWindow({ locked: true })).toBe(false);
    expect(inAmendmentWindow({ locked: true, final: false })).toBe(false);
  });

  it("is false for a round that is final, however often it was amended", () => {
    expect(inAmendmentWindow({ locked: true, final: true, amend_count: 3 })).toBe(false);
  });

  it("is true only for a reopened round still being corrected", () => {
    expect(inAmendmentWindow({ locked: true, final: false, amend_count: 1 })).toBe(true);
  });
});

describe("amendSeqOf", () => {
  it("is zero for a round that was never reopened", () => {
    expect(amendSeqOf(null)).toBe(0);
    expect(amendSeqOf({ locked: true })).toBe(0);
  });

  // Amendment 2's edits must not blend into amendment 1's, or the second
  // finalize replays the first correction's holes at a man whose card is
  // unchanged this time round.
  it("separates one amendment from the next", () => {
    expect(amendSeqOf({ amend_count: 2 })).toBe(2);
    expect(scoreEditDocId({ round: 2, amendSeq: 1, playerId: "a1", hole: 7 }))
      .not.toBe(scoreEditDocId({ round: 2, amendSeq: 2, playerId: "a1", hole: 7 }));
  });
});

describe("buildScoreEdit", () => {
  it("records the hole with both numbers on it", () => {
    const e = buildScoreEdit(args());
    expect(e).toMatchObject({
      kind: "score", round_number: 2, amend_seq: 1, player_id: "a1",
      hole_number: 7, from: 5, to: 4, edited_by: "Aaron J",
    });
  });

  it("keys the same hole to one document however often it is typed", () => {
    expect(buildScoreEdit(args()).id).toBe(buildScoreEdit(args({ to: 3 })).id);
  });

  // THE case this module exists to get right. A director types 5, sees it is
  // wrong, types 4. The man is owed "7 → 4", not "5 → 4".
  it("keeps the ORIGINAL score across a second edit of the same hole", () => {
    const first = buildScoreEdit(args({ from: 7, to: 5 }));
    expect(first.from).toBe(7);
    const second = buildScoreEdit(args({ from: 5, to: 4, previous: first }));
    // `from` is deliberately absent so the merge cannot overwrite the 7.
    expect("from" in second).toBe(false);
    expect(second.to).toBe(4);
  });

  // A director opens the wrong card, types, and undoes it. The card now reads
  // exactly as the man signed it; telling him it moved is a false alarm the
  // app produced entirely by its own bookkeeping.
  it("asks for the row to be removed when a hole comes back to where it started", () => {
    const first = buildScoreEdit(args({ from: 7, to: 5 }));
    const back = buildScoreEdit(args({ from: 5, to: 7, previous: first }));
    expect(back).toEqual({ revert: true, id: first.id });
  });

  it("records nothing at all when the first edit changes nothing", () => {
    expect(buildScoreEdit(args({ from: 5, to: 5 }))).toBe(null);
  });

  // Scores come off number inputs and round-trip through Firestore. One
  // string in that chain would report a correction on every hole.
  it("does not read a stored string as a change", () => {
    expect(buildScoreEdit(args({ from: "4", to: 4 }))).toBe(null);
  });

  it("treats a blank and an unplayed hole as the same hole", () => {
    expect(buildScoreEdit(args({ from: null, to: "" }))).toBe(null);
    expect(buildScoreEdit(args({ from: null, to: 5 }))).toMatchObject({ from: null, to: 5 });
    expect(buildScoreEdit(args({ from: 5, to: null }))).toMatchObject({ from: 5, to: null });
  });
});

describe("buildHandicapEdit", () => {
  it("records one row per player per amendment", () => {
    const e = buildHandicapEdit(args({ from: 12, to: 14 }));
    expect(e).toMatchObject({ kind: "handicap", player_id: "a1", from: 12, to: 14 });
    expect(e.id).toBe(handicapEditDocId({ round: 2, amendSeq: 1, playerId: "a1" }));
    expect(e.hole_number).toBeUndefined();
  });

  it("keeps the original across a second recalculate", () => {
    const first = buildHandicapEdit(args({ from: 12, to: 14 }));
    const second = buildHandicapEdit(args({ from: 14, to: 15, previous: first }));
    expect("from" in second).toBe(false);
    expect(second.to).toBe(15);
  });

  it("asks for removal when a recalculate lands back on the original", () => {
    const first = buildHandicapEdit(args({ from: 12, to: 14 }));
    expect(buildHandicapEdit(args({ from: 14, to: 12, previous: first })))
      .toEqual({ revert: true, id: first.id });
  });

  it("never collides with a score row for the same player", () => {
    expect(handicapEditDocId({ round: 2, amendSeq: 1, playerId: "a1" }))
      .not.toBe(scoreEditDocId({ round: 2, amendSeq: 1, playerId: "a1", hole: 7 }));
  });
});

describe("reading the log back", () => {
  const log = {
    e1: { id: "e1", round_number: 2, amend_seq: 1, player_id: "a1", kind: "score" },
    e2: { id: "e2", round_number: 2, amend_seq: 1, player_id: "b1", kind: "score" },
    e3: { id: "e3", round_number: 2, amend_seq: 2, player_id: "c1", kind: "score" },
    e4: { id: "e4", round_number: 3, amend_seq: 1, player_id: "d1", kind: "score" },
  };

  it("takes one amendment of one round and nothing else", () => {
    expect(editsForAmendment(log, 2, 1).map(e => e.id)).toEqual(["e1", "e2"]);
    expect(editsForAmendment(log, 2, 2).map(e => e.id)).toEqual(["e3"]);
    expect(editsForAmendment(log, 3, 1).map(e => e.id)).toEqual(["e4"]);
  });

  it("names each affected player once", () => {
    expect(playersAffected(log, 2, 1).sort()).toEqual(["a1", "b1"]);
    expect(playersAffected(log, 4, 1)).toEqual([]);
    expect(playersAffected(null, 2, 1)).toEqual([]);
  });
});
