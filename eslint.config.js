import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'ios', 'functions/node_modules']),
  {
    files: ['**/*.{js,jsx}'],
    plugins: { react },
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      // ── A component that isn't imported ──
      // `no-undef` does not see JSX element names, so `<StickyTop>` with no
      // import lints perfectly clean, builds perfectly clean, and throws
      // "Can't find variable" the moment somebody opens that tab. That is
      // exactly how a screen extracted out of App.jsx shipped with two of its
      // imports missing over in WBC: everything green, and the Betting tab
      // dead on tap. App.jsx here is ~5k lines and components get lifted out
      // of it regularly, which is the same move that caused it there.
      //
      // This is the rule that catches it, and it is the only reason
      // eslint-plugin-react is a dependency — nothing else from it is on.
      'react/jsx-no-undef': 'error',
      // `catch {}` is a deliberate shape here: browser APIs that are absent or
      // permission-blocked on some platforms should degrade quietly, not crash.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // Runs in Node, not the browser: the Vite config, the Vercel serverless
    // handlers (which read secrets off `process.env`), the sheet pipeline and
    // the history import script.
    files: ['vite.config.js', 'api/**/*.js', 'pipeline/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    // Cloud Functions — Node, and CommonJS rather than ESM, so `require` and
    // `exports` are globals rather than syntax. Without this block the file
    // reported twelve `no-undef` errors for doing exactly what a Cloud
    // Function is supposed to do, and those twelve were most of the noise the
    // repo's real findings were hiding behind.
    files: ['functions/**/*.js'],
    languageOptions: {
      globals: globals.node,
      sourceType: 'commonjs',
    },
  },
  {
    // The push service worker. Not a page and not Node: it has the worker
    // globals, `importScripts`, and the compat `firebase` object those scripts
    // define on self.
    files: ['public/firebase-messaging-sw.js'],
    languageOptions: {
      globals: { ...globals.serviceworker, firebase: 'readonly' },
    },
  },
])
