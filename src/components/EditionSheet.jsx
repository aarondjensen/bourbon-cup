// ══════════════════════════════════════════════════════════════════
//  EditionSheet — everything you can do to one tournament.
// ══════════════════════════════════════════════════════════════════
//
// Opened by tapping a row in EditionSwitcher. It exists because the row could
// not go on being both a name and a control panel: at a 320pt viewport a
// director's row carried six things and the name was down to "…p 2026". Every
// rearrangement of six things is another arrangement of six things, so the
// four controls moved here instead.
//
// What that buys, beyond the width:
//
//   • EVERY ACTION GETS A WORD. A 12px 🗑 four pixels from Open is a mis-tap
//     on a phone in sunlight. "Delete tournament", in red, behind a tap, is
//     not — and the existing confirm still follows it.
//   • ABSENCES CAN EXPLAIN THEMSELVES. `deleteEdition` refuses the active
//     edition, because the running app would lose its data out from under it.
//     On the row that showed up as a trash icon that quietly was not drawn,
//     which tells a director nothing. Here it is a sentence.
//   • ONE LIST FOR BOTH AUDIENCES. The player/director fork used to be four
//     conditionals inside a row; it is now one button against five in here,
//     so the list itself is identical for everybody.
//
// The player's copy of this sheet also absorbs the confirm that used to open
// ON TOP of the picker when somebody opened a finished year — same words, one
// layer instead of two. The destructive confirms (delete, lock) stay, because
// those are the ones a person should have to answer twice.
import { BC, FS, FONT, ON_AMBER, R } from "../theme";
import { Popup } from "./Popup";
import { IconPencil, IconLock, IconUnlock, IconTrash, IconSwap } from "./Icons";
import { editionActions, isDemoEdition } from "../lib/editionLock";

const metaWord = {
  fontSize: FS.label, fontWeight: 700, letterSpacing: 1,
  textTransform: "uppercase", lineHeight: 1,
};

// One row of the action list. The icon is decoration beside a word, so it is
// aria-hidden inside Icons and the button carries the label itself.
function Action({ icon: Icon, label, hint, danger, onClick, disabled }) {
  const ink = danger ? BC.danger : BC.t1;
  return (
    <button onClick={onClick} disabled={disabled} style={{
      display: "flex", alignItems: "center", gap: 11, width: "100%",
      padding: "12px 10px", borderRadius: R.md, border: "none", background: "transparent",
      fontFamily: FONT, fontSize: FS.body, fontWeight: 700, color: ink,
      textAlign: "left", cursor: disabled ? "default" : "pointer",
      opacity: disabled ? 0.4 : 1,
    }}>
      <span style={{ flexShrink: 0, color: danger ? BC.danger : BC.t3, display: "flex" }}>
        <Icon size={16} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      {hint && (
        <span style={{ flexShrink: 0, fontSize: FS.label, fontWeight: 600, color: BC.t3 }}>{hint}</span>
      )}
    </button>
  );
}

const Divider = () => (
  <div style={{ height: 1, background: BC.bdr, margin: "6px 10px" }} />
);

/**
 * @param {object}   edition     the row that was tapped
 * @param {boolean}  isActive    is this the edition the app has open
 * @param {boolean}  canManage   draw the director half
 * @param {Function} onOpen onRename onLock onStatus onDelete onClose
 */
