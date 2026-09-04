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

  it("says plainly that it is not an account password", () => {
    expect(gate).toMatch(/not<\/strong> a password|not a password/);
  });

  it("tells the reviewer the sign-in already worked", () => {
    expect(gate).toMatch(/Your account is all set/);
  });

  // type="password" would make a browser and a reviewer both read it as a
  // credential, and there is nothing to mask from a man on the same tee box.
  it("is not a password input", () => {
    expect(gate).not.toMatch(/type="password"/);
  });
});
