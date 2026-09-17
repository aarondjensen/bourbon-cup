/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  The captain's card, and the one thing it must never contain
// ══════════════════════════════════════════════════════════════════
//
// The closing round is narrated. Before a hole goes up on the television the
// captain of the side going first tells the room what is on it, and THEN taps.
// So his phone holds a hole nobody has seen — on purpose, because he is about
// to read it out.
//
// That makes this the most delicate surface in the app, and the invariant is
// exact. A captain's card may contain:
//
//   (a) his own side's data for the single hole he is ABOUT to reveal, and
//   (b) his own side's data for holes his own side has ALREADY revealed.
//
// Nothing else. Not a number, not a name, not a streak, not a superlative, not
// the other side's anything. `countdownPrompt.test.js` pins the arithmetic of
// the window; this file pins what the COMPONENT hands it and what the DOM ends
// up holding — which can come apart from the arithmetic, because the component
// has the whole round in its hands the entire time and chooses what to pass.
//
// The existing FinalCountdown.test.jsx covers the television. This file is the
// phone, and only the phone.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { FinalCountdown } from "./FinalCountdown";
import { computeMatchResult } from "../scoring";

afterEach(cleanup);

// jsdom reports 1024×768, which the component reads as a television. These set
// the width the way a real device does and fire the resize the hook listens to.
const setWidth = (w) => {
  window.innerWidth = w;
  window.dispatchEvent(new Event("resize"));
};
const PHONE = 393;
const TV = 1280;
afterEach(() => setWidth(TV));

const PARS = Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
const courses = [{
  id: "c1", name: "Treetops", hole_pars: PARS, hole_handicaps: SI,
  tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }],
}];
const tRounds = [{
  round_number: 4, format: "team_best_ball", course_id: "c1", tee_box: "White",
  handicap_mode: "full", scoring_type: "points", hole_points: { front: 1, back: 1 },
  counting_scores: { holes: Array(18).fill(2) },
}];

// Three a side, best two of three, so the counted/missed split is real. The
// third man on each side carries a name that exists NOWHERE else in the app or
// in this file's fixtures — it is the tracer dye for the leak tests below.
const tPlayers = [
  { player_id: "a1", name: "Paul W", team: "A", handicap_index: 0 },
  { player_id: "a2", name: "Dave K", team: "A", handicap_index: 0 },
  { player_id: "a3", name: "Zephyrus Quill", team: "A", handicap_index: 0 },
  { player_id: "b1", name: "Andy H", team: "B", handicap_index: 0 },
  { player_id: "b2", name: "Nick R", team: "B", handicap_index: 0 },
  { player_id: "b3", name: "Obadiah Fenn", team: "B", handicap_index: 0 },
];
const match = {
  id: "m4", round: 4, teamA: ["a1", "a2", "a3"], teamB: ["b1", "b2", "b3"],
  scoring_type: "points", hole_points: { front: 1, back: 1 },
};

// A flat round: A birdies-par-bogey on every hole, B pars-pars-bogey. Nothing
// distinguishes hole 4 from hole 14, which is exactly what a leak test wants —
// anything unusual on screen had to come from somewhere.
const flat = () => {
  const d = { a1_4: {}, a2_4: {}, a3_4: {}, b1_4: {}, b2_4: {}, b3_4: {} };
  for (let h = 0; h < 18; h += 1) {
    d.a1_4[h] = 3; d.a2_4[h] = 4; d.a3_4[h] = 5;
    d.b1_4[h] = 4; d.b2_4[h] = 4; d.b3_4[h] = 5;
  }
  return d;
};
const holeData = flat();

const scored = (data) =>
  computeMatchResult(match, data, courses, tRounds, tPlayers, "team_best_ball", {}, undefined, {}, {});
const reader = (data) => (pid, h) => data[`${pid}_4`]?.[h] || 0;

const result = scored(holeData);
const getScore = reader(holeData);

