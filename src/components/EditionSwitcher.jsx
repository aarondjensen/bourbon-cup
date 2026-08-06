// ══════════════════════════════════════════════════════════════════
//  EditionSwitcher — every year the cup has been played, and the door
//  to next year's.
// ══════════════════════════════════════════════════════════════════
// Reuses the shared Popup + ConfirmModal chrome. Switching an edition
// reloads the app (see lib/editions.js), so the switch goes through a
// confirm first.
//
// Two doors open this, and they want different things:
//
//   ☰ → Tournaments      ANYBODY. Reading a past year — its leaderboard, its
//                        cards, who won — is the whole reason the old cups
//                        were imported, and reading is open to every member
//                        in firestore.rules.
//   Admin → Tournament   the DIRECTOR, who also builds next year here.
//
// `canManage` is the difference: without it this is a list of years and a
// Switch button. It is not a security boundary — firestore.rules is, and it
// allows bc_editions writes to a director only — it is there so a player is
// not shown controls whose every tap comes back refused.
import { useState, useEffect } from "react";
import { BC, FS, ON_AMBER } from "../theme";
import { Popup, ConfirmModal } from "./Popup";
import { getActiveTournamentId } from "../firebase";
import { loadEditions, createEdition, cloneEdition, deleteEdition, switchEdition, ensureActiveEditionDoc } from "../lib/editions";

const fieldStyle = (w) => ({
  width: w || "100%", flex: w ? "none" : 1, padding: "9px 11px", borderRadius: 8,
  background: BC.inp, border: `1px solid ${BC.bdr}`, color: BC.t1,
  fontSize: FS.body, fontWeight: 600, outline: "none",
});

// What a clone can copy. Scores/matches/skins/locks are NEVER cloned.
const CLONE_ITEMS = [
  { key: "players", label: "Players (roster)" },
  { key: "teams", label: "Team names, logos & colors" },
  { key: "tournamentName", label: "Tournament name & location" },
  { key: "courses", label: "Courses" },
  { key: "rounds", label: "Round setup (formats, Nassau)" },
];
const DEFAULT_CLONE_OPTS = { players: true, teams: true, tournamentName: true, courses: false, rounds: false };

