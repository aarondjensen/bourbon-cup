import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  GUEST_ID, GUEST_KEY, GUEST_USER, isGuest, readGuestMode, writeGuestMode,
} from "./guest";
import { SPECTATOR_ID, BOOTSTRAP_DIRECTOR } from "../firebase";

// A stand-in for the browser's, so the round trip is tested rather than
// mocked away. The real one is not present under vitest's node environment.
const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    has: (k) => map.has(k),
  };
};

describe("the guest identity", () => {
  it("is nobody on the roster", () => {
    // The whole safety argument downstream rests on this: a guest matches no
    // player id, so no match, card, group or ledger row can find them.
    expect(GUEST_USER.player_id).toBe(GUEST_ID);
    expect(GUEST_USER.team).toBeNull();
  });

  it("grants nothing", () => {
    expect(GUEST_USER.isDirector).toBe(false);
  });

  it("is not the spectator and not the bootstrap director", () => {
    // Three player-less identities, three different reasons to exist. A
    // shared id would let one's allowances leak onto another.
    expect(GUEST_ID).not.toBe(SPECTATOR_ID);
    expect(GUEST_ID).not.toBe(BOOTSTRAP_DIRECTOR.player_id);
  });

  it("cannot be mutated by whoever it is handed to", () => {
    expect(() => { GUEST_USER.isDirector = true; }).toThrow();
    expect(GUEST_USER.isDirector).toBe(false);
  });
});

describe("isGuest", () => {
  it("recognises the guest identity", () => {
    expect(isGuest(GUEST_USER)).toBe(true);
    expect(isGuest({ ...GUEST_USER })).toBe(true);
  });

  it("says no to everybody else", () => {
    expect(isGuest(null)).toBe(false);
    expect(isGuest(undefined)).toBe(false);
    expect(isGuest({})).toBe(false);
    expect(isGuest({ player_id: "bc_player_123", name: "Weezy" })).toBe(false);
    expect(isGuest({ player_id: SPECTATOR_ID })).toBe(false);
    expect(isGuest(BOOTSTRAP_DIRECTOR)).toBe(false);
  });
});

describe("the guest flag", () => {
  let store;
  beforeEach(() => {
    store = memoryStorage();
    vi.stubGlobal("localStorage", store);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("is off until it is set", () => {
    expect(readGuestMode()).toBe(false);
  });

  it("round trips", () => {
    writeGuestMode(true);
    expect(readGuestMode()).toBe(true);
    writeGuestMode(false);
    expect(readGuestMode()).toBe(false);
  });

  it("removes the key rather than storing a falsy one", () => {
    // A leftover "0" would still be a key the next reader has to interpret.
    writeGuestMode(true);
    writeGuestMode(false);
    expect(store.has(GUEST_KEY)).toBe(false);
  });

  it("reads anything other than the set value as off", () => {
    store.setItem(GUEST_KEY, "0");
    expect(readGuestMode()).toBe(false);
    store.setItem(GUEST_KEY, "true");
    expect(readGuestMode()).toBe(false);
  });

  it("survives storage that throws", () => {
    // Private browsing, and some webviews. "Not a guest" is the right answer
    // there; a thrown error during render is a blank page.
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    });
    expect(readGuestMode()).toBe(false);
    expect(() => writeGuestMode(true)).not.toThrow();
  });

  it("survives storage that is not there at all", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(readGuestMode()).toBe(false);
    expect(() => writeGuestMode(true)).not.toThrow();
  });
});
