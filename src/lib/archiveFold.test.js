// The fold is the only definition of a career this app has — the running year
// goes through it as well as the ten that are over — so what it counts, and
// what it refuses to count, is worth pinning.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { foldArchive, aliasIndex, norm } from "./archiveFold.js";

const read = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}`, import.meta.url), "utf8"));
const archive = read("bourbon-cup-archive.json");

// A two-man cup: one four-ball, one singles round, four cards.
const toy = {
  players: [
    { id: "a", name: "Amy A", aka: ["a", "amya"] },
    { id: "b", name: "Bob B", aka: ["b", "bobb"] },
    { id: "c", name: "Cal C", aka: ["c", "calc"] },
    { id: "d", name: "Dee D", aka: ["d", "deed"] },
  ],
  editions: [{
    year: 2001, teamA: "REDS", teamB: "BLUES",
    roster: [{ p: "a", t: "A" }, { p: "b", t: "A" }, { p: "c", t: "B" }, { p: "d", t: "B" }],
  }],
  rounds: [
    { year: 2001, round: 1, format: "best_ball", course: "Toy Links", par: 72 },
    { year: 2001, round: 2, format: "singles", course: "Toy Dunes", par: 70 },
  ],
  matches: [
    { year: 2001, round: 1, A: ["a", "b"], B: ["c", "d"], ptsA: 3, ptsB: 0 },
    { year: 2001, round: 2, A: ["a"], B: ["c"], ptsA: 0, ptsB: 3 },
    { year: 2001, round: 2, A: ["b"], B: ["d"], ptsA: 1.5, ptsB: 1.5 },
  ],
  cards: [
    { year: 2001, round: 1, p: "a", g: 80, tp: 8, e: 0, b: 1, pr: 8, bo: 7, d: 2, a9: -3 },
    { year: 2001, round: 1, p: "c", g: 90, tp: 18, e: 0, b: 0, pr: 4, bo: 8, d: 6, a9: 3 },
    { year: 2001, round: 2, p: "a", g: 75, tp: 5, e: 1, b: 2, pr: 9, bo: 5, d: 1 },
    { year: 2001, round: 2, p: "c", g: 85, tp: 15, e: 0, b: 1, pr: 5, bo: 9, d: 3 },
  ],
};

describe("a match result belongs to the side", () => {
  const f = foldArchive(toy);
  const rowOf = (id) => f.careerOf(id);

  it("credits a four-ball win to both partners", () => {
    expect(rowOf("a").w).toBe(1);
    expect(rowOf("b").w).toBe(1);
    expect(rowOf("c").l).toBe(1);
  });

  it("adds the side's points to every player on it", () => {
    // R1 three points, R2 nothing.
    expect(rowOf("a").pts).toBe(3);
    // R1 three, R2 a half.
    expect(rowOf("b").pts).toBe(4.5);
  });

  it("counts a tie as a half for both", () => {
    expect(rowOf("b").h).toBe(1);
    expect(rowOf("d").h).toBe(1);
  });
});

describe("partnerships and head-to-heads count different things", () => {
  const f = foldArchive(toy);

  it("pairs only two-man sides", () => {
    expect(f.partners.map((p) => `${p.a}|${p.b}`).sort()).toEqual(["a|b", "c|d"]);
  });

  it("leaves the big team round out of the partnership table", () => {
    const big = foldArchive({
      ...toy,
      matches: [{ year: 2001, round: 1, A: ["a", "b", "c"], B: ["d"], ptsA: 1, ptsB: 0 }],
    });
    expect(big.partners).toEqual([]);
  });

  it("counts head-to-head from singles only", () => {
    expect(f.h2h).toHaveLength(2);
    const ac = f.h2hOf("a").find((r) => r.against === "c");
    expect([ac.w, ac.l, ac.h]).toEqual([0, 1, 0]);
  });
});

describe("the cards", () => {
  const f = foldArchive(toy);

  it("ranks a best round on to par, not on gross", () => {
    const wide = foldArchive({
      ...toy,
      cards: [
        { year: 2001, round: 1, p: "a", g: 78, tp: 6, e: 0, b: 0, pr: 0, bo: 0, d: 0 },
        { year: 2001, round: 2, p: "a", g: 79, tp: 9, e: 0, b: 0, pr: 0, bo: 0, d: 0 },
      ],
    });
    expect(wide.careerOf("a").best.gross).toBe(78);
    const flipped = foldArchive({
      ...toy,
      rounds: [
        { year: 2001, round: 1, format: "best_ball", course: "Toy Links", par: 72 },
        { year: 2001, round: 2, format: "singles", course: "Short", par: 62 },
      ],
      cards: [
        { year: 2001, round: 1, p: "a", g: 78, tp: 6, e: 0, b: 0, pr: 0, bo: 0, d: 0 },
        { year: 2001, round: 2, p: "a", g: 66, tp: 4, e: 0, b: 0, pr: 0, bo: 0, d: 0 },
      ],
    });
    expect(flipped.careerOf("a").best.gross).toBe(66);
  });

  it("counts a comeback off the status at the turn, not the final margin", () => {
    expect(f.careerOf("a").comebacks).toBe(1);
    expect(f.careerOf("c").collapses).toBe(1);
    expect(f.careerOf("b").comebacks).toBe(0);
  });
});

describe("an unfinished cup is not a record", () => {
  const running = {
    ...toy,
    editions: [{ ...toy.editions[0], complete: false }],
  };

  it("has no winner while it is being played", () => {
    const f = foldArchive(running);
    expect(f.editions[0].winner).toBeNull();
    expect(f.editions[0].complete).toBe(false);
  });

  it("is kept out of closest-ever and biggest-ever", () => {
    const f = foldArchive(running);
    expect(f.records.closest).toBeNull();
    expect(f.records.biggest).toBeNull();
    expect(f.records.cupsPlayed).toBe(0);
  });

  it("still counts towards a career, because those matches were played", () => {
    const f = foldArchive(running);
    expect(f.careerOf("a").matches).toBe(2);
    // But not towards a cup won — that is not decided yet.
    expect(f.careerOf("a").cupsWon).toBe(0);
  });
});

describe("the running total after each round", () => {
  it("accumulates, and keeps each round's own split", () => {
    const f = foldArchive(toy);
    expect(f.editions[0].rounds.map((r) => [r.round, r.ptsA, r.ptsB, r.cumA, r.cumB]))
      .toEqual([[1, 3, 0, 3, 0], [2, 1.5, 4.5, 4.5, 4.5]]);
  });

  it("reads a level cup as halved once it is over", () => {
    const f = foldArchive({ ...toy, editions: [{ ...toy.editions[0], complete: true }] });
    expect(f.editions[0].halved).toBe(true);
    expect(f.editions[0].winner).toBeNull();
  });
});

describe("identity", () => {
  it("resolves every spelling the registry knows to one golfer", () => {
    const ix = aliasIndex(archive.players);
    expect(ix.get(norm("Weezy"))).toBe("paulw");
    expect(ix.get(norm("Paul W"))).toBe("paulw");
    expect(ix.get(norm("paulw"))).toBe("paulw");
    // The six 2022 handle changes, which are the folds nothing downstream can
    // catch — a split identity gives each half a complete, plausible record.
    expect(ix.get(norm("Telly"))).toBe(ix.get(norm("Ben T")));
    expect(ix.get(norm("House"))).toBe(ix.get(norm("Shaun W")));
    expect(ix.get(norm("T-Mo"))).toBe(ix.get(norm("Tim C")));
    expect(ix.get(norm("Hile"))).toBe(ix.get(norm("Jim H")));
    expect(ix.get(norm("Elger"))).toBe(ix.get(norm("Joe E")));
  });
});

// ── Against the real thing ────────────────────────────────────────
// The committed archive is generated, and these are the invariants that say
// it was generated correctly rather than merely written.
describe("the committed archive", () => {
  const f = foldArchive(archive);

  it("holds every year the cup has been played", () => {
    expect(f.years).toEqual([...archive.years].sort((a, b) => b - a));
    expect(f.editions.every((e) => e.rounds.length === 4)).toBe(true);
  });

  it("gives every card a round to belong to", () => {
    const keys = new Set(archive.rounds.map((r) => `${r.year}_${r.round}`));
    expect(archive.cards.filter((c) => !keys.has(`${c.year}_${c.round}`))).toEqual([]);
    expect(archive.matches.filter((m) => !keys.has(`${m.year}_${m.round}`))).toEqual([]);
  });

  it("knows every golfer named on a match or a card", () => {
    const known = new Set(archive.players.map((p) => p.id));
    const named = new Set([
      ...archive.cards.map((c) => c.p),
      ...archive.matches.flatMap((m) => [...m.A, ...m.B]),
    ]);
    expect([...named].filter((id) => !known.has(id))).toEqual([]);
  });

  it("totals each year to what its own matches add up to", () => {
    f.editions.forEach((e) => {
      const mine = archive.matches.filter((m) => m.year === e.year);
      expect(e.scoreA).toBeCloseTo(mine.reduce((s, m) => s + m.ptsA, 0), 6);
      expect(e.scoreB).toBeCloseTo(mine.reduce((s, m) => s + m.ptsB, 0), 6);
    });
  });

  it("gives a man one appearance per year he was on a roster", () => {
    f.career.forEach((r) => {
      expect(r.apps).toBe(r.byYear.length);
      expect(new Set(r.years).size).toBe(r.years.length);
    });
  });

  it("splits every career into wins, losses and halves that add up", () => {
    f.career.forEach((r) => expect(r.w + r.l + r.h).toBe(r.matches));
  });

  it("counts every card's holes as eighteen", () => {
    archive.cards.forEach((c) => {
      expect(c.e + c.b + c.pr + c.bo + c.d).toBe(18);
    });
  });
});
