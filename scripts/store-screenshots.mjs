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
//   npm i --no-save playwright && npx playwright install chromium
//
// ── It cannot be run from a Claude session ──────────────────────────
// Not for want of trying, and the reason is worth keeping so nobody spends an
// afternoon on it again: Chromium ships static certificate pins for
// *.googleapis.com, the sandbox re-signs TLS at its egress proxy, and every
// Firestore connection from the browser is therefore reset — while `curl` from
// the same container succeeds. The app loads and renders an empty tournament.
// See docs/store-submission.md §4.
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (f, fallback) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : fallback);

const WRITE = has("--write");
const SITE = valueOf("--url", "https://www.thebourboncup.com");
const EDITION = valueOf("--edition", "bc_2025");
const OUT = valueOf("--out", "store/ios");
const LIGHT = has("--light");

// Apple's 6.9" iPhone slot. 430×932 is the CSS viewport of an iPhone 16 Pro
// Max; ×3 is its device pixel ratio. The other accepted size is 1320×2868 —
// read the required set off App Store Connect rather than trusting this line,
// because Apple moves it and rejects on dimensions alone.
const VIEWPORT = { width: 430, height: 932 };
const SCALE = 3;
const EXPECT = { width: VIEWPORT.width * SCALE, height: VIEWPORT.height * SCALE };

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
        if (/OUT/.test(t) && /MATCH\s*\d/i.test(t)) return true;
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

console.log(`\n  ${SITE}`);
console.log(`  edition ${EDITION} · ${LIGHT ? "light" : "dark"} · ${EXPECT.width}×${EXPECT.height} · → ${OUT}`);
console.log(`  ${"─".repeat(58)}`);
for (const s of SHOTS) console.log(`  ${s.name}  ${s.why}`);
console.log(`  ${"─".repeat(58)}`);

if (!WRITE) {
  console.log("\n  Dry run. Pass --write to drive the site and save them.");
  console.log("  Needs:  npm i --no-save playwright && npx playwright install chromium\n");
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });

// Imported HERE rather than at the top, so the dry run above needs neither
// playwright nor a browser download — the same reason seed-demo.mjs defers
// firebase-admin. A preview anybody can run is a preview that gets run.
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("\n  ✖ playwright is not installed.\n"
    + "      npm i --no-save playwright && npx playwright install chromium\n");
  process.exit(1);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: SCALE,
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
// The archive chunk and a thousand hole scores arrive over several frames, and
// a screenshot taken at first paint photographs a tournament with nothing in
// it — which is exactly the impression the listing must not give.
await page.waitForTimeout(6000);

let written = 0;
const seen = new Set();
for (const s of SHOTS) {
  const ok = await s.find(page);
  if (!ok) { console.log(`  ✖ ${s.name} — could not reach it, skipped`); continue; }
  await page.waitForTimeout(600);
  const text = await bodyText(page);

  // ── Did the screen actually change? ──
  // The failure this exists for, found on the first real run: the scorecard
  // step clicked something harmless, nothing unfolded, and the run wrote a
  // byte-identical copy of the leaderboard under a second name and ticked it.
  // Four files, three screens, and the only clue was that two readback lines
  // were identical — which nobody would notice at 1am.
  //
  // Two guards, because they catch different things. `expect` is what a screen
  // must contain to BE that screen; the duplicate check covers the ones with
  // no such marker.
  if (s.expect && !s.expect.test(text)) {
    console.log(`  ✖ ${s.name} — reached it, but nothing matching ${s.expect} is on it, skipped`);
    continue;
  }
  if (seen.has(text.slice(0, 400))) {
    console.log(`  ✖ ${s.name} — identical to a shot already taken, skipped`);
    continue;
  }
  seen.add(text.slice(0, 400));

  const path = join(OUT, `${s.name}.png`);
  await page.screenshot({ path });
  console.log(`  ✔ ${s.name}.png  ${text.slice(0, 90)}`);
  written++;
}

await browser.close();

console.log(`\n  ${written}/${SHOTS.length} written to ${OUT}`);
if (written) {
  console.log(`  Check each one is ${EXPECT.width}×${EXPECT.height} before uploading — Apple rejects on size alone:`);
  console.log(`      sips -g pixelWidth -g pixelHeight ${OUT}/*.png\n`);
}
if (!existsSync(join(OUT, "01-leaderboard.png"))) process.exit(1);
