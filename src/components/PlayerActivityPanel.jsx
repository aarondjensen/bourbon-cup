// ══════════════════════════════════════════════════════════════════
//  PlayerActivityPanel — is the field actually set up?
// ══════════════════════════════════════════════════════════════════
//
// Ported from WBC. The two questions a director asks the week before, and
// that nothing in this app could answer: has he signed in, and will he get
// the tee time. See lib/playerActivity for the join and for why push has to
// be read off a TOKEN rather than off a browser permission.
//
// It subscribes to bc_notification_tokens itself rather than taking the rows
// as a prop. That collection is not edition data — a token belongs to a
// device, not to a year — so threading it through App's edition subscriptions
// would have put a non-edition collection in the middle of them. It is
// `allow read: if isOpen()` in the rules, so this costs one listener and
// needs no rules change.
//
// Collapsed by default. It is a pre-tournament check, not something a
// director reads while running a round, and the roster below it is what the
// tab is actually for.
import { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import { BC, ALPHA, FS, FONT } from "../theme";
import { buildActivity, activitySummary, platformLabel } from "../lib/playerActivity";
import { realPlayers } from "../lib/players";

const TOKENS_COL = "bc_notification_tokens";

export function PlayerActivityPanel({ tPlayers }) {
  const [tokens, setTokens] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const stop = db.subscribe(TOKENS_COL, [], rows => setTokens(rows || []));
    return () => stop?.();
  }, []);

  const rows = useMemo(
    () => buildActivity({ players: realPlayers(tPlayers), tokens }),
    [tPlayers, tokens]
  );
  const sum = useMemo(() => activitySummary(rows), [rows]);

  if (sum.total === 0) return null;

  // Amber only when somebody is actually missing. A card that is always
  // coloured is a card nobody reads.
  const allSet = sum.signedIn === sum.total && sum.pushOn === sum.total;
  const accent = allSet ? BC.green : BC.warn;

  const stat = (n, of, label) => (
    <span style={{ display: "flex", alignItems: "baseline", gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: FS.body, fontWeight: 800, color: n === of ? BC.green : BC.warn }}>
        {n}/{of}
      </span>
      <span style={{ fontSize: FS.micro, fontWeight: 700, color: BC.t3, letterSpacing: 1 }}>{label}</span>
    </span>
  );

  return (
    <div style={{
      marginBottom: 10, borderRadius: 10, fontFamily: FONT,
      background: BC.card, border: `1px solid ${accent}${ALPHA.line}`,
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          padding: "9px 12px", background: "transparent", border: "none",
          cursor: "pointer", fontFamily: FONT, textAlign: "left",
        }}
      >
        <span style={{ fontSize: FS.body, flexShrink: 0 }} aria-hidden="true">📋</span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", gap: 14, flexWrap: "wrap" }}>
          {stat(sum.signedIn, sum.total, "SIGNED IN")}
          {stat(sum.pushOn, sum.total, "PUSH ON")}
        </span>
        <span style={{ fontSize: FS.label, color: BC.t3, flexShrink: 0 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ borderTop: `1px solid ${BC.bdr}`, padding: "8px 12px 10px" }}>
          {/* The two lists worth acting on — this is who to text. Named
              rather than counted, because a count tells a director there is
              a problem and not who has it. */}
          {sum.notSignedIn.length > 0 && (
            <Line label="Never signed in" names={sum.notSignedIn} tone={BC.warn} />
          )}
          {sum.noPush.length > 0 && (
            <Line label="No notifications" names={sum.noPush} tone={BC.t2} />
          )}
          {allSet && (
            <div style={{ fontSize: FS.label, color: BC.green, fontWeight: 700, marginBottom: 6 }}>
              Everyone is signed in with notifications on.
            </div>
          )}

          {/* Per-man detail. Last seen is the newest token refresh, so it is
              blank for anybody without push rather than reading as "never". */}
          <div style={{ marginTop: 4 }}>
            {rows.map(r => (
              <div key={r.playerId} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "5px 0", borderTop: `1px solid ${BC.bdr}${ALPHA.hair}`,
                fontSize: FS.label,
              }}>
                <span style={{ flex: 1, minWidth: 0, color: BC.t1, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.name}
                </span>
                <span style={{ flexShrink: 0, color: r.signedIn ? BC.t3 : BC.warn, fontWeight: 700 }}>
                  {r.signedIn ? (r.provider === "apple" ? "Apple" : r.provider === "google" ? "Google" : "In") : "—"}
                </span>
                <span style={{ flexShrink: 0, width: 62, textAlign: "right", color: r.pushOn ? BC.t2 : BC.t3 }}>
                  {r.pushOn ? r.platforms.map(platformLabel).join(", ") : "no push"}
                </span>
                <span style={{ flexShrink: 0, width: 58, textAlign: "right", color: BC.t3 }}>
                  {r.lastSeenLabel}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Line({ label, names, tone }) {
  return (
    <div style={{ fontSize: FS.label, color: BC.t2, marginBottom: 5, lineHeight: 1.45 }}>
      <span style={{ fontWeight: 800, color: tone, letterSpacing: 0.5 }}>{label}:</span>{" "}
      {names.join(", ")}
    </div>
  );
}
