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
| What ships | A Capacitor app with the build **bundled inside it** | The same, one platform along |
| Codebase | One, with four subsystems carrying a native branch | The same four |
| Shipping a change | A new bundle, uploaded — minutes on internal testing | A new build and a new review |
| Engineering left | None | None — **but none of it has been compiled**, see `app-store.md` |
| What is left | A keystore and a `google-services.json` | Console setup and a Mac — `app-store.md` §5 |
| The thing that holds it up | Collecting sixteen Google accounts | Guideline 4.2, and the four things WKWebView breaks |
| Distribution | **Internal testing** — link only, never in search | **Unlisted**, same as Maize N Que |

There used to be an asymmetry here worth planning around — Android accepted the
web app as a web app through a Trusted Web Activity, and iOS could not. Android
is a Capacitor build now, so the two are one shape and one set of native
branches, matching WBC.

What that costs, and it applies to both platforms now: **the web build lives
inside the binary.** A Vercel deploy no longer reaches anybody's installed app.
After the first release, "I pushed a fix" is not true for anyone carrying a
store build until a new one ships — minutes on Play's internal track, a review
on iOS.

---

## 1. The four things that must be true before either submission

These are prerequisites, not steps in a submission flow. Every one of them is
something a reviewer will personally tap.

They are no longer all outstanding, and the status below is **checked rather
than remembered** — a list still saying "not done" long after it was done is
how an evening gets spent redoing it:

| | State | How that was established |
| --- | --- | --- |
| 1.1 Cloud Functions | **Deployed** | Reported in the commit that documented the discovery timeout — all six endpoints went up. Re-check by tapping My Account → Delete Account on a throwaway account; the button says so itself when the callable is missing. |
| 1.2 `firestore.rules` | **Deployed** | `bc_ledger` and `bc_budget` both answer a public REST read. Under the older rule set the default-deny at the bottom of the file refused them. |
| 1.3 `VITE_FCM_VAPID_KEY` | **Set** | Confirmed in Vercel against the Web Push key pair in Firebase → Cloud Messaging. Nothing in the repo or the database can see this one, so it is the one item here that can only ever be checked by looking. Web push only — neither store build uses it. |
| 1.4 Reviewer account | **Demo seeded**, account still to claim | `bc_demo` holds its 371 documents and all twelve roster rows, unclaimed, written by the seed. The Google account and its crown are the part a person does. |

What remains is the second half of 1.4: signing the demo Google account in,
claiming one of the twelve names **inside the demo edition**, and crowning it.
That one cannot be done from a repo or a console — it is a person tapping
through the app once.

`VITE_*` is baked in at build time, so if 1.3 is ever changed it needs a Vercel
redeploy to take, not just a saved variable.

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

**If it fails with "An unexpected error has occurred":** look one line ABOVE
it, at the warning the CLI buries:

```
⚠  functions: Couldn't find firebase-functions package in your source code.
   Have you run 'npm install'?
```

`functions/` has its own `package.json` and its own dependencies, and they are
NOT installed by the repo root's `npm ci` — nothing in the root lockfile
reaches into that directory. The CLI has to load the code to work out what to
deploy, so a missing `node_modules` there kills the analysis, and the sentence
it prints about it names nothing.

```sh
cd functions && npm ci && cd ..
firebase deploy --only functions
```

Once per machine. It is the one step in this file that a second developer's
laptop hits and the first developer's never does again.

**If it fails with "Cannot determine backend specification. Timeout after
10000":** widen the window and update the CLI.

```powershell
npm install -g firebase-tools
$env:FUNCTIONS_DISCOVERY_TIMEOUT=60
firebase deploy --only functions
```

That is not a code problem, and the error names the wrong thing twice over.
`Serving at port NNNN` is printed by the discovery server BEFORE it loads
`index.js` — the require only happens when the CLI fetches `/__/functions.yaml`
off it — so the line is not evidence the code loaded. What timed out was the
CLI's own request to its own localhost server.

Prove which half is broken without guessing, by loading the code with no HTTP
in the way at all:

