# Getting The Bourbon Cup into the App Store

Read [`store-submission.md`](./store-submission.md) first — the reviewer
account, the data disclosures, the age rating and the deploy prerequisites are
there and are not repeated here.

**It compiles, and it has been uploaded.** On 31 Aug 2026 the first archive of
this app went to App Store Connect from the MacBook: `npm run ios:sync`, Xcode,
Archive, Distribute → Upload, accepted. Everything in §2 and §3 had until then
never been through a Swift compiler, and that sentence stood at the top of this
file for months — it is worth keeping the shape of it as a reminder of what
"the code is written" is worth on its own.

What that upload does NOT establish is §2: every one of those four subsystems
fails on a phone rather than at build time, so **§6 is now the real starting
line.** An accepted binary means the project is configured, not that Google
sign-in works inside a WKWebView.

---

## 1. Why there is a native shell at all

Android *has* a first-party way to ship a web app as an app — a Trusted Web
Activity — and this repo used to use it. **iOS has no equivalent**, which is
why Capacitor arrived here first. Android has since moved to Capacitor as well,
so the two platforms are now one shape (see `play-store.md`); this section is
about why the shell had to exist at all.

The App Store takes a signed `.ipa` built from an Xcode project, so a native
shell has to exist, and the shell has to hold a `WKWebView`.

Two consequences, and the second is the expensive one:

- **The web build is bundled into the binary**, not loaded from
  `thebourboncup.com`. Capacitor will happily point the webview at a remote URL
  (`server.url`), and doing that would have made this a one-day job. It is also
  the fastest known route to a **guideline 4.2** rejection — an app whose entire
  content is a remote website is the exact thing 4.2 was written for. So
  `capacitor.config.json` has no `server` block, and **Vercel is no longer the
  release channel for iOS**: shipping a change there means a new build and a
  new App Store review. Android is the same now that it is Capacitor too — the
  difference used to be real and is not any more.
- **A bundled build runs from `capacitor://localhost`.** Four subsystems in
  this repo assumed `https://thebourboncup.com`, and all four broke. That is §2.

Maize N Que went down this road first: `src/lib/notifications.js` opened by
saying it was ported from that app *minus its native (Capacitor) branch*. The
branch is back.

---

## 2. The four things WKWebView breaks — and how each is handled

None of these fail at build time. All four would fail on a reviewer's phone.

### 2.1 Google sign-in — `src/lib/auth.js`

`signInWithPopup` and its `signInWithRedirect` fallback are both dead inside a
webview: **Google refuses OAuth to an embedded user agent** and answers
`403 disallowed_useragent`. There is no user-agent trick worth shipping.

`signIn()` now forks. Native goes through `@capacitor-firebase/authentication`,
which opens the system sheet and hands back a **provider credential**;
`signInWithCredential` turns that into the same Firebase user a popup would
have produced. Same uid, same `bc_accounts` document, same claim screen — which
is why nothing downstream of the sign-in needed changing.

Three details worth not undoing:

- **`skipNativeAuth: true`** in `capacitor.config.json`. The plugin would
  otherwise sign into the *native* Firebase SDK, and the session this app runs
  on is the JS SDK's — Firestore and the security rules read that token. Two
  SDKs each holding half a login is the bug that shape invites.
- **Apple's `rawNonce` is load-bearing.** The plugin sends Apple a SHA-256 of a
  nonce and returns the raw one; Firebase hashes it again and compares. Drop it
  and the credential is rejected with an error that never mentions nonces.
- **A cancelled sheet re-throws** rather than resolving null. The sign-in
  screen leaves its buttons busy on a resolved call, because a resolved call
  means the screen is about to be replaced. Resolving null on a cancel would
  leave every button dead until the app restarted.

**Guideline 4.8** requires Sign in with Apple wherever a third-party social
login is offered. Both are offered, rendered from `PROVIDERS` as two buttons of
identical size, which is what 4.8 asks for. Nothing to do; worth not breaking.

### 2.2 Push notifications — `src/lib/notifications.js`

No service worker, no Notification API, no Web Push, and the VAPID key is
meaningless. Native goes through `@capacitor-firebase/messaging`, which
swizzles APNs underneath and returns an **FCM token** rather than a raw APNs
one — the detail that keeps this cheap. `writeTokenRow` is now shared by both
paths, so `bc_notification_tokens` gets one shape.

`sendToPlayer` was NOT untouched, though this file said so for a while. It sent
**data-only** — right for the web, where the service worker reads title and body
out of the data block and renders them itself — and a WKWebView has no service
worker. An APNs payload with no `aps.alert` is a silent background push with
nothing to display, so the send succeeded, FCM reported one delivery, and the
phone stayed dark. It now carries per-platform `apns` and `android` blocks
alongside the data, rather than a top-level `notification`, which the web SDK
would auto-display on top of the worker's own — one push, two banners, on the
platform that was already working. Rows carry a `platform` field — `"web"`,
`"ios"` or `"android"`, off `platformName()` rather than off `isNative()`,
which mattered the moment Android stopped being a browser. The rule is
`allow write: if isMember()` with no field list, so **no rules change is
needed.**

