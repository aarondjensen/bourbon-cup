// ══════════════════════════════════════════════════════════════════
//  send-push — one push, of any type, to one player's devices.
// ══════════════════════════════════════════════════════════════════
//
// The Notifications page's "Send a test notification" button can only send
// `type: "test"`, and type is what the service worker branches on. So the
// one thing that button cannot exercise is the badge: only `attest_ready`
// increments it (see the BADGE MODEL note at the top of
// public/firebase-messaging-sw.js). Testing that path used to mean signing
// a real card in a real match, which means a match, a round and a second
// player who is not you.
//
// This sends the message the Cloud Function would have sent, without the
// card. Same shape as sendToPlayer in functions/index.js: DATA-ONLY, every
// value stringified, TTL an hour, urgency high.
//
// ── Running it ────────────────────────────────────────────────────
// Dry run is the DEFAULT — it resolves the player and lists their devices
// and prints the message, and sends nothing until --send:
//
//   node scripts/send-push.mjs --list
//   node scripts/send-push.mjs --player bc_player_1712...
//   node scripts/send-push.mjs --player bc_player_1712... --send
//   node scripts/send-push.mjs --player bc_player_1712... --type card_final --send
//
// --list is the way to find a player id: it prints everyone who has a
// device registered, which is a much shorter list than the roster.
//
// Credentials, same as import-history: the ADMIN SDK, pointed at a
// service-account key from Firebase Console → Project Settings → Service
// accounts → Generate new private key. Do not commit it. firebase-admin is
// not a dependency of the app, so install it for the run
// (`npm i --no-save firebase-admin`) or run this from functions/.
//
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
//   node scripts/send-push.mjs --player bc_player_1712... --send
//
// ── What it will not do ───────────────────────────────────────────
// There is no --all. This exists to buzz your own phone while you watch it,
// and a one-key mistake that buzzes sixteen people during a round is not a
// mistake this tool needs to be capable of. Broadcasting is the Cloud
// Functions' job, from a real event.
//
// It also does not delete stale tokens the way sendToPlayer does. Cleanup
// on rejection belongs to the thing that sends for real; a debugging tool
// that quietly unsubscribes a device you were trying to debug is worse than
// one that prints the error and leaves the row alone.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const TOKENS_COL = "bc_notification_tokens";
const PLAYERS_COL = "bc_players";

// The types the service worker knows. Anything else reaches it and falls
// through to a plain notification with no badge and the default tap target,
// which is a real thing to want to check — hence a warning, not a refusal.
const KNOWN_TYPES = ["attest_ready", "card_final", "round_final", "test"];

// What each type says. Copied from functions/index.js rather than imported:
// that file is CommonJS, loads firebase-functions at import time, and is
// deployed as its own package. A divergence here costs a slightly wrong
// preview line in a debugging tool; wiring the two together to prevent that
// costs a build step.
const MESSAGES = {
  attest_ready: (o) => ({
    title: "Time to attest your card",
    body: `${o.signer} signed your Round ${o.round} card — open Scoring to attest it.`,
    data: { type: "attest_ready", round: o.round, match_id: o.matchId, tournament_id: o.tournament, url: "/#scoring" },
  }),
  card_final: (o) => ({
    title: "Card is final",
    body: `Your Round ${o.round} card is signed and attested by everyone.`,
    data: { type: "card_final", round: o.round, match_id: o.matchId, tournament_id: o.tournament, url: "/#scoring" },
  }),
  round_final: (o) => ({
    title: `Round ${o.round} is final`,
    body: "Handicaps and results are frozen — the leaderboard is up to date.",
    data: { type: "round_final", round: o.round, tournament_id: o.tournament, url: "/#leaderboard" },
  }),
  test: () => ({
    title: "The Bourbon Cup",
    body: "Notifications are working on this device.",
    data: { type: "test", url: "/" },
  }),
};

// ── Arguments ───────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

const args = {
  list: flag("list"),
  send: flag("send"),
  player: opt("player"),
  type: opt("type", "attest_ready"),
  round: opt("round", "1"),
  matchId: opt("match", "dev_match"),
  tournament: opt("tournament", "bc_2025"),
  signer: opt("signer", "Somebody"),
};

if (flag("help") || (!args.list && !args.player)) {
  console.log(`
  send-push — one push, of any type, to one player's devices.

    --list                    who has a device registered
    --player <player_id>      required to send; from --list
    --type <type>             ${KNOWN_TYPES.join(" | ")}   (default attest_ready)
    --round <n>               round number in the message (default 1)
    --match <id>              match_id in the data block (default dev_match)
    --tournament <id>         tournament_id in the data block (default bc_2025)
    --signer <name>           who "signed" it, for attest_ready (default Somebody)
    --send                    actually send. Without it, nothing leaves.

  GOOGLE_APPLICATION_CREDENTIALS must point at a service-account key.
`);
  process.exit(0);
}

