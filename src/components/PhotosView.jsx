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
// ── One sheet, newest first ───────────────────────────────────────
// No headings. There were "Round 1 / Round 2" ones, and they were guesses:
// the round could only come from which one was open at UPLOAD time, and
// nobody uploads from the tee — the camera roll gets emptied on Sunday night,
// which filed the whole weekend under one round. See the note in lib/media.js.
// The ORDER still holds, because it comes off each file's own date.
import { useEffect, useMemo, useRef, useState } from "react";
import { BC, FONT, FS, ALPHA, ON_ACCENT, ON_AMBER } from "../theme";
import { Popup, ConfirmModal } from "./Popup";
import { useConfirm } from "../lib/useConfirm";
import { PHOTO_LIBRARY_URL } from "../constants";
import { sortByTaken, canDelete, validateSource, uploadFailureMessage, UPLOAD_PHASE } from "../lib/media";
import { canReport, readReported, rememberReported } from "../lib/mediaReports";
import { savePhoto, saveMessage } from "../lib/mediaSave";

// The same Card AccountView defines, for the same reason: this screen is a
// page of cards and the app has no shared component for one.
const Card = ({ children, style }) => (
  <div style={{
    background: BC.card, border: `1px solid ${BC.bdr}`, borderRadius: 10,
    padding: "14px 16px", ...style,
  }}>{children}</div>
);

// Grid geometry. Three across is what fits a 320px handset with a gap that
// still reads as a gap; the cells stay square via aspectRatio so a slow
// thumbnail does not collapse the row it is in and shove everything below it
// up the screen.
const COLS = 3;
const GAP = 4;

