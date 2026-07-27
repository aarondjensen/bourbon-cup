import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Honor $PORT so a second dev server on the same machine (the other
  // developer's tooling, or a second agent session) gets the port it was
  // assigned instead of silently drifting to Vite's 5173+1 fallback.
  server: { port: Number(process.env.PORT) || 5173 },
})
