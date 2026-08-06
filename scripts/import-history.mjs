// ══════════════════════════════════════════════════════════════════
//  import-history — the past cups, into Firestore, as real editions.
// ══════════════════════════════════════════════════════════════════
//
// Turns 2016–2024 into editions the app treats like any other: switch to 2019
// in Editions and the leaderboard, the scorecards, the match strip and the
// round detail all work, because nothing about them is special-cased.
//
// WHAT DECIDES THE CONTENT IS NOT HERE. src/lib/historyImport.js builds every
// document; src/lib/historyVerify.js scores the result with the app's own
// engine and compares it against the record. This file reads, verifies, prints
// and writes — and refuses to write a year that does not come out the way it
// was played.
//
// ── Running it ────────────────────────────────────────────────────
// Dry run is the DEFAULT. Nothing is written unless --write is passed:
//
//   node scripts/import-history.mjs                  # verify, count, preview
//   node scripts/import-history.mjs --year 2019      # one year
//   node scripts/import-history.mjs --write          # actually write
//   node scripts/import-history.mjs --undo --write   # take it back out
//
// Credentials: this uses the Firebase ADMIN SDK, which bypasses
// firestore.rules entirely — bc_players, bc_courses and bc_rounds are
// director-only there, and a bulk import is not a signed-in phone. Point it at
// a service-account key:
//
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
//   node scripts/import-history.mjs --write
//
// The key comes from Firebase Console → Project Settings → Service accounts →
// Generate new private key. It has full database access: do not commit it.
// firebase-admin is not a dependency of the app, so install it for the run
// (`npm i --no-save firebase-admin`) or run this from functions/, which has it.
//
// ── A year the app already holds is not imported ──────────────────
// 2025 was typed into the app by hand, to try the app against a tournament
// that had already been played. Its roster rows are the ones accounts have
// claimed, and its document ids were minted by the app (`bc_player_<ms>`), not
// by this import (`hist_2025_<name>`).
//
// That difference is the whole hazard. An import of 2025 would not REPLACE
// what is there — the ids don't collide — it would sit a second roster, a
// second draw and a second set of cards beside the first, inside the same
// edition. Every screen would show sixteen players twice.
//
// So it is skipped, and naming it with --year asks for --force on top. The
// same reasoning covers any edition built in the app rather than imported —
// 2026 when it starts — which is why the write half also asks Firestore
// whether the year it is about to write already has a hand-built roster in it.
//
// ── Idempotent ────────────────────────────────────────────────────
// Every document id is derived from (year, round, player, hole), so a second
// run overwrites the first rather than duplicating it. Re-running after fixing
// a row in data/ is the intended way to correct an import.
//
// It does NOT delete. A year that lost rows in data/ keeps whatever was
// written before; --undo removes exactly the documents this import would
// create, which is the tool for putting back a run that went somewhere it
// shouldn't have.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { IMPORT_COLLECTIONS, countDocs } from "../src/lib/historyImport.js";
import { verifyEdition, verdictOf, cupScore } from "../src/lib/historyVerify.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");
const read = (f) => JSON.parse(readFileSync(join(DATA, f), "utf8"));

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => (args.indexOf(flag) >= 0 ? args[args.indexOf(flag) + 1] : null);
const WRITE = has("--write");
const UNDO = has("--undo");
const FORCE = has("--force");
const yearArg = valueOf("--year") ? Number(valueOf("--year")) : null;
const allowProject = valueOf("--allow-project");

// Years the app already holds, built in it rather than imported into it. A
// plain list, not derived from the active-edition pointer: that pointer moves
// to 2026 the moment next year is set up, and a rule that read it would then
// happily import a second 2025 on top of the one people have claimed names in.
// A year leaves this list only if its documents are gone from Firestore.
const BUILT_IN_THE_APP = new Set([2025]);

// ── Which project this repo belongs to ────────────────────────────
// Read from .firebaserc, the file `firebase deploy` reads, so the check and
// the deploy agree. A key for another project is refused outright: announcing
// which database is about to take eight thousand documents is not the same as
// refusing to put them in the wrong one.
const expectedProject = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, ".firebaserc"), "utf8"))?.projects?.default || null; }
  catch { return null; }
})();

// ── The credential, checked before anything is announced ──────────
// Up here rather than beside the batches, so a bad key path costs nothing and
// says nothing misleading: a missing file must not print "WRITING to
// Firestore" and a document count before it fails.
const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
let serviceAccount = null;

const die = (...lines) => { console.error(["", ...lines].join("\n")); process.exit(1); };

