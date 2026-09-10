import { describe, it, expect } from "vitest";
import { holePrompt, holeNuggets, possessive, ballNote, relToPar, fmtRel, sayNames, EAGLE, BIRDIE } from "./countdownPrompt";

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
  it("names the side rather than calling it his", () => {
    // He reads this out. "Mash Brothers, four under" is a sentence; "your
    // side, four under" is a prompt he has to translate first.
    const p = holePrompt({ balls: [ball("Tim C", 4)], par: 4, countN: 1, score: 4, teamName: "Mash Brothers" });
    expect(p.headline).toBe("Mash Brothers E");
    expect(p.headline).not.toContain("YOUR SIDE");
  });

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


describe("possessive", () => {
  it("gives a name ending in s the bare apostrophe", () => {
    expect(possessive("Mash Brothers")).toBe("Mash Brothers'");
    expect(possessive("Irons")).toBe("Irons'");
  });
  it("and everything else an apostrophe s", () => {
    expect(possessive("The Field")).toBe("The Field's");
    expect(possessive("")).toBe("");
  });
});

// ══════════════════════════════════════════════════════════════════
//  The nuggets, and the window they may look at
// ══════════════════════════════════════════════════════════════════
//  The things one hole cannot tell you: the first net eagle anybody has hit,
//  a man on his third birdie running, the best hole of the evening so far.
//
//  `history` is the holes ALREADY TURNED OVER, and nothing else. That cap is
//  the whole safety of the feature — a captain's phone holds his side's entire
//  round, because a team is never hidden from itself, and a nugget compiled
//  from a hole the room has not seen is the ending leaked through the one
//  thing on that screen nobody would think to check.
describe("nuggets", () => {
  const hole = (nets, par = 4, score = null) => ({
    balls: nets.map(([name, net], i) => ({ pid: `p${i}`, name, net, counted: true })),
    par,
    countN: nets.length,
    score: score == null ? nets.reduce((a, [, n]) => a + n, 0) : score,
  });

  it("calls the first net eagle of the round", () => {
    const now = hole([["Paul W", 2], ["Dave K", 4]]);
    expect(holeNuggets({ ...now, history: [] }).join(" ")).toContain("First net eagle of the round — Paul W");
  });

  it("only calls it once", () => {
    const earlier = hole([["Joe E", 2], ["Dave K", 4]]);
    const now = hole([["Paul W", 2], ["Dave K", 4]]);
    expect(holeNuggets({ ...now, history: [earlier] }).join(" ")).not.toContain("First net eagle");
  });

  // The one that matters. Hole 12 has an eagle on it and nobody has seen hole
  // 12 — so on hole 3 this is still the first, and saying otherwise would be
  // telling the room what is coming.
  it("cannot see a hole that has not been turned over", () => {
    const unrevealed = hole([["Joe E", 2], ["Dave K", 4]]);
    const now = hole([["Paul W", 2], ["Dave K", 4]]);
    // The caller passes holes 1..N-1 only. This module has no other input.
    expect(holeNuggets({ ...now, history: [] }).join(" ")).toContain("First net eagle");
    // And if that hole HAD been turned over, it would know.
    expect(holeNuggets({ ...now, history: [unrevealed] }).join(" ")).not.toContain("First net eagle");
  });

  it("calls a man on a run of birdies", () => {
    const past = [hole([["Dave K", 3], ["Tim C", 5]]), hole([["Dave K", 3], ["Tim C", 5]])];
    const now = hole([["Dave K", 3], ["Tim C", 5]]);
    expect(holeNuggets({ ...now, history: past }).join(" ")).toContain("Dave K — three in a row");
  });

  it("says nothing about one birdie on its own", () => {
    // That is the birdie line above it; a "run" of one is not a run.
    const now = hole([["Dave K", 3], ["Tim C", 5]]);
    expect(holeNuggets({ ...now, history: [hole([["Dave K", 5], ["Tim C", 5]])] }).join(" ")).not.toContain("in a row");
  });

  it("breaks a run on the hole he missed", () => {
    const past = [
      hole([["Dave K", 3]]),
      hole([["Dave K", 4]]),   // par — the run ends here
      hole([["Dave K", 3]]),
    ];
    const now = hole([["Dave K", 3]]);
    expect(holeNuggets({ ...now, history: past }).join(" ")).toContain("two in a row");
  });

  it("never counts a ball that did not make the number", () => {
    const missed = { balls: [{ pid: "p0", name: "Rudy T", net: 2, counted: false }], par: 4, countN: 1, score: 4 };
    expect(holeNuggets({ ...missed, history: [] })).toEqual([]);
  });

  it("calls the best hole of the round so far", () => {
    const past = [hole([["Tim C", 4], ["Ben T", 4]]), hole([["Tim C", 4], ["Ben T", 3]])];
    const now = hole([["Tim C", 3], ["Ben T", 3]]);
    expect(holeNuggets({ ...now, history: past, teamName: "Mash Brothers" }).join(" "))
      .toContain("Mash Brothers' best hole of the round");
  });

  it("does not call a level hole anybody's best", () => {
    // A side that has been level all night does not get told the level one is
    // its best hole.
    const past = [hole([["Tim C", 5], ["Ben T", 5]])];
    const now = hole([["Tim C", 4], ["Ben T", 4]]);
    expect(holeNuggets({ ...now, history: past, teamName: "Irons" }).join(" ")).not.toContain("best hole");
  });

  it("says nothing about a best hole with nothing to compare it to", () => {
    const now = hole([["Tim C", 3], ["Ben T", 3]]);
    expect(holeNuggets({ ...now, history: [], teamName: "Irons" }).join(" ")).not.toContain("best hole");
  });

  it("keeps it to two, because he is holding a drink", () => {
    const past = [hole([["Paul W", 3], ["Dave K", 5]]), hole([["Paul W", 3], ["Dave K", 5]])];
    // An eagle, a run and a best hole all at once.
    const now = hole([["Paul W", 2], ["Dave K", 2]]);
    expect(holeNuggets({ ...now, history: past, teamName: "Irons" }).length).toBe(2);
  });

  it("rides along on the prompt", () => {
    const p = holePrompt({
      balls: [{ pid: "p0", name: "Paul W", net: 2, counted: true }],
      par: 4, countN: 1, score: 2, teamName: "Irons", history: [],
    });
    expect(p.nuggets.join(" ")).toContain("First net eagle");
  });
});
