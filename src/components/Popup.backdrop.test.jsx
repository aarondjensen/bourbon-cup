/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  What counts as "tapped outside" — the drag rule.
// ══════════════════════════════════════════════════════════════════
//
// Popup.test.jsx pins this component's SHAPE through a static render. This
// file is the other half: one rule that only exists as behaviour, and that
// cost a director a course.
//
// A browser fires `click` on the nearest common ancestor of the element the
// pointer went DOWN on and the one it came UP on. Highlight part of a course
// name in the Admin course editor and release past the edge of the card —
// which on a 390px phone is most of the screen — and that ancestor is the
// backdrop. The click lands on the backdrop directly, so the card's
// stopPropagation is not on the path and cannot help: the sheet closed at the
// exact moment the highlight finished, taking the draft with it.
//
// Reproduced in Chromium before the fix: press inside the name field, drag out
// past the card's left edge, release — and the editor is gone, with nothing
// selected because the field went with it.
//
// So a dismiss needs the whole gesture on the backdrop. The two mixed cases
// are a text selection (down inside, up outside) and a slip (down outside, up
// inside), and neither is somebody asking to close.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { Popup } from "./Popup.jsx";

afterEach(cleanup);

// Render a popup holding a text field, and hand back the two ends of every
// gesture below: the backdrop, and something well inside the card.
const mount = (props = {}) => {
  const onClose = vi.fn();
  render(<Popup onClose={onClose} {...props}><input defaultValue="Treetops" /></Popup>);
  const backdrop = document.querySelector("[data-popup]");
  const field = document.querySelector("input");
  expect(backdrop && field).toBeTruthy();
  return { onClose, backdrop, field };
};

// One gesture, start to finish. `click` goes to the nearest common ancestor of
// the two ends, which is what the browser does and what the old code had no
// way to tell apart from a tap.
const drag = ({ from, to, backdrop }) => {
  fireEvent.pointerDown(from);
  fireEvent.pointerUp(to);
  fireEvent.click(from === to ? from : backdrop);
};

describe("a backdrop dismiss", () => {
  it("closes on a tap that starts and ends on the backdrop", () => {
    const { onClose, backdrop } = mount();
    drag({ from: backdrop, to: backdrop, backdrop });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // The bug. Selecting text to retype it is the commonest drag anybody
  // performs inside a popup, and it ended with the popup gone.
  it("does not close when a selection is dragged out of a field", () => {
    const { onClose, backdrop, field } = mount();
    drag({ from: field, to: backdrop, backdrop });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close when a drag starts outside and ends in the card", () => {
    const { onClose, backdrop, field } = mount();
    drag({ from: backdrop, to: field, backdrop });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("still ignores an ordinary click inside the card", () => {
    const { onClose, field, backdrop } = mount();
    drag({ from: field, to: field, backdrop });
    expect(onClose).not.toHaveBeenCalled();
  });

  // Mouse events are the fallback where pointer events are missing, and they
  // have to reach the same verdict on their own.
  it("reads the gesture off mouse events too", () => {
    const { onClose, backdrop, field } = mount();
    fireEvent.mouseDown(field);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // The blocking popups opt out of the backdrop entirely; that is unchanged.
  it("stays shut off when the caller refuses backdrop closes", () => {
    const { onClose, backdrop } = mount({ noBackdropClose: true });
    drag({ from: backdrop, to: backdrop, backdrop });
    expect(onClose).not.toHaveBeenCalled();
  });
});
