// ══════════════════════════════════════════════════════════════════
//  firestore.rules — the tests
// ══════════════════════════════════════════════════════════════════
//
// The rules are the only thing standing between a stranger with the app's
// public config and the tournament data, so "it looked right" is not good
// enough. Run this before deploying a change to them:
//
//   npm i --no-save firebase-tools @firebase/rules-unit-testing
//   npx firebase emulators:exec --only firestore --project bc-rules-probe \
//     "node firestore.rules.test.mjs"
//
// The two packages are deliberately NOT devDependencies: they are ~600
// packages and a JVM emulator between them, needed by whoever is editing
// the rules and nobody else. `--no-save` leaves package.json alone.
//
// Everything runs against a throwaway project id on a local emulator. No
// call in here can reach the real project.
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, getDocs, collection, deleteDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";

const env = await initializeTestEnvironment({
  projectId: "bc-rules-probe",
  firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
});

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(["PASS", name]); }
  catch (e) { results.push(["FAIL", name, e?.message?.slice(0, 120)]); }
};

// alice is the director throughout, mallory the stranger, pete an ordinary
// member. Directorship is granted the only way it can be — out of band,
// with rules disabled, exactly as a human editing the document in the
// Firebase console does it.
const aliceDb = () => env.authenticatedContext("alice").firestore();
const malloryDb = () => env.authenticatedContext("mallory").firestore();
const peteDb = () => env.authenticatedContext("pete").firestore();
const anonDb = () => env.unauthenticatedContext().firestore();

const member = { uid: "alice", email: "a@example.com", joined_at: "now" };

const grantDirector = (uid) => env.withSecurityRulesDisabled(ctx =>
  setDoc(doc(ctx.firestore(), `bc_accounts/${uid}`), { is_director: true }, { merge: true }));

const seed = (path, data) => env.withSecurityRulesDisabled(ctx =>
  setDoc(doc(ctx.firestore(), path), data));

// ── With NO password configured (the bootstrap state) ───────────────
await env.clearFirestore();

await check("anon cannot write a score", () =>
  assertFails(setDoc(doc(anonDb(), "bc_hole_scores/x"), { v: 1 })));

await check("signed-in non-member cannot write a score", () =>
  assertFails(setDoc(doc(aliceDb(), "bc_hole_scores/x"), { v: 1 })));

await check("no password set: membership can be created with a blank code", () =>
  assertSucceeds(setDoc(doc(aliceDb(), "bc_accounts/alice"), { ...member, code: "" })));

await check("member can now write a score", () =>
  assertSucceeds(setDoc(doc(aliceDb(), "bc_hole_scores/x"), { v: 1 })));

// ── Director is a flag no client can set ────────────────────────────
await check("a member cannot make themselves a director on the way in", async () => {
  await assertFails(setDoc(doc(peteDb(), "bc_accounts/pete"), { uid: "pete", code: "", is_director: true }));
  await assertSucceeds(setDoc(doc(peteDb(), "bc_accounts/pete"), { uid: "pete", code: "" }));
});

await check("a member cannot promote themselves afterwards", () =>
  assertFails(setDoc(doc(peteDb(), "bc_accounts/pete"), { uid: "pete", is_director: true }, { merge: true })));

await check("an ordinary member cannot touch what Admin owns", async () => {
  await assertFails(setDoc(doc(peteDb(), "bc_players/p9"), { name: "Ringer" }));
  await assertFails(setDoc(doc(peteDb(), "bc_rounds/r1"), { par: 72 }));
  await assertFails(setDoc(doc(peteDb(), "bc_matches/m1"), { teamA: [] }));
  await assertFails(setDoc(doc(peteDb(), "bc_courses/c1"), { name: "Pete's" }));
  await assertFails(setDoc(doc(peteDb(), "bc_groups/g1"), { players: [] }));
  await assertFails(setDoc(doc(peteDb(), "bc_settings/team_names"), { teamA: "x" }));
  await assertFails(setDoc(doc(peteDb(), "bc_editions/bc_2027"), { year: 2027 }));
  await assertFails(setDoc(doc(peteDb(), "bc_tee_assignments/t1"), { a: 1 }));
  await assertFails(setDoc(doc(peteDb(), "bc_hcp_overrides/h1"), { a: 1 }));
  await assertFails(setDoc(doc(peteDb(), "bc_tournament_settings/s1"), { skins_pot: 1 }));
});

await check("an ordinary member CAN still do everything a player does", async () => {
  await assertSucceeds(setDoc(doc(peteDb(), "bc_hole_scores/p9h1"), { v: 4 }));
  await assertSucceeds(setDoc(doc(peteDb(), "bc_ctp/r1h7"), { player_id: "p9" }));
  await assertSucceeds(setDoc(doc(peteDb(), "bc_card_sigs/r1m1"), { signed_by: "p9" }));
  // The auto-lock fires on the first score of a round, from a player's phone.
  await assertSucceeds(setDoc(doc(peteDb(), "bc_round_locks/r1"), { state: "open" }));
  await assertSucceeds(setDoc(doc(peteDb(), "bc_notification_tokens/pete_x"), { token: "t" }));
});

