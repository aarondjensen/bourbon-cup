// ══════════════════════════════════════════════════════════════════
//  GhinLink — bind a player's app profile to their GHIN identity and
//  sync their Handicap Index from it.
// ══════════════════════════════════════════════════════════════════
//
//  Two exports:
//    • GhinLinkButton — a COMPACT chip in each player row. Unlinked shows
//      "+ GHIN" (blue); linked shows "GHIN ✓" (green). Tapping opens a
//      full dialog that holds everything — search, confirm, re-sync, and
//      unlink — so the row itself never needs to grow wide (which was
//      pushing rows off-screen before).
//    • GhinSyncButton — director batch: one call refreshes every linked
//      player's index. Short label so it never overflows the header.
//
//  Why a dialog and not an inline row: on a dark theme an inline search
//  field blends into the background and reads as broken. The dialog uses
//  an elevated surface + dimmed backdrop, is anchored to the top so the
//  on-screen keyboard doesn't cover the input, and walks the director
//  through one clear action at a time.
//
//  Permission model (auth-agnostic): canEdit = director OR the signed-in
//  player editing their own row. Works with today's tap-to-login and with
//  Google/Apple auth later, unchanged. Firestore rules enforce the real
//  boundary (a player may write only their own ghin_*/handicap_index).
//
//  Fields on the player doc: ghin_number, ghin_name, handicap_index,
//  ghin_rev_date, ghin_synced_at. db.upsert merges, so unlink writes nulls.

import { useState } from "react";
import { BC } from "../theme";
import { searchGhinGolfers, syncGhinNumbers, parseGhinHI, fmtHI } from "../lib/ghin";

const BLUE = BC.hcpBlue;
const FONT = "'Montserrat', sans-serif";

// ── Top-anchored dialog (keyboard-friendly) ─────────────────────────
function Sheet({ title, onClose, children }) {
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 1000 }}
      />
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: "fixed", zIndex: 1001,
          top: "calc(env(safe-area-inset-top, 0px) + 10px)",
          left: "50%", transform: "translateX(-50%)",
          width: "calc(100% - 20px)", maxWidth: 440,
          maxHeight: "calc(100svh - env(safe-area-inset-top, 0px) - 28px)",
          display: "flex", flexDirection: "column",
          background: BC.card, border: `1px solid ${BC.bdr}`, borderRadius: 16,
          boxShadow: "0 18px 50px rgba(0,0,0,0.65)", overflow: "hidden",
          boxSizing: "border-box", fontFamily: FONT,
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "14px 14px 12px", borderBottom: `1px solid ${BC.bdr}`,
        }}>
          <div style={{
            fontSize: 14, fontWeight: 800, color: BC.t1, flex: 1, minWidth: 0,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>{title}</div>
          <button onClick={onClose} aria-label="Close" style={{
            flexShrink: 0, width: 30, height: 30, borderRadius: 8, cursor: "pointer",
            border: `1px solid ${BC.bdr}`, background: "transparent", color: BC.t2,
            fontSize: 15, lineHeight: 1,
          }}>✕</button>
        </div>
        <div style={{ padding: 14, overflowY: "auto", overscrollBehavior: "contain" }}>
          {children}
        </div>
      </div>
    </>
  );
}

const primaryBtn = (color) => ({
  width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 10,
  border: "none", background: color, color: "#0a0804", fontSize: 14, fontWeight: 800,
  cursor: "pointer", fontFamily: FONT,
});
const ghostBtn = {
  width: "100%", boxSizing: "border-box", padding: "11px 14px", borderRadius: 10,
  border: `1px solid ${BC.bdr}`, background: "transparent", color: BC.t2,
  fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FONT,
};
const muted = { fontSize: 12, color: BC.t3, padding: "10px 2px", lineHeight: 1.4 };

