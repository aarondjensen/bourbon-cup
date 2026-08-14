// ══════════════════════════════════════════════════════════════════
//  ios-icons — the app icon and the launch image, from the brand mark.
// ══════════════════════════════════════════════════════════════════
//
//   npm run build:ios-icons
//
// `npx cap add ios` seeds the asset catalog with CAPACITOR'S OWN LOGO, and
// it looks close enough to a real icon in the Xcode navigator that it ships.
// A build with it reaches TestFlight looking like somebody else's app and is
// rejected on sight at review. This is the script that makes that impossible
// to forget: run it after `cap add ios` or after the mark changes, and the
// diff shows whether anything moved.
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
import { rename } from "node:fs/promises";

const SVG = "public/BC ICON-01.svg";
const ICON = "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png";
const SPLASH_DIR = "ios/App/App/Assets.xcassets/Splash.imageset/";
// Xcode names these by scale factor (1x/2x/3x) and Capacitor generates all
// three at the same size. Same image in each: the launch screen is one mark
// on one background, and there is nothing for a higher scale to add.
const SPLASHES = ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"];

// The app's own background, so the launch image and the first painted frame
// are the same colour and the handoff is invisible. Kept in step with
// `backgroundColor` in capacitor.config.json and BC.bg in src/theme.js.
const APP_BG = "#161618";
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

const { width, height, channels } = await sharp(ICON).metadata();
// Loud rather than silent: this is the one assertion that would otherwise be
// discovered by App Store Connect, hours later, on an upload.
if (width !== 1024 || height !== 1024 || channels !== 3) {
  throw new Error(`icon is ${width}x${height} with ${channels} channels; App Store wants 1024x1024 and no alpha`);
}
console.log(`icon ${width}x${height} (${channels} channels, no alpha) + ${SPLASHES.length} splash images`);
