import { describe, it, expect } from "vitest";
import { missingForCard, skippedHoles, cardComplete, attestedPids, isFullyAttested, pendingAttestations, withdrawnIds, sigForMatch, cardState, roundCardProgress } from "./cardSigs";

// The can't-sign strip has now been wrong twice in the same direction: it
// told a scorer his card was short while he was still tapping in the group
// standing next to him. Both times the cause was the window it counts over,
// and both times it looked reasonable in the source. So the window gets
// pinned here rather than re-argued.
//
// The rule it encodes: a hole is a GAP only when somebody has posted on it
// AND the group has moved past it. The hole they are on is neither.

const PIDS = ["pete", "jim", "nick", "paul"];
const match = { round: 1, teamA: ["pete", "jim"], teamB: ["nick", "paul"] };

// { pid: [holeIdx, ...] } → holeData
const hd = (spec) => {
  const out = {};
  for (const p of PIDS) out[`${p}_1`] = {};
  for (const [pid, holes] of Object.entries(spec)) for (const h of holes) out[`${pid}_1`][h] = 4;
  return out;
};
const upTo = (n) => [...Array(n).keys()];
const all = (n) => Object.fromEntries(PIDS.map(p => [p, upTo(n)]));
const names = (r) => r.map(m => m.pid);

describe("missingForCard — the hole in progress is never a gap", () => {
  it("says nothing when the first of four is entered on hole 1", () => {
    expect(missingForCard(match, hd({ pete: [0] }))).toEqual([]);
  });

  it("still says nothing at three of four on hole 1", () => {
    expect(missingForCard(match, hd({ pete: [0], jim: [0], nick: [0] }))).toEqual([]);
  });

  it("says nothing mid-way through hole 10 of a clean round", () => {
    expect(missingForCard(match, hd({ ...all(9), pete: upTo(10) }))).toEqual([]);
  });

  it("says nothing when the group is on 18 waiting for the fourth card", () => {
    expect(missingForCard(match, hd({ ...all(18), paul: upTo(17) }))).toEqual([]);
  });
});

describe("missingForCard — a real gap behind the group", () => {
  it("names the player and the hole", () => {
    const gap = hd({ ...all(9), nick: upTo(9).filter(h => h !== 3) });
    expect(missingForCard(match, gap)).toEqual([{ pid: "nick", holes: [4] }]);
  });

  it("keeps naming it while the next hole is being played", () => {
    const gap = hd({ ...all(9), nick: upTo(9).filter(h => h !== 3), pete: upTo(10), jim: upTo(10) });
    expect(missingForCard(match, gap)).toEqual([{ pid: "nick", holes: [4] }]);
  });

  it("names a gap that only surfaces once all 18 are in", () => {
    const gap = hd({ ...all(18), nick: upTo(18).filter(h => h !== 6) });
    expect(missingForCard(match, gap)).toEqual([{ pid: "nick", holes: [7] }]);
  });

  it("names a player who has posted nothing at all", () => {
    const gap = hd({ pete: upTo(18), jim: upTo(18), nick: upTo(18) });
    expect(names(missingForCard(match, gap))).toEqual(["paul"]);
  });
});

describe("missingForCard — holes the group has not reached", () => {
  it("is silent on an untouched card", () => {
    expect(missingForCard(match, hd({}))).toEqual([]);
  });

  it("is silent on a complete card", () => {
    expect(missingForCard(match, hd(all(18)))).toEqual([]);
  });

  // A shotgun start leaves the front of the card blank for most of the
  // round. Counting those would make the strip permanent and useless.
  it("ignores the holes before a shotgun group's starting hole", () => {
    const shotgun = Object.fromEntries(PIDS.map(p => [p, upTo(9).slice(4)]));
    expect(missingForCard(match, hd(shotgun))).toEqual([]);
  });

  // ── The hole the WHOLE group skipped ──
  // The one gap the strip could never see. `missingForCard` only ever looked
  // at holes SOMEBODY had scored, so a hole nobody scored was missing for
  // nobody — and the engine skips an unscored hole too, so the front, the
  // back and the overall went on being computed around it in silence. Found
  // on a demo card: holes 1-10 in, the 11th blank, 12 and 13 in, the group
  // standing on the 14th and the status reading OVERALL TIED.
  it("names a hole nobody in the group scored", () => {
    // Holes 1-13 posted by everybody, except index 10 — hole 11.
    const gap = Object.fromEntries(PIDS.map(p => [p, upTo(13).filter(h => h !== 10)]));
    expect(missingForCard(match, hd(gap))).toEqual(
      PIDS.map(pid => ({ pid, holes: [11] })));
    expect(skippedHoles(match, hd(gap))).toEqual([11]);
  });

  it("says nothing of the kind about a shotgun group's blank front", () => {
    // The window starts at the group's FIRST scored hole, not at hole 1 — a
    // side that went off the 5th has four holes it has not reached, and they
    // are not gaps because holes above them are filled.
    const shotgun = Object.fromEntries(PIDS.map(p => [p, upTo(9).slice(4)]));
    expect(skippedHoles(match, hd(shotgun))).toEqual([]);
  });

  it("says nothing of the kind about the holes ahead of a clean group", () => {
    expect(skippedHoles(match, hd(all(9)))).toEqual([]);
    expect(skippedHoles(match, hd({}))).toEqual([]);
  });

  it("is not what decides whether a card can be signed", () => {
    // Silent strip, and still unsignable — 18 holes is cardComplete's bar.
    const onNine = hd(all(9));
    expect(missingForCard(match, onNine)).toEqual([]);
    expect(cardComplete(match, onNine)).toBe(false);
  });
});


