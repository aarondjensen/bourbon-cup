// ══════════════════════════════════════════════════════════════════
//  store-screenshots — the four screens, at the size Apple demands.
// ══════════════════════════════════════════════════════════════════
//
//   npm run shots:store                       # dry run — says what it would do
//   npm run shots:store -- --write            # drive the site and write PNGs
//
// `docs/store-submission.md` §4 names the four screens and why those four.
// This is the part that was being done by hand, one screenshot at a time, and
// redone from scratch every time a layout changed before submission.
//
// ── Why a script and not a phone ────────────────────────────────────
// Apple rejects on DIMENSIONS, not on provenance: a 6.9" iPhone screenshot is
// 1290×2796, and a browser at 430×932 with a device pixel ratio of 3 produces
// exactly that. Nothing about the file says which machine drew it.
//
// What that buys is repeatability. The listing needs new screenshots whenever
// the leaderboard or the draw changes shape, and "open four screens on a phone
// and AirDrop them" is a twenty-minute job that gets skipped, so the listing
// ends up showing a version of the app nobody is running.
//
// ── Guest mode, deliberately ────────────────────────────────────────
// All four screens are readable without an account (`src/lib/guest.js`), so
// this signs into nothing and can write nothing: every write rule in
// firestore.rules starts at `request.auth != null`, and a guest has no token.
// A screenshot run therefore cannot touch the tournament even by accident,
// which is not a promise a script driving a signed-in session could make.
//
// ── Playwright is not a devDependency ───────────────────────────────
// Same reasoning as firebase-tools in firestore.rules.test.mjs: it is a
// browser download, wanted by whoever is preparing a store listing and nobody
// else. Install it for the run and leave package.json alone:
//
//   npm i --no-save playwright
//   npx playwright install chromium
//
// ── It cannot be run from a Claude session ──────────────────────────
// Not for want of trying, and the reason is worth keeping so nobody spends an
// afternoon on it again: Chromium ships static certificate pins for
// *.googleapis.com, the sandbox re-signs TLS at its egress proxy, and every
// Firestore connection from the browser is therefore reset — while `curl` from
// the same container succeeds. The app loads and renders an empty tournament.
// See docs/store-submission.md §4.
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (f, fallback) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : fallback);

const WRITE = has("--write");
const SITE = valueOf("--url", "https://www.thebourboncup.com");
const EDITION = valueOf("--edition", "bc_2025");
const OUT = valueOf("--out", "store");
const ONLY = valueOf("--only", null);
const LIGHT = has("--light");

// ── The two stores want two different sizes ─────────────────────────
// And one set cannot serve both, which is the trap worth stating plainly:
// Apple requires 1290×2796 for the 6.9" iPhone slot, and Play refuses any
// image whose longer side is more than twice its shorter one. 2796/1290 is
// 2.17, so the size Apple DEMANDS is a size Play REFUSES. This script wrote
// Apple's set only for its first months, sitting next to a play-store.md that
// named Play's viewport — every file would have been refused at Play's upload
// screen. Both sets, every run.
//
// Sizes are CSS pixels × a device scale factor, because that is what the
// browser takes and it lands on the exact number rather than near it. Read
// Apple's required set off App Store Connect rather than trusting this line;
// Apple moves it and rejects on dimensions alone.
//
//   apple  430×932 @3 = 1290×2796  the 6.9" iPhone. 1320×2868 also accepted.
//   play   360×640 @3 = 1080×1920  Google's recommended phone size, and a 16:9
//                                  comfortably inside the 2:1 limit.
//
// `flatten` is Play's other unwritten rule: it REJECTS AN ALPHA CHANNEL, and
// the error it gives does not mention transparency. Chromium currently writes
// these opaque (3 channels) because the app paints a solid background, so the
// flatten is usually a no-op — it is here so that a screen which ever renders
// a transparent pixel cannot quietly produce a file Play refuses. Composited
// onto the app's own background, the `backgroundColor` capacitor.config.json
// gives the native shells.
const BG = "#161618";
const TARGETS = [
  { name: "apple", dir: "ios",  width: 430, height: 932, scale: 3, flatten: false },
  { name: "play",  dir: "play", width: 360, height: 640, scale: 3, flatten: true },
];
const WANTED = TARGETS.filter((t) => !ONLY || t.name === ONLY);

