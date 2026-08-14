// ══════════════════════════════════════════════════════════════════
//  seed-demo — writes the tester edition, and only ever that one.
// ══════════════════════════════════════════════════════════════════
//
// The demo tournament `docs/store-submission.md` §1.4 asks for, and the thing
// the Play closed test needs so twelve people have something to actually do.
// `src/lib/demoSeed.js` decides every document; this file prints them, writes
// them and takes them back out.
//
// ── Running it ────────────────────────────────────────────────────
// Dry run is the DEFAULT. Nothing is written unless --write is passed:
//
//   node scripts/seed-demo.mjs                  # build, count, preview
//   node scripts/seed-demo.mjs --write          # actually write
//   node scripts/seed-demo.mjs --undo --write   # take it back out
//
// A thirteenth golfer, for a tester who would rather see their own name than
// claim "Pete V" — one row, no re-seed, and stamped so --undo still gets it:
//
//   node scripts/seed-demo.mjs --add "Aaron J" --team A --index 12.4 --write
//
// A director can do the same from Admin → Players while switched to the demo,
// which is easier for one person. This is for a handful at once.
//
// Credentials: the Firebase ADMIN SDK, which bypasses firestore.rules — the
// roster, courses and rounds are director-only there and a bulk seed is not a
// signed-in phone. Point --key at a service-account key; it works the same in
// PowerShell and in bash, which `VAR=value command` does not:
//
//   node scripts/seed-demo.mjs --write --key C:\path\to\key.json
//
// GOOGLE_APPLICATION_CREDENTIALS is still read when it is set, for anyone who
// already has it in their environment.
//
// The key is Firebase Console → Project Settings → Service accounts →
// Generate new private key. It has full database access: do not commit it
// (.gitignore already covers the names the console gives it). firebase-admin
// is not an app dependency — `npm i --no-save firebase-admin`, or run this
// from functions/, which has it.
//
// ── What stops this touching the real cup ─────────────────────────
// Everything, and deliberately more than once, because the failure would be
// unrecoverable and would land in the middle of a live tournament:
//
//   1. The target edition id is a CONSTANT. There is no --edition flag, so
//      there is no argument to typo. A run that somehow built a document for
//      another edition aborts before it opens a connection.
//   2. Every document is verified to carry tournament_id === bc_demo and a
//      namespaced id, in this file, after the builder has run.
//   3. The project id is checked against .firebaserc unless --allow-project
//      names a different one out loud.
//   4. If bc_demo already holds documents WITHOUT `seeded_from`, it stops.
//      That means somebody built something real in there, and the point of
//      the mark is that this seed only ever owns what it wrote.
//   5. --undo deletes by the mark, not by the collection. A document a human
//      added to the demo survives an undo.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDemo, buildDemoPlayer, countDemoDocs,
  DEMO_COLLECTIONS, DEMO_EDITION_ID, DEMO_MARK, DEMO_NAME, SEEDED_PLAYER_IDS,
} from "../src/lib/demoSeed.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (f) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : null);

// Everything after a flag up to the next one, joined. `--add "Aaron J"` should
// be one name, and on Windows it is not: `npm run seed:demo -- --add "Aaron J"`
// arrives as `--add Aaron J`, because npm hands the arguments to cmd and the
// quotes are gone by the time node sees them. Reading a single token there
// would create a golfer called "Aaron" and silently drop the surname — a
// result that looks like it worked.
const phraseAfter = (f) => {
  const i = args.indexOf(f);
  if (i < 0) return null;
  const words = [];
  for (let j = i + 1; j < args.length && !args[j].startsWith("--"); j++) words.push(args[j]);
  return words.length ? words.join(" ") : null;
};

const WRITE = has("--write");
const UNDO = has("--undo");
const ADD = phraseAfter("--add");
const allowProject = valueOf("--allow-project");

const die = (msg) => { console.error(`\n✖ ${msg}\n`); process.exit(1); };

if (ADD && UNDO) die("--add and --undo do opposite things. Pick one.");

