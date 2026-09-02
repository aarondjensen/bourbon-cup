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
| 1.2 `firestore.rules` | **Deployed** — 31 Aug 2026, on the second attempt | `firebase deploy --only firestore:rules` against `the-bourbon-cup` printed `uploading rules firestore.rules` and then `released rules … to cloud.firestore`. **The upload line is the one that matters**, and the first attempt did not have it — see below. |
| 1.3 `VITE_FCM_VAPID_KEY` | **Set** | Confirmed in Vercel against the Web Push key pair in Firebase → Cloud Messaging. Nothing in the repo or the database can see this one, so it is the one item here that can only ever be checked by looking. Web push only — neither store build uses it. |
| 1.4 Reviewer account | **Not needed** | No credentials are handed to either store. `bc_demo` holds its 371 documents and all twelve roster rows, unclaimed; a reviewer signs in with their own Apple ID or Google account, presents the REVIEWER code (not the tournament password — see below), claims a name, and gets the Admin tabs because the edition is a demo. |

**Nothing in §1 is outstanding.** What is left of either submission is in
`play-store.md` and `app-store.md`, plus the screenshots in §4.

**`Deploy complete!` is not evidence that the right rules are live**, and this
is not hypothetical — it happened here on 31 Aug and is why that row says
"second attempt".

`firebase deploy` uploads the `firestore.rules` in the working copy it runs
from. The first deploy ran from a checkout two weeks behind `main`, so the file
it sent was the one from BEFORE `canAdminEdition` existed. It compiled, it
released, it said `Deploy complete!` — and, because that same stale ruleset was
already live, it also said:

> `latest version of firestore.rules already up to date, skipping upload`

which reads exactly like "you are current" and means "the file you just handed
me matches what is already deployed". Both statements are true of a checkout
that is a fortnight stale. The failure it would have shipped is the one this
row exists to prevent: a reviewer inside the demo typing into an Admin tab
whose every save is refused, which `db.upsert` swallows, on a build that looks
perfect to everyone with a crown.

So the check is not the deploy output. It is the file:

```sh
git -C <checkout> pull
git -C <checkout> grep -c canAdminEdition firestore.rules   # 15, not nothing
firebase deploy --only firestore:rules                      # must say "uploading"
```

`git grep -c` prints NOTHING when it matches nothing, which is easy to read as
success at 1am. And on a deploy that genuinely changes the rules, `uploading
rules firestore.rules` appears; if `skipping upload` appears instead, either
nothing changed or you are deploying a stale file, and only the `grep` tells
you which.

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
npm ci --prefix functions
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

**And now because Admin-in-the-demo is a rules change** (§1.4). The app decides
whether to DRAW the Admin tab from `canAdminEdition` in `src/lib/editionLock.js`;
whether the writes behind it land is decided by `canAdminEdition()` in
`firestore.rules`. Ship the app without deploying the rules and a reviewer gets
an Admin tab whose every save is refused — the exact failure the two-sided
mirror exists to prevent.

### 1.3 `VITE_FCM_VAPID_KEY` must be set in Vercel

Or the **web** app reports push as unconfigured. Neither store build uses it:
both are Capacitor now and take the native FCM path (`app-store.md` §2.2,
`play-store.md` §5), so this is about the browser and nothing else.

### 1.4 A reviewer account must exist

Both stores want to reach everything, and guest mode is read-only by design, so
guest mode alone is **not** an answer to either store's access question. It is a
very good answer to half of it.

Three things need the account rather than the guest door, and the third is the
one that decides it:

- **The write half of the app.** Scoring, photos, side bets and the Admin tabs
  are all behind a membership — the Admin tabs included, since a demo
  administrator is a MEMBER of the demo and a guest is not a member of
  anything. A reviewer who can only read has not seen what the app is for.
- **App Review Information asks directly.** Apple's form has a sign-in toggle
  with a username and password beside it. Answering "no sign-in required"
  because guest mode exists, and then having a reviewer meet the password
  screen on the Scoring tab, is a rejection for the review information rather
  than for the app.
- **Account deletion cannot be tested without an account.** Guideline 5.1.1(v)
  is checked by hand, and My Account → Delete Account does not exist for a
  guest — there is no account to delete. So the one requirement that most needs
  demonstrating is the one guest mode structurally cannot demonstrate.

#### When there is no Google account to spare

Google caps accounts per verification phone number, and that cap is reachable.
Two things that look like ways round it and are not:

