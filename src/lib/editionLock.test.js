// What the padlock means, and what it says before it is tapped.
//
// Most of this module is strings, and strings do not need tests. Three things
// here do: the default (which decides whether eleven years of tournaments are
// writable the moment the rules deploy), the confirm on locking the ACTIVE
// year (the dangerous case, and the one the director will not notice, because
// directors are exempt), and the bulk button's two directions.
import { describe, it, expect } from "vitest";
import { isEditionLocked, lockVerdict, bulkLockVerdict, lockNotice, isDemoEdition, canAdminEdition, demoOnlyAdmin,
  editionDisplayName, editionStatusChip, editionActions } from "./editionLock";

const ed = (id, year, locked) => ({ id, year, ...(locked === undefined ? {} : { locked }) });

describe("isEditionLocked", () => {
  it("is false for anything that is not exactly true", () => {
    // The default has to fall this way. Every edition document written before
    // this field existed has no `locked` on it, and a default of true would
    // freeze every one of them on deploy — including the year being played.
    expect(isEditionLocked(ed("bc_2019", 2019))).toBe(false);
    expect(isEditionLocked({ locked: false })).toBe(false);
    expect(isEditionLocked({ locked: null })).toBe(false);
    expect(isEditionLocked({ locked: "true" })).toBe(false);
    expect(isEditionLocked(undefined)).toBe(false);
    expect(isEditionLocked(null)).toBe(false);
  });

  it("is true only for the flag itself", () => {
    expect(isEditionLocked({ locked: true })).toBe(true);
  });
});

describe("lockVerdict", () => {
  it("asks before locking, and says who will not notice", () => {
    const v = lockVerdict(ed("bc_2026", 2026), { isActive: true });
    expect(v.next).toBe(true);
    expect(v.label).toBe("Lock");
    // The whole reason this is a returned object rather than inline JSX: the
    // active-year warning is the one that matters and the one worth pinning.
    expect(v.confirm.body).toMatch(/showing right now/);
    expect(v.confirm.body).toMatch(/directors are exempt/i);
  });

  it("warns more gently about a year nobody is standing in", () => {
    const v = lockVerdict(ed("bc_2019", 2019), { isActive: false });
    expect(v.confirm.body).not.toMatch(/showing right now/);
    expect(v.confirm.body).toMatch(/Reading is unaffected/);
  });

  it("never asks before unlocking", () => {
    // Unlocking only ever widens what is possible, and a control that
    // interrogates you for undoing something makes people leave it alone.
    const v = lockVerdict(ed("bc_2019", 2019, true));
    expect(v.next).toBe(false);
    expect(v.label).toBe("Unlock");
    expect(v.confirm).toBeNull();
  });

  it("falls back to the id when a row has no year", () => {
    expect(lockVerdict({ id: "bc_dev" }).title).toMatch(/bc_dev/);
  });
});

