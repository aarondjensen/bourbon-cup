// ══════════════════════════════════════════════════════════════════
//  Popup — the structure holding the close button and the scroll
// ══════════════════════════════════════════════════════════════════
//
// BC's first component tests. They render through `renderToStaticMarkup` rather
// than jsdom, which is how MNQ tests its components: no jsdom, no
// testing-library, no new dependency, and it reaches exactly what these tests
// need to reach — the structure. WBC uses jsdom because it tests behaviour;
// this file tests SHAPE, and shape survives a string.
//
// Everything pinned here is invisible in a passing render, which is why it is
// pinned. The popup looks correct in all of these cases right up until the
// content is tall enough, and then one of them strands the user in a modal
// they cannot close.
//
// Note these render under Node, where `document` is undefined — which is the
// branch where Popup skips the portal and returns the overlay inline. The
// markup below is therefore the overlay itself, portal prop or not.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Popup, ConfirmModal } from "./Popup.jsx";

const tall = Array.from({ length: 200 }, (_, i) => <div key={i}>row {i}</div>);
const render = (el) => renderToStaticMarkup(el);

// The backdrop scrolls too, so "overflow-y:auto" alone matches two elements and
// would quietly assert against the wrong one. `min-height:0` is unique to the
// inner scroller — it is what lets a flex child shrink below its content.
const SCROLLER = "min-height:0";

describe("Popup structure", () => {
  // The bug this exists to prevent: the card used to be the scroller, with the
  // ✕ absolutely positioned inside it. An absolute box inside a scrolling
  // container scrolls with the content, so on a tall popup the close button
  // left the screen and there was no way to shut the thing.
  it("puts the scroll on an inner element, not on the card holding the ✕", () => {
    const html = render(<Popup onClose={() => {}} showClose>{tall}</Popup>);
    const closeIdx = html.indexOf('aria-label="Close"');
    const scrollerIdx = html.indexOf(SCROLLER);
    expect(closeIdx).toBeGreaterThan(-1);
    expect(scrollerIdx).toBeGreaterThan(-1);
    // The ✕ is a SIBLING that precedes the scrolling region, not a descendant
    // of it. That ordering is the whole fix.
    expect(closeIdx).toBeLessThan(scrollerIdx);
  });

  it("gives the card itself no scroll to steal", () => {
    const html = render(<Popup onClose={() => {}} showClose>{tall}</Popup>);
    expect(html).toContain("overflow:hidden");
  });

  // Load-bearing, not decoration: usePullToRefresh walks up from the touch
  // target and bails when it crosses this, which is how every popup suppresses
  // the page's pull-to-refresh without anyone registering it anywhere.
  it("marks the backdrop for the pull-to-refresh walk", () => {
    expect(render(<Popup onClose={() => {}}>hi</Popup>)).toContain("data-popup");
  });

  it("only renders a close button when asked, and only with something to call", () => {
    expect(render(<Popup onClose={() => {}}>hi</Popup>)).not.toContain('aria-label="Close"');
    expect(render(<Popup showClose>hi</Popup>)).not.toContain('aria-label="Close"');
    expect(render(<Popup onClose={() => {}} showClose>hi</Popup>)).toContain('aria-label="Close"');
  });

  // A viewportFit popup sizes itself to the visible rect above the iOS
  // keyboard and lets its content do its own scrolling. If the wrapper started
  // scrolling too, a form with a text field would scroll in two places at once.
  it("leaves scrolling to the content in viewportFit mode", () => {
    const html = render(<Popup onClose={() => {}} viewportFit>{tall}</Popup>);
    expect(html).not.toContain("overflow-y:auto");
  });

  // Several callers pass display:flex + flexDirection to size children against
  // the popup. The children now sit a level deeper than they used to, so that
  // flex context has to travel with them or those popups lose their sizing.
  it("carries a caller's flex layout through to where the children actually are", () => {
    const html = render(
      <Popup onClose={() => {}} innerStyle={{ display: "flex", flexDirection: "column" }}>hi</Popup>
    );
    expect(html.match(/flex-direction:column/g)?.length).toBeGreaterThanOrEqual(2);
  });

  // The rest of innerStyle dresses the FRAME. If the background moved inward
  // with the layout, the card would show the default surface behind a
  // differently-coloured scroller.
  it("leaves a caller's background on the frame", () => {
    const html = render(<Popup onClose={() => {}} innerStyle={{ background: "rgb(1, 2, 3)" }}>hi</Popup>);
    const frameIdx = html.indexOf("rgb(1, 2, 3)");
    expect(frameIdx).toBeGreaterThan(-1);
    expect(frameIdx).toBeLessThan(html.indexOf(SCROLLER));
  });

  // The app's font is set per view root rather than globally, so a popup
  // portaled to <body> would otherwise render in the browser default.
  it("declares the app font, since a portaled popup inherits nothing", () => {
    expect(render(<Popup onClose={() => {}}>hi</Popup>)).toContain("Montserrat");
  });
});

describe("ConfirmModal", () => {
  // The nullable-state gate. useConfirm passes null while idle, and a
  // ConfirmModal that rendered a bare card for it would put an empty box on
  // screen every time nothing was being confirmed.
  it("renders nothing when idle", () => {
    expect(render(<ConfirmModal modal={null} />)).toBe("");
    expect(render(<ConfirmModal />)).toBe("");
  });

  it("renders nothing with neither a title nor a message", () => {
    expect(render(<ConfirmModal modal={{ onConfirm: () => {} }} />)).toBe("");
  });

  it("takes both the modal-prop and the inline-prop call styles", () => {
    expect(render(<ConfirmModal modal={{ title: "Remove?" }} />)).toContain("Remove?");
    expect(render(<ConfirmModal title="Remove?" />)).toContain("Remove?");
  });

  // `alert` is an informational notice with nothing to decide. Leaving Cancel
  // on it asks a question that has no second answer.
  it("drops Cancel for an alert, and says OK instead of Confirm", () => {
    const html = render(<ConfirmModal modal={{ title: "Heads up", alert: true }} />);
    expect(html).not.toContain("Cancel");
    expect(html).toContain("OK");
  });

  it("offers both choices otherwise", () => {
    const html = render(<ConfirmModal modal={{ title: "Remove?" }} />);
    expect(html).toContain("Cancel");
    expect(html).toContain("Confirm");
  });

  it("takes custom labels", () => {
    const html = render(<ConfirmModal modal={{ title: "x", confirmLabel: "Delete it", cancelLabel: "Keep" }} />);
    expect(html).toContain("Delete it");
    expect(html).toContain("Keep");
  });

  // Both spellings reach the same red, and a destructive confirm that renders
  // in the ordinary amber is a delete button dressed as a save button.
  it("renders destructive in danger colours either way it is asked", () => {
    const viaFlag = render(<ConfirmModal modal={{ title: "x", destructive: true }} />);
    const viaVariant = render(<ConfirmModal modal={{ title: "x", variant: "danger" }} />);
    const plain = render(<ConfirmModal modal={{ title: "x" }} />);
    expect(viaFlag).toBe(viaVariant);
    expect(viaFlag).not.toBe(plain);
  });
});