await grantDirector("alice");

// ── Appointing a director from the app ──────────────────────────────
await check("a director can appoint another member", () =>
  // The exact shape db.upsertStrict sends: a merge carrying one key. It
  // sends the id as the path, never as a field — a second changed key
  // here is refused, which is what this asserts as much as the grant.
  assertSucceeds(setDoc(doc(aliceDb(), "bc_accounts/pete"), { is_director: true }, { merge: true })));

await check("...and can demote them again", () =>
  assertSucceeds(setDoc(doc(aliceDb(), "bc_accounts/pete"), { is_director: false }, { merge: true })));

await check("...but not while also writing the id field", () =>
  assertFails(setDoc(doc(aliceDb(), "bc_accounts/pete"), { id: "pete", is_director: true }, { merge: true })));

await check("a director cannot change their OWN flag (last one out)", () =>
  assertFails(setDoc(doc(aliceDb(), "bc_accounts/alice"), { is_director: false }, { merge: true })));

await check("a director cannot alter anything else on a membership", async () => {
  await assertFails(setDoc(doc(aliceDb(), "bc_accounts/pete"), { code: "peek" }, { merge: true }));
  await assertFails(setDoc(doc(aliceDb(), "bc_accounts/pete"), { is_director: true, email: "x@y.z" }, { merge: true }));
});

await check("an ordinary member cannot appoint anybody", () =>
  assertFails(setDoc(doc(peteDb(), "bc_accounts/mallory"), { is_director: true }, { merge: true })));

await check("a director can list every membership; a member cannot", async () => {
  await assertSucceeds(getDocs(collection(aliceDb(), "bc_accounts")));
  await assertFails(getDocs(collection(peteDb(), "bc_accounts")));
});

await check("a director can write what Admin owns", async () => {
  await assertSucceeds(setDoc(doc(aliceDb(), "bc_players/p9"), { name: "Pete C", player_id: "p9" }));
  await assertSucceeds(setDoc(doc(aliceDb(), "bc_rounds/r1"), { par: 72 }));
  await assertSucceeds(setDoc(doc(aliceDb(), "bc_settings/team_names"), { teamA: "Mash" }));
});

// ── Claiming a name: the one roster write an ordinary member makes ──
await check("a member can claim an unclaimed name", () =>
  assertSucceeds(setDoc(doc(peteDb(), "bc_players/p9"),
    { auth_uid: "pete", auth_email: "p@example.com", auth_provider: "google.com", auth_linked_at: "now" }, { merge: true })));

await check("...but cannot change anything else while doing it", () =>
  assertFails(setDoc(doc(peteDb(), "bc_players/p9"),
    { auth_uid: "pete", handicap_index: 0 }, { merge: true })));

await check("...cannot claim in somebody else's name", () =>
  assertFails(setDoc(doc(peteDb(), "bc_players/p9"),
    { auth_uid: "mallory" }, { merge: true })));

await check("...cannot crown themselves through the claim", () =>
  assertFails(setDoc(doc(peteDb(), "bc_players/p9"),
    { auth_uid: "pete", isDirector: true }, { merge: true })));

await check("...and cannot steal a name somebody else has claimed", async () => {
  await seed("bc_players/p10", { player_id: "p10", name: "Taken", auth_uid: "alice" });
  await assertFails(setDoc(doc(peteDb(), "bc_players/p10"), { auth_uid: "pete" }, { merge: true }));
});

await check("a director can unlink a claim", () =>
  assertSucceeds(setDoc(doc(aliceDb(), "bc_players/p10"), { auth_uid: null }, { merge: true })));

await check("member cannot re-write their own membership", () =>
  assertFails(setDoc(doc(aliceDb(), "bc_accounts/alice"), { ...member, code: "" })));

await check("member cannot delete their own membership", () =>
  assertFails(deleteDoc(doc(aliceDb(), "bc_accounts/alice"))));

await check("member can read their own membership", () =>
  assertSucceeds(getDoc(doc(aliceDb(), "bc_accounts/alice"))));

await check("nobody can read somebody else's membership", () =>
  assertFails(getDoc(doc(malloryDb(), "bc_accounts/alice"))));

await check("a director can set the password", () =>
  assertSucceeds(setDoc(doc(aliceDb(), "bc_secrets/access"), { code: "bourbon2026" })));

await check("an ordinary member cannot set the password", () =>
  assertFails(setDoc(doc(peteDb(), "bc_secrets/access"), { code: "petes" })));

await check("an ordinary member cannot READ the password", () =>
  assertFails(getDoc(doc(peteDb(), "bc_secrets/access"))));

// ── With a password configured ──────────────────────────────────────
await check("a director can read the password back (Admin shows it)", () =>
  assertSucceeds(getDoc(doc(aliceDb(), "bc_secrets/access"))));

await check("a signed-in non-member CANNOT read the password", () => {
  const bob = env.authenticatedContext("bob").firestore();
  return assertFails(getDoc(doc(bob, "bc_secrets/access")));
});

await check("an anonymous visitor cannot read the password", () =>
  assertFails(getDoc(doc(anonDb(), "bc_secrets/access"))));

