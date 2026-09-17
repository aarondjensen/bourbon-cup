import { describe, it, expect } from "vitest";
import { holePrompt, holeNuggets, possessive, ballNote, relToPar, fmtRel, sayNames, quietLine, QUIET_LINES, EAGLE, BIRDIE } from "./countdownPrompt";

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
    // The first of the five. Which one is a function of how many quiet holes
    // have already gone by, and with no history behind it this is hole one.
    expect(p.notes).toEqual([QUIET_LINES[0]]);
  });

  // He is standing in front of the room. "The group hasn't finished posting"
  // and "your side made nothing" are opposite instructions.
  it("says when the hole is not in yet", () => {
    expect(holePrompt({ balls: [], par: 4, countN: 6, score: null }).ready).toBe(false);
    expect(holePrompt({ balls: [ball("Tim C", null)], par: 4, countN: 6, score: null }).headline)
      .toBe("NO SCORES ON THIS HOLE YET");
  });

  // ══════════════════════════════════════════════════════════════
  //  The hole where more men made it than the format could count
  // ══════════════════════════════════════════════════════════════
  //
  // This used to read "never names a ball that missed the cut", and the hole
  // that reversed it: four counted, FIVE men at net one under. The card named
  // four of them, and the fifth was standing in the room.
  //
  // Worth knowing WHY that is the only shape this ever takes. The engine
  // counts the N BEST balls, so an uncounted ball is never worse than a
  // counted one by definition — if a birdie missed the cut, every ball that
  // made it is a birdie or better, and which four of five identical scores
  // "counted" is an arbitrary tie-break inside the engine. There is no
  // fourth-best of five equal numbers, so there is nobody to leave out.
  describe("more men than slots", () => {
    const five = () => [
      ball("Dave K", 3), ball("John S", 3), ball("Paul W", 3),
      ball("Tim C", 3), ball("Wes B", 3, false),
    ];

    it("says five, names five, and says four counted", () => {
      const p = holePrompt({ balls: five(), par: 4, countN: 4, score: 12 });
      expect(p.notes[0]).toBe("Five net birdies — Dave K, John S, Paul W, Tim C and Wes B (four counted)");
    });

    it("leaves the number alone", () => {
      // The fifth birdie is named and contributes nothing. −4 is the four
      // that counted, against four pars, and it does not move.
      const p = holePrompt({ balls: five(), par: 4, countN: 4, score: 12 });
      expect(p.headline).toBe("YOUR SIDE −4");
      expect(p.counted).toBe(4);
    });

    it("stays short when everybody who made it counted", () => {
      // Which is nearly every hole. The count is spoken only when the two
      // numbers genuinely differ — otherwise it is a number restating a list
      // the reader can see.
      const p = holePrompt({ balls: [ball("Dave K", 3), ball("John S", 3)], par: 4, countN: 2, score: 6 });
      expect(p.notes[0]).toBe("Net birdies — Dave K and John S");
      expect(p.notes.join(" ")).not.toContain("counted");
    });

    it("counts each kind against its own slots", () => {
      // Two eagles and three birdies into four slots: both eagles count and
      // one birdie is squeezed out. Each line reports its own arithmetic
      // rather than the hole's.
      const balls = [
        ball("Dave K", 2), ball("John S", 2),
        ball("Paul W", 3), ball("Tim C", 3), ball("Wes B", 3, false),
      ];
      const p = holePrompt({ balls, par: 4, countN: 4, score: 10 });
      expect(p.notes[0]).toBe("Net eagles — Dave K and John S");
      expect(p.notes[1]).toBe("Three net birdies — Paul W, Tim C and Wes B (two counted)");
    });

    it("still says it in the singular", () => {
      const balls = [ball("Dave K", 3), ball("John S", 3, false)];
      const p = holePrompt({ balls, par: 4, countN: 1, score: 3 });
      expect(p.notes[0]).toBe("Two net birdies — Dave K and John S (one counted)");
    });
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
    expect(holeNuggets({ ...now, history: [] }).join(" ")).toContain("First net eagle so far — Paul W");
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

  it("calls the best hole so far so far", () => {
    const past = [hole([["Tim C", 4], ["Ben T", 4]]), hole([["Tim C", 4], ["Ben T", 3]])];
    const now = hole([["Tim C", 3], ["Ben T", 3]]);
    expect(holeNuggets({ ...now, history: past, teamName: "Mash Brothers" }).join(" "))
      .toContain("Mash Brothers' best hole so far");
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

// ══════════════════════════════════════════════════════════════════
//  The window, pressed from both sides
// ══════════════════════════════════════════════════════════════════
//  Everything below exists to pin ONE invariant: a captain's card may hold
//  the hole he is about to reveal and the holes his side has already turned
//  over, and NOTHING else — not a number, not a name, not a streak, not a
//  superlative.
//
//  A window test that only ever proves "the line fires" is half a test. Every
//  one of these has a mirror: the same fixture with the deciding hole INSIDE
//  the window, proving the module read the window rather than ignoring it.
//  A module that ignored `history` entirely would pass the first half of each
//  pair and fail the second.
describe("the nugget window, from both sides", () => {
  // A hole in the shape the component hands over: one entry per ball, the
  // par, how many balls make the number, and what the side came to.
  const mk = (nets, { par = 4, countN = null, score = null, counted = null } = {}) => {
    const balls = nets.map(([name, net]) => ({
      pid: name, name, net, counted: counted ? counted.includes(name) : true,
    }));
    const n = countN ?? balls.filter((b) => b.counted).length;
    return {
      balls, par, countN: n,
      score: score ?? balls.filter((b) => b.counted).reduce((a, b) => a + b.net, 0),
    };
  };

  describe("the first net eagle", () => {
    // The hole being announced is the third; holes 4 through 18 are sitting
    // in the same object on his phone and one of them is an eagle. The module
    // is handed the window and cannot reach past it — which is the point: on
    // hole 3 this IS the first net eagle the room has seen, and saying
    // anything else would be telling them no other one is coming.
    it("fires for the hole in hand when the only other eagle is in the future", () => {
      const past = [mk([["Tim C", 4], ["Ben T", 4]]), mk([["Tim C", 4], ["Ben T", 4]])];
      const now = mk([["Paul W", 2], ["Ben T", 4]]);
      // The eagle on the (unrevealed) hole 12 exists — it is simply not in the
      // window, and there is no argument the module can take that would let it
      // in. The caller decides; see FinalCountdown's `history`.
      const out = holeNuggets({ ...now, history: past, teamName: "Irons" });
      expect(out.join(" ")).toContain("First net eagle so far — Paul W");
    });

    // The mirror, and the half that proves the window is READ. Same current
    // hole, same everything — one of the two revealed holes now carries the
    // eagle, and the line goes away.
    it("is suppressed the moment that eagle is inside the window", () => {
      const past = [mk([["Tim C", 4], ["Ben T", 4]]), mk([["Joe E", 2], ["Ben T", 4]])];
      const now = mk([["Paul W", 2], ["Ben T", 4]]);
      const out = holeNuggets({ ...now, history: past, teamName: "Irons" });
      expect(out.join(" ")).not.toContain("First net eagle");
    });

    // And it is the WHOLE window, not just the hole before it.
    it("looks at every revealed hole, not only the last one", () => {
      const past = [
        mk([["Joe E", 2], ["Ben T", 4]]),   // the eagle, nine holes ago
        mk([["Tim C", 4], ["Ben T", 4]]),
        mk([["Tim C", 4], ["Ben T", 4]]),
      ];
      const now = mk([["Paul W", 2], ["Ben T", 4]]);
      expect(holeNuggets({ ...now, history: past }).join(" ")).not.toContain("First net eagle");
    });

    // An eagle nobody counted did not happen, so it neither fires the line nor
    // cancels a later one. Both halves, because the two are separate code.
    it("ignores an uncounted eagle at both ends", () => {
      const past = [mk([["Joe E", 2], ["Ben T", 4]], { counted: ["Ben T"], countN: 1 })];
      const now = mk([["Paul W", 2], ["Ben T", 4]], { counted: ["Ben T"], countN: 1 });
      // Uncounted now — nothing to say.
      expect(holeNuggets({ ...now, history: [] }).join(" ")).not.toContain("First net eagle");
      // Uncounted then — so this one is still the first.
      const real = mk([["Paul W", 2], ["Ben T", 4]]);
      expect(holeNuggets({ ...real, history: past }).join(" ")).toContain("First net eagle");
    });
  });

  describe("a man on a run", () => {
    const birdies = (names) => mk(names.map((n) => [n, 3]));

    // The rule the code actually implements, written down: `under()` is built
    // from COUNTED balls only, so a birdie that missed the cut is not on the
    // hole as far as the run is concerned and the loop breaks there. It does
    // not merely fail to extend the run — it ends it, and the holes before it
    // are unreachable.
    it("is BROKEN by a birdie that did not count, not merely unextended", () => {
      const past = [
        mk([["Dave K", 3], ["Tim C", 3]]),                                  // counted birdie
        mk([["Dave K", 3], ["Tim C", 3]], { counted: ["Tim C"], countN: 1 }), // Dave's birdie missed the cut
      ];
      const now = mk([["Dave K", 3], ["Tim C", 5]]);
      const out = holeNuggets({ ...now, history: past }).join(" ");
      // Two holes of birdies sit behind the uncounted one. Neither is reachable.
      expect(out).not.toContain("Dave K — two in a row");
      expect(out).not.toContain("in a row");
    });

    // The window is the ceiling. Four holes of birdies exist; two of them have
    // been turned over, so the most he can be on is three — the two revealed
    // plus the one being announced.
    it("never claims more holes than the window holds", () => {
      const past = [birdies(["Dave K"]), birdies(["Dave K"])];
      const now = birdies(["Dave K"]);
      expect(holeNuggets({ ...now, history: past }).join(" ")).toContain("three in a row");
      // One fewer revealed hole, same round: the number comes down with it.
      expect(holeNuggets({ ...now, history: [birdies(["Dave K"])] }).join(" ")).toContain("two in a row");
      // And with nothing revealed there is no run at all, whatever he did
      // on the seventeen holes his phone is holding.
      expect(holeNuggets({ ...now, history: [] }).join(" ")).not.toContain("in a row");
    });

    // A run that reaches the first hole of the window is a run of exactly
    // window + 1, and the loop runs off the front of the array rather than
    // past it.
    it("stops at the front of the window without running off it", () => {
      const past = Array.from({ length: 6 }, () => birdies(["Dave K"]));
      expect(holeNuggets({ ...birdies(["Dave K"]), history: past }).join(" "))
        .toContain("Dave K — seven in a row");
    });

    it("says the number the way a person says it", () => {
      const run = (n) => holeNuggets({
        ...birdies(["Dave K"]),
        history: Array.from({ length: n - 1 }, () => birdies(["Dave K"])),
      }).join(" ");
      expect(run(2)).toContain("two in a row");
      expect(run(3)).toContain("three in a row");
      expect(run(7)).toContain("seven in a row");
      // Eight is the longest a run can be on one side of a nine, and the
      // words reach it.
      expect(run(8)).toContain("eight in a row");
      // Past them it falls back to the digit rather than saying "undefined in
      // a row", and a captain reading "Dave K — 9 in a row" is fine.
      expect(run(9)).toContain("9 in a row");
    });

    // One line, not three. He is standing in front of fifteen people.
    it("announces only the longest when two men are running", () => {
      const past = [
        mk([["Dave K", 3], ["Tim C", 4]]),
        mk([["Dave K", 3], ["Tim C", 3]]),
      ];
      const now = mk([["Dave K", 3], ["Tim C", 3]]);
      const out = holeNuggets({ ...now, history: past }).join(" ");
      expect(out).toContain("Dave K — three in a row");
      expect(out).not.toContain("Tim C —");
      expect(out.match(/in a row/g)).toHaveLength(1);
    });

    it("breaks on the hole he parred and counts forward from there", () => {
      const past = [
        birdies(["Dave K"]),
        birdies(["Dave K"]),
        mk([["Dave K", 4]]),   // par — everything behind this is gone
        birdies(["Dave K"]),
      ];
      expect(holeNuggets({ ...birdies(["Dave K"]), history: past }).join(" "))
        .toContain("Dave K — two in a row");
    });
  });

  describe("the best hole so far", () => {
    const level = mk([["Tim C", 4], ["Ben T", 4]]);      // E
    const oneUnder = mk([["Tim C", 4], ["Ben T", 3]]);   // −1
    const twoUnder = mk([["Tim C", 3], ["Ben T", 3]]);   // −2

    it("fires only when it beats every hole the room has watched", () => {
      expect(holeNuggets({ ...twoUnder, history: [level, oneUnder], teamName: "Irons" }).join(" "))
        .toContain("Irons' best hole so far");
    });

    // The mirror: the same −2 hole, with a −2 already turned over. Equal is
    // not better, and "their best hole" said twice is one of them wrong.
    it("does not fire on a tie with a revealed hole", () => {
      expect(holeNuggets({ ...twoUnder, history: [level, twoUnder], teamName: "Irons" }).join(" "))
        .not.toContain("best hole");
    });

    // The leak this line could be. A −4 exists in the round and nobody has
    // seen it; on the window the room HAS seen, this −2 is the best there has
    // been, and saying so tells them nothing they could not already see.
    it("cannot be tripped by a better hole outside the window", () => {
      const fourUnder = mk([["Tim C", 2], ["Ben T", 2]]);
      // Inside the window it suppresses the line...
      expect(holeNuggets({ ...twoUnder, history: [fourUnder], teamName: "Irons" }).join(" "))
        .not.toContain("best hole");
      // ...and outside it, it does not exist. Same round, same −4.
      expect(holeNuggets({ ...twoUnder, history: [level], teamName: "Irons" }).join(" "))
        .toContain("best hole");
    });

    it("has nothing to be the best of on the first hole", () => {
      expect(holeNuggets({ ...twoUnder, history: [], teamName: "Irons" }).join(" "))
        .not.toContain("best hole");
    });

    it("will not call a level or an over-par hole anybody's best", () => {
      expect(holeNuggets({ ...level, history: [mk([["Tim C", 5], ["Ben T", 5]])], teamName: "Irons" }).join(" "))
        .not.toContain("best hole");
      const overPar = mk([["Tim C", 5], ["Ben T", 5]]);
      expect(holeNuggets({ ...overPar, history: [mk([["Tim C", 6], ["Ben T", 6]])], teamName: "Irons" }).join(" "))
        .not.toContain("best hole");
    });

    it("measures a past hole against its own par and its own count", () => {
      // A par 3 played best-2 (−1) against a par 5 played best-3 (−2): the
      // comparison is each hole's own arithmetic, not a raw total.
      const par3 = mk([["Tim C", 2], ["Ben T", 3]], { par: 3 });            // 5 vs 6 → −1
      const par5 = mk([["Tim C", 4], ["Ben T", 4], ["Jim H", 5]], { par: 5 }); // 13 vs 15 → −2
      expect(holeNuggets({ ...par5, history: [par3], teamName: "Irons" }).join(" "))
        .toContain("best hole");
      expect(holeNuggets({ ...par3, history: [par5], teamName: "Irons" }).join(" "))
        .not.toContain("best hole");
    });

    it("calls the side by name, possessive", () => {
      expect(holeNuggets({ ...twoUnder, history: [level], teamName: "Mash Brothers" }).join(" "))
        .toContain("Mash Brothers' best hole");
      expect(holeNuggets({ ...twoUnder, history: [level], teamName: "The Field" }).join(" "))
        .toContain("The Field's best hole");
      // No name at all is still a sentence rather than a blank.
      expect(holeNuggets({ ...twoUnder, history: [level] }).join(" "))
        .toContain("your side's best hole");
    });
  });

  describe("how many, and in what order", () => {
    it("keeps two and drops the third, in the order he says them", () => {
      // An eagle, a three-birdie run and the best hole of the night, all on
      // one hole. Eagle leads, the run follows, the superlative is the one
      // that goes.
      const past = [
        { balls: [{ pid: "p", name: "Paul W", net: 3, counted: true }], par: 4, countN: 1, score: 3 },
        { balls: [{ pid: "p", name: "Paul W", net: 3, counted: true }], par: 4, countN: 1, score: 3 },
      ];
      const now = { balls: [{ pid: "p", name: "Paul W", net: 2, counted: true }], par: 4, countN: 1, score: 2 };
      const out = holeNuggets({ ...now, history: past, teamName: "Irons" });
      expect(out).toHaveLength(2);
      expect(out[0]).toContain("First net eagle");
      expect(out[1]).toContain("three in a row");
      expect(out.join(" ")).not.toContain("best hole");
    });

    it("returns nothing rather than something manufactured", () => {
      const flat = { balls: [{ pid: "p", name: "Tim C", net: 4, counted: true }], par: 4, countN: 1, score: 4 };
      expect(holeNuggets({ ...flat, history: [flat] })).toEqual([]);
    });

    // The caller may hand it nothing at all — a hole nobody has posted, a
    // side with no balls in — and it must not throw on the one screen that
    // cannot be reloaded in front of the room.
    it("survives an empty or missing window", () => {
      const now = { balls: [{ pid: "p", name: "Paul W", net: 2, counted: true }], par: 4, countN: 1, score: 2 };
      expect(holeNuggets({ ...now, history: undefined }).join(" ")).toContain("First net eagle");
      expect(holeNuggets({ balls: [], par: 4, countN: 6, score: null, history: [] })).toEqual([]);
      expect(holeNuggets({ balls: null, par: null, countN: null, score: null, history: null })).toEqual([]);
    });
  });
});

// ══════════════════════════════════════════════════════════════════
//  The rest of the line-drawing, pinned
// ══════════════════════════════════════════════════════════════════
describe("ballNote, at the edges", () => {
  // Best six of eight: the ninth-best ball did not happen as far as the
  // number is concerned. However good it was.
  it("says nothing about the best ball on the hole if it missed the cut", () => {
    expect(ballNote({ pid: "r", name: "Rudy T", net: 1, counted: false }, 4)).toBe(null);
    expect(ballNote({ pid: "r", name: "Rudy T", net: -2, counted: false }, 4)).toBe(null);
    expect(ballNote({ pid: "r", name: "Rudy T", net: 2, counted: undefined }, 4)).toBe(null);
  });

  // The other half of the line, and the one with a person on the end of it:
  // this screen does not name a man for a bad hole in front of the room he
  // played it for.
  it("refuses to name a man for a par or worse, counted or not", () => {
    [4, 5, 6, 9].forEach((net) => {
      expect(ballNote({ pid: "j", name: "Jim H", net, counted: true }, 4)).toBe(null);
    });
  });

  it("calls anything two under or better an eagle", () => {
    expect(ballNote({ pid: "p", name: "Paul W", net: 4, counted: true }, 5)).toBe(BIRDIE);
    expect(ballNote({ pid: "p", name: "Paul W", net: 3, counted: true }, 5)).toBe(EAGLE);
    expect(ballNote({ pid: "p", name: "Paul W", net: 2, counted: true }, 5)).toBe(EAGLE);
    expect(ballNote({ pid: "p", name: "Paul W", net: 1, counted: true }, 5)).toBe(EAGLE);
    expect(ballNote({ pid: "p", name: "Paul W", net: 0, counted: true }, 5)).toBe(EAGLE);
  });
});

describe("relToPar, on a best-N hole", () => {
  // Six net 4s on a par 4 is level, not twenty under. The par a side's number
  // is measured against is N pars.
  it("uses N pars on best-6", () => {
    expect(relToPar(24, 4, 6)).toBe(0);
    expect(relToPar(21, 4, 6)).toBe(-3);
    expect(relToPar(27, 4, 6)).toBe(3);
  });

  it("uses N pars on best-8", () => {
    expect(relToPar(32, 4, 8)).toBe(0);
    expect(relToPar(30, 4, 8)).toBe(-2);
    // The same total against a different count is a different number, which
    // is the whole reason countN is passed.
    expect(relToPar(30, 4, 6)).toBe(6);
  });

  it("treats a missing, zero or negative count as one ball", () => {
    expect(relToPar(3, 4)).toBe(-1);
    expect(relToPar(3, 4, null)).toBe(-1);
    expect(relToPar(3, 4, 0)).toBe(-1);
    expect(relToPar(3, 4, -6)).toBe(-1);
    expect(relToPar(3, 4, NaN)).toBe(-1);
    expect(relToPar(3, 4, Infinity)).toBe(-1);
  });
});

describe("holePrompt, when the hole is not ready", () => {
  const b = (name, net) => ({ pid: name, name, net, counted: true });

  // "The group hasn't finished posting" and "your side made nothing" are
  // opposite instructions to a man about to speak.
  it("says so rather than reading out a blank", () => {
    const p = holePrompt({ balls: [b("Tim C", 4), b("Ben T", null)], par: 4, countN: 6, score: null });
    expect(p.ready).toBe(false);
    expect(p.headline).toBe("NO SCORES ON THIS HOLE YET");
    expect(p.notes).toEqual([]);
    expect(p.counted).toBe(0);
  });

  it("says so when no ball is posted at all", () => {
    const p = holePrompt({ balls: [], par: 4, countN: 6, score: 20 });
    expect(p.ready).toBe(false);
    expect(p.need).toBe(6);
  });

  it("says so when the side has balls but no number yet", () => {
    // The engine returns null for a side that has fewer than N in — see
    // scoring.js. That is the case this is.
    expect(holePrompt({ balls: [b("Tim C", 4)], par: 4, countN: 6, score: null }).ready).toBe(false);
    expect(holePrompt({ balls: [b("Tim C", 4)], par: 4, countN: 6, score: undefined }).ready).toBe(false);
  });

  // A not-ready hole has no nuggets on it either — there is nothing to
  // compile and nothing to say.
  it("carries no nuggets when it is not ready", () => {
    const p = holePrompt({
      balls: [], par: 4, countN: 6, score: null,
      history: [{ balls: [b("Paul W", 2)], par: 4, countN: 1, score: 2 }],
    });
    expect(p.nuggets).toBeUndefined();
  });

  // Zero is a number and not an absence — a side cannot actually make it, but
  // the card must not treat it as "nothing posted" if it ever arrives.
  it("treats a zero as a score, not as a missing one", () => {
    const p = holePrompt({ balls: [b("Tim C", 0)], par: 4, countN: 1, score: 0 });
    expect(p.ready).toBe(true);
    expect(p.headline).toBe("YOUR SIDE −4");
  });

  it("falls back to YOUR SIDE when nobody named the team", () => {
    expect(holePrompt({ balls: [b("Tim C", 4)], par: 4, countN: 1, score: 4 }).headline).toBe("YOUR SIDE E");
    expect(holePrompt({ balls: [b("Tim C", 4)], par: 4, countN: 1, score: 4, teamName: "" }).headline).toBe("YOUR SIDE E");
    expect(holePrompt({ balls: [b("Tim C", 4)], par: 4, countN: 1, score: 4, teamName: null }).headline).toBe("YOUR SIDE E");
  });

  it("has no number to read when the par is missing", () => {
    const p = holePrompt({ balls: [b("Tim C", 4)], par: undefined, countN: 1, score: 4, teamName: "Irons" });
    expect(p.ready).toBe(true);
    expect(p.headline).toBe("Irons —");
    expect(p.notes).toEqual([QUIET_LINES[0]]);
  });

  it("reports how many made the number and how many were needed", () => {
    const balls = [b("Paul W", 3), b("Dave K", 4), { pid: "x", name: "Tim C", net: 6, counted: false }];
    const p = holePrompt({ balls, par: 4, countN: 2, score: 7 });
    expect(p.counted).toBe(2);
    expect(p.need).toBe(2);
    // No count given: what made the number IS the count.
    expect(holePrompt({ balls, par: 4, score: 7 }).need).toBe(2);
  });
});

describe("possessive, on a name a director typed", () => {
  it("gives a name ending in s the bare apostrophe, whatever its case", () => {
    expect(possessive("Irons")).toBe("Irons'");
    expect(possessive("IRONS")).toBe("IRONS'");
    expect(possessive("Shot Callers")).toBe("Shot Callers'");
  });
  it("gives everything else an apostrophe s", () => {
    expect(possessive("Drivers Club")).toBe("Drivers Club's");
    expect(possessive("A")).toBe("A's");
  });
  it("has nothing to say about nothing", () => {
    expect(possessive("")).toBe("");
    expect(possessive("   ")).toBe("");
    expect(possessive(null)).toBe("");
    expect(possessive(undefined)).toBe("");
  });
});

// ══════════════════════════════════════════════════════════════════
//  The quiet hole, said a different way each time
// ══════════════════════════════════════════════════════════════════
//
// Four men par a par 3 and there is nothing to name. Saying so is right — an
// empty panel reads as a bug — but it was ONE string, and a captain who hit
// two flat holes in an evening read the identical sentence out twice. On a
// screen whose whole job is to be spoken aloud that does not land as
// consistency; it lands as a stuck app.
describe("the quiet line", () => {
  // A hole in the window, in the shape holePrompt's caller builds them.
  const quiet = (n = 2) => ({
    balls: Array.from({ length: n }, (_, i) => ({ pid: `q${i}`, name: `Q${i}`, net: 4, counted: true })),
    par: 4, countN: n, score: 4 * n,
  });
  const loud = () => ({
    balls: [{ pid: "p", name: "Paul W", net: 3, counted: true }],
    par: 4, countN: 1, score: 3,
  });
  const say = (history) => holePrompt({ ...quiet(), history }).notes[0];

  it("moves on each time the side has a flat hole", () => {
    const seen = [0, 1, 2, 3, 4].map((n) => say(Array.from({ length: n }, quiet)));
    expect(seen).toEqual(QUIET_LINES);
    // Every one of them different, which is the whole point.
    expect(new Set(seen).size).toBe(QUIET_LINES.length);
  });

  it("comes back round rather than running out", () => {
    // Five is unusual and six would be a strange evening, but a sixth flat
    // hole must not read "undefined".
    expect(say(Array.from({ length: 5 }, quiet))).toBe(QUIET_LINES[0]);
    expect(say(Array.from({ length: 7 }, quiet))).toBe(QUIET_LINES[2]);
  });

  it("counts the flat holes and not the holes", () => {
    // Three holes behind him, one of them flat: this is his SECOND quiet
    // hole, whatever hole number it happens to be.
    expect(say([loud(), quiet(), loud()])).toBe(QUIET_LINES[1]);
  });

  it("does not let an unplayed hole advance it", () => {
    // A hole nobody posted is not quiet, it is unplayed — and the window can
    // hold one when a group is still on the course.
    const blank = { balls: [], par: 4, countN: 4, score: null };
    expect(say([blank, blank])).toBe(QUIET_LINES[0]);
  });

  it("is the same words every time that hole is looked at", () => {
    // A director stepping the room back a hole and forward again must not
    // hand the captain a different script for a hole he has already read.
    const past = [quiet(), loud(), quiet()];
    expect(say(past)).toBe(say(past));
    expect(quietLine(past)).toBe(say(past));
  });

  it("is never reached when there is a name to say", () => {
    const p = holePrompt({ ...loud(), history: [quiet(), quiet()] });
    expect(p.notes[0]).toBe("Net birdie — Paul W");
    QUIET_LINES.forEach((l) => expect(p.notes).not.toContain(l));
  });
});

// ── "So far", which is not a hedge ──────────────────────────────────
// Both nuggets read "of the round" — said on the sixth of eighteen, in a room
// whose entire point is that nobody knows what is coming. A captain reading
// that is telling fifteen people no better hole is on its way, and he cannot
// know it: the window means he is looking at six holes and the sentence
// claims all eighteen.
describe("what the nuggets claim to know", () => {
  const b = (name, net, counted = true) => ({ pid: name, name, net, counted });
  const hole = (nets, { par = 4, countN = null } = {}) => {
    const balls = nets.map(([n, v]) => b(n, v));
    const need = countN ?? balls.length;
    return { balls, par, countN: need, score: balls.map((x) => x.net).reduce((a, c) => a + c, 0) };
  };

  it("never says 'of the round' about a round still being turned over", () => {
    const eagle = hole([["Paul W", 2]], { countN: 1 });
    const out = holeNuggets({ ...eagle, history: [hole([["Tim C", 4]], { countN: 1 })], teamName: "Irons" });
    const all = out.join(" ");
    expect(all).not.toContain("of the round");
    expect(all).toContain("First net eagle so far — Paul W");
    expect(all).toContain("Irons' best hole so far");
  });
});
