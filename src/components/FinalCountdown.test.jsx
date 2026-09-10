/** @vitest-environment jsdom */
// ── The countdown, turned over a side at a time ─────────────────────
// The screen the whole evening is built around, and the one place in the app
// where drawing a number one beat early cannot be taken back. lib/reveal pins
// the arithmetic; this pins what the television actually SHOWS on the far side
// of it — which can come apart from the arithmetic, because the component has
// both sides' balls in hand the whole time and chooses which to draw.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { FinalCountdown } from "./FinalCountdown";
import { computeMatchResult } from "../scoring";

afterEach(cleanup);

// jsdom reports 1024×768, so the component reads it as a television. These
// two set the width the same way a real device does, and fire the resize the
// hook listens for.
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

// Two men a side so the counted/missed split is visible: A's low pair make the
// number and the other two do not.
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
// A: a birdie, a par and a bogey. B: three pars. A takes every hole.
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

const advanced = [];
const screen = (reveal, extra = {}) => {
  advanced.length = 0;
  return render(
    <FinalCountdown
      match={match} result={result} getScore={getScore}
      ownResult={result} ownGetScore={getScore}
      holePars={PARS} holeHcps={SI} tPlayers={tPlayers}
      teams={{ A: { id: "A", name: "Mash Brothers" }, B: { id: "B", name: "Shot Callers" } }}
      courseName="Treetops" formatLabel="Team Best Ball"
      reveal={reveal} totals={{ A: 3, B: 1 }} toWin={12.5} clincher={null}
      isDirector onAdvance={(s, n) => advanced.push([s, n])} onClose={() => {}}
      {...extra}
    />,
  ).container;
};

describe("a hole half turned over", () => {
  it("shows the side that has spoken and not the one that hasn't", () => {
    // A has hole 1; B does not. A's balls are on screen; B's are not.
    const t = screen({ A: 1, B: 0 }).textContent;
    expect(t).toContain("HOLE 1");
    expect(t).toContain("Paul W");
    expect(t).not.toContain("Andy H");
    expect(t).toContain("SHOT CALLERS TO TELL IT");
  });

  // The one thing the screen must never do early. Both sides' numbers are in
  // the component's hands from the first render — the guard is what it DRAWS.
  //
  // There is no verdict BAND any more, so this asks the two things that still
  // say who took the hole: the winning column lights up in its own colour, and
  // the strip fills that hole in. Neither may happen on half a hole.
  it("marks no winner until both captains have spoken", () => {
    // A strip cell is a <button> for a director (it jumps the reveal) and a
    // <div> for everybody else, so this asks for either.
    const cell = (c, n) => [...c.querySelectorAll("div,button")].filter(d => d.textContent === String(n)).pop();
    expect(cell(screen({ A: 1, B: 0 }), 1).style.background).toBe("transparent");
    cleanup();
    expect(cell(screen({ A: 1, B: 1 }), 1).style.background).not.toBe("transparent");
  });

  // It read "SHOT CALLERS TAKE IT · 1 POINT" across a band of its own — the
  // third place on this screen saying one fact, and the only one of the three
  // that cost a whole row of height.
  it("has no hole-verdict band at all", () => {
    const t = screen({ A: 1, B: 1 }).textContent;
    expect(t).not.toContain("TAKE IT");
    expect(t).not.toContain("EACH");
    expect(t).not.toContain("NO RESULT ON THIS HOLE");
    // The hole's point value still rides in the terms line under HOLE 1,
    // where it belongs — that is what the hole is worth, not who won it.
    expect(t).toContain("1 POINT");
  });

  // Not the same fact. "Who took the hole" happens eighteen times; "the cup is
  // won" happens once, and it is the moment the evening is built around.
  it("still gives the clinch a band of its own", () => {
    const t = screen({ A: 1, B: 1 }, { clincher: "A" }).textContent;
    expect(t).toContain("WIN THE BOURBON CUP");
    // And not before both captains have spoken on the hole it lands.
    cleanup();
    expect(screen({ A: 1, B: 0 }, { clincher: "A" }).textContent).not.toContain("WIN THE BOURBON CUP");
  });

  it("names the balls that made the number and dims the ones that didn't", () => {
    const t = screen({ A: 1, B: 1 }).textContent;
    // Best 2 of 3: Paul and Dave count, Tim does not — but he is still named,
    // because on this format that is half the conversation in the room.
    expect(t).toContain("Paul W");
    expect(t).toContain("Dave K");
    expect(t).toContain("Tim C");
  });
});