// `ownResult` is the captain's own side scored off the UNCUT map — it holds the
// hole he is about to reveal, which is the whole reason this screen is
// dangerous. In production App hands it exactly this. Defaults here match.
const mount = (reveal, extra = {}) => render(
  <FinalCountdown
    match={match} result={result} getScore={getScore}
    ownResult={result} ownGetScore={getScore}
    holePars={PARS} holeHcps={SI} tPlayers={tPlayers}
    teams={{ A: { id: "A", name: "Mash Brothers" }, B: { id: "B", name: "Shot Callers" } }}
    courseName="Treetops" formatLabel="Team Best Ball"
    reveal={reveal} totals={{ A: 3, B: 1 }} toWin={12.5} clincher={null}
    isDirector={false} captainSide={null}
    onAdvance={() => {}} onSetHole={() => {}} onClose={() => {}}
    {...extra}
  />,
).container;

// The card itself, not the screen around it. It is the only 2px-bordered div
// whose text opens with the hole number — the side columns open with a team
// name, the clinch band with a team name, and the reveal control is a button.
// Everything below asserts against THIS element, because the leak that matters
// is one inside the band: the television's own chips are supposed to name the
// men on the hole the room is looking at.
// By its NAME, not by its first words. The card's own "HOLE n" heading is
// conditional now — it sits directly under the screen's, so it prints only on
// the beat where the two differ (his side is a hole behind and he is about to
// reveal one the room has not reached).
const cardOf = (c) => c.querySelector('[aria-label="Captain\'s card"]') || null;

// Which hole the card is ABOUT, which is the question these tests ask. Its own
// heading when it carries one; otherwise the screen's, which is what its
// absence means.
const cardHole = (c) => {
  const card = cardOf(c);
  if (!card) return null;
  const own = /^HOLE (\d+)/.exec(card.textContent);
  if (own) return Number(own[1]);
  const screenHole = /HOLE (\d+)/.exec(c.textContent);
  return screenHole ? Number(screenHole[1]) : null;
};

const captainA = { isDirector: false, captainSide: "A" };

// ══════════════════════════════════════════════════════════════════
//  1. It is never on the television
// ══════════════════════════════════════════════════════════════════
//  Signing the TV in as a guest keeps `captainSide` null and the card away —
//  but that is a setup step somebody has to get right on the night, in a room,
//  once a year, and if they get it wrong by signing in as a captain instead the
//  failure is SILENT AND TOTAL: the hole nobody has seen, printed forty inches
//  wide in front of the room the countdown exists to keep it from. Nobody would
//  even know it was there until somebody read it.
//
//  So the screen refuses on its own, off the same measurement the layout forks
//  on, and this is pinned harder than anything else in the file.
describe("the card never reaches the television", () => {
  it("is absent on a big screen for a captain", () => {
    setWidth(TV);
    expect(cardOf(mount({ A: 1, B: 1 }, captainA))).toBe(null);
  });

  it("is absent on a big screen for a captain who is also the director", () => {
    setWidth(TV);
    expect(cardOf(mount({ A: 1, B: 1 }, { isDirector: true, captainSide: "A" }))).toBe(null);
    cleanup();
    expect(cardOf(mount({ A: 1, B: 1 }, { isDirector: true, captainSide: "B" }))).toBe(null);
  });

  it("is absent on a big screen at every point in the reveal", () => {
    setWidth(TV);
    [{ A: 0, B: 0 }, { A: 1, B: 1 }, { A: 1, B: 0 }, { A: 9, B: 9 }, { A: 17, B: 17 }].forEach((r) => {
      expect(cardOf(mount(r, captainA))).toBe(null);
      cleanup();
    });
  });

  // Not just the band element — none of the card's TEXT reaches the screen by
  // any other route. These three strings exist nowhere else in the layout.
  it("puts none of the card's lines on a big screen anywhere", () => {
    setWidth(TV);
    const t = mount({ A: 4, B: 4 }, captainA).textContent;
    expect(t).not.toContain("Net birdie");
    expect(t).not.toContain("in a row");
    expect(t).not.toContain("First net eagle");
    expect(t).not.toContain("best hole so far");
    // And nothing about hole 5, which is the hole the card would have held.
    expect(t).not.toContain("HANDICAP 5");
  });

  // The refusal is the layout's own breakpoint, so pin where it falls. 900 is
  // a television; 899 is a phone turned sideways, which is still a phone.
  it("draws on the phone side of the breakpoint and not the other", () => {
    setWidth(899);
    expect(cardOf(mount({ A: 1, B: 1 }, captainA))).toBeTruthy();
    cleanup();
    setWidth(900);
    expect(cardOf(mount({ A: 1, B: 1 }, captainA))).toBe(null);
  });

  // The cost of that refusal, stated: he keeps the CONTROL and loses the card.
  // A captain driving off a laptop can still turn his side over.
  it("still leaves him his reveal button on a big screen", () => {
    setWidth(TV);
    expect(mount({ A: 1, B: 1 }, captainA).textContent).toContain("REVEAL MASH BROTHERS · HOLE 2");
  });
});