await check("stranger with the WRONG password is refused membership", () =>
  assertFails(setDoc(doc(malloryDb(), "bc_accounts/mallory"), { uid: "mallory", code: "guess" })));

await check("a code typed in the wrong case still gets in", async () => {
  // The stored code is "bourbon2026"; these are what a phone keyboard and
  // a person repeating it across a table actually produce.
  const shout = env.authenticatedContext("shout").firestore();
  await assertSucceeds(setDoc(doc(shout, "bc_accounts/shout"), { uid: "shout", code: "Bourbon2026" }));
  const mixed = env.authenticatedContext("mixed").firestore();
  await assertSucceeds(setDoc(doc(mixed, "bc_accounts/mixed"), { uid: "mixed", code: "BOURBON2026" }));
});

await check("...but a wrong code in any case is still wrong", () =>
  assertFails(setDoc(doc(malloryDb(), "bc_accounts/mallory"), { uid: "mallory", code: "BOURBON2027" })));

await check("a non-string code is refused, not an error", () =>
  assertFails(setDoc(doc(malloryDb(), "bc_accounts/mallory"), { uid: "mallory", code: 2026 })));

await check("stranger with a BLANK password is refused membership", () =>
  assertFails(setDoc(doc(malloryDb(), "bc_accounts/mallory"), { uid: "mallory", code: "" })));

await check("stranger with no code field at all is refused", () =>
  assertFails(setDoc(doc(malloryDb(), "bc_accounts/mallory"), { uid: "mallory" })));

await check("stranger still cannot write a score", () =>
  assertFails(setDoc(doc(malloryDb(), "bc_hole_scores/y"), { v: 2 })));

await check("nobody can mint a membership for a DIFFERENT uid", () =>
  assertFails(setDoc(doc(malloryDb(), "bc_accounts/pete"), { uid: "pete", code: "bourbon2026" })));

await check("stranger with the RIGHT password gets in", () =>
  assertSucceeds(setDoc(doc(malloryDb(), "bc_accounts/mallory"), { uid: "mallory", code: "bourbon2026" })));

await check("...and can then write a score", () =>
  assertSucceeds(setDoc(doc(malloryDb(), "bc_hole_scores/y"), { v: 2 })));

await check("a non-member cannot set the password", () => {
  const bob = env.authenticatedContext("bob").firestore();
  return assertFails(setDoc(doc(bob, "bc_secrets/access"), { code: "mine" }));
});

// ── The photo library ───────────────────────────────────────────────
// alice is the director, pete and mallory ordinary members. See the
// bc_media block in firestore.rules for why each of these is the rule.
const photo = (uid, over = {}) =>
  ({ kind: "photo", host: "storage", uploadedBy: uid, url: "u", thumbUrl: "t", ...over });

await check("a member can post a photo under their own uid", () =>
  assertSucceeds(setDoc(doc(peteDb(), "bc_media/med_bc_2026_p1"), photo("pete"))));

await check("...but not under somebody else's name", () =>
  assertFails(setDoc(doc(peteDb(), "bc_media/med_bc_2026_p2"), photo("alice"))));

await check("a non-member cannot post a photo at all", () => {
  const bob = env.authenticatedContext("bob").firestore();
  return assertFails(setDoc(doc(bob, "bc_media/med_bc_2026_p3"), photo("bob")));
});

await check("a member can fix their own caption but cannot reassign the photo", async () => {
  await assertSucceeds(setDoc(doc(peteDb(), "bc_media/med_bc_2026_p1"), { caption: "18th" }, { merge: true }));
  await assertFails(setDoc(doc(peteDb(), "bc_media/med_bc_2026_p1"), { uploadedBy: "mallory" }, { merge: true }));
});

await check("a member cannot touch somebody else's photo", async () => {
  await seed("bc_media/med_bc_2026_a1", photo("alice"));
  await assertFails(setDoc(doc(peteDb(), "bc_media/med_bc_2026_a1"), { caption: "mine now" }, { merge: true }));
  await assertFails(deleteDoc(doc(peteDb(), "bc_media/med_bc_2026_a1")));
});

await check("a member can remove what they posted", () =>
  assertSucceeds(deleteDoc(doc(peteDb(), "bc_media/med_bc_2026_p1"))));

await check("a graduated photo is the director's to remove, not the poster's", async () => {
  await seed("bc_media/med_bc_2019_g1", photo("pete", { host: "archive" }));
  await assertFails(deleteDoc(doc(peteDb(), "bc_media/med_bc_2019_g1")));
  await assertSucceeds(deleteDoc(doc(aliceDb(), "bc_media/med_bc_2019_g1")));
});

await check("a director can remove anybody's photo", async () => {
  await seed("bc_media/med_bc_2026_p9", photo("pete"));
  await assertSucceeds(deleteDoc(doc(aliceDb(), "bc_media/med_bc_2026_p9")));
});

await check("anon can browse the gallery", () =>
  assertSucceeds(getDoc(doc(anonDb(), "bc_media/med_bc_2026_a1"))));