// ── Build, then check what was built ────────────────────────────────
// --add builds ONE roster row instead of the whole tournament, and goes
// through the same rails below: same mark, same containment checks, same
// project check. There is no second write path.
let built, total;
if (ADD) {
  const res = buildDemoPlayer({ name: ADD, team: valueOf("--team"), index: valueOf("--index") });
  if (!res.ok) die(res.error);
  if (SEEDED_PLAYER_IDS.includes(res.player.id)) {
    die(`\`${res.player.id}\` is one of the twelve the seed owns. Pick another name, or re-run the seed to change it.`);
  }
  built = Object.fromEntries(DEMO_COLLECTIONS.map(c => [c, []]));
  built.bc_players = [res.player];
  total = 1;
  console.log(`\n  + ${res.player.name}  ·  Team ${res.player.team}  ·  ${res.player.handicap_index}  ·  ${res.player.id}`);
} else {
  built = buildDemo();
  total = countDemoDocs(built);
}

// Rail 2. The builder is unit-tested and this is still here, because the cost
// of the two disagreeing is a stray roster row inside the live cup and the
// cost of the check is nothing.
for (const col of DEMO_COLLECTIONS) {
  for (const doc of built[col]) {
    if (col === "bc_editions") {
      if (doc.id !== DEMO_EDITION_ID) die(`refusing to write edition \`${doc.id}\``);
      continue;
    }
    if (doc.tournament_id !== DEMO_EDITION_ID) {
      die(`${col}/${doc.id} carries tournament_id \`${doc.tournament_id}\` — refusing to write anything`);
    }
    const own = doc.id.startsWith(`${DEMO_EDITION_ID}__`) || doc.id.startsWith("demo_");
    if (!own) die(`${col}/${doc.id} is not namespaced under ${DEMO_EDITION_ID} — refusing to write anything`);
    if (doc.seeded_from !== DEMO_MARK) die(`${col}/${doc.id} is unmarked — refusing to write anything`);
  }
}

console.log(`\n  ${DEMO_NAME}  (${DEMO_EDITION_ID})`);
console.log(`  ${"─".repeat(46)}`);
for (const col of DEMO_COLLECTIONS) {
  const n = built[col].length;
  if (n) console.log(`  ${String(n).padStart(4)}  ${col}`);
}
console.log(`  ${"─".repeat(46)}`);
console.log(`  ${String(total).padStart(4)}  documents total\n`);

if (!WRITE) {
  console.log(
    UNDO ? "  Dry run. Pass --undo --write to delete what this seed wrote.\n"
    : ADD ? "  Dry run. Pass --write to add them.\n"
    : "  Dry run. Pass --write to create it.\n");
  process.exit(0);
}

// ── The key, however this shell likes to say it ─────────────────────
// `--key` exists because `GOOGLE_APPLICATION_CREDENTIALS=… node …` is bash
// syntax and this repo has a Windows developer. In PowerShell that line is not
// a command with an environment override in front of it, it is a command whose
// NAME is `GOOGLE_APPLICATION_CREDENTIALS=…`, and the error says so in those
// terms — which reads as the script being broken rather than the shell being
// different. A flag works identically in both.
const KEY = phraseAfter("--key") || process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!KEY) {
  die("No service-account key.\n"
    + "      --key C:\\path\\to\\key.json        (any shell)\n"
    + "      $env:GOOGLE_APPLICATION_CREDENTIALS = \"C:\\path\\to\\key.json\"   (PowerShell)\n"
    + "      GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json               (bash/zsh)");
}
if (!existsSync(KEY)) {
  die(`no file at \`${KEY}\`.\n`
    + `  That is the path to the JSON the Firebase console downloads —\n`
    + `  Project Settings → Service accounts → Generate new private key.`);
}
// Rail 3, BEFORE anything connects — the key itself names the project, and a
// key for the wrong one is how a seed ends up in somebody else's database. Read
// it off the file rather than off an initialized app, so the check happens
// before a connection is possible rather than after.
const expected = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, ".firebaserc"), "utf8"))?.projects?.default || null; }
  catch { return null; }
})();
const serviceAccount = (() => {
  try { return JSON.parse(readFileSync(KEY, "utf8")); }
  catch { return null; }
})();
const actual = serviceAccount?.project_id || null;
if (!actual) die(`\`${KEY}\` is not a service-account key — no project_id in it.`);
if (expected && actual !== expected && actual !== allowProject) {
  die(`the key is for \`${actual}\`, and .firebaserc says \`${expected}\`.\n`
    + `  If that is deliberate: --allow-project ${actual}`);
}
console.log(`  Project: ${actual}\n`);

