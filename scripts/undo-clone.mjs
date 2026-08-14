// ══════════════════════════════════════════════════════════════════
//  undo-clone — take a clone back out of the tournament it landed in.
// ══════════════════════════════════════════════════════════════════
//
// An edition's id used to be `bc_${year}` and nothing else, so a demo
// tournament typed as 2026 was not a second tournament — it was the 2026
// already being built for the real trip. The picker cannot do that any more
// (lib/editions.js refuses an occupied id, and a label gives a demo copy an id
// of its own). This is the repair for the editions it already happened to.
//
// WHAT DECIDES WHAT GETS DELETED IS NOT HERE. src/lib/cloneAudit.js reads the
// id shapes, scans for references and marks each row; it is pure and it is
// unit-tested, because "which of these two Aaron Jensens is the real one" is
// not a question to answer by eye against a live database. This file reads,
// prints, and deletes exactly what that plan marked safe.
//
// ── Running it ────────────────────────────────────────────────────
// Dry run is the DEFAULT. Nothing is deleted unless --write is passed:
//
//   node scripts/undo-clone.mjs                        # every edition, what's in it
//   node scripts/undo-clone.mjs --edition bc_2026      # one edition, in full
//   node scripts/undo-clone.mjs --edition bc_2026 --write
//   node scripts/undo-clone.mjs --edition bc_2026 --stamp 1755093742318 --write
//
// UNLIKE import-history, the DRY RUN needs credentials too — there is no local
// copy of what a clone did, so every word of the report comes off the live
// database. Same key, same admin SDK, same reason (bc_players is director-only
// in the rules and this is not a signed-in phone):
//
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
//   node scripts/undo-clone.mjs --edition bc_2026
//
// firebase-admin is not a dependency of the app: `npm i --no-save
// firebase-admin`, or run this from functions/, which has it.
//
// ── What it will not do ───────────────────────────────────────────
// Only the DUPLICATED half of a collision is repairable. The documents a clone
// merges over in place — the tournament settings, team names, branding, each
// round's setup — have the same id either way, so there is no second row to
// remove and nothing that records what the field held first. They are listed
// with their current values at the end of the report, flagged, and never
// touched. Deleting them would take the tournament with them.
//
// Nor will it delete a cloned row something still points at. A clone that was
// actually played on has cards keyed to those ids, and pulling the roster row
// out from under a scorecard leaves the card on screen with nothing behind it.
// Those rows are named and kept; --force is deliberately not offered for them,
// because the fix is to delete the match or the card first, in the app, where
// what is being lost is visible.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  planCloneRemoval, originalRows, duplicatedLogins, overwritableDocIds, CLONE_ID_COLLECTIONS,
} from "../src/lib/cloneAudit.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => (args.indexOf(flag) >= 0 ? args[args.indexOf(flag) + 1] : null);
const WRITE = has("--write");
const editionArg = valueOf("--edition");
const stampArg = valueOf("--stamp") ? Number(valueOf("--stamp")) : null;
const allowProject = valueOf("--allow-project");

const die = (...lines) => { console.error(["", ...lines].join("\n")); process.exit(1); };

// ── Which project this repo belongs to ────────────────────────────
// Read from .firebaserc, the file `firebase deploy` reads, so the check and
// the deploy agree. Same guard as import-history, and it matters more here:
// that script adds documents, this one removes them.
const expectedProject = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, ".firebaserc"), "utf8"))?.projects?.default || null; }
  catch { return null; }
})();

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
let serviceAccount = null;

if (!emulator) {
  if (!keyPath) {
    die("GOOGLE_APPLICATION_CREDENTIALS is not set. Nothing was read or deleted.",
        "",
        "  export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json",
        "",
        "Unlike the history import, the DRY RUN needs this too — the whole report is",
        "read off the live database. The key comes from Firebase Console -> Project",
        "Settings -> Service accounts -> Generate new private key.");
  }
  let raw;
  try { raw = readFileSync(keyPath, "utf8"); }
  catch (e) {
    die("Can't read the service-account key. Nothing was read or deleted.", `  ${keyPath}`, "",
        e.code === "ENOENT"
          ? "There is no file at that path. The console downloads it as"
            + " <project>-firebase-adminsdk-<hash>.json, which is rarely what you guessed."
          : `  ${e.message}`);
  }
  try { serviceAccount = JSON.parse(raw); }
  catch { die("The service-account key is not valid JSON.", `  ${keyPath}`); }
  for (const field of ["project_id", "client_email", "private_key"]) {
    if (!serviceAccount[field]) die(`That file is not a service-account key — no \`${field}\`.`, `  ${keyPath}`);
  }
  const target = serviceAccount.project_id;
  if (expectedProject && target !== expectedProject && target !== allowProject) {
    die("That key is for a DIFFERENT Firebase project. Nothing was read or deleted.", "",
        `  key points at:  ${target}`,
        `  .firebaserc:    ${expectedProject}`, "",
        "If that is genuinely where you meant to work, name it:",
        `  node scripts/undo-clone.mjs --allow-project ${target} ...`);
  }
}

