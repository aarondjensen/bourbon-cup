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
//   Admin → Event        the DIRECTOR, who also builds next year here.
//
// `canManage` is the difference: without it this is a list of years and a
// Switch button. It is not a security boundary — firestore.rules is, and it
// allows bc_editions writes to a director only — it is there so a player is
// not shown controls whose every tap comes back refused.
import { useState, useEffect } from "react";
import { BC, FS, FONT, ON_AMBER } from "../theme";
import { Popup, ConfirmModal } from "./Popup";
import { getActiveTournamentId } from "../firebase";
import { loadEditions, createEdition, cloneEdition, updateEdition, setEditionLocked, deleteEdition, switchEdition, ensureActiveEditionDoc, editionIdFor, EDITION_STATUSES } from "../lib/editions";
import { isEditionLocked, lockVerdict, bulkLockVerdict, lockBadge } from "../lib/editionLock";

// FS.lead, not FS.body, and that is functional rather than cosmetic: iOS
// Safari zooms the page in when a focused input is under 16px and does not
// zoom back out when the field is done with — so the director finished typing
// a year and was left holding a viewport they had to pinch out of. See the
// note under the FS scale in theme.js; condense with padding, never by
// dropping a rung.
const fieldStyle = (w) => ({
  width: w || "100%", flex: w ? "none" : 1, padding: "9px 11px", borderRadius: 8,
  boxSizing: "border-box", fontFamily: FONT,
  background: BC.inp, border: `1px solid ${BC.bdr}`, color: BC.t1,
  fontSize: FS.lead, fontWeight: 600, outline: "none",
});

