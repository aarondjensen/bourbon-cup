// ══════════════════════════════════════════════════════════════════
//  media — the photo library's paths, sizes and grouping.
// ══════════════════════════════════════════════════════════════════
//
// Ported from WBC's lib/media.js so the two apps store a photo the same way.
// Pure: no Firebase, no React, no canvas. Same reason lib/players.js is pure —
// firebase.js initializes an app at import time, so anything importing it is
// untestable in a plain unit test. The browser half (canvas resizing, the
// upload itself) lives in mediaUpload.js and imports THIS.
//
// ── Firestore holds an index, not the photos ──────────────────────
// The bytes live in Firebase Storage; Firestore holds one small document per
// photo carrying the two URLs to draw it from. That split is what keeps a
// gallery affordable — a document is a few hundred bytes and a photo is a few
// hundred kilobytes, and only the ones somebody actually looks at get fetched.
//
// Two hosts are recorded per item, in `host`:
//
//   storage  Firebase Storage. The only one a phone can write to, so it is
//            where the live tournament uploads.
//   archive  A photo that has been moved out to the public library at
//            thebourboncup.com/photos. Nothing in the app produces one yet;
//            the value exists so the day a year is graduated there is a
//            metadata rewrite rather than a schema change, and so the delete
//            rule below already knows what to do with one.
//
// ── Why the documents carry URLs ──────────────────────────────────
// A Storage path is not a URL — resolving one needs an async getDownloadURL
// per item, and a 500-photo grid cannot make 500 round trips to draw itself.
// So the URL is resolved ONCE at upload and stored. `host` is then bookkeeping
// for deletion, not something a render path consults.
//
// ── The free tier, and what keeps us inside it ────────────────────
// Firebase Storage's no-cost tier is single-digit GB and it BILLS past the
// line rather than stopping. Three things hold the line, and all three are in
// this file or the one beside it:
//
//   1. The original never leaves the phone. mediaUpload.js writes a 1600px
//      WebP (~250KB) and a 400px square thumb (~25KB) — a ~15x reduction on a
//      raw iPhone photo. A whole cup of 500 photos is ~140MB.
//   2. The grid loads thumbnails only, with a year-long immutable cache.
//   3. The budget circuit breaker at the bottom of this file, which stops
//      UPLOADS and nothing else if the storage budget is ever reached.

// ── Hosts ──────────────────────────────────────────────────────────
export const HOSTS = {
  storage: "storage",
  archive: "archive",
};

// `kind` is on every document from the first one written, and the gallery
// switches on it, because the alternative is a migration over the whole index
// the day video is added. Only "photo" is produced today.
export const KINDS = {
  photo: "photo",
  video: "video",
};

// ── The two sizes ──────────────────────────────────────────────────
// A display image and a square thumbnail, both WebP. The grid loads only
// thumbnails; the full size is fetched when one is opened.
//
// 1600px is the point where a photo still looks right full-screen on a phone
// at 3x and the file lands around 250KB. The thumb at 400px covers a 3-across
// grid on the largest handset without the grid pulling megabytes to draw a
// screen of pictures nobody has tapped.
export const DISPLAY_EDGE = 1600;
export const THUMB_EDGE = 400;
export const WEBP_QUALITY = 0.8;
export const THUMB_QUALITY = 0.72;

// What a phone is allowed to hand us. This is the SOURCE cap, before resizing
// — a 45-megapixel raw off a mirrorless is not a tournament snapshot, and
// decoding one on a phone browser is how the tab dies. The resized upload is
// capped separately and far lower in storage.rules.
export const MAX_SOURCE_BYTES = 50 * 1024 * 1024;

// ── Upload progress ────────────────────────────────────────────────
// Two phases, because they are genuinely different and only one of them can
// be measured:
//
//   preparing  decode, resize, encode. All CPU, no byte count to report, and
//              on an older phone with a 12-megapixel source it is the SLOWER
//              half. The screen draws something indeterminate.
//   uploading  real bytes over a real network, so a real fraction.
//
// Lives here rather than in mediaUpload.js so the gallery can read the phase
// without statically importing the uploader — which would pull it out of its
// own lazy chunk and back into the bundle every player loads.
export const UPLOAD_PHASE = { preparing: "preparing", uploading: "uploading" };

// ── Identity and paths ─────────────────────────────────────────────
// Document ids carry the edition, the same way editionDocId() does for every
// other per-edition document (see src/firebase.js): the edition is in the id,
// so two editions cannot collide even though their photos are otherwise
// unrelated. `tid` is the full tournament id — "bc_2025", not "2025".
export const mediaDocId = (tid, id) => `med_${tid}_${id}`;

// What storage.rules will accept. The two MUST agree: the rule rejects
// anything at or above this, and a rejection arrives as an opaque permission
// error long after the photo was picked, which is the least debuggable way for
// an upload to fail. mediaUpload.js re-encodes at lower quality rather than let
// a photo hit this.
//
// The comparison is STRICTLY LESS THAN on both sides — the rule reads
// `request.resource.size < 2 * 1024 * 1024`, so a blob of exactly this size is
// refused. mediaUpload.js uses `<` for the same reason.
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