const { initializeApp, cert } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
initializeApp({
  projectId: serviceAccount?.project_id || expectedProject || "bourbon-cup",
  ...(serviceAccount ? { credential: cert(serviceAccount) } : {}),
});
const db = getFirestore();

const when = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

console.log(WRITE
  ? `DELETING from Firestore — project ${serviceAccount?.project_id || emulator}\n`
  : "DRY RUN — nothing will be deleted. Add --write to commit.\n");

// ── The editions, and which one we're working on ──────────────────
const editions = (await db.collection("bc_editions").get()).docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .sort((a, b) => (b.year || 0) - (a.year || 0));

if (!editionArg) {
  // No edition named: survey every one of them. Cheap (two collections each),
  // and it answers "did this happen anywhere else" without anybody having to
  // guess which years to check.
  console.log("edition            year   players  courses  cloned rows  created_from");
  for (const e of editions) {
    const rows = {};
    for (const col of CLONE_ID_COLLECTIONS) {
      rows[col] = (await db.collection(col).where("tournament_id", "==", e.id).get())
        .docs.map((d) => ({ id: d.id, ...d.data() }));
    }
    const batches = planCloneRemoval({ rows });
    const cloned = batches.reduce((n, b) => n + b.rows.length, 0);
    console.log(
      String(e.id).padEnd(19) +
      String(e.year ?? "").padEnd(7) +
      String(rows.bc_players.length).padEnd(9) +
      String(rows.bc_courses.length).padEnd(9) +
      (cloned ? `${cloned} in ${plural(batches.length, "batch", "batches")}` : "—").padEnd(13) +
      (e.created_from || "—"));
  }
  console.log("\nName one to see it in full:  node scripts/undo-clone.mjs --edition bc_2026");
  process.exit(0);
}

const edition = editions.find((e) => e.id === editionArg);
if (!edition) {
  die(`No edition \`${editionArg}\`. The ones that exist:`, "",
      ...editions.map((e) => `  ${e.id}`));
}

console.log(`${edition.id} · ${edition.name || "(unnamed)"} — ${edition.status || "no status"}`);
if (edition.created_from) {
  // Corroboration, not proof. A clone that landed here set this; an edition
  // legitimately cloned from elsewhere has it too. It is worth printing
  // because a self-clone (created_from === its own id) can only be the
  // collision, and that is the case this script exists for.
  console.log(edition.created_from === edition.id
    ? `  created_from: ${edition.created_from}  ← itself. A clone of this edition landed back inside it.`
    : `  created_from: ${edition.created_from}`);
}
console.log("");

// ── Everything in this tournament, and everything that could point at it ──
// listCollections() rather than a hardcoded list of tournament-scoped
// collections: a list here would have to track EDITION_DATA_COLS in
// lib/editions.js by hand, and the failure mode of it falling behind is
// deleting a roster row that a collection nobody remembered still references.
const all = await db.listCollections();
const rows = {};
const scan = [];
for (const c of all) {
  const docs = (await c.where("tournament_id", "==", edition.id).get()).docs;
  rows[c.id] = docs.map((d) => ({ id: d.id, ...d.data() }));
  for (const d of docs) scan.push({ col: c.id, id: d.id, doc: d.data() });
}
// Push tokens are a property of a DEVICE, not of an edition, so they carry no
// tournament_id and the query above cannot see them — but they are keyed by
// player_id, so a deleted roster row can strand one. Small collection; read it
// whole rather than not at all.
for (const d of (await db.collection("bc_notification_tokens").get()).docs) {
  scan.push({ col: "bc_notification_tokens", id: d.id, doc: d.data() });
}

const batches = planCloneRemoval({ rows, scan });
const originals = originalRows(rows);

if (!batches.length) {
  console.log("No cloned rows in this edition — every player and course id was minted by the app.");
  console.log(`  ${plural(originals.filter((r) => r.col === "bc_players").length, "player")}, ` +
              `${plural(originals.filter((r) => r.col === "bc_courses").length, "course")}.`);
  process.exit(0);
}

// ── The batches ───────────────────────────────────────────────────
const chosen = stampArg ? batches.filter((b) => b.stamp === stampArg) : batches;
if (stampArg && !chosen.length) {
  die(`No clone batch with stamp ${stampArg} in ${edition.id}. The ones there:`, "",
      ...batches.map((b) => `  ${b.stamp}  ${when(b.stamp)}  ${plural(b.rows.length, "row")}`));
}

