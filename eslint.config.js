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
      // ── Two things core no-unused-vars gets wrong on its own ──
      // ignoreRestSiblings: `const { a, b, ...rest } = obj` is the idiomatic way
      // to OMIT keys. Without it the omitted names read as dead variables, and
      // the "fix" is to delete them — which puts the omitted keys straight back
      // into rest and changes what gets written.
      //
      // jsx-uses-vars (below) is the other half: core ESLint does not count a
      // JSX reference as a use.
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', ignoreRestSiblings: true }],
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
      // The companion. Counts a JSX reference as a USE, which core ESLint does
      // not — so a component or namespace only ever reached from JSX reads as an
      // unused variable, and deleting one to satisfy the lint takes the screen
      // with it. MnQ had six of those, all rendering scorecards.
      'react/jsx-uses-vars': 'error',
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
  // ── The radius scale is the only source of these numbers, in the files that
  //    have been migrated onto it ──
  // WBC enforces this across its whole src/. Here it is scoped to the shared
  // chrome, because the rest of the app still carries ~242 loose radii and
  // snapping those onto rungs is a VISUAL decision on every one of them — not
  // something to do behind a lint rule.
  //
  // The fix is never a new number. It is the rung whose ROLE matches what you
  // are drawing; if none fits, add one in theme.js with a note on what it is
  // for, the way R.modal exists.
  //
  // Widen `files` as more of the app is migrated. theme.js is where the numbers
  // live, so it is not in the list.
  {
    files: ['src/components/Popup.jsx', 'src/components/ui.jsx'],
    rules: {
      'no-restricted-syntax': ['error',
        // Two selectors, not one. A bare descendant match reaches every number
        // in the value expression — the 0 in a comparison, an arithmetic operand
        // — and flags things that were never a radius. A direct-child match
        // alone misses the other half: `cond ? 10 : 8` hides its literals one
        // level down. So: the value itself, plus the BRANCHES of any ternary.
        //
        // Only values at or above the smallest rung (4) are flagged. A 1-3px
        // corner is part of a DRAWING — the nested rings on a score marker, a
        // hairline rule — not a component corner somebody chose off-scale, and
        // no rung is that small on purpose. 0 is exempt for the same reason: a
        // squared-off corner is the absence of a radius.
        {
          selector: 'Property[key.name="borderRadius"] > Literal[value=type(number)][value>=4]',
          message: 'Use a rung off the R scale (R.sm, R.md, R.modal, …) rather than a raw px radius — see theme.js.',
        },
        {
          selector: 'Property[key.name="borderRadius"] ConditionalExpression > Literal[value=type(number)][value>=4]',
          message: 'Use a rung off the R scale (R.sm, R.md, R.modal, …) rather than a raw px radius — see theme.js.',
        },
      ],
    },
  },
])
