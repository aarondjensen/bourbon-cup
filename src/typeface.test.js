// ══════════════════════════════════════════════════════════════════
//  The typeface has to be there before the first frame, not after it
// ══════════════════════════════════════════════════════════════════
//
// Montserrat used to arrive as a <link> to fonts.googleapis.com that theme.js
// appended at import time. That is four hops behind the first paint — fetch
// the bundle, evaluate it, fetch Google's CSS, fetch the woff2 off a third
// origin — and with `display: swap` the app painted in the system sans for all
// of it and re-lettered when the font landed.
//
// On the splash that is the largest type in the app changing shape under you,
// which is what it was reported as: "The Bourbon Cup 20XX in two different
// font formats", read as two screens rather than as one font arriving late.
//
// The fix is entirely about WHEN the browser can find out, so this test is
// about the same thing. It is not checking that the app uses Montserrat — the
// screens do that by rendering. It is checking that the declaration is
// somewhere the preload scanner reaches, and that nobody has quietly put the
// CDN back.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const HTML = readFileSync("index.html", "utf8");
const THEME = readFileSync("src/theme.js", "utf8");

// Both files explain in prose why the CDN is gone, and the check below is for
// a live reference rather than for the word. Stripping the commentary first is
// what lets the note stay readable without tripping its own test.
const CODE = (src, ...comments) =>
  comments.reduce((acc, re) => acc.replace(re, ""), src);
const HTML_CODE = CODE(HTML, /<!--[\s\S]*?-->/g);
const THEME_CODE = CODE(THEME, /\/\*[\s\S]*?\*\//g, /^\s*\/\/.*$/gm);

// Latin alone is preloaded. latin-ext is declared so an accented name renders
// in the same face as the one beside it, but it is unicode-range'd and a
// tournament in Michigan will not normally fetch it — preloading it would be
// 68 KB spent on the cold start for a glyph nobody types.
const PRELOADED = "/fonts/montserrat-latin-var.woff2";

describe("the typeface", () => {
  it("is declared in the document, not injected by script", () => {
    expect(HTML).toContain("@font-face");
    expect(HTML).toContain(PRELOADED);
    expect(HTML).toContain("/fonts/montserrat-latin-ext-var.woff2");
  });

  it("is preloaded, with crossorigin", () => {
    const tag = HTML.match(/<link[^>]*rel="preload"[^>]*>/);
    expect(tag).toBeTruthy();
    expect(tag[0]).toContain(`href="${PRELOADED}"`);
    expect(tag[0]).toContain('as="font"');
    // Not optional even though the file is same-origin: fonts are fetched in
    // CORS mode, and a preload whose mode disagrees with the use is discarded
    // and fetched a second time.
    expect(tag[0]).toContain("crossorigin");
  });

  it("is not fetched from a CDN by anybody", () => {
    // The whole point. A stylesheet on another origin cannot be started until
    // this one has been parsed, and one appended by JavaScript cannot be
    // started until the bundle has run.
    expect(HTML_CODE).not.toContain("fonts.googleapis.com");
    expect(THEME_CODE).not.toContain("fonts.googleapis.com");
    expect(THEME_CODE).not.toContain("fonts.gstatic.com");
  });

  it("is same-origin, which is what lets the service worker hold it", () => {
    // public/sw-cache-rules.js bypasses every cross-origin request, so the
    // Google-hosted font was never on disk: an installed app cold-starting out
    // of range did without its typeface entirely. Same-origin woff2 matches
    // the cache-first rule there.
    const rules = readFileSync("public/sw-cache-rules.js", "utf8");
    expect(rules).toContain("woff2");
    expect(PRELOADED.startsWith("/")).toBe(true);
  });

  it("still keeps the family string in one place", () => {
    expect(THEME).toContain(`export const FONT = "'Montserrat', sans-serif";`);
  });
});
