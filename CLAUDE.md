# Working agreement

## Land it, don't ask

The default is to build the change and merge it. Aaron would rather look at the
result on his phone than read a description of it and approve a plan, and
`git revert` is cheap. A question that the merged result would have answered
faster than the question did is a question that should not have been asked.

So stop doing these:

- asking which of two layouts he prefers before building either one
- describing what a change will look like and waiting for a yes
- offering three options when one is clearly right and the other two exist for
  symmetry
- holding finished work back pending a question the merged result answers
- ending a message with "want me to go ahead?" when nothing is at risk

"He might not like it" is never a reason to hold work back. Land it; he will
say "undo that" and it costs one revert.

### The one exception

Land without asking **unless the change can fail in a way he cannot see.**
Then say so before merging — one or two sentences naming the specific failure,
not a general caveat. That covers:

- **Anything that can lie to the user.** A delete that reports success and
  leaves the record behind. A save that silently drops a field. These look
  correct on screen, which is exactly what makes them dangerous, and "I'll ask
  you to undo it" cannot catch them because there is nothing to see.
- **Writes to the live tournament during play.** Firestore is shared and live.
  There is no revert for a wrong score posted in front of the field.
- **`firestore.rules` and Cloud Functions.** Reverting the commit does not
  un-lock-out a phone mid-round. Ordering still applies: app first, rules
  second.
- **Anything a `git revert` does not actually undo** — a Firestore data
  migration, a Firebase Console setting, a Vercel env var, an iOS
  install-time meta tag that only re-snapshots on reinstall.
- **Work that is finished but inert until somebody deploys.** If a feature
  needs `firebase deploy --only functions` or a rules deploy to function, say
  so plainly at merge time. Otherwise it ships looking complete and fails in
  the field.

The test is not "is this a big change." It is "if this is wrong, will he find
out by looking?" If yes, just land it.

### Flag once

One flag, at the point of merging. Not a caveats section on every message, not
a re-raise of something he already answered. If he says land it anyway, land
it and don't mention it again.

## Git

This is a two-developer project, so the old "always commit straight to `main`,
never branch" rule no longer applies. `App.jsx` is ~6k lines and is the file
both developers will reach for; unsynchronized pushes to `main` turn that into
hand-merged conflicts.

### The shape of one unit of work

**One task → one branch → one squashed commit on `main` → branch deleted.**
Branch from an up-to-date `main`, keep the branch alive for hours not days,
land it, and let the merge remove it.

- **Never reuse a branch across sessions.** A `claude/*` branch is the
  workspace for one task, not a personal long-lived line of development. If a
  branch from a previous session is still open, either land it or abandon it
  deliberately — do not add new work on top of it.
- **Never merge `main` into a working branch.** Rebase instead — `git fetch
  origin`, then `git rebase origin/main`, as two commands, because `&&` is a
  parser error in Windows PowerShell 5.1 and one of the two developers here is
  on it. Back-merges are what braid the history into something unreadable, and
  they are the reason a branch ends up merged into `main` three separate times.
- **Land through a PR, not a local merge.** `gh pr create --fill`, then
  `gh pr merge --squash --delete-branch`. A local `git merge` followed by a
  push to `main` does work, but it skips the PR record *and* it never triggers
  GitHub's *Automatically delete head branches*, which only fires on a PR
  merge. That is how a repo accumulates a dozen fully-merged branches nobody
  can safely identify by eye.

Squash-merging means `git branch --merged origin/main` will stop recognising a
landed branch, because the squashed commit is a new object with no ancestry
link. That is expected. Cleanup is handled by `--delete-branch` at merge time,
not by inspecting merge state afterwards.

Committing directly to `main` is still fine for small, self-contained changes
when you know the other developer isn't mid-change in the same files. When you
do, always `git pull --rebase` before pushing.

### Start and end of every session

**Before starting new work**, run:

```
git fetch --prune
git branch -r --no-merged origin/main
git log --oneline origin/main..<each branch>
```

If anything comes back, name each branch and summarise what it contains before
touching anything else. Do not assume an old branch is stale — check whether
its files exist on `main`. Work has already been stranded this way once.

**Before ending a session**, the branch is either merged, or the closing
message names it explicitly and says why it is still open. A branch that
nobody mentions is a branch that gets forgotten.

### Deleting branches

**Never attempt to delete a remote branch yourself.** Some environments' git
proxy refuses ref deletions (`403` on `git push --delete`, and the GitHub REST
API is gated there too). Let `gh pr merge --delete-branch` do it, or leave it
for a human to clear in the GitHub UI.

### Still expected on every commit, branch or not

- Build before committing — `npm run build` must pass.
- Lint with `npx eslint <changed files>` and compare the error count against
  the same files before the change. The repo carries pre-existing errors; the
  bar is not adding new ones, not a clean sheet.
- Push when the work is done (`origin main`, or the branch + PR).

## Firestore is shared and live

There is one Firebase project behind the app and it holds the real tournament.
`AdminView` auto-saves on edit, so a dev server aimed at production can corrupt
a live round with one stray click — and with two people working, one of you is
eventually editing while the other is running a round.

- To aim a machine at a scratch Firebase project, copy `.env.example` to
  `.env.local` and set every `VITE_FIREBASE_*` var. Partial overrides throw at
  startup on purpose. Unset them all to use production.
- With no override, `src/firebase.js` logs a dev-mode warning naming the live
  project. If you see that warning, assume every write is real.
