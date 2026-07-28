// ══════════════════════════════════════════════════════════════════
//  functions/index.js — push notifications for The Bourbon Cup
// ══════════════════════════════════════════════════════════════════
//
// Ported from the MnQ golf league app's Cloud Functions, which have run a
// season of this. Three Firestore triggers and one callable:
//
//   onCardSigned    → "Time to attest your card"   (to the non-signers)
//   onCardAttested  → "Your card is final"         (to the whole match)
//   onRoundFinal    → "Round N is final"           (to everyone)
//   sendTestPush    → callable, from the Notifications page
//
// Deploy:  firebase deploy --only functions
// (from the repo root; firebase.json points the "functions" source here.)
//
// ── Why onDocumentWritten everywhere ────────────────────────────────
// It is the only trigger that hands you BOTH the before and after state,
// which is what makes transition detection possible: fire when `attested`
// goes false→true, not on every save of an already-attested card. Without
// that, one director editing a settled round re-notifies the whole field.
//
// ── Editions ────────────────────────────────────────────────────────
// Unlike MnQ, which has one league and hardcodes its id, this app runs
// several editions side by side in one project (bc_2025, bc_2026, …). So
// nothing here hardcodes a tournament: every trigger reads `tournament_id`
// off the document that fired it and scopes its own lookups to that. A
// notification about a card in bc_2026 can never be addressed using
// bc_2025's roster.
//
// Push TOKENS are the deliberate exception — they are keyed by player and
// device, not by edition, because a phone's subscription is not a property
// of a tournament year. See src/lib/notifications.js.
//
// ── Message format ──────────────────────────────────────────────────
// DATA-ONLY. Title and body ride in the data block and the service worker
// renders them (see public/firebase-messaging-sw.js for why: it is the one
// format that lets the worker decide about badges and tap targets, and it
// is the most reliable delivery to an installed iOS PWA).

const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");

admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();

const TOKENS_COL = "bc_notification_tokens";

// ── Send to one player, across every device they have registered ────
// Stale tokens are deleted as they are discovered. FCM is the only thing
// that knows a browser has been wiped or a PWA uninstalled, and it only
// tells you by rejecting a send — so this is the only place the cleanup
// can happen, and skipping it means retrying dead devices forever.
async function sendToPlayer(playerId, payload) {
  if (!playerId) return { sent: 0, failed: 0, cleaned: 0, errors: ["missing_playerId"] };

  let snap;
  try {
    snap = await db.collection(TOKENS_COL).where("player_id", "==", playerId).get();
  } catch (err) {
    logger.error("token query failed", { playerId, err: err?.message });
    throw new HttpsError("internal", `Firestore query failed: ${err?.message || err}`);
  }
  if (snap.empty) return { sent: 0, failed: 0, cleaned: 0, errors: ["no_tokens_registered"] };

  // Every value in an FCM data block must be a string — a number silently
  // fails the whole send rather than being coerced.
  const data = {
    ...Object.fromEntries(
      Object.entries(payload.data || {})
        .filter(([, v]) => v != null)
        .map(([k, v]) => [k, String(v)])
    ),
    title: payload.title || "The Bourbon Cup",
    body: payload.body || "",
  };

  let sent = 0, failed = 0, cleaned = 0;
  const errors = [];

  for (const doc of snap.docs) {
    const token = doc.data().token;
    if (!token) continue;
    try {
      await messaging.send({
        token,
        data,
        // TTL an hour: a "time to attest" that arrives the next morning is
        // worse than one that never arrives. Urgency high so a dozing
        // phone wakes for it.
        webpush: { headers: { TTL: "3600", Urgency: "high" } },
      });
      sent++;
      try { await doc.ref.update({ last_seen_at: Date.now() }); } catch { /* swallow */ }
    } catch (err) {
      failed++;
      const code = err?.errorInfo?.code || err?.code || "unknown";
      errors.push(`${code}: ${err?.errorInfo?.message || err?.message || String(err)}`);
      logger.error("messaging.send failed", { playerId, docId: doc.id, code });
      const stale =
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token" ||
        code === "messaging/invalid-argument";
      if (stale) {
        try { await doc.ref.delete(); cleaned++; } catch { /* swallow */ }
      }
    }
  }
  return { sent, failed, cleaned, errors };
}

