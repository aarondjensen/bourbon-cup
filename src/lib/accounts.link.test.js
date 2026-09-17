// ══════════════════════════════════════════════════════════════════
//  Joining a roster row to an account, which only ever went one way
// ══════════════════════════════════════════════════════════════════
//
// A claim writes the uid onto ONE roster row — the one in the edition the man
// was standing in when he tapped his name. `cloneEdition` copies a row whole,
// `auth_uid` included, so the link travels FORWARD and the asymmetry stays
// hidden: claimed in 2025, still claimed in the 2026 cloned from it.
//
// Backwards it does not travel at all. Sign in for the first time on the year
// being played, switch to any earlier one, and `linkedPlayer` finds nothing —
// the edition switch leaves a SPECTATOR on a tournament whose roster has his
// name on it. He gets no card of his own, and a director cannot make him a
// captain there, because both badges reach his membership THROUGH the roster
// row (membershipFor).
//
// The claim cannot repair this by itself: there is no key to match the same
// man across editions. A clone mints fresh ids, the imported years carry their
// own, and the only thing left is "first name, last initial" — the one shape
// that eventually collides, and getting it wrong claims a man to another man's
// record in a year nobody is looking at. So it is the director's, beside the
// unlink that was already there.
import { describe, it, expect, vi, beforeEach } from "vitest";

// The roster, for the lookup at the foot of this file. Empty for everything
// above it, which is what the old mock was.
const rows = { bc_players: [] };
const asked = [];

vi.mock("../firebase", () => ({
  db: {
    get: async (col, filters = []) => {
      asked.push(filters);
      return (rows[col] || []).filter((r) => filters.every((f) =>
        (f.op === "in" ? f.value.includes(r[f.field]) : r[f.field] === f.value)));
    },
    getById: async () => null, upsert: async () => null, upsertStrict: async () => null,
  },
  TOURNAMENT_ID: "bc_2025",
  writeFailure: () => "failed",
}));

const { linkPatch, linkableAccounts, loadAccountNames, membershipLabel, unlinkPatch } = await import("./accounts");

const acct = (uid, extra = {}) => ({ id: uid, uid, email: `${uid}@example.com`, ...extra });

describe("linkPatch", () => {
  it("writes the same four fields a claim does", () => {
    const patch = linkPatch(acct("u_tj", { provider: "google" }));
    expect(patch.auth_uid).toBe("u_tj");
    expect(patch.auth_email).toBe("u_tj@example.com");
    expect(patch.auth_provider).toBe("google");
    expect(typeof patch.auth_linked_at).toBe("string");
    // Exactly the keys unlink puts back to null, so the two are each other's
    // inverse and neither can leave a field the other cannot reach.
    expect(Object.keys(patch).sort()).toEqual(Object.keys(unlinkPatch()).sort());
  });

  it("does not invent a provider it was not told", () => {
    // A membership records the email and not the provider — there is no
    // sign-in happening here to read one off. Null, not a guess.
    expect(linkPatch(acct("u1")).auth_provider).toBeNull();
  });

  it("refuses a membership with no uid", () => {
    expect(linkPatch(null)).toBeNull();
    expect(linkPatch({ email: "nobody@example.com" })).toBeNull();
  });

  it("takes the uid off either field", () => {
    // `joinWithCode` writes both `id` and `uid`; a document edited by hand in
    // the console may carry only the id.
    expect(linkPatch({ id: "u2", email: "x@y.z" }).auth_uid).toBe("u2");
  });
});

