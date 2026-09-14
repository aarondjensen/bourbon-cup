// ══════════════════════════════════════════════════════════════════
//  app-icons — every launcher icon, on both platforms, from one mark.
// ══════════════════════════════════════════════════════════════════
//
//   npm run build:app-icons
//
// `cap add ios` AND `cap add android` both seed their icon slots with
// CAPACITOR'S OWN LOGO — a blue X on white — and on both platforms it looks
// close enough to a real icon in the tooling that it ships. A build carrying it
// reaches TestFlight or a tester's home screen looking like somebody else's
// app. This is the script that makes that impossible to forget: run it after
// either `cap add`, or after the mark changes, and the diff shows what moved.
//
// The source is `public/BC ICON-01.svg`, which is the same artwork the PWA
// and the Play listing already use — rendered rather than upscaled, because
// the largest raster in the repo is 512px and the App Store wants 1024.
//
// Two things Apple is strict about and this handles:
//
//   • THE ICON MAY NOT HAVE AN ALPHA CHANNEL. Not "may not be transparent" —
//     the upload is rejected for the channel being present, even when every
//     pixel in it is opaque. `removeAlpha` after `flatten` is what guarantees
//     three channels come out.
//   • The icon is 1024×1024 exactly, and it is the ONLY size in the catalog
//     now; Xcode derives the rest at build time.
//
// The splash is a 2732×2732 square because iOS crops it to whatever the
// screen is, in either orientation — so the mark sits well inside it rather
// than filling it, or it loses its edges on a phone.
import sharp from "sharp";
import { rename, mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";

const SVG = "public/BC ICON-01.svg";
const ICON = "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png";
const ANDROID_RES = "android/app/src/main/res";

// Android's five density buckets, in dp-independent pixels for a 48dp icon.
const DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const SPLASH_DIR = "ios/App/App/Assets.xcassets/Splash.imageset/";
// Xcode names these by scale factor (1x/2x/3x) and Capacitor generates all
// three at the same size. Same image in each: the launch screen is one mark
// on one background, and there is nothing for a higher scale to add.
const SPLASHES = ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"];

// The app's own background, so the launch image and the first painted frame
// are the same colour and the handoff is invisible. Kept in step with
// `backgroundColor` in capacitor.config.json and BC.bg in src/theme.js — it
// had drifted to #161618 while both of those said #0a0a0b, which is a seam
// you see rather than measure: the launch image lightens a shade at the
// moment the web view takes over.
const APP_BG = "#0a0a0b";
const ICON_BG = "#0a0a0b";

// Written to a temp name and renamed, so an interrupted run cannot leave a
// half-written PNG in the asset catalog — which Xcode reports as a corrupt
// catalog rather than as a missing icon.
const writeAtomic = async (pipeline, path) => {
  await pipeline.png({ compressionLevel: 9 }).toFile(`${path}.tmp`);
  await rename(`${path}.tmp`, path);
};

// Density well above the default: the source is a 120-unit viewBox, and
// rasterising it at its nominal size and scaling up would throw away
// everything the vector was for.
const render = (size) => sharp(SVG, { density: 1200 }).resize(size, size);

// The same artwork with its gradient panel and its long shadow switched off,
// leaving the white trophy on transparency. Done by rewriting two rules in the
// source rather than by keeping a second file, so the two can never drift:
// `.cls-2` is the gradient rect and `.cls-5` is the shadow group at 25%.
const markOnly = Buffer.from(
  readFileSync(SVG, "utf8")
    .replace(/\.cls-2\s*\{[^}]*\}/, ".cls-2 { fill: none; }")
    .replace(/\.cls-5\s*\{[^}]*\}/, ".cls-5 { opacity: 0; }")
);

await writeAtomic(
  render(1024).flatten({ background: ICON_BG }).removeAlpha(),
  ICON
);

const mark = await render(820).png().toBuffer();
for (const name of SPLASHES) {
  await writeAtomic(
    sharp({ create: { width: 2732, height: 2732, channels: 3, background: APP_BG } })
      .composite([{ input: mark, gravity: "centre" }])
      .removeAlpha(),
    SPLASH_DIR + name
  );
}

// ── The Android launch screen ───────────────────────────────────────
// Same mark, same ground, and it is here for the reason at the top of this
// file: `cap add android` seeds THESE too, and it seeds them with the blue X
// on WHITE. iOS was being regenerated and Android was not, so the repo shipped
// one platform's launch screen as the app and the other's as Capacitor's —
// and on Android the white is the loud part, because it flashes in front of a
// near-black app.
//
// Eleven files rather than one because a bitmap used as a window background is
// STRETCHED to the window, with no aspect ratio kept. That is what the
// port/land split and the density buckets are for: each bucket is already
// close to the shape of the screens that ask for it, so the mark arrives
// roughly square instead of pulled. It is sized off the SHORTER edge for the
// same reason — 30% of it, which is the proportion the iOS square uses.
//
// Android 12 and up mostly do not reach these: `Theme.SplashScreen` draws the
// adaptive launcher icon over `windowSplashScreenBackground` instead, which is
// why values/splash_background.xml is written below. These are what everything
// older still uses, and they are what `android:background` on the launch theme
// points at.
const ANDROID_SPLASHES = {
  "drawable": [480, 320],
  "drawable-land-mdpi": [480, 320],
  "drawable-land-hdpi": [800, 480],
  "drawable-land-xhdpi": [1280, 720],
  "drawable-land-xxhdpi": [1600, 960],
  "drawable-land-xxxhdpi": [1920, 1280],
  "drawable-port-mdpi": [320, 480],
  "drawable-port-hdpi": [480, 800],
  "drawable-port-xhdpi": [720, 1280],
  "drawable-port-xxhdpi": [960, 1600],
  "drawable-port-xxxhdpi": [1280, 1920],
};

