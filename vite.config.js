import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  return {
    plugins: [react()],

    build: {
      rollupOptions: {
        output: {
          // ── Splitting the vendor code out of the app's ──
          //
          // React used to ship inside the app chunk, which meant every deploy
          // — a copy change, a colour, a one-line fix — invalidated all of it.
          // A phone on a course with one bar re-downloaded React to pick up a
          // reworded button. React moves on its own clock and the app moves
          // constantly, so split apart a routine deploy re-fetches only the
          // app chunk and the rest comes off disk. WBC and MNQ both already
          // split this way; this brings BC in line with them.
          //
          // Split by SOURCE PATH rather than by named package: `firebase/app`,
          // `firebase/firestore` and `@firebase/*` all resolve into the same
          // node_modules tree, and listing package names by hand misses the
          // transitive half — which is most of it.
          manualChunks(id) {
            if (!id.includes("node_modules")) return;
            // ── The deferred Firebase entry points, each on its own ──
            // None of these is imported statically: messaging is dynamic in
            // firebase.js and lib/notifications.js, functions in lib/accounts
            // and NotificationSettings, storage in lib/mediaUpload. A dynamic
            // import still lands in whatever chunk it is ASSIGNED to, so
            // folding them into the `firebase` catch-all below would undo the
            // deferral and ship all three to every phone anyway — the
            // deliberate `import()` would buy nothing.
            //
            // Split out, they are fetched by the phone that registers for
            // push, the one that deletes its account, and the one that posts a
            // photo — and never by somebody opening a leaderboard.
            if (/[\\/]node_modules[\\/](@firebase|firebase)[\\/]messaging[\\/]/.test(id)) return "firebase-messaging";
            if (/[\\/]node_modules[\\/](@firebase|firebase)[\\/]functions[\\/]/.test(id)) return "firebase-functions";
            if (/[\\/]node_modules[\\/](@firebase|firebase)[\\/]storage[\\/]/.test(id)) return "firebase-storage";
            if (/[\\/]node_modules[\\/](@firebase|firebase|idb)[\\/]/.test(id)) return "firebase";
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react";
            return "vendor";
          },
        },
      },
    },

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
