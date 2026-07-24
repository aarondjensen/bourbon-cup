// ══════════════════════════════════════════════════════════════════
//  GhinLink — bind a player's app profile to their GHIN identity, and
//  sync their Handicap Index from it.
// ══════════════════════════════════════════════════════════════════
//
//  Exports
//  ───────
//    • GhinLinkButton — per-player. Unlinked: opens a search Popup to
//      find and confirm the golfer, then stores `ghin_number` +
//      `handicap_index` on the player doc. Linked: shows the number +
//      revision date, a one-tap re-sync, and unlink.
//    • GhinSyncButton — director. One batch call refreshes every linked
//      player's index (one login + N reads server-side).
//
//  Permission model (auth-agnostic on purpose)
//  ────────────────────────────────────────────
//  canEdit = director OR the signed-in player editing their own row. Today
//  `user` comes from the tap-to-login screen; once Google/Apple auth lands
//  and sets the same { player_id, isDirector } shape, this component works
//  unchanged — and the same GhinLinkButton drops into a future "My Profile"
//  screen so players self-link. Enforce the real boundary in Firestore
//  rules (a player may write only ghin_number / handicap_index / ghin_* on
//  their own doc); this flag is just UX.
//
//  Field naming matches the proxy + roster: ghin_number, handicap_index,
//  ghin_rev_date, ghin_synced_at. db.upsert() merges, so unlink writes
//  nulls (merge can't delete a field); null ghin_number reads as unlinked.

import { useState } from "react";
import { BC } from "../theme";
import { Popup } from "./Popup";
import { searchGhinGolfers, syncGhinNumbers, parseGhinHI, fmtHI } from "../lib/ghin";

const GHIN_BLUE = BC.hcpBlue;

const chip = {
  fontSize: 9, padding: "1px 5px", borderRadius: 4, cursor: "pointer",
  border: `1px solid ${BC.bdr}`, background: "transparent", color: BC.t3,
  flexShrink: 0, fontFamily: "'Montserrat', sans-serif",
};