// The circuit breaker is enforced here, not just honoured by the app.
await check("a tripped breaker refuses new photos and still allows removals", async () => {
  await seed("bc_config/photos", { uploadsDisabled: true, reason: "budget" });
  await seed("bc_media/med_bc_2026_p4", photo("pete"));
  await assertFails(setDoc(doc(peteDb(), "bc_media/med_bc_2026_p5"), photo("pete")));
  await assertSucceeds(deleteDoc(doc(peteDb(), "bc_media/med_bc_2026_p4")));
});

await check("a member cannot clear a breaker a budget tripped", () =>
  assertFails(setDoc(doc(peteDb(), "bc_config/photos"), { uploadsDisabled: false }, { merge: true })));

await check("a director can, and photos come back", async () => {
  await assertSucceeds(setDoc(doc(aliceDb(), "bc_config/photos"), { uploadsDisabled: false }, { merge: true }));
  await assertSucceeds(setDoc(doc(peteDb(), "bc_media/med_bc_2026_p6"), photo("pete")));
});

await check("everyone can read whether uploads are on, signed in or not", () =>
  assertSucceeds(getDoc(doc(anonDb(), "bc_config/photos"))));

// ── Side bets ───────────────────────────────────────────────────────
// A ledger the app records and does not run. See the bc_side_bets block in
// firestore.rules; src/lib/sideBets.js canDeleteSideBet mirrors the delete
// rule and sideBets.test.js pins that half.
const sideBet = (uid, over = {}) =>
  ({ tournament_id: "bc_2026", created_by: uid, player_a: "p1", player_b: "p2",
     amount: 20, detail: "closest on 17", created_at: 1, ...over });

await check("a member can log a side bet under their own uid", () =>
  assertSucceeds(setDoc(doc(peteDb(), "bc_side_bets/sb1"), sideBet("pete"))));

// created_by is what the delete rule trusts, so it has to be unforgeable at
// the moment it is written.
await check("...but not under somebody else's name", () =>
  assertFails(setDoc(doc(peteDb(), "bc_side_bets/sb2"), sideBet("alice"))));

await check("a non-member cannot log a side bet", () => {
  const bob = env.authenticatedContext("bob").firestore();
  return assertFails(setDoc(doc(bob, "bc_side_bets/sb3"), sideBet("bob")));
});

await check("a member can fix their own terms but cannot reassign the bet", async () => {
  await assertSucceeds(setDoc(doc(peteDb(), "bc_side_bets/sb1"), { detail: "closest on 7" }, { merge: true }));
  await assertFails(setDoc(doc(peteDb(), "bc_side_bets/sb1"), { created_by: "mallory" }, { merge: true }));
});

// The other side of a bet you dispute is not yours to erase.
await check("the opponent cannot edit or delete a bet they did not log", async () => {
  await seed("bc_side_bets/sb4", sideBet("alice", { player_b: "pete" }));
  await assertFails(setDoc(doc(peteDb(), "bc_side_bets/sb4"), { amount: 1 }, { merge: true }));
  await assertFails(deleteDoc(doc(peteDb(), "bc_side_bets/sb4")));
});

await check("a member can remove a bet they logged, and a director anybody's", async () => {
  await assertSucceeds(deleteDoc(doc(peteDb(), "bc_side_bets/sb1")));
  await assertSucceeds(deleteDoc(doc(aliceDb(), "bc_side_bets/sb4")));
});

await check("anon can read the side-bet ledger but not write to it", async () => {
  await seed("bc_side_bets/sb5", sideBet("pete"));
  await assertSucceeds(getDoc(doc(anonDb(), "bc_side_bets/sb5")));
  await assertFails(setDoc(doc(anonDb(), "bc_side_bets/sb6"), sideBet("nobody")));
});

// ── Settling: the third update clause ───────────────────────────────
// A bet is paid when BOTH players say so, so the player who did NOT log it
// has to be able to write `settled_by` — and nothing else.
await check("the other player can mark a bet settled without owning it", async () => {
  await seed("bc_side_bets/sb7", sideBet("alice", { player_b: "pete", settled_by: [] }));
  await assertSucceeds(setDoc(doc(peteDb(), "bc_side_bets/sb7"), { settled_by: ["p2"] }, { merge: true }));
});

// hasOnly() is what makes widening update safe: the mark is the ONLY thing a
// non-author may touch.
await check("...but cannot ride anything else in on the same write", async () => {
  await assertFails(setDoc(doc(peteDb(), "bc_side_bets/sb7"),
    { settled_by: ["p2"], amount: 1 }, { merge: true }));
  await assertFails(setDoc(doc(peteDb(), "bc_side_bets/sb7"),
    { settled_by: ["p2"], detail: "different bet now" }, { merge: true }));
  await assertFails(setDoc(doc(peteDb(), "bc_side_bets/sb7"),
    { settled_by: ["p2"], player_b: "mallory" }, { merge: true }));
  await assertFails(setDoc(doc(peteDb(), "bc_side_bets/sb7"),
    { settled_by: ["p2"], created_by: "pete" }, { merge: true }));
});

