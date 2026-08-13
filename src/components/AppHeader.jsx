// ══════════════════════════════════════════════════════════════════
//  AppHeader — the cup mark over YEAR · CITY
// ══════════════════════════════════════════════════════════════════
//  App chrome, not a screen's content: it sits above the scroll area in the
//  shell, so it renders once and shows on every tab. It started life inside
//  the leaderboard's pinned block, which is why it's shaped the way it is —
//  see below — but identity belongs to the app, not to one screen, and a
//  copy per tab would be five ways for the same header to drift.
//
//  Year and city sit on ONE centred caption under the mark rather than
//  flanking it. Flanking them was centred only in the geometric sense: the
//  mark held the middle column, but "GAYLORD, MI" carries near three times
//  the ink of "2025", so all of that weight piled up on one side and the
//  cluster read as leaning right. Every fix that keeps the three abreast is
//  a balancing act against label lengths that change with the tournament —
//  a longer city, a two-word one — so the row would need re-tuning each
//  time it changed. Stacking is symmetric by construction: one centred
//  mark, one centred line, nothing to balance and nothing to re-tune.
//
//  The year comes from the active edition, not the calendar — the same
//  getTournamentYear() the login screen uses — so a director browsing 2024
//  data can't be shown a header that says 2026. The location is the
//  director's, set in Admin → Event and passed down; the constant is
//  only the fallback for an edition that hasn't been through that screen.
//
//  The mark is drawn as a CSS mask rather than an <img> for the same reason
//  the nav icon is: the asset is a flat PNG silhouette, so masking is the
//  only way it takes the exact live theme accent in both light and dark.
//
//  ── This band owns the top safe-area inset ────────────────────────────
//  env(safe-area-inset-top) used to be paddingTop on the app shell, two
//  components up. Moving it here fixes three things at once:
//
//    1. ONE number instead of three. The gap above the trophy was the shell's
//       inset, plus the 520-wide column's padding, plus this band's own
//       padding — three components, three files, and no way to nudge the
//       header down a couple of pixels without guessing which one to edit.
//       The header's distance from the top of the screen is now decided
//       entirely by HEADER_SAFE_PAD below.
//
//    2. The reserved strip is PAINTED by the thing that reserves it. The shell
//       painted it in BC.bg, so on any platform with a translucent status bar
//       — Android edge-to-edge, and an iOS home-screen icon snapshotted while
//       index.html still said black-translucent — content scrolling in the
//       body slid visibly under the clock. This band is opaque and sits above
//       the scroll area in the flex column, so nothing can pass behind it.
//
//    3. It is symmetric with the bottom. The nav carries its own
//       safe-area-inset-bottom for exactly the same reasons; the shell now
//       carries only left and right, which are the two that really do apply to
//       every row.
//
//  ── The right-hand slot ───────────────────────────────────────────────
//  HEADER_SLOT_ID marks an empty, absolutely-positioned box at the far right
//  of this band. A screen with one piece of chrome that belongs up here —
//  today only Scoring's director group chip — portals into it rather than
//  spending a row of its own on it (see components/GroupSwitcher).
//
//  Absolute, so the mark and caption stay centred on the BAND rather than on
//  whatever is left over beside the slot: an in-flow item on this row would
//  shove the trophy off-centre by half its width the moment it appeared, and
//  the header would visibly jump each time a director opened Scoring. Being
//  out of flow also means the slot cannot make this band any taller, which is
//  the whole reason the chip came up here.
//
//  The portal fills it from a screen further down the tree, so anything in it
//  unmounts with that screen — nothing here has to know which tab is open.
//
//  ── The countdown ─────────────────────────────────────────────────────
//  Given `countdownAt` — the moment round one's field tees off — the mark gets
//  the clock wrapped around it, days and hours to its left, minutes and
//  seconds to its right. See components/HeaderCountdown for why the digits
//  flank the trophy when the year and the city deliberately do not. Given
//  null, or once it has run out, this band is exactly the band it has always
//  been.
//
//  flexShrink: 0 is not optional — the shell is a flex column with
//  overflow: hidden, so without it a tall tab could compress this band and the
//  clipped remainder would look like the header failing to fit.
import { BC, FONT, FS, ALPHA } from "../theme";
import { TROPHY_SILHOUETTE, TOURNAMENT_LOCATION } from "../constants";
import { getTournamentYear } from "../firebase";
import { HeaderCountdown } from "./HeaderCountdown";

// The single knob for how far the header sits from the top of the screen.
// 5px above the platform's inset: on an installed iOS app with
// status-bar-style "black" the inset resolves to 0 and this is a plain 5px gap
// below an opaque status bar, which is what "snug" means there. On Android
// edge-to-edge and in a browser tab with a translucent bar, the inset is real
// and the 5px rides on top of it.
const HEADER_SAFE_PAD = "calc(env(safe-area-inset-top, 0px) + 5px)";

// The id a screen portals its header-right chrome into. Exported so the
// portaling side names the same box this one renders.
export const HEADER_SLOT_ID = "bc-header-slot";

// Where a fixed-position toast has to sit to land ON this band and nowhere
// else. The band's content runs from HEADER_SAFE_PAD for 51px — trophy 28,
// gap 4, caption 12, bottom padding 7 — so a 26px one-line toast centres at
// +17 and its bottom edge stops ~13px short of the band's.
//
// Exported for the same reason HEADER_SLOT_ID is: the alternative is the
// scoring screen hardcoding a guess at this file's padding, and then being
// silently wrong the next time the trophy is resized. Everything below this
// band on the Scoring tab is a tappable hole, so "how far down can a toast
// reach" is a real constraint and it belongs to the thing that sets it.
export const HEADER_TOAST_TOP = "calc(env(safe-area-inset-top, 0px) + 17px)";

