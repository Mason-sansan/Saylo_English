import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthContext'

/**
 * StrictMode is off in dev: double mount/teardown was aborting the first WebSocket handshake
 * (Chrome: "WebSocket is closed before the connection is established") and breaking Conversation.
 * VoicePathA already guards stale sockets; re-enable StrictMode if you need double-invocation checks.
 */
createRoot(document.getElementById('root')!).render(
  <AuthProvider>
    <App />
  </AuthProvider>,
)
