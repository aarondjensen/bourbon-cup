/** @vitest-environment node */
// ── A style built at import time is a style stuck in one theme ─────
// `BC` is mutated in place (see theme.js) precisely so that every component
// sees the current palette. A module-level constant built out of it opts out
// of that: it copies the values once, at import, and paints the mode the app
// happened to start in for the rest of the session.
//
// It looks correct on every fresh load, which is how it lived here for
// months. You only see it by toggling dark/light without reloading, and then
// the Leaderboard's round header — `HEAD_TEXT`, near-white `t1` captured in
// dark — is drawn on a cream page.
//
// So this walks the source instead of waiting for somebody to notice: any
// top-level constant that mentions BC has to go through `themedStyle`, which
// re-runs its builder on every applyBCTheme. A component or a helper that
// reads BC when it is called is fine and is not matched — that IS the
// contract.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const walk = (dir) => readdirSync(dir).flatMap((entry) => {
  const full = join(dir, entry);
  if (statSync(full).isDirectory()) return walk(full);
  return /\.jsx?$/.test(entry) && !/\.test\./.test(entry) ? [full] : [];
});

// A top-level `const NAME = <expr>` and everything up to the end of it.
// Arrow functions are skipped: they evaluate per call, which is the fix.
const topLevelConsts = (src) => {
  const lines = src.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const [, name, rest] = m;
    if (/^(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(rest)) continue;
    const delta = (s) => (s.match(/[{([]/g) || []).length - (s.match(/[})\]]/g) || []).length;
    let depth = delta(rest);
    const block = [rest];
    let j = i;
    while (depth > 0 && j + 1 < lines.length) {
      j += 1;
      depth += delta(lines[j]);
      block.push(lines[j]);
    }
    out.push({ name, line: i + 1, body: block.join("\n") });
    i = j;
  }
  return out;
};

describe("theme colours are never frozen at import time", () => {
  it("has no top-level constant that captures BC outside themedStyle", () => {
    const offenders = [];
    for (const file of walk("src")) {
      // theme.js is where the palette is built; it is the one file whose
      // top-level constants are allowed to name colours.
      if (file.endsWith(`theme.js`)) continue;
      const src = readFileSync(file, "utf8");
      if (!src.includes("BC.")) continue;
      for (const { name, line, body } of topLevelConsts(src)) {
        if (!/\bBC\.\w+/.test(body)) continue;
        if (body.includes("themedStyle(")) continue;
        offenders.push(`${file}:${line} ${name}`);
      }
    }
    // Every entry here paints one theme for the life of the session. Wrap it
    // in themedStyle, or make it a function if it is a bare string.
    expect(offenders).toEqual([]);
  });
});