// ══════════════════════════════════════════════════════════════════
//  2. Who gets one at all
// ══════════════════════════════════════════════════════════════════
describe("who the card is for", () => {
  it("is absent for anybody who captains nothing", () => {
    setWidth(PHONE);
    // A player, a guest, a spectator.
    expect(cardOf(mount({ A: 1, B: 1 }, { isDirector: false, captainSide: null }))).toBe(null);
    cleanup();
    // And a DIRECTOR who captains nothing. The crown drives both counters; it
    // does not make him the man narrating, and a card in his hand would be a
    // second phone in the room holding an unrevealed hole.
    expect(cardOf(mount({ A: 1, B: 1 }, { isDirector: true, captainSide: null }))).toBe(null);
  });

  // `sidesPending`: his side is a hole ahead, so the OTHER captain is speaking
  // and this band would be him reading over the top of it — while holding a
  // hole the room has not reached.
  it("is absent when it is not his go", () => {
    setWidth(PHONE);
    expect(cardOf(mount({ A: 2, B: 1 }, captainA))).toBe(null);
    cleanup();
    // The other captain, same instant, does get one — it is his turn.
    const c = mount({ A: 2, B: 1 }, { isDirector: false, captainSide: "B" });
    expect(cardOf(c)).toBeTruthy();
    expect(cardHole(c)).toBe(2);
  });

  it("is there for both when the sides are level and either may open the hole", () => {
    setWidth(PHONE);
    expect(cardHole(mount({ A: 5, B: 5 }, captainA))).toBe(6);
    cleanup();
    expect(cardHole(mount({ A: 5, B: 5 }, { isDirector: false, captainSide: "B" }))).toBe(6);
  });

  it("is absent once his side has nothing left to show", () => {
    setWidth(PHONE);
    expect(cardOf(mount({ A: 18, B: 18 }, captainA))).toBe(null);
    cleanup();
    // His side is done and the other is not: still nothing to announce.
    expect(cardOf(mount({ A: 18, B: 17 }, captainA))).toBe(null);
  });

  it("is absent without an own-side pass to read", () => {
    // App withholds `ownResult` from anybody it has not decided is a captain.
    // The card must not fall back to the television's own cut pass and draw
    // whatever happens to be in it.
    setWidth(PHONE);
    expect(cardOf(mount({ A: 1, B: 1 }, { ...captainA, ownResult: null }))).toBe(null);
  });
});