- A weaker but zero-setup alternative is working inside a throwaway *edition*
  (`bc_dev_<name>`). Editions created now namespace their doc ids, so they're
  isolated from `bc_2025` — but they still live in the production project, so a
  bad delete can still reach real data.
- Never commit Firebase overrides or API secrets. `.env`, `*.local`, and
  `.claude/settings.local.json` are gitignored; the secrets in `api/*.js` are
  set in Vercel, not in the repo.

## The two shells

The app ships three ways off one codebase: the **web app** at
thebourboncup.com, and **Capacitor** builds for iOS and Android. Both stores
get the same shell, the same plugins and the same native branches, and so does
WBC — that symmetry is the point, and it was bought deliberately.

Android used to be a **Trusted Web Activity**: a hollow shell opening the live
site, so a Vercel deploy WAS the Android release. That was a good trade while
it was the only native shell. It stopped being one when iOS arrived, because
Apple has no TWA equivalent — the repo was then running two architectures, two
toolchains, and two sets of things to remember, with only one of them shared
with WBC. Android is Capacitor now and `twa-manifest.json`,
`public/.well-known/assetlinks.json` and bubblewrap are all gone.

What that costs, and it is worth knowing before promising anybody a fix: **the
web build lives inside the binary.** A Vercel deploy no longer reaches an
installed app on either platform. Minutes on Play's internal track, a review
on iOS.

`src/lib/platform.js` is the only file that knows which of the three it is in,
and everything in it is a **no-op on the web by default** — the browser and its
sixteen users are the production app; the store builds are the new thing. The
four subsystems that fork are auth, push, `/api` and the status bar; see
`docs/app-store.md` §2, which explains each and why.

**`isNative()` is not a synonym for iOS.** It was, for exactly as long as
Android was a TWA — a browser, which reported itself as web. Anything recording
WHICH platform a device is has to ask `platformName()`, or every Android phone
files itself as an iPhone in the one field somebody would consult to work out
why a push never arrived.

## The demo edition

`bc_demo` — "DEMO — Testers" — is a whole tournament for the store reviewers
and the twelve Play testers: an invented field, invented courses, and generated
scores. `npm run seed:demo` builds it (dry run by default, `--write` to land it,
`--undo --write` to remove it), and `--add "Name" --team A --index 12.4` adds a
tester. `src/lib/demoSeed.js` decides every document and is unit-tested through
the app's own scoring engine — the demo is not seeded unless it provably
renders. See `docs/store-submission.md` §1.4.

**A demo is not a cup, and that has to be enforced in two places.** The
`tournament_id` filter only covers the screens that read one edition; the app
reaches ACROSS editions in exactly two, and both would otherwise surface twelve
golfers who do not exist:

- **The Data tab** folds whichever edition is open into ten years of career
  records (`lib/archiveLive`). Unchecked, that puts Dave R in the career table
  beside the real field and adds a 2026 cup that was never contested.
- **`cloneEdition`** copies a roster forward, so next year's real tournament
  would open with a dozen men nobody invited.

There is a third, and it is the one that bites hardest: **`bulkLockVerdict`**
("Lock all but 2026") means every OTHER edition, and the demo is another
edition. Sweeping it in freezes the tournament the testers are posting scores
in, and does it invisibly — a director is exempt from the lock they just set,
so the one person able to reproduce it is the one person who cannot see it. The
seed writes `locked: false` explicitly as well.

All three read **`isDemoEdition`**, which lives in `lib/editionLock` (the pure
module — `editions.js` imports firebase and so cannot be imported by anything
unit-tested) and is re-exported from `lib/editions`, where callers reach for it.
The seed writes the flag; `createEdition` never does, so an edition a director
makes is real unless somebody says otherwise. A flag rather than a check on the
id, because the next scratch edition will not be called `bc_demo`. **Anything
else that ever spans editions has to consult it too.**

**Nothing opens on the demo any more.** `defaultEdition` used to fork on
`isNative()` so a store build started in `bc_demo`, because a store build meant
Play's twelve closed-test strangers with no roster row. Internal testing retired
that audience (`play-store.md` §7): a store build is now installed by the same
sixteen men who use the website, and landing THEM on "DEMO — Testers" is the
same failure the fork existed to prevent, pointed the other way. Every install
opens on the cup; `VITE_DEFAULT_EDITION` still overrides. The demo is untouched
and still reachable in ☰ → Tournaments — it is simply not where anybody starts,
and a reviewer's path is the guest door rather than a claimed demo name.

**Inside a demo, every member is an administrator.** `canAdminEdition()` in
`firestore.rules` grants the edition-scoped admin collections — roster, courses,
rounds, matches, groups, tee sheet, handicap overrides, settings, budget and
ledger — to any member whose write has `is_demo` on the edition at BOTH ends, and
`canAdminEdition` in `lib/editionLock` is the app's mirror of it, which is what
stops the app ever drawing an Admin tab whose writes would be refused.

It exists for the store queues: App Review and the twelve Play testers get no
account of ours and no crown, so the roster and the draw would otherwise be a
tab reading "Directors Only". The alternative on the table was an Admin that
renders and refuses, and it is worse — AdminView auto-saves on edit and
`db.upsert` swallows a rejection, so a reviewer would type a name, watch it
appear, and find it gone on the next load.

