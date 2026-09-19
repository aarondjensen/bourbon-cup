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

  // ── The other end, and the whole week ───────────────────────────
  it("ranks the worst round from the bottom, not the top", () => {
    const f = foldArchive(round1({ a: [70, 0], b: [80, 0], c: [90, 0] }));
    expect(f.strokesGained.best[0].name).toBe("Amy A");
    expect(f.strokesGained.worst[0].name).toBe("Cal C");
    expect(f.strokesGained.worst[0].sg).toBeCloseTo(-10, 9);
  });

  it("keeps a week off the board until it is three own-ball rounds", () => {
    const week = (rounds) => ({
      players: toy.players,
      editions: [{
        year: 2001, teamA: "REDS", teamB: "BLUES", complete: true,
        roster: [{ p: "a", t: "A" }, { p: "c", t: "B" }],
      }],
      rounds: rounds.map((n) => ({ year: 2001, round: n, format: "best_ball", course: `Toy ${n}`, par: 72 })),
      matches: [],
      cards: rounds.flatMap((n) => [
        { year: 2001, round: n, p: "a", g: 70, ch: 0, tp: -2, e: 0, b: 0, pr: 0, bo: 0, d: 0 },
        { year: 2001, round: n, p: "c", g: 80, ch: 0, tp: 8, e: 0, b: 0, pr: 0, bo: 0, d: 0 },
      ]),
    });
    expect(foldArchive(week([1, 2])).strokesGained.weeks).toEqual([]);
    const three = foldArchive(week([1, 2, 3])).strokesGained.weeks;
    expect(three[0].name).toBe("Amy A");
    // Five a round, three rounds — TOTALLED over the week, not averaged.
    expect(three[0].sg).toBeCloseTo(15, 9);
    expect(three[0].rounds).toBe(3);
  });
});

// ── One cup, round by round ───────────────────────────────────────
describe("a year's strokes gained by round", () => {
  // Two men, and whatever days are asked for.
  const year = (days) => ({
    players: toy.players,
    editions: [{
      year: 2001, teamA: "REDS", teamB: "BLUES", complete: true,
      roster: [{ p: "a", t: "A" }, { p: "c", t: "B" }],
    }],
    rounds: days.map((d) => ({
      year: 2001, round: d.round, format: d.format || "best_ball", course: `Toy ${d.round}`, par: 72,
    })),
    matches: [],
    cards: days.flatMap((d) => Object.entries(d.scores).map(([p, g]) => ({
      year: 2001, round: d.round, p, g, ch: 0, tp: g - 72, e: 0, b: 0, pr: 0, bo: 0, d: 0,
    }))),
  });

  it("names a column per round and totals the row", () => {
    const t = foldArchive(year([
      { round: 1, scores: { a: 70, c: 80 } },
      { round: 2, scores: { a: 74, c: 78 } },
    ])).sgYear(2001);
    expect(t.rounds).toEqual([1, 2]);
    const a = t.rows[0];
    expect(a.name).toBe("Amy A");
    expect(a.by[1].gross).toBeCloseTo(5, 9);
    expect(a.by[2].gross).toBeCloseTo(2, 9);
    // The total is the SUM of the columns shown, so the row adds up on screen.
    expect(a.gross).toBeCloseTo(7, 9);
    expect(a.grossRounds).toBe(2);
    // Gross descending, and the other half of a field is always the negative.
    expect(t.rows[1].gross).toBeCloseTo(-7, 9);
  });

  it("leaves a shared-ball day off the columns entirely", () => {
    const t = foldArchive(year([
      { round: 1, scores: { a: 70, c: 80 } },
      { round: 2, format: "scramble", scores: { a: 64, c: 64 } },
      { round: 3, scores: { a: 74, c: 78 } },
    ])).sgYear(2001);
    // R1 R3, which is what the board's OWN BALL label is answering for.
    expect(t.rounds).toEqual([1, 3]);
    expect(t.rows[0].by[2]).toBeUndefined();
    expect(t.rows[0].grossRounds).toBe(2);
  });

  it("drops a round one man played alone, which is not a field", () => {
    const t = foldArchive(year([
      { round: 1, scores: { a: 70, c: 80 } },
      { round: 2, scores: { a: 74 } },
    ])).sgYear(2001);
    expect(t.rounds).toEqual([1]);
  });

  it("totals a man over the rounds he played, not the rounds there were", () => {
    const t = foldArchive(year([
      { round: 1, scores: { a: 70, c: 80 } },
      { round: 2, scores: { a: 74, c: 78, d: 76 } },
    ])).sgYear(2001);
    const c = t.rows.find((r) => r.id === "c");
    const d = t.rows.find((r) => r.id === "d");
    expect(c.grossRounds).toBe(2);
    expect(d.grossRounds).toBe(1);
    expect(d.by[1]).toBeUndefined();
    expect(d.gross).toBeCloseTo(d.by[2].gross, 9);
  });

  it("carries the side so a row can be drawn in its team's colour", () => {
    const t = foldArchive(year([{ round: 1, scores: { a: 70, c: 80 } }])).sgYear(2001);
    expect(t.rows.find((r) => r.id === "a").teamName).toBe("REDS");
    expect(t.rows.find((r) => r.id === "c").side).toBe("B");
  });

  it("says nothing about a year that was never played", () => {
    expect(foldArchive(toy).sgYear(1999)).toBeNull();
  });

  // The real ten, through the same door the screen uses.
  it("answers every finished year the archive holds", () => {
    const f = foldArchive(archive);
    f.years.forEach((y) => {
      const t = f.sgYear(y);
      if (!t) return;
      expect(t.rounds.length).toBeGreaterThan(0);
      t.rows.forEach((r) => {
        const sum = t.rounds.reduce((acc, n) => acc + (r.by[n]?.gross ?? 0), 0);
        expect(r.gross).toBeCloseTo(sum, 6);
      });
    });
  });
});