console.log(`Left by the app itself: ${plural(originals.filter((r) => r.col === "bc_players").length, "player")}, ` +
            `${plural(originals.filter((r) => r.col === "bc_courses").length, "course")}.\n`);

for (const b of batches) {
  const selected = !stampArg || b.stamp === stampArg;
  console.log(`CLONE BATCH ${b.stamp} — ${when(b.stamp)}${selected ? "" : "   (not selected)"}`);
  for (const r of b.rows) {
    const label = r.row.name || r.row.first || "(no name)";
    console.log(`  ${r.col.replace("bc_", "").padEnd(8)} ${r.id.padEnd(24)} ${String(label).padEnd(22)}` +
      (r.safe ? "nothing points at it" : `HELD — ${plural(r.refs.length, "reference")}: ` +
        [...new Set(r.refs.map((x) => x.col))].join(", ")));
  }
  console.log(`  → ${plural(b.safeRows.length, "row")} deletable, ${b.heldRows.length} held.\n`);
}

// ── The sign-ins that ended up on two rows ────────────────────────
const dupes = duplicatedLogins(rows.bc_players || []);
if (dupes.length) {
  console.log(`${plural(dupes.length, "account")} on more than one roster row — the clone copies auth_uid,`);
  console.log("which is why the two rows are identical in Admin → Players (same name, same crown,");
  console.log("same link icon). Deleting the cloned row leaves the original signed in.\n");
  for (const d of dupes) {
    console.log(`  ${d.uid}`);
    for (const p of d.players) console.log(`    ${String(p.id).padEnd(24)} ${p.name || ""}`);
  }
  console.log("");
}

// ── What no undo can reach ────────────────────────────────────────
const roundCount = (rows.bc_rounds || []).length || 4;
const overwritable = overwritableDocIds(edition.id, roundCount);
const present = overwritable
  .map((o) => ({ ...o, row: (rows[o.col] || []).find((r) => r.id === o.id) }))
  .filter((o) => o.row);

if (present.length) {
  console.log("NOT REPAIRABLE — a clone merges these over in place, same id either way. There is");
  console.log("no second row to delete and no record of what they held first. Current values:\n");
  for (const o of present) {
    const d = o.row;
    const preview = o.col === "bc_settings"
      ? JSON.stringify(Object.fromEntries(Object.entries(d).filter(([k]) => !["id", "tournament_id"].includes(k))))
      : JSON.stringify({ course_id: d.course_id ?? null, format: d.format ?? null, date: d.date ?? null });
    console.log(`  ${o.key.padEnd(12)} ${preview.slice(0, 150)}`);
  }
  console.log("\n  Check these against what you set up, in Admin → Event and Admin → Rounds.\n");
}

// ── Delete ────────────────────────────────────────────────────────
const doomed = chosen.flatMap((b) => b.safeRows);
const held = chosen.flatMap((b) => b.heldRows);

if (!WRITE) {
  console.log(`--write would delete ${plural(doomed.length, "document")}` +
    (held.length ? `, and keep ${plural(held.length, "row")} something still points at.` : "."));
  if (batches.length > 1 && !stampArg) {
    console.log(`\n${plural(batches.length, "batch")} found. To take one at a time:`);
    console.log(`  node scripts/undo-clone.mjs --edition ${edition.id} --stamp ${batches[0].stamp} --write`);
  }
  process.exit(0);
}

if (!doomed.length) {
  die("Nothing to delete — every cloned row is still referenced. Nothing was written.", "",
      "Clear what points at them first, in the app, where what is being lost is on screen:",
      "a cloned COURSE is usually held by the round that was cloned alongside it (Admin →",
      "Rounds, pick the real course), and a cloned PLAYER by a match or a posted card.",
      "Then run this again.");
}

const BATCH = 400;   // 500 is Firestore's hard limit; 400 leaves room.
let done = 0;
for (let i = 0; i < doomed.length; i += BATCH) {
  const slice = doomed.slice(i, i + BATCH);
  const batch = db.batch();
  for (const r of slice) batch.delete(db.collection(r.col).doc(r.id));
  await batch.commit();
  done += slice.length;
  process.stdout.write(`\r${done}/${doomed.length} documents…`);
}

console.log(`\rDeleted ${plural(done, "document")} from ${edition.id}.` + " ".repeat(20));
if (held.length) {
  console.log(`Kept ${plural(held.length, "row")} something still points at — named above. Clear the`);
  console.log("reference in the app (a round's course, a match, a posted card) and run this again.");
}
console.log("\nOpen the edition in the app and check the roster before doing anything else with it.");
