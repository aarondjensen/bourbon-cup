// ══════════════════════════════════════════════════════════════════
//  fileSave — getting a generated file off the app and onto a machine.
// ══════════════════════════════════════════════════════════════════
//
// lib/mediaSave does this for a photo somebody tapped in the gallery. This is
// the same problem for a file the app has just BUILT — today the scores CSV,
// which has nowhere to come from but memory.
//
// Not merged with mediaSave, and it was tempting: a photo's routes are ordered
// share-first because a photo on a phone wants the OS sheet, and its messages
// all end in "press and hold the picture instead", which is advice about an
// image on a screen. Neither is true of a CSV. Same shape, opposite priorities.
//
// ── The routes, in the order they are tried ───────────────────────
//
//   download   an <a download> on a blob URL. The right answer on a laptop,
//              which is where a director exporting a backup is sitting, and
//              it puts the file in the downloads folder with its name intact.
//   share      navigator.share with a File — the OS sheet, which on a phone
//              is Save to Files, Mail and AirDrop. Tried FIRST on a native
//              build, because <a download> in a WKWebView opens a blank tab
//              and saves nothing.
//   clipboard  the text itself. Not a file at all, and that is fine for this
//              one: the destination is a spreadsheet, and pasting is what
//              somebody was going to do with it anyway.
//
// ── Why it reports which one happened ─────────────────────────────
// Same reason mediaSave does. "Exported" is not true of all three, and a
// director told his backup was saved when a popup blocker ate it finds out
// on the day he needs it. Each route says what it did and the screen says
// something true about it.
export const SAVED = {
  downloaded: "downloaded",  // in the downloads folder, under its own name
  shared: "shared",          // handed to the OS sheet; the OS owns it now
  copied: "copied",          // on the clipboard, not on disk
  cancelled: "cancelled",    // the share sheet was dismissed — not a failure
  failed: "failed",
};

export const savedMessage = (status, what = "The file") => {
  if (status === SAVED.downloaded) return `${what} is in your downloads.`;
  if (status === SAVED.copied) return `${what} is on your clipboard — paste it into a spreadsheet.`;
  if (status === SAVED.failed) return `Couldn't export ${what.toLowerCase()}.`;
  // shared: the OS sheet is its own confirmation and a toast under it is
  // noise. cancelled: they changed their mind, and saying anything is nagging.
  return "";
};

// A share sheet dismissed must NOT fall through to a download — that saves the
// file somebody just declined to save. Every other share failure is worth
// trying the next route for.
const CANCELLED = Symbol("cancelled");

const shareFile = async (name, text, mime) => {
  try {
    const file = new File([text], name, { type: mime });
    // canShare is the feature test that matters: `share` exists on desktop
    // browsers that cannot take files, and calling it there throws.
    if (!navigator.canShare?.({ files: [file] })) return false;
    await navigator.share({ files: [file] });
    return true;
  } catch (err) {
    if (err?.name === "AbortError") return CANCELLED;
    return false;
  }
};

const downloadFile = async (name, text, mime) => {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    // Revoked on a later tick. Safari has been known to cancel a download
    // whose object URL is released in the same frame the click was dispatched.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch { return false; }
};

const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { return false; }
};

// `native` is passed in rather than read from lib/platform, so this module
// stays testable without a Capacitor shim and the caller keeps the one
// isNative() the rest of the screen is already branching on.
export const saveTextFile = async ({ name, text, mime = "text/csv;charset=utf-8", native = false }) => {
  const routes = native
    ? [shareFile, downloadFile]
    : [downloadFile, shareFile];

  for (const route of routes) {
    const r = await route(name, text, mime);
    if (r === CANCELLED) return SAVED.cancelled;
    if (r) return route === shareFile ? SAVED.shared : SAVED.downloaded;
  }
  return (await copyText(text)) ? SAVED.copied : SAVED.failed;
};
