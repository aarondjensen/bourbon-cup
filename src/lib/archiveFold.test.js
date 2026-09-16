// The fold is the only definition of a career this app has — the running year
// goes through it as well as the ten that are over — so what it counts, and
// what it refuses to count, is worth pinning.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  foldArchive, aliasIndex, norm, CORE_MIN_APPS, RECENT_CUPS, RECENT_MIN, recentMax,
} from "./archiveFold.js";

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

  // A scramble card is two names on one ball, so it is a side's number and
  // not anybody's round. The rule is formatOwnBall in src/constants.js, and it
  // has to hold in both places a low round is printed.
  it("keeps a shared ball out of the low rounds and off a man's best", () => {
    const shared = foldArchive({
      ...toy,
      rounds: [
        { year: 2001, round: 1, format: "scramble", course: "Toy Links", par: 72 },
        { year: 2001, round: 2, format: "singles", course: "Toy Dunes", par: 70 },
      ],
      cards: [
        { year: 2001, round: 1, p: "a", g: 62, tp: -10, e: 0, b: 0, pr: 0, bo: 0, d: 0 },
        { year: 2001, round: 1, p: "b", g: 62, tp: -10, e: 0, b: 0, pr: 0, bo: 0, d: 0 },
        { year: 2001, round: 2, p: "a", g: 75, tp: 5, e: 0, b: 0, pr: 0, bo: 0, d: 0 },
      ],
    });
    expect(shared.records.lowRounds.map((c) => c.gross ?? c.g)).toEqual([75]);
    expect(shared.careerOf("a").best.gross).toBe(75);
    // And he has no best round at all if the shared ball is all he played.
    expect(shared.careerOf("b").best).toBeNull();
    // The round still happened: it counts towards his rounds and his to par.
    expect(shared.careerOf("b").rounds).toBe(1);
  });

  it("counts a shamble out too — his own ball, off somebody else's drive", () => {
    const shamble = foldArchive({
      ...toy,
      rounds: [
        { year: 2001, round: 1, format: "shamble", course: "Toy Links", par: 72 },
        { year: 2001, round: 2, format: "singles", course: "Toy Dunes", par: 70 },
      ],
      cards: [
        { year: 2001, round: 1, p: "a", g: 68, tp: -4, e: 0, b: 0, pr: 0, bo: 0, d: 0 },
        { year: 2001, round: 2, p: "a", g: 75, tp: 5, e: 0, b: 0, pr: 0, bo: 0, d: 0 },
      ],
    });
    expect(shamble.careerOf("a").best.gross).toBe(75);
  });

  // A round row that has not arrived yet is not a reason to blank a decade of
  // records — an unknown format counts.
  it("counts a card whose round it cannot find", () => {
    const orphan = foldArchive({
      ...toy,
      rounds: [],
      cards: [{ year: 2001, round: 9, p: "a", g: 70, tp: 0, e: 0, b: 0, pr: 0, bo: 0, d: 0 }],
    });
    expect(orphan.careerOf("a").best.gross).toBe(70);
    expect(orphan.records.lowRounds).toHaveLength(1);
  });

  it("counts a comeback off the status at the turn, not the final margin", () => {
    expect(f.careerOf("a").comebacks).toBe(1);
    expect(f.careerOf("c").collapses).toBe(1);
    expect(f.careerOf("b").comebacks).toBe(0);
  });
});

