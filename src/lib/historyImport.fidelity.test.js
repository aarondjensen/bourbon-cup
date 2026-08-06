// ══════════════════════════════════════════════════════════════════
//  historyImport — does an imported year come out as it was played?
// ══════════════════════════════════════════════════════════════════
//
// The unit tests next door check that the documents have the right SHAPE. This
// one checks the only thing that finally matters: run the app's own scoring
// engine over an imported edition and it must reproduce the tournament.
//
// The checks themselves live in lib/historyVerify.js, because the import
// script runs exactly the same ones before it writes anything. This file is
// the part that runs them on every `npm test`, against all ten years, so a
// change to the engine that would quietly re-score 2016 fails here first.
//
// Three independent records to check against, all built by the pipeline off
// the original spreadsheets:
//
//   backbone.playerRound   every gross total and course handicap. Checks the
//                          cards survived the import intact.
//   matchFacts             every match's running status, resolved off the
//                          scorecards. Checks the draw, the stroke allocation
//                          and the format.
//   the Round 4 point share the one round no match status exists for, totalled
//                          on the card itself.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { verifyEdition } from "./historyVerify.js";

// Resolved off this file rather than off the working directory, so the suite
// reads the same data whichever directory vitest was started from.
const read = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}`, import.meta.url), "utf8"));
const { editions } = read("bourbon-cup-editions.json");
const backbone = read("bourbon-cup-backbone.json");
const facts = read("bourbon-cup-matchfacts.json").matchFacts;

const YEARS = editions.map((e) => e.year);

const verify = (year) => {
  const edition = editions.find((e) => e.year === year);
  return verifyEdition(edition, backbone.playerHole.filter((h) => h.year === year), {
    playerRounds: backbone.playerRound.filter((r) => r.year === year),
    facts: facts.filter((f) => f.year === year),
  });
};

describe("every imported year keeps its cards", () => {
  it.each(YEARS)("%i — gross totals and course handicaps match the record", (year) => {
    expect(verify(year).cards).toEqual([]);
  });
});

describe("every imported year keeps its draw", () => {
  it.each(YEARS)("%i — everybody is in the match he played", (year) => {
    expect(verify(year).draw).toEqual([]);
  });
});

describe("every imported year comes out as it was played", () => {
  it.each(YEARS)("%i — the app crowns the same match winners", (year) => {
    const v = verify(year);
    expect(v.matchesChecked).toBeGreaterThan(0);
    expect(v.matches).toEqual([]);
  });

  it.each(YEARS)("%i — Round 4 pays out what the card paid out", (year) => {
    expect(verify(year).points).toEqual([]);
  });
});
