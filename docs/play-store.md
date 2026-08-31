# Getting The Bourbon Cup into the Play Store

> ## The route is INTERNAL TESTING
>
> Decided, for this app and for WBC both. Up to 100 testers, live in minutes,
> exempt from the Data safety form, and no closed test at all — no twelve
> testers, no fourteen days, no production-access application.
>
> **§8 does not apply.** It is kept because it is the right instructions if
> this app ever wants a public listing, and because the reasoning in it about
> tester engagement is what makes a closed test survivable. Until then it is
> reference, not the plan. §7 is why.
>
> Play has no Unlisted track — that is an Apple mechanism — but internal
> testing is already the shape it suggests: the opt-in URL goes on
> `thebourboncup.com`, a tester taps it, and Play installs the app. Nobody
> searches for anything, and the app never appears in the store to be found.

Read [`store-submission.md`](./store-submission.md) first — the reviewer
account, the data disclosures, the age rating and the deploy prerequisites live
there and are not repeated here. The iOS half is [`app-store.md`](./app-store.md),
and it is a much larger job; start this one first, because its long pole is
calendar time rather than work.

The app is a PWA, and the Android app is a **Capacitor** build of it — the same
shell as iOS (`app-store.md`), with the web build bundled inside the APK rather
than loaded off the network.

**It used to be a Trusted Web Activity**, and the reasoning for that was good:
a TWA is a hollow shell that opens `https://thebourboncup.com` full-screen, so
shipping a change was a Vercel deploy and there was never a second release to
keep in step. What it cost was a second architecture. Once iOS needed Capacitor
— Apple has no TWA equivalent — this repo was running two different shells with
two different toolchains, two different sets of native branches to reason
about, and only one of them shared with WBC.

So Android is Capacitor too, and the whole estate is now one shape: two apps,
two platforms each, one build command. The price is that a web fix no longer
reaches Android by Vercel alone — it needs a new bundle and an upload. On the
internal-testing track that is minutes, and it buys a single mental model.

Everything below is either already in this repo or a step somebody has to take
by hand in a console. The by-hand ones are marked **BY HAND**, and they are the
ones that will hold the submission up.

---

## What is in the repo

| File | What it is |
| --- | --- |
| `capacitor.config.json` | One config, both platforms. The `android` block sits beside the `ios` one. |
| `android/` | **Tracked**, like `ios/` and like both of WBC's — the signing block, the manifest and the launcher icons are all edited by hand. `android/.gitignore` covers what is generated. |
| `android/app/build.gradle` | Release signing, read from `keystore.properties` or the environment. Deliberately the same shape as WBC's. |
| `android/keystore.properties.example` | The template. The real file is gitignored. |
| `scripts/app-icons.mjs` | Every launcher icon on both platforms, from `public/BC ICON-01.svg`. |
| `public/privacy.html` | The privacy policy URL the Play listing requires. |
| `public/account-deletion.html` | The account-deletion URL the Data safety section requires. |
| `public/legal.css` | The look of those two pages. No JavaScript on either. |

Gone with the TWA: `twa-manifest.json`, and `public/.well-known/assetlinks.json`
with its placeholder fingerprint. A Capacitor app is a real native app — there
is no browser chrome to hide, so there is no Digital Asset Links handshake to
get right and no round-trip through Play to collect a signing fingerprint.

---

## 1. Build the bundle

Same three commands as iOS, one platform along. No JDK to download, no Android
SDK to fetch, no global CLI — Capacitor uses the Gradle wrapper in `android/`.

```sh
npm run android:bundle
```

That is the whole thing: build, `cap sync android`, and `bundleRelease`, with
the right Gradle wrapper for the platform. **Use the script rather than the
three commands**, and not for brevity — `npm run build && npx cap sync android`
is bash, and `&&` is not a statement separator in Windows PowerShell 5.1, where
it fails on the first line. `./gradlew` is a shell script Windows cannot run at
all; there it is `gradlew.bat`. The script spawns whichever is right and the
shell never gets a say.

It also refuses to build when signing is unconfigured, which Gradle does not:
a release build with no keystore SUCCEEDS and emits an unsigned bundle, the
warning scrolls past in a hundred lines of Gradle output, and Play is where you
would find out.

`npx cap open android` opens Android Studio if you would rather build there.

### Signing — **BY HAND, once**

