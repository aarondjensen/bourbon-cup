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
//  Arrow keys and the space bar still work for whoever is driving, for the
//  year the laptop is close enough to reach.
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

import { useEffect, useRef, useCallback } from "react";
import { BC, FONT, ALPHA, teamColor } from "../theme";
import { playerLookup } from "../lib/players";
import { HOLE_COUNT, nextHoleForSide, sidesPending } from "../lib/reveal";
import { holePrompt } from "../lib/countdownPrompt";

// ── Type scale, for a television ─────────────────────────────────
// Read as: never smaller than the first (a phone held sideways, or the
// browser window somebody is testing in), grows with the viewport, never
// larger than the third (a 4K panel, where unbounded vw would put a single
// digit through the ceiling).
const T = {
  cupName:  "clamp(11px, 1.5vw, 30px)",
  cupPts:   "clamp(26px, 3.6vw, 76px)",
  hole:     "clamp(20px, 3.0vw, 62px)",
  terms:    "clamp(9px,  1.2vw, 24px)",
  // The one size that has to know about HEIGHT as well as width. A 16:9
  // television and a phone turned sideways have similar widths in vw terms
  // and nothing like the same room underneath — sized on vw alone, the
  // number that fits a TV pushed the balls that made it off the bottom of a
  // laptop window.
  side:     "clamp(30px, min(9vw, 17vh), 190px)",
  sideName: "clamp(12px, 1.7vw, 34px)",
  chip:     "clamp(13px, 2.3vw, 48px)",
  chipName: "clamp(8px,  1.0vw, 21px)",
  verdict:  "clamp(16px, 2.6vw, 54px)",
  cup:      "clamp(20px, 3.4vw, 72px)",
  strip:    "clamp(7px,  0.95vw, 20px)",
  btn:      "clamp(11px, 1.5vw, 30px)",
  prompt:   "clamp(13px, 1.6vw, 32px)",
  promptSm: "clamp(10px, 1.2vw, 24px)",
};

const fmtPts = (n) => (n == null ? "—" : Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));


// ── One player's ball ────────────────────────────────────────────
// Gross above, net below, a dot per handicap stroke — the same three facts
// the scorecard prints, at the size of a room. A ball that did not count is
// the same card with the lights off; it is still named, because on this
// format "you didn't count" is the joke of the evening.
//
//  UNDER PAR IS RED, which is the oldest convention on a scorecard and the
//  one thing in this app where red does not mean trouble: a printed card puts
//  the under-par numbers in red ink and everything else in black, and a room
//  full of golfers reads it without being told. It is on the NET score,
//  because net is what the format counts.
function BallChip({ name, gross, strokes, net, par, tid, counted }) {
  const col = teamColor(tid);
  const under = counted && net != null && Number.isFinite(par) && net < par;
  return (
    <div style={{
      // Shares the column evenly with its siblings rather than claiming a
      // fixed width. The counted row is six balls on the front and seven on
      // the back — a fixed width sized for six wrapped the seventh onto a
      // line of its own, which read as a ball that counted differently.
      flex: "1 1 0", minWidth: 0,
      padding: "clamp(4px, 0.6vw, 12px) clamp(3px, 0.45vw, 10px)",
      borderRadius: "clamp(5px, 0.7vw, 14px)",
      background: counted ? `${col}${ALPHA.tint}` : "transparent",
      border: `1px solid ${counted ? col : `${BC.bdr}${ALPHA.line}`}`,
      textAlign: "center", opacity: counted ? 1 : 0.42,
      display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
    }}>
      <div style={{
        fontSize: T.chipName, fontWeight: 800, letterSpacing: 0.6,
        color: counted ? col : BC.t3, whiteSpace: "nowrap",
        overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%",
      }}>{name}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.35em" }}>
        <span style={{
          fontSize: T.chip, fontWeight: 800, lineHeight: 1,
          color: under ? BC.danger : counted ? BC.t1 : BC.t3,
        }}>
          {net == null ? "·" : net}
        </span>
        {gross != null && gross !== net && (
          <span style={{ fontSize: T.chipName, fontWeight: 700, color: BC.t3 }}>
            ({gross}{strokes > 0 ? "•".repeat(Math.min(strokes, 3)) : ""})
          </span>
        )}
      </div>
    </div>
  );
}