// The four, in the order §4 argues for them. `find` runs before the shot and
// returns false to skip — a screen that cannot be reached is reported rather
// than silently photographed as whatever was on screen before it.
const SHOTS = [
  {
    name: "01-leaderboard",
    why: "the cup total mid-round — the app in one image",
    find: async (p) => tap(p, "Leaderboard"),
  },
  {
    name: "02-scorecard",
    why: "a scorecard mid-round, hole by hole",
    // Unfolds out of a MATCH CARD on the leaderboard — `MatchCard` in
    // components/Leaderboard is one big <button> whose expansion renders the
    // same FullScorecard the Scoring tab opens.
    //
    // There is nothing distinctive to select it by: its label is whatever the
    // players happen to be called. So this opens candidates until the PAGE
    // proves one worked, which is the only test that means anything here. The
    // first version guessed a selector, clicked something harmless, returned
    // true, and the run wrote a second copy of the leaderboard with a tick
    // beside it.
    expect: /OUT/,
    find: async (p) => {
      if (!(await tap(p, "Leaderboard"))) return false;
      // Everything except the five nav buttons: clicking one of those is a
      // navigation, and the second click that is meant to collapse a card
      // cannot undo it — the run then photographs the wrong tab under the
      // right name.
      const cards = p.locator("button").filter({
        hasNotText: new RegExp(`^\\s*(${NAV.join("|")})\\s*$`, "i"),
      });
      const n = Math.min(await cards.count(), 25);
      for (let i = 0; i < n; i++) {
        const card = cards.nth(i);
        await card.click({ timeout: 3000 }).catch(() => {});
        await p.waitForTimeout(900);
        const t = await bodyText(p);
        if (/OUT/.test(t) && /MATCH\s*\d/i.test(t)) {
          // Expanding it is not the same as SEEING it. The card unfolds where
          // it sits — several hundred pixels down a board of four matches —
          // and the viewport stays at the top, so the frame is the cup total
          // again. Twice now that produced a "scorecard" screenshot that was
          // the leaderboard.
          //
          // The theme locks html/body to overflow:hidden (see CLAUDE.md), so
          // there is no page to scroll: this scrolls the app's own container,
          // which is what scrollIntoViewIfNeeded does for whatever element
          // actually holds the scroll.
          await p.locator("text=OUT").first().scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
          await p.waitForTimeout(700);
          return true;
        }
        // Not it — put the screen back before trying the next, or the run ends
        // up several taps deep inside something unrelated.
        await card.click({ timeout: 3000 }).catch(() => {});
        await p.waitForTimeout(300);
      }
      return false;
    },
  },
  {
    name: "03-matches",
    why: "the draw, tee times and groups",
    find: async (p) => tap(p, "Matches"),
  },
  {
    name: "04-career",
    why: "ten years of record — the fastest way to say this is not a weekend project",
    // The career table's column head. Without a marker this shot was the one
    // the guards could not check, and it is also the one most likely to fail:
    // the Data tab is a lazy chunk, so it is the only screen here that needs a
    // network fetch AFTER the app has loaded.
    expect: /\bPTS\b/,
    find: async (p) => {
      if (!(await tap(p, "More"))) return false;
      if (!(await tap(p, "Data"))) return false;
      await tap(p, "Player");
      return true;
    },
  },
];

const bodyText = (page) =>
  page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim());

// What to print beside the tick. The first 90 characters is the wrong answer
// for the one shot that needs checking: a match card unfolds IN PLACE on the
// leaderboard, so the top of the body is the cup total either way and the
// scorecard's readback comes out character-for-character identical to the
// leaderboard's. That reads as the very failure the `expect` guard exists to
// catch, on a run where nothing went wrong at all.
//
// So when a shot declares what makes it that screen, show THAT — the match and
// the text around it — and let the first 90 serve the shots with no marker.
const readback = (text, expect) => {
  if (!expect) return text.slice(0, 90);
  const m = expect.exec(text);
  if (!m) return text.slice(0, 90);
  const from = Math.max(0, m.index - 30);
  return `…${text.slice(from, from + 90)}…`;
};

// The bottom nav's five labels, which are also words that appear in ordinary
// copy on the screens themselves — "matches will appear here once…" is on the
// empty leaderboard. A loose text match therefore clicks a paragraph and
// reports success, and the run photographs whatever was already there.
const NAV = ["Scoring", "Matches", "Leaderboard", "Betting", "More"];

