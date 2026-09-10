/** @vitest-environment jsdom */
// ── The countdown, turned over a side at a time ─────────────────────
// The screen the whole evening is built around, and the one place in the app
// where drawing a number one beat early cannot be taken back. lib/reveal pins
// the arithmetic; this pins what the television actually SHOWS on the far side
// of it — which can come apart from the arithmetic, because the component has
// both sides' balls in hand the whole time and chooses which to draw.
import { describe, it, expect, afterEach, beforeEach } from "vitest";
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
const cleared = [];
const screen = (reveal, extra = {}) => {
  advanced.length = 0;
  cleared.length = 0;
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
      onClose={() => {}}
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

  // The cup band ran almost into HOLE 7 and the eighth man ran into the bottom
  // of his own card, so the middle of the screen read as one solid block from
  // the band to the ticker with no air anywhere in it.
  it("gives the hole number room above it and the last man room below", () => {
    setWidth(TV);
    const c = screen({ A: 1, B: 1 });
    // The whole header block — the arrows, the number and the two lines under
    // it. (Its textContent starts with the back arrow, not with "HOLE".)
    const header = [...c.querySelectorAll("div")].find(d =>
      d.style.textAlign === "center" && d.textContent.includes("HOLE 1")
      && d.textContent.includes("1 POINT"));
    expect(header.style.paddingTop).toBeTruthy();
    // And the side's card is deeper at the bottom than at the top: the eighth
    // name sits against it, where the top edge has the team's own name above
    // it doing the same job.
    const col = [...c.querySelectorAll("div")]
      .find(d => d.style.borderRadius?.startsWith("clamp(8px") && d.textContent.includes("Paul W"));
    expect(col.style.paddingBottom).toBeTruthy();
    expect(col.style.paddingBottom).not.toBe(col.style.paddingTop);
  });

  // Two lines under the number, not one string of four facts separated by
  // dots. What the HOLE is (par, and the handicap that decides who gets a shot
  // on it), then what it is WORTH (how many balls make the number, and what it
  // pays). From the back of a room the single line was a rule nobody parses.
  it("splits the hole from what it is worth", () => {
    const t = screen({ A: 1, B: 1 }).textContent;
    expect(t).toContain("PAR 4 · HANDICAP 1");
    expect(t).toContain("BEST 2 OF 3 · 1 POINT");
    // And they are separate elements, not one run of text.
    expect(t).not.toContain("HANDICAP 1 · BEST");
    // "SI" is the correct term and not the one anybody says out loud. The
    // captain's card calls the same number the same thing.
    expect(t).not.toContain("SI ");
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

// ── What one man's ball says, and what it stopped saying ────────────
// Chips across on a phone, a list down on a television — two shapes, one set
// of facts. Every number on either of them is TO PAR, all the way down from
// the side's total, so the six that made it visibly add up to it.
describe("a man's ball", () => {
  it("shows the net score and not the gross", () => {
    // a1 is a gross 3 with no strokes, a3 a gross 5. What must NOT be there is
    // the "(5)" that used to ride beside them: two numbers on a postage stamp,
    // in a room.
    const t = screen({ A: 1, B: 1 }).textContent;
    expect(t).not.toMatch(/\(\d\)/);
  });

  // The side reads −1 and the balls under it used to read 3, 4, 5 — two
  // scales in one column, and the room doing the conversion in its head to
  // see where the number came from.
  it("is against par, not a raw net, on either screen", () => {
    const scores = (c) => [...c.querySelectorAll("div,span")]
      .filter(d => !d.children.length && /^[−+]\d$|^E$/.test(d.textContent))
      .map(d => d.textContent);
    // Best 2 of 3 on a par 4: a birdie, a par and a bogey a side.
    setWidth(TV);
    const tv = screen({ A: 1, B: 1 });
    expect(scores(tv)).toEqual(expect.arrayContaining(["−1", "E", "+1"]));
    // And the raw nets are gone with it. (A strip cell is also a bare number,
    // so this asks outside the strip — those are the eighteen hole labels.)
    expect([...tv.querySelectorAll("div,span")]
      .filter(d => !d.children.length && d.textContent === "5"
        && !d.style.borderRadius?.startsWith("clamp(3px")).length).toBe(0);
    cleanup();
    setWidth(PHONE);
    expect(scores(screen({ A: 1, B: 1 }))).toEqual(expect.arrayContaining(["−1", "E", "+1"]));
  });

  // ── A centred trio of left-to-right columns ──
  // The side's header is centred, so the eight rows under it have to be. But
  // "centred" means the three lanes TOGETHER, not each row's ink: the name
  // stays left-aligned so eight names start on one pixel, the score is centred
  // in its own lane, and the block of three sits in the middle.
  it("centres the trio without centring what is inside it", () => {
    setWidth(TV);
    const c = screen({ A: 1, B: 1 });
    const rows = [...c.querySelectorAll("div")]
      .filter(d => d.style.borderLeft?.startsWith("clamp(3px"));
    expect(rows.length).toBe(6);
    rows.forEach((row) => {
      expect(row.style.justifyContent).toBe("center");
      const [name, dots, score] = [...row.children];
      expect(name.style.textAlign).toBe("left");
      expect(score.style.textAlign).toBe("center");
      // No lane may GROW. A lane that takes a share of the column carries the
      // leftover space inside itself, which is what leaves a left-aligned name
      // floating in a pool of it and the block reading left-heavy however
      // carefully the box is centred.
      [name, dots, score].forEach((lane) => expect(lane.style.flexGrow).toBe(""));
      expect(name.style.width).toBeTruthy();
      expect(dots.style.width).toBeTruthy();
      expect(score.style.width).toBeTruthy();
    });
  });

  // Sized to the longest name ON THAT SIDE, so the trio has no slack in it and
  // the middle of the box is the middle of the ink.
  it("sizes the name lane to the longest name on the side", () => {
    setWidth(TV);
    const c = screen({ A: 1, B: 1 });
    const lanes = [...c.querySelectorAll("div")]
      .filter(d => d.style.borderLeft?.startsWith("clamp(3px"))
      .map(row => row.children[0].style.width);
    // One width for the whole side, or the names have no left edge to line up
    // on. Both sides here are 6-character names, so both come out the same.
    expect(new Set(lanes).size).toBe(1);
    expect(parseFloat(lanes[0])).toBeCloseTo(6 * 0.75, 5);
  });

  // A border only on the left shifts the content box right by its own width,
  // and "dead centre" that is eight pixels off is the kind of wrong that is
  // visible on a television and invisible in a diff.
  it("mirrors the colour rail so the centre is a real centre", () => {
    const row = [...screen({ A: 1, B: 1 }).querySelectorAll("div")]
      .find(d => d.style.borderLeft?.startsWith("clamp(3px"));
    expect(row.style.borderRightWidth).toBe(row.style.borderLeftWidth);
    expect(row.style.borderRightColor).toBe("transparent");
  });

  it("leaves a ball that missed the cut legible, on either screen", () => {
    // It used to sit at opacity 0.42, which from twelve feet is a number you
    // cannot read — and on this format "you didn't count" is half the
    // conversation in the room. The tint and the rail say who made the number.
    const balls = (c) => [...c.querySelectorAll("div")]
      .filter(d => d.style.borderRadius?.startsWith("clamp(5px")   // a phone chip
        || d.style.borderLeft?.startsWith("clamp(3px"));           // a TV row
    setWidth(TV);
    const tv = balls(screen({ A: 1, B: 1 }));
    expect(tv.length).toBe(6);
    cleanup();
    setWidth(PHONE);
    const phone = balls(screen({ A: 1, B: 1 }));
    expect(phone.length).toBe(6);
    [...tv, ...phone].forEach(d =>
      expect(d.style.opacity === "" || Number(d.style.opacity) >= 1).toBe(true));
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

// ── The cup, across the top ─────────────────────────────────────────
// The central and most important thing on the screen: eighteen holes are
// turned over underneath it and not one of them matters except for what it
// does to these two numbers.
describe("the cup band", () => {
  const ticks = (c) => [...c.querySelectorAll("div")]
    .filter(d => d.style.position === "absolute" && d.style.width === "3px");

  it("names what the number in the middle is", () => {
    // It read "TO WIN" in the same grey as everything else — a label on a
    // number nobody could place, from across a room.
    expect(screen({ A: 1, B: 1 }).textContent).toContain("TO WIN THE CUP");
    expect(screen({ A: 1, B: 1 }).textContent).toContain("12.5");
  });

  it("shortens it on a phone rather than crushing the totals", () => {
    setWidth(PHONE);
    const t = screen({ A: 1, B: 1 }).textContent;
    expect(t).toContain("TO WIN");
    expect(t).not.toContain("TO WIN THE CUP");
  });

  // Each side fills from its own end, so the mark it has to REACH sits at
  // `toWin` measured from that same end. On a full card those two land a
  // shade either side of the middle, which is the truth of the format: both
  // marks cannot be reached. The plain halfway line that used to be there
  // said something weaker and looked the same.
  it("marks the clinch from each end, not the halfway point", () => {
    const [a, b] = ticks(screen({ A: 1, B: 1 }));
    // toWin 12.5 against 24 points on the table.
    expect(a.style.left).toBe(`${(12.5 / 24) * 100}%`);
    expect(b.style.right).toBe(`${(12.5 / 24) * 100}%`);
    expect(a.style.left).not.toBe("50%");
  });
});

// ── The cup, behind all of it ───────────────────────────────────────
// The same trophy silhouette the sign-in screen carries. Nothing else on this
// screen names the Bourbon Cup — two team names, a hole number and eighteen
// cells — and a television somebody walks past should say what it is.
describe("the trophy", () => {
  const trophy = (c) => c.querySelector("img");

  it("is behind the screen, not in front of it", () => {
    const img = trophy(screen({ A: 1, B: 1 }));
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toContain("trophy");
    // A positioned element paints above its static siblings whatever the
    // source order, so the layout lives in a `relative` layer of its own and
    // the image sits under it. Without that the watermark covers the names.
    expect(img.style.zIndex).toBe("0");
    expect(img.style.pointerEvents).toBe("none");
    expect(img.parentElement.querySelector("div").style.zIndex).toBe("1");
  });

  // It was inset:0 on the fixed backdrop — the whole viewport — so the cup
  // band across the top and the controls along the bottom, both opaque, sat ON
  // it and sliced the trophy off at the handles. A watermark with its top cut
  // away does not read as a trophy, it reads as a smudge.
  it("is sized to the stage between the headers, not to the screen", () => {
    const c = screen({ A: 1, B: 1 });
    const img = trophy(c);
    const box = img.parentElement;
    // Its box is the flex child between the two headers, so it is bounded by
    // whatever room they left — nothing is measured.
    expect(box.style.position).toBe("relative");
    expect(box.style.minHeight).toBe("0px");
    expect(img.style.objectFit).toBe("contain");
    // And NOT the fixed full-screen backdrop, which is what cropped it. The
    // stage is a child of it, several elements down.
    expect(c.firstChild.style.position).toBe("fixed");
    expect(c.firstChild).not.toBe(box);
    expect(c.firstChild.contains(box)).toBe(true);
  });

  it("fades once there are names to read over it", () => {
    // The sign-in screen carries it at full strength because there is nothing
    // else on it. Here there are eight names a side, and a watermark that
    // competes with a name is one that made a name harder to read.
    const opening = Number(trophy(screen({ A: 0, B: 0 })).style.opacity);
    cleanup();
    const playing = Number(trophy(screen({ A: 1, B: 1 })).style.opacity);
    expect(opening).toBeGreaterThan(playing);
    expect(playing).toBeGreaterThan(0);
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
  // The card is a PHONE thing — see the two tests at the bottom of this block.
  beforeEach(() => setWidth(PHONE));

  it("gives him one button and it is his own side's", () => {
    const t = screen({ A: 1, B: 1 }, captain).textContent;
    expect(t).toContain("REVEAL MASH BROTHERS · HOLE 2");
    expect(t).not.toContain("REVEAL SHOT CALLERS");
  });

  // The whole reason his phone has the hole before the room does: he is
  // reading it out. It is his OWN side, which is never hidden from him.
  it("tells him what to say before he taps", () => {
    const t = screen({ A: 1, B: 1 }, captain).textContent;
    // The stroke index too — it is why a man is getting a shot on this hole
    // and not the last one, which is what the room asks the moment a net eagle
    // is announced.
    // The hole is the heading and par/SI the detail under it — two lines, not
    // one grey caption with the number he is announcing buried in it.
    expect(t).toContain("HOLE 2");
    expect(t).toContain("PAR 4 · HANDICAP 2");
    expect(t).toContain("Mash Brothers −1");   // birdie + par against two pars
    expect(t).toContain("Net birdie — Paul W");
  });

  // A net bogey is never read out — see lib/countdownPrompt for why.
  it("never names the man who made the bogey", () => {
    const t = screen({ A: 1, B: 1 }, captain).textContent;
    const band = t.slice(t.indexOf("PAR 4 · HANDICAP 2"));
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

  // ── The order he says it in ─────────────────────────────────────
  // "…with contributions from Paul and Dave, and the first net eagle of the
  // round — the Mash Brothers are three under."
  //
  // So the card reads top to bottom in that order, and the team's number is
  // LAST. It used to sit at the top beside the hole, which is a scoreboard's
  // order — answer first, detail under it — and reading this card out then
  // meant starting at the bottom, going up for the names and coming back
  // down, every hole, eighteen times, in front of everybody.
  it("puts the hole, then the men, then the number", () => {
    const t = screen({ A: 1, B: 1 }, captain).textContent;
    const hole = t.indexOf("PAR 4 · HANDICAP 2");
    const names = t.indexOf("Net birdie — Paul W");
    const number = t.indexOf("Mash Brothers −1");
    expect(hole).toBeGreaterThan(-1);
    expect(names).toBeGreaterThan(hole);
    expect(number).toBeGreaterThan(names);
  });

  it("puts a nugget with the men, ahead of the number", () => {
    // "…from Paul, AND the first eagle of the round — the Mash Brothers are…"
    // is one breath. The stats belong to the build-up, not to the payoff.
    const t = screen({ A: 1, B: 1 }, captain).textContent;
    const names = t.indexOf("Net birdie — Paul W");
    const nugget = t.indexOf("in a row");
    const number = t.indexOf("Mash Brothers −1");
    expect(nugget).toBeGreaterThan(names);
    expect(number).toBeGreaterThan(nugget);
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

  // ── The card is HIS, and only his ─────────────────────────────
  // The commentary is a script for one man. On the television it is not
  // clutter, it is a LEAK: the card is the hole nobody has seen yet, printed
  // in front of the room the countdown exists to keep it from.
  //
  // Signing the TV in as a guest keeps `captainSide` null and the card away —
  // but that is a setup step somebody has to get right on the night, and the
  // failure is silent and total. The screen refuses on its own instead.
  it("never draws the card on a big screen, whoever is signed in", () => {
    setWidth(TV);
    const t = screen({ A: 1, B: 1 }, captain).textContent;
    expect(t).not.toContain("Net birdie — Paul W");
    expect(t).not.toContain("in a row");
    expect(t).not.toContain("PAR 4 · HANDICAP 2");
  });

  it("still gives him his reveal button on a big screen", () => {
    // The card is what is withheld, not the control. A captain driving off a
    // laptop keeps his half of the countdown.
    setWidth(TV);
    expect(screen({ A: 1, B: 1 }, captain).textContent).toContain("REVEAL MASH BROTHERS · HOLE 2");
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
// The strip REWINDS, and it does not fast-forward. Backward is the repair it
// was added for — a stray tap took the room to hole 7 and somebody has to take
// it back — and backward reveals nothing, because every hole it lands on has
// already been seen. Forward is one hole at a time, through a captain's own
// button, which is the ceremony.
describe("the strip as a control", () => {
  const cell = (c, n) => [...c.querySelectorAll("div,button")]
    .filter(d => d.textContent === String(n) && d.style.borderRadius?.startsWith("clamp(3px")).pop();

  it("lets a director tap back to a hole, both sides at once", () => {
    const c = screen({ A: 6, B: 6 });
    fireEvent.click(cell(c, 3));
    expect(advanced).toEqual([[null, 3]]);
  });

  it("works the same on a phone, which is where it is needed", () => {
    setWidth(PHONE);
    const c = screen({ A: 12, B: 12 });
    fireEvent.click(cell(c, 4));
    expect(advanced).toEqual([[null, 4]]);
  });

  // ── The one that cannot happen ────────────────────────────────────
  // The strip used to accept any cell, which made it a way to turn over every
  // hole between here and there in ONE TAP — the one thing this screen exists
  // to prevent, and unrecoverable in the way that matters: a mistap on 18 does
  // not show a wrong number somebody can correct, it shows the room the end of
  // the tournament, and no amount of tapping back un-sees it.
  it("will not jump a director FORWARD, on either screen", () => {
    const forward = (w) => {
      setWidth(w);
      const c = screen({ A: 6, B: 6 });
      // Hole 12 is six holes past what the room has seen.
      expect(cell(c, 12).tagName).toBe("DIV");
      fireEvent.click(cell(c, 12));
      // And the very next one, which is the tempting mistap.
      fireEvent.click(cell(c, 7));
      expect(advanced).toEqual([]);
      cleanup();
    };
    forward(TV);
    forward(PHONE);
  });

  // With A on 7 and B on 6 the room is mid-hole-7. Tapping 7 would set BOTH
  // sides to 7 — which is not going back, it is turning over the half of hole
  // 7 the other captain has not told yet.
  it("will not 'go back' to the half-open hole", () => {
    const c = screen({ A: 7, B: 6 });
    expect(cell(c, 7).tagName).toBe("DIV");
    fireEvent.click(cell(c, 7));
    expect(advanced).toEqual([]);
    // Hole 6 is genuinely behind, and still works.
    fireEvent.click(cell(c, 6));
    expect(advanced).toEqual([[null, 6]]);
  });

  it("offers nothing at all before the first hole", () => {
    const c = screen({ A: 0, B: 0 });
    expect(cell(c, 1).tagName).toBe("DIV");
    fireEvent.click(cell(c, 1));
    expect(advanced).toEqual([]);
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

// ══════════════════════════════════════════════════════════════════
//  Clearing the board between holes
// ══════════════════════════════════════════════════════════════════
//  Both captains have told their side, the hole is up with all sixteen balls
//  on it, and everybody is looking at it. The reveal is finished; the hole is
//  not, because the hole is a conversation. Before these two arrows the only
//  way off it was for a captain to reveal HALF OF THE NEXT ONE — so the result
//  of hole 7 was wiped by the arrival of hole 8, on somebody else's cue.
describe("the hole arrows", () => {
  // By aria-label, not by glyph: the controls row carries its own "◀" (the
  // reveal step-back), and these two are a different control entirely.
  const arrows = (c) => [...c.querySelectorAll(
    'button[aria-label="Next hole"], button[aria-label="Previous hole"]')];
  const arrow = (c, dir) => c.querySelector(
    `button[aria-label="${dir === "next" ? "Next hole" : "Previous hole"}"]`);

  it("moves the room on without turning anything over", () => {
    const c = screen({ A: 7, B: 7 });
    fireEvent.click(arrow(c, "next"));
    expect(cleared).toEqual([8]);
    // And nothing was revealed by it. That is the whole point: the board goes
    // blank and waits for the first captain.
    expect(advanced).toEqual([]);
  });

  it("clears the board rather than showing half of the next hole", () => {
    // Cleared to 8 with both counters still on 7: hole 8 is on screen and
    // neither side has been told.
    const t = screen({ A: 7, B: 7, cursor: 8 }).textContent;
    expect(t).toContain("HOLE 8");
    expect(t).toContain("MASH BROTHERS TO TELL IT");
    expect(t).toContain("SHOT CALLERS TO TELL IT");
    expect(t).not.toContain("Paul W");
    expect(t).not.toContain("Andy H");
  });

  it("waits for both captains before it will move", () => {
    // A is a hole up; B has not told hole 7 yet. Advancing here would skip
    // B's eight balls and they would never come back on their own.
    const c = screen({ A: 7, B: 6 });
    expect(arrow(c, "next").disabled).toBe(true);
    fireEvent.click(arrow(c, "next"));
    expect(cleared).toEqual([]);
  });

  it("takes a clear back, and only while it is still a clear", () => {
    const c = screen({ A: 7, B: 7, cursor: 8 });
    expect(arrow(c, "back").disabled).toBe(false);
    fireEvent.click(arrow(c, "back"));
    expect(cleared).toEqual([7]);
    cleanup();
    // Once a captain has revealed into the new hole, taking the room back
    // would be un-showing something it has already watched.
    const after = screen({ A: 8, B: 7, cursor: 8 });
    expect(arrow(after, "back").disabled).toBe(true);
    cleanup();
    // And there is nothing to undo on a hole nobody cleared onto.
    expect(arrow(screen({ A: 7, B: 7 }), "back").disabled).toBe(true);
  });

  // The shell is one big tap target for `advance`. Without stopPropagation a
  // tap on ▶ would clear the board and then be handled again by the
  // background — which on a hole both sides had told would clear it twice.
  it("does not also fire the background tap", () => {
    const c = screen({ A: 7, B: 7 });
    fireEvent.click(arrow(c, "next"));
    expect(cleared).toEqual([8]);
  });

  it("is a director's control and nobody else's", () => {
    expect(arrows(screen({ A: 7, B: 7 }, { isDirector: false, captainSide: "A" })).length).toBe(0);
    cleanup();
    expect(arrows(screen({ A: 7, B: 7 }, { isDirector: false, captainSide: null })).length).toBe(0);
    cleanup();
    // Symmetric, so the hole number stays centred on the television.
    expect(arrows(screen({ A: 7, B: 7 })).length).toBe(2);
  });

  it("has nothing left to clear on the eighteenth", () => {
    expect(arrow(screen({ A: 18, B: 18 }), "next").disabled).toBe(true);
  });

  // The keyboard moves the room between holes and does not reveal — see the
  // block below on the one door a reveal has.
  it("moves the room on from the keyboard", () => {
    screen({ A: 7, B: 7 });
    fireEvent.keyDown(window, { key: " " });
    expect(cleared).toEqual([8]);
    expect(advanced).toEqual([]);
    cleanup();
    // On a cleared board there is nothing left for it to do — a captain's
    // button is the only thing that turns a side over.
    screen({ A: 7, B: 7, cursor: 8 });
    fireEvent.keyDown(window, { key: " " });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(cleared).toEqual([]);
    expect(advanced).toEqual([]);
  });

  it("undoes the clear on the way back, before it un-reveals anything", () => {
    screen({ A: 7, B: 7, cursor: 8 });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(cleared).toEqual([7]);
    expect(advanced).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════
//  A reveal has exactly one door
// ══════════════════════════════════════════════════════════════════
//  The whole screen used to be one tap target: a click anywhere on the
//  background turned over the next side that was due. On the ONE screen in
//  this app where a stray tap cannot be taken back, that is the wrong
//  convenience — a phone in a pocket, a trackpad brushed while somebody
//  reaches past the laptop, a hand steadying the machine on a table. Any of
//  them put eight balls in front of the room before the captain had said a
//  word, and nobody would know what they had touched.
describe("what may turn a side over", () => {
  const shell = (c) => c.firstChild;

  it("is not the background", () => {
    const c = screen({ A: 1, B: 1 });
    fireEvent.click(shell(c));
    expect(advanced).toEqual([]);
    expect(cleared).toEqual([]);
  });

  it("is not the hole header, the strip, or the trophy behind them", () => {
    const c = screen({ A: 1, B: 1 });
    // Every element on the page that is not a button. If any of them reveals,
    // the room finds out the hard way.
    [...c.querySelectorAll("div,img,span")]
      .filter(d => d.tagName !== "BUTTON")
      .forEach(d => fireEvent.click(d));
    expect(advanced).toEqual([]);
  });

  it("is the button with the team's name on it", () => {
    const c = screen({ A: 1, B: 1 });
    fireEvent.click([...c.querySelectorAll("button")]
      .find(b => b.textContent.includes("REVEAL SHOT CALLERS")));
    expect(advanced).toEqual([["B", 2]]);
  });

  // The keyboard keeps the PACING, because neither clearing the board nor
  // taking a clear back shows anything that was not already on screen.
  it("is not the space bar", () => {
    screen({ A: 1, B: 1 });
    ["  ", " ", "Enter", "ArrowRight", "PageDown"].forEach(key =>
      fireEvent.keyDown(window, { key }));
    expect(advanced).toEqual([]);
  });
});
