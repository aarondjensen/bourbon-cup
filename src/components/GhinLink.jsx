// ══════════════════════════════════════════════════════════════════
//  GhinLink — bind a player's app profile to their GHIN identity and
//  sync their Handicap Index from it.
// ══════════════════════════════════════════════════════════════════
//
//  Exports:
//    • GhinLinkButton — a compact chip in each player row ("+ GHIN" /
//      "GHIN ✓") that opens a popup owning the whole workflow: search →
//      pick → confirm → link, plus re-sync / unlink when already linked.
//    • GhinSyncButton — director batch: refresh every linked player at once.
//
//  Why this finally works on mobile (three things, all required)
//  ────────────────────────────────────────────────────────────
//  1. PORTAL to document.body. The player row uses `transform` (swipe-to-
//     delete); a transformed ancestor becomes the containing block for
//     `position: fixed`, trapping/clipping any modal rendered inline.
//     createPortal moves the popup out to <body>, so fixed positioning is
//     viewport-relative.
//  2. OVERLAY SIZED TO THE VISUAL VIEWPORT, in live pixels. iOS does not
//     shrink CSS viewport units (svh/dvh/vh) for the keyboard, and
//     innerHeight math is unreliable in PWA / black-translucent mode. So
//     we read window.visualViewport {offsetTop,offsetLeft,width,height} and
//     set the overlay's top/left/width/height to exactly that rectangle,
//     updating on every resize/scroll. The overlay is therefore ALWAYS the
//     visible area above the keyboard — the card can't render behind the
//     keys, and its results list scrolls entirely within view.
//  3. DEFERRED FOCUS. We focus the field ~150ms after the popup mounts (not
//     autoFocus), so the portal has laid out before the keyboard animates
//     in — avoiding the jump where iOS scrolls the field out of view. The
//     field is set at FS.lead (16px), which is what stops iOS
//     zoom-on-focus — do not drop it a rung to save height.
//
//  Permission: canEdit = director OR the signed-in player editing their own
//  row. Firestore rules enforce the real boundary.
//  Player-doc fields: ghin_number, ghin_name, handicap_index,
//  ghin_rev_date, ghin_synced_at. db.upsert merges → unlink writes nulls.

import { useState, useEffect, useRef } from "react";
import { BC, FONT, SCRIM, ALPHA, ON_AMBER, FS } from "../theme";
import { Popup } from "./Popup";
import { searchGhinGolfers, syncGhinNumbers, parseGhinHI, fmtHI } from "../lib/ghin";

const BLUE = BC.hcpBlue;
const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

const primaryBtn = (color) => ({
  width: "100%", boxSizing: "border-box", padding: "14px 14px", borderRadius: 12,
  border: "none", background: color, color: ON_AMBER, fontSize: FS.lead, fontWeight: 800,
  cursor: "pointer", fontFamily: FONT,
});
const ghostBtn = {
  width: "100%", boxSizing: "border-box", padding: "13px 14px", borderRadius: 12,
  border: `1px solid ${BC.bdr}`, background: "transparent", color: BC.t2,
  fontSize: FS.body, fontWeight: 700, cursor: "pointer", fontFamily: FONT,
};
const muted = { fontSize: FS.body, color: BC.t3, padding: "16px 4px", lineHeight: 1.5, textAlign: "center" };

// ── GHIN wordmark badge ─────────────────────────────────────────────
// A small text badge in the GHIN/handicap blue. Deliberately NOT the USGA
// app's raster logo: at column-header / inline sizes a real logo renders as
// an illegible smudge, whereas this stays crisp at any size and matches the
// existing "+ GHIN" / "GHIN ✓" chips. Use it to label handicap columns or
// mark GHIN-sourced values. `size`: "xs" (headers) | "sm" (default).
export function GhinBadge({ size = "sm", title = "Handicap Index sourced from GHIN" }) {
  const s = size === "xs"
    ? { fontSize: FS.micro, padding: "1px 3px", radius: 3, letter: 0.3 }
    : { fontSize: FS.label, padding: "2px 6px", radius: 4, letter: 0.5 };
  return (
    <span title={title} style={{
      display: "inline-flex", alignItems: "center", boxSizing: "border-box",
      fontSize: s.fontSize, fontWeight: 800, letterSpacing: s.letter, lineHeight: 1,
      padding: s.padding, borderRadius: s.radius, whiteSpace: "nowrap",
      border: `1px solid ${BLUE}${ALPHA.line}`, background: BLUE + "1f", color: BLUE, fontFamily: FONT,
    }}>GHIN</span>
  );
}

