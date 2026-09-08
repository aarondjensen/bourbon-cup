// Which devices get a service worker, and — more importantly — which do not.
import { describe, it, expect, vi } from "vitest";
import { shouldRegisterSW, registerAppServiceWorker, SW_URL, SW_SCOPE } from "./swRegister";

const base = { supported: true, isProd: true, isNative: false, protocol: "https:", hostname: "thebourboncup.com" };

describe("shouldRegisterSW", () => {
  it("registers on the deployed site", () => {
    expect(shouldRegisterSW(base)).toBe(true);
  });

  it("stays out of the way in dev", () => {
    // Vite serves modules unbundled and reloads them constantly; a worker
    // caching that serves yesterday's code to whoever is editing it.
    expect(shouldRegisterSW({ ...base, isProd: false })).toBe(false);
  });

  it("does nothing in the native shells", () => {
    // Capacitor reads its assets out of the app bundle with no network in the
    // path — there is nothing for a cache to save.
    expect(shouldRegisterSW({ ...base, isNative: true })).toBe(false);
  });

  it("needs a secure context, and localhost counts as one", () => {
    expect(shouldRegisterSW({ ...base, protocol: "http:", hostname: "example.com" })).toBe(false);
    expect(shouldRegisterSW({ ...base, protocol: "http:", hostname: "localhost" })).toBe(true);
    expect(shouldRegisterSW({ ...base, protocol: "http:", hostname: "127.0.0.1" })).toBe(true);
  });

  it("does nothing where the browser has no support", () => {
    expect(shouldRegisterSW({ ...base, supported: false })).toBe(false);
  });

  it("refuses by default rather than on an empty environment", () => {
    expect(shouldRegisterSW()).toBe(false);
  });
});

describe("registerAppServiceWorker", () => {
  it("names the same script and scope lib/notifications does", async () => {
    // A scope has one registration. Two call sites naming the same pair makes
    // register() idempotent; naming different ones would have the caching
    // worker replace the push worker and turn notifications off for everyone.
    const register = vi.fn().mockResolvedValue("reg");
    await registerAppServiceWorker({ ...base, register });
    expect(register).toHaveBeenCalledWith(SW_URL, { scope: SW_SCOPE });
    expect(SW_URL).toBe("/firebase-messaging-sw.js");
    expect(SW_SCOPE).toBe("/");
  });

  it("does not call register at all where it should not", async () => {
    const register = vi.fn();
    expect(await registerAppServiceWorker({ ...base, isNative: true, register })).toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it("swallows a failed registration — this launch already has the files", async () => {
    const register = vi.fn().mockRejectedValue(new Error("nope"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(registerAppServiceWorker({ ...base, register })).resolves.toBeNull();
    warn.mockRestore();
  });
});