- **A `+tag` or dotted alias is the same account.** Gmail ignores both, Google
  OAuth returns the same canonical address and the same subject id, so Firebase
  mints the same uid. `you+demo@gmail.com` signs in as you, with your crown and
  your roster row.
- **Handing over a personal account.** It is a director on the live cup, and
  the reviewer's first documented instruction is to delete an account.

#### What is actually submitted: no account, and not the tournament password

**Hand over no account.** Sign in with Apple works with the Apple ID already on
the reviewer's device, so there is no username and password to type — this app
has no email-and-password sign-in. Apple's App Review Information sign-in toggle
is answered by naming a code instead.

**And it is not the tournament's code.** There are two, set in the same card in
Admin → Event → Access. The reviewer code mints a membership stamped
`demo_only`, which `canWriteEdition()` confines to demo editions — so the string
typed into App Store Connect and into Play's App access form can claim a name,
score, post photos and administer inside `bc_demo`, and can do nothing whatever
to the cup.

That distinction is what makes the form safe to fill in at all. Both stores
quote the credential back on **every future update review**, so a code in that
box can never be rotated without breaking the next review — and the tournament
password is one sixteen men say out loud across a table. See the two-codes
section in `CLAUDE.md`, and `demoAccessCode` in `firestore.rules`.

**The order in the review notes is load-bearing.** A reviewer who taps a name
on the cup's roster before switching to the demo is refused by the rules, so
`claimPlayer` names that case specifically — "that access code only opens demo
tournaments" — rather than falling through to `writeFailure`, which would tell
an App Store reviewer that the app's security rules may not be deployed.

That used to reach everything EXCEPT the Admin tabs, and the gap was structural:
the crown is a flag on a membership document that does not exist until they sign
in, so nobody could set it in advance for an account nobody had created yet.

**The gap is closed, from the other end.** Inside a DEMO edition every member is
an administrator — `canAdminEdition()` in `firestore.rules`, mirrored by
`canAdminEdition` in `src/lib/editionLock.js`. So a reviewer who signs in with
their own Apple ID, presents the reviewer code and claims a name in
"DEMO — Testers" gets the Admin tabs on the way in, with nothing granted by
hand. Three cards are
not there, because they are project-wide rather than scoped to a tournament and
the rules keep them director-only: **Editions** (creating, deleting or unlocking
a tournament), **Access** (the password) and the **crown** itself. They are
hidden rather than shown-and-refused — AdminView auto-saves on edit and
`db.upsert` swallows a rejection, so a decorative Admin would let a reviewer
type a name, watch it appear, and find it gone on the next load.

What that costs: a reviewer can rename an invented golfer, redraw the demo's
matches, or edit a demo course. All of it is inside `bc_demo` and
`npm run seed:demo -- --undo --write` followed by a re-seed puts it back.

#### Why there is no Google account here

Kept because it is the reasoning, not the leftovers. Google caps accounts per
verification phone number and that cap is reachable; two things that look like
ways round it are not:

- **A `+tag` or dotted alias is the same account.** Gmail ignores both, Google
  OAuth returns the same canonical address and the same subject id, so Firebase
  mints the same uid. `you+demo@gmail.com` signs in as you, with your crown and
  your roster row.
- **Handing over a personal account.** It is a director on the live cup, and
  the reviewer's first documented instruction is to delete an account.

If a fresh Google account is ever wanted anyway, the two routes that do not
touch the cap are Cloud Identity Free on `thebourboncup.com` (real Google
accounts on a domain you already own, free for a few dozen users — check the
current limit) and a different verification phone number.

> **Any handed-over account has to be able to sign in from Apple's network.**
> This is the failure that reads as a broken app and is not one: a fresh Google
> account signed into from an unfamiliar device in another country is exactly
> what Google's risk checks are built to challenge, and a reviewer asked to
> confirm a code sent to a phone they do not have reports that they could not
> log in. This is the other half of why the submitted answer is "no account".

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

**And SIMULATED gambling is also No, and CONTESTS is None.** This paragraph
used to say the opposite — that simulated gambling was "the honest box" — and
that advice cost a rejection on 2 Sep 2026, before a human had looked at the
app at all:

> The current submission cannot be reviewed because the app's rating in App
> Store Connect indicates it includes simulated gambling and the app has been
> submitted by an individual developer.

**Simulated gambling plus an individual developer account is an automatic
stop.** Apple's only two remedies are correcting the rating or enrolling as an
organization, and there is no third. So the box is not a cautious middle
ground between "no gambling" and "real gambling" — it is a category with an
account-type gate on it.