// ── Gross and net ─────────────────────────────────────────────────
// Every figure with two readings. The round numbers are exact arithmetic off
// `tp` and `ch`; the hole counts come off the `np` marks, because eagles and
// birdies are per hole and no round total can recover them.
describe("net, beside gross", () => {
  const roundOf = (cards, format = "best_ball") => ({
    players: toy.players,
    editions: [{
      year: 2001, teamA: "REDS", teamB: "BLUES", complete: true,
      roster: cards.map((c) => ({ p: c.p, t: "A" })),
    }],
    rounds: [{ year: 2001, round: 1, format, course: "Toy", par: 72 }],
    matches: [],
    cards: cards.map((c) => ({ year: 2001, round: 1, e: 0, b: 0, pr: 0, bo: 0, d: 0, ...c })),
  });

  it("takes net score off the handicap and net-to-par with it", () => {
    const f = foldArchive(roundOf([
      { p: "a", g: 90, ch: 18, tp: 18, np: "P".repeat(18) },
      { p: "c", g: 80, ch: 4, tp: 8, np: "P".repeat(18) },
    ]));
    expect(f.careerOf("a").bestNet.net).toBe(72);
    expect(f.careerOf("a").bestNet.netToPar).toBe(0);
    expect(f.careerOf("a").avgNetToPar).toBe(0);
    expect(f.careerOf("c").bestNet.net).toBe(76);
    expect(f.careerOf("c").avgNetToPar).toBe(4);
  });

  it("counts net eagles, birdies, pars and bogeys off the marks", () => {
    const f = foldArchive(roundOf([
      { p: "a", g: 80, ch: 8, tp: 8, e: 1, b: 2, pr: 3, bo: 4, d: 8, np: "EEBBBPPPP111122233" },
      { p: "c", g: 85, ch: 8, tp: 13, np: "P".repeat(18) },
    ]));
    const r = f.careerOf("a");
    expect([r.nE, r.nB, r.nP, r.nBo, r.nD]).toEqual([2, 3, 4, 4, 5]);
    // Double OR WORSE, the same bucket the gross counts use: "2" and "3".
    expect(r.nD).toBe(3 + 2);
    // Gross is untouched and still the round summary's own.
    expect([r.e, r.b, r.pr, r.bo, r.d]).toEqual([1, 2, 3, 4, 8]);
  });

  it("has no net reading at all for a card with no handicap", () => {
    const f = foldArchive(roundOf([
      { p: "a", g: 80, ch: null, tp: 8, np: "P".repeat(18) },
      { p: "c", g: 85, ch: null, tp: 13, np: "P".repeat(18) },
    ]));
    expect(f.careerOf("a").netRounds).toBe(0);
    expect(f.careerOf("a").bestNet).toBeNull();
    expect(f.careerOf("a").avgNetToPar).toBeNull();
    // And it is still a round, and still a gross one.
    expect(f.careerOf("a").rounds).toBe(1);
    expect(f.careerOf("a").best.gross).toBe(80);
  });

  it("ranks the net board on net against par, not on the net score", () => {
    const f = foldArchive(roundOf([
      // a is level net off 90; c is one under net off 80.
      { p: "a", g: 90, ch: 18, tp: 18, np: "P".repeat(18) },
      { p: "c", g: 80, ch: 9, tp: 8, np: "P".repeat(18) },
    ]));
    expect(f.records.lowRoundsNet.map((c) => [c.name, c.net, c.netToPar]))
      .toEqual([["Cal C", 71, -1], ["Amy A", 72, 0]]);
  });

  // Against par first, and only then on the score — which can only ever
  // separate two rounds at DIFFERENT pars, because inside one round level
  // against par is the same net number.
  it("separates two men level against par by the one who took fewer shots", () => {
    const two = {
      players: toy.players,
      editions: [{
        year: 2001, teamA: "REDS", teamB: "BLUES", complete: true,
        roster: [{ p: "a", t: "A" }, { p: "c", t: "B" }],
      }],
      rounds: [
        { year: 2001, round: 1, format: "singles", course: "Long", par: 73 },
        { year: 2001, round: 2, format: "singles", course: "Short", par: 70 },
      ],
      matches: [],
      cards: [
        // Both one under net. a went round a par 73 in 72 net, c a par 70 in 69.
        { year: 2001, round: 1, p: "a", g: 82, ch: 10, tp: 9, e: 0, b: 0, pr: 0, bo: 0, d: 0, np: "P".repeat(18) },
        { year: 2001, round: 2, p: "c", g: 79, ch: 10, tp: 9, e: 0, b: 0, pr: 0, bo: 0, d: 0, np: "P".repeat(18) },
      ],
    };
    const f = foldArchive(two);
    expect(f.records.lowRoundsNet.map((c) => [c.name, c.net, c.netToPar]))
      .toEqual([["Cal C", 69, -1], ["Amy A", 72, -1]]);
  });

  it("keeps a shared ball off the net board too", () => {
    const f = foldArchive(roundOf([
      { p: "a", g: 70, ch: 10, tp: -2, np: "P".repeat(18) },
      { p: "c", g: 71, ch: 10, tp: -1, np: "P".repeat(18) },
    ], "scramble"));
    expect(f.records.lowRoundsNet).toEqual([]);
    expect(f.careerOf("a").bestNet).toBeNull();
    // But it is still a net round for his average — a card is a card.
    expect(f.careerOf("a").netRounds).toBe(1);
  });

  it("ranks net birdies on the marks and gross ones on the summary", () => {
    const f = foldArchive(roundOf([
      // a made one gross birdie and eight net ones.
      { p: "a", g: 90, ch: 18, tp: 18, e: 0, b: 1, pr: 2, bo: 7, d: 8, np: "BBBBBBBB1111111111" },
      { p: "c", g: 74, ch: 2, tp: 2, e: 0, b: 4, pr: 9, bo: 5, d: 0, np: "BB1111111111111111" },
    ]));
    expect(f.records.mostBirdies.map((r) => r.name)).toEqual(["Cal C", "Amy A"]);
    expect(f.records.mostBirdiesNet.map((r) => r.name)).toEqual(["Amy A", "Cal C"]);
    expect(f.careerOf("a").birdiesPerRoundNet).toBe(8);
  });

  // On the real record, which is the whole reason the chip is worth having.
  it("names different men on the committed archive", () => {
    const f = foldArchive(archive);
    const names = (rows) => rows.map((r) => r.name);
    expect(names(f.records.lowRounds)).not.toEqual(names(f.records.lowRoundsNet));
    expect(names(f.records.mostBirdies)).not.toEqual(names(f.records.mostBirdiesNet));
    expect(f.records.lowRoundsNet).toHaveLength(5);
    expect(f.records.bestWeeksNet).toHaveLength(5);
    expect(f.strokesGained.bestNet).toHaveLength(5);
    // Every net card ranks under par or close to it: handicaps are what they
    // are for. Gross, the same board is four rounds by one man.
    expect(new Set(names(f.records.lowRoundsNet)).size).toBeGreaterThan(1);
  });
});

