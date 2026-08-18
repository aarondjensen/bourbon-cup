// ══════════════════════════════════════════════════════════════════
//  Icons — the app's line glyphs, as SVG rather than emoji.
// ══════════════════════════════════════════════════════════════════
//
// Emoji were free and they cost more than they saved. Three things go wrong
// with 🔒 / 🗑 / ✎ side by side on a row, and all three showed up at once in
// the tournaments picker:
//
//   • THEY IGNORE `color`. A colour font paints its own palette, so a padlock
//     is yellow whatever the theme says. That is why lock state had to be
//     carried by `opacity` and `grayscale(1)` — a switch whose only two
//     positions were "bright" and "washed out".
//   • THEY ARE NOT ONE FAMILY. 🔒 and 🗑 render as full-colour pictures; ✎ is
//     a thin text glyph that takes `color` like ordinary type. Set at the same
//     px they read as three different weights, and the pencil disappeared next
//     to a padlock that shouts.
//   • THEY ARE THE PLATFORM'S, NOT OURS. The same character is a different
//     drawing on iOS, Android and a desktop browser — three shells off one
//     codebase, three pictures.
//
// So: one stroke weight, `currentColor` throughout, sized by the caller.
// `color` works, which means a locked year can light AMBER and an unlocked one
// can sit in `BC.t3` — state carried by the theme's own ink rather than by
// washing a picture out.
//
// `aria-hidden` by default, because an icon beside a word is decoration; a
// control with no visible label passes its own `title`/`aria-label` on the
// BUTTON, which is where a screen reader wants it.
const base = (size) => ({
  width: size, height: size, display: "block", flexShrink: 0,
});

function Glyph({ size = 16, width = 1.6, children }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" style={base(size)}
      fill="none" stroke="currentColor" strokeWidth={width}
      strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export const IconPencil = (p) => (
  <Glyph {...p}><path d="M13.5 3.5a1.6 1.6 0 0 1 2.3 2.3L7.4 14.2 4 15l.8-3.4Z" /></Glyph>
);

// Shackle down = shut. The open one lifts the shackle off the right-hand
// side, which is the difference emoji could not carry at 12px: 🔒 and 🔓 are
// the same yellow padlock with a shackle tilted a few degrees.
export const IconLock = (p) => (
  <Glyph {...p}>
    <rect x="4.5" y="8.8" width="11" height="7.2" rx="1.6" />
    <path d="M7 8.8V6.6a3 3 0 0 1 6 0v2.2" />
  </Glyph>
);

export const IconUnlock = (p) => (
  <Glyph {...p}>
    <rect x="4.5" y="8.8" width="11" height="7.2" rx="1.6" />
    <path d="M7 8.8V6.6a3 3 0 0 1 6 0" />
  </Glyph>
);

export const IconTrash = (p) => (
  <Glyph {...p}><path d="M4.5 6h11M8 6V4.6h4V6M6.4 6l.6 9.4h6l.6-9.4" /></Glyph>
);

// Points at what is behind the tap. On a list row it is the whole promise
// that the row does something.
export const IconChevron = (p) => (
  <Glyph {...p}><path d="M8 5l5 5-5 5" /></Glyph>
);

// Two arrows passing — "swap this for another one". Used for the status
// picker, where the action is replacing one value with a different one rather
// than adding or removing anything.
export const IconSwap = (p) => (
  <Glyph {...p}><path d="M6 7h9l-2.4-2.4M14 13H5l2.4 2.4" /></Glyph>
);
