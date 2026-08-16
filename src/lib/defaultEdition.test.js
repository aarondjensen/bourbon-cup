import { describe, it, expect } from "vitest";
import { defaultEdition, liveEdition, WEB_DEFAULT_EDITION_ID } from "./defaultEdition";
import { DEMO_EDITION_ID } from "./editionLock";

describe("defaultEdition", () => {
  it("opens a store build on the demo", () => {
    // The whole point. A tester or a store reviewer is handed the app to try;
    // landing them on a finished cup means a locked roster they cannot claim,
    // so their first act in the app is a refusal.
    expect(defaultEdition({ native: true })).toBe(DEMO_EDITION_ID);
  });

  it("leaves the web app on the cup", () => {
    // thebourboncup.com is the sixteen men. They must never open the app on an
    // invented tournament.
    expect(defaultEdition({ native: false })).toBe(WEB_DEFAULT_EDITION_ID);
    expect(defaultEdition()).toBe(WEB_DEFAULT_EDITION_ID);
  });

  it("lets VITE_DEFAULT_EDITION win on either platform", () => {
    // The way this stops being a special case: when the field installs the
    // store builds, point it at that year and the fork is gone.
    expect(defaultEdition({ override: "bc_2026", native: true })).toBe("bc_2026");
    expect(defaultEdition({ override: "bc_2026", native: false })).toBe("bc_2026");
  });

  it("ignores an override that is blank or whitespace", () => {
    // An env var set to "" is what an unset var looks like in a .env file, and
    // it must not resolve the app to an edition id of "" — which would filter
    // every query to nothing and render an empty tournament.
    expect(defaultEdition({ override: "", native: true })).toBe(DEMO_EDITION_ID);
    expect(defaultEdition({ override: "   ", native: false })).toBe(WEB_DEFAULT_EDITION_ID);
    expect(defaultEdition({ override: undefined, native: true })).toBe(DEMO_EDITION_ID);
  });

  it("trims a pasted override", () => {
    expect(defaultEdition({ override: " bc_2026 " })).toBe("bc_2026");
  });
});

describe("liveEdition", () => {
  const ARCHIVE = [
    { id: "bc_2019", year: 2019, status: "archived" },
    { id: "bc_2024", year: 2024, status: "archived" },
  ];
  const CUP = { id: "bc_2025", year: 2025, status: "published" };
  const NEXT = { id: "bc_2026", year: 2026, status: "draft" };
  const DEMO = { id: DEMO_EDITION_ID, year: 2026, status: "published", is_demo: true };

  it("is the published year, not the newest one", () => {
    // Next year exists as a draft the moment a director starts building it,
    // and it has no draw and possibly no roster. Sending the field back to it
    // because its number is bigger is the one wrong answer.
    expect(liveEdition([...ARCHIVE, CUP, NEXT], WEB_DEFAULT_EDITION_ID)).toBe("bc_2025");
  });

  it("moves on its own the day next year is published", () => {
    // The reason this reads `status` rather than the build-time default: no
    // code change, no release, no forgotten constant naming last year's cup.
    const rolled = [...ARCHIVE, { ...CUP, status: "archived" }, { ...NEXT, status: "published" }];
    expect(liveEdition(rolled, WEB_DEFAULT_EDITION_ID)).toBe("bc_2026");
  });

  it("keeps the demo out of the web app's way home", () => {
    // The seed publishes bc_demo, and its year is whatever the invented
    // tournament was given. Newest-published alone would send the sixteen men
    // to a field of twelve golfers who do not exist.
    expect(liveEdition([...ARCHIVE, CUP, DEMO], WEB_DEFAULT_EDITION_ID)).toBe("bc_2025");
  });

  it("sends a store build home to the demo", () => {
    // A tester's home IS bc_demo — it is where a fresh install lands and the
    // only roster with a row they are allowed to claim.
    expect(liveEdition([...ARCHIVE, CUP, DEMO], DEMO_EDITION_ID)).toBe(DEMO_EDITION_ID);
  });

  it("points nowhere rather than somewhere wrong", () => {
    // Nothing loaded yet (the subscription arrives a moment after the shell),
    // and a project with only finished years. Both render no row.
    expect(liveEdition([], WEB_DEFAULT_EDITION_ID)).toBe("");
    expect(liveEdition(ARCHIVE, WEB_DEFAULT_EDITION_ID)).toBe("");
    expect(liveEdition(null, null)).toBe("");
  });

  it("falls back to the device's own edition when nothing is published", () => {
    expect(liveEdition([...ARCHIVE, { ...CUP, status: "archived" }], "bc_2025")).toBe("bc_2025");
  });

  it("ignores rows with no id", () => {
    expect(liveEdition([{ year: 2027, status: "published" }, CUP], "bc_2025")).toBe("bc_2025");
  });
});
