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
//  director's, set in Admin → Tournament and passed down; the constant is
//  only the fallback for an edition that hasn't been through that screen.
//
//  The mark is drawn as a CSS mask rather than an <img> for the same reason
//  the nav icon is: the asset is a flat PNG silhouette, so masking is the
//  only way it takes the exact live theme accent in both light and dark.
import { BC } from "../theme";
import { TROPHY_SILHOUETTE, TOURNAMENT_LOCATION } from "../constants";
import { getTournamentYear } from "../firebase";

export function AppHeader({ location }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: 5, padding: "6px 12px 9px", flexShrink: 0,
      fontFamily: "'Montserrat', sans-serif",
    }}>
      <div style={{
        width: 30, height: 34, background: BC.amber, flexShrink: 0,
        WebkitMask: `url(${TROPHY_SILHOUETTE}) center/contain no-repeat`,
        mask: `url(${TROPHY_SILHOUETTE}) center/contain no-repeat`,
      }} />

      <div style={{
        fontSize: 11, fontWeight: 800, letterSpacing: 2.4, color: BC.t2,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%",
      }}>{getTournamentYear()} · {(location || TOURNAMENT_LOCATION).toUpperCase()}</div>
    </div>
  );
}

export default AppHeader;
