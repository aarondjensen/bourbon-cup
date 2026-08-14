// ══════════════════════════════════════════════════════════════════
//  store-graphics — the Play listing's feature graphic.
// ══════════════════════════════════════════════════════════════════
//
//   npm run build:store-graphics
//
// Play requires a 1024×500 feature graphic and will not publish a listing
// without one. It is the only store asset this repo did not already have:
// the 512×512 icon is `public/favicon/web-app-manifest-512x512.png`, and the
// App Store's icon comes out of `scripts/ios-icons.mjs`.
//
// Everything here is composed from things the app already owns — the mark in
// `public/BC ICON-01.svg` and the two gradient stops inside it — so the
// graphic cannot drift away from the icon sitting next to it in the listing.
//
// ── The font ────────────────────────────────────────────────────────
// Montserrat, because that is `FONT` in src/theme.js and a listing set in
// something else reads as a different product. It is NOT vendored: it has to
// be installed on the machine for the renderer to find it by name, which is a
// system-level thing a repo cannot do for you.
//
//   curl the ttf from the Google Fonts css2 endpoint into ~/.fonts, fc-cache -f
//
// Without it this falls back to a local grotesque and SAYS SO, rather than
// rendering something subtly off-brand and letting it reach the store. The
// committed PNG under `store/` was rendered with the real thing.
import sharp from "sharp";
import { readFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";

const OUT_DIR = "store";
const OUT = `${OUT_DIR}/play-feature-graphic.png`;
const W = 1024, H = 500;

// The icon's own two stops, read out of the SVG rather than retyped, so
// recolouring the mark recolours this too.
const svg = readFileSync("public/BC ICON-01.svg", "utf8");
const stops = [...svg.matchAll(/stop-color="(#[0-9a-fA-F]{6})"/g)].map(m => m[1]);
const [FROM, TO] = stops.length >= 2 ? stops : ["#00a839", "#0077d8"];

const hasMontserrat = (() => {
  try { return execSync("fc-list", { encoding: "utf8" }).toLowerCase().includes("montserrat"); }
  catch { return false; }
})();
const FAMILY = hasMontserrat ? "Montserrat" : "Liberation Sans";
if (!hasMontserrat) {
  console.warn("⚠ Montserrat is not installed — falling back to Liberation Sans.");
  console.warn("  The committed store/play-feature-graphic.png was rendered WITH Montserrat.");
  console.warn("  Install it before regenerating, or the listing goes off-brand. See the header of this file.");
}

// The mark, rendered on its own and composited rather than inlined into the
// SVG below: the source has its own <defs> and gradient ids, and pasting two
// documents together makes those ids collide with the background's.
//
// CORNER-ROUNDED, and that is not decoration. The mark is a full-bleed square
// whose gradient is close to the background's own, so pasted flat it reads as
// a mis-cut rectangle rather than as anything intentional. Rounded to the
// proportion iOS and Android both mask an icon to, it reads as what it is:
// the app's icon, sitting next to the app's name. The repo's other trophy
// silhouettes would composite without a tile at all, but they are a DIFFERENT
// trophy from the one on the icon — and the icon is what sits beside this
// graphic in the listing.
const MARK = 300;
const RADIUS = Math.round(MARK * 0.225);
const mask = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${MARK}" height="${MARK}">` +
  `<rect width="${MARK}" height="${MARK}" rx="${RADIUS}" ry="${RADIUS}" fill="#fff"/></svg>`
);
const mark = await sharp("public/BC ICON-01.svg", { density: 1200 })
  .resize(MARK, MARK)
  .composite([{ input: mask, blend: "dest-in" }])
  .png()
  .toBuffer();

// Play crops and overlays this at several sizes, so nothing that has to be
// read sits near an edge — hence the generous left inset and the type block
// stopping well short of the right.
const background = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="${W}" y2="${H}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${FROM}"/>
      <stop offset="1" stop-color="${TO}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <g font-family="${FAMILY}" fill="#ffffff">
    <text x="410" y="212" font-size="62" font-weight="800" letter-spacing="1">THE BOURBON</text>
    <text x="410" y="286" font-size="62" font-weight="800" letter-spacing="1">CUP</text>
    <rect x="412" y="318" width="86" height="5" rx="2.5" fill="#ffffff" opacity="0.85"/>
    <text x="410" y="374" font-size="25" font-weight="600" letter-spacing="3.2" opacity="0.92">MATCH PLAY · SINCE 2016</text>
  </g>
</svg>`;

mkdirSync(OUT_DIR, { recursive: true });
await sharp(Buffer.from(background))
  .composite([{ input: mark, top: (H - MARK) / 2, left: 84 }])
  .flatten({ background: FROM })
  .removeAlpha()
  .png({ compressionLevel: 9 })
  .toFile(`${OUT}.tmp`);

const { renameSync } = await import("node:fs");
renameSync(`${OUT}.tmp`, OUT);

const { width, height } = await sharp(OUT).metadata();
// Play rejects on dimensions, exactly. Loud here beats a Console error later.
if (width !== W || height !== H) throw new Error(`feature graphic is ${width}x${height}, Play wants ${W}x${H}`);
console.log(`${OUT} — ${width}x${height}, ${FAMILY}, ${FROM} → ${TO}`);