Two consequences that are real and not bugs:

- **Foreground banners are drawn by iOS**, from `presentationOptions` in
  `capacitor.config.json`, so `initForegroundNotifications` returns early on
  native. Re-rendering would show every push twice.
- **The app badge is set by the app, not by the push.** `navigator.setAppBadge`
  does not exist in a WKWebView, so `syncAppBadge` goes through
  `@capawesome/capacitor-badge` on native. It counts with
  `pendingAttestations` — the same function the web badge and the Scoring
  screen count with.

  What it does not do is the service worker's other job: increment while the
  app is closed. iOS runs no JavaScript for this app in the background, so a
  card signed overnight moves the badge only when the app is next opened. The
  alternative — an absolute count in the APNs payload from `sendToPlayer` —
  was rejected deliberately: that count would be a **second implementation**
  of "what does this player still owe", and the two would be scoped
  differently the moment either changed. It would show up as a badge that
  jumps to a different number when the app opens. A badge that is late is a
  smaller lie than a badge that disagrees with the screen behind it.

### 2.3 The `/api` calls — `src/lib/platform.js`

Six relative fetches (`lib/ghin.js` ×2, `AdminView.jsx` ×4) resolve against the
app bundle under `capacitor://localhost` and 404 — not as a network error,
which is what made it hard to recognise. All six now go through `apiUrl()`,
which returns the path unchanged on web and prefixes
`https://www.thebourboncup.com` on native. Overridable with `VITE_API_BASE`,
for the same reason `VITE_API_PROXY` exists.

**The `www.` is load-bearing, and it was missing.** The apex redirects:

```
$ curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' \
    https://thebourboncup.com/api/courses?search=oak
307 -> https://www.thebourboncup.com/api/courses?search=oak
```

`fetch` follows a redirect happily, but a CROSS-ORIGIN fetch applies CORS to
every hop, and Vercel's domain redirect carries no `Access-Control-Allow-Origin`.
So the request died on the first hop and never reached the handler — which also
means the CORS headers added to `api/courses.js` below were never consulted.
Every course search and every GHIN lookup, on every phone, came back empty,
while the identical call worked on the web where nothing redirects.

An absolute base for a cross-origin API has to be the CANONICAL host, not
whichever name the domain also answers to.

`api/courses.js` also grew CORS headers. It had been setting
`Access-Control-Allow-Origin` **on the success path only**, so a 400 or a 500
came back without it and the browser refused to let the caller read the reason.
Same-origin on the web, so nobody ever saw it; cross-origin from the app, so
everybody would have.

### 2.4 The iOS chrome — `src/lib/platform.js`, `capacitor.config.json`

Every `apple-mobile-web-app-*` tag in `index.html` — including the hard-won
`status-bar-style: black` finding measured off an iPhone 16 Pro — is a Safari
home-screen mechanism that does **nothing** inside a WKWebView.
`applyNativeChrome()` is the same decision restated natively, called from
`App.jsx` on the `darkMode` state so the bar follows the theme pill. The app
has a light mode, and light text on a near-white bar is a status bar with
nothing readable in it.

`UIViewControllerBasedStatusBarAppearance` is **false** in `Info.plist` — that
is required for the plugin's `setStyle` to have any effect, and it is easy to
"fix" back to true.

Trip Info's house link stays a real anchor and only preempts its own click on
native, routing through `@capacitor/browser`. A `target="_blank"` there opens
VRBO inside the app's webview with no address bar and no way back.

### 2.5 What does not break

Most of the app: Firestore, the scoring engine, the archive chunk, IndexedDB
auth persistence, `<input type="file">` for photo upload, and every layout
decision. The four above are the whole list.

---

## 3. Passing guideline 4.2

A webview wrapper is close to an automatic bounce in 2026 unless the native
adaptation is real. The useful thing about §2 is that its fixes *are* the
adaptation — they are not decoration added to pass review:

- **Native Sign in with Apple and native Google sign-in** — a system sheet and
  Face ID, not a web form.
- **Native push through APNs**, which Safari cannot deliver to a
  non-home-screen web app at all.
- **Haptics and the system photo sheet.** There WAS a 📷 button here, on native
  only, driving `@capacitor/camera` straight to the capture — and it was listed
  as the most visible adaptation of the five. It is gone: the file input's own
  iOS sheet already offers Take Photo or Video beside Photo Library, so the
  button was a second control doing a subset of the first one's job, asked of
  somebody standing on a tee box.
  Worth knowing when writing review notes: the camera is no longer part of this
  argument. What is left is stronger anyway — a system sign-in sheet, APNs, and
  a binary that opens with no network — and none of it is a thing a Safari tab
  can do.
- **Haptics** — a light impact as a stroke lands, a success notification when a
  card is signed. `tapFeedback` / `commitFeedback` in `lib/platform`, both
  fire-and-forget so a score posts whether or not the taptic engine answered.
