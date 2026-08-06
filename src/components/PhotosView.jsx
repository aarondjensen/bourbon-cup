// ══════════════════════════════════════════════════════════════════
//  PhotosView — the cup's photo library.
// ══════════════════════════════════════════════════════════════════
//
// Ported from WBC's PhotosView. What is on screen follows the edition selected
// in Tournaments, so this screen answers "what did 2019 look like" with the
// same control that answers "what did 2019 score".
//
// The photos are not in Firestore. Firestore holds an index — one document per
// photo, carrying the two URLs to draw it from — and the bytes are in Firebase
// Storage. src/lib/media.js is where that decision is written down; this file
// only draws what the index points at.
//
// ── Why the grid is thumbnails and squares ────────────────────────
// A gallery is the one screen in this app that can cost real money to render.
// Everything else is numbers; this is megabytes, on a phone, outdoors, on
// whatever signal a golf course has. So the grid loads ONLY the 400px square
// thumbnails (~25KB each) and the 1600px display copy is fetched when a photo
// is actually opened — a screen of twelve photos costs ~300KB instead of ~3MB.
//
// Squares, because a contact sheet of mixed aspect ratios has ragged rows and
// no two photos the same size, which reads as a directory listing rather than
// a set of pictures. The crop is centred and happens once, at upload.
//
// `loading="lazy"` on top of that means scrolling a 500-photo year still only
// pays for the rows that get looked at.
//
// ── Grouping ──────────────────────────────────────────────────────
// Rounds in order, then everything that belongs to the cup but not to a round
// — the drive up, the dinner, the trophy — under one heading at the end. On a
// finished year that last group is the whole thing, so it is not styled as
// leftovers.
import { useEffect, useMemo, useRef, useState } from "react";
import { BC, FONT, FS, ALPHA, ON_ACCENT, ON_AMBER } from "../theme";
import { Popup } from "./Popup";
import { PHOTO_LIBRARY_URL } from "../constants";
import { groupByRound, canDelete, validateSource, uploadFailureMessage } from "../lib/media";

// Same two primitives AccountView defines, for the same reason: this screen is
// a page of cards and section headings and the app has no shared component for
// either.
const Card = ({ children, style }) => (
  <div style={{
    background: BC.card, border: `1px solid ${BC.bdr}`, borderRadius: 10,
    padding: "14px 16px", ...style,
  }}>{children}</div>
);

const SectionLabel = ({ children, style }) => (
  <div style={{
    fontSize: FS.label, fontWeight: 800, letterSpacing: 1.5,
    color: BC.amberInk, marginBottom: 8, ...style,
  }}>{children}</div>
);

// Grid geometry. Three across is what fits a 320px handset with a gap that
// still reads as a gap; the cells stay square via aspectRatio so a slow
// thumbnail does not collapse the row it is in and shove everything below it
// up the screen.
const COLS = 3;
const GAP = 4;

// ── Tile ───────────────────────────────────────────────────────────
function Tile({ item, onOpen }) {
  const [failed, setFailed] = useState(false);
  return (
    <button
      onClick={() => onOpen(item)}
      style={{
        padding: 0, border: "none", background: BC.inp, cursor: "pointer",
        aspectRatio: "1 / 1", borderRadius: 6, overflow: "hidden",
        display: "flex", alignItems: "center", justifyContent: "center", width: "100%",
      }}
    >
      {failed ? (
        // A thumbnail that will not load is a broken link in the index, not a
        // broken app. Say so in the cell rather than showing the browser's own
        // torn-page icon, which on a dark background is unreadable anyway.
        <span style={{ fontSize: FS.small, color: BC.t3, fontFamily: FONT }}>—</span>
      ) : (
        <img
          src={item.thumbUrl}
          alt={item.caption || ""}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      )}
    </button>
  );
}

