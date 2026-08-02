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
//  WHAT DRIVES IT
//  --------------
//  The director's phone. `reveal_through` is one live field on the round
//  document, so the television is a dumb display pointed at a URL and
//  nobody has to stand up or find a trackpad. Arrow keys and the space
//  bar work too, for the year the laptop is close enough to reach.
//
//  Between taps everything is LOCAL: one press stages the hole open over
//  about two and a half seconds — A's number, then B's, then the verdict
//  and the cup bar moving — because eighteen holes at three taps each is
//  fifty-four taps and puts the pacing in a thumb instead of on the
//  screen. A second press during the stagger skips to the end, for the
//  holes nobody is going to argue about.
//
//  WHAT IT IS HANDED
//  -----------------
//  The CONCEALED hole data — the same map the scoreboard gets, cut off
//  at the reveal. That is deliberate and it is what makes this screen
//  safe to write casually: hole `through - 1` is the last one that
//  exists, so there is no hole after it to leak, and no discipline
//  required of the layout below to avoid drawing one.

import { useState, useEffect, useRef, useCallback } from "react";
import { BC, FONT, ALPHA, teamColor } from "../theme";
import { playerLookup } from "../lib/players";
import { HOLE_COUNT } from "../lib/reveal";

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
};

const fmtPts = (n) => (n == null ? "—" : Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

// The stagger, in ms from the tap. Tuned by reading it out loud: long
// enough that the second number is a separate event from the first, short
// enough that eighteen of them is not an hour.
const STAGE_AT = [520, 1500, 2350];
const STAGE_DONE = 3;

// ── One player's ball ────────────────────────────────────────────
// Gross above, net below, a dot per handicap stroke — the same three facts
// the scorecard prints, at the size of a room. A ball that did not count is
// the same card with the lights off; it is still named, because on this
// format "you didn't count" is the joke of the evening.
function BallChip({ name, gross, strokes, net, tid, counted }) {
  const col = teamColor(tid);
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
        <span style={{ fontSize: T.chip, fontWeight: 800, color: counted ? BC.t1 : BC.t3, lineHeight: 1 }}>
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
function SideColumn({ tid, teamName, score, balls, revealed, won }) {
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
      <div style={{
        display: "flex", justifyContent: "center", alignItems: "stretch",
        gap: "clamp(2px, 0.35vw, 8px)", width: "100%",
        opacity: revealed ? 1 : 0, transition: "opacity 420ms ease 120ms",
      }}>
        {counted.map((b) => <BallChip key={b.pid} {...b} tid={tid} />)}
      </div>
      {missed.length > 0 && (
        // The ones that didn't count sit on their own line, and only as wide
        // as they need to be — they are a footnote to the row above, not a
        // second set of six.
        <div style={{
          display: "flex", justifyContent: "center", alignItems: "stretch",
          gap: "clamp(2px, 0.35vw, 8px)", width: `${Math.min(100, (missed.length / Math.max(counted.length, 1)) * 100)}%`,
          opacity: revealed ? 1 : 0, transition: "opacity 420ms ease 260ms",
        }}>
          {missed.map((b) => <BallChip key={b.pid} {...b} tid={tid} />)}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  FinalCountdown
// ══════════════════════════════════════════════════════════════════
//  `result` is scored off the CONCEALED hole data, so `holes[through - 1]`
//  is the last one with anything in it. `totals` / `toWin` / `clincher`
//  are the cup as the scoreboard has it — revealed points only — which is
//  what makes the bar across the top move as the holes come out.
export function FinalCountdown({
  match, result, getScore, holePars, holeHcps, tPlayers, teams, courseName, formatLabel,
  through, totals, toWin, clincher, canAdvance, onAdvance, onClose,
}) {
  const [stage, setStage] = useState(STAGE_DONE);
  const holeIdx = through - 1;
  const { nameOf } = playerLookup(tPlayers);

  // ── The stagger ──────────────────────────────────────────────────
  // Each new hole opens closed and walks itself open. Keyed on `through`,
  // which is the live Firestore field — so a hole tapped on the director's
  // phone opens the same way, at the same pace, on the television and on
  // every phone in the room, rather than only on the screen that was
  // touched.
  //
  // The reset happens DURING RENDER, not in the effect below. If it were in
  // the effect, the new hole would paint fully open for one frame before
  // closing again — the whole hole given away, then taken back, which is the
  // one thing this screen must not do. Adjusting state on a changed prop
  // during render is React's own answer to exactly this.
  const [stagedFor, setStagedFor] = useState(through);
  if (stagedFor !== through) {
    setStagedFor(through);
    setStage(through > 0 ? 0 : STAGE_DONE);
  }
  useEffect(() => {
    if (through <= 0) return undefined;
    const timers = STAGE_AT.map((ms, i) => setTimeout(() => setStage(i + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, [through]);

  const advance = useCallback(() => {
    if (through > 0 && stage < STAGE_DONE) { setStage(STAGE_DONE); return; }
    if (canAdvance && through < HOLE_COUNT) onAdvance(through + 1);
  }, [through, stage, canAdvance, onAdvance]);

  const back = useCallback(() => {
    if (canAdvance && through > 0) onAdvance(through - 1);
  }, [through, canAdvance, onAdvance]);

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
  const ballsFor = (tid) => {
    const pids = tid === "A" ? match.teamA : match.teamB;
    const made = hr?.counted?.[tid] || null;
    return (pids || []).map((pid) => {
      const gross = getScore(pid, holeIdx) || null;
      const strokes = result?.strokeMaps?.[pid]?.[holeIdx] || 0;
      return {
        pid, name: nameOf(pid), gross, strokes,
        net: gross == null || gross <= 0 ? null : gross - strokes,
        // No counted list means every ball made the number (a Team Total, a
        // Singles) — dimming all of them would be a lie about the format.
        counted: made ? made.includes(pid) : true,
      };
    });
  };

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
        cursor: canAdvance ? "pointer" : "default", userSelect: "none", overflow: "hidden",
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
  // A HALVED hole is split down the middle in both teams' colours rather
  // than left grey. Grey is what an unturned hole looks like, and from the
  // back of a room "we halved it" and "we haven't seen it yet" reading the
  // same is the one mistake this strip can make — it is the thing everybody
  // is counting.
  const strip = (
    <div style={{ flexShrink: 0, display: "flex", gap: "clamp(2px, 0.3vw, 6px)" }}>
      {Array.from({ length: HOLE_COUNT }, (_, i) => {
        const out = i < through;
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

  const controls = canAdvance ? (
    <div style={{ flexShrink: 0, display: "flex", gap: "clamp(5px, 0.7vw, 14px)", alignItems: "stretch" }} onClick={(e) => e.stopPropagation()}>
      <button onClick={back} disabled={through <= 0} style={{
        padding: "clamp(6px, 0.9vw, 18px) clamp(10px, 1.4vw, 28px)", borderRadius: "clamp(6px, 0.8vw, 16px)",
        background: BC.inp, border: `1px solid ${BC.bdr}`, color: BC.t2, fontFamily: FONT,
        fontSize: T.btn, fontWeight: 800, letterSpacing: 1,
        opacity: through <= 0 ? 0.35 : 1, cursor: through <= 0 ? "not-allowed" : "pointer",
      }}>◀</button>
      <button onClick={advance} disabled={through >= HOLE_COUNT && stage >= STAGE_DONE} style={{
        flex: 1, padding: "clamp(6px, 0.9vw, 18px) 0", borderRadius: "clamp(6px, 0.8vw, 16px)",
        background: through >= HOLE_COUNT ? BC.inp : BC.amberGlow,
        border: `1px solid ${through >= HOLE_COUNT ? BC.bdr : BC.amber}`,
        color: through >= HOLE_COUNT ? BC.t3 : BC.amberInk, fontFamily: FONT,
        fontSize: T.btn, fontWeight: 800, letterSpacing: 1.4,
        cursor: through >= HOLE_COUNT && stage >= STAGE_DONE ? "not-allowed" : "pointer",
      }}>
        {stage < STAGE_DONE ? "SKIP AHEAD"
          : through >= HOLE_COUNT ? "THAT'S THE LOT"
          : through === 0 ? "START THE COUNTDOWN ▸"
          : `REVEAL HOLE ${through + 1} ▸`}
      </button>
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
      }}>THE DIRECTOR IS DRIVING · TAP TO EXIT</button>
    </div>
  );

  // ── Before the first hole ──────────────────────────────────────
  if (through <= 0) {
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
        {controls}
      </>
    );
  }

  // ── A hole ─────────────────────────────────────────────────────
  const showA = stage >= 1;
  const showB = stage >= 2;
  const showVerdict = stage >= STAGE_DONE;
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
        <SideColumn tid="A" teamName={tA.name} score={hr?.aScore} balls={ballsFor("A")} revealed={showA} won={showVerdict && winner === "A"} />
        <div style={{ flexShrink: 0, fontSize: T.sideName, fontWeight: 800, color: BC.t3, opacity: 0.5 }}>vs</div>
        <SideColumn tid="B" teamName={tB.name} score={hr?.bScore} balls={ballsFor("B")} revealed={showB} won={showVerdict && winner === "B"} />
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
        {clincher && showVerdict ? (
          <div style={{ fontSize: T.cup, fontWeight: 800, letterSpacing: "0.14em", color: teamColor(clincher), lineHeight: 1.15 }}>
            🏆 {clincher === "A" ? tA.name : tB.name} WIN THE BOURBON CUP
          </div>
        ) : (
          <div style={{ fontSize: T.verdict, fontWeight: 800, letterSpacing: "0.1em", color: winner ? teamColor(winner) : BC.t2 }}>
            {!hr?.played ? "NO RESULT ON THIS HOLE"
              : verdictName
                ? `${verdictName} TAKE IT${holeValue ? `  ·  +${fmtPts(holeValue)}` : ""}`
                : `HALVED${holeValue ? `  ·  ${fmtPts(holeValue / 2)} EACH` : ""}`}
          </div>
        )}
      </div>

      {strip}
      {controls}
    </>
  );
}

export default FinalCountdown;