// ── Per-player: compact chip → portaled popup ───────────────────────
export function GhinLinkButton({ player, user, onUpdatePlayer, notify }) {
  const canEdit = !!(user?.isDirector || user?.player_id === player?.player_id);
  const linked = !!player?.ghin_number;

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("view");     // "view" | "search"
  const [q, setQ] = useState("");
  const [state, setState] = useState("");        // optional 2-letter state filter
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);

  const inputRef = useRef(null);

  // Lock the background while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Deferred focus once the portal has laid out.
  useEffect(() => {
    if (open && (mode === "search" || !linked)) {
      const t = setTimeout(() => inputRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [open, mode, linked]);

  if (!canEdit && !linked) return null;

  const openPopup = () => {
    setOpen(true);
    setMode(linked ? "view" : "search");
    setQ([player?.first_name, player?.last_name].filter(Boolean).join(" ").trim() || player?.name || "");
    setResults([]); setSearched(false); setPending(null);
  };
  const close = () => setOpen(false);

  const doSearch = async () => {
    if (!q.trim()) return;
    setBusy(true); setSearched(true); setPending(null);
    try { setResults(await searchGhinGolfers(q.trim(), state)); }
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

  const title = mode === "search" ? `Search GHIN — ${player.name}` : `${player.name} · GHIN`;

  const popup = (
    <Popup
      onClose={close}
      maxWidth={460}
      zIndex={4000}
      portal
      viewportFit
      align="start"
      padding={0}
      outerPadding={12}
      innerStyle={{
        background: BC.card, borderRadius: 16,
        boxShadow: `0 20px 60px ${SCRIM}`, overflow: "hidden",
        display: "flex", flexDirection: "column", fontFamily: FONT,
      }}
    >
        {/* Header */}
        <div style={{
          flexShrink: 0, display: "flex", alignItems: "center", gap: 10,
          padding: "13px 14px", borderBottom: `1px solid ${BC.bdr}`,
        }}>
          <div style={{
            flex: 1, minWidth: 0, fontSize: FS.body, fontWeight: 800, color: BC.t1,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>{title}</div>
          <button onClick={close} aria-label="Close" style={{
            flexShrink: 0, width: 32, height: 32, borderRadius: 9, cursor: "pointer",
            border: `1px solid ${BC.bdr}`, background: "transparent", color: BC.t2,
            fontSize: FS.lead, lineHeight: 1,
          }}>✕</button>
        </div>

        {/* ── Linked summary ── */}
        {mode === "view" && linked && (
          <div style={{ overflowY: "auto", overscrollBehavior: "contain", padding: 16 }}>
            <div style={{ background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 14, padding: 14, marginBottom: 16 }}>
              <div style={{ fontSize: FS.small, fontWeight: 700, color: BLUE, letterSpacing: 0.5 }}>GHIN #{player.ghin_number}</div>
              {player.ghin_name && <div style={{ fontSize: FS.lead, fontWeight: 700, color: BC.t1, marginTop: 4 }}>{player.ghin_name}</div>}
              <div style={{ fontSize: FS.body, color: BC.t2, marginTop: 8 }}>
                Handicap Index <b style={{ color: BC.t1 }}>{fmtHI(player.handicap_index)}</b>
                {player.ghin_rev_date ? `  ·  revised ${player.ghin_rev_date}` : ""}
              </div>
              {player.ghin_synced_at && (
                <div style={{ fontSize: FS.small, color: BC.t3, marginTop: 4 }}>
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
              <button onClick={unlink} style={{ ...ghostBtn, color: BC.danger, borderColor: BC.danger + ALPHA.line }}>
                Unlink (keep current HI)
              </button>
            </div>
          </div>
        )}

        {/* ── Search / link ── */}
        {(mode === "search" || !linked) && (
          <>
            {/* Pinned search field */}
            <div style={{ flexShrink: 0, padding: 14, borderBottom: `1px solid ${BC.bdr}` }}>
              <label style={{ display: "block", fontSize: FS.small, fontWeight: 700, color: BC.t3, letterSpacing: 1, marginBottom: 6 }}>
                GOLFER NAME OR GHIN #
              </label>
              <input
                ref={inputRef}
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
                  color: BC.t1, fontSize: FS.lead, fontWeight: 600, outline: "none", fontFamily: FONT,
                }}
              />
              {/* Optional state filter — narrows a name search (a bare name
                  can return golfers nationwide). Ignored for a GHIN #. */}
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <select value={state} onChange={e => setState(e.target.value)} aria-label="State filter"
                  style={{ flexShrink: 0, width: 108, boxSizing: "border-box", padding: "0 10px",
                    background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 12,
                    color: BC.t1, fontSize: FS.lead, fontWeight: 600, outline: "none", fontFamily: FONT, cursor: "pointer" }}>
                  <option value="">All states</option>
                  {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button disabled={busy} onClick={doSearch} style={{ ...primaryBtn(BLUE), flex: 1 }}>
                  {busy ? "Searching…" : "Search GHIN"}
                </button>
              </div>
            </div>

            {/* Scrolling results */}
            <div style={{ flex: 1, minHeight: 60, overflowY: "auto", overscrollBehavior: "contain", padding: "10px 14px 16px" }}>
              {busy && <div style={muted}>Searching GHIN…</div>}
              {!busy && searched && results.length === 0 && (
                <div style={muted}>No golfers found.<br />Try a different spelling, add a last name, or enter the 7-digit GHIN number.</div>
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
                      background: isSel ? BLUE + "22" : BC.inp,
                      border: `1px solid ${isSel ? BLUE : BC.bdr}`, fontFamily: FONT,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: FS.lead, fontWeight: 700, color: BC.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {g.name || "Unknown golfer"}
                      </div>
                      <div style={{ fontSize: FS.small, color: BC.t3, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        #{g.ghin_number}{g.club_name ? ` · ${g.club_name}` : ""}{g.state ? ` · ${g.state}` : ""}
                      </div>
                    </div>
                    <div style={{ flexShrink: 0, textAlign: "right" }}>
                      <div style={{ fontSize: FS.lead, fontWeight: 800, color: BLUE }}>{fmtHI(parseGhinHI(g.handicap_index))}</div>
                      <div style={{ fontSize: FS.micro, fontWeight: 700, color: BC.t3, letterSpacing: 1 }}>INDEX</div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Pinned confirm bar */}
            {pending && (
              <div style={{ flexShrink: 0, padding: 14, borderTop: `1px solid ${BC.green}${ALPHA.line}`, background: BC.inp }}>
                <div style={{ fontSize: FS.body, color: BC.t2, lineHeight: 1.45 }}>
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
    </Popup>
  );

  return (
    <>
      <button
        onClick={openPopup}
        title={linked ? `GHIN ${player.ghin_number}` : "Link a GHIN profile"}
        style={{
          flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 3,
          boxSizing: "border-box", padding: "3px 7px", borderRadius: 5, cursor: "pointer",
          fontSize: FS.label, fontWeight: 800, letterSpacing: 0.2, fontFamily: FONT,
          border: `1px solid ${(linked ? BC.green : BLUE)}${ALPHA.line}`,
          background: (linked ? BC.green : BLUE) + "1f",
          color: linked ? BC.green : BLUE, whiteSpace: "nowrap",
        }}
      >
        {linked ? "GHIN ✓" : "+ GHIN"}
      </button>

      {open && popup}
    </>
  );
}

// ── Director batch sync ─────────────────────────────────────────────
// `confirm` (optional): a promise-based confirmation (useConfirm's) shown
// before syncing, so the director sees exactly what will happen. `compact`
// renders just an emoji button (for placing beside a column header).
export function GhinSyncButton({ players, onUpdatePlayer, notify, confirm, compact }) {
  const [busy, setBusy] = useState(false);
  const linked = (players || []).filter(p => p?.ghin_number);

  const syncAll = async () => {
    if (!linked.length) { notify?.("No players linked to GHIN yet", "error"); return; }
    if (confirm) {
      const n = linked.length;
      const ok = await confirm({
        title: "Re-sync handicaps from GHIN",
        message: `This pulls the current Handicap Index for all ${n} GHIN-linked player${n !== 1 ? "s" : ""} from the USGA GHIN database and overwrites their stored index.\n\n• Director overrides are kept (they still win).\n• Manual (non-linked) players are untouched.`,
        confirmLabel: `Re-sync ${n}`,
      });
      if (!ok) return;
    }
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

  if (compact) {
    return (
      <button
        disabled={busy || !linked.length}
        onClick={syncAll}
        title={linked.length ? `Re-sync ${linked.length} GHIN-linked player${linked.length !== 1 ? "s" : ""}` : "No GHIN-linked players yet"}
        style={{
          boxSizing: "border-box", display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 24, height: 24, padding: 0, borderRadius: 6, lineHeight: 1,
          cursor: linked.length ? "pointer" : "default",
          border: `1px solid ${BC.green}${ALPHA.line}`, background: BC.green + ALPHA.wash,
          fontSize: FS.small, flexShrink: 0, opacity: linked.length ? 1 : 0.4, fontFamily: FONT,
        }}
      >
        {busy ? "⏳" : "🔄"}
      </button>
    );
  }

  return (
    <button
      disabled={busy || !linked.length}
      onClick={syncAll}
      title="Sync every linked player's handicap from GHIN"
      style={{
        boxSizing: "border-box", maxWidth: "100%", padding: "8px 12px", borderRadius: 10,
        cursor: linked.length ? "pointer" : "default", whiteSpace: "nowrap",
        border: `1px solid ${BC.green}${ALPHA.line}`, background: BC.green + ALPHA.wash, color: BC.green,
        fontSize: FS.small, fontWeight: 700, flexShrink: 0, opacity: linked.length ? 1 : 0.5,
        fontFamily: FONT,
      }}
    >
      {busy ? "Syncing…" : `↻ Sync GHIN (${linked.length})`}
    </button>
  );
}
