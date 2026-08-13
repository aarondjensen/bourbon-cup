// ══════════════════════════════════════════════════════════════════
//  My Account — the one screen that is about the USER, not the event.
// ══════════════════════════════════════════════════════════════════
//
// Everything on every other tab is the tournament: scores, matches, the
// cup. This is the only place that is about the person holding the phone,
// so it is where their four personal controls now live — sign out, delete,
// notifications, appearance. Two of them (Logout, the dark-mode switch)
// used to sit in the More menu; a slide-up menu is a place to GO, and a
// preference is not a destination. They moved here rather than being
// duplicated, so there is exactly one place to change either.
//
// Delete Account is the reason this screen exists now rather than later:
// App Store review guideline 5.1.1(v) requires any app that lets you
// create an account to let you delete it from inside the app, without
// emailing anyone. With Google and Apple sign-in that obligation is real
// and specific — there is a Firebase user, a membership document, and a
// link to a name on the roster.
//
// The teardown itself is a Cloud Function (see lib/accounts.deleteAccount
// for why it has to be). This screen owns the conversation around it: which
// account is about to go, what survives it, and one last chance to stop.
//
// TWO IDENTITIES, and keeping them apart is most of the copy here. The
// ACCOUNT is the Google or Apple login. The PLAYER is a row on the roster
// that the director created, usually before that person ever signed in.
// Deleting the account unlinks the two and leaves the tournament's record
// alone — which is only a defensible answer if the screen says it plainly
// before anybody taps, so it does, twice.
import { useState } from "react";
import { BC, FONT, ALPHA, FS, ON_ACCENT } from "../theme";
import { SegmentedToggle } from "./ui";
import { ConfirmModal } from "./Popup";
import { useConfirm } from "../lib/useConfirm";
import { providerLabel } from "../lib/auth";
import { BOOTSTRAP_DIRECTOR } from "../firebase";
import { NotificationSettings } from "./NotificationSettings";
import { BalanceCard } from "./Ledger";

const Card = ({ children, style }) => (
  <div style={{
    background: BC.card, border: `1px solid ${BC.bdr}`, borderRadius: 10,
    padding: "14px 16px", ...style,
  }}>{children}</div>
);

// Centred, matching Trip Info. These heads name the card under them rather
// than starting a line of prose, and a head over the middle of one card and
// over the left edge of the next reads as two different kinds of heading —
// which is what the two screens looked like side by side. The CONTENTS of
// each card keep their own alignment: the identity row is an avatar beside a
// name, the balance is a figure opposite its breakdown, and both are
// two-column layouts that centring would only smear.
const SectionLabel = ({ children, style }) => (
  <div style={{
    fontSize: FS.label, fontWeight: 800, letterSpacing: 1.5,
    color: BC.amberInk, marginBottom: 10, textAlign: "center", ...style,
  }}>{children}</div>
);

// Initials from whatever name we actually have. Two words → two letters,
// one word → one; a nickname ("Deuce") is a name like any other here.
// Punctuation is stripped before the first character is taken, or the
// bootstrap identity ("Director (Setup)") reads as "D(".
const initialsOf = (name) => String(name || "?")
  .trim().split(/\s+/)
  .map(w => w.replace(/[^\p{L}\p{N}]/gu, "")[0] || "")
  .filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";

