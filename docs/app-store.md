# Getting The Bourbon Cup into the App Store

Read [`store-submission.md`](./store-submission.md) first — the reviewer
account, the data disclosures, the age rating and the deploy prerequisites are
there and are not repeated here.

**This one is not ready.** The Play submission is packaging work; this is
engineering work, and pretending otherwise is how it gets rejected twice.
Everything below is either a thing to build, a thing to configure in a console,
or a thing to write on a form.

---

## 1. Why there is no shortcut

Android has a Trusted Web Activity: a supported, first-party way to ship a web
app as an app, which is what `play-store.md` uses. **iOS has no equivalent.**
The App Store takes a signed `.ipa` built from an Xcode project, so a native
shell has to exist, and the shell has to hold a `WKWebView`.

Two consequences, and the second is the expensive one:

- **The web app has to be bundled into the binary**, not loaded from
  `thebourboncup.com`. Capacitor will happily point the webview at a remote URL
  (`server.url`), and doing that would make this a one-day job. It is also the
  fastest known route to a **guideline 4.2** rejection — an app whose entire
  content is a remote website is the exact thing 4.2 was written for. Ship the
  build inside the app, and Vercel stops being the release channel for iOS.
- **A bundled build runs from `capacitor://localhost`**, not from
  `https://thebourboncup.com`. Four subsystems in this repo assume the second,
  and all four break. That is §2.

Maize N Que already went down this road: `src/lib/notifications.js` opens by
saying it was ported from that app *minus its native (Capacitor) branch*. So
this is a re-port with a known shape, not a design problem.

---

## 2. The four things that break in a WKWebView

None of these fail loudly at build time. All four fail on a reviewer's phone.

### 2.1 Google sign-in stops working entirely

`src/lib/auth.js` calls `signInWithPopup`, falling back to
`signInWithRedirect`. **Google blocks OAuth in embedded webviews** — the request
comes back `403 disallowed_useragent` — so both paths are dead inside Capacitor.
This is Google policy, not a bug, and there is no user-agent trick worth
shipping.

The fix is native sign-in on both providers, with the web path kept for the
browser and the TWA:

```sh
npm i @capacitor-firebase/authentication
```

It performs a native Google sign-in and a native Sign in with Apple, hands back
a credential, and the existing JS Firebase SDK consumes it with
`signInWithCredential`. Everything downstream — the uid, `bc_accounts`, the
claim screen, `lib/accounts.js` — is untouched, because the uid is the same uid.

What changes in this repo: `signIn()` in `src/lib/auth.js` grows a native branch
in front of the popup/redirect logic. The long comment block above
`signInWithPopup` about user activation and iOS storage partitioning stays
relevant to the web path and stops applying to the native one — a native sheet
has no popup to block.

Console work this needs, none of which the web flow already covers:

- **Sign in with Apple capability** on the App ID in the Apple Developer portal,
  and in Xcode. This is separate from the Services ID the *web* flow uses; both
  have to exist.
- **`GoogleService-Info.plist`** from the Firebase console, added to the Xcode
  project.
- **The reversed client ID** as a URL scheme in `Info.plist`, or the Google
  sheet opens and never comes back.

> **Guideline 4.8** requires Sign in with Apple wherever a third-party social
> login is offered. The app already offers both, and `PROVIDERS` in
> `src/lib/auth.js` renders them as two buttons of identical size — which is
> what 4.8 actually asks for. Nothing to do; worth not breaking.

### 2.2 Push notifications stop working entirely

WKWebView has no service worker and no Web Push. `public/firebase-messaging-sw.js`
never registers, the VAPID key is irrelevant, and `registerForPush` fails.

```sh
npm i @capacitor-firebase/messaging
```

It returns an **FCM token** on iOS (swizzling APNs underneath) rather than a raw
APNs token, which matters more than it sounds: `bc_notification_tokens` rows
keep their shape, `sendToPlayer` in `functions/index.js` keeps working
unchanged, and there is no second delivery path to keep in step. Add a native
branch to `src/lib/notifications.js` alongside the web one — the file's module
comment already anticipates it.

Console and Xcode work:

- An **APNs authentication key** (`.p8`) uploaded to Firebase → Project
  Settings → Cloud Messaging. Without it every send silently no-ops.
