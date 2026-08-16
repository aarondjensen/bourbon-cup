import { describe, it, expect } from "vitest";
import { defaultEdition, WEB_DEFAULT_EDITION_ID } from "./defaultEdition";
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
