import { describe, it, expect } from "vitest";
import { parseDeepLink, roundSummaryHash } from "./deepLink";

describe("parseDeepLink", () => {
  it("selects a tab", () => {
    expect(parseDeepLink("#scoring")).toEqual({ view: "scoring", round: null });
    expect(parseDeepLink("#leaderboard")).toEqual({ view: "leaderboard", round: null });
    expect(parseDeepLink("#betting")).toEqual({ view: "betting", round: null });
  });

  it("takes a hash with or without its leading #", () => {
    expect(parseDeepLink("scoring")).toEqual({ view: "scoring", round: null });
  });

  it("opens a round summary over the leaderboard", () => {
    expect(parseDeepLink("#round/3")).toEqual({ view: "leaderboard", round: 3 });
    expect(parseDeepLink(roundSummaryHash(4))).toEqual({ view: "leaderboard", round: 4 });
  });

  // `menu` opens a drawer, not a view. Selecting it would leave the app on
  // whatever tab was underneath.
  it("will not select the More drawer", () => {
    expect(parseDeepLink("#menu")).toBe(null);
  });

  // The television's URL, read once at module load and owned by the
  // Leaderboard thereafter.
  it("leaves the countdown hash alone", () => {
    expect(parseDeepLink("#countdown")).toBe(null);
  });

  it("is null for anything it does not recognise", () => {
    expect(parseDeepLink("#")).toBe(null);
    expect(parseDeepLink("")).toBe(null);
    expect(parseDeepLink(null)).toBe(null);
    expect(parseDeepLink(undefined)).toBe(null);
    expect(parseDeepLink("#nonsense")).toBe(null);
    expect(parseDeepLink("#round")).toBe(null);
    expect(parseDeepLink("#round/")).toBe(null);
    expect(parseDeepLink("#round/two")).toBe(null);
    expect(parseDeepLink("#round/1/2")).toBe(null);
  });

  it("refuses round zero", () => {
    expect(parseDeepLink("#round/0")).toBe(null);
  });

  it("spells the summary hash one way", () => {
    expect(roundSummaryHash(2)).toBe("#round/2");
  });
});
