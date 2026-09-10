import { describe, it, expect } from "vitest";
import {
  resolveSealed, HOLE_COUNT, sealDefaultFor, isSealedRound, revealedThrough, isFullyRevealed, isConcealing, revealState, concealedRoundNumbers, concealHoleData, countdownHoleData, stepReveal, revealSummary, wantsCountdown,
  sideReveal, revealedForSide, revealHole, sidesPending, nextHoleForSide,
} from "./reveal";

// The blackout is the one feature of this app whose failure mode is silent
// and unrecoverable: a leaderboard that shows one hole too many has given
// away an ending that cannot be un-given. So the subtraction gets pinned
// down here rather than trusted to read correctly.

const round = (n, extra = {}) => ({ round_number: n, format: "singles", ...extra });
const sealedRound = (n, through, extra = {}) =>
  round(n, { format: "team_best_ball", sealed: true, reveal_through: through, ...extra });

// n holes posted for a player in a round: { 0: 4, 1: 4, … }
const card = (n, s = 4) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i, s]));

describe("sealDefaultFor", () => {
  it("opens Team Best Ball sealed and nothing else", () => {
    expect(sealDefaultFor("team_best_ball")).toBe(true);
    expect(sealDefaultFor("singles")).toBe(false);
    expect(sealDefaultFor("best_ball")).toBe(false);
    expect(sealDefaultFor(undefined)).toBe(false);
  });
});

describe("isSealedRound", () => {
  // A stored flag is the director's word and always wins, in both directions.
  it("takes the stored flag over everything", () => {
    expect(isSealedRound(round(4, { format: "team_best_ball", sealed: true }))).toBe(true);
    expect(isSealedRound(round(4, { format: "team_best_ball", sealed: false }))).toBe(false);
    // Even on a finished round, and even against the format.
    expect(isSealedRound(round(4, { format: "team_best_ball", sealed: false, final: true }))).toBe(false);
    expect(isSealedRound(round(1, { format: "best_ball", sealed: true }))).toBe(true);
  });

  // The reason this fallback exists. The seed only reaches the document when a
  // director opens that round's form, so a Team Best Ball round nobody edited
  // was played in the open — opponents' scores and the match status on every
  // phone on the course, which is the one thing the reveal is for.
  it("seals an unflagged Team Best Ball round that is still live", () => {
    expect(isSealedRound(round(4, { format: "team_best_ball" }))).toBe(true);
  });

  // The other end, and the load-bearing one: every imported year is written
  // locked and final, so none of a decade of results can be pulled off the
  // board by this fallback.
  it("never seals a finished round on the format alone", () => {
    expect(isSealedRound(round(4, { format: "team_best_ball", final: true }))).toBe(false);
  });

  it("leaves every other format alone", () => {
    expect(isSealedRound(round(1, { format: "best_ball" }))).toBe(false);
    expect(isSealedRound(round(2, { format: "scramble" }))).toBe(false);
    expect(isSealedRound(round(3, { format: undefined }))).toBe(false);
    expect(isSealedRound(null)).toBe(false);
  });
});

describe("resolveSealed", () => {
  // One rule, shared by the Rounds form's seed and the board that reads it.
  // They each held their own copy, which is how a form and a scoreboard came
  // to disagree about what an unwritten flag meant.
  it("is the same answer the Rounds form seeds from", () => {
    expect(resolveSealed("team_best_ball", null, false)).toBe(true);
    expect(resolveSealed("team_best_ball", null, true)).toBe(false);
    expect(resolveSealed("team_best_ball", undefined, false)).toBe(true);
    expect(resolveSealed("best_ball", null, false)).toBe(false);
    expect(resolveSealed("best_ball", true, true)).toBe(true);
    expect(resolveSealed("team_best_ball", false, false)).toBe(false);
  });
});

