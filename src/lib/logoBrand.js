// ══════════════════════════════════════════════════════════════════
//  logoBrand — turn an uploaded team logo into a stored image + accent.
// ══════════════════════════════════════════════════════════════════
//
// Two jobs, done in the browser at tournament-setup time:
//   1. Downscale the uploaded logo to a small PNG data URL suitable for
//      storing directly in the branding doc (base64-in-Firestore — no
//      Firebase Storage needed for files this small).
//   2. Extract the dominant *vivid* color from the logo to seed the
//      team's accent. The setup UI shows this as a swatch the director
//      can confirm or nudge before saving.
//
// The extraction algorithm mirrors the offline validation exactly:
//   • ignore transparent pixels (alpha < 200)
//   • ignore greys/near-white/near-black (saturation < 0.25 or value
//     < 0.15) — this drops the black outlines and cream paper that
//     dominate most logos so the emblem color wins
//   • quantize survivors into 16-step RGB buckets and take the most
//     common bucket
// On the real logos this yields ~#109040 (Mash green) and ~#005060
// (Shot Callers teal), so uploading the Mash logo reconstructs the
// green scheme automatically.
//
// dim()/glow() derive the darker gradient shade and the low-alpha wash
// from that single color, so the director only ever picks ONE color per
// team and the theme fills in the rest (see theme.js dimHex/glowHex,
// which use the identical math).

const SAT_MIN = 0.25;   // below this = grey/white/black, skip
const VAL_MIN = 0.15;   // below this = near-black outline, skip
const ALPHA_MIN = 200;  // below this = transparent, skip
const BUCKET = 16;      // RGB quantization step

// ── color helpers (kept in sync with theme.js) ──
const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
const hx = (n) => clamp(n).toString(16).padStart(2, "0");
const toHex = (r, g, b) => `#${hx(r)}${hx(g)}${hx(b)}`;

export const dim = (hex, f = 0.62) => {
  const [r, g, b] = rgbOf(hex);
  return toHex(r * f, g * f, b * f);
};
export const glow = (hex, a = 0.16) => {
  const [r, g, b] = rgbOf(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};
function rgbOf(hex) {
  const h = String(hex).replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  return [0, s, v]; // hue unused
}

// Load a File OR an existing data-URL string into an <img>.
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    if (typeof src === "string") {
      img.src = src;
    } else {
      const reader = new FileReader();
      reader.onload = () => { img.src = reader.result; };
      reader.onerror = reject;
      reader.readAsDataURL(src);
    }
  });
}

// Draw an image into a canvas fitted within maxDim (aspect preserved).
function fitCanvas(img, maxDim) {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas, ctx, w, h };
}

// Pure extraction over raw RGBA bytes — exported for testability.
export function extractAccentFromPixels(data) {
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < ALPHA_MIN) continue;
    const [, s, v] = rgbToHsv(r, g, b);
    if (s < SAT_MIN || v < VAL_MIN) continue;
    const key = `${Math.floor(r / BUCKET) * BUCKET},${Math.floor(g / BUCKET) * BUCKET},${Math.floor(b / BUCKET) * BUCKET}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (counts.size === 0) return null;
  let best = null, bestN = -1, total = 0;
  for (const [key, n] of counts) { total += n; if (n > bestN) { bestN = n; best = key; } }
  const [r, g, b] = best.split(",").map(Number);
  const color = toHex(r, g, b);
  return { color, dim: dim(color), glow: glow(color), share: bestN / total };
}

// Extract accent from a loaded image (sampled small for speed/stability).
export function extractAccent(img, sampleSize = 120) {
  const { ctx, w, h } = fitCanvas(img, sampleSize);
  const { data } = ctx.getImageData(0, 0, w, h);
  return extractAccentFromPixels(data);
}

// Full pipeline: File → { logo (data URL), color, dim, glow }.
//   storeSize — max dimension of the stored PNG (default 256)
//   sampleSize — resolution used for color sampling (default 120)
//   mime — "image/png" keeps transparency; "image/webp" is ~smaller if
//          you want to shrink the stored payload further.
export async function processLogo(file, { storeSize = 256, sampleSize = 120, mime = "image/png" } = {}) {
  const img = await loadImage(file);
  const { canvas } = fitCanvas(img, storeSize);
  const logo = canvas.toDataURL(mime);
  const accent = extractAccent(img, sampleSize) || { color: "#888888", dim: "#545454", glow: "rgba(136,136,136,0.16)" };
  return { logo, color: accent.color, dim: accent.dim, glow: accent.glow };
}