// Exact-text button first, loose text second. The nav items are buttons whose
// entire text is the label; everything else that mentions the word is prose.
const tap = async (page, label) => {
  const exact = page.locator("button").filter({ hasText: new RegExp(`^\\s*${label}\\s*$`, "i") });
  const el = (await exact.count()) ? exact.last() : page.getByText(label, { exact: false }).last();
  if (!(await el.count())) { console.log(`      ! nothing labelled "${label}"`); return false; }
  await el.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1400);
  return true;
};

if (ONLY && !WANTED.length) {
  console.error(`\n  ✖ --only ${ONLY} matches no target. Try: ${TARGETS.map((t) => t.name).join(", ")}\n`);
  process.exit(1);
}

console.log(`\n  ${SITE}`);
console.log(`  edition ${EDITION} · ${LIGHT ? "light" : "dark"} · → ${OUT}/`);
console.log(`  ${"─".repeat(58)}`);
for (const s of SHOTS) console.log(`  ${s.name}  ${s.why}`);
console.log(`  ${"─".repeat(58)}`);
for (const t of WANTED) {
  console.log(`  ${t.name.padEnd(6)} ${t.width * t.scale}×${t.height * t.scale}`
    + `  → ${OUT}/${t.dir}${t.flatten ? "  (flattened — Play refuses alpha)" : ""}`);
}
console.log(`  ${"─".repeat(58)}`);

if (!WRITE) {
  console.log("\n  Dry run. Pass --write to drive the site and save them.");
  console.log("  Needs:  npm i --no-save playwright");
  console.log("          npx playwright install chromium\n");
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });

// Imported HERE rather than at the top, so the dry run above needs neither
// playwright nor a browser download — the same reason seed-demo.mjs defers
// firebase-admin. A preview anybody can run is a preview that gets run.
let chromium, sharp;
try {
  ({ chromium } = await import("playwright"));
} catch {
  // Two lines, not one chained with `&&`: this gets pasted into Windows
  // PowerShell 5.1, where `&&` is a parser error rather than a separator.
  console.error("\n  ✖ playwright is not installed.\n"
    + "      npm i --no-save playwright\n"
    + "      npx playwright install chromium\n");
  process.exit(1);
}
// sharp IS a devDependency (store-graphics.mjs renders the feature graphic
// with it), so this only ever fails on a production install. Needed on every
// run now, not just a flattening one: it is what measures the files afterwards.
({ default: sharp } = await import("sharp"));

const browser = await chromium.launch();
const totals = [];

