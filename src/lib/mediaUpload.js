// ══════════════════════════════════════════════════════════════════
//  mediaUpload — a picked photo, downscaled in the browser and stored.
// ══════════════════════════════════════════════════════════════════
//
// The browser half of the photo library, ported from WBC. media.js holds every
// decision this file makes — sizes, crops, paths, validation — so that the
// arithmetic is testable without a DOM and this file is only canvas and
// network.
//
// ── The original never leaves the phone ───────────────────────────
// This is the single thing that keeps the library inside a free tier. A raw
// iPhone photo is 3–5MB; the 1600px WebP written here is around 250KB and the
// thumbnail around 25KB. That is a ~15x difference, and it is the difference
// between a cup costing 2.5GB and costing 175MB.
//
// It also means the upload is one small PUT on a course with two bars of
// signal, rather than a 5MB one that fails and gets retried.
//
// ── Why the Storage SDK is imported dynamically ───────────────────
// firebase/storage is ~40KB gzipped and every player loads the bundle on a
// phone, usually outdoors, to check a leaderboard. Almost none of them post a
// photo in a given session, so the module is pulled in on first upload instead
// of on every app start — the same reasoning firebase.js applies to Messaging.
// `firebaseApp` is already initialized there; getStorage just attaches to it.
import { firebaseApp } from "../firebase";
import {
  DISPLAY_EDGE, THUMB_EDGE, WEBP_QUALITY, THUMB_QUALITY,
  HOSTS, KINDS, photoId, storagePaths, mediaDocId,
  resizePlan, squareCropPlan, validateSource,
  ENCODINGS, MAX_UPLOAD_BYTES,
} from "./media";

// Cached so a run of uploads pays the dynamic import once.
let _storagePromise = null;
const storageApi = () => {
  if (!_storagePromise) _storagePromise = import("firebase/storage");
  return _storagePromise;
};

// ── Cache-Control ──────────────────────────────────────────────────
// A year, immutable. Photo bytes are addressed by a generated id and are never
// rewritten in place — a re-uploaded photo is a new id — so there is nothing a
// stale cache can be wrong about.
//
// This is not a micro-optimization. Egress is the metered dimension on the
// bucket, and a gallery of 500 thumbnails re-fetched on every visit is the one
// realistic way this feature generates a bill. With this header the second
// visit costs nothing.
const IMMUTABLE_YEAR = "public, max-age=31536000, immutable";

// ── Decoding ───────────────────────────────────────────────────────
// Two decoders, tried in order, because one of them is not enough on a phone.
//
// `imageOrientation: "from-image"` is what applies the EXIF rotation flag. Get
// this wrong and a good fraction of any iPhone library renders sideways, which
// is not a subtle bug but is an easy one to ship — the photo looks correct in
// the OS picker right up until the canvas draws it.

// The fallback decoder, and the one that matters on an iPhone.
//
// createImageBitmap cannot always take a HEIC blob even on a device whose
// image stack decodes HEIC perfectly well — the picker usually transcodes to
// JPEG on the way out, but not on every iOS version or every "Keep Originals"
// setting. An <img> goes through the platform's own decoder, which on iOS
// handles HEIC natively.
//
// EXIF orientation still applies here: CSS `image-orientation` defaults to
// `from-image`, and drawImage honours the rendered orientation.
const decodeViaImg = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    // Same shape the render functions expect from an ImageBitmap, so nothing
    // downstream has to know which decoder produced it.
    resolve({
      width: img.naturalWidth,
      height: img.naturalHeight,
      source: img,
      close: () => URL.revokeObjectURL(url),
    });
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error("This phone couldn't open that photo."));
  };
  img.src = url;
});

// ImageBitmap draws directly; the <img> fallback carries its element in
// `source`. drawImage accepts either.
const drawable = (bitmap) => bitmap.source || bitmap;

const decode = async (file) => {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      try {
        // Safari has historically rejected the options bag rather than
        // ignoring it. Retry bare — orientation may be off on that path, but a
        // rotated photo beats no photo.
        return await createImageBitmap(file);
      } catch { /* fall through to the <img> decoder */ }
    }
  }
  return decodeViaImg(file);
};