// ── Per-player: compact chip → dialog ───────────────────────────────
export function GhinLinkButton({ player, user, onUpdatePlayer, notify }) {
  const canEdit = !!(user?.isDirector || user?.player_id === player?.player_id);
  const linked = !!player?.ghin_number;

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("view");     // "view" (linked summary) | "search"
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null); // result awaiting confirm

  if (!canEdit && !linked) return null;

  const openModal = () => {
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

  return (
    <>
      {/* Compact trigger — fixed, small, so the row never overflows */}
      <button
        onClick={openModal}
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
        <Sheet title={`${player.name} · GHIN`} onClose={close}>
          {/* ── Linked summary ── */}
          {mode === "view" && linked && (
            <div>
              <div style={{
                background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 12,
                padding: 12, marginBottom: 14,
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: BLUE, letterSpacing: 0.5 }}>
                  GHIN #{player.ghin_number}
                </div>
                {player.ghin_name && (
                  <div style={{ fontSize: 13, fontWeight: 600, color: BC.t1, marginTop: 3 }}>
                    {player.ghin_name}
                  </div>
                )}
                <div style={{ fontSize: 12, color: BC.t2, marginTop: 6 }}>
                  Handicap Index <b style={{ color: BC.t1 }}>{fmtHI(player.handicap_index)}</b>
                  {player.ghin_rev_date ? `  ·  revised ${player.ghin_rev_date}` : ""}
                </div>
                {player.ghin_synced_at && (
                  <div style={{ fontSize: 10, color: BC.t3, marginTop: 4 }}>
                    Last synced {new Date(player.ghin_synced_at).toLocaleDateString()}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
            <div>
              <div style={{ fontSize: 12, color: BC.t2, lineHeight: 1.45, marginBottom: 12 }}>
                Type a name or 7-digit GHIN number, tap <b>Search</b>, then tap the correct
                golfer. Check the club and index to be sure it's the right person.
              </div>

              <input
                autoFocus
                value={q}
                onChange={e => setQ(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") doSearch(); }}
                placeholder="Name or GHIN number"
                autoCapitalize="words"
                enterKeyHint="search"
                style={{
                  width: "100%", boxSizing: "border-box", padding: "12px 13px",
                  background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 10,
                  color: BC.t1, fontSize: 15, fontWeight: 600, outline: "none", fontFamily: FONT,
                }}
              />
              <button disabled={busy} onClick={doSearch} style={{ ...primaryBtn(BLUE), marginTop: 8 }}>
                {busy ? "Searching…" : "Search GHIN"}
              </button>

              {/* Confirm banner once a golfer is picked */}
              {pending && (
                <div style={{
                  marginTop: 14, background: BC.inp, border: `1px solid ${BC.green}66`,
                  borderRadius: 12, padding: 12,
                }}>
                  <div style={{ fontSize: 12, color: BC.t2, lineHeight: 1.4 }}>
                    Link <b style={{ color: BC.t1 }}>{player.name}</b> to{" "}
                    <b style={{ color: BC.t1 }}>{pending.name || `GHIN ${pending.ghin_number}`}</b>
                    {pending.club_name ? ` (${pending.club_name})` : ""}.
                  </div>
                  <div style={{ fontSize: 12, color: BC.t2, marginTop: 6 }}>
                    Handicap Index {fmtHI(player.handicap_index)} →{" "}
                    <b style={{ color: BC.t1 }}>{fmtHI(parseGhinHI(pending.handicap_index))}</b>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button onClick={confirmLink} style={{ ...primaryBtn(BC.green), padding: "10px 12px" }}>
                      Confirm link
                    </button>
                    <button onClick={() => setPending(null)} style={{ ...ghostBtn, width: "auto", padding: "10px 14px" }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Results */}
              <div style={{ marginTop: 12 }}>
                {busy && <div style={muted}>Searching GHIN…</div>}
                {!busy && searched && results.length === 0 && (
                  <div style={muted}>No golfers found. Try a different spelling, add a last name, or use the GHIN number.</div>
                )}
                {!busy && !searched && (
                  <div style={muted}>Tip: the 7-digit GHIN number is the most reliable match when several golfers share a name.</div>
                )}

                {results.map(g => {
                  const isSel = pending?.ghin_number === g.ghin_number;
                  return (
                    <button
                      key={g.ghin_number}
                      onClick={() => setPending(g)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, width: "100%",
                        boxSizing: "border-box", textAlign: "left", cursor: "pointer",
                        padding: "10px 11px", marginBottom: 6, borderRadius: 10,
                        background: isSel ? BLUE + "22" : BC.inp,
                        border: `1px solid ${isSel ? BLUE : BC.bdr}`, fontFamily: FONT,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 14, fontWeight: 700, color: BC.t1,
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}>{g.name || "Unknown golfer"}</div>
                        <div style={{
                          fontSize: 11, color: BC.t3, marginTop: 2,
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}>
                          #{g.ghin_number}
                          {g.club_name ? ` · ${g.club_name}` : ""}
                          {g.state ? ` · ${g.state}` : ""}
                        </div>
                      </div>
                      <div style={{ flexShrink: 0, textAlign: "right" }}>
                        <div style={{ fontSize: 15, fontWeight: 800, color: BLUE }}>
                          {fmtHI(parseGhinHI(g.handicap_index))}
                        </div>
                        <div style={{ fontSize: 8, fontWeight: 700, color: BC.t3, letterSpacing: 1 }}>INDEX</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </Sheet>
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
