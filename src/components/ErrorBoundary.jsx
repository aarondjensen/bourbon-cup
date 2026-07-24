import { Component } from "react";
import { BC } from "../theme";

// ══════════════════════════════════════════════════════════════════
//  ErrorBoundary — friendly fallback instead of a blank white screen.
// ══════════════════════════════════════════════════════════════════
// Catches runtime errors anywhere in its child tree and renders a
// recoverable fallback. Wrap the main view in App.jsx with a KEYED
// boundary (<ErrorBoundary key={view}>) so that switching tabs remounts
// the boundary and clears the error automatically — a crashed view
// self-heals the moment the user navigates away.
//
// React's error-boundary API (getDerivedStateFromError / componentDidCatch)
// only exists on class components, which is the sole reason this isn't a
// function component like the rest of the app.
//
// Colors are read inline from the live `BC` theme object so the fallback
// respects dark/light mode. No team names or team colors appear here —
// this is neutral tournament chrome, safe across any year's config.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Surface to devtools / Vercel logs. If external error reporting is
    // ever added (Sentry etc.), it would hook in here.
    console.error("[ErrorBoundary] Caught error in view:", error, errorInfo);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", padding: "40px 20px", minHeight: 300,
        textAlign: "center",
      }}>
        {/* Emoji-free warning mark (BC UI convention). Muted so it reads
            as reassuring, not alarming. */}
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
          style={{ marginBottom: 12, opacity: 0.6 }} aria-hidden="true">
          <path d="M12 3 L22 20 H2 Z" stroke={BC.t3} strokeWidth="1.6"
            strokeLinejoin="round" fill="none" />
          <line x1="12" y1="9.5" x2="12" y2="14" stroke={BC.t3}
            strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="12" cy="16.8" r="1" fill={BC.t3} />
        </svg>
        <div style={{
          fontSize: 17, fontWeight: 700, color: BC.t1,
          letterSpacing: 0.5, marginBottom: 6,
        }}>
          Something went wrong
        </div>
        <div style={{
          fontSize: 13, color: BC.t3, maxWidth: 300,
          lineHeight: 1.5, marginBottom: 20,
        }}>
          This screen hit an unexpected error. Try switching tabs, or reload the app.
        </div>
        <button onClick={() => window.location.reload()} style={{
          padding: "10px 20px", borderRadius: 8,
          background: BC.amber, border: "none",
          color: BC.bg, fontSize: 13, fontWeight: 700,
          cursor: "pointer", letterSpacing: 0.4,
        }}>
          Reload App
        </button>
        {/* Dev-only: show the real error so it's debuggable. Production
            users see only the friendly message above. */}
        {import.meta.env.DEV && this.state.error && (
          <pre style={{
            marginTop: 20, padding: 10, background: BC.card,
            border: `1px solid ${BC.bdr}`, borderRadius: 6,
            fontSize: 11, color: BC.danger, maxWidth: 400,
            overflow: "auto", textAlign: "left",
            whiteSpace: "pre-wrap", fontFamily: "monospace",
            textTransform: "none", letterSpacing: 0,
          }}>
            {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
          </pre>
        )}
      </div>
    );
  }
}
