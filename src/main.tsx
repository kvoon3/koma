import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installDebugHandle } from './debug'
import { loadSession, saveSession, sessionMeta } from './lib/sessionStore'
import { router } from './router'
import { useStore } from './store'
import './index.css'

// React Grab, dev server only: hover an element, press ⌘C / Ctrl+C, and paste
// the component stack with source locations into an agent. The dynamic import
// sits behind `import.meta.env.DEV`, which Vite folds to `false` in a build, so
// neither the chunk nor the package reaches the deploy or koma.html.
if (import.meta.env.DEV)
  void import('react-grab')

installDebugHandle()

/** Persist the current state. Photos are put incrementally (see sessionStore). */
function saveNow() {
  const s = useStore.getState()
  void saveSession(sessionMeta(s), s.photos)
}

async function boot() {
  // Hydrate before the first render: the hash URL picks the view, this picks
  // the content, so a refresh lands exactly where it left off.
  const session = await loadSession()
  if (session)
    useStore.getState().hydrate(session)

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  )

  // Autosave on every change (debounced), plus a flush when the page goes
  // away: close/refresh must not lose the tail the debounce would drop.
  let timer: ReturnType<typeof setTimeout> | undefined
  useStore.subscribe(() => {
    clearTimeout(timer)
    timer = setTimeout(saveNow, 800)
  })
  const flush = () => {
    clearTimeout(timer)
    saveNow()
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden')
      flush()
  })
  window.addEventListener('pagehide', flush)
}

void boot()
