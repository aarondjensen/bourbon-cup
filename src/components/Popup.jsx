// ══════════════════════════════════════════════════════════════════
//  Popup + ConfirmModal — shared modal chrome for every popup.
// ══════════════════════════════════════════════════════════════════
//
//  Public exports
//  ──────────────
//    • Popup        — base wrapper: backdrop, centering, frame, ESC
//                     close, optional ✕, scroll containment. Owns
//                     everything outside the inner content.
//    • ConfirmModal — title + message + Cancel / Confirm on top of Popup.
//                     Two API styles supported (see below).
//
//  Canonical z-index ladder
//  ────────────────────────
//    • content →  500  (edit/detail popups)
//    • modal   →  900  (confirm-on-top-of-content)
//    Toasts/overlays should live at 1000+ so they stack above modals.
//    Pass a number to override, or the strings "content" / "modal".
//    The ladder only works when the rungs share a stacking context —
//    ConfirmModal therefore always portals to <body>, so it wins over
//    portaled content popups regardless of where it's rendered from.
//
//  Migration cheat-sheet (replaces BC's bespoke inline modals)
//  ───────────────────────────────────────────────────────────
//  Before:
//    <div onClick={onClose} style={{ position:"fixed", inset:0,
//      background:"rgba(0,0,0,.6)", zIndex:500 }} />
//    <div style={{ position:"fixed", inset:0, zIndex:550, display:"flex",
//      alignItems:"center", justifyContent:"center", padding:20 }}>
//      <div onClick={e=>e.stopPropagation()} style={{ background:BC.bg,
//        border:`1px solid ${BC.bdr}`, borderRadius:14, padding:20,
//        width:"100%", maxWidth:360 }}>
//        {/* contents */}
//      </div>
//    </div>
//  After:
//    <Popup onClose={onClose} maxWidth={360} padding={20}>
//      {/* contents */}
//    </Popup>
//
//  Notes
//  ─────
//  • Stop-propagation on the inner card is automatic — children click
//    freely without closing the popup.
//  • The `data-popup` attribute on the backdrop is load-bearing, not
//    decoration: usePullToRefresh walks up from the touch target and
//    bails when it crosses one, which is how every popup — portaled or
//    inline — suppresses the pull-to-refresh gesture without anyone
//    remembering to register it anywhere. Don't remove it, and don't
//    build a popup that skips this wrapper without adding the marker.
//  • Colors come only from the live `BC` theme object; no team names or
//    team colors are baked in, so this chrome is safe across any year's
//    tournament config. ConfirmModal's confirm color is the primary
//    accent by default and switches to BC.danger for destructive actions.
// ══════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BC, FONT, ON_ACCENT, ON_AMBER, SHADOW, SCRIM, FS } from "../theme";

const Z_MAP = { content: 500, modal: 900 };
const STD_BACKDROP = SCRIM;