// ── The guest ──────────────────────────────────────────────────────
// Somebody who took the guest door on the sign-in screen (src/lib/guest.js).
// They have no Firebase account, so three of this screen's four sections
// are about things they do not have: there is nothing to sign out of, no
// account to delete, and no membership document, which means a push token
// they registered would be refused by the rules with nothing on screen to
// explain it. Appearance is the one preference that is genuinely theirs —
// it is a localStorage flag, the same as the guest flag itself.
//
// What replaces the rest is one card that says what guest mode IS and one
// button out of it, because "why can't I post a score" is the question a
// guest arrives at this screen holding.
export function AccountView({
  user, authUser, player, teams, payments, duesAmount, isGuest = false,
  darkMode, onToggleTheme, onLogout, onDeleteAccount, notify,
}) {
  const { confirm, confirmModal } = useConfirm();
  const [deleting, setDeleting] = useState(false);

  // The live roster row is the truth about team and name; the account is the
  // truth about the login. Neither substitutes for the other — an account
  // that has not claimed a name has no roster row at all.
  const name = player?.name || user?.name || "Player";
  const teamId = player?.team || user?.team || null;
  const team = teamId ? teams?.[teamId] : null;
  const accent = team?.accent || BC.amber;
  // Which button they signed in with, and the address it came back with.
  // Apple's Hide My Email hands over a privaterelay address, which is a
  // real answer and worth showing as-is — it is what the roster stores.
  const signInWith = providerLabel(authUser?.provider);
  const signInAs = authUser?.email || null;
  // No roster row: a director bootstrapping an edition with an empty
  // roster, or an account whose claim a director has since unlinked. There
  // is nothing to unlink and the delete copy must not promise there is.
  //
  // `player` is the LIVE row and `user` may be the cached identity the app
  // runs on for the moment before the roster subscription lands (see the
  // session note in firebase.js). Either one means a name has been claimed;
  // reading only the live row would flash "no name claimed" at somebody who
  // has had one for a year, on a cold start with bad signal.
  // A guest is never claimed — the identity they run on matches no roster
  // row by construction (lib/guest.js), so it must not read as one here.
  const claimed = !isGuest
    && (!!player
      || (!!user?.player_id && user.player_id !== BOOTSTRAP_DIRECTOR.player_id));

  const handleLogout = async () => {
    // A guest has nothing to log out OF, so the question is a different one:
    // this drops the guest flag and puts the sign-in screen back. No confirm
    // — nothing is lost by it, and it is the only way forward for a tester
    // who has been given a real account since.
    if (isGuest) { onLogout(); return; }
    if (await confirm({
      title: "Log out?",
      message: `Nothing is deleted — sign back in with ${signInWith === "account" ? "the same account" : signInWith} and you'll come straight back to ${name}.`,
      confirmLabel: "Log Out",
    })) onLogout();
  };

  // Two confirms, deliberately. This is irreversible, it is two taps from
  // the More menu, and phones get handed around at this event — the second
  // dialog is the last thing standing between a mis-tap and somebody's
  // sign-in being gone.
  const handleDelete = async () => {
    if (deleting) return;

    const detail = [
      `This permanently deletes your ${signInWith === "account" ? "" : signInWith + " "}sign-in${signInAs ? ` (${signInAs})` : ""}:`,
      "",
      "• you won't be able to sign in to the app again",
      "• your email is removed from the roster",
      ...(claimed ? [`• ${name} is unlinked, and free for someone to claim`] : []),
      "• push notifications stop on every device",
      "",
      // Compressed, not cut. This is the one thing somebody deleting an
      // account does not expect, and the reason is what stops it reading as
      // arbitrary — the cards are part of rounds other people signed.
      ...(claimed
        ? [`${name} STAYS on the roster, with your scores and the cards you signed — other players signed those rounds too. Ask the director if the name itself needs to go.`]
        : ["Nothing on the roster is linked to this account."]),
    ];

    if (!await confirm({
      eyebrow: "Delete account",
      title: "Delete your account?",
      message: detail.join("\n"),
      confirmLabel: "Continue",
      destructive: true,
    })) return;

    if (!await confirm({
      title: "This can't be undone",
      message: claimed
        ? `Your sign-in is deleted for good. You can sign in again as a new account and claim ${name} back, unless somebody else has taken it.`
        : "Your sign-in is deleted for good. Signing up again means starting from the tournament password.",
      confirmLabel: "Delete Account",
      destructive: true,
    })) return;

    setDeleting(true);
    const res = await onDeleteAccount();
    // On success the app drops to the login screen out from under us, so
    // there is nothing to un-busy — and nothing to toast at, either.
    if (!res?.success) {
      setDeleting(false);
      notify?.(res?.error || "Couldn't delete the account — try again", "error");
    }
  };

  return (
    <div style={{ fontFamily: FONT, padding: "4px 2px 20px" }}>
      <SectionLabel>{isGuest ? "GUEST" : "MY ACCOUNT"}</SectionLabel>

      {/* Who you are signed in as — the roster name on top, the account it
          is signed in with under it. Both, because they are separate things
          and this is the one screen where the difference matters: the
          buttons at the bottom act on the account, not on the name. */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
            background: `${accent}${ALPHA.tint}`, border: `1.5px solid ${accent}${ALPHA.line}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: FS.body, fontWeight: 800, color: accent, letterSpacing: 0.5,
          }}>{initialsOf(name)}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: FS.lead, fontWeight: 800, color: BC.t1, lineHeight: 1.2 }}>{name}</div>
            <div style={{ fontSize: FS.small, color: BC.t3, marginTop: 3, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              {team && <span style={{ color: accent, fontWeight: 700 }}>{team.name}</span>}
              {user?.isDirector && (
                <span style={{
                  padding: "1px 6px", borderRadius: 4, fontSize: FS.label, fontWeight: 800,
                  background: `${BC.amber}${ALPHA.wash}`, color: BC.amberInk, letterSpacing: 0.5,
                }}>DIRECTOR</span>
              )}
              {/* Same slot as the crown, and the same job: the one word that
                  explains what this identity can and cannot do. Neutral
                  rather than danger-coloured — being a guest is not a
                  problem, it is a choice made on the sign-in screen. */}
              {isGuest && (
                <span style={{
                  padding: "1px 6px", borderRadius: 4, fontSize: FS.label, fontWeight: 800,
                  background: `${BC.t3}${ALPHA.wash}`, color: BC.t2, letterSpacing: 0.5,
                }}>READ-ONLY</span>
              )}
            </div>
          </div>
        </div>
        {/* What guest mode is, where the identity card can explain it — next
            to the word READ-ONLY rather than in a caption further down the
            screen that nobody scrolls to. It names the two things a guest
            will actually notice missing (scoring, photos) and the way out. */}
        {isGuest && (
          <div style={{
            marginTop: 12, paddingTop: 10, borderTop: `1px solid ${BC.bdr}${ALPHA.hair}`,
            fontSize: FS.small, color: BC.t2, lineHeight: 1.5,
          }}>
            You&apos;re looking around without an account. Every screen is live and
            nothing you tap can change the tournament — posting scores, photos and
            bets needs a sign-in and the tournament password.
          </div>
        )}
        {authUser && (
          <div style={{
            marginTop: 12, paddingTop: 10, borderTop: `1px solid ${BC.bdr}${ALPHA.hair}`,
            fontSize: FS.small, color: BC.t2, lineHeight: 1.5,
          }}>
            {/* Two lines, not one sentence. "Signed in with Google as
                aarondjensen@gmail.com" wrapped mid-address on every phone,
                so the provider — the thing that answers "which button do I
                press next time" — was the half that got pushed around by
                however long somebody's email happens to be. Split, the
                provider always reads on one line and the address gets the
                full width to break in. */}
            <div>Signed in with <strong style={{ color: BC.t1 }}>{signInWith}</strong></div>
            {signInAs && (
              <div style={{ color: BC.t1, wordBreak: "break-all", marginTop: 2 }}>{signInAs}</div>
            )}
            {!claimed && (
              <div style={{ fontSize: FS.label, color: BC.t3, marginTop: 4 }}>
                This account hasn&apos;t claimed a name on the roster.
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ── Balance due ──
          Directly under the identity card, above the preferences, because it
          is the only thing on this screen that is ever OUTSTANDING — the rest
          is settings, and settings can wait behind a debt. It renders nothing
          at all when the tournament has no ledger, so a year that nobody
          charged for looks exactly as it did before this existed.

          It shows only THIS reader's position. Who else owes what is the
          director's screen (Admin → Budget), not a leaderboard. */}
      <BalanceCard player={player} payments={payments} duesAmount={duesAmount} />

      {/* ── Appearance ──
          A pill the width it needs and no wider, centred under the head.
          It was full-bleed with a "Theme" label over it, and both were
          doing the head's job a second time: the card says APPEARANCE, the
          two buttons say Light and Dark, and a stretched control reads as
          something with more settings inside it than it has. Sized to sit
          level with the notification switches below rather than dwarfing
          them — this is a preference, the same weight as those. */}
      <SectionLabel>APPEARANCE</SectionLabel>
      <Card style={{ marginBottom: 16, display: "flex", justifyContent: "center" }}>
        <SegmentedToggle
          dense
          style={{ width: 172 }}
          options={[["light", "☀️  Light"], ["dark", "🌙  Dark"]]}
          value={darkMode ? "dark" : "light"}
          // The toggle is a two-state switch behind a two-option control:
          // re-picking the mode already on is a no-op, not a flip.
          onChange={(k) => { if ((k === "dark") !== !!darkMode) onToggleTheme(); }}
        />
      </Card>

      {/* ── Notifications ──
          The real settings screen, embedded rather than linked. It owns a
          four-way permission dance (iOS version, home-screen install,
          browser denial, unsupported) that has one correct home, and there
          is no back button in this app to return from a separate route. */}
      {/* Withheld from a guest, not disabled for one. Registering a push
          token is a write, and bc_notification_tokens requires a membership
          — so the switch would flick on, the write would be refused, and the
          card would sit there saying SUBSCRIBED at somebody who will never
          get a notification. A control that cannot work is worse than a
          control that is not there. */}
      {!isGuest && <NotificationSettings user={user} notify={notify} />}

      {/* ── The two ways out ──
          One card, because they are the same question asked at two
          strengths: leave, and leave for good. They were two sections with a
          head apiece and a line of explanation between them, which put three
          rungs of chrome around two buttons.

          The description under Delete is gone. It said less than the two
          confirms behind the button already say, and it said it to everybody
          who ever opened this screen rather than to the one person about to
          tap — see handleDelete, which spells out every consequence and then
          asks again. A caption cannot be the safeguard when a dialog is.

          Delete keeps the danger colour and stays LAST. It is still the one
          control on this screen that doing twice does not undo. */}
      <SectionLabel style={{ marginTop: 4 }}>{isGuest ? "GUEST MODE" : "ACCOUNT ACTIONS"}</SectionLabel>
      <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <button onClick={handleLogout} style={{
          width: "100%", padding: "12px 0", borderRadius: 10,
          background: BC.inp, border: `1px solid ${BC.bdr}`,
          color: BC.t1, fontSize: FS.body, fontWeight: 800,
          cursor: "pointer", fontFamily: FONT,
        }}>
          {isGuest ? "Exit Guest Mode" : "Log Out"}
        </button>
        {/* No Delete Account for a guest. There is no Firebase user, no
            membership document and no roster row to unlink — the callable
            would find nothing and the button would be a promise about an
            account that was never created. App Store guideline 5.1.1(v) is
            about accounts you can CREATE in the app; guest mode creates
            none, which is the point of it. */}
        {!isGuest && <button onClick={handleDelete} disabled={deleting} style={{
          width: "100%", padding: "12px 0", borderRadius: 10,
          background: BC.danger, border: "none",
          color: ON_ACCENT, fontSize: FS.body, fontWeight: 800,
          cursor: deleting ? "default" : "pointer", opacity: deleting ? 0.6 : 1,
          fontFamily: FONT,
        }}>
          {deleting ? "Deleting…" : "Delete Account"}
        </button>}
      </Card>

      <ConfirmModal modal={confirmModal} />
    </div>
  );
}