// ── The grid ────────────────────────────────────────────────────────
// Eight men, four across and two down, alphabetical, every hole for eighteen
// holes. It used to be two flex rows sized to their contents — counted on top,
// missed underneath — so a man moved between rows depending on how he putted,
// and the room re-read eight names every hole. Position is constant now and
// the highlight carries all of the meaning.
describe("the side's grid", () => {
  const namesIn = (container, side) => {
    // The chips carry a name and a number; the names are the only all-caps-
    // free text in them. Read them in DOM order, which is render order.
    const col = container.querySelectorAll("div");
    const roster = side === "A" ? ["Paul W", "Dave K", "Tim C"] : ["Andy H", "Nick R", "Rudy T"];
    const seen = [];
    col.forEach((d) => {
      const t = d.textContent;
      roster.forEach((n) => {
        if (t === n && !seen.includes(n)) seen.push(n);
      });
    });
    return seen;
  };

  it("draws every man on the side, counted or not", () => {
    const t = screen({ A: 1, B: 1 }).textContent;
    ["Paul W", "Dave K", "Tim C"].forEach((n) => expect(t).toContain(n));
  });

  it("puts them in alphabetical order, not roster order", () => {
    // The roster is Paul, Dave, Tim. Alphabetically it is Dave, Paul, Tim —
    // and it has to be the same order on hole 18 as on hole 1.
    const c = screen({ A: 1, B: 1 });
    expect(namesIn(c, "A")).toEqual(["Dave K", "Paul W", "Tim C"]);
  });

  it("keeps a man in the same place when his ball stops counting", () => {
    // Hole 1 and hole 2 are scored identically here, but the order must not
    // depend on the scoring at all — that is the whole point of the fixed grid.
    const first = namesIn(screen({ A: 1, B: 1 }), "A");
    cleanup();
    const later = namesIn(screen({ A: 9, B: 9 }), "A");
    expect(later).toEqual(first);
  });
});

// ── What a chip says, and what it stopped saying ────────────────────
describe("the chip", () => {
  it("shows the net score and not the gross", () => {
    // a1 is a gross 3 with no strokes, a3 a gross 5. Both are on screen as
    // net. What must NOT be there is the "(5)" that used to ride beside them:
    // two numbers on a postage stamp, in a room.
    const t = screen({ A: 1, B: 1 }).textContent;
    expect(t).not.toMatch(/\(\d\)/);
  });

  it("leaves a ball that missed the cut legible", () => {
    // It used to sit at opacity 0.42, which from twelve feet is a number you
    // cannot read — and on this format "you didn't count" is half the
    // conversation in the room. The ring and the tint say who made the number.
    const c = screen({ A: 1, B: 1 });
    const chips = [...c.querySelectorAll("div")].filter(d => d.style.borderRadius?.startsWith("clamp(5px"));
    expect(chips.length).toBeGreaterThan(0);
    chips.forEach(d => expect(d.style.opacity === "" || Number(d.style.opacity) >= 1).toBe(true));
  });
});

// ── The side's number ───────────────────────────────────────────────
// Against par, not a raw total. Nobody in the room knows that six pars on
// this hole is 24; they all know what −3 is.
describe("the side's number", () => {
  it("is relative to par, measured against the balls that counted", () => {
    // Best 2 of 3 on a par 4. A is net 3 + 4 against two pars — one under.
    // B is 4 + 4 — level.
    const t = screen({ A: 1, B: 1 }).textContent;
    expect(t).toContain("−1");
    expect(t).toContain("E");
    // The raw totals are gone: 7 and 8 are not on the screen as side scores.
    expect(result.holes[0].aScore).toBe(7);
    expect(t).not.toContain("Mash Brothers7");
  });

  it("says nothing for a side whose captain has not spoken", () => {
    const t = screen({ A: 1, B: 0 }).textContent;
    expect(t).toContain("SHOT CALLERS TO TELL IT");
  });
});