// The formats to try encoding, in order of preference.
//
// WebP first — it is roughly 30% smaller than JPEG at the same quality, which
// is the whole storage argument. But Safari's canvas has historically NOT
// encoded WebP, and it does not fail when asked to: `toBlob` quietly hands
// back a PNG instead. An unnoticed PNG is a 3-5MB upload where a 250KB one was
// intended, which then breaches MAX_UPLOAD_BYTES and is refused by the rules —
// on an iPhone, which is most of the field.
//
// So mediaUpload.js checks what it actually got and falls through to JPEG,
// and the EXTENSION travels with the choice — a JPEG stored at a .webp path
// would be served with the wrong content type forever.
export const ENCODINGS = [
  { type: "image/webp", ext: "webp" },
  { type: "image/jpeg", ext: "jpg" },
];

// Where the bytes sit in the Storage bucket. Keyed by edition so clearing a
// year out is a prefix listing rather than a query. The extension is whatever
// the browser actually managed to encode, not what was asked for.
export const storagePaths = (tid, id, ext = "webp") => ({
  full: `editions/${tid}/${id}.${ext}`,
  thumb: `editions/${tid}/${id}_thumb.${ext}`,
});

// An id for a newly picked photo. Time-ordered prefix so a bucket listing and
// the index come out in the same order, which is what makes an audit of one
// against the other readable.
export const photoId = (now, rand) => {
  const t = Number(now).toString(36).padStart(8, "0");
  const r = Math.floor(rand * 0x10000).toString(36).padStart(4, "0");
  return `${t}${r}`;
};

// ── Resizing, as arithmetic ────────────────────────────────────────
// The canvas work is in mediaUpload.js; the decisions are here so they can be
// tested without a DOM.

// Longest edge to `maxEdge`, aspect preserved, and NEVER upscaled — a 900px
// photo off an old camera stays 900px rather than being blown up to 1600 and
// made to look worse while costing more.
export const resizePlan = (w, h, maxEdge) => {
  const sw = Math.max(1, Math.round(w || 0));
  const sh = Math.max(1, Math.round(h || 0));
  const longest = Math.max(sw, sh);
  if (!maxEdge || longest <= maxEdge) return { w: sw, h: sh, scaled: false };
  const k = maxEdge / longest;
  return {
    w: Math.max(1, Math.round(sw * k)),
    h: Math.max(1, Math.round(sh * k)),
    scaled: true,
  };
};

// Thumbnails are square-cropped from the centre rather than letterboxed. A
// grid of mixed aspect ratios has ragged rows and no two photos the same size,
// which reads as a list of files instead of a contact sheet. The crop is the
// largest centred square the source contains.
export const squareCropPlan = (w, h, edge) => {
  const sw = Math.max(1, Math.round(w || 0));
  const sh = Math.max(1, Math.round(h || 0));
  const size = Math.min(sw, sh);
  return {
    sx: Math.round((sw - size) / 2),
    sy: Math.round((sh - size) / 2),
    size,
    // Same no-upscale rule as resizePlan: a source smaller than the thumb
    // target is written at its own size.
    edge: Math.min(edge, size),
  };
};

// ── What a phone is allowed to hand us ─────────────────────────────
// Returns a reason string rather than throwing, because every one of these is
// something to say to the person holding the phone, not an exception.
export const validateSource = (file) => {
  if (!file) return { ok: false, reason: "No file chosen." };
  const type = String(file.type || "");
  // HEIC off an iPhone reports as image/heic and some browsers report nothing
  // at all for it. Both are accepted here and sorted out at decode time — a
  // browser that cannot decode HEIC fails with a message, which is better than
  // rejecting a file the browser could actually have handled.
  if (type && !type.startsWith("image/")) {
    return { ok: false, reason: "That file is not a photo." };
  }
  if (file.size > MAX_SOURCE_BYTES) {
    return { ok: false, reason: "That photo is too large to upload." };
  }
  return { ok: true, reason: "" };
};

// ── Ordering and grouping ──────────────────────────────────────────
// When the photo was TAKEN, not when it was uploaded. The two are minutes
// apart for a photo posted from a tee box and years apart for anything added
// later from a laptop, and only takenAt puts the second one in the right
// place. Falls back to createdAt so a photo with no file date sorts with its
// upload rather than jumping to 1970.
export const takenTime = (item) => {
  const t = Date.parse(item?.takenAt || "");
  if (!Number.isNaN(t)) return t;
  const c = Date.parse(item?.createdAt || "");
  return Number.isNaN(c) ? 0 : c;
};

