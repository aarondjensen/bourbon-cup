import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// The outermost boundary, and the only one that can catch App itself.
//
// App carries its own KEYED boundary around the view area, which is what lets
// a crashed tab self-heal when you navigate away. But that boundary lives
// INSIDE App, so it cannot catch anything thrown by App's own body — the
// subscriptions, the derived memos, the header. Those throws unmounted the
// entire tree and left a black page whose only explanation was in a console
// that a phone at a tee box cannot open.
//
// `showDetail` because this one is the last word: there is no tab to switch
// to and no screen behind it, so the error itself is the only thing that can
// tell anybody what happened.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary showDetail>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
