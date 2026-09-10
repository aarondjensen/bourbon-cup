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

  // The card is capped against the box it SITS IN, not against the page.
  // `calc(100vh - 32px)` was wrong twice over: 32 hardcoded the default
  // outerPadding, so a caller passing anything else got a card allowed to
  // overflow the overlay's own content box, and 100vh in mobile Safari is the
  // large viewport — the height with the toolbars retracted — which is taller
  // than the position:fixed overlay itself. Both ways the bottom of the card
  // hangs off the bottom of the screen, taking whatever sits on its bottom
  // edge with it. A percentage cannot be wrong about either.
  it("measures the card against the overlay, never against the viewport", () => {
    const html = render(<Popup onClose={() => {}} outerPadding={12}>{tall}</Popup>);
    expect(html).toContain("max-height:100%");
    expect(html).not.toContain("100vh");
  });

  // env() insets have to be written AFTER the `padding` shorthand. They used
  // to be spread in ahead of it, and a shorthand set later erases the
  // longhand — so the safe-area clearance every keyboard-aware modal thought
  // it had was being overwritten one property later and was never on screen.
  it("keeps the safe-area insets from being erased by the padding shorthand", () => {
    const html = render(<Popup onClose={() => {}}>hi</Popup>);
    const padIdx = html.indexOf("padding:16px");
    expect(padIdx).toBeGreaterThan(-1);
    expect(html.indexOf("padding-top:calc(env(safe-area-inset-top")).toBeGreaterThan(padIdx);
    expect(html.indexOf("padding-bottom:calc(env(safe-area-inset-bottom")).toBeGreaterThan(padIdx);
  });

  // A viewportFit overlay is already pinned to the visible rect, which ends at
  // the top of the keyboard. A home-indicator inset added below that is
  // clearance for glass that is not on screen any more.
  it("leaves the bottom inset off a keyboard-aware overlay", () => {
    const html = render(<Popup onClose={() => {}} viewportFit>hi</Popup>);
    expect(html).not.toContain("safe-area-inset-bottom");
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

// ── The typed gate and the reason box ──────────────────────────────
// Both are protections that only work by being IN THE WAY, and both fail
// silently in the direction that matters: a Confirm button that is live when
// it should be disabled looks exactly like one that is correctly live. These
// pin the disabled state, which is the half a passing render never shows.
describe("ConfirmModal — requireText", () => {
  it("is absent by default, and Confirm is live", () => {
    const html = render(<ConfirmModal modal={{ title: "x" }} />);
    expect(html).not.toContain("to continue");
    expect(html).not.toContain("disabled");
  });

  it("puts the word on screen and holds Confirm shut until it is typed", () => {
    const html = render(<ConfirmModal modal={{ title: "x", requireText: "AMEND" }} />);
    expect(html).toContain("Type AMEND to continue");
    expect(html).toContain("disabled");
  });

  it("never disables Cancel — the way out is not the thing being gated", () => {
    const html = render(<ConfirmModal modal={{ title: "x", requireText: "AMEND" }} />);
    // One disabled attribute only, and it is not on the Cancel button.
    expect(html.match(/disabled/g)).toHaveLength(1);
    expect(html.split("Cancel")[0]).not.toContain("disabled");
  });
});

describe("ConfirmModal — reasonPrompt", () => {
  it("asks for a reason and holds Confirm shut while it is empty", () => {
    const html = render(<ConfirmModal modal={{ title: "x", reasonPrompt: { label: "Reason" } }} />);
    expect(html).toContain("Reason");
    expect(html).toContain("<textarea");
    expect(html).toContain("disabled");
  });

  it("shows the placeholder it was given", () => {
    const html = render(<ConfirmModal modal={{
      title: "x", reasonPrompt: { label: "Reason", placeholder: "e.g. hole 7 was wrong" },
    }} />);
    expect(html).toContain("e.g. hole 7 was wrong");
  });

  // The amendment flow asks for both at once. Neither may be droppable by
  // satisfying the other.
  it("stacks with requireText rather than replacing it", () => {
    const html = render(<ConfirmModal modal={{
      title: "x", requireText: "AMEND", reasonPrompt: { label: "Reason" },
    }} />);
    expect(html).toContain("<textarea");
    expect(html).toContain("Type AMEND to continue");
  });

  // 16px is the floor mobile Safari zooms in under and does not zoom back out
  // of. Both boxes sit inside a modal a director reaches one-handed.
  it("keeps both inputs at the no-zoom type size", () => {
    const html = render(<ConfirmModal modal={{
      title: "x", requireText: "AMEND", reasonPrompt: { label: "Reason" },
    }} />);
    expect(html.match(/font-size:16px/g)?.length).toBe(2);
  });
});