// ── Lightbox ───────────────────────────────────────────────────────
// The display copy, its caption, and — for whoever is allowed to remove it —
// a delete. Arrow keys and the on-screen chevrons move through the same
// flattened, sorted list the grid is showing, so paging never jumps between
// groups in an order the screen did not display.
function Lightbox({ item, items, onClose, onStep, onDelete, canRemove, busy }) {
  const idx = items.findIndex(i => i.id === item.id);
  // The key handler is bound once, but `onStep` closes over the current photo
  // and changes every time one is opened. Held in a ref — updated in an effect,
  // never during render — so the listener always calls the live one without
  // being torn down and re-added on each step.
  const stepRef = useRef(onStep);
  useEffect(() => { stepRef.current = onStep; }, [onStep]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowLeft") stepRef.current(-1);
      if (e.key === "ArrowRight") stepRef.current(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Popup onClose={onClose} maxWidth={640} padding={0} portal>
      <div style={{ position: "relative", background: "#000", borderRadius: 12, overflow: "hidden" }}>
        <img
          src={item.url}
          alt={item.caption || ""}
          style={{ width: "100%", maxHeight: "70vh", objectFit: "contain", display: "block" }}
        />
        {items.length > 1 && (
          <>
            <ChevronButton side="left" onClick={() => onStep(-1)} />
            <ChevronButton side="right" onClick={() => onStep(1)} />
          </>
        )}
      </div>
      <div style={{ padding: 14, fontFamily: FONT }}>
        {item.caption && (
          <div style={{ fontSize: FS.body, color: BC.t1, marginBottom: 6 }}>{item.caption}</div>
        )}
        <div style={{ fontSize: FS.small, color: BC.t3, display: "flex", justifyContent: "space-between", gap: 10 }}>
          <span>{item.uploadedByName || "—"}</span>
          <span>{items.length ? `${idx + 1} of ${items.length}` : ""}</span>
        </div>
        {canRemove && (
          <button onClick={() => onDelete(item)} disabled={busy} style={{
            width: "100%", marginTop: 12, padding: "10px 0", borderRadius: 10,
            background: BC.danger, border: "none", color: ON_ACCENT,
            fontSize: FS.small, fontWeight: 800, fontFamily: FONT,
            cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
          }}>
            {busy ? "Removing…" : "Remove photo"}
          </button>
        )}
      </div>
    </Popup>
  );
}

function ChevronButton({ side, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label={side === "left" ? "Previous photo" : "Next photo"}
      style={{
        position: "absolute", top: "50%", transform: "translateY(-50%)",
        [side]: 6, width: 38, height: 38, borderRadius: "50%",
        background: `${BC.bg}${ALPHA.panel}`, border: `1px solid ${BC.bdr}`,
        color: BC.t1, fontSize: FS.lead, fontWeight: 700, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {side === "left" ? "‹" : "›"}
    </button>
  );
}

// ── PhotosView ─────────────────────────────────────────────────────
export function PhotosView({
  items, year, uid, isDirector, canPost, uploadsBlockedReason = "",
  onUpload, onDelete, notify,
}) {
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const fileRef = useRef(null);

  const groups = useMemo(() => groupByRound(items), [items]);
  // The flattened list the lightbox pages through — the same order the groups
  // are drawn in, so "next" on screen and "next" in the array are one thing.
  const flat = useMemo(() => groups.flatMap(g => g.items), [groups]);

  const step = (dir) => {
    if (!open) return;
    const i = flat.findIndex(x => x.id === open.id);
    if (i === -1) return;
    const next = flat[(i + dir + flat.length) % flat.length];
    if (next) setOpen(next);
  };

  const pick = () => fileRef.current?.click();

  const onFiles = async (e) => {
    const files = [...(e.target.files || [])];
    // Reset immediately so picking the same file twice in a row still fires a
    // change event — without this the second attempt looks like nothing
    // happened at all.
    e.target.value = "";
    if (!files.length) return;

    const rejected = files.map(f => validateSource(f)).filter(r => !r.ok);
    if (rejected.length) notify?.(rejected[0].reason, "error");
    const usable = files.filter(f => validateSource(f).ok);
    if (!usable.length) return;

    setBusy(true);
    let done = 0;
    const failures = [];
    for (const file of usable) {
      setProgress(`${done + 1} of ${usable.length}`);
      try {
        await onUpload(file);
        done += 1;
      } catch (err) {
        // Keep going. A batch of twenty that stops dead on the one photo the
        // browser could not decode is worse than nineteen uploaded photos and
        // a count of what did not make it.
        failures.push(err);
        console.error("photo upload failed:", err);
      }
    }
    setBusy(false);
    setProgress(null);

    if (!failures.length) {
      notify?.(done === 1 ? "Photo added." : `${done} photos added.`);
      return;
    }
    // Say what actually went wrong. This used to report "couldn't be read" for
    // every failure — decode, encode, network and permissions all collapsed
    // into one sentence that was wrong for three of them, on a phone with no
    // console to check. The thrown messages are written to be read by whoever
    // is holding it; a Firebase error code is not, so those get translated.
    notify?.(`${done ? `${done} added. ` : ""}${uploadFailureMessage(failures[0], failures.length)}`, "error");
  };

  const remove = async (item) => {
    setBusy(true);
    try {
      await onDelete(item);
      // Step off the deleted photo rather than closing: removing three bad
      // shots in a row should not mean reopening the lightbox three times.
      const i = flat.findIndex(x => x.id === item.id);
      const next = flat[i + 1] || flat[i - 1] || null;
      setOpen(next && next.id !== item.id ? next : null);
      notify?.("Photo removed.");
    } catch (err) {
      console.error("photo delete failed:", err);
      notify?.("Couldn't remove that photo.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ fontFamily: FONT }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: FS.lead, fontWeight: 800, color: BC.t1 }}>Photos</div>
          <div style={{ fontSize: FS.small, color: BC.t3 }}>
            {year ? `${year} · ` : ""}{items.length} {items.length === 1 ? "photo" : "photos"}
          </div>
        </div>
        {canPost && (
          <>
            {/* `capture` is deliberately absent: it forces the camera and
                hides the library, and most photos worth adding were taken
                hours ago. Leaving it off gives both on iOS and Android. */}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              onChange={onFiles}
              style={{ display: "none" }}
            />
            <button onClick={pick} disabled={busy} style={{
              padding: "8px 16px", borderRadius: 10, border: "none",
              background: `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})`,
              color: ON_AMBER, fontSize: FS.small, fontWeight: 800, fontFamily: FONT,
              cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, flexShrink: 0,
            }}>
              {busy ? (progress || "Adding…") : "Add Photos"}
            </button>
          </>
        )}
      </div>

      {/* The budget circuit breaker, said out loud. A vanished Add button with
          no explanation reads as a bug, and the first thing somebody does
          about a bug is try again — so the reason is on screen, and it says
          what still works. Browsing is deliberately unaffected. */}
      {uploadsBlockedReason && (
        <Card style={{ marginBottom: 12, borderColor: `${BC.warn}${ALPHA.line}`, padding: 12 }}>
          <div style={{ fontSize: FS.small, color: BC.t2, lineHeight: 1.45 }}>
            {uploadsBlockedReason}
            <br />
            <span style={{ color: BC.t3 }}>Browsing and removing photos still work.</span>
          </div>
        </Card>
      )}

      {!items.length ? (
        <Card style={{ textAlign: "center", padding: 24 }}>
          <div style={{ fontSize: FS.body, color: BC.t2 }}>
            {canPost
              ? "No photos from this tournament yet. Add the first one."
              : "No photos from this tournament yet."}
          </div>
        </Card>
      ) : (
        groups.map(group => (
          <div key={group.round ?? "loose"} style={{ marginBottom: 18 }}>
            <SectionLabel>{group.label}</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: GAP }}>
              {group.items.map(item => (
                <Tile key={item.id} item={item} onOpen={setOpen} />
              ))}
            </div>
          </div>
        ))
      )}

      {/* The years that were photographed before this screen existed. They live
          on the tournament's own website and always have; this tab is what the
          app itself holds, which is nothing at all for most of them. The link
          out is how you get to the rest rather than a second navigation. */}
      <a
        href={PHOTO_LIBRARY_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "block", marginTop: 4, padding: "12px 0", textAlign: "center",
          fontSize: FS.small, fontWeight: 700, color: BC.amberInk, textDecoration: "none",
          border: `1px solid ${BC.bdr}`, borderRadius: 10, background: BC.card,
        }}
      >
        The full photo library ↗
      </a>

      {open && (
        <Lightbox
          item={open}
          items={flat}
          busy={busy}
          canRemove={canDelete(open, { uid, isDirector })}
          onStep={step}
          onDelete={remove}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

export default PhotosView;
