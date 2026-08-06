import { describe, it, expect } from "vitest";
import { uploadFailureMessage } from "./media";

// These exist because the first version of this screen reported every upload
// failure as "couldn't be read" — decode, encode, network and permission
// errors all collapsed into one sentence that was wrong for three of them, on
// a phone with no console to check. The message IS the diagnostic here.
describe("uploadFailureMessage", () => {
  it("explains a refused write instead of printing storage/unauthorized", () => {
    const m = uploadFailureMessage({ code: "storage/unauthorized" });
    expect(m).not.toMatch(/storage\//);
    expect(m).toMatch(/sign out|director/i);
  });

  it("treats a Firestore permission-denied the same way", () => {
    expect(uploadFailureMessage({ code: "permission-denied" })).toMatch(/locked|director/i);
  });

  it("tells somebody with no signal to try again", () => {
    expect(uploadFailureMessage({ code: "storage/retry-limit-exceeded" })).toMatch(/signal|try again/i);
    expect(uploadFailureMessage({ code: "unavailable" })).toMatch(/signal|try again/i);
  });

  it("names a full bucket as a storage problem, not a photo problem", () => {
    expect(uploadFailureMessage({ code: "storage/quota-exceeded" })).toMatch(/full/i);
  });

  it("passes through the sentences mediaUpload.js writes for this screen", () => {
    const m = uploadFailureMessage(new Error("This phone couldn't open that photo."));
    expect(m).toBe("This phone couldn't open that photo.");
  });

  it("does not put a raw Firebase sentence on screen", () => {
    const m = uploadFailureMessage(new Error("Firebase Storage: User does not have permission (storage/unauthorized)"));
    expect(m).toBe("That photo couldn't be added.");
  });

  it("does not put a stack-length message on screen", () => {
    const m = uploadFailureMessage(new Error("x".repeat(400)));
    expect(m).toBe("That photo couldn't be added.");
  });

  it("falls back to something honest when there is nothing to go on", () => {
    expect(uploadFailureMessage(null)).toBe("That photo couldn't be added.");
    expect(uploadFailureMessage(new Error(""))).toBe("That photo couldn't be added.");
  });

  it("counts a batch so one message covers several failures", () => {
    expect(uploadFailureMessage({ code: "storage/unauthorized" }, 3)).toMatch(/\(3 photos\)/);
    expect(uploadFailureMessage({ code: "storage/unauthorized" }, 1)).not.toMatch(/photos\)/);
  });
});