if (WRITE && !emulator) {
  if (!keyPath) {
    die("GOOGLE_APPLICATION_CREDENTIALS is not set. Nothing was written.",
        "",
        "  export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json",
        "",
        "The key comes from Firebase Console -> Project Settings -> Service accounts",
        "-> Generate new private key. To rehearse against no real database, set",
        "FIRESTORE_EMULATOR_HOST and point it at the emulator.");
  }
  let raw;
  try { raw = readFileSync(keyPath, "utf8"); }
  catch (e) {
    die("Can't read the service-account key. Nothing was written.", `  ${keyPath}`, "",
        e.code === "ENOENT"
          ? "There is no file at that path. The console downloads it as"
          : `  ${e.message}`,
        e.code === "ENOENT" ? "<project>-firebase-adminsdk-<hash>.json, which is rarely what you guessed." : "");
  }
  try { serviceAccount = JSON.parse(raw); }
  catch { die("The service-account key is not valid JSON. Nothing was written.", `  ${keyPath}`); }
  for (const field of ["project_id", "client_email", "private_key"]) {
    if (!serviceAccount[field]) {
      die(`That file is not a service-account key — no \`${field}\`. Nothing was written.`, `  ${keyPath}`);
    }
  }
  const target = serviceAccount.project_id;
  if (expectedProject && target !== expectedProject && target !== allowProject) {
    die("That key is for a DIFFERENT Firebase project. Nothing was written.", "",
        `  key points at:  ${target}`,
        `  .firebaserc:    ${expectedProject}`,
        `  key file:       ${keyPath}`, "",
        "If that is genuinely where you meant to write, name it:",
        `  node scripts/import-history.mjs --allow-project ${target} ...`);
  }
}

// ── Build and verify ──────────────────────────────────────────────
const { editions } = read("bourbon-cup-editions.json");
const backbone = read("bourbon-cup-backbone.json");
const facts = read("bourbon-cup-matchfacts.json").matchFacts;

const wanted = editions.filter((e) => (yearArg ? e.year === yearArg : !BUILT_IN_THE_APP.has(e.year)));
if (!wanted.length) {
  die(yearArg ? `No edition for ${yearArg} in data/bourbon-cup-editions.json.`
              : "No editions to import. Run `npm run build:editions` first.");
}
if (yearArg && BUILT_IN_THE_APP.has(yearArg) && !FORCE) {
  die(`${yearArg} is already in the app — it was entered by hand, and accounts are claimed to its roster.`,
      "This import would not replace it. Its document ids are different, so you would get a",
      "second roster, a second draw and a second set of cards inside the same edition.",
      "",
      "If you mean to do it anyway, delete that edition in Admin → Tournament → Editions",
      "first, then add --force.");
}

console.log(
  UNDO && WRITE ? `DELETING from Firestore${serviceAccount ? ` — project ${serviceAccount.project_id}` : ""}\n`
  : UNDO ? "DRY RUN (undo) — nothing will be deleted. Add --write to commit.\n"
  : WRITE ? `WRITING to Firestore${serviceAccount ? ` — project ${serviceAccount.project_id}` : ""}${emulator ? ` (emulator at ${emulator})` : ""}\n`
  : "DRY RUN — nothing will be written. Pass --write to commit.\n");

console.log("year   players  matches  scores   docs   cup           verified");
const runs = [];
for (const edition of wanted) {
  const holes = backbone.playerHole.filter((h) => h.year === edition.year);
  const v = verifyEdition(edition, holes, {
    playerRounds: backbone.playerRound.filter((r) => r.year === edition.year),
    facts: facts.filter((f) => f.year === edition.year),
  });
  const problems = verdictOf(v);
  const cup = cupScore(v.built, v.view);
  runs.push({ edition, built: v.built, problems });
  console.log(
    String(edition.year).padEnd(7) +
    String(v.built.bc_players.length).padEnd(9) +
    String(v.built.bc_matches.length).padEnd(9) +
    String(v.built.bc_hole_scores.length).padEnd(9) +
    String(countDocs(v.built)).padEnd(7) +
    `${cup.A}–${cup.B}`.padEnd(14) +
    (problems.length ? `✗ ${problems.length} problem${problems.length > 1 ? "s" : ""}` : "✓"));
  for (const p of problems) console.log(`         ${p}`);
}

