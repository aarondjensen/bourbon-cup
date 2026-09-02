// The Credential Manager fallback, and the two times it must NOT fire.
//
// Android's Credential Manager threw NoCredentialException on the first
// Android phone the app was ever installed on — a phone with the right
// Google account signed in and the right signing certificate registered.
// The golfer saw the bare string "No credentials available" and had no way
// forward. The older intent flow works there and the plugin keeps it behind
// one option, so a refusal costs a retry rather than the sign-in.
import { describe, it, expect, vi, beforeEach } from "vitest";

let platform = "android";
vi.mock("./platform", () => ({
  isNative: () => platform !== "web",
  isNativeAndroid: () => platform === "android",
}));
vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(), initializeAuth: vi.fn(), indexedDBLocalPersistence: {},
  GoogleAuthProvider: class { static credential() { return {}; } },
  OAuthProvider: class { credential() { return {}; } },
  signInWithPopup: vi.fn(), signInWithRedirect: vi.fn(), getRedirectResult: vi.fn(),
  onAuthStateChanged: vi.fn(), signOut: vi.fn(), signInWithCredential: vi.fn(),
}));
vi.mock("../firebase", () => ({ firebaseApp: {} }));

const { googleNative } = await import("./auth");

const OK = { credential: { idToken: "t" } };
const noCredential = () => Object.assign(new Error("No credentials available"), { code: "unknown" });

beforeEach(() => { platform = "android"; });

describe("googleNative", () => {
  it("does not touch the fallback when Credential Manager works", async () => {
    const plugin = { signInWithGoogle: vi.fn(async () => OK) };
    expect(await googleNative(plugin)).toBe(OK);
    expect(plugin.signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(plugin.signInWithGoogle).toHaveBeenCalledWith();
  });

  it("retries through the intent flow when Credential Manager refuses", async () => {
    const plugin = { signInWithGoogle: vi.fn()
      .mockRejectedValueOnce(noCredential())
      .mockResolvedValueOnce(OK) };
    expect(await googleNative(plugin)).toBe(OK);
    expect(plugin.signInWithGoogle).toHaveBeenNthCalledWith(2, { useCredentialManager: false });
  });

  // Reopening the account sheet under the thumb that just dismissed it is
  // the rudest possible reading of a Back tap.
  it("never retries a cancel", async () => {
    const plugin = { signInWithGoogle: vi.fn()
      .mockRejectedValue(Object.assign(new Error("cancelled"), { code: "auth/cancelled-popup-request" })) };
    await expect(googleNative(plugin)).rejects.toThrow();
    expect(plugin.signInWithGoogle).toHaveBeenCalledTimes(1);
  });

  // The option is Android-only. On iOS the retry fails identically and only
  // doubles the wait before the error appears.
  it("does not retry on iOS", async () => {
    platform = "ios";
    const plugin = { signInWithGoogle: vi.fn().mockRejectedValue(noCredential()) };
    await expect(googleNative(plugin)).rejects.toThrow(/No credentials/);
    expect(plugin.signInWithGoogle).toHaveBeenCalledTimes(1);
  });

  // A second refusal is the real answer; it must reach the user rather than
  // loop.
  it("surfaces a fallback failure instead of retrying again", async () => {
    const plugin = { signInWithGoogle: vi.fn().mockRejectedValue(noCredential()) };
    await expect(googleNative(plugin)).rejects.toThrow();
    expect(plugin.signInWithGoogle).toHaveBeenCalledTimes(2);
  });
});
