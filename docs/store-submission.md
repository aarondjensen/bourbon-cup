# Submitting The Bourbon Cup to both stores

Two stores, two very different amounts of work, and a set of answers they both
ask for. This file holds the shared half. The store-specific halves are
[`play-store.md`](./play-store.md) and [`app-store.md`](./app-store.md), and
neither repeats what is here.

Read this first. Most of what gets a submission bounced is in this file, not in
the packaging.

---

## The shape of the two, side by side

|  | Play Store | App Store |
| --- | --- | --- |
| What ships | A Trusted Web Activity — a thin shell over `https://thebourboncup.com` | A Capacitor app with the build **bundled inside it** |
| Codebase | None. The site is the app. | Still one codebase; four subsystems carry a native branch |
| Shipping a change | A Vercel deploy | A new build and a new review |
| Engineering left | None | None — **but none of it has been compiled**, see `app-store.md` |
| What is left | A keystore, a fingerprint, and 14 days | Console setup and a Mac — `app-store.md` §5 |
| The thing that holds it up | 12 testers actually using it for 14 days | Guideline 4.2, and the four things WKWebView breaks |
| Distribution | Public, closed testing first | **Unlisted**, same as Maize N Que |

The asymmetry is the point: Android can accept a web app as a web app, and iOS
cannot. Do not plan them as one piece of work.

One thing the table understates. On Android the site *is* the app, so a fix
lands the moment Vercel deploys. On iOS the build is inside the binary, so the
two can drift — and after the first App Store release, "I pushed a fix" stops
being true for everyone carrying the iPhone build until a new one is reviewed.

---

## 1. The four things that must be true before either submission

These are prerequisites, not steps in a submission flow. Every one of them is
something a reviewer will personally tap, and every one of them is currently
**not done**.

### 1.1 The Cloud Functions must be deployed — **BY HAND**

```sh
firebase deploy --only functions
```

Account deletion is a callable (`deleteAccount` in `functions/index.js`) and
both stores require deletion to work from inside the app — App Store guideline
5.1.1(v), Play's Data safety declaration. Until this runs, **My Account →
Delete Account** says deletion is not deployed yet. That message is honest and
it is a failed requirement in both queues.

Verify on a throwaway account and check all three outcomes in the Firebase
console: the `bc_accounts` document gone, the roster row surviving with
`auth_uid: null`, the Auth user gone.

### 1.2 `firestore.rules` must be deployed

Not because the stores ask, but because `bc_ledger` and `bc_budget` are newer
than the deployed rules and the default-deny at the bottom of the file refuses
every read of them. A reviewer opening the Budget tab on an undeployed rule set
sees an app that is broken. App first, rules second, as always.

### 1.3 `VITE_FCM_VAPID_KEY` must be set in Vercel

Or the app reports push as unconfigured, on the web and inside the TWA both.
(The iOS app does not use it — see `app-store.md` §2.2.)

### 1.4 A reviewer account must exist

Both stores want to reach everything, and guest mode is read-only by design, so
guest mode alone is **not** an answer to either store's access question. It is a
very good answer to half of it.

Set up **one** account and give it to both stores:

1. Create a throwaway edition in **Admin → Event → Editions** — not the live
   cup. A reviewer will tap things.
2. Add a roster row for the reviewer in that edition.
3. Sign in as the demo Google account, present the tournament password, claim
   that row.
4. Make it a director (**Admin → Players**, crown toggle) so the Admin tabs are
   reachable. Both stores will otherwise report a section of the app they could
   not enter.

Hand over three facts: the Google address, its password, and the tournament
password from **Admin → Event → Access**.

> The tournament password is project-wide rather than per-edition, so that
> account can write to any year, including the live one. Revoke it after both
> reviews by deleting its `bc_accounts` document in the Firebase console.
> Rotating the tournament password does **not** evict it — memberships are
> never re-checked.

---

## 2. What the app collects

One table, because both stores ask the same question in different forms. Taken
from `src/lib/accounts.js`, `src/lib/notifications.js`, `src/lib/mediaUpload.js`
and the roster — not from memory.

| Data | Collected | Shared with third parties | Required | Why |
| --- | --- | --- | --- | --- |
| Email address | Yes | No | Yes | Sign-in, account management |
| Name | Yes | No | Yes | The roster, and every screen that names a player |
| User ID | Yes | No | Yes | The Firebase uid, which is what links an account to a roster row |
| Photos | Yes | No | Optional | The photo library |
| Device ID | Yes | No | Optional | The push token, one row per device |
| Other user content | Yes | No | Yes | Scores, matches, card signatures, side bets |
| Other financial info | Yes | No | Optional | Trip payments the director records — **amounts and dates only**, no card or bank details, no processor |