// ── Best by round, and recent form ────────────────────────────────
describe("best by round", () => {
  const cup = (cards) => ({
    players: toy.players,
    editions: [{
      year: 2001, teamA: "REDS", teamB: "BLUES", complete: true,
      roster: [{ p: "a", t: "A" }, { p: "c", t: "B" }],
    }],
    rounds: [1, 2, 3, 4].map((round) => ({ year: 2001, round, format: "singles", course: "Toy", par: 72 })),
    matches: [],
    cards: cards.map((c) => ({ year: 2001, ch: 8, e: 0, b: 0, pr: 0, bo: 0, d: 0, np: "P".repeat(18), ...c })),
  });

  it("gives one row per round, lowest in that round", () => {
    const f = foldArchive(cup([
      { round: 1, p: "a", g: 80, tp: 8 }, { round: 1, p: "c", g: 76, tp: 4 },
      { round: 2, p: "a", g: 74, tp: 2 }, { round: 2, p: "c", g: 79, tp: 7 },
      { round: 4, p: "a", g: 90, tp: 18 },
    ]));
    expect(f.records.bestByRound.map((c) => [c.round, c.name, c.g]))
      .toEqual([[1, "Cal C", 76], [2, "Amy A", 74], [4, "Amy A", 90]]);
  });

  it("names a round nobody has played not at all", () => {
    const f = foldArchive(cup([{ round: 2, p: "a", g: 74, tp: 2 }]));
    expect(f.records.bestByRound.map((c) => c.round)).toEqual([2]);
  });

  it("has a net board of its own, which can name a different man", () => {
    const f = foldArchive(cup([
      { round: 1, p: "a", g: 90, ch: 20, tp: 18 },
      { round: 1, p: "c", g: 76, ch: 2, tp: 4 },
    ]));
    expect(f.records.bestByRound[0].name).toBe("Cal C");
    expect(f.records.bestByRoundNet[0].name).toBe("Amy A");
  });
});

