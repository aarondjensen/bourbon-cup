# Getting The Bourbon Cup into the Play Store

The app is a PWA. The Android app is a **Trusted Web Activity** — a thin native
shell that opens `https://thebourboncup.com` full-screen, with no browser
chrome, sharing the same session and the same service worker as the site. There
is no second codebase and no second release to keep in step: shipping a change
is a Vercel deploy, exactly as it is today. A new **bundle** is only needed when
something in `twa-manifest.json` changes — the name, the icon, the colours, the
version.

Everything below is either already in this repo or a step somebody has to take
by hand in a console. The by-hand ones are marked **BY HAND**, and they are the
ones that will hold the submission up.

---

## What is in the repo

| File | What it is |
| --- | --- |
| `twa-manifest.json` | Bubblewrap's configuration. The Android project is generated from this; it is not committed, because regenerating it is one command. |
| `public/.well-known/assetlinks.json` | The site's half of the Digital Asset Links handshake that removes the URL bar. **Carries a placeholder fingerprint** — see below. |
| `public/.well-known/README.md` | Why that file matters and how to verify it. |
| `public/favicon/site.webmanifest` | The web manifest Bubblewrap reads for the name, icons and colours. |
| `public/privacy.html` | The privacy policy URL the Play listing requires. |
| `public/account-deletion.html` | The account-deletion URL the Data safety section requires. |
| `public/legal.css` | The look of those two pages. No JavaScript on either. |

---

## 1. Build the bundle

Bubblewrap needs a JDK 17 and the Android SDK; it will offer to download both
the first time.

```sh
npm install -g @bubblewrap/cli

# From the repo root, where twa-manifest.json already is.
# It reads the existing config rather than asking twenty questions.
bubblewrap update        # regenerates the Android project from twa-manifest.json
bubblewrap build         # produces app-release-bundle.aab and app-release-signed.apk
```

The first `build` asks for a signing keystore. Let it create `android.keystore`
in the repo root — `.gitignore` already covers it.

> **BY HAND, and it cannot be recovered:** back up `android.keystore` and its
> passwords somewhere that is not this laptop. With Play App Signing enabled
> (it is, for any new app) losing the upload key is recoverable through Google
> support; losing it *without* Play App Signing means the app can never be
> updated again. Do it before the first upload, not after.

`bubblewrap doctor` diagnoses a broken toolchain. `bubblewrap validate` checks
the deployed site against the PWA criteria Play expects.

### Version bumps

`appVersionCode` in `twa-manifest.json` must increase on every upload;
`appVersionName` is what humans see. `bubblewrap update` picks up both.

---

## 2. Remove the URL bar — **BY HAND**

This is the step that most often gets a TWA rejected, and it cannot be
completed until after the first upload, because the fingerprint it needs is
Google's, not yours.

1. Upload the AAB to any track (internal testing is fine and fastest).
2. **Release → Setup → App integrity → App signing key certificate**.
3. Copy the **SHA-256 certificate fingerprint**.
4. Paste it over the placeholder in `public/.well-known/assetlinks.json`.
5. Commit and let Vercel deploy.
6. Verify — see `public/.well-known/README.md` for the two commands.

Until this is right the app opens with an address bar across the top. It runs
fine, which is exactly why it slips through internal testing.

---

## 3. App access — **BY HAND**

**App content → App access.** The app has a sign-in wall, so this cannot be
"All functionality is available without special access."

Choose **All or some functionality is restricted** and add two entries:

**Entry 1 — Browsing (no credentials needed)**

> Name: Guest mode
>
> Instructions: On the sign-in screen, tap "Look around as a guest" (below the
> Google and Apple buttons). This opens the whole app read-only with no account
> — the leaderboard, the draw, every scorecard, the trip schedule, the photo
> library and ten years of tournament history. No credentials are required. The
> same link is also on the password screen if you sign in first.

**Entry 2 — Scoring, photos and administration**

> Name: Full access
>
> Instructions: Sign in with the Google account below, then enter the
> tournament password when prompted, then tap the pre-assigned name on the
> roster screen (it will already be linked). This unlocks score entry, the
> photo library upload, side bets and the director's admin tabs.
>
> Username: `<the demo Google account>`
> Password: `<its Google password>`
> Any other instructions: Tournament password: `<from Admin → Event → Access>`

> **Set the demo account up first**, and point it at a scratch year rather than
> the live cup: create a throwaway edition in **Admin → Event → Editions**,
> add a roster row for the reviewer, sign in as the demo account and claim it.
> The tournament password is project-wide rather than per-edition, so that
> account can write to any year — revoke it after review by deleting its
> `bc_accounts` document in the Firebase console.

Guest mode alone is **not** enough for this section. Play wants reviewers to
reach all functionality, and guest mode is read-only by design.

---

## 4. Data safety — **BY HAND**

**App content → Data safety.** What the app actually collects, from
`src/lib/accounts.js`, `src/lib/notifications.js`, `src/lib/mediaUpload.js` and
the roster:

| Data type | Collected | Shared | Required | Purpose |
| --- | --- | --- | --- | --- |
| Email address | Yes | No | Yes | App functionality, Account management |
| Name | Yes | No | Yes | App functionality |
| User IDs | Yes | No | Yes | App functionality, Account management |
| Photos | Yes | No | Optional | App functionality |
| Device or other IDs | Yes | No | Optional | App functionality (push notification token) |
| Other user-generated content | Yes | No | Yes | App functionality (scores, matches, card signatures) |
| Other financial info | Yes | No | Optional | App functionality (trip payments the director records — amounts and dates only, no card or bank details) |