describe("revealedThrough", () => {
  it("is every hole on a round that isn't sealed", () => {
    expect(revealedThrough(round(1))).toBe(HOLE_COUNT);
    expect(revealedThrough(round(1, { reveal_through: 3 }))).toBe(HOLE_COUNT);
  });

  it("is nothing on a sealed round that has never been stepped", () => {
    expect(revealedThrough(round(4, { sealed: true }))).toBe(0);
    expect(revealedThrough(round(4, { sealed: true, reveal_through: null }))).toBe(0);
    expect(revealedThrough(round(4, { sealed: true, reveal_through: "nonsense" }))).toBe(0);
  });

  it("clamps to the card", () => {
    expect(revealedThrough(sealedRound(4, -5))).toBe(0);
    expect(revealedThrough(sealedRound(4, 99))).toBe(HOLE_COUNT);
    expect(revealedThrough(sealedRound(4, 7))).toBe(7);
  });
});

describe("isConcealing", () => {
  it("stops when the last hole is turned over AND the round is final", () => {
    expect(isConcealing(sealedRound(4, 0))).toBe(true);
    expect(isConcealing(sealedRound(4, 17))).toBe(true);
    expect(isConcealing(sealedRound(4, 18, { final: true }))).toBe(false);
    expect(isConcealing(round(4))).toBe(false);
  });

  // ── The second condition, and why it is not the eighteenth hole ──
  // Turning over eighteen holes is the CEREMONY finishing. Between that and
  // the round going in the books sit the things that decide what it is worth:
  // a card nobody signed, a hole somebody typed wrong and fixed in front of
  // the room, an attest still outstanding. A number published before the
  // director stands behind it is a number that can still move, and one that
  // moves after everybody has read it is worse than one that lands late.
  it("keeps holding after the eighteenth until the director finalises it", () => {
    expect(isFullyRevealed(sealedRound(4, 18))).toBe(true);
    expect(isConcealing(sealedRound(4, 18))).toBe(true);
  });

  // The other end of the same door. A Team Best Ball round nobody ever
  // flagged is sealed by the FORMAT, and resolveSealed drops that fallback
  // the moment the lock lands — so the two halves cannot deadlock a round
  // between them.
  it("cannot strand a round that was never explicitly sealed", () => {
    const unflagged = round(4, { format: "team_best_ball", reveal_through: 18, final: true });
    expect(isSealedRound(unflagged)).toBe(false);
    expect(isConcealing(unflagged)).toBe(false);
  });

  // The flag survives the reveal — a revealed round still reads as a sealed
  // one in Admin, and re-sealing it is a step back, not a re-tick.
  it("leaves the round sealed once it is fully revealed", () => {
    expect(isFullyRevealed(sealedRound(4, 18))).toBe(true);
    expect(isSealedRound(sealedRound(4, 18))).toBe(true);
  });
});

describe("revealState / concealedRoundNumbers", () => {
  const tRounds = [round(1), round(2), sealedRound(3, 18, { final: true }), sealedRound(4, 6)];

  it("answers per round", () => {
    expect(revealState(tRounds, 1)).toEqual({ sealed: false, concealing: false, through: 18, sides: { A: 18, B: 18 }, hole: 18 });
    expect(revealState(tRounds, 3)).toEqual({ sealed: true, concealing: false, through: 18, sides: { A: 18, B: 18 }, hole: 18 });
    expect(revealState(tRounds, 4)).toEqual({ sealed: true, concealing: true, through: 6, sides: { A: 6, B: 6 }, hole: 6 });
  });

  it("reads an unknown round as wide open", () => {
    expect(revealState(tRounds, 9)).toEqual({ sealed: false, concealing: false, through: 18, sides: { A: 18, B: 18 }, hole: 18 });
    expect(revealState(undefined, 1).concealing).toBe(false);
  });

  it("lists only the rounds still holding something back", () => {
    expect(concealedRoundNumbers(tRounds)).toEqual([4]);
    expect(concealedRoundNumbers([round(1), round(2)])).toEqual([]);
  });
});

