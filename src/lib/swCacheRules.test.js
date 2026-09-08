/**
 * The caching worker's routing table.
 *
 * A service worker cannot be imported by a test — it needs a ServiceWorker
 * global scope that does not exist in node. public/sw-cache-rules.js is
 * written so that the DECISION is a pure function on a plain object, and the
 * listener wiring is skipped when there is nothing to attach to. So the file
 * is loaded here as text and evaluated against a fake `self`, which exercises
 * the real rules rather than a copy of them.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";

let routeFor, entriesToEvict, SHELL_CACHE, ASSET_CACHE;

beforeAll(() => {
  const src = readFileSync(new URL("../../public/sw-cache-rules.js", import.meta.url), "utf8");
  // No addEventListener and no caches on this scope, so the file registers its
  // rules and returns before touching either.
  const fake = { location: { origin: "https://thebourboncup.com" } };
  new Function("self", src)(fake);
  ({ routeFor, entriesToEvict, SHELL_CACHE, ASSET_CACHE } = fake.BC_CACHE_RULES);
});

const route = (o) => routeFor({ method: "GET", sameOrigin: true, ...o });

describe("routeFor", () => {
  it("never touches a write", () => {
    expect(route({ method: "POST", pathname: "/" })).toBe("bypass");
  });

  it("leaves Firestore and every other origin alone", () => {
    // Firestore does its own far better caching underneath us.
    expect(route({ sameOrigin: false, pathname: "/v1/projects/x" })).toBe("bypass");
  });

  it("holds the app document, so a cold start out of range opens", () => {
    expect(route({ pathname: "/", mode: "navigate" })).toBe("network-first");
    expect(route({ pathname: "/index.html" })).toBe("network-first");
  });

  it("does NOT answer the update check from a cache", () => {
    // hasNewBundle asks with no-store precisely to get the truth. Answer it
    // from disk and an installed app loses its only way to pick up a deploy.
    expect(route({ pathname: "/index.html", cacheMode: "no-store" })).toBe("bypass");
    expect(route({ pathname: "/", cacheMode: "reload" })).toBe("bypass");
  });

  it("never holds the worker or the manifest", () => {
    // A stale worker is the one mistake with no way back on a device that has
    // no address bar.
    expect(route({ pathname: "/firebase-messaging-sw.js" })).toBe("bypass");
    expect(route({ pathname: "/sw-cache-rules.js" })).toBe("bypass");
    expect(route({ pathname: "/favicon/site.webmanifest" })).toBe("bypass");
  });

  it("does not store the legal pages as the app shell", () => {
    // They are separate documents that happen to be same-origin. Stored under
    // the shell key, one of them would be served AS the app on the next
    // launch out of range.
    expect(route({ pathname: "/privacy.html", mode: "navigate" })).toBe("bypass");
    expect(route({ pathname: "/account-deletion.html", mode: "navigate" })).toBe("bypass");
    expect(route({ pathname: "/app/index.html", mode: "navigate" })).toBe("bypass");
  });

  it("keeps hashed build output, which can never go stale", () => {
    expect(route({ pathname: "/assets/index-D8MGSCxi.js" })).toBe("cache-first");
    expect(route({ pathname: "/assets/theme-C_HpgY7a.js" })).toBe("cache-first");
  });

  it("keeps the pinned images and icons", () => {
    expect(route({ pathname: "/favicon/favicon.svg" })).toBe("cache-first");
    expect(route({ pathname: "/trophy_photo.png" })).toBe("cache-first");
    expect(route({ pathname: "/app/app-store-badge.svg" })).toBe("cache-first");
  });

  it("leaves anything it was not told about alone, rather than guessing", () => {
    expect(route({ pathname: "/legal.css" })).toBe("bypass");
    expect(route({ pathname: "/api/ghin" })).toBe("bypass");
  });
});

describe("entriesToEvict", () => {
  it("drops nothing while under the cap", () => {
    expect(entriesToEvict(["a", "b"], 5)).toEqual([]);
  });
  it("drops the oldest first, which is the front of Cache.keys()", () => {
    expect(entriesToEvict(["a", "b", "c", "d"], 2)).toEqual(["a", "b"]);
  });
  it("survives an empty or missing list", () => {
    expect(entriesToEvict(undefined, 2)).toEqual([]);
  });
});

describe("cache names", () => {
  it("are versioned, so a rule change drops the old pile", () => {
    expect(SHELL_CACHE).toMatch(/^bc-.*-v\d+$/);
    expect(ASSET_CACHE).toMatch(/^bc-.*-v\d+$/);
    expect(SHELL_CACHE).not.toBe(ASSET_CACHE);
  });
});
