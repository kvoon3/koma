import type { Workspace } from '../../store'
/**
 * The overview's keyboard navigation: arrows / hjkl / Tab walk a highlight over
 * the nine cells, Enter enters the highlighted one. The switcher owns the
 * keyboard while it is open, and a dialog owns it while one is up, so the
 * listener only exists in between.
 */
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { gridStep } from '../../lib/workspaces'
import { useStore } from '../../store'

type NavDir = 'left' | 'right' | 'up' | 'down'

/** vim keys and arrows → a grid navigation direction, null for anything else. */
function dirForKey(k: string): NavDir | null {
  if (k === 'h' || k === 'H' || k === 'ArrowLeft')
    return 'left'
  if (k === 'l' || k === 'L' || k === 'ArrowRight')
    return 'right'
  if (k === 'k' || k === 'K' || k === 'ArrowUp')
    return 'up'
  if (k === 'j' || k === 'J' || k === 'ArrowDown')
    return 'down'
  return null
}

export function useGridKeyboard({ workspaces, activeId, switcherOpen, enter }: {
  workspaces: Workspace[]
  /** The cell the highlight starts on. */
  activeId: string
  /** The switcher owns the keyboard while it is open (Esc leaves it). */
  switcherOpen: boolean
  /** Enter a workspace (its cell's id). */
  enter: (id: string) => void
}) {
  const [hl, setHl] = useState(() => {
    const i = workspaces.findIndex(w => w.id === activeId)
    return i === -1 ? 0 : i
  })
  const hlRef = useRef(hl)
  useEffect(
    () => { hlRef.current = hl },
    [hl],
  )

  // The handler only has to *use* the latest `enter` (and read the store); no
  // reason to re-subscribe the window listener when it changes identity.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const t = e.target as HTMLElement
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      return
    const k = e.key
    // A dialog (settings drawer, library, help) owns Tab, the arrows and
    // Enter while it is open, so its own controls stay reachable.
    if (t.closest('[role="dialog"]'))
      return
    const dirKey = dirForKey(k)
    if (dirKey) {
      e.preventDefault()
      setHl(gridStep(hlRef.current, dirKey, useStore.getState().workspaces.length))
      return
    }
    if (k === 'Tab') {
      e.preventDefault()
      setHl(gridStep(hlRef.current, 'next', useStore.getState().workspaces.length))
      return
    }
    if (k === 'Enter') {
      e.preventDefault()
      const ws = useStore.getState().workspaces[hlRef.current]
      if (ws)
        enter(ws.id)
    }
  })

  useEffect(() => {
    if (switcherOpen)
      return
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [switcherOpen])

  return hl
}
