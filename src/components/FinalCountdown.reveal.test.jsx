/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  The countdown's CONTROLS
// ══════════════════════════════════════════════════════════════════
//  FinalCountdown.test.jsx pins what the television draws. This file pins
//  what can make it draw — every door into the two reveal counters, and the
//  fact that there is exactly one of them per side.
//
//  The whole screen is a stray tap away from showing eight balls to fifteen
//  people, and there is no revert for a room that has already read a number.
//  So the questions here are deliberately paranoid ones: can the BACKGROUND
//  reveal, can the KEYBOARD reveal, can a captain reach the OTHER side's
//  counter, can the director walk the room past a man who has not spoken.
//  Every one of them has to come back no.
//
//  lib/reveal.test.js is the arithmetic underneath this; the component can
//  come apart from it, because it holds both sides' balls the whole time and
//  chooses which to draw and which button to arm.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { FinalCountdown } from "./FinalCountdown";
import { computeMatchResult } from "../scoring";

afterEach(cleanup);

// jsdom reports 1024×768, so the component reads it as a television.
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
const tPlayers = [
  { player_id: "a1", name: "Paul W", team: "A", handicap_index: 0 },
  { player_id: "a2", name: "Dave K", team: "A", handicap_index: 0 },
  { player_id: "a3", name: "Tim C", team: "A", handicap_index: 0 },
  { player_id: "b1", name: "Andy H", team: "B", handicap_index: 0 },
  { player_id: "b2", name: "Nick R", team: "B", handicap_index: 0 },
  { player_id: "b3", name: "Rudy T", team: "B", handicap_index: 0 },
];
const match = {
  id: "m4", round: 4, teamA: ["a1", "a2", "a3"], teamB: ["b1", "b2", "b3"],
  scoring_type: "points", hole_points: { front: 1, back: 1 },
};
const holeData = {};
Array.from({ length: 18 }, (_, h) => h).forEach((h) => {
  holeData.a1_4 = { ...(holeData.a1_4 || {}), [h]: 3 };
  holeData.a2_4 = { ...(holeData.a2_4 || {}), [h]: 4 };
  holeData.a3_4 = { ...(holeData.a3_4 || {}), [h]: 5 };
  holeData.b1_4 = { ...(holeData.b1_4 || {}), [h]: 4 };
  holeData.b2_4 = { ...(holeData.b2_4 || {}), [h]: 4 };
  holeData.b3_4 = { ...(holeData.b3_4 || {}), [h]: 5 };
});
const result = computeMatchResult(match, holeData, courses, tRounds, tPlayers, "team_best_ball", {}, undefined, {}, {});
const getScore = (pid, h) => holeData[`${pid}_4`]?.[h] || 0;

// Every call the screen can make, in the order it made them. `advanced` is
// the one that cannot be taken back — an entry in it is eight balls in front
// of the room.
const advanced = [];
const cleared = [];
const closed = [];
const screen = (reveal, extra = {}) => {
  advanced.length = 0;
  cleared.length = 0;
  closed.length = 0;
  return render(
    <FinalCountdown
      match={match} result={result} getScore={getScore}
      ownResult={result} ownGetScore={getScore}
      holePars={PARS} holeHcps={SI} tPlayers={tPlayers}
      teams={{ A: { id: "A", name: "Mash Brothers" }, B: { id: "B", name: "Shot Callers" } }}
      courseName="Treetops" formatLabel="Team Best Ball"
      reveal={reveal} totals={{ A: 3, B: 1 }} toWin={12.5} clincher={null}
      isDirector onAdvance={(s, n) => advanced.push([s, n])}
      onSetHole={(n) => cleared.push(n)}
      onClose={() => closed.push(true)}
      {...extra}
    />,
  ).container;
};

const DIRECTOR = {};
const CAPTAIN_A = { isDirector: false, captainSide: "A" };
const CAPTAIN_B = { isDirector: false, captainSide: "B" };
const SPECTATOR = { isDirector: false, captainSide: null };

const buttons = (c) => [...c.querySelectorAll("button")];
// The one door. A side's own button carries its team's name and the hole it
// would turn over — or says why it cannot ("WAITING ON …", "· ALL OUT").
const sideButtons = (c) => buttons(c)
  .filter((b) => /· HOLE \d+$|· ALL OUT$|^WAITING ON /.test(b.textContent));
