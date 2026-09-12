// ══════════════════════════════════════════════════════════════════
//  The Final Countdown — the sealed round, turned over in a room.
// ══════════════════════════════════════════════════════════════════
//
//  This is the only screen in the app that is not for a phone. Sixteen
//  people are sitting around a television, the closing round has been
//  played in the dark all day (see lib/reveal.js), and it comes out one
//  hole at a time with the cup riding on it. Everything here follows
//  from that:
//
//    • TYPE IS SIZED FOR A ROOM, not a hand. Every size is a clamp on
//      vw, so the same page reads at twelve feet on a 4K television and
//      still fits the laptop it is being tested on. The rest of the app
//      uses the FS scale; nothing on this screen does, because FS tops
//      out at 40px and the number everybody is waiting for wants 200.
//    • ONE HOLE FILLS THE SCREEN. Not a scoreboard with a cursor on it —
//      the hole being revealed IS the page, and the eighteen-hole strip
//      along the bottom is the only other thing competing for attention,
//      because "how many are left" is the question that makes 16 and 17
//      unbearable.
//    • THE STORY IS WHOSE BALL COUNTED. A Team Best Ball hole is the sum
//      of the side's best six net balls out of eight, so the number is
//      the outcome and the six names are the reason. The two who did not
//      count are dimmed rather than dropped: on this format that is half
//      the conversation in the room, and hiding it would be a kindness
//      nobody asked for.
//
//  WHAT DRIVES IT — THE TWO CAPTAINS
//  ---------------------------------
//  A hole is turned over ONE SIDE AT A TIME, and the side's own captain is
//  the one who turns it: he tells the room what is on it — "hole one, net
//  eagle from Paul, couple of birdies off Dave and John, we're three under"
//  — and THEN taps his own phone, and his eight balls go up on the
//  television. Then the other captain does his. Only when both are out does
//  anybody know who won the hole, and only then does the strip fill in.
//
//  That is the evening, and it is why the reveal is a PAIR of counters
//  (`reveal_a` / `reveal_b`, see lib/reveal) rather than one. A director can
//  move either — somebody has to be able to fix a mistap, and a captain who
//  put his phone down should not stop the room — but the pacing belongs to
//  the two men doing the talking.
//
//  It replaced a three-second local stagger: one press used to open A, then
//  B, then the verdict, on a timer. The timer was standing in for exactly
//  this, badly. Nothing narrates as well as the man who played the hole, and
//  a countdown paced by a setTimeout cannot wait for a story or hurry past a
//  hole nobody wants to talk about.
//
//  A REVEAL HAS EXACTLY ONE DOOR: the button with the team's name on it.
//  Nothing else on this screen turns a side over — not the background, not the
//  hole number, not the space bar. It used to: the whole shell was a tap
//  target, which on the one screen where a stray tap cannot be taken back is
//  the wrong convenience. See the note above `revealSide`.
//
//  Arrow keys and the space bar move the room BETWEEN holes, for the year the
//  laptop is close enough to reach. Neither of those shows anything that was
//  not already on the screen.
//
//  WHAT A CAPTAIN'S PHONE HAS THAT THE ROOM DOES NOT
//  -------------------------------------------------
//  His own side's next hole, before he reveals it — which is the whole point,
//  since he is reading it out. It costs nothing and exposes nothing: a team is
//  never hidden from itself (see lib/reveal), and it is the same allowance the
//  scoreboard's own-side card has had all day. The OTHER side's next hole he
//  does not get, on this screen or any other, until its captain says so.
//
//  lib/countdownPrompt turns those balls into the two lines he can read at a
//  glance while holding a drink.
//
//  WHAT IT IS HANDED
//  -----------------
//  `countdownHoleData` — the round cut off at the reveal (see lib/reveal).
//  That is deliberate and it is what makes this screen safe to write
//  casually: hole `through - 1` is the last one that exists, so there is
//  no hole after it to leak, and no discipline required of the layout
//  below to avoid drawing one.
//
//  It is NOT what the scoreboard gets. The board is handed the same round
//  with nothing in it at all and holds there until the eighteenth hole is
//  turned over — the reveal happens here, on one screen, rather than on
//  this one and on sixteen phones a half-second sooner. So the cup bar
//  across the top, the trophy line and the match state below are all
//  scored off this map, and they are the only place in the app any of it
//  is visible while the countdown is running.

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { BC, FONT, ALPHA, teamColor } from "../theme";
import { TROPHY_SILHOUETTE } from "../constants";
import { playerLookup } from "../lib/players";
import { HOLE_COUNT, nextHoleForSide, sidesPending } from "../lib/reveal";
import { holePrompt, relToPar, fmtRel } from "../lib/countdownPrompt";

// ── Type scale, for a television ─────────────────────────────────
// Read as: never smaller than the first (a phone held sideways, or the
// browser window somebody is testing in), grows with the viewport, never
// larger than the third (a 4K panel, where unbounded vw would put a single
// digit through the ceiling).
//
// ── WHY ALMOST EVERY RUNG CARRIES A vh CEILING ──
// This page has to FIT. It is one screenful — a band, a header, eight rows a
// side, a strip and a row of controls — with no scroll on the television, so
// anything that grows past the bottom does not scroll, it disappears under the
// thing below it.
//
// Sized on vw alone, the chrome grows with WIDTH while the room it has to fit
// in is HEIGHT, and those come apart the moment the window is not 16:9. A
// laptop browser at 1366x640 is wider than a television in vw terms and two
// inches shorter in the space that matters: the cup band and the hole header
// came out bigger than they do on a 720p TV, and the last man's row went under
// the hole ticker.
//
// `vwh(k)` is that fixed: the same vw size with a vh ceiling at 1.8x the
// coefficient. 16:9 puts vh at exactly 0.5625vw, so a ceiling above 1.778x
// never binds there — this is a NO-OP on a television, on a 4K panel and on
// anything TALLER than 16:9 (a 16:10 laptop, a phone), and bites only on a
// window WIDER than 16:9, where it scales the whole page down together rather
// than letting the chrome eat the rows.
const vwh = (k) => `min(${k}vw, ${(k * 1.8).toFixed(2)}vh)`;

const T = {
  cupName:  `clamp(11px, ${vwh(1.5)}, 30px)`,
  // The cup total is the biggest thing on the screen after the hole itself,
  // because the band across the top is what the room is actually tracking —
  // every hole is only interesting for what it does to these two numbers.
  cupPts:   `clamp(26px, ${vwh(4.2)}, 92px)`,
  // What it takes to win it, in gold, between them. Deliberately smaller than
  // the totals it sits between: it is the line they are running at, not a
  // third score.
  cupGoal:  `clamp(17px, ${vwh(2.3)}, 48px)`,
  hole:     `clamp(20px, ${vwh(3.0)}, 62px)`,
  terms:    `clamp(9px,  ${vwh(1.2)}, 24px)`,
  // The side's own number is capped HARDER than the rest — 9.7vh against the
  // 10.2 `vwh` would give it — because it is the single tallest thing between
  // the hole header and the strip, and the eight rows under it are what it
  // takes room from.
  side:     "clamp(28px, min(5.5vw, 7.0vh), 120px)",
  sideName: `clamp(12px, ${vwh(1.7)}, 34px)`,
  // ── The television's roll-call ──
  // A name and a number on one line, eight lines a side. Bigger than the
  // chip's caption-sized name could ever be, which is the whole reason the
  // television stopped using chips.
  //
  // Both rungs are capped on HEIGHT as well as width, and so is the row's
  // padding and the side's number above it — because eight rows is a stack
  // that has to FIT, and the thing it has to fit inside is the gap between
  // the hole header and the strip. Sized on vw alone the eight of them ran
  // 40px past the bottom of a 16:9 window, and the block is centred in its
  // box, so half of that overflow came out of the top: the last man's row sat
  // under the hole ticker and the terms line ran through the first man's.
  rowName:  "clamp(11px, min(1.45vw, 2.4vh), 30px)",
  rowScore: "clamp(13px, min(1.75vw, 2.45vh), 36px)",
  rowPad:   "clamp(1px,  min(0.42vw, 0.45vh), 9px)",
  rowGap:   "clamp(2px,  min(0.3vw,  0.38vh), 7px)",
  // The clinch line. Smaller than it was (3.4vw), because its band is now
  // RESERVED for the whole round — see the note on `clinchBand` — so every
  // pixel it takes is a pixel off eighteen holes of rows, not just the one it
  // appears on.
  cup:      `clamp(15px, ${vwh(1.95)}, 42px)`,
  strip:    `clamp(7px,  ${vwh(0.95)}, 20px)`,
  btn:      `clamp(11px, ${vwh(1.5)}, 30px)`,
  promptSm: "clamp(10px, 1.2vw, 24px)",
  // ── The captain's card ──
  // Its own three rungs, and they are the only sizes on this screen tuned for
  // a HAND rather than a room. Everything else here is read at twelve feet and
  // takes its floor from whatever fits a browser window; this is read at arm's
  // length, in a lit room, by a man holding a drink and talking at the same
  // time — so the floors are what matter and they are set high.
  //
  // They were T.promptSm / T.prompt / T.verdict, which are television rungs:
  // on a 393px phone every one of them bottomed out at its clamp minimum, and
  // those minimums exist to keep a TELEVISION layout from collapsing in a
  // narrow browser window. 10px, 13px and 16px is a caption, a body line and a
  // subhead — for a card whose whole job is to be glanced at and read aloud.
  cardHole:  "clamp(22px, 2.3vw, 46px)",
  cardLabel: "clamp(13px, 1.4vw, 28px)",
  cardLine:  "clamp(17px, 1.8vw, 36px)",
  cardTotal: "clamp(27px, 3.0vw, 62px)",
};

