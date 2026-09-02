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
import { db, TOURNAMENT_ID, writeFailure } from "../firebase";
import { bestEffort } from "./bestEffort";
import { isEditionLocked, isDemoEdition } from "./editionLock";

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
// Deployed rules that predate this build have no bc_accounts rule at all,
// so they refuse every request against it — including the read below,
// before any password is compared. Reported as a wrong password, that
// sends the tournament director hunting for a typo in a code that was
// never the problem. It is worth its own message.
const STALE_RULES =
  "The database rules are out of date, so this can't be checked yet — nothing to do with the password. " +
  "Tell the tournament director to re-publish firestore.rules.";

export async function joinWithCode(authUser, code) {
  if (!authUser?.uid) return { ok: false, error: "Not signed in." };
  try {
    // Already through? Say so and write nothing. This is not just an
    // optimisation: the rules deny UPDATE on a membership document, so a
    // second create by somebody who already has one would come back as
    // permission-denied and be reported below as a wrong password. It is
    // also the recovery path when the startup check could not reach the
    // network and fell through to this screen.
    //
    // A DENIAL here is never about the code — this read is allowed to
    // anybody asking after their own membership — so it is caught
    // separately rather than falling into the catch below.
    try {
      if (await db.getById(ACCOUNTS_COL, authUser.uid)) return { ok: true };
    } catch (e) {
      if (e?.code === "permission-denied") return { ok: false, error: STALE_RULES };
      throw e;
    }
    // ── Two codes, and the client cannot tell them apart ──────────
    // There is a second code for store reviewers (see demoAccessCode in
    // firestore.rules). It mints a membership stamped `demo_only`, which
    // the rules confine to demo editions — so somebody who reads it off a
    // store form gets a sandbox rather than the cup.
    //
    // This file cannot know which one was typed: bc_secrets is unreadable
    // to every client, which is the whole point of it. So it asks for an
    // ordinary membership first and retries stamped only if that is
    // refused. A player pays one write; a reviewer pays two, and neither
    // learns anything about the other's code.
    //
    // The order matters. Asking stamped-first would hand every player a
    // demo_only membership whenever both codes were somehow equal, and
    // they would find out on the first tee.
    const base = {
      id: authUser.uid,
      uid: authUser.uid,
      code: (code || "").trim(),
      email: authUser.email || null,
      joined_at: new Date().toISOString(),
    };
    try {
      await db.create(ACCOUNTS_COL, base);
      return { ok: true };
    } catch (e) {
      if (e?.code !== "permission-denied") throw e;
      // Wrong tournament code — or the reviewer's, which is refused by the
      // same rule for the same reason: it may not mint an ordinary one.
      await db.create(ACCOUNTS_COL, { ...base, demo_only: true });
      return { ok: true, demoOnly: true };
    }
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
// Matched on the document id first, then a `uid` field. Both are the same
// value for a membership the app created; a membership typed into the
// Firebase console by hand — which is how the FIRST director is made — may
// only have the id.
export const membershipFor = (memberships, player) => {
  const uid = player?.auth_uid;
  if (!uid) return null;
  return (memberships || []).find(m => m.id === uid || m.uid === uid) || null;
};

// A director can always see their own membership, so an empty list means
// the read was refused, not that nobody has signed in. In practice that is
// one thing: rules older than this build, which have no clause letting a
// director list the collection.
export const accountsUnreadable = (memberships) => (memberships || []).length === 0;

export const playerIsDirector = (memberships, player) =>
  membershipFor(memberships, player)?.is_director === true;

// ── Reading the password back ───────────────────────────────────────
// Directors only, enforced by the rules — a stranger who could read this
// would not need to be told the password at all.
//
// Three answers, and the third is why this does not just return a string.
// "No password set" and "I was not allowed to look" are the same absence
// to a caller that swallows the error, and they are opposite instructions
// to the director reading the screen: one says the door is open, the other
// says the rules need re-publishing. This is also the screen somebody
// reaches for while debugging a password that will not work, which is
// exactly the wrong moment to be told a comforting lie.
export async function readAccessCode() {
  try {
    const doc = await db.getById(SECRETS_COL, ACCESS_DOC);
    return { ok: true, code: doc?.code || null, demoCode: doc?.demo_code || null };
  } catch (e) {
    if (e?.code === "permission-denied") {
      return { ok: false, error: "Can't read it — the rules deployed to Firebase are older than this app. Re-publish firestore.rules." };
    }
    return { ok: false, error: "Couldn't read it — check signal and try again." };
  }
}

// ── Setting the password ────────────────────────────────────────────
// Saving an empty value removes the requirement — the rules treat a blank
// or missing code as an open door, which is also what makes the very first
// setup possible before any code exists.
export async function setAccessCode(code) {
  try {
    // MERGED, not replaced. `db.create` overwrites the whole document, and
    // this one now carries a second field — the reviewer code — that a
    // director changing the tournament password has no reason to be
    // thinking about. Replacing here would delete it silently, and the
    // symptom would arrive weeks later as a store review that cannot get in.
    await db.upsert(SECRETS_COL, { id: ACCESS_DOC, code: (code || "").trim() || null }, { loud: true });
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the password." };
  }
}

// ── The reviewer's code ─────────────────────────────────────────────
// Same document, different field, and the same merge discipline in reverse.
// Blank removes it, which closes that door entirely rather than opening it:
// demoCodeOK() in the rules fails on a missing or empty value, unlike the
// tournament code whose blank is the bootstrap.
export async function setDemoAccessCode(code) {
  try {
    await db.upsert(SECRETS_COL, { id: ACCESS_DOC, demo_code: (code || "").trim() || null }, { loud: true });
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the reviewer code." };
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

// ── Deleting an account ─────────────────────────────────────────────
// App Store review guideline 5.1.1(v): an app that lets you create an
// account has to let you delete it from inside the app, without emailing
// anybody. Now that signing in is real, so is that obligation.
//
// ── Why this is a Cloud Function and not four writes from here ─────
// Because the security rules deny every one of them, deliberately:
//
//   • bc_accounts — `delete: if false` for all clients. A client that could
//     delete its own membership is one loosened rule away from deleting
//     somebody else's, so revocation was left to the console.
//   • bc_players — director-only, apart from the one narrow claim update,
//     and even that cannot be used to UNCLAIM: the rule requires the
//     written auth_uid to equal the caller's, so writing null is refused.
//   • the Firebase Auth user — a client can only delete its own, and that
//     path additionally demands a recent login.
//
// Loosening any of those to let a phone do it would trade a real guarantee
// for a convenience. The admin SDK bypasses rules by design, which makes a
// callable the honest place for this: one authenticated entry point that
// does the whole thing, and takes NO uid argument — it acts on the caller's
// own uid and nothing else. See functions/index.js.
//
// ── What goes, and what does not ──────────────────────────────────
// GONE: the Firebase Auth user (nothing signs in as it again), the
// membership document (the thing every write in the project is gated on),
// the auth_* fields on every roster row that pointed at it — including the
// email, the only personal identifier the roster holds — and every push
// token registered to those player ids.
//
// STAYS: the roster row itself, and with it the name, handicap, scores,
// signed cards and matches. That is not a hedge — since sign-in landed the
// roster row is no longer the account. It is a tournament entry the director
// created, usually before the person ever signed in, and it carries holes
// other players attested to. Deleting the account unlinks it and leaves the
// event's record intact, which is exactly what the director's own unlink
// button does. The screen says so before anybody taps.
//
// The FCM revocation stays on the client because only the browser can do it
// — the admin SDK can delete the row, but it cannot tell this device's push
// service to stop honouring the subscription.
// Both steps before the callable are calls into somebody else's SDK across a
// network, and both are declared optional. `bestEffort` is what makes that
// true against a call that never settles rather than only against one that
// rejects — see the module, and the iOS deletion that hung forever inside a
// try/catch written to prevent exactly this.
//
// Account deletion is a store requirement in both queues (App Store 5.1.1(v),
// Play's Data safety), so it is the one flow that must never be blockable by
// a subsystem it does not need.
export async function deleteAccount({ playerId } = {}) {
  // Order: revoke at Apple while the account still exists — revocation
  // reauthenticates, and there is nothing to reauthenticate afterwards.
  //
  // Timed out like the push cleanup below, and for the same reason: on native
  // this opens a system sheet, and a sheet that is never answered must not
  // strand a deletion the user has already confirmed.
  const { revokeProviderAccess } = await import("./auth");
  await bestEffort(revokeProviderAccess(), "Apple token revocation", 30000);

  if (playerId) {
    const { unsubscribeFromPush, clearCachedSubscriptionStatus } = await import("./notifications");
    // The deletion's own row cleanup happens server-side either way: the
    // callable removes every push token for these player ids, so what is lost
    // when this times out is only telling THIS device's push service to stop
    // honouring a subscription whose rows are about to vanish.
    await bestEffort(unsubscribeFromPush(playerId), "push cleanup");
    clearCachedSubscriptionStatus(playerId);
  }

  try {
    // Dynamically imported for the same reason messaging is: firebase/
    // functions has no business on the critical path for a leaderboard.
    const [{ getFunctions, httpsCallable }, { getApp }] = await Promise.all([
      import("firebase/functions"),
      import("firebase/app"),
    ]);
    const res = await httpsCallable(getFunctions(getApp()), "deleteAccount")();
    return { ok: true, ...(res?.data || {}) };
  } catch (e) {
    // `unauthenticated` means the session went away underneath us — the one
    // failure where the right advice is "sign in again", not "try again".
    if (e?.code === "functions/unauthenticated") {
      return { ok: false, error: "Your sign-in expired. Sign in again, then delete." };
    }
    // The callable is deployed by hand, like the rules. Until it is, this is
    // the failure — and "try again" would be a lie about a build that cannot
    // succeed until somebody deploys.
    if (e?.code === "functions/not-found" || e?.code === "functions/internal") {
      return { ok: false, error: "Account deletion isn't deployed yet — tell the tournament director to deploy the Cloud Functions." };
    }
    console.error("[account] delete failed", e);
    return { ok: false, error: "Couldn't delete the account — check signal and try again." };
  }
}

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

  // `loud` so a refusal arrives as a rejection rather than as null. The
  // default swallows both a refused write and a failed one into the same
  // nothing, and this screen then said "check signal and try again" — which
  // is a lie in the case that actually happens, and sends somebody standing
  // in a car park hunting for a bar of signal.
  //
  // The case that actually happens is the LOCK. `bc_players`'s claim rule
  // starts at `canWriteEdition()`, which is `isMember() && (editionOpen() ||
  // isDirector())` — so on a locked edition a claim is refused for everybody
  // except a director, and a director is exactly who will never see it. That
  // is the same blind spot the bulk lock has, arriving from the other end:
  // the field can't claim, and the one person who could reproduce it writes
  // straight through.
  //
  // So a denial asks the edition whether it is locked and says so plainly.
  // Reads are open to everybody, so that question can always be answered,
  // and if the answer is no we fall back to writeFailure — which names the
  // undeployed-rules case, the other way this rule refuses a claim.
  try {
    const saved = await db.upsert("bc_players", {
      id: player.player_id,
      auth_uid: authUser.uid,
      auth_email: authUser.email || null,
      auth_provider: authUser.provider || null,
      auth_linked_at: new Date().toISOString(),
    }, { loud: true });
    return { ok: true, player: { ...current, ...saved } };
  } catch (e) {
    if (e?.code === "permission-denied") {
      const edition = await db.getById("bc_editions", TOURNAMENT_ID).catch(() => null);
      if (isEditionLocked(edition)) {
        return {
          ok: false,
          error: `${edition?.name || "This tournament"} is locked, so it can't take a new claim. Ask the tournament director to unlock it.`,
        };
      }
      // The other refusal this rule now has, and the one with an audience:
      // a membership minted by the REVIEWER code is stamped demo_only, and
      // canWriteEdition() confines it to demo editions. So a store reviewer
      // who taps a name on the cup's roster instead of switching first is
      // refused — and without this, by writeFailure's "the security rules
      // may not be deployed yet", which is both wrong and reads like a
      // broken app to the one person it must not read that way to.
      //
      // The stamp is on the caller's own bc_accounts document, which they
      // are allowed to read. Fetched only on a denial, so the ordinary
      // claim still costs one write and no reads.
      if (!isDemoEdition(edition)) {
        const membership = await db.getById("bc_accounts", authUser.uid).catch(() => null);
        if (membership?.demo_only === true) {
          return {
            ok: false,
            error: 'That access code only opens demo tournaments. Tap "Switch tournament" and choose the one labelled DEMO.',
          };
        }
      }
    }
    return { ok: false, error: writeFailure(e, "Could not save that — check signal and try again.") };
  }
}
