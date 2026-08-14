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
// signed-in phone.
//
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
//   node scripts/seed-demo.mjs --write
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
import { readFileSync } from "node:fs";
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

const WRITE = has("--write");
const UNDO = has("--undo");
const ADD = valueOf("--add");
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

// ── Connect ─────────────────────────────────────────────────────────
let admin;
try {
  admin = (await import("firebase-admin")).default;
} catch {
  die("firebase-admin is not installed. `npm i --no-save firebase-admin`, or run this from functions/.");
}

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  die("GOOGLE_APPLICATION_CREDENTIALS is not set. Point it at a service-account key.");
}

// Rail 3, BEFORE initializeApp — the key itself names the project, and a key
// for the wrong one is how a seed ends up in somebody else's database. Read it
// off the file rather than off the initialized app so the check happens before
// anything can connect.
const expected = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, ".firebaserc"), "utf8"))?.projects?.default || null; }
  catch { return null; }
})();
const actual = (() => {
  try { return JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8")).project_id || null; }
  catch { return null; }
})();
if (!actual) die(`could not read a project_id out of ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
if (expected && actual !== expected && actual !== allowProject) {
  die(`the key is for \`${actual}\`, and .firebaserc says \`${expected}\`.\n`
    + `  If that is deliberate: --allow-project ${actual}`);
}
console.log(`  Project: ${actual}\n`);

admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();

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
  const snap = await db.collection(col).where("tournament_id", "==", DEMO_EDITION_ID).get();
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
    await batch.commit();
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
      : await db.collection(col).where("tournament_id", "==", DEMO_EDITION_ID).get();
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
