// Every one of these routes can silently do the wrong thing: report an export
// that never happened, or save a file somebody just declined to save. The
// status is the only thing standing between that and what the screen says.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { saveTextFile, savedMessage, SAVED } from "./fileSave";

const TEXT = "Round 1,,,Kaufman - White\r\n";
const NAME = "The Bourbon Cup - Round 1.csv";

let clicked;
let shared;

// vi.stubGlobal rather than assignment: `navigator` is a getter-only global on
// modern Node, so `globalThis.navigator = {}` throws outright.
const setNavigator = (nav) => vi.stubGlobal("navigator", nav);

// A navigator that can take files, whose share() does whatever it is told.
const sharer = (impl) => ({
  canShare: () => true,
  share: async (data) => { shared.push(data); return impl?.(); },
});

beforeEach(() => {
  clicked = [];
  shared = [];
  vi.stubGlobal("document", {
    createElement: () => {
      const a = {};
      a.click = () => clicked.push({ href: a.href, download: a.download });
      return a;
    },
  });
  globalThis.URL.createObjectURL = () => "blob:fake";
  globalThis.URL.revokeObjectURL = () => {};
  setNavigator({});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("on the web", () => {
  // A director exporting a backup is at a laptop, and what he wants is the
  // file in his downloads folder under its own name — not a share sheet.
  it("downloads, in preference to a share sheet it could have used", async () => {
    setNavigator(sharer());
    expect(await saveTextFile({ name: NAME, text: TEXT })).toBe(SAVED.downloaded);
    expect(clicked).toEqual([{ href: "blob:fake", download: NAME }]);
    expect(shared).toEqual([]);
  });

  it("falls back to the share sheet when the download throws", async () => {
    vi.stubGlobal("document", { createElement: () => { throw new Error("no DOM"); } });
    setNavigator(sharer());
    expect(await saveTextFile({ name: NAME, text: TEXT })).toBe(SAVED.shared);
    expect(shared).toHaveLength(1);
  });

  // The destination is a spreadsheet and pasting is what somebody was going
  // to do anyway, so the clipboard is a real outcome rather than a failure.
  it("puts it on the clipboard when neither route exists", async () => {
    vi.stubGlobal("document", { createElement: () => { throw new Error("no DOM"); } });
    let copied = null;
    setNavigator({ clipboard: { writeText: async (t) => { copied = t; } } });
    expect(await saveTextFile({ name: NAME, text: TEXT })).toBe(SAVED.copied);
    expect(copied).toBe(TEXT);
  });

  it("says so when nothing at all worked", async () => {
    vi.stubGlobal("document", { createElement: () => { throw new Error("no DOM"); } });
    setNavigator({ clipboard: { writeText: async () => { throw new Error("denied"); } } });
    expect(await saveTextFile({ name: NAME, text: TEXT })).toBe(SAVED.failed);
  });
});

describe("on a native build", () => {
  // <a download> on a blob URL opens a blank tab inside a WKWebView and saves
  // nothing, so the OS sheet — Save to Files, Mail, AirDrop — goes first.
  it("offers the share sheet before trying to download", async () => {
    setNavigator(sharer());
    expect(await saveTextFile({ name: NAME, text: TEXT, native: true })).toBe(SAVED.shared);
    expect(clicked).toEqual([]);
    expect(shared[0].files[0].name).toBe(NAME);
  });

  // The one that must not fall through. Dismissing the sheet throws
  // AbortError, and treating that as a failure would download the file
  // somebody had just decided not to save.
  it("stops when the sheet is dismissed rather than downloading anyway", async () => {
    setNavigator(sharer(() => { const e = new Error("x"); e.name = "AbortError"; throw e; }));
    expect(await saveTextFile({ name: NAME, text: TEXT, native: true })).toBe(SAVED.cancelled);
    expect(clicked).toEqual([]);
  });

  it("downloads when the device cannot share a file", async () => {
    setNavigator({ canShare: () => false, share: async () => {} });
    expect(await saveTextFile({ name: NAME, text: TEXT, native: true })).toBe(SAVED.downloaded);
    expect(shared).toEqual([]);
  });
});

describe("savedMessage", () => {
  it("says where the file went", () => {
    expect(savedMessage(SAVED.downloaded, "Round 1")).toBe("Round 1 is in your downloads.");
    expect(savedMessage(SAVED.copied, "Round 1")).toMatch(/clipboard/);
    expect(savedMessage(SAVED.failed, "Round 1")).toBe("Couldn't export round 1.");
  });
  // The OS sheet is its own confirmation and a toast under it is noise;
  // somebody who changed their mind does not need telling they did.
  it("says nothing about a share or a change of mind", () => {
    expect(savedMessage(SAVED.shared)).toBe("");
    expect(savedMessage(SAVED.cancelled)).toBe("");
  });
});
