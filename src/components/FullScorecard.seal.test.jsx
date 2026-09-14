/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  The sealed card, and whose gross scores are on it.
// ══════════════════════════════════════════════════════════════════
//
// The closing round is played in the dark: neither side may learn the
// other's scores until the cards come back to the house and the room turns
// them over a hole at a time (src/lib/reveal.js).
//
// This card hid the things that COMPARE the two sides — the side's net row,
// the hole-won boxes, the running line, the nine's result — and went on
// printing every player's GROSS row underneath them. That was deliberate and
// it was right for the round it was written against: a 2v2 match IS one
// foursome, so the four men on the card walked it together and wrote all four
// of those rows themselves, and taking them back would be hiding numbers they
// typed an hour ago.
//
// Team Best Ball breaks it in half. Its match is the whole side across four
// tee waves — sixteen men on one card — so the eight on the other side are a
// different group on a different tee that this phone never saw. The card was
// handing over all eight of their cards, in full, on the one round of the
// year whose entire point is that nobody knows.
//
// So a match bigger than a foursome shows the reader's own side and nothing
// else on this sheet — `ownSideOnly`, set by the Scoring tab. Not tied to the
// reveal: this popup is the card the group keeps ON THE COURSE, and the
// detailed result of a finished round is read off the Leaderboard, which
// draws both sides in full once the round stops concealing. A rule with no
// timing in it cannot be got wrong by a lock state landing out of order.
//
// Both halves are pinned here, because either one alone is a card that is
// wrong: a 2v2 match IS its own foursome, and taking those rows away would be
// hiding numbers the four of them typed an hour ago.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { FullScorecard } from "./FullScorecard";
import { computeMatchResult } from "../scoring";
import { revealState } from "../lib/reveal";

afterEach(cleanup);

const PARS = Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
const courses = [{
  id: "c1", name: "Treetops", hole_pars: PARS, hole_handicaps: SI,
  tee_boxes: [{ name: "White", slope: 113, rating: 72, par: 72 }],
}];

// Scratch all round, so every net is its gross and nothing below turns on a
// handicap allocation.
// Distinct initials on purpose: the grid draws a man as his initials, so
// unique ones are what make the ROW ORDER readable off the rendered card.
const NAMES = {
  a1: "Aaron Jensen", a2: "Pete Carr", a3: "Andy Hill", a4: "Kevin Jones",
  b1: "Wes Long", b2: "Gil Ash", b3: "Tom Frye", b4: "Marty King",
};
const mk = (pid, team) => ({ player_id: pid, name: NAMES[pid], team, handicap_index: 0 });
const teamA = ["a1", "a2", "a3", "a4"];
const teamB = ["b1", "b2", "b3", "b4"];
const tPlayers = [...teamA.map(p => mk(p, "A")), ...teamB.map(p => mk(p, "B"))];

// A shoots 4s, B shoots 11s, so B's nine totals 99 — a number that appears
// nowhere else on this card, which is what gives "is B's card on screen" an
// exact answer instead of a guess at which 4 belongs to whom. Deliberately
// NOT 108: that is what A's own NET row comes to (best three of four 4s, nine
// times over), and a sentinel that collides with a number the reader IS
// entitled to see would fail this suite for the wrong reason.
const A_SHOT = 4, B_SHOT = 11, B_NINE = 99;
const holeData = {};
teamA.forEach(p => { holeData[`${p}_4`] = {}; for (let h = 0; h < 18; h++) holeData[`${p}_4`][h] = A_SHOT; });
teamB.forEach(p => { holeData[`${p}_4`] = {}; for (let h = 0; h < 18; h++) holeData[`${p}_4`][h] = B_SHOT; });

const round = {
  round_number: 4, format: "team_best_ball", course_id: "c1", tee_box: "White",
  handicap_mode: "full", scoring_type: "match", sealed: true, reveal_through: 0,
  counting_scores: { holes: [...Array(9).fill(3), ...Array(9).fill(3)] },
};
const match = { id: "m4", round: 4, teamA, teamB, scoring_type: "match" };

// `through: 0` is the state the round spends the whole afternoon in: sealed,
// and not one hole turned over yet.
const SEALED = { through: 0, side: "A" };

