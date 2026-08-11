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
- **Never merge `main` into a working branch.** Rebase instead:
  `git fetch origin && git rebase origin/main`. Back-merges are what braid the
  history into something unreadable, and they are the reason a branch ends up
  merged into `main` three separate times.
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

## The old cups

2016–2024 are editions like any other. Switch to one in **☰ → Tournaments**
(anybody) or **Admin → Tournament → Editions** (a director, who also builds
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

- Set or change it in Admin → Tournament → Access, where **Show** reveals the
  current one. Saving it blank turns the requirement off. Directors only, read
  and write.
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

## The trip ledger

What each man owes the director for the weekend, and what he has paid so far.
Nothing to do with the golf, and nothing to do with the Betting tab either —
skins and side bets are settled between players; this is money owed to the
person who fronted the rooms and the greens fees months ago, usually paid back
in installments across the summer.

Three pieces, and only the third is a collection:

- **The tournament figure** — `bc_settings/<edition>__dues`, set in
  **Admin → Money**. Zero (or never set) means there is no ledger, and the
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

**It needs `firestore.rules` deployed** to work: `bc_ledger` is a new
collection, and until the rules land the default-deny at the bottom of that
file refuses every read of it. App first, rules second, as always.

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
