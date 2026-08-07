import { describe, it, expect } from "vitest";
import {
  HOSTS, KINDS, DISPLAY_EDGE, THUMB_EDGE, MAX_SOURCE_BYTES,
  mediaDocId, storagePaths, photoId,
  resizePlan, squareCropPlan, validateSource,
  takenTime, sortByTaken, canDelete, saveFilename,
  photoUploadsAllowed, uploadsDisabledReason, ENCODINGS, MAX_UPLOAD_BYTES,
} from "./media";

describe("mediaDocId / paths", () => {
  it("scopes the document id to the edition", () => {
    expect(mediaDocId("bc_2026", "abc")).toBe("med_bc_2026_abc");
  });

  it("does not collide across editions for the same photo id", () => {
    expect(mediaDocId("bc_2025", "abc")).not.toBe(mediaDocId("bc_2026", "abc"));
  });

  it("puts both sizes under the edition's prefix", () => {
    expect(storagePaths("bc_2026", "abc")).toEqual({
      full: "editions/bc_2026/abc.webp",
      thumb: "editions/bc_2026/abc_thumb.webp",
    });
  });

  it("carries the extension of whatever the browser actually encoded", () => {
    // Safari can refuse WebP and hand back JPEG; the path has to follow, or
    // the file is served with the wrong content type for as long as it exists.
    expect(storagePaths("bc_2026", "abc", "jpg")).toEqual({
      full: "editions/bc_2026/abc.jpg",
      thumb: "editions/bc_2026/abc_thumb.jpg",
    });
  });

  it("keeps the two sizes as distinct files", () => {
    const p = storagePaths("bc_2026", "abc");
    expect(p.full).not.toBe(p.thumb);
  });
});

