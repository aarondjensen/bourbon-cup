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
//
// ── The door in front of all of this ──────────────────────────────
// Signing in is free — anybody with a Google account can do it, and the
// app's Firebase config ships in the bundle. So between signing in and
// touching anything, an account has to present the tournament password and
// be issued a MEMBERSHIP: a bc_accounts/{uid} document.
//
// The password is checked by the security rules, not here. It lives in
// bc_secrets/access, which only a director may read — rules can `get()` a
// document the reader is denied, which is what lets them compare against
// it either way — and the rules also gate every write in the project on
// the membership document existing. That is the difference between a
// password and a doorman: the check survives someone reading the bundle,
// disabling the JavaScript, or talking to Firestore directly.
//
// What this file can do is ask ("create my membership, here is the code")
// and read the answer. A rejection comes back as permission-denied, which
// means exactly one thing here: wrong password.
import { db } from "../firebase";

// The fields this module owns on a player document. Grouped so the admin
// unlink and the claim write cannot drift apart.
export const AUTH_FIELDS = ["auth_uid", "auth_email", "auth_provider", "auth_linked_at"];

// One membership document per account, keyed BY the uid so the rules can
// check `exists(.../bc_accounts/$(request.auth.uid))` in one hop. (The
// roster cannot be keyed that way — a player exists before their account
// does — which is why the uid lives in a field there and a doc id here.)
export const ACCOUNTS_COL = "bc_accounts";
// The password itself. Read-denied to every client; only the rules see it.
export const SECRETS_COL = "bc_secrets";
export const ACCESS_DOC = "access";

// ── Is this account through the door, and who is it? ────────────────
// Returns the membership document, or null for "signed in, not a member".
// Errors are NOT caught: a failed read is not the same answer as "no
// membership", and treating a dropped connection as a locked door would
// put the password screen in front of somebody who is already through it,
// on the first tee, with no signal.
//
// The document also carries `is_director`, which is the only thing in the
// project that grants Admin. Nobody can set it on themselves — the rules
// reject a create that carries it, and an update to your own — so it comes
// either from another director (setDirector below) or from the console,
// which is where the first one has to come from. The app reads it here
// rather than trusting the roster's crown, so the Admin tab can never
// appear for somebody whose writes would be refused.
export async function readMembership(uid) {
  if (!uid) return null;
  return await db.getById(ACCOUNTS_COL, uid);
}

export const isDirectorAccount = (membership) => membership?.is_director === true;

// ── Presenting the password ─────────────────────────────────────────
// The code travels as a field on the membership document because that is
// the only channel the rules can see — they compare it against the secret
// and reject the write outright if it differs. It stays on the document
// afterwards, readable by this account alone, which is the person who
// typed it in the first place.
export async function joinWithCode(authUser, code) {
  if (!authUser?.uid) return { ok: false, error: "Not signed in." };
  try {
    // Already through? Say so and write nothing. This is not just an
    // optimisation: the rules deny UPDATE on a membership document, so a
    // second create by somebody who already has one would come back as
    // permission-denied and be reported below as a wrong password. It is
    // also the recovery path when the startup check could not reach the
    // network and fell through to this screen.
    if (await db.getById(ACCOUNTS_COL, authUser.uid)) return { ok: true };
    await db.create(ACCOUNTS_COL, {
      id: authUser.uid,
      uid: authUser.uid,
      code: (code || "").trim(),
      email: authUser.email || null,
      joined_at: new Date().toISOString(),
    });
    return { ok: true };
  } catch (e) {
    if (e?.code === "permission-denied") {
      return { ok: false, error: "That password isn't right." };
    }
    return { ok: false, error: "Could not check that — check signal and try again." };
  }
}

// ── Appointing a director ───────────────────────────────────────────
// Writes the one field the rules honour, on somebody else's membership.
// Refused unless you are a director already, and refused outright on your
// own document — nobody appoints themselves, and nobody can step down from
// inside the app, which is what keeps the set of directors from being
// emptied by mistake.
//
// The target must have signed in and been through the password screen: the
// flag lives on a membership document, and there is nothing to flag until
// one exists. The caller checks that first so it can say so; this reports
// what the database said if it slips through anyway.
export async function setDirector(uid, on) {
  if (!uid) return { ok: false, error: "That player hasn't signed in yet." };
  try {
    await db.upsertStrict(ACCOUNTS_COL, uid, { is_director: !!on });
    return { ok: true };
  } catch (e) {
    if (e?.code === "permission-denied") {
      return { ok: false, error: "Only a director can do that, and not to their own account." };
    }
    return { ok: false, error: "Could not save that — check signal and try again." };
  }
}

// Every membership, for a director's Admin screen — the roster's crown is
// drawn from these rather than from a field on the roster, so what is on
// screen is what the rules will honour. A non-director cannot read this;
// the rules allow the listing only for a director.
export const membershipFor = (memberships, player) =>
  (player?.auth_uid && (memberships || []).find(m => m.uid === player.auth_uid)) || null;

export const playerIsDirector = (memberships, player) =>
  membershipFor(memberships, player)?.is_director === true;

// ── Reading the password back ───────────────────────────────────────
// Members only, enforced by the rules — a stranger who could read this
// would not need to be told the password at all. Returns null when none is
// set, which is the same thing the door means by "open".
export async function readAccessCode() {
  try { return (await db.getById(SECRETS_COL, ACCESS_DOC))?.code || null; }
  catch { return null; }
}

// ── Setting the password ────────────────────────────────────────────
// Saving an empty value removes the requirement — the rules treat a blank
// or missing code as an open door, which is also what makes the very first
// setup possible before any code exists.
export async function setAccessCode(code) {
  try {
    await db.create(SECRETS_COL, { id: ACCESS_DOC, code: (code || "").trim() || null });
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the password." };
  }
}

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
