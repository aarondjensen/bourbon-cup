// ─── BOURBON CUP THEME ───
// `BC` is mutated in place when the user toggles dark/light mode. The mutation
// pattern (vs. swapping the reference) is intentional: every component holds
// a stale closure over `BC` from when the module loaded, but since they all
// point to the SAME object, mutating its keys updates every consumer at once.
// React picks up the visual change because the App-level `darkMode` state
// transition triggers a top-level re-render that propagates down — children
// re-read the now-updated BC values inline in JSX.
//
// Borrowed from the MNQ pattern: getTheme(mode) → applyTheme(mode) mutates K.
// ─── BOURBON CUP THEME ───
// Design philosophy — "traditional clubhouse, not all-bourbon-everywhere".
// The earlier palette tinted every surface (bg, card, inputs, borders, text)
// with the same warm-brown family, which read as muddy/monochromatic. The
// revised approach: keep the chrome NEUTRAL (warm-cream paper in light,
// cool slate in dark) and reserve bourbon amber for the actual accents —
// active buttons, MASH ROUND header, score-button selection, toast,
// triangle indicators. Result: amber stops blending into its surroundings
// and starts reading as the brand signature it's meant to be.
//
// Light mode is built like a vintage scorecard — soft linen-cream paper,
// near-black ink for primary text, gentle neutral grays for borders. The
// warmth in the bg is subtle (NOT yellow) so the amber accent doesn't
// fight it. Dark mode goes cool-charcoal (think aged-leather binding seen
// from a low-light angle) so amber reads as gold instead of beige.
// ─── BOURBON CUP THEME — Gold (Blackout) default ───
// Tournament chrome is a true-neutral black base with a sharp gold-amber
// primary accent ("amber") and a bourbon-brown secondary ("gold"). This
// is the CONSTANT Bourbon Cup identity. Per-team colors are NOT baked in
// here — they are extracted from each team's uploaded logo at setup time
// (see lib/logoBrand.js) and layered on via the brand config below
// (teamA/teamB tokens). Swap teams year to year; this chrome stays put.
// Light mode is a crisp near-white; dark mode is the black shown in the
// Gold mockup. The key name "amber" now genuinely holds amber.
// ── Brand-driven accents ──────────────────────────────────────────
// Neutral chrome (bg/card/inp/bdr/text) is fixed per mode. The ACCENTS
// are tournament-configurable: each team's color is extracted from its
// uploaded logo at setup time (see lib/logoBrand.js) and stored in the
// branding doc. `brand` shape:
//   { tournamentAccent?: "#rrggbb",
//     teamA?: { color: "#rrggbb" }, teamB?: { color: "#rrggbb" } }
// Any field omitted falls back to a built-in default, so the app is
// fully functional before anything is configured — the defaults
// reproduce today's look (Mash green for team A, a teal for team B,
// and the existing primary accent for chrome).
import { TEAM_A, TEAM_B } from "./constants";

