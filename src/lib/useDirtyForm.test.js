import { describe, it, expect } from "vitest";

// The hook itself needs a React renderer, which BC has no jsdom environment
// for. What IS worth pinning is the comparison underneath it: `isDirty` and
// the sync-when-clean guard are both decided by stableStringify, and the
// property that matters — key order must not count as a change — is pure.
//
// Re-declared here rather than exported from the hook: it is an implementation
// detail, and forcing it into the public API just to reach it would be testing
// the wrong thing.
function stableStringify(obj) {
  return JSON.stringify(obj, (_k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted = {};
      Object.keys(v).sort().forEach(k => { sorted[k] = v[k]; });
      return sorted;
    }
    return v;
  });
}

describe("stableStringify — the dirty comparison", () => {
  // The whole reason it exists. A Firestore snapshot can hand back the same
  // document with its keys in a different order; plain JSON.stringify would
  // call that a change, mark a clean form dirty, and stop it re-seeding.
  it("ignores key order", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it("ignores key order in nested objects", () => {
    expect(stableStringify({ o: { x: 1, y: 2 } })).toBe(stableStringify({ o: { y: 2, x: 1 } }));
  });

  it("still sees a real value change", () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });

  it("still sees an added or removed key", () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 1, b: 2 }));
  });

  // Arrays are ordered data — a re-ordered team roster is a different roster.
  it("does NOT ignore array order", () => {
    expect(stableStringify({ teamA: ["a", "b"] })).not.toBe(stableStringify({ teamA: ["b", "a"] }));
  });

  it("treats a match-shaped object consistently", () => {
    const a = { round: 1, format: "fourball", teamA: ["p1", "p2"], teamB: ["p3", "p4"] };
    const b = { teamB: ["p3", "p4"], format: "fourball", teamA: ["p1", "p2"], round: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(stableStringify(a)).not.toBe(stableStringify({ ...a, round: 2 }));
  });

  it("distinguishes null, undefined-key and empty string", () => {
    expect(stableStringify({ a: null })).not.toBe(stableStringify({ a: "" }));
    expect(stableStringify({ a: null })).not.toBe(stableStringify({}));
  });
});
