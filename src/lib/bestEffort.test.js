import { describe, it, expect, vi } from "vitest";
import { bestEffort } from "./bestEffort";

const silent = { warn: () => {} };

describe("bestEffort", () => {
  it("resolves with the step when it succeeds", async () => {
    await expect(bestEffort(Promise.resolve("done"), "step", 1000, silent))
      .resolves.toEqual({ ok: true });
  });

  it("swallows a rejection rather than propagating it", async () => {
    // The caller's next line has to run. A rejected optional step is the
    // case a try/catch already covered, and this must not regress it.
    await expect(bestEffort(Promise.reject(new Error("nope")), "step", 1000, silent))
      .resolves.toEqual({ ok: false, reason: "failed" });
  });

  it("gives up on a promise that NEVER settles", async () => {
    // The one this module exists for. `FirebaseMessaging.deleteToken()` on a
    // device whose project has no APNs key does exactly this: the bridge
    // records the call and no result ever arrives. A try/catch cannot see it.
    vi.useFakeTimers();
    try {
      const forever = new Promise(() => {});
      const race = bestEffort(forever, "hung step", 8000, silent);
      await vi.advanceTimersByTimeAsync(8000);
      await expect(race).resolves.toEqual({ ok: false, reason: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("names the step it gave up on", async () => {
    vi.useFakeTimers();
    try {
      const warn = vi.fn();
      const race = bestEffort(new Promise(() => {}), "push cleanup", 500, { warn });
      await vi.advanceTimersByTimeAsync(500);
      await race;
      // A log saying "something timed out" sends the next person reading it
      // to the wrong subsystem.
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("push cleanup"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not leave a timer pending when the step wins", async () => {
    // A resolved step holding a live timer keeps the event loop awake in a
    // test run and a closure alive in a browser.
    vi.useFakeTimers();
    try {
      await bestEffort(Promise.resolve(), "quick", 60000, silent);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts a non-promise", async () => {
    await expect(bestEffort("not a promise", "step", 1000, silent))
      .resolves.toEqual({ ok: true });
  });
});
