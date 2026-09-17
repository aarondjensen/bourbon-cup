/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  The director's bar, and the one round where it says something else.
// ══════════════════════════════════════════════════════════════════
//
// Three rungs, and the third exists because the closing round is played in
// the dark. "Ready to finalize" is a TRUE sentence about a sealed round whose
// cards are all in — and it is an instruction to do the one thing that has to
// happen last. Finalizing first fires the round-final push at sixteen phones
// with the pins in it, and takes the board's landing off the director's word
// and onto the eighteenth hole (see lib/reveal.isConcealing).
//
// So on that round the bar names the ceremony instead, and points at the
// Leaderboard, where the way onto the television is.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DirectorFinalizeAlert } from "./FinalizeRound";

afterEach(cleanup);

const progress = { entered: 288, total: 288, missing: 0, missingBy: [], complete: true };
const cards = { total: 16, signed: 16, attested: 16, complete: true };

const bar = (props) => render(
  <DirectorFinalizeAlert
    round={4} nextRound={null} progress={progress} cards={cards}
    onOpen={() => {}} onDismiss={() => {}} {...props}
  />
);

describe("DirectorFinalizeAlert", () => {
  it("asks for the Final Countdown on a sealed round the room has not seen", () => {
    bar({ stage: "countdown" });
    expect(screen.getByText("Round 4 is ready for the Final Countdown!")).toBeTruthy();
  });

  it("does not say finalize anywhere on that rung", () => {
    // The whole point of the third stage. The word is the instruction, and
    // the instruction is wrong until the eighteenth hole is turned over.
    const { container } = bar({ stage: "countdown" });
    // Read what a director can actually SEE. The bar ships its pulse
    // keyframes in an inline <style>, and the animation is called
    // bcFinalizePulse — which is not the app saying "finalize" to anybody.
    const seen = container.cloneNode(true);
    seen.querySelectorAll("style").forEach((n) => n.remove());
    expect(seen.textContent).not.toMatch(/finaliz/i);
    // And the sentence is still there once the style is gone, so this is not
    // passing by having removed the whole bar.
    expect(seen.textContent).toMatch(/Final Countdown/);
  });

  it("names the cards, and then gets out of the way", () => {
    bar({ stage: "countdown" });
    expect(screen.getByText("All 16 cards signed and attested — LFG!!!!")).toBeTruthy();
  });

  it("still asks for the finalize once the reveal is done", () => {
    // Same cards, same scores — the only thing that changed is that the room
    // has now seen it, and the ordinary wording comes back on its own.
    bar({ stage: "ready" });
    expect(screen.getByText("Round 4 is ready to finalize")).toBeTruthy();
    expect(screen.queryByText(/Final Countdown/)).toBeNull();
  });

  it("leaves the early rung alone", () => {
    // "All scores are in, waiting on cards" reads the same on a sealed round
    // as on any other: the golf is finished, the cards are not, and the
    // reveal is not ready either.
    bar({ stage: "scores", cards: { total: 16, signed: 13, attested: 13, complete: false } });
    expect(screen.getByText("Round 4 — all 288 scores are in")).toBeTruthy();
    expect(screen.queryByText(/Final Countdown/)).toBeNull();
  });

  it("carries the same weight as the finalize rung", () => {
    // Both are the loud bar — a filled amber frame with a pulsing dot. The
    // sentence changes and the tap changes; the urgency does not.
    const { container: cd } = bar({ stage: "countdown" });
    const pulsing = (root) => !!root.querySelector('[style*="bcFinalizePulse"]');
    expect(pulsing(cd)).toBe(true);
    cleanup();
    const { container: rdy } = bar({ stage: "ready" });
    expect(pulsing(rdy)).toBe(true);
  });

  it("opens whatever the caller pointed it at", () => {
    // App sends the countdown rung to the Leaderboard and every other rung to
    // the finalize sheet; the bar itself only has to fire the one handler.
    const onOpen = vi.fn();
    bar({ stage: "countdown", onOpen });
    fireEvent.click(screen.getByText("Round 4 is ready for the Final Countdown!"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("names the round it is actually about", () => {
    // Not hardcoded to 4. The seal follows the FORMAT, so a director who moves
    // Team Best Ball to another round gets this bar pointed at that one.
    bar({ stage: "countdown", round: 3 });
    expect(screen.getByText("Round 3 is ready for the Final Countdown!")).toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════════════
//  The rung that is not the director's
// ══════════════════════════════════════════════════════════════════
//
// A captain who is not also a director was told nothing. His card is real and
// it renders on his own phone — his side's contributions on the hole, the
// nuggets, the number he lands on, the reveal button — and the only door to
// it was an amber button inside round 4's leaderboard section, on a tab he
// has no reason to open, labelled nothing about him.
//
// It surfaced the first time a captain who was not a director was asked to
// run the reveal: he could not find his card, on the evening he was the one
// the room was waiting for.
describe("the captain's rung", () => {
  it("tells him it is his side, by name", () => {
    bar({ stage: "captain", teamName: "Shot Callers" });
    expect(screen.getByText("Round 4 — you're revealing for Shot Callers")).toBeTruthy();
  });

  // The one piece of information the whole rung exists to carry. Every other
  // rung leaves the wayfinding to the tap, because every other rung lands on
  // the thing it names; this one lands one button short of it.
  it("says where the card is", () => {
    bar({ stage: "captain", teamName: "Irons" });
    expect(screen.getByText("Open the Final Countdown for your captain's card")).toBeTruthy();
  });

  it("never asks him to finalize, which he cannot do", () => {
    const { container } = bar({ stage: "captain", teamName: "Irons" });
    const seen = container.cloneNode(true);
    seen.querySelectorAll("style").forEach((n) => n.remove());
    expect(seen.textContent).not.toMatch(/finaliz/i);
  });

  it("is the loud bar, like the two rungs beside it", () => {
    const { container } = bar({ stage: "captain", teamName: "Irons" });
    expect(!!container.querySelector('[style*="bcFinalizePulse"]')).toBe(true);
  });

  // A team whose name has not arrived yet still gets a sentence rather than
  // "revealing for null" — the subscriptions land over several frames and
  // this bar is chrome above every tab.
  it("survives a name that has not loaded", () => {
    bar({ stage: "captain" });
    expect(screen.getByText("Round 4 — you're revealing for your side")).toBeTruthy();
  });
});
