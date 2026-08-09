import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
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
