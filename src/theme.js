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
// active buttons, section headers, score-button selection, toast,
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
// ── Contrast ─────────────────────────────────────────────────────
// WCAG relative luminance and contrast ratio. Here so the palette can hold
// itself to a readable level rather than leaving it to be eyeballed.
const _srgbC = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export const luminance = (hex) => {
  const [r, g, b] = _rgbC(hex);
  return 0.2126 * _srgbC(r) + 0.7152 * _srgbC(g) + 0.0722 * _srgbC(b);
};
export const contrast = (a, b) => {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

// Walk a color toward black until it clears `target` against `bg`, and leave
// it alone if it already does. A FIXED darkening factor can't do this job:
// the two team colors need x0.76 and x0.70 to reach the same ratio, because
// green and teal carry very different luminance per unit of RGB. Stepping to
// a contrast target instead of a factor is also what keeps this correct for
// a logo colour nobody has uploaded yet.
export function shadeToContrast(hex, bg, target = 4.5) {
  if (contrast(hex, bg) >= target) return hex;
  for (let f = 0.98; f >= 0.06; f -= 0.02) {
    const c = dimHex(hex, f);
    if (contrast(c, bg) >= target) return c;
  }
  return dimHex(hex, 0.06);
}

// Low-alpha wash for glows / tinted backgrounds.
export const glowHex = (hex, a = 0.16) => {
  const [r, g, b] = _rgbC(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

// Augments a base palette in place with per-team tokens (and an optional
// tournament-accent override), then returns it.
// AA for normal text. The team accents are used at 10-11px in places — the
// F9/B9 results, the team name over each cup total — so the large-text 3:1
// allowance doesn't cover them.
const TEAM_TEXT_CONTRAST = 4.5;

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
  const rawA = brandA ? liftHex(brandA) : TEAM_A.accent;
  const rawB = brandB ? liftHex(brandB) : TEAM_B.accent;
  // The lift above is what makes a team color read on a black page — and it
  // is exactly what stops it reading on a white one. Carried into light mode
  // unchanged, the two accents measured 2.80:1 and 2.35:1 against #fafaf9:
  // under the 3:1 floor for even large text, on the colors that carry team
  // names, F9/B9 results and the running match status. Light mode therefore
  // takes the same hue walked down until it clears AA for normal text, since
  // some of what it colors is 10-11px. Dark mode is untouched.
  const onLight = (hex) => shadeToContrast(hex, base.bg, TEAM_TEXT_CONTRAST);
  const aCol = mode === "light" ? onLight(rawA) : rawA;
  const bCol = mode === "light" ? onLight(rawB) : rawB;
  base.teamA = aCol;
  base.teamB = bCol;
  // Dim and glow stay derived from the UN-shaded color: the first is a deep
  // fill that sits behind light text and is already darker than either
  // accent, the second a low-alpha wash where contrast doesn't arise. Only
  // the accent — the one that gets used as ink — needed moving.
  base.teamADim  = brandA ? dimHex(rawA)         : TEAM_A.color;
  base.teamAGlow = brandA ? glowHex(rawA, glowA) : TEAM_A.glow;
  base.teamBDim  = brandB ? dimHex(rawB)         : TEAM_B.color;
  base.teamBGlow = brandB ? glowHex(rawB, glowA) : TEAM_B.glow;
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
      thumb: "#ffffff",     // the raised half of a segmented track (see below)
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
    // The raised half of a segmented track. It is NOT `card`: the track it
    // sits in is `inp`, and card is only 5 steps off that — the selected tab
    // would have to be read rather than seen. Lifted past `hover` until it
    // separates at arm's length in daylight, which is where this app is used.
    thumb: "#33333a",
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

// ── The typeface ──
// theme.js loads Montserrat (see the <link> injection at the bottom), so it
// owns the family string too. It was declared as a `const FONT` in four
// component files and typed out inline twenty-four more times, which is a lot
// of places to edit the day the tournament changes its type.
export const FONT = "'Montserrat', sans-serif";

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

// ── Ink on everything else saturated ──
// ON_AMBER's sibling, and the one that never got a name: white, for ink that
// sits on a fill too dark or too saturated to take the near-black — the
// team-coloured hole navigator, an active tab, a skin-winning cell, the
// danger button. It was "#fff" at two dozen call sites.
//
// Neither of these flips with the mode, and for the same reason: the surface
// under them doesn't either. Which of the two you want is decided by the FILL,
// never by the theme.
export const ON_ACCENT = "#ffffff";

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

// ── Alpha ladder ──
// Every BC token is 6-digit hex, so a wash is made by appending two more
// characters: `BC.amber + ALPHA.wash`. That freedom is why there were
// twenty-four different alpha levels in the app — eighteen on BC.amber
// alone — with no way to tell a considered value from a typo. 27% and 33%
// borders sat on adjacent elements; the same list used 6%, 13% and 20%
// dividers on different rows.
//
// Six rungs, each roughly 1.5–2× the last, which is about the smallest step
// that survives being painted over a card at 1px. The names describe
// STRENGTH; the roles listed are what each one is usually for, not a fence.
// A wash that has to be "between hair and line" is a wash that should pick
// one of them.
export const ALPHA = {
  wash:  "14", //  8% — an accent breathed onto a surface; content reads on top
  tint:  "26", // 15% — that surface switched on: selected row, active chip
  hair:  "33", // 20% — a divider inside one list; a placeholder mark
  line:  "55", // 33% — the edge of a thing: card, chip, input, button, bar
  panel: "88", // 53% — a translucent surface that still reads as a surface
  held:  "99", // 60% — ink pulled back on purpose (see `ink` below)
  soft:  "bf", // 75% — ink pulled back FAR ENOUGH TO READ (see LIVE_ALPHA)
};

// ── Black, for the two things black is for ──
// Drop shadows and modal backdrops were nine different rgba(0,0,0,…) values
// for ten uses — including 0.4 and 0.3 each spelled two ways, and one "#0009".
// They are black at an alpha, which is what the ladder above is for, so they
// use it: SHADOW under anything that floats, SCRIM behind anything modal.
// Neither is a theme colour — a shadow is the absence of light in both modes.
export const SHADOW = `#000000${ALPHA.line}`;  // 33%
export const SCRIM  = `#000000${ALPHA.held}`;  // 60%

// ── Settled vs in-play ink ──
// A result that's still moving is drawn lighter than one that's banked, so
// scanning a board separates "this is decided" from "this could change"
// before you read a single number. Appended as an alpha byte, which every BC
// color token supports since they're all 6-digit hex.
// 75%, not the 60% the scrim uses. At 60% an in-play team colour composited
// onto its card measured 2.33:1 in light mode and 2.96:1 in dark — below the
// 3:1 floor on the single most-read thing on a live board, the status of a
// match still being played. 75% holds the "this is still moving" signal (a
// settled result reads 4.8:1 against an in-play 3.1:1 in light) while keeping
// both sides of that distinction legible. The scrim stays at 60%: it is a
// sheet of black over a page, and nothing has to be read THROUGH it.
export const LIVE_ALPHA = ALPHA.soft;
export const ink = (hex, settled) => (settled ? hex : `${hex}${LIVE_ALPHA}`);

// ── The selected-segment look ─────────────────────────────────────
// One definition of what "this one is selected" looks like, because the app
// has this control in five places at three sizes and every one of them used
// to draw its own: a raised thumb in a recessed field, with a short amber
// rule under the label.
//
// It replaced an amber-gradient fill with near-black ink on 2026-07-29. On
// the dark theme that fill read as gold; on the light theme's near-white page
// it read as tarnished bronze, and dark ink on a mid-tone brown was the
// muddiest contrast pair in the app. Shape now carries "selected" and amber
// carries only the accent — which is also what lets amber keep meaning
// something, since it is the override star, the CTP flag and the cup total
// everywhere else and cannot be all of those AND the tab chrome.
//
// `compact` is the 10px-label size used inline on a form row (the Admin
// round card's scoring and handicap toggles); the rule scales with it so a
// small pill doesn't wear a smudge.
export const segThumb = (on, { compact = false, sunken = false } = {}) => ({
  background: on ? BC.thumb : (sunken ? BC.inp : "transparent"),
  color: on ? BC.t1 : BC.t3,
  border: "none",
  borderRadius: compact ? 14 : 16,
  position: "relative",
  // The lift. A step off the ALPHA ladder above rather than a bespoke rgba —
  // it is a shadow, and a shadow is black at an alpha.
  boxShadow: on ? `0 1px 3px #000000${ALPHA.hair}` : "none",
});

// The field the thumb is raised out of. `compact` is the inline size, whose
// 2px of padding is what keeps a 10px-label row from growing a row taller.
export const segTrack = ({ compact = false } = {}) => ({
  display: "flex",
  background: BC.inp,
  borderRadius: 20,
  padding: compact ? 2 : 3,
  // Transparent rather than absent: it holds the track at the height a
  // bordered one would be, so two of these never disagree by a pixel.
  border: "1px solid transparent",
});

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
//
// ── The one exception: the band an old home-screen icon leaves ─────
// index.html pins apple-mobile-web-app-status-bar-style to "black" so the
// webview starts BELOW the status bar and its bottom edge is the physical
// bottom of the screen. But iOS SNAPSHOTS that meta when the icon is added
// to the home screen, so an icon installed before that fix still runs the
// old "black-translucent" behaviour, and no redeploy can reach it — only
// deleting and re-adding the icon can. In that mode the page is pulled up
// to y=0 while the layout viewport keeps the SHORT height, so
// `position: fixed; bottom: 0` lands one status bar ABOVE the glass.
//
// Reported on an iPhone 17e (390x844pt, 47pt notch inset): the bottom nav —
// and the slide-up menu that sits on it — floated 47pt up, over a band of
// bare page background. (The band is painted at all because the root
// background propagates to the whole canvas, not just the layout viewport.)
//
// The two states tell themselves apart, no sniffing required: once iOS has
// reserved the status bar the top inset is 0, and when it hasn't the inset
// is exactly the height that fell off the bottom.
//
//     drop = min(screen.height - innerHeight, safe-area-inset-top)
//
// This is not the banned measurement above. Nothing here asks how tall the
// app is: it reads ONE offset, clamped to a status bar's height, which is
// 0px for a correctly installed icon, 0px in a browser tab, and 0px on
// anything that isn't a standalone iOS webview. Consumers use it through a
// CSS variable whose fallback is 0px, so if this never runs the layout is
// exactly what it was before.
export const VP_DROP = "var(--bc-vp-drop, 0px)";
// Bottom-anchored fixed elements reach past the short viewport with this.
export const VP_DROP_BOTTOM = `calc(-1 * ${VP_DROP})`;

const measureVpDrop = () => {
  if (typeof window === "undefined" || typeof document === "undefined") return 0;
  const standalone = window.navigator?.standalone === true
    || window.matchMedia?.("(display-mode: standalone)").matches === true;
  if (!standalone) return 0;
  // env() is only readable off a laid-out box — getComputedStyle hands back
  // the unresolved token stream for a custom property holding it.
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;height:env(safe-area-inset-top, 0px)";
  (document.body || document.documentElement).appendChild(probe);
  const insetTop = probe.getBoundingClientRect().height;
  probe.remove();
  if (insetTop <= 0) return 0;
  const short = (window.screen?.height || 0) - window.innerHeight;
  return short > 0 ? Math.min(short, insetTop) : 0;
};

// ── Reading an inset from JS ──────────────────────────────────────
// The same probe measureVpDrop uses, pointed at the bottom inset and
// exported, because the bottom-nav clearance needs this as a NUMBER.
//
// It used to be CSS — `max(<measured>px, calc(env(safe-area-inset-bottom) +
// 72px))` — which reads well and puts the floor exactly where it belongs. But
// a CSS function that an engine won't parse takes its whole declaration with
// it, and the failure mode of this particular declaration is content sitting
// under the bar with no scroll left to reach it. A number can't be dropped.
export const readSafeAreaBottom = () => {
  if (typeof document === "undefined") return 0;
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;height:env(safe-area-inset-bottom, 0px)";
  (document.body || document.documentElement).appendChild(probe);
  const inset = probe.getBoundingClientRect().height;
  probe.remove();
  return inset > 0 ? inset : 0;
};

export const syncVpDrop = () => {
  if (typeof document === "undefined") return 0;
  const drop = measureVpDrop();
  document.documentElement.style.setProperty("--bc-vp-drop", `${drop}px`);
  return drop;
};

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

  // ── Seat the bottom edge (see VP_DROP above) ──
  // Measured before React mounts so the nav never paints in the wrong place,
  // and re-measured on the events that can change it. Both listeners are for
  // the lifetime of the document, so there is nothing to tear down.
  syncVpDrop();
  window.addEventListener("resize", syncVpDrop);
  window.addEventListener("orientationchange", syncVpDrop);
}
