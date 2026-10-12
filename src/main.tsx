import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installDebugHandle } from './debug'
import { loadSession, saveSession } from './lib/sessionStore'
import { router } from './router'
import { useStore } from './store'
import './index.css'

installDebugHandle()

/** Persist the current state. Photos are put incrementally (see sessionStore). */
function saveNow() {
  const s = useStore.getState()
  void saveSession(
    {
      workspaces: s.workspaces,
      activeId: s.activeId,
      gap: s.gap,
      radius: s.radius,
      bg: s.bg,
      longSide: s.longSide,
      format: s.format,
      quality: s.quality,
    },
    s.photos,
  )
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
