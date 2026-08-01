import { describe, it, expect } from "vitest";
import { openingHole } from "./useHoleAdvance";

// Only `openingHole` is covered here. The hook around it is timers, refs and
// React state — it needs a renderer BC has no jsdom environment for — but the
// decision it is built on ("which hole does this screen open on?") is pure,
// and it is the piece whose edge cases actually bite: a wrong answer here is
// the screen opening on hole 1 halfway through a round, or flashing hole 1
// before jumping, every single time a player returns to their card.

// A reader over { pid: { holeIdx: strokes } }, matching the getScore contract:
// 0 (not undefined) for an unscored hole.
const reader = (map) => (pid, h) => map?.[pid]?.[h] || 0;
// n holes posted for a player.
const card = (n, s = 4) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i, s]));

describe("openingHole", () => {
  it("opens on the first hole the match has not all finished", () => {
    expect(openingHole(["a", "b"], reader({ a: card(7), b: card(7) }))).toBe(7);
  });

  // The match moves together — one player short means the hole isn't done,
  // and the screen belongs on the hole that is still open, not on the one the
  // fastest player has reached.
  it("waits for the slowest player on a hole", () => {
    expect(openingHole(["a", "b"], reader({ a: card(9), b: card(4) }))).toBe(4);
  });

  // A back-filled gap: the live edge is the GAP, not the far end. This is what
  // makes auto-advance's edge-skipping and this function agree.
  it("returns to a gap left behind", () => {
    const a = { ...card(18) }; delete a[5];
    expect(openingHole(["a"], reader({ a }))).toBe(5);
  });

  it("treats a cleared score (0) as unplayed", () => {
    expect(openingHole(["a"], reader({ a: { ...card(6), 3: 0 } }))).toBe(3);
  });

  // ── The three ways of answering "hole 1" ──
  // All of them return 0, and the hook's callers rely on that: `positionOn`
  // uses `edge > 0` to decide whether it had real data to position FROM, so
  // every 0 deliberately leaves the deferred cold-load jump armed.
  it("starts at the start when nothing has been posted", () => {
    expect(openingHole(["a", "b"], reader({}))).toBe(0);
  });

  it("returns 0 with no players", () => {
    expect(openingHole([], reader({}))).toBe(0);
    expect(openingHole(undefined, reader({}))).toBe(0);
  });

  // Nothing to fast-forward TO. The screen shows hole 1 of a finished card
  // rather than being parked on 18 with no next hole.
  it("returns 0 when every player has every hole", () => {
    expect(openingHole(["a", "b"], reader({ a: card(18), b: card(18) }))).toBe(0);
  });

  it("is the live edge as soon as one score exists", () => {
    expect(openingHole(["a", "b"], reader({ a: { 0: 5 } }))).toBe(0);
    expect(openingHole(["a", "b"], reader({ a: { 0: 5 }, b: { 0: 4 } }))).toBe(1);
  });

  it("tolerates a reader that returns undefined for every hole", () => {
    expect(openingHole(["a"], () => undefined)).toBe(0);
  });

  it("handles a singles match (one player a side)", () => {
    expect(openingHole(["a", "b"], reader({ a: card(12), b: card(12) }))).toBe(12);
  });

  it("handles a full foursome", () => {
    const scores = { a: card(6), b: card(6), c: card(6), d: card(5) };
    expect(openingHole(["a", "b", "c", "d"], reader(scores))).toBe(5);
  });
});
