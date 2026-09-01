// ══════════════════════════════════════════════════════════════════
//  mediaReports — flagging a photo for the director's attention.
// ══════════════════════════════════════════════════════════════════
//
// Both stores ask the same four questions of any app carrying user-generated
// content — is there a filter, a way to REPORT it, a way to block a user, and
// published contact details (App Store guideline 1.2, Play's UGC policy and
// the IARC questionnaire's "ability to report user-generated content"). The
// answer used to be an argument: uploading needs the tournament password AND a
// claimed roster spot, so the sixteen uploaders are people who see each other
// every July. That argument is true and it kept having to be made, twice per
// store, in prose nobody can verify. This is the version that does not need
// making.
//
// Pure — no Firebase, no React — for the usual reason: firebase.js initialises
// an app at import, so anything importing it cannot be unit-tested.
//
// ── One document per person per photo ─────────────────────────────
// The id is derived rather than generated, so reporting the same photo twice
// overwrites rather than accumulating: a document per tap would let one person
// make a photo look like a scandal. It also makes the write idempotent, which
// matters on a course with one bar of signal where a tap gets repeated.
//
// ── Why not a field on the photo itself ───────────────────────────
// `bc_media` lets a member update only their OWN document, and the point of a
// report is that somebody else's photo is the problem. Widening that rule to
// let any member write to any photo row — to set a flag — would also let them
// rewrite its caption, its uploader and its URL. A separate collection keeps
// the photo index's write rule as narrow as it is.
export const REPORTS_COL = "bc_media_reports";

// Prefixed like every other id in the project, and joined with a double
// underscore because a media id already contains single ones (`med_bc_2025_…`).
export const reportDocId = (mediaId, uid) => `rep_${mediaId}__${uid}`;

/**
 * A report document. `reported_by` is pinned to the caller's own uid because
 * that is the field the security rule compares against `request.auth.uid` —
 * it has to be unforgeable at the moment it is written, the same shape as
 * bc_media's own create rule.
 */
export const buildReport = ({ mediaId, tid, uid, name = "", now = Date.now() }) => ({
  id: reportDocId(mediaId, uid),
  media_id: mediaId,
  tournament_id: tid,
  reported_by: uid,
  // Denormalised so the director sees who raised it without a second read
  // against a roster that may not even be the edition they are looking at.
  reported_by_name: name,
  reported_at: now,
});

/**
 * Who gets the button. A guest holds no uid and could not write the document
 * if they tapped it — the rules refuse an unauthenticated write before the UI
 * is consulted — so offering it would be a button that lies.
 *
 * Your own photo is excluded for a different reason: you can already delete
 * it. "Report" on a photo you can remove yourself is a worse version of a
 * button that is already there.
 */
export const canReport = (item, { uid } = {}) =>
  Boolean(uid) && Boolean(item?.id) && item?.uploadedBy !== uid;

/** mediaId → how many people have reported it. For the director's badge. */
export const reportsByMedia = (reports = []) => {
  const counts = new Map();
  for (const r of reports) {
    if (!r?.media_id) continue;
    counts.set(r.media_id, (counts.get(r.media_id) || 0) + 1);
  }
  return counts;
};

// ── Remembering that YOU reported something ───────────────────────
// The reports collection is director-only to read, deliberately: in a group of
// sixteen who have known each other since 2015, "who reported whose photo" is
// not a fact the app should hand around. That leaves the reporter's own UI
// with nothing to read back, so it remembers locally. Wrong after a reinstall,
// which costs one duplicate write that overwrites itself — the id is derived.
export const REPORTED_KEY = "bc_reported_photos";

const store = () => (typeof localStorage === "undefined" ? null : localStorage);

/** Every read and write is wrapped: Safari in private mode throws on both. */
export const readReported = (s = store()) => {
  try {
    const raw = s?.getItem(REPORTED_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter(x => typeof x === "string") : []);
  } catch { return new Set(); }
};

export const rememberReported = (mediaId, s = store()) => {
  try {
    const next = readReported(s);
    next.add(mediaId);
    s?.setItem(REPORTED_KEY, JSON.stringify([...next]));
    return next;
  } catch { return readReported(s); }
};
