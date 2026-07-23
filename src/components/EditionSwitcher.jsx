// ══════════════════════════════════════════════════════════════════
//  EditionSwitcher — director modal to change the active year or start
//  a new one. Gated to the director at the call site.
// ══════════════════════════════════════════════════════════════════
// Reuses the shared Popup + ConfirmModal chrome. Switching an edition
// reloads the app (see lib/editions.js), so the switch goes through a
// confirm first.
import { useState, useEffect } from "react";
import { BC } from "../theme";
import { Popup, ConfirmModal } from "./Popup";
import { getActiveTournamentId } from "../firebase";
import { loadEditions, createEdition, switchEdition, ensureActiveEditionDoc } from "../lib/editions";

const fieldStyle = (w) => ({
  width: w || "100%", flex: w ? "none" : 1, padding: "9px 11px", borderRadius: 8,
  background: BC.inp, border: `1px solid ${BC.bdr}`, color: BC.t1,
  fontSize: 13, fontWeight: 600, outline: "none",
});

export function EditionSwitcher({ open, onClose }) {
  const [editions, setEditions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(null);
  const activeId = getActiveTournamentId();

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      setLoading(true);
      await ensureActiveEditionDoc();
      const rows = await loadEditions();
      if (alive) { setEditions(rows); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [open]);

  if (!open) return null;

  const doCreate = async () => {
    if (!year) return;
    await createEdition({ year, name });
    setYear(""); setName("");
    setEditions(await loadEditions());
  };

  const statusColor = (s) => s === "published" ? BC.amber : s === "archived" ? BC.t3 : BC.gold;

  return (
    <>
      <Popup onClose={onClose} maxWidth={400} padding={18} showClose>
        <div style={{ fontSize: 15, fontWeight: 800, color: BC.t1, letterSpacing: 0.5, marginBottom: 3 }}>Editions</div>
        <div style={{ fontSize: 12, color: BC.t3, marginBottom: 14 }}>Switch the active year or start a new one.</div>

        {loading ? (
          <div style={{ fontSize: 12, color: BC.t3, padding: "10px 0 16px" }}>Loading…</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {editions.map((e) => {
              const isActive = e.id === activeId;
              return (
                <div key={e.id} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", borderRadius: 10,
                  background: BC.inp, border: `1px solid ${isActive ? BC.amber : BC.bdr}`,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: BC.t1 }}>{e.name}</div>
                    <div style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
                      color: statusColor(e.status), marginTop: 2,
                    }}>{e.status}</div>
                  </div>
                  {isActive ? (
                    <span style={{
                      fontSize: 10, fontWeight: 800, letterSpacing: 0.5, color: BC.bg,
                      background: BC.amber, padding: "5px 10px", borderRadius: 6,
                    }}>ACTIVE</span>
                  ) : (
                    <button onClick={() => setPending(e)} style={{
                      fontSize: 11, fontWeight: 800, letterSpacing: 0.5, color: BC.t2, background: BC.card,
                      border: `1px solid ${BC.bdr}`, borderRadius: 8, padding: "7px 12px", cursor: "pointer",
                    }}>Switch</button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ borderTop: `1px solid ${BC.bdr}`, paddingTop: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, color: BC.t3, marginBottom: 9 }}>NEW EDITION</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="Year" inputMode="numeric" style={fieldStyle(78)} />
            <input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Name (optional)" style={fieldStyle()} />
          </div>
          <button onClick={doCreate} disabled={!year} style={{
            width: "100%", padding: 11, borderRadius: 10, border: "none", cursor: year ? "pointer" : "not-allowed",
            background: year ? BC.amber : BC.inp, color: year ? BC.bg : BC.t3,
            fontSize: 13, fontWeight: 800, letterSpacing: 0.5,
          }}>Create draft edition</button>
        </div>
      </Popup>

      {pending && (
        <ConfirmModal
          eyebrow="Switch edition"
          title={`Switch to ${pending.name}?`}
          message="The app will reload to load this edition's data."
          confirmLabel="Switch"
          onConfirm={() => switchEdition(pending.id)}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
