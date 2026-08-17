// ══════════════════════════════════════════════════════════════════
//  Who is allowed to hold a push subscription
// ══════════════════════════════════════════════════════════════════
//
// The rest of this module talks to the OS, to FCM and to Firestore, and is
// tested by a phone. This one decision is pure and is the one that failed
// silently: `sendToPlayer` in functions/index.js addresses every push by
// `player_id`, so a token row filed under an id no roster row carries is a
// subscription that can never receive anything.
//
// Nothing on screen contradicted it. The toggle wrote the row, the row
// existed, `checkSubscriptionStatus` found it and reported subscribed, and no
// notification ever arrived. It was found on a real phone with a real test
// push and one row in the whole project filed under "spectator".
import { describe, it, expect } from "vitest";
import { canSubscribe, PLAYERLESS_IDS, subscribedOnThisDevice, testPushOutcome } from "./notifications";
import { SPECTATOR_ID, BOOTSTRAP_DIRECTOR } from "../firebase";
import { GUEST_ID } from "./guest";

describe("canSubscribe", () => {
  it("says yes to a claimed roster row", () => {
    // The two id shapes a real player can have: the app's own, and the
    // history import's. Plus a demo tester's, which is a real row too.
    expect(canSubscribe("bc_player_1773595975465")).toBe(true);
    expect(canSubscribe("hist_2019_paulw")).toBe(true);
    expect(canSubscribe("demo_dave")).toBe(true);
  });

  it("says no to each of the three identities that match no roster row", () => {
    expect(canSubscribe(GUEST_ID)).toBe(false);
    expect(canSubscribe(SPECTATOR_ID)).toBe(false);
    expect(canSubscribe(BOOTSTRAP_DIRECTOR.player_id)).toBe(false);
  });

  it("covers all three in PLAYERLESS_IDS, so nothing drifts out of the list", () => {
    // The list is what the screen and the register path both read. A fourth
    // player-less identity added elsewhere and not added here would arrive as
    // the same silent failure this whole file is about.
    expect([...PLAYERLESS_IDS].sort()).toEqual(
      [GUEST_ID, SPECTATOR_ID, BOOTSTRAP_DIRECTOR.player_id].sort(),
    );
  });

  it("says no to no id at all", () => {
    expect(canSubscribe(undefined)).toBe(false);
    expect(canSubscribe(null)).toBe(false);
    expect(canSubscribe("")).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════
//  Subscribed HERE, not subscribed somewhere
// ══════════════════════════════════════════════════════════════════
//
// The card asks "will this phone buzz" and was answered with "does this player
// have a token row anywhere". Two devices is everybody, so the second question
// says yes on a phone that has never registered — which is exactly what a real
// iPhone showed: NOTIFICATIONS ON, in green, over a collection whose only row
// was written by a browser on a laptop.
//
// The screen's own footer promises the opposite ("per device — turn them on
// separately on each phone or browser"), and so does the cache this overwrote.
describe("subscribedOnThisDevice", () => {
  const mine = { id: "pdemo_dave_a1b2c3", token: "t1" };
  const laptop = { id: "pdemo_dave_9z8y7x", token: "t2" };

  it("is true when this device's row is among them", () => {
    expect(subscribedOnThisDevice([laptop, mine], mine.id)).toBe(true);
  });

  it("is FALSE when another device subscribed and this one did not", () => {
    // The whole bug, in one assertion.
    expect(subscribedOnThisDevice([laptop], mine.id)).toBe(false);
  });

  it("is false when this device never recorded a row", () => {
    // Including a device that subscribed before the id was recorded. Wrong in
    // the direction that costs one tap, rather than a season of silence.
    expect(subscribedOnThisDevice([laptop, mine], null)).toBe(false);
  });

  it("is false when there are no rows at all", () => {
    expect(subscribedOnThisDevice([], mine.id)).toBe(false);
    expect(subscribedOnThisDevice(undefined, mine.id)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════
//  What the test button says
// ══════════════════════════════════════════════════════════════════
//
// The callable returns a REPORT rather than throwing — sendToPlayer catches
// every delivery failure and hands back { sent, failed, errors }. The screen
// read only `sent`, so a phone holding a registered iOS token was told "No
// devices registered" while the report in its hand said
//
//     failed: 1, errors: ["messaging/third-party-auth-error: Invalid APNs
//     credential."]
//
// The cause was found by reading Cloud Functions logs on a laptop. The point
// of a test button is that it IS the diagnostic.
describe("testPushOutcome", () => {
  it("reports a delivery", () => {
    expect(testPushOutcome({ sent: 1, failed: 0, errors: [] }))
      .toEqual({ tone: "success", text: "Test sent to 1 device" });
    expect(testPushOutcome({ sent: 3, failed: 0, errors: [] }).text)
      .toBe("Test sent to 3 devices");
  });

  it("names the APNs credential, which is the one that cost an evening", () => {
    const out = testPushOutcome({
      sent: 0, failed: 1,
      errors: ["messaging/third-party-auth-error: Invalid APNs credential."],
    });
    expect(out.tone).toBe("error");
    expect(out.text).toMatch(/APNs key/);
    expect(out.text).toMatch(/Cloud Messaging/);
    // And explicitly NOT the old answer, which sent somebody looking for a
    // device that was sitting in their hand.
    expect(out.text).not.toMatch(/No devices/);
  });

  it("hands back an unrecognised code rather than swallowing it", () => {
    expect(testPushOutcome({ sent: 0, failed: 1, errors: ["messaging/quota-exceeded: slow down"] }).text)
      .toBe("Push refused: messaging/quota-exceeded: slow down");
  });

  it("says no devices only when nothing was actually attempted", () => {
    expect(testPushOutcome({ sent: 0, failed: 0, errors: ["no_tokens_registered"] }).text)
      .toMatch(/No devices registered/);
    expect(testPushOutcome(undefined).tone).toBe("error");
  });
});
