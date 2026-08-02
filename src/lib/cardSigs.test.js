import { describe, it, expect } from "vitest";
import { missingForCard, cardComplete } from "./cardSigs";

// The can't-sign strip has now been wrong twice in the same direction: it
// told a scorer his card was short while he was still tapping in the group
// standing next to him. Both times the cause was the window it counts over,
// and both times it looked reasonable in the source. So the window gets
// pinned here rather than re-argued.
//
// The rule it encodes: a hole is a GAP only when somebody has posted on it
// AND the group has moved past it. The hole they are on is neither.

const PIDS = ["pete", "jim", "nick", "paul"];
const match = { round: 1, teamA: ["pete", "jim"], teamB: ["nick", "paul"] };

// { pid: [holeIdx, ...] } → holeData
const hd = (spec) => {
  const out = {};
  for (const p of PIDS) out[`${p}_1`] = {};
  for (const [pid, holes] of Object.entries(spec)) for (const h of holes) out[`${pid}_1`][h] = 4;
  return out;
};
const upTo = (n) => [...Array(n).keys()];
const all = (n) => Object.fromEntries(PIDS.map(p => [p, upTo(n)]));
const names = (r) => r.map(m => m.pid);

describe("missingForCard — the hole in progress is never a gap", () => {
  it("says nothing when the first of four is entered on hole 1", () => {
    expect(missingForCard(match, hd({ pete: [0] }))).toEqual([]);
  });

  it("still says nothing at three of four on hole 1", () => {
    expect(missingForCard(match, hd({ pete: [0], jim: [0], nick: [0] }))).toEqual([]);
  });

  it("says nothing mid-way through hole 10 of a clean round", () => {
    expect(missingForCard(match, hd({ ...all(9), pete: upTo(10) }))).toEqual([]);
  });

  it("says nothing when the group is on 18 waiting for the fourth card", () => {
    expect(missingForCard(match, hd({ ...all(18), paul: upTo(17) }))).toEqual([]);
  });
});

describe("missingForCard — a real gap behind the group", () => {
  it("names the player and the hole", () => {
    const gap = hd({ ...all(9), nick: upTo(9).filter(h => h !== 3) });
    expect(missingForCard(match, gap)).toEqual([{ pid: "nick", holes: [4] }]);
  });

  it("keeps naming it while the next hole is being played", () => {
    const gap = hd({ ...all(9), nick: upTo(9).filter(h => h !== 3), pete: upTo(10), jim: upTo(10) });
    expect(missingForCard(match, gap)).toEqual([{ pid: "nick", holes: [4] }]);
  });

  it("names a gap that only surfaces once all 18 are in", () => {
    const gap = hd({ ...all(18), nick: upTo(18).filter(h => h !== 6) });
    expect(missingForCard(match, gap)).toEqual([{ pid: "nick", holes: [7] }]);
  });

  it("names a player who has posted nothing at all", () => {
    const gap = hd({ pete: upTo(18), jim: upTo(18), nick: upTo(18) });
    expect(names(missingForCard(match, gap))).toEqual(["paul"]);
  });
});

describe("missingForCard — holes the group has not reached", () => {
  it("is silent on an untouched card", () => {
    expect(missingForCard(match, hd({}))).toEqual([]);
  });

  it("is silent on a complete card", () => {
    expect(missingForCard(match, hd(all(18)))).toEqual([]);
  });

  // A shotgun start leaves the front of the card blank for most of the
  // round. Counting those would make the strip permanent and useless.
  it("ignores the holes before a shotgun group's starting hole", () => {
    const shotgun = Object.fromEntries(PIDS.map(p => [p, upTo(9).slice(4)]));
    expect(missingForCard(match, hd(shotgun))).toEqual([]);
  });

  it("is not what decides whether a card can be signed", () => {
    // Silent strip, and still unsignable — 18 holes is cardComplete's bar.
    const onNine = hd(all(9));
    expect(missingForCard(match, onNine)).toEqual([]);
    expect(cardComplete(match, onNine)).toBe(false);
  });
});
