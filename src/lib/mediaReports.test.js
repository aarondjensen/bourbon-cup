import { describe, it, expect } from "vitest";
import {
  REPORTS_COL, reportDocId, buildReport, canReport, reportsByMedia,
  readReported, rememberReported, REPORTED_KEY,
} from "./mediaReports";

// A localStorage that behaves, and one that throws on everything — Safari in
// private mode is the second one, and every caller here has to survive it.
const fakeStore = () => {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
  };
};
const hostileStore = () => ({
  getItem: () => { throw new Error("denied"); },
  setItem: () => { throw new Error("denied"); },
});

describe("reportDocId", () => {
  it("is derived, so reporting twice overwrites rather than accumulating", () => {
    const a = reportDocId("med_bc_2025_abc", "uid1");
    const b = reportDocId("med_bc_2025_abc", "uid1");
    expect(a).toBe(b);
  });

  it("separates two people reporting the same photo", () => {
    expect(reportDocId("med_1", "uid1")).not.toBe(reportDocId("med_1", "uid2"));
  });

  it("joins with a double underscore, since media ids contain single ones", () => {
    expect(reportDocId("med_bc_2025_abc", "uid1")).toBe("rep_med_bc_2025_abc__uid1");
  });
});

describe("buildReport", () => {
  it("pins reported_by to the caller's own uid", () => {
    // The security rule compares this field against request.auth.uid, so it
    // has to be written from the caller rather than accepted from a form.
    const r = buildReport({ mediaId: "med_1", tid: "bc_2025", uid: "uid1", name: "Ben T", now: 42 });
    expect(r.reported_by).toBe("uid1");
    expect(r.id).toBe("rep_med_1__uid1");
    expect(r.media_id).toBe("med_1");
    expect(r.tournament_id).toBe("bc_2025");
    expect(r.reported_by_name).toBe("Ben T");
    expect(r.reported_at).toBe(42);
  });

  it("tolerates a missing name rather than writing undefined", () => {
    // Firestore rejects an undefined value outright, and a report is not worth
    // failing over a roster row that has not loaded.
    expect(buildReport({ mediaId: "m", tid: "t", uid: "u" }).reported_by_name).toBe("");
  });
});

describe("canReport", () => {
  it("offers nothing to a guest", () => {
    // A guest holds no uid, so the rules refuse the write before the UI is
    // consulted. A button that cannot work is worse than no button.
    expect(canReport({ id: "m", uploadedBy: "uid2" }, { uid: null })).toBe(false);
    expect(canReport({ id: "m", uploadedBy: "uid2" }, {})).toBe(false);
  });

  it("does not offer it on your own photo", () => {
    // You can already delete that one.
    expect(canReport({ id: "m", uploadedBy: "uid1" }, { uid: "uid1" })).toBe(false);
  });

  it("offers it on somebody else's", () => {
    expect(canReport({ id: "m", uploadedBy: "uid2" }, { uid: "uid1" })).toBe(true);
  });
});

describe("reportsByMedia", () => {
  it("counts per photo and ignores malformed rows", () => {
    const counts = reportsByMedia([
      { media_id: "a" }, { media_id: "a" }, { media_id: "b" }, {}, null,
    ]);
    expect(counts.get("a")).toBe(2);
    expect(counts.get("b")).toBe(1);
    expect(counts.size).toBe(2);
  });

  it("is empty for no reports", () => {
    expect(reportsByMedia().size).toBe(0);
  });
});

describe("remembering your own reports", () => {
  it("round-trips", () => {
    const s = fakeStore();
    rememberReported("med_1", s);
    rememberReported("med_2", s);
    expect([...readReported(s)].sort()).toEqual(["med_1", "med_2"]);
  });

  it("survives a localStorage that throws on every call", () => {
    const s = hostileStore();
    expect(readReported(s).size).toBe(0);
    expect(() => rememberReported("med_1", s)).not.toThrow();
    expect(readReported(s).size).toBe(0);
  });

  it("survives junk under the key", () => {
    const s = fakeStore();
    s.setItem(REPORTED_KEY, "{not json");
    expect(readReported(s).size).toBe(0);
    s.setItem(REPORTED_KEY, JSON.stringify({ nope: true }));
    expect(readReported(s).size).toBe(0);
    s.setItem(REPORTED_KEY, JSON.stringify(["med_1", 7, null]));
    expect([...readReported(s)]).toEqual(["med_1"]);
  });
});

describe("the collection", () => {
  it("is its own, not a field on bc_media", () => {
    // bc_media lets a member update only their OWN row, and the whole point of
    // a report is that somebody else's photo is the problem. Widening that
    // rule would also let any member rewrite any caption, uploader and URL.
    expect(REPORTS_COL).toBe("bc_media_reports");
  });
});