const card = (conceal, ownSideOnly = true, waves = null) => {
  const result = computeMatchResult(
    match, holeData, courses, [round], tPlayers, "team_best_ball", {}, undefined, {}, {},
  );
  return render(
    <FullScorecard
      match={match} result={result} format="team_best_ball"
      holePars={PARS} holeHcps={SI} course={courses[0]}
      tPlayers={tPlayers} viewer="A" conceal={conceal} ownSideOnly={ownSideOnly} waves={waves}
      getScore={(pid, h) => holeData[`${pid}_4`]?.[h] || 0}
    />,
  ).container;
};

const locks = (el) => el.querySelectorAll('[title="Sealed until the reveal"]').length;

describe("a card whose match is bigger than a foursome", () => {
  // The Scoring tab sets ownSideOnly for it. Nobody holding this phone wrote a
  // stroke of the other side's card — they are a different wave on a different
  // tee — so it is not on this sheet.
  it("does not print the other side's totals", () => {
    expect(card(SEALED).textContent).not.toContain(String(B_NINE));
  });

  it("still prints the reader's own side in full", () => {
    // A team is never hidden from itself — the line every surface in this app
    // draws. Four players, two nines, 36 apiece.
    expect(card(SEALED).textContent).toContain("36");
  });

  it("draws no rows for the other side at all, locked or otherwise", () => {
    // Not eighteen rows of padlocks. A row of nothing is furniture, not
    // information — so the side's four player rows and its NET row are simply
    // absent, and the card is shorter by exactly that much.
    const cells = (c) => c.querySelectorAll("div").length;
    expect(cells(card(SEALED))).toBeLessThan(cells(card(SEALED, false)));
    // One line a nine stands where they were, not ninety locks.
    expect(locks(card(SEALED))).toBe(2);
  });

  it("says which side is missing rather than leaving a gap", () => {
    expect(card(SEALED).textContent).toContain("SEALED UNTIL THE REVEAL");
  });

  it("states no running match either", () => {
    // The match cannot be stated with one side's card off the sheet, so the
    // MATCH row goes with it rather than printing padlocks under a gap.
    const text = card(SEALED).textContent;
    expect(text).not.toContain("▲");
    expect(text).not.toContain("▼");
  });
});

// ══════════════════════════════════════════════════════════════════
//  And it does not come back here when the round opens up
// ══════════════════════════════════════════════════════════════════
//
// The blackout lifts when every hole has been turned over AND the round is
// final — the countdown finished and the cup decided (isConcealing, in
// lib/reveal). That is when the LEADERBOARD draws both sides in full, which
// is where a finished round is read.
//
// This sheet is not that screen. It is the card the group keeps while they
// are playing, and the other side's eight men were never part of it, so it
// stays own-side-only through every one of those states. The card says so in
// as many words once there is nothing left to seal.
describe("the Scoring tab's card, at every state of the reveal", () => {
  const at = (over) => {
    const tr = { ...round, final: false, ...over };
    const seal = revealState([tr], 4);
    return card(seal.concealing ? { through: seal.through, side: "A" } : null);
  };
  const showsB = (over) => at(over).textContent.includes(String(B_NINE));

  it("withholds it while the countdown has not started", () => {
    expect(showsB({ reveal_through: 0 })).toBe(false);
  });

  it("withholds it part way through the countdown", () => {
    expect(showsB({ reveal_through: 12 })).toBe(false);
  });

  it("withholds it when the countdown is done but the cup is not", () => {
    // The hole everybody assumes is the finish line. The room has seen all
    // eighteen on the television and the round is still not in the books.
    expect(showsB({ reveal_through: 18, final: false })).toBe(false);
  });

  it("withholds it once the countdown is complete and the cup has a winner", () => {
    // The blackout is over — and this is still not the screen that answers it.
    expect(showsB({ reveal_through: 18, final: true })).toBe(false);
  });

  it("stops saying SEALED and points at the Leaderboard instead", () => {
    // Two reasons to be missing, two sentences. While the round is sealed the
    // lock says wait; afterwards the card is simply not where that answer
    // lives, and it says where it does.
    const open = at({ reveal_through: 18, final: true });
    expect(open.textContent).not.toContain("SEALED UNTIL THE REVEAL");
    expect(open.textContent).toContain("FULL CARD ON THE LEADERBOARD");
    expect(locks(open)).toBe(0);
  });

  it("never withholds the reader's own side at any of them", () => {
    [{ reveal_through: 0 }, { reveal_through: 12 }, { reveal_through: 18 },
     { reveal_through: 18, final: true }].forEach((over) => {
      expect(at(over).textContent).toContain("36");
    });
  });
});