- **The build ships inside the binary**, so the app opens with no network.

Two things that would sink it, both easy to reintroduce:

- Any visible browser chrome, or an external link that opens in the webview.
- Pointing `capacitor.config.json` at a remote `server.url`.

Say the adaptation out loud in App Review notes (§7). A reviewer who has to
discover it will not.

---

## 4. What is configured in `ios/`

`ios/` **is committed**, unlike the Android project, because it is edited by
hand. `ios/.gitignore` covers what Capacitor generates.

| File | What is set, and why |
| --- | --- |
| `App/Info.plist` | Camera and photo-library usage strings (**a missing one is a crash**, not a warning, the first time the picker opens — and it is the reviewer who finds it). `ITSAppUsesNonExemptEncryption = false`, which skips the export-compliance question on every upload. Portrait only. A **placeholder** URL scheme for the reversed Google client ID. |
| `App/AppDelegate.swift` | `FirebaseApp.configure()`, which Capacitor's stock template does not call. Both capacitor-firebase plugins build their native Firebase objects as the bridge loads plugins — before any of our JavaScript — so without it the authentication plugin throws, the bridge reports "JS Eval error", React never mounts and the app stops on the launch image. Needed even though `skipNativeAuth` is true: that flag decides which SDK holds the session, not whether the native one is initialised. |
| `App/App.entitlements` | `aps-environment` (Xcode rewrites it to `production` on archive — do not set it by hand) and `com.apple.developer.applesignin`. |
| `App/PrivacyInfo.xcprivacy` | The privacy manifest. Required since May 2024; the **upload** is rejected without one. Declares the same data as `store-submission.md` §2, plus required-reason APIs for UserDefaults (`CA92.1`), file timestamps (`C617.1`), disk space (`E174.1`) and boot time (`35F9.1`). Registered in the Resources build phase, or it would sit in the repo and never ship. |
| `App.xcodeproj` | `CODE_SIGN_ENTITLEMENTS`, and `TARGETED_DEVICE_FAMILY = "1"` — **iPhone only**. Declaring iPad means a reviewer opens it on an iPad, and every layout call in this app was made for a phone held one-handed on a tee box. |
| `Assets.xcassets` | The real icon and launch image, from `npm run build:app-icons`. |

**None of it can be compiled here, so it is tested as files.**
`scripts/native-projects.test.js` runs in the ordinary `npm test` suite and reads
the plists, the pbxproj and the icon's PNG header, asserting that each setting
in the table above is still there. It cannot tell you the app builds; it tells
you that a `cap add ios`, a merge or a well-meant simplification has not
quietly dropped a key whose absence you would otherwise discover on an upload
days later. The 4.2 trap is in there too: **the suite fails if
`capacitor.config.json` grows a `server.url`.**

**`npm run build:app-icons`** (`scripts/app-icons.mjs`) renders
`public/BC ICON-01.svg` — the same mark the PWA and the Play listing use — to a
1024×1024 icon and three 2732×2732 splash images. Run it after any
`cap add`, because both platforms seed their icon slots with **Capacitor's own
logo**, which looks close enough to a real icon in the Xcode navigator to ship.
The script asserts the icon comes out with **no alpha channel**: Apple rejects
the upload for the channel being present, not for any pixel being transparent.

---

## 5. The by-hand setup

Nothing here can be done from this repo. All of it is required before the app
will run, and most of it fails silently.

**Status, checked on 31 Aug 2026 rather than remembered** — the same discipline
as `store-submission.md` §1, and for the same reason: a list that still says
"do this" long after it was done is how an evening gets spent redoing it.

| | State | How that was established |
| --- | --- | --- |
| 1. `GoogleService-Info.plist` | **In place** | On the build Mac at `ios/App/App/`, dated 16 Aug. `plutil` says `PROJECT_ID` = `the-bourbon-cup`, `BUNDLE_ID` = `com.thebourboncup.app`, `GOOGLE_APP_ID` = `1:957218531964:ios:07e2…` — an `:ios:` app, not the web one. Per-machine and gitignored, so this is a fact about that Mac, not about the repo. |
| 2. Reversed client ID | **Agrees** | The file's `REVERSED_CLIENT_ID` and the scheme committed in `Info.plist` are the same string, `…957218531964-c6ru1h658nj6udpbbbfd756db6jf9hb3`. So the iOS app has not been re-registered since it was committed. |
| 3. APNs key | **Uploaded** | Firebase → Cloud Messaging shows key `7UA9A9SR3K` under both Development and Production with Team ID `7RRL56R755`, which matches `DEVELOPMENT_TEAM` in `project.pbxproj`. Both slots with one Key ID is correct, not a double upload. |
| 4. Sign in with Apple on the App ID | **Enabled** | Checked in the developer portal, Identifiers → `com.thebourboncup.app`, 31 Aug 2026. Nothing in the repo can see this, so it is a fact with a date on it and no way to re-derive. Missing it fails SIGNING with an entitlement mismatch that never mentions Apple. |
| 5. Push Notifications on the App ID | **Enabled** | Same page, same date. |
| 6. Build on a Mac | **Done** — 1.0 (1) 31 Aug, 1.0 (2) 2 Sep 2026 | Archived from `~/dev/bourbon-cup` and accepted by App Store Connect. **§5 is complete.** Export compliance needed no questionnaire, which is `ITSAppUsesNonExemptEncryption` in `Info.plist` doing its job. |

