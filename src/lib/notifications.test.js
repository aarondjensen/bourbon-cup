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
import { canSubscribe, PLAYERLESS_IDS } from "./notifications";
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
