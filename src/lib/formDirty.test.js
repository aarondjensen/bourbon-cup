import { describe, it, expect } from "vitest";
import { playerFormSig, courseFormSig } from "./formDirty";

describe("playerFormSig", () => {
  const stored = { pid: "bc_player_1", team: "A", first: "Paul", last: "W", nick: "Weezy", hi: "12.4", ov: "", dir: false };

  it("a sheet opened and not touched matches what seeded it", () => {
    expect(playerFormSig({ ...stored })).toBe(playerFormSig(stored));
  });

  it("ignores fields the sheet cannot change", () => {
    expect(playerFormSig({ ...stored, pid: "something else", _source: "api" }))
      .toBe(playerFormSig(stored));
  });

  it("does not call a re-typed handicap an edit", () => {
    expect(playerFormSig({ ...stored, hi: "12.40" })).toBe(playerFormSig(stored));
  });

  it("catches every field the sheet does change", () => {
    for (const patch of [{ first: "Paulie" }, { last: "Wz" }, { nick: "Weez" },
      { hi: "11.2" }, { ov: "0" }, { team: "B" }, { dir: true },
      { ghin_number: "1234567" }]) {
      expect(playerFormSig({ ...stored, ...patch })).not.toBe(playerFormSig(stored));
    }
  });

  it("a written 0 override is an edit, not an absence", () => {
    expect(playerFormSig({ ...stored, ov: "0" })).not.toBe(playerFormSig({ ...stored, ov: "" }));
  });

  it("a blank new-player form is its own resting state", () => {
    const blank = { isNew: true, team: "A", first: "", last: "", nick: "", hi: "", ov: "", dir: false };
    expect(playerFormSig({ ...blank })).toBe(playerFormSig(blank));
    expect(playerFormSig({ ...blank, first: "Jim" })).not.toBe(playerFormSig(blank));
  });
});

describe("courseFormSig", () => {
  // As Firestore holds it: numbers.
  const stored = {
    id: "bc_course_1", tournament_id: "bc_2025", name: "Boyne Highlands", city: "Harbor Springs", state: "MI",
    par: 72, slope: 131, rating: 72.4,
    hole_pars: [4, 5, 3, 4, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5],
    hole_handicaps: Array.from({ length: 18 }, (_, i) => i + 1),
    tee_boxes: [{ name: "Blue", color: "#3b82f6", rating: 72.4, slope: 131, par: 72, yardage: 6500 }],
  };

  it("a course opened for edit and not touched is not dirty", () => {
    expect(courseFormSig({ ...stored })).toBe(courseFormSig(stored));
  });

  // The form's inputs hand back strings for numbers that never changed.
  it("does not read the form's own strings as edits", () => {
    const draft = {
      ...stored,
      hole_pars: stored.hole_pars.map(String),
      hole_handicaps: stored.hole_handicaps.map(String),
      tee_boxes: [{ name: "Blue", color: "#3b82f6", rating: "72.4", slope: "131", par: "72", yardage: "6500" }],
    };
    expect(courseFormSig(draft)).toBe(courseFormSig(stored));
  });

  it("catches a scorecard, tee and name edit", () => {
    const pars = [...stored.hole_pars]; pars[3] = "5";
    expect(courseFormSig({ ...stored, hole_pars: pars })).not.toBe(courseFormSig(stored));
    const hcps = [...stored.hole_handicaps]; hcps[0] = "7";
    expect(courseFormSig({ ...stored, hole_handicaps: hcps })).not.toBe(courseFormSig(stored));
    expect(courseFormSig({ ...stored, name: "Boyne Highlands (Moor)" })).not.toBe(courseFormSig(stored));
    expect(courseFormSig({ ...stored, tee_boxes: [...stored.tee_boxes, { name: "White" }] }))
      .not.toBe(courseFormSig(stored));
    expect(courseFormSig({ ...stored, tee_boxes: [{ ...stored.tee_boxes[0], yardage: 6200 }] }))
      .not.toBe(courseFormSig(stored));
  });

  it("a yardage of 0 is not the same as no yardage at all", () => {
    expect(courseFormSig({ ...stored, tee_boxes: [{ ...stored.tee_boxes[0], yardage: 0 }] }))
      .not.toBe(courseFormSig({ ...stored, tee_boxes: [{ ...stored.tee_boxes[0], yardage: 6500 }] }));
  });

  it("ignores the ids and the API's own bookkeeping", () => {
    expect(courseFormSig({ ...stored, _source: "GolfAPI", _incompleteData: false }))
      .toBe(courseFormSig(stored));
  });

  it("a course that is not there yet has no signature", () => {
    expect(courseFormSig(null)).toBe("");
    expect(courseFormSig(stored)).not.toBe("");
  });
});
