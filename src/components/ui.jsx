// ══════════════════════════════════════════════════════════════════
//  ui — small shared presentational primitives.
// ══════════════════════════════════════════════════════════════════
//  One home for the chrome that was previously copy-pasted inline across
//  App.jsx. All colors come from the live BC theme.
//    • SegmentedToggle — the rounded pill tab switcher.
//    • Banner          — the amber section header strip.
//    • Toast           — the transient "slides down from the top" toast.

import { BC } from "../theme";

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
  const activeFg = variant === "flat" ? "#fff" : "#0a0804";
  return (
    <div style={{ display: "flex", background: BC.card, borderRadius: 20, padding: 3, border: `1px solid ${BC.bdr}`, ...style }}>
      {options.map(([k, label]) => {
        const on = value === k;
        return (
          <button
            key={k}
            onClick={onChange ? () => onChange(k) : undefined}
            style={{
              flex: 1, padding: "8px 0", borderRadius: 16, fontSize: 12, fontWeight: 700,
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

// ── Banner ──
// The amber section-header strip (e.g. TEAMS / ROUND 2 / SKINS).
export function Banner({ children, background = BC.amber, color = "#fff" }) {
  return (
    <div style={{ padding: "8px 14px", background, textAlign: "center" }}>
      <div style={{ fontSize: 11, color, fontWeight: 800, letterSpacing: 2 }}>{children}</div>
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
        background: BC.amber, color: "#0a0804",
        padding: "12px 32px", borderRadius: 12,
        fontSize: 13, fontWeight: 700, zIndex: 1000,
        whiteSpace: "nowrap", textAlign: "center",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        animation: "bcToastDown 0.3s ease",
        fontFamily: FONT,
      }}>
        {message}
      </div>
    </>
  );
}