While the Keys page was open, the two `.p8`s were seen side by side and the
column that tells them apart is exactly as described below: `7UA9A9SR3K`
("App APNs") reads **Team Scoped (All topics) · Sandbox & Production**, and
`9K7J7J2VGT` ("Bourbon Cup Apple Sign In") reads a dash. Three more sign-in
keys sit beside them for WBC, MNQ and SFGL, which is why the filename is not a
safe way to pick one.

The repo side of iOS is finished: the `ios/` audit on 31 Aug found only
`UIRequiredDeviceCapabilities` still set to Capacitor's `armv7`, now `arm64`.
Camera and both photo-library usage strings are present, `PrivacyInfo.xcprivacy`
is in Copy Bundle Resources rather than only in the folder, the entitlements
carry `aps-environment` and `applesignin`, and `TARGETED_DEVICE_FAMILY` is 1 in
both configurations with no `~ipad` orientation array to contradict it.

Step 2 is **done and committed** — the real reversed client id is in
`Info.plist`, and the Xcode project already references
`GoogleService-Info.plist` in Copy Bundle Resources. What step 1 leaves on a
fresh clone is the FILE, which is gitignored and therefore per-machine: the
project points at a path nothing has put anything at, and the build stops at
Copy Bundle Resources with "Build input file cannot be found". Downloading it
into place is the whole of it.

1. **`GoogleService-Info.plist`** — Firebase console → Project settings →
   General → the **iOS** app → download, then put it at
   `ios/App/App/GoogleService-Info.plist`. The project reference is committed,
   so placing the file is enough — no drag, and no target checkbox to get
   wrong. A missing file now fails at Copy Bundle Resources, which is loud;
   the file itself stays gitignored.

   **Check the filename.** Every app in this estate downloads a file with the
   identical name, so a second download lands as `GoogleService-Info-2.plist`
   and macOS keeps the older one. Firebase looks for the exact name and finds
   nothing: the app builds, installs, launches, and fails to initialise
   Firebase at runtime. The `-2` is also outside the gitignore, which matches
   one exact path, so it turns up in `git status` ready to be committed.

   `grep -A1 PROJECT_ID` it before trusting it — it should say
   `the-bourbon-cup`. Same trap as the four identically-named `app-release.aab`
   files in `play-store.md` §1, and it bit the same way.

   > If Xcode's source control integration stages the plist (`A` in
   > `git status`), unstage it — `git restore --staged`. A path already in the
   > index is no longer subject to `.gitignore`.

   Without any of this, push never works.
2. **The reversed Google client ID** in `Info.plist` — **already there**:
   `com.googleusercontent.apps.957218531964-c6ru1h658nj6udpbbbfd756db6jf9hb3`,
   committed, because it is a public OAuth client identifier readable out of
   any shipped binary. Nothing to type.

   What is still worth doing once the plist from step 1 is in place is
   **checking the two agree**. `REVERSED_CLIENT_ID` in the downloaded file must
   be that same string; if the iOS app was ever deleted and re-registered in
   Firebase, it is a different id and the committed one is stale. Miss that and
   the Google sheet opens and never comes back — a failure with no error
   message anywhere in it.

   ```sh
   plutil -p ios/App/App/GoogleService-Info.plist \
     | grep -E 'PROJECT_ID|BUNDLE_ID|GOOGLE_APP_ID|REVERSED_CLIENT_ID'
   grep googleusercontent ios/App/App/Info.plist
   ```

   The second line is the committed half, and it is `grep googleusercontent`
   rather than `grep REVERSED_CLIENT_ID` because `Info.plist` has no key by
   that name — the id lives inside `CFBundleURLTypes` as a URL SCHEME, which
   is what the OAuth callback comes back to. Grepping for the key name
   returns nothing and reads exactly like a missing value.

   `PROJECT_ID` = `the-bourbon-cup`, `BUNDLE_ID` = `com.thebourboncup.app`,
   `GOOGLE_APP_ID` beginning `1:957218531964:ios:` — an id beginning `:web:`
   means the *web* app's file was downloaded, which carries no
   `REVERSED_CLIENT_ID` at all and is the other way this step goes wrong.
