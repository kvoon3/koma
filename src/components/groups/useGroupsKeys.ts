import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useCallback } from 'react'

/**
 * The groups page keyboard: Left/Right and Home/End pick a group, Enter and
 * Escape leave for the open group's overview. A focused button keeps Enter and
 * Space, and an open menu or dialog keeps every key.
 */
export function useGroupsKeys({ activeIndex, count, goTo, onOpen }: {
  activeIndex: number
  count: number
  goTo: (index: number) => void
  onOpen: () => void
}): (e: ReactKeyboardEvent<HTMLDivElement>) => void {
  return useCallback((e) => {
    if (e.defaultPrevented)
      return
    const target = e.target as HTMLElement
    if (target.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"]'))
      return
    const onControl = target.closest('button, a[href]')
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault()
        goTo(Math.max(0, activeIndex - 1))
        break
      case 'ArrowRight':
        e.preventDefault()
        goTo(Math.min(count - 1, activeIndex + 1))
        break
      case 'Home':
        e.preventDefault()
        goTo(0)
        break
      case 'End':
        e.preventDefault()
        goTo(count - 1)
        break
      case 'Enter':
        if (onControl)
          return
        e.preventDefault()
        onOpen()
        break
      case 'Escape':
        e.preventDefault()
        onOpen()
        break
    }
  }, [activeIndex, count, goTo, onOpen])
}