- **Push Notifications** capability in Xcode.
- **Background Modes → Remote notifications** in Xcode.
- `NSUserNotificationsUsageDescription` is not required, but the permission
  prompt must be requested from a tap, same as the web.

### 2.3 Every `/api` call 404s

Six relative fetches assume the app is served from the same origin as the Vercel
functions:

- `src/lib/ghin.js:39` and `:56` — the GHIN lookup and sync
- `src/components/AdminView.jsx:976`, `:982`, `:997`, `:1001` — course search

Under `capacitor://localhost` these resolve against the bundle and fail. The
`vite.config.js` dev proxy does not help — that is a dev-server feature.

Fix: an API base that is empty on the web and absolute on native.

```js
// One place, read by lib/ghin.js and AdminView alike.
export const API_BASE = Capacitor.isNativePlatform() ? "https://thebourboncup.com" : "";
```

Then `api/ghin.js`, `api/courses.js` and `api/courses2.js` need **CORS response
headers** allowing the Capacitor origin, or the browser inside the app refuses
the response after the network call succeeds — which reads in the console as a
network failure and is not one.

These are director-only screens, so nothing a reviewer touches breaks if this is
missed. It would break for Aaron on his own phone, silently, months later. Fix
it in the same pass.

### 2.4 The iOS chrome the app carefully tuned no longer applies

`index.html` carries a long, hard-won comment about
`apple-mobile-web-app-status-bar-style` having to stay `"black"`, with measured
numbers off an iPhone 16 Pro. **Every one of those meta tags is a Safari
home-screen mechanism and none of them do anything inside Capacitor.** The
status bar there is `@capacitor/status-bar` plus
`UIViewControllerBasedStatusBarAppearance` in `Info.plist`.

That is not a regression — the same visual result is reachable — but it is a
separate implementation of a thing this repo has already got wrong once, and
the layout has to be re-verified on a device with a notch. Same for
`env(safe-area-inset-*)` under `viewport-fit=cover`, and for the keyboard, where
Capacitor's `KeyboardResize` mode decides whether a focused input scrolls into
view or is covered.

Also: `TripInfo.jsx:248` renders the house link as `target="_blank"`. Inside
Capacitor that opens **in the app's own webview**, with no way back — it looks
broken and it reads as browser-like to a reviewer. Route external links through
`@capacitor/browser`.

### 2.5 What does *not* break

Worth stating, because it is most of the app: Firestore, the whole scoring
engine, the archive chunk, IndexedDB auth persistence, `<input type="file">` for
photo upload, and every screen's layout logic all work unchanged. The four
above are the whole list.

---

## 3. Passing guideline 4.2

This is the rejection to plan for. 4.2 asks for an app that is more than a
repackaged website, and in 2026 a webview wrapper is close to an automatic
bounce unless the native adaptation is real and visible.

The good news is that the fixes in §2 *are* the adaptation — they are not
decoration added to pass review, they are the app working:

- **Native Sign in with Apple and native Google sign-in** (§2.1) — a system
  sheet, Face ID, not a web form.
- **Native push notifications** through APNs (§2.2), which Safari cannot deliver
  to a non-installed web app at all.
- **Native camera and photo library** access for the photo tab. `PhotosView`
  deliberately leaves `capture` off its file input; on native, `@capacitor/camera`
  gives the real picker and the real camera.
- **Haptics** on score entry (`@capacitor/haptics`). Small, cheap, and the kind
  of thing a reviewer notices in ten seconds of tapping.
- **The build ships inside the binary**, so the app opens and works with no
  network for everything already cached — which is the "meaningful loss of
  functionality in Safari" test 4.2 actually applies.

Two things that would sink it, both easy to do by accident:

- Any visible browser chrome, address bar, or page that scrolls like a website.
- An external link that opens inside the webview (§2.4).

Say the adaptation out loud in App Review notes. A reviewer who has to discover
it will not.

---

## 4. Info.plist, capabilities and the privacy manifest

| Item | Value / note |
| --- | --- |
| `NSCameraUsageDescription` | "Take photos of the tournament to add to the shared album." |
| `NSPhotoLibraryUsageDescription` | "Choose photos from your library to add to the tournament album." |
| `NSPhotoLibraryAddUsageDescription` | Only if the app saves images back out. It does not today. |
| `ITSAppUsesNonExemptEncryption` | `false`. The app uses HTTPS and nothing else; setting this skips the export-compliance question on every single upload. |
| `UIViewControllerBasedStatusBarAppearance` | See §2.4. |
| URL scheme | The reversed Google client ID (§2.1). |
| Capabilities | Push Notifications, Background Modes → Remote notifications, Sign in with Apple. |