await check("a non-member cannot mark anything settled", async () => {
  const bob = env.authenticatedContext("bob").firestore();
  await assertFails(setDoc(doc(bob, "bc_side_bets/sb7"), { settled_by: ["p2"] }, { merge: true }));
  await assertFails(setDoc(doc(anonDb(), "bc_side_bets/sb7"), { settled_by: ["p2"] }, { merge: true }));
});

// Withdrawing your own mark is the same write in reverse, so it needs no rule
// of its own — but it is worth pinning that it is allowed.
await check("a mark can be withdrawn again", () =>
  assertSucceeds(setDoc(doc(peteDb(), "bc_side_bets/sb7"), { settled_by: [] }, { merge: true })));

// ── The trip ledger ─────────────────────────────────────────────────
// The opposite shape to the side bets above, and the contrast is the point.
// A side bet is between two equals, so a member logs it and the other side
// gets one narrow write. A trip payment has no equals in it: the money went
// to the director, and only the director knows it arrived. So there is no
// member clause at all. See src/lib/ledger.js.
const payment = (over = {}) =>
  ({ tournament_id: "bc_2026", player_id: "p1", amount: 250, date: "2026-06-01",
     method: "venmo", note: "", created_by: "alice", created_at: 1, ...over });

await check("a director can log a payment", () =>
  assertSucceeds(setDoc(doc(aliceDb(), "bc_ledger/pay1"), payment())));

// The whole authorization model: a player saying they paid is a claim, not a
// record. Pete is a full member — this is not about membership.
await check("a member cannot log a payment, not even their own", async () => {
  await assertFails(setDoc(doc(peteDb(), "bc_ledger/pay2"), payment({ created_by: "pete" })));
  await assertFails(setDoc(doc(anonDb(), "bc_ledger/pay3"), payment()));
});

// The balance is due minus paid, so editing either half is editing the
// balance. Both have to be shut to a member, not just the create.
await check("a member cannot edit or delete a payment", async () => {
  await assertFails(setDoc(doc(peteDb(), "bc_ledger/pay1"), { amount: 850 }, { merge: true }));
  await assertFails(deleteDoc(doc(peteDb(), "bc_ledger/pay1")));
});

// The other half of what a balance is made of: the per-player override lives
// on the roster row, which is already director-only apart from the claim
// update — and that update's hasOnly() is what stops a player writing their
// own trip cost while claiming their name.
await check("a member cannot set their own trip cost on the roster", async () => {
  await seed("bc_players/p1", { tournament_id: "bc_2026", name: "Pete", auth_uid: "pete" });
  await assertFails(setDoc(doc(peteDb(), "bc_players/p1"), { dues_amount: 0 }, { merge: true }));
  await assertFails(setDoc(doc(peteDb(), "bc_players/p1"),
    { auth_uid: "pete", dues_amount: 0 }, { merge: true }));
});

await check("a director can, and so can they set the tournament figure", async () => {
  await assertSucceeds(setDoc(doc(aliceDb(), "bc_players/p1"), { dues_amount: 400 }, { merge: true }));
  await assertSucceeds(setDoc(doc(aliceDb(), "bc_settings/bc_2026__dues"), { amount: 850 }));
});

await check("a director can delete a payment logged in error", () =>
  assertSucceeds(deleteDoc(doc(aliceDb(), "bc_ledger/pay1"))));

// Open like every other read in this file — see the note in the rules about
// what that concedes.
await check("anon can read the ledger", async () => {
  await seed("bc_ledger/pay9", payment());
  await assertSucceeds(getDoc(doc(anonDb(), "bc_ledger/pay9")));
});

// ── The budget ──────────────────────────────────────────────────────
// The other half of Admin → $, and the simplest block in the file: what the
// trip costs is not a thing a player has an opinion about.
const budgetLine = (over = {}) =>
  ({ tournament_id: "bc_2026", category: "lodging", label: "The house",
     amount: 3400, note: "", created_by: "alice", created_at: 1, ...over });

await check("a director can budget a line, and edit and delete it", async () => {
  await assertSucceeds(setDoc(doc(aliceDb(), "bc_budget/bl1"), budgetLine()));
  await assertSucceeds(setDoc(doc(aliceDb(), "bc_budget/bl1"), { amount: 3600 }, { merge: true }));
  await assertSucceeds(deleteDoc(doc(aliceDb(), "bc_budget/bl1")));
});

await check("a member cannot touch the budget", async () => {
  await seed("bc_budget/bl2", budgetLine());
  await assertFails(setDoc(doc(peteDb(), "bc_budget/bl3"), budgetLine({ created_by: "pete" })));
  await assertFails(setDoc(doc(peteDb(), "bc_budget/bl2"), { amount: 1 }, { merge: true }));
  await assertFails(deleteDoc(doc(peteDb(), "bc_budget/bl2")));
});

await check("anon can read the budget but not write it", async () => {
  await assertSucceeds(getDoc(doc(anonDb(), "bc_budget/bl2")));
  await assertFails(setDoc(doc(anonDb(), "bc_budget/bl4"), budgetLine()));
});

// ── Reads stay open, and the archive is director-owned ──────────────
await check("anon can still read the leaderboard data", () =>
  assertSucceeds(getDoc(doc(anonDb(), "bc_hole_scores/x"))));