Three things stay director-only, because they are project-wide and no
`tournament_id` could scope them: **`bc_editions`** (creating, deleting or
unlocking a tournament — and it is where `is_demo` itself lives, so a write
there would let a member mark the real cup as a demo), **`bc_secrets`** (the
password — reading it would hand every reviewer the key to the live cup), and
the **crown** on `bc_accounts`. `demoOnlyAdmin` is what hides those three cards
rather than showing them and having the rules refuse. `bc_media`'s director
clause is left alone too: "delete somebody else's photo" reaches a public
library that is not edition-scoped.

**This needs `firebase deploy --only firestore:rules`**, app first as always.

The demo and the lock are two halves of one problem and neither is the other:
the demo keeps invented players from leaking OUT into a real tournament, the
lock keeps real testers from writing IN to one. Lock the real editions, leave
the demo unlocked.

The writer refuses to touch any other edition: the id is a constant with no
flag to typo, every document is re-checked before a connection opens, the
service-account key is checked against `.firebaserc`, and a full seed aborts if
`bc_demo` holds a document it did not write. `--undo` deletes by the
`seeded_from` mark, so a card a tester signed survives it.

## The old cups

2016–2024 are editions like any other. Switch to one in **☰ → Tournaments**
(anybody) or **Admin → Event → Editions** (a director, who also builds
next year there) and the leaderboard, the draw, the scorecards and the round
detail all work, because nothing about those years is special-cased.

They were not typed in. Three layers build them, each with its own job:

- **`pipeline/editions.mjs`** (`npm run build:editions`) reads the sheets under
  `data/historical sheets` and writes `data/bourbon-cup-editions.json` — teams,
  roster, courses, round setup and the draw. Scores are not copied into it;
  they already exist hole by hole in `bourbon-cup-backbone.json`.
- **`src/lib/historyImport.js`** turns that plus the backbone into the
  documents. Pure — no Firebase, no React — so it is unit-tested.
- **`scripts/import-history.mjs`** (`npm run import:history`) writes them.
  **Dry run by default**; needs `--write`, a service-account key, and
  `firebase-admin` (`npm i --no-save firebase-admin`). It refuses a key for
  another project, and it will not write into an edition that already exists in
  the app — 2025 was entered by hand and accounts are claimed to its roster.
  That is not an overwrite hazard, it is a duplication one: the import's ids
  (`hist_2025_jensen`) don't collide with the app's (`bc_player_<ms>`), so both
  rosters would survive and every screen would show the field twice. Before
  writing, it asks Firestore whether each target edition already holds roster
  rows without an `imported_from` field, which is what will protect 2026. Every
  document it writes carries that field, and a re-run deletes the ones it wrote
  before that it no longer would — which is how a changed player id cleans up
  after itself instead of leaving a second roster behind.

**Who is who is decided in one place** — `pipeline/players.mjs`. The 2022
sheets renamed six men mid-record (Telly is Ben T, House is Shaun W, T-Mo is
Tim C, Weezy is Paul W, Hile is Jim H, Elger is Joe E), and until those folds
were restored the fact layer read them as twelve golfers who happened never to
appear in the same year. Nothing downstream can catch that: a split identity
gives each half a complete, plausible record. `pipeline/players.test.js` pins
every fold, and the registry also carries each player's real name — the app
shows first name and last initial everywhere, so the import writes that form.

The generated fact files are sorted before they are written, so a rebuild is
byte-comparable with what is committed and "does this still reproduce?" has an
answer. `pipeline/export-csv.mjs` rebuilds `data/holes.csv`, `rounds.csv` and
`matches.csv`, which used to be hand-exported and therefore drifted.

A fourth layer answers the questions that span years — **`pipeline/archive.mjs`**
(`npm run build:archive`) writes `data/bourbon-cup-archive.json`, which is what
the **Data** tab reads. See "The Data tab" below.

**The team colours come off the SCOREBOARD banner** — `pipeline/team-brand.mjs`,
run as part of `build:editions`. It is the only place a sheet records them: the
Master Input's team cell is highlighted yellow because it is an input cell, and
the rest of the workbook's colour is the template's own. A black banner hands
over to its type (Shot Callers is black lettered in teal, which is the teal the
app has always drawn them in); a banner in black and white gives no colour and
that side keeps the app's palette. 2016–2018 have no banner colour at all, and
2022 wrote its teams in coloured type rather than a fill — Irons navy, and
Drivers red from the one hex Aaron had to name, which the file says so about. **No logos** — only 2024's workbook has one embedded, and the sheets for
the other years hold none.

**The course handicap is stored, not derived.** Handicaps were pasted into
those sheets as values, per round, already rounded and blended; no single index
reproduces them. So each round is imported already LOCKED and FINAL with the
recorded handicap frozen in the snapshot, which is the app's own mechanism for
"this round never recalculates" (`getRoundCH` reads `lock.players[pid].ch`
first). It is also true: those tournaments are over.

**Nothing is imported that cannot be checked.** `src/lib/historyVerify.js`
scores every imported year with the app's own engine and compares it against
three independent records — the gross totals and handicaps from the backbone,
every match's running status from the scorecards, and Round 4's point share off
the card. `historyImport.fidelity.test.js` runs it on every `npm test`, and the
import script runs the same checks and **refuses to write a year that fails**.
All ten years currently reproduce exactly. If a change to the scoring engine
would re-score 2016, that test is where you find out.

Two things worth knowing before touching it:

- **The shared-ball rounds carry a 50/50 allowance**, which is not an allowance
  anybody played off. The sheets blended Scramble and Pinehurst handicaps
  themselves and wrote the result on both partners' rows, so applying the
  catalog's 35/15 to it blends an already-blended number. See the note in
  `historyImport.js`.