const fmtPts = (n) => (n == null ? "—" : Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));


// ── The strokes he got, as DOTS ──────────────────────────────────
// One dot per handicap stroke, in a lane of its own, which is where a
// scorecard puts them and where this app puts them everywhere else (see
// ScoreCell in components/FullScorecard). They used to be crammed inside the
// gross parenthetical as "(5•)", which is not a stroke dot — it is a bullet in
// a bracket, at the size of the smallest type on the screen, from twelve feet
// away.
//
// They are the whole reason the number beside them is not the number he wrote
// down. A room looking at a man two under wants to know whether that was an
// eagle or two shots, and the dots are the answer.
//
// The lane keeps its size with no strokes in it, so the numbers line up
// whether or not the man got a shot.
function StrokeDots({ strokes, compact }) {
  const d = compact ? 4 : "clamp(4px, 0.45vw, 9px)";
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      gap: compact ? 2 : "clamp(1px, 0.15vw, 3px)",
      // Four dots at their own size, plus the three gaps between them, is
      // 28.8px at 1280 — and the lane was 28.2. A man on his fourth stroke
      // pushed the last dot into the score beside him.
      width: compact ? 22 : "clamp(24px, 2.9vw, 60px)", flexShrink: 0,
    }}>
      {Array.from({ length: Math.min(strokes || 0, 4) }, (_, i) => (
        <span key={i} style={{
          width: d, height: d, borderRadius: "50%", background: BC.hcpBlue, display: "block",
        }} />
      ))}
    </div>
  );
}

// ── A score, against par ─────────────────────────────────────────
// Every number on this screen is TO PAR, from the side's total down to one
// man's ball. It used to be the man's raw net — 3, 4, 5 — beneath a side
// total that was already relative, so the room was reading two different
// scales in one column and doing the conversion in its head to see where the
// −4 came from. Now the six numbers that made it visibly add up to it.
//
// UNDER PAR IS RED, the oldest convention on a scorecard and the one thing in
// this app where red does not mean trouble: a printed card puts the under-par
// numbers in red ink and everything else in black, and a room full of golfers
// reads it without being told. On any ball, counted or not — that is what the
// red ink means, the score and not its standing.
const ballRel = (net, par) =>
  net == null || !Number.isFinite(par) ? null : net - par;

// ── One player's ball ────────────────────────────────────────────
// The same three facts on ONE LINE — name, strokes, the number — eight lines
// down a column, on the television and on a phone alike.
//
// THE PHONE USED TO GET CHIPS: four across and two down, on the reasoning that
// width is the scarce thing in a hand. It is not, and the argument had a hole
// in it — the two sides are STACKED on a phone, so each one has the whole 393
// px, not half of it. What that grid actually did was cap every name at a
// quarter of the screen and set it in the smallest type in the app (8px), to
// buy vertical space on the one layout that was already free to scroll.
//
// So both screens are the same list now, and the phone is the shape that
// gained: a name at 13px instead of 8, no ellipsis, the same stroke dots, the
// same to-par number, the same rail down the balls that counted. What a
// captain sees in his hand is what the room sees on the wall, which is the
// whole point of the thing — he is describing that screen out loud.
//
// ── A CENTRED TRIO OF LEFT-TO-RIGHT COLUMNS ──
// The side's header is centred — the team's name over its big to-par number —
// so the eight rows under it have to be, or the column reads as a centred
// title over a table pushed against one edge. But "centred" here means the
// THREE LANES TOGETHER, not each row's ink: name, strokes and score keep their
// own alignment inside their own lane, and the block of three is what sits in
// the middle.
//
//   NAME     left-aligned, so eight names start on one pixel and the column
//            can be read down rather than scanned.
//   STROKES  a fixed lane, whether or not the man got a shot.
//   SCORE    centred in its lane.
//
// It went through the wrong middle first: name hard left, number hard right,
// and the dots stranded near the right on a 1250px column — two facts at
// opposite ends of a foot of black. Then the dot lane was pinned dead centre
// with equal flex either side, which centred one column and left the score
// hanging past it with a hand's width of nothing beyond.
//
// WHAT MAKES IT OPTICAL RATHER THAN JUST CENTRED: the name lane is sized to
// the LONGEST NAME ON THAT SIDE (see SideColumn) instead of to a share of the
// column. A lane sized by its share carries the leftover space inside itself,
// so left-aligned names sit in the middle of a pool of it and the block reads
// left-heavy however carefully the box is centred. Sized to its content, the
// trio has no slack in it and the middle of the box is the middle of the ink.
//
// The rail is mirrored by a TRANSPARENT border of the same width on the right.
// A border only on the left shifts the content box right by its own width, and
// "dead centre" that is eight pixels off is the kind of wrong that is visible
// on a television and invisible in a diff.
//
// The counted balls carry that rail in the side's colour. From the back of a
// room it reads as one continuous mark down the six that made the number,
// which is the question the format asks — and it does it without the two that
// missed going dim (see the note in SideColumn).
const RAIL = "clamp(3px, 0.4vw, 8px)";

// ══════════════════════════════════════════════════════════════════
//  Confetti, on the winners' side
// ══════════════════════════════════════════════════════════════════
//  Inside the winning side's own card and nowhere else, because WHOSE it is
//  is the whole message. A shower across the middle of the screen would be the
//  app celebrating; a shower over one of the two columns is the room being
//  told which one.
//
//  It does not stop. The cup is won once in a year and the screen stays on it
//  while sixteen men shout at each other — a three-second burst would be over
//  before anybody looked up. Infinite, staggered, and costing nothing in
//  layout: the whole thing is one absolutely-positioned layer with
//  `pointer-events: none` over a card whose size it cannot change.
//
//  Seeded rather than random, so a re-render does not reshuffle every piece
//  mid-fall — React has no idea this is an animation and would happily hand
//  each strip a new duration on the next state change.
//  It falls by animating `top`, not `transform`. A percentage inside
//  `translate` resolves against the ELEMENT — so `translateY(118%)` on a strip
//  eighteen pixels tall moves it twenty-one pixels and the whole shower sits
//  in a band across the top of the card, which is exactly what it did. A
//  percentage on `top` resolves against the containing block, which is the
//  card, which is the distance meant. The transform is left to do the two
//  things it is the right tool for: the sideways drift and the spin.
const CONFETTI_CSS = `
@keyframes bcConfettiFall {
  0%   { top: -14%; transform: translateX(0) rotate(0deg); opacity: 0; }
  6%   { opacity: 1; }
  90%  { opacity: 1; }
  100% { top: 114%; transform: translateX(var(--bc-drift)) rotate(var(--bc-spin)); opacity: 0; }
}`;

const CONFETTI_N = 34;

// A small deterministic generator — same pieces every render, different ones
// per side.
const seeded = (n) => {
  let x = (n * 9301 + 49297) % 233280;
  return () => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
};

function Confetti({ tid }) {
  const col = teamColor(tid);
  const pieces = useMemo(() => {
    const r = seeded(tid === "A" ? 17 : 41);
    // The side's own colour, a light and a dark of it, and the cup's gold.
    const palette = [col, `${col}${ALPHA.tint}`, BC.amber, BC.t1, col];
    return Array.from({ length: CONFETTI_N }, (_, i) => ({
      id: i,
      left: r() * 100,
      delay: -r() * 6,
      dur: 3.6 + r() * 4.2,
      drift: (r() * 2 - 1) * 40,
      spin: 360 + Math.round(r() * 900),
      w: 5 + Math.round(r() * 5),
      h: 9 + Math.round(r() * 9),
      color: palette[Math.floor(r() * palette.length)],
      round: r() > 0.7,
    }));
  }, [col, tid]);
  return (
    <div aria-hidden="true" style={{
      position: "absolute", inset: 0, overflow: "hidden",
      pointerEvents: "none", zIndex: 2, borderRadius: "inherit",
    }}>
      <style>{CONFETTI_CSS}</style>
      {pieces.map((p) => (
        <span key={p.id} style={{
          position: "absolute", top: 0, left: `${p.left}%`,
          width: p.w, height: p.h,
          background: p.color,
          borderRadius: p.round ? "50%" : 1,
          animation: `bcConfettiFall ${p.dur}s linear ${p.delay}s infinite`,
          // Read by the keyframes, so each strip drifts and spins its own way
          // instead of eighteen identical ones falling in a column.
          "--bc-drift": `${p.drift}px`,
          "--bc-spin": `${p.spin}deg`,
        }} />
      ))}
    </div>
  );
}