// Fan out, and log once for the whole fan rather than once per player —
// a per-player log line for a twenty-person field buries the one that
// actually failed.
async function broadcast(recipients, payload, label) {
  let sent = 0, failed = 0;
  const problems = {};
  for (const pid of [...new Set(recipients)].filter(Boolean)) {
    try {
      const r = await sendToPlayer(pid, payload);
      sent += r.sent; failed += r.failed;
      // "No tokens" is the normal state for anyone who never turned push
      // on. It is not a problem and must not read as one.
      if (r.errors.length && !r.errors.every(e => e === "no_tokens_registered")) problems[pid] = r.errors;
    } catch (e) {
      problems[pid] = [e?.message || String(e)];
    }
  }
  logger.info(`${label} broadcast complete`, {
    recipients: recipients.length, sent, failed, problemPlayers: Object.keys(problems),
  });
  return { sent, failed };
}

// ── Helpers ─────────────────────────────────────────────────────────
// The four players in a match, from the match document. Matches store
// teamA / teamB as arrays of player ids (see src/lib/groups matchPlayers),
// so this is that same function on the server.
async function matchPlayerIds(matchId) {
  if (!matchId) return [];
  try {
    const snap = await db.collection("bc_matches").doc(String(matchId)).get();
    if (!snap.exists) return [];
    const m = snap.data();
    return [...(m.teamA || []), ...(m.teamB || [])].filter(Boolean);
  } catch (e) {
    logger.warn("matchPlayerIds failed", { matchId, err: e?.message });
    return [];
  }
}

// Everyone in one edition. Used only by the round-final broadcast, which is
// genuinely tournament-wide.
async function allPlayerIds(tournamentId) {
  try {
    const snap = await db.collection("bc_players")
      .where("tournament_id", "==", tournamentId).get();
    return snap.docs.map(d => d.data().player_id).filter(Boolean);
  } catch (e) {
    logger.warn("allPlayerIds failed", { tournamentId, err: e?.message });
    return [];
  }
}

const nameOf = async (playerId) => {
  if (!playerId) return "Someone";
  try {
    const snap = await db.collection("bc_players").where("player_id", "==", playerId).limit(1).get();
    return snap.empty ? "Someone" : (snap.docs[0].data().name || "Someone");
  } catch { return "Someone"; }
};

