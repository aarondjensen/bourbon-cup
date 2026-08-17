import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ══════════════════════════════════════════════════════════════════
//  platform — what the web must keep doing, and what native changes.
// ══════════════════════════════════════════════════════════════════
//
// The whole safety argument for shipping an iOS build is that not one line of
// it changes the browser. The web app and the Android TWA are what the field
// actually uses; the iOS build does not exist on anybody's phone yet. So the
// tests that matter most here are the ones asserting a NO-OP.
//
// `isNativePlatform` is mocked rather than stubbed on a global, because it is
// what @capacitor/core reads and what every branch in the module hangs off.
// The module is re-imported per test with `vi.resetModules()` — API_BASE is
// computed once at module load, so a shared import could only ever test one
// platform.
const mockPlatform = (native, name = native ? "ios" : "web") => {
  vi.doMock("@capacitor/core", () => ({
    Capacitor: {
      isNativePlatform: () => native,
      getPlatform: () => name,
    },
  }));
};

const load = async () => import("./platform");

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.doUnmock("@capacitor/core"); vi.unstubAllGlobals(); });

describe("which platform this is", () => {
  it("is not native in a browser", async () => {
    mockPlatform(false);
    const { isNative, isNativeIOS, platformName } = await load();
    expect(isNative()).toBe(false);
    expect(isNativeIOS()).toBe(false);
    expect(platformName()).toBe("web");
  });

  it("is native, and iOS, inside the app", async () => {
    mockPlatform(true, "ios");
    const { isNative, isNativeIOS, platformName } = await load();
    expect(isNative()).toBe(true);
    expect(isNativeIOS()).toBe(true);
    expect(platformName()).toBe("ios");
  });

  it("answers 'not native' rather than throwing when the runtime is absent", async () => {
    // A test environment, a server render, a build step — anything that
    // evaluates this module without a Capacitor global. Throwing here would
    // take down whatever imported it, and the honest answer is "a browser".
    vi.doMock("@capacitor/core", () => ({
      Capacitor: {
        isNativePlatform: () => { throw new Error("no runtime"); },
        getPlatform: () => { throw new Error("no runtime"); },
      },
    }));
    const { isNative, platformName } = await load();
    expect(isNative()).toBe(false);
    expect(platformName()).toBe("web");
  });
});

describe("where /api lives", () => {
  it("stays relative on the web, so the same-origin call is unchanged", async () => {
    // This is the assertion that protects production. `/api/ghin` has always
    // been same-origin — Vercel in production, the vite proxy in dev — and
    // prefixing it with anything at all would break both.
    mockPlatform(false);
    const { API_BASE, apiUrl } = await load();
    expect(API_BASE).toBe("");
    expect(apiUrl("/api/ghin?search=jensen")).toBe("/api/ghin?search=jensen");
    expect(apiUrl("/api/courses2?search=treetops")).toBe("/api/courses2?search=treetops");
  });

  it("goes absolute on native, at the CANONICAL host", async () => {
    // Under capacitor://localhost a relative /api path resolves INSIDE the
    // app bundle and 404s — not as a network error, which is what makes it
    // hard to recognise on a phone.
    //
    // The `www.` is the load-bearing half and it was missing. The apex 307s to
    // the canonical host; `fetch` follows a redirect happily, but a
    // CROSS-ORIGIN fetch applies CORS to every hop, and Vercel's domain
    // redirect carries no Access-Control-Allow-Origin. So the request died on
    // the first hop and never reached the handler — every course search and
    // every GHIN lookup, on every phone, came back empty, while the same call
    // worked perfectly on the web where nothing redirects.
    mockPlatform(true);
    const { API_BASE, apiUrl } = await load();
    expect(API_BASE).toBe("https://www.thebourboncup.com");
    expect(apiUrl("/api/ghin?search=jensen"))
      .toBe("https://www.thebourboncup.com/api/ghin?search=jensen");
  });

  it("still lets a device build be pointed at `vercel dev`", async () => {
    // The reason the base is a variable at all: `api/*.js` cannot be exercised
    // from a phone any other way, because the deployed function is the one a
    // relative call reaches.
    mockPlatform(true);
    vi.stubEnv("VITE_API_BASE", "http://192.168.1.20:3000");
    try {
      const { apiUrl } = await load();
      expect(apiUrl("/api/courses?search=oak"))
        .toBe("http://192.168.1.20:3000/api/courses?search=oak");
    } finally { vi.unstubAllEnvs(); }
  });

  it("keeps the query string and the leading slash exactly as the call site wrote them", async () => {
    mockPlatform(true);
    const { apiUrl } = await load();
    // The call sites were changed by wrapping, not by rewriting: whatever
    // they built before is what must come out the other side.
    const q = "/api/ghin?search=a%20b&state=MI";
    expect(apiUrl(q).endsWith(q)).toBe(true);
  });
});

describe("leaving the app", () => {
  it("uses window.open on the web and loads no plugin", async () => {
    mockPlatform(false);
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    const { openExternal } = await load();
    await openExternal("https://vrbo.com/1234");
    expect(open).toHaveBeenCalledWith("https://vrbo.com/1234", "_blank", "noopener,noreferrer");
  });

  it("does nothing at all without a url", async () => {
    mockPlatform(false);
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    const { openExternal } = await load();
    await openExternal("");
    await openExternal(null);
    expect(open).not.toHaveBeenCalled();
  });

  it("swallows a blocked popup rather than rejecting", async () => {
    // The caller is an onClick. An unhandled rejection there is a console
    // error on somebody's phone and nothing else.
    mockPlatform(false);
    vi.stubGlobal("window", { open: () => { throw new Error("blocked"); } });
    const { openExternal } = await load();
    await expect(openExternal("https://vrbo.com/1234")).resolves.toBeUndefined();
  });
});

describe("the native-only side effects", () => {
  it("are all no-ops on the web, and none of them throw", async () => {
    // tapFeedback fires on every score tap and applyNativeChrome on every
    // theme flip. Both run in the browser hundreds of times a round and must
    // cost nothing and break nothing.
    mockPlatform(false);
    const { tapFeedback, commitFeedback, applyNativeChrome } = await load();
    expect(() => tapFeedback()).not.toThrow();
    expect(() => commitFeedback()).not.toThrow();
    await expect(applyNativeChrome(true)).resolves.toBeUndefined();
    await expect(applyNativeChrome(false)).resolves.toBeUndefined();
  });

  it("return synchronously rather than handing the caller a promise to await", async () => {
    // A score must post whether or not the taptic engine answered, so these
    // are deliberately fire-and-forget. If either started returning a promise
    // somebody would eventually await it on the write path.
    mockPlatform(true);
    const { tapFeedback, commitFeedback } = await load();
    expect(tapFeedback()).toBeUndefined();
    expect(commitFeedback()).toBeUndefined();
  });
});