3. **An APNs authentication key (`.p8`)** uploaded to Firebase → Project
   Settings → Cloud Messaging — key **`7UA9A9SR3K`** ("App APNs"), which is
   TEAM SCOPED, so one key covers this app and the other three in the team.
   Without it iOS hands over a token FCM cannot exchange and **every send
   silently no-ops**.

   **A Sign in with Apple key is also a `.p8`, and uploading it here fails in a
   way that names nothing.** `9K7J7J2VGT` is this project's Apple-sign-in key;
   it spent an evening in this slot, and every push came back
   `messaging/third-party-auth-error: Invalid APNs credential.` — while Apple
   sign-in went on working perfectly, because that key was busy doing its real
   job. Apple's Keys list tells them apart in one column: an APNs key has
   **APNS CONFIG** populated ("Team Scoped (All topics)"), and a sign-in key
   has a dash. Check that column before uploading, not the filename.

   Do not revoke `9K7J7J2VGT` while tidying up. It is configured in Firebase →
   Authentication → Sign-in method → Apple, and revoking it breaks sign-in for
   everybody. Removing it from Cloud Messaging is the only removal wanted.

   It appears in the console under BOTH "Development APNs auth key" and
   "Production APNs auth key" with the same Key ID, and that is correct rather
   than a double upload: a `.p8` is environment-agnostic and covers sandbox and
   production at once, which is the whole reason it beats the per-environment
   certificates it replaced.

   The Team ID beside it must match `DEVELOPMENT_TEAM` in
   `App.xcodeproj/project.pbxproj` — both are `7RRL56R755`. If those two ever
   disagree the phone still registers and still hands back a token, and every
   send fails the APNs handshake with nothing visible at either end.
4. **Sign in with Apple** enabled on the App ID in the Apple Developer portal.
   This is separate from the Services ID the *web* flow uses; both must exist.
   Missing it fails signing with an entitlement mismatch, which says nothing
   about Apple sign-in.
5. **Push Notifications** capability on the App ID.
6. On a Mac: `npm run ios:sync`, then `npx cap open ios`. Set the
   signing team, and build. Capacitor 8 uses Swift Package Manager, so there is
   no CocoaPods step.

---

## 6. TestFlight, before submitting anything

Free, no review for internal testers, and the only way to find out whether §2
actually works. Up to 100 internal testers, each needing an App Store Connect
user role — fine for a field of sixteen, and faster than external testing,
which needs Beta App Review.

### There are TWO review-notes fields and they are not the same one

This cost a rejection on 2 Sep 2026 — **Guideline 2.1(a), "unable to
successfully access all or part of the app"**, on the BETA review, with §7's
notes sitting complete and unread the whole time.

| Queue | Where its notes live | Who reads them |
| --- | --- | --- |
| App Store review | the version page → **App Review** (left sidebar) | the reviewer of a submitted version |
| **Beta App Review** | **TestFlight → Test Information → Beta App Review Information** | the reviewer of an external TestFlight group |

Filling one does nothing for the other. The beta reviewer met the sign-in
screen with no instructions at all, no way to know an access code existed, and
correctly reported that they could not get in.

**Both fields get the §7 block.** Copy it into each; they are edited
independently and neither warns that the other is empty.

The credential fields are the awkward part, because this app has no
email-and-password sign-in to give. Ticking **Sign-in required** makes User
Name and Password mandatory, so they carry the instruction rather than a
credential:

- **User Name:** `No account needed — tap "Sign in with Apple"`
- **Password:** the reviewer code

That is honest rather than a dodge — the code IS the credential, and the notes
say so in the sentence above it. Apple's own message offers "a demonstration
mode that exhibits the app's full features" as an alternative to an account,
which is what the guest door plus `bc_demo` are; say so in the reply.

**Do not add an email-and-password login to satisfy this.** It would be a third
permanent sign-in path, with its own account-deletion obligations under
5.1.1(v) and its own console provider to enable, bought to appease one
reviewer who has not yet seen the instructions.

**And check whether external testing is wanted at all.** The field installs
from the unlisted App Store link once that is approved, and internal testers
need no review — so an external group created only to try a build is a review
queue entered for nothing.

Test these specifically. They are the ones that pass in a simulator and fail on
hardware:

- Sign in with Google, then with Apple, both from a cold install.
- Cancel each sheet halfway and check the buttons come back (§2.1).
- Receive a push with the app closed, and one with it open — exactly one
  banner, not two.
- Open the house link from Trip Info and get back.
- Upload a photo from the library and watch it land.
- **On a NON-DIRECTOR account, open the claim screen on the CUP and check the
  roster is tappable.** This caught a locked `bc_2026` on 2 Sep 2026, with the
  app days from the field. A locked edition refuses the claim write for
  everybody except a director — `canWriteEdition()` is `isMember() &&
  (editionOpen() || isDirector())` — and the screen greys the roster only for
  non-directors (`editionLocked={isEditionLocked(activeEdition) &&
  !isDirectorUser}`). So both directors saw a normal roster and wrote straight
  through, and the fourteen men who would have hit it did not have the app yet.
  It would have arrived as fourteen texts from a first tee.

  Likely cause when it happens: **"Lock all but 2026"** run while a different
  edition was active. `bulkLockVerdict` locks every edition OTHER than the
  active one, so firing it from inside 2025 or the demo sweeps the cup up with
  the rest — and can take `bc_demo` with it, which kills the reviewer's path
  as well. Check both. The tell on screen is a card headed "This tournament is
  closed"; the fix is Admin → Event → Editions.

  A director cannot run this check from their own account. That is the whole
  point of it.