// ── Connect ─────────────────────────────────────────────────────────
// The MODULAR subpath API, matching scripts/import-history.mjs and
// scripts/undo-clone.mjs. Not `(await import("firebase-admin")).default` and
// the old `admin.credential.applicationDefault()` namespace: under ESM,
// firebase-admin v13's default export does not carry `credential`, so that
// form dies with "Cannot read properties of undefined" AFTER printing the
// project line — i.e. at the exact moment it looks like it is about to work.
//
// Imported lazily so a dry run needs neither credentials nor firebase-admin
// installed, which is what makes the preview above runnable by anybody.
//
// `cert(serviceAccount)` rather than applicationDefault(): the key is already
// parsed above for the project check, so the credential comes from the same
// object the check passed. Nothing depends on the environment variable having
// been set, which is the whole point of --key.
let initializeApp, cert, getFirestore;
try {
  ({ initializeApp, cert } = await import("firebase-admin/app"));
  ({ getFirestore } = await import("firebase-admin/firestore"));
} catch {
  die("firebase-admin is not installed. `npm i --no-save firebase-admin`, or run this from functions/.");
}

// A key whose JSON is fine but whose private_key is truncated, re-wrapped by a
// copy-paste, or simply not a key throws out of `cert()` as an unhandled
// OpenSSL decoder error — four lines of asn1 stack that say nothing about
// which file is wrong or what to do. Everything else in this script dies with
// a sentence; so does this.
let db;
try {
  initializeApp({ projectId: actual, credential: cert(serviceAccount) });
  db = getFirestore();
} catch (e) {
  die(`\`${KEY}\` was not accepted as a service-account key.\n`
    + `  ${e?.message || e}\n\n`
    + `  The JSON parsed and named the right project, so the file is a key of some\n`
    + `  kind — most likely its private_key was mangled in transit. Download a fresh\n`
    + `  one: Firebase Console → Project Settings → Service accounts →\n`
    + `  Generate new private key, and save it without opening it in an editor.`);
}

// ── Firestore failures, said in a sentence ──────────────────────────
// The admin SDK throws rich objects — a rejected credential comes back as a
// multi-screen dump of response headers and a tracking id, with the actual
// cause somewhere in the middle. Every other failure in this script is one
// line; these are the ones most likely to be hit, so they get the same
// treatment. `partial` matters: a query that fails wrote nothing, and a batch
// that fails halfway through did not.
const firestoreDied = (e, what, { partial = false } = {}) => {
  const msg = String(e?.message || e);
  const hint =
    /invalid_grant|Invalid JWT|invalid_client|UNAUTHENTICATED|Getting metadata|credential/i.test(msg)
      ? "The key was structurally fine but the server refused it. It may have been revoked,\n"
        + "  or it may belong to a deleted service account — generate a fresh one in the console."
    : /PERMISSION_DENIED|Missing or insufficient/i.test(msg)
      ? "The key authenticated but is not allowed to do this. A service-account key normally\n"
        + "  bypasses security rules, so check the account still has a Firebase/Datastore role."
    : /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network|fetch failed/i.test(msg)
      ? "That looks like a network problem rather than a credentials one. Check the connection\n"
        + "  and run it again — the seed is idempotent, so a re-run is safe."
      : "";
  die(`${what} failed.\n  ${msg.split("\n")[0]}\n`
    + (hint ? `\n  ${hint}\n` : "")
    + (partial
      ? `\n  SOME DOCUMENTS MAY ALREADY BE WRITTEN. Re-running is safe — every id is\n`
        + `  derived, so a second run overwrites rather than duplicating. To clear it\n`
        + `  out instead: --undo --write.`
      : `\n  Nothing was written.`));
};

// ── --add needs a tournament to add to ──────────────────────────────
// Adding a golfer to an edition that was never seeded leaves a roster row
// carrying `tournament_id: bc_demo` and no bc_editions document behind it. The
// write SUCCEEDS, and the result is invisible: the picker lists editions, so
// ☰ → Tournaments shows nothing new and there is no way to switch to the
// tournament the row is in. Worse, `editionExists` counts roster rows as well
// as documents, so the id then reads as taken — a later `createEdition` for it
// is refused with no clue why.
//
// Cheap to check and impossible to diagnose from the app, so it is checked.
if (ADD) {
  const edition = await db.collection("bc_editions").doc(DEMO_EDITION_ID).get()
    .catch((e) => firestoreDied(e, "Reading the demo edition"));
  if (!edition.exists) {
    die(`there is no \`${DEMO_EDITION_ID}\` tournament to add them to.\n`
      + `  Seed it first:\n`
      + `      npm run seed:demo -- --write --key <path to key>\n\n`
      + `  Adding a player to an edition that does not exist writes a roster row\n`
      + `  nothing can reach — the picker lists editions, and there would not be one.`);
  }
}

