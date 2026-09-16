// ══════════════════════════════════════════════════════════════════
//  Match Royale, against the workbook that invented it.
// ══════════════════════════════════════════════════════════════════
//
// The Google Sheets workbook recorded a Match Royale for every one of the 630
// player-rounds it ever scored, and those numbers are in the backbone. This
// checks the app's own arithmetic against all of them.
//
// It is NOT expected to match exactly, and the gap is the point of the test
// rather than a failure of it. The workbook computed Match Royale off its own
// per-hole net column, and that column does not survive being checked: on
// eight of the forty rounds its net is not its own gross less its own
// recorded strokes. The app computes net the way it computes net everywhere —
// full course handicap down the stroke index, the card scoresExport prints —
// because that is the one a running tournament can produce.
//
// So this pins the SIZE of the divergence. If a change to handicap allocation
// or to the fold ever moved Match Royale away from the decade the sheets
// recorded, the means below would move and this would fail here rather than
// on somebody's phone.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { matchRoyale, netByHole, royaleHoles } from "./matchRoyale.js";

const read = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}`, import.meta.url), "utf8"));
const archive = read("bourbon-cup-archive.json");
const backbone = read("bourbon-cup-backbone.json");

describe("the shipped archive", () => {
  it("carries a Match Royale on every card", () => {
    expect(archive.cards.filter((c) => c.mr == null)).toEqual([]);
    archive.cards.forEach((c) => {
      expect(c.mr).toBeGreaterThanOrEqual(0);
      expect(c.mr).toBeLessThanOrEqual(1);
    });
  });

  // Every hole hands out exactly as many wins as losses, so a whole field
  // averages a half by construction — nine holes' worth of eighteen. If this
  // ever stops being true the field being compared is not the field that
  // played, which is the same check strokes gained gets.
  // Three places rather than exact: the archive stores `mr` rounded to four,
  // which is a tenth of a hole at the scale it is read on and is what keeps
  // the file from carrying 630 full floats to say nothing anybody can see.
  it("averages dead even across the field, which it must", () => {
    const all = archive.cards.map((c) => c.mr);
    const mean = all.reduce((a, b) => a + b, 0) / all.length;
    expect(royaleHoles(mean)).toBeCloseTo(9, 3);
  });

  it("averages dead even inside every single round", () => {
    const rounds = new Map();
    archive.cards.forEach((c) => {
      const k = `${c.year}_${c.round}`;
      if (!rounds.has(k)) rounds.set(k, []);
      rounds.get(k).push(c.mr);
    });
    expect(rounds.size).toBe(40);
    rounds.forEach((xs) => {
      expect(xs.reduce((a, b) => a + b, 0) / xs.length).toBeCloseTo(0.5, 4);
    });
  });
});

describe("against the workbook's own numbers", () => {
  // The backbone's `matchRoyale` is the workbook's, on its 0–18 scale. Both
  // sides are sorted inside each round before comparing: the archive keys a
  // card on the canonical golfer and the backbone on that year's handle, and
  // what is being measured here is the DISTRIBUTION the two produce, not the
  // name attached to a row.
  const pairs = [];
  const mine = new Map();
  const theirs = new Map();
  archive.cards.forEach((c) => {
    const k = `${c.year}_${c.round}`;
    if (!mine.has(k)) mine.set(k, []);
    mine.get(k).push(royaleHoles(c.mr));
  });
  backbone.playerRound.forEach((r) => {
    if (r.matchRoyale == null) return;
    const k = `${r.year}_${r.round}`;
    if (!theirs.has(k)) theirs.set(k, []);
    theirs.get(k).push(r.matchRoyale);
  });
  mine.forEach((xs, k) => {
    const ys = theirs.get(k);
    if (!ys || ys.length !== xs.length) return;
    const a = xs.slice().sort((x, y) => x - y);
    const b = ys.slice().sort((x, y) => x - y);
    a.forEach((v, i) => pairs.push(Math.abs(v - b[i])));
  });

  it("has a number to compare for all ten years", () => {
    expect(pairs.length).toBe(630);
  });

  // 0.06 of one hole, on a scale where 9 is average and the spread across the
  // field is several holes wide. Tightened deliberately: this is a ceiling on
  // a known divergence, not room to drift.
  it("tracks the workbook to within a tenth of a hole on average", () => {
    const mean = pairs.reduce((a, b) => a + b, 0) / pairs.length;
    expect(mean).toBeLessThan(0.1);
  });

  it("is within half a hole on all but a handful of rounds", () => {
    expect(pairs.filter((d) => d < 0.5).length).toBeGreaterThanOrEqual(620);
    expect(Math.max(...pairs)).toBeLessThan(1.5);
  });
});

describe("the arithmetic itself", () => {
  const card = (nets) => Object.fromEntries(nets.map((n, i) => [i, n]));

  it("gives a man who beats everybody on every hole a perfect one", () => {
    const r = matchRoyale({
      a: card(Array(18).fill(3)),
      b: card(Array(18).fill(4)),
      c: card(Array(18).fill(5)),
    });
    expect(r.a).toBe(1);
    expect(r.c).toBe(0);
    expect(r.b).toBe(0.5);
  });

  it("counts a tied hole as a half, the way a halved match is", () => {
    const r = matchRoyale({ a: card([4]), b: card([4]) });
    expect(r.a).toBe(0.5);
    expect(r.b).toBe(0.5);
  });

  it("skips a hole either man has no score for rather than losing it", () => {
    // a beats b on the one hole they both played; b's second hole is his own.
    const r = matchRoyale({ a: { 0: 3 }, b: { 0: 4, 1: 3 } });
    expect(r.a).toBe(1);
    expect(r.b).toBe(0);
  });

  it("refuses a field of one, which is fifty per cent by construction", () => {
    expect(matchRoyale({ a: card([4]) })).toEqual({});
    expect(matchRoyale({})).toEqual({});
  });

  it("takes the net card off the stroke map", () => {
    expect(netByHole({ 0: 5, 1: 4, 2: 6 }, { 0: 1, 2: 1 })).toEqual({ 0: 4, 1: 4, 2: 5 });
  });

  it("ignores a hole with no score on it", () => {
    expect(netByHole({ 0: 5, 1: 0, 2: null }, {})).toEqual({ 0: 5 });
  });
});