await check("anon can read the roster", () =>
  assertSucceeds(getDoc(doc(anonDb(), "bc_players/p1"))));

// The archive used to be bc_historical, append-only so a world-writable
// client could not rewrite a year once it was in. It is now the `result` on
// an edition document, which is director-write — a stronger guarantee than
// append-only, since a member cannot add a year either.
await check("anyone can read the archive", () =>
  assertSucceeds(getDoc(doc(anonDb(), "bc_editions/bc_2019"))));

await check("a member cannot write a year's result", () =>
  assertFails(setDoc(doc(peteDb(), "bc_editions/bc_2019"), {
    year: 2019, result: { scoreA: 99, scoreB: 0 },
  })));

await check("a director can write a year's result", () =>
  assertSucceeds(setDoc(doc(aliceDb(), "bc_editions/bc_2019"), {
    year: 2019, result: { scoreA: 14, scoreB: 10 },
  })));

await check("unlisted collections stay denied", () =>
  assertFails(setDoc(doc(aliceDb(), "bc_whatever/x"), { v: 1 })));

// bc_skins is retired. Skins were never stored — they are derived from the
// cards every time they are shown (src/lib/betting) — and the collection was
// only ever written, never read. It held nothing in production, so this is
// the "unlisted" case above pointed at a name that used to be listed.
await check("the retired skins collection is denied like any other", () =>
  assertFails(setDoc(doc(aliceDb(), "bc_skins/r1h3"), { player_id: "p9" })));

// ── A LOCKED EDITION ────────────────────────────────────────────────
// `locked: true` on an edition freezes that year against everybody but a
// director. See src/lib/editionLock.js for what it means and canWriteEdition()
// in the rules for what makes it true.
//
// What these pin, in order of how expensive they are to get wrong:
//   • the DEFAULT is unlocked — three ways, because eleven years of edition
//     rows predate the field and a default of locked freezes all of them
//   • a locked year refuses a member's writes, on every collection they own
//   • a director is exempt, so a locked year is never stranded
//   • reading is untouched
//   • BOTH ends of an update are checked, so a row cannot be carried out of a
//     locked year into an open one
await seed("bc_editions/bc_2019", { id: "bc_2019", year: 2019, locked: true });
await seed("bc_editions/bc_2026", { id: "bc_2026", year: 2026, locked: false });
await seed("bc_editions/bc_2025", { id: "bc_2025", year: 2025 });   // no field at all
await seed("bc_hole_scores/hs_locked", { tournament_id: "bc_2019", strokes: 4 });
await seed("bc_side_bets/sb_locked", { tournament_id: "bc_2019", created_by: "pete" });

await check("a member can still write to an UNLOCKED year", () =>
  assertSucceeds(setDoc(doc(peteDb(), "bc_hole_scores/hs_open"), { tournament_id: "bc_2026", strokes: 4 })));

await check("an edition with no `locked` field is unlocked", () =>
  assertSucceeds(setDoc(doc(peteDb(), "bc_hole_scores/hs_nofield"), { tournament_id: "bc_2025", strokes: 4 })));

await check("an edition with no document at all is unlocked", () =>
  // ensureActiveEditionDoc seeds the row lazily, so there is a real window in
  // which a phone is pointed at a year whose index document does not exist.
  // Failing open there means a new tournament can start.
  assertSucceeds(setDoc(doc(peteDb(), "bc_hole_scores/hs_noedition"), { tournament_id: "bc_2099", strokes: 4 })));

await check("a member CANNOT post a score in a locked year", () =>
  assertFails(setDoc(doc(peteDb(), "bc_hole_scores/hs_new"), { tournament_id: "bc_2019", strokes: 4 })));

await check("a member CANNOT change a score already in a locked year", () =>
  assertFails(setDoc(doc(peteDb(), "bc_hole_scores/hs_locked"), { tournament_id: "bc_2019", strokes: 9 })));

await check("a member CANNOT delete out of a locked year", () =>
  // `request.resource` is null on delete, so this is the half of editionOpen()
  // that reads `resource` instead.
  assertFails(deleteDoc(doc(peteDb(), "bc_hole_scores/hs_locked"))));

await check("a member CANNOT sign a card, tag a CTP or lock a round in a locked year", async () => {
  await assertFails(setDoc(doc(peteDb(), "bc_card_sigs/sig_locked"), { tournament_id: "bc_2019", round: 1 }));
  await assertFails(setDoc(doc(peteDb(), "bc_ctp/ctp_locked"), { tournament_id: "bc_2019", hole: 7 }));
  await assertFails(setDoc(doc(peteDb(), "bc_round_locks/rl_locked"), { tournament_id: "bc_2019", locked: true }));
});

await check("a member CANNOT place a side bet in a locked year", () =>
  assertFails(setDoc(doc(peteDb(), "bc_side_bets/sb_new"), { tournament_id: "bc_2019", created_by: "pete" })));

await check("a member CANNOT settle their own side bet in a locked year", () =>
  assertFails(setDoc(doc(peteDb(), "bc_side_bets/sb_locked"), { settled_by: "pete" }, { merge: true })));