describe("concealHoleData", () => {
  const data = { p1_3: card(18), p1_4: card(18), "p_two_4": card(12) };

  it("hands back the same object when nothing is sealed", () => {
    const tRounds = [round(3), round(4)];
    expect(concealHoleData(data, tRounds)).toBe(data);
  });

  it("hands back the same object once everything is revealed", () => {
    expect(concealHoleData(data, [round(3), sealedRound(4, 18, { final: true })])).toBe(data);
  });

  it("drops the round entirely when nothing has been turned over", () => {
    const out = concealHoleData(data, [round(3), sealedRound(4, 0)]);
    expect(out.p1_4).toBeUndefined();
    expect(out.p_two_4).toBeUndefined();
    // Every other round is untouched.
    expect(out.p1_3).toEqual(card(18));
  });

  // The board is all-or-nothing: a reveal in progress is still nothing.
  // This is the whole change — the scoreboard no longer keeps step with the
  // countdown, it waits for it. A hole leaking through here would put the
  // ending on sixteen phones before it reaches the television.
  it("drops the round mid-reveal too, however far the countdown has walked", () => {
    [1, 6, 13, 17].forEach((through) => {
      const out = concealHoleData(data, [round(3), sealedRound(4, through)]);
      expect(out.p1_4).toBeUndefined();
      expect(out.p_two_4).toBeUndefined();
      expect(out.p1_3).toEqual(card(18));
    });
  });

  it("lands the whole round when the eighteenth is out and the round is final", () => {
    expect(concealHoleData(data, [sealedRound(4, 17)]).p1_4).toBeUndefined();
    // Eighteen out, not yet in the books: still nothing.
    expect(concealHoleData(data, [sealedRound(4, 18)]).p1_4).toBeUndefined();
    expect(concealHoleData(data, [sealedRound(4, 18, { final: true })]).p1_4).toEqual(card(18));
  });

  // A player id with underscores in it must not be read as a round number.
  it("reads the round off the last separator", () => {
    const out = concealHoleData(data, [sealedRound(4, 3)]);
    expect(out.p_two_4).toBeUndefined();
    expect(out.p1_3).toEqual(card(18));
  });

  it("leaves the original untouched", () => {
    concealHoleData(data, [sealedRound(4, 3)]);
    expect(Object.keys(data.p1_4)).toHaveLength(18);
  });

  it("survives an empty map", () => {
    expect(concealHoleData(undefined, [sealedRound(4, 3)])).toEqual({});
  });
});

