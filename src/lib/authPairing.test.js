// Moving a claimed name to a new sign-in — the client half.
//
// The code is read off one phone and typed into another, usually by somebody
// standing up. Everything pinned here is about that trip. See lib/authPairing.
import { describe, it, expect } from "vitest";
import {
  cleanCode, isCompleteCode, formatCode, expiryLabel,
  pairingError, PAIRING_ALPHABET, PAIRING_LENGTH,
} from "./authPairing";

describe("the alphabet", () => {
  it("leaves out the four characters that get mistyped", () => {
    expect(PAIRING_ALPHABET).not.toMatch(/[IO01]/);
    expect(PAIRING_LENGTH).toBe(8);
  });
});

describe("cleanCode", () => {
  it("takes what somebody actually types", () => {
    expect(cleanCode("abcd efgh")).toBe("ABCDEFGH");
    expect(cleanCode("ABCD-EFGH")).toBe("ABCDEFGH");
    expect(cleanCode("  abcdefgh  ")).toBe("ABCDEFGH");
  });

  it("does not try to correct the four the alphabet leaves out", () => {
    // The alphabet excludes I, O, 0 AND 1, so none of them can appear in a
    // real code and none can be confused for another. A fold here would turn
    // a typo into a different typo — the exclusion is what does the work.
    expect(cleanCode("ABCD0FGH")).toBe("ABCD0FGH");
    expect(isCompleteCode("ABCD0FGH")).toBe(false);
  });

  it("stops at eight, so a double-paste is not a different code", () => {
    expect(cleanCode("ABCDEFGHABCDEFGH")).toBe("ABCDEFGH");
  });

  it("survives nothing at all", () => {
    expect(cleanCode(null)).toBe("");
    expect(cleanCode(undefined)).toBe("");
  });
});

describe("isCompleteCode", () => {
  it("is false while somebody is still typing", () => {
    // Short is not wrong — the button simply is not ready.
    expect(isCompleteCode("ABCD")).toBe(false);
    expect(isCompleteCode("")).toBe(false);
  });
  it("is true for a full code, folded characters included", () => {
    expect(isCompleteCode("ABCDEFGH")).toBe(true);
    expect(isCompleteCode("abcd efgh")).toBe(true);
  });
});

describe("formatCode", () => {
  it("puts one gap in the middle, for reading aloud", () => {
    expect(formatCode("ABCDEFGH")).toBe("ABCD EFGH");
  });
  it("does not add a trailing gap while it is being typed", () => {
    expect(formatCode("ABCD")).toBe("ABCD");
    expect(formatCode("ABCDE")).toBe("ABCD E");
  });
});

describe("expiryLabel", () => {
  const now = 1_000_000;
  it("counts up, not down to zero", () => {
    expect(expiryLabel(now + 15 * 60_000, now)).toBe("Expires in 15 minutes");
    expect(expiryLabel(now + 60_000, now)).toBe("Expires in 1 minute");
  });
  it("says so once it is dead", () => {
    expect(expiryLabel(now - 1, now)).toBe("Expired");
    expect(expiryLabel(undefined, now)).toBe("Expired");
  });
});

describe("pairingError", () => {
  it("names the undeployed case, because retrying can never fix it", () => {
    // The functions are deployed by hand, like the rules.
    expect(pairingError({ code: "functions/not-found" })).toContain("deployed");
  });

  it("does NOT confuse an unknown code with an undeployed function", () => {
    // Both would be `not-found` if the function used that code for a bad
    // pairing; the advice for the two is opposite, so the function throws
    // invalid-argument and carries its own wording.
    const bad = pairingError({ code: "functions/invalid-argument", message: "That code isn't valid. Ask for a new one." });
    expect(bad).toBe("That code isn't valid. Ask for a new one.");
    expect(bad).not.toContain("deployed");
  });

  it("passes through the wording the function wrote for the reader", () => {
    expect(pairingError({
      code: "functions/failed-precondition",
      message: "Enter the tournament's invite code first, then move your name across.",
    })).toContain("invite code");
  });

  it("tells an expired code apart from a wrong one", () => {
    expect(pairingError({ code: "functions/deadline-exceeded" })).toContain("expired");
  });

  it("sends somebody whose session went away to sign in, not to retry", () => {
    expect(pairingError({ code: "functions/unauthenticated" })).toContain("Sign in again");
  });

  it("falls back rather than showing nothing", () => {
    expect(pairingError({}, "nope")).toBe("nope");
  });
});