const lbl = {
  display: "block", fontSize: FS.label, fontWeight: 800, letterSpacing: 1,
  textTransform: "uppercase", color: BC.t3, marginBottom: 4,
};

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
  // "list" | "new" | "edit". The composer used to sit under the list of every
  // year the cup has been played, which put its one button at the very bottom
  // of a tall scroll — i.e. in the strip an iPhone gives to the home indicator
  // and the side-button gestures, where aiming for Clone gets you Siri. Its own
  // view is short, so the button lands where a thumb is.
  const [mode, setMode] = useState("list");
  const [editing, setEditing] = useState(null);
  const [year, setYear] = useState("");
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [cloneFrom, setCloneFrom] = useState("");
  const [cloneOpts, setCloneOpts] = useState(DEFAULT_CLONE_OPTS);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [pending, setPending] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [pendingLock, setPendingLock] = useState(null);
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

  // What the year (plus any label) would name. Shown while typing, because the
  // id is the thing that decides whether this is a new tournament or a write
  // into an existing one, and it used to be invisible until it was too late.
  const targetId = year ? editionIdFor(year, label) : "";
  const taken = targetId ? editions.find((e) => e.id === targetId) : null;
  const ready = !!year && !taken && !busy;

  const resetForm = () => {
    setYear(""); setName(""); setLabel(""); setCloneFrom("");
    setCloneOpts(DEFAULT_CLONE_OPTS); setErr(null);
  };

  const doCreate = async () => {
    if (!ready) return;
    setBusy(true);
    setErr(null);
    try {
      // Both refuse an id that is already a tournament and say so. The check
      // above is the one the director sees; this is the one that holds.
      const res = cloneFrom
        ? await cloneEdition(cloneFrom, { year, name, label }, cloneOpts)
        : await createEdition({ year, name, label });
      if (!res?.ok) { setErr(res?.error || "Could not create that tournament."); return; }
      resetForm();
      setEditions(await loadEditions());
      setMode("list");
    } finally { setBusy(false); }
  };

  const openEdit = (e) => {
    setEditing({ id: e.id, name: e.name || "", status: e.status || "draft" });
    setErr(null);
    setMode("edit");
  };

  const doSave = async () => {
    if (!editing?.name.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await updateEdition(editing.id, { name: editing.name, status: editing.status });
      if (!res?.ok) { setErr(res?.error || "That didn't save."); return; }
      setEditions(await loadEditions());
      setEditing(null);
      setMode("list");
    } finally { setBusy(false); }
  };

  const leaveForm = () => { setMode("list"); setEditing(null); setErr(null); };

  // ── The padlock ────────────────────────────────────────────────────
  // Locking asks; unlocking does not — see lockVerdict, which decides both the
  // question and whether there is one. A verdict with no confirm goes straight
  // through rather than raising an empty dialog.
  const applyLock = async (ids, next) => {
    setBusy(true);
    try {
      await Promise.all(ids.map((id) => setEditionLocked(id, next)));
      setEditions(await loadEditions());
    } finally { setBusy(false); }
  };

  const tapLock = (e) => {
    const v = lockVerdict(e, { isActive: e.id === activeId });
    if (v.confirm) setPendingLock({ ...v, ids: [e.id] });
    else applyLock([e.id], v.next);
  };

  const statusColor = (s) => s === "published" ? BC.amberInk : s === "archived" ? BC.t3 : BC.gold;

  const headerBtn = {
    flexShrink: 0, width: 32, height: 32, borderRadius: 9, border: `1px solid ${BC.bdr}`,
    background: "transparent", color: BC.t2, fontSize: FS.lead, fontWeight: 600,
    cursor: "pointer", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
  };

  return (
    <>
      {/* viewportFit + align start: this popup has text fields in it, and the
          classic centred overlay puts them (and the button under them) behind
          the on-screen keyboard. padding 0 + a flex column so the header and
          the action bar stay put while only the middle scrolls. */}
      <Popup
        onClose={onClose} portal viewportFit align="start"
        maxWidth={420} padding={0} outerPadding={12}
        innerStyle={{ display: "flex", flexDirection: "column", fontFamily: FONT }}
      >
        <div style={{
          flexShrink: 0, display: "flex", alignItems: "center", gap: 9,
          padding: "12px 14px", borderBottom: `1px solid ${BC.bdr}`,
        }}>
          {mode !== "list" && (
            <button onClick={leaveForm} aria-label="Back"
              style={{ ...headerBtn, fontSize: FS.title }}>‹</button>
          )}
          <div style={{ flex: 1, minWidth: 0, fontSize: FS.lead, fontWeight: 800, color: BC.t1, letterSpacing: 0.5 }}>
            {mode === "new" ? "New tournament" : mode === "edit" ? "Rename tournament" : "Tournaments"}
          </div>
          {mode === "list" && canManage && !loading && (
            <button onClick={() => { resetForm(); setMode("new"); }} style={{
              flexShrink: 0, padding: "7px 12px", borderRadius: 9, fontFamily: FONT,
              border: `1px solid ${BC.amber}`, background: "transparent", color: BC.amberInk,
              fontSize: FS.small, fontWeight: 800, letterSpacing: 0.5, cursor: "pointer",
            }}>+ New</button>
          )}
          <button onClick={onClose} aria-label="Close" style={headerBtn}>✕</button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: 14 }}>
        {mode === "list" ? (<>
        {loading ? (
          <div style={{ fontSize: FS.small, color: BC.t3, padding: "10px 0 16px" }}>Loading…</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {editions.map((e) => {
              const isActive = e.id === activeId;
              return (
                <div key={e.id} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", borderRadius: 10,
                  background: BC.inp, border: `1px solid ${isActive ? BC.amber : BC.bdr}`,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Truncated, not wrapped. A director-side row now carries
                        four controls, and letting the name take a second line
                        makes the list's row height depend on how long somebody
                        typed — which is how a picker you scan turns into one
                        you read. */}
                    <div style={{
                      fontSize: FS.body, fontWeight: 800, color: BC.t1,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}>{e.name}</div>
                    <div style={{
                      display: "flex", alignItems: "center", gap: 6, marginTop: 2,
                      fontSize: FS.label, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
                    }}>
                      {/* The YEAR lives down here, not only inside the name.
                          A name long enough to truncate ("The Bourbon Cup
                          2026") loses its year to the ellipsis, and the year
                          is the one thing anybody picks a tournament by. Four
                          characters, never truncated. */}
                      <span style={{ color: BC.t2 }}>{e.year}</span>
                      <span style={{ color: BC.t3 }}>·</span>
                      <span style={{ color: statusColor(e.status) }}>{e.status}</span>
                      {/* Status and lock are different questions — one is what
                          this year IS, the other is who may write to it — so
                          they sit side by side rather than one replacing the
                          other. See lib/editionLock. */}
                      {lockBadge(e) && (
                        <span style={{ color: BC.t3, display: "flex", alignItems: "center", gap: 3 }}>
                          <span aria-hidden>🔒</span>{lockBadge(e)}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Rename is offered on the ACTIVE row too, and that is the
                      point of it: the edition a collision renamed is the one
                      you are standing in. */}
                  {canManage && (
                    <button onClick={() => openEdit(e)} title="Rename" style={{
                      fontSize: FS.small, fontWeight: 700, color: BC.t3, background: "transparent",
                      border: "none", borderRadius: 8, padding: "5px 6px", cursor: "pointer",
                      flexShrink: 0, lineHeight: 1,
                    }}>✎</button>
                  )}
                  {/* The padlock is offered on the ACTIVE row too. Freezing the
                      year being played is a real thing a director wants — the
                      moment the cup is over — and it is the one lock that asks
                      the sharper question, because the person tapping it is the
                      one member who will not notice: directors are exempt. */}
                  {canManage && (
                    // ONE glyph in two brightnesses, not 🔒 against 🔓. Both of
                    // those render as a yellow padlock and the only difference
                    // is whether a small shackle is tilted — at 12px on a phone
                    // they are the same picture, and emoji ignore `color`, so
                    // the state cannot be carried by tint either. Lit vs dimmed
                    // reads as a switch at a glance; the LOCKED badge on the row
                    // says it in words for anyone who wants certainty.
                    <button onClick={() => tapLock(e)} disabled={busy}
                      title={lockVerdict(e, { isActive }).title} style={{
                        fontSize: FS.small, background: "transparent", border: "none",
                        borderRadius: 8, padding: "5px 6px", lineHeight: 1, flexShrink: 0,
                        opacity: isEditionLocked(e) ? 1 : 0.3,
                        filter: isEditionLocked(e) ? "none" : "grayscale(1)",
                        cursor: busy ? "default" : "pointer",
                      }}>🔒</button>
                  )}
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

        {/* ── Every other year at once ──
            Eleven editions is eleven taps, and the padlock's real use is a
            setup done ONCE before handing the app to store testers: freeze the
            history, leave the year being played open. One row at a time is the
            kind of chore that gets abandoned halfway, which leaves exactly the
            hole the lock was for. Null when there is nothing to offer, so this
            is absent rather than disabled. See bulkLockVerdict. */}
        {canManage && !loading && (() => {
          const v = bulkLockVerdict(editions, activeId);
          if (!v) return null;
          return (
            <button onClick={() => setPendingLock(v)} disabled={busy} style={{
              width: "100%", marginTop: 12, padding: "10px 12px", borderRadius: 10, fontFamily: FONT,
              background: "transparent", border: `1px solid ${BC.bdr}`, color: BC.t2,
              fontSize: FS.small, fontWeight: 800, letterSpacing: 0.5,
              cursor: busy ? "default" : "pointer",
            }}>{v.next ? "🔒" : "🔓"} {v.label}</button>
          );
        })()}
        </>) : mode === "edit" ? (<>
          {/* Only the name and the status. The id is the tournament_id every
              other collection filters on, so making it editable here would
              orphan an entire edition while the picker went on looking right. */}
          <div style={{ fontSize: FS.label, color: BC.t3, marginBottom: 12, lineHeight: 1.45 }}>
            <b style={{ color: BC.t2 }}>{editing?.id}</b> · {editing?.id?.replace(/\D/g, "") || "—"}.
            The id and the year are fixed — every score, match and card in this tournament is filed under them.
          </div>
          <div style={{ marginBottom: 10 }}>
            <span style={lbl}>Name</span>
            <input value={editing?.name || ""} autoFocus placeholder="The Bourbon Cup 2026"
              onChange={(e) => { setErr(null); setEditing((s) => ({ ...s, name: e.target.value })); }}
              style={fieldStyle()} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <span style={lbl}>Status</span>
            <select value={editing?.status || "draft"}
              onChange={(e) => setEditing((s) => ({ ...s, status: e.target.value }))}
              style={{ ...fieldStyle(), cursor: "pointer" }}>
              {EDITION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {err && (
            <div style={{ fontSize: FS.small, fontWeight: 600, color: BC.danger, lineHeight: 1.45 }}>{err}</div>
          )}
        </>) : (<>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <div style={{ flex: "none", width: 92 }}>
              <span style={lbl}>Year *</span>
              <input value={year} autoFocus inputMode="numeric" placeholder="2026"
                onChange={(e) => { setErr(null); setYear(e.target.value.replace(/\D/g, "").slice(0, 4)); }}
                style={fieldStyle()} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={lbl}>Name</span>
              <input value={name} placeholder={`The Bourbon Cup ${year || "…"}`}
                onChange={(e) => setName(e.target.value)} style={fieldStyle()} />
            </div>
          </div>

          {/* The label is what makes a demo or test tournament possible at all.
              Without it the id is the year and nothing else, so a second 2026
              is not a second tournament — it is the first one, written into. */}
          <div style={{ marginBottom: 8 }}>
            <span style={lbl}>Label — for a demo or test copy</span>
            <input value={label} placeholder="demo, test — leave blank for the real one"
              onChange={(e) => { setErr(null); setLabel(e.target.value); }} style={fieldStyle()} />
          </div>

          {/* What this will be called in the database, while there is still
              time to change it. Red when it names a tournament that exists. */}
          <div style={{ fontSize: FS.label, lineHeight: 1.45, marginBottom: 12, color: taken ? BC.danger : BC.t3 }}>
            {!year
              ? "Enter a year to name the new tournament."
              : taken
                ? `${targetId} is already "${taken.name}". Give this one a label — the clone would land inside that tournament, not beside it.`
                : <>Creates <b style={{ color: BC.t2 }}>{targetId}</b>, separate from every other tournament.</>}
          </div>

          {/* Clone from a prior edition (optional) */}
          <span style={lbl}>Build from</span>
          <select value={cloneFrom} onChange={(e) => setCloneFrom(e.target.value)} style={{ ...fieldStyle(), marginBottom: 10, cursor: "pointer" }}>
            <option value="">Start blank (no clone)</option>
            {editions.map((e) => (
              <option key={e.id} value={e.id}>Clone from {e.year} · {e.name}</option>
            ))}
          </select>

          {cloneFrom && (
            <div style={{ marginBottom: 10, background: BC.inp, border: `1px solid ${BC.bdr}`, borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ fontSize: FS.label, fontWeight: 700, color: BC.t3, letterSpacing: 0.5, marginBottom: 8 }}>COPY INTO THE NEW TOURNAMENT</div>
              {CLONE_ITEMS.map(({ key, label: text }) => (
                <label key={key} style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 7, cursor: "pointer" }}>
                  <input type="checkbox" checked={cloneOpts[key]}
                    onChange={(e) => setCloneOpts((o) => ({ ...o, [key]: e.target.checked }))}
                    style={{ width: 16, height: 16, accentColor: BC.amber, flexShrink: 0 }} />
                  <span style={{ fontSize: FS.small, fontWeight: 600, color: BC.t1 }}>{text}</span>
                </label>
              ))}
              <div style={{ fontSize: FS.label, color: BC.t3, marginTop: 4, lineHeight: 1.4 }}>
                Scores, matches, skins &amp; round locks always start fresh.
              </div>
            </div>
          )}

          {err && (
            <div style={{ fontSize: FS.small, fontWeight: 600, color: BC.danger, lineHeight: 1.45, marginBottom: 4 }}>{err}</div>
          )}
        </>)}
        </div>

        {/* The action bar. Fixed rather than the last thing in a long scroll,
            and padded out past the home indicator so the tap that lands just
            below Clone is still Clone and not a system gesture. */}
        {mode !== "list" && (() => {
          const editReady = mode === "edit" && !!editing?.name.trim() && !busy;
          const on = mode === "edit" ? editReady : ready;
          return (
            <div style={{
              flexShrink: 0, display: "flex", gap: 8, background: BC.bg,
              padding: "10px 14px calc(env(safe-area-inset-bottom, 0px) + 12px)",
              borderTop: `1px solid ${BC.bdr}`,
            }}>
              <button onClick={leaveForm} style={{
                flex: "none", padding: "11px 16px", borderRadius: 10, fontFamily: FONT,
                background: BC.inp, border: `1px solid ${BC.bdr}`, color: BC.t2,
                fontSize: FS.body, fontWeight: 700, cursor: "pointer",
              }}>Cancel</button>
              {/* The label carries the disabled state. It used to be a dead amber
                  bar that said "Clone into new edition" whether or not it would,
                  leaving the missing year to be guessed at. */}
              <button onClick={mode === "edit" ? doSave : doCreate} disabled={!on} style={{
                flex: 1, padding: 11, borderRadius: 10, border: "none", fontFamily: FONT,
                cursor: on ? "pointer" : "not-allowed",
                background: on ? BC.amber : BC.inp, color: on ? ON_AMBER : BC.t3,
                fontSize: FS.body, fontWeight: 800, letterSpacing: 0.5,
              }}>
                {busy ? "Working…"
                  : mode === "edit" ? (editReady ? "Save" : "Name it first")
                  : !year ? "Enter a year first"
                  : taken ? "Add a label first"
                  : cloneFrom ? "Clone into new tournament" : "Create draft tournament"}
              </button>
            </div>
          );
        })()}
      </Popup>

      {pending && (
        <ConfirmModal
          eyebrow="Open tournament"
          title={`Open ${pending.name}?`}
          message={pending.status === "archived"
            // Said plainly, because it is the thing somebody opening 2019
            // notices first and would otherwise read as being logged out.
            ? "It's finished, so it opens read-only — every card and result, nothing to change. Come back here to return to this year."
            : "The app will reload to load this edition's data."}
          confirmLabel="Open"
          onConfirm={() => switchEdition(pending.id, { namespaced: !!pending.namespaced })}
          onCancel={() => setPending(null)}
        />
      )}

      {/* Locking asks; unlocking a single year does not — lockVerdict returns
          no confirm for that one and tapLock applies it straight away. The
          bulk action asks in both directions, because it has no tap-again
          undo: nothing remembers which years were frozen a moment ago. */}
      {pendingLock?.confirm && (
        <ConfirmModal
          eyebrow={pendingLock.next ? "Lock" : "Unlock"}
          title={pendingLock.confirm.title}
          message={pendingLock.confirm.body}
          confirmLabel={pendingLock.confirm.confirmLabel}
          onConfirm={async () => {
            const v = pendingLock;
            setPendingLock(null);
            await applyLock(v.ids, v.next);
          }}
          onCancel={() => setPendingLock(null)}
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
