import { describe, it, expect } from "vitest";
import {
  resolveSealed, HOLE_COUNT, sealDefaultFor, isSealedRound, revealedThrough, isFullyRevealed, isConcealing, revealState, concealedRoundNumbers, concealHoleData, countdownHoleData, stepReveal, revealSummary, wantsCountdown, revealPending,
  sideReveal, revealedForSide, revealHole, sidesPending, nextHoleForSide,
  revealCursor, countdownHole, canAdvanceHole, canGoBackHole,
  COUNTDOWN_HASH, COUNTDOWN_PATH,
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

  // An unsealed round is every hole out and nothing left to drive.
  const open18 = { through: 18, sides: { A: 18, B: 18 }, hole: 18, canNext: false, canBack: false };

  it("answers per round", () => {
    expect(revealState(tRounds, 1)).toEqual({ sealed: false, concealing: false, ...open18 });
    expect(revealState(tRounds, 3)).toEqual({ sealed: true, concealing: false, ...open18 });
    expect(revealState(tRounds, 4)).toEqual({
      sealed: true, concealing: true, through: 6, sides: { A: 6, B: 6 }, hole: 6,
      // Both sides have told hole 6, so the director may clear it; nothing has
      // been cleared yet, so there is nothing to take back.
      canNext: true, canBack: false,
    });
  });

  it("reads an unknown round as wide open", () => {
    expect(revealState(tRounds, 9)).toEqual({ sealed: false, concealing: false, ...open18 });
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

// ══════════════════════════════════════════════════════════════════
//  Where the ROOM is, which is not where the reveal is
// ══════════════════════════════════════════════════════════════════
//  Both captains have told their side, the hole is up on the television with
//  all sixteen balls on it, and everybody is looking at it. The reveal is
//  finished; the hole is not, because the hole is a conversation. Until the
//  cursor existed the only way off it was for a captain to reveal HALF OF THE
//  NEXT ONE — so the result of hole 7 was wiped by the arrival of hole 8, on
//  somebody else's cue, and the director had no way to say "right, that's 7".
describe("the director's cursor", () => {
  const at = (a, b, cursor) => round(4, {
    format: "team_best_ball", sealed: true, reveal_a: a, reveal_b: b,
    ...(cursor == null ? {} : { reveal_cursor: cursor }),
  });

  it("is the furthest hole revealed when nobody has moved it", () => {
    expect(revealCursor(at(7, 7))).toBe(0);
    expect(countdownHole(at(7, 7))).toBe(7);
    // A hole sits HALF open while one captain talks, so this is the max of the
    // two counters and never the minimum.
    expect(countdownHole(at(7, 6))).toBe(7);
  });

  it("leads the reveal once the director clears the board", () => {
    expect(countdownHole(at(7, 7, 8))).toBe(8);
  });

  // The one that would have been a bug on the night. A director who uses the
  // arrows for six holes and then puts his phone down must not freeze the
  // television while the captains carry on revealing.
  it("never holds the screen behind the captains", () => {
    expect(countdownHole(at(11, 11, 8))).toBe(11);
    expect(countdownHole(at(12, 11, 8))).toBe(12);
  });

  it("clamps like every other counter", () => {
    expect(revealCursor(at(0, 0, -3))).toBe(0);
    expect(revealCursor(at(0, 0, 99))).toBe(HOLE_COUNT);
    expect(revealCursor(at(0, 0, "nonsense"))).toBe(0);
  });

  describe("next", () => {
    it("waits for BOTH captains", () => {
      // Advancing past a side that has not spoken would skip its eight balls
      // and they would never come back on their own.
      expect(canAdvanceHole(at(7, 6))).toBe(false);
      expect(canAdvanceHole(at(7, 7))).toBe(true);
    });

    it("is done at the eighteenth", () => {
      expect(canAdvanceHole(at(18, 18))).toBe(false);
      expect(canAdvanceHole(at(17, 17))).toBe(true);
    });

    it("will not clear a board that is already clear", () => {
      // Cleared to 8 and nobody has told it yet.
      expect(canAdvanceHole(at(7, 7, 8))).toBe(false);
    });
  });

  describe("back", () => {
    it("undoes a clear", () => {
      expect(canGoBackHole(at(7, 7, 8))).toBe(true);
      expect(countdownHole(at(7, 7, 7))).toBe(7);
    });

    it("does nothing when there is no clear to undo", () => {
      // Taking the room off a hole it has WATCHED is a different act, and the
      // reveal control below is what does it.
      expect(canGoBackHole(at(7, 7))).toBe(false);
      expect(canGoBackHole(at(7, 6))).toBe(false);
    });

    it("stops the moment a captain reveals into the new hole", () => {
      expect(canGoBackHole(at(8, 7, 8))).toBe(false);
    });
  });

  // It moves the LAYOUT and nothing else. The countdown's scores are cut by
  // the two reveal counters, so a cursor can only ever show less, never more —
  // which is why a director may write it without a rules change.
  it("cannot turn a single ball over", () => {
    const holes = { a1_4: card(18), b1_4: card(18) };
    const cleared = [at(7, 7, 8)];
    const notCleared = [at(7, 7)];
    expect(countdownHoleData(holes, cleared)).toEqual(countdownHoleData(holes, notCleared));
    expect(revealedThrough(at(7, 7, 8))).toBe(7);
    expect(concealHoleData(holes, cleared).a1_4).toBeUndefined();
  });
});


// ══════════════════════════════════════════════════════════════════
//  THE CONTROLS, EXHAUSTIVELY
// ══════════════════════════════════════════════════════════════════
//  Everything below is the same three numbers — `reveal_a`, `reveal_b` and
//  `reveal_cursor` — asked every way the evening can ask them. The blocks
//  above pin the cases somebody thought of; these walk the matrix, because
//  the failure mode here is not a wrong number on a screen somebody can
//  correct. It is eight balls in front of fifteen people, one beat early,
//  and there is no revert for what a room has already read.

// One round, three counters. `cursor` omitted means the field is absent,
// which is what a round nobody has cleared carries.
const rc = (a, b, cursor) => round(4, {
  format: "team_best_ball", sealed: true, reveal_a: a, reveal_b: b,
  ...(cursor == null ? {} : { reveal_cursor: cursor }),
});

// The states the ceremony can actually reach. A side may be at most one hole
// ahead of the other (the screen holds that line and so do the security
// rules), and the cursor is only ever where somebody walked it.
const LADDER = [0, 1, 2, 6, 7, 8, 16, 17, 18];
const CURSORS = Array.from({ length: HOLE_COUNT + 1 }, (_, i) => i);
const everyState = (fn) => {
  LADDER.forEach((a) => LADDER.forEach((b) => CURSORS.forEach((c) => {
    fn(a, b, c, rc(a, b, c));
  })));
};

describe("canAdvanceHole / canGoBackHole across the whole matrix", () => {
  // The definition, written out once. `hole` is what the television is on;
  // NEXT is offered only when both sides have reached it and there is a hole
  // left to reach.
  it("is exactly 'both sides have told the hole on screen, and it is not the last'", () => {
    everyState((a, b, c, tr) => {
      const at = Math.max(c, a, b);
      expect(canAdvanceHole(tr)).toBe(at < HOLE_COUNT && a >= at && b >= at);
    });
  });

  // The invariant that matters, stated as itself rather than as the formula:
  // the room is never moved on past a captain who has not spoken.
  it("never advances past a side that has not told the hole", () => {
    everyState((a, b, c, tr) => {
      if (!canAdvanceHole(tr)) return;
      expect(Math.min(a, b)).toBeGreaterThanOrEqual(countdownHole(tr));
    });
  });

  // BACK is the undo of NEXT and nothing else: it exists only while the clear
  // is still a clear. Un-revealing a hole the room has WATCHED is a different
  // act with its own control (the reveal buttons, and the director's strip).
  it("goes back only when there is a clear to take back", () => {
    everyState((a, b, c, tr) => {
      expect(canGoBackHole(tr)).toBe(c > Math.max(a, b));
    });
  });

  // They cannot both be live. If BACK is offered the cursor leads the reveal,
  // so at least one side has not told the hole on screen — which is exactly
  // what NEXT refuses. A screen offering both would mean the two controls
  // disagreed about where the room is.
  it("never offers both at once", () => {
    everyState((a, b, c, tr) => {
      expect(canAdvanceHole(tr) && canGoBackHole(tr)).toBe(false);
    });
  });

  // Neither control can reach a hole outside the card, whatever is stored.
  it("keeps the hole on the card", () => {
    everyState((a, b, c, tr) => {
      const at = countdownHole(tr);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThanOrEqual(HOLE_COUNT);
      if (canAdvanceHole(tr)) expect(at + 1).toBeLessThanOrEqual(HOLE_COUNT);
      if (canGoBackHole(tr)) expect(at - 1).toBeGreaterThanOrEqual(0);
    });
  });

  // ── The named corners ──────────────────────────────────────────
  it("is level at nothing before anybody has tapped", () => {
    // Both sides have reached hole 0 because there is no hole 0 to tell, so
    // the state machine will clear the opening card onto hole 1 — which shows
    // two empty columns and turns over nothing.
    //
    // The SCREEN is stricter: FinalCountdown's own `canNext` carries an extra
    // `hole > 0`, so the ▶ arrow stays dark on the splash and the first move
    // of the evening is a captain's. Both ends are safe (the cursor cannot
    // reveal a ball either way); the screen is the one that decides.
    expect(countdownHole(rc(0, 0))).toBe(0);
    expect(canAdvanceHole(rc(0, 0))).toBe(true);
    expect(canGoBackHole(rc(0, 0))).toBe(false);
  });

  it("holds while one side is ahead, either side", () => {
    expect(canAdvanceHole(rc(1, 0))).toBe(false);
    expect(canAdvanceHole(rc(0, 1))).toBe(false);
    expect(canAdvanceHole(rc(18, 17))).toBe(false);
    expect(canAdvanceHole(rc(17, 18))).toBe(false);
    // And there is nothing to take back either — the leading side put the
    // room on this hole, not the director.
    expect(canGoBackHole(rc(1, 0))).toBe(false);
    expect(canGoBackHole(rc(17, 18))).toBe(false);
  });

  it("offers only BACK once the cursor is ahead of both", () => {
    expect(canAdvanceHole(rc(7, 7, 8))).toBe(false);
    expect(canGoBackHole(rc(7, 7, 8))).toBe(true);
    // Even miles ahead — a stored cursor that got away from the ceremony is
    // still only ever walked back one hole at a time.
    expect(canAdvanceHole(rc(2, 2, 17))).toBe(false);
    expect(canGoBackHole(rc(2, 2, 17))).toBe(true);
  });

  it("has nothing to clear onto at the eighteenth", () => {
    expect(canAdvanceHole(rc(18, 18))).toBe(false);
    expect(canAdvanceHole(rc(18, 18, 18))).toBe(false);
    expect(canGoBackHole(rc(18, 18, 18))).toBe(false);
    // A cursor at 18 over an unfinished reveal is a cleared board on the last
    // hole: nothing forward, and the clear still takes back.
    expect(canAdvanceHole(rc(0, 0, 18))).toBe(false);
    expect(canGoBackHole(rc(0, 0, 18))).toBe(true);
    expect(canGoBackHole(rc(17, 17, 18))).toBe(true);
  });

  it("is inert when the cursor sits exactly on the revealed hole", () => {
    // The common state: the director cleared onto 8 and both captains have
    // since told it. Nothing to undo, and NEXT is live again.
    expect(countdownHole(rc(8, 8, 8))).toBe(8);
    expect(canGoBackHole(rc(8, 8, 8))).toBe(false);
    expect(canAdvanceHole(rc(8, 8, 8))).toBe(true);
  });

  it("says nothing at all about a round that is not sealed", () => {
    const open = round(4, { format: "singles", reveal_a: 3, reveal_b: 3, reveal_cursor: 4 });
    expect(countdownHole(open)).toBe(HOLE_COUNT);
    expect(canAdvanceHole(open)).toBe(false);
    // The cursor is read off the raw field, so an unsealed round with a stale
    // cursor still reports the whole card as revealed and drives nothing.
    expect(canGoBackHole(open)).toBe(false);
    expect(canAdvanceHole(null)).toBe(false);
    expect(canGoBackHole(undefined)).toBe(false);
  });
});

// The line the comment over countdownHole draws: a director who walks the
// arrows and then puts his phone down must not freeze the television.
describe("countdownHole is the MAX, never the cursor alone", () => {
  it("is max(cursor, the furthest side)", () => {
    everyState((a, b, c, tr) => {
      expect(countdownHole(tr)).toBe(Math.max(c, a, b));
    });
  });

  it("follows the captains again the moment they pass the director", () => {
    // He cleared to 8 and stopped driving. The captains carry on.
    expect(countdownHole(rc(7, 7, 8))).toBe(8);
    expect(countdownHole(rc(8, 7, 8))).toBe(8);
    expect(countdownHole(rc(8, 8, 8))).toBe(8);
    expect(countdownHole(rc(9, 8, 8))).toBe(9);
    expect(countdownHole(rc(12, 12, 8))).toBe(12);
    // All the way to the end, with the cursor still sitting on 8.
    expect(countdownHole(rc(18, 18, 8))).toBe(HOLE_COUNT);
  });

  it("never lets the cursor hide a hole a captain has turned over", () => {
    // A cursor BEHIND the reveal is ignored outright — otherwise the screen
    // would be showing a hole while a side's balls sat on a later one.
    everyState((a, b, c, tr) => {
      expect(countdownHole(tr)).toBeGreaterThanOrEqual(revealHole(tr));
    });
  });
});

describe("sidesPending / nextHoleForSide at every boundary", () => {
  it("offers both captains a level hole and one captain a split one", () => {
    expect(sidesPending(rc(0, 0))).toEqual(["A", "B"]);
    expect(sidesPending(rc(9, 9))).toEqual(["A", "B"]);
    expect(sidesPending(rc(17, 17))).toEqual(["A", "B"]);
    expect(sidesPending(rc(1, 0))).toEqual(["B"]);
    expect(sidesPending(rc(0, 1))).toEqual(["A"]);
    expect(sidesPending(rc(18, 17))).toEqual(["B"]);
    expect(sidesPending(rc(17, 18))).toEqual(["A"]);
  });

  it("has nobody left once both sides are out", () => {
    expect(sidesPending(rc(18, 18))).toEqual([]);
    expect(sidesPending(rc(18, 18, 18))).toEqual([]);
  });

  // The cursor is the layout and nothing else — it cannot put a captain back
  // on the clock or take him off it.
  it("ignores the cursor entirely", () => {
    CURSORS.forEach((c) => {
      expect(sidesPending(rc(7, 7, c))).toEqual(["A", "B"]);
      expect(sidesPending(rc(8, 7, c))).toEqual(["B"]);
      expect(sidesPending(rc(18, 18, c))).toEqual([]);
    });
  });

  it("names each side's next hole, and null when it has none", () => {
    expect(nextHoleForSide(rc(0, 0), "A")).toBe(1);
    expect(nextHoleForSide(rc(0, 0), "B")).toBe(1);
    expect(nextHoleForSide(rc(17, 17), "A")).toBe(18);
    expect(nextHoleForSide(rc(18, 17), "A")).toBe(null);
    expect(nextHoleForSide(rc(18, 17), "B")).toBe(18);
    expect(nextHoleForSide(rc(17, 18), "A")).toBe(18);
    expect(nextHoleForSide(rc(18, 18), "A")).toBe(null);
    expect(nextHoleForSide(rc(18, 18), "B")).toBe(null);
  });

  // It answers "which hole would his tap turn over", not "is it his go" —
  // those are two questions and sidesPending is the other one. FinalCountdown
  // asks BOTH before it will call onAdvance; so do the security rules.
  it("is not a permission — it names a hole for a side that is not due", () => {
    expect(nextHoleForSide(rc(1, 0), "A")).toBe(2);
    expect(sidesPending(rc(1, 0))).not.toContain("A");
  });

  // One hole at a time, all the way up, and never two.
  it("only ever moves a side on by one", () => {
    everyState((a, b, c, tr) => {
      ["A", "B"].forEach((side) => {
        const own = side === "A" ? a : b;
        const next = nextHoleForSide(tr, side);
        if (next == null) expect(own).toBe(HOLE_COUNT);
        else expect(next).toBe(own + 1);
      });
    });
  });
});

describe("stepReveal takes garbage and still lands on the card", () => {
  it("walks one hole and stops at both ends", () => {
    expect(stepReveal(0, 1)).toBe(1);
    expect(stepReveal(0, -1)).toBe(0);
    expect(stepReveal(17, 1)).toBe(HOLE_COUNT);
    expect(stepReveal(18, 1)).toBe(HOLE_COUNT);
    expect(stepReveal(18, -1)).toBe(17);
    expect(stepReveal(1, -1)).toBe(0);
  });

  it("reads anything unreadable as nothing revealed", () => {
    [undefined, null, "", "nonsense", NaN, {}, [], "abc"].forEach((v) => {
      expect(stepReveal(v, 1)).toBe(1);
      expect(stepReveal(v, -1)).toBe(0);
    });
  });

  it("clamps a stored value from outside the card", () => {
    expect(stepReveal(-5, 1)).toBe(0);
    expect(stepReveal(-5, -1)).toBe(0);
    expect(stepReveal(99, 1)).toBe(HOLE_COUNT);
    expect(stepReveal(99, -1)).toBe(HOLE_COUNT);
    expect(stepReveal(Infinity, 1)).toBe(HOLE_COUNT);
    expect(stepReveal(-Infinity, 1)).toBe(0);
  });

  // Whatever goes in, what comes out is on the card. That is the only
  // guarantee any caller needs from it.
  it("is always between 0 and 18, from anything at all", () => {
    [undefined, null, "", "7", "nonsense", NaN, Infinity, -Infinity, -1, 0, 3.7, 17, 18, 99, {}, []]
      .forEach((v) => [1, -1, 18, -18].forEach((by) => {
        const out = stepReveal(v, by);
        expect(out).toBeGreaterThanOrEqual(0);
        expect(out).toBeLessThanOrEqual(HOLE_COUNT);
      }));
  });

  // A FRACTION SURVIVES, and that is fine: every caller floors before it gets
  // here. `revealState.through` comes through clampHole (which floors) and
  // App's onSetReveal rounds before it writes, so a stored 3.7 is a 3 by the
  // time RevealControl sees it. Pinned so a change to either end is noticed.
  it("does not itself round a fractional input", () => {
    expect(stepReveal(3.7, 1)).toBeCloseTo(4.7, 5);
    expect(revealedThrough(sealedRound(4, 3.7))).toBe(3);
  });
});

// ── Half a hole is not a hole ───────────────────────────────────────
// The one that the whole evening rests on. While one captain is talking his
// side's number is on the television and the other side's is not, so the hole
// has no result — and NOTHING outside the countdown may count it.
describe("a half-revealed hole is public nowhere", () => {
  const data = { a1_4: card(18), b1_4: card(18) };

  it("is MIN for what is public and MAX for what is on screen", () => {
    everyState((a, b, c, tr) => {
      expect(revealedThrough(tr)).toBe(Math.min(a, b));
      expect(revealHole(tr)).toBe(Math.max(a, b));
    });
  });

  it("keeps the board at nothing on every split hole", () => {
    for (let n = 1; n <= HOLE_COUNT; n += 1) {
      [[n, n - 1], [n - 1, n]].forEach(([a, b]) => {
        const tr = rc(a, b);
        expect(revealedThrough(tr)).toBe(n - 1);
        expect(isFullyRevealed(tr)).toBe(false);
        expect(isConcealing(tr)).toBe(true);
        expect(revealState([tr], 4).through).toBe(n - 1);
        // The scoreboard is all-or-nothing whatever the sides are doing.
        expect(concealHoleData(data, [tr]).a1_4).toBeUndefined();
        expect(concealHoleData(data, [tr]).b1_4).toBeUndefined();
      });
    }
  });

  // Even on the last hole of the evening, and even with the round final: one
  // captain still holding his eight balls means the cup is not decided.
  it("is not over with one side still to speak on the eighteenth", () => {
    expect(isFullyRevealed(rc(18, 17))).toBe(false);
    expect(isConcealing(round(4, {
      format: "team_best_ball", sealed: true, reveal_a: 18, reveal_b: 17, final: true,
    }))).toBe(true);
    expect(concealHoleData(data, [round(4, {
      format: "team_best_ball", sealed: true, reveal_a: 18, reveal_b: 17, final: true,
    })]).a1_4).toBeUndefined();
  });

  // The countdown is the ONE screen allowed to be mid-hole, and even there
  // the cut is per side.
  it("shows the trailing side less, on the one screen that may", () => {
    const sideOf = (pid) => (pid.startsWith("a") ? "A" : "B");
    const tv = countdownHoleData(data, [rc(7, 6)], sideOf);
    expect(Object.keys(tv.a1_4).length).toBe(7);
    expect(Object.keys(tv.b1_4).length).toBe(6);
    expect(tv.b1_4[6]).toBeUndefined();
  });

  // And the cursor cannot buy a single ball. It is the layout; the scores are
  // cut by the two counters, so a cleared board shows the same map as the
  // hole before it.
  it("is unmoved by the cursor, on either screen", () => {
    CURSORS.forEach((c) => {
      expect(countdownHoleData(data, [rc(7, 6, c)]))
        .toEqual(countdownHoleData(data, [rc(7, 6)]));
      expect(concealHoleData(data, [rc(7, 6, c)]).a1_4).toBeUndefined();
      expect(revealedThrough(rc(7, 6, c))).toBe(6);
    });
  });
});

// A round sealed before the sides came apart carries ONE number. It has to
// keep reading as both — and a side that has since been stepped has to win.
describe("the legacy counter, and the mixed round", () => {
  const legacy = (extra) => round(4, { format: "team_best_ball", sealed: true, ...extra });

  it("reads one number as both sides", () => {
    expect(sideReveal(legacy({ reveal_through: 9 }))).toEqual({ A: 9, B: 9 });
    expect(revealedThrough(legacy({ reveal_through: 9 }))).toBe(9);
    expect(revealHole(legacy({ reveal_through: 9 }))).toBe(9);
    expect(sidesPending(legacy({ reveal_through: 9 }))).toEqual(["A", "B"]);
  });

  // The shape a round takes the first time a captain taps: his own counter is
  // written, the other side is still on the legacy number.
  it("takes a side's own counter and leaves the other on the legacy one", () => {
    const mixed = legacy({ reveal_through: 9, reveal_a: 10 });
    expect(sideReveal(mixed)).toEqual({ A: 10, B: 9 });
    expect(revealedThrough(mixed)).toBe(9);
    expect(revealHole(mixed)).toBe(10);
    expect(sidesPending(mixed)).toEqual(["B"]);
    expect(nextHoleForSide(mixed, "B")).toBe(10);
    // Mirrored.
    const other = legacy({ reveal_through: 9, reveal_b: 10 });
    expect(sideReveal(other)).toEqual({ A: 9, B: 10 });
    expect(sidesPending(other)).toEqual(["A"]);
  });

  // A written ZERO is a value, not an absence. A captain who stepped his side
  // all the way back to 0 must not silently inherit the legacy number.
  it("treats a written 0 as a counter and not as a missing one", () => {
    expect(sideReveal(legacy({ reveal_through: 9, reveal_a: 0 }))).toEqual({ A: 0, B: 9 });
    expect(revealedThrough(legacy({ reveal_through: 9, reveal_a: 0 }))).toBe(0);
    expect(sidesPending(legacy({ reveal_through: 9, reveal_a: 0 }))).toEqual(["A"]);
  });

  it("is nothing revealed when neither the side nor the legacy field exists", () => {
    expect(sideReveal(legacy({}))).toEqual({ A: 0, B: 0 });
    expect(sideReveal(legacy({ reveal_a: 4 }))).toEqual({ A: 4, B: 0 });
    expect(countdownHole(legacy({}))).toBe(0);
  });
});

// A field somebody edited in the Firebase console, a value from an older
// shape, a number that arrived as a string. None of them may produce a hole
// off the card, and none of them may throw on the one evening it matters.
describe("a corrupted counter reads as a hole on the card", () => {
  const garbage = [
    ["a string number", "7", 7],
    ["a fractional string", "7.9", 7],
    ["a fraction", 3.7, 3],
    ["nonsense", "nonsense", 0],
    ["an empty string", "", 0],
    ["NaN", NaN, 0],
    ["Infinity", Infinity, 0],
    ["negative infinity", -Infinity, 0],
    ["a negative", -1, 0],
    ["far past the card", 99, HOLE_COUNT],
    ["an object", {}, 0],
    ["an array", [], 0],
    ["false", false, 0],
  ];

  garbage.forEach(([what, value, expected]) => {
    it(`reads ${what} as ${expected}`, () => {
      const tr = round(4, {
        format: "team_best_ball", sealed: true,
        reveal_a: value, reveal_b: value, reveal_cursor: value,
      });
      expect(revealedForSide(tr, "A")).toBe(expected);
      expect(revealedForSide(tr, "B")).toBe(expected);
      expect(revealedThrough(tr)).toBe(expected);
      expect(revealHole(tr)).toBe(expected);
      expect(revealCursor(tr)).toBe(expected);
      expect(countdownHole(tr)).toBe(expected);
      // And nothing downstream falls over.
      expect(typeof canAdvanceHole(tr)).toBe("boolean");
      expect(typeof canGoBackHole(tr)).toBe("boolean");
      expect(revealState([tr], 4).hole).toBe(expected);
    });
  });

  // Infinity is the one worth naming: it reads as ZERO rather than as the
  // whole card, because clampHole rejects a non-finite number before it
  // clamps. Nothing revealed is the safe end of that mistake.
  it("reads an infinite counter as nothing revealed, not as everything", () => {
    const tr = round(4, { format: "team_best_ball", sealed: true, reveal_a: Infinity, reveal_b: Infinity });
    expect(isFullyRevealed(tr)).toBe(false);
    expect(isConcealing(tr)).toBe(true);
  });

  it("never returns a hole off the card, from anything", () => {
    garbage.forEach(([, value]) => {
      [["reveal_a", "A"], ["reveal_b", "B"]].forEach(([field, side]) => {
        const tr = round(4, { format: "team_best_ball", sealed: true, [field]: value });
        const n = revealedForSide(tr, side);
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(HOLE_COUNT);
      });
    });
  });
});

describe("what the board says, at the four corners", () => {
  const at = (through, extra = {}) => sealedRound(4, through, extra);

  it("counts a concealing round in at 0, 1, 17 and 18", () => {
    expect(isFullyRevealed(at(0))).toBe(false);
    expect(isFullyRevealed(at(1))).toBe(false);
    expect(isFullyRevealed(at(17))).toBe(false);
    expect(isFullyRevealed(at(18))).toBe(true);

    expect(concealedRoundNumbers([at(0)])).toEqual([4]);
    expect(concealedRoundNumbers([at(1)])).toEqual([4]);
    expect(concealedRoundNumbers([at(17)])).toEqual([4]);
    // Eighteen out is the CEREMONY finishing, which is not the round going in
    // the books — it holds until the director finalises it.
    expect(concealedRoundNumbers([at(18)])).toEqual([4]);
    expect(concealedRoundNumbers([at(18, { final: true })])).toEqual([]);
  });

  it("lists concealing rounds ascending and skips the ones without a number", () => {
    expect(concealedRoundNumbers([at(6), { ...at(2), round_number: 2 }, round(1)])).toEqual([2, 4]);
    expect(concealedRoundNumbers([{ ...at(6), round_number: undefined }])).toEqual([]);
    expect(concealedRoundNumbers([{ ...at(6), round_number: "4" }])).toEqual([]);
    expect(concealedRoundNumbers(null)).toEqual([]);
  });

  it("reports the whole control state per round", () => {
    expect(revealState([at(0)], 4)).toEqual({
      sealed: true, concealing: true, through: 0, sides: { A: 0, B: 0 }, hole: 0,
      canNext: true, canBack: false,
    });
    expect(revealState([at(1)], 4)).toEqual({
      sealed: true, concealing: true, through: 1, sides: { A: 1, B: 1 }, hole: 1,
      canNext: true, canBack: false,
    });
    expect(revealState([at(17)], 4)).toEqual({
      sealed: true, concealing: true, through: 17, sides: { A: 17, B: 17 }, hole: 17,
      canNext: true, canBack: false,
    });
    expect(revealState([at(18)], 4)).toEqual({
      sealed: true, concealing: true, through: 18, sides: { A: 18, B: 18 }, hole: 18,
      canNext: false, canBack: false,
    });
    expect(revealState([at(18, { final: true })], 4)).toEqual({
      sealed: true, concealing: false, through: 18, sides: { A: 18, B: 18 }, hole: 18,
      canNext: false, canBack: false,
    });
  });

  it("words the summary the same way at every count", () => {
    expect(revealSummary(0)).toBe("Sealed — nothing revealed yet");
    expect(revealSummary(1)).toBe("1 of 18 holes revealed");
    expect(revealSummary(17)).toBe("17 of 18 holes revealed");
    expect(revealSummary(18)).toBe("18 of 18 holes revealed");
    // It never says "0 of 18", in either direction.
    expect(revealSummary(-1)).toBe("Sealed — nothing revealed yet");
    expect(revealSummary(0)).not.toContain("0 of");
  });
});

// The machine wired to the television is bookmarked on one address and
// refreshed by somebody two minutes before the room sits down.
describe("the television's bookmark", () => {
  it("takes the path in any case, with or without the trailing slash", () => {
    [
      "/finalcountdown", "/finalcountdown/", "/finalcountdown///",
      "/FinalCountdown", "/FINALCOUNTDOWN", "/FINALCOUNTDOWN/",
    ].forEach((pathname) => {
      expect(wantsCountdown({ pathname, hash: "" })).toBe(true);
    });
  });

  it("takes the hash the app writes for itself", () => {
    expect(wantsCountdown({ pathname: "/", hash: COUNTDOWN_HASH })).toBe(true);
    expect(wantsCountdown({ pathname: "/anything", hash: COUNTDOWN_HASH })).toBe(true);
    expect(wantsCountdown({ pathname: COUNTDOWN_PATH, hash: "#leaderboard" })).toBe(true);
  });

  // The hash is compared EXACTLY, and it can be: it is the only spelling no
  // human types. The app writes it, so it is always this string — the path is
  // the half a person says out loud, and that is the half that is forgiving.
  it("compares the hash exactly, because only the app writes it", () => {
    expect(wantsCountdown({ pathname: "/", hash: "#Countdown" })).toBe(false);
    expect(wantsCountdown({ pathname: "/", hash: "#countdown/" })).toBe(false);
    expect(wantsCountdown({ pathname: "/", hash: "countdown" })).toBe(false);
  });

  it("leaves every near miss alone", () => {
    [
      "/", "/final", "/countdown", "/finalcountdownx", "/x/finalcountdown",
      "//finalcountdown", "/finalcountdown/x", "/index.html",
    ].forEach((pathname) => {
      expect(wantsCountdown({ pathname, hash: "" })).toBe(false);
    });
    expect(wantsCountdown({})).toBe(false);
    expect(wantsCountdown(null)).toBe(false);
    expect(wantsCountdown(undefined)).toBe(false);
    expect(wantsCountdown({ pathname: null, hash: null })).toBe(false);
  });
});

// ── The ceremony has not happened yet ──────────────────────────────
// `revealPending` gates the finalize prompt. It is deliberately narrower
// than `isConcealing`: a fully-revealed round still conceals (it waits on
// the director) but its ceremony IS over, and finalizing is the next thing
// that should happen. Getting these two confused either nags the director an
// hour early or never nags him at all.
describe("revealPending", () => {
  const sealed = (extra) => ({ round_number: 4, format: "team_best_ball", sealed: true, ...extra });

  it("is true on a sealed round nobody has started turning over", () => {
    expect(revealPending(sealed({ reveal_a: 0, reveal_b: 0 }))).toBe(true);
  });

  it("stays true all the way to the seventeenth", () => {
    expect(revealPending(sealed({ reveal_a: 17, reveal_b: 17 }))).toBe(true);
    // And on a hole only one side has told — which is not a hole that is out.
    expect(revealPending(sealed({ reveal_a: 18, reveal_b: 17 }))).toBe(true);
  });

  it("goes false the moment the last hole is out, BEFORE the round is final", () => {
    // The whole point. The ceremony is over, the round is not yet in the
    // books, and this is exactly when the director should be prompted.
    const done = sealed({ reveal_a: 18, reveal_b: 18 });
    expect(revealPending(done)).toBe(false);
    expect(isConcealing(done)).toBe(true);        // still concealing, still his call
  });

  it("is false on a round that was never sealed", () => {
    expect(revealPending({ round_number: 1, format: "singles", sealed: false })).toBe(false);
    // Including one with no scores and no counters at all.
    expect(revealPending({ round_number: 1, format: "singles" })).toBe(false);
  });

  it("is false on a finished round, so an imported year never nags", () => {
    // History is written locked and final, which is what keeps the ten old
    // cups out of every fallback in this file.
    expect(revealPending({ round_number: 4, format: "team_best_ball", final: true })).toBe(false);
  });

  it("is false for a round that does not exist", () => {
    // What App hands it when `currentRound` is null or the round list has not
    // arrived — the prompt must not be suppressed by a missing document.
    expect(revealPending(undefined)).toBe(false);
    expect(revealPending(null)).toBe(false);
  });
});
