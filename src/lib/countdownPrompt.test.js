import { describe, it, expect } from "vitest";
import { holePrompt, ballNote, relToPar, fmtRel, sayNames, EAGLE, BIRDIE } from "./countdownPrompt";

// What the captain reads out to the room before he taps. The whole test of
// this module is whether it names the right men — a net eagle nobody
// mentioned is a story lost, and a net bogey read out is a man named for a
// bad hole in front of the person he cost.

const ball = (name, net, counted = true) => ({ pid: name, name, net, counted, gross: net, strokes: 0 });

describe("ballNote", () => {
  it("calls an eagle an eagle and better still an eagle", () => {
    expect(ballNote(ball("Paul", 2), 4)).toBe(EAGLE);
    expect(ballNote(ball("Paul", 1), 4)).toBe(EAGLE);
  });

  it("calls one under a birdie", () => {
    expect(ballNote(ball("Dave", 3), 4)).toBe(BIRDIE);
  });

  // The line, and the reason for it: nobody cheers a par, and reading out a
  // bogey names a man for a bad hole in front of the room.
  it("says nothing about a par or worse", () => {
    expect(ballNote(ball("John", 4), 4)).toBe(null);
    expect(ballNote(ball("John", 5), 4)).toBe(null);
    expect(ballNote(ball("John", 7), 4)).toBe(null);
  });

  // On best-six-of-eight the seventh-best birdie did not happen as far as the
  // number is concerned, and shouting it invites the argument the format is
  // there to avoid.
  it("never names a ball that did not count, however good", () => {
    expect(ballNote(ball("Rudy", 2, false), 4)).toBe(null);
    expect(ballNote(ball("Rudy", 3, false), 4)).toBe(null);
  });

  it("says nothing about a hole with no score on it", () => {
    expect(ballNote(ball("Hank", null), 4)).toBe(null);
    expect(ballNote(null, 4)).toBe(null);
    expect(ballNote(ball("Hank", 3), undefined)).toBe(null);
  });
});

describe("relToPar / fmtRel", () => {
  // A side's number is the sum of N balls, so the par it is measured against
  // is N pars. Six net 3s on a par 4 is six under, not one under.
  it("measures a best-N total against N pars", () => {
    expect(relToPar(21, 4, 6)).toBe(-3);
    expect(relToPar(24, 4, 6)).toBe(0);
    expect(relToPar(26, 4, 6)).toBe(2);
  });

  it("falls back to one par when there is no count", () => {
    expect(relToPar(3, 4)).toBe(-1);
    expect(relToPar(3, 4, 0)).toBe(-1);
  });

  it("prints it the way somebody would say it", () => {
    expect(fmtRel(-3)).toBe("−3");
    expect(fmtRel(0)).toBe("E");
    expect(fmtRel(2)).toBe("+2");
    expect(fmtRel(null)).toBe("—");
  });

  it("has no answer without a score or a par", () => {
    expect(relToPar(null, 4, 6)).toBe(null);
    expect(relToPar(21, undefined, 6)).toBe(null);
  });
});

describe("sayNames", () => {
  it("joins them the way a person would", () => {
    expect(sayNames(["Paul"])).toBe("Paul");
    expect(sayNames(["Paul", "Dave"])).toBe("Paul and Dave");
    expect(sayNames(["Paul", "Dave", "John"])).toBe("Paul, Dave and John");
    expect(sayNames([])).toBe("");
  });
});

describe("holePrompt", () => {
  // The example from the brief: a net eagle from Paul, a couple of birdies
  // from Dave and John, and the side is three under.
  it("gives him the number and the names", () => {
    const balls = [
      ball("Paul W", 2), ball("Dave K", 3), ball("John S", 3),
      ball("Tim C", 4), ball("Ben T", 4), ball("Jim H", 4),
      ball("Shaun W", 5, false), ball("Joe E", 6, false),
    ];
    const p = holePrompt({ balls, par: 4, countN: 6, score: 20 });
    expect(p.ready).toBe(true);
    expect(p.headline).toBe("YOUR SIDE −4");
    expect(p.notes[0]).toBe("Net eagle — Paul W");
    expect(p.notes[1]).toBe("Net birdies — Dave K and John S");
    expect(p.counted).toBe(6);
  });

  it("puts the eagles first, because that is what he leads with", () => {
    const balls = [ball("Dave K", 3), ball("Paul W", 2)];
    const p = holePrompt({ balls, par: 4, countN: 2, score: 5 });
    expect(p.notes[0]).toContain("eagle");
    expect(p.notes[1]).toContain("birdie");
  });

  // A par 3 everybody pars is a real hole and a real thing to say about it.
  // An empty panel reads as a bug to the man holding the phone.
  it("says there is nothing to shout about rather than nothing at all", () => {
    const balls = [ball("Tim C", 3), ball("Ben T", 3)];
    const p = holePrompt({ balls, par: 3, countN: 2, score: 6 });
    expect(p.ready).toBe(true);
    expect(p.headline).toBe("YOUR SIDE E");
    expect(p.notes).toEqual(["Nothing to shout about — read the number"]);
  });

  // He is standing in front of the room. "The group hasn't finished posting"
  // and "your side made nothing" are opposite instructions.
  it("says when the hole is not in yet", () => {
    expect(holePrompt({ balls: [], par: 4, countN: 6, score: null }).ready).toBe(false);
    expect(holePrompt({ balls: [ball("Tim C", null)], par: 4, countN: 6, score: null }).headline)
      .toBe("NO SCORES ON THIS HOLE YET");
  });

  it("never names a ball that missed the cut", () => {
    const balls = [ball("Tim C", 4), ball("Rudy T", 2, false)];
    const p = holePrompt({ balls, par: 4, countN: 1, score: 4 });
    expect(p.notes.join(" ")).not.toContain("Rudy");
  });
});