```powershell
cd functions
$env:FUNCTIONS_MANIFEST_OUTPUT_PATH="$env:TEMP\bc-manifest.json"
node node_modules\firebase-functions\lib\bin\firebase-functions.js .
Remove-Item Env:\FUNCTIONS_MANIFEST_OUTPUT_PATH
(Get-Content "$env:TEMP\bc-manifest.json" -Raw | ConvertFrom-Json).endpoints.PSObject.Properties.Name
```

That branch writes the manifest and prints a real stack trace on failure. If it
lists all six endpoints, the code is fine and the problem is local networking —
check `HTTP_PROXY`/`HTTPS_PROXY` (a proxy variable routes the CLI's own
`localhost` request through something that cannot reach the machine), then the
firewall. Setting the timeout permanently avoids the whole thing recurring:

```powershell
[Environment]::SetEnvironmentVariable("FUNCTIONS_DISCOVERY_TIMEOUT","60","User")
```

### 1.2 `firestore.rules` must be deployed

Not because the stores ask, but because `bc_ledger` and `bc_budget` are newer
than the deployed rules and the default-deny at the bottom of the file refuses
every read of them. A reviewer opening the Budget tab on an undeployed rule set
sees an app that is broken. App first, rules second, as always.

### 1.3 `VITE_FCM_VAPID_KEY` must be set in Vercel

Or the **web** app reports push as unconfigured. Neither store build uses it:
both are Capacitor now and take the native FCM path (`app-store.md` §2.2,
`play-store.md` §5), so this is about the browser and nothing else.

### 1.4 A reviewer account must exist

Both stores want to reach everything, and guest mode is read-only by design, so
guest mode alone is **not** an answer to either store's access question. It is a
very good answer to half of it.

**The demo edition is seeded, not built by hand.**

```sh
npm i --no-save firebase-admin
npm run seed:demo                                       # dry run — builds and counts
npm run seed:demo -- --write --key /path/to/key.json    # any shell
```

`--key` rather than an environment variable in front of the command:
`GOOGLE_APPLICATION_CREDENTIALS=… npm run …` is bash syntax, and in PowerShell
it is read as a command *named* `GOOGLE_APPLICATION_CREDENTIALS=…`, which fails
in a way that reads as the script being broken. The flag works the same
everywhere. `GOOGLE_APPLICATION_CREDENTIALS` is still honoured when it is
already set.

`bc_demo` — "DEMO — Testers" — is 371 documents: twelve invented golfers six a
side, two invented courses with full cards and two tees, four rounds over a
July weekend, a draw in which nobody meets the same opponent twice, round 1
played out and **round 2 stopped at the turn**, a settled CTP, a skins pot, a
budget and a rental house. The cup sits **6–6** when a tester opens it, with
nine holes left to post — which is the entire point: a tester who can only
look generates nothing (§ `play-store.md` §7).

`src/lib/demoSeed.js` decides every document and is unit-tested, including
against the app's own scoring engine — the demo is not seeded unless it
provably renders a leaderboard. `scripts/seed-demo.mjs` writes it, dry-run by
default, and refuses to touch anything but `bc_demo`: the edition id is a
constant with no flag to typo, every document is re-checked for its
`tournament_id` before a connection is opened, the service-account key is
checked against `.firebaserc`, and it aborts if `bc_demo` holds a document it
did not write. Take it back out with `--undo --write`, which deletes by the
`seeded_from` mark, so anything a tester made in there survives.

Then, for the reviewer specifically:

1. Sign in as the demo Google account, present the tournament password, and
   claim any of the twelve names on the roster screen.
2. Make it a director (**Admin → Players**, crown toggle) so the Admin tabs are
   reachable. Both stores will otherwise report a section of the app they could
   not enter.

Testers claim the other eleven. Nothing in the seed is claimed, and it creates
no memberships — those are minted by presenting the password, which is a thing
a person does.

### A store build opens on the demo

Not by instruction — by default. A fresh install has no edition pointer, and
`lib/defaultEdition` answers **`bc_demo` on native and `bc_2025` on the web**.
The web app is the sixteen men and must never open on an invented tournament;
a store build today is a tester or a review queue, and they are handed the app
to try rather than to navigate.

It matters more than it sounds. The real editions are locked, so a tester who
lands on one gets a roster they cannot claim — `canWriteEdition()` refuses
every write — and their first act in the app is a refusal. The claim screen
now says so and offers a switcher, but "find the right tournament first" is
not an instruction a tester should need.