describe("ENCODINGS / MAX_UPLOAD_BYTES", () => {
  it("prefers WebP but keeps a fallback, because Safari may not encode it", () => {
    expect(ENCODINGS[0].type).toBe("image/webp");
    expect(ENCODINGS.length).toBeGreaterThan(1);
    expect(ENCODINGS.at(-1).type).toBe("image/jpeg");
  });

  it("gives every encoding a file extension to travel with", () => {
    for (const e of ENCODINGS) {
      expect(e.ext).toMatch(/^[a-z0-9]+$/);
      expect(e.type).toMatch(/^image\//);
    }
  });

  it("agrees with the cap written into storage.rules", () => {
    // storage.rules: request.resource.size < 2 * 1024 * 1024.
    // If these drift, uploads fail as opaque permission errors. Note the
    // comparison is strict on both sides — mediaUpload.js uses `<` too, so a
    // blob of exactly this size is re-encoded rather than refused.
    expect(MAX_UPLOAD_BYTES).toBe(2 * 1024 * 1024);
  });
});

describe("photoId", () => {
  it("sorts lexically in time order", () => {
    const early = photoId(1_600_000_000_000, 0.5);
    const later = photoId(1_700_000_000_000, 0.5);
    expect([later, early].sort()).toEqual([early, later]);
  });

  it("separates two photos picked in the same millisecond", () => {
    expect(photoId(1_700_000_000_000, 0.1)).not.toBe(photoId(1_700_000_000_000, 0.9));
  });

  it("is a fixed-width token safe for a url and a filename", () => {
    const id = photoId(1_700_000_000_000, 0.42);
    expect(id).toMatch(/^[0-9a-z]+$/);
    expect(id).toHaveLength(12);
  });
});

describe("resizePlan", () => {
  it("scales the longest edge down and keeps the aspect ratio", () => {
    expect(resizePlan(4000, 3000, 1600)).toEqual({ w: 1600, h: 1200, scaled: true });
    expect(resizePlan(3000, 4000, 1600)).toEqual({ w: 1200, h: 1600, scaled: true });
  });

  it("never upscales a small photo from an old camera", () => {
    expect(resizePlan(900, 600, 1600)).toEqual({ w: 900, h: 600, scaled: false });
  });

  it("leaves a photo exactly at the target alone", () => {
    expect(resizePlan(1600, 1200, 1600)).toEqual({ w: 1600, h: 1200, scaled: false });
  });

  it("keeps a panorama at least one pixel tall", () => {
    const p = resizePlan(10000, 100, 1600);
    expect(p.w).toBe(1600);
    expect(p.h).toBeGreaterThanOrEqual(1);
  });

  it("degrades rather than throwing on missing dimensions", () => {
    expect(resizePlan(0, 0, 1600)).toEqual({ w: 1, h: 1, scaled: false });
    expect(resizePlan(undefined, undefined, 1600)).toEqual({ w: 1, h: 1, scaled: false });
  });

  it("produces a display image no bigger than DISPLAY_EDGE on either side", () => {
    for (const [w, h] of [[6000, 4000], [4000, 6000], [1601, 1601], [800, 200]]) {
      const p = resizePlan(w, h, DISPLAY_EDGE);
      expect(Math.max(p.w, p.h)).toBeLessThanOrEqual(DISPLAY_EDGE);
    }
  });
});

describe("squareCropPlan", () => {
  it("takes the largest centred square from a landscape photo", () => {
    expect(squareCropPlan(4000, 3000, 400)).toEqual({ sx: 500, sy: 0, size: 3000, edge: 400 });
  });

  it("takes it from the middle of a portrait photo too", () => {
    expect(squareCropPlan(3000, 4000, 400)).toEqual({ sx: 0, sy: 500, size: 3000, edge: 400 });
  });

  it("crops nothing from an already-square photo", () => {
    expect(squareCropPlan(1000, 1000, 400)).toEqual({ sx: 0, sy: 0, size: 1000, edge: 400 });
  });

  it("does not upscale a source smaller than the thumbnail", () => {
    expect(squareCropPlan(200, 150, 400).edge).toBe(150);
  });

  it("stays inside the source bounds", () => {
    for (const [w, h] of [[4000, 3000], [3000, 4000], [1234, 567], [1, 900]]) {
      const c = squareCropPlan(w, h, THUMB_EDGE);
      expect(c.sx).toBeGreaterThanOrEqual(0);
      expect(c.sy).toBeGreaterThanOrEqual(0);
      expect(c.sx + c.size).toBeLessThanOrEqual(w);
      expect(c.sy + c.size).toBeLessThanOrEqual(h);
    }
  });
});

describe("validateSource", () => {
  const file = (over = {}) => ({ type: "image/jpeg", size: 2_000_000, ...over });

  it("accepts an ordinary phone photo", () => {
    expect(validateSource(file()).ok).toBe(true);
  });

  it("accepts HEIC off an iPhone", () => {
    expect(validateSource(file({ type: "image/heic" })).ok).toBe(true);
  });

  it("accepts a file the browser reported no type for", () => {
    expect(validateSource(file({ type: "" })).ok).toBe(true);
  });

  it("rejects a non-image with something worth saying", () => {
    const r = validateSource(file({ type: "application/pdf" }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not a photo/i);
  });

  it("rejects a source too big to decode on a phone", () => {
    const r = validateSource(file({ size: MAX_SOURCE_BYTES + 1 }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/too large/i);
  });

  it("accepts a file exactly at the cap", () => {
    expect(validateSource(file({ size: MAX_SOURCE_BYTES })).ok).toBe(true);
  });

  it("rejects nothing at all without throwing", () => {
    expect(validateSource(null).ok).toBe(false);
    expect(validateSource(undefined).ok).toBe(false);
  });
});

describe("takenTime", () => {
  it("prefers when the photo was taken over when it was uploaded", () => {
    const item = { takenAt: "2019-06-21T15:00:00.000Z", createdAt: "2026-08-06T12:00:00.000Z" };
    expect(takenTime(item)).toBe(Date.parse("2019-06-21T15:00:00.000Z"));
  });

  it("falls back to the upload time when there is no file date", () => {
    const item = { createdAt: "2026-08-06T12:00:00.000Z" };
    expect(takenTime(item)).toBe(Date.parse("2026-08-06T12:00:00.000Z"));
  });

  it("does not send an undated photo to 1970 by way of NaN", () => {
    expect(takenTime({})).toBe(0);
    expect(takenTime({ takenAt: "not a date" })).toBe(0);
    expect(takenTime(null)).toBe(0);
  });
});

describe("sortByTaken", () => {
  const a = { id: "a", takenAt: "2019-06-21T15:00:00.000Z" };
  const b = { id: "b", takenAt: "2023-06-21T15:00:00.000Z" };
  const c = { id: "c", takenAt: "2026-06-21T15:00:00.000Z" };

  it("puts the most recent photo first", () => {
    expect(sortByTaken([a, c, b]).map(x => x.id)).toEqual(["c", "b", "a"]);
  });

  it("does not mutate the array it was given", () => {
    const input = [a, c, b];
    sortByTaken(input);
    expect(input.map(x => x.id)).toEqual(["a", "c", "b"]);
  });

  it("survives an empty or missing list", () => {
    expect(sortByTaken([])).toEqual([]);
    expect(sortByTaken(null)).toEqual([]);
  });
});


describe("saveFilename", () => {
  const item = { mediaId: "abc123", id: "med_bc_2026_abc123" };

  it("names a saved photo after the cup, not after a generated id alone", () => {
    expect(saveFilename(item, "image/webp")).toBe("bourbon-cup-abc123.webp");
  });

  it("spells jpeg the way every other file on a phone spells it", () => {
    expect(saveFilename(item, "image/jpeg")).toBe("bourbon-cup-abc123.jpg");
  });

  it("cuts a structured suffix rather than putting it in the filename", () => {
    // image/svg+xml would otherwise land as "…svg+xml", which a phone will
    // not open.
    expect(saveFilename(item, "image/svg+xml")).toBe("bourbon-cup-abc123.svg");
  });

  it("cuts MIME parameters too", () => {
    expect(saveFilename(item, "image/jpeg; charset=binary")).toBe("bourbon-cup-abc123.jpg");
  });

  it("falls back to jpg rather than producing a file with no extension", () => {
    expect(saveFilename(item, "")).toBe("bourbon-cup-abc123.jpg");
    expect(saveFilename(item, null)).toBe("bourbon-cup-abc123.jpg");
    expect(saveFilename(item, "notamimetype")).toBe("bourbon-cup-abc123.jpg");
  });

  it("uses the document id when a photo predates mediaId", () => {
    expect(saveFilename({ id: "med_bc_2026_xyz" }, "image/webp")).toBe("bourbon-cup-med_bc_2026_xyz.webp");
  });

  it("still produces a usable name for nothing at all", () => {
    expect(saveFilename(null, "image/webp")).toBe("bourbon-cup-photo.webp");
  });
});

describe("canDelete", () => {
  const mine = { host: HOSTS.storage, uploadedBy: "me" };
  const theirs = { host: HOSTS.storage, uploadedBy: "you" };
  const archived = { host: HOSTS.archive, uploadedBy: "me" };

  it("lets a member remove what they posted", () => {
    expect(canDelete(mine, { uid: "me", isDirector: false })).toBe(true);
  });

  it("does not let a member remove somebody else's photo", () => {
    expect(canDelete(theirs, { uid: "me", isDirector: false })).toBe(false);
  });

  it("lets a director remove anything live", () => {
    expect(canDelete(theirs, { uid: "me", isDirector: true })).toBe(true);
  });

  it("keeps the archive director-only, even for the person who posted it", () => {
    expect(canDelete(archived, { uid: "me", isDirector: false })).toBe(false);
    expect(canDelete(archived, { uid: "me", isDirector: true })).toBe(true);
  });

  it("keeps a host nobody has thought about yet director-only too", () => {
    const odd = { host: "somewhere-new", uploadedBy: "me" };
    expect(canDelete(odd, { uid: "me", isDirector: false })).toBe(false);
    expect(canDelete(odd, { uid: "me", isDirector: true })).toBe(true);
  });

  it("refuses a signed-out reader", () => {
    expect(canDelete(mine, { uid: null, isDirector: false })).toBe(false);
    expect(canDelete(mine, { uid: null, isDirector: true })).toBe(false);
  });

  it("refuses a missing item rather than throwing", () => {
    expect(canDelete(null, { uid: "me", isDirector: true })).toBe(false);
  });
});

describe("photoUploadsAllowed", () => {
  it("allows uploads when the breaker has never tripped", () => {
    expect(photoUploadsAllowed(null)).toBe(true);
    expect(photoUploadsAllowed(undefined)).toBe(true);
    expect(photoUploadsAllowed({})).toBe(true);
  });

  it("allows uploads when the breaker is explicitly closed", () => {
    expect(photoUploadsAllowed({ uploadsDisabled: false })).toBe(true);
  });

  it("stops uploads when the breaker is tripped", () => {
    expect(photoUploadsAllowed({ uploadsDisabled: true })).toBe(false);
  });

  it("carries the reason the function wrote, when there is one", () => {
    expect(uploadsDisabledReason({ reason: "Budget hit $1.02." })).toBe("Budget hit $1.02.");
  });

  it("still says something useful with no reason recorded", () => {
    expect(uploadsDisabledReason({ uploadsDisabled: true })).toMatch(/paused/i);
    expect(uploadsDisabledReason(null)).toMatch(/paused/i);
  });
});

describe("constants the rest of the app shares", () => {
  it("names the hosts an item can live on", () => {
    expect(HOSTS).toEqual({ storage: "storage", archive: "archive" });
  });

  it("carries video in the schema before video is built", () => {
    expect(KINDS.video).toBe("video");
  });

  it("keeps the thumbnail well under the display size", () => {
    expect(THUMB_EDGE).toBeLessThan(DISPLAY_EDGE);
  });
});
