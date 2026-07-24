// ══════════════════════════════════════════════════════════════════
//  GhinLink — bind a player's app profile to their GHIN identity and
//  sync their Handicap Index from it.
// ══════════════════════════════════════════════════════════════════
//
//  Exports:
//    • GhinLinkButton — a compact chip in each player row ("+ GHIN" when
//      unlinked, "GHIN ✓" when linked). Tapping it opens a FULL-SCREEN
//      page that owns the whole workflow: search → pick → confirm → link,
//      plus re-sync / unlink for an already-linked player.
//    • GhinSyncButton — director batch: one call refreshes every linked
//      player's index.
//
//  Why full-screen (and how the keyboard is handled)
//  ─────────────────────────────────────────────────
//  On iOS the on-screen keyboard does NOT shrink CSS viewport units, and
//  positioning a floating dialog relative to window.visualViewport.offsetTop
//  is unreliable — the card ends up pushed out of view. The robust pattern
//  is a full-screen opaque page (so there's no confusing see-through
//  background) whose ONLY concession to the keyboard is bottom padding
//  equal to the keyboard's height (window.innerHeight − visualViewport
//  height). With that padding the whole page — pinned search field at top,
//  scrolling results in the middle, pinned confirm bar at the bottom —
//  lives entirely in the visible area above the keyboard. The field sits
//  near the top, so it's always visible while typing, and the 16px font
//  stops iOS zoom-on-focus.
//
//  Permission model (auth-agnostic): canEdit = director OR the signed-in
//  player editing their own row. Firestore rules enforce the real boundary.
//
//  Player-doc fields: ghin_number, ghin_name, handicap_index,
//  ghin_rev_date, ghin_synced_at. db.upsert merges, so unlink writes nulls.

import { useState, useEffect } from "react";
import { BC } from "../theme";
import { searchGhinGolfers, syncGhinNumbers, parseGhinHI, fmtHI } from "../lib/ghin";

const BLUE = BC.hcpBlue;
const FONT = "'Montserrat', sans-serif";

// Height of the on-screen keyboard, derived from the visual viewport.
// 0 when the keyboard is closed or the API is unavailable.
function useKeyboardInset() {
  const read = () => {
    if (typeof window === "undefined") return 0;
    const v = window.visualViewport;
    if (!v) return 0;
    return Math.max(0, Math.round(window.innerHeight - v.height - v.offsetTop));
  };
  const [kb, setKb] = useState(read);
  useEffect(() => {
    const v = window.visualViewport;
    const update = () => setKb(read());
    update();
    if (v) {
      v.addEventListener("resize", update);
      v.addEventListener("scroll", update);
    }
    window.addEventListener("resize", update);
    return () => {
      if (v) {
        v.removeEventListener("resize", update);
        v.removeEventListener("scroll", update);
      }
      window.removeEventListener("resize", update);
    };
  }, []);
  return kb;
}

const primaryBtn = (color) => ({
  width: "100%", boxSizing: "border-box", padding: "14px 14px", borderRadius: 12,
  border: "none", background: color, color: "#0a0804", fontSize: 15, fontWeight: 800,
  cursor: "pointer", fontFamily: FONT,
});
const ghostBtn = {
  width: "100%", boxSizing: "border-box", padding: "13px 14px", borderRadius: 12,
  border: `1px solid ${BC.bdr}`, background: "transparent", color: BC.t2,
  fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: FONT,
};
const muted = { fontSize: 13, color: BC.t3, padding: "14px 4px", lineHeight: 1.5, textAlign: "center" };