describe("bulkLockVerdict", () => {
  const editions = [ed("bc_2026", 2026), ed("bc_2025", 2025), ed("bc_2019", 2019, true)];

  it("offers to lock the others while any of them is open", () => {
    const v = bulkLockVerdict(editions, "bc_2026");
    expect(v.next).toBe(true);
    expect(v.ids).toEqual(["bc_2025"]);          // 2019 is already locked
    expect(v.label).toBe("Lock all but 2026");
    expect(v.confirm.body).toMatch(/2026 stays open/);
  });

  it("never touches the active year, in either direction", () => {
    // Freezing the tournament being played is a thing a director might want,
    // but never as a side effect of tidying up the other ten.
    expect(bulkLockVerdict(editions, "bc_2026").ids).not.toContain("bc_2026");
    const allShut = [ed("bc_2026", 2026), ed("bc_2025", 2025, true), ed("bc_2019", 2019, true)];
    expect(bulkLockVerdict(allShut, "bc_2026").ids).not.toContain("bc_2026");
  });

  it("turns into Unlock all once every other year is shut", () => {
    // A dead control is worse than a different one.
    const v = bulkLockVerdict([ed("bc_2026", 2026), ed("bc_2025", 2025, true)], "bc_2026");
    expect(v.next).toBe(false);
    expect(v.label).toBe("Unlock all");
    expect(v.ids).toEqual(["bc_2025"]);
  });

  it("asks in BOTH directions, unlike the single toggle", () => {
    // A bulk action has no tap-again undo: it flattens whatever pattern of
    // locks was there, and nothing remembers what they were.
    expect(bulkLockVerdict(editions, "bc_2026").confirm).toBeTruthy();
    const v = bulkLockVerdict([ed("bc_2026", 2026), ed("bc_2025", 2025, true)], "bc_2026");
    expect(v.confirm.body).toMatch(/can't be undone/);
  });

  it("is null when there is nothing to offer", () => {
    expect(bulkLockVerdict([ed("bc_2026", 2026)], "bc_2026")).toBeNull();
    expect(bulkLockVerdict([], "bc_2026")).toBeNull();
    expect(bulkLockVerdict()).toBeNull();
  });
});

describe("lockNotice", () => {
  it("tells a member why their writes will be refused", () => {
    expect(lockNotice(ed("bc_2019", 2019, true))).toMatch(/2019 is locked/);
  });

  it("says nothing to a director, who is exempt", () => {
    // They would be reading a wall that is not there for them.
    expect(lockNotice(ed("bc_2019", 2019, true), { isDirector: true })).toBeNull();
  });

  it("says nothing about an unlocked year", () => {
    expect(lockNotice(ed("bc_2026", 2026))).toBeNull();
    expect(lockNotice(null)).toBeNull();
  });
});

// ── Demo tournaments are not "other years" ──────────────────────────
// Added when the demo edition landed. The two features were built separately
// and interact badly: "Lock all but 2026" means every other edition, and the
// demo IS another edition — so one tap would freeze the tournament the twelve
// Play testers are supposed to be posting scores in. Invisibly, because a
// director is exempt from the lock they just set, so the person best placed to
// notice is the one person who cannot.
describe("a demo tournament", () => {
  const real = { id: "bc_2025", year: 2025 };
  const live = { id: "bc_2026", year: 2026 };
  const demo = { id: "bc_demo", year: 2026, is_demo: true };

  it("is recognised only by an explicit flag", () => {
    expect(isDemoEdition(demo)).toBe(true);
    expect(isDemoEdition(real)).toBe(false);
    expect(isDemoEdition({ id: "bc_demo" })).toBe(false);   // the id proves nothing
    expect(isDemoEdition({ is_demo: "true" })).toBe(false); // not truthiness
    expect(isDemoEdition(null)).toBe(false);
  });

  // ── Who administers it ──
  // The mirror of canAdminEdition() in firestore.rules. If these two ever
  // disagree the app draws an Admin tab whose writes come back refused, which
  // is the one failure this whole arrangement exists to avoid.
  const director = { isDirector: true, isMember: true };
  const memberOnly = { isDirector: false, isMember: true };
  const guest = { isDirector: false, isMember: false };

  it("is administered by any member", () => {
    expect(canAdminEdition({ ...memberOnly, edition: demo })).toBe(true);
    expect(canAdminEdition({ ...director, edition: demo })).toBe(true);
  });

  it("...but a real edition is not", () => {
    expect(canAdminEdition({ ...memberOnly, edition: real })).toBe(false);
    expect(canAdminEdition({ ...memberOnly, edition: live })).toBe(false);
    // An edition the app has not loaded yet is a real one. The opposite
    // default to the lock, deliberately — see the note in editionLock.
    expect(canAdminEdition({ ...memberOnly, edition: null })).toBe(false);
    expect(canAdminEdition({ ...memberOnly, edition: undefined })).toBe(false);
    // The flag, not the id, and not truthiness.
    expect(canAdminEdition({ ...memberOnly, edition: { id: "bc_demo" } })).toBe(false);
    expect(canAdminEdition({ ...memberOnly, edition: { is_demo: "true" } })).toBe(false);
  });

  it("a director administers everything, demo or not", () => {
    expect(canAdminEdition({ ...director, edition: real })).toBe(true);
    expect(canAdminEdition({ ...director, edition: null })).toBe(true);
  });

  it("a guest administers nothing — there is no account to be a member of", () => {
    expect(canAdminEdition({ ...guest, edition: demo })).toBe(false);
    expect(canAdminEdition({ ...guest, edition: real })).toBe(false);
    expect(canAdminEdition()).toBe(false);
  });

  // What hides Editions, Access and the crown: those three are project-wide,
  // so a demo cannot scope them and the rules keep them director-only.
  it("tells a demo administrator apart from a real director", () => {
    expect(demoOnlyAdmin({ ...memberOnly, edition: demo })).toBe(true);
    expect(demoOnlyAdmin({ ...director, edition: demo })).toBe(false);
    expect(demoOnlyAdmin({ ...memberOnly, edition: real })).toBe(false);
    expect(demoOnlyAdmin({ ...guest, edition: demo })).toBe(false);
  });

  it("is left out of a bulk lock", () => {
    const v = bulkLockVerdict([real, live, demo], "bc_2026");
    expect(v.next).toBe(true);
    expect(v.ids).toEqual(["bc_2025"]);
    expect(v.ids).not.toContain("bc_demo");
  });

  it("does not make a bulk lock look available when it is the only other year", () => {
    // Active year plus a demo and nothing else: there is genuinely nothing to
    // lock, and offering the control would be offering a no-op.
    expect(bulkLockVerdict([live, demo], "bc_2026")).toBeNull();
  });

  it("is not counted as already-locked either", () => {
    // The other branch: with every real year locked, the verdict flips to
    // "unlock". A demo in the list must not appear in that set — unlocking it
    // is meaningless and naming it in the confirm is confusing.
    const v = bulkLockVerdict([{ ...real, locked: true }, live, demo], "bc_2026");
    expect(v.next).toBe(false);
    expect(v.ids).not.toContain("bc_demo");
  });
});

// ── What the picker draws ───────────────────────────────────────────
// Three helpers that each decide whether something is RENDERED AT ALL, which
// is the class of bug a screenshot catches a week late. The row is year-first:
// the year is the rigid part and everything below is what may join it.
describe("editionDisplayName", () => {
  const TITLE = "The Bourbon Cup";

  it("says nothing when the name is just the title and the year", () => {
    // The whole reason the row can drop the name slot. Eleven editions called
    // "The Bourbon Cup ####" printed beside their own year is the year twice,
    // and eleven rows that read identically.
    expect(editionDisplayName({ name: "The Bourbon Cup 2019", year: 2019 }, TITLE)).toBeNull();
    expect(editionDisplayName({ name: "The Bourbon Cup 2019", year: "2019" }, TITLE)).toBeNull();
    expect(editionDisplayName({ name: "2019", year: 2019 }, TITLE)).toBeNull();
  });

  it("forgives the casing and spacing of a name typed by hand", () => {
    expect(editionDisplayName({ name: "  the  bourbon cup   2019 ", year: 2019 }, TITLE)).toBeNull();
  });

  it("shows a name somebody actually chose", () => {
    // The case worth the space, and the one that keeps catching people out.
    expect(editionDisplayName({ name: "DEMO — Testers", year: 2026 }, TITLE)).toBe("DEMO — Testers");
    expect(editionDisplayName({ name: "2026 Test Copy", year: 2026 }, TITLE)).toBe("2026 Test Copy");
    expect(editionDisplayName({ name: "The 2019 Do-Over", year: 2019 }, TITLE)).toBe("The 2019 Do-Over");
  });

  it("keeps a name that merely ENDS in the year", () => {
    // The rule this replaced was "does the name end with the year", which
    // reduced a round at Bandon to a bare numeral. Exact match, so it doesn't.
    expect(editionDisplayName({ name: "Bandon Dunes 2024", year: 2024 }, TITLE)).toBe("Bandon Dunes 2024");
  });

  it("is not tied to one app's tournament title", () => {
    // WBC's cup is not called The Bourbon Cup. Each app passes its own, so one
    // helper serves both without either naming the other's tournament.
    expect(editionDisplayName({ name: "Winter Bourbon Classic 2024", year: 2024 }, "Winter Bourbon Classic")).toBeNull();
    expect(editionDisplayName({ name: "Winter Bourbon Classic 2024", year: 2024 }, TITLE)).toBe("Winter Bourbon Classic 2024");
  });

  it("shows whatever there is when there is no year to compare", () => {
    expect(editionDisplayName({ name: "Scratch" }, TITLE)).toBe("Scratch");
    expect(editionDisplayName({ name: "", year: 2019 }, TITLE)).toBeNull();
    expect(editionDisplayName(null, TITLE)).toBeNull();
  });
});

describe("editionStatusChip", () => {
  it("draws nothing for a year that is over", () => {
    // ARCHIVED on ten rows out of twelve is the background, not a label.
    expect(editionStatusChip({ status: "archived" })).toBeNull();
    expect(editionStatusChip({})).toBeNull();
    expect(editionStatusChip(null)).toBeNull();
  });

  it("treats a status it has never heard of as finished", () => {
    // A later release inventing a fourth status must not make this one paint
    // an unrecognised word onto every row.
    expect(editionStatusChip({ status: "retired" })).toBeNull();
  });

  it("draws the two that are news", () => {
    expect(editionStatusChip({ status: "published" })).toBe("PUBLISHED");
    expect(editionStatusChip({ status: "draft" })).toBe("DRAFT");
  });
});

describe("editionActions", () => {
  const demo = { id: "bc_demo", year: 2026, is_demo: true };

  it("offers a player one thing", () => {
    const a = editionActions({ edition: ed("bc_2019", 2019, true) });
    expect(a).toMatchObject({ open: true, rename: false, lock: false, status: false, delete: false });
    expect(a.locked).toBe(true);
  });

  it("will not open or delete the year you are standing in", () => {
    // Not a nicety: deleteEdition refuses the active edition outright, because
    // the running app would lose its data out from under it. Today that shows
    // up as a trash icon that quietly is not drawn.
    const a = editionActions({ edition: demo, isActive: true, canManage: true });
    expect(a.open).toBe(false);
    expect(a.delete).toBe(false);
    // ...and the sheet says WHY, which the missing icon never did.
    expect(a.note).toMatch(/can't be deleted/);
    // The two that survive are the two a director does want on the live year.
    expect(a.rename).toBe(true);
    expect(a.lock).toBe(true);
  });

  it("says nothing about absences on a year you are not in", () => {
    expect(editionActions({ edition: ed("bc_2019", 2019), canManage: true }).note).toBeNull();
  });

  it("lets a demo be deleted like anything else", () => {
    // Only being ACTIVE stops a delete. A scratch edition has to be removable.
    expect(editionActions({ edition: demo, canManage: true }).delete).toBe(true);
  });
});
