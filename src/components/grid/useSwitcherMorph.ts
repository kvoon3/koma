/**
 * The switcher's mode: whether it is open, and the morph that opens or closes
 * it. It is a mode of the overview, not a route (the hash URL keeps meaning the
 * overview), so it lives in React state with a view transition around the flip:
 * the board scales down / back up instead of cutting. Reduced motion or a
 * missing API keeps the synchronous change.
 */
import { useCallback, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { prefersReducedMotion } from '../../lib/viewTransition'
import { useStore } from '../../store'

export function useSwitcherMorph() {
  const [switcher, setSwitcher] = useState(false)
  /**
   * The receding board carries a view-transition name from before the open
   * transition's first snapshot until the close one has painted: the name must
   * sit on the element in BOTH snapshots for the group to morph between the
   * full and the receded board (the app-shrinking feel).
   */
  const [boardNamed, setBoardNamed] = useState(false)
  /** Set by the board pager: leaving drops its gesture (never park the board). */
  const resetRef = useRef<() => void>(() => {})

  /**
   * Open the switcher over the board, or leave it, zooming back into
   * `gridId`'s workspace first when given (switching groups is navigation, no
   * undo step).
   */
  const morphSwitcher = useCallback((open: boolean, gridId?: string) => {
    const apply = () => {
      // Leaving drops the gesture with the mode: the board must never be left
      // parked a page over (Esc mid-drag, a backdrop click, a card, a pull up).
      if (!open)
        resetRef.current()
      if (!open && gridId && gridId !== useStore.getState().activeGridId)
        useStore.getState().switchGrid(gridId)
      setSwitcher(open)
    }
    if (!document.startViewTransition || prefersReducedMotion()) {
      apply()
      setBoardNamed(false)
      return
    }
    if (open) {
      // eslint-disable-next-line react/dom-no-flush-sync -- the name must be on the element before the old snapshot is captured
      flushSync(() => setBoardNamed(true))
    }
    const vt = document.startViewTransition(() => {
      // eslint-disable-next-line react/dom-no-flush-sync -- DOM must match the store before the new snapshot is captured
      flushSync(apply)
    })
    void vt.finished.finally(() => {
      if (!open)
        setBoardNamed(false)
    }).catch(() => {})
  }, [])

  return { switcher, boardNamed, morphSwitcher, resetRef }
}