// ── Stroke dots ─────────────────────────────────────────────────────
// The big number on a chip is a NET score, and the dots are the only thing
// that says so. A room looking at a net 2 wants to know whether that was an
// eagle or two shots. They used to be a bullet crammed inside the gross
// parenthetical — "(5•)" — at the smallest type on the screen, read from
// twelve feet away.
describe("stroke dots", () => {
  const dots = (container) =>
    [...container.querySelectorAll("*")].filter(d => d.style?.borderRadius === "50%").length;

  it("draws one per stroke on the man who got them", () => {
    // Full handicaps off a neutral tee, so a Course Handicap of 18 is one
    // stroke on every hole and 0 is none.
    const shots = tPlayers.map(p => (p.player_id === "a1" ? { ...p, handicap_index: 18 } : p));
    const r = computeMatchResult(match, holeData, courses, tRounds, shots, "team_best_ball", {}, undefined, {}, {});
    const c = render(
      <FinalCountdown
        match={match} result={r} getScore={getScore} ownResult={r} ownGetScore={getScore}
        holePars={PARS} holeHcps={SI} tPlayers={shots}
        teams={{ A: { id: "A", name: "Mash Brothers" }, B: { id: "B", name: "Shot Callers" } }}
        courseName="Treetops" formatLabel="Team Best Ball"
        reveal={{ A: 1, B: 1 }} totals={{ A: 1, B: 1 }} toWin={12.5} clincher={null}
        isDirector onAdvance={() => {}} onClose={() => {}}
      />,
    ).container;
    expect(r.strokeMaps.a1[0]).toBe(1);
    expect(dots(c)).toBe(1);
  });

  it("draws none at all when nobody is getting a shot", () => {
    // Every index is 0 in the base fixture.
    expect(dots(screen({ A: 1, B: 1 }))).toBe(0);
  });
});

// ── The eighteen ────────────────────────────────────────────────────
// Coloured by who WON, and by nothing else: a team's colour, grey for a tie,
// hollow for a hole not turned over. The tie used to be a diagonal in both
// teams' colours, which from the back of a room read as a loading bar rather
// than a scoreboard.
describe("the hole strip", () => {
  // A strip cell is a <button> for a director and a <div> otherwise.
  const cell = (container, n) =>
    [...container.querySelectorAll("div,button")].filter(d => d.textContent === String(n)).pop();

  it("paints a won hole in the winning side's colour", () => {
    // A takes every hole in this fixture.
    const c = screen({ A: 3, B: 3 });
    expect(cell(c, 1).style.background).toBeTruthy();
    expect(cell(c, 1).style.background).not.toBe("transparent");
  });

  it("paints a tied hole grey, and not in two colours", () => {
    // Same score both sides on hole 1 — played, no winner.
    const level = {};
    Object.keys(holeData).forEach((k) => { level[k] = { ...holeData[k] }; });
    ["a1", "a2", "a3", "b1", "b2", "b3"].forEach((pid) => { level[`${pid}_4`][0] = 4; });
    const levelResult = computeMatchResult(
      { ...match }, level, courses, tRounds, tPlayers, "team_best_ball", {}, undefined, {}, {},
    );
    const c = render(
      <FinalCountdown
        match={match} result={levelResult} getScore={(pid, h) => level[`${pid}_4`]?.[h] || 0}
        ownResult={levelResult} ownGetScore={(pid, h) => level[`${pid}_4`]?.[h] || 0}
        holePars={PARS} holeHcps={SI} tPlayers={tPlayers}
        teams={{ A: { id: "A", name: "Mash Brothers" }, B: { id: "B", name: "Shot Callers" } }}
        courseName="Treetops" formatLabel="Team Best Ball"
        reveal={{ A: 3, B: 3 }} totals={{ A: 1, B: 1 }} toWin={12.5} clincher={null}
        isDirector onAdvance={() => {}} onClose={() => {}}
      />,
    ).container;
    const bg = cell(c, 1).style.background;
    expect(levelResult.holes[0].winner).toBe(null);
    expect(bg).not.toContain("gradient");
    expect(bg).toBeTruthy();
  });

  it("leaves a hole nobody has turned over hollow", () => {
    const c = screen({ A: 3, B: 3 });
    expect(cell(c, 12).style.background).toBe("transparent");
  });

  // A hole with one captain still to speak has no winner, so it cannot be
  // coloured — the strip counts what is wholly out, not what is on screen.
  it("does not colour the hole in play", () => {
    const c = screen({ A: 4, B: 3 });
    expect(cell(c, 4).style.background).toBe("transparent");
  });
});

