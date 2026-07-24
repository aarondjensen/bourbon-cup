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
//  • The `data-popup` attribute is left on the backdrop as a hook for
//    any future DOM-based popup detection. BC's pull-to-refresh instead
//    suppresses via the state-driven popupOpenRef, so keep flipping that
//    when you open a Popup (set it true while mounted) to keep the
//    gesture from firing behind the modal.
//  • Colors come only from the live `BC` theme object; no team names or
//    team colors are baked in, so this chrome is safe across any year's
//    tournament config. ConfirmModal's confirm color is the primary
//    accent by default and switches to BC.danger for destructive actions.
// ══════════════════════════════════════════════════════════════════

import { useEffect } from "react";
import { BC } from "../theme";

const Z_MAP = { content: 500, modal: 900 };
const STD_BACKDROP = "rgba(0, 0, 0, 0.65)";

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
  children,
}) {
  const z = typeof zIndex === "number" ? zIndex : (Z_MAP[zIndex] || 500);

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

  return (
    <div
      onClick={handleBackdrop}
      data-popup
      style={{
        position: "fixed",
        inset: 0,
        background: STD_BACKDROP,
        zIndex: z,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: outerPadding,
        overflowY: "auto",
        overscrollBehavior: "contain",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: BC.bg,
          border: `1px solid ${BC.bdr}`,
          borderRadius: 14,
          padding,
          width: "100%",
          maxWidth,
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          overscrollBehavior: "contain",
          position: "relative",
          boxShadow: "0 12px 40px rgba(0, 0, 0, 0.4)",
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
              background: "transparent",
              border: "none",
              color: BC.t3,
              fontSize: 17,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        )}
        {children}
      </div>
    </div>
  );
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

  const isDanger = m.destructive === true || m.variant === "danger";
  const confirmBg = isDanger ? BC.danger : BC.amber;
  const confirmFg = isDanger ? "#fff" : BC.bg;
  const handleCancel = m.onCancel || (() => {});

  return (
    <Popup onClose={handleCancel} maxWidth={340} zIndex="modal" padding={20}>
      {m.eyebrow && (
        <div style={{
          fontSize: 11, fontWeight: 700, color: BC.amber,
          letterSpacing: 1.5, textTransform: "uppercase",
          marginBottom: 10,
        }}>{m.eyebrow}</div>
      )}
      <div style={{
        fontSize: 14, fontWeight: 700, color: BC.t1,
        marginBottom: m.message ? 6 : 16,
      }}>{m.title}</div>
      {m.message && (
        <div style={{
          fontSize: 13, color: BC.t2, lineHeight: 1.5,
          marginBottom: 16, whiteSpace: "pre-line",
        }}>{m.message}</div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={handleCancel}
          style={{
            flex: 1, padding: 12, borderRadius: 10,
            background: BC.inp, border: `1px solid ${BC.bdr}`,
            color: BC.t2, fontSize: 14, fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {m.cancelLabel || "Cancel"}
        </button>
        <button
          onClick={m.onConfirm}
          style={{
            flex: 1, padding: 12, borderRadius: 10,
            background: confirmBg, border: "none",
            color: confirmFg, fontSize: 14, fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {m.confirmLabel || "Confirm"}
        </button>
      </div>
    </Popup>
  );
}