// ── PendingTile ────────────────────────────────────────────────────
// A photo that has been PICKED but not yet uploaded, drawn from a local object
// URL so it is on screen before a single byte has moved.
//
// This exists because the alternative — a spinner inside the Add button —
// leaves somebody looking at a screen that has not changed, wondering whether
// the tap registered. The next thing they do is tap again, and now there are
// two of everything. Showing the photo itself is the only unambiguous answer
// to "did that work", and it is available instantly and for free.
//
// Two states, matching the two phases an upload actually has: a pulse while
// the phone is decoding and re-encoding (no byte count exists to report), and
// a real bar once bytes are moving.
function PendingTile({ entry }) {
  const uploading = entry.phase === UPLOAD_PHASE.uploading;
  return (
    <div style={{
      position: "relative", aspectRatio: "1 / 1", borderRadius: 6,
      overflow: "hidden", background: BC.inp,
    }}>
      <img
        src={entry.previewUrl}
        alt=""
        style={{
          width: "100%", height: "100%", objectFit: "cover", display: "block",
          opacity: 0.45,
          animation: uploading ? "none" : "bcPhotoPulse 1.4s ease-in-out infinite",
        }}
      />
      {/* The bar sits on the bottom edge of the tile rather than centred: it
          must not cover the photo it is describing, which is the thing that
          tells somebody WHICH upload this is. */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, background: `${BC.bg}${ALPHA.panel}` }}>
        <div style={{
          height: "100%",
          width: uploading ? `${Math.round(entry.fraction * 100)}%` : "100%",
          background: BC.amber,
          opacity: uploading ? 1 : 0.4,
          transition: "width .2s linear",
        }} />
      </div>
    </div>
  );
}

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
// The display copy, its caption, a Save, and — for whoever is allowed to
// remove it — a delete. Arrow keys and the on-screen chevrons move through the
// same sorted list the grid is showing, so "next" here and "next" on screen
// are the same photo.
//
// ── Saving a photo to the phone it is being looked at on ──────────
// The routes and what each one reports live in lib/mediaSave.js. What belongs
// here is WHEN the bytes are fetched, because that is a rendering decision.
//
// THE BLOB IS FETCHED WHEN THE PHOTO OPENS, not when Save is tapped. Safari
// will not open a share sheet from a handler that has awaited anything — the
// tap's activation is spent by then, the sheet never appears, and the button
// looks dead on exactly the phones that matter. Having the bytes in hand makes
// the handler synchronous up to the share() call. The display copy is on
// screen anyway, so this is normally a cache hit rather than a second
// download.
//
// The fetch needs BUCKET CORS to be configured for this origin. Without it the
// fetch fails, `blob` stays null, and mediaSave falls back to opening the photo
// in a tab — degraded, not broken, and it says so rather than claiming a save.
function Lightbox({
  item, items, onClose, onStep, onDelete, canRemove, busy, notify,
  onReport, canFlag, reported, reportCount = 0,
}) {
  const idx = items.findIndex(i => i.id === item.id);
  // The fetched bytes AND the url they came from, held together. Paging is
  // what makes that necessary: the previous photo's blob is still in state
  // while the next one downloads, and saving then would write the wrong photo
  // to somebody's camera roll under the right name. Pairing them means a
  // mismatch reads as "not ready yet", which is exactly what it is.
  //
  // It also keeps the reset out of the effect body — clearing state
  // synchronously there is a cascading render, and the pairing makes it
  // unnecessary rather than merely quieter.
  const [fetched, setFetched] = useState(null);
  const blob = fetched?.url === item.url ? fetched.blob : null;

  useEffect(() => {
    let live = true;
    fetch(item.url)
      .then(r => (r.ok ? r.blob() : null))
      .then(b => { if (live && b) setFetched({ url: item.url, blob: b }); })
      .catch(() => { /* Save falls back to opening the photo in a tab */ });
    return () => { live = false; };
  }, [item.url]);

  const save = async () => {
    const status = await savePhoto({ item, blob });
    const msg = saveMessage(status);
    if (msg) notify?.(msg, status === "saved" ? "success" : "error");
  };

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
          <span>
            {item.uploadedByName || "—"}
            {/* Only a director is subscribed to the reports, so this only ever
                renders for one. It sits beside the uploader's name rather than
                on the grid tile: a flag on a thumbnail is a public accusation
                in a gallery sixteen people scroll. */}
            {reportCount > 0 && (
              <span style={{ marginLeft: 8, color: BC.danger, fontWeight: 800 }}>
                ⚑ reported{reportCount > 1 ? ` ×${reportCount}` : ""}
              </span>
            )}
          </span>
          <span>{items.length ? `${idx + 1} of ${items.length}` : ""}</span>
        </div>
        {/* Save leads and is the full-width one: everybody can do it, on
            everybody's photo. Remove is the rarer, heavier action and sits
            under it in its own colour. */}
        <button onClick={save} style={{
          width: "100%", marginTop: 12, padding: "10px 0", borderRadius: 10,
          background: `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})`,
          border: "none", color: ON_AMBER,
          fontSize: FS.small, fontWeight: 800, fontFamily: FONT, cursor: "pointer",
        }}>
          Save to phone
        </button>
        {canRemove && (
          <button onClick={() => onDelete(item)} disabled={busy} style={{
            width: "100%", marginTop: 8, padding: "10px 0", borderRadius: 10,
            background: "transparent", border: `1px solid ${BC.danger}${ALPHA.line}`,
            color: BC.danger,
            fontSize: FS.small, fontWeight: 800, fontFamily: FONT,
            cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
          }}>
            {busy ? "Removing…" : "Remove photo"}
          </button>
        )}
        {/* Quiet on purpose, and last. It is the rarest action in the app and
            it should not compete with Save; a report button styled like the
            other two invites a curious tap on a gallery of golf photos. Once
            you have reported this one it says so instead of offering again —
            reporting twice writes the same document, but a button that keeps
            offering reads as one that did nothing. */}
        {canFlag && (
          <button
            onClick={() => onReport(item)}
            disabled={busy || reported}
            style={{
              width: "100%", marginTop: 8, padding: "8px 0", borderRadius: 10,
              background: "none", border: "none", color: BC.t3,
              fontSize: FS.small, fontWeight: 600, fontFamily: FONT,
              textDecoration: reported ? "none" : "underline",
              cursor: busy || reported ? "default" : "pointer",
            }}
          >
            {reported ? "Reported — a director has been told" : "Report this photo"}
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
  onUpload, onDelete, onReport, reportCounts, notify,
}) {
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const { confirm, confirmModal } = useConfirm();
  // Photos that have been PICKED but not yet stored. Each carries a local
  // object URL so it can be on screen instantly — see PendingTile for why that
  // matters more than a spinner does.
  const [pending, setPending] = useState([]);
  const fileRef = useRef(null);
  // Read once at mount rather than on every render: the reports collection is
  // director-only, so this is the reporter's only way to know they already
  // did. See lib/mediaReports for why the collection is not readable.
  const [reported, setReported] = useState(() => readReported());

  // Object URLs are a manual allocation. Each is revoked as its upload
  // finishes, and this covers the other exit: navigating away mid-batch, which
  // would otherwise leak one decoded photo per file picked.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => () => {
    pendingRef.current.forEach(p => URL.revokeObjectURL(p.previewUrl));
  }, []);

  // One list, newest first, and the lightbox pages through the same array the
  // grid draws — so "next" on screen and "next" in the array are one thing.
  const flat = useMemo(() => sortByTaken(items), [items]);

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
    await uploadFiles(files);
  };

  // ── No Take Photo button, deliberately ────────────────────────────
  // There was one, on native only, driving @capacitor/camera straight to the
  // capture: one tap from "something just happened on 17" to a photo of it.
  //
  // It is gone because it was never filling a hole. The file input above works
  // inside a WKWebView, and iOS's own sheet on it offers Take Photo or Video
  // right beside Photo Library — so a phone can still shoot a picture into
  // this screen, in one more tap, through the control the OS already gives it.
  // A second button doing a subset of what the first one does is a choice
  // asked of somebody standing on a tee box.
  //
  // What it costs is an argument rather than a capability: docs/app-store.md
  // §3 listed the camera among the native adaptations that answer guideline
  // 4.2. Native sign-in, APNs push, haptics and the bundled offline build are
  // still there and are still the stronger half of that case.
  //
  // NSCameraUsageDescription stays in Info.plist. The file input's own sheet
  // opens the camera through the webview, and a missing usage string is a
  // crash the first time somebody taps Take Photo — not a warning, and not
  // ours to see first.

  const uploadFiles = async (files) => {
    if (!files.length) return;

    const rejected = files.map(f => validateSource(f)).filter(r => !r.ok);
    if (rejected.length) notify?.(rejected[0].reason, "error");
    const usable = files.filter(f => validateSource(f).ok);
    if (!usable.length) return;

    // Every picked photo goes on screen NOW, before a byte moves.
    const queued = usable.map((file, i) => ({
      key: `pending_${Date.now()}_${i}`,
      file,
      previewUrl: URL.createObjectURL(file),
      fraction: 0,
      phase: UPLOAD_PHASE.preparing,
    }));
    setPending(prev => [...prev, ...queued]);

    setBusy(true);
    let done = 0;
    const failures = [];
    for (const entry of queued) {
      try {
        await onUpload(entry.file, (fraction, phase) => {
          setPending(prev => prev.map(p => (p.key === entry.key ? { ...p, fraction, phase } : p)));
        });
        done += 1;
      } catch (err) {
        // Keep going. A batch of twenty that stops dead on the one photo the
        // browser could not decode is worse than nineteen uploaded photos and
        // a count of what did not make it.
        failures.push(err);
        console.error("photo upload failed:", err);
      } finally {
        // Dropped as each one lands rather than at the end of the batch, so
        // the tile is replaced by the real one from Firestore instead of
        // sitting beside it.
        URL.revokeObjectURL(entry.previewUrl);
        setPending(prev => prev.filter(p => p.key !== entry.key));
      }
    }
    setBusy(false);

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

  // The only destructive act on this screen, and the only one in the app that
  // used to go straight through on one tap. It deletes the bytes out of
  // Storage, not just the index row, so there is nothing to re-draw it from
  // afterwards — and Remove photo sits directly under Save to phone, which is
  // the tap somebody actually meant.
  //
  // Whose photo it is gets named only when it isn't the reader's. A director
  // clearing their own bad shot does not need telling who took it; a director
  // clearing somebody else's is removing a thing that person put up, which is
  // the fact the dialog exists to put in front of them. Same shape as the
  // director branch on CardSignature's unsign.
  const remove = async (item) => {
    const theirs = item.uploadedBy !== uid;
    const who = item.uploadedByName;
    const ok = await confirm({
      eyebrow: "Photos",
      title: "Remove this photo?",
      message: [
        "It goes for everybody, and the file goes with it. This can't be undone.",
        ...(theirs ? ["", `${who || "Somebody else"} posted it.`] : []),
      ].join("\n"),
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
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

  // ── Reporting somebody else's photo ──
  // Confirmed, because it is a message about a person rather than about a
  // file, and the dialog is where that gets said plainly. Not destructive
  // styling: nothing is deleted, and a red button would suggest otherwise.
  const report = async (item) => {
    const ok = await confirm({
      eyebrow: "Photos",
      title: "Report this photo?",
      message: [
        "A director will be told, and can take it down.",
        "",
        "Nothing happens to the photo now, and whoever posted it is not told who reported it.",
      ].join("\n"),
      confirmLabel: "Report",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await onReport(item);
      setReported(rememberReported(item.id));
      notify?.("Reported. A director will take a look.");
    } catch (err) {
      console.error("photo report failed:", err);
      notify?.("Couldn't send that report.", "error");
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
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {/* Native only. On the web the picker's own sheet is the whole
                  story and a second button beside it is clutter. */}
              <button onClick={pick} disabled={busy} style={{
                padding: "8px 16px", borderRadius: 10, border: "none",
                background: `linear-gradient(135deg, ${BC.amber}, ${BC.amberDim})`,
                color: ON_AMBER, fontSize: FS.small, fontWeight: 800, fontFamily: FONT,
                cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
              }}>
                {busy ? "Adding…" : "Add Photos"}
              </button>
            </div>
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

      {/* Picked but not yet stored. Above the sheet because they are the most
          recent thing that happened, which is where the newest photo goes
          anyway — and because a row that appears at the bottom of a 500-photo
          gallery is a row nobody sees. */}
      {pending.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{
            fontSize: FS.label, fontWeight: 800, letterSpacing: 1.5,
            color: BC.amberInk, marginBottom: 8,
          }}>
            Adding {pending.length} {pending.length === 1 ? "photo" : "photos"}
          </div>
          {/* Declared once for the whole section rather than inside the tile:
              a batch of twenty would otherwise put twenty identical copies of
              the same keyframes in the document. */}
          <style>{"@keyframes bcPhotoPulse { 0%,100% { opacity: .30 } 50% { opacity: .62 } }"}</style>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: GAP }}>
            {pending.map(entry => <PendingTile key={entry.key} entry={entry} />)}
          </div>
        </div>
      )}

      {!items.length && !pending.length ? (
        <Card style={{ textAlign: "center", padding: 24 }}>
          <div style={{ fontSize: FS.body, color: BC.t2 }}>
            {canPost
              ? "No photos from this tournament yet. Add the first one."
              : "No photos from this tournament yet."}
          </div>
        </Card>
      ) : items.length ? (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: GAP, marginBottom: 18 }}>
          {flat.map(item => (
            <Tile key={item.id} item={item} onOpen={setOpen} />
          ))}
        </div>
      ) : null}

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
          onReport={report}
          canFlag={canReport(open, { uid })}
          reported={reported.has(open.id)}
          reportCount={reportCounts?.get(open.id) || 0}
          onClose={() => setOpen(null)}
          notify={notify}
        />
      )}

      {/* Portals to <body> at the modal rung, so it stacks over the
          lightbox it is raised from rather than under it. */}
      <ConfirmModal modal={confirmModal} />
    </div>
  );
}

export default PhotosView;
