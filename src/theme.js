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
// Brighter variant — the inverse of dimHex, same multiply-the-channels math,
// so hue and saturation are preserved and only the value moves. This is the
// ONE knob for "how bright is the palette": team accents, their dim shades
// (derived from the lifted accent, so they track it) and the neutral grays
// all run through the same factor, which is why they stay in step with each
// other when it changes.
export const liftHex = (hex, f = 1.2) => {
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
  // A brand-supplied color is lifted here rather than at extraction time so
  // the stored branding doc keeps the logo's true color and only the DISPLAY
  // is brightened. The defaults are already lifted in constants.js (they have
  // to be — components read TEAM_A.accent directly), so they must not be run
  // through liftHex a second time here.
  const aCol = brandA ? liftHex(brandA) : TEAM_A.accent;
  const bCol = brandB ? liftHex(brandB) : TEAM_B.accent;
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
    // t2/t3 are the app's "primary gray" — the app-header caption, the
    // inactive bottom-nav tabs, the trailing side's player names on the
    // leaderboard. Lifted by the same 1.2 the team colors are (was #a0a0a6 /
    // #6a6a70) so the chrome brightened in step with the accents instead of
    // receding behind them. t1 is deliberately NOT lifted: at #f5f4f2 the
    // same factor just clamps to pure white and loses the off-white warmth.
    t2: "#c0c0c7",          // neutral medium gray
    t3: "#7f7f86",          // muted neutral gray
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

// ── Ink on amber ──
// The one text/fill color that sits ON the amber and gold accents — active
// segmented tabs, primary buttons, the FRONT/BACK scorecard band, the
// theme-toggle knob. It is NOT a neutral rung: it does not flip with the
// mode, because the surface it sits on does not flip either. Amber is amber
// in light and dark, so its ink is this warm near-black in both.
//
// It lived as a private const in ui.jsx and as a bare "#0a0804" at thirty
// other call sites, which is the same thing as not having a name at all.
// Reach for this instead of typing the hex; if a surface needs different
// ink, that surface is not amber and this is the wrong token.
export const ON_AMBER = "#0a0804";

// ── Type scale ──
// The app is styled entirely with inline objects, so before this existed
// every `fontSize:` was a hand-picked number. That produced seventeen
// distinct sizes between 7px and 40px — an unbroken 1px ladder from 7 to 17
// — and the same role kept landing on different rungs: the "COURSE" eyebrow
// label was 9px in one panel and 10px in the next, a player's name was 11,
// 12, 13 or 14 depending on which list you were looking at. A 1px step is
// invisible on its own and indistinguishable from a mistake, which is
// exactly what makes it drift: there was no rung to snap to.
//
// FS is that set of rungs. Nine steps, named for the ROLE rather than the
// number, because the rule the app is trying to hold is "same role, same
// size" — not "sizes come from a list". Pick the entry whose description
// matches what you're rendering; if none fits, the answer is almost never a
// new number, it's that the thing is one of these in disguise.
//
// Steps are 2px apart through the text range (8→16) — the smallest gap that
// reads as deliberate on a phone — then open up for display sizes where a
// 2px difference stops registering at all.
export const FS = {
  micro:    8, // dense grid cells, scorecard column heads, stroke dots, tiny badges
  label:   10, // all-caps eyebrows/section labels, hint + helper prose, meta lines
  small:   12, // list rows, secondary body copy, pill and segmented buttons
  body:    14, // form inputs, standard buttons, player names, card/dialog titles
  lead:    16, // key values, primary CTAs, panel and screen titles, icon buttons
  title:   20, // hero numerics, oversized nav glyphs
  hero:    26, // the active hole number
  display: 32, // team point totals, large empty-state icons
  jumbo:   40, // full-screen empty-state icons
};
// One functional constraint rides on this scale: a text input below 16px
// makes iOS Safari zoom the page on focus. Every field the user types free
// text into (the player modal, GHIN search, course search) is therefore at
// FS.lead, and stays there — condense those with padding, never by dropping
// a rung. The narrow numeric cells in the dense director-side grids are the
// deliberate exception: they are steppers you tap, not fields you type into,
// and 16px will not fit nine of them across a phone.

// ── Live per-team color accessors ──
// Single read surface for team colors. These read the live BC tokens (which
// applyBCTheme keeps in sync with the active branding doc), so a component
// never has to branch on team id inline or reach back into the constants.
// `teamColor` = the vivid accent, `teamColorDim` = the deep fill/background
// shade, `teamColorGlow` = the low-alpha wash.
export const teamColor     = (tid) => (tid === "A" ? BC.teamA     : BC.teamB);
export const teamColorDim  = (tid) => (tid === "A" ? BC.teamADim  : BC.teamBDim);
export const teamColorGlow = (tid) => (tid === "A" ? BC.teamAGlow : BC.teamBGlow);

// ── Settled vs in-play ink ──
// A result that's still moving is drawn lighter than one that's banked, so
// scanning a board separates "this is decided" from "this could change"
// before you read a single number. Appended as an alpha byte, which every BC
// color token supports since they're all 6-digit hex.
export const LIVE_ALPHA = "99"; // 60%
export const ink = (hex, settled) => (settled ? hex : `${hex}${LIVE_ALPHA}`);

// ── Player-name text color ──
// Single source of truth for how player names read in rosters and lists.
// Brightening them updates every instance that routes through here. Uses the
// bright primary text token (BC.t1) — team identity is carried by stripes,
// grouping and team colors elsewhere, not by dimming the name itself.
// Reads live BC so it tracks the active theme.
export const playerNameColor = () => BC.t1;

// ── Why there is deliberately NO JS viewport measurement here ──────
// The obvious "modern" fix for a bottom bar that won't sit on the bottom is
// to measure window.visualViewport.height and size the app to it. On iOS
// that is actively WRONG in the one place it matters most: inside an
// INSTALLED home-screen app, visualViewport.height silently subtracts
// env(safe-area-inset-top). Measured on an iPhone 16 Pro (402x874pt) it
// reports 812 for a webview that is genuinely 874 — so the shell ends up
// short by exactly the height of the Dynamic Island, and a 62pt black band
// opens up under the nav. That was a real regression, not a theory.
//
// `position: fixed; inset: 0` on the app shell does NOT have that problem:
// the fixed containing block is the full webview in standalone mode, and
// mobile Safari re-pins fixed elements above its own toolbar for free. So
// the shell stays fixed, html/body/#root stay a plain 100%, and nothing in
// the layout ever asks JavaScript how tall the screen is.

// ── Global stylesheet ──
// Single source of truth for the document-level CSS. Both the initial
// injection below and App's theme-toggle effect call this, so the two can
// no longer drift apart (they were duplicated string literals before).
//
// Layout contract: html/body/#root are a plain full-height, non-scrolling,
// non-overscrolling backdrop painted in the theme bg. All real layout is
// done by the app shell, which is position:fixed; inset:0 on top of them.
export const bcGlobalCSS = (bg) => `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #root {
    height: 100%;
    width: 100%;
    background: ${bg};
    overflow: hidden;
    overscroll-behavior: none;
  }
  body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; }
  /* ── All-caps, app-wide ──
     One inherited rule on the mount point instead of a textTransform on every
     style object — the app is styled inline, so per-component opt-in would be
     hundreds of edits and every new component a chance to forget. Form
     controls are named explicitly because a UA stylesheet is the one place
     that can interrupt inheritance on them; this is display-only, so what
     lands in Firestore is still exactly what the director typed. */
  #root, #root input, #root textarea, #root select, #root button {
    text-transform: uppercase;
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
