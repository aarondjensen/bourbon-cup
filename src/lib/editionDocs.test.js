// The lookup that made a first load render the real tournament.
//
// The bug it fixes: a device with no `bc_active_edition_ns` in localStorage —
// every first-time reader, and the scoreboard door takes one straight to the
// leaderboard — resolved `editionDocId("team_names")` to the BARE id while the
// live edition stores `bc_2026__team_names`. Nothing matched, so the app drew
// its own fallbacks: Team Alpha and Team Beta over the real field.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { findEditionDoc, namespacedDocId } from "./editionDocs";

const BARE = [
  { id: "team_names", teamA: "MASH BROTHERS", teamB: "SHOT CALLERS" },
  { id: "tournament", name: "The Bourbon Cup 2025" },
];
const NAMESPACED = [
  { id: "bc_2026__team_names", teamA: "mash brotherS", teamB: "shot callerS" },
  { id: "bc_2026__tournament", name: "The Bourbon Cup 2026" },
];

describe("findEditionDoc", () => {
  it("finds a namespaced singleton", () => {
    expect(findEditionDoc(NAMESPACED, "team_names", "bc_2026").teamA).toBe("mash brotherS");
  });

  it("finds the original edition's bare singleton", () => {
    // bc_2025 predates namespacing and its ids are never rewritten.
    expect(findEditionDoc(BARE, "team_names", "bc_2025").teamA).toBe("MASH BROTHERS");
  });

  it("does not need to be told which shape this edition uses", () => {
    // The whole point: one call answers for either edition, so a first load
    // that has not yet read bc_editions renders what a tenth load renders.
    // The rows handed in are one edition's, which is what makes accepting
    // both shapes safe — neither can name another year's document.
    expect(findEditionDoc(BARE, "tournament", "bc_2025").name).toBe("The Bourbon Cup 2025");
    expect(findEditionDoc(NAMESPACED, "tournament", "bc_2026").name).toBe("The Bourbon Cup 2026");
  });

  it("prefers the id that names this edition outright", () => {
    const both = [{ id: "team_names", teamA: "STRAY" }, { id: "bc_2026__team_names", teamA: "MINE" }];
    expect(findEditionDoc(both, "team_names", "bc_2026").teamA).toBe("MINE");
  });

  it("is null when the document is not there", () => {
    expect(findEditionDoc(NAMESPACED, "branding", "bc_2026")).toBeNull();
    expect(findEditionDoc([], "team_names", "bc_2026")).toBeNull();
  });

  it("survives rows that are not rows", () => {
    // A snapshot callback runs before anything else has; null in, null out
    // beats a thrown render.
    expect(findEditionDoc(null, "team_names", "bc_2026")).toBeNull();
    expect(findEditionDoc([null, undefined, {}], "team_names", "bc_2026")).toBeNull();
    expect(findEditionDoc(NAMESPACED, "", "bc_2026")).toBeNull();
  });

  it("builds the namespaced id the way firebase.js writes it", () => {
    // editionDocId's namespaced branch, restated: `${tid}__${bareId}`. The two
    // cannot be imported into one file — firebase.js initialises Firebase on
    // import — so this is the pin that keeps them spelling it the same.
    expect(namespacedDocId("team_names", "bc_2026")).toBe("bc_2026__team_names");
    const firebaseSrc = readFileSync(new URL("../firebase.js", import.meta.url), "utf8");
    expect(firebaseSrc).toContain("`${tid}__${bareId}`");
  });
});

describe("App's settings lookups", () => {
  // A source assertion, like gateScreenWording: what matters is that the
  // singleton reads do not go back to asking the per-device flag.
  const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");

  it("find the singletons by either id shape", () => {
    expect(app).toMatch(/const settingsDoc = \(bareId\) => findEditionDoc\(rows, bareId, TOURNAMENT_ID\);/);
    expect(app).toMatch(/findEditionDoc\(rows, "bc_settings_main", TOURNAMENT_ID\)/);
  });

  it("never match a subscribed row against editionDocId again", () => {
    // That is the shape of the bug: `rows.find(r => r.id === editionDocId(…))`
    // is a per-device flag deciding whether a read hits.
    expect(app).not.toMatch(/r\.id === editionDocId\(/);
  });
});