- **Sign in on a SECOND account, switch to "DEMO — Testers", and open Admin.**
  That is the path the reviewer takes (`store-submission.md` §1.4): every member
  administers a demo, so the tab should be there without anybody granting a
  crown, and a save should stick after a reload rather than reverting. Three
  cards should be ABSENT — Editions, Access and the crown toggle in the player
  modal. Then switch to a real year on the same account and check the Admin tab
  is gone again. If the tab is there and saves revert, the rules have not been
  deployed (§1.2 in `store-submission.md`).
- Leave a card unattested, force-quit the app, reopen it — the badge should
  arrive then, not before (§2.2).
- Search for a course in Admin → Courses (that is the `/api` path, §2.3).
- Flip the theme pill and watch the status bar follow.
- Delete the account, and check the three outcomes in the Firebase console.
  **Do this one LAST, and on the account you are willing to lose.** It works —
  verified on a device: the membership document goes, the roster row survives
  unlinked with `auth_uid: null`, and the player's push tokens are deleted with
  it. What that costs is everything the account had: signing in again means
  presenting the tournament password to mint a NEW membership, on a NEW uid,
  **without the director flag** — because the crown lives on the membership
  document that was just deleted. If it was the only director, nobody can
  restore it from inside the app and the way back is a console edit
  (`is_director: true` on the new `bc_accounts/{uid}`), exactly as for the
  first one.

  It is also the proof that the CALLABLE TRANSPORT works from a Capacitor
  build. `deleteAccount` and `sendTestPush` are both v2 callables invoked from
  `capacitor://localhost`; if one of them completes, a CORS or origin problem
  is not what is wrong with the other.

Builds expire after 90 days. Do not start TestFlight until §5 is done, or the
field tests a broken build and stops trusting the next one.

---

## 7. Review notes to submit with the build

**Paste this into BOTH notes fields** — the version page's App Review
Information and TestFlight's Beta App Review Information. They are separate
queues with separate reviewers, and filling one leaves the other blank; see §6.

No account is handed over — see `store-submission.md` §1.4 for why, and for how
the Admin tabs are reachable without one. What IS handed over is the **reviewer
code**, which is not the tournament password: it mints a membership the rules
confine to demo editions, so the string written into this form cannot reach the
cup and never has to be rotated. Set it in Admin → Event → Access and paste the
same value into Play's App access form.

**The demo edition is load-bearing for exactly this**, which is worth knowing
before anybody retires it. The guest door covers the read-only half of a
review and needs nothing from us, but a reviewer who wants to SIGN IN has to
claim a name, and that needs an unlocked edition with unclaimed roster rows.
Only `bc_demo` is one: the current cup's roster belongs to the men playing it
and every past year is locked. Since store builds stopped opening on the demo
(`lib/defaultEdition`), switching to it is the reviewer's first step rather
than a fallback, and the note below says so in that order.

> The Bourbon Cup is the scoring app for one private annual golf tournament.
> It is submitted for unlisted distribution.
>
> **To see the app with no credentials:** tap "Look around as a guest" on the
> sign-in screen. This opens the entire app read-only — leaderboard, draw,
> scorecards, trip schedule, and ten years of tournament history — with no
> account. It is not a limited demo; it is the whole app without write access.
>
> **To reach scoring, photos and everything a player does:** tap **Sign in with
> Apple** and use the Apple ID already on your device, then enter the invite
> code below when prompted. There is no separate demo account to request — this
> app has no email-and-password sign-in, and Sign in with Apple needs nothing
> from us.
>
> **The invite code is not an account password and you are never asked to
> create one.** Sign in with Apple completes the authentication on its own;
> the code is a single shared string the tournament director gives to the
> whole group, the same for every member, and it authenticates nobody. It is
> the private tournament's front door, not a credential.
>
> Invite code: `<the REVIEWER code from Admin → Event → Access>`
>
> **Then switch to the tournament named "DEMO — Testers", before tapping a
> name.** The app opens on the current cup, whose roster is already claimed by
> the men playing it. Tap "Switch tournament" on the roster screen, or
> ☰ → Tournaments, and choose the one labelled DEMO. Then tap any unclaimed
> name there.
>
> The invite code above opens the demo tournament only — it is issued for review and
> deliberately cannot write to the tournament being played. If you tap a name
> outside the demo, the app will say so and point you back to the switcher.
> Every other year listed is a completed tournament, closed to new entries.
>
> **The Admin tab is open to you inside "DEMO — Testers".** One person in a real
> tournament is its director, and the Admin tabs are that role's tools — the
> roster, the draw, the courses, the tee sheet and the trip's budget. In the
> demo tournament every signed-in account gets them, so you can open and edit
> all of it without us granting anything. Changes you make there affect only
> the demo; the completed tournaments are unaffected. Nothing behind those
> screens is a purchase, a subscription, or a different app.
>
> **On the Betting tab:** the app records wagers players agree with each other
> in person, and settles them in person. It processes no payments, contains no
> in-app purchases, and has no connection to any payment provider. The dollar
> figures are a shared notepad.
>
> **Account deletion** is at My Account → Delete Account, and removes the
> authentication account, the membership record and all personal identifiers.
> The tournament roster entry survives, unlinked, because it carries scores
> other players attested to.
>
> If you test deletion, please do it **last**. It is a real deletion: signing
> in again creates a new account and needs the invite code above, and the
> roster name you claimed becomes free for somebody else.
>
> The app is iPhone-only by design and is used one-handed on a golf course.