A missing usage-description string is a **crash**, not a warning, the first time
the picker opens — and it is the reviewer who finds it.

**`PrivacyInfo.xcprivacy` is required.** Apple has enforced privacy manifests
since May 2024, and the upload is rejected without one when a required-reason
API is used. Capacitor and the Firebase SDKs ship their own; the **app-level**
manifest is yours and has to declare:

- The collected data types from `store-submission.md` §2, in Apple's vocabulary.
- Required-reason API declarations for `UserDefaults` (`CA92.1` — access limited
  to the app itself) and file timestamp APIs if any plugin reaches for them.
- `NSPrivacyTracking: false`, and an empty tracking-domains list. The app has no
  analytics and no ad SDK, which makes this section short and true.

Set the deployment target to a modern iOS and **iPhone only**. Declaring iPad
support means a reviewer opens it on an iPad, and every layout decision in this
app was made for a phone held in one hand on a tee box.

---

## 5. Unlisted distribution

Same route as Maize N Que, and for the same reason: this app is for sixteen
men, it is gated behind a tournament password, and it has no business being
searchable. Unlisted apps get a direct link, are not discoverable, and do not
appear in search, charts or recommendations.

The sequencing traps, which are what caught this last time:

1. **The app must be submitted to App Review before the unlisted request is
   made.** Apple declines unlisted requests for apps that have not been
   submitted, and for apps still in a beta or prerelease state.
2. **Put a line in the Review Notes** of the submission saying the app is
   intended for unlisted distribution.
3. **The request form must be filed by the Account Holder.** Submissions from
   any other App Store Connect role get bounced without a useful reason.
4. **It is one-way.** An app record converted to unlisted cannot be made public
   again. That is fine here; know it before clicking.

The request lives at
<https://developer.apple.com/contact/request/unlisted-app-distribution>.

Unlisted does **not** mean unreviewed. The app goes through the same App Review
as a public one — §3 still applies in full.

---

## 6. TestFlight, before any of it

Free, no review for internal testers, and the only way to find out whether §2
actually works on a real phone. Up to 100 internal testers, each needing an
App Store Connect user role — for a field of sixteen that is fine, and it is
faster than external testing, which needs Beta App Review.

Test the four §2 items specifically, because they are the ones that pass in a
simulator and fail on hardware:

- Sign in with Google, then with Apple, both from a cold install.
- Receive a push with the app closed.
- Open the house link from Trip Info and get back.
- Delete the account, and check the three outcomes in the Firebase console.

Builds expire after 90 days. Do not start TestFlight until §2 is actually
written or the field tests a broken app and stops trusting the next build.

---

## 7. Review notes to submit with the build

Write these into App Review Notes rather than leaving them to be discovered.
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

## 8. The order to do it in

1. Everything in `store-submission.md` §1. **BY HAND**
2. `npm i @capacitor/core @capacitor/cli && npx cap init`, then `npx cap add ios`.
   Commit `capacitor.config.ts`; the `ios/` project is generated, like the
   Android one.
3. Write the four native branches — §2.1, §2.2, §2.3, §2.4. This is the work.
4. Add the native-adaptation plugins from §3 (camera, haptics, browser).
5. Info.plist, capabilities, `PrivacyInfo.xcprivacy` — §4.
6. TestFlight to the field, test the four items in §6. **BY HAND**
7. Screenshots at Apple's sizes — `store-submission.md` §4 for which screens.
   Apple wants 6.9″ iPhone (1290×2796 or 1320×2868) and rejects on dimensions
   alone. Read the current required set off App Store Connect rather than
   trusting this line.
8. App Privacy labels in App Store Connect, from `store-submission.md` §2.
9. Age rating questionnaire — `store-submission.md` §3. The alcohol answer is
   yes and the gambling answer is no.
10. Submit to App Review with the notes from §7. **BY HAND**
11. **Then** file the unlisted-distribution request, as the Account Holder — §5.
    **BY HAND**

Steps 3–5 are the whole cost of the iOS store. Nothing before step 6 is
verifiable without a Mac.
