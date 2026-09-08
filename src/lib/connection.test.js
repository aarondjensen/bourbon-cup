// What the phone says when its writes are not landing.
//
// Every case here is a state the app used to have no voice for: see
// lib/connection for why a queued write and a refused one are opposite
// problems that look identical from a tee box.
import { describe, it, expect, vi } from "vitest";
import { createWriteTracker, syncStatus, SCORE_KIND } from "./connection";

const settle = () => new Promise(r => setTimeout(r, 0));

describe("createWriteTracker", () => {
  it("hands back the very same promise, so a call site is unchanged", async () => {
    const t = createWriteTracker();
    const p = Promise.resolve("value");
    expect(t.track(p, "c")).toBe(p);
    await expect(p).resolves.toBe("value");
  });

  it("counts a write while it is outstanding and clears it when it lands", async () => {
    const t = createWriteTracker();
    let release;
    t.track(new Promise(r => { release = r; }), SCORE_KIND);
    expect(t.state()).toMatchObject({ pending: 1, kinds: { [SCORE_KIND]: 1 } });
    release();
    await settle();
    expect(t.state()).toMatchObject({ pending: 0, kinds: {} });
  });

  it("counts a REJECTED write as refused, not as still waiting", async () => {
    const t = createWriteTracker();
    t.track(Promise.reject(new Error("denied")), SCORE_KIND).catch(() => {});
    await settle();
    expect(t.state()).toMatchObject({ pending: 0, refused: 1, refusedKinds: { [SCORE_KIND]: 1 } });
  });

  it("keeps a refusal until a write of the same kind succeeds", async () => {
    const t = createWriteTracker();
    t.track(Promise.reject(new Error("denied")), SCORE_KIND).catch(() => {});
    await settle();
    // A different collection working says nothing about this one.
    t.track(Promise.resolve(), "bc_players");
    await settle();
    expect(t.state().refused).toBe(1);
    // The same door working means whatever it was is over.
    t.track(Promise.resolve(), SCORE_KIND);
    await settle();
    expect(t.state().refused).toBe(0);
  });

  it("starts the clock when the queue fills and stops it when it drains", async () => {
    let now = 1000;
    const t = createWriteTracker(() => now);
    expect(t.state().since).toBeNull();
    let a, b;
    t.track(new Promise(r => { a = r; }), "c");
    expect(t.state().since).toBe(1000);
    // A second write joining a queue that is ALREADY backed up does not
    // restart it — the question is how long this phone has been stuck.
    now = 5000;
    t.track(new Promise(r => { b = r; }), "c");
    expect(t.state().since).toBe(1000);
    a(); b();
    await settle();
    expect(t.state().since).toBeNull();
  });

  it("tells subscribers the current state immediately, then on every change", async () => {
    const t = createWriteTracker();
    const seen = vi.fn();
    const off = t.subscribe(seen);
    expect(seen).toHaveBeenCalledTimes(1);
    t.track(Promise.resolve(), "c");
    await settle();
    expect(seen.mock.calls.length).toBeGreaterThan(1);
    off();
    const before = seen.mock.calls.length;
    t.track(Promise.resolve(), "c");
    await settle();
    expect(seen.mock.calls.length).toBe(before);
  });
});

describe("syncStatus", () => {
  it("says nothing at all when everything is landing", () => {
    // The whole design: a bar that is always there is furniture nobody reads.
    expect(syncStatus({ online: true })).toBeNull();
    expect(syncStatus({ online: true, pending: 2, kinds: { [SCORE_KIND]: 2 }, stalled: false })).toBeNull();
  });

  it("names SCORES rather than 'changes' when that is what is held", () => {
    const s = syncStatus({ online: false, pending: 3, kinds: { [SCORE_KIND]: 3 } });
    expect(s.label).toContain("3 scores");
    expect(s.hint).toBe("Keep scoring");
  });

  it("gets the singular right, because it is on screen at a tee box", () => {
    expect(syncStatus({ online: false, pending: 1, kinds: { [SCORE_KIND]: 1 } }).label)
      .toContain("1 score still on this phone");
  });

  it("tells a spectator with nothing to send that the board may be behind", () => {
    // No advice: they are not scoring anything, so there is nothing to keep
    // doing.
    const s = syncStatus({ online: false });
    expect(s.label).toBe("No signal — the board may be behind");
    expect(s.hint).toBe("");
  });

  it("only mentions a slow write once it has actually stalled", () => {
    expect(syncStatus({ online: true, pending: 1, kinds: { [SCORE_KIND]: 1 }, stalled: false })).toBeNull();
    expect(syncStatus({ online: true, pending: 1, kinds: { [SCORE_KIND]: 1 }, stalled: true }).key)
      .toBe("stalled-scores");
  });

  it("puts a REFUSAL above no signal, because it is the opposite problem", () => {
    // Offline means the score is safe on the phone. Refused means Firestore
    // rolled it back and it is gone from here too.
    const s = syncStatus({
      online: false, pending: 2, kinds: { [SCORE_KIND]: 2 },
      refused: 1, refusedKinds: { [SCORE_KIND]: 1 },
    });
    expect(s.tone).toBe("bad");
    expect(s.label).toContain("did not save");
    expect(s.label).toContain("nobody else has it");
    expect(s.hint).toBe("Check you're signed in");
  });

  it("says 'changes' for a refusal that is not a score", () => {
    const s = syncStatus({ online: true, refused: 2, refusedKinds: { bc_players: 2 } });
    expect(s.key).toBe("refused");
    expect(s.label).toBe("2 changes did not save");
  });
});
