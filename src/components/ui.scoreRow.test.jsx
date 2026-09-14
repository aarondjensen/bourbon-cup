/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  ScoreButtonRow — what the two nudges are actually for.
// ══════════════════════════════════════════════════════════════════
//
// The row draws five par-relative numbers, [par-1 … par+3], because that is
// the range real scores land in. The nudges either side of them exist for
// everything else: the ace, the 9 on a par 4, the hole that got away.
//
// They did not do that. Both were written as "one off the current score"
// (`score + 1`, falling back to par when nothing was posted yet), so on an
// unscored par 4 the `+` button handed back a 5 — bogey, the button two
// along from the thumb that just tapped it. A control whose whole job is
// to reach what is NOT on screen was reaching into the middle of it, and
// recording a 9 meant tapping `+` five times.
//
// So each nudge now starts at the first score on its side that is not
// drawn, read off the window as displayed. These pin that, and they pin
// the recentre behaviour underneath it, which is what keeps the SECOND tap
// worth one stroke instead of another leap.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { ScoreButtonRow } from "./ui";

afterEach(cleanup);

// Tap a glyph and report the single value the row handed back.
// By role, not by text: each control sits in a column with a label slot
// beneath it, so when the label is blank the wrapper div carries the same
// text as the button inside it and a text query matches both.
const tapped = (glyph, props) => {
  const onScore = vi.fn();
  const { getByRole, unmount } = render(<ScoreButtonRow onScore={onScore} {...props} />);
  fireEvent.click(getByRole("button", { name: glyph }));
  // Unmount before returning, not at afterEach: several of these compare two
  // rows in one test, and a second copy left standing makes every query
  // ambiguous.
  unmount();
  expect(onScore).toHaveBeenCalledTimes(1);
  return onScore.mock.calls[0][0];
};
const plus = (props) => tapped("+", props);
const minus = (props) => tapped("−", props);

describe("ScoreButtonRow nudges", () => {
  // ── The window nobody has typed into yet ──
  describe("on an unscored hole", () => {
    it("sends + past the last number on screen", () => {
      // Par 4 draws 3-4-5-6-7. The first score not on it is 8, and the old
      // behaviour — par + 1 — was 5, which is sitting right there.
      expect(plus({ par: 4, score: 0 })).toBe(8);
      expect(plus({ par: 4, score: 0 })).not.toBe(5);
    });

    it("sends − past the first number on screen", () => {
      // The other end of the same rule: 3 is drawn, so − is the eagle.
      expect(minus({ par: 4, score: 0 })).toBe(2);
    });

    it("follows par rather than a fixed offset", () => {
      expect(plus({ par: 3, score: 0 })).toBe(7);   // 2-3-4-5-6 drawn
      expect(plus({ par: 5, score: 0 })).toBe(9);   // 4-5-6-7-8 drawn
    });
  });

  // ── A score already posted, still inside the window ──
  // The nudge does not care where the selection sits: everything in the
  // window is one direct tap, so both nudges still reach past it.
  describe("with a score the window already shows", () => {
    it("still jumps past the top, not one above the score", () => {
      expect(plus({ par: 4, score: 6 })).toBe(8);
      expect(plus({ par: 4, score: 3 })).toBe(8);
    });

    it("still jumps past the bottom", () => {
      expect(minus({ par: 4, score: 6 })).toBe(2);
    });
  });

  // ── Once the window has recentred ──
  // A score outside [par-1, par+3] slides the whole window so the number is
  // visible and re-tappable — which puts that score at the very top (or the
  // very bottom) of what is drawn. So the nudge past it is worth exactly one
  // stroke, and climbing stays one tap per shot.
  describe("after the window recentres", () => {
    it("adds one to a score that is already off the top", () => {
      // A 9 on a par 4 draws 5-6-7-8-9.
      expect(plus({ par: 4, score: 9 })).toBe(10);
      expect(minus({ par: 4, score: 9 })).toBe(4);
    });

    it("reaches a blow-up hole in two taps", () => {
      // The whole point of the change. Tap once off an empty card, post what
      // it gives you, tap again: 9 on a par 4. It used to take five.
      const first = plus({ par: 4, score: 0 });
      expect(first).toBe(8);
      expect(plus({ par: 4, score: first })).toBe(9);
    });
  });

  // ── The floor ──
  describe("at the bottom of the card", () => {
    it("records an ace on a par 3 in one tap", () => {
      // 2-3-4-5-6 is drawn, so the first score below the window IS the ace.
      expect(minus({ par: 3, score: 0 })).toBe(1);
    });

    it("never offers less than a hole in one", () => {
      // An ace recentres the window to 1-2-3-4-5. There is nothing under it,
      // and the nudge must not hand back 0 — that is the row's "clear".
      expect(minus({ par: 3, score: 1 })).toBe(1);
      expect(minus({ par: 5, score: 1 })).toBe(1);
    });
  });

  // ── The five numbers themselves are untouched ──
  // Pinned here because the nudges are defined off the same window: a change
  // to one must not quietly move the other.
  describe("the drawn numbers", () => {
    it("posts the number tapped", () => {
      expect(tapped("6", { par: 4, score: 0 })).toBe(6);
    });

    it("clears when the selected number is tapped again", () => {
      expect(tapped("6", { par: 4, score: 6 })).toBe(0);
    });
  });
});