- **Round 4's contribution count is calibrated, not copied.** The sheets set it
  hole by hole and the app holds one number per nine, so the import searches
  for the pair that reproduces the round's recorded point share, breaking ties
  toward the sheet's own numbers.

Switching editions writes a player-less **spectator** identity
(`firebase.spectatorSession`), scoped to the edition it was written for. That
is what stops a player who opened 2019 from being asked to bind their account
to a roster row on a finished tournament — and the scope is what keeps a player
who has never claimed a name meeting the claim screen on the year being played.

## Sign-in

Three steps, each seen once: sign in with Google or Apple (`src/lib/auth.js`),
enter the tournament password, then claim a name off the roster
(`src/lib/accounts.js`, which stores the uid on the `bc_players` document).
Firebase persists the session in IndexedDB, so it survives closing the app —
the old tap-a-player screen kept identity in sessionStorage, which is why
reopening the app always asked again.

The password is the actual access control, and it is enforced by the security
rules, not by the UI. Presenting it mints a `bc_accounts/{uid}` document, and
every write in the project requires that document to exist. The code lives in
`bc_secrets/access`, which **no client may read** — rules `get()` is not
subject to read rules, which is what lets them compare against a secret they
never serve. So it holds against someone reading the bundle or skipping the
app and talking to Firestore directly, which a client-side password check
would not.

- Set or change it in Admin → Event → Access, where **Show** reveals the
  current one. Saving it blank turns the requirement off. Directors only, read
  and write.

**There is a second code, and it is not a second password.** Same card, same
document, `demo_code` rather than `code`. It mints a membership stamped
`demo_only`, and `canWriteEdition()` confines that membership to demo editions
by the same both-ends check a demo administrator gets — so it can claim a name,
score, post and administer inside `bc_demo`, and can do nothing at all to the
cup.

It exists because both stores want a credential typed into a form that is
quoted back on **every future update review**. A tournament password in that
box can never be rotated without breaking the next review, and it is a password
sixteen men say out loud across a table. Learning the reviewer code from a
store form, a screenshot or a leak buys a sandbox.

Two things follow that are easy to get wrong:

- **The client cannot tell which code was typed** — `bc_secrets` is unreadable
  to every client, which is the whole point of it. So `joinWithCode` asks for an
  ordinary membership first and retries stamped only if that is refused. A
  player pays one write, a reviewer two, and neither learns anything about the
  other's code. Asking stamped-first would confine every player the day the two
  codes happened to match.
- **A blank reviewer code fails CLOSED**, unlike the tournament code, whose
  blank is the bootstrap that lets the first membership exist. No second code
  means no second door.

`setAccessCode` and `setDemoAccessCode` both MERGE. `db.create` replaces a
document, and a director changing the tournament password has no reason to be
thinking about the other field — replacing would delete it silently and the
symptom would arrive weeks later as a review that cannot get in.
- **Compared without case** — it gets read aloud and typed into a phone by
  somebody who never saw it written down. The stored value keeps whatever
  casing was typed, so Show still displays it as written; only the comparison
  is flattened.
- **A blank or missing code means the door is open.** That is the bootstrap —
  without it the first membership could never be created and the project would
  be locked to its own owners.
- Locking somebody out means deleting their `bc_accounts` document in the
  Firebase console. Rotating the password does not evict anybody already
  through; existing memberships are never re-checked.

### The guest door

**Sign-in screen → "Look around as a guest"**, `src/lib/guest.js`. It exists
for the store review queues: Google Play's closed test wants a dozen people
tapping around the app for two weeks, and every one of them would otherwise
need the tournament password (which is the one thing the password exists to
withhold) and a roster row (which a director then has to unlink).

A guest is **not signed in to Firebase at all** — no anonymous account, no
uid, no membership document. That is the design, not an economy, because it
makes read-only structural rather than a promise the UI makes:

- Reads in `firestore.rules` are open to everybody (`isOpen()`), which is
  already what lets a spouse open a shared leaderboard link.
- Every write rule in the project starts at `isMember()`, which starts at
  `request.auth != null`. **A guest has no auth token, so a guest cannot write
  a single document** — not a score, not a push token, not a photo, not a bet.
  It is not that the app declines to offer it; the database would refuse it.

Which is also why it needs **no rules deploy and no Firebase console setting**
to work — the two by-hand steps everything else here waits on. Anonymous auth
was the obvious alternative and is the worse one: it hands a guest a uid, and
a uid is one loosened rule away from being a membership.

The identity (`GUEST_USER`, `player_id: "guest"`) matches no roster row, which
is what keeps a guest out of every match, card and ledger row without a single
extra check. Deliberately NOT the spectator id — a spectator is a signed-in
member looking at a year they are not in, and one id for both would let each
one's allowances leak onto the other.

The flag is a localStorage key (`bc_guest`), so a tester who opened the app on
day three of fourteen is still inside it. Signing in for real clears it; **My
Account → Exit Guest Mode** is the way back to the sign-in screen.

What the app withholds rather than lets fail: the Scoring tab says so instead
of showing an empty draw, and My Account drops Notifications (a token write
needs a membership) and Delete Account (there is no account to delete —
guideline 5.1.1(v) is about accounts the app lets you CREATE). Photos and side
bets were already gated on a uid and needed no change.

### Deleting an account

