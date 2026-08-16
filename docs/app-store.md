# Getting The Bourbon Cup into the App Store

Read [`store-submission.md`](./store-submission.md) first — the reviewer
account, the data disclosures, the age rating and the deploy prerequisites are
there and are not repeated here.

**The code is written. Nothing has been compiled.** Everything in §2 and §3
below exists in this repo; none of it has been through a Swift compiler,
because that needs a Mac and there isn't one in CI. Treat §5 as the real
starting line.

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
paths, so `bc_notification_tokens` gets one shape and `sendToPlayer` in
`functions/index.js` is untouched. Rows carry a `platform` field — `"web"`,
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
`https://thebourboncup.com` on native. Overridable with `VITE_API_BASE`, for
the same reason `VITE_API_PROXY` exists.

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
- **A native camera.** Photos gains a 📷 button on native only, driving
  `@capacitor/camera` straight to the capture and feeding the same upload
  pipeline the picker feeds. One tap from "something happened on 17" to a photo
  of it.
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
   ```

   `PROJECT_ID` = `the-bourbon-cup`, `BUNDLE_ID` = `com.thebourboncup.app`,
   `GOOGLE_APP_ID` beginning `1:957218531964:ios:` — an id beginning `:web:`
   means the *web* app's file was downloaded, which carries no
   `REVERSED_CLIENT_ID` at all and is the other way this step goes wrong.
3. **An APNs authentication key (`.p8`)** uploaded to Firebase → Project
   Settings → Cloud Messaging. Without it iOS hands over a token FCM cannot
   exchange and **every send silently no-ops**.
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

Test these specifically. They are the ones that pass in a simulator and fail on
hardware:

- Sign in with Google, then with Apple, both from a cold install.
- Cancel each sheet halfway and check the buttons come back (§2.1).
- Receive a push with the app closed, and one with it open — exactly one
  banner, not two.
- Open the house link from Trip Info and get back.
- Take a photo with the 📷 button and watch it upload.
- Leave a card unattested, force-quit the app, reopen it — the badge should
  arrive then, not before (§2.2).
- Search for a course in Admin → Courses (that is the `/api` path, §2.3).
- Flip the theme pill and watch the status bar follow.
- Delete the account, and check the three outcomes in the Firebase console.

Builds expire after 90 days. Do not start TestFlight until §5 is done, or the
field tests a broken build and stops trusting the next one.

---

## 7. Review notes to submit with the build

Credentials come from `store-submission.md` §1.4.

> The Bourbon Cup is the scoring app for one private annual golf tournament.
> It is submitted for unlisted distribution.
>
> **To see the app with no credentials:** tap "Look around as a guest" on the
> sign-in screen. This opens the entire app read-only — leaderboard, draw,
> scorecards, trip schedule, and ten years of tournament history — with no
> account. It is not a limited demo; it is the whole app without write access.
>
> **To reach scoring, photos and the admin tools:** sign in with the Google
> account below, enter the tournament password when prompted, then tap the
> pre-assigned name on the roster screen. The account is a tournament director,
> so the Admin tabs are reachable.
>
> **Please use the tournament named "DEMO — Testers".** If the app opens on a
> different year, tap "Switch tournament" on the roster screen (or ☰ →
> Tournaments) and choose it. The other years are completed tournaments and
> are closed to new entries, so a name cannot be claimed in them — the app
> says so on screen.
>
> Google account: `<demo address>` / `<password>`
> Tournament password: `<from Admin → Event → Access>`
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
> The app is iPhone-only by design and is used one-handed on a golf course.

---

## 8. Unlisted distribution

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

1. Everything in `store-submission.md` §1. **BY HAND**
2. All six items in §5. **BY HAND, on a Mac**
3. Build, run on a device, work through the §6 list. **BY HAND**
4. TestFlight to the field. **BY HAND**
5. Screenshots at Apple's sizes — `store-submission.md` §4 for which screens.
   Apple wants 6.9″ iPhone (1290×2796 or 1320×2868) and rejects on dimensions
   alone. Read the current required set off App Store Connect rather than
   trusting this line.
6. App Privacy labels, from `store-submission.md` §2. They must agree with
   `PrivacyInfo.xcprivacy`.
7. Age rating — `store-submission.md` §3. Alcohol yes, gambling no.
8. Submit to App Review with the notes in §7. **BY HAND**
9. **Then** file the unlisted-distribution request, as the Account Holder — §8.
   **BY HAND**

Steps 1–2 are the whole remaining cost. Nothing before step 3 is verifiable
without a Mac.
