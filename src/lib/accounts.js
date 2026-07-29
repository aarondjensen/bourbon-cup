// ══════════════════════════════════════════════════════════════════
//  accounts — which Google/Apple account is which player.
// ══════════════════════════════════════════════════════════════════
//
// Signing in (lib/auth.js) answers "who owns this phone". It cannot answer
// "which name on the roster is that", because nothing in a Google account
// knows about a golf tournament. Something has to make that link once, and
// the cheapest thing that works is the screen the app already had: after
// signing in, a player taps their own name out of the roster exactly once,
// and that pairing is remembered from then on.
//
// ── Where the link is stored ──────────────────────────────────────
// On the ROSTER document (bc_players), as `auth_uid` plus a couple of
// descriptive fields. The alternative — a separate accounts collection
// keyed by uid — was rejected for two reasons:
//
//   • The roster is already subscribed to by every client, so "is this
//     name taken" needs no extra read, and the claim screen can grey out
//     the eleven names that are not yours.
//   • Editions clone their roster (lib/editions.js), so next year's
//     tournament starts with everybody still linked, instead of twelve
//     people re-claiming their own names on the first tee.
//
// The uid is the key, never the email: Apple's Hide My Email hands us a
// per-app relay address, and people change their Google address. The email
// is stored alongside it purely so the director can see, in Admin, whose
// account is attached to a name.
import { db } from "../firebase";

// The fields this module owns on a player document. Grouped so the admin
// unlink and the claim write cannot drift apart.
export const AUTH_FIELDS = ["auth_uid", "auth_email", "auth_provider", "auth_linked_at"];

// Has anybody claimed this roster spot?
export const isClaimed = (p) => !!p?.auth_uid;

// The player this account has claimed, or null if it has claimed none yet.
// A uid appearing on two documents would be a director editing the roster
// by hand; taking the first keeps that survivable rather than fatal.
export const linkedPlayer = (players, uid) =>
  (uid && (players || []).find((p) => p.auth_uid === uid)) || null;

// What to show the director next to a name in Admin.
export const accountLabel = (p) =>
  !isClaimed(p) ? null : (p.auth_email || `${p.auth_provider || "account"} sign-in`);

// The patch that severs the link, for the director's unlink button. Nulls
// rather than deleted keys: `db.upsert` merges, so a missing key would
// leave the old value in place — the exact opposite of what unlink means.
export const unlinkPatch = () => ({
  auth_uid: null, auth_email: null, auth_provider: null, auth_linked_at: null,
});

// ── Claiming a name ─────────────────────────────────────────────────
// Writes only the auth fields (the upsert merges) so a claim can never
// stomp an edit the director is making to the same player at the same
// moment — a real possibility on setup night.
//
// The re-read first is not paranoia about a determined attacker; the rules
// cannot express "only if unclaimed" without making the director's own
// roster edits illegal, so this is a client check either way. It is here
// to catch the ordinary version: two people looking at the same stale
// roster on a bad signal, both tapping the same name. Whoever writes
// first keeps it, and the second gets told rather than silently taking it
// over.
export async function claimPlayer(player, authUser) {
  if (!player?.player_id) return { ok: false, error: "No player selected." };
  if (!authUser?.uid) return { ok: false, error: "Not signed in." };

  const fresh = (await db.get("bc_players", [{ field: "id", op: "==", value: player.player_id }]))[0];
  const current = fresh || player;
  if (isClaimed(current) && current.auth_uid !== authUser.uid) {
    return { ok: false, error: `${current.name} is already claimed by another account. Ask the director to unlink it.` };
  }

  const saved = await db.upsert("bc_players", {
    id: player.player_id,
    auth_uid: authUser.uid,
    auth_email: authUser.email || null,
    auth_provider: authUser.provider || null,
    auth_linked_at: new Date().toISOString(),
  });
  if (!saved) return { ok: false, error: "Could not save that — check signal and try again." };
  return { ok: true, player: { ...current, ...saved } };
}