---

### Guideline 4: the code screen may not look like a password

**1.0 (2) was rejected on 4 Sep 2026** for this, reviewed on an iPhone 17 Pro
Max:

> The app offers Sign in with Apple as a login option but does not follow the
> design and user experience requirements for Sign in with Apple.
> Specifically, users are required to provide or create a password after using
> Sign in with Apple even though account authentication is already handled by
> the Authentication Services framework so passwords are unnecessary.

Nothing was wrong with the mechanism, and nothing about it changed. The gate
screen asks for ONE SHARED CODE for a private group — the same string for all
sixteen men, checked by `firestore.rules`, authenticating nobody. It is the
tournament's front door, not a credential.

But it was a box placeheld **"Password"**, one tap after Sign in with Apple,
and a reviewer reads what is on the screen. Guideline 4 forbids demanding a
password on top of the sign-in that just happened, and that is exactly what it
looked like.

The screen is now three lines, and the ORDER is the argument:

> Signed in as: `name@example.com`
> **This tournament is private**
> Enter the invite code below

The account is already signed in; the tournament is a separate thing and it is
private; the box wants an invite to it. The box says **Invite code**, the
button says **Join tournament**, and no verb anywhere asks anybody to create,
choose or set anything — guideline 4 is about being made to *provide or create*
a password, so "create" would be the same rejection in a new word.

`gateScreenWording.test.js` pins the order and the vocabulary, because this is
a store requirement carried entirely by a handful of strings.

**The word "password" on that screen is a rejection.** The review notes above
say the same thing in their own paragraph, so the next reviewer is told before
they arrive rather than after.

---

## 8. Unlisted distribution

**APPROVED, 3 Sep 2026** — filed 2 Sep, answered the next day, case
`102951265981`, app id `6802036093`. The four sequencing traps below were all
avoided; the form itself is written for enterprises and none of its categories
fit, so **organization type** and **app category** both went to **Other**,
described as a private recurring event for a fixed group. "General public" is
the trap on the first — it is the answer that contradicts the request — and
"Productivity" on the second, which means workplace software.

Approval is permission, not publication. The version still has to clear App
Review; when it does and the release goes out, App Store Connect hands over the
unlisted URL, and that is the link for the iPhone half of the field.

Same route as Maize N Que, and for the same reason: this app is for sixteen
men, it is gated behind a tournament password, and it has no business being
searchable. Unlisted apps get a direct link and do not appear in search, charts
or recommendations.

The sequencing traps, which are what caught this last time:

1. **Submit to App Review first.** Apple declines unlisted requests for apps
   that have not been submitted, and for apps still in a beta or prerelease
   state.
2. **Put a line in the Review Notes** saying the app is intended for unlisted
   distribution.
3. **The request form must be filed by the Account Holder.** Submissions from
   any other App Store Connect role get bounced without a useful reason.
4. **It is one-way.** An app record converted to unlisted cannot be made public
   again.

The request lives at
<https://developer.apple.com/contact/request/unlisted-app-distribution>.

Unlisted does **not** mean unreviewed — §3 applies in full.

---

## 9. The order from here

**1.0 (2) was submitted to App Review on 2 Sep 2026, and the
unlisted-distribution request was filed the same evening.** Every step below is
done. What is left is waiting, and then whatever either queue answers.

The two run independently — the unlisted request is not part of App Review and
does not wait on it — so a rejection from one says nothing about the other.

1. ~~Everything in `store-submission.md` §1.~~
2. ~~All six items in §5.~~
3. ~~Build, run on a device, work through the §6 list.~~
4. ~~TestFlight to the field.~~ Internal testing only, via the **Dev Test**
   group. No external group exists, so Beta App Review gates nothing — the
   field will install from the unlisted App Store link. A beta submission of
   1.0 (1) was rejected under 2.1(a) on 2 Sep with the Beta App Review
   Information section empty; see §6. It was left unresolved deliberately.
5. ~~Screenshots at Apple's sizes.~~ One 6.9″ set (1290×2796) uploaded; Apple
   scales it into the 6.5″ slot, so one set covers both.
6. ~~App Privacy labels.~~ The seven types from `store-submission.md` §2, all
   App Functionality, all linked to identity, none used for tracking. **This
   is the gate that blocks Add for Review**, and the error names an Admin
   rather than the section, which is a slow way to find out.
