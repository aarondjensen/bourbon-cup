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
import { doc, setDoc, getDoc, deleteDoc } from "firebase/firestore";
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

const aliceDb = () => env.authenticatedContext("alice").firestore();
const malloryDb = () => env.authenticatedContext("mallory").firestore();
const anonDb = () => env.unauthenticatedContext().firestore();

const member = { uid: "alice", email: "a@example.com", joined_at: "now" };

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

await check("member cannot re-write their own membership", () =>
  assertFails(setDoc(doc(aliceDb(), "bc_accounts/alice"), { ...member, code: "" })));

await check("member cannot delete their own membership", () =>
  assertFails(deleteDoc(doc(aliceDb(), "bc_accounts/alice"))));

await check("member can read their own membership", () =>
  assertSucceeds(getDoc(doc(aliceDb(), "bc_accounts/alice"))));

await check("nobody can read somebody else's membership", () =>
  assertFails(getDoc(doc(malloryDb(), "bc_accounts/alice"))));

await check("a member can set the password", () =>
  assertSucceeds(setDoc(doc(aliceDb(), "bc_secrets/access"), { code: "bourbon2026" })));

// ── With a password configured ──────────────────────────────────────
await check("a member can read the password back (Admin shows it)", () =>
  assertSucceeds(getDoc(doc(aliceDb(), "bc_secrets/access"))));

await check("a signed-in non-member CANNOT read the password", () => {
  const bob = env.authenticatedContext("bob").firestore();
  return assertFails(getDoc(doc(bob, "bc_secrets/access")));
});

await check("an anonymous visitor cannot read the password", () =>
  assertFails(getDoc(doc(anonDb(), "bc_secrets/access"))));

await check("stranger with the WRONG password is refused membership", () =>
  assertFails(setDoc(doc(malloryDb(), "bc_accounts/mallory"), { uid: "mallory", code: "guess" })));

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
