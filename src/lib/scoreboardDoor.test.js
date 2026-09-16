// The scoreboard door — "View the leaderboard" on the sign-in screen, and
// the app it opens: the leaderboard, with nothing else reachable from it.
//
// Source assertions rather than a mounted tree, the same trade
// gateScreenWording.test.js makes and for the same reasons: App.jsx is ~6k
// lines and pulls in Firebase, and what needs holding here is a handful of
// structural decisions that are each one deleted line away from quietly
// becoming untrue. "Nothing else" is not a thing a screenshot can prove;
// it is four places in one file agreeing.
//
// The flag itself is behaviour and is tested where it lives — lib/guest.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");

// Comments stripped, so this file's own explanations of what board mode
// withholds are never read as the withholding.
const code = src
  .split("\n")
  .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.trim().startsWith("/*"))
  .join("\n");

const signIn = (() => {
  const start = code.indexOf("function SignInScreen(");
  return start < 0 ? "" : code.slice(start, code.indexOf("\nfunction ", start + 10));
})();

describe("the door on the sign-in screen", () => {
  it("is found, so the rest of this file means something", () => {
    expect(signIn.length).toBeGreaterThan(500);
  });

  it("offers the leaderboard, in those words", () => {
    // The public's whole reason for opening the site. If this button is
    // ever renamed, rename it here too — but do not delete it.
    expect(signIn).toMatch(/>View the leaderboard</);
  });

  it("wires it to its own handler, not the guest link's", () => {
    // Both doors take the same identity, and that is exactly why they are
    // easy to collapse into one. They are not the same door: one hands over
    // the whole app read-only, the other one screen.
    expect(signIn).toMatch(/onClick=\{onBoard\}/);
    expect(signIn).toMatch(/onClick=\{onGuest\}/);
  });

  it("is still not the primary action on a tournament's login screen", () => {
    // The two provider buttons are the way in for the men playing. A filled
    // button here would outrank them.
    expect(signIn).toMatch(/onClick=\{onBoard\}[\s\S]{0,400}background: "transparent"/);
  });
});

describe("the app it opens", () => {
  it("only counts as board mode for a guest", () => {
    // A stale flag must never pin a signed-in player to one screen.
    expect(code).toMatch(/const boardOnly = guesting && boardMode;/);
  });

  it("pins the view rather than merely hiding the way off it", () => {
    // The nav and the menu are withheld below, but `setView` is also reached
    // by a deep-linked hash, which would strand a reader on a tab with
    // nothing to navigate away with.
    expect(code).toMatch(/const view = boardOnly \? "leaderboard" : viewState;/);
  });

  it("withholds the bottom nav's tabs", () => {
    expect(code).toMatch(/\{boardOnly \? \([\s\S]{0,900}\) : \([\s\S]{0,400}navItems\.map/);
  });

  it("does not render the slide menu at all", () => {
    expect(code).toMatch(/\{!boardOnly && \(\s*<SlideMenu/);
  });

  it("leaves a way out", () => {
    // No nav means no My Account, which is where every other exit lives.
    expect(code).toMatch(/onClick=\{exitBoard\}/);
    expect(code).toMatch(/const exitBoard = useCallback/);
  });
});
