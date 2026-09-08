// ══════════════════════════════════════════════════════════════════
//  SyncBanner — the one line that says this phone is on its own.
// ══════════════════════════════════════════════════════════════════
//
// Ported from WBC. Firestore queues a write with no signal instead of failing
// it, so a score can go green on a card that nobody else will see for an hour
// — and a REFUSED write is worse still, because Firestore rolls it back and
// the score is then gone from this phone too. Neither had a voice anywhere in
// the app. See lib/connection for what is counted and lib/useSyncStatus for
// when it is worth saying.
//
// It renders NOTHING when everything is landing, which is nearly always. A
// strip that says "synced" all weekend is furniture, and the one time it says
// something else it would not be read either — so there is no healthy state
// to draw. `useSyncStatus` returns null and this returns null with it.
//
// PORTALED to <body>, for the reason the Toast is and documented in full
// there: in Chromium `position: fixed` always creates a stacking context, the
// app shell is fixed, and anything drawn inside it is confined to the shell's
// layer where a portaled Popup (z-index 500) paints over all of it. This sits
// at 950 — under a toast, which is a reply to something you just did, and
// over the popup ladder, because a card that is not saving outranks the sheet
// you happen to have open.
//
// It sits at the BOTTOM. The top of the screen is the hole banner and the
// toast, and on the scoring screen the top is also where the eye is; the
// bottom is the tab bar's edge, which is dead space on a popup and is where
// a persistent condition belongs rather than a momentary one.
import { createPortal } from "react-dom";
import { BC, FONT, FS, ALPHA } from "../theme";
import { useSyncStatus } from "../lib/useSyncStatus";
import { writeTracker } from "../firebase";

export function SyncBanner({ tracker = writeTracker }) {
  const status = useSyncStatus(tracker);
  if (!status) return null;

  // Two tones only. `bad` is the refusal — the one state that needs somebody
  // to do something — and `warn` is everything else, all of which is the app
  // working and saying so.
  const accent = status.tone === "bad" ? BC.danger : BC.warn;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed", left: "50%", bottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
        transform: "translateX(-50%)", zIndex: 950,
        display: "flex", alignItems: "center", gap: 8,
        maxWidth: "min(92vw, 420px)",
        background: BC.card, border: `1px solid ${accent}`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: 10, padding: "8px 12px",
        boxShadow: `0 8px 32px ${BC.bdr}`,
        fontFamily: FONT,
      }}
    >
      <span style={{ fontSize: FS.body, flexShrink: 0 }}>{status.tone === "bad" ? "⚠️" : "📡"}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: FS.small, fontWeight: 800, color: accent, lineHeight: 1.3 }}>
          {status.label}
        </span>
        {/* Only ever present when this phone is HOLDING something — the case
            where somebody might otherwise stop and wait, which is the wrong
            move because the queue drains itself. */}
        {status.hint ? (
          <span style={{ display: "block", fontSize: FS.label, color: BC.t3, marginTop: 1, lineHeight: 1.3 }}>
            {status.hint}
          </span>
        ) : null}
      </span>
    </div>,
    document.body,
  );
}
