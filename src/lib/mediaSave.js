// ══════════════════════════════════════════════════════════════════
//  mediaSave — getting a photo off the gallery and onto the phone.
// ══════════════════════════════════════════════════════════════════
//
// Long-pressing the image has always worked and still does; this is the same
// thing said out loud, because "long-press it" is folk knowledge and half the
// field will never find it.
//
// Three routes, each a fallback for the last:
//
//   share     navigator.share with a File opens the OS sheet — on iOS that is
//             Save Image, AirDrop and Messages, the gestures somebody already
//             knows. This is the one that matters on a phone.
//   download  an <a download> on an object URL, for a desktop browser with no
//             share sheet.
//   open      the photo in a new tab, from which a long-press still works.
//             The last resort, and it is allowed to fail.
//
// ── Why it returns a status instead of nothing ────────────────────
// The caller has to say something true afterwards, and "saved" is not true of
// all three. A share sheet dismissed is not a failure, a blocked popup is not
// a save, and telling somebody their photo was saved when a popup blocker ate
// it is how they find out later that it wasn't. So each route reports itself
// and the screen says what actually happened.
import { saveFilename } from "./media";

export const SAVE = {
  shared: "shared",       // handed to the OS sheet; the OS owns it from here
  saved: "saved",         // written to the downloads folder
  opened: "opened",       // opened in a tab for a long-press
  cancelled: "cancelled", // the share sheet was dismissed — not a failure
  blocked: "blocked",     // the popup was blocked; nothing happened
  failed: "failed",
};

// What the screen says. Only two of these are worth interrupting somebody for:
// the ones where nothing landed on their phone.
export const saveMessage = (status) => {
  if (status === SAVE.saved) return "Photo saved.";
  if (status === SAVE.opened) return "Opened the photo — press and hold it to save.";
  if (status === SAVE.blocked) return "Your browser blocked that — press and hold the photo to save it.";
  if (status === SAVE.failed) return "Couldn't save that photo — press and hold the picture instead.";
  // shared: the OS sheet is its own confirmation, and a toast under it is
  // noise. cancelled: they changed their mind; saying anything is nagging.
  return "";
};

// `blob` is the already-fetched bytes, or null when the fetch failed or has
// not landed yet. See PhotosView for why it is fetched ahead of the tap rather
// than inside it: Safari will not open a share sheet from a handler that has
// awaited anything, so having the bytes ready is what makes the sheet possible
// at all.
export const savePhoto = async ({ item, blob }) => {
  if (!item?.url) return SAVE.failed;

  if (blob) {
    const name = saveFilename(item, blob.type);
    try {
      const file = new File([blob], name, { type: blob.type });
      // canShare is the feature test that matters — `share` exists on desktop
      // browsers that cannot take files, and calling it there throws.
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        return SAVE.shared;
      }
    } catch (err) {
      // Dismissing the sheet throws AbortError. That is somebody changing
      // their mind — it must NOT fall through to a download and save the photo
      // they just declined to save.
      if (err?.name === "AbortError") return SAVE.cancelled;
      // Any other share failure is worth trying to download instead.
    }

    try {
      // The `download` ATTRIBUTE ALONE IS NOT ENOUGH: it is ignored
      // cross-origin, and the photo is served from firebasestorage.googleapis
      // .com, so a plain link silently degrades to a navigation. Downloading
      // an object URL works because that URL is same-origin.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      // Revoked on a later tick, not immediately: Safari has been known to
      // cancel a download whose object URL is released in the same frame the
      // click was dispatched.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return SAVE.saved;
    } catch { /* fall through to opening it */ }
  }

  // No bytes — the fetch failed, which on this bucket usually means CORS is
  // not configured for this origin. Opening the photo still gets somebody to a
  // long-press, which is the gesture that never needed any of this.
  //
  // window.open RETURNS NULL WHEN BLOCKED, and saying "opened" then would be a
  // lie told to somebody staring at an unchanged screen.
  const win = window.open(item.url, "_blank", "noopener");
  return win ? SAVE.opened : SAVE.blocked;
};