// ── Per-player link / sync ──────────────────────────────────────────
export function GhinLinkButton({ player, user, onUpdatePlayer, notify }) {
  const canEdit = !!(user?.isDirector || user?.player_id === player?.player_id);
  const linked = !!player?.ghin_number;

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(player?.name || "");
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);

  if (!canEdit && !linked) return null;

  const doSearch = async () => {
    if (!q.trim()) return;
    setBusy(true); setSearched(true);
    try { setResults(await searchGhinGolfers(q.trim())); }
    catch (e) { notify?.(e.message || "GHIN search failed", "error"); }
    finally { setBusy(false); }
  };

  const link = async (g) => {
    const hi = parseGhinHI(g.handicap_index);
    const label = [g.name, g.club_name, g.state].filter(Boolean).join(" · ");
    const msg =
      `Link ${player.name} → GHIN ${g.ghin_number}\n${label}\n\n` +
      (hi != null
        ? `HI: ${fmtHI(player.handicap_index)} → ${fmtHI(hi)}`
        : "(no index on file — HI unchanged)");
    if (!window.confirm(msg)) return;

    await onUpdatePlayer({
      ...player,
      ghin_number: g.ghin_number,
      handicap_index: hi != null ? hi : player.handicap_index,
      ghin_rev_date: g.last_revision_date || null,
      ghin_synced_at: new Date().toISOString(),
    });
    notify?.(`Linked ${player.name} to GHIN ${g.ghin_number}`, "success");
    setOpen(false); setResults([]); setSearched(false);
  };

  const resync = async () => {
    if (!player?.ghin_number) return;
    setBusy(true);
    try {
      const map = await syncGhinNumbers([player.ghin_number]);
      const res = map[String(player.ghin_number)];
      if (!res || res.error || res.handicap_index == null) {
        notify?.(`Sync failed: ${res?.error || "no data"}`, "error");
        return;
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
    } catch (e) {
      notify?.(e.message || "Sync failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (!window.confirm(`Unlink GHIN from ${player.name}? (keeps current HI)`)) return;
    await onUpdatePlayer({ ...player, ghin_number: null, ghin_rev_date: null, ghin_synced_at: null });
    notify?.(`Unlinked ${player.name}`, "success");
  };

  // ── Linked: status + re-sync + unlink ──
  if (linked) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: GHIN_BLUE, letterSpacing: 0.3, whiteSpace: "nowrap" }}>
          GHIN {player.ghin_number}
          {player.ghin_rev_date ? ` · ${player.ghin_rev_date}` : ""}
        </span>
        <button disabled={busy} onClick={resync} title="Sync index from GHIN"
          style={{ ...chip, color: BC.green, borderColor: BC.green + "66" }}>
          {busy ? "…" : "↻"}
        </button>
        {canEdit && (
          <button onClick={unlink} title="Unlink"
            style={{ ...chip, color: BC.danger, borderColor: BC.danger + "66" }}>✕</button>
        )}
      </span>
    );
  }

  // ── Unlinked: "Link GHIN" → search Popup ──
  return (
    <>
      <button onClick={() => { setOpen(true); setQ(player?.name || ""); }}
        style={{ ...chip, color: GHIN_BLUE, borderColor: GHIN_BLUE + "66" }}>
        Link GHIN
      </button>

      {open && (
        <Popup onClose={() => setOpen(false)} maxWidth={360} padding={16} showClose>
          <div style={{ fontSize: 13, fontWeight: 700, color: BC.t1, marginBottom: 2 }}>
            Link {player.name} to GHIN
          </div>
          <div style={{ fontSize: 11, color: BC.t3, marginBottom: 12 }}>
            Search by name or 7-digit GHIN number, then pick the match.
          </div>

          <div style={{ display: "flex", gap: 6 }}>
            <input
              autoFocus value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") doSearch(); }}
              placeholder="Name or GHIN #"
              style={{
                flex: 1, padding: "9px 11px", background: BC.inp,
                border: `1px solid ${BC.bdr}`, borderRadius: 8, color: BC.t1,
                fontSize: 13, fontWeight: 600, outline: "none",
                fontFamily: "'Montserrat', sans-serif",
              }}
            />
            <button disabled={busy} onClick={doSearch} style={{
              padding: "9px 16px", borderRadius: 8, border: "none", cursor: "pointer",
              background: GHIN_BLUE, color: "#0a0804", fontSize: 13, fontWeight: 700, flexShrink: 0,
            }}>
              {busy ? "…" : "Search"}
            </button>
          </div>

          <div style={{ marginTop: 10, maxHeight: 300, overflowY: "auto" }}>
            {busy && <div style={{ fontSize: 12, color: BC.t3, padding: "8px 2px" }}>Searching…</div>}
            {!busy && searched && results.length === 0 && (
              <div style={{ fontSize: 12, color: BC.t3, padding: "8px 2px" }}>
                No golfers found. Try a different spelling or the GHIN number.
              </div>
            )}
            {results.map(g => {
              const hi = parseGhinHI(g.handicap_index);
              return (
                <button key={g.ghin_number} onClick={() => link(g)} style={{
                  display: "block", width: "100%", textAlign: "left", cursor: "pointer",
                  background: "transparent", border: "none",
                  borderBottom: `1px solid ${BC.bdr}`, padding: "9px 2px", color: BC.t1,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {g.name || "Unknown"}{" "}
                    <span style={{ color: GHIN_BLUE, fontWeight: 700 }}>· {fmtHI(hi)}</span>
                  </div>
                  <div style={{ fontSize: 10, color: BC.t3 }}>
                    #{g.ghin_number}
                    {g.club_name ? ` · ${g.club_name}` : ""}
                    {g.state ? ` · ${g.state}` : ""}
                  </div>
                </button>
              );
            })}
          </div>
        </Popup>
      )}
    </>
  );
}

// ── Director batch sync ─────────────────────────────────────────────
export function GhinSyncButton({ players, onUpdatePlayer, notify }) {
  const [busy, setBusy] = useState(false);
  const linked = (players || []).filter(p => p?.ghin_number);

  const syncAll = async () => {
    if (!linked.length) { notify?.("No players linked to GHIN", "error"); return; }
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
    } finally {
      setBusy(false);
    }
  };

  return (
    <button disabled={busy || !linked.length} onClick={syncAll} style={{
      padding: "8px 14px", borderRadius: 10, cursor: linked.length ? "pointer" : "default",
      border: `1px solid ${BC.green}66`, background: BC.green + "18", color: BC.green,
      fontSize: 12, fontWeight: 700, flexShrink: 0, opacity: linked.length ? 1 : 0.5,
      fontFamily: "'Montserrat', sans-serif",
    }}>
      {busy ? "Syncing…" : `↻ Sync GHIN handicaps (${linked.length})`}
    </button>
  );
}
