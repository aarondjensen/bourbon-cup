import { describe, it, expect } from "vitest";
import { NOTIFICATION_TYPES, normalizeTypePrefs } from "./notificationTypes";

describe("NOTIFICATION_TYPES", () => {
  it("is the contract the Cloud Functions gate on", () => {
    // These strings are the `type` values functions/index.js stamps into each
    // payload. If this test is what broke, the fix is in BOTH files or the
    // gate stops matching — and it fails open, so the symptom would be a
    // push somebody switched off still arriving.
    expect(NOTIFICATION_TYPES).toEqual(["attest_ready", "card_final", "round_final"]);
  });
});

describe("normalizeTypePrefs", () => {
  it("is all on for a token registered before the switches existed", () => {
    // No `types` map at all. The honest reading is "never turned anything
    // off", not "wants nothing".
    expect(normalizeTypePrefs(undefined)).toEqual({
      attest_ready: true, card_final: true, round_final: true,
    });
    expect(normalizeTypePrefs(null)).toEqual({
      attest_ready: true, card_final: true, round_final: true,
    });
    expect(normalizeTypePrefs({})).toEqual({
      attest_ready: true, card_final: true, round_final: true,
    });
  });

  it("mutes only on an explicit false", () => {
    expect(normalizeTypePrefs({ card_final: false })).toEqual({
      attest_ready: true, card_final: false, round_final: true,
    });
  });

  it("does not treat other falsy values as a mute", () => {
    // A half-written document, or JSON that lost a boolean somewhere. None of
    // these is somebody saying no, and reading them as no would silence a
    // push nobody asked to silence.
    expect(normalizeTypePrefs({ card_final: 0 }).card_final).toBe(true);
    expect(normalizeTypePrefs({ card_final: null }).card_final).toBe(true);
    expect(normalizeTypePrefs({ card_final: "" }).card_final).toBe(true);
    expect(normalizeTypePrefs({ card_final: undefined }).card_final).toBe(true);
  });

  it("always returns every key, whatever it was handed", () => {
    // The screen renders one switch per key and reads prefs[key] directly, so
    // a missing key would render an undefined switch rather than an on one.
    expect(Object.keys(normalizeTypePrefs({ round_final: false })).sort())
      .toEqual([...NOTIFICATION_TYPES].sort());
  });

  it("drops keys it has never heard of rather than passing them through", () => {
    // A preference written by a newer build. It is not this build's business
    // and must not reach the switches.
    const out = normalizeTypePrefs({ some_future_type: false, card_final: false });
    expect(out.some_future_type).toBeUndefined();
    expect(out.card_final).toBe(false);
  });

  it("round-trips its own output unchanged", () => {
    // saveTypePrefs normalizes what it stores and readTypePrefs normalizes
    // what it loads, so a second pass must be a no-op or a preference would
    // drift every time it was read back.
    const once = normalizeTypePrefs({ attest_ready: false });
    expect(normalizeTypePrefs(once)).toEqual(once);
  });
});