It is also simply the wrong description. Apple's simulated gambling means
gambling-THEMED GAMES: slots, poker, casino play, wagering virtual currency
inside the app. This app contains no game of chance, no odds, no virtual
currency and no wager placed in the app. The Betting tab records agreements
made in person on a golf course and settled in person afterwards; nothing is
gambled inside the app, simulated or otherwise. "Contests" means sweepstakes
and prize contests the app runs, not a golf tournament between friends.

The rating lives on the app record rather than in the binary, so correcting it
needs no new build — App Information → Age Rating → Edit, then resubmit the
build already attached.

> **Say it in the review notes on both stores**, in one sentence: *the app
> records wagers agreed between players in person and settles them in person;
> it processes no payments and contains no purchase of any kind.* This is the
> single most likely thing to draw a reviewer's question, and answering it
> before it is asked costs one line and saves a rejection round trip.

Worth knowing and still not acted on: renaming the tab from **Betting** to
something like **Games** would lower this risk further. Apple has now bounced
the app once over gambling — but over the RATING we typed, not over anything
on the screen, and a reviewer has still never objected to the tab itself. So
the fix that matched the actual fault was the questionnaire. Keep the rename
in reserve for a rejection that quotes the app rather than the form.

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

**There is a script for it now**, because this is a job that gets redone from
scratch every time a layout changes and therefore gets skipped.

**One command per line, everywhere in these files.** `&&` is not a statement
separator in Windows PowerShell 5.1, which is the shell this gets pasted into,
and it fails on the first character with a parser error naming nothing useful.
`play-store.md` §1 tells the same story about `npm run android:bundle` — an npm
script exists there precisely so the shell never gets a say. Anything written
here as a chain has to be written as lines instead.

```sh
npm i --no-save playwright
npx playwright install chromium
npm run shots:store                 # dry run — names the four and both sizes
npm run shots:store -- --write      # drives the site, writes store/ios and store/play
npm run shots:store -- --write --only play
```

**It takes both stores' sets in one run, and it has to.** Apple requires
1290×2796 and Play refuses any image whose longer side is more than twice the
shorter — 2796/1290 is 2.17, so the size Apple DEMANDS is a size Play REFUSES.
Play's set is 1080×1920 and is flattened before it is written, because Play
also rejects an alpha channel and says something else when it does.

It runs in guest mode, so it signs into nothing and — since every write rule
begins at `request.auth != null` — it *cannot* touch the tournament even by
accident. `--edition`, `--url`, `--out`, `--only` and `--light` are all
overridable.

**It measures every file it writes** and fails the run on a wrong size or a
stray alpha channel, rather than ending with a command telling you to check
them yourself — which it used to, using `sips`, which does not exist on the
Windows machine that builds the Play bundle. Both stores reject on dimensions
alone, so an unchecked check is the worst of the three states.

It also prints the text it photographed, so an empty screen is visible in the
output rather than at upload time — and for a shot that declares a marker it
prints the text AROUND THE MARKER rather than the first ninety characters.
`02-scorecard` is why: a match card unfolds in place on the leaderboard, so the
top of the body is the cup total on both screens and the two readbacks came out
character-for-character identical on a run where nothing was wrong. That reads
as exactly the failure the marker exists to catch.

One of the four RENDERS anywhere, including a sandbox with no Firestore: the
Data tab's career table reads `bourbon-cup-archive.json` out of the bundle, so
`04-career.png` needs no database at all. The other three need real scores.

It is still not a shot you can ship from there, and the reason is the same
wall one door along: `src/theme.js` injects the Montserrat stylesheet from
`fonts.googleapis.com` at runtime, and that host is re-signed by the proxy and
reset exactly like Firestore is. The page comes out in a fallback grotesque —
which looks fine until it is sitting in the listing beside a feature graphic
set in the real thing. Both walls were re-confirmed in August 2026: from
Chromium, `firestore.googleapis.com` and `fonts.googleapis.com` both answer
`net::ERR_CONNECTION_RESET`, while `curl` from the same container gets both.

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

**Shared, first** — three of the four prerequisites in §1 are already done, and
that table is the record of which. What is left of the spine:

1. ~~`firebase deploy --only firestore:rules` (§1.2)~~ — **done, 31 Aug 2026.**
2. Take the four screenshots (§4). **BY HAND, on a machine with a browser that
   can reach Firestore** — a sandbox cannot, and the wall is a real one rather
   than a missing credential; see §4. This is the whole of the shared spine
   that is left.