// ══════════════════════════════════════════════════════════════════
//  3. The hole on the card is HIS next one, not the room's
// ══════════════════════════════════════════════════════════════════
//  Two different questions with two different answers, and the card answering
//  the room's would put him a hole behind his own script.
describe("which hole the card holds", () => {
  it("is one past his own counter while the television is on the last one", () => {
    setWidth(PHONE);
    const c = mount({ A: 3, B: 3 }, captainA);
    // The room is on hole 3 — the one both captains have finished telling.
    expect(c.textContent).toContain("HOLE 3PAR 4 · HANDICAP 3");
    // His card is on hole 4, which nobody has seen — and because that is NOT
    // the hole on screen, the card carries its own heading to say so. This is
    // the beat the heading exists for.
    expect(cardOf(c).textContent).toMatch(/^HOLE 4PAR 4 · HANDICAP 4/);
    expect(cardHole(c)).toBe(4);
  });

  it("follows his own counter, not the other side's", () => {
    setWidth(PHONE);
    // B has opened hole 4 and is talking; A is next on the same hole.
    const c = mount({ A: 3, B: 4 }, captainA);
    expect(cardHole(c)).toBe(4);
    // And it does NOT reprint the heading: hole 4 is the hole on screen, so
    // the card would be saying it a second time forty pixels lower.
    expect(cardOf(c).textContent).not.toMatch(/^HOLE /);
  });

  // The director has cleared the board and moved the room on to hole 4 with
  // nothing on it. `reveal_cursor` moving can only ever show LESS, never more
  // (see lib/reveal) — and the card is unmoved by it either way.
  it("is unmoved by the director's cursor", () => {
    setWidth(PHONE);
    const c = mount({ A: 3, B: 3, cursor: 4 }, captainA);
    expect(c.textContent).toContain("HOLE 4PAR 4 · HANDICAP 4");
    expect(cardHole(c)).toBe(4);
  });

  // A side may be at most one hole ahead — the ceremony written down. A state
  // where A is two clear is not reachable through the app or the rules, and if
  // one ever arrived the card refuses rather than running on ahead.
  it("refuses a side that has somehow run two holes clear", () => {
    setWidth(PHONE);
    expect(cardOf(mount({ A: 3, B: 1 }, captainA))).toBe(null);
  });

  it("opens on hole 1 with nothing behind it", () => {
    setWidth(PHONE);
    const card = cardOf(mount({ A: 0, B: 0 }, captainA));
    expect(card.textContent).toMatch(/^HOLE 1PAR 4 · HANDICAP 1/);
    // No history means no nugget, whatever the other seventeen holes hold.
    expect(card.textContent).not.toContain("in a row");
    expect(card.textContent).not.toContain("best hole");
  });
});