describe("recent form", () => {
  const years = [2001, 2002, 2003, 2004, 2005];
  const many = {
    players: toy.players,
    editions: years.map((year) => ({
      year, teamA: "REDS", teamB: "BLUES", complete: true,
      roster: [{ p: "a", t: "A" }, { p: "c", t: "B" }],
    })),
    rounds: years.map((year) => ({ year, round: 1, format: "singles", course: "Toy", par: 72 })),
    // a loses the first two cups 0-3 and wins the last three 3-0.
    matches: years.map((year, i) => ({
      year, round: 1, A: ["a"], B: ["c"], ptsA: i < 2 ? 0 : 3, ptsB: i < 2 ? 3 : 0,
    })),
    cards: [],
  };

  it("opens on the last three cups PLAYED, newest first", () => {
    const f = foldArchive(many);
    expect(RECENT_CUPS).toBe(3);
    expect(f.recentYears()).toEqual([2005, 2004, 2003]);
  });

  // How far back is the reader's to choose.
  it("reaches back as far as it is asked to", () => {
    const f = foldArchive(many);
    expect(f.recentYears(2)).toEqual([2005, 2004]);
    expect(f.recentYears(4)).toEqual([2005, 2004, 2003, 2002]);
  });

  // One cup is not form, it is a year, and the chip beside it already offers
  // a single year by name.
  it("will not go below two", () => {
    const f = foldArchive(many);
    expect(RECENT_MIN).toBe(2);
    expect(f.recentYears(1)).toEqual([2005, 2004]);
    expect(f.recentYears(0)).toEqual([2005, 2004]);
  });

  // And never all of them: Career is the position above it on the same chip
  // group, so a last-N that IS the career is a control doing nothing.
  it("stops short of the whole record", () => {
    const f = foldArchive(many);
    expect(f.recentMax).toBe(4);
    expect(recentMax(5)).toBe(4);
    expect(f.recentYears(99)).toHaveLength(4);
    // A project with two cups in it still has a floor.
    expect(recentMax(2)).toBe(2);
    expect(recentMax(1)).toBe(2);
  });

  it("re-totals a career over only those years", () => {
    const f = foldArchive(many);
    const [a] = f.careerOver(f.recentYears()).filter((r) => r.id === "a");
    expect(a.apps).toBe(3);
    expect(a.matches).toBe(3);
    expect(a.w).toBe(3);
    expect(a.l).toBe(0);
    expect(a.pts).toBe(9);
    expect(a.years).toEqual([2003, 2004, 2005]);
    // Against the whole record, which is 3-2.
    expect(f.careerOf("a").w).toBe(3);
    expect(f.careerOf("a").l).toBe(2);
  });

  it("re-counts cups won rather than carrying the career's", () => {
    const f = foldArchive(many);
    const [a] = f.careerOver(f.recentYears()).filter((r) => r.id === "a");
    expect(a.cupsWon).toBe(3);
    expect(a.cupsLost).toBe(0);
    expect(f.careerOf("a").cupsWon).toBe(3);
    expect(f.careerOf("a").cupsLost).toBe(2);
  });

  // The "vs" in recent form vs total history: the slice carries the career
  // figure it is being read against.
  it("carries the career rate alongside the slice's", () => {
    const f = foldArchive(many);
    const [a] = f.careerOver(f.recentYears()).filter((r) => r.id === "a");
    expect(a.ppm).toBe(3);
    expect(a.careerPpm).toBe(9 / 5);
  });

  it("leaves out a man who played none of them", () => {
    const f = foldArchive(many);
    expect(f.careerOver([1999]).length).toBe(0);
  });
});

// ── The core sixteen ──────────────────────────────────────────────
describe("the core", () => {
  // n cups, each with the same two men, so appearances are the only variable.
  const cups = (appsOf) => {
    const years = [...new Set(Object.values(appsOf).flat())].sort();
    return {
      players: toy.players,
      editions: years.map((year) => ({
        year, teamA: "REDS", teamB: "BLUES", complete: true,
        roster: Object.entries(appsOf).filter(([, ys]) => ys.includes(year))
          .map(([p], i) => ({ p, t: i % 2 ? "B" : "A" })),
      })),
      rounds: [], matches: [], cards: [],
    };
  };

  it("takes everyone with four cups or more", () => {
    const f = foldArchive(cups({
      a: [2001, 2002, 2003, 2004],
      b: [2001, 2002, 2003],
      c: [2004],
    }));
    expect(CORE_MIN_APPS).toBe(4);
    expect([...f.core].sort()).toEqual(["a"]);
  });

  // On the real record the rule lands on sixteen, and it is not a number
  // chosen to: the sixteenth man has played seven cups and the seventeenth
  // has played three, so any cut between four and seven names the same men.
  it("names sixteen on the committed archive, with room either side", () => {
    const f = foldArchive(archive);
    expect(f.core.size).toBe(16);
    const apps = f.career.filter((r) => r.apps).map((r) => r.apps).sort((x, y) => y - x);
    expect(apps[15]).toBeGreaterThanOrEqual(7);
    expect(apps[16]).toBeLessThanOrEqual(3);
    [4, 5, 6, 7].forEach((cut) => {
      expect(f.career.filter((r) => r.apps >= cut).length).toBe(16);
    });
  });
});

