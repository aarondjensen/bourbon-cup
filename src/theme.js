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
// ─── BOURBON CUP THEME — Mash Brothers Edition ───
// Design philosophy — temporary all-Mash skin while internal practice rounds
// are the focus. Mash Brothers brand green (#009144 deep / #004d24 deeper)
// becomes the PRIMARY accent everywhere amber used to live: active tabs,
// hole nav banner, score-button selection, auto-advance toast, MASH ROUND
// header, leaderboard active states. Bourbon brown is demoted to a
// SECONDARY accent and used only where it carries real "Bourbon Cup"
// brand meaning — the login screen title and the trophy silhouette
// glow. Net effect: the app reads as Mash team property with bourbon
// as the parent-tournament flavor.
//
// Implementation note — `BC.amber` keeps its key name despite now holding
// green values. Renaming would require touching ~100 call sites; instead,
// the convention is "BC.amber = primary brand accent (whatever color
// that currently is)" and "BC.gold = bourbon brown secondary accent".
// The few places that genuinely need bourbon brown (login title) read
// from BC.gold explicitly.
//
// Light mode is paper-with-a-whisper-of-green — like the natural fiber
// of a Mash Brothers scorecard. Dark mode evokes the black-bg/green-flag
// palette of the team logo itself, with a subtle green undertone in the
// "near-black" so the green accent reads as part of a deliberate system
// rather than as a pop of color floating on neutral charcoal.
export const getBCTheme = (mode) => {
  if (mode === "light") {
    return {
      bg: "#f4f7f3",        // pale linen with whisper of Mash green
      card: "#ffffff",      // pure white card surface
      inp: "#e6ebe7",       // pale green-tinted gray (input/inactive)
      hover: "#d8dfd9",
      bdr: "#c4cfc6",       // soft green-tinted border
      t1: "#1a1f1c",        // near-black with cool/green tint
      t2: "#5a615c",        // medium neutral with green lean
      t3: "#8b918d",        // muted neutral, refined
      amber: "#009144",     // PRIMARY ACCENT — Mash Brothers brand green
      amberGlow: "rgba(0,145,68,0.14)",
      amberDim: "#004d24",  // Mash deep green (gradients, hover-state)
      gold: "#a8730a",      // SECONDARY ACCENT — bourbon brown (login title only)
      goldGlow: "rgba(168,115,10,0.10)",
      danger: "#c1272d",    // traditional deep red
      warn: "#c2570d",      // burnt orange
      green: "#047857",     // generic positive (distinct from brand accent)
      // Handicap blue — matches MNQ's K.hcpBlue exactly so users
      // moving between the two apps see consistent visual language for
      // handicap strokes / stroke dots / (CH) labels. Tailwind blue-500.
      hcpBlue: "#3b82f6",
    };
  }
  // dark (default) — Mash logo "black bg + green flag" inspired
  return {
    bg: "#0a1410",          // near-black with green undertone (Mash logo bg)
    card: "#121d18",        // elevated panel
    inp: "#0e1813",         // sunken input
    hover: "#1a2922",
    bdr: "#1f3026",         // subtle green-tinted border
    t1: "#e8eee9",          // slightly green-tinted clean white
    t2: "#a3aea7",          // green-leaning medium gray
    t3: "#6b766f",          // green-leaning muted gray
    amber: "#16a34a",       // PRIMARY ACCENT — brightened Mash green for dark
    amberGlow: "rgba(22,163,74,0.20)",
    amberDim: "#15803d",
    gold: "#d4a843",        // SECONDARY ACCENT — bourbon brown
    goldGlow: "rgba(212,168,67,0.12)",
    danger: "#ef4444",
    warn: "#f59e0b",
    green: "#22c55e",
    hcpBlue: "#3b82f6",
  };
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

export const applyBCTheme = (mode) => {
  const next = getBCTheme(mode);
  for (const key in next) BC[key] = next[key];
};

// ── Inject global styles ──
// The body bg is set on initial load so the page paints the correct theme
// before React mounts. A useEffect in App keeps it in sync when the user
// toggles the theme (the inline rule below would otherwise be stale).
// The element id is fixed so App can `getElementById` and replace
// .textContent on theme toggle.
if (typeof document !== "undefined") {
  const _style = document.createElement("style");
  _style.id = "bc-global-style";
  _style.textContent = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body, #root { height: 100%; width: 100%; background: ${BC.bg}; overflow: hidden; }
    body { margin: 0; padding: 0; }
    /* Native form controls don't inherit font-family by default — they
       reset to the system UI font (San Francisco / Roboto / Segoe UI).
       Force inheritance so every button/input/select picks up Montserrat
       from its container without needing fontFamily set inline. */
    button, input, select, textarea { font-family: inherit; }
  `;
  document.head.appendChild(_style);

  // ── Inject Montserrat font ──
  const _link = document.createElement("link");
  _link.rel = "stylesheet";
  _link.href = "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap";
  document.head.appendChild(_link);
}
