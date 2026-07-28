// ══════════════════════════════════════════════════════════════════
//  ui — small shared presentational primitives.
// ══════════════════════════════════════════════════════════════════
//  One home for the chrome that was previously copy-pasted inline across
//  App.jsx. All colors come from the live BC theme.
//    • SegmentedToggle — the rounded pill tab switcher.
//    • StickyTop       — the pinned control strip at the top of a tab.
//    • Banner          — the amber section header strip.
//    • Toast           — the transient "slides down from the top" toast.
//    • ScoreButtonRow  — the tappable par-relative score entry row.

import { BC, ON_ACCENT, SHADOW, ON_AMBER, FS } from "../theme";

const FONT = "'Montserrat', sans-serif";

// ── SegmentedToggle ──
// options: array of [key, label]. `value` is the active key; `onChange(key)`
// fires on tap. variant "gradient" (amber gradient + dark ink, the default)
// or "flat" (solid amber + white). Extra container style via `style`
// (e.g. { marginBottom: 14 } or { flex: 1 } inside a row).
export function SegmentedToggle({ options, value, onChange, variant = "gradient", letterSpacing, style }) {
  const activeBg = variant === "flat"
    ? BC.amber
    : `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})`;
  const activeFg = variant === "flat" ? ON_ACCENT : ON_AMBER;
  return (
    <div style={{ display: "flex", background: BC.card, borderRadius: 20, padding: 3, border: `1px solid ${BC.bdr}`, ...style }}>
      {options.map(([k, label]) => {
        const on = value === k;
        return (
          <button
            key={k}
            onClick={onChange ? () => onChange(k) : undefined}
            style={{
              flex: 1, padding: "8px 0", borderRadius: 16, fontSize: FS.small, fontWeight: 700,
              cursor: "pointer", border: "none",
              background: on ? activeBg : "transparent",
              color: on ? activeFg : BC.t3,
              ...(letterSpacing != null ? { letterSpacing } : {}),
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ── StickyTop ──
// The pinned control strip at the top of a tab. Every tab leads with the one
// control the whole view is steered from — the Leaderboard's cup total, the
// Admin tab bar, the Matches round pills, the Betting mode toggle — and each
// of them pins here, so that control lands in the SAME place on every tab
// instead of wherever that tab's content height happens to put it.
//
// Two details are what make it hold:
//   • The wrapper is painted in the page bg and carries the gap BELOW it as
//     padding, so content scrolls under it with nothing showing through.
//   • A sticky box pins to the scroll container's CONTENT box, not its
//     padding box, so the body's top padding stays a live strip of scrolling
//     content ABOVE the pin — hole strips and cards slide through it. The
//     absolute cover (bottom:100%) paints that strip in the page bg. It rides
//     directly above the wrapper rather than being sized to the body's
//     padding, so it stays correct if that padding ever changes; the scroll
//     container clips whatever hangs past its top edge.
export function StickyTop({ children, padTop = 0, padBottom = 12, style }) {
  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 5,
      background: BC.bg, paddingTop: padTop, paddingBottom: padBottom,
      ...style,
    }}>
      <div style={{
        position: "absolute", left: 0, right: 0, bottom: "100%",
        height: 40, background: BC.bg, pointerEvents: "none",
      }} />
      {children}
    </div>
  );
}

// ── Banner ──
// The amber section-header strip (e.g. TEAMS / ROUND 2 / SKINS).
export function Banner({ children, background = BC.amber, color = ON_ACCENT }) {
  return (
    <div style={{ padding: "8px 14px", background, textAlign: "center" }}>
      <div style={{ fontSize: FS.small, color, fontWeight: 800, letterSpacing: 2 }}>{children}</div>
    </div>
  );
}

// ── Toast ──
// Transient action feedback that slides down from the top-center. Renders
// nothing when `message` is falsy, so callers just pass their toast state.
export function Toast({ message, top = 30 }) {
  if (!message) return null;
  return (
    <>
      <style>{`@keyframes bcToastDown { 0% { transform: translateX(-50%) translateY(-20px); opacity: 0; } 100% { transform: translateX(-50%) translateY(0); opacity: 1; } }`}</style>
      <div style={{
        position: "fixed", top, left: "50%", transform: "translateX(-50%)",
        background: BC.amber, color: ON_AMBER,
        padding: "12px 32px", borderRadius: 12,
        fontSize: FS.body, fontWeight: 700, zIndex: 1000,
        whiteSpace: "nowrap", textAlign: "center",
        boxShadow: `0 8px 32px ${SHADOW}`,
        animation: "bcToastDown 0.3s ease",
        fontFamily: FONT,
      }}>
        {message}
      </div>
    </>
  );
}

// ── ScoreButtonRow ──
// The tappable score-entry row used on every scoring screen. Ported from
// MNQ's PlayerScoreCard so the two apps present score entry identically —
// a golfer switching between them shouldn't have to re-learn the control.
//
// Shape (left → right): a − nudge, five par-relative buttons, a + nudge.
// The window is [par-1 … par+3] — birdie / par / bogey / double / triple —
// which is the range real scores land in; the nudges cover everything else.
// Buttons are 44px tall (Apple HIG minimum touch target) and each reserves
// a 12px label slot beneath it so the row height never shifts.
//
// `score` is the saved gross for the hole (0 = none). `onScore(value)` is
// called with the new gross; 0 means "clear" (tapping the active button
// again). `par` drives both the window and the score-shape iconography.
const SCORE_LABELS = ["Birdie", "Par", "Bogey", "Double", "Triple"];

export function ScoreButtonRow({ par, score, onScore }) {
  // Recenter — when the saved score falls outside [par-1, par+3] (an ace on
  // a par 3, a 9 on a par 4) the whole window slides so the saved number is
  // visible and re-tappable. Because par-1 >= 2 and score >= 1, the shifted
  // low end can never drop below 1, so no clamp is needed.
  const defaultBtns = [par - 1, par, par + 1, par + 2, par + 3];
  const maxBtn = defaultBtns[defaultBtns.length - 1];
  const minBtn = defaultBtns[0];
  let btns = defaultBtns;
  if (score > maxBtn) btns = defaultBtns.map(b => b + (score - maxBtn));
  else if (score > 0 && score < minBtn) btns = defaultBtns.map(b => b - (minBtn - score));
  // Reference equality is intentional: btns === defaultBtns is true ONLY when
  // recenter didn't fire (otherwise we re-assigned to a freshly-mapped array).
  // In the recentered case the labels would mislabel the numbers under them
  // ("Birdie" sitting under a 5 on a par 4), so we blank them — the empty
  // slot still reserves its height.
  const showLabels = btns === defaultBtns;

  const nudge = {
    width: 30, height: 44, borderRadius: 8, background: BC.inp, border: "none",
    color: BC.t3, fontSize: FS.body, fontWeight: 700, cursor: "pointer", flexShrink: 0,
  };

  return (
    <div style={{ display: "flex", gap: 4, alignItems: "flex-start" }}>
      {/* − sits at the FAR LEFT (not next to +) so the par button lands dead
          center of the seven-control row. Symmetric with the + on the right. */}
      <button onClick={() => onScore(Math.max(1, (score || par) - 1))} style={nudge}>−</button>
      {btns.map((btn, idx) => {
        const isCur = btn === score;
        const sd = btn - par;
        const boxSize = 32;
        // Par anchor — the par button's label gets a brighter color and a
        // bolder weight so the eye finds par as the visual reference.
        // Suppressed when par is the selected score (the amber fill is
        // already the focal point) and absent entirely when recentered,
        // since par isn't in the window then.
        const showParAnchor = btn === par && !isCur;
        return (
          <div key={btn} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0 }}>
            <button onClick={() => onScore(isCur ? 0 : btn)} style={{
              width: "100%", height: 44, borderRadius: 8, cursor: "pointer", fontSize: FS.lead, fontWeight: 800,
              border: "none", background: isCur ? BC.amber : BC.inp, color: isCur ? ON_AMBER : BC.t2,
              position: "relative", display: "flex", alignItems: "center", justifyContent: "center",
              // No CSS transition: when the hole auto-advances, all four
              // selections should swap instantly. A fade cross-dissolves them
              // through a half-amber state that reads as ghost selections.
            }}>
              {/* SELECTED-STATE rings — red circle for under par (nested for
                  eagle-or-better), dark square for over par (nested for
                  double-bogey-or-worse). Drawn over the amber fill. */}
              {isCur && sd !== 0 && (
                <div style={{ position: "absolute", width: boxSize, height: boxSize, left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}>
                  <div style={{ position: "absolute", inset: 0, borderRadius: sd < 0 ? "50%" : 3, border: `1.5px solid ${sd < 0 ? BC.danger : ON_AMBER}` }} />
                  {Math.abs(sd) >= 2 && (
                    <div style={{ position: "absolute", inset: 3, borderRadius: sd < 0 ? "50%" : 2, border: `1px solid ${sd < 0 ? BC.danger : ON_AMBER}` }} />
                  )}
                </div>
              )}
              {/* RESTING-STATE outlines — same geometry at 0.15 opacity so the
                  row previews what each number means before it's tapped.
                  Skipped on par (its own anchor is the label emphasis). */}
              {!isCur && sd !== 0 && (
                <div style={{ position: "absolute", width: boxSize, height: boxSize, left: "50%", top: "50%", transform: "translate(-50%, -50%)", opacity: 0.15 }}>
                  <div style={{ position: "absolute", inset: 0, borderRadius: sd < 0 ? "50%" : 3, border: `1.25px solid ${sd < 0 ? BC.danger : BC.t2}` }} />
                  {Math.abs(sd) >= 2 && (
                    <div style={{ position: "absolute", inset: 3, borderRadius: sd < 0 ? "50%" : 2, border: `1px solid ${sd < 0 ? BC.danger : BC.t2}` }} />
                  )}
                </div>
              )}
              <span style={{ position: "relative", zIndex: 1 }}>{btn}</span>
            </button>
            {/* Uppercase to match how MNQ renders these — its shell sets a
                global text-transform, so the labels read as small caps there. */}
            <div style={{
              fontSize: FS.label, color: showParAnchor ? BC.t2 : BC.t3, fontWeight: showParAnchor ? 700 : 600,
              letterSpacing: 0.4, lineHeight: 1, height: 12, textTransform: "uppercase",
            }}>
              {showLabels ? SCORE_LABELS[idx] : ""}
            </div>
          </div>
        );
      })}
      <button onClick={() => onScore((score || par) + 1)} style={nudge}>+</button>
    </div>
  );
}
