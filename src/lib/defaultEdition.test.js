import { describe, it, expect } from "vitest";
import { defaultEdition, liveEdition, WEB_DEFAULT_EDITION_ID } from "./defaultEdition";
import { DEMO_EDITION_ID } from "./editionLock";

describe("defaultEdition", () => {
  it("opens every install on the cup, store build or browser", () => {
    // It used to fork on `native` and open a store build on the demo, for
    // Play's twelve closed-test strangers who had no roster row. Internal
    // testing retired that audience: a store build is now installed by the
    // same sixteen men as the website, and landing THEM on "DEMO — Testers"
    // is the same failure pointed the other way.
    expect(defaultEdition()).toBe(WEB_DEFAULT_EDITION_ID);
    expect(defaultEdition({})).toBe(WEB_DEFAULT_EDITION_ID);
  });

  it("never opens on the demo of its own accord", () => {
    expect(defaultEdition()).not.toBe(DEMO_EDITION_ID);
  });

  it("lets VITE_DEFAULT_EDITION win, which is how next year ships", () => {
    expect(defaultEdition({ override: "bc_2026" })).toBe("bc_2026");
  });

  it("treats a blank or absent override as absent", () => {
    // Vite hands over "" for an unset variable, not undefined, and a value
    // typed with a stray space is the same mistake.
    expect(defaultEdition({ override: "" })).toBe(WEB_DEFAULT_EDITION_ID);
    expect(defaultEdition({ override: "   " })).toBe(WEB_DEFAULT_EDITION_ID);
    expect(defaultEdition({ override: undefined })).toBe(WEB_DEFAULT_EDITION_ID);
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