// ── One side of the hole ─────────────────────────────────────────
// `revealed` is the stagger, not the blackout: the numbers are all here by
// the time this renders. What it withholds it withholds for two seconds.
function SideColumn({ tid, teamName, score, balls, par, revealed, won, waitingOn }) {
  const col = teamColor(tid);
  const counted = balls.filter((b) => b.counted);
  const missed = balls.filter((b) => !b.counted);
  return (
    <div style={{
      flex: 1, minWidth: 0, display: "flex", flexDirection: "column",
      alignItems: "center", gap: "clamp(2px, 0.7vw, 14px)",
      padding: "clamp(3px, 1vw, 20px) clamp(4px, 0.8vw, 16px)",
      borderRadius: "clamp(8px, 1vw, 20px)",
      background: won && revealed ? `${col}${ALPHA.wash}` : "transparent",
      border: `2px solid ${won && revealed ? `${col}${ALPHA.line}` : "transparent"}`,
      transition: "background 400ms ease, border-color 400ms ease",
    }}>
      <div style={{
        fontSize: T.sideName, fontWeight: 800, letterSpacing: 1, color: col,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%",
      }}>{teamName}</div>
      <div style={{
        fontSize: T.side, fontWeight: 800, lineHeight: 0.95, color: col,
        opacity: revealed ? 1 : 0,
        transform: revealed ? "none" : "translateY(0.12em) scale(0.94)",
        transition: "opacity 380ms ease, transform 380ms cubic-bezier(.2,.7,.3,1)",
      }}>{revealed ? (score == null ? "—" : score) : "—"}</div>
      {/* A side still waiting on its captain says so, rather than sitting
          under a dash that reads the same as a hole nobody posted. This is
          the half of the screen the room is looking at while he talks. */}
      {!revealed && (
        <div style={{
          fontSize: T.promptSm, fontWeight: 800, letterSpacing: "0.22em",
          color: BC.t3, textAlign: "center", lineHeight: 1.5,
        }}>{waitingOn || "WAITING"}</div>
      )}
      {/* NOT RENDERED until the side has spoken, rather than rendered and
          hidden. It used to be an opacity — which was fine when both sides
          came out two seconds apart on a timer, and is not now: a side can sit
          unrevealed for as long as the other captain wants to talk, and
          "invisible on a television" is not the same as "not on the screen".
          The names and the numbers stay out of the page until they are his to
          give. Same rule as lib/reveal's, one layer up. */}
      {revealed && (
      <div style={{
        display: "flex", justifyContent: "center", alignItems: "stretch",
        gap: "clamp(2px, 0.35vw, 8px)", width: "100%",
        animation: "none",
      }}>
        {counted.map((b) => <BallChip key={b.pid} {...b} par={par} tid={tid} />)}
      </div>
      )}
      {revealed && missed.length > 0 && (
        // The ones that didn't count sit on their own line, and only as wide
        // as they need to be — they are a footnote to the row above, not a
        // second set of six.
        <div style={{
          display: "flex", justifyContent: "center", alignItems: "stretch",
          gap: "clamp(2px, 0.35vw, 8px)", width: `${Math.min(100, (missed.length / Math.max(counted.length, 1)) * 100)}%`,
        }}>
          {missed.map((b) => <BallChip key={b.pid} {...b} par={par} tid={tid} />)}
        </div>
      )}
    </div>
  );
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
  isDirector = false, captainSide = null, onAdvance, onClose,
}) {
  const { nameOf } = playerLookup(tPlayers);
  const { A: outA, B: outB } = reveal || { A: 0, B: 0 };
  // The hole the room is ON — the one a side has been shown, or the last one
  // finished when the two are level. Not the minimum: the whole point is that
  // a hole sits half-open while one captain talks.
  const hole = Math.max(outA, outB);
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
    if (!onAdvance) return;
    if (outA > outB && drives("A")) onAdvance("A", outA - 1);
    else if (outB > outA && drives("B")) onAdvance("B", outB - 1);
    else if (outA === outB && outA > 0) {
      if (drives("A")) onAdvance("A", outA - 1);
      else if (drives("B")) onAdvance("B", outB - 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outA, outB, onAdvance, isDirector, captainSide]);

  // Space / right arrow, for whoever is at the keyboard. It moves the side
  // that is DUE: the one behind, or — when they are level — the first side
  // this viewer is allowed to move. A television nobody is driving does
  // nothing, which is what it should do.
  const advance = useCallback(() => {
    const next = sidesPending({ sealed: true, reveal_a: outA, reveal_b: outB }).filter(drives);
    if (next.length) revealSide(next[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outA, outB, revealSide, isDirector, captainSide]);

  // Keyboard, for the year the laptop is within reach. The phone is still
  // the primary control — see the note at the top of the file.
  const keyRef = useRef({ advance, back, onClose });
  useEffect(() => { keyRef.current = { advance, back, onClose }; }, [advance, back, onClose]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === " " || e.key === "ArrowRight" || e.key === "Enter" || e.key === "PageDown") {
        e.preventDefault(); keyRef.current.advance();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault(); keyRef.current.back();
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
    });
  };

  // ── What the captain reads out ───────────────────────────────────
  // His own side's NEXT hole — the one he is about to turn over — off the
  // uncut own-side pass. Null for a director who captains nothing, and null
  // once his side has no holes left. See lib/countdownPrompt.
  const myNext = captainSide ? nextHoleForSide({ sealed: true, reveal_a: outA, reveal_b: outB }, captainSide) : null;
  const myPrompt = (() => {
    if (!captainSide || myNext == null || !ownResult) return null;
    // Not his go. The other captain is talking and this band would be him
    // reading ahead over the top of it.
    if (!sidesPending({ sealed: true, reveal_a: outA, reveal_b: outB }).includes(captainSide)) return null;
    const idx = myNext - 1;
    const src = { result: ownResult, getScore: ownGetScore || getScore };
    const own = ownResult.holes?.[idx];
    return {
      hole: myNext,
      par: holePars?.[idx] ?? null,
      ...holePrompt({
        balls: ballsFor(captainSide, idx, src),
        par: holePars?.[idx],
        countN: ownResult.counting?.[idx] ?? null,
        score: captainSide === "A" ? own?.aScore : own?.bScore,
      }),
    };
  })();

  const pct = (v) => {
    const scale = Math.max(toWin * 2 - 1, totals.A + totals.B, 1);
    return Math.min(100, (v / scale) * 100);
  };

  const shell = (children) => (
    <div
      onClick={advance}
      style={{
        position: "fixed", inset: 0, zIndex: 4000, background: BC.bg, color: BC.t1,
        fontFamily: FONT, display: "flex", flexDirection: "column",
        padding: "clamp(8px, 1.2vw, 26px)", gap: "clamp(6px, 0.9vw, 18px)",
        cursor: canDrive ? "pointer" : "default", userSelect: "none", overflow: "hidden",
      }}>
      {children}
    </div>
  );

  // ── The cup, across the top ────────────────────────────────────
  const cupBar = (
    <div style={{ flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: "clamp(8px, 1.5vw, 30px)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: T.cupName, fontWeight: 800, letterSpacing: 1.4, color: BC.teamA, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tA.name}</div>
          <div style={{ fontSize: T.cupPts, fontWeight: 800, lineHeight: 1, color: BC.teamA }}>{fmtPts(totals.A)}</div>
        </div>
        <div style={{ textAlign: "center", flexShrink: 0 }}>
          <div style={{ fontSize: T.cupName, fontWeight: 800, letterSpacing: 1.4, color: BC.t3 }}>TO WIN</div>
          <div style={{ fontSize: T.hole, fontWeight: 800, lineHeight: 1, color: BC.t1 }}>{fmtPts(toWin)}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0, textAlign: "right" }}>
          <div style={{ fontSize: T.cupName, fontWeight: 800, letterSpacing: 1.4, color: BC.teamB, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tB.name}</div>
          <div style={{ fontSize: T.cupPts, fontWeight: 800, lineHeight: 1, color: BC.teamB }}>{fmtPts(totals.B)}</div>
        </div>
      </div>
      <div style={{ position: "relative", height: "clamp(6px, 0.8vw, 16px)", borderRadius: 99, background: BC.inp, overflow: "hidden", marginTop: "clamp(4px, 0.6vw, 12px)" }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct(totals.A)}%`, background: BC.teamA, transition: "width 700ms cubic-bezier(.2,.7,.3,1)" }} />
        <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: `${pct(totals.B)}%`, background: BC.teamB, transition: "width 700ms cubic-bezier(.2,.7,.3,1)" }} />
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 3, marginLeft: -1.5, background: BC.bg }} />
      </div>
    </div>
  );

  // ── The eighteen ───────────────────────────────────────────────
  // Painted by who took each hole. The one being revealed carries a ring,
  // and it is the only thing on the strip that moves.
  //
  // A TIED hole is split down the middle in both teams' colours rather than
  // left grey. Grey is what an unturned hole looks like, and from the back of
  // a room "we tied it" and "we haven't seen it yet" reading the same is the
  // one mistake this strip can make — it is the thing everybody is counting.
  const strip = (
    <div style={{ flexShrink: 0, display: "flex", gap: "clamp(2px, 0.3vw, 6px)" }}>
      {Array.from({ length: HOLE_COUNT }, (_, i) => {
        // A hole is coloured by its WINNER, and there is no winner until both
        // captains have spoken — so the strip counts what is wholly out, not
        // what is on screen. The hole in play carries the ring and stays grey
        // underneath it, which is exactly what it is: half a story.
        const out = i < settled;
        const h = result?.holes?.[i];
        const w = out ? h?.winner : null;
        const halved = out && !w && h?.played;
        const cur = i === holeIdx;
        return (
          <div key={i} style={{
            flex: 1, minWidth: 0, textAlign: "center",
            padding: "clamp(2px, 0.35vw, 8px) 0",
            borderRadius: "clamp(3px, 0.4vw, 8px)",
            fontSize: T.strip, fontWeight: 800,
            background: w ? teamColor(w)
              : halved ? `linear-gradient(105deg, ${teamColor("A")} 0 50%, ${teamColor("B")} 50% 100%)`
              : out ? BC.inp : "transparent",
            border: `1px solid ${cur ? BC.amber : out ? "transparent" : `${BC.bdr}${ALPHA.line}`}`,
            outline: cur ? `2px solid ${BC.amber}` : "none",
            color: w || halved ? BC.bg : out ? BC.t2 : BC.t3,
            opacity: out ? 1 : 0.5,
            transition: "background 400ms ease",
          }}>{i + 1}</div>
        );
      })}
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
        flex: 1, minWidth: 0, padding: "clamp(6px, 0.9vw, 18px) clamp(6px, 0.8vw, 16px)",
        borderRadius: "clamp(6px, 0.8vw, 16px)",
        background: done || held ? BC.inp : `${col}${ALPHA.tint}`,
        border: `2px solid ${done || held ? BC.bdr : col}`,
        color: done || held ? BC.t3 : BC.t1, fontFamily: FONT,
        fontSize: T.btn, fontWeight: 800, letterSpacing: 1,
        cursor: done || held ? "not-allowed" : "pointer",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>
        {done ? `${team.name.toUpperCase()} · ALL OUT`
          : held ? `WAITING ON ${(side === "A" ? tB : tA).name.toUpperCase()}`
          : `${waiting ? "▸ " : ""}REVEAL ${team.name.toUpperCase()} · HOLE ${next}`}
      </button>
    );
  };

  // ── The captain's band ───────────────────────────────────────────
  // What he says before he taps, and nothing else. Two lines: the number his
  // side made, and the balls worth naming. See lib/countdownPrompt for where
  // the line between "worth naming" and "leave it alone" is drawn, and why a
  // net bogey is never on the right side of it.
  const captainBand = myPrompt ? (
    <div onClick={(e) => e.stopPropagation()} style={{
      flexShrink: 0, padding: "clamp(6px, 0.9vw, 18px) clamp(9px, 1.2vw, 24px)",
      borderRadius: "clamp(6px, 0.8vw, 16px)",
      background: `${teamColor(captainSide)}${ALPHA.wash}`,
      border: `2px solid ${teamColor(captainSide)}${ALPHA.line}`,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "clamp(6px, 1vw, 20px)", flexWrap: "wrap" }}>
        <span style={{ fontSize: T.promptSm, fontWeight: 800, letterSpacing: "0.2em", color: BC.t3 }}>
          YOU&rsquo;RE UP · HOLE {myPrompt.hole}{myPrompt.par ? ` · PAR ${myPrompt.par}` : ""}
        </span>
        <span style={{ fontSize: T.prompt, fontWeight: 800, letterSpacing: 1, color: teamColor(captainSide) }}>
          {myPrompt.headline}
        </span>
      </div>
      <div style={{ marginTop: "0.35em", display: "flex", flexDirection: "column", gap: "0.15em" }}>
        {myPrompt.notes.map((n) => (
          <span key={n} style={{ fontSize: T.prompt, fontWeight: 700, color: BC.t1, lineHeight: 1.35 }}>{n}</span>
        ))}
      </div>
    </div>
  ) : null;

  const controls = canDrive ? (
    <div style={{ flexShrink: 0, display: "flex", gap: "clamp(5px, 0.7vw, 14px)", alignItems: "stretch" }} onClick={(e) => e.stopPropagation()}>
      <button onClick={back} disabled={hole <= 0} style={{
        padding: "clamp(6px, 0.9vw, 18px) clamp(10px, 1.4vw, 28px)", borderRadius: "clamp(6px, 0.8vw, 16px)",
        background: BC.inp, border: `1px solid ${BC.bdr}`, color: BC.t2, fontFamily: FONT,
        fontSize: T.btn, fontWeight: 800, letterSpacing: 1,
        opacity: hole <= 0 ? 0.35 : 1, cursor: hole <= 0 ? "not-allowed" : "pointer",
      }}>◀</button>
      {["A", "B"].filter(drives).map(sideBtn)}
      <button onClick={onClose} style={{
        padding: "clamp(6px, 0.9vw, 18px) clamp(10px, 1.4vw, 28px)", borderRadius: "clamp(6px, 0.8vw, 16px)",
        background: BC.inp, border: `1px solid ${BC.bdr}`, color: BC.t2, fontFamily: FONT,
        fontSize: T.btn, fontWeight: 800, letterSpacing: 1, cursor: "pointer",
      }}>EXIT</button>
    </div>
  ) : (
    <div style={{ flexShrink: 0, textAlign: "center", fontSize: T.terms, color: BC.t3, letterSpacing: 1.4, fontWeight: 700 }} onClick={(e) => e.stopPropagation()}>
      <button onClick={onClose} style={{
        background: "transparent", border: "none", color: BC.t3, fontFamily: FONT,
        fontSize: T.terms, fontWeight: 700, letterSpacing: 1.4, cursor: "pointer",
      }}>THE CAPTAINS ARE DRIVING · TAP TO EXIT</button>
    </div>
  );

  // ── Before the first hole ──────────────────────────────────────
  if (hole <= 0) {
    return shell(
      <>
        {cupBar}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "clamp(6px, 1vw, 20px)", textAlign: "center" }}>
          <div style={{ fontSize: T.terms, fontWeight: 800, letterSpacing: "0.4em", color: BC.t3 }}>SEALED ALL DAY</div>
          <div style={{ fontSize: T.hole, fontWeight: 800, letterSpacing: "0.12em", color: BC.amberInk, lineHeight: 1.1 }}>
            THE FINAL COUNTDOWN
          </div>
          <div style={{ fontSize: T.terms, color: BC.t2, letterSpacing: 2, lineHeight: 1.8 }}>
            {[courseName, formatLabel].filter(Boolean).join(" · ")}
            <br />
            {HOLE_COUNT} HOLES · {fmtPts(HOLE_COUNT && result?.holePoints ? result.holePoints.front * 9 + result.holePoints.back * 9 : 0)} POINTS ON THE TABLE
          </div>
        </div>
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
  const verdictName = winner === "A" ? tA.name : winner === "B" ? tB.name : null;

  return shell(
    <>
      {cupBar}

      <div style={{ flexShrink: 0, textAlign: "center" }}>
        <div style={{ fontSize: T.hole, fontWeight: 800, letterSpacing: "0.1em", color: BC.t1, lineHeight: 1.05 }}>
          HOLE {holeIdx + 1}
        </div>
        <div style={{ fontSize: T.terms, fontWeight: 700, letterSpacing: 2.4, color: BC.t3, marginTop: "0.3em" }}>
          PAR {holePars?.[holeIdx] ?? "—"} · SI {holeHcps?.[holeIdx] ?? "—"}
          {countN ? ` · BEST ${countN} OF ${match.teamA?.length ?? "—"}` : ""}
          {holeValue ? ` · ${fmtPts(holeValue)} POINT${holeValue === 1 ? "" : "S"}` : ""}
        </div>
      </div>

      <div style={{ flex: "1 1 0", minHeight: 0, display: "flex", alignItems: "center", gap: "clamp(6px, 1vw, 22px)" }}>
        <SideColumn tid="A" teamName={tA.name} score={hr?.aScore} balls={ballsFor("A")} par={holePars?.[holeIdx]}
          revealed={showA} won={showVerdict && winner === "A"} waitingOn={`${tA.name.toUpperCase()} TO TELL IT`} />
        <div style={{ flexShrink: 0, fontSize: T.sideName, fontWeight: 800, color: BC.t3, opacity: 0.5 }}>vs</div>
        <SideColumn tid="B" teamName={tB.name} score={hr?.bScore} balls={ballsFor("B")} par={holePars?.[holeIdx]}
          revealed={showB} won={showVerdict && winner === "B"} waitingOn={`${tB.name.toUpperCase()} TO TELL IT`} />
      </div>

      {/* The verdict, and — on the hole it happens — the cup. A clinch gets
          the band to itself at three times the height: it is the moment the
          whole evening is built around and it should not have to share a row
          with "won the hole". */}
      <div style={{
        flexShrink: 0, textAlign: "center", borderRadius: "clamp(6px, 0.8vw, 16px)",
        padding: clincher && showVerdict ? "clamp(8px, 1.3vw, 26px) 0" : "clamp(5px, 0.8vw, 16px) 0",
        background: clincher && showVerdict ? `${teamColor(clincher)}${ALPHA.tint}`
          : winner && showVerdict ? `${teamColor(winner)}${ALPHA.wash}`
          : showVerdict && hr?.played ? BC.inp : "transparent",
        border: `2px solid ${clincher && showVerdict ? teamColor(clincher)
          : winner && showVerdict ? `${teamColor(winner)}${ALPHA.line}`
          : showVerdict && hr?.played ? `${BC.bdr}${ALPHA.line}` : "transparent"}`,
        opacity: showVerdict ? 1 : 0,
        transition: "opacity 420ms ease, background 420ms ease, padding 420ms ease",
      }}>
        {/* Half a hole has no winner, and the words for one are not written
            into the page while a captain is still telling his half of it. The
            band keeps its height so the layout does not jump when they land —
            it is the TEXT that waits, not the space. */}
        {!showVerdict ? <span>&nbsp;</span>
          : clincher ? (
          <div style={{ fontSize: T.cup, fontWeight: 800, letterSpacing: "0.14em", color: teamColor(clincher), lineHeight: 1.15 }}>
            🏆 {clincher === "A" ? tA.name : tB.name} WIN THE BOURBON CUP
          </div>
        ) : (
          <div style={{ fontSize: T.verdict, fontWeight: 800, letterSpacing: "0.1em", color: winner ? teamColor(winner) : BC.t2 }}>
            {!hr?.played ? "NO RESULT ON THIS HOLE"
              : verdictName
                ? `${verdictName} TAKE IT${holeValue ? `  ·  +${fmtPts(holeValue)}` : ""}`
                : `TIED${holeValue ? `  ·  ${fmtPts(holeValue / 2)} EACH` : ""}`}
          </div>
        )}
      </div>

      {strip}
      {captainBand}
      {controls}
    </>
  );
}

export default FinalCountdown;
