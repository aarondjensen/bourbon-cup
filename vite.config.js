import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  return {
    plugins: [react()],
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
