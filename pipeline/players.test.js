// The identity registry is the one place that decides two rows on two
// spreadsheets are the same golfer. It has been wrong before — six men were
// read as twelve for as long as the handles the 2022 sheets introduced were
// treated as new people — and nothing downstream can notice: a split identity
// produces a complete, plausible record for each half.
//
// So the folds are pinned here.
import { describe, it, expect } from "vitest";
import { PLAYERS, buildResolver, formalName, realName, displayName } from "./players.mjs";

const resolve = buildResolver();

describe("the 2022 handle change", () => {
  // Every one of these is corroborated twice over: the handle's first year is
  // the year after the name's last, and data/rounds.csv — exported before the
  // registry lost the folds — already carries the left-hand name.
  const FOLDED = [
    ["Telly", "Ben T"],
    ["House", "Shaun W"],
    ["T-Mo", "Tim C"],
    ["Weezy", "Paul W"],
    ["Hile", "Jim H"],
    ["Carp", "Pete C"],
    ["CuzNick", "Nick S"],
  ];

  it.each(FOLDED)("%s and %s are one golfer", (handle, name) => {
    const a = resolve(handle);
    expect(a).toBeTruthy();
    expect(a).toBe(resolve(name));
  });

  it("resolves a folded handle to the real name, not back to the handle", () => {
    expect(formalName(resolve("Telly"))).toBe("Ben T");
    expect(formalName(resolve("House"))).toBe("Shaun W");
  });

  // Matt H played Louisville in 2017, in the same field as Jim H, so the two
  // are not each other — and Hile, who starts in 2022, is Jim.
  it("keeps Matt H separate from Jim H", () => {
    expect(resolve("Matt H")).not.toBe(resolve("Jim H"));
    expect(resolve("Hile")).toBe(resolve("Jim H"));
  });
});

describe("the name the app shows", () => {
  it("is first name and last initial for everybody the registry has a name for", () => {
    const unresolved = Object.keys(PLAYERS).filter((id) => !realName(id));
    expect(unresolved).toEqual([]);
  });

  it("builds it from the recorded real name", () => {
    expect(formalName("jensen")).toBe("Aaron J");
    expect(formalName("tjsc")).toBe("TJ C");
    expect(formalName("saugy")).toBe("Paul S");
  });

  it("reads a display name that is already in that form without needing one", () => {
    expect(realName("daveb")).toEqual({ first: "Dave", last: "B" });
    expect(formalName("daveb")).toBe("Dave B");
  });

  it("falls back to the id for somebody the registry has never heard of", () => {
    expect(formalName("nobody")).toBe("nobody");
    expect(displayName("nobody")).toBe("nobody");
  });
});

describe("the resolver", () => {
  it("matches on the handle, the display name and the full name alike", () => {
    for (const form of ["Aaron J", "Jensen", "Aaron Jensen", "aaronjensen"]) {
      expect(resolve(form)).toBe("jensen");
    }
  });

  it("gives every canonical id a unique display name", () => {
    const names = Object.keys(PLAYERS).map((id) => PLAYERS[id].name);
    expect(new Set(names).size).toBe(names.length);
  });
});