Answer these as follows:

- **Is all data encrypted in transit?** Yes.
- **Do you provide a way for users to request data deletion?** Yes —
  `https://thebourboncup.com/account-deletion.html`
- **Data collected is processed ephemerally?** No.
- **Location, contacts, calendar, messages, health, financial account info,
  audio, files, app activity, crash logs, diagnostics, advertising ID?** Not
  collected. The app has no analytics and no advertising SDKs at all.

**Privacy policy URL:** `https://thebourboncup.com/privacy.html`

---

## 5. Deploy the account-deletion function — **BY HAND**

Play requires deletion to work from inside the app, and a reviewer will tap the
button. `deleteAccount` is a Cloud Function and Cloud Functions are deployed by
hand:

```sh
firebase deploy --only functions
```

Until that runs, **My Account → Delete Account** reports that deletion is not
deployed yet. That is an honest message and a failed requirement.

Verify on a throwaway account and check all three outcomes in the Firebase
console: the `bc_accounts` document gone, the roster row surviving with
`auth_uid: null`, the Auth user gone.

---

## 6. Notifications on Android

Web push works inside a TWA, delegated to the Android notification system.
`twa-manifest.json` sets `enableNotifications: true`, which is what makes
Bubblewrap request `POST_NOTIFICATIONS` on Android 13 and above.

This needs `VITE_FCM_VAPID_KEY` set in Vercel or the app reports push as
unconfigured. Nothing about the TWA changes that — it is the same web push the
site already uses.

---

## 7. Store listing

Play wants, at minimum: an app name (30 chars), a short description (80), a
full description (4000), a 512×512 icon, a 1024×500 feature graphic, and at
least two phone screenshots (16:9 or 9:16, each side 320–3840px).

Suggested copy:

**App name**

```
The Bourbon Cup
```

**Short description**

```
Live scoring, the draw and a decade of history for one annual golf trip.
```

**Full description**

```
The Bourbon Cup is the scoring app for one annual match-play golf tournament —
two teams, four rounds, and a trophy that has changed hands since 2016.

Post scores hole by hole from the tee box. One phone in the group can enter for
all four players, and the leaderboard updates on everybody else's while they
walk. Cards are signed and attested by the people who played the round, the way
they always were on paper.

• LEADERBOARD — the cup total, live, from the first tee shot to the handshake
  on 18.
• SCORING — your group's card, with strokes worked out for the format you are
  playing: fourball, scramble, Pinehurst, singles.
• MATCHES — the whole draw, every round, with tee times and playing groups.
• BETTING — skins, closest-to-the-pin and side bets between players, settled by
  both sides agreeing rather than by the app deciding.
• TRIP INFO — when it is, where everybody is staying, and the scorecard for
  every course on the schedule.
• DATA — every cup since 2016: career records, head-to-heads, partnerships,
  and where each year turned.
• PHOTOS — the week, posted from the phone that took it.

Want a look before you commit? Tap "Look around as a guest" on the sign-in
screen and the whole app opens read-only, no account needed.

Scoring requires an account and the tournament password, which the tournament
director hands out to the field.
```

Both static pages and the guest door make the listing's own requirements easy:
privacy policy at `/privacy.html`, deletion at `/account-deletion.html`, and a
reviewer who can open the app without waiting for credentials.

### Screenshots

The fastest honest way to get them is to drive the deployed site in a phone
viewport and photograph the real screens:

```js
// Chromium is at /opt/pw-browsers/chromium-*/chrome-linux/chrome in CI.
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },  // 9:19.5, a Pixel
  deviceScaleFactor: 2,                   // → 824×1830, inside Play's limits
});
```

Leaderboard, a scorecard mid-round, the draw, and the Data tab's career table
are the four that show what the app is. Take them on a year with scores in it —
`bc_2025` or any imported cup — rather than on an empty new edition.

---

## 8. The closed-testing requirement

A **personal** Play developer account must run a closed test before it can apply
for production access: a number of testers opted in continuously for a number of
days, and then an application form. Organisation accounts are exempt. Both
numbers have moved more than once — read them off the Console rather than
trusting any figure written down here, including this one.

What matters in practice:

- Google counts testers **opted in**, not taps. Each tester needs a Google
  account on the closed-test list (an email list or a Google Group), and each
  has to accept the opt-in link and install from Play.
- The production-access form asks how testers were recruited and what feedback
  came back. Guest mode is what makes that answerable: a tester can open the
  app and use it without the tournament password, so there is something real to
  give feedback about.
- Uninstalling does not remove a tester from the count, but leaving the tester
  list does. Do not prune it mid-test.

---

## The order to do this in

1. Deploy the Cloud Functions, so deletion works. **BY HAND**
2. Deploy the site with this commit, so both static pages and the guest door are
   live. (Vercel does this on merge.)
3. `bubblewrap build`, back up the keystore. **BY HAND**
4. Upload to internal testing, read the signing fingerprint, fill in
   `assetlinks.json`, commit, verify the URL bar is gone. **BY HAND**
5. Fill in App access, Data safety, the privacy policy URL and the listing.
   **BY HAND**
6. Promote to closed testing and open it to the field.
