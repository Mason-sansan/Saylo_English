import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** One `/api` rule with `ws: true` so `/api/realtime` upgrades correctly. Splitting `/api/realtime` vs `/api` can match `/api` first and break the WebSocket handshake. */
const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:8787',
    changeOrigin: true,
    ws: true,
    secure: false,
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    /** Default dev server can listen on IPv6-only `localhost`; `http://127.0.0.1:5173` then refuses TCP and WebSocket proxy breaks. */
    host: true,
    port: 5173,
    /** If 5173 is in use, try the next free port (check terminal for the real URL). */
    strictPort: false,
    /** Open the app in the default browser when `npm run dev` starts. */
    open: true,
    proxy: { ...apiProxy },
  },
  /** `vite preview` does not inherit `server.proxy` — without this, `/api/*` stays on the static server and playback/TTS breaks. */
  preview: {
    host: true,
    proxy: { ...apiProxy },
  },
})