// ── Admin SDK ───────────────────────────────────────────────────────
let admin;
try {
  admin = require("firebase-admin");
} catch {
  console.error("firebase-admin is not installed. Run: npm i --no-save firebase-admin");
  process.exit(1);
}

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error("GOOGLE_APPLICATION_CREDENTIALS is not set — point it at a service-account key.");
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();
const messaging = admin.messaging();

// ── --list ──────────────────────────────────────────────────────────
const listDevices = async () => {
  const snap = await db.collection(TOKENS_COL).get();
  if (snap.empty) {
    console.log("No devices registered at all. Turn notifications on in ☰ → Notifications first.");
    return;
  }
  // One roster read rather than one per token: a player id appears once per
  // device and the same name would be fetched three times for a phone, a
  // laptop and an iPad.
  const names = new Map();
  const players = await db.collection(PLAYERS_COL).get();
  for (const d of players.docs) {
    const p = d.data();
    if (p.player_id && !names.has(p.player_id)) names.set(p.player_id, p.name || "?");
  }

  const byPlayer = new Map();
  for (const d of snap.docs) {
    const t = d.data();
    if (!byPlayer.has(t.player_id)) byPlayer.set(t.player_id, []);
    byPlayer.get(t.player_id).push(t);
  }

  console.log(`\n  ${byPlayer.size} player(s) with ${snap.size} device(s):\n`);
  for (const [pid, tokens] of byPlayer) {
    console.log(`  ${names.get(pid) || "(not on any roster)"}  —  ${pid}`);
    for (const t of tokens) {
      const kind = t.is_ios ? (t.is_standalone ? "iOS PWA" : "iOS Safari (no push)") : "browser";
      console.log(`      ${kind}  ·  registered ${new Date(t.registered_at || 0).toISOString().slice(0, 10)}`);
    }
  }
  console.log("");
};

// ── The send ────────────────────────────────────────────────────────
const send = async () => {
  if (!KNOWN_TYPES.includes(args.type)) {
    console.warn(`  ! "${args.type}" is not a type the service worker knows — expect no badge and a default tap target.`);
  }

  const build = MESSAGES[args.type] || (() => ({
    title: "The Bourbon Cup",
    body: `Unrecognized type: ${args.type}`,
    data: { type: args.type, url: "/" },
  }));
  const payload = build(args);

  // Every value in an FCM data block must be a string — a number silently
  // fails the whole send rather than being coerced. Same rule, and the same
  // null-stripping, as sendToPlayer.
  const data = {
    ...Object.fromEntries(
      Object.entries(payload.data)
        .filter(([, v]) => v != null)
        .map(([k, v]) => [k, String(v)])
    ),
    title: payload.title,
    body: payload.body,
  };

  const snap = await db.collection(TOKENS_COL).where("player_id", "==", args.player).get();
  if (snap.empty) {
    console.error(`\n  No devices registered for ${args.player}. Try --list.\n`);
    process.exit(1);
  }

  console.log(`\n  to:      ${args.player}  (${snap.size} device(s))`);
  console.log(`  title:   ${payload.title}`);
  console.log(`  body:    ${payload.body}`);
  console.log(`  data:    ${JSON.stringify(data)}`);
  console.log(`  badge:   ${args.type === "attest_ready" ? "+1 (background only)" : "unchanged"}`);

  if (!args.send) {
    console.log(`\n  DRY RUN — nothing sent. Add --send.\n`);
    return;
  }

  let sent = 0, failed = 0;
  for (const doc of snap.docs) {
    const token = doc.data().token;
    if (!token) continue;
    try {
      await messaging.send({
        token,
        data,
        webpush: { headers: { TTL: "3600", Urgency: "high" } },
      });
      sent++;
    } catch (err) {
      failed++;
      const code = err?.errorInfo?.code || err?.code || "unknown";
      console.error(`  ✗ ${doc.id}: ${code} — ${err?.errorInfo?.message || err?.message || err}`);
    }
  }
  console.log(`\n  sent ${sent}, failed ${failed}\n`);
  if (sent && args.type === "attest_ready") {
    console.log("  The badge only moves if the app was CLOSED or BACKGROUNDED when this");
    console.log("  landed — a foreground push goes to onMessage, which does not badge.");
    console.log("  Opening the app clears it again: syncAppBadge reconciles to the real");
    console.log("  number of outstanding attestations, which for a fake card is zero.\n");
  }
};

// ── Go ──────────────────────────────────────────────────────────────
try {
  if (args.list) await listDevices();
  else await send();
  process.exit(0);
} catch (err) {
  console.error("\n  Failed:", err?.message || err, "\n");
  process.exit(1);
}