// Newest first, and that is the whole of the gallery's organisation.
//
// ── Why there is no round grouping ────────────────────────────────
// There was, and it was wrong. The round could only ever be guessed from
// WHICH ROUND WAS OPEN WHEN THE PHOTO WAS UPLOADED, and nobody uploads from
// the tee — they empty their camera roll on Sunday night, which filed the
// whole weekend under whatever round the app was showing at that moment. A
// heading that says "Round 2" over Friday's photos is worse than no heading:
// it is a fact the screen states and gets wrong, and nothing else on it looks
// any less trustworthy for being beside one.
//
// Ordering survives that, which is why it is still here. `takenAt` comes off
// the file's own date, so a batch dumped days later still sorts by when the
// photos were TAKEN — the sheet reads in the order the weekend happened
// whether it was posted from the course or from a laptop afterwards.
//
// If rounds ever come back it will be because somebody TOLD the app, not
// because it inferred one.
export const sortByTaken = (items) =>
  [...(items || [])].sort((a, b) => takenTime(b) - takenTime(a));

// ── The budget circuit breaker ─────────────────────────────────────
// Google Cloud budgets alert; they do not cap. The only native hard stop
// detaches the project from its billing account, which would take Firestore,
// the Cloud Functions and push down with it — the whole tournament app dark,
// plausibly mid-round, to save a sum smaller than one green fee.
//
// So the stop is scoped to the thing that can actually run away: photo
// uploads. functions/index.js listens to the budget's Pub/Sub topic and
// writes bc_config/photos; this reads it. Scoring, leaderboards, pairings and
// notifications are untouched by design — a blown photo budget must never be
// able to stop somebody posting a score.
//
// Reading the gallery stays open when the breaker is tripped. Serving photos
// that already exist is bounded and cached; it is UPLOADING that adds bytes
// which then have to be served forever.
export const CONFIG_COL = "bc_config";
export const PHOTOS_CONFIG_ID = "photos";

// Missing config means allowed. The document does not exist until the breaker
// trips for the first time, and a photo library that refuses uploads because
// nobody has ever blown the budget would be a strange way to fail.
export const photoUploadsAllowed = (config) => !config?.uploadsDisabled;

// What to tell somebody holding a phone. Deliberately not "contact an
// administrator": on this tournament the director is standing next to them.
export const uploadsDisabledReason = (config) =>
  config?.reason || "Photo uploads are paused — this month's storage budget was reached.";

// ── What to say when an upload fails ───────────────────────────────
// Firebase throws codes, not sentences. Left raw they reach the screen as
// "storage/unauthorized", which tells the person holding the phone nothing and
// tells whoever they report it to almost nothing either. Each of these maps to
// the actual situation and, where possible, what to do about it.
export function uploadFailureMessage(err, count = 1) {
  const code = String(err?.code || "");
  const many = count > 1 ? ` (${count} photos)` : "";
  if (code === "storage/unauthorized" || code === "permission-denied") {
    return `Photos are locked right now — sign out and back in, or ask the director.${many}`;
  }
  if (code === "storage/retry-limit-exceeded" || code === "storage/canceled" || code === "unavailable") {
    return `Couldn't reach the server — try again when you have signal.${many}`;
  }
  if (code === "storage/quota-exceeded") {
    return `Photo storage is full for now.${many}`;
  }
  // Everything thrown by mediaUpload.js is already a sentence meant for this
  // screen, so it is used as-is rather than replaced with something vaguer.
  const msg = String(err?.message || "").trim();
  if (msg && !msg.startsWith("Firebase") && msg.length < 120) return `${msg}${many}`;
  return `That photo couldn't be added.${many}`;
}

// ── The name a saved photo lands under ─────────────────────────────
// This ends up in somebody's camera roll or Downloads folder, so it carries
// the cup's name rather than the generated id alone.
//
// The extension is derived from the blob's OWN type rather than from the
// stored path, because those can disagree: an old document written before the
// JPEG fallback existed points at a `.webp` path, and what actually comes back
// is whatever the bytes are.
//
// A MIME type is not just "type/subtype". It can carry a structured suffix
// (`image/svg+xml`) or parameters (`image/jpeg; charset=binary`), and pasting
// either into a filename produces something a phone will not open. Both are
// cut, and `jpeg` is spelled the way every other file on a phone spells it.
export const saveFilename = (item, mimeType) => {
  const sub = String(mimeType || "").split("/")[1] || "";
  const ext = sub.split(/[+;]/)[0].trim().toLowerCase().replace(/^jpeg$/, "jpg") || "jpg";
  return `bourbon-cup-${item?.mediaId || item?.id || "photo"}.${ext}`;
};

// ── Deletion ───────────────────────────────────────────────────────
// Who may remove a photo, decided here so the gallery and firestore.rules
// agree by construction rather than by both being edited carefully.
//
// A director may remove anything; everyone else may remove what they posted,
// and only while it is still in the bucket. A photo that has been graduated to
// the public library is director-only: its bytes are no longer somewhere this
// app can delete from, so removing the index document would leave a file only
// whoever runs that site can clear. The check is written as "storage, or
// nothing" rather than "not archive", so a host added later is director-only
// until somebody decides otherwise instead of silently member-deletable.
export const canDelete = (item, { uid, isDirector }) => {
  if (!item || !uid) return false;
  if (isDirector) return true;
  return item.host === HOSTS.storage && item.uploadedBy === uid;
};
