# Working agreement

## Git

This is a two-developer project, so the old "always commit straight to `main`,
never branch" rule no longer applies. `App.jsx` is ~6k lines and is the file
both developers will reach for; unsynchronized pushes to `main` turn that into
hand-merged conflicts.

**Default to a short-lived branch and a PR** for anything beyond a one-file
tweak. Branch from an up-to-date `main`, keep the branch alive for hours not
days, and squash-merge.

Branch cleanup used to be the reason to avoid this: some environments' git
proxy refuses ref deletions (`403` on `git push --delete`, and the GitHub REST
API is gated there too), so branches had to be deleted by hand in the GitHub
UI. The fix is *Settings → General → Automatically delete head branches* on the
repo, which removes merged branches server-side. **Never attempt to delete a
remote branch yourself** — it will fail in some environments; let the merge do
it, or leave it for a human.

Committing directly to `main` is still fine for small, self-contained changes
when you know the other developer isn't mid-change in the same files. When you
do, always `git pull --rebase` before pushing.

Still expected on every commit, branch or not:

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
  current one. Saving it blank turns the requirement off.
- Reading the code is members-only, and that is the whole of the protection —
  a stranger who could read it would not need to be told it. It is readable by
  any of the twelve, not just a director; rules have no director predicate.
  This concedes little, because every `bc_accounts` document already stores the
  code its owner typed and is readable by that owner.
- **A blank or missing code means the door is open.** That is the bootstrap —
  without it the first membership could never be created and the project would
  be locked to its own owners.
- Locking somebody out means deleting their `bc_accounts` document in the
  Firebase console. Rotating the password does not evict anybody already
  through; existing memberships are never re-checked.
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