// ══════════════════════════════════════════════════════════════════
//  4. Nothing from beyond the window reaches the band
// ══════════════════════════════════════════════════════════════════
describe("no unrevealed hole reaches the card", () => {
  // A round identical to the flat one for the first four holes, and then
  // extraordinary: Zephyrus Quill — a name that exists nowhere else on this
  // screen's output except his own chip on the hole the room is looking at —
  // makes a hole-in-one on 18, and Paul W eagles the whole back nine.
  //
  // Announcing hole 2, none of that has happened yet as far as the room is
  // concerned, and none of it may be on the card.
  const heroics = () => {
    const d = flat();
    d.a3_4[17] = 1;                           // an ace on the last, net −3
    for (let h = 9; h < 18; h += 1) d.a1_4[h] = 2;  // eagles all the way home
    return d;
  };

  it("keeps a tracer name off the card when its hole is unrevealed", () => {
    setWidth(PHONE);
    const data = heroics();
    const r = scored(data);
    const read = reader(data);
    const c = mount({ A: 1, B: 1 }, { ...captainA, ownResult: r, ownGetScore: read, result: r, getScore: read });
    const card = cardOf(c);
    expect(card).toBeTruthy();
    expect(card.textContent).toMatch(/^HOLE 2/);
    // Nothing off hole 18 or the back nine.
    expect(card.textContent).not.toContain("Zephyrus");
    expect(card.textContent).not.toContain("eagle");
    expect(card.textContent).not.toContain("Eagle");
    // And no superlative built from a hole better than this one.
    expect(card.textContent).not.toContain("best hole");
  });

  // ── The half a "not.toContain" cannot see ────────────────────────
  // A card reading the whole round leaks in TWO directions, and the second is
  // the quiet one: a line that should have fired and did not. "First net eagle
  // of the round" withheld on hole 2 because hole 14 also has one is the room
  // being told, by an absence, that this is not the first — which is exactly
  // the fact the evening exists to withhold.
  //
  // So: an eagle on the hole in hand AND an eagle nobody has seen. The line
  // must fire, and it must name only the man who made the one he is about to
  // read out.
  it("still calls the first net eagle when a later hole has one too", () => {
    setWidth(PHONE);
    const two = flat();
    two.a1_4[1] = 2;    // the hole in hand — Paul W, net eagle
    two.a3_4[13] = 1;   // hole 14 — Zephyrus, unseen
    const r = scored(two);
    const read = reader(two);
    const card = cardOf(mount({ A: 1, B: 1 }, { ...captainA, ownResult: r, ownGetScore: read }));
    expect(card.textContent).toMatch(/^HOLE 2/);
    expect(card.textContent).toContain("First net eagle so far — Paul W");
    expect(card.textContent).not.toContain("Zephyrus");
  });

  // The same trap on the superlative: the side's best hole of the night so far
  // is not cancelled by a better one nobody has watched.
  it("still calls the best hole so far when a later hole is better", () => {
    setWidth(PHONE);
    const two = flat();
    two.a1_4[1] = 3; two.a2_4[1] = 3;   // hole 2 — the side is −2
    two.a1_4[9] = 1; two.a2_4[9] = 1;   // hole 10 — −6, unseen
    const r = scored(two);
    const read = reader(two);
    const card = cardOf(mount({ A: 1, B: 1 }, { ...captainA, ownResult: r, ownGetScore: read }));
    expect(card.textContent).toContain("Mash Brothers −2");
    expect(card.textContent).toContain("Mash Brothers' best hole so far");
  });

  // The mirror, and the half that proves the card is not simply mute. Walk the
  // reveal to hole 18 and the same fixture says all of it.
  it("says all of it the moment those holes are his to announce", () => {
    setWidth(PHONE);
    const data = heroics();
    const r = scored(data);
    const read = reader(data);
    const card = cardOf(mount(
      { A: 17, B: 17 },
      { ...captainA, ownResult: r, ownGetScore: read, result: r, getScore: read },
    ));
    expect(card.textContent).toMatch(/^HOLE 18/);
    expect(card.textContent).toContain("Zephyrus Quill");
    expect(card.textContent).toContain("Net eagle");
  });

  // The sharpest boundary there is: the eagle is on the hole IMMEDIATELY after
  // the one he is announcing. One hole further than the window reaches, and
  // nothing separates it from the window but the window itself — an off-by-one
  // of a single hole in either direction shows up here and nowhere else.
  it("cannot see the hole directly after the one in hand", () => {
    setWidth(PHONE);
    const nextUp = flat();
    nextUp.a3_4[2] = 1;   // Zephyrus eagles hole 3, unseen
    const r = scored(nextUp);
    const read = reader(nextUp);

    // Announcing hole 2, hole 3 is one past the edge.
    const before = cardOf(mount({ A: 1, B: 1 }, { ...captainA, ownResult: r, ownGetScore: read }));
    expect(before.textContent).toMatch(/^HOLE 2/);
    expect(before.textContent).not.toContain("Zephyrus");
    expect(before.textContent).not.toContain("eagle");
    cleanup();

    // One tap later it is the hole in hand, and it is his to call.
    const after = cardOf(mount({ A: 2, B: 2 }, { ...captainA, ownResult: r, ownGetScore: read }));
    expect(after.textContent).toMatch(/^HOLE 3/);
    expect(after.textContent).toContain("First net eagle so far — Zephyrus Quill");
  });

  // ── The strongest form of the invariant ──────────────────────────
  // Two renders of the same instant, differing ONLY in holes the captain has
  // not reached. The television's pass is the SAME OBJECT in both — in
  // production it is cut by `countdownHoleData`, so it cannot differ — and the
  // captain's own uncut pass is where the two fixtures come apart.
  //
  // If one character of the rendered output differs, something derived from an
  // unrevealed hole reached the DOM. This is the assertion that does not depend
  // on guessing which string the leak would be spelled with.
  it("renders byte-identically however the unreached holes are scored", () => {
    setWidth(PHONE);
    // Announcing hole 3: holes 1-2 revealed, hole 3 in hand. Everything from
    // hole 4 on is fair game to mutate.
    const reveal = { A: 2, B: 2 };

    // The mutation is shaped to move EVERY nugget if any of it were reachable:
    // hole 4 breaks the run a forward-reading card would count, hole 5 plants
    // the first eagle that would suppress the eagle line, and the rest go so
    // far under par that the superlative could not survive them.
    const wild = flat();
    wild.a1_4[3] = 4;                       // a par, where the flat round has a birdie
    wild.a3_4[4] = 2;                       // an eagle nobody has seen
    for (let h = 5; h < 18; h += 1) {
      wild.a1_4[h] = 1; wild.a2_4[h] = 1; wild.a3_4[h] = 1;
      wild.b1_4[h] = 9; wild.b2_4[h] = 9; wild.b3_4[h] = 9;
    }

    // The television's pass, cut at the reveal exactly as lib/reveal cuts it.
    // Identical in both renders by construction.
    const cut = {};
    Object.entries(flat()).forEach(([k, v]) => {
      cut[k] = Object.fromEntries(Object.entries(v).filter(([h]) => Number(h) < 2));
    });
    const tvResult = scored(cut);
    const tvRead = reader(cut);

    const draw = (data) => mount(reveal, {
      ...captainA,
      result: tvResult, getScore: tvRead,
      ownResult: scored(data), ownGetScore: reader(data),
    }).textContent;

    const calm = draw(flat());
    cleanup();
    const chaos = draw(wild);

    // Sanity: the card really is being drawn, so this is not two blanks.
    expect(calm).toContain("HOLE 3");
    expect(calm).toBe(chaos);
  });

  // The same proof pointed at the nuggets alone, which are the part compiled
  // from more than one hole and therefore the part with reach.
  it("compiles a run out of revealed holes only", () => {
    setWidth(PHONE);
    // a1 birdies every hole in the flat fixture. On hole 4 that is his fourth
    // running and the card says so — four, not eighteen.
    const card = cardOf(mount({ A: 3, B: 3 }, captainA));
    expect(card.textContent).toContain("Paul W — four in a row");
    expect(card.textContent).not.toContain("eighteen");
    expect(card.textContent).not.toContain("18 in a row");
  });
});