**My Account → Delete Account**, which calls the `deleteAccount` callable in
`functions/index.js`. It exists because the App Store requires it (review
guideline 5.1.1(v): an app with account creation must offer deletion from
inside the app), and it is a Cloud Function because the rules deny every step
of it from a client, on purpose:

- `bc_accounts` is `delete: if false` for everybody. Revoking a membership is a
  console edit, as above.
- `bc_players` is director-only apart from the narrow claim update — and that
  one cannot *unclaim*, because the rule requires the written `auth_uid` to
  equal the caller's, so a null is refused.
- Deleting a Firebase Auth user from a phone additionally demands a recent
  login. The admin SDK does not, which is why nothing here can strand a stale
  session.

Loosening any of those would trade a real guarantee for a convenience. The
callable takes **no uid argument** — it acts on the verified auth context, so
there is no way to phrase a call that deletes somebody else. It goes Firestore
first, Auth user last: the reverse order revokes the caller's own token
mid-run and leaves the login gone with the membership still standing.

What goes: the Auth user, the membership document, the `auth_*` fields on every
roster row that pointed at it (including the email, the only personal
identifier the roster holds), and every push token for those player ids. Roster
rows are matched **across all editions**, unscoped by `tournament_id` — editions
clone the roster, so a uid left linked in `bc_2026` would sign a deleted account
straight back in next year.

What stays: the roster row itself, unlinked and free to claim again, with the
name, handicap, scores and signed cards on it. Since sign-in landed that row is
not the account — it is a tournament entry the director created, carrying holes
other players attested to, and pulling it would rewrite a result the field
already agreed to. It is the same trade the director's own unlink makes. Both
confirm dialogs say so before anybody taps.

Two things stay on the client because only a browser can do them: revoking this
device's FCM subscription, and revoking the Apple token. The second is its own
App Store requirement for Sign in with Apple — skip it and the app stays listed
under Settings → Apple Account on a phone whose account it no longer holds.
Apple's token arrives once, in the credential from a sign-in, and is not
stored, so `revokeProviderAccess` reauthenticates to get a fresh one. It is
best-effort by construction: a blocked popup logs and the deletion proceeds,
because refusing to delete an account over a popup is the worse failure.

- **It needs `firebase deploy --only functions`.** Until that runs the button
  reports that deletion isn't deployed yet rather than failing silently — but
  it does not work. Same by-hand step as the rules.
- Worth testing on a throwaway account after any change to it, and checking all
  three outcomes in the console: membership document gone, roster row surviving
  with `auth_uid: null`, Auth user gone.

## Directors

**One director appoints the next, in Admin → Players.** The crown toggle in the
player modal writes `is_director` on that person's `bc_accounts` document,
which is the flag the security rules check — so the badge on screen and the
access behind it can never disagree. The crown you see in the roster list is
read from the same place.

Two things it deliberately cannot do, both enforced by the rules rather than
by the UI:

- **Appoint somebody who has never signed in.** The flag lives on a membership
  document, and there isn't one until they've been through the password screen.
  The toggle is disabled with that explanation.
- **Change your own.** Nobody appoints themselves, and nobody steps down from
  inside the app — which means the last director can never remove themselves
  and leave the tournament unadministered. Stepping down is a console edit.

**The first director has to come from the Firebase console**, since the rule
requires one to already exist: set `is_director: true` on their
`bc_accounts/{uid}` document. That is also the way back if the set is ever
emptied.

The app reads the same flag to decide whether the Admin tab exists, so a phone
can never show an Admin tab whose writes would be refused. The `isDirector`
field on `bc_players` is vestigial — nothing reads it any more. Rules never
could: finding the roster row whose `auth_uid` is yours would need a query, and
rules only fetch paths they can construct.

What that split buys: a member can do everything a player does from a tee box —
scores, skins, CTPs, card signatures, the round lock, their own push token, and
the one narrow update that claims their own name. Everything AdminView owns —
roster, rounds, matches, courses, groups, tee sheets, settings, editions, the
password — needs director.

- **Set the first flag before deploying rules that depend on it.** Until one
  membership carries it, nobody can edit the tournament at all; the way back is
  the console.
- The director escape hatch on the claim screen grants no Admin any more. It
  gets you into an edition with an empty roster; the flag decides what is there
  when you arrive.
- `firestore.rules.test.mjs` covers all of this against the emulator. Run it
  before deploying a rules change.

Things that will bite you:

- **Neither provider works until it is enabled in the Firebase console**
  (Authentication → Sign-in method). Google is one toggle. Apple needs an
  Apple Developer Program membership — a Services ID, a key and the team id —
  and the Services ID must list
  `https://the-bourbon-cup.firebaseapp.com/__/auth/handler` as a return URL.
- **Every origin you sign in from must be an authorized domain** (Authentication
  → Settings). That includes `localhost` and any Vercel preview URL you actually
  test sign-in on, or you get `auth/unauthorized-domain`.
- **A scratch Firebase project needs its own providers enabled**, or the dev
  server can read data but nobody can log into it.
- **Deploy `firestore.rules` after the app, never before.** Writes require a
  membership document; a phone on an older bundle has no way to get one and
  fails every write silently if the rules land first.
- The director escape hatch (`DIRECTOR_CODE`, typed on the claim screen) exists
  for bootstrapping an edition with an empty roster, and the field only appears
  when the roster IS empty. It is a constant in the bundle, so it is not a
  secret — leaving it reachable on a set-up tournament would hand Admin to
  anyone who reads the JavaScript.

