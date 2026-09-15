/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  The one round the sheet will not finalize
// ══════════════════════════════════════════════════════════════════
//
// Every other unreadiness on this sheet is an OVERRIDE: scores missing,
// cards unsigned, a foursome that drove home without attesting — a confirm
// names the problem and the director may finalize anyway, because a round
// the field has walked off has to be freezable whatever is outstanding.
//
// The closing round is not that. Finalizing it before the room has watched
// it is the single act in this app that ruins an evening and shows the man
// who did it nothing:
//
//   • the round-final push lands on sixteen OTHER phones with the pins in it
//   • the board stops waiting on his word and lands on the eighteenth hole
//     instead (lib/reveal.isConcealing)
//   • and on a round whose `sealed` flag was never explicitly written, the
//     lock arriving makes resolveSealed return false — so the whole round
//     goes onto the leaderboard at once, in front of the field, with the
//     television still showing hole one
//
// None of that is visible on the director's own screen, which is exactly the
// case this project does not ship a control for. So it is refused, in both
// halves: the button here, and App's onFinalizeRound at the source.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { FinalizeRoundSheet } from "./FinalizeRound";

afterEach(cleanup);

const progress = { entered: 288, total: 288, missing: 0, missingBy: [], complete: true };
const cards = { total: 4, signed: 4, attested: 4, complete: true, unsigned: [], awaiting: [] };

// The sheet is a Popup and portals onto <body>, so that is what a test reads.
const sheet = (over = {}) => {
  render(
    <FinalizeRoundSheet
      round={4}
      rounds={[4]}
      liveRound={4}
      nextRound={null}
      progress={progress}
      cards={cards}
      tPlayers={[]}
      onFinalizeRound={async () => ({ final: true })}
      notify={() => {}}
      onClose={() => {}}
      {...over}
    />
  );
  return document.body;
};

const button = (c, re) => [...c.querySelectorAll("button")]
  .find((b) => re.test((b.textContent || "").trim()));

describe("the sealed round's finalize button", () => {
  it("is disabled, and says what it is waiting for", () => {
    const b = button(sheet({ held: true }), /Final Countdown/);
    expect(b).toBeTruthy();
    expect(b.disabled).toBe(true);
  });

  it("is the button's own label, not a paragraph above it", () => {
    // Ship the control, not the explanation. The rule fits on the control
    // that enforces it, and a sentence restating it is a line somebody has
    // to ask to remove.
    const c = sheet({ held: true });
    expect(c.textContent).not.toContain("Finalizing freezes Round 4");
  });

  it("does not call finalize when the disabled button is driven anyway", async () => {
    const calls = [];
    const c = sheet({ held: true, onFinalizeRound: async (...a) => { calls.push(a); return { final: true }; } });
    await act(async () => { fireEvent.click(button(c, /Final Countdown/)); });
    expect(calls).toEqual([]);
    // And it does NOT reach a confirm on the way — "finalize anyway?" about
    // an act that is refused is worse than no dialog at all.
    expect(c.textContent).not.toMatch(/anyway/i);
  });

  it("stops calling the round ready when the cards are in but the seal holds", () => {
    // Both sentences are true of different things. "Round 4 is ready" is
    // about the cards; the round is not going anywhere.
    expect(sheet({ held: true }).textContent).toContain("Round 4 is sealed");
    cleanup();
    expect(sheet({ held: false }).textContent).toContain("Round 4 is ready");
  });
});

// The moment the eighteenth hole is out, `held` goes false and this sheet is
// the ordinary one again. Nothing here is a permanent restriction on round 4.
describe("and once the room has seen it", () => {
  it("is the ordinary amber button, and finalizes", async () => {
    const calls = [];
    const c = sheet({ held: false, onFinalizeRound: async (...a) => { calls.push(a); return { final: true }; } });
    const b = button(c, /^Finalize Round 4$/);
    expect(b.disabled).toBe(false);
    await act(async () => { fireEvent.click(b); });
    expect(calls).toEqual([[4, true]]);
  });

  it("says the consequence again", () => {
    expect(sheet({ held: false }).textContent).toContain("Finalizing freezes Round 4");
  });
});

// `held` is a prop, and an absent one must not silently open the gate on a
// caller that forgot it — but it also must not close it on the three rounds
// that are not sealed at all. Defaulting to false is right, and this pins
// which way it defaults so nobody flips it on a hunch.
describe("the default", () => {
  it("is not held", () => {
    expect(button(sheet(), /^Finalize Round 4$/).disabled).toBe(false);
  });
});
