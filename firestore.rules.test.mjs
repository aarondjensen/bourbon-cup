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
  await assertSucceeds(setDoc(doc(peteDb(), "bc_skins/r1h3"), { player_id: "p9" }));
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

// ── Reads stay open, and the archive stays append-only ──────────────
await check("anon can still read the leaderboard data", () =>
  assertSucceeds(getDoc(doc(anonDb(), "bc_hole_scores/x"))));

await check("anon can read the roster", () =>
  assertSucceeds(getDoc(doc(anonDb(), "bc_players/p1"))));

await check("member cannot rewrite an archived year", async () => {
  await assertSucceeds(setDoc(doc(aliceDb(), "bc_historical/2019"), { year: 2019 }));
  await assertFails(setDoc(doc(aliceDb(), "bc_historical/2019"), { year: 2019, pot: 999 }));
});

await check("unlisted collections stay denied", () =>
  assertFails(setDoc(doc(aliceDb(), "bc_whatever/x"), { v: 1 })));

await env.cleanup();

let failed = 0;
for (const [status, name, msg] of results) {
  if (status === "FAIL") failed++;
  console.log(`${status}  ${name}${msg ? `\n      ${msg}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