// One context per target rather than one resized mid-run: the app reads the
// viewport at module scope for its breakpoints, and a context reload to pick a
// new size up is the same cost as a new context without the state to untangle.
for (const t of WANTED) {
  const dir = join(OUT, t.dir);
  mkdirSync(dir, { recursive: true });
  console.log(`\n  ${t.name} · ${t.width * t.scale}×${t.height * t.scale} → ${dir}`);

  const ctx = await browser.newContext({
    viewport: { width: t.width, height: t.height },
    deviceScaleFactor: t.scale,
    isMobile: true,
    hasTouch: true,
    colorScheme: LIGHT ? "light" : "dark",
  });

  // Guest mode and the edition, set before the first line of app code runs —
  // the app reads both out of localStorage at module scope (lib/guest,
  // firebase.js), so setting them afterwards would need a reload.
  await ctx.addInitScript(({ edition, light }) => {
    localStorage.setItem("bc_guest", "1");
    localStorage.setItem("bc_active_edition", edition);
    localStorage.setItem("bc_active_edition_ns", edition === "bc_2025" ? "false" : "true");
    localStorage.setItem("bc_dark", light ? "0" : "1");
  }, { edition: EDITION, light: LIGHT });

  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("      ⚠", m.text().slice(0, 120)); });

  await page.goto(SITE, { waitUntil: "domcontentloaded" });
  // The archive chunk and a thousand hole scores arrive over several frames,
  // and a screenshot taken at first paint photographs a tournament with
  // nothing in it — which is exactly the impression the listing must not give.
  await page.waitForTimeout(6000);

  let written = 0;
  let wrong = 0;
  const seen = new Set();
  for (const s of SHOTS) {
    const ok = await s.find(page);
    if (!ok) { console.log(`  ✖ ${s.name} — could not reach it, skipped`); continue; }
    await page.waitForTimeout(600);
    const text = await bodyText(page);

    // ── Did the screen actually change? ──
    // The failure this exists for, found on the first real run: the scorecard
    // step clicked something harmless, nothing unfolded, and the run wrote a
    // byte-identical copy of the leaderboard under a second name and ticked
    // it. Four files, three screens, and the only clue was that two readback
    // lines were identical — which nobody would notice at 1am.
    //
    // Two guards, because they catch different things. `expect` is what a
    // screen must contain to BE that screen; the duplicate check covers the
    // ones with no such marker.
    // ── Is this the ErrorBoundary rather than the screen? ──
    // A lazily-loaded chunk that 404s renders `src/components/ErrorBoundary`,
    // which is a perfectly composed screenshot of the words "Something went
    // wrong". It happened on a real run: the site redeployed between this
    // script's two passes, the old hashed chunk name stopped existing, and the
    // Data tab came out as the error card — written, ticked, and 404s scrolling
    // past above it as warnings.
    //
    // Checked for EVERY shot rather than only the ones with a marker, because
    // any screen can land here and none of them should be uploaded.
    if (/Something went wrong/i.test(text) && /unexpected error/i.test(text)) {
      console.log(`  ✖ ${s.name} — the app's error screen, not the app. Re-run; if it persists,`);
      console.log("      a deploy is probably mid-flight and the chunk hashes have moved.");
      wrong++;
      continue;
    }
    if (s.expect && !s.expect.test(text)) {
      console.log(`  ✖ ${s.name} — reached it, but nothing matching ${s.expect} is on it, skipped`);
      continue;
    }
    // Compared as PIXELS, not as text. The text guard was fooled the first
    // time it mattered: the scorecard had unfolded far enough down the board
    // that the body text differed while the visible frame did not, so the
    // check passed and the file written was the leaderboard again. What goes
    // to a store is the image, so the image is what gets compared. Hashed
    // BEFORE the flatten, so the comparison is of what the browser drew.
    const shot = await page.screenshot();
    const hash = createHash("sha256").update(shot).digest("hex");
    if (seen.has(hash)) {
      console.log(`  ✖ ${s.name} — pixel-identical to a shot already taken, skipped`);
      continue;
    }
    seen.add(hash);

    const png = t.flatten ? await sharp(shot).flatten({ background: BG }).png().toBuffer() : shot;
    const file = join(dir, `${s.name}.png`);
    writeFileSync(file, png);

    // ── Measured, not assumed ──
    // Both stores reject on dimensions alone, and this used to end by telling
    // you to check them yourself with `sips` — which is macOS-only, so on the
    // Windows machine that actually builds the Play bundle the check silently
    // was not a check. The script wrote the bytes; the script can measure
    // them.
    const meta = await sharp(png).metadata();
    const want = { width: t.width * t.scale, height: t.height * t.scale };
    const size = `${meta.width}×${meta.height}`;
    if (meta.width !== want.width || meta.height !== want.height) {
      console.log(`  ✖ ${s.name}.png — ${size}, but ${t.name} wants ${want.width}×${want.height}`);
      wrong++;
      continue;
    }
    if (t.flatten && meta.hasAlpha) {
      console.log(`  ✖ ${s.name}.png — still carries an alpha channel, which Play refuses`);
      wrong++;
      continue;
    }
    console.log(`  ✔ ${s.name}.png  ${size}  ${readback(text, s.expect)}`);
    written++;
  }

  await ctx.close();
  totals.push({ t, dir, written, wrong });
}

await browser.close();

console.log("");
for (const { t, dir, written, wrong } of totals) {
  console.log(`  ${written}/${SHOTS.length} written to ${dir}`
    + `, every one measured at ${t.width * t.scale}×${t.height * t.scale}`
    + (wrong ? ` — ${wrong} REJECTED, see above` : ""));
}
console.log("");

// A run that reached nothing is a run that must not look like a success —
// the leaderboard is the one shot every listing needs and the one that proves
// the app had data in it. A file written at the wrong size is worse than a
// missing one, because it looks finished, so that fails the run too.
const missing = !totals.length || totals.some(({ dir }) => !existsSync(join(dir, "01-leaderboard.png")));
if (missing || totals.some(({ wrong }) => wrong)) process.exit(1);