## The Data tab

**☰ → Data**, one row where Player Analytics and Historical Data used to be two.
The toggle inside is **Tournament** / **Player**, and the axis matters: the old
split cut NOW from THEN, so "how has Weezy done" was answered for this year on
one row and nowhere at all for the other ten. Cutting by SUBJECT lets either
half span every year.

- **Tournament** — cup records, every year round by round (tap a year to see the
  running total after each round, and a button inside it to switch editions),
  where the cup turns, and the course passport: 36 courses over 40 rounds, none
  ever played in two different years.
- **Player** — a career table across all ten cups, each row opening onto that
  man's years, formats, partners, singles head-to-heads, scoring profile and
  comebacks. The `Career` / `<year>` chips are a scope, not a second time axis:
  the same table, one man's whole record or one week of it.

### How it loads, and why that way

The app subscribes to ONE edition on purpose — a year is roughly a thousand
documents — so "career records" cannot be answered by opening ten of them. The
years that are over cannot change, so they are precomputed at build time and
**shipped with the app**: `data/bourbon-cup-archive.json`, imported dynamically
by `src/lib/useArchive.js`. Vite gives it a content-hashed chunk of its own,
about **12 KB gzipped**, cached until its bytes change and separate from the
screen's own chunk so restyling the tab does not invalidate a decade of history.
Zero Firestore reads, no security rule, no deploy step. Opening the More menu
prefetches it.

The three alternatives were all worse: ten subscriptions (~10,000 reads a tap),
a precomputed Firestore collection (a read per open, rules to deploy, and a
second copy of the history a console edit could disagree with), or a Cloud
Function (a cold start in front of a tab).

### The one rule that keeps it honest

**The archive holds only years that are over. The running year is live.**
`src/lib/archiveLive.js` turns the active edition into rows of the same shape
and `src/lib/archiveFold.js` folds both together — so this year's matches are
added to last year's record by the code that computed last year's record. There
is no second implementation of "what is a win".

Consequences worth knowing:

- **The live year replaces the archive's copy of itself**, so nothing is counted
  twice when the app is open on a year the archive also has (2025 is both).
  Except when the live year has no matches yet: subscriptions arrive over
  several frames, and letting a half-loaded edition replace a finished year
  would blank a decade of records on screen and then fill them back in.
- **Every number is the app's own engine's.** `pipeline/archive.mjs` scores each
  year through `buildVerified` + `computeMatchResult` — the same path
  `historyVerify` takes and the same one the leaderboard takes when you switch
  into 2019. The archive is a cache of the cards in the sense `editionSummary`
  is; nothing is typed.
- **Rebuild it when the scoring engine or the sheets change** (`npm run
  build:archive`). It is sorted, so a rebuild is byte-comparable and a diff is
  a real answer to "did this change anything".
- **Birdies are GROSS and computed from the holes.** The backbone's own
  eagles/birdies/pars/bogies/doubles are NET — for 2016 R1 they reconstruct
  Andy H's net 78 exactly and his gross 87 not at all — and only the gross ones
  can also be computed for the live year. Two definitions of a birdie on one
  screen is worse than either.
- **Who is who** goes through `canonicalId`: an explicit `career_id`, else the
  canonical id inside an imported row's document id (`hist_2019_paulw`), else
  the registry's every known spelling of the name. A golfer the registry has
  never heard of gets a `live:` id and a career one year long, which is right.
  Nothing writes `career_id` today; it is the escape hatch for two men who
  genuinely share a display name.
- **Partnerships count two-man sides only**, and head-to-heads count singles
  only. Round 4 puts seven men against seven; twenty-one "partnerships" a round
  would bury the four-ball record under teammates who never shared a hole.
- **An unfinished cup is not a record.** It still counts towards careers — those
  matches were played — but not towards closest-ever, biggest-ever, or a best
  week.

## Trip Info

**☰ → Trip Info**, read-only for everybody including the director. The three
questions in the group text the week before: when is it, where are we staying,
what are we playing.

**Nothing on it is a second copy**, and that is the whole design:

- **Dates** are the tournament's own pair — `start_date` / `end_date` on
  `bc_settings/<edition>__tournament`, set in **Admin → Event**. That pair
  is the **source of truth** and everything else reads down from it: the day
  picker on each round offers the days between them, so a round cannot be dated
  outside the trip it belongs to. They started out derived from the round dates
  and that was backwards — a director knows the weekend in February and the
  draw in July, so deriving left the app unable to answer "when is it" for
  exactly the months everybody asks.
- **Each round's day** is `bc_rounds.date`, picked in Admin → Rounds beside
  that round's course and tee times. It is a *choice from the trip's days*, not
  a free calendar; the plain date box only appears when the tournament has no
  dates set yet.
- **Courses** come off the rounds — `bc_rounds.course_id` → `bc_courses`, where
  the director already picks them. Tapping a schedule row opens that course's
  **scorecard** — par, stroke index and yardage per hole, with a tee picker.
  Read-only, same numbers the director edits in Admin → Courses.
- **The house** is the one genuinely new fact typed for this screen:
  `bc_settings/<edition>__trip` (`house_name`, `house_url`), set in Admin → Event.

Schedule and Courses used to be two sections and the second was the first
restated — every course on it was already named on a schedule row. One list
now, and the detail moved behind the tap.

