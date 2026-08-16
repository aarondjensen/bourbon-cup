// ══════════════════════════════════════════════════════════════════
//  Every name destructured from a dynamic import must actually exist
// ══════════════════════════════════════════════════════════════════
//
// `const { a, b } = await import("./x")` is NOT checked by anything. A static
// `import { a } from "./x"` is — eslint's import plugin and the bundler both
// resolve it — but the dynamic form resolves at runtime, so a name that was
// never exported becomes `undefined` silently, and calling it throws only on
// the line that calls it.
//
// That shipped. `deleteAccount` destructured `clearCachedSubscriptionStatus`
// from lib/notifications, which had never been written. The TypeError rejected
// the deletion outside its own try/catch, Delete Account sat on "Deleting…"
// forever, and the account survived — on every platform, not just native.
// Account deletion is required by both app stores, so the first person to
// find it would plausibly have been a reviewer.
//
// Dynamic imports are used deliberately here — they keep firebase/messaging,
// firebase/functions and the media pipeline off the critical path for a
// leaderboard — so the answer is not to stop using them. It is to check them.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const SRC = "src";

const walk = (dir) => readdirSync(dir).flatMap((entry) => {
  const p = join(dir, entry);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const sourceFiles = walk(SRC).filter((f) => /\.jsx?$/.test(f) && !/\.test\.jsx?$/.test(f));

// `const { a, b } = await import("./x")`, capturing the names and the path.
const DESTRUCTURED_IMPORT = /const\s*\{([^}]+)\}\s*=\s*await\s+import\(\s*["'](\.[^"']+)["']\s*\)/g;

// Resolve a relative specifier the way the bundler would.
const resolveModule = (fromFile, spec) => {
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [`${base}.js`, `${base}.jsx`, join(base, "index.js")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

// `export const X`, `export function X`, `export async function X`,
// `export let/class X`, and the `export { X }` / `export { Y as X }` list form.
const exportsName = (source, name) => {
  const declared = new RegExp(
    `export\\s+(?:async\\s+)?(?:const|let|var|function|class)\\s+${name}\\b`
  );
  if (declared.test(source)) return true;

  for (const [, list] of source.matchAll(/export\s*\{([^}]+)\}/g)) {
    const exported = list.split(",").map((part) => {
      const bits = part.trim().split(/\s+as\s+/);
      return (bits[1] || bits[0] || "").trim();
    });
    if (exported.includes(name)) return true;
  }
  return false;
};

describe("dynamic import destructures", () => {
  it("finds some, so this test is not silently vacuous", () => {
    const found = sourceFiles.flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(DESTRUCTURED_IMPORT)]
    );
    expect(found.length).toBeGreaterThan(0);
  });

  it("only name exports that exist in the target module", () => {
    const missing = [];

    for (const file of sourceFiles) {
      const source = readFileSync(file, "utf8");
      for (const [, names, spec] of source.matchAll(DESTRUCTURED_IMPORT)) {
        const target = resolveModule(file, spec);
        // Not resolvable inside src (a bare package, or a path this crude
        // resolver does not model) — out of scope rather than a failure.
        if (!target) continue;

        const targetSource = readFileSync(target, "utf8");
        for (const raw of names.split(",")) {
          // `{ a: b }` renames on destructure; the SOURCE name is what has to
          // be exported.
          const name = raw.trim().split(":")[0].trim();
          if (!name || name === "default") continue;
          if (!exportsName(targetSource, name)) {
            missing.push(`${file} imports { ${name} } from "${spec}" — not exported by ${target}`);
          }
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