// ══════════════════════════════════════════════════════════════════
//  4b. The window, swept
// ══════════════════════════════════════════════════════════════════
//  One assertion per hole rather than one fixture that happens to be safe.
describe("the window, at every point in the reveal", () => {
  it("always holds exactly the hole one past his own counter", () => {
    setWidth(PHONE);
    for (let k = 0; k < 18; k += 1) {
      const card = cardOf(mount({ A: k, B: k }, captainA));
      expect(card.textContent).toContain(`HOLE ${k + 1}PAR 4 · HANDICAP ${k + 1}`);
      cleanup();
    }
  });

  // ── The proof that the superlative reads the window and not the round ──
  // A round that gets better every hole: the side is −1 on the first, −2 on
  // the second, down to −6 on the sixth. On EVERY hole after the first, that
  // hole is the best of the ones the room has watched, so the star fires every
  // single time.
  //
  // A card that compiled from the whole round could not do this. Against
  // eighteen holes the best is hole 6 and the line would fire once, at the end
  // — which is the leak stated as an observation: the absence of the star on
  // hole 2 would tell the room a better hole is still to come.
  it("calls each hole the best so far when every hole beats the last", () => {
    setWidth(PHONE);
    // Best two of three, par 4: the pair sums to 8 − h on hole h, so the side
    // is −1, −2, −3 … down to −6.
    //
    // The eagle is spent on the FIRST hole on purpose. Only two nuggets ever
    // go on the card and the star is the third in the order, so a "first net
    // eagle" arriving later would displace the very line under test — which is
    // the cap doing its job, not a leak, and not what this test is about.
    const pairs = [[2, 5], [3, 3], [3, 2], [2, 2], [2, 1], [1, 1]];
    const climbing = flat();
    pairs.forEach(([lo, hi], i) => {
      climbing.a1_4[i] = lo; climbing.a2_4[i] = hi; climbing.a3_4[i] = 8;
    });
    const r = scored(climbing);
    const read = reader(climbing);

    for (let k = 0; k < 6; k += 1) {
      const card = cardOf(mount({ A: k, B: k }, { ...captainA, ownResult: r, ownGetScore: read }));
      const text = card.textContent;
      expect(text).toContain(`HOLE ${k + 1}`);
      expect(text).toContain(`Mash Brothers −${k + 1}`);
      // The first hole has nothing behind it and gets no star; every one after
      // it is the best of what the room has seen.
      if (k === 0) expect(text).not.toContain("best hole");
      else expect(text).toContain("Mash Brothers' best hole so far");
      cleanup();
    }
  });

  // The mirror, on the same sweep: a round that gets WORSE every hole. Only
  // the first is ever anybody's best, and it has nothing to be the best of —
  // so the star never appears at all, on any of the six.
  it("never calls one the best when every hole is worse than the last", () => {
    setWidth(PHONE);
    const pairs = [[1, 1], [2, 1], [2, 2], [3, 2], [3, 3], [4, 3]];
    const sinking = flat();
    pairs.forEach(([lo, hi], i) => {
      sinking.a1_4[i] = lo; sinking.a2_4[i] = hi; sinking.a3_4[i] = 8;
    });
    const r = scored(sinking);
    const read = reader(sinking);

    for (let k = 0; k < 6; k += 1) {
      const card = cardOf(mount({ A: k, B: k }, { ...captainA, ownResult: r, ownGetScore: read }));
      expect(card.textContent).not.toContain("best hole");
      cleanup();
    }
  });

  // And the run, swept: a1 birdies all eighteen, so on hole k+1 he is on
  // exactly k+1 in a row — the length of the window, never the length of the
  // round.
  it("counts a run to the edge of the window and no further", () => {
    setWidth(PHONE);
    const word = ["", "", "two", "three", "four", "five", "six", "seven"];
    for (let k = 1; k < 7; k += 1) {
      const card = cardOf(mount({ A: k, B: k }, captainA));
      expect(card.textContent).toContain(`Paul W — ${word[k + 1]} in a row`);
      cleanup();
    }
  });
});