await check("a member CANNOT claim a roster name in a locked year", () =>
  assertFails(setDoc(doc(peteDb(), "bc_players/p_locked"), { auth_uid: "pete" }, { merge: true })));

// The attack the `request.resource` half of editionOpen() exists for: without
// it, a member could pick a document up out of a frozen year and set it down
// in an open one, which is an edit to the locked tournament by another name.
await check("a member CANNOT carry a row out of a locked year into an open one", () =>
  assertFails(setDoc(doc(peteDb(), "bc_hole_scores/hs_locked"), { tournament_id: "bc_2026", strokes: 9 })));

await check("nor carry one INTO a locked year", () =>
  assertFails(setDoc(doc(peteDb(), "bc_hole_scores/hs_open"), { tournament_id: "bc_2019", strokes: 9 })));

await check("a DIRECTOR can still write to a locked year", () =>
  // Somebody has to be able to correct one. A flag that can strand a
  // tournament beyond repair is a worse bug than the one it fixes.
  assertSucceeds(setDoc(doc(aliceDb(), "bc_hole_scores/hs_locked"), { tournament_id: "bc_2019", strokes: 5 })));

await check("reading a locked year is untouched", () =>
  // Freezing a tournament is not the same as hiding it — every leaderboard,
  // card and photo stays visible to everybody, guests included.
  assertSucceeds(getDoc(doc(peteDb(), "bc_hole_scores/hs_locked"))));

await check("a member cannot lift the lock, and a director can", async () => {
  // bc_editions is deliberately NOT gated on canWriteEdition: a lock that
  // blocked its own removal would be a one-way door.
  await assertFails(setDoc(doc(peteDb(), "bc_editions/bc_2019"), { locked: false }, { merge: true }));
  await assertSucceeds(setDoc(doc(aliceDb(), "bc_editions/bc_2019"), { locked: false }, { merge: true }));
});

await check("and once unlocked, a member can write to it again", () =>
  assertSucceeds(setDoc(doc(peteDb(), "bc_hole_scores/hs_unlocked"), { tournament_id: "bc_2019", strokes: 4 })));

// ── ADMIN INSIDE A DEMO EDITION ─────────────────────────────────────
// `is_demo: true` on an edition makes every MEMBER an administrator of that
// tournament and of nothing else. See canAdminEdition() in firestore.rules for
// why the access is real rather than a read-only Admin screen.
//
// What these pin, in order of how expensive they are to get wrong:
//   • a member administers the demo — the whole point
//   • a member administers NOTHING else, locked or unlocked, which is the
//     property the live tournament depends on
//   • the flag is what decides it, not the edition id, and absent means real
//   • BOTH ends of an update are checked, so a document cannot be carried out
//     of the demo into the cup or dragged into the demo out of it
//   • bc_editions, bc_secrets and the crown stay director-only, because they
//     are project-wide and no tournament_id could scope them
await seed("bc_editions/bc_demo", { id: "bc_demo", year: 2026, is_demo: true, locked: false });
await seed("bc_editions/bc_notdemo", { id: "bc_notdemo", year: 2026, is_demo: "true" });
await seed("bc_players/demo_p1", { tournament_id: "bc_demo", player_id: "demo_p1", name: "Dave R" });
await seed("bc_players/real_p1", { tournament_id: "bc_2026", player_id: "real_p1", name: "Aaron J" });

await check("a member administers the demo roster, rounds and draw", async () => {
  await assertSucceeds(setDoc(doc(peteDb(), "bc_players/demo_p2"),
    { tournament_id: "bc_demo", player_id: "demo_p2", name: "Ringer" }));
  await assertSucceeds(setDoc(doc(peteDb(), "bc_players/demo_p1"),
    { tournament_id: "bc_demo", handicap_index: 4.2 }, { merge: true }));
  await assertSucceeds(setDoc(doc(peteDb(), "bc_rounds/demo_r1"), { tournament_id: "bc_demo", par: 72 }));
  await assertSucceeds(setDoc(doc(peteDb(), "bc_matches/demo_m1"), { tournament_id: "bc_demo", teamA: [] }));
  await assertSucceeds(setDoc(doc(peteDb(), "bc_courses/demo_c1"), { tournament_id: "bc_demo", name: "Otsego" }));
  await assertSucceeds(setDoc(doc(peteDb(), "bc_groups/demo_g1"), { tournament_id: "bc_demo", players: [] }));
  await assertSucceeds(setDoc(doc(peteDb(), "bc_tee_assignments/demo_t1"), { tournament_id: "bc_demo", tee: "white" }));
  await assertSucceeds(setDoc(doc(peteDb(), "bc_hcp_overrides/demo_h1"), { tournament_id: "bc_demo", ch: 9 }));
  await assertSucceeds(setDoc(doc(peteDb(), "bc_settings/bc_demo__team_names"), { tournament_id: "bc_demo", teamA: "Mash" }));
  await assertSucceeds(setDoc(doc(peteDb(), "bc_tournament_settings/demo_s"), { tournament_id: "bc_demo", skins_pot: 240 }));
  await assertSucceeds(setDoc(doc(peteDb(), "bc_budget/demo_b1"), { tournament_id: "bc_demo", amount: 90 }));
  await assertSucceeds(setDoc(doc(peteDb(), "bc_ledger/demo_l1"), { tournament_id: "bc_demo", amount: 100 }));
});

