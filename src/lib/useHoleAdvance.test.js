import { describe, it, expect } from "vitest";
import { openingHole, HOLES } from "./useHoleAdvance";

// Only `openingHole` is covered here. The hook around it is timers, refs and
// React state — it needs a renderer BC has no jsdom environment for — but the
// decision it is built on ("which hole does this screen open on?") is pure,
// and it is the piece whose edge cases actually bite: a wrong answer here is
// the screen opening on hole 1 halfway through a round, or flashing hole 1
// before jumping, every single time a player returns to their card.

// A reader over { pid: { holeIdx: strokes } }, matching the getScore contract:
// falsy for an unscored hole.
const reader = (map) => (pid, h) => map?.[pid]?.[h] || 0;
// n holes posted for a player.
const card = (n, s = 4) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i, s]));

describe("openingHole", () => {
  it("opens on the first hole the match has not all finished", () => {
    const r = openingHole(["a", "b"], reader({ a: card(7), b: card(7) }));
    expect(r).toMatchObject({ hole: 7, allComplete: false, resolved: true });
  });

  // The match moves together — one player short means the hole isn't done,
  // and the screen belongs on the hole that is still open, not on the one the
  // fastest player has reached.
  it("waits for the slowest player on a hole", () => {
    expect(openingHole(["a", "b"], reader({ a: card(9), b: card(4) })).hole).toBe(4);
  });

  // A back-filled gap: the live edge is the GAP, not the far end. This is what
  // makes auto-advance's edge-skipping and this function agree.
  it("returns to a gap left behind", () => {
    const a = { ...card(18) }; delete a[5];
    const r = openingHole(["a"], reader({ a }));
    expect(r.hole).toBe(5);
    expect(r.allComplete).toBe(false);
  });

  it("treats a cleared score (0) as unplayed", () => {
    expect(openingHole(["a"], reader({ a: { ...card(6), 3: 0 } })).hole).toBe(3);
  });

  // ── A finished match ──
  // Lands on the LAST hole, not the first. There is no next hole to fast-
  // forward to, and 18 is what the group was looking at when they finished —
  // the same answer WBC gives.
  it("lands on the last hole when everything is in", () => {
    const r = openingHole(["a", "b"], reader({ a: card(18), b: card(18) }));
    expect(r).toMatchObject({ hole: HOLES - 1, allComplete: true, resolved: true });
  });

  // ── The cold-load distinction, which is the point of `resolved` ──
  // An empty map and a genuinely untouched card both answer "hole 1", and so
  // does a match whose live edge really is hole 1. Only the caller knows which
  // it is looking at, so the answer says whether it came from real data —
  // `positionedFor` keys on that, never on the hole index.
  it("is unresolved when nothing has been posted", () => {
    expect(openingHole(["a", "b"], reader({})))
      .toMatchObject({ hole: 0, hasAnyScores: false, resolved: false });
  });

  it("is unresolved with no players", () => {
    expect(openingHole([], reader({}))).toMatchObject({ hole: 0, resolved: false });
    expect(openingHole(undefined, reader({}))).toMatchObject({ hole: 0, resolved: false });
  });

  it("is resolved as soon as one score exists, even on hole 1", () => {
    expect(openingHole(["a", "b"], reader({ a: { 0: 5 } })))
      .toMatchObject({ hole: 0, hasAnyScores: true, resolved: true });
    expect(openingHole(["a", "b"], reader({ a: { 0: 5 }, b: { 0: 4 } })).hole).toBe(1);
  });

  it("tolerates a reader that returns undefined for every hole", () => {
    expect(openingHole(["a"], () => undefined)).toMatchObject({ hole: 0, resolved: false });
  });

  it("drops empty slots in the player list", () => {
    expect(openingHole(["a", null, undefined], reader({ a: card(3) })).hole).toBe(3);
  });

  it("handles a singles match (one player a side)", () => {
    expect(openingHole(["a", "b"], reader({ a: card(12), b: card(12) })).hole).toBe(12);
  });

  it("handles a full foursome", () => {
    const scores = { a: card(6), b: card(6), c: card(6), d: card(5) };
    expect(openingHole(["a", "b", "c", "d"], reader(scores)).hole).toBe(5);
  });

  it("honours a shorter card for a nine-hole round", () => {
    expect(openingHole(["a"], reader({ a: card(9) }), 9))
      .toMatchObject({ hole: 8, allComplete: true });
  });
});