**A new edition inherits none of it.** `cloneEdition` does not copy the trip
document, and it strips `start_date` / `end_date` off the tournament document
it does copy. Last year's rental link and last year's weekend on this year's
Trip Info are the quiet kind of wrong.

`safeHouseUrl` in `src/lib/tripInfo.js` decides what counts as a link: **http
and https only**. A `javascript:` URL in an href runs with the app's own
origin, and "only a director can write it" is the argument behind every stored
XSS there has ever been. A bare `vrbo.com/1234` gets `https://` put on the
front, because that is what somebody actually pastes off a phone.

`coursePar` prefers the **scorecard** over the stored `par` field. The two can
disagree — one came from the import, the other from a director correcting holes
since — and showing both is how a sheet says "Par 71" at the top and totals 72
at the bottom.

Dates are `YYYY-MM-DD` strings end to end — see `src/lib/dates.js`, which owns
that decision for the app. `new Date("2026-07-01")` is UTC midnight, which in
Michigan is the evening of June 30th, so a round on the 1st would read as the
last day of the previous month on the phone of somebody standing on its first
tee. The weekday is worked out arithmetically; the only `Date` in the file is
inside `addDays`, where **both ends are UTC** so the local zone never enters
the calculation.

**The Event tab is condensed by padding and weight, never by dropping a type
rung.** Its inputs stay at 16px on purpose: mobile Safari zooms the page in
when a focused input is under 16px and does not zoom back out, so a smaller box
trades a scroll for a viewport the director has to pinch out of on every field.

**The trip's dates are picked on one calendar**, hotel-style —
`src/components/DateRangePicker.jsx`, opened from the row labelled Dates. First
tap is the first day, second is the last, a third starts over, and a tap before
the current start reads as "no, THIS is the first day" rather than as a request
to drag the start back. The days between fill in, so the length of the weekend
is on screen rather than something you count.

It replaced two `<input type="date">` boxes, and the reasons are worth keeping:
a range asked as two unrelated questions opens two calendars neither of which
can see the other's answer, `type="date"` is a wheel on iOS and a spin-button
on desktop Firefox so it can't be sized to a row, and squeezing it to 12px to
fit walked straight into the zoom trap above. A button focuses nothing, so
nothing zooms.

The arithmetic is all in `lib/dates` and tested there — `monthGrid` (always six
rows, so paging doesn't change the popup's height under your thumb),
`addMonths` (counted in total months, because `new Date(2026, 0, 31)` moved on
a month is March 3rd), `nextRangeSelection` and `rangePosition`. The component
is the drawing of it; nothing in either file constructs a `Date` from a stored
date.

**The Tournament card says whether it saved.** It used to apply the typed name,
location, dates and round count to local state and *then* fire the write —
and `db.upsert` swallows a rejection and returns null. A refused write left
every screen showing exactly what the director had typed, with no toast and
nothing to disagree with, and the change was gone on the next reload. It now
writes first, applies nothing unless the write landed, and toasts either way.

## The money tab

**Admin → Budget**, two sub-tabs, one question asked from both ends. The outer
**Budget** and the inner **Budget** are the same word doing two jobs — the tab
is the money as a whole, the sub-tab is the spending half of it — and that is
worth knowing before writing "Admin → Budget" and meaning either one. The tab
was `$` until it was renamed; the state key is still `money`.

The sub-tab **Budget** is what the trip costs; **Accounting** is what each man
owes against it and what he has paid. They are sub-tabs rather than two tabs
because the join between them is the only interesting number either one has,
and splitting them would put that comparison nowhere:

> SHORT $270 — the trip costs $816.88 a man and you're charging $800.

A director who prices the trip and then books a bigger house has no other way
to notice; the ledger would go on collecting the old figure and come up short
in October. `budgetVsDues` in `src/lib/budget.js` is that line, and it reads
the ledger's own `billed` total so per-player overrides count properly — a
comped man contributes nothing rather than an average.

### The budget

One document per line in `bc_budget`, not one document with an array of lines:
two phones editing that array both write the whole thing and the last one
silently drops the other's line. A line carries its category rather than living
under one, so re-filing it is a field edit. Categories are a fixed catalog
(`BUDGET_CATEGORIES`) for the same reason payment methods are — "what is the
golf costing us" needs a value you can group by, not sixteen spellings of
greens fees. A line whose category was retired shows up under **Other** rather
than vanishing with its money still in the total.

**A line is priced whichever way the director knows it** — `basis` is `total`
or `per_man`, and everything downstream expands it. The house is one number off
a listing; golf is what the course quotes a man. The typed figure is stored as
typed, so a per-man line stays readable as "$90 a man" and its total moves on
its own when the field grows. An absent `basis` is a total, which is what every
line written before it existed is. The DETAIL is optional — a Lodging line for
the house needs no elaboration, and `lineTitle` falls back to the category.

**Estimates and actuals are deliberately not modelled.** A line is one number
and the director decides whether it is a quote or a receipt; two columns would
double the typing on every line for a distinction that matters on three of
them, and a half-filled actuals column reads as a budget that is under by
whatever nobody has entered yet.