// ── How wide the name lane has to be ────────────────────────────
// MEASURED, not estimated — see `useNameLane` below. What follows is only the
// fallback for the first paint and for a test environment that lays nothing
// out, and it is deliberately generous: an AVERAGE character width is exactly
// the wrong tool here, because a roster has whatever letters it has and "WOODY
// W" is half again as wide per character as "TIM C". Being over costs a little
// dead space for one frame; being under cuts a man's name off on a television.
const nameLaneEm = (n) => Math.max(4, (Number(n) || 0) * 0.95);

// EVERY name on the side, set invisibly in exactly the type the rows use, and
// the widest of them read back. Exact at any viewport, and it re-reads itself
// when the type changes size — the whole scale on this screen is vw/vh, so a
// resized window is a resized name.
//
// ALL OF THEM, AND THAT IS THE POINT. It used to measure the single longest
// name and size the lane to that, where "longest" meant the most CHARACTERS —
// which is the same mistake, one level up, as the 0.75em-a-character estimate
// this replaced. "Curtis D" and "Wesley B" are both eight characters and
// twelve pixels apart, so a side holding both sized its lane to Curtis and cut
// Wesley off. On a television, in front of the room, on the one screen nobody
// can correct in the moment.
//
// A shrink-to-fit box stacked with every name is as wide as the widest line in
// it, so the browser does the comparison in the only unit that matters.
//
// The ruler is wired by a CALLBACK REF rather than an effect with a dependency
// list. The rows it measures are behind `revealed`, so the node appears and
// disappears during the round; a callback ref runs exactly when that happens,
// where an effect keyed on the names would have been asked to re-run at a
// moment its dependency had not changed.
//
// Falls back to the estimate above when there is nothing to measure: the first
// paint, and jsdom, which has no layout and no ResizeObserver.
function useNameLane(names) {
  const [px, setPx] = useState(0);
  const watching = useRef(null);
  const probe = useCallback((el) => {
    if (watching.current) { watching.current.disconnect(); watching.current = null; }
    if (!el) return;
    // +2 so sub-pixel rounding can never take the last letter.
    const read = () => {
      const w = Math.ceil(el.getBoundingClientRect().width);
      if (w > 0) setPx((prev) => (prev === w + 2 ? prev : w + 2));
    };
    read();
    if (typeof ResizeObserver !== "function") return;
    watching.current = new ResizeObserver(read);
    watching.current.observe(el);
  }, []);
  const longest = (names || []).reduce((a, b) => (b.length > a.length ? b : a), "");
  return [px ? `${px}px` : `${nameLaneEm(longest.length)}em`, probe];
}

function BallRow({ strokes, name, net, par, tid, counted, nameLane, compact }) {
  const col = teamColor(tid);
  const rel = ballRel(net, par);
  const under = rel != null && rel < 0;
  const rail = compact ? "3px" : RAIL;
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      gap: compact ? 6 : "clamp(4px, 0.6vw, 12px)",
      padding: compact ? "2px 8px" : `${T.rowPad} clamp(6px, 0.8vw, 16px)`,
      borderRadius: compact ? 5 : "clamp(4px, 0.5vw, 10px)",
      background: counted ? `${col}${ALPHA.tint}` : "transparent",
      borderLeft: `${rail} solid ${counted ? col : `${BC.bdr}${ALPHA.line}`}`,
      borderRight: `${rail} solid transparent`,
      minWidth: 0,
    }}>
      <div style={{
        width: nameLane, flexShrink: 1, minWidth: 0, textAlign: "left",
        fontSize: compact ? 13 : T.rowName, fontWeight: 800, letterSpacing: 0.4,
        color: counted ? BC.t1 : BC.t2,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>{name}</div>
      <StrokeDots strokes={strokes} compact={compact} />
      <div style={{
        width: "2.7em", flexShrink: 0, textAlign: "center", whiteSpace: "nowrap",
        fontSize: compact ? 15 : T.rowScore, fontWeight: 800, lineHeight: 1,
        color: under ? BC.danger : counted ? BC.t1 : BC.t2,
      }}>{rel == null ? "·" : fmtRel(rel)}</div>
    </div>
  );
}