// ══════════════════════════════════════════════════════════════════
//  The other shape: a sealed round whose match IS one foursome
// ══════════════════════════════════════════════════════════════════
describe("a sealed card whose two sides shared a foursome", () => {
  // ownSideOnly false: a 2v2 match is one foursome, so these four men wrote
  // all four of these rows between them. What the blackout owes them is what
  // the scores ADD UP TO, not the scores back.
  const foursome = (c) => card(c, false);

  it("keeps printing the opponents' gross rows", () => {
    expect(foursome(SEALED).textContent).toContain(String(B_NINE));
  });

  it("still withholds what those scores come to", () => {
    expect(foursome(SEALED).textContent).toContain("SEALED");
    expect(locks(foursome(SEALED))).toBeGreaterThan(0);
  });
});

describe("an unsealed card that is nobody's own side only", () => {
  it("prints both sides, and locks nothing", () => {
    // What the LEADERBOARD opens: no conceal, no ownSideOnly, the whole card.
    const el = card(null, false);
    expect(el.textContent).toContain(String(B_NINE));
    expect(locks(el)).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════
//  Grouped by the foursome that actually played together
// ══════════════════════════════════════════════════════════════════
//
// The Scoring tab draws one WAVE at a time — four men who walked together.
// The card behind it is the MATCH, so it holds every wave at once, and as a
// flat list of eight it put those four men four rows apart in an order that
// matched nothing anybody had seen. So it takes the waves and groups under
// them, labelled by the tee time they went off.
describe("a side that went off in waves", () => {
  // Deliberately NOT in roster order: a1 and a3 went off at 2:00 with two
  // men from later in the list, which is exactly the interleaving that made a
  // flat list unreadable.
  const waves = [
    { key: "w1", label: "2:00", pids: ["a3", "a1"] },
    { key: "w2", label: "2:10", pids: ["a4", "a2"] },
  ];
  const el = () => card(SEALED, true, waves);

  it("labels each wave with the time it went off", () => {
    const text = el().textContent;
    expect(text).toContain("2:00");
    expect(text).toContain("2:10");
  });

  // Where each thing lands in the rendered card, read off the first nine.
  const at = (needle) => el().textContent.indexOf(needle);

  it("puts each man under the wave he went off in", () => {
    // AJ and AH went off at 2:00; PC and KJ at 2:10. On a flat list they were
    // interleaved — AJ, PC, AH, KJ — which is the reading this fixes.
    expect(at("2:00")).toBeLessThan(at("AJ"));
    expect(at("AH")).toBeLessThan(at("2:10"));
    expect(at("2:10")).toBeLessThan(at("PC"));
  });

  it("orders a wave the way the Scoring tab orders it", () => {
    // The Scoring tab draws `match.teamA.filter(inUnit)` — the MATCH's roster
    // order, cut to the wave. The 2:00 wave is handed over here as [a3, a1]
    // and must still be drawn a1 (AJ) then a3 (AH), so the two screens can
    // never put the same four men in two different orders.
    expect(at("AJ")).toBeLessThan(at("AH"));
    expect(at("PC")).toBeLessThan(at("KJ"));
  });

  it("still counts the whole side, not the wave", () => {
    // Grouping is a layout. The NET row is the side's best N across every
    // wave, exactly as the engine scored it.
    expect(el().textContent).toContain("36");
  });

  it("keeps a man the draw never placed on the card", () => {
    const short = [{ key: "w1", label: "2:00", pids: ["a1", "a2"] }];
    const text = card(SEALED, true, short).textContent;
    expect(text).toContain("NOT ON THE TEE SHEET");
  });

  it("draws a flat list when there are no waves to group by", () => {
    // Every 1- and 2-man round: the match IS the foursome, so there is
    // nothing to group and no label row is spent on saying so.
    expect(card(SEALED, true, null).textContent).not.toContain("2:00");
  });
});