describe("linkableAccounts", () => {
  const memberships = [acct("u_tj"), acct("u_dave"), acct("u_paul")];

  it("offers an account that claimed a name in ANOTHER edition", () => {
    // The whole case. TJ holds a name in 2026; this screen is 2025's roster,
    // where he holds nothing — so he is exactly who should be on offer.
    const players2025 = [{ player_id: "p1", name: "Dave K", auth_uid: "u_dave" }];
    expect(linkableAccounts(memberships, players2025).map((m) => m.uid))
      .toEqual(["u_paul", "u_tj"]);
  });

  it("leaves out anybody already holding a name here", () => {
    const players = [
      { player_id: "p1", auth_uid: "u_dave" },
      { player_id: "p2", auth_uid: "u_tj" },
    ];
    // One uid on two rows in one tournament is a state `linkedPlayer`
    // resolves by taking the first, and no screen expects.
    expect(linkableAccounts(memberships, players).map((m) => m.uid)).toEqual(["u_paul"]);
  });

  it("leaves out a reviewer's membership", () => {
    // `demo_only` is confined to demo editions by canWriteEdition, so
    // offering one on the cup offers a link whose every write is refused.
    const withReviewer = [...memberships, acct("u_review", { demo_only: true })];
    expect(linkableAccounts(withReviewer, []).map((m) => m.uid))
      .toEqual(["u_dave", "u_paul", "u_tj"]);
  });

  it("sorts by the thing the picker shows", () => {
    const jumbled = [acct("u_zeta"), acct("u_alpha"), acct("u_mid")];
    expect(linkableAccounts(jumbled, []).map((m) => m.uid))
      .toEqual(["u_alpha", "u_mid", "u_zeta"]);
  });

  it("survives an empty or missing list either side", () => {
    expect(linkableAccounts(null, null)).toEqual([]);
    expect(linkableAccounts([], [{ auth_uid: "u1" }])).toEqual([]);
    expect(linkableAccounts(memberships, []).length).toBe(3);
    // A membership document with no uid at all is not offerable — there
    // would be nothing to write.
    expect(linkableAccounts([{ email: "ghost@example.com" }], []).length).toBe(0);
  });
});

describe("membershipLabel", () => {
  it("is the email when nothing else is known about the account", () => {
    expect(membershipLabel(acct("u_tj"))).toBe("u_tj@example.com");
  });

  it("still says something for an account with no email", () => {
    // Apple's hide-my-email and a console-made document both reach this. A
    // blank row in a picker is a row nobody can choose deliberately.
    expect(membershipLabel({ uid: "abc123xyz", provider: "apple" }))
      .toBe("apple sign-in · abc123");
    expect(membershipLabel({ uid: "abc123xyz" })).toBe("account sign-in · abc123");
  });

  // And the name it holds in whichever edition it claimed one, which is the
  // half an email cannot always do — see loadAccountNames below.
  it("leads with the name once that has been looked up", () => {
    expect(membershipLabel(acct("u_tj"), { u_tj: { name: "TJ M" } }))
      .toBe("TJ M · u_tj@example.com");
    // Not yet looked up, or never claimed anywhere: the email alone, which
    // is what it always was.
    expect(membershipLabel(acct("u_tj"), {})).toBe("u_tj@example.com");
    expect(membershipLabel(acct("u_tj"), null)).toBe("u_tj@example.com");
  });
});

// ── Who an account belongs to ─────────────────────────────────────
// Apple's Hide My Email gives a per-app relay address, so an email can name
// nobody at all — on the one screen where picking the wrong man writes his
// phone onto another man's record. The name he claimed in another edition
// answers it, and that row is one query away.
describe("loadAccountNames", () => {
  beforeEach(() => { rows.bc_players = []; asked.length = 0; });

  it("asks ten uids at a time, which is Firestore's `in` limit", async () => {
    await loadAccountNames(Array.from({ length: 23 }, (_, i) => `u${i}`));
    expect(asked.length).toBe(3);
    expect(asked[0][0].value.length).toBe(10);
    expect(asked[2][0].value.length).toBe(3);
  });

  it("names each account off whichever row it claimed last", async () => {
    rows.bc_players = [
      { id: "a", player_id: "a", name: "TJ M", auth_uid: "u_tj", auth_linked_at: "2025-06-01T00:00:00.000Z" },
      { id: "b", player_id: "b", name: "TJ Moore", auth_uid: "u_tj", auth_linked_at: "2026-06-01T00:00:00.000Z" },
    ];
    // A director's unlink leaves the row behind rather than moving it, so an
    // account can have held two names over the years.
    expect((await loadAccountNames(["u_tj"])).u_tj.name).toBe("TJ Moore");
  });

  it("asks nothing when there is nobody to ask about", async () => {
    expect(await loadAccountNames([])).toEqual({});
    expect(await loadAccountNames(null)).toEqual({});
    expect(asked.length).toBe(0);
  });

  it("drops the duplicates rather than paying for them twice", async () => {
    await loadAccountNames(["u1", "u1", "u2"]);
    expect(asked[0][0].value).toEqual(["u1", "u2"]);
  });
});