describe("whose tap it is", () => {
  it("offers both sides on a fresh hole", () => {
    const t = screen({ A: 1, B: 1 }).textContent;
    expect(t).toContain("REVEAL MASH BROTHERS · HOLE 2");
    expect(t).toContain("REVEAL SHOT CALLERS · HOLE 2");
  });

  // One hole, both stories, next hole. A side that ran ahead would leave the
  // other tapping through holes nobody in the room could see.
  it("holds the side that is a hole up", () => {
    const t = screen({ A: 2, B: 1 }).textContent;
    expect(t).toContain("WAITING ON SHOT CALLERS");
    expect(t).toContain("REVEAL SHOT CALLERS · HOLE 2");
    expect(t).not.toContain("REVEAL MASH BROTHERS");
  });

  it("advances the side that was tapped, and only that side", () => {
    const c = screen({ A: 1, B: 1 });
    fireEvent.click([...c.querySelectorAll("button")].find(b => b.textContent.includes("SHOT CALLERS · HOLE 2")));
    expect(advanced).toEqual([["B", 2]]);
  });

  it("refuses a tap from a side that is already ahead", () => {
    const c = screen({ A: 2, B: 1 });
    const held = [...c.querySelectorAll("button")].find(b => b.textContent.includes("WAITING ON"));
    fireEvent.click(held);
    expect(advanced).toEqual([]);
  });
});

describe("a captain's phone", () => {
  const captain = { isDirector: false, captainSide: "A" };

  it("gives him one button and it is his own side's", () => {
    const t = screen({ A: 1, B: 1 }, captain).textContent;
    expect(t).toContain("REVEAL MASH BROTHERS · HOLE 2");
    expect(t).not.toContain("REVEAL SHOT CALLERS");
  });

  // The whole reason his phone has the hole before the room does: he is
  // reading it out. It is his OWN side, which is never hidden from him.
  it("tells him what to say before he taps", () => {
    const t = screen({ A: 1, B: 1 }, captain).textContent;
    expect(t).toContain("HOLE 2 · PAR 4");
    expect(t).toContain("Mash Brothers −1");   // birdie + par against two pars
    expect(t).toContain("Net birdie — Paul W");
  });

  // A net bogey is never read out — see lib/countdownPrompt for why.
  it("never names the man who made the bogey", () => {
    const t = screen({ A: 1, B: 1 }, captain).textContent;
    const band = t.slice(t.indexOf("HOLE 2 · PAR 4"));
    expect(band).not.toContain("Tim C");
  });

  it("names his side rather than calling it his", () => {
    const t = screen({ A: 1, B: 1 }, captain).textContent;
    expect(t).toContain("Mash Brothers −1");
    expect(t).not.toContain("YOUR SIDE");
    // And no "YOU'RE UP" — his phone put the card up, it is his side's
    // colour, and the button under it has his team's name on it.
    expect(t).not.toContain("UP · HOLE");
  });

  // ── The window the nuggets may look at ──────────────────────────
  // His phone holds his side's ENTIRE round, uncut, because a team is never
  // hidden from itself. The nuggets may only see the holes already turned
  // over — otherwise "the first net eagle of the round" on hole 2 is quietly a
  // promise that no eagle is coming, on an evening built on nobody knowing.
  it("compiles a nugget only from holes the room has seen", () => {
    // Every hole in this fixture is identical: a1 nets a birdie on all
    // eighteen. On hole 2 that is his SECOND in a row and the card says so.
    const t = screen({ A: 1, B: 1 }, captain).textContent;
    expect(t).toContain("Paul W — two in a row");
    cleanup();
    // On hole 1 there is no history at all, so there is no run to call —
    // even though holes 2 through 18 are sitting in the same object.
    expect(screen({ A: 0, B: 0 }, captain).textContent).not.toContain("in a row");
  });

  it("calls the first net eagle off the revealed holes alone", () => {
    // a1 is a gross 3 on every hole; give him a 2 on hole 3 and nothing else
    // changes. Announcing hole 2, the room has seen one hole and there is no
    // eagle in it — so hole 3's eagle must not be reachable, in either
    // direction: it is neither called now nor able to cancel a later call.
    const withEagle = {};
    Object.keys(holeData).forEach((k) => { withEagle[k] = { ...holeData[k] }; });
    withEagle.a1_4[2] = 2;
    const r = computeMatchResult(match, withEagle, courses, tRounds, tPlayers, "team_best_ball", {}, undefined, {}, {});
    const read = (pid, h) => withEagle[`${pid}_4`]?.[h] || 0;
    const at = (reveal) => render(
      <FinalCountdown
        match={match} result={r} getScore={read} ownResult={r} ownGetScore={read}
        holePars={PARS} holeHcps={SI} tPlayers={tPlayers}
        teams={{ A: { id: "A", name: "Mash Brothers" }, B: { id: "B", name: "Shot Callers" } }}
        courseName="Treetops" formatLabel="Team Best Ball"
        reveal={reveal} totals={{ A: 3, B: 1 }} toWin={12.5} clincher={null}
        isDirector={false} captainSide="A" onAdvance={() => {}} onClose={() => {}}
      />,
    ).container.textContent;

    expect(at({ A: 1, B: 1 })).not.toContain("First net eagle");
    cleanup();
    // Announcing hole 3, which IS the eagle — now it is his to call.
    expect(at({ A: 2, B: 2 })).toContain("First net eagle of the round — Paul W");
  });

  it("says nothing while the other captain is talking", () => {
    // His side is a hole up: it is not his go, and a prompt here would be him
    // reading ahead over the top of the man who is speaking.
    expect(screen({ A: 2, B: 1 }, captain).textContent).not.toContain("Mash Brothers −");
  });

  it("leaves a spectator with no controls at all", () => {
    const t = screen({ A: 1, B: 1 }, { isDirector: false, captainSide: null }).textContent;
    expect(t).not.toContain("REVEAL");
    expect(t).toContain("THE CAPTAINS ARE DRIVING");
  });
});


