// The week-before questions: has he signed in, and will he get the tee time.
import { describe, it, expect } from "vitest";
import {
  toMillis, timeAgo, devicesByPlayer, buildActivity, activitySummary, platformLabel,
} from "./playerActivity";

const NOW = Date.parse("2026-07-10T12:00:00Z");
const ago = (mins) => NOW - mins * 60_000;

describe("toMillis", () => {
  it("reads all three generations of timestamp this app has written", () => {
    expect(toMillis(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toMillis("2026-07-10T12:00:00Z")).toBe(NOW);
    expect(toMillis({ seconds: 1_700_000_000 })).toBe(1_700_000_000_000);
    expect(toMillis(new Date(NOW))).toBe(NOW);
  });
  it("is null on anything it cannot read, rather than NaN", () => {
    expect(toMillis(null)).toBeNull();
    expect(toMillis("soon")).toBeNull();
    expect(toMillis(NaN)).toBeNull();
    expect(toMillis({})).toBeNull();
  });
});

describe("timeAgo", () => {
  it("is coarse on purpose — the question is whether he is set up", () => {
    expect(timeAgo(ago(0), NOW)).toBe("just now");
    expect(timeAgo(ago(5), NOW)).toBe("5m ago");
    expect(timeAgo(ago(180), NOW)).toBe("3h ago");
    expect(timeAgo(ago(60 * 24 * 3), NOW)).toBe("3d ago");
    expect(timeAgo(ago(60 * 24 * 60), NOW)).toBe("2mo ago");
  });
  it("says nothing at all when there is no timestamp", () => {
    expect(timeAgo(null, NOW)).toBe("");
  });
  it("does not report the future as a negative age", () => {
    expect(timeAgo(NOW + 60_000, NOW)).toBe("just now");
  });
});

describe("devicesByPlayer", () => {
  it("gives a man with a phone and an iPad two devices, newest first", () => {
    const d = devicesByPlayer([
      { player_id: "a", platform: "ios", last_seen_at: ago(600) },
      { player_id: "a", platform: "web", last_seen_at: ago(10) },
    ]);
    expect(d.a).toHaveLength(2);
    expect(d.a[0].platform).toBe("web");
  });
  it("falls back to registration when a token has never been refreshed", () => {
    const d = devicesByPlayer([{ player_id: "a", registered_at: ago(30) }]);
    expect(d.a[0].lastSeen).toBe(ago(30));
  });
  it("reads a pre-platform token without filing it as an iPhone", () => {
    // `platform` is the field that exists so Android is not called iOS.
    expect(devicesByPlayer([{ player_id: "a", is_ios: false }]).a[0].platform).toBe("web");
    expect(devicesByPlayer([{ player_id: "a", is_ios: true }]).a[0].platform).toBe("ios");
  });
  it("drops a row with no player on it", () => {
    expect(devicesByPlayer([{ token: "x" }])).toEqual({});
  });
});

describe("buildActivity", () => {
  const players = [
    { player_id: "p1", name: "Aaron J", auth_uid: "u1", auth_provider: "google", auth_linked_at: "2026-06-01T00:00:00Z" },
    { player_id: "p2", name: "Paul W", auth_uid: "u2", auth_provider: "apple" },
    { player_id: "p3", name: "Jim H" },
  ];
  const tokens = [{ player_id: "p1", platform: "ios", last_seen_at: ago(120) }];

  it("says who has been through the door", () => {
    const rows = buildActivity({ players, tokens, now: NOW });
    expect(rows.map(r => r.signedIn)).toEqual([true, true, false]);
  });

  it("reads push off the TOKEN, never off a permission", () => {
    // A browser permission stays granted forever, including for somebody who
    // has since switched notifications off.
    const rows = buildActivity({ players, tokens, now: NOW });
    expect(rows[0].pushOn).toBe(true);
    expect(rows[1].pushOn).toBe(false);
    expect(rows[0].lastSeenLabel).toBe("2h ago");
  });

  it("leaves last-seen EMPTY for a man with no token", () => {
    // Rather than a blank that reads as "never opened it" — he may well have.
    const rows = buildActivity({ players, tokens, now: NOW });
    expect(rows[1].lastSeen).toBeNull();
    expect(rows[1].lastSeenLabel).toBe("");
  });

  it("survives an empty roster and missing collections", () => {
    expect(buildActivity()).toEqual([]);
    expect(buildActivity({ players: [{ player_id: "x" }] })[0].name).toBe("x");
  });
});

describe("activitySummary", () => {
  it("counts the field and names who to text", () => {
    const rows = buildActivity({
      players: [
        { player_id: "p1", name: "Aaron J", auth_uid: "u1" },
        { player_id: "p2", name: "Paul W", auth_uid: "u2" },
        { player_id: "p3", name: "Jim H" },
      ],
      tokens: [{ player_id: "p1", platform: "ios", last_seen_at: ago(5) }],
      now: NOW,
    });
    expect(activitySummary(rows)).toMatchObject({
      total: 3, signedIn: 2, pushOn: 1,
      notSignedIn: ["Jim H"],
      // Only men who ARE signed in can be missing push — the others have a
      // bigger problem and are already on the list above.
      noPush: ["Paul W"],
    });
  });
});

describe("platformLabel", () => {
  it("names the build a man is carrying", () => {
    expect(platformLabel("ios")).toBe("iOS");
    expect(platformLabel("android")).toBe("Android");
    expect(platformLabel(undefined)).toBe("Web");
  });
});