// ══════════════════════════════════════════════════════════════════
//  5. His own side, and only his own side
// ══════════════════════════════════════════════════════════════════
//  The other side's eagles are their captain's to announce. His card is the
//  one round he can see all of, and it is not theirs.
describe("the card holds one side", () => {
  it("names nobody from the other side", () => {
    setWidth(PHONE);
    const card = cardOf(mount({ A: 1, B: 1 }, captainA));
    ["Andy H", "Nick R", "Obadiah", "Shot Callers"].forEach((s) => {
      expect(card.textContent).not.toContain(s);
    });
    // And it does name his own.
    expect(card.textContent).toContain("Paul W");
    expect(card.textContent).toContain("Mash Brothers");
  });

  it("names nobody from the other side for the other captain either", () => {
    setWidth(PHONE);
    const card = cardOf(mount({ A: 1, B: 1 }, { isDirector: false, captainSide: "B" }));
    ["Paul W", "Dave K", "Zephyrus", "Mash Brothers"].forEach((s) => {
      expect(card.textContent).not.toContain(s);
    });
    expect(card.textContent).toContain("Shot Callers");
  });

  // The other side's number is on his card nowhere either — not as a headline,
  // not as a comparison. He reads his own and sits down.
  it("carries one number and it is his own side's", () => {
    setWidth(PHONE);
    const card = cardOf(mount({ A: 1, B: 1 }, captainA));
    const nums = card.textContent.match(/(Mash Brothers|Shot Callers) [−+E]/g) || [];
    expect(nums).toEqual(["Mash Brothers −"]);
  });
});