export function EditionSheet({
  edition, isActive = false, canManage = false, busy = false,
  onOpen, onRename, onLock, onStatus, onDelete, onClose,
}) {
  if (!edition) return null;
  const acts = editionActions({ edition, isActive, canManage });
  const archived = edition.status !== "published" && edition.status !== "draft";
  // Title case, so the status reads the same whether it came off the document
  // ("published") or from the archived default ("Archived").
  const statusWord = archived ? "Archived"
    : edition.status.charAt(0).toUpperCase() + edition.status.slice(1);

  return (
    // An EXPLICIT rung between the picker ("content", 500) and a ConfirmModal
    // ("modal", 900): above the list it was opened from, below the delete and
    // lock confirms it raises. It renders correctly on the default too, but
    // only because this is written after the picker in the JSX — two popups at
    // the same z-index are decided by DOM order, and that is not a thing to
    // leave a modal's visibility resting on. See the ladder in Popup.jsx.
    <Popup onClose={onClose} portal zIndex={700} maxWidth={420} padding={0} outerPadding={12}
      innerStyle={{ fontFamily: FONT }}>

      {/* The YEAR at display size, the way the row leads with it. Somebody
          arriving here tapped a row four rows down a scroll; the first thing
          the sheet owes them is which one they hit. */}
      <div style={{ padding: "15px 15px 13px", borderBottom: `1px solid ${BC.bdr}` }}>
        <div style={{
          fontSize: FS.display, fontWeight: 800, color: BC.t1, lineHeight: 1,
          fontVariantNumeric: "tabular-nums", letterSpacing: -0.5,
        }}>{edition.year || edition.id}</div>
        {/* The full name, always, even when the row omitted it as derivable.
            The row is a scan; this is the confirmation. */}
        <div style={{ fontSize: FS.body, fontWeight: 600, color: BC.t3, marginTop: 5, lineHeight: 1.3 }}>
          {edition.name || edition.id}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 8, flexWrap: "wrap" }}>
          {isActive && (
            <span style={{
              ...metaWord, color: ON_AMBER, background: BC.amber,
              padding: "4px 8px", borderRadius: R.sm,
            }}>ACTIVE</span>
          )}
          <span style={{ ...metaWord, color: BC.t3 }}>
            {statusWord}
          </span>
          {acts.locked && (
            <>
              <span style={{ color: BC.bdr }}>|</span>
              <span style={{ ...metaWord, color: BC.amberInk }}>Locked</span>
            </>
          )}
          {isDemoEdition(edition) && (
            <>
              <span style={{ color: BC.bdr }}>|</span>
              <span style={{ ...metaWord, color: BC.t3 }}>Demo</span>
            </>
          )}
        </div>
        {/* The read-only warning, which used to be a ConfirmModal stacked on
            top of the picker. Said here, before the tap, rather than after it. */}
        {acts.open && archived && (
          <div style={{ fontSize: FS.small, fontWeight: 600, color: BC.t3, marginTop: 9, lineHeight: 1.5 }}>
            Finished, so it opens read-only — every card and result, nothing to
            change. Come back here to return to this year.
          </div>
        )}
      </div>

      <div style={{
        display: "flex", flexDirection: "column", padding: 7,
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 10px)",
      }}>
        {acts.open && (
          <button onClick={onOpen} disabled={busy} style={{
            padding: 12, borderRadius: R.md, border: "none", fontFamily: FONT,
            background: BC.amber, color: ON_AMBER, fontSize: FS.body, fontWeight: 800,
            letterSpacing: 0.5, cursor: busy ? "default" : "pointer",
          }}>Open this tournament</button>
        )}
        {acts.open && canManage && <Divider />}

        {acts.rename && <Action icon={IconPencil} label="Rename" onClick={onRename} disabled={busy} />}
        {acts.lock && (
          <Action
            icon={acts.locked ? IconUnlock : IconLock}
            label={acts.locked ? "Unlock" : "Lock"}
            hint={acts.locked ? "members can write" : "freeze it against members"}
            onClick={onLock} disabled={busy}
          />
        )}
        {acts.status && (
          <Action icon={IconSwap} label="Change status"
            hint={statusWord} onClick={onStatus} disabled={busy} />
        )}

        {acts.delete && <><Divider />
          <Action icon={IconTrash} label="Delete tournament" danger onClick={onDelete} disabled={busy} />
        </>}

        {/* Why the two that are missing are missing. The row could only omit
            them silently; see editionActions. */}
        {acts.note && (
          <>
            {canManage && <Divider />}
            <p style={{
              margin: "2px 10px 6px", fontSize: FS.small, fontWeight: 600,
              color: BC.t3, lineHeight: 1.5,
            }}>{acts.note}</p>
          </>
        )}

        {/* A player looking at the year they are already in has nothing to do
            here at all, and an empty sheet is worse than a sentence. */}
        {!acts.open && !canManage && (
          <p style={{
            margin: "2px 10px 6px", fontSize: FS.small, fontWeight: 600,
            color: BC.t3, lineHeight: 1.5,
          }}>You&rsquo;re viewing this tournament.</p>
        )}

        <button onClick={onClose} style={{
          marginTop: 6, padding: 11, borderRadius: R.md, fontFamily: FONT,
          background: BC.inp, border: `1px solid ${BC.bdr}`, color: BC.t2,
          fontSize: FS.body, fontWeight: 700, cursor: "pointer",
        }}>Close</button>
      </div>
    </Popup>
  );
}
