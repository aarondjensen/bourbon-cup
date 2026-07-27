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