const _clampC = (n) => Math.max(0, Math.min(255, Math.round(n)));
const _hxC = (n) => _clampC(n).toString(16).padStart(2, "0");
const _rgbC = (hex) => {
  const h = String(hex).replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
// Darker variant for gradients / hover / deep-fills. Kept in sync with
// lib/logoBrand.js so the theme and the extractor agree on shades.
export const dimHex = (hex, f = 0.62) => {
  const [r, g, b] = _rgbC(hex);
  return `#${_hxC(r * f)}${_hxC(g * f)}${_hxC(b * f)}`;
};
// Low-alpha wash for glows / tinted backgrounds.
export const glowHex = (hex, a = 0.16) => {
  const [r, g, b] = _rgbC(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

// Augments a base palette in place with per-team tokens (and an optional
// tournament-accent override), then returns it.
function withBrand(mode, brand, base) {
  const glowA = mode === "light" ? 0.14 : 0.20;
  // Fallback team colors live in ONE place — the TEAM_A/TEAM_B definitions in
  // constants.js. When a branding doc supplies a color, the dim/glow shades
  // are derived from it; otherwise we use the exact deep-color/glow from
  // constants so the un-branded look is pixel-identical to the original.
  const brandA = brand?.teamA?.color;
  const brandB = brand?.teamB?.color;
  const aCol = brandA || TEAM_A.accent;
  const bCol = brandB || TEAM_B.accent;
  base.teamA = aCol;
  base.teamADim  = brandA ? dimHex(aCol)         : TEAM_A.color;
  base.teamAGlow = brandA ? glowHex(aCol, glowA) : TEAM_A.glow;
  base.teamB = bCol;
  base.teamBDim  = brandB ? dimHex(bCol)         : TEAM_B.color;
  base.teamBGlow = brandB ? glowHex(bCol, glowA) : TEAM_B.glow;
  // Optional override of the neutral tournament accent (chrome). When
  // omitted, the existing amber/green primary accent is kept as-is, so
  // adopting this is visually a no-op until a tournament is configured.
  if (brand?.tournamentAccent) {
    base.amber = brand.tournamentAccent;
    base.amberDim = dimHex(brand.tournamentAccent);
    base.amberGlow = glowHex(brand.tournamentAccent, glowA);
  }
  return base;
}

export const getBCTheme = (mode, brand = null) => {
  if (mode === "light") {
    return withBrand("light", brand, {
      bg: "#fafaf9",        // crisp near-white page
      card: "#ffffff",      // pure white card surface
      inp: "#f0f0ee",       // light neutral gray (input/inactive)
      hover: "#e7e7e4",
      bdr: "#dcdcd9",       // soft neutral border
      t1: "#16161a",        // near-black ink
      t2: "#5c5c62",        // medium neutral
      t3: "#93939a",        // muted neutral
      amber: "#b8801a",     // PRIMARY ACCENT — bourbon amber (Blackout/Gold)
      amberGlow: "rgba(184,128,26,0.14)",
      amberDim: "#8a5f10",  // deeper amber (gradients, hover-state)
      gold: "#8a5a2b",      // SECONDARY ACCENT — bourbon brown (login title, trophy glow)
      goldGlow: "rgba(138,90,43,0.10)",
      danger: "#c1272d",    // traditional deep red
      warn: "#c2570d",      // burnt orange
      green: "#047857",     // generic positive (distinct from brand accent)
      // Handicap blue — matches MNQ's K.hcpBlue exactly so users
      // moving between the two apps see consistent visual language for
      // handicap strokes / stroke dots / (CH) labels. Tailwind blue-500.
      hcpBlue: "#3b82f6",
    });
  }
  // dark (default) — Mash logo "black bg + green flag" inspired
  return withBrand("dark", brand, {
    bg: "#0a0a0b",          // true neutral black (Blackout/Gold)
    card: "#161618",        // elevated panel
    inp: "#1d1d20",         // sunken input
    hover: "#26262a",
    bdr: "#2a2a2e",         // neutral border
    t1: "#f5f4f2",          // crisp off-white
    t2: "#a0a0a6",          // neutral medium gray
    t3: "#6a6a70",          // muted neutral gray
    amber: "#e0a93c",       // PRIMARY ACCENT — sharp gold-amber for dark
    amberGlow: "rgba(224,169,60,0.20)",
    amberDim: "#b8801a",
    gold: "#d4a843",        // SECONDARY ACCENT — bourbon brown
    goldGlow: "rgba(212,168,67,0.12)",
    danger: "#ef5350",
    warn: "#f59e0b",
    green: "#22c55e",
    hcpBlue: "#3b82f6",
  });
};

// Read saved preference (default: dark). Wrapped in try/catch so SSR or
// blocked-localStorage envs don't crash module load. Exported so App can
// seed its `darkMode` useState with the right initial value.
export const initialBCMode = (() => {
  try {
    return typeof window !== "undefined" && localStorage.getItem("bc_theme") === "light" ? "light" : "dark";
  } catch { return "dark"; }
})();

// `BC` is the live theme object. Mutated in place by applyBCTheme — never
// reassigned — so every component that imports it sees the same reference
// and reads up-to-date values inline in JSX after a top-level re-render.
export const BC = { ...getBCTheme(initialBCMode) };

export const applyBCTheme = (mode, brand = null) => {
  const next = getBCTheme(mode, brand);
  for (const key in next) BC[key] = next[key];
};

// ── Live per-team color accessors ──
// Single read surface for team colors. These read the live BC tokens (which
// applyBCTheme keeps in sync with the active branding doc), so a component
// never has to branch on team id inline or reach back into the constants.
// `teamColor` = the vivid accent, `teamColorDim` = the deep fill/background
// shade, `teamColorGlow` = the low-alpha wash.
export const teamColor     = (tid) => (tid === "A" ? BC.teamA     : BC.teamB);
export const teamColorDim  = (tid) => (tid === "A" ? BC.teamADim  : BC.teamBDim);
export const teamColorGlow = (tid) => (tid === "A" ? BC.teamAGlow : BC.teamBGlow);

// ── App viewport height (--bc-app-h) ──────────────────────────────
// Every mobile browser misreports the viewport in a slightly different way,
// and `position: fixed; bottom: 0` inherits every one of those lies:
//
//   • iOS Safari resolves a fixed element's containing block against the
//     LARGE viewport (toolbars retracted). While the toolbar is showing,
//     `bottom: 0` is BELOW the visible area; once it collapses, the layout
//     is stale until something forces a reflow. Either way the bar drifts.
//   • Android Chrome keeps the layout viewport at its large size while the
//     URL bar is on screen, with the same net effect.
//   • Installed (standalone) PWAs stack the home-indicator inset on top of
//     all of that.
//
// So we stop trusting `bottom: 0` entirely. syncAppHeight() MEASURES the
// visible viewport via the visualViewport API and publishes it as a CSS
// custom property on <html>. #root is sized to exactly that height, the app
// shell fills #root at height:100%, and the bottom nav — being the shell's
// last flex child — is therefore flush with the real bottom edge on every
// device, in every browser, in both browser and standalone modes.
//
// Keyboard guard: when the on-screen keyboard opens, visualViewport
// collapses to a fraction of the layout viewport. We deliberately ignore
// that case and keep the full height, so focusing a score input doesn't
// yank the entire chrome upward mid-entry.
export const syncAppHeight = () => {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const vv = window.visualViewport;
  const inner = window.innerHeight || 0;
  let h = vv ? vv.height : inner;
  if (vv && inner && vv.height < inner * 0.7) h = inner;
  if (!h) return;
  document.documentElement.style.setProperty("--bc-app-h", `${Math.round(h)}px`);
};

if (typeof window !== "undefined") {
  let _vpRaf = 0;
  const _scheduleVp = () => {
    if (_vpRaf) return;
    _vpRaf = requestAnimationFrame(() => { _vpRaf = 0; syncAppHeight(); });
  };
  // Synchronous seed so the FIRST paint is already the right height — no
  // one-frame flash of a too-tall/too-short shell.
  syncAppHeight();
  window.addEventListener("resize", _scheduleVp);
  window.addEventListener("orientationchange", _scheduleVp);
  // bfcache restores (iOS back-swipe) replay the old layout; re-measure.
  window.addEventListener("pageshow", _scheduleVp);
  if (window.visualViewport) {
    // `resize` fires when the toolbar expands/collapses; `scroll` fires when
    // the visual viewport pans (pinch-zoom, keyboard). Both change the
    // effective bottom edge.
    window.visualViewport.addEventListener("resize", _scheduleVp);
    window.visualViewport.addEventListener("scroll", _scheduleVp);
  }
}

// ── Global stylesheet ──
// Single source of truth for the document-level CSS. Both the initial
// injection below and App's theme-toggle effect call this, so the two can
// no longer drift apart (they were duplicated string literals before).
//
// Layout contract, top to bottom:
//   html  — full height, no scrolling, no overscroll chaining
//   body  — position:fixed at the TOP of the viewport with an explicit
//           MEASURED height. Nothing here depends on `bottom: 0` resolving
//           correctly, which is the entire point.
//   #root — height:100% of body; the app shell fills it.
export const bcGlobalCSS = (bg) => `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  /* Pre-JS fallback chain for --bc-app-h. syncAppHeight() overwrites this
     with a measured pixel value as an inline style on <html>, which wins
     over these rules. dvh where supported, plain vh everywhere else. */
  :root { --bc-app-h: 100vh; }
  @supports (height: 100dvh) { :root { --bc-app-h: 100dvh; } }

  html {
    height: 100%;
    width: 100%;
    background: ${bg};
    overflow: hidden;
    overscroll-behavior: none;
    -webkit-text-size-adjust: 100%;
  }

  body {
    margin: 0;
    padding: 0;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    width: 100%;
    height: var(--bc-app-h);
    background: ${bg};
    overflow: hidden;
    overscroll-behavior: none;
  }

  #root {
    width: 100%;
    height: 100%;
    background: ${bg};
    overflow: hidden;
  }
`;

// ── Inject global styles ──
// The body bg is set on initial load so the page paints the correct theme
// before React mounts. A useEffect in App keeps it in sync when the user
// toggles the theme (the injected rules below would otherwise be stale).
// The element id is fixed so App can `getElementById` and replace
// .textContent on theme toggle.
if (typeof document !== "undefined") {
  const _style = document.createElement("style");
  _style.id = "bc-global-style";
  _style.textContent = bcGlobalCSS(BC.bg);
  document.head.appendChild(_style);

  // ── Inject Montserrat font ──
  const _link = document.createElement("link");
  _link.rel = "stylesheet";
  _link.href = "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap";
  document.head.appendChild(_link);
}
