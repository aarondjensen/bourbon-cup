// ══════════════════════════════════════════════════════════════════
//  EditionBanner — the way back from a year that is over.
// ══════════════════════════════════════════════════════════════════
//
// ☰ → Tournaments is a one-way trip in practice. Opening 2019 reloads the app
// into a finished cup, and the pointer is persisted — so the app STAYS in 2019
// across every cold start until somebody remembers that the way out is four
// taps back through a menu they opened once, a week ago, out of curiosity. The
// symptom is not "I am in the wrong year", it is "the app is broken, there are
// no scores in it".
//
// So: a thin row, seated on top of the bottom nav, saying which year is on
// screen and offering the one that is being played. Present only while those
// two differ, which is why it costs nothing on the ordinary path — the sixteen
// men who never touch the picker never see it.
//
// It sits INSIDE the nav's box rather than above it, and that is load-bearing
// in two ways. The shell measures that box (`navH`) to seat the slide menu on
// top of it, so a sibling row would be covered by the menu; and the nav is the
// shell's last in-flow flex row, so anything inside it is reserved by layout
// rather than by a JS-measured spacer. See the note on the bar in App.jsx.
//
// One tap, no confirm. The picker asks before switching because a reload is
// disruptive and the destination is a choice; here the destination is home and
// the whole point is that getting back is quick. Everything it can reload out
// from under you is read-only anyway: a locked edition refuses every member
// write in firestore.rules.
import { BC, FS, FONT, ALPHA, ON_AMBER } from "../theme";
import { switchEdition } from "../lib/editions";

/**
 * @param {object} props
 * @param {object|null} props.viewing  the edition document on screen
 * @param {object|null} props.live     the edition to offer, or null for none
 */
export function EditionBanner({ viewing, live }) {
  // Nothing to offer, or the two are the same year — the ordinary case.
  if (!live?.id || !viewing?.id || live.id === viewing.id) return null;

  // The YEAR, not the name. A name is whatever a director typed ("The Bourbon
  // Cup 2019", "DEMO — Testers") and this row is one line tall on a phone,
  // sharing it with a button — so the name would be an ellipsis by the third
  // word. Four characters, never truncated, and the year is what anybody
  // names a cup by anyway. Falls back to the name for an edition whose id
  // carries no year at all.
  const label = (e) => e.year || e.name || e.id;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      maxWidth: 520, margin: "0 auto", padding: "5px 12px 5px 16px",
      borderBottom: `1px solid ${BC.bdr}`, background: BC.amber + ALPHA.wash,
    }}>
      <span style={{
        flex: 1, minWidth: 0, fontSize: FS.label, fontWeight: 700, letterSpacing: 0.5,
        color: BC.t2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>
        You&rsquo;re viewing <b style={{ color: BC.t1 }}>{label(viewing)}</b>
      </span>
      <button
        onClick={() => switchEdition(live.id, { namespaced: !!live.namespaced })}
        style={{
          flexShrink: 0, padding: "5px 11px", borderRadius: 999, border: "none",
          fontFamily: FONT, background: BC.amber, color: ON_AMBER,
          fontSize: FS.label, fontWeight: 800, letterSpacing: 0.5, cursor: "pointer",
          lineHeight: 1.4,
        }}
      >Back to {label(live)}</button>
    </div>
  );
}
