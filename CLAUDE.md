# Working agreement

## Git

**Commit directly to `main`. Do not create feature branches, and do not open
pull requests unless explicitly asked for one.**

This is a single-maintainer project and branches here cost more than they buy:
this environment's git proxy refuses ref deletions (`403` on
`git push --delete`, and the GitHub REST API is gated at the proxy too), so
every branch created has to be deleted by hand in the GitHub UI afterwards.
Committing straight to `main` is the preferred workflow.

Still expected on every commit:

- Build before committing — `npm run build` must pass.
- Lint with `npx eslint <changed files>` and compare the error count against
  the same files before the change. The repo carries pre-existing errors; the
  bar is not adding new ones, not a clean sheet.
- Push to `origin main` when the work is done.

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