**Then Play**, which is ready to go and gated on nothing but the by-hand
console work — see `play-store.md`. **The route is internal testing**, so
there is no closed test, no twelve testers and no fourteen-day clock; an
upload is live to the testers in minutes. Start it first anyway, because it
is the one that can be finished in an evening.

**Then iOS**, which is gated on engineering — see `app-store.md`.

There is no ordering constraint left between them. There used to be one, and
it is worth knowing why it is gone: the plan was production on Play, which
needs twelve people using the app for fourteen days, and the iOS build was not
something they could use — so the clock had to start before the Mac work.
Internal testing has no clock, so the two are independent now. `play-store.md`
§7 is the reasoning, and §8 is the closed test kept as reference.

---

## 6. The photo gallery is user-generated content

`src/components/PhotosView.jsx` lets players upload photos, and **Apple
Guideline 1.2 asks four things of any app with user-generated content**: a
filter for objectionable material, a way to report it, a way to block abusive
users, and published contact information. Play's UGC policy is the same shape.

Nothing in the app answers those four directly, and the honest position is that
the threat model does not apply. Read off `firestore.rules` rather than
remembered:

- **Uploading requires a membership.** `allow create` on `bc_media` needs
  `canWriteEdition()`, which needs `isMember()`, which needs the tournament
  password — and `request.resource.data.uploadedBy == request.auth.uid`, so a
  photo cannot be posted under somebody else's name. The uploaders are sixteen
  men who have played the same tournament since 2015 and see each other every
  July.
- **A guest can look and cannot post.** Reads are `isOpen()`; a guest holds no
  auth token at all, so every write rule refuses them before the UI is
  consulted.
- **Anything can be taken down, by two people.** `allow delete` is the
  director, or the uploader of that photo. There is no orphaned content.
- **The director can turn uploading off entirely** — `photoUploadsOn()`.

**Say it in the Review Notes.** The argument usually works; "usually" is the
problem when you want the submission to pass first time, and a reviewer who
finds a photo gallery with no report button and no explanation is a reviewer
who has to guess:

> The photo gallery is not public user-generated content. Uploading requires
> the private tournament password AND a claimed spot on a fixed sixteen-person
> roster of people who have known each other personally since 2015. Guests can
> view but cannot upload — an unauthenticated visitor holds no account and the
> database refuses every write. Any photo can be removed by the person who
> posted it or by the tournament director from inside the app, and the director
> can disable uploads entirely. Contact: aarondjensen@gmail.com

**There is a Report button now, so two of those four are answered outright**
rather than argued (31 Aug 2026). `src/lib/mediaReports.js` and the
`bc_media_reports` rules block:

- **Report** — in the photo's lightbox, for any signed-in member, on anybody's
  photo but their own (they can already delete that one). One document per
  person per photo, id derived so a second tap overwrites rather than
  accumulating, and the director sees a count beside the uploader's name.
- **Block** — still no, and the honest answer stays the one above: the sixteen
  are invited, and a director removing a photo or a membership is the block.

Reports are **director-only to read**, which is the one line in `firestore.rules`
that is not `isOpen()`. In a group this size "who reported whose photo" is not
a fact to serve to anybody who asks, so the reporter's own UI remembers locally
instead. Creating one needs `isMember()` rather than `canWriteEdition()`, so a
locked past year stays reportable — the lock exists to stop scores changing
after a cup is over, and freezing the one action meant for flagging something
that should not be there would be a strange reading of it.

**Rules deployed 31 Aug 2026**, so the button works. Watch the output for
`uploading rules firestore.rules` rather than `skipping upload` — see §1.2 for
the morning this distinction cost, when a deploy from a stale checkout released
the wrong file and said `Deploy complete!` about it.

**The declaration is ahead of the builds, and that is the thing to keep
straight.** A report button in `main` is not a report button in somebody's
hand:

| Where | Carries it? |
| --- | --- |
| the website | yes, on the next Vercel deploy |
| Play internal testing, `versionCode 100` | **no** — built before it existed |
| App Store Connect `1.0 (1)` | **no** — same |
| anything built from `main` after 31 Aug | yes |

So the Android bundle wants rebuilding (`versionCode 101`) and the iOS
submission wants to be the `1.0 (2)` archive rather than the one already
uploaded. Until then the IARC answer describes a build nobody is running.

Play's IARC questionnaire asks this directly ("Does the app include the ability
to report users or user-generated content?"). It is **yes** from the release
that carries this, and **no** for any build already in a store.