**`VITE_DEFAULT_EDITION` overrides both**, and that is the way out of this
being a special case. When the FIELD starts installing store builds rather
than twelve testers, set it to that year's edition — otherwise sixteen men
open the app on a demo. It is the one thing here that will look wrong later
and be nobody's obvious fault, so it is worth a note wherever the release is
built.

Locking is what actually confines a tester to the demo, not this. The default
decides where they LAND; `firestore.rules` decides where they can WRITE, and
every real edition being locked is what makes the second one true.

### Adding a tester

A thirteenth golfer, for somebody who would rather see their own name than
claim "Pete V":

```sh
npm run seed:demo -- --add "Aaron J" --team A --index 12.4 --write --key /path/to/key.json
```

(On Windows npm strips the quotes before node sees them, so `--add` reads every
word up to the next flag — "Aaron J" survives either way.)

One row, stamped like the rest so `--undo` still takes it out, unclaimed so
they can claim it, and **not** in the draw — put them in a match in
Admin → Matches, or leave them to watch. A director switched to the demo can
do the same thing in **Admin → Players**, which is easier for one person; the
flag is for a handful at once.

### Why they cannot appear in a real tournament

Not the `tournament_id` filter — that only covers the screens that read one
edition. The app deliberately reaches ACROSS editions in exactly two places,
and both would have surfaced the invented field:

- **The Data tab** folds whichever edition is open into ten years of career
  records (`lib/archiveLive`). Left alone, a tester on the demo would see Dave
  R in the career table beside the real men, two courses nobody has played in
  the passport, and a **2026 cup that was never contested** in the tournament
  records.
- **`cloneEdition`** copies a roster forward. Build 2026 from the demo with
  COPY PLAYERS ticked and next year's real tournament opens with twelve men
  nobody invited — who read as people somebody forgot to remove.

Both now read `isDemoEdition` off the edition document's `is_demo` flag, which
the seed writes and `createEdition` never does. The Data tab shows the ten real
years and says so on screen; the clone picker does not offer a demo, and
`cloneEdition` refuses one even if something else asks. A flag rather than a
hardcoded `bc_demo`, because the next scratch edition will not be called that.

### The other direction: keeping testers out of the real cup

The demo stops test golfers reaching a real tournament. **Edition locking** is
the half that stops testers reaching one — a membership is not edition-scoped,
so a tester can switch into the live year and post a score in it. Lock the real
editions in **Admin → Event → Editions** and leave the demo unlocked. That is
the complete answer, and the two halves are independent: one is about invented
players leaking out, the other about real people writing in.

`bulkLockVerdict` ("Lock all but 2026") **skips demo editions**, and it has to.
Sweeping the demo in with the finished cups would freeze the tournament the
twelve testers are meant to be posting scores in — and it would do it
invisibly, because a director is exempt from the lock they just set, so the one
person able to reproduce it is the one person who cannot see it. The seed also
writes `locked: false` explicitly rather than relying on the default.

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

**These have to be taken somewhere that can reach the app.** Any laptop with a
browser will do it in ten minutes, and guest mode gets you three of the four
without signing in.

Not a Claude session, and the reason is worth writing down properly so nobody
spends an afternoon rediscovering it. The reason given here before — "a local
dev server has no Firebase credentials" — is wrong: the config is public by
design and inline in `src/firebase.js`, so a dev server in a sandbox reaches
the live project perfectly well, and `curl` against the Firestore REST API
from one returns the real roster. Two other things are the wall, and neither
can be worked around from inside:

- `thebourboncup.com` is a policy denial at the egress proxy, so the deployed
  site is unreachable. That leaves the dev server, which is fine.
- The dev server's own Firestore calls are not. Outbound HTTPS is terminated
  and re-signed by the sandbox's proxy, and **Chromium ships static certificate
  pins for `*.googleapis.com`** — so every Firestore connection from the
  browser is reset, while `curl` from the same container succeeds. Trusting the
  proxy CA properly needs `certutil` and the NSS store, which is not installed;
  the flags that paper over it are blanket TLS-verification-off.

So the app renders, and it renders empty. A component harness with mocked props
(`CLAUDE.md`, "Verifying UI changes") still works and is the right tool for a
layout change — it is only real tournament data that cannot get there.

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