// ── Strokes gained as a cup record ────────────────────────────────
// The team board is net and per man; the field spread is gross and per round.
describe("a side's day in strokes gained", () => {
  // Eight men, four a side, one own-ball round.
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const cup = (gs, format = "best_ball", days = [1]) => ({
    players: ids.map((id) => ({ id, name: id.toUpperCase(), aka: [id] })),
    editions: [{
      year: 2001, teamA: "REDS", teamB: "BLUES", complete: true,
      roster: ids.map((p, i) => ({ p, t: i < 4 ? "A" : "B" })),
    }],
    rounds: days.map((n) => ({ year: 2001, round: n, format, course: `Toy ${n}`, par: 72 })),
    matches: [],
    cards: days.flatMap((n) => ids.map((p, i) => ({
      year: 2001, round: n, p, g: gs[i], ch: 0, tp: gs[i] - 72, e: 0, b: 0, pr: 0, bo: 0, d: 0,
    }))),
  });

  it("names the side that played above itself, per man", () => {
    // REDS average 75, BLUES 85; the field is 80.
    const f = foldArchive(cup([74, 75, 75, 76, 84, 85, 85, 86]));
    const top = f.records.sgTeamRounds[0];
    expect(top.team).toBe("REDS");
    expect(top.men).toBe(4);
    expect(top.per).toBeCloseTo(5, 9);
    // One board, one side: the other half of a round is always negative.
    expect(f.records.sgTeamRounds).toHaveLength(1);
  });

  it("leaves a shared ball out of it, like every other own-ball board", () => {
    expect(foldArchive(cup([74, 75, 75, 76, 84, 85, 85, 86], "scramble")).records.sgTeamRounds).toEqual([]);
  });

  it("refuses a day half a side did not play own ball", () => {
    const thin = cup([74, 75, 75, 76, 84, 85, 85, 86]);
    // Three cards a side is not a team performance.
    thin.cards = thin.cards.filter((c) => !["d", "h"].includes(c.p));
    expect(foldArchive(thin).records.sgTeamRounds).toEqual([]);
  });

  it("measures how far apart a field was, in strokes a round", () => {
    // Two days, because one round a man is noise rather than a level.
    const tight = foldArchive(cup([79, 80, 80, 81, 79, 80, 80, 81], "best_ball", [1, 2]));
    const wide = foldArchive(cup([60, 70, 80, 90, 100, 70, 80, 90], "best_ball", [1, 2]));
    expect(tight.records.tightestField.spread).toBeLessThan(wide.records.tightestField.spread);
    // One cup is both ends of its own board.
    expect(tight.records.widestField.year).toBe(2001);
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

  // ── The run still going ─────────────────────────────────────────
  describe("current cup streaks", () => {
    const years = [2001, 2002, 2003, 2004];
    const cups = (results) => ({
      players: toy.players,
      editions: years.map((year) => ({
        year, teamA: "REDS", teamB: "BLUES", complete: true,
        roster: [{ p: "a", t: "A" }, { p: "c", t: "B" }],
      })),
      rounds: years.map((year) => ({ year, round: 1, format: "singles", course: "Toy", par: 72 })),
      // `results` is a's result per year; c gets the other side of it.
      matches: years.map((year, i) => ({
        year, round: 1, A: ["a"], B: ["c"],
        ptsA: results[i] === "W" ? 3 : 0, ptsB: results[i] === "W" ? 0 : 3,
      })),
      cards: [],
    });

    it("reads the run off the end, not the best one in the career", () => {
      // a wins the first three, loses the last two — his best is 3, his
      // current is nothing, and his current LOSING run is 1 (under the floor).
      const f = foldArchive(cups(["W", "W", "W", "L"]));
      expect(f.streakOf("a").cupsWon.len).toBe(3);
      expect(f.streakOf("a").cupsWonNow).toBeNull();
      expect(f.streakOf("a").cupsLostNow.len).toBe(1);
      // And his opponent is on the other side of all of it.
      expect(f.streakOf("c").cupsWonNow.len).toBe(1);
    });

    it("names the run when it reaches the latest cup", () => {
      const f = foldArchive(cups(["L", "W", "W", "W"]));
      const now = f.streakOf("a").cupsWonNow;
      expect(now.len).toBe(3);
      expect(now.from.year).toBe(2002);
      expect(now.to.year).toBe(2004);
      expect(f.streaks.cupsWonNow[0].name).toBe("Amy A");
    });

    // The rule that separates a current streak from a longest one. A longest
    // run steps over a year a man missed; a current run cannot, or the board
    // reports somebody as on a run he stopped being on years ago.
    it("is nothing at all for a man who missed the latest cup", () => {
      const base = cups(["W", "W", "W", "W"]);
      const f = foldArchive({
        ...base,
        // a skips the last cup entirely.
        editions: base.editions.map((e) => (e.year === 2004
          ? { ...e, roster: [{ p: "b", t: "A" }, { p: "c", t: "B" }] } : e)),
        matches: base.matches.map((m) => (m.year === 2004 ? { ...m, A: ["b"] } : m)),
      });
      expect(f.streakOf("a").cupsWon.len).toBe(3);
      expect(f.streakOf("a").cupsWonNow).toBeNull();
    });

    it("keeps a run of one off the board, like every other streak", () => {
      const f = foldArchive(cups(["L", "L", "L", "W"]));
      expect(f.streakOf("a").cupsWonNow.len).toBe(1);
      expect(f.streaks.cupsWonNow).toEqual([]);
    });
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

describe("a day is ranked against days played the same way", () => {
  // A cup whose scramble morning is the lowest field score of the week by
  // eight shots, which is what a scramble morning always is.
  const mixed = {
    ...toy,
    rounds: [
      { year: 2001, round: 1, format: "singles", course: "Toy Links", par: 72, rating: 72, slope: 113 },
      { year: 2001, round: 2, format: "scramble", course: "Toy Dunes", par: 72, rating: 72, slope: 113 },
    ],
    cards: [
      { year: 2001, round: 1, p: "a", g: 82, tp: 10, e: 0, b: 0, pr: 0, bo: 0, d: 0 },
      { year: 2001, round: 1, p: "c", g: 84, tp: 12, e: 0, b: 0, pr: 0, bo: 0, d: 0 },
      { year: 2001, round: 2, p: "a", g: 74, tp: 2, e: 0, b: 0, pr: 0, bo: 0, d: 0 },
      { year: 2001, round: 2, p: "c", g: 76, tp: 4, e: 0, b: 0, pr: 0, bo: 0, d: 0 },
    ],
  };
  const f = foldArchive(mixed);

  it("keeps the shared ball out of the easiest day and gives it its own", () => {
    expect(f.records.easiest.round).toBe(1);
    expect(f.records.hardest.round).toBe(1);
    expect(f.records.easiestShared.round).toBe(2);
    expect(f.records.hardestShared.round).toBe(2);
  });

  it("marks each round in the passport with which kind it was", () => {
    expect(f.courses.map((c) => [c.round, c.ownBall])).toEqual([[1, true], [2, false]]);
  });

  it("averages the week over the own-ball rounds", () => {
    // Every card: 10, 12, 2, 4. The own-ball ones: 10 and 12.
    expect(f.editions[0].avgToPar).toBeCloseTo(7, 6);
    expect(f.editions[0].avgOwnToPar).toBeCloseTo(11, 6);
  });

  it("has no own-ball day to name when the whole cup was shared", () => {
    const allShared = foldArchive({
      ...mixed,
      rounds: mixed.rounds.map((r) => ({ ...r, format: "scramble" })),
    });
    expect(allShared.records.hardest).toBeNull();
    expect(allShared.records.easiest).toBeNull();
    expect(allShared.records.easiestShared.round).toBe(2);
    expect(allShared.editions[0].avgOwnToPar).toBeNull();
    // And no week to rank, rather than a week ranked on nothing.
    expect(allShared.records.hardestWeek).toBeNull();
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

  // The Master Input's team cell is a key, not a banner — G-MEN is what the
  // 2017 workbook does lookups against, and the Greensmen is what they were
  // called. pipeline/editions.mjs keeps both; this is the one that shows.
  it("names each side the way the team was known", () => {
    expect(f.editions.find((e) => e.year === 2017).teamA).toBe("Greensmen");
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
    // Family Biz played in blue and orange and the banner kept the orange —
    // the pale end of it, which survives neither theme. The blue is named by
    // hand in pipeline/team-brand.mjs, and a rebuild must not walk it back.
    expect(f.editions.find((e) => e.year === 2020).brand.A).toEqual({ color: "#4A86E8" });
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

  // ── The tournament records ──────────────────────────────────────
  it("ranks the hardest day against the course's rating, not its par", () => {
    // The field shot worse at Harbor Shores in 2020; Glenoaks 2017 is where
    // they played worst for what the course was.
    expect(f.records.hardest.year).toBe(2017);
    expect(f.records.hardest.rated).toBe(true);
    // And the raw to-par board would have named a different day.
    const byToPar = f.courses.filter((c) => c.cards)
      .slice().sort((a, b) => b.avgToPar - a.avgToPar)[0];
    expect(byToPar.year).toBe(2020);
    // Both ends are ranked the same way, so nothing mixes the two scales.
    expect(f.records.easiest.rated).toBe(true);
    expect(f.records.easiest.difficulty).toBeLessThan(f.records.hardest.difficulty);
  });

  // The five scrambles in the record came in between +1.0 and -0.3 as a
  // field, and the shamble and the pinehurst a dozen shots under the worst
  // own-ball day. Ranked together they are the whole bottom of the board, and
  // EASIEST DAY is then a fact about the draw rather than about a golf course.
  it("ranks a shared-ball day only against other shared-ball days", () => {
    // Purgatory hosted both ends of it in one weekend: the singles on
    // Saturday is the kindest own-ball day in ten years, and the scramble
    // round it the next morning is the kindest shared one.
    expect([f.records.easiest.year, f.records.easiest.round]).toEqual([2021, 2]);
    expect(f.records.easiest.ownBall).toBe(true);
    expect([f.records.easiestShared.year, f.records.easiestShared.round]).toEqual([2021, 3]);
    expect(f.records.easiestShared.ownBall).toBe(false);
    // The hardest day is an own-ball day either way — the shared ones are
    // nowhere near it — but it is ranked in the same company all the same.
    expect(f.records.hardest.ownBall).toBe(true);
    expect(f.records.hardestShared.ownBall).toBe(false);
    // Neither board can reach into the other.
    const shared = new Set(archive.rounds
      .filter((r) => ["scramble", "pinehurst", "shamble"].includes(r.format))
      .map((r) => `${r.year}_${r.round}`));
    expect(shared.has(`${f.records.easiest.year}_${f.records.easiest.round}`)).toBe(false);
    expect(shared.has(`${f.records.easiestShared.year}_${f.records.easiestShared.round}`)).toBe(true);
    // And the two are not comparable, which is the point: every shared-ball
    // day in the record played easier than every own-ball one.
    expect(f.records.hardestShared.difficulty).toBeLessThan(f.records.easiest.difficulty);
  });

  it("names the hardest and easiest WEEK, which no board ranked", () => {
    expect(f.records.hardestWeek.year).toBe(2016);
    expect(f.records.easiestWeek.year).toBe(2023);
    expect(f.records.hardestWeek.avgOwnToPar).toBeGreaterThan(f.records.easiestWeek.avgOwnToPar);
  });

  // Three of the ten cups had no shared ball in them at all, so a week
  // average over every card ranks the DRAW: 2023 comes out four and a half
  // shots kinder than it played, and 2016 not a stroke kinder than it did.
  it("measures a week over its own-ball rounds", () => {
    const e = (year) => f.editions.find((x) => x.year === year);
    // 2016, 2020 and 2022 played four own-ball rounds: nothing to strip.
    [2016, 2020, 2022].forEach((year) => {
      expect(e(year).avgOwnToPar).toBeCloseTo(e(year).avgToPar, 6);
    });
    // Every other year had one, and every one of them played harder than the
    // raw average says.
    [2017, 2018, 2019, 2021, 2023, 2024, 2025].forEach((year) => {
      expect(e(year).avgOwnToPar).toBeGreaterThan(e(year).avgToPar);
    });
    // Which reorders the middle of the board: 2019 opened with a scramble and
    // is the third-hardest week in the record on own-ball rounds, where every
    // card put it fifth.
    const rank = (key) => f.editions.slice()
      .sort((a, b) => b[key] - a[key]).map((x) => x.year).indexOf(2019);
    expect(rank("avgOwnToPar")).toBe(2);
    expect(rank("avgToPar")).toBe(4);
  });

  it("finds the round somebody swept", () => {
    const [top] = f.records.roundRouts;
    expect([top.year, top.round, top.won, top.lost]).toEqual([2024, 1, 16, 0]);
    expect(top.winner).toBe("Silver Foxes");
    // Every rout is a round somebody actually won.
    f.records.roundRouts.forEach((x) => expect(x.margin).toBeGreaterThan(0));
  });

  it("counts the rounds that finished level", () => {
    expect(f.records.roundsPlayed).toBe(40);
    expect(f.records.levelRounds).toBe(3);
  });

  // Wire-to-wire and the comebacks are complements: between them they sort
  // every finished, unhalved cup into one of two kinds.
  it("splits every cup into led-from-the-front or came-from-behind", () => {
    const wire = f.records.wireToWire.map((e) => e.year).sort();
    const back = f.records.cupComebacks.map((e) => e.year).sort();
    expect(wire).toEqual([2019, 2020, 2021, 2023, 2024]);
    expect(wire.filter((y) => back.includes(y))).toEqual([]);
    const decided = f.editions.filter((e) => e.complete && !e.halved).length;
    expect(wire.length + back.length).toBe(decided);
  });

  it("names the years the lead actually changed", () => {
    expect(f.records.leadChanges[0].year).toBe(2016);
    expect(f.records.leadChanges[0].changes).toBe(3);
    f.records.leadChanges.forEach((e) => expect(e.changes).toBeGreaterThan(0));
  });

  it("totals ten years in one line", () => {
    expect(f.records.totals).toEqual({
      cups: 10, matches: 170, cards: 630, holes: 11340, birdies: 665, courses: 36,
    });
    // The holes are the cards times eighteen, and the courses are the ones
    // the passport counts.
    expect(f.records.totals.holes).toBe(f.records.totals.cards * 18);
    expect(f.records.totals.courses).toBe(new Set(archive.rounds.map((r) => r.course)).size);
  });

  it("has somebody on a live cup run, and its other side", () => {
    const core = f.boards(f.core).streaks;
    expect(core.cupsWonNow[0].name).toBe("TJ C");
    expect(core.cupsWonNow[0].len).toBe(4);
    expect(core.cupsWonNow[0].to.year).toBe(2025);
    // Three men are on three straight losses.
    expect(core.cupsLostNow.map((x) => x.len)).toEqual([3, 3, 3]);
    // Every current run has to reach the most recent cup.
    [...core.cupsWonNow, ...core.cupsLostNow].forEach((x) => expect(x.to.year).toBe(2025));
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
