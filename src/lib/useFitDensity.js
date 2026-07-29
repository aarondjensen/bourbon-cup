// ══════════════════════════════════════════════════════════════════
//  useFitDensity — size a fixed-content screen to the device it's on.
// ══════════════════════════════════════════════════════════════════
//  The scoring screen has a fixed cast of parts: two hole strips, two
//  status rows, a hole banner and four player cards. Nothing about it is
//  a list you scroll — it is one screen you work from, with both hands,
//  standing on a tee box. Scrolling to reach the fourth player is the
//  difference between entering a score and fumbling for one.
//
//  Its natural height is around 745px. That fits a 14 Pro Max and misses
//  an SE by 200px, so no single set of sizes can serve both. Rather than
//  pick a compromise that's cramped on the big phone and still short on
//  the small one, the screen measures the room it actually has and picks
//  a density: the same parts, sized to the device.
//
//  Measured, not guessed from viewport height, because the room that
//  matters is what's left after the app header, the nav bar and the
//  home-indicator inset — and that last one only exists on some phones.
//
//  Thresholds are the height each density needs to fit its own content,
//  found by measuring, not by rounding to pretty numbers. See FIT_SIZES.

import { useState, useLayoutEffect } from "react";
import { FS } from "../theme";

// Sizes per density. Every vertical dimension the scoring screen spends
// meaningful room on appears here, so the whole budget can be read in one
// place instead of being chased through the render.
//
// `cardMax` is the ceiling on a player card. Without it the cards divide
// whatever a tablet has and the tap targets reach absurd sizes — a 113px
// score button is not a better score button. Past the ceiling the stack
// centres in the room it has instead of stretching into it.
export const FIT_SIZES = {
  roomy: {
    holeCell: 32, holeFont: FS.lead,
    statusCell: 29, statusBar: 8, statusPad: 4,
    nav: { pad: "4px 8px", gap: 6, nav: 36, num: FS.hero, label: FS.micro, side: FS.lead },
    scorecardPad: "5px 0",
    badge: true,
    stack: 4,
    cardPad: "6px 10px", cardGap: 4, cardMax: 104,
    btnMin: 44, btnFont: FS.lead, labels: true,
  },
  compact: {
    holeCell: 29, holeFont: FS.body,
    statusCell: 24, statusBar: 7, statusPad: 3,
    nav: { pad: "3px 8px", gap: 4, nav: 30, num: FS.title, label: FS.micro, side: FS.body },
    scorecardPad: "4px 0",
    badge: true,
    stack: 3,
    cardPad: "5px 9px", cardGap: 3, cardMax: 92,
    btnMin: 38, btnFont: FS.lead, labels: true,
  },
  tight: {
    holeCell: 26, holeFont: FS.small,
    statusCell: 20, statusBar: 6, statusPad: 2,
    nav: { pad: "2px 8px", gap: 3, nav: 26, num: FS.lead, label: FS.micro, side: FS.small },
    scorecardPad: "3px 0",
    // The format badge and the score labels are the two things that carry
    // no state — they name what's already on screen. On the smallest
    // phones that reference costs a row per card, so it goes first.
    badge: false,
    stack: 3,
    cardPad: "3px 8px", cardGap: 2, cardMax: 80,
    btnMin: 32, btnFont: FS.body, labels: false,
  },
};

// Room each density needs, measured against a four-card match. Anything
// below `tight`'s floor scrolls — there is a point past which shrinking a
// tap target does more harm than a scrollbar.
const ROOMY_NEEDS = 660;
const COMPACT_NEEDS = 530;

export function densityFor(usable) {
  if (!usable) return "roomy";
  if (usable >= ROOMY_NEEDS) return "roomy";
  if (usable >= COMPACT_NEEDS) return "compact";
  return "tight";
}

// Watches the nearest scroll container and reports how much room its
// CONTENT box has — its own padding excluded, since that's reserved for
// the nav bar and can't be built in.
//
// Measuring the container rather than the screen itself is deliberate: the
// screen grows with its content, so reading its height would let a density
// change feed back into the measurement that chose it.
export function useFitDensity(ref, selector = ".bc-app-body") {
  const [usable, setUsable] = useState(0);

  useLayoutEffect(() => {
    const host = ref.current?.closest(selector);
    if (!host) return;
    // The nav clearance is an ELEMENT at the end of the scroll content, not
    // bottom padding on the host (see App's bc-nav-spacer for why). It is
    // reserved room either way, so it comes off the same budget — reading
    // only the padding would hand the scoring screen ~100px it does not have
    // and push it a density too large for the phone it is on.
    const spacer = host.querySelector(".bc-nav-spacer");
    const read = () => {
      const cs = getComputedStyle(host);
      const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      const reserved = spacer ? spacer.getBoundingClientRect().height : 0;
      setUsable(Math.max(0, host.clientHeight - pad - reserved));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(host);
    // The spacer as well: it grows when the bar does, and that changes the
    // room left over without the host's own box moving at all.
    if (spacer) ro.observe(spacer);
    return () => ro.disconnect();
  }, [ref, selector]);

  const density = densityFor(usable);
  return { density, sizes: FIT_SIZES[density], usable };
}