describe("boards over a chosen field", () => {
  const f = foldArchive(archive);

  it("hands back the whole record when asked for everybody", () => {
    expect(f.boards(null).records.lowRounds).toEqual(f.records.lowRounds);
    expect(f.boards(null).streaks).toEqual(f.streaks);
    expect(f.boards(null).strokesGained).toEqual(f.strokesGained);
  });

  // The reason this is a function of the field and not a filter over a
  // finished board: John S played two cups and holds the four lowest rounds
  // in the record, so cutting the top five down to the core afterwards leaves
  // one line on it.
  it("cuts to the field before it cuts to five", () => {
    const core = f.boards(f.core);
    expect(f.records.lowRounds.filter((c) => f.core.has(c.id))).toHaveLength(1);
    expect(core.records.lowRounds).toHaveLength(5);
    core.records.lowRounds.forEach((c) => expect(f.core.has(c.id)).toBe(true));
  });

  it("keeps every board inside the field it was asked for", () => {
    const core = f.boards(f.core);
    const ids = (rows) => rows.forEach((r) => expect(f.core.has(r.id)).toBe(true));
    ["lowRounds", "bestWeeks", "mostPoints", "mostApps", "bestRate", "mostBirdies", "comebacks"]
      .forEach((k) => ids(core.records[k]));
    ["gross", "net", "best"].forEach((k) => ids(core.strokesGained[k]));
    Object.values(core.streaks).forEach(ids);
  });

  // The cup's own records are not a player board. Which year was closest is
  // the same answer whoever is being listed.
  it("leaves the cup's own records alone", () => {
    const core = f.boards(f.core);
    expect(core.records.closest).toEqual(f.records.closest);
    expect(core.records.cupComebacks).toEqual(f.records.cupComebacks);
    expect(core.records.cupsPlayed).toBe(f.records.cupsPlayed);
  });
});

// ── The biggest comeback ──────────────────────────────────────────
describe("trailing into the last round and winning anyway", () => {
  // n rounds, each one match, with the points given per round for each side.
  const cupOf = (year, perRound, complete = true) => ({
    players: toy.players,
    editions: [{
      year, teamA: "REDS", teamB: "BLUES", complete,
      roster: [{ p: "a", t: "A" }, { p: "c", t: "B" }],
    }],
    rounds: perRound.map((_, i) => ({ year, round: i + 1, format: "singles", course: "Toy", par: 72 })),
    matches: perRound.map(([ptsA, ptsB], i) => ({ year, round: i + 1, A: ["a"], B: ["c"], ptsA, ptsB })),
    cards: [],
  });

  it("counts the deficit at the boundary where it was deepest", () => {
    // Down 8–2 after two, then 9–0: won by 3 from 6 down.
    const f = foldArchive(cupOf(2001, [[1, 4], [1, 4], [9, 0]]));
    const [cb] = f.records.cupComebacks;
    expect(cb.year).toBe(2001);
    expect(cb.deficit).toBe(6);
    expect(cb.after).toBe(2);
    expect(cb.margin).toBe(3);
  });

  // Any boundary, whatever the cup's length — nothing here is tied to round
  // three by number.
  it("looks at every boundary, whatever the cup's length", () => {
    expect(foldArchive(cupOf(2001, [[0, 5], [9, 0]])).records.cupComebacks[0].after).toBe(1);
    expect(foldArchive(cupOf(2002, [[1, 1], [1, 1], [1, 1], [0, 5], [9, 0]]))
      .records.cupComebacks[0].after).toBe(4);
  });

  it("is not a comeback if the winner was already ahead", () => {
    expect(foldArchive(cupOf(2001, [[5, 0], [5, 0], [1, 1]])).records.cupComebacks).toEqual([]);
  });

  it("is not a comeback if the cup was halved or is unfinished", () => {
    expect(foldArchive(cupOf(2001, [[0, 5], [5, 0]])).records.cupComebacks).toEqual([]);
    expect(foldArchive(cupOf(2001, [[0, 5], [9, 0]], false)).records.cupComebacks).toEqual([]);
  });

  it("ranks the biggest deficit first", () => {
    const a = cupOf(2001, [[0, 3], [9, 0]]);
    const b = cupOf(2002, [[0, 9], [20, 0]]);
    const f = foldArchive({
      players: toy.players,
      editions: [...a.editions, ...b.editions],
      rounds: [...a.rounds, ...b.rounds],
      matches: [...a.matches, ...b.matches],
      cards: [],
    });
    expect(f.records.cupComebacks.map((c) => [c.year, c.deficit])).toEqual([[2002, 9], [2001, 3]]);
  });

  // A deficit faced early still counts. Measuring only the final round found
  // three cups and called 2016 a one-point comeback when they had been five
  // down on Friday night.
  it("counts a deficit from any round, not only the last", () => {
    const f = foldArchive(cupOf(2001, [[0, 8], [9, 0], [9, 0], [1, 1]]));
    const [cb] = f.records.cupComebacks;
    // Eight down after R1, in front from R2 on, and it is still a comeback.
    expect(cb.deficit).toBe(8);
    expect(cb.after).toBe(1);
  });

  it("counts a round 2 deficit a side had already recovered from", () => {
    // Level after R1, four down after R2, ahead after R3, wins.
    const f = foldArchive(cupOf(2001, [[2, 2], [0, 4], [6, 0], [2, 2]]));
    const [cb] = f.records.cupComebacks;
    expect(cb.deficit).toBe(4);
    expect(cb.after).toBe(2);
  });

  // The same deficit with less left to fix it is the harder hole.
  it("breaks a tie toward the later round", () => {
    // Five down after R1 and five down again after R2.
    const f = foldArchive(cupOf(2001, [[0, 5], [3, 3], [9, 0]]));
    const [cb] = f.records.cupComebacks;
    expect(cb.deficit).toBe(5);
    expect(cb.after).toBe(2);
  });

  it("never reads the final round as a deficit to have overcome", () => {
    // Ahead at every boundary, and the last round is not a boundary at all.
    expect(foldArchive(cupOf(2001, [[5, 0], [5, 0], [0, 4]])).records.cupComebacks).toEqual([]);
  });

  // On the real record: five of the ten cups, and the two the old measure
  // could not see are 2017 and 2022.
  it("finds five on the committed archive, 2025 deepest", () => {
    const f = foldArchive(archive);
    expect(f.records.cupComebacks.map((c) => [c.year, c.deficit, c.after]))
      .toEqual([[2025, 11, 3], [2017, 8, 1], [2022, 7, 1], [2016, 5, 1], [2018, 5, 1]]);
  });
});

