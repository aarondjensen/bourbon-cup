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

import { useState, useEffect, useRef, useCallback } from "react";
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
const T = {
  cupName:  "clamp(11px, 1.5vw, 30px)",
  // The cup total is the biggest thing on the screen after the hole itself,
  // because the band across the top is what the room is actually tracking —
  // every hole is only interesting for what it does to these two numbers.
  cupPts:   "clamp(26px, 4.2vw, 92px)",
  // What it takes to win it, in gold, between them. Deliberately smaller than
  // the totals it sits between: it is the line they are running at, not a
  // third score.
  cupGoal:  "clamp(17px, 2.3vw, 48px)",
  hole:     "clamp(20px, 3.0vw, 62px)",
  terms:    "clamp(9px,  1.2vw, 24px)",
  // The one size that has to know about HEIGHT as well as width. A 16:9
  // television and a phone turned sideways have similar widths in vw terms
  // and nothing like the same room underneath — sized on vw alone, the
  // number that fits a TV pushed the balls that made it off the bottom of a
  // laptop window.
  side:     "clamp(28px, min(5.5vw, 9.7vh), 120px)",
  sideName: "clamp(12px, 1.7vw, 34px)",
  chip:     "clamp(13px, 2.3vw, 48px)",
  chipName: "clamp(8px,  1.0vw, 21px)",
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
  rowScore: "clamp(13px, min(1.75vw, 2.8vh), 36px)",
  rowPad:   "clamp(1px,  min(0.42vw, 0.7vh),  9px)",
  rowGap:   "clamp(2px,  min(0.3vw,  0.55vh), 7px)",
  cup:      "clamp(20px, 3.4vw, 72px)",
  strip:    "clamp(7px,  0.95vw, 20px)",
  btn:      "clamp(11px, 1.5vw, 30px)",
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

const GRID_COLS = 4;

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
function StrokeDots({ strokes, row }) {
  const d = row ? "clamp(4px, 0.45vw, 9px)" : "clamp(3px, 0.4vw, 8px)";
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      gap: "clamp(1px, 0.15vw, 3px)",
      ...(row
        ? { width: "clamp(18px, 2.2vw, 46px)", flexShrink: 0 }
        : { height: "clamp(6px, 0.8vw, 16px)" }),
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

// ── One player's ball, on a phone ────────────────────────────────
// A chip in the side's four-across grid. A ball that did not count is the same
// card with the lights off; it is still named, because on this format "you
// didn't count" is the joke of the evening.
function BallChip({ strokes, name, net, par, tid, counted }) {
  const col = teamColor(tid);
  const rel = ballRel(net, par);
  const under = rel != null && rel < 0;
  return (
    <div style={{
      // A cell of the side's grid, not a flex sibling — see SideColumn. Every
      // man keeps the same square every hole, so the room learns where to look
      // for him instead of re-reading eight names each time.
      minWidth: 0,
      padding: "clamp(4px, 0.6vw, 12px) clamp(3px, 0.45vw, 10px)",
      borderRadius: "clamp(5px, 0.7vw, 14px)",
      background: counted ? `${col}${ALPHA.tint}` : "transparent",
      border: `1px solid ${counted ? col : `${BC.bdr}${ALPHA.line}`}`,
      // A ball that missed is NOT dimmed. It used to sit at 0.42, which from
      // twelve feet is a number you cannot read — and on this format "you
      // didn't count" is half the conversation in the room, so the man being
      // laughed at deserves to have his score legible while it happens. The
      // ring and the tint already say who made the number; they say it
      // loudly enough on their own, and they say it without hiding anything.
      textAlign: "center",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
    }}>
      <div style={{
        fontSize: T.chipName, fontWeight: 800, letterSpacing: 0.6,
        color: counted ? col : BC.t3, whiteSpace: "nowrap",
        overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%",
      }}>{name}</div>

      <StrokeDots strokes={strokes} />

      {/* TO PAR, and net. The gross used to ride beside it in parentheses —
          "3 (5)" — which is two numbers to read on a chip the size of a
          postage stamp, in a room, on the one screen where a half-second of
          squinting is a half-second of the ceremony. The dots above say the
          number is a net one; the number he wrote down is on the card he
          signed, and nobody in the room is auditing it. */}
      <span style={{
        fontSize: T.chip, fontWeight: 800, lineHeight: 1,
        color: under ? BC.danger : counted ? BC.t1 : BC.t2,
      }}>
        {rel == null ? "·" : fmtRel(rel)}
      </span>
    </div>
  );
}

// ── One player's ball, on a television ───────────────────────────
// The same three facts on ONE LINE — name, strokes, the number — eight lines
// down a column instead of four chips across and two down.
//
// A chip is the right shape for a phone, where the width is the scarce thing
// and a name has to fit in a quarter of 393px. On a 16:9 television the scarce
// thing is HEIGHT and width is what there is too much of, and a four-across
// grid spends all of it: the name is capped by the column, which is capped by
// the chip, which is a quarter of half the screen — so "Christopher M" was set
// in the smallest type on the display while an inch of black sat either side
// of it. A row gives the name room and the number a lane of its own, so the
// eight of them line up as a list somebody can read down.
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

// How wide a name lane has to be, in ems of its own type, for `n` characters.
// Montserrat Bold in the app's all-caps (see theme.js) measures about 0.67em a
// character; this is that with a margin, because the cost of being a little
// wide is a little slack and the cost of being narrow is "CHRISTOPHE…" on a
// television. It ellipsizes anyway if a director ever types something enormous.
const nameLaneEm = (n) => Math.max(3.4, (Number(n) || 0) * 0.75);

function BallRow({ strokes, name, net, par, tid, counted, nameEm }) {
  const col = teamColor(tid);
  const rel = ballRel(net, par);
  const under = rel != null && rel < 0;
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      gap: "clamp(4px, 0.6vw, 12px)",
      padding: `${T.rowPad} clamp(6px, 0.8vw, 16px)`,
      borderRadius: "clamp(4px, 0.5vw, 10px)",
      background: counted ? `${col}${ALPHA.tint}` : "transparent",
      borderLeft: `${RAIL} solid ${counted ? col : `${BC.bdr}${ALPHA.line}`}`,
      borderRight: `${RAIL} solid transparent`,
      minWidth: 0,
    }}>
      <div style={{
        width: `${nameEm}em`, flexShrink: 1, minWidth: 0, textAlign: "left",
        fontSize: T.rowName, fontWeight: 800, letterSpacing: 0.4,
        color: counted ? BC.t1 : BC.t2,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>{name}</div>
      <StrokeDots strokes={strokes} row />
      <div style={{
        width: "2.2em", flexShrink: 0, textAlign: "center", whiteSpace: "nowrap",
        fontSize: T.rowScore, fontWeight: 800, lineHeight: 1,
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
function SideColumn({ tid, teamName, score, balls, par, countN, compact, revealed, won, waitingOn }) {
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
  // has no slack to sit off-centre in. See BallRow.
  const nameEm = nameLaneEm(Math.max(0, ...balls.map((b) => (b.name || "").length)));
  return (
    <div style={{
      // On a television each side claims half the width and stretches to fill
      // the height. On a PHONE they are stacked, and stretching makes each one
      // half a screen tall with a column of black under an eight-man grid that
      // is four rows deep. Content height, top of the screen down.
      flex: compact ? "0 0 auto" : 1,
      minWidth: 0, display: "flex", flexDirection: "column",
      alignItems: "center", gap: compact ? 6 : "clamp(2px, min(0.7vw, 1.1vh), 14px)",
      padding: compact ? "8px 10px" : "clamp(3px, min(1vw, 1.6vh), 20px) clamp(4px, 0.8vw, 16px)",
      borderRadius: "clamp(8px, 1vw, 20px)",
      background: won && revealed ? `${col}${ALPHA.wash}` : "transparent",
      border: `2px solid ${won && revealed ? `${col}${ALPHA.line}` : "transparent"}`,
      transition: "background 400ms ease, border-color 400ms ease",
    }}>
      {/* On a television the name sits above the number, both enormous. On a
          PHONE they share one row: the name at the left, the figure at the
          right, which is a scoreboard line rather than two stacked blocks —
          and it is the difference between the grids fitting on the screen and
          not. */}
      <div style={{
        display: "flex", width: "100%",
        // A COLUMN on a television, and its children have to be centred in it
        // — `baseline` down a column is a left edge, which is how the name and
        // the number came to sit against the left of a 16:9 screen with the
        // grid centred underneath them.
        alignItems: compact ? "baseline" : "center",
        justifyContent: compact ? "space-between" : "center",
        flexDirection: compact ? "row" : "column", gap: compact ? 8 : 0,
      }}>
        <div style={{
          fontSize: compact ? 15 : T.sideName, fontWeight: 800, letterSpacing: 1, color: col,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0,
        }}>{teamName}</div>
        <div style={{
          fontSize: compact ? 30 : T.side, fontWeight: 800, lineHeight: 0.95, color: col,
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
      {/* Chips across on a phone, a list down on a television — see the note
          on BallRow for why the same eight men want two different shapes. The
          ORDER is alphabetical either way, and it is the same order on hole 18
          as on hole 1. */}
      {revealed && (compact ? (
        <div style={{
          display: "grid", width: "100%",
          gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
          gap: "clamp(2px, 0.35vw, 8px)",
        }}>
          {balls.map((b) => <BallChip key={b.pid} {...b} par={par} tid={tid} />)}
        </div>
      ) : (
        <div style={{
          display: "flex", flexDirection: "column", width: "100%",
          gap: T.rowGap,
        }}>
          {/* One lane width for the whole side, off the longest name on it —
              which is what makes the trio hug its content and sit optically in
              the middle rather than floating in a share of the column. See the
              note on BallRow. */}
          {balls.map((b) => (
            <BallRow key={b.pid} {...b} par={par} tid={tid} nameEm={nameEm} />
          ))}
        </div>
      ))}
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
        padding: "clamp(8px, 1.2vw, 26px)", gap: "clamp(6px, 0.9vw, 18px)",
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
      padding: compact ? "9px 12px" : "clamp(6px, 0.9vw, 18px) clamp(10px, 1.4vw, 28px)",
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
      <div style={{ position: "relative", height: "clamp(6px, 0.9vw, 18px)", borderRadius: 99, background: BC.inp, overflow: "hidden", marginTop: "clamp(4px, 0.6vw, 12px)" }}>
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
        padding: compact ? "9px 0" : "clamp(2px, 0.35vw, 8px) 0",
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
        padding: compact ? "15px 10px" : "clamp(6px, 0.9vw, 18px) clamp(6px, 0.8vw, 16px)",
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
          myPrompt.si ? `SI ${myPrompt.si}` : null,
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
      padding: compact ? "12px 18px" : "clamp(6px, 0.9vw, 18px) clamp(10px, 1.4vw, 28px)",
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

      <div style={{ flexShrink: 0, textAlign: "center" }}>
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
        <div style={{ fontSize: compact ? 10 : T.terms, fontWeight: 700, letterSpacing: compact ? 1 : 2.4, color: BC.t3, marginTop: "0.3em" }}>
          PAR {holePars?.[holeIdx] ?? "—"} · SI {holeHcps?.[holeIdx] ?? "—"}
          {countN ? ` · BEST ${countN} OF ${match.teamA?.length ?? "—"}` : ""}
          {holeValue ? ` · ${fmtPts(holeValue)} POINT${holeValue === 1 ? "" : "S"}` : ""}
        </div>
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
            revealed={showA} won={showVerdict && winner === "A"} waitingOn={`${tA.name.toUpperCase()} TO TELL IT`} />
          {/* No "vs" between them. It was a television flourish from when each
              side was a name over one enormous number and the gap between them
              was empty; two eight-man lists do not need to be told they are
              opposed, and the centred hole header above already parts them. */}
          <SideColumn tid="B" teamName={tB.name} score={hr?.bScore} balls={ballsFor("B")}
            par={holePars?.[holeIdx]} countN={countN} compact={compact}
            revealed={showB} won={showVerdict && winner === "B"} waitingOn={`${tB.name.toUpperCase()} TO TELL IT`} />
        </>,
      )}

      {/* ── The cup, on the hole it is won ──
          There is no hole verdict here any more. It was a band across the
          screen reading "SHOT CALLERS TAKE IT · 1 POINT", and it was the
          third place on this screen saying the same thing: the winning side's
          column already lights up in its own colour, and the strip along the
          bottom already fills that hole in. Three tellings of one fact, on the
          screen where every row is competing for the room's attention, and it
          was the one of the three that cost a whole band of height.

          The CLINCH stays, and it gets the band to itself. It is not the same
          fact — "who took the hole" happens eighteen times and "the cup is
          won" happens once — and it is the moment the whole evening is built
          around. It renders only on the hole it happens, so the rest of the
          countdown gets that height back for the grids. */}
      {clincher && showVerdict && (
        <div style={{
          flexShrink: 0, textAlign: "center", borderRadius: "clamp(6px, 0.8vw, 16px)",
          padding: "clamp(8px, 1.3vw, 26px) 0",
          background: `${teamColor(clincher)}${ALPHA.tint}`,
          border: `2px solid ${teamColor(clincher)}`,
        }}>
          <div style={{ fontSize: T.cup, fontWeight: 800, letterSpacing: "0.14em", color: teamColor(clincher), lineHeight: 1.15 }}>
            🏆 {clincher === "A" ? tA.name : tB.name} WIN THE BOURBON CUP
          </div>
        </div>
      )}

      {strip}
      {captainBand}
      {controls}
    </>
  );
}

export default FinalCountdown;
