// ══════════════════════════════════════════════════════════════════
//  ui — small shared presentational primitives.
// ══════════════════════════════════════════════════════════════════
//  One home for the chrome that was previously copy-pasted inline across
//  App.jsx. All colors come from the live BC theme.
//    • SegRule         — the amber rule under a selected segment.
//    • SegmentedToggle — the rounded pill tab switcher.
//    • StickyTop       — the pinned control strip at the top of a tab.
//    • Banner          — the brown section header strip.
//    • Toast           — the transient "slides down from the top" toast.
//    • ScoreButtonRow  — the tappable par-relative score entry row.

import { BC, FONT, ON_ACCENT, BROWN, HOLE_BANNER, SHADOW, ALPHA, dimHex, FS, segThumb, segTrack } from "../theme";


// The rule that marks the thumb. A child rather than a border because it is
// shorter than the pill: an edge-to-edge line reads as a second border on the
// thumb, a short one reads as an underline on the label.
export function SegRule({ compact = false }) {
  return (
    <span style={{
      position: "absolute", left: "50%", transform: "translateX(-50%)",
      bottom: compact ? 3 : 4, width: compact ? 12 : 18, height: 2,
      borderRadius: 1, background: BC.amber,
    }} />
  );
}

// ── SegmentedToggle ──
// options: array of [key, label]. `value` is the active key; `onChange(key)`
// fires on tap. Extra container style via `style` (e.g. { marginBottom: 14 }).
//
// Two variants. There were four; `flat` and `outline` were a solid-amber
// track and an amber-edged picker, and once selection stopped being drawn in
// amber they were two more answers to a question that now has one:
//
//   segmented a sunken track holding the thumb. The default, and what a mode
//             switch inside a card looks like.
//   pills     free-standing buttons with a gap between them — a row of TABS
//             (rounds, matches) sitting on the page rather than in a card.
//             Unselected sits in the sunken fill so the selected one has
//             something to be raised out of; the track variant gets that from
//             the track itself.
//
// The track owns its background and its buttons are borderless; the pills
// have no track and each button carries its own edge. That is the whole
// difference — the selected state is the same object in both.
export function SegmentedToggle({ options, value, onChange, variant = "segmented", letterSpacing, style }) {
  const tracked = variant === "segmented";
  // The track is the sunken one so its thumb has something to be raised out
  // of. Free-standing pills get the same recess per button instead.
  const track = tracked ? segTrack() : { gap: 6 };
  const btn = (on) => (tracked
    ? segThumb(on)
    : { ...segThumb(on, { sunken: true }), borderRadius: 8, border: `1px solid ${on ? "transparent" : BC.bdr}` });
  return (
    <div style={{ display: "flex", ...track, ...style }}>
      {options.map(([k, label]) => {
        const on = value === k;
        return (
          <button
            key={k}
            onClick={onChange ? () => onChange(k) : undefined}
            style={{
              flex: 1, padding: tracked ? "8px 0" : "8px 4px",
              fontSize: FS.small, fontWeight: 700, cursor: "pointer",
              fontFamily: FONT, ...btn(on),
              ...(letterSpacing != null ? { letterSpacing } : {}),
            }}
          >
            {label}
            {on && <SegRule />}
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
// The brown section-header strip (e.g. TEAMS / ROUND 2 / SKINS). See
// theme's BROWN for why the fill is one value rather than one per mode.
export function Banner({ children, background = BROWN, color = ON_ACCENT }) {
  return (
    <div style={{ padding: "8px 14px", background, textAlign: "center" }}>
      <div style={{ fontSize: FS.small, color, fontWeight: 800, letterSpacing: 2 }}>{children}</div>
    </div>
  );
}

// ── Toast ──
// Transient feedback, top-centre, sliding down. The app had two of these: an
// amber one here for "hole saved", and a red/green `Notif` in App.jsx for
// everything else — same job, same corner of the screen, two looks, and which
// one you got depended on which screen you were standing on.
//
// This is the one. `type` picks the accent, so a message reads as what it is
// before it is read at all; the chip stays dark in both modes because it
// floats over whatever was already on screen and cannot borrow that screen's
// surface without sometimes vanishing into it.
//
// Deliberately CONTROLLED — it renders `message` and nothing else. That is
// what let the two merge: `notify()` is fire-and-forget and owns its own
// 2.8s timer, while the scoring screens hold their toast open for exactly
// the 1.8s auto-advance window and clear it the moment the hole changes.
// Both are just a caller deciding when `message` is truthy.
const TOAST_ACCENT = { error: "danger", warn: "warn", success: "green" };
export function Toast({ message, type = "success", top = 30 }) {
  if (!message) return null;
  const accent = BC[TOAST_ACCENT[type] || "green"];
  return (
    <>
      <style>{`@keyframes bcToastDown { 0% { transform: translateX(-50%) translateY(-20px); opacity: 0; } 100% { transform: translateX(-50%) translateY(0); opacity: 1; } }`}</style>
      <div style={{
        position: "fixed", top, left: "50%", transform: "translateX(-50%)",
        background: dimHex(accent, 0.42), border: `1px solid ${accent}`,
        color: ON_ACCENT,
        padding: "10px 22px", borderRadius: 12,
        fontSize: FS.body, fontWeight: 700, zIndex: 1000,
        maxWidth: "80vw", textAlign: "center",
        boxShadow: `0 8px 32px ${SHADOW}`,
        animation: "bcToastDown 0.3s ease",
        fontFamily: FONT,
      }}>
        {message}
      </div>
    </>
  );
}

// ── HoleNavigator ──
// The banner over every scoring screen: ‹ prev, then Par / HOLE n / HCP, then
// next ›. Both scoring screens carried a verbatim copy of it — thirty-one
// lines, identical down to the 0.75 opacity on the three little captions.
// `sizes` lets a caller that is fighting for vertical room compact the bar —
// the scoring screen passes its density's figures. Omitted, it renders at the
// dimensions both screens used before it was shared.
const HOLE_NAV_SIZES = { pad: "4px 8px", gap: 6, nav: 36, num: FS.hero, label: FS.micro, side: FS.lead };

export function HoleNavigator({ hole, par, hcp, onGo, sizes = HOLE_NAV_SIZES }) {
  const { fill, ink } = HOLE_BANNER;
  const arrow = (dir) => {
    const at = dir < 0 ? hole === 0 : hole === 17;
    return (
      <button
        onClick={() => onGo(Math.max(0, Math.min(17, hole + dir)))}
        disabled={at}
        style={{
          width: 28, height: sizes.nav, borderRadius: 8, background: "none", border: "none",
          cursor: at ? "default" : "pointer",
          color: at ? `${ink}${ALPHA.line}` : ink,
          fontSize: FS.title, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >{dir < 0 ? "\u2039" : "\u203a"}</button>
    );
  };
  const cap = { fontSize: sizes.label, color: ink, fontWeight: 600, opacity: 0.75 };
  const val = { fontSize: sizes.side, fontWeight: 800, color: ink };
  return (
    <div style={{
      background: fill, borderRadius: 10, padding: sizes.pad, marginBottom: sizes.gap,
      display: "flex", alignItems: "center", flexShrink: 0,
    }}>
      {arrow(-1)}
      <div style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 8px" }}>
        <div style={{ textAlign: "center", minWidth: 32 }}>
          <div style={cap}>Par</div>
          <div style={val}>{par}</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ ...cap, textTransform: "uppercase", letterSpacing: 1 }}>Hole</div>
          <div style={{ fontSize: sizes.num, fontWeight: 800, color: ink, lineHeight: 1 }}>{hole + 1}</div>
        </div>
        <div style={{ textAlign: "center", minWidth: 32 }}>
          <div style={cap}>HCP</div>
          <div style={val}>{hcp}</div>
        </div>
      </div>
      {arrow(1)}
    </div>
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

export function ScoreButtonRow({ par, score, onScore, fill = false, minHeight = 44, fontSize = FS.lead, labels = true }) {
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
  const showLabels = labels && btns === defaultBtns;
  // The label slot is what keeps the row a stable height, so it holds its
  // 12px whenever labels are on — even in the recentered case, where the
  // text is blanked rather than removed. Turned off entirely (`labels`
  // false) it gives the row back, which is how the scoring screen's tight
  // density buys the last few pixels it needs.
  const labelH = labels ? 12 : 0;
  // `fill` hands the row's height over to its container: buttons stretch to
  // whatever the card has left rather than standing at a fixed 44. minHeight
  // is the floor below which a tap target stops being one.
  const btnBox = fill
    ? { flex: "1 1 auto", minHeight, height: "auto" }
    : { height: minHeight };

  // t2, not t3: the glyph IS the control here, and on the sunken `inp` fill
  // t3 measured 4.23:1 in dark and 2.67:1 in light — the second of those is
  // under the 3:1 floor for a graphical control, never mind text. t2 keeps
  // them quieter than the score numbers (t1) without making them a guess.
  const nudge = {
    width: 30, borderRadius: 8, background: BC.inp, border: "none",
    color: BC.t2, fontSize: FS.body, fontWeight: 700, cursor: "pointer", flexShrink: 0,
    ...btnBox,
  };
  // Each control sits in a column with a label slot beneath it, the nudges
  // included — their slot is empty, but reserving it is what keeps them
  // level with the score buttons instead of hanging a label's worth lower.
  const column = { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0, height: "100%" };

  return (
    <div style={{
      display: "flex", gap: 4, alignItems: "stretch",
      // width, not flex: the row is a block child in the practice tab and a
      // flex item in the scoring tab, and as a flex item it would otherwise
      // shrink to its content instead of spanning the card.
      width: "100%", minWidth: 0,
      height: fill ? "100%" : "auto", minHeight: 0,
    }}>
      {/* − sits at the FAR LEFT (not next to +) so the par button lands dead
          center of the seven-control row. Symmetric with the + on the right. */}
      <div style={{ ...column, flex: "0 0 auto" }}>
        <button onClick={() => onScore(Math.max(1, (score || par) - 1))} style={nudge}>−</button>
        <div style={{ height: labelH }} />
      </div>
      {btns.map((btn, idx) => {
        const isCur = btn === score;
        const sd = btn - par;
        const boxSize = 32;
        // Par anchor — the par button's label gets a brighter color and a
        // bolder weight so the eye finds par as the visual reference.
        // Suppressed when par is the selected score (the selected fill is
        // already the focal point) and absent entirely when recentered,
        // since par isn't in the window then.
        const showParAnchor = btn === par && !isCur;
        return (
          <div key={btn} style={{ ...column, flex: 1 }}>
            <button onClick={() => onScore(isCur ? 0 : btn)} style={{
              width: "100%", ...btnBox, borderRadius: 8, cursor: "pointer", fontSize, fontWeight: 800,
              // BROWN, not amber. The selected score is the biggest filled
              // block on the screen after the hole banner, and in amber the
              // two sat at the same hue 24 points of lightness apart — near
              // enough to read as a failed match rather than a pair. One
              // warm FILL for the whole screen; gold stays what it is
              // everywhere else, an ink and a hairline. See theme's BROWN.
              border: "none", background: isCur ? BROWN : BC.inp, color: isCur ? ON_ACCENT : BC.t2,
              position: "relative", display: "flex", alignItems: "center", justifyContent: "center",
              // No CSS transition: when the hole auto-advances, all four
              // selections should swap instantly. A fade cross-dissolves them
              // through a half-amber state that reads as ghost selections.
            }}>
              {/* SELECTED-STATE rings — circle for under par (nested for
                  eagle-or-better), square for over par (nested for
                  double-bogey-or-worse), drawn over the selected fill.

                  Both in the fill's own ink. The under-par one used to be
                  BC.danger, which measured 1.65:1 on the old amber fill and
                  1.32:1 on this one — a red ring nobody could see, on the
                  one score anybody wants to look at. The SHAPE is what says
                  under or over par; it always was, since a birdie and a
                  bogey are a circle and a square either way. Red survives
                  where it is legible: the resting outlines below, on the
                  sunken fill. */}
              {isCur && sd !== 0 && (
                <div style={{ position: "absolute", width: boxSize, height: boxSize, left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}>
                  <div style={{ position: "absolute", inset: 0, borderRadius: sd < 0 ? "50%" : 3, border: `1.5px solid ${ON_ACCENT}` }} />
                  {Math.abs(sd) >= 2 && (
                    <div style={{ position: "absolute", inset: 3, borderRadius: sd < 0 ? "50%" : 2, border: `1px solid ${ON_ACCENT}` }} />
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
              letterSpacing: 0.4, lineHeight: 1, height: labelH, textTransform: "uppercase",
            }}>
              {showLabels ? SCORE_LABELS[idx] : ""}
            </div>
          </div>
        );
      })}
      <div style={{ ...column, flex: "0 0 auto" }}>
        <button onClick={() => onScore((score || par) + 1)} style={nudge}>+</button>
        <div style={{ height: labelH }} />
      </div>
    </div>
  );
}