// The visible rectangle above the on-screen keyboard. iOS does NOT shrink CSS
// viewport units (svh/dvh/vh) for the keyboard, so a full-viewport overlay can
// render its card (and text field) behind the keys. Reading visualViewport and
// sizing the overlay to exactly that rect keeps the card in view. Only active
// when `enabled` (viewportFit modals) — otherwise it no-ops and returns a
// window-sized rect so non-keyboard modals pay nothing.
function useViewportRect(enabled) {
  const read = () => {
    if (typeof window === "undefined") return { top: 0, left: 0, width: 0, height: 0 };
    const v = window.visualViewport;
    if (v) return { top: v.offsetTop, left: v.offsetLeft, width: v.width, height: v.height };
    return { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
  };
  const [rect, setRect] = useState(read);
  useEffect(() => {
    if (!enabled) return;
    const v = window.visualViewport;
    const update = () => setRect(read());
    update();
    if (v) { v.addEventListener("resize", update); v.addEventListener("scroll", update); }
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      if (v) { v.removeEventListener("resize", update); v.removeEventListener("scroll", update); }
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, [enabled]);
  return rect;
}

export function Popup({
  onClose,
  maxWidth = 420,
  zIndex = "content",
  showClose = false,
  noBackdropClose = false,
  noEscClose = false,
  padding = 16,
  outerPadding = 16,
  innerStyle,
  // ── Mobile-modal opt-ins (default off → identical to the classic modal) ──
  //  portal      — render into <body> so a transformed ancestor can't trap
  //                position:fixed (needed when opened from a swipeable row).
  //  viewportFit — size the overlay to the visual viewport (above keyboard)
  //                instead of inset:0; the card manages its own inner scroll.
  //  align       — cross-axis placement: "center" (default) or "start".
  portal = false,
  viewportFit = false,
  align = "center",
  children,
}) {
  const z = typeof zIndex === "number" ? zIndex : (Z_MAP[zIndex] || 500);
  const rect = useViewportRect(viewportFit);
  const alignItems = align === "start" ? "flex-start" : "center";

  // ESC closes unless disabled. Only registers when onClose exists.
  useEffect(() => {
    if (!onClose || noEscClose) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, noEscClose]);

  const handleBackdrop = () => {
    if (!noBackdropClose && onClose) onClose();
  };

  const node = (
    <div
      onClick={handleBackdrop}
      data-popup
      style={{
        position: "fixed",
        // viewportFit: pin to the live visible rect (above the keyboard).
        // Otherwise the classic full-viewport overlay.
        ...(viewportFit
          ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height, paddingTop: `calc(env(safe-area-inset-top, 0px) + ${outerPadding}px)` }
          // Plain inset:0. This used to reach below the layout viewport to dim
          // the strip an old iOS home-screen icon leaves under it, which never
          // worked: the webview clips at its bottom edge, so the backdrop was
          // not painting down there and the strip was undimmed either way. It
          // is canvas-painted (see bcGlobalCSS) and no element can cover it, so
          // on that one install mode a modal leaves a card-coloured sliver at
          // the very bottom. Cosmetic, and cheaper than having every popup
          // reach out and mutate the root background.
          : { top: 0, left: 0, right: 0, bottom: 0 }),
        background: STD_BACKDROP,
        zIndex: z,
        display: "flex",
        alignItems,
        justifyContent: "center",
        padding: outerPadding,
        boxSizing: "border-box",
        overflowY: viewportFit ? "hidden" : "auto",
        overscrollBehavior: "contain",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: BC.bg,
          border: `1px solid ${BC.bdr}`,
          borderRadius: 14,
          // The app's font is set inline on each view root, not globally, so
          // a portaled popup (a direct <body> child) would otherwise fall
          // back to the browser default. Declare it here so every popup
          // matches the app no matter where it's mounted.
          fontFamily: FONT,
          width: "100%",
          maxWidth,
          // viewportFit cards fill the rect and scroll internally.
          maxHeight: viewportFit ? "100%" : "calc(100vh - 32px)",
          // ── The card is a FRAME. The scroller is inside it. ──
          // This used to be the scroller itself, with the ✕ absolutely
          // positioned in it — and an absolute box inside a scrolling
          // container scrolls with the content, so on a popup tall enough to
          // overflow (the finalize panel, the group switcher on a big
          // tournament) the close button scrolled off the top and left no way
          // to shut it. MNQ hit that first on its leaderboard and fixed it
          // this way; this is that fix.
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          overscrollBehavior: "contain",
          position: "relative",
          boxShadow: `0 12px 40px ${SHADOW}`,
          ...innerStyle,
        }}
      >
        {showClose && onClose && (
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              width: 32,
              height: 32,
              borderRadius: 8,
              // Opaque, not transparent. The content now scrolls UNDERNEATH
              // this button rather than carrying it away, which is the fix —
              // but a transparent button means rows slide visibly through the
              // glyph on their way past. MNQ landed on the same background for
              // the same reason.
              background: BC.bg,
              border: "none",
              color: BC.t3,
              fontSize: FS.lead,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              // Above the scroller, which is its own stacking context — see
              // the note on the scroller below.
              zIndex: 2,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        )}
        {/* Scrolling happens HERE, not on the card, so the ✕ stays pinned to a
            frame that never moves and the content travels underneath it.

            position:relative + zIndex:0 makes this its own stacking context,
            which keeps the ✕ VISIBLE as well as present: a popup whose content
            sticks a header at a high z-index would otherwise paint straight
            over the button as a plain sibling. Isolating the scroller caps
            every z-index inside the content below the close affordance, so no
            child can bury it.

            Layout intent from innerStyle is carried through rather than left
            on the card. Several callers pass display:flex + flexDirection to
            size their children against the popup; with the children now a
            level deeper, that flex context has to come with them or those
            popups lose their sizing. Everything else in innerStyle — the
            background, the border, the radius — belongs to the frame and
            stays there. */}
        <div style={{
          padding,
          // viewportFit cards don't scroll themselves; their content manages
          // its own scrolling against the keyboard-aware rect.
          overflowY: viewportFit ? "hidden" : "auto",
          overscrollBehavior: "contain",
          flex: 1,
          minHeight: 0,
          position: "relative",
          zIndex: 0,
          ...(innerStyle?.display ? { display: innerStyle.display } : null),
          ...(innerStyle?.flexDirection ? { flexDirection: innerStyle.flexDirection } : null),
        }}>
          {children}
        </div>
      </div>
    </div>
  );

  return portal && typeof document !== "undefined"
    ? createPortal(node, document.body)
    : node;
}

// ──────────────────────────────────────────────────────────────────
//  ConfirmModal — canonical title / message / Cancel / Confirm modal.
//  Defaults to zIndex "modal" so a confirm raised from inside another
//  popup naturally stacks on top.
//
//  Two API styles, both supported:
//    Legacy (nullable-state pattern):
//      <ConfirmModal modal={confirmModal} />
//      where confirmModal is { title, message, onConfirm, onCancel,
//      confirmLabel, cancelLabel, destructive, eyebrow } or null.
//    Inline props:
//      <ConfirmModal title="…" message="…" onConfirm={..} onCancel={..}
//        variant="danger" />
//
//  Renders nothing when neither title nor message is present (or when
//  `modal` is explicitly null). destructive=true and variant="danger"
//  both render a red (BC.danger) confirm button.
// ──────────────────────────────────────────────────────────────────
export function ConfirmModal(props) {
  // Prefer an explicit `modal` prop if present (even when null — that's
  // the legacy nullable-state gate); otherwise read inline props.
  const m = "modal" in props ? props.modal : props;
  if (!m) return null;
  if (!m.title && !m.message) return null;
  return <ConfirmModalInner m={m} />;
}

// Split so the mount effect below can use hooks past ConfirmModal's
// nullable-state early returns.
function ConfirmModalInner({ m }) {
  // Drop the on-screen keyboard the moment a confirm opens. A confirm is
  // routinely raised while a text field still has focus (e.g. typing a
  // handicap override, then tapping Save) and iOS does NOT shrink the
  // layout viewport for the keyboard — so this full-viewport-centered card
  // could sit hidden under the keys while the keyboard-aware (viewportFit)
  // popup beneath stays visible, reading as "the confirm is behind".
  // Blurring closes the keyboard and restores the full visible viewport.
  useEffect(() => {
    const el = document.activeElement;
    if (el && el !== document.body && typeof el.blur === "function") el.blur();
  }, []);

  const isDanger = m.destructive === true || m.variant === "danger";
  const confirmBg = isDanger ? BC.danger : BC.amber;
  // ON_AMBER, not BC.bg: which ink an amber button takes is decided by the
  // FILL, never by the theme. BC.bg happens to be near-black in dark mode,
  // which is why this read correctly there and read as near-white on
  // mid-amber — 3.42:1 — in light.
  const confirmFg = isDanger ? ON_ACCENT : ON_AMBER;
  const handleCancel = m.onCancel || (() => {});

  return (
    // Always portaled: a confirm is by definition the topmost layer, and the
    // z ladder (modal 900 over content 500) only holds when both live in the
    // root stacking context. Rendered inline, an app ancestor's transform /
    // filter / opacity traps the confirm's z-index inside that context, and a
    // portaled content popup (e.g. the player editor) paints over it.
    <Popup onClose={handleCancel} maxWidth={340} zIndex="modal" padding={20} portal>
      {m.eyebrow && (
        <div style={{
          fontSize: FS.small, fontWeight: 700, color: BC.amberInk,
          letterSpacing: 1.5, textTransform: "uppercase",
          marginBottom: 10,
        }}>{m.eyebrow}</div>
      )}
      <div style={{
        fontSize: FS.body, fontWeight: 700, color: BC.t1,
        marginBottom: m.message ? 6 : 16,
      }}>{m.title}</div>
      {m.message && (
        <div style={{
          fontSize: FS.body, color: BC.t2, lineHeight: 1.5,
          marginBottom: 16, whiteSpace: "pre-line",
        }}>{m.message}</div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        {/* alert=true → informational notice: one OK button, no choice to
            make. Backdrop/ESC still settle it via onCancel. */}
        {!m.alert && (
          <button
            onClick={handleCancel}
            style={{
              flex: 1, padding: 12, borderRadius: 10,
              background: BC.inp, border: `1px solid ${BC.bdr}`,
              color: BC.t2, fontSize: FS.body, fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {m.cancelLabel || "Cancel"}
          </button>
        )}
        <button
          onClick={m.onConfirm}
          style={{
            flex: 1, padding: 12, borderRadius: 10,
            background: confirmBg, border: "none",
            color: confirmFg, fontSize: FS.body, fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {m.confirmLabel || (m.alert ? "OK" : "Confirm")}
        </button>
      </div>
    </Popup>
  );
}