Everything else is **not collected**: no location, contacts, calendar,
messages, health, browsing history, search history, audio, files, app activity,
crash logs, diagnostics, performance data, or advertising identifiers. The app
has **no analytics SDK and no advertising SDK at all**, which is unusual enough
that it is worth saying plainly on both forms rather than leaving boxes blank.

Both stores also want:

- **Encrypted in transit?** Yes.
- **Processed ephemerally?** No.
- **A way to request deletion?** Yes — in-app, plus
  `https://thebourboncup.com/account-deletion.html`.
- **Privacy policy URL:** `https://thebourboncup.com/privacy.html`

On Apple this becomes App Privacy "nutrition labels" in App Store Connect and
must additionally be mirrored in a `PrivacyInfo.xcprivacy` file in the binary —
see `app-store.md` §4.

---

## 3. Age rating — the two questions that are easy to answer wrong

Neither store's questionnaire is a formality. A wrong answer here is a policy
violation rather than a rejection, which means it can take an app down after it
is live rather than before.

### 3.1 The app is named after bourbon

Both questionnaires ask about alcohol references. **Answer yes, infrequent or
mild.** The name is on every screen, the trophy art is on the sign-in screen,
and the tournament is named after the thing.

This is not a problem — it lands the app somewhere around 16+ on Apple and Teen
on Play, which for an app whose entire audience is sixteen adult men on a golf
trip costs nothing. Answering no to save a rating tier is the mistake: the name
is not hideable and the questionnaire is an attestation.

### 3.2 The Betting tab is not gambling, and the form has to be told why

The app scores skins, closest-to-the-pin and a buy-in pot, and it keeps a
ledger of side bets between players. What it does **not** do, anywhere, is move
money. There is no processor, no wallet, no payout, no in-app purchase. The
ledger's payment methods (`src/lib/ledger.js`) are labels a director types after
a Venmo arrives outside the app; `SideBets` settles nothing and says so in its
own header comment.

So on both questionnaires, the real-money gambling question is **No**:

- Apple 5.3.4 governs apps that *offer* real money gaming. Answering yes forces
  18+ and invites a licensing and geo-restriction review the app cannot pass and
  does not need.
- Play's real-money gambling policy is the same shape and would require
  licensing per country.

"Contests" or "simulated gambling", where the questionnaire offers it, is the
honest box.

> **Say it in the review notes on both stores**, in one sentence: *the app
> records wagers agreed between players in person and settles them in person;
> it processes no payments and contains no purchase of any kind.* This is the
> single most likely thing to draw a reviewer's question, and answering it
> before it is asked costs one line and saves a rejection round trip.

Worth knowing and not worth acting on yet: renaming the tab from **Betting** to
something like **Games** would lower this risk further. It is not obviously
worth changing a name the field already uses, and no reviewer has objected yet.
If either store queries it, that is the cheap fix to reach for.

---

## 4. Screenshots

The same four screens make the case in both stores; only the pixel dimensions
differ. Take them on a year with scores in it — `bc_2025` or any imported cup —
rather than on an empty new edition, or the app photographs as though nobody
uses it.

1. **Leaderboard** — the cup total mid-round. This is the app in one image.
2. **A scorecard mid-round** — hole by hole, strokes shown.
3. **Matches** — the draw, tee times, groups.
4. **Data → Player career table** — ten years of record. Nothing else in the
   listing says "this is not a weekend project" as fast.

**These have to be taken somewhere that can reach the app.** Not a Claude
session: the sandbox's network policy denies `thebourboncup.com`, and a local
dev server has no Firebase credentials, so there is no route to a screen with
real scores on it from there. Any laptop with a browser will do it in ten
minutes. Guest mode gets you three of the four without signing in.

Drive the deployed site in a phone viewport and photograph real screens rather
than mocking them up:

```js
// Chromium is at /opt/pw-browsers/chromium-*/chrome-linux/chrome here.
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },  // Play: → 824×1830 at DSR 2
  deviceScaleFactor: 2,
});
```

Per-store sizes are in each store's own file. Apple is the fussier of the two
and will reject on dimensions alone.

---

## 5. The order to do it in

The two submissions share a spine and then diverge. Do the spine once.

**Shared, first:**

1. Deploy the Cloud Functions (§1.1) and the rules (§1.2). **BY HAND**
2. Set `VITE_FCM_VAPID_KEY` in Vercel (§1.3). **BY HAND**
3. Build the demo edition and the reviewer account (§1.4). **BY HAND**
4. Take the four screenshots (§4).

**Then Play**, which is ready to go and gated on calendar time rather than
work — see `play-store.md`. Start it first for exactly that reason: the
14 days of closed testing run while the iOS work happens.

**Then iOS**, which is gated on engineering — see `app-store.md`.

The one ordering constraint between them: the Play closed test wants twelve
people using the app for two weeks, and the iOS build is not one of the things
they can use. Do not wait for iOS to start the clock.
