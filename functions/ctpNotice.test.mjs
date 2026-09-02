import { describe, it, expect } from "vitest";
import { ctpBody, initialsOf, MAX_BODY } from "./ctpNotice.js";

// A four-par-3 round, the shape every course in the record has: 4, 7, 12, 16.
const PARS = [4, 3, 5, 3, 4, 4, 3, 4, 4, 4, 3, 4, 4, 4, 4, 4, 5, 4]
  .map((p, i) => ([3, 6, 11, 15].includes(i) ? 3 : p === 3 ? 4 : p));

const ROSTER = [
  { player_id: "p1", name: "Paul W" },
  { player_id: "p2", name: "Jim H" },
  { player_id: "p3", name: "Tim C" },
  { player_id: "p4", name: "Andy H" },
  { player_id: "p5", name: "Dave B" },
];

const tags = (pairs) => pairs.map(([hole, player_id]) => ({ hole, player_id }));

describe("initialsOf", () => {
  it("takes the first and last initial of the stored short name", () => {
    expect(initialsOf("Paul W")).toBe("PW");
    expect(initialsOf("andy h")).toBe("AH");
  });

  it("skips the middle rather than stacking three", () => {
    expect(initialsOf("Mary Jo Smith")).toBe("MS");
  });

  it("has nothing to shorten on a one-word name", () => {
    expect(initialsOf("Ghost")).toBe(null);
    expect(initialsOf("")).toBe(null);
    expect(initialsOf(null)).toBe(null);
  });
});

describe("ctpBody", () => {
  it("names every pin the round played, in hole order", () => {
    const body = ctpBody({
      pars: PARS,
      tags: tags([[15, "p4"], [3, "p1"], [11, "p3"], [6, "p2"]]),
      ctpIn: null,
      roster: ROSTER,
    });
    expect(body).toBe("CTPs: #4 PW, #7 JH, #12 TC, #16 AH");
  });

  it("keeps a four-pin round inside the budget", () => {
    const body = ctpBody({
      pars: PARS,
      tags: tags([[3, "p1"], [6, "p2"], [11, "p3"], [15, "p4"]]),
      ctpIn: null,
      roster: ROSTER,
    });
    expect(body.length).toBeLessThanOrEqual(MAX_BODY);
  });

  it("lists only the pins that were tagged", () => {
    const body = ctpBody({ pars: PARS, tags: tags([[6, "p2"]]), ctpIn: null, roster: ROSTER });
    expect(body).toBe("CTPs: #7 JH");
  });

  it("says nothing when no pin was tagged", () => {
    expect(ctpBody({ pars: PARS, tags: [], ctpIn: null, roster: ROSTER })).toBe(null);
  });

  it("says nothing when the round has no par 3s", () => {
    const flat = Array(18).fill(4);
    expect(ctpBody({ pars: flat, tags: tags([[6, "p2"]]), ctpIn: null, roster: ROSTER })).toBe(null);
  });

  // The lock's frozen hole_pars, not the live course: a hole re-pointed after
  // the round must not carry its tag into the notification.
  it("ignores a tag on a hole that is not a par 3 in this round", () => {
    expect(ctpBody({ pars: PARS, tags: tags([[8, "p2"]]), ctpIn: null, roster: ROSTER })).toBe(null);
  });

  it("ignores a tag by somebody who is not on the roster", () => {
    expect(ctpBody({ pars: PARS, tags: tags([[6, "ghost_pid"]]), ctpIn: null, roster: ROSTER })).toBe(null);
  });

  it("ignores a tag by somebody outside the CTP buy-in", () => {
    const body = ctpBody({
      pars: PARS,
      tags: tags([[3, "p1"], [6, "p2"]]),
      ctpIn: ["p1"],
      roster: ROSTER,
    });
    expect(body).toBe("CTPs: #4 PW");
  });

  it("treats a null buy-in field as everybody", () => {
    const body = ctpBody({ pars: PARS, tags: tags([[6, "p2"]]), ctpIn: null, roster: ROSTER });
    expect(body).toBe("CTPs: #7 JH");
  });

  it("treats an empty buy-in field as nobody", () => {
    expect(ctpBody({ pars: PARS, tags: tags([[6, "p2"]]), ctpIn: [], roster: ROSTER })).toBe(null);
  });

  // TJ C and Tim C both play here. Initialled they are one string, and each
  // man would read the other's pin as his own.
  it("spells out a name whose initials another man in the field shares", () => {
    const roster = [...ROSTER, { player_id: "p6", name: "TJ C" }];
    const body = ctpBody({ pars: PARS, tags: tags([[6, "p3"], [11, "p6"]]), ctpIn: null, roster });
    expect(body).toBe("CTPs: #7 Tim C, #12 TJ C");
  });

  it("still initials everybody the collision does not touch", () => {
    const roster = [...ROSTER, { player_id: "p6", name: "TJ C" }];
    const body = ctpBody({ pars: PARS, tags: tags([[3, "p1"], [6, "p3"]]), ctpIn: null, roster });
    expect(body).toBe("CTPs: #4 PW, #7 Tim C");
  });

  it("does not let the borrowed ball hold a pin or a set of initials", () => {
    const roster = [...ROSTER, { player_id: "bb", name: "Borrowed Wall", borrowed: true }];
    // The borrowed ball is a roster row, so it would otherwise sit in the
    // collision map and could take a pin of its own. It is a compiled card.
    const body = ctpBody({ pars: PARS, tags: tags([[3, "p1"], [6, "bb"]]), ctpIn: null, roster });
    expect(body).toBe("CTPs: #4 PW");
  });

  it("trims from the end with a count when the line will not fit", () => {
    // Five pins — the shape eight of the forty rounds on record have — and
    // every one of them a spelled-out collision, is well past the two-line
    // budget.
    const pars5 = PARS.map((p, i) => (i === 17 ? 3 : p));
    const roster = [
      { player_id: "a1", name: "Bartholomew Winchester" },
      { player_id: "a2", name: "Benjamin Winchester" },
      { player_id: "a3", name: "Beatrice Winchester" },
      { player_id: "a4", name: "Bernard Winchester" },
      { player_id: "a5", name: "Blake Winchester" },
    ];
    const body = ctpBody({
      pars: pars5,
      tags: tags([[3, "a1"], [6, "a2"], [11, "a3"], [15, "a4"], [17, "a5"]]),
      ctpIn: null,
      roster,
    });
    expect(body.length).toBeLessThanOrEqual(MAX_BODY);
    expect(body).toMatch(/\+\d+ more$/);
    expect(body.startsWith("CTPs: #4 Bartholomew Winchester")).toBe(true);
  });

  it("says nothing without a roster to read names off", () => {
    expect(ctpBody({ pars: PARS, tags: tags([[6, "p2"]]), ctpIn: null, roster: [] })).toBe(null);
    expect(ctpBody({ pars: PARS, tags: tags([[6, "p2"]]), ctpIn: null, roster: null })).toBe(null);
  });

  it("survives a lock with no frozen pars and a malformed tag", () => {
    expect(ctpBody({ pars: null, tags: tags([[6, "p2"]]), ctpIn: null, roster: ROSTER })).toBe(null);
    expect(ctpBody({ pars: PARS, tags: [{ player_id: "p2" }, null], ctpIn: null, roster: ROSTER })).toBe(null);
  });
});