// The other half of the split. Same subtraction, cut at the reveal instead
// of at zero, and handed to exactly one screen.
describe("countdownHoleData", () => {
  const data = { p1_3: card(18), p1_4: card(18), "p_two_4": card(12) };

  it("hands back the same object when nothing is sealed", () => {
    expect(countdownHoleData(data, [round(3), round(4)])).toBe(data);
    expect(countdownHoleData(data, [round(3), sealedRound(4, 18, { final: true })])).toBe(data);
  });

  it("keeps exactly the revealed holes and no more", () => {
    const out = countdownHoleData(data, [sealedRound(4, 6)]);
    expect(Object.keys(out.p1_4).map(Number).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(out.p1_4[5]).toBe(4);
    expect(out.p1_4[6]).toBeUndefined();
  });

  it("drops the round when nothing has been turned over", () => {
    const out = countdownHoleData(data, [round(3), sealedRound(4, 0)]);
    expect(out.p1_4).toBeUndefined();
    expect(out.p1_3).toEqual(card(18));
  });

  it("reads the round off the last separator", () => {
    const out = countdownHoleData(data, [sealedRound(4, 3)]);
    expect(Object.keys(out.p_two_4)).toHaveLength(3);
  });

  it("leaves the original untouched", () => {
    countdownHoleData(data, [sealedRound(4, 3)]);
    expect(Object.keys(data.p1_4)).toHaveLength(18);
  });

  it("survives an empty map", () => {
    expect(countdownHoleData(undefined, [sealedRound(4, 3)])).toEqual({});
  });

  // The two are only ever allowed to agree in one direction: whatever the
  // countdown is showing, the board is showing that much or less.
  it("never shows less than the board", () => {
    for (let through = 0; through <= HOLE_COUNT; through += 1) {
      const tRounds = [sealedRound(4, through)];
      const board = concealHoleData(data, tRounds);
      const tv = countdownHoleData(data, tRounds);
      const boardHoles = Object.keys(board.p1_4 || {}).length;
      const tvHoles = Object.keys(tv.p1_4 || {}).length;
      expect(tvHoles).toBeGreaterThanOrEqual(boardHoles);
      // And the board is at one of the two ends, never in between.
      expect([0, HOLE_COUNT]).toContain(boardHoles);
    }
  });
});

describe("stepReveal", () => {
  it("walks the card and stops at both ends", () => {
    expect(stepReveal(0, 1)).toBe(1);
    expect(stepReveal(0, -1)).toBe(0);
    expect(stepReveal(17, 1)).toBe(18);
    expect(stepReveal(18, 1)).toBe(18);
    expect(stepReveal(undefined, 1)).toBe(1);
  });
});

describe("revealSummary", () => {
  it("says nothing is out rather than '0 of 18'", () => {
    expect(revealSummary(0)).toBe("Sealed — nothing revealed yet");
    expect(revealSummary(6)).toBe("6 of 18 holes revealed");
  });
});

// ── The whole point, end to end ────────────────────────────────────
// isSealedRound is a predicate; what the field actually experiences is
// concealHoleData, which is what the scoreboard, the Betting tab and the
// Data tab are scored off. These pin the subtraction on the shape that
// failed: a live cup whose round 4 nobody opened the Rounds form for.
describe("a live Team Best Ball round nobody flagged", () => {
  const liveCup = [
    { round_number: 1, format: "best_ball" },
    { round_number: 4, format: "team_best_ball" },
  ];
  const holes = {
    "a1_1": { 0: 4, 1: 5, 2: 3 },
    "a1_4": { 0: 4, 1: 5, 2: 3 },
    "b1_4": { 0: 5, 1: 4, 2: 4 },
  };

  it("takes round 4 off the board entirely and leaves round 1 alone", () => {
    const out = concealHoleData(holes, liveCup);
    expect(out["a1_1"]).toEqual({ 0: 4, 1: 5, 2: 3 });
    // Nothing turned over yet, so the round has no scores at all — no side
    // totals, no match status, nothing banked.
    expect(out["a1_4"]).toBeUndefined();
    expect(out["b1_4"]).toBeUndefined();
  });

  it("still says nothing while the countdown is walking", () => {
    const through2 = [{ round_number: 4, format: "team_best_ball", reveal_through: 2 }];
    const out = concealHoleData(holes, through2);
    expect(out["a1_4"]).toBeUndefined();
    expect(out["b1_4"]).toBeUndefined();
    // The television is the one screen that has them.
    const tv = countdownHoleData(holes, through2);
    expect(tv["a1_4"]).toEqual({ 0: 4, 1: 5 });
    expect(tv["b1_4"]).toEqual({ 0: 5, 1: 4 });
  });

  it("is fully open again once all eighteen are revealed and it is final", () => {
    const walked = [{ round_number: 4, format: "team_best_ball", reveal_through: HOLE_COUNT }];
    expect(concealHoleData(holes, walked)["a1_4"]).toBeUndefined();
    const done = [{ round_number: 4, format: "team_best_ball", reveal_through: HOLE_COUNT, final: true }];
    expect(concealHoleData(holes, done)).toBe(holes);
  });

  // A decade of results must survive the deploy that turned this on.
  it("does not touch a finished year", () => {
    const history = [{ round_number: 4, format: "team_best_ball", final: true }];
    expect(concealHoleData(holes, history)).toBe(holes);
  });

  // And a director who deliberately wants it live keeps that.
  it("respects an explicit unseal", () => {
    const open = [{ round_number: 4, format: "team_best_ball", sealed: false }];
    expect(concealHoleData(holes, open)).toBe(holes);
  });
});

// ── The television's URL ─────────────────────────────────────────
// One machine, wired to a TV, pointed at one address and refreshed by
// somebody two minutes before the room sits down. Both spellings have to
// land on the countdown; see the note over COUNTDOWN_PATH.
describe("wantsCountdown", () => {
  it("takes the path a person says out loud", () => {
    expect(wantsCountdown({ pathname: "/finalcountdown", hash: "" })).toBe(true);
    // A television browser adds the slash; nobody typing it does.
    expect(wantsCountdown({ pathname: "/finalcountdown/", hash: "" })).toBe(true);
    expect(wantsCountdown({ pathname: "/FinalCountdown", hash: "" })).toBe(true);
  });

  it("takes the hash the app writes for itself", () => {
    expect(wantsCountdown({ pathname: "/", hash: "#countdown" })).toBe(true);
  });

  it("leaves every other address alone", () => {
    expect(wantsCountdown({ pathname: "/", hash: "" })).toBe(false);
    expect(wantsCountdown({ pathname: "/finalcountdownx", hash: "" })).toBe(false);
    expect(wantsCountdown({ pathname: "/final", hash: "" })).toBe(false);
    expect(wantsCountdown({ pathname: "/", hash: "#leaderboard" })).toBe(false);
    expect(wantsCountdown(null)).toBe(false);
  });

  // A store build loads from a file inside the binary; its pathname is
  // whatever the platform hands over and must never read as the countdown.
  it("does not fire on a native file path", () => {
    expect(wantsCountdown({ pathname: "/index.html", hash: "" })).toBe(false);
    expect(wantsCountdown({ pathname: "/var/containers/app/index.html", hash: "" })).toBe(false);
  });
});


// ══════════════════════════════════════════════════════════════════
//  Two counters, one per side
// ══════════════════════════════════════════════════════════════════
//  A hole is turned over one side at a time — its captain tells the room
//  what is on it, then taps — so a hole can sit half-open while he talks.
//  Everything that asks "what is PUBLIC" has to keep meaning the holes that
//  are wholly out, or the board learns the result a captain has not given yet.

const twoSided = (a, b, extra = {}) => round(4, { format: "team_best_ball", sealed: true, reveal_a: a, reveal_b: b, ...extra });

describe("the two sides", () => {
  it("reads each side's own counter", () => {
    expect(sideReveal(twoSided(7, 6))).toEqual({ A: 7, B: 6 });
    expect(revealedForSide(twoSided(7, 6), "A")).toBe(7);
    expect(revealedForSide(twoSided(7, 6), "B")).toBe(6);
  });

  // Every round sealed before the sides came apart carries one number, and it
  // is what a director's ALL button still writes.
  it("reads a legacy single counter as both", () => {
    expect(sideReveal(sealedRound(4, 9))).toEqual({ A: 9, B: 9 });
    expect(revealedForSide(sealedRound(4, 9), "B")).toBe(9);
  });

  it("takes a side's own counter over the legacy one", () => {
    const tr = round(4, { format: "team_best_ball", sealed: true, reveal_through: 9, reveal_a: 3 });
    expect(sideReveal(tr)).toEqual({ A: 3, B: 9 });
  });

  it("is every hole on a round that is not sealed", () => {
    expect(sideReveal(round(1))).toEqual({ A: HOLE_COUNT, B: HOLE_COUNT });
  });

  it("clamps each side to the card", () => {
    expect(sideReveal(twoSided(-4, 99))).toEqual({ A: 0, B: HOLE_COUNT });
    expect(sideReveal(twoSided("nonsense", null))).toEqual({ A: 0, B: 0 });
  });
});

// The load-bearing one. `revealedThrough` is what the scoreboard's own
// subtraction, `isConcealing` and "is it over" all read, and it must never
// count a hole only one captain has spoken to.
describe("what is PUBLIC is the lower of the two", () => {
  it("holds at the side that has said less", () => {
    expect(revealedThrough(twoSided(7, 6))).toBe(6);
    expect(revealedThrough(twoSided(6, 7))).toBe(6);
    expect(revealedThrough(twoSided(0, 18))).toBe(0);
  });

  it("is not over until BOTH sides have finished", () => {
    expect(isFullyRevealed(twoSided(18, 17))).toBe(false);
    expect(isConcealing(twoSided(18, 17))).toBe(true);
    expect(isFullyRevealed(twoSided(18, 18))).toBe(true);
    expect(isConcealing(twoSided(18, 18, { final: true }))).toBe(false);
  });

  // The scoreboard is all-or-nothing whatever the sides are doing, which is
  // the rule the whole evening rests on.
  it("keeps the board at nothing while one side is ahead", () => {
    const data = { p1_4: card(18) };
    expect(concealHoleData(data, [twoSided(17, 16)]).p1_4).toBeUndefined();
    expect(concealHoleData(data, [twoSided(18, 17)]).p1_4).toBeUndefined();
    // And lands the lot when the last captain speaks.
    expect(concealHoleData(data, [twoSided(18, 18, { final: true })])).toBe(data);
  });
});

describe("whose tap comes next", () => {
  it("is the hole a side has been shown, or the last one finished", () => {
    expect(revealHole(twoSided(0, 0))).toBe(0);
    expect(revealHole(twoSided(1, 0))).toBe(1);
    expect(revealHole(twoSided(1, 1))).toBe(1);
  });

  it("offers both when they are level and one when they are not", () => {
    expect(sidesPending(twoSided(3, 3))).toEqual(["A", "B"]);
    expect(sidesPending(twoSided(4, 3))).toEqual(["B"]);
    expect(sidesPending(twoSided(3, 4))).toEqual(["A"]);
    expect(sidesPending(twoSided(18, 18))).toEqual([]);
  });

  it("names the hole each side's next tap would turn over", () => {
    expect(nextHoleForSide(twoSided(3, 4), "A")).toBe(4);
    expect(nextHoleForSide(twoSided(3, 4), "B")).toBe(5);
    expect(nextHoleForSide(twoSided(18, 4), "A")).toBe(null);
  });
});

// The countdown's own map, and the reason it needed a side lookup: the one
// screen that is supposed to walk the round has to walk it a side at a time.
describe("countdownHoleData, per side", () => {
  const sideOf = (pid) => (pid.startsWith("a") ? "A" : "B");
  const data = { a1_4: card(18), b1_4: card(18), a1_3: card(18) };

  it("gives each side its own cut", () => {
    const out = countdownHoleData(data, [twoSided(7, 6)], sideOf);
    expect(Object.keys(out.a1_4).length).toBe(7);
    expect(Object.keys(out.b1_4).length).toBe(6);
    // A round that is not concealing is untouched.
    expect(out.a1_3).toEqual(card(18));
  });

  // The half that matters: team B's seventh must not be on this map while
  // their captain still has it to tell.
  it("holds the trailing side back a hole", () => {
    const out = countdownHoleData(data, [twoSided(7, 6)], sideOf);
    expect(out.a1_4[6]).toBe(4);
    expect(out.b1_4[6]).toBeUndefined();
  });

  it("drops a side that has nothing out at all", () => {
    const out = countdownHoleData(data, [twoSided(3, 0)], sideOf);
    expect(Object.keys(out.a1_4).length).toBe(3);
    expect(out.b1_4).toBeUndefined();
  });

  // A player the lookup has never heard of is cut at the SAFER of the two,
  // which is the side that has been shown less.
  it("cuts an unknown player at the lower counter", () => {
    const out = countdownHoleData({ ghost_4: card(18) }, [twoSided(7, 2)], sideOf);
    expect(Object.keys(out.ghost_4).length).toBe(2);
  });

  it("falls back to the wholly-out hole with no lookup at all", () => {
    const out = countdownHoleData(data, [twoSided(7, 2)]);
    expect(Object.keys(out.a1_4).length).toBe(2);
    expect(Object.keys(out.b1_4).length).toBe(2);
  });

  it("hands back the same object when nothing is concealing", () => {
    expect(countdownHoleData(data, [round(4)], sideOf)).toBe(data);
  });
});
