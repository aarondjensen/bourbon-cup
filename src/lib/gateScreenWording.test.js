// The one screen whose WORDING is a store requirement.
//
// App Review rejected 1.0 (2) under guideline 4 on 4 Sep 2026: "users are
// required to provide or create a password after using Sign in with Apple".
// Nothing was wrong with the mechanism — one shared code for a private
// group, the same string for sixteen men, authenticating nobody — but the
// box said "Password" one tap after Sign in with Apple, and that is what a
// reviewer reads.
//
// A source assertion rather than a mounted component, deliberately:
// App.jsx is ~6k lines and pulls in Firebase, and what needs pinning is a
// string, not behaviour. If GateScreen is ever renamed this fails loudly,
// which is the right failure — somebody should re-read this note.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
const start = src.indexOf("function GateScreen(");
// Comments stripped, because this file's own note explains why the input is
// NOT type="password" — and a check that reads its own explanation as the
// thing it forbids is worse than no check.
const gate = src
  .slice(start, src.indexOf("\nfunction ", start + 10))
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

describe("the invite-code screen", () => {
  it("is found, so the rest of this file means something", () => {
    expect(start).toBeGreaterThan(-1);
    expect(gate.length).toBeGreaterThan(500);
  });

  it("never labels the field a password", () => {
    expect(gate).not.toMatch(/placeholder="[^"]*[Pp]assword/);
  });

  // The three lines, in order. The order is the argument a reviewer reads:
  // the account is already signed in, the tournament is a separate and
  // private thing, and the box wants an invite to it. Nothing asks anybody
  // to create anything.
  it("says the account is already signed in, before asking for anything", () => {
    const signedIn = gate.indexOf("Signed in as:");
    const isPrivate = gate.indexOf("This tournament is private");
    const enter = gate.indexOf("Enter the invite code below");
    expect(signedIn).toBeGreaterThan(-1);
    expect(isPrivate).toBeGreaterThan(signedIn);
    expect(enter).toBeGreaterThan(isPrivate);
  });

  // "Enter" and never "create", "choose" or "set" — the guideline is about
  // being made to PROVIDE OR CREATE a password after Sign in with Apple, and
  // a verb that implies making one up is the same rejection in a new word.
  it("asks the code to be entered, never created", () => {
    expect(gate).not.toMatch(/\b(create|choose|set up|make) (a|your) (code|password)/i);
  });

  // type="password" would make a browser and a reviewer both read it as a
  // credential, and there is nothing to mask from a man on the same tee box.
  it("is not a password input", () => {
    expect(gate).not.toMatch(/type="password"/);
  });
});

// ── The claim screen ────────────────────────────────────────────────
// App Review rejected 1.0 (3) under 2.1(a): "redirects to the Select your
// Name screen after tapping on the Link this Account button". Nothing
// redirected. The claim was refused, and doClaim then cleared the picked
// player — which emptied the confirm bar and un-highlighted the name, so
// the screen looked exactly as it had before the tap.
const claimStart = src.indexOf("function ClaimScreen(");
const claim = src
  .slice(claimStart, src.indexOf("\n// ", claimStart + 10))
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

describe("a refused claim", () => {
  it("finds the screen, so the rest of this block means something", () => {
    expect(claimStart).toBeGreaterThan(-1);
    expect(claim).toMatch(/doClaim/);
  });

  // The pick surviving is what tells the eye the tap was received: the name
  // stays lit and the button stays on screen, with the reason beside them.
  it("keeps the picked player", () => {
    const body = claim.slice(claim.indexOf("const doClaim"), claim.indexOf("onClaimed(res.player)"));
    expect(body).not.toMatch(/setPicked\(null\)/);
  });

  it("says so somewhere a reviewer cannot miss", () => {
    expect(claim).toMatch(/role="alert"/);
    expect(claim).toMatch(/wasn&rsquo;t linked|wasn't linked/);
  });
});