// ── Rail 4 — is there anything real in there? ───────────────────────
// Skipped for --add, and the distinction is the point of the rail rather than
// an exception to it. The check exists because a full seed OVERWRITES 371
// documents, so anything a person built in the demo would be flattened by it.
// --add writes one new row under an id nothing else can be using — it cannot
// flatten anything, and a director who added a player by hand should not find
// that adding a second one is now refused.
const foreign = [];
for (const col of ADD ? [] : DEMO_COLLECTIONS) {
  if (col === "bc_editions") continue;
  const snap = await db.collection(col).where("tournament_id", "==", DEMO_EDITION_ID).get()
    .catch((e) => firestoreDied(e, `Reading ${col}`));
  for (const d of snap.docs) if (d.data().seeded_from !== DEMO_MARK) foreign.push(`${col}/${d.id}`);
}
if (foreign.length) {
  die(`${DEMO_EDITION_ID} holds ${foreign.length} document(s) this seed did not write:\n`
    + foreign.slice(0, 8).map(f => `      ${f}`).join("\n")
    + (foreign.length > 8 ? `\n      … and ${foreign.length - 8} more` : "")
    + `\n\n  Somebody built something in the demo edition. Move or delete it first;`
    + `\n  this seed only ever owns what it marked.`);
}

// Firestore caps a batch at 500 writes.
const commitInChunks = async (ops) => {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + 400)) op(batch);
    await batch.commit().catch((e) => firestoreDied(e, "Writing", { partial: i > 0 }));
    process.stdout.write(`\r  ${Math.min(i + 400, ops.length)}/${ops.length}`);
  }
  process.stdout.write("\n");
};

if (UNDO) {
  // Rail 5. By the mark, not by the collection — a card a tester signed in the
  // demo is theirs, and an undo that took it would be deleting somebody's work
  // to tidy up.
  const ops = [];
  for (const col of DEMO_COLLECTIONS) {
    const snap = col === "bc_editions"
      ? await db.collection(col).where("seeded_from", "==", DEMO_MARK).get()
        .catch((e) => firestoreDied(e, `Reading ${col}`))
      : await db.collection(col).where("tournament_id", "==", DEMO_EDITION_ID).get()
        .catch((e) => firestoreDied(e, `Reading ${col}`));
    for (const d of snap.docs) {
      if (d.data().seeded_from !== DEMO_MARK) continue;
      ops.push((b) => b.delete(d.ref));
    }
  }
  if (!ops.length) { console.log("  Nothing seeded to remove.\n"); process.exit(0); }
  console.log(`  Deleting ${ops.length} seeded document(s)…`);
  await commitInChunks(ops);
  console.log(`\n  ${DEMO_EDITION_ID} removed.`);
  console.log("  Anything a tester created in it that this seed did not write has been left.\n");
  process.exit(0);
}

const ops = [];
for (const col of DEMO_COLLECTIONS) {
  for (const doc of built[col]) {
    const { id, ...rest } = doc;
    // `set` with merge, so a re-run corrects a changed field rather than
    // erroring, and a tester's edited score is overwritten back to the seed's
    // value — which is what re-running a seed is FOR.
    ops.push((b) => b.set(db.collection(col).doc(id), rest, { merge: true }));
  }
}
console.log(`  Writing ${ops.length} document(s)…`);
await commitInChunks(ops);

if (ADD) {
  console.log(`\n  Added to ${DEMO_NAME}. They can claim the name on the roster screen.`);
  console.log(`  They are NOT in the draw — put them in a match in Admin → Matches,`);
  console.log(`  or leave them to watch. Either way they are only in ${DEMO_EDITION_ID}.\n`);
} else {
  console.log(`\n  ${DEMO_NAME} is live.`);
  console.log(`  Switch to it in ☰ → Tournaments, or Admin → Event → Editions.`);
  console.log(`  Testers claim any of the twelve names on the roster screen.`);
  console.log(`  Take it back out with: node scripts/seed-demo.mjs --undo --write\n`);
}