for (const [bucket, [w, h]] of Object.entries(ANDROID_SPLASHES)) {
  const dir = `${ANDROID_RES}/${bucket}`;
  await mkdir(dir, { recursive: true });
  const size = Math.round(Math.min(w, h) * 0.3);
  const art = await render(size).png().toBuffer();
  await writeAtomic(
    sharp({ create: { width: w, height: h, channels: 3, background: APP_BG } })
      .composite([{ input: art, gravity: "centre" }])
      .removeAlpha(),
    `${dir}/splash.png`
  );
}


// ── Android ─────────────────────────────────────────────────────────
// Three slots per density, and the third one has a rule worth knowing.
//
//   ic_launcher            the legacy square, pre-Android-8 launchers
//   ic_launcher_round      the legacy circle, for launchers that ask for one
//   ic_launcher_foreground the ADAPTIVE layer, and the fussy one
//
// An adaptive icon is 108dp of canvas of which the launcher may mask away
// everything outside the central 72dp — and it animates within that margin,
// so the outer ring is genuinely reachable at rest and genuinely gone under a
// circle mask. Artwork drawn edge to edge therefore loses its corners on some
// phones and not others. The mark is scaled to 62% of the canvas and centred,
// which sits inside the 66.6% safe zone with a little room rather than exactly
// on the line.
//
// The background is a flat colour (values/ic_launcher_background.xml), not a
// second image, because the mark's own gradient already carries the identity
// and two gradients fighting through a mask reads as a mistake.
// The gradient's own midpoint, computed once and written down: #00a839 and
// #0077d8 average to this. The adaptive BACKGROUND has to be a flat colour —
// it is a <color> resource, not an image — so the mark cannot bring its
// gradient with it, and a background sampled from the middle of that gradient
// is the closest a flat fill gets to the icon everywhere else.
const ANDROID_BG = "#008f88";

const circleMask = (size) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
  `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`
);

for (const [density, px] of Object.entries(DENSITIES)) {
  const dir = `${ANDROID_RES}/mipmap-${density}`;
  await mkdir(dir, { recursive: true });

  // Square: the full mark, flattened — a legacy launcher icon has no mask.
  await writeAtomic(render(px).flatten({ background: ICON_BG }), `${dir}/ic_launcher.png`);

  // Round: the same square clipped to a circle, alpha kept so the launcher
  // sees the corners as transparent rather than as black.
  await writeAtomic(
    render(px).flatten({ background: ICON_BG })
      .composite([{ input: circleMask(px), blend: "dest-in" }]),
    `${dir}/ic_launcher_round.png`
  );

  // Adaptive foreground: 108dp canvas at this density, mark at 62%, on
  // transparency so the background colour layer shows through.
  //
  // THE BARE MARK, not the square art — `markOnly`, with the gradient panel
  // and the long shadow switched off. Rendering the full tile here and letting
  // the launcher mask it gives a gradient square floating inside a circle,
  // which reads as a sticker somebody stuck on rather than as an icon.
  const canvas = Math.round(px * 108 / 48);
  const inner = Math.round(canvas * 0.62);
  const markPng = await sharp(markOnly, { density: 1200 }).resize(inner, inner).png().toBuffer();
  await writeAtomic(
    sharp({ create: { width: canvas, height: canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: markPng, gravity: "centre" }]),
    `${dir}/ic_launcher_foreground.png`
  );
}

// The background layer, as a colour resource. Written rather than assumed:
// `cap add android` seeds it #FFFFFF, which puts a white ring around a mark
// designed to sit on the app's own near-black.
await writeFile(
  `${ANDROID_RES}/values/ic_launcher_background.xml`,
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${ANDROID_BG}</color>\n</resources>\n`
);

// The ground the Android 12+ system splash draws the launcher icon on, read by
// `windowSplashScreenBackground` in values/styles.xml. Its own default is the
// theme's colorBackground, which on the AppCompat parent Capacitor seeds is
// WHITE — so the drawables above were being skipped and a white screen shown
// instead, on every phone new enough to matter. Written here rather than typed
// into styles.xml so it can only ever be APP_BG.
await writeFile(
  `${ANDROID_RES}/values/splash_background.xml`,
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="splash_background">${APP_BG}</color>\n</resources>\n`
);

const { width, height, channels } = await sharp(ICON).metadata();
// Loud rather than silent: this is the one assertion that would otherwise be
// discovered by App Store Connect, hours later, on an upload.
if (width !== 1024 || height !== 1024 || channels !== 3) {
  throw new Error(`icon is ${width}x${height} with ${channels} channels; App Store wants 1024x1024 and no alpha`);
}
console.log(`iOS: ${width}x${height} icon (${channels} channels, no alpha) + ${SPLASHES.length} splash images`);
console.log(`Android: ${Object.keys(DENSITIES).length} densities x 3 slots, adaptive background ${ANDROID_BG}`);
console.log(`Launch screen: ${Object.keys(ANDROID_SPLASHES).length} Android drawables + splash_background ${APP_BG}`);