// ── Strokes gained ────────────────────────────────────────────────
// Against the field, inside one round. It is zero-sum by construction, which
// is the check worth having: if it ever stops summing to zero, the field the
// comparison is against is not the field that played.
describe("strokes gained", () => {
  const round1 = (gs) => ({
    players: toy.players,
    editions: [{
      year: 2001, teamA: "REDS", teamB: "BLUES", complete: true,
      roster: Object.keys(gs).map((p) => ({ p, t: "A" })),
    }],
    rounds: [{ year: 2001, round: 1, format: "best_ball", course: "Toy", par: 72 }],
    matches: [],
    cards: Object.entries(gs).map(([p, [g, ch]]) => ({
      year: 2001, round: 1, p, g, ch, tp: g - 72, e: 0, b: 0, pr: 0, bo: 0, d: 0,
    })),
  });

  it("is the field average less his own score", () => {
    // 70, 80, 90 — the field averages 80.
    const f = foldArchive(round1({ a: [70, 0], b: [80, 0], c: [90, 0] }));
    expect(f.careerOf("a").sg).toBeCloseTo(10, 9);
    expect(f.careerOf("b").sg).toBeCloseTo(0, 9);
    expect(f.careerOf("c").sg).toBeCloseTo(-10, 9);
  });

  it("sums to zero across the field", () => {
    const f = foldArchive(round1({ a: [71, 4], b: [83, 11], c: [96, 22], d: [88, 15] }));
    expect(f.career.reduce((s, r) => s + (r.sg ?? 0) * r.sgRounds, 0)).toBeCloseTo(0, 9);
    expect(f.career.reduce((s, r) => s + (r.sgNetPer ?? 0) * r.sgNets, 0)).toBeCloseTo(0, 9);
  });

  it("answers gross and net differently, which is the point of showing both", () => {
    // b shoots five more than a and gets eleven more strokes.
    const f = foldArchive(round1({ a: [75, 2], b: [80, 13] }));
    expect(f.careerOf("a").sg).toBeGreaterThan(f.careerOf("b").sg);
    expect(f.careerOf("a").sgNetPer).toBeLessThan(f.careerOf("b").sgNetPer);
  });

  // A man compared with himself is zero by construction, and a board of those
  // would be topped by whoever played a round nobody else did.
  it("refuses a field of one", () => {
    const f = foldArchive(round1({ a: [70, 0] }));
    expect(f.careerOf("a").sg).toBeNull();
    expect(f.careerOf("a").sgRounds).toBe(0);
  });

  it("leaves a shared ball out of it", () => {
    const base = round1({ a: [70, 0], b: [80, 0] });
    const shared = { ...base, rounds: [{ ...base.rounds[0], format: "scramble" }] };
    expect(foldArchive(base).careerOf("a").sg).toBeCloseTo(5, 9);
    expect(foldArchive(shared).careerOf("a").sg).toBeNull();
  });

  it("has no net figure for a card with no handicap on it", () => {
    const f = foldArchive(round1({ a: [70, null], b: [80, null] }));
    expect(f.careerOf("a").sg).toBeCloseTo(5, 9);
    expect(f.careerOf("a").sgNetPer).toBeNull();
  });

  it("keeps a short career off the board but not out of the record", () => {
    const f = foldArchive(round1({ a: [70, 0], b: [80, 0] }));
    expect(f.careerOf("a").sg).toBeCloseTo(5, 9);
    // One round is a long way short of the eight-round floor.
    expect(f.strokesGained.gross).toEqual([]);
    // The best single round has no floor — it is one round by definition.
    expect(f.strokesGained.best[0].name).toBe("Amy A");
  });
});