// ── The sync chip ─────────────────────────────────────────────────────
// The left-hand counterpart to the slot on the right, and the app's answer to
// "did that score actually go anywhere?".
//
// Silent when there is nothing to say, which is almost always. It speaks in
// exactly two situations, and they mean opposite things:
//
//   SAVING n   writes queued and unacknowledged. On a course this is a dead
//              spot and nothing more — Firestore is holding them and will
//              replay them on reconnect. Muted, because it is not a problem;
//              it exists so a group standing in a hollow on 12 can see that
//              the app knows it is behind, instead of guessing.
//   n UNSAVED  writes the server REFUSED. Those scores are gone and the cells
//              have already repainted without them. Danger-coloured, because
//              this one needs somebody to do something.
//
// The band it sits in is 51px of chrome that was otherwise empty on the left,
// so this costs no screen anywhere. Absolute for the same reason the right
// slot is: an in-flow item would shove the trophy off-centre every time a
// write went out.
function SyncChip({ pending = 0, failed = 0 }) {
  if (!pending && !failed) return null;
  const bad = failed > 0;
  const accent = bad ? BC.danger : BC.t3;
  return (
    <div
      title={bad
        ? "Some scores were refused by the server and are not saved."
        : "Waiting for signal — these will send themselves when it returns."}
      style={{
        display: "flex", alignItems: "center", gap: 4,
        fontSize: FS.micro, fontWeight: 800, letterSpacing: 0.6,
        color: accent, whiteSpace: "nowrap",
        border: `1px solid ${accent}${ALPHA.line}`,
        borderRadius: 999, padding: "1px 6px",
      }}
    >
      <span style={{
        width: 5, height: 5, borderRadius: "50%", background: accent, flexShrink: 0,
      }} />
      {bad ? `${failed} UNSAVED` : `SAVING${pending > 1 ? ` ${pending}` : ""}`}
    </div>
  );
}

// How much of the band each side needs when the chip is up. The chip is
// absolutely positioned, so it is invisible to the caption's layout and will
// happily print straight through it — which is exactly what "12 UNSAVED" did
// to "2025 · GRAND RAPIDS, MICHIGAN".
//
// Reserved on BOTH sides rather than just the left, because the caption is
// centred: taking room off one end alone would slide it off-centre, which is
// the thing this header's whole comment is about not doing. So a place name
// long enough to reach the chip ellipsises instead, and an ellipsised city is
// a much better failure than two lines of type on top of each other.
const CHIP_GUTTER = 170;

export function AppHeader({ location, pendingWrites = 0, failedWrites = 0, countdownAt = null }) {
  const hasChip = pendingWrites > 0 || failedWrites > 0;
  const mark = (
    <div style={{
      width: 25, height: 28, background: BC.amber, flexShrink: 0,
      WebkitMask: `url(${TROPHY_SILHOUETTE}) center/contain no-repeat`,
      mask: `url(${TROPHY_SILHOUETTE}) center/contain no-repeat`,
    }} />
  );
  return (
    // Sized for a band that is now on EVERY screen rather than one: the mark
    // came down from 30×34 and the caption from 11px, which buys back ~12px
    // of every tab's height. Trimmed rather than shrunk to nothing — below
    // roughly this the trophy stops being legible as a trophy at arm's
    // length, and the caption's tracking is what makes it read as a label
    // instead of stray text.
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: 4, flexShrink: 0,
      // Longhand rather than the shorthand it replaced ("5px 12px 7px"), so the
      // inset-aware top can't be silently overwritten by a later shorthand.
      paddingTop: HEADER_SAFE_PAD,
      paddingLeft: 12, paddingRight: 12, paddingBottom: 7,
      // Opaque, and above the scroll area in the stacking order: this band is
      // what the status bar sits on, and content must not show through it.
      background: BC.bg,
      position: "relative", zIndex: 2,
      fontFamily: FONT,
    }}>
      {countdownAt != null ? <HeaderCountdown at={countdownAt}>{mark}</HeaderCountdown> : mark}

      <div style={{
        fontSize: FS.label, fontWeight: 800, letterSpacing: 2.2, color: BC.t2,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        maxWidth: hasChip ? `calc(100% - ${CHIP_GUTTER}px)` : "100%",
      }}>{getTournamentYear()} · {(location || TOURNAMENT_LOCATION).toUpperCase()}</div>

      {/* Left-hand chip — mirrors the slot below, same baseline. */}
      <div style={{
        position: "absolute", left: 10, bottom: 7,
        display: "flex", alignItems: "flex-end",
      }}>
        <SyncChip pending={pendingWrites} failed={failedWrites} />
      </div>

      {/* Right-hand slot — see the note at the top. Bottom-aligned with the
          caption rather than centred on the band, so the chip sits level with
          the type beside it instead of floating against the trophy. `right`
          matches the scroll area's 10px content padding, not this band's 12,
          so it lines up with the right edge of what's underneath it. */}
      <div id={HEADER_SLOT_ID} style={{
        position: "absolute", right: 10, bottom: 7,
        display: "flex", alignItems: "flex-end",
      }} />
    </div>
  );
}

export default AppHeader;
