# Working agreement

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