// ── Streaks ───────────────────────────────────────────────────────
// The marks themselves are pinned in streaks.test.js. What is pinned here is
// what the fold refuses to carry a run through.
describe("streaks", () => {
  const holes = (np, hr) => ({ np, hr });
  const cup = (year, cards, format = "best_ball") => ({
    players: toy.players,
    editions: [{
      year, teamA: "REDS", teamB: "BLUES", complete: true,
      roster: [{ p: "a", t: "A" }, { p: "c", t: "B" }],
    }],
    rounds: [{ year, round: 1, format, course: "Toy", par: 72 },
      { year, round: 2, format, course: "Toy", par: 72 }],
    matches: [{ year, round: 1, A: ["a"], B: ["c"], ptsA: 3, ptsB: 0 }],
    cards,
  });
  const card = (year, round, p, marks) => ({
    year, round, p, g: 80, ch: 8, tp: 8, e: 0, b: 0, pr: 0, bo: 0, d: 0, ...marks,
  });

  it("carries a run from one round into the next", () => {
    const f = foldArchive(cup(2001, [
      card(2001, 1, "a", holes("111111111111111PPP", "------------------")),
      card(2001, 2, "a", holes("PPPPP1111111111111", "------------------")),
    ]));
    // Three to finish Friday and five to open Saturday is one run of eight.
    expect(f.streaks.netPar[0].len).toBe(8);
    expect(f.streaks.netPar[0].from.round).toBe(1);
    expect(f.streaks.netPar[0].to.round).toBe(2);
  });

  it("starts a new cup fresh, so no run is twelve months long", () => {
    const one = cup(2001, [card(2001, 2, "a", holes("1111111111111111PP", ""))]);
    const two = cup(2002, [card(2002, 1, "a", holes("PPPP11111111111111", ""))]);
    const f = foldArchive({
      players: toy.players,
      editions: [...one.editions, ...two.editions],
      rounds: [...one.rounds, ...two.rounds],
      matches: [...one.matches, ...two.matches],
      cards: [...one.cards, ...two.cards],
    });
    // Two to end 2001 and four to open 2002 is a four, not a six.
    expect(f.streaks.netPar[0].len).toBe(4);
    expect(f.streaks.netPar[0].from.year).toBe(2002);
  });

  it("will not carry a net run through a shared ball", () => {
    const base = cup(2001, [
      card(2001, 1, "a", holes("PPPPPPPPPPPPPPPPPP", "")),
      card(2001, 2, "a", holes("PPPPPPPPPPPPPPPPPP", "")),
    ]);
    expect(foldArchive(base).streaks.netPar[0].len).toBe(36);
    // The same two cards with a scramble in the middle of them: the shared
    // ball is eighteen gaps, so 36 becomes two 18s.
    const split = { ...base, rounds: base.rounds.map((r) => r.round === 2 ? { ...r, format: "scramble" } : r) };
    expect(foldArchive(split).streaks.netPar[0].len).toBe(18);
  });

  it("counts a halved hole as neither won nor lost", () => {
    const f = foldArchive(cup(2001, [
      card(2001, 1, "a", holes("", "WWHWW-------------")),
    ]));
    expect(f.streaks.holesWon[0].len).toBe(2);
    expect(f.streaks.holesLost).toEqual([]);
  });

  it("counts a halve into a winless run, because it is not a win", () => {
    const f = foldArchive({
      ...toy,
      editions: [{ ...toy.editions[0], complete: true }],
    });
    // b halved his singles and was on the winning four-ball, so his longest
    // run without a win is the one halve.
    expect(f.streakOf("b").winless.len).toBe(1);
    expect(f.streakOf("d").winless.len).toBe(2);
  });

  it("keeps a run of one off the board", () => {
    const f = foldArchive(cup(2001, [card(2001, 1, "a", holes("", "W-W-W-------------"))]));
    expect(f.streaks.holesWon).toEqual([]);
  });

  it("says nothing at all about cards with no marks on them", () => {
    const f = foldArchive(toy);
    expect(f.streaks.netPar).toEqual([]);
    expect(f.streaks.holesWon).toEqual([]);
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

  // Six of the ten lowest cards in the record were scramble balls, each
  // printed twice because both partners sign it. On the real archive:
  it("ranks no shared ball among the low rounds", () => {
    const shared = new Set(archive.rounds
      .filter((r) => ["scramble", "pinehurst", "shamble"].includes(r.format))
      .map((r) => `${r.year}_${r.round}`));
    expect(shared.size).toBeGreaterThan(0);
    expect(f.records.lowRounds.filter((c) => shared.has(`${c.year}_${c.round}`))).toEqual([]);
    expect(f.career.filter((r) => r.best && shared.has(`${r.best.year}_${r.best.round}`))).toEqual([]);
  });

  // Each year was played in its own colours, off its own SCOREBOARD banner.
  // Without them the Data tab drew a decade of teams in whatever colours the
  // CURRENT edition happens to use.
  it("carries the colours a year was played in", () => {
    const branded = f.editions.filter((e) => e.brand);
    expect(branded.length).toBeGreaterThanOrEqual(7);
    branded.forEach((e) => {
      const sides = Object.values(e.brand);
      expect(sides.length).toBeGreaterThan(0);
      sides.forEach((b) => expect(b.color).toMatch(/^#[0-9A-Fa-f]{6}$/));
    });
    // 2022 wrote its teams in coloured type: Irons navy, Drivers red.
    const y2022 = f.editions.find((e) => e.year === 2022);
    expect(y2022.brand).toEqual({ A: { color: "#073763" }, B: { color: "#CC0000" } });
  });

  // Absent is not an error, and it is not the same as a black banner either:
  // both mean the side keeps the app's palette.
  it("leaves the years with no banner colour without one", () => {
    [2016, 2017, 2018].forEach((year) => {
      expect(f.editions.find((e) => e.year === year).brand).toBeNull();
    });
    // 2023 and 2024 wrote their second team in black on white, which is not a
    // colour — one side only, and the other falls back.
    [2023, 2024].forEach((year) => {
      const { brand } = f.editions.find((e) => e.year === year);
      expect(brand.A.color).toMatch(/^#/);
      expect(brand.B).toBeUndefined();
    });
  });

  it("gives every card eighteen streak marks", () => {
    archive.cards.forEach((c) => {
      expect(c.np).toHaveLength(18);
      expect(c.hr).toHaveLength(18);
      expect(c.np).toMatch(/^[EBP123-]{18}$/);
      expect(c.hr).toMatch(/^[WLH-]{18}$/);
    });
  });

  // Every hole streak is inside one cup, so the span on screen is always a
  // week somebody could go and check.
  it("keeps every hole streak inside a single year", () => {
    ["holesWon", "holesLost", "netPar", "noDouble", "noPar"].forEach((k) => {
      expect(f.streaks[k].length).toBeGreaterThan(0);
      f.streaks[k].forEach((s) => expect(s.from.year).toBe(s.to.year));
    });
  });

  // And no net streak is standing on a ball two men shared.
  it("runs no net streak through a shared-ball round", () => {
    const shared = new Set(archive.rounds
      .filter((r) => ["scramble", "pinehurst", "shamble"].includes(r.format))
      .map((r) => `${r.year}_${r.round}`));
    ["netPar", "noDouble", "noPar"].forEach((k) => {
      f.streaks[k].forEach((s) => {
        for (let round = s.from.round; round <= s.to.round; round++) {
          expect(shared.has(`${s.from.year}_${round}`)).toBe(false);
        }
      });
    });
  });

  // On the real record, across ten years and forty rounds.
  it("gains no strokes on the field overall", () => {
    expect(f.career.reduce((s, r) => s + (r.sg ?? 0) * r.sgRounds, 0)).toBeCloseTo(0, 6);
    expect(f.career.reduce((s, r) => s + (r.sgNetPer ?? 0) * r.sgNets, 0)).toBeCloseTo(0, 6);
  });

  it("admits nobody to a strokes gained board under the round floor", () => {
    const min = f.strokesGained.minRounds;
    f.strokesGained.gross.forEach((r) => expect(r.sgRounds).toBeGreaterThanOrEqual(min));
    f.strokesGained.net.forEach((r) => expect(r.sgNets).toBeGreaterThanOrEqual(min));
  });

  it("counts every card's holes as eighteen", () => {
    archive.cards.forEach((c) => {
      expect(c.e + c.b + c.pr + c.bo + c.d).toBe(18);
    });
  });
});