// ── Two phones attesting the same card ──────────────────────────────
// The array append these replaced lost one of them; see lib/cardSigs.
describe("attestedPids", () => {
  const match = { round: 1, teamA: ["a", "b"], teamB: ["c", "d"] };

  it("reads a card signed before the map existed", () => {
    expect(attestedPids({ attested_by: ["b", "c"] })).toEqual(["b", "c"]);
  });

  it("reads a card attested only through the map", () => {
    expect(attestedPids({ attests: { b: { at: "t" }, c: { at: "t" } } }).sort())
      .toEqual(["b", "c"]);
  });

  it("folds a card part-written under each shape into one list", () => {
    // One attestation landed before the deploy, one after.
    expect(attestedPids({ attested_by: ["b"], attests: { c: { at: "t" } } }).sort())
      .toEqual(["b", "c"]);
  });

  it("does not double-count a player present in both", () => {
    expect(attestedPids({ attested_by: ["b"], attests: { b: { at: "t" } } })).toEqual(["b"]);
  });

  it("treats a nulled map key as no attestation", () => {
    // A merge cannot remove a key, so absence is read off the value.
    expect(attestedPids({ attests: { b: null } })).toEqual([]);
  });

  it("survives rubbish rather than taking the card down", () => {
    expect(attestedPids(null)).toEqual([]);
    expect(attestedPids({ attested_by: "nope", attests: "nope" })).toEqual([]);
  });

  it("completes a card when two attesters arrive as separate keys", () => {
    // The case the old shape lost: b and c wrote from the same snapshot.
    const sig = { signed_by: "a", attests: { b: { at: "t" }, c: { at: "t" } } };
    expect(isFullyAttested(match, sig)).toBe(false);   // d has not attested
    const all = { ...sig, attests: { ...sig.attests, d: { at: "t" } } };
    expect(isFullyAttested(match, all)).toBe(true);
  });

  it("stops counting an attestation the player already gave", () => {
    const sig = { signed_by: "a", attests: { b: { at: "t" } } };
    expect(pendingAttestations([{ id: "m1", ...match }], [{ match_id: "m1", ...sig }], "b"))
      .toHaveLength(0);
    expect(pendingAttestations([{ id: "m1", ...match }], [{ match_id: "m1", ...sig }], "c"))
      .toHaveLength(1);
  });
});

// ── A man who walked in ─────────────────────────────────────────────
// Until this existed his three partners were left with a card that could
// never be signed. Nothing here touches scoring — see lib/cardSigs.
describe("withdrawals", () => {
  const match = { id: "m1", round: 1, teamA: ["a", "b"], teamB: ["c", "d"] };
  const full = () => Object.fromEntries(Array.from({ length: 18 }, (_, h) => [h, 4]));
  const nine = () => Object.fromEntries(Array.from({ length: 9 }, (_, h) => [h, 4]));
  const holeData = { a_1: full(), b_1: full(), c_1: full(), d_1: nine() };

  it("blocks the card while everybody is still expected to finish", () => {
    expect(cardComplete(match, holeData)).toBe(false);
  });

  it("lets the card complete once the man who walked in is marked", () => {
    expect(cardComplete(match, holeData, withdrawnIds([{ player_id: "d", withdrawn: true }]))).toBe(true);
  });

  it("stops naming his missing holes in the can't-sign strip", () => {
    const before = missingForCard(match, holeData);
    expect(before.map(m => m.pid)).toContain("d");
    const after = missingForCard(match, holeData, new Set(["d"]));
    expect(after.map(m => m.pid)).not.toContain("d");
  });

  it("still reads the frontier off HIS holes — they say where the group got to", () => {
    // Only he has played the 10th. Dropping him from the frontier would make
    // the other three's blanks on it read as gaps.
    const hd = { a_1: nine(), b_1: nine(), c_1: nine(), d_1: { ...nine(), 9: 5 } };
    expect(missingForCard(match, hd, new Set(["d"]))).toEqual([]);
  });

  it("does not wait on him for an attestation, or ask him for one", () => {
    const sig = { match_id: "m1", signed_by: "a", attests: { b: { at: "t" }, c: { at: "t" } } };
    expect(isFullyAttested(match, sig)).toBe(false);
    expect(isFullyAttested(match, sig, new Set(["d"]))).toBe(true);
    expect(pendingAttestations([match], [sig], "d", new Set(["d"]))).toHaveLength(0);
  });

  it("counts nobody as withdrawn on a roster with no flags", () => {
    expect(withdrawnIds([{ player_id: "a" }, { player_id: "b", withdrawn: false }]).size).toBe(0);
    expect(withdrawnIds(null).size).toBe(0);
  });
});