const total = runs.reduce((n, r) => n + countDocs(r.built), 0);
console.log(`\n${runs.length} editions, ${total} documents.`);
const forced = wanted.filter((e) => BUILT_IN_THE_APP.has(e.year));
if (forced.length) {
  console.log(`\n⚠ ${forced.map((e) => e.year).join(", ")} is already in the app and --force was given.`);
  console.log("  Unless that edition has been deleted first, this ADDS a second roster beside the one there.");
} else if (!yearArg) {
  console.log(`${[...BUILT_IN_THE_APP].join(", ")} skipped — already in the app, entered by hand.`);
}

// A year the app scores differently from the record is not imported. The whole
// value of these editions is that they say what happened; one that doesn't is
// worse than not having it, because nothing on screen would say so.
const failed = runs.filter((r) => r.problems.length);
if (failed.length && WRITE && !UNDO) {
  die(`${failed.map((r) => r.edition.year).join(", ")} did not verify. Nothing was written.`,
      "",
      "Fix the data (pipeline/editions.mjs) or the builder (src/lib/historyImport.js)",
      "and run the dry run again. --force does not override this: an edition that",
      "scores differently from the scorecards is not the tournament it claims to be.");
}

if (!WRITE) {
  const sample = runs.find((r) => r.built.bc_hole_scores.length);
  if (sample && !UNDO) {
    console.log(`\nSample documents from ${sample.edition.year}:`);
    for (const c of IMPORT_COLLECTIONS) {
      if (sample.built[c]?.length) console.log(`  ${c}: ${JSON.stringify(sample.built[c][0]).slice(0, 220)}`);
    }
  }
  if (UNDO) console.log(`\n--undo would DELETE those ${total} documents. Add --write to commit.`);
  process.exit(0);
}

// ── The write half ────────────────────────────────────────────────
// Imported lazily so a dry run needs no credentials and no firebase-admin
// installed — which is what makes the preview above runnable by anybody.
const { initializeApp, cert } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");

initializeApp({
  projectId: serviceAccount?.project_id || expectedProject || "bourbon-cup-import",
  ...(serviceAccount ? { credential: cert(serviceAccount) } : {}),
});
const db = getFirestore();

// ── Is this year already somebody's tournament? ───────────────────
// The list above is a declaration, and a declaration goes stale. This is the
// check that cannot: ask the database whether the edition about to be written
// already holds roster rows this import did not write. Every document it
// creates carries an `imported_from` field, so anything without one was built
// in the app — by a director setting up 2026, or by whoever typed in 2025.
//
// Writing on top of that does not replace it. The ids differ, so both rosters
// survive and every screen shows the field twice. Refused rather than warned,
// because the run that does it looks exactly like the run that doesn't until
// somebody opens the app.
if (!UNDO) {
  const occupied = [];
  for (const { edition } of runs) {
    const tid = `bc_${edition.year}`;
    const rows = await db.collection("bc_players").where("tournament_id", "==", tid).get();
    const handBuilt = rows.docs.filter((d) => !d.data().imported_from).length;
    if (handBuilt) occupied.push(`${edition.year}: ${handBuilt} roster rows already there, not from this import`);
  }
  if (occupied.length && !FORCE) {
    die("Those editions already exist in the app. Nothing was written.", "",
        ...occupied.map((o) => `  ${o}`), "",
        "This import would sit a second roster beside the one that is there rather than",
        "replace it. Delete the edition in Admin → Tournament → Editions first, or add",
        "--force if you know the two sets of documents will not collide.");
  }
  if (occupied.length) {
    console.log("⚠ --force: writing into editions that already hold a roster —");
    for (const o of occupied) console.log(`    ${o}`);
  }
}

// 500 is Firestore's hard limit on a batch; 400 leaves room and keeps a failed
// batch small enough to reason about.
const BATCH = 400;
let done = 0;
const tick = () => process.stdout.write(`\r${done}/${total} documents…`);

for (const { built } of runs) {
  for (const col of IMPORT_COLLECTIONS) {
    const docs = built[col] || [];
    for (let i = 0; i < docs.length; i += BATCH) {
      const slice = docs.slice(i, i + BATCH);
      const batch = db.batch();
      for (const d of slice) {
        const ref = db.collection(col).doc(String(d.id));
        // merge on write so a re-run corrects rather than replaces, and an
        // edition somebody has since edited in the app keeps those edits on
        // fields this import does not set.
        if (UNDO) batch.delete(ref); else batch.set(ref, d, { merge: true });
      }
      await batch.commit();
      done += slice.length;
      tick();
    }
  }
}

console.log(`\r${UNDO ? "Deleted" : "Wrote"} ${done} documents across ${runs.length} editions.        `);
if (!UNDO) console.log("\nSwitch to any year in Admin → Tournament → Editions, or the ☰ menu → Tournaments.");