// ── Drawing ────────────────────────────────────────────────────────
// OffscreenCanvas where it exists (it keeps the main thread free while a
// 12-megapixel source is scaled), a detached <canvas> everywhere else.
const canvasFor = (w, h) => {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

// Encode once, in a named format, and REPORT WHAT CAME BACK.
//
// That last part is the whole point. Safari does not refuse an unsupported
// canvas export type — it hands back a PNG and says nothing, so asking for
// WebP and trusting the answer produces a silent 3-5MB upload that the 2MB
// rule then refuses with an opaque permission error. Every caller here checks
// `blob.type` against what it asked for.
const encodeAs = async (canvas, type, quality) => {
  let blob;
  if (typeof canvas.convertToBlob === "function") {
    // OffscreenCanvas rejects outright on an unsupported type rather than
    // substituting one, so a throw here is just "try the next format".
    try { blob = await canvas.convertToBlob({ type, quality }); }
    catch { return null; }
  } else {
    blob = await new Promise(resolve => canvas.toBlob(resolve, type, quality));
  }
  if (!blob) return null;
  return blob.type === type ? blob : null;
};

// Try the preferred formats in order, then push quality down until the result
// fits what storage.rules will accept.
//
// The quality ladder is not about looking good — a 1600px photo at q0.8 is
// ~250KB, nowhere near the 2MB cap. It exists so that the pathological case (a
// huge, noisy, incompressible image) degrades in quality instead of failing an
// upload on a tee box.
//
// STRICTLY less than the cap, because that is how storage.rules compares it.
// At exactly 2MB the rule refuses the write, and it refuses it as the same
// opaque permission error this whole path exists to avoid.
const encodeBest = async (canvas, baseQuality) => {
  for (const { type, ext } of ENCODINGS) {
    for (const quality of [baseQuality, 0.6, 0.45]) {
      const blob = await encodeAs(canvas, type, quality);
      if (blob && blob.size < MAX_UPLOAD_BYTES) return { blob, type, ext };
    }
  }
  throw new Error("This phone couldn't convert that photo to a smaller size.");
};

// The display rendition: longest edge to DISPLAY_EDGE, whole frame kept.
const renderDisplay = async (bitmap) => {
  const plan = resizePlan(bitmap.width, bitmap.height, DISPLAY_EDGE);
  const canvas = canvasFor(plan.w, plan.h);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(drawable(bitmap), 0, 0, plan.w, plan.h);
  const out = await encodeBest(canvas, WEBP_QUALITY);
  return { ...out, w: plan.w, h: plan.h };
};

// The thumbnail: centre square, so the grid is a contact sheet rather than a
// ragged list of differently-shaped files.
const renderThumb = async (bitmap) => {
  const crop = squareCropPlan(bitmap.width, bitmap.height, THUMB_EDGE);
  const canvas = canvasFor(crop.edge, crop.edge);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(drawable(bitmap), crop.sx, crop.sy, crop.size, crop.size, 0, 0, crop.edge, crop.edge);
  return encodeBest(canvas, THUMB_QUALITY);
};

// ── When the photo was taken ───────────────────────────────────────
// The browser gets `lastModified`, not EXIF. Parsing DateTimeOriginal out of a
// JPEG in the client would mean shipping an EXIF reader to every phone to
// improve a timestamp that, for a photo being uploaded from the tee minutes
// after it was taken, is already right.
const takenAtOf = (file) => {
  const t = Number(file?.lastModified);
  return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : new Date().toISOString();
};

// ── Upload ─────────────────────────────────────────────────────────
// Returns the document to write to `bc_media` — this module does not write it
// itself, because the caller owns the Firestore layer (App.jsx's `db`) and a
// second write path into the same collection is how two of them drift.
//
// Throws with a message meant to be shown to whoever is holding the phone.
export const uploadPhoto = async ({ file, tid, uid, uploaderName, round = null, caption = "", now = Date.now(), rand = Math.random() }) => {
  const check = validateSource(file);
  if (!check.ok) throw new Error(check.reason);
  if (!tid) throw new Error("No tournament is selected.");
  if (!uid) throw new Error("You need to be signed in to add photos.");

  const bitmap = await decode(file);
  let display, thumb;
  try {
    display = await renderDisplay(bitmap);
    thumb = await renderThumb(bitmap);
  } finally {
    // A decoded 12-megapixel bitmap is ~48MB of memory. Several of those held
    // at once while a batch uploads is enough to have the tab killed on an
    // older phone, and close() is the only thing that frees one promptly.
    bitmap.close?.();
  }

  const id = photoId(now, rand);
  // The extension and content type come from what the browser ACTUALLY
  // encoded, not from what was asked for. A JPEG parked at a .webp path would
  // be served with the wrong content type for as long as the photo exists.
  //
  // Each size carries its OWN extension. They almost always agree — the two
  // encodes ask for the same formats in the same order — but "almost always"
  // is how a thumbnail ends up named .jpg while holding WebP, and the two
  // calls cost nothing.
  const paths = {
    full: storagePaths(tid, id, display.ext).full,
    thumb: storagePaths(tid, id, thumb.ext).thumb,
  };
  const { getStorage, ref, uploadBytes, getDownloadURL } = await storageApi();
  const storage = getStorage(firebaseApp);

  const fullRef = ref(storage, paths.full);
  const thumbRef = ref(storage, paths.thumb);
  await uploadBytes(fullRef, display.blob, { contentType: display.type, cacheControl: IMMUTABLE_YEAR });
  await uploadBytes(thumbRef, thumb.blob, { contentType: thumb.type, cacheControl: IMMUTABLE_YEAR });
  const [url, thumbUrl] = await Promise.all([getDownloadURL(fullRef), getDownloadURL(thumbRef)]);

  return {
    id: mediaDocId(tid, id),
    mediaId: id,
    tournament_id: tid,
    kind: KINDS.photo,
    host: HOSTS.storage,
    // Resolved once, here. See the note in media.js on why a grid cannot
    // afford to resolve download URLs at render time.
    url,
    thumbUrl,
    path: paths.full,
    thumbPath: paths.thumb,
    w: display.w,
    h: display.h,
    round: Number.isFinite(Number(round)) && Number(round) > 0 ? Number(round) : null,
    caption: String(caption || "").slice(0, 280),
    uploadedBy: uid,
    uploadedByName: uploaderName || "",
    takenAt: takenAtOf(file),
    createdAt: new Date(now).toISOString(),
  };
};

// ── Deleting the bytes ─────────────────────────────────────────────
// Only ever called for host === "storage". A graduated photo's bytes are on
// the public library's own host and there is nothing here that can remove one,
// which is why media.js keeps the archive to a director.
//
// Missing objects are not an error: the index document is the thing that makes
// a photo exist in the app, and refusing to delete it because its bytes are
// already gone would leave a permanently undeletable row.
export const deletePhotoBytes = async (item) => {
  if (!item || item.host !== HOSTS.storage) return;
  const { getStorage, ref, deleteObject } = await storageApi();
  const storage = getStorage(firebaseApp);
  for (const path of [item.path, item.thumbPath]) {
    if (!path) continue;
    try {
      await deleteObject(ref(storage, path));
    } catch (e) {
      if (e?.code !== "storage/object-not-found") throw e;
    }
  }
};