// ── Per-player: compact chip → full-screen page ─────────────────────
export function GhinLinkButton({ player, user, onUpdatePlayer, notify }) {
  const canEdit = !!(user?.isDirector || user?.player_id === player?.player_id);
  const linked = !!player?.ghin_number;

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("view");     // "view" | "search"
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);

  const kb = useKeyboardInset();

  // Lock the background page while the full-screen search is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!canEdit && !linked) return null;

  const openPage = () => {
    setOpen(true);
    setMode(linked ? "view" : "search");
    setQ(player?.name || "");
    setResults([]); setSearched(false); setPending(null);
  };
  const close = () => setOpen(false);

  const doSearch = async () => {
    if (!q.trim()) return;
    setBusy(true); setSearched(true); setPending(null);
    try { setResults(await searchGhinGolfers(q.trim())); }
    catch (e) { notify?.(e.message || "GHIN search failed", "error"); }
    finally { setBusy(false); }
  };

  const confirmLink = async () => {
    const g = pending; if (!g) return;
    const hi = parseGhinHI(g.handicap_index);
    await onUpdatePlayer({
      ...player,
      ghin_number: g.ghin_number,
      ghin_name: g.name || null,
      handicap_index: hi != null ? hi : player.handicap_index,
      ghin_rev_date: g.last_revision_date || null,
      ghin_synced_at: new Date().toISOString(),
    });
    notify?.(`Linked ${player.name} → GHIN ${g.ghin_number}`, "success");
    close();
  };

  const resync = async () => {
    setBusy(true);
    try {
      const map = await syncGhinNumbers([player.ghin_number]);
      const res = map[String(player.ghin_number)];
      if (!res || res.error || res.handicap_index == null) {
        notify?.(`Sync failed: ${res?.error || "no data"}`, "error"); return;
      }
      const hi = parseGhinHI(res.handicap_index);
      const patch = {
        ...player,
        ghin_rev_date: res.last_revision_date || player.ghin_rev_date || null,
        ghin_synced_at: new Date().toISOString(),
      };
      if (parseFloat(player.handicap_index) === hi) {
        await onUpdatePlayer(patch);
        notify?.(`${player.name}: HI unchanged (${fmtHI(hi)})`, "success");
      } else {
        await onUpdatePlayer({ ...patch, handicap_index: hi });
        notify?.(`${player.name}: HI ${fmtHI(player.handicap_index)} → ${fmtHI(hi)}`, "success");
      }
      close();
    } catch (e) {
      notify?.(e.message || "Sync failed", "error");
    } finally { setBusy(false); }
  };

  const unlink = async () => {
    await onUpdatePlayer({ ...player, ghin_number: null, ghin_name: null, ghin_rev_date: null, ghin_synced_at: null });
    notify?.(`Unlinked ${player.name} (kept HI ${fmtHI(player.handicap_index)})`, "success");
    close();
  };

  const title = mode === "search" ? `Link ${player.name}` : `${player.name} · GHIN`;

  return (
    <>
      {/* Compact row chip */}
      <button
        onClick={openPage}
        title={linked ? `GHIN ${player.ghin_number}` : "Link a GHIN profile"}
        style={{
          flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 3,
          boxSizing: "border-box", padding: "3px 7px", borderRadius: 5, cursor: "pointer",
          fontSize: 9, fontWeight: 800, letterSpacing: 0.2, fontFamily: FONT,
          border: `1px solid ${(linked ? BC.green : BLUE)}66`,
          background: (linked ? BC.green : BLUE) + "1f",
          color: linked ? BC.green : BLUE, whiteSpace: "nowrap",
        }}
      >
        {linked ? "GHIN ✓" : "+ GHIN"}
      </button>

      {open && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 3000, background: BC.bg,
            display: "flex", flexDirection: "column", boxSizing: "border-box",
            fontFamily: FONT,
            paddingTop: "env(safe-area-inset-top, 0px)",
            paddingLeft: "env(safe-area-inset-left, 0px)",
            paddingRight: "env(safe-area-inset-right, 0px)",
            paddingBottom: kb,                 // keyboard treated as bottom padding
            transition: "padding-bottom 0.15s ease",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div style={{
            flexShrink: 0, display: "flex", alignItems: "center", gap: 10,
            padding: "12px 14px", borderBottom: `1px solid ${BC.bdr}`,
          }}>
            <button onClick={close} style={{
              flexShrink: 0, padding: "7px 12px", borderRadius: 9, cursor: "pointer",
              border: `1px solid ${BC.bdr}`, background: "transparent", color: BC.t2,
              fontSize: 13, fontWeight: 700, fontFamily: FONT,
            }}>Cancel</button>
            <div style={{
              flex: 1, minWidth: 0, textAlign: "center", fontSize: 15, fontWeight: 800,
              color: BC.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>{title}</div>
            <div style={{ width: 64, flexShrink: 0 }} />
          </div>

          {/* ── Linked summary ── */}
          {mode === "view" && linked && (
            <div style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain", padding: 16 }}>
              <div style={{ background: BC.card, border: `1px solid ${BC.bdr}`, borderRadius: 14, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: BLUE, letterSpacing: 0.5 }}>GHIN #{player.ghin_number}</div>
                {player.ghin_name && <div style={{ fontSize: 15, fontWeight: 700, color: BC.t1, marginTop: 4 }}>{player.ghin_name}</div>}
                <div style={{ fontSize: 13, color: BC.t2, marginTop: 8 }}>
                  Handicap Index <b style={{ color: BC.t1 }}>{fmtHI(player.handicap_index)}</b>
                  {player.ghin_rev_date ? `  ·  revised ${player.ghin_rev_date}` : ""}
                </div>
                {player.ghin_synced_at && (
                  <div style={{ fontSize: 11, color: BC.t3, marginTop: 4 }}>
                    Last synced {new Date(player.ghin_synced_at).toLocaleDateString()}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button disabled={busy} onClick={resync} style={primaryBtn(BC.green)}>
                  {busy ? "Syncing…" : "↻ Re-sync handicap now"}
                </button>
                <button onClick={() => { setMode("search"); setQ(player.name || ""); setResults([]); setSearched(false); setPending(null); }} style={ghostBtn}>
                  Change / re-link golfer
                </button>
                <button onClick={unlink} style={{ ...ghostBtn, color: BC.danger, borderColor: BC.danger + "55" }}>
                  Unlink (keep current HI)
                </button>
              </div>
            </div>
          )}

          {/* ── Search / link ── */}
          {(mode === "search" || !linked) && (
            <>
              {/* Pinned search field — stays visible above the keyboard */}
              <div style={{ flexShrink: 0, padding: 16, borderBottom: `1px solid ${BC.bdr}` }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: BC.t3, letterSpacing: 1, marginBottom: 6 }}>
                  GOLFER NAME OR GHIN #
                </label>
                <input
                  autoFocus
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") doSearch(); }}
                  placeholder="e.g. Aaron Jensen  or  1234567"
                  autoCapitalize="words"
                  autoCorrect="off"
                  enterKeyHint="search"
                  style={{
                    width: "100%", boxSizing: "border-box", padding: "14px 14px",
                    background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 12,
                    color: BC.t1, fontSize: 16, fontWeight: 600, outline: "none", fontFamily: FONT,
                  }}
                />
                <button disabled={busy} onClick={doSearch} style={{ ...primaryBtn(BLUE), marginTop: 10 }}>
                  {busy ? "Searching…" : "Search GHIN"}
                </button>
              </div>

              {/* Scrolling results */}
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: "10px 14px 20px" }}>
                {busy && <div style={muted}>Searching GHIN…</div>}
                {!busy && searched && results.length === 0 && (
                  <div style={muted}>No golfers found.<br />Try a different spelling, add a last name, or use the 7-digit GHIN number.</div>
                )}
                {!busy && !searched && (
                  <div style={muted}>Type a name or GHIN number above, then tap Search.<br />The GHIN number is the surest match when golfers share a name.</div>
                )}

                {results.map(g => {
                  const isSel = pending?.ghin_number === g.ghin_number;
                  return (
                    <button
                      key={g.ghin_number}
                      onClick={() => setPending(g)}
                      style={{
                        display: "flex", alignItems: "center", gap: 12, width: "100%",
                        boxSizing: "border-box", textAlign: "left", cursor: "pointer",
                        padding: "13px 14px", marginBottom: 8, borderRadius: 12,
                        background: isSel ? BLUE + "22" : BC.card,
                        border: `1px solid ${isSel ? BLUE : BC.bdr}`, fontFamily: FONT,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: BC.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {g.name || "Unknown golfer"}
                        </div>
                        <div style={{ fontSize: 12, color: BC.t3, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          #{g.ghin_number}{g.club_name ? ` · ${g.club_name}` : ""}{g.state ? ` · ${g.state}` : ""}
                        </div>
                      </div>
                      <div style={{ flexShrink: 0, textAlign: "right" }}>
                        <div style={{ fontSize: 17, fontWeight: 800, color: BLUE }}>{fmtHI(parseGhinHI(g.handicap_index))}</div>
                        <div style={{ fontSize: 8, fontWeight: 700, color: BC.t3, letterSpacing: 1 }}>INDEX</div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Pinned confirm bar (appears after a golfer is tapped) */}
              {pending && (
                <div style={{ flexShrink: 0, padding: 14, borderTop: `1px solid ${BC.green}66`, background: BC.card }}>
                  <div style={{ fontSize: 13, color: BC.t2, lineHeight: 1.45 }}>
                    Link <b style={{ color: BC.t1 }}>{player.name}</b> to <b style={{ color: BC.t1 }}>{pending.name || `GHIN ${pending.ghin_number}`}</b>
                    {pending.club_name ? ` (${pending.club_name})` : ""}.
                    <br />Handicap Index {fmtHI(player.handicap_index)} → <b style={{ color: BC.t1 }}>{fmtHI(parseGhinHI(pending.handicap_index))}</b>
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                    <button onClick={confirmLink} style={primaryBtn(BC.green)}>Confirm link</button>
                    <button onClick={() => setPending(null)} style={{ ...ghostBtn, width: "auto", padding: "13px 18px" }}>Back</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

// ── Director batch sync ─────────────────────────────────────────────
export function GhinSyncButton({ players, onUpdatePlayer, notify }) {
  const [busy, setBusy] = useState(false);
  const linked = (players || []).filter(p => p?.ghin_number);

  const syncAll = async () => {
    if (!linked.length) { notify?.("No players linked to GHIN yet", "error"); return; }
    setBusy(true);
    try {
      const map = await syncGhinNumbers(linked.map(p => p.ghin_number));
      let changed = 0, same = 0, failed = 0;
      for (const p of linked) {
        const res = map[String(p.ghin_number)];
        if (!res || res.error || res.handicap_index == null) { failed++; continue; }
        const hi = parseGhinHI(res.handicap_index);
        const patch = {
          ...p,
          ghin_rev_date: res.last_revision_date || p.ghin_rev_date || null,
          ghin_synced_at: new Date().toISOString(),
        };
        if (parseFloat(p.handicap_index) === hi) { await onUpdatePlayer(patch); same++; }
        else { await onUpdatePlayer({ ...patch, handicap_index: hi }); changed++; }
      }
      notify?.(
        `GHIN sync: ${changed} updated, ${same} unchanged${failed ? `, ${failed} failed` : ""}`,
        failed ? "error" : "success"
      );
    } catch (e) {
      notify?.(e.message || "GHIN sync failed", "error");
    } finally { setBusy(false); }
  };

  return (
    <button
      disabled={busy || !linked.length}
      onClick={syncAll}
      title="Sync every linked player's handicap from GHIN"
      style={{
        boxSizing: "border-box", maxWidth: "100%", padding: "8px 12px", borderRadius: 10,
        cursor: linked.length ? "pointer" : "default", whiteSpace: "nowrap",
        border: `1px solid ${BC.green}66`, background: BC.green + "18", color: BC.green,
        fontSize: 12, fontWeight: 700, flexShrink: 0, opacity: linked.length ? 1 : 0.5,
        fontFamily: FONT,
      }}
    >
      {busy ? "Syncing…" : `↻ Sync GHIN (${linked.length})`}
    </button>
  );
}