describe("sigForMatch", () => {
  it("finds a card by match_id, not by its own document id", () => {
    const sigs = [{ id: "bc_sig_r1_m1", match_id: "m1", signed_by: "a" }];
    expect(sigForMatch(sigs, "m1")?.signed_by).toBe("a");
  });

  it("is null for a match with no card, an empty list, or nothing at all", () => {
    expect(sigForMatch([{ match_id: "m1" }], "m2")).toBeNull();
    expect(sigForMatch([], "m1")).toBeNull();
    expect(sigForMatch(null, "m1")).toBeNull();
  });
});

// ── The three named states, and who is asking for a re-sign ─────────
describe("cardState", () => {
  const match = { id: "m1", round: 1, teamA: ["a", "b"], teamB: ["c", "d"] };

  it("is open with no signature at all", () => {
    expect(cardState(match, null)).toBe("open");
  });

  it("is signed while at least one other player still owes an attestation", () => {
    const sig = { signed_by: "a", attests: { b: { at: "t" } } };
    expect(cardState(match, sig)).toBe("signed");
  });

  it("is final once every other player has attested", () => {
    const sig = { signed_by: "a", attests: { b: { at: "t" }, c: { at: "t" }, d: { at: "t" } } };
    expect(cardState(match, sig)).toBe("final");
  });

  // The degenerate case: a match containing only the signer is final the
  // moment it is signed rather than waiting forever on an empty list.
  it("is final immediately when the signer is the whole match", () => {
    const solo = { id: "m2", round: 1, teamA: ["a"], teamB: [] };
    expect(cardState(solo, { signed_by: "a" })).toBe("final");
  });

  it("re-signing (a second signature written on an already-signed card) is read the same way — the latest signed_by wins", () => {
    // Nothing in this module makes the write idempotent by itself; it just
    // reads whatever the document currently says. A second sign overwrites
    // signed_by, and the card state is computed fresh off that.
    const resigned = { signed_by: "b", attests: { a: { at: "t" } } };
    expect(cardState(match, resigned)).toBe("signed");   // c and d still owe it
  });
});

// ── Round-level progress, the finalize sheet's own view ──────────────
describe("roundCardProgress", () => {
  const matches = [
    { id: "m1", round: 1, teamA: ["a", "b"], teamB: ["c", "d"] },
    { id: "m2", round: 1, teamA: ["e", "f"], teamB: ["g", "h"] },
  ];

  it("counts an unsigned match as neither signed nor attested", () => {
    const progress = roundCardProgress(matches, [], 1);
    expect(progress.total).toBe(2);
    expect(progress.signed).toBe(0);
    expect(progress.attested).toBe(0);
    expect(progress.unsigned.map(m => m.id)).toEqual(["m1", "m2"]);
    expect(progress.complete).toBe(false);
  });

  it("names who a signed-but-not-final card is still waiting on", () => {
    const cardSigs = [
      { match_id: "m1", signed_by: "a", attests: { b: { at: "t" }, c: { at: "t" }, d: { at: "t" } } },
      { match_id: "m2", signed_by: "e" },
    ];
    const progress = roundCardProgress(matches, cardSigs, 1);
    expect(progress.signed).toBe(2);
    expect(progress.attested).toBe(1);
    expect(progress.awaiting).toHaveLength(1);
    expect(progress.awaiting[0].match.id).toBe("m2");
    expect(progress.awaiting[0].pending.sort()).toEqual(["f", "g", "h"]);
    expect(progress.complete).toBe(false);
  });

  it("is complete only once every drawn match is fully attested", () => {
    const cardSigs = matches.map(m => ({
      match_id: m.id,
      signed_by: m.teamA[0],
      attests: Object.fromEntries([m.teamA[1], ...m.teamB].map(pid => [pid, { at: "t" }])),
    }));
    expect(roundCardProgress(matches, cardSigs, 1).complete).toBe(true);
  });

  // An empty round is not a finished one — there is nothing to be complete.
  it("is not complete for a round with no matches drawn at all", () => {
    const progress = roundCardProgress([], [], 1);
    expect(progress.total).toBe(0);
    expect(progress.complete).toBe(false);
  });

  it("ignores matches from another round", () => {
    const other = [...matches, { id: "m3", round: 2, teamA: ["x"], teamB: ["y"] }];
    expect(roundCardProgress(other, [], 1).total).toBe(2);
  });
});
