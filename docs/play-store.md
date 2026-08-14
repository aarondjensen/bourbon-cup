# Getting The Bourbon Cup into the Play Store

Read [`store-submission.md`](./store-submission.md) first — the reviewer
account, the data disclosures, the age rating and the deploy prerequisites live
there and are not repeated here. The iOS half is [`app-store.md`](./app-store.md),
and it is a much larger job; start this one first, because its long pole is
calendar time rather than work.

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

The account itself is built once and used by both stores — see
`store-submission.md` §1.4.

Guest mode alone is **not** enough for this section. Play wants reviewers to
reach all functionality, and guest mode is read-only by design.

---

## 4. Data safety and age rating — **BY HAND**

**App content → Data safety.** The collection table is in
`store-submission.md` §2, in the same vocabulary Play's form uses. Every row
there maps to App functionality, and Email / User IDs additionally to Account
management.

**App content → Content ratings** is the IARC questionnaire, and it is the one
that is easy to answer wrong in a way that survives review and gets the app
pulled later. `store-submission.md` §3 has both answers: the alcohol reference
is **yes, mild** (the app is named after bourbon), and the real-money gambling
question is **no** (the app moves no money and has no purchases).

**Privacy policy URL:** `https://thebourboncup.com/privacy.html`

---

## 5. Notifications on Android

Web push works inside a TWA, delegated to the Android notification system.
`twa-manifest.json` sets `enableNotifications: true`, which is what makes
Bubblewrap request `POST_NOTIFICATIONS` on Android 13 and above.

This needs `VITE_FCM_VAPID_KEY` set in Vercel or the app reports push as
unconfigured. Nothing about the TWA changes that — it is the same web push the
site already uses.

---

## 6. Store listing

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

Which four screens, and how to photograph them, is in `store-submission.md` §4.
Play's own limits: at least two phone screenshots, 16:9 or 9:16, each side
between 320px and 3840px. A 412×915 viewport at device scale 2 gives 824×1830,
comfortably inside them.

Play also wants a **1024×500 feature graphic** and a **512×512 icon**, neither
of which the App Store asks for. Both exist:

| Asset | Where |
| --- | --- |
| 512×512 icon | `public/favicon/web-app-manifest-512x512.png` — the one the PWA already uses |
| 1024×500 feature graphic | `store/play-feature-graphic.png`, from `npm run build:store-graphics` |

The feature graphic is composed from the mark and the two gradient stops
inside `public/BC ICON-01.svg`, so it cannot drift away from the icon sitting
next to it in the listing. It needs **Montserrat installed on the machine** to
regenerate — that is `FONT` in `src/theme.js`, and a listing set in something
else reads as a different product. The script says so and falls back rather
than rendering something quietly off-brand; the header of
`scripts/store-graphics.mjs` has the one-line install.

---

## 7. The closed-testing requirement — the part that failed last time

A **personal** Play developer account must run a closed test before it can apply
for production access: **12 testers opted in continuously for 14 days**, then an
application form. Organisation accounts are exempt. Both numbers have moved
before — read them off the Console rather than trusting this line.

### What went wrong on Maize N Que, and why

Twelve people installed the app and that was the whole of it. The count was met
and the application was still refused.

That is not bad luck. **Since April 2026 Google rejects production-access
applications for insufficient testing engagement** — testers who opted in but
never used the app. The 12-and-14 figures are a floor Google checks
automatically; the application is then read by a human who looks at what the
testers actually did and at what the developer says came back from them. An
application whose answer to "what feedback did you receive" is thin is the
application that gets refused, and the refusal costs another 14 days.

So the count is the easy half. Plan the other half.

### Running a test that passes

**Recruit for real use, not for headcount.** The field is sixteen men who are
going on this trip. They are the best testers available anywhere and they have
an actual reason to open the app. Do not pad the list with people who will
install and forget — an inactive tester is worse than no tester, because they
count toward twelve and drag the engagement picture down.

**Give them the password.** This is the one place guest mode is the wrong tool.
Guest mode exists so a stranger can look around; the field are not strangers.
A tester who can post a score, sign a card and settle a skin generates the
engagement Google is looking for, and a tester in read-only mode taps four
screens and closes the app. Use guest mode for anyone outside the sixteen who
is filling out the roster of twelve.

**Time it against the tournament, or against something.** Fourteen days of an
app with nothing happening in it is fourteen days of nobody opening it. If the
window cannot cover a live round, the demo edition is what fills it —
`npm run seed:demo` (see `store-submission.md` §1.4) leaves the cup tied 6–6
with round 2 stopped at the turn and twelve unclaimed names, so there is a
scorecard waiting for whoever opens it. Then ask each man to do three specific
things:

1. Sign in, claim your name, and check your handicap is right.
2. Post a score for a made-up round and sign the card.
3. Open Trip Info and tell me if the dates and the house are wrong.

Three concrete asks produce three concrete answers, and those answers are
literally what the application form wants pasted into it.

**Collect the feedback somewhere you can quote.** A group text is fine — the
form asks what you learned and what you changed. Screenshot it. "Two testers
reported the header countdown was cut off on a small screen; fixed in build 4"
is an application that gets approved. "Testers said it worked well" is not.

**Ship a build or two during the window.** A test with one build looks like a
distribution exercise. A test with three builds, where the later ones fix things
the testers named, looks like testing — because it is.

### Mechanics that bite

- Google counts testers **opted in**, not taps. Each tester needs a Google
  account on the closed-test list (an email list or a Google Group), and each
  has to accept the opt-in link **and install from Play**. Sideloading does not
  count and neither does opting in without installing.
- The account that opts in must be the account signed into the Play Store on
  the device. This is the single most common failure: a man with a work Google
  account on his phone and a personal one on the invite list.
- **Uninstalling does not remove a tester from the count, but leaving the tester
  list does.** Do not prune the list mid-test — it resets the clock.
- The 14 days are **continuous**. Dropping below twelve opted-in testers at any
  point starts them again.
- Allow roughly three weeks end to end: 14 days of testing, up to a couple of
  days for the production-access decision, and up to 7 more for the production
  review itself.

---

## The order to do this in

Steps 1–3 are in `store-submission.md` §1 and are shared with the iOS
submission. Do them once.

1. Everything in `store-submission.md` §1 — functions deployed, rules deployed,
   VAPID key set, reviewer account built. **BY HAND**
2. Deploy the site, so both static pages and the guest door are live. (Vercel
   does this on merge.)
3. `bubblewrap build`, back up the keystore. **BY HAND**
4. Upload to internal testing, read the signing fingerprint, fill in
   `assetlinks.json`, commit, verify the URL bar is gone. **BY HAND**
5. Fill in App access, Data safety, content rating, the privacy policy URL and
   the listing. **BY HAND**
6. Promote to closed testing, open it to the field **with the tournament
   password**, and run the fourteen days as §7 describes — with things to do,
   more than one build, and feedback written down. **BY HAND**
7. Apply for production access, quoting the feedback. **BY HAND**