A $0 line is legal (something comped, a quote that hasn't come back); a
negative one is not — that is a refund, and refunds belong in the ledger.

### The ledger

What each man owes the director for the weekend, and what he has paid so far.
Nothing to do with the golf, and nothing to do with the Betting tab either —
skins and side bets are settled between players; this is money owed to the
person who fronted the rooms and the greens fees months ago, usually paid back
in installments across the summer.

Three pieces, and only the third is a collection:

- **The tournament figure** — `bc_settings/<edition>__dues`, set in
  **Admin → Budget → Accounting**. Zero (or never set) means there is no ledger, and the
  BALANCE DUE card disappears from every My Account.
- **The per-player override** — `bc_players.dues_amount`, for the man coming
  for one night or the one being comped. A written **0 is an override**, not an
  absence; `hasDuesOverride` is the test, and blank means "use the tournament
  figure". `cloneEdition` deliberately DROPS this field, because last year's
  "$400, Saturday only" carried into a new edition bills somebody wrong on a
  screen nobody would think to re-check.
- **The payments** — `bc_ledger`, one document per installment: amount, date,
  method, note. Dates are `YYYY-MM-DD` strings and are never parsed into a
  `Date`; `new Date("2026-07-01")` is UTC midnight, which in Michigan is the
  evening of June 30th.

**The balance is never stored.** It is `due - paid`, derived every time in
`src/lib/ledger.js`, because a stored third number can disagree with the two it
came from — and that disagreement always surfaces as "the app says I owe $150
and the payments add to $700", which is the argument the ledger exists to end.
It goes negative on an overpayment rather than clamping, and the director's
totals never net one man's overpayment against another's debt.

**Writes are director-only, all of them**, which is the whole authorization
model: a player logging their own payment is a claim, the director receiving it
is the record. That is the opposite shape to `bc_side_bets`, where the two
parties are equals and both get a write — worth noticing before anybody
"consistency-fixes" one to match the other. Reads are open like everything else
in the project, so a member could read another man's balance by talking to
Firestore directly; the screens only ever show a player their own.

A player who owes anything gets a **red dot** on the More tab and on the My
Account row inside it. The finalize dot is amber and wins when both are lit —
it has a deadline, the money will still be owed after the round is in.

**A write that is refused says so.** `db.upsert(col, data, { loud: true })`
leaves the rejection in, and `writeFailure` in `src/firebase.js` turns
`permission-denied` into "the security rules may not be deployed yet" instead
of "try again" — which is a lie when the answer is "and it never will until
somebody deploys". Every money write goes through it, and they all return
`{ ok, error }` rather than a boolean. **A form's object is passed through
WHOLE** (`buildBudgetLine({ ...form, … })`) rather than re-listed field by
field: the handler used to name each one, and when the form grew a `basis`
toggle it silently dropped it — the sheet showed "$90 × 16 = $1,440" and the
database got a flat $90 total.

**Both need `firestore.rules` deployed** to work: `bc_ledger` and `bc_budget`
are new collections, and until the rules land the default-deny at the bottom of
that file refuses every read of them. App first, rules second, as always.

## The api/ handlers during local dev

`api/*.js` are Vercel serverless functions and do not run under `npm run dev`.
`vite.config.js` proxies `/api` to the deployed site so GHIN and course lookups
work locally with no credentials on the machine — the deployed function holds
them. Two consequences:

- A local `/api` call exercises the DEPLOYED handler, not your edits to it.
  Changing `api/ghin.js` itself needs `vercel dev` plus real credentials; point
  `VITE_API_PROXY` at that instead.
- These are live third-party calls against the real GHIN account. Fine for
  lookups, but don't loop them.

**When a GHIN sync fails, open `/api/ghin?diagnose=1&ghin=<a linked number>`.**
A batch sync reporting "N failed" means the login hop worked and every golfer
read did not — the two hops fail in completely different ways and the count
alone cannot tell you which. The probe reproduces both and reports what each
one actually answered: statuses, the field the session token came out of, the
response key names, and the upstream body when a hop errored. It returns no
credential and no golfer data, so it is safe on the public endpoint. It needs a
Vercel deploy but no app build, which is the point — the phone that hit the
failure is running a bundle inside a binary and cannot be patched today.

`fetchGolfer` tries `/golfers/{n}.json` and falls back to
`/golfers/search.json?golfer_id=` — the same endpoint the name search uses — so
one of the two moving is no longer a whole-batch outage. The fallback only runs
when the first returns nothing, and a golfer's `via` field says which answered.

## Verifying UI changes

Screenshots beat assertions for anything visual. The pattern that works here:
a throwaway harness (`harness.html` + `src/__harness.jsx`) that mounts the real
component with mock props, driven by Playwright against
`/opt/pw-browsers/chromium-*/chrome-linux/chrome`.

Two rules for it:

- **Block the network.** `AdminView` auto-saves to Firestore on edit, so a
  harness click can reach the live tournament data. Route everything through
  Playwright and abort anything that isn't the local dev server or Google
  Fonts.
- **Delete the harness before committing.** It is scaffolding, not source. If
  it needed a temporary `export` on an internal component, revert that too.

Note that the theme locks `html/body` to `overflow: hidden`, so the page itself
does not scroll — screenshot with `fullPage: true` or scroll the app's own
scroll container from JS.

**`Toast` is portaled to `<body>`, and it has to stay that way.** In Chromium
`position: fixed` ALWAYS creates a stacking context, z-index or not. The app
shell is `position: fixed`, so anything rendered inside it is confined to the
shell's layer and a portaled `Popup` (z-index 500) paints above ALL of it — the
toast was at z-index 1000 and still lost. Every toast raised while any popup
was open was invisible underneath it. If a fixed overlay ever goes missing,
that is the first thing to check, and `elementFromPoint` at its centre is how
to prove it.
