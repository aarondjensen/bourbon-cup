import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { savePhoto, saveMessage, SAVE } from "./mediaSave";

// Every one of these is a route that can silently do the wrong thing: report a
// save that never happened, or save a photo somebody just declined to save.
// The status is the only thing standing between that and the screen.

const ITEM = { mediaId: "abc123", url: "https://firebasestorage.googleapis.com/v0/b/x/o/y.jpg?alt=media&token=t" };
const blobOf = (type = "image/jpeg") => new Blob(["bytes"], { type });

let clicked;
let opened;
let winStub;

// vi.stubGlobal rather than assignment: `navigator` is a getter-only global on
// modern Node, so `globalThis.navigator = {}` throws outright.
const setNavigator = (nav) => vi.stubGlobal("navigator", nav);

beforeEach(() => {
  clicked = [];
  opened = [];
  winStub = {
    open: (...args) => { opened.push(args); return winStub.__openReturns; },
    __openReturns: {},
  };
  vi.stubGlobal("window", winStub);
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
  vi.restoreAllMocks();
});

describe("savePhoto — the share route", () => {
  it("hands the file to the OS sheet when the phone can take one", async () => {
    const shared = [];
    setNavigator({ canShare: () => true, share: async (d) => { shared.push(d); } });
    expect(await savePhoto({ item: ITEM, blob: blobOf() })).toBe(SAVE.shared);
    expect(shared[0].files[0].name).toBe("bourbon-cup-abc123.jpg");
    expect(clicked).toHaveLength(0);
  });

  it("treats a dismissed sheet as cancelled and DOES NOT download instead", async () => {
    // The bug this guards: somebody taps Save, thinks better of it, dismisses
    // the sheet — and the photo lands in their downloads anyway.
    setNavigator({
      canShare: () => true,
      share: async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; },
    });
    expect(await savePhoto({ item: ITEM, blob: blobOf() })).toBe(SAVE.cancelled);
    expect(clicked).toHaveLength(0);
    expect(opened).toHaveLength(0);
  });

  it("falls through to a download when the sheet fails for any other reason", async () => {
    setNavigator({ canShare: () => true, share: async () => { throw new Error("no handler"); } });
    expect(await savePhoto({ item: ITEM, blob: blobOf() })).toBe(SAVE.saved);
    expect(clicked).toHaveLength(1);
  });
});

describe("savePhoto — the download route", () => {
  it("downloads when there is no share sheet for files", async () => {
    setNavigator({ canShare: () => false, share: async () => {} });
    expect(await savePhoto({ item: ITEM, blob: blobOf() })).toBe(SAVE.saved);
    expect(clicked[0].download).toBe("bourbon-cup-abc123.jpg");
    expect(clicked[0].href).toBe("blob:fake");
  });

  it("works on a browser with no share API at all", async () => {
    setNavigator({});
    expect(await savePhoto({ item: ITEM, blob: blobOf() })).toBe(SAVE.saved);
  });

  it("names the file from the blob, not from the stored path", async () => {
    // A document written before the JPEG fallback existed points at a .webp
    // path while the bytes coming back are a JPEG.
    setNavigator({});
    await savePhoto({ item: { ...ITEM, url: "https://x/y.webp?alt=media" }, blob: blobOf("image/jpeg") });
    expect(clicked[0].download).toBe("bourbon-cup-abc123.jpg");
  });
});

describe("savePhoto — the open-in-a-tab last resort", () => {
  it("opens the photo when the bytes could not be fetched", async () => {
    // This is the CORS case: <img> renders fine, fetch is refused, so there is
    // no blob to share or download.
    expect(await savePhoto({ item: ITEM, blob: null })).toBe(SAVE.opened);
    expect(opened[0][0]).toBe(ITEM.url);
  });

  it("reports BLOCKED rather than claiming it opened something", async () => {
    // window.open returns null when a popup blocker eats it. Saying "opened"
    // here is a lie told to somebody staring at an unchanged screen.
    winStub.__openReturns = null;
    expect(await savePhoto({ item: ITEM, blob: null })).toBe(SAVE.blocked);
  });

  it("fails honestly on an item with no url at all", async () => {
    expect(await savePhoto({ item: {}, blob: null })).toBe(SAVE.failed);
    expect(await savePhoto({ item: null, blob: null })).toBe(SAVE.failed);
  });
});

describe("saveMessage", () => {
  it("says nothing after a share — the OS sheet is its own confirmation", () => {
    expect(saveMessage(SAVE.shared)).toBe("");
  });

  it("says nothing when somebody changed their mind", () => {
    expect(saveMessage(SAVE.cancelled)).toBe("");
  });

  it("confirms a real download", () => {
    expect(saveMessage(SAVE.saved)).toMatch(/saved/i);
  });

  it("tells somebody what to do in each degraded case", () => {
    expect(saveMessage(SAVE.opened)).toMatch(/hold/i);
    expect(saveMessage(SAVE.blocked)).toMatch(/hold/i);
    expect(saveMessage(SAVE.failed)).toMatch(/hold/i);
  });

  it("has an answer for every status, and never renders undefined", () => {
    for (const s of Object.values(SAVE)) {
      expect(typeof saveMessage(s)).toBe("string");
    }
  });

  it("stays quiet on anything it does not recognise", () => {
    // A status added later that nobody wired a sentence for should say
    // nothing, not "undefined".
    expect(saveMessage("something-new")).toBe("");
    expect(saveMessage(undefined)).toBe("");
  });
});