// ══════════════════════════════════════════════════════════════════
//  6. What it says when there is nothing to say
// ══════════════════════════════════════════════════════════════════
//  "The group hasn't finished posting" and "your side made nothing" are
//  opposite instructions to a man about to speak to a room.
describe("a hole that is not fully posted", () => {
  it("tells him so instead of reading out a blank", () => {
    setWidth(PHONE);
    // Best two of three, and only one of A's men has posted hole 2.
    const thin = flat();
    delete thin.a2_4[1];
    delete thin.a3_4[1];
    const r = scored(thin);
    const read = reader(thin);
    const card = cardOf(mount({ A: 1, B: 1 }, { ...captainA, ownResult: r, ownGetScore: read }));
    expect(card.textContent).toContain("NO SCORES ON THIS HOLE YET");
    // No number, and no man named off a half-posted hole.
    expect(card.textContent).not.toContain("Mash Brothers −");
    expect(card.textContent).not.toContain("Net birdie");
  });
});

// ══════════════════════════════════════════════════════════════════
//  His phone is a script, not a scoreboard
// ══════════════════════════════════════════════════════════════════
//
// Photographed: the middle of a captain's phone was the other side's list
// half cut off by the scroll container, a band of nothing, and eighteen
// ticker cells — with the one thing he is holding the phone to READ below all
// of it. Two rows of nine is 76px of a 393px screen, and the ticker answers
// "where are we in the round", which he can see on the television he is
// standing next to.
describe("what his phone spends its height on", () => {
  // The ticker, by the one thing only it has: a row of numbered cells. Nine
  // of them on a phone, which splits it in two, and all eighteen on a
  // television, which does not.
  const ticker = (c) => [...c.querySelectorAll("div")]
    .find((d) => (d.children.length === 9 || d.children.length === 18)
      && [...d.children].every((x) => /^\d+$/.test(x.textContent || "")));

  it("drops the hole ticker while he has a card to read", () => {
    setWidth(PHONE);
    expect(ticker(mount({ A: 3, B: 3 }, captainA))).toBeFalsy();
  });

  it("keeps it for everybody else", () => {
    setWidth(PHONE);
    // A player watching on his own phone: no card, so the ticker is the only
    // thing telling him where the round is.
    expect(ticker(mount({ A: 3, B: 3 }, { isDirector: false, captainSide: null }))).toBeTruthy();
    cleanup();
    // And the television, which is where it belongs most.
    setWidth(TV);
    expect(ticker(mount({ A: 3, B: 3 }, captainA))).toBeTruthy();
  });

  it("puts the card above the two lists, not under them", () => {
    setWidth(PHONE);
    const c = mount({ A: 3, B: 3 }, captainA);
    const card = cardOf(c);
    const list = [...c.querySelectorAll("div")].find((d) => /^Mash Brothers/.test(d.textContent)
      && d.style.overflow === "hidden" && d.style.minWidth === "0px");
    expect(card).toBeTruthy();
    expect(list).toBeTruthy();
    // DOCUMENT_POSITION_FOLLOWING: the list comes after the card.
    expect(!!(card.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });
});