// ── One side of the hole ─────────────────────────────────────────
// `revealed` is whether this side's captain has spoken. Until he has there
// are no names and no numbers in the page at all — see the note at the top.
//
// THE GRID IS FIXED, AND SO IS THE ORDER. Eight men, four across and two
// down, alphabetical, every hole for eighteen holes. It used to be two flex
// rows — the balls that counted on top, the ones that missed underneath, each
// sized to its own row — so a side's grid re-flowed on every hole: six across
// then two, five then three, and a man moved three places between hole 4 and
// hole 5 depending on how he putted.
//
// That is unreadable from the back of a room, and it is the wrong thing to
// spend the animation on. What the room is watching for is WHOSE BALL
// COUNTED, and that reads far better as a square lighting up in a place the
// eye already knows than as a name migrating between two rows. Position is
// now constant and the highlight carries all of the meaning.
//
// Alphabetical rather than roster order for the same reason: roster order is
// whatever the director typed, it differs between the two sides, and it is
// not a thing anybody can look a name up in. A is at the top left.
function SideColumn({ tid, teamName, score, balls, par, countN, compact, revealed, won, waitingOn, celebrate }) {
  const col = teamColor(tid);
  // ── The number, AGAINST PAR ──
  // It used to be the side's raw total — 25, 18 — which is the sum of six or
  // seven net balls and means nothing to anybody without doing the same sum
  // in their head first. Nobody in the room knows that six pars on this hole
  // is 24. They all know what −3 is.
  //
  // Measured against N pars, where N is the number of balls that made the
  // number, so a best-6 hole is compared with six pars and a best-7 hole with
  // seven. The captain's prompt band is computed the same way (see
  // lib/countdownPrompt) — one arithmetic, so the screen and the man reading
  // it out cannot disagree by a shot.
  const need = Number.isFinite(countN) && countN > 0
    ? countN
    : balls.filter((b) => b.counted && b.net != null).length;
  const rel = revealed ? relToPar(score, par, need) : null;
  // The name lane, one width for all eight rows so the column has an edge to
  // be read down, and no wider than the longest name on the side so the trio
  // has no slack to sit off-centre in. See BallRow and useNameLane.
  const names = useMemo(() => (balls || []).map((b) => b.name || ""), [balls]);
  const [nameLane, probeRef] = useNameLane(names);
  return (
    <div style={{
      // On a television each side claims half the width and stretches to fill
      // the height. On a PHONE they are stacked, and stretching makes each one
      // half a screen tall with a column of black under an eight-man grid that
      // is four rows deep. Content height, top of the screen down.
      flex: compact ? "0 0 auto" : 1,
      // A containing block for the confetti, which is an absolute layer over
      // this card and must be clipped by it — the celebration belongs to one
      // side, so it may not spill across the screen.
      position: "relative", overflow: "hidden",
      minWidth: 0, display: "flex", flexDirection: "column",
      alignItems: "center", gap: compact ? 4 : "clamp(2px, min(0.7vw, 1.1vh), 14px)",
      // The bottom is deliberately deeper than the top: the eighth name sits
      // against it, and the top edge has the team's own name above it doing
      // the same job.
      padding: compact
        ? "6px 10px 10px"
        : `clamp(3px, min(1vw, 1.6vh), 20px) clamp(4px, 0.8vw, 16px) clamp(6px, ${vwh(0.8)}, 20px)`,
      borderRadius: "clamp(8px, 1vw, 20px)",
      background: won && revealed ? `${col}${ALPHA.wash}` : "transparent",
      border: `2px solid ${won && revealed ? `${col}${ALPHA.line}` : "transparent"}`,
      transition: "background 400ms ease, border-color 400ms ease",
    }}>
      {celebrate && <Confetti tid={tid} />}
      {/* The name above the number, centred, on both screens. The phone used
          to run them as one scoreboard line — name left, figure right — which
          was bought to make room for the chip grid underneath. The grid is
          gone and the line went with it: a captain glancing down at his phone
          and then up at the wall should be looking at the same thing twice.

          A COLUMN, and its children have to be CENTRED in it — `baseline` down
          a column is a left edge, which is how the name and the number once
          came to sit against the left of a 16:9 screen with the rows centred
          underneath them. */}
      <div style={{
        display: "flex", width: "100%",
        alignItems: "center", justifyContent: "center", flexDirection: "column",
      }}>
        <div style={{
          maxWidth: "100%",
          fontSize: compact ? 14 : T.sideName, fontWeight: 800, letterSpacing: 1, color: col,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{teamName}</div>
        <div style={{
          fontSize: compact ? 27 : T.side, fontWeight: 800, lineHeight: 0.95, color: col,
          flexShrink: 0,
          opacity: revealed ? 1 : 0,
          transform: revealed ? "none" : "translateY(0.12em) scale(0.94)",
          transition: "opacity 380ms ease, transform 380ms cubic-bezier(.2,.7,.3,1)",
        }}>{revealed && score != null ? fmtRel(rel) : "—"}</div>
      </div>
      {/* A side still waiting on its captain says so, rather than sitting
          under a dash that reads the same as a hole nobody posted. This is
          the half of the screen the room is looking at while he talks. */}
      {!revealed && (
        <div style={{
          fontSize: compact ? 11 : T.promptSm, fontWeight: 800, letterSpacing: "0.22em",
          color: BC.t3, textAlign: "center", lineHeight: 1.5,
          padding: compact ? "6px 0" : 0,
        }}>{waitingOn || "WAITING"}</div>
      )}
      {/* ONE list, on both screens. The ORDER is alphabetical, and it is the
          same order on hole 18 as it was on hole 1 — a man keeps his line, and
          the highlight moving is the only thing that changes. */}
      {revealed && (
        <div style={{
          display: "flex", flexDirection: "column", width: "100%",
          gap: compact ? 2 : T.rowGap, position: "relative",
        }}>
          {/* The ruler. Out of flow and invisible, holding EVERY name on the
              side, set in exactly the type the rows are set in. A shrink-to-fit
              box is as wide as its widest line, so what comes back is the width
              the lane has to be — measured, and in pixels, which is the only
              unit that can tell "Curtis D" from "Wesley B". See useNameLane. */}
          <div ref={probeRef} aria-hidden="true" style={{
            position: "absolute", left: 0, top: 0, visibility: "hidden",
            pointerEvents: "none", whiteSpace: "nowrap",
            fontSize: compact ? 13 : T.rowName, fontWeight: 800, letterSpacing: 0.4,
          }}>{names.map((n, i) => <div key={`${n}-${i}`}>{n}</div>)}</div>
          {/* One lane width for the whole side, off the longest name on it —
              which is what makes the trio hug its content and sit optically in
              the middle rather than floating in a share of the column. See the
              note on BallRow. */}
          {balls.map((b) => (
            <BallRow key={b.pid} {...b} par={par} tid={tid} nameLane={nameLane} compact={compact} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Which screen is this on? ─────────────────────────────────────
// The countdown is TWO screens, not one page that stretches. A television
// across a room and a captain's phone in his hand want opposite layouts, and
// the clamps that made one page serve both served neither: eight names four
// across in half of 393px is "CHRI…", eighteen tap targets across the same
// 393px is 20px each, and a page laid out for 16:9 leaves a phone with a
// column of dead black between the header and the grid.
//
// So this measures, and the render forks. Under 900px is a phone — including
// a phone turned sideways, which is 852 wide and 393 tall and cannot hold the
// television layout either.
//
// Measured rather than done in a media query because what changes is the
// STRUCTURE — sides stacked instead of side by side, the strip in two rows
// instead of one, the controls in a column — and that is JSX, not CSS.
const PHONE_MAX = 900;

function useCompact() {
  const [compact, setCompact] = useState(
    () => (typeof window === "undefined" ? false : window.innerWidth < PHONE_MAX),
  );
  useEffect(() => {
    const read = () => setCompact(window.innerWidth < PHONE_MAX);
    read();
    window.addEventListener("resize", read);
    window.addEventListener("orientationchange", read);
    return () => {
      window.removeEventListener("resize", read);
      window.removeEventListener("orientationchange", read);
    };
  }, []);
  return compact;
}

// ══════════════════════════════════════════════════════════════════
//  FinalCountdown
// ══════════════════════════════════════════════════════════════════
//  `result` is scored off `countdownHoleData`, so `holes[through - 1]` is
//  the last one with anything in it. `totals` / `toWin` / `clincher` are
//  the cup counted off that same pass — every point revealed so far,
//  including this round's — which is what makes the bar across the top
//  move as the holes come out. The scoreboard's own cup bar does not; see
//  the note above.
export function FinalCountdown({
  match, result, getScore, holePars, holeHcps, tPlayers, teams, courseName, formatLabel,
  reveal, ownResult, ownGetScore, totals, toWin, clincher,
  isDirector = false, captainSide = null, onAdvance, onSetHole, onClose,
}) {
  const compact = useCompact();
  const { nameOf } = playerLookup(tPlayers);
  const { A: outA, B: outB } = reveal || { A: 0, B: 0 };
  // ── The hole on screen ───────────────────────────────────────────
  // The furthest a captain has turned over — a hole sits HALF open while one
  // of them talks, which is why this is the max of the two counters and not
  // the minimum — or the director's cursor, when he has moved the room on
  // ahead of both of them.
  //
  // That last case is the cleared board: hole 7 is finished, everybody has
  // looked at it, and the director taps ▸. The screen goes to hole 8 with
  // nothing on it and both sides waiting to be told. Before the cursor
  // existed the only way off hole 7 was for a captain to reveal half of hole
  // 8, so the result was wiped on somebody else's cue and there was no beat
  // in between. See countdownHole in lib/reveal.
  const revealedHole = Math.max(outA, outB);
  const hole = Math.max(reveal?.cursor || 0, revealedHole);
  const holeIdx = hole - 1;
  const shown = { A: outA >= hole && hole > 0, B: outB >= hole && hole > 0 };
  const bothOut = shown.A && shown.B;
  // Wholly out, which is what the strip counts and what "is it over" means.
  const settled = Math.min(outA, outB);

  // Who may move which counter. A director drives both; a captain drives his
  // own and nothing else. Everybody else is watching a television.
  const drives = (side) => !!onAdvance && (isDirector || captainSide === side);
  const canDrive = drives("A") || drives("B");

  // A side may be AT MOST one hole ahead of the other, which is the ceremony
  // written down: one hole, both stories, next hole. Without it a captain who
  // kept tapping would run to 18 while the other side was still on 4 — and the
  // screen shows `max(A, B)`, so the man behind would then tap his way through
  // holes nobody could see. `sidesPending` is the same question asked in
  // lib/reveal, and the security rules hold the same line so a second phone
  // cannot get round it (see captainRevealing in firestore.rules).
  const pending = sidesPending({ sealed: true, reveal_a: outA, reveal_b: outB });
  const due = (side) => pending.includes(side);

  // ── Clearing the screen ──────────────────────────────────────────
  // The director's alone. NEXT is offered only once both captains have told
  // this hole — advancing past a side that has not spoken would skip its eight
  // balls entirely and they would never come back on their own. BACK is the
  // undo of it, and only while the clear is still a clear: once a captain has
  // revealed into the new hole, taking the room back would be un-showing
  // something it has already watched, which is what the reveal control in the
  // row below is for.
  const canNext = isDirector && !!onSetHole && hole > 0 && hole < HOLE_COUNT && bothOut;
  const canBack = isDirector && !!onSetHole && hole > revealedHole;
  const goNext = useCallback(() => { if (canNext) onSetHole(hole + 1); }, [canNext, onSetHole, hole]);
  const goBack = useCallback(() => { if (canBack) onSetHole(hole - 1); }, [canBack, onSetHole, hole]);

  const revealSide = useCallback((side) => {
    if (!onAdvance) return;
    const next = nextHoleForSide({ sealed: true, reveal_a: outA, reveal_b: outB }, side);
    if (next == null) return;
    if (!sidesPending({ sealed: true, reveal_a: outA, reveal_b: outB }).includes(side)) return;
    onAdvance(side, next);
  }, [outA, outB, onAdvance]);

  // One step back, for the mistap. It takes the LEADING side back, which is
  // the one that just moved — walking the trailing side backwards would open
  // a gap nobody asked for.
  const back = useCallback(() => {
    // Undo the clear first: it is the step that just happened, and it is the
    // one that un-does cleanly. Only once there is no clear left to take back
    // does this un-reveal anything.
    if (canBack) { goBack(); return; }
    if (!onAdvance) return;
    if (outA > outB && drives("A")) onAdvance("A", outA - 1);
    else if (outB > outA && drives("B")) onAdvance("B", outB - 1);
    else if (outA === outB && outA > 0) {
      if (drives("A")) onAdvance("A", outA - 1);
      else if (drives("B")) onAdvance("B", outB - 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canBack, goBack, outA, outB, onAdvance, isDirector, captainSide]);

  // ── NOTHING REVEALS A SIDE BUT ITS OWN BUTTON ────────────────────
  // The whole screen used to be one tap target: a click anywhere on the
  // background turned over the next side that was due. It was written as a
  // convenience for whoever was driving, and it is the wrong convenience on
  // this screen — the ONE screen in the app where a stray tap cannot be taken
  // back. A phone in a pocket, a laptop trackpad brushed while somebody
  // reaches past it, a hand steadying the machine on a table: any of those
  // turned over eight balls in front of the room before the captain had said a
  // word. Nobody would even know what they had touched.
  //
  // So a reveal now has exactly one door, and it is the button with the team's
  // name on it. The keyboard keeps the PACING — clear the board, take the
  // clear back — because neither of those shows anything that was not already
  // on screen, and a director driving from a laptop should not have to reach
  // for a trackpad between every hole.

  // Keyboard, for the year the laptop is within reach. It moves the room
  // between holes and nothing else — see the note above. The phone is still
  // the primary control.
  const keyRef = useRef({ goNext, goBack, onClose });
  useEffect(() => { keyRef.current = { goNext, goBack, onClose }; }, [goNext, goBack, onClose]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === " " || e.key === "ArrowRight" || e.key === "Enter" || e.key === "PageDown") {
        e.preventDefault(); keyRef.current.goNext();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault(); keyRef.current.goBack();
      } else if (e.key === "Escape") {
        keyRef.current.onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The screen must not sleep between holes 4 and 5 while the room argues
  // about hole 4. Best-effort by construction: no wake lock on this browser
  // is a television that dims, not a countdown that fails.
  useEffect(() => {
    let lock = null, cancelled = false;
    navigator.wakeLock?.request("screen").then((l) => {
      if (cancelled) l.release(); else lock = l;
    }).catch(() => {});
    return () => { cancelled = true; lock?.release?.().catch(() => {}); };
  }, []);

  const hr = holeIdx >= 0 ? result?.holes?.[holeIdx] : null;
  const holeValue = result?.holePoints
    ? (holeIdx < 9 ? result.holePoints.front : result.holePoints.back)
    : null;
  const countN = result?.counting?.[holeIdx] ?? null;
  const { A: tA, B: tB } = teams;

  // Every ball on the hole, both sides, in roster order with the ones that
  // made the number flagged. `counted` comes off the engine (see
  // scoring.js) — this screen does not decide which balls counted, it only
  // says so loudly.
  //
  // Pointed at a DIFFERENT pass for the captain's own prompt: `ownResult` is
  // his side scored off the uncut map, so it has the hole he is about to
  // reveal. Same builder either way, so the eight chips the room sees and the
  // two lines he reads out cannot describe different balls.
  const ballsFor = (tid, idx = holeIdx, src = null) => {
    const res = src?.result || result;
    const read = src?.getScore || getScore;
    const pids = tid === "A" ? match.teamA : match.teamB;
    const made = res?.holes?.[idx]?.counted?.[tid] || null;
    return (pids || []).map((pid) => {
      const gross = read(pid, idx) || null;
      const strokes = res?.strokeMaps?.[pid]?.[idx] || 0;
      return {
        pid, name: nameOf(pid), gross, strokes,
        net: gross == null || gross <= 0 ? null : gross - strokes,
        // No counted list means every ball made the number (a Team Total, a
        // Singles) — dimming all of them would be a lie about the format.
        counted: made ? made.includes(pid) : true,
      };
    })
      // Alphabetical, so a man is in the same square on hole 18 as he was on
      // hole 1. See the note on SideColumn's grid for why that matters more
      // than sorting the counted ones to the front.
      .sort((x, y) => x.name.localeCompare(y.name));
  };

  // ── What the captain reads out ───────────────────────────────────
  // His own side's NEXT hole — the one he is about to turn over — off the
  // uncut own-side pass. Null for a director who captains nothing, and null
  // once his side has no holes left. See lib/countdownPrompt.
  const myNext = captainSide ? nextHoleForSide({ sealed: true, reveal_a: outA, reveal_b: outB }, captainSide) : null;
  const myPrompt = (() => {
    // ── Never on the shared screen ──
    // The commentary is a script for one man, and on the television it is not
    // clutter — it is a LEAK. The card holds the hole NOBODY HAS SEEN YET, on
    // purpose, because he is about to read it out; putting that on a forty-inch
    // panel in front of the room is the one thing the whole evening is built to
    // prevent, and it would happen without a single tap.
    //
    // Signing the television in as a guest already keeps `captainSide` null and
    // the card away. That is a setup step somebody has to get right on the
    // night, in a room, once a year — and if they get it wrong by signing in as
    // a captain instead, the failure is silent and total. So the screen refuses
    // on its own, off the same measurement the layout forks on.
    //
    // The cost is a captain driving from a laptop, who keeps his BUTTON and
    // loses his card. That is the right way round: a captain narrating to a
    // room is holding a phone, and the alternative is trusting a login on the
    // one screen that cannot be untold.
    if (!compact) return null;
    if (!captainSide || myNext == null || !ownResult) return null;
    // Not his go. The other captain is talking and this band would be him
    // reading ahead over the top of it.
    if (!sidesPending({ sealed: true, reveal_a: outA, reveal_b: outB }).includes(captainSide)) return null;
    const idx = myNext - 1;
    const src = { result: ownResult, getScore: ownGetScore || getScore };
    const own = ownResult.holes?.[idx];
    const scoreAt = (h) => (captainSide === "A" ? h?.aScore : h?.bScore);
    const holeAt = (i) => ({
      balls: ballsFor(captainSide, i, src),
      par: holePars?.[i],
      countN: ownResult.counting?.[i] ?? null,
      score: scoreAt(ownResult.holes?.[i]),
    });
    // ── The window the nuggets may look at ──
    // Holes 0 … idx-1, which is exactly the holes his side has already turned
    // over — `myNext` is one past his own counter, so `idx` IS that counter.
    //
    // This cap is the whole safety of the feature. His phone holds his side's
    // entire round, uncut, because a team is never hidden from itself; if the
    // nuggets read all of it, "the first net eagle of the round" on the third
    // hole would quietly be a promise that no eagle is coming, on an evening
    // built on nobody knowing what is coming. lib/countdownPrompt has no way
    // to reach past what it is handed, and this is where the handing happens.
    const history = Array.from({ length: idx }, (_, i) => holeAt(i));
    return {
      hole: myNext,
      par: holePars?.[idx] ?? null,
      si: holeHcps?.[idx] ?? null,
      ...holePrompt({
        balls: ballsFor(captainSide, idx, src),
        par: holePars?.[idx],
        countN: ownResult.counting?.[idx] ?? null,
        score: scoreAt(own),
        teamName: (captainSide === "A" ? tA : tB).name,
        history,
      }),
    };
  })();

  const pct = (v) => {
    const scale = Math.max(toWin * 2 - 1, totals.A + totals.B, 1);
    return Math.min(100, (v / scale) * 100);
  };

  const shell = (children) => (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 4000, background: BC.bg, color: BC.t1,
        fontFamily: FONT, display: "flex", flexDirection: "column",
        padding: `clamp(8px, ${vwh(1.2)}, 26px)`, gap: `clamp(6px, ${vwh(0.9)}, 18px)`,
        userSelect: "none", overflow: "hidden",
      }}>
      {children}
    </div>
  );

  // ── The cup itself, behind the hole ──────────────────────────────
  // The same trophy silhouette the sign-in screen puts behind the title, for
  // the same reason: it is the thing in the room and this is the hour it gets
  // handed over. Nothing on this screen names the Bourbon Cup otherwise — two
  // team names, a hole number and eighteen cells — and a television somebody
  // walks past should say what it is looking at.
  //
  // IT IS SIZED TO THE STAGE, NOT THE SCREEN. It was inset:0 on the backdrop,
  // full viewport — so the cup band across the top and the controls along the
  // bottom, both opaque, sat ON it and cut the trophy off at the handles. A
  // watermark with its top sliced away does not read as a trophy, it reads as
  // a smudge. `contain` inside the stage — the band between the two headers,
  // which is the only region of this screen the layout leaves empty — fits the
  // whole cup with nothing over it. Nothing is measured: the stage is a flex
  // child, so it already knows how much room the headers left it.
  //
  // IT FADES WHEN THE HOLES START. The sign-in screen carries it at full
  // strength because there is nothing else on that screen; here there are
  // eight names a side over it, and a watermark that competes with a name is
  // one that made a name harder to read from the back of a room.
  //
  // Behind by construction: it is the only positioned child of the stage, and
  // the stage's content sits in a `relative` layer above it. Painting order
  // alone would have put the image on top — a positioned element paints above
  // static siblings whatever the source order.
  const stage = (inner, children) => (
    <div style={{ position: "relative", flex: "1 1 0", minHeight: 0 }}>
      <img src={TROPHY_SILHOUETTE} alt="" style={{
        position: "absolute", inset: 0, width: "100%", height: "100%",
        objectFit: "contain",
        opacity: hole <= 0 ? 0.34 : 0.1,
        filter: "brightness(1.4) contrast(1.2)",
        transition: "opacity 900ms ease",
        pointerEvents: "none", userSelect: "none", zIndex: 0,
      }} />
      <div style={{ position: "relative", zIndex: 1, height: "100%", ...inner }}>
        {children}
      </div>
    </div>
  );

  // ── The cup, across the top ────────────────────────────────────
  // The centre and the most important part of the whole thing. Eighteen holes
  // are turned over underneath it and not one of them is interesting except
  // for what it does to these two numbers — so it is a CARD of its own rather
  // than three columns of loose text above a rule, and it holds the biggest
  // type on the screen after the hole number itself.
  //
  // TO WIN THE CUP, in gold, dead centre. It used to read "TO WIN" in the same
  // grey as everything else, which from across a room is a label on a number
  // nobody could place — and it is the one number in the building that says
  // what the evening is for. The gold is the app's own accent and it is used
  // here and nowhere else on this screen, so the eye finds it without being
  // sent.
  const cupBar = (
    <div style={{
      flexShrink: 0,
      background: BC.card,
      border: `1px solid ${BC.bdr}${ALPHA.line}`,
      borderRadius: "clamp(8px, 1vw, 20px)",
      padding: compact ? "9px 12px" : `clamp(6px, ${vwh(0.9)}, 18px) clamp(10px, 1.4vw, 28px)`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "clamp(8px, 1.5vw, 30px)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: T.cupName, fontWeight: 800, letterSpacing: 1.4, color: BC.teamA, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tA.name}</div>
          <div style={{ fontSize: T.cupPts, fontWeight: 800, lineHeight: 1, color: BC.teamA }}>{fmtPts(totals.A)}</div>
        </div>
        <div style={{ textAlign: "center", flexShrink: 0 }}>
          {/* Shortened on a phone. "TO WIN THE CUP" at 11px with a third of an
              em of tracking is most of a 393px row on its own, and the two
              totals it is supposed to sit between would have nowhere to go. */}
          <div style={{
            fontSize: compact ? 9 : T.terms, fontWeight: 800,
            letterSpacing: "0.28em", color: BC.t3, whiteSpace: "nowrap",
          }}>{compact ? "TO WIN" : "TO WIN THE CUP"}</div>
          <div style={{
            fontSize: compact ? 22 : T.cupGoal, fontWeight: 800, lineHeight: 1.1,
            color: BC.amberInk,
          }}>{fmtPts(toWin)}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0, textAlign: "right" }}>
          <div style={{ fontSize: T.cupName, fontWeight: 800, letterSpacing: 1.4, color: BC.teamB, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tB.name}</div>
          <div style={{ fontSize: T.cupPts, fontWeight: 800, lineHeight: 1, color: BC.teamB }}>{fmtPts(totals.B)}</div>
        </div>
      </div>
      {/* Each side fills from its own end, and the GOLD TICKS are where that
          side's fill has to reach. They sit at `toWin` measured from each end,
          which on a full card is a shade past the middle — which is the truth
          of the format and worth showing: both marks cannot be reached, and
          the pair of them straddling the centre is what says so. The plain
          halfway line that used to be there said something weaker and looked
          the same. */}
      <div style={{ position: "relative", height: `clamp(6px, ${vwh(0.9)}, 18px)`, borderRadius: 99, background: BC.inp, overflow: "hidden", marginTop: `clamp(4px, ${vwh(0.6)}, 12px)` }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct(totals.A)}%`, background: BC.teamA, transition: "width 700ms cubic-bezier(.2,.7,.3,1)" }} />
        <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: `${pct(totals.B)}%`, background: BC.teamB, transition: "width 700ms cubic-bezier(.2,.7,.3,1)" }} />
        <div style={{ position: "absolute", left: `${pct(toWin)}%`, top: 0, bottom: 0, width: 3, marginLeft: -1.5, background: BC.amber }} />
        <div style={{ position: "absolute", right: `${pct(toWin)}%`, top: 0, bottom: 0, width: 3, marginRight: -1.5, background: BC.amber }} />
      </div>
    </div>
  );

  // ── The eighteen ───────────────────────────────────────────────
  // Coloured by WHO WON each hole, and by nothing else. Three states and
  // three readings:
  //
  //   a team's colour   they took the hole
  //   grey, filled      it was tied
  //   empty, outlined   not turned over yet
  //
  // The tie used to be a diagonal split in both teams' colours, on the
  // reasoning that grey was already "we haven't seen it" and the two must not
  // read alike. They still must not, and they still don't — one is filled and
  // one is hollow — but the gradient was buying that at the price of the
  // strip's actual job. From the back of a room eighteen cells in two colours
  // read as a scoreboard; the same eighteen with four of them striped read as
  // a loading bar, and the thing everybody is counting was the thing hardest
  // to count.
  //
  // A hole is not coloured until BOTH captains have spoken — there is no
  // winner before that — which is why this counts `settled` and not the hole
  // on screen.
  //
  // On a PHONE it is two rows of nine. Eighteen across 393px is a 20px cell —
  // unreadable, and untappable, which matters because a director navigating
  // the reveal does it from here.
  const stripCell = (i) => {
    const out = i < settled;
    const h = result?.holes?.[i];
    const w = out ? h?.winner : null;
    const tied = out && !w && h?.played;
    const cur = i === holeIdx;
    // ── The strip REWINDS. It does not fast-forward. ──
    // Tapping a hole sets the reveal to it, both sides at once, and a director
    // is the only one offered it — a captain has his own button and no
    // business moving the other side (the rules refuse it too; see
    // captainRevealing in firestore.rules).
    //
    // It used to accept ANY cell, which made the strip a way to turn over
    // every hole between here and there in one tap. That is the one thing this
    // whole screen exists to prevent, and it is unrecoverable in the way that
    // matters: a mistap on 18 does not show a wrong number somebody can
    // correct, it shows the ROOM the end of the tournament, and no amount of
    // tapping back un-sees it. Eighteen live grenades along the bottom of the
    // screen, on the one night everybody is reaching for the same laptop.
    //
    // So a cell is a control only if it is BEHIND the hole on screen. Backward
    // is the repair the jump was added for — a stray tap took the room to hole
    // 7 and somebody has to take it back — and backward reveals nothing,
    // because every hole it lands on has already been seen. Forward is one
    // hole at a time, through a captain's own button, which is the ceremony.
    //
    // `hole` and not `settled`: with A on 7 and B on 6, hole 7 itself must
    // stay inert, or "going back" to it would turn over B's side of it.
    const jump = isDirector && onAdvance && i + 1 < hole
      ? () => onAdvance(null, i + 1)
      : null;
    const Cell = jump ? "button" : "div";
    return (
      <Cell key={i} onClick={jump || undefined} style={{
        flex: 1, minWidth: 0, textAlign: "center", fontFamily: FONT,
        padding: compact ? "9px 0" : `clamp(2px, ${vwh(0.35)}, 8px) 0`,
        borderRadius: "clamp(3px, 0.4vw, 8px)",
        fontSize: compact ? 14 : T.strip, fontWeight: 800,
        background: w ? teamColor(w) : tied ? BC.t3 : out ? BC.inp : "transparent",
        border: `1px solid ${cur ? BC.amber : out ? "transparent" : `${BC.bdr}${ALPHA.line}`}`,
        outline: cur ? `2px solid ${BC.amber}` : "none",
        color: w || tied ? BC.bg : out ? BC.t2 : BC.t3,
        opacity: out ? 1 : 0.5,
        cursor: jump ? "pointer" : "default",
        transition: "background 400ms ease",
      }}>{i + 1}</Cell>
    );
  };

  const stripRow = (from, to) => (
    <div style={{ display: "flex", gap: compact ? 4 : "clamp(2px, 0.3vw, 6px)" }}>
      {Array.from({ length: to - from }, (_, k) => stripCell(from + k))}
    </div>
  );

  const strip = (
    <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: compact ? 4 : 0 }}>
      {compact
        ? <>{stripRow(0, 9)}{stripRow(9, HOLE_COUNT)}</>
        : stripRow(0, HOLE_COUNT)}
    </div>
  );

  // ── The controls ─────────────────────────────────────────────────
  // One button per side this viewer may move, so a captain sees exactly one
  // and a director sees the pair. A side already out on this hole shows what
  // it did rather than a dead button — the room is looking at the numbers, and
  // he needs to know his tap landed.
  const sideBtn = (side) => {
    const team = side === "A" ? tA : tB;
    const col = teamColor(side);
    const next = nextHoleForSide({ sealed: true, reveal_a: outA, reveal_b: outB }, side);
    const done = next == null;
    // Not his turn: his side is a hole up and the other captain is talking.
    // The button says whose it is rather than greying out silently, because
    // from where he is standing "nothing happened" and "it isn't your go" are
    // the same tap.
    const held = !done && !due(side);
    const waiting = !shown[side] && hole > 0;
    return (
      <button key={side} onClick={() => revealSide(side)} disabled={done || held} style={{
        flex: 1, minWidth: 0,
        padding: compact ? "15px 10px" : `clamp(6px, ${vwh(0.9)}, 18px) clamp(6px, 0.8vw, 16px)`,
        borderRadius: "clamp(6px, 0.8vw, 16px)",
        background: done || held ? BC.inp : `${col}${ALPHA.tint}`,
        border: `2px solid ${done || held ? BC.bdr : col}`,
        color: done || held ? BC.t3 : BC.t1, fontFamily: FONT,
        fontSize: compact ? 15 : T.btn, fontWeight: 800, letterSpacing: compact ? 0.4 : 1,
        cursor: done || held ? "not-allowed" : "pointer",
        // The label wraps on a phone rather than truncating. "REVEAL SHOT …"
        // is not a button — it is a button with the answer cut off it.
        whiteSpace: compact ? "normal" : "nowrap",
        overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.25,
      }}>
        {done ? `${team.name.toUpperCase()} · ALL OUT`
          : held ? `WAITING ON ${(side === "A" ? tB : tA).name.toUpperCase()}`
          : `${waiting ? "▸ " : ""}REVEAL ${team.name.toUpperCase()} · HOLE ${next}`}
      </button>
    );
  };

  // ── The captain's card ───────────────────────────────────────────
  // Laid out in the order he SAYS it, top to bottom:
  //
  //   "…with contributions from Paul, Dave and John, and the first net eagle
  //    of the round — the Mash Brothers are three under."
  //
  // Which is why the team and its number are at the BOTTOM. They were at the
  // top, beside the hole number, and that is the order a scoreboard uses: the
  // answer first, the detail under it. This card is not a scoreboard. It is a
  // script, and the number is the line he lands on — reading it out means
  // starting at the bottom of the card, going up for the names, and coming
  // back down, every hole, eighteen times, in front of everybody.
  //
  // So: the hole he is on, the men who made it, the fun of it, and then the
  // number. The rule sits above the number rather than above the nuggets,
  // because the split that matters on a card read aloud is BUILD-UP from
  // PAYOFF — the contributions and the stats are one breath ("…from Paul,
  // Dave and John, AND the first eagle of the round…") and the rule between
  // them was a pause he does not take.
  const captainBand = myPrompt ? (
    <div style={{
      flexShrink: 0, padding: "clamp(6px, 0.9vw, 18px) clamp(9px, 1.2vw, 24px)",
      borderRadius: "clamp(6px, 0.8vw, 16px)",
      background: `${teamColor(captainSide)}${ALPHA.wash}`,
      border: `2px solid ${teamColor(captainSide)}${ALPHA.line}`,
    }}>
      {/* No "YOU'RE UP". His phone put up a card, it is his side's colour,
          and it carries a button with his team's name on it — he knows. It
          was a line of the app talking to the man holding the phone on a
          card whose whole job is to be read out to somebody else. */}
      {/* ── The hole, then what is on it ──
          Two lines, not one. It ran as "HOLE 8 · PAR 5 · SI 9" in one grey
          caption, which puts the number he is announcing — the first thing out
          of his mouth, and the one thing on the card he has to be sure of at a
          glance — in the same weight and the same colour as the two facts
          about it. WHICH HOLE is the heading; par and stroke index are the
          detail under it. */}
      <div style={{ fontSize: T.cardHole, fontWeight: 800, letterSpacing: "0.08em", color: BC.t1, lineHeight: 1.05 }}>
        HOLE {myPrompt.hole}
      </div>
      <div style={{ fontSize: T.cardLabel, fontWeight: 800, letterSpacing: "0.16em", color: BC.t3, marginTop: "0.15em" }}>
        {[
          myPrompt.par ? `PAR ${myPrompt.par}` : null,
          // The stroke index too. It is why a man is getting a shot on this
          // hole and not the last one, which is the question the room asks the
          // moment a net eagle is announced — and the card is the only thing
          // in his hand that can answer it.
          myPrompt.si ? `HANDICAP ${myPrompt.si}` : null,
        ].filter(Boolean).join(" · ")}
      </div>

      {/* The contributions, then the fun of them. Still told apart by colour —
          one is this hole, the other is the round it sits in — but read as one
          run of lines, because that is how they are spoken. */}
      <div style={{ marginTop: "0.35em", display: "flex", flexDirection: "column", gap: "0.2em" }}>
        {myPrompt.notes.map((n) => (
          <span key={n} style={{ fontSize: T.cardLine, fontWeight: 700, color: BC.t1, lineHeight: 1.3 }}>{n}</span>
        ))}
        {(myPrompt.nuggets || []).map((n) => (
          <span key={n} style={{
            fontSize: T.cardLine, fontWeight: 700, lineHeight: 1.3,
            color: teamColor(captainSide),
          }}>{n}</span>
        ))}
      </div>

      {/* The line he lands on. Bigger than everything above it, because it is
          the only part of the card the room is waiting for. */}
      <div style={{
        marginTop: "0.5em", paddingTop: "0.45em",
        borderTop: `1px solid ${teamColor(captainSide)}${ALPHA.line}`,
        fontSize: T.cardTotal, fontWeight: 800, letterSpacing: 1,
        color: teamColor(captainSide), lineHeight: 1.15,
      }}>
        {myPrompt.headline}
      </div>
    </div>
  ) : null;

  //
  // On a PHONE the reveal buttons get the full width and a row of their own,
  // with ◀ and EXIT underneath. Four controls on one 393px row is how "REVEAL
  // SHOT …" and "WAITING ON SH…" happened — every one of them truncated, and
  // the two that matter most sharing their row with the two that matter least.
  // One of the two arrows beside the hole number, or nothing at all for
  // anybody who is not driving.
  const holeArrow = (dir, onPress, off) => {
    if (!isDirector || !onSetHole) return null;
    return (
      <button
        onClick={onPress}
        disabled={off}
        aria-label={dir === "next" ? "Next hole" : "Previous hole"}
        style={{
          flexShrink: 0, background: "transparent", border: "none", fontFamily: FONT,
          color: BC.t3, opacity: off ? 0.16 : 0.72,
          fontSize: compact ? 20 : "clamp(13px, 1.6vw, 34px)", lineHeight: 1,
          padding: compact ? "8px 12px" : "0 clamp(5px, 0.8vw, 16px)",
          cursor: off ? "default" : "pointer",
          transition: "opacity 250ms ease",
        }}
      >{dir === "next" ? "▶" : "◀"}</button>
    );
  };

  const smallBtn = (label, onPress, off) => (
    <button onClick={onPress} disabled={off} style={{
      padding: compact ? "12px 18px" : `clamp(6px, ${vwh(0.9)}, 18px) clamp(10px, 1.4vw, 28px)`,
      borderRadius: "clamp(6px, 0.8vw, 16px)",
      background: BC.inp, border: `1px solid ${BC.bdr}`, color: BC.t2, fontFamily: FONT,
      fontSize: compact ? 15 : T.btn, fontWeight: 800, letterSpacing: 1,
      opacity: off ? 0.35 : 1, cursor: off ? "not-allowed" : "pointer",
      flex: compact ? 1 : "0 0 auto",
    }}>{label}</button>
  );

  const controls = canDrive ? (
    <div
      style={{
        flexShrink: 0, display: "flex", alignItems: "stretch",
        flexDirection: compact ? "column" : "row",
        gap: compact ? 7 : "clamp(5px, 0.7vw, 14px)",
      }}
    >
      {compact ? (
        <>
          <div style={{ display: "flex", gap: 7 }}>{["A", "B"].filter(drives).map(sideBtn)}</div>
          <div style={{ display: "flex", gap: 7 }}>
            {smallBtn("◀ BACK", back, hole <= 0)}
            {smallBtn("EXIT", onClose, false)}
          </div>
        </>
      ) : (
        <>
          {smallBtn("◀", back, hole <= 0)}
          {["A", "B"].filter(drives).map(sideBtn)}
          {smallBtn("EXIT", onClose, false)}
        </>
      )}
    </div>
  ) : (
    <div style={{ flexShrink: 0, textAlign: "center", fontSize: T.terms, color: BC.t3, letterSpacing: 1.4, fontWeight: 700 }}>
      <button onClick={onClose} style={{
        background: "transparent", border: "none", color: BC.t3, fontFamily: FONT,
        fontSize: compact ? 13 : T.terms, fontWeight: 700, letterSpacing: 1.4,
        cursor: "pointer", padding: compact ? 12 : 0,
      }}>THE CAPTAINS ARE DRIVING · TAP TO EXIT</button>
    </div>
  );

  // ── Before the first hole ──────────────────────────────────────
  if (hole <= 0) {
    return shell(
      <>
        {cupBar}
        {stage(
          { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "clamp(6px, 1vw, 20px)", textAlign: "center" },
          <>
            <div style={{ fontSize: T.hole, fontWeight: 800, letterSpacing: "0.12em", color: BC.amberInk, lineHeight: 1.1 }}>
              THE FINAL COUNTDOWN
            </div>
            <div style={{ fontSize: T.terms, color: BC.t2, letterSpacing: 2, lineHeight: 1.8 }}>
              {[courseName, formatLabel].filter(Boolean).join(" · ")}
              <br />
              {HOLE_COUNT} HOLES · {fmtPts(HOLE_COUNT && result?.holePoints ? result.holePoints.front * 9 + result.holePoints.back * 9 : 0)} POINTS
            </div>
          </>,
        )}
        {strip}
        {captainBand}
        {controls}
      </>
    );
  }

  // ── A hole ─────────────────────────────────────────────────────
  // The verdict waits for BOTH captains. Half a hole has no winner, and a
  // screen that guessed at one from the side that spoke first would be doing
  // the thing the whole evening exists to prevent.
  const showA = shown.A;
  const showB = shown.B;
  const showVerdict = bothOut;
  const winner = hr?.winner || null;

  return shell(
    <>
      {cupBar}
      {/* ── The cup, on the hole it is won ──
          There is no hole verdict here any more. It was a band across the
          screen reading "SHOT CALLERS TAKE IT · 1 POINT", and it was the
          third place on this screen saying the same thing: the winning side's
          column already lights up in its own colour, and the strip along the
          bottom already fills that hole in.

          The CLINCH stays, and it gets the band to itself. It is not the same
          fact — "who took the hole" happens eighteen times and "the cup is
          won" happens once — and it is the moment the whole evening is built
          around.

          ── WHERE IT SITS, AND WHY IT IS ALWAYS THERE ──
          Under the cup, above the hole. That is the sentence it finishes: the
          two totals are directly above it and the number that just moved them
          is directly below, so the eye reads the score, the reason and the
          verdict in one column without going anywhere.

          It used to sit under the rows, and it used to render only on the hole
          it happens — which together were the whole bug. This page is one
          screenful with no scroll, the rows are sized to the space between the
          header and the ticker, and a band arriving at hole 12 shrank that
          space by its own height with nothing able to give it back. The rows
          did not shrink — they OVERFLOWED, straight over the band, so the
          biggest moment of the year read as "SHOT CALLERS WIN THE BOURBON CUP"
          printed through two men's names.

          Moving it up does not on its own fix that; RESERVING it does, and it
          would have been needed wherever the band went. The header's own top
          padding came off with the move, because the band's empty box is the
          air under the cup band now.

          So the band is always in the layout and only sometimes visible. The
          placeholder carries the LONGER of the two team names, invisible, so
          the height reserved is the height the real line will take — including
          how it wraps on a phone, which a hardcoded number could not know.
          Nothing moves when it lands; it fades up into a space that was always
          its own. */}
      {(() => {
        const won = !!clincher && showVerdict;
        const side = won ? clincher : (tA.name.length >= tB.name.length ? "A" : "B");
        const line = `🏆 ${side === "A" ? tA.name : tB.name} WIN THE BOURBON CUP`;
        return (
          <div style={{
            flexShrink: 0, textAlign: "center", borderRadius: "clamp(6px, 0.8vw, 16px)",
            padding: `clamp(4px, ${vwh(0.55)}, 14px) 0`,
            background: won ? `${teamColor(clincher)}${ALPHA.tint}` : "transparent",
            border: `2px solid ${won ? teamColor(clincher) : "transparent"}`,
            opacity: won ? 1 : 0,
            transition: "opacity 700ms ease, background 700ms ease, border-color 700ms ease",
          }}>
            <div style={{
              fontSize: T.cup, fontWeight: 800, letterSpacing: "0.14em",
              color: won ? teamColor(clincher) : "transparent", lineHeight: 1.15,
            }}>{line}</div>
          </div>
        );
      })()}


      {/* A margin above the hole number and another under the last row of
          each side — see the note on SideColumn's padding. The cup band ran
          almost into HOLE 7 and the eighth man ran into the bottom of his own
          card, so the middle of the screen read as one solid block from the
          band to the ticker with no air anywhere in it. Capped on height like
          everything else on this page, so a short window spends less of it
          rather than pushing a row under the ticker. */}
      <div style={{ flexShrink: 0, textAlign: "center", paddingTop: 0 }}>
        {/* ── The two arrows ──
            They flank the hole number rather than joining the row of controls
            at the bottom, because what they move IS the hole number — the
            director reaches for them while looking at the thing they change,
            and the row below is where the two teams' buttons live.

            SUBTLE ON PURPOSE. This screen belongs to the room, and a pair of
            chrome buttons either side of the biggest number on the television
            would read as part of the ceremony rather than as the stagehand's
            hand on the curtain. Grey, borderless, and dim to the point of
            nearly gone when they cannot be used — which is most of the time,
            since NEXT only lights when both captains have finished a hole.

            Drawn for a director only, and symmetric, so the number stays
            centred on the television whether or not anybody can drive it. */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          gap: compact ? 2 : "clamp(2px, 0.4vw, 10px)",
        }}>
          {holeArrow("back", goBack, !canBack)}
          <div style={{ fontSize: compact ? 30 : T.hole, fontWeight: 800, letterSpacing: "0.1em", color: BC.t1, lineHeight: 1.05 }}>
            HOLE {holeIdx + 1}
          </div>
          {holeArrow("next", goNext, !canNext)}
        </div>
        {/* ── Two lines under the number, not one ──
            They answer two different questions and they were running together
            into one string of four facts separated by dots — "PAR 4 · SI 5 ·
            BEST 6 OF 8 · 1 POINT" — which from the back of a room is a rule
            nobody parses.

            The HOLE is what it is: its par, and the handicap that decides who
            gets a shot on it. The FORMAT is what it is worth: how many balls
            make the number, and what the hole pays. One line each.

            "HANDICAP" rather than "SI". Stroke index is the correct term and
            it is not the one anybody in this room says out loud — a US card
            prints Handicap, and the question being asked is always "who's
            getting a shot here". The captain's card says the same word for
            the same number; two names for one figure across two screens the
            same man is holding is how an argument starts. */}
        <div style={{ fontSize: compact ? 10 : T.terms, fontWeight: 700, letterSpacing: compact ? 1 : 2.4, color: BC.t3, marginTop: "0.3em" }}>
          PAR {holePars?.[holeIdx] ?? "—"} · HANDICAP {holeHcps?.[holeIdx] ?? "—"}
        </div>
        {(countN || holeValue) && (
          <div style={{ fontSize: compact ? 10 : T.terms, fontWeight: 700, letterSpacing: compact ? 1 : 2.4, color: BC.t3, marginTop: "0.15em" }}>
            {[
              countN ? `BEST ${countN} OF ${match.teamA?.length ?? "—"}` : null,
              holeValue ? `${fmtPts(holeValue)} POINT${holeValue === 1 ? "" : "S"}` : null,
            ].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>

      {/* Side by side on a television, STACKED on a phone. Four names across
          half of 393px is "CHRI…"; across the whole of it they fit, which is
          the entire argument. The "vs" between them is a television flourish
          and goes with the horizontal layout — stacked, it would be a row of
          its own saying nothing.

          The phone's column scrolls rather than compressing: two grids, a
          prompt and a set of controls do not fit a 393×852 screen at any type
          size that can be read, and a scroll is the honest answer. The strip
          and the controls stay pinned below it. */}
      {stage(
        {
          display: "flex", gap: compact ? 10 : "clamp(6px, 1vw, 22px)",
          flexDirection: compact ? "column" : "row",
          alignItems: compact ? "stretch" : "center",
          justifyContent: compact ? "flex-start" : "center",
          overflowY: compact ? "auto" : "visible",
          overscrollBehavior: "contain",
        },
        <>
          <SideColumn tid="A" teamName={tA.name} score={hr?.aScore} balls={ballsFor("A")}
            par={holePars?.[holeIdx]} countN={countN} compact={compact}
            revealed={showA} won={showVerdict && winner === "A"}
            celebrate={showVerdict && clincher === "A"}
            waitingOn={`${tA.name.toUpperCase()} TO TELL IT`} />
          {/* No "vs" between them. It was a television flourish from when each
              side was a name over one enormous number and the gap between them
              was empty; two eight-man lists do not need to be told they are
              opposed, and the centred hole header above already parts them. */}
          <SideColumn tid="B" teamName={tB.name} score={hr?.bScore} balls={ballsFor("B")}
            par={holePars?.[holeIdx]} countN={countN} compact={compact}
            revealed={showB} won={showVerdict && winner === "B"}
            celebrate={showVerdict && clincher === "B"}
            waitingOn={`${tB.name.toUpperCase()} TO TELL IT`} />
        </>,
      )}

      {strip}
      {captainBand}
      {controls}
    </>
  );
}

export default FinalCountdown;