Create a keystore and tell Gradle where it is. One line, no `\` continuation —
that is bash, and a parse error in PowerShell:

```sh
keytool -genkey -v -keystore android/bourbon-cup.keystore -alias bourbon-cup -keyalg RSA -keysize 2048 -validity 10000
```

`keytool` ships with the JDK, so if it is not found you do not have one on
PATH — which Gradle will need anyway (17 or newer). It prompts for a password
and then for name, organisation and country; **the answers to those do not
matter and are never shown to anybody**, but the password does. Use the same
one for the store and the key, which is what the prompts assume when you press
return at "key password".

Then copy the template and fill in the two passwords:

```sh
cp android/keystore.properties.example android/keystore.properties
```

On Windows that is `copy android\keystore.properties.example android\keystore.properties`.

Both the keystore and `keystore.properties` are gitignored. `BC_KEYSTORE_FILE`,
`BC_KEYSTORE_PASSWORD`, `BC_KEY_ALIAS` and `BC_KEY_PASSWORD` override the file,
which is how CI would sign without one on disk.

A release build with signing unconfigured **still succeeds** and produces an
unsigned bundle Play refuses. `build.gradle` warns loudly at task-graph time
rather than letting that be discovered at upload — but the warning scrolls past,
so check the bundle is signed before you upload the first one.

> **BY HAND, and it cannot be recovered:** back up the keystore and its
> passwords somewhere that is not this laptop. With Play App Signing enabled
> (it is, for any new app) losing the upload key is recoverable through Google
> support; losing it *without* Play App Signing means the app can never be
> updated again. Do it before the first upload, not after.

**Keep the keystore OUTSIDE the repo**, beside the other apps' at `C:\dev\keys\`
rather than in `android/`. `*.keystore` is gitignored, and a gitignored file in
a working tree is precisely what `git clean -xfd` deletes without naming. That
is the likeliest end of this app's FIRST upload key — bubblewrap wrote it to
`./android.keystore` at the repo root, `twa-manifest.json` pointed at it there,
and when Android moved to Capacitor the file was gone while Play went on
expecting it. `storeFile` takes an absolute path, so there is no cost:

```properties
storeFile=C:/dev/keys/bourbon-cup-upload.keystore
```

Forward slashes, or doubled backslashes — it is a Java properties file.

### Android developer verification — **registered, nothing to do**

**Play Console → Android developer verification** lists every package name
Google will let be installed on a certified Android device, and says apps not
registered by **September 30, 2026** are removed from Play globally. It reads
like an outstanding submission step and is not one: all four packages on this
account — `com.mnqgolf.app`, `com.sfglgolf.app`, `com.thebourboncup.app` and
Wannabe Cup — already show **Registered**, because Play pre-fills the page from
the Play Console account itself. A package with a console entry is registered
whether or not anything has ever been published to it, so Bourbon Cup and WBC
being unsubmitted is not a gap in it, and none of it gates an upload.

What is registered is a package name **plus signing keys**, and the check at
install time is against the key the installed app is actually signed with:

- **Anything installed from Play is covered permanently.** Under Play App
  Signing the users' copy is signed by Google's key, and Google registers that
  one itself. That is the whole internal-testing route (§7).
- **A sideloaded build is the one that can be refused** — an APK dragged onto a
  phone to test something is signed with the upload key or a debug key, not
  Google's, and that certificate has to be one of the ones listed against the
  package. Bourbon Cup and WBC carry three keys each where MnQ and SFGL carry
  one — Google's app-signing key, the upload key and, on this app at least, the
  bubblewrap key from the TWA era. Open the row once before sideloading
  anything and check the certificate the current keystore produces is among
  them.
- **An upload key reset mints a key this page has not seen.** If the bundle is
  ever refused for the wrong key and it goes to *Request upload key reset*
  (above), register the new certificate here as well. Its SHA-256 comes off the
  keystore:

  ```sh
  keytool -list -v -keystore C:/dev/keys/bourbon-cup-upload.keystore -alias bourbon-cup
  ```

Same for WBC, in its own repo — the page is per Play Console account, so the
two apps are already both on it, but a key added for one is not a key added for
the other.

### When Play refuses the bundle

Two rejections cost an evening between them, and neither says what it means.

**"needs to have the package name com.thebourboncup.app"** — usually true, and
usually because the wrong file went up. Four repos on this machine build a
Capacitor Android app, and every one of them emits
`android\app\build\outputs\bundle\release\app-release.aab`. A browser file
picker remembering the wrong recent folder is all it takes, and the sizes are
the only tell (Bourbon Cup 12.1 MB, MnQ 9.8, SFGL 7.2, WBC 5.5). Confirm what
Gradle actually built:

```powershell
Get-ChildItem android\app\build\intermediates -Recurse -Filter AndroidManifest.xml |
  Where-Object { $_.FullName -like "*merged_manifest*" -and $_.FullName -like "*release*" } |
  ForEach-Object { Select-String -Path $_.FullName -Pattern 'package="[^"]*"' -AllMatches }