7. ~~Age rating.~~ **Simulated Gambling: None. Contests: None.** Both were
   set wrong and cost a rejection on 2 Sep — simulated gambling plus an
   individual developer account is an automatic stop, refused before a human
   sees the app. `store-submission.md` §3.2 has the reasoning; the fix is the
   questionnaire and needs no new build.
8. ~~Submit to App Review with the notes in §7.~~
9. ~~File the unlisted-distribution request, as the Account Holder — §8.~~
   Filed 2 Sep 2026, **approved 3 Sep**. The form is written for enterprises distributing internal
   tools, and none of its categories fit: organization type and app category
   both go to **Other**, described as a private recurring event for a fixed
   group. "General public" is the trap on the first one — it is the answer that
   contradicts the request — and "Productivity" on the second, which means
   workplace software and puts the request in front of a reviewer expecting a
   business tool.

### What the submission run found, which nothing else would have

Two live faults, both invisible from a director's account, both caught only
because the reviewer path was walked on a plain Google account:

- **Neither access code was set.** A blank `code` is an OPEN DOOR, not a
  closed one — `codeOK()` treats blank as a pass, because that blank is the
  bootstrap that lets the first membership exist. Anyone signing in with any
  Google or Apple account was being minted an ordinary member of the live cup.
- **`bc_2026` was locked**, so none of the fourteen unclaimed men could have
  claimed a name. See §6; a director writes straight through the lock and sees
  a normal roster.

Neither is visible to a director and neither would have surfaced until the
wrong person hit it — a reviewer in the first case, the field on a first tee
in the second. Walk §6 on a non-director account before every release, not
just this one.

---

## 10. The listing copy

Apple's fields are not Play's, so `play-store.md` §6 does not transfer: Apple
has a **subtitle** and **keywords** that Play has no equivalent of, a shorter
name limit in practice, and a **promotional text** field that can be changed
WITHOUT shipping a new build — which is the one to use for anything that might
date, like "2026 draw is up".

Character limits are hard limits; App Store Connect truncates silently in some
fields and refuses in others.

**App Name** (30)

```
The Bourbon Cup
```

**Subtitle** (30) — shown under the name, indexed for search.

```
Golf trip scoring and history
```

**Promotional text** (170) — editable any time, no review.

```
Live scoring, the draw, side games and a decade of cup history — for one
annual golf trip and the sixteen men who play it.
```

**Keywords** (100, comma-separated, no spaces after commas). Do NOT repeat
words already in the name or subtitle; Apple indexes those anyway and the
space is better spent.

```
matchplay,scorecard,handicap,skins,fourball,scramble,pinehurst,tee,foursome
```

**Description** (4000). Adapted from Play's, with the two changes Apple
requires: no mention of another platform, and nothing that reads as a price or
a beta.

```
The Bourbon Cup is the scoring app for one annual match-play golf tournament —
two teams, four rounds, and a trophy that has changed hands since 2015.

Post scores hole by hole from the tee box. One phone in the group can enter for
all four players, and the leaderboard updates on everybody else's while they
walk. Cards are signed and attested by the people who played the round, the way
they always were on paper.

LEADERBOARD — the cup total, live, from the first tee shot to the handshake on
18.

SCORING — your group's card, with strokes worked out for the format you are
playing: fourball, scramble, Pinehurst, singles.

MATCHES — the whole draw, every round, with tee times and playing groups.

BETTING — skins, closest-to-the-pin and side bets between players, settled by
both sides agreeing rather than by the app deciding. The app records what was
agreed; it moves no money and has no purchases of any kind.

TRIP INFO — when it is, where everybody is staying, and the scorecard for every
course on the schedule.

DATA — ten cups of career records, head-to-heads, partnerships, and where each
year turned.

PHOTOS — the week, posted from the phone that took it.

Want a look first? Tap "Look around as a guest" on the sign-in screen and the
whole app opens read-only, with no account needed.

Scoring requires an account and the tournament password, which the tournament
director hands to the field.
```

**Support URL** — `https://thebourboncup.com/app`, which is a real page that
answers the question a support URL is for. Apple requires the URL to resolve
and to be about the app; a bare marketing site sometimes draws a query.

**Marketing URL** — `https://thebourboncup.com`

**Copyright** — `2026 Aaron Jensen`

**Category** — Primary: Sports. Secondary: none. Not Games; a scorekeeper for a
real tournament is not a game, and Games drags in the gambling questionnaire.

**Two different years live in this copy and only one of them is 2015.** The
tournament began in 2015 — that is what "changed hands since 2015" and the
feature graphic's SINCE 2015 assert, and it is about the cup. The archive the
app SHIPS starts at 2016, because that is where the spreadsheets everything is
imported from begin, so the Data tab's earliest year is 2016. The lines about
what the app contains therefore count cups rather than naming a year: "a decade
of cup history", "ten cups". Anchor those to 2015 and the listing promises a
year the app cannot show.

The BETTING paragraph's second sentence is load-bearing and should not be
trimmed for length: it is the same claim the age-rating questionnaire and the
review notes make (§3.2 in `store-submission.md`), and having it in the public
description too is what makes the three agree if anybody checks.
