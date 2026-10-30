import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useCallback } from 'react'

/**
 * The groups page keyboard: Escape leaves for the open group's overview. The
 * tiles are buttons, so Tab and Enter (and an open menu or dialog's own keys)
 * keep their native behaviour.
 */
export function useGroupsKeys({ onLeave }: {
  onLeave: () => void
}): (e: ReactKeyboardEvent<HTMLDivElement>) => void {
  return useCallback((e) => {
    if (e.defaultPrevented)
      return
    const target = e.target as HTMLElement
    if (target.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"]'))
      return
    if (e.key !== 'Escape')
      return
    e.preventDefault()
    onLeave()
  }, [onLeave])
}
