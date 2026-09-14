/** @vitest-environment jsdom */
// ══════════════════════════════════════════════════════════════════
//  ErrorBoundary — the fallback, and the one owner that wants telling.
// ══════════════════════════════════════════════════════════════════
//
// Most of this app recovers from a crash by being navigated away from: the
// view boundary is keyed on the tab, so switching tabs remounts it clean.
//
// The Final Countdown is the exception, and it is the exception on the one
// night of the year nobody can fix it. It runs on a television nobody is
// standing at, opened by a #countdown hash that survives a reload, and it is
// mounted through a portal — so its nearest boundary WAS the keyed one around
// the whole tab. A crash there took the scoreboard with it and then re-opened
// itself on every recovery route there is.
//
// `onError` is what closes that loop: the countdown's own boundary uses it to
// clear the hash. These pin the contract it depends on.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { createPortal } from "react-dom";
import ErrorBoundary from "./ErrorBoundary";

// A child that throws on render, the way a real one would.
function Boom({ when = true }) {
  if (when) throw new Error("boom");
  return <div>fine</div>;
}

describe("ErrorBoundary", () => {
  let spy;
  beforeEach(() => { spy = vi.spyOn(console, "error").mockImplementation(() => {}); });
  // No global setup file in this repo — every component suite cleans up for
  // itself, or a portal from an earlier test is still on document.body when
  // the next one queries it.
  afterEach(() => { cleanup(); spy.mockRestore(); });

  it("renders its children when nothing throws", () => {
    render(<ErrorBoundary><div>fine</div></ErrorBoundary>);
    expect(screen.getByText("fine")).toBeTruthy();
  });

  it("shows the fallback instead of a blank screen when a child throws", () => {
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByText("Reload App")).toBeTruthy();
  });

  it("tells an owner that asked, with the error", () => {
    const onError = vi.fn();
    render(<ErrorBoundary onError={onError}><Boom /></ErrorBoundary>);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toBe("boom");
  });

  it("still shows the fallback when the handler itself throws", () => {
    // A handler that throws inside componentDidCatch would otherwise replace
    // a caught error with an uncaught one — and take the tree it was called
    // in to save.
    const onError = () => { throw new Error("the handler is broken too"); };
    expect(() => render(<ErrorBoundary onError={onError}><Boom /></ErrorBoundary>)).not.toThrow();
    expect(screen.getByText("Something went wrong")).toBeTruthy();
  });

  it("is not called when nothing throws", () => {
    const onError = vi.fn();
    render(<ErrorBoundary onError={onError}><Boom when={false} /></ErrorBoundary>);
    expect(onError).not.toHaveBeenCalled();
  });

  // ── The countdown's shape, in miniature ──────────────────────────
  // A portal's children stay in the React tree of whoever created them, so
  // this is the arrangement the Leaderboard actually builds: a boundary
  // INSIDE the portal, with the scoreboard as its sibling outside.
  it("contains a crash inside a portal without taking its sibling", () => {
    const onError = vi.fn();
    function Tab() {
      return (
        <div>
          <div>THE SCOREBOARD</div>
          {createPortal(
            <ErrorBoundary onError={onError}><Boom /></ErrorBoundary>,
            document.body,
          )}
        </div>
      );
    }
    render(<Tab />);
    // The reveal is gone and said so...
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    // ...and the board behind it is still there, which is what the keyed
    // boundary around the whole tab could not promise.
    expect(screen.getByText("THE SCOREBOARD")).toBeTruthy();
    // And the owner was told, so the hash gets cleared and a reload lands on
    // the board rather than back on the screen that just threw.
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