// ══════════════════════════════════════════════════════════════════
//  Two screens, not one page that stretches
// ══════════════════════════════════════════════════════════════════
//  A television across a room and a captain's phone in his hand want opposite
//  layouts. Squeezing one page into both gave the phone eight names four
//  across in half of 393px ("CHRI…"), eighteen tap targets at 20px each, and
//  four controls on one row every one of which truncated.
describe("the phone layout", () => {
  const cells = (c) => [...c.querySelectorAll("div,button")]
    .filter(d => /^([1-9]|1[0-8])$/.test(d.textContent) && d.style.borderRadius?.startsWith("clamp(3px"));

  it("stacks the two sides instead of setting them side by side", () => {
    setWidth(TV);
    const wide = screen({ A: 1, B: 1 });
    const row = [...wide.querySelectorAll("div")].find(d => d.style.flexDirection === "row" && d.style.overflowY === "visible");
    expect(row).toBeTruthy();
    cleanup();

    setWidth(PHONE);
    const tall = screen({ A: 1, B: 1 });
    const col = [...tall.querySelectorAll("div")].find(d => d.style.flexDirection === "column" && d.style.overflowY === "auto");
    expect(col).toBeTruthy();
  });

  it("drops the television's vs between them", () => {
    setWidth(PHONE);
    expect(screen({ A: 1, B: 1 }).textContent).not.toContain("vs");
  });

  it("keeps all eighteen holes, in either shape", () => {
    setWidth(TV);
    expect(cells(screen({ A: 1, B: 1 })).length).toBe(18);
    cleanup();
    setWidth(PHONE);
    expect(cells(screen({ A: 1, B: 1 })).length).toBe(18);
  });

  it("gives the controls a column so nothing has to truncate", () => {
    setWidth(PHONE);
    const c = screen({ A: 2, B: 1 });
    const held = [...c.querySelectorAll("button")].find(b => b.textContent.includes("WAITING ON"));
    // `nowrap` is what turned "WAITING ON SHOT CALLERS" into "WAITING ON SH…".
    expect(held.style.whiteSpace).toBe("normal");
    expect(c.textContent).toContain("BACK");
    expect(c.textContent).toContain("EXIT");
  });
});

// ── Tapping between holes ───────────────────────────────────────────
// The strip is how a director navigates. He is the one exempt from the
// one-hole-at-a-time clamp, and jumping is the repair that clamp exists to
// make necessary: a stray tap took the room to hole 7 and somebody has to be
// able to take it back.
describe("the strip as a control", () => {
  const cell = (c, n) => [...c.querySelectorAll("div,button")]
    .filter(d => d.textContent === String(n) && d.style.borderRadius?.startsWith("clamp(3px")).pop();

  it("lets a director tap straight to a hole, both sides at once", () => {
    const c = screen({ A: 6, B: 6 });
    fireEvent.click(cell(c, 3));
    expect(advanced).toEqual([[null, 3]]);
  });

  it("works the same on a phone, which is where it is needed", () => {
    setWidth(PHONE);
    const c = screen({ A: 6, B: 6 });
    fireEvent.click(cell(c, 12));
    expect(advanced).toEqual([[null, 12]]);
  });

  it("is not a control for a captain", () => {
    // He has his own button and no business moving the other side. The rules
    // would refuse it anyway — this is the screen not offering it.
    const c = screen({ A: 6, B: 6 }, { isDirector: false, captainSide: "A" });
    expect(cell(c, 3).tagName).toBe("DIV");
    fireEvent.click(cell(c, 3));
    expect(advanced).toEqual([]);
  });

  it("is not a control for a spectator either", () => {
    const c = screen({ A: 6, B: 6 }, { isDirector: false, captainSide: null });
    expect(cell(c, 3).tagName).toBe("DIV");
  });
});