export function EditionSwitcher({ open, onClose, canManage = false }) {
  const [editions, setEditions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState("");
  const [name, setName] = useState("");
  const [cloneFrom, setCloneFrom] = useState("");
  const [cloneOpts, setCloneOpts] = useState(DEFAULT_CLONE_OPTS);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const activeId = getActiveTournamentId();

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      setLoading(true);
      // Seeding the running year into the list is a WRITE, and bc_editions is
      // director-only in the rules — so a player opening this only reads. The
      // seed exists for a project whose picker has never been opened by a
      // director, which is a state one director visit fixes for everybody.
      if (canManage) await ensureActiveEditionDoc();
      const rows = await loadEditions();
      if (alive) { setEditions(rows); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [open, canManage]);

  if (!open) return null;

  const doCreate = async () => {
    if (!year || busy) return;
    setBusy(true);
    try {
      if (cloneFrom) await cloneEdition(cloneFrom, { year, name }, cloneOpts);
      else await createEdition({ year, name });
      setYear(""); setName(""); setCloneFrom(""); setCloneOpts(DEFAULT_CLONE_OPTS);
      setEditions(await loadEditions());
    } finally { setBusy(false); }
  };

  const statusColor = (s) => s === "published" ? BC.amberInk : s === "archived" ? BC.t3 : BC.gold;

  return (
    <>
      <Popup onClose={onClose} maxWidth={400} padding={18} showClose>
        <div style={{ fontSize: FS.lead, fontWeight: 800, color: BC.t1, letterSpacing: 0.5, marginBottom: 3 }}>Tournaments</div>
        <div style={{ fontSize: FS.small, color: BC.t3, marginBottom: 14 }}>
          {canManage ? "Open a year, or start the next one." : "Open any year the cup has been played."}
        </div>

        {loading ? (
          <div style={{ fontSize: FS.small, color: BC.t3, padding: "10px 0 16px" }}>Loading…</div>
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
                    <div style={{ fontSize: FS.body, fontWeight: 800, color: BC.t1 }}>{e.name}</div>
                    <div style={{
                      fontSize: FS.label, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
                      color: statusColor(e.status), marginTop: 2,
                    }}>{e.status}</div>
                  </div>
                  {isActive ? (
                    <span style={{
                      fontSize: FS.label, fontWeight: 800, letterSpacing: 0.5, color: ON_AMBER,
                      background: BC.amber, padding: "5px 10px", borderRadius: 6,
                    }}>ACTIVE</span>
                  ) : (
                    <>
                      <button onClick={() => setPending(e)} style={{
                        fontSize: FS.small, fontWeight: 800, letterSpacing: 0.5, color: BC.t2, background: BC.card,
                        border: `1px solid ${BC.bdr}`, borderRadius: 8, padding: "7px 12px", cursor: "pointer",
                      }}>Open</button>
                      {canManage && (
                        <button onClick={() => setPendingDelete(e)} title="Delete edition" style={{
                          fontSize: FS.body, fontWeight: 700, color: BC.t3, background: "transparent",
                          border: "none", borderRadius: 8, padding: "5px 6px", cursor: "pointer", flexShrink: 0, lineHeight: 1,
                        }}>🗑</button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {canManage && (
        <div style={{ borderTop: `1px solid ${BC.bdr}`, paddingTop: 14 }}>
          <div style={{ fontSize: FS.small, fontWeight: 800, letterSpacing: 1.5, color: BC.t3, marginBottom: 9 }}>NEW EDITION</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="Year" inputMode="numeric" style={fieldStyle(78)} />
            <input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Name (optional)" style={fieldStyle()} />
          </div>

          {/* Clone from a prior edition (optional) */}
          <select value={cloneFrom} onChange={(e) => setCloneFrom(e.target.value)} style={{ ...fieldStyle(), marginBottom: 8, cursor: "pointer" }}>
            <option value="">Start blank (no clone)</option>
            {editions.map((e) => (
              <option key={e.id} value={e.id}>Clone from {e.year} · {e.name}</option>
            ))}
          </select>

          {cloneFrom && (
            <div style={{ marginBottom: 10, background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ fontSize: FS.label, fontWeight: 700, color: BC.t3, letterSpacing: 0.5, marginBottom: 8 }}>COPY INTO THE NEW EDITION</div>
              {CLONE_ITEMS.map(({ key, label }) => (
                <label key={key} style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 7, cursor: "pointer" }}>
                  <input type="checkbox" checked={cloneOpts[key]}
                    onChange={(e) => setCloneOpts((o) => ({ ...o, [key]: e.target.checked }))}
                    style={{ width: 16, height: 16, accentColor: BC.amber, flexShrink: 0 }} />
                  <span style={{ fontSize: FS.small, fontWeight: 600, color: BC.t1 }}>{label}</span>
                </label>
              ))}
              <div style={{ fontSize: FS.label, color: BC.t3, marginTop: 4, lineHeight: 1.4 }}>
                Scores, matches, skins &amp; round locks always start fresh.
              </div>
            </div>
          )}

          <button onClick={doCreate} disabled={!year || busy} style={{
            width: "100%", padding: 11, borderRadius: 10, border: "none", cursor: (year && !busy) ? "pointer" : "not-allowed",
            background: (year && !busy) ? BC.amber : BC.inp, color: (year && !busy) ? ON_AMBER : BC.t3,
            fontSize: FS.body, fontWeight: 800, letterSpacing: 0.5,
          }}>{busy ? "Working…" : (cloneFrom ? "Clone into new edition" : "Create draft edition")}</button>
        </div>
        )}
      </Popup>

      {pending && (
        <ConfirmModal
          eyebrow="Open tournament"
          title={`Open ${pending.name}?`}
          message={pending.status === "archived"
            // Said plainly, because it is the thing somebody opening 2019
            // notices first and would otherwise read as being logged out.
            ? "The app will reload onto that year. It's finished, so it opens read-only — every card and result, nothing to change. Come back here to return to this year."
            : "The app will reload to load this edition's data."}
          confirmLabel="Open"
          onConfirm={() => switchEdition(pending.id, { namespaced: !!pending.namespaced })}
          onCancel={() => setPending(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmModal
          eyebrow="Delete edition"
          title={`Delete ${pendingDelete.name}?`}
          message={`This permanently deletes ${pendingDelete.name} and ALL of its players, courses, settings, rounds, scores and results.${
            // An imported year is the one deletion that IS reversible, and
            // saying so is the difference between a director leaving a
            // mis-imported 2019 in place and fixing it.
            pendingDelete.imported_from
              ? " It was imported from the spreadsheets in the repo, so it can be put back by running the import again."
              : " This can't be undone."}`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={async () => {
            const target = pendingDelete;
            setPendingDelete(null);
            await deleteEdition(target.id);
            setEditions(await loadEditions());
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  );
}