// ═══════════════════════════════════════════════════════════════════
//  TRIGGER 1 — a card was signed → the others need to attest
// ═══════════════════════════════════════════════════════════════════
// Fires on the CREATE of a bc_card_sigs document. A create is a signature;
// the updates that follow are attestations arriving one at a time, and
// re-firing on those would push "time to attest" at the very people who
// just did, over and over.
//
// Recipients are the match's players minus the signer and minus anyone who
// has somehow already attested. A card that auto-attested at signing time
// (a match with nobody else in it) has no recipients and sends nothing.
exports.onCardSigned = onDocumentWritten("bc_card_sigs/{docId}", async (event) => {
  try {
    const before = event.data.before?.exists ? event.data.before.data() : null;
    const after = event.data.after?.exists ? event.data.after.data() : null;
    if (!after || before) return;   // CREATE only

    const { match_id, round_number, signed_by, attested_by = [], tournament_id } = after;
    if (!match_id || !signed_by) {
      logger.warn("onCardSigned: incomplete document", { docId: event.params.docId, match_id, signed_by });
      return;
    }

    const pids = await matchPlayerIds(match_id);
    const recipients = pids.filter(pid => pid !== signed_by && !attested_by.includes(pid));
    if (!recipients.length) {
      logger.info("onCardSigned: nobody to notify", { match_id, round_number });
      return;
    }

    const signer = await nameOf(signed_by);
    await broadcast(recipients, {
      title: "Time to attest your card",
      body: `${signer} signed your Round ${round_number} card — open Scoring to attest it.`,
      data: { type: "attest_ready", round: round_number, match_id, tournament_id, url: "/#scoring" },
    }, "attest_ready");
  } catch (err) {
    logger.error("onCardSigned error", { err: err?.message, stack: err?.stack?.slice(0, 500) });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  TRIGGER 2 — the last attestation landed → the card is final
// ═══════════════════════════════════════════════════════════════════
// The transition that matters is `attested` false→true, which happens
// exactly once per card. Everyone in the match hears about it, the signer
// included: they are the one person who has been waiting on it.
//
// Not sent for a card the director force-attested. That is a housekeeping
// action taken because the players had already left, and telling four
// people their card is final is only useful when one of them did it.
exports.onCardAttested = onDocumentWritten("bc_card_sigs/{docId}", async (event) => {
  try {
    const before = event.data.before?.exists ? event.data.before.data() : null;
    const after = event.data.after?.exists ? event.data.after.data() : null;
    if (!after) return;
    if (after.attested !== true) return;
    if (before?.attested === true) return;          // already final; not a transition
    if (after.attested_forced_at) return;           // director housekeeping, not news

    const { match_id, round_number, tournament_id } = after;
    const pids = await matchPlayerIds(match_id);
    if (!pids.length) return;

    await broadcast(pids, {
      title: "Card is final",
      body: `Your Round ${round_number} card is signed and attested by everyone.`,
      data: { type: "card_final", round: round_number, match_id, tournament_id, url: "/#scoring" },
    }, "card_final");
  } catch (err) {
    logger.error("onCardAttested error", { err: err?.message, stack: err?.stack?.slice(0, 500) });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  TRIGGER 3 — the director finalized a round
// ═══════════════════════════════════════════════════════════════════
// bc_round_locks carries the round gate (see src/lib/roundLocks): `locked`
// means the handicaps are frozen, `final` means the round is over and the
// next one is open on every device. The false→true edge on `final` is the
// one moment the whole field needs to hear about, and it is the moment
// scoring moves out from under them.
exports.onRoundFinal = onDocumentWritten("bc_round_locks/{docId}", async (event) => {
  try {
    const before = event.data.before?.exists ? event.data.before.data() : null;
    const after = event.data.after?.exists ? event.data.after.data() : null;
    if (!after) return;
    if (after.final !== true) return;
    if (before?.final === true) return;             // re-save of an already-final round

    const { round_number, tournament_id } = after;
    if (!tournament_id) {
      logger.warn("onRoundFinal: no tournament_id, cannot resolve a roster", { docId: event.params.docId });
      return;
    }

    const pids = await allPlayerIds(tournament_id);
    if (!pids.length) return;

    await broadcast(pids, {
      title: `Round ${round_number} is final`,
      body: "Handicaps and results are frozen — the leaderboard is up to date.",
      data: { type: "round_final", round: round_number, tournament_id, url: "/#leaderboard" },
    }, "round_final");
  } catch (err) {
    logger.error("onRoundFinal error", { err: err?.message, stack: err?.stack?.slice(0, 500) });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  CALLABLE — send myself a test
// ═══════════════════════════════════════════════════════════════════
// The Notifications page's "send a test" button. Worth having: the failure
// modes for iOS PWA push are numerous and all of them look identical from
// the settings screen (a toggle that says On). This is the only way for a
// player to find out before it matters that their phone is not actually
// going to buzz.
//
// It sends only to the player id it is given, and the worst it can do is
// notify someone else's phone once — which is the same power anyone with
// the app already has by signing a card.
exports.sendTestPush = onCall(async (request) => {
  const playerId = request.data?.playerId;
  if (!playerId) throw new HttpsError("invalid-argument", "playerId is required");

  const result = await sendToPlayer(playerId, {
    title: "The Bourbon Cup",
    body: "Notifications are working on this device.",
    data: { type: "test", url: "/" },
  });
  logger.info("sendTestPush", { playerId, ...result });
  return result;
});
