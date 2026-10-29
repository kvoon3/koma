/**
 * The overview's keyboard navigation: arrows / hjkl / Tab walk a highlight over
 * the nine cells, Enter enters the highlighted one. The manager owns the
 * keyboard while it is open (browse is the only mode with the listener), and a
 * dialog owns it while one is up, so the listener only exists in between.
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

export function useGridKeyboard({ workspaces, activeId, enabled, enter }: {
  workspaces: { id: string }[]
  /** The cell the highlight starts on. */
  activeId: string
  /** The listener exists only in browse; jiggle and the manager own their keys. */
  enabled: boolean
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
    // The page dots own their own keys (Enter opens the manager).
    if (t.closest('[data-board-dots]'))
      return
    const k = e.key
    // An open menu or dialog owns every key while it is up.
    if (t.closest('[role="menu"], [role="dialog"]'))
      return
    // Tab and Enter belong to a focused control (the + cell opens its menu);
    // the arrows still walk the grid, so its highlight never freezes.
    if (t.closest('button, a[href]') && (k === 'Tab' || k === 'Enter'))
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
    if (!enabled)
      return
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])

  return hl
}