await check("...and can delete inside it", () =>
  // `request.resource` is null on delete, so this is the half of bothEndsDemo()
  // that reads `resource` instead.
  assertSucceeds(deleteDoc(doc(peteDb(), "bc_players/demo_p2"))));

await check("a member administers NOTHING in a real edition", async () => {
  await assertFails(setDoc(doc(peteDb(), "bc_players/real_p2"),
    { tournament_id: "bc_2026", player_id: "real_p2", name: "Ringer" }));
  await assertFails(setDoc(doc(peteDb(), "bc_players/real_p1"), { tournament_id: "bc_2026", handicap_index: 0 }, { merge: true }));
  await assertFails(setDoc(doc(peteDb(), "bc_rounds/real_r1"), { tournament_id: "bc_2026", par: 72 }));
  await assertFails(setDoc(doc(peteDb(), "bc_courses/real_c1"), { tournament_id: "bc_2026", name: "Pete's" }));
  await assertFails(setDoc(doc(peteDb(), "bc_settings/bc_2026__team_names"), { tournament_id: "bc_2026", teamA: "x" }));
  await assertFails(setDoc(doc(peteDb(), "bc_budget/real_b1"), { tournament_id: "bc_2026", amount: 5000 }));
  await assertFails(setDoc(doc(peteDb(), "bc_ledger/real_l1"), { tournament_id: "bc_2026", amount: 800 }));
  await assertFails(deleteDoc(doc(peteDb(), "bc_players/real_p1")));
});

await check("nor in one with no edition document at all", () =>
  // The opposite default to editionLocked(), deliberately: a missing edition
  // row fails OPEN for scoring (a new tournament has to be able to start) and
  // CLOSED for admin (an unmarked tournament is a real one).
  assertFails(setDoc(doc(peteDb(), "bc_rounds/ghost_r1"), { tournament_id: "bc_2099", par: 72 })));

await check("the FLAG decides it, not the id, and it must be a boolean", async () => {
  // `is_demo: "true"` is a string. Truthiness is not the test.
  await assertFails(setDoc(doc(peteDb(), "bc_rounds/nd_r1"), { tournament_id: "bc_notdemo", par: 72 }));
  // bc_2025 has an edition row with no is_demo field at all.
  await assertFails(setDoc(doc(peteDb(), "bc_rounds/r2025"), { tournament_id: "bc_2025", par: 72 }));
});

await check("a demo administrator cannot carry a row OUT of the demo", () =>
  assertFails(setDoc(doc(peteDb(), "bc_players/demo_p1"), { tournament_id: "bc_2026" }, { merge: true })));

await check("...nor drag one INTO it out of the cup", () =>
  assertFails(setDoc(doc(peteDb(), "bc_players/real_p1"), { tournament_id: "bc_demo" }, { merge: true })));

await check("a demo administrator cannot touch the list of tournaments", async () => {
  // Not even the demo's own row: bc_editions is where `is_demo` and `locked`
  // live, so a write here would let a member mark the live cup as a demo.
  await assertFails(setDoc(doc(peteDb(), "bc_editions/bc_demo"), { name: "Mine" }, { merge: true }));
  await assertFails(setDoc(doc(peteDb(), "bc_editions/bc_2026"), { is_demo: true }, { merge: true }));
  await assertFails(setDoc(doc(peteDb(), "bc_editions/bc_2027"), { year: 2027, is_demo: true }));
  await assertFails(deleteDoc(doc(peteDb(), "bc_editions/bc_2026")));
});

await check("a demo administrator cannot read or set the password", async () => {
  await assertFails(getDoc(doc(peteDb(), "bc_secrets/access")));
  await assertFails(setDoc(doc(peteDb(), "bc_secrets/access"), { code: "petes" }));
});

await check("a demo administrator cannot crown anybody, themselves included", async () => {
  await assertFails(setDoc(doc(peteDb(), "bc_accounts/pete"), { is_director: true }, { merge: true }));
  await assertFails(setDoc(doc(peteDb(), "bc_accounts/mallory"), { is_director: true }, { merge: true }));
});

await check("a signed-in NON-member gets none of it", () => {
  const bob = env.authenticatedContext("bob").firestore();
  return assertFails(setDoc(doc(bob, "bc_rounds/demo_r2"), { tournament_id: "bc_demo", par: 72 }));
});

await check("a guest — no auth at all — gets none of it", () =>
  assertFails(setDoc(doc(anonDb(), "bc_rounds/demo_r3"), { tournament_id: "bc_demo", par: 72 })));

await check("a director still administers the demo like anywhere else", () =>
  assertSucceeds(setDoc(doc(aliceDb(), "bc_rounds/demo_r1"), { tournament_id: "bc_demo", par: 71 }, { merge: true })));

await env.cleanup();

let failed = 0;
for (const [status, name, msg] of results) {
  if (status === "FAIL") failed++;
  console.log(`${status}  ${name}${msg ? `\n      ${msg}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