```

If that says `com.thebourboncup.app` and Play still refuses, **Play is reading a
different file than you are**. Copy the bundle somewhere with a name no other
repo produces and upload that — it is faster than proving it any other way, and
it is what finally surfaced the real error underneath.

**"signed with the wrong key"** — the listing already has an upload key
registered, from something uploaded to it long ago. A listing that once held a
bubblewrap TWA is enrolled with bubblewrap's key, not with the keystore made
later, and no rebuild fixes that. If the old keystore still exists, point
`keystore.properties` at it and carry on; using it as the upload key costs
nothing, because the key users actually install against is Google's under Play
App Signing either way.

If it is gone, it is **Test and release → App integrity → App signing →
Request upload key reset**, attaching a PEM of the new certificate:

```powershell
keytool -export -rfc -keystore C:/dev/keys/bourbon-cup-upload.keystore -alias bourbon-cup -file upload_certificate.pem
```

A day or two, and nothing else in the submission is blocked by it — the
functions, the rules, the demo seed, the edition locks and every App content
section are all independent. Do them while it sits.

### Version bumps

`versionCode` in `android/app/build.gradle` must increase on every upload;
`versionName` is what humans see. Play rejects a re-used `versionCode` with a
message that says exactly that, so this one at least fails loudly.

**It starts at 100 rather than at 1**, because this package name is not new to
Play — the bubblewrap TWA was uploaded to this same listing, and every
`versionCode` it ever used is spent. Capacitor's generated project counts from
1, which is precisely the range those uploads occupied, so the first upload of
the new app would have been refused for a reason that has nothing to do with
the build. The number only ever goes up, so overshooting costs nothing.

### Icons

`npm run build:app-icons` renders every launcher icon on both platforms from
`public/BC ICON-01.svg`. Run it after any `cap add`, because **both** platforms
seed their icon slots with Capacitor's own logo and it looks close enough to a
real icon in the tooling to ship.

The Android adaptive icon is the fussy one: its foreground is the bare mark on
transparency over a flat colour, not the square artwork. A launcher masks the
outer ring away, so the full tile rendered there reads as a sticker inside a
circle rather than as an icon.

---

## 2. What used to be here: removing the URL bar

Nothing to do. This section was the Digital Asset Links handshake — the step
that most often got a TWA rejected, and the one that could not be completed
until after the first upload because the fingerprint it needed was Google's
re-signing certificate rather than yours.

A Capacitor app is a real native app with no browser chrome to hide, so the
handshake does not apply and `public/.well-known/assetlinks.json` is gone.

Kept as a heading because the sections below are numbered and referenced, and
because "why is there no assetlinks file any more" is a question worth one
paragraph.

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
> Instructions: Sign in with any Google account of your own, enter the
> tournament password below when prompted, then tap any unclaimed name on the
> roster screen. This unlocks score entry, the photo library upload, side bets
> and the Admin tabs.
>
> Please use the tournament named "DEMO — Testers". If the app opens on a
> different year, tap "Switch tournament" on the roster screen (or ☰ →
> Tournaments) and choose it. The other years are completed tournaments,
> closed to new entries, so a name cannot be claimed in them — the app says
> so on screen. Inside the demo tournament every signed-in account gets the
> Admin tabs, so nothing needs granting; changes there affect only the demo.
>
> Username: `<none — no credentials are handed over>`
> Password: `<none>`
> Any other instructions: Tournament password: `<from Admin → Event → Access>`

**No account is handed over, on purpose** — see `store-submission.md` §1.4 for
why (Google's per-phone cap, and a fresh account signed into from an unfamiliar
network is exactly what Google's risk checks challenge). The Admin tabs used to
be the one thing this could not reach; a demo edition grants them to any member
now, which is what makes "sign in with your own account" a complete answer.

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

## 5. Notifications and the camera on Android

**Push on Android is now native, and that is a change.** Inside a TWA it was
web push — the site's own service worker, the VAPID key, delegated to the
Android notification system. A Capacitor build has no service worker, so
`lib/notifications` takes its native branch here exactly as it does on iOS, and
`@capacitor-firebase/messaging` talks to FCM directly.

The good news is that FCM is FCM: the token is the same kind of token, the
`bc_notification_tokens` row is the same shape, and `sendToPlayer` in
`functions/index.js` is untouched. The `platform` field on the row now reads
`"android"` rather than `"web"`, which is the point of it.

Two by-hand consequences:

- **`google-services.json`** from the Firebase console, into
  `android/app/`. Gitignored, like its iOS counterpart, and **without it native
  sign-in and push both silently do nothing**.
- **The signing SHA-1 and SHA-256** registered against the Android app in
  Firebase, or native Google sign-in fails. Take them from the keystore
  (`keytool -list -v -keystore …`) and, once Play App Signing is on, from
  **Release → Setup → App integrity** as well — Play re-signs, so the
  fingerprint a shipped build presents is Google's, not yours.

  **Which means the first upload is a throwaway, and it has to be.** Google's
  app-signing certificate does not exist until a bundle has been uploaded and
  Play App Signing is enrolled, so the fingerprint cannot be in
  `google-services.json` at the time the first bundle is built. Upload it,
  copy both fingerprints into Firebase, **re-download `google-services.json`
  into `android/app/`**, bump the `versionCode`, and build again. That second
  bundle is the one testers get.

  Skip it and the failure is the invisible kind: Google sign-in works
  perfectly for whoever built the bundle — your local release build presents
  YOUR certificate, which is registered — and fails for every single person
  who installs from Play, because theirs presents Google's, which is not. WBC
  learned this one the hard way; its `android/app/build.gradle` still carries
  the note, which is why its `versionCode` starts at 2.

`VITE_FCM_VAPID_KEY` is still needed, but only for the **web** app now. It has
nothing to do with either store build.

### The camera, and why it declares no permission

`POST_NOTIFICATIONS` is not in `AndroidManifest.xml` and does not need to be —
`@capacitor-firebase/messaging` merges it in from its own manifest, which is
why push can prompt on Android 13+ without the app asking for anything.

The camera is the opposite case: the manifest declares **no `CAMERA`
permission on purpose**. `@capacitor/camera` checks `isPermissionDeclared`
first, and when the app has not declared it the plugin skips the runtime
request entirely and fires an `IMAGE_CAPTURE` intent — the system camera app
holds the permission, not this app. Declaring it would buy a permission dialog
on every phone and a `uses-feature` entry to stop Play filtering the app off
devices without a camera, in exchange for nothing.

**The cost is Android 9 and below (API ≤ 28), where the 📷 button does not
work.** `minSdkVersion` is 24, so those phones can install the app. The chain
is worth writing down because nothing about it is guessable from the symptom:

- `saveToGallery: true` needs `WRITE_EXTERNAL_STORAGE` on API ≤ 28 — on 29 and
  up the plugin writes through MediaStore and needs no permission at all, which
  is why this is only ever an old-phone problem.
- The plugin asks for it, the system refuses undeclared permissions without
  showing a dialog, and then its permission callback re-checks `CAMERA`
  **without** the `isPermissionDeclared` guard it used on the way in — so it
  rejects with `User denied access to camera` on a phone where nobody was asked
  anything.

It used to fail **silently**: `PhotosView`'s catch swallowed anything matching
`/denied/`, so the button did nothing, twice, with nothing on screen to
disagree with. It now says camera access is off and points at Settings — which
is the truth on iOS, where a real refusal produces the same message, and is at
least visible on an old Android.

Three ways out if it ever matters, none of them taken:

- `minSdkVersion = 29`, which makes the broken path unreachable. It is the
  clean fix and the one with an **invisible** failure mode: an excluded phone
  is told by the Play Store that the app is incompatible, and the man holding
  it has no way to report that to anybody.
- Declare `CAMERA` and `WRITE_EXTERNAL_STORAGE` (`maxSdkVersion="28"`), which
  fixes ≤ 28 and adds a permission dialog for everybody else.
- `saveToGallery: false`, which fixes ≤ 28 by dropping a feature on every
  phone. The photo already uploads to the shared album either way; what would
  go is the copy in the photographer's own roll.

The field is sixteen men, and an Android phone that never saw Android 10 was
last sold in 2019. Left as it is, deliberately, and recorded here so the next
person to read a "denied" report knows it is not the permission it names.

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
`npm run shots:store -- --write` writes Play's set to `store/play` at
1080×1920, alongside Apple's at `store/ios`.

**Apple's set cannot be uploaded here**, which is the trap this paragraph used
to walk into by naming a viewport nobody could reach. Play takes at least two
phone screenshots, each side between 320px and 3840px, and refuses any image
whose longer side is more than twice the shorter. Apple's required 1290×2796 is
2.17:1, so every file in Apple's set is refused at Play's upload screen. Play
also rejects an alpha channel, with an error that mentions something else.
Both are handled in the script; neither is visible in the file you are
holding.

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

## 7. Do you need production at all? — read this before §8

**This section can delete the whole of §8, and for this app it probably
should.** It was missing from the first cut of this file, which went straight
to the closed test as though production were the only destination. WBC's own
submission doc got here first; this is the same reasoning.

Play has three testing tracks above nothing, and they are not steps on a
ladder:

| Track | Testers | Wait | Counts toward production access |
| --- | --- | --- | --- |
| **Internal** | up to 100 | minutes, no review queue | **No** |
| Closed | unlimited | full review | **Yes** — 12 for 14 days |
| Open | unlimited | full review | Yes |

**Internal testing installs through the Play Store, updates automatically, and
needs no minimum tester count, no 14-day wait and no production-access
application.** You can start one before the store listing is finished.

For this app that is not a shortcut, it is the correct destination. The
Bourbon Cup is sixteen men behind a tournament password. A public production
listing makes it findable by strangers who can do nothing with it, in exchange
for three weeks of grind. **Internal testing is the Android counterpart of the
Unlisted route already chosen on iOS** (`app-store.md` §8) — private
distribution by link, to people you name.

So:

- **If the field just needs the app on their phones** — internal testing.
  Upload, add sixteen email addresses, send the link. Same day. Skip §8
  entirely, and skip §6's listing copy until you actually want a listing.
- **Only if you want The Bourbon Cup publicly listed on Play** does §8 apply.

**And the requirement is per app.** Production access earned by one app does
not carry to the next: a personal account created after 13 November 2023 runs
a fresh 12-tester, 14-day closed test for every new app it wants in
production. Read that off the Console before planning around it — the numbers
and the scope have both moved before.

One consequence worth knowing either way: internal testing contributes
**nothing** to the closed-testing count. A month of it with a hundred people
leaves the production checklist at zero. The two tracks are separate roads,
not a sequence, so choosing internal now costs nothing later except starting
the fourteen days when you decide you want production.

### Setting it up

**Testing → Internal testing → Create new release**, upload the AAB, roll out.
Then **Testers**, paste the email addresses, and copy the opt-in URL.

You still owe some of App content even on this track — a privacy policy URL,
the content rating questionnaire (§4), App access (§3), ads and target
audience. What you skip is the **Data safety form**, which is the long one:
apps active only on internal testing are exempt from it.

### The message to send, and the one line that has to be in it

The failure mode of internal testing is not a broken app, it is a tester who
never gets one. **The account that opts in has to be the account signed into
the Play Store on the phone**, and a man with a work Google account on his
phone and a personal one on your list sees "item not found" — or nothing at
all. He has no way to diagnose that, and it looks like your app is broken.

So say it before it happens:

```
The Bourbon Cup is on Android now. Two things, in this order:

1. Reply with the Google account your phone uses for the Play Store.
   Settings → Google → check the address at the top. It has to be that
   one — if you send me a different address the link will tell you the
   app doesn't exist.

2. Once I've added you I'll send a link. Tap it, tap "Become a tester",
   then tap the Play Store link underneath. It installs like any other
   app and updates itself from then on.

You won't find it by searching the Play Store. That's deliberate — it's
only for us.
```

Collect the addresses first and add them all at once. A tester added after
they have already tapped the link has to tap it again, which is one more
message than it is worth.

---

## 8. The closed-testing requirement — the part that failed last time

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

**Internal testing is the route (§7), so stop after step 7** — add the testers,
send the link, done. Steps 8 and 9 are the production road, kept for reference.

1. Everything in `store-submission.md` §1 — which is down to the rules deploy;
   the functions, the VAPID key and the demo edition are already done, and that
   file's status table is the record of it. No reviewer account is handed to
   either store. **BY HAND**
2. Deploy the site, so both static pages and the guest door are live. (Vercel
   does this on merge.) The store builds no longer depend on this, but the web
   app and the privacy URLs do.
3. `google-services.json` into `android/app/`, and the signing fingerprints
   into Firebase — §5. **BY HAND**
4. Create the keystore, `npm run android:bundle`, back up the keystore. **BY HAND**
5. Upload to internal testing, fill in App access, content rating and the
   privacy policy URL. **BY HAND**
6. **Then do step 4 again.** Copy Play's app-signing SHA-1 and SHA-256 into
   Firebase, re-download `google-services.json`, bump the `versionCode` and
   upload the rebuilt bundle — §5. The first upload exists to mint the
   certificate; without this, Google sign-in fails for everyone but you.
   **BY HAND**
7. Collect the sixteen Google accounts, add them all at once, send the opt-in
   link — §7. **BY HAND**
8. *(Production only)* Promote to closed testing and run the fourteen days as
   §8 describes — with things to do, more than one build, and feedback written
   down. **BY HAND**
9. *(Production only)* Apply for production access, quoting the feedback. **BY HAND**