const arrows = (c) => [...c.querySelectorAll(
  'button[aria-label="Next hole"], button[aria-label="Previous hole"]')];
const arrow = (c, dir) => c.querySelector(
  `button[aria-label="${dir === "next" ? "Next hole" : "Previous hole"}"]`);
const stripCell = (c, n) => buttons(c).concat([...c.querySelectorAll("div")])
  .filter((d) => d.textContent === String(n) && d.style.borderRadius?.startsWith("clamp(3px")).pop();

// ══════════════════════════════════════════════════════════════════
//  Who gets a button
// ══════════════════════════════════════════════════════════════════
//  `drives(side)` is the whole authorization model on this screen: a captain
//  drives his own side and nothing else, a director drives both, and everyone
//  else is watching a television. The security rules hold the same line from
//  the other end (captainRevealing in firestore.rules), so the screen never
//  draws a control whose write would be refused.
describe("who gets a reveal button", () => {
  it("gives a captain exactly one, and it is his own side's", () => {
    // Default width, which the component reads as a television — a captain
    // driving from a laptop has no card and so no preview step. One tap.
    const a = screen({ A: 1, B: 1 }, CAPTAIN_A);
    expect(sideButtons(a)).toHaveLength(1);
    expect(sideButtons(a)[0].textContent).toBe("REVEAL MASH BROTHERS · HOLE 2");
    expect(a.textContent).not.toContain("SHOT CALLERS · HOLE");
    cleanup();

    const b = screen({ A: 1, B: 1 }, CAPTAIN_B);
    expect(sideButtons(b)).toHaveLength(1);
    expect(sideButtons(b)[0].textContent).toBe("REVEAL SHOT CALLERS · HOLE 2");
    expect(b.textContent).not.toContain("MASH BROTHERS · HOLE");
  });

  it("gives the director both", () => {
    const c = screen({ A: 1, B: 1 }, DIRECTOR);
    expect(sideButtons(c).map((b) => b.textContent)).toEqual([
      "REVEAL MASH BROTHERS · HOLE 2",
      "REVEAL SHOT CALLERS · HOLE 2",
    ]);
  });

  it("gives a viewer who is neither none at all", () => {
    const c = screen({ A: 1, B: 1 }, SPECTATOR);
    expect(sideButtons(c)).toEqual([]);
    expect(arrows(c)).toEqual([]);
    expect(c.textContent).not.toContain("REVEAL");
    expect(c.textContent).toContain("THE CAPTAINS ARE DRIVING");
    // And the only button on the screen is the way out of it.
    expect(buttons(c).map((b) => b.textContent))
      .toEqual(["THE CAPTAINS ARE DRIVING · TAP TO EXIT"]);
  });

  // The television in the room is signed in as whoever was holding the
  // laptop. Without `onAdvance` nobody drives, whatever they are.
  it("gives nobody one when there is nothing to write with", () => {
    const c = screen({ A: 1, B: 1 }, { onAdvance: null, onSetHole: null });
    expect(sideButtons(c)).toEqual([]);
    expect(arrows(c)).toEqual([]);
    expect(c.textContent).toContain("THE CAPTAINS ARE DRIVING");
  });

  it("is the same on a phone, which is where a captain is standing", () => {
    setWidth(PHONE);
    const a = screen({ A: 1, B: 1 }, CAPTAIN_A);
    expect(sideButtons(a)).toHaveLength(1);
    // PREVIEW rather than REVEAL: on a phone his first tap opens his own card
    // and the second is the reveal. The question this test asks is WHO gets a
    // button, and he gets exactly one.
    expect(sideButtons(a)[0].textContent).toBe("PREVIEW MASH BROTHERS · HOLE 2");
    cleanup();
    expect(sideButtons(screen({ A: 1, B: 1 }, SPECTATOR))).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════
//  A captain moves HIS OWN counter and nothing else
// ══════════════════════════════════════════════════════════════════
describe("a captain cannot reach the other side", () => {
  it("turns over his own side, one hole, when he taps", () => {
    const c = screen({ A: 1, B: 1 }, CAPTAIN_A);
    fireEvent.click(sideButtons(c)[0]);
    expect(advanced).toEqual([["A", 2]]);
  });

  // Every control on the screen, swept. Nothing a captain can touch may ever
  // name the other side — not the button, not the strip, not the background.
  it("never names the other side, whatever he taps", () => {
    [CAPTAIN_A, CAPTAIN_B].forEach((who) => {
      const c = screen({ A: 4, B: 4 }, who);
      buttons(c).forEach((b) => fireEvent.click(b));
      [...c.querySelectorAll("div,span,img")].forEach((d) => fireEvent.click(d));
      advanced.forEach(([side]) => expect(side).toBe(who.captainSide));
      cleanup();
    });
  });

  // He has no business moving the other side and the rules would refuse it,
  // so the screen does not offer it: the strip is a director's rewind.
  it("gets no strip, no arrows and no cursor", () => {
    const c = screen({ A: 6, B: 6 }, CAPTAIN_A);
    expect(arrows(c)).toEqual([]);
    expect(stripCell(c, 3).tagName).toBe("DIV");
    fireEvent.click(stripCell(c, 3));
    expect(advanced).toEqual([]);
    expect(cleared).toEqual([]);
  });

  // One tap, one hole. The component reads the counters off its props, so a
  // second tap on a screen that has not heard back from Firestore must ask
  // for the SAME hole again rather than running on to the next one.
  it("asks for the same hole again rather than running ahead", () => {
    const c = screen({ A: 1, B: 1 }, CAPTAIN_A);
    const btn = sideButtons(c)[0];
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(advanced).toEqual([["A", 2], ["A", 2], ["A", 2]]);
  });

  // His side is a hole up and the other captain is talking. The button says
  // whose go it is rather than greying out silently — from where he is
  // standing "nothing happened" and "it isn't your go" are the same tap.
  it("is dead while his side is the one ahead", () => {
    const c = screen({ A: 2, B: 1 }, CAPTAIN_A);
    const btn = sideButtons(c)[0];
    expect(btn.textContent).toBe("WAITING ON SHOT CALLERS");
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(advanced).toEqual([]);
    // Hole 2 is on the television — his own side's balls are up on it — but
    // there is no CONTROL anywhere on his screen for the half of it the
    // other side still owes.
    expect(c.textContent).toContain("HOLE 2");
    expect(sideButtons(c)).toHaveLength(1);
    expect(buttons(c).map((b) => b.textContent).join(" | ")).not.toContain("HOLE 2");
  });

  it("has nothing left once his side is out", () => {
    const c = screen({ A: 18, B: 17 }, CAPTAIN_A);
    const btn = sideButtons(c)[0];
    expect(btn.textContent).toBe("MASH BROTHERS · ALL OUT");
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(advanced).toEqual([]);
  });

  // ── His BACK is his own side's, or nobody's ─────────────────────
  // One step back, for the mistap. It takes the side that just moved — and a
  // captain can only ever be that side if it is his.
  it("steps his own side back and refuses to step the other one", () => {
    // A is the side that just moved, and A is his.
    const mine = screen({ A: 7, B: 6 }, CAPTAIN_A);
    fireEvent.click(buttons(mine).find((b) => b.textContent === "◀"));
    expect(advanced).toEqual([["A", 6]]);
    cleanup();
    // Same board, the other captain. The step that just happened was not his,
    // so his BACK does nothing at all rather than walking A backwards.
    const theirs = screen({ A: 7, B: 6 }, CAPTAIN_B);
    fireEvent.click(buttons(theirs).find((b) => b.textContent === "◀"));
    expect(advanced).toEqual([]);
    expect(cleared).toEqual([]);
  });

  it("cannot step anything back before the first hole", () => {
    const c = screen({ A: 0, B: 0 }, CAPTAIN_A);
    const back = buttons(c).find((b) => b.textContent === "◀");
    expect(back.disabled).toBe(true);
    fireEvent.click(back);
    expect(advanced).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════
//  A reveal has exactly ONE door
// ══════════════════════════════════════════════════════════════════
//  The whole screen used to be one tap target. On the one screen in this app
//  where a stray tap cannot be taken back that is the wrong convenience — a
//  phone in a pocket, a trackpad brushed while somebody reaches past the
//  laptop, a hand steadying the machine on a table. Any of them put eight
//  balls in front of the room before the captain had said a word.
describe("the background is not a tap target", () => {
  const shellOf = (c) => c.firstChild;

  it("reveals nothing when the shell itself is clicked", () => {
    [DIRECTOR, CAPTAIN_A, CAPTAIN_B, SPECTATOR].forEach((who) => {
      const c = screen({ A: 3, B: 3 }, who);
      fireEvent.click(shellOf(c));
      fireEvent.mouseDown(shellOf(c));
      fireEvent.mouseUp(shellOf(c));
      fireEvent.touchStart(shellOf(c));
      fireEvent.touchEnd(shellOf(c));
      expect(advanced).toEqual([]);
      expect(cleared).toEqual([]);
      cleanup();
    });
  });

  // Every element on the page that is not a button, on both layouts and on
  // every interesting board state. If any of them reveals, the room finds out
  // the hard way and nobody knows what they touched.
  it("reveals nothing when anything that is not a button is clicked", () => {
    [TV, PHONE].forEach((w) => {
      [{ A: 0, B: 0 }, { A: 1, B: 0 }, { A: 7, B: 7 }, { A: 7, B: 7, cursor: 8 }, { A: 18, B: 18 }]
        .forEach((reveal) => {
          setWidth(w);
          const c = screen(reveal, DIRECTOR);
          [...c.querySelectorAll("*")]
            .filter((d) => d.tagName !== "BUTTON")
            .forEach((d) => fireEvent.click(d));
          expect(advanced).toEqual([]);
          expect(cleared).toEqual([]);
          cleanup();
        });
    });
  });

  // The strip cells are the exception worth stating: a director's cells ARE
  // buttons, but only the ones BEHIND the hole on screen. Everything forward
  // of it is an inert div, which is what stops a mistap on 18 ending the
  // tournament in one press.
  it("leaves every hole ahead of the room inert, even for a director", () => {
    const c = screen({ A: 6, B: 6 }, DIRECTOR);
    [6, 7, 8, 12, 17, 18].forEach((n) => {
      expect(stripCell(c, n).tagName).toBe("DIV");
      fireEvent.click(stripCell(c, n));
    });
    expect(advanced).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════
//  The keyboard moves the ROOM, and cannot reveal
// ══════════════════════════════════════════════════════════════════
//  A director driving from a laptop should not have to reach for a trackpad
//  between every hole, so the keyboard keeps the PACING — clear the board,
//  take the clear back. Neither of those shows anything that was not already
//  on screen. Nothing on a keyboard may reach `onAdvance`.
describe("the keyboard", () => {
  const FORWARD = [" ", "ArrowRight", "Enter", "PageDown"];
  const BACKWARD = ["ArrowLeft", "PageUp"];
  const ALL = [...FORWARD, ...BACKWARD];

  it("clears the board with the forward keys, and turns over nothing", () => {
    FORWARD.forEach((key) => {
      screen({ A: 7, B: 7 }, DIRECTOR);
      fireEvent.keyDown(window, { key });
      // One call, to onSetHole, naming the next hole — and not one to the
      // handler that turns a side over.
      expect(cleared).toEqual([8]);
      expect(advanced).toEqual([]);
      cleanup();
    });
  });

  it("takes the clear back with the backward keys, and turns over nothing", () => {
    BACKWARD.forEach((key) => {
      screen({ A: 7, B: 7, cursor: 8 }, DIRECTOR);
      fireEvent.keyDown(window, { key });
      expect(cleared).toEqual([7]);
      expect(advanced).toEqual([]);
      cleanup();
    });
  });

  // The load-bearing one, asked from every seat and every board state. There
  // is no key on a keyboard that turns a side over.
  it("never reveals a side, from any seat, on any board", () => {
    [DIRECTOR, CAPTAIN_A, CAPTAIN_B, SPECTATOR].forEach((who) => {
      [{ A: 0, B: 0 }, { A: 1, B: 0 }, { A: 7, B: 6 }, { A: 7, B: 7 },
        { A: 7, B: 7, cursor: 8 }, { A: 17, B: 17 }, { A: 18, B: 17 }, { A: 18, B: 18 }]
        .forEach((reveal) => {
          screen(reveal, who);
          ALL.forEach((key) => fireEvent.keyDown(window, { key }));
          expect(advanced).toEqual([]);
          cleanup();
        });
    });
  });

  // It is a DIRECTOR'S control, like the arrows it stands in for. A captain's
  // keyboard moves nothing — the room's pacing is not his to drive.
  it("moves nothing at all for a captain or a spectator", () => {
    [CAPTAIN_A, CAPTAIN_B, SPECTATOR].forEach((who) => {
      screen({ A: 7, B: 7 }, who);
      ALL.forEach((key) => fireEvent.keyDown(window, { key }));
      expect(cleared).toEqual([]);
      expect(advanced).toEqual([]);
      cleanup();
    });
  });

  // The same gate the ▶ arrow is behind: advancing past a side that has not
  // spoken would skip its eight balls and they would never come back.
  it("will not clear past a captain who has not spoken", () => {
    screen({ A: 7, B: 6 }, DIRECTOR);
    FORWARD.forEach((key) => fireEvent.keyDown(window, { key }));
    expect(cleared).toEqual([]);
    expect(advanced).toEqual([]);
  });

  it("will not clear a board that is already clear", () => {
    screen({ A: 7, B: 7, cursor: 8 }, DIRECTOR);
    FORWARD.forEach((key) => fireEvent.keyDown(window, { key }));
    expect(cleared).toEqual([]);
    expect(advanced).toEqual([]);
  });

  it("will not take back a clear that a captain has revealed into", () => {
    screen({ A: 8, B: 7, cursor: 8 }, DIRECTOR);
    BACKWARD.forEach((key) => fireEvent.keyDown(window, { key }));
    expect(cleared).toEqual([]);
    expect(advanced).toEqual([]);
  });

  it("runs off the end of the card at neither end", () => {
    screen({ A: 18, B: 18 }, DIRECTOR);
    FORWARD.forEach((key) => fireEvent.keyDown(window, { key }));
    expect(cleared).toEqual([]);
    cleanup();
    // And nothing to take back before the first hole.
    screen({ A: 0, B: 0 }, DIRECTOR);
    BACKWARD.forEach((key) => fireEvent.keyDown(window, { key }));
    expect(cleared).toEqual([]);
    expect(advanced).toEqual([]);
  });

  it("leaves Escape as the way out and nothing more", () => {
    screen({ A: 7, B: 7 }, DIRECTOR);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(closed).toEqual([true]);
    expect(advanced).toEqual([]);
    expect(cleared).toEqual([]);
  });

  it("ignores every other key", () => {
    screen({ A: 7, B: 7 }, DIRECTOR);
    ["a", "1", "Tab", "ArrowUp", "ArrowDown", "Home", "End", "Backspace", "Delete"]
      .forEach((key) => fireEvent.keyDown(window, { key }));
    expect(advanced).toEqual([]);
    expect(cleared).toEqual([]);
    expect(closed).toEqual([]);
  });

  it("stops listening once the countdown is closed", () => {
    screen({ A: 7, B: 7 }, DIRECTOR);
    cleanup();
    fireEvent.keyDown(window, { key: " " });
    expect(cleared).toEqual([]);
    expect(advanced).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════
//  NEXT waits for both captains
// ══════════════════════════════════════════════════════════════════
describe("the director's ▶", () => {
  it("is dark until both sides have told the hole on screen", () => {
    const half = screen({ A: 7, B: 6 }, DIRECTOR);
    expect(arrow(half, "next").disabled).toBe(true);
    fireEvent.click(arrow(half, "next"));
    expect(cleared).toEqual([]);
    cleanup();

    const both = screen({ A: 7, B: 7 }, DIRECTOR);
    expect(arrow(both, "next").disabled).toBe(false);
    fireEvent.click(arrow(both, "next"));
    expect(cleared).toEqual([8]);
    expect(advanced).toEqual([]);
  });

  it("is dark either way round", () => {
    expect(arrow(screen({ A: 6, B: 7 }, DIRECTOR), "next").disabled).toBe(true);
  });

  // The splash. Both sides have "reached" hole 0 because there is no hole 0
  // to tell, so the pure state machine would allow a clear onto hole 1 — the
  // SCREEN is the stricter of the two and holds the opening card until a
  // captain speaks. Either way nothing is turned over; see the note on
  // canAdvanceHole in lib/reveal.test.js.
  it("is not on the opening card at all", () => {
    const c = screen({ A: 0, B: 0 }, DIRECTOR);
    expect(arrows(c)).toEqual([]);
    expect(c.textContent).toContain("THE FINAL COUNTDOWN");
    // Nor from the keyboard, which is the same control by another route.
    [" ", "ArrowRight", "Enter", "PageDown"].forEach((key) => fireEvent.keyDown(window, { key }));
    expect(cleared).toEqual([]);
    expect(advanced).toEqual([]);
  });

  it("is dark on a board that is already cleared", () => {
    const c = screen({ A: 7, B: 7, cursor: 8 }, DIRECTOR);
    expect(arrow(c, "next").disabled).toBe(true);
    fireEvent.click(arrow(c, "next"));
    expect(cleared).toEqual([]);
  });

  it("has nothing left on the eighteenth", () => {
    const c = screen({ A: 18, B: 18 }, DIRECTOR);
    expect(arrow(c, "next").disabled).toBe(true);
    fireEvent.click(arrow(c, "next"));
    expect(cleared).toEqual([]);
  });

  it("moves exactly one hole, every time", () => {
    const c = screen({ A: 7, B: 7 }, DIRECTOR);
    fireEvent.click(arrow(c, "next"));
    fireEvent.click(arrow(c, "next"));
    // The props have not moved, so neither has the ask. It is never 9.
    expect(cleared).toEqual([8, 8]);
  });

  it("belongs to the director alone", () => {
    [CAPTAIN_A, CAPTAIN_B, SPECTATOR].forEach((who) => {
      expect(arrows(screen({ A: 7, B: 7 }, who))).toEqual([]);
      cleanup();
    });
    // And to nobody at all without a cursor to write.
    expect(arrows(screen({ A: 7, B: 7 }, { onSetHole: null }))).toEqual([]);
  });
});

// BACK is the undo of NEXT and nothing else. It can never un-reveal a hole
// the room has already watched — that is a different act, and the reveal
// buttons and the strip are what do it.
describe("the director's ◀", () => {
  it("takes back a clear", () => {
    const c = screen({ A: 7, B: 7, cursor: 8 }, DIRECTOR);
    expect(arrow(c, "back").disabled).toBe(false);
    fireEvent.click(arrow(c, "back"));
    expect(cleared).toEqual([7]);
    expect(advanced).toEqual([]);
  });

  it("is dark once a captain has revealed into the new hole", () => {
    const c = screen({ A: 8, B: 7, cursor: 8 }, DIRECTOR);
    expect(arrow(c, "back").disabled).toBe(true);
    fireEvent.click(arrow(c, "back"));
    expect(cleared).toEqual([]);
    expect(advanced).toEqual([]);
  });

  it("is dark when there is no clear to undo", () => {
    expect(arrow(screen({ A: 7, B: 7 }, DIRECTOR), "back").disabled).toBe(true);
    cleanup();
    expect(arrow(screen({ A: 7, B: 6 }, DIRECTOR), "back").disabled).toBe(true);
    cleanup();
    // The opening card carries no arrows at all — there is no hole yet to be
    // on, and nothing behind it to go back to.
    expect(arrows(screen({ A: 0, B: 0 }, DIRECTOR))).toEqual([]);
  });

  // The row's own ◀ is a different control: it undoes the CLEAR first, and
  // only once there is no clear left does it un-reveal anything.
  it("undoes the clear before it un-reveals anything", () => {
    const c = screen({ A: 7, B: 7, cursor: 8 }, DIRECTOR);
    fireEvent.click(buttons(c).find((b) => b.textContent === "◀" && !b.getAttribute("aria-label")));
    expect(cleared).toEqual([7]);
    expect(advanced).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════
//  The strip rewinds, and it takes the room with it
// ══════════════════════════════════════════════════════════════════
//  A cell is a control only if it is BEHIND the hole on screen, so the strip
//  can repair a mistap and can never fast-forward. What it has to do as well
//  is bring the CURSOR back — the hole on screen is max(cursor, revealed), so
//  a rewind that left a cursor sitting out in front would put the room on an
//  empty hole it had not asked for and could not see anything on.
describe("the strip's rewind", () => {
  it("takes both counters back to the hole tapped", () => {
    const c = screen({ A: 6, B: 6 }, DIRECTOR);
    fireEvent.click(stripCell(c, 3));
    expect(advanced).toEqual([[null, 3]]);
  });

  it("brings the room back with them", () => {
    // The director has used ▶ at least once, so a cursor exists. Without
    // moving it too, tapping 3 leaves the television on hole 7 with nothing
    // on it — max(cursor, revealed) is still 7 — and the rewind silently does
    // nothing the room can see.
    const c = screen({ A: 6, B: 6, cursor: 7 }, DIRECTOR);
    fireEvent.click(stripCell(c, 3));
    expect(advanced).toEqual([[null, 3]]);
    expect(cleared).toEqual([3]);
  });

  it("is still only ever backwards", () => {
    const c = screen({ A: 6, B: 6, cursor: 7 }, DIRECTOR);
    // Hole 7 is the cleared board itself and 8 is past it; neither is a
    // control, so neither can be jumped to.
    expect(stripCell(c, 7).tagName).toBe("DIV");
    expect(stripCell(c, 8).tagName).toBe("DIV");
    fireEvent.click(stripCell(c, 7));
    fireEvent.click(stripCell(c, 8));
    expect(advanced).toEqual([]);
    expect(cleared).toEqual([]);
  });

  it("stays a director's control with a cursor in play", () => {
    [CAPTAIN_A, CAPTAIN_B, SPECTATOR].forEach((who) => {
      const c = screen({ A: 6, B: 6, cursor: 7 }, who);
      expect(stripCell(c, 3).tagName).toBe("DIV");
      fireEvent.click(stripCell(c, 3));
      expect(advanced).toEqual([]);
      expect(cleared).toEqual([]);
      cleanup();
    });
  });
});

// ══════════════════════════════════════════════════════════════════
//  What the room can see while a captain still has it to tell
// ══════════════════════════════════════════════════════════════════
//  The controls are only half of it. A hole that is half turned over must
//  draw half — the component holds both sides' balls from the first render
//  and the guard is what it puts on screen.
describe("a hole the other captain still owes", () => {
  it("is on screen for the side that spoke and blank for the side that has not", () => {
    const t = screen({ A: 4, B: 3 }, DIRECTOR).textContent;
    expect(t).toContain("HOLE 4");
    expect(t).toContain("Paul W");
    expect(t).not.toContain("Andy H");
    // One side is still owed. It used to be checked by the label naming the
    // team — "SHOT CALLERS TO TELL IT" — under a card already set in that
    // team's name and colour. The label says TO REVEAL now and nothing else,
    // so the count is what tells the two apart, which is the sturdier test:
    // it is the SIDE that is blank, not the wording.
    expect(t.split("TO REVEAL").length - 1).toBe(1);
  });

  // A cleared board shows neither, whoever is looking at it.
  it("is blank on both sides once the director has cleared it", () => {
    [DIRECTOR, CAPTAIN_A, SPECTATOR].forEach((who) => {
      const t = screen({ A: 7, B: 7, cursor: 8 }, who).textContent;
      expect(t).toContain("HOLE 8");
      expect(t).not.toContain("Paul W");
      expect(t).not.toContain("Andy H");
      cleanup();
    });
  });

  // The cursor is the layout and nothing else: it can only ever show LESS.
  it("shows no more with a cursor than without one", () => {
    const withCursor = screen({ A: 7, B: 7, cursor: 8 }, DIRECTOR).textContent;
    cleanup();
    const without = screen({ A: 7, B: 7 }, DIRECTOR).textContent;
    ["Paul W", "Dave K", "Tim C", "Andy H", "Nick R", "Rudy T"].forEach((name) => {
      if (!without.includes(name)) expect(withCursor).not.toContain(name);
    });
  });
});
