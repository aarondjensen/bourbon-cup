import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  return {
    plugins: [react()],

    // ── Unit tests (`npm test` / `npm run test:run`) ──
    // Only the pure modules under src/. firestore.rules.test.mjs at the repo
    // root is deliberately left out: it is an INTEGRATION test that needs the
    // Firestore emulator listening on 127.0.0.1:8080 and dies with
    // ECONNREFUSED without it. Inside the default glob it would make the suite
    // red on a clean checkout, and a suite that is red by default is one
    // everybody learns to ignore.
    //
    // Run the rules suite deliberately, with the emulator up:
    //   firebase emulators:exec --only firestore "npx vitest run firestore.rules.test.mjs"
    test: {
      // pipeline/ is in as well as src/: the identity registry there decides
      // that two rows on two spreadsheets are the same golfer, and it has been
      // wrong in a way nothing downstream can notice — a split identity gives
      // each half a complete, plausible record. It is a pure module like the
      // ones under src/, and it wants the same suite.
      //
      // scripts/ is in for one suite and a different reason. `ios/` is a
      // committed, hand-edited Xcode project that nothing in this repo can
      // compile — no Mac in CI — so scripts/ios-project.test.js reads its
      // plists and its pbxproj as files and asserts the settings are still
      // there. It needs no emulator and no network, so unlike the rules suite
      // it belongs in the default run: the failure it exists to catch is a
      // regenerate or a merge quietly dropping a key, and that is only useful
      // caught on the commit that does it.
      include: ['{src,pipeline,scripts}/**/*.{test,spec}.{js,jsx,mjs}'],
    },

    server: {
      // Honor $PORT so a second dev server on the same machine (the other
      // developer's tooling, or a second agent session) gets the port it was
      // assigned instead of silently drifting to Vite's 5173+1 fallback.
      port: Number(process.env.PORT) || 5173,

      // ── /api during local dev ──
      // The handlers in api/ are Vercel serverless functions; Vite has no
      // handler for them. Without this proxy a local `fetch("/api/ghin")`
      // falls through to the SPA fallback, comes back as index.html, and dies
      // in `r.json()` — which reads like a GHIN outage but is just routing.
      //
      // Forwarding to a DEPLOYED instance means the GHIN and course-lookup
      // credentials never leave Vercel: no one needs them on their machine to
      // work on the features that consume them. The tradeoff is that this
      // exercises the deployed api/ code, not local edits to it — changing a
      // handler itself still needs `vercel dev` and real credentials.
      //
      // Point somewhere else (a preview deployment, or a local `vercel dev`
      // on another port) by setting VITE_API_PROXY in .env.local.
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY || 'https://thebourboncup.com',
          changeOrigin: true,
        },
      },
    },
  }
})
