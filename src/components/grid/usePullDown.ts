/**
 * The overview's pull-down: a downward drag anywhere on the board area opens
 * the switcher, through the same morph the Workspace chip uses.
 *
 * It arms only where nothing else owns the press (not in a dialog or the dock,
 * and not on a cell under a mouse, where dnd-kit's 5px reorder drag starts
 * first), it needs a vertical axis lock past the slop, and it commits once, at
 * `PULL_COMMIT`. A tap, a short drag and a sideways drag all leave it alone.
 */
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useRef } from 'react'
import { PAGER_SLOP } from '../../lib/boardPager'
import { lockedAxis, PULL_COMMIT, releaseCapture } from './switcherLayout'

export function usePullDown({ enabled, onOpen, isSuppressed }: {
  /** Only the overview pulls down (the switcher has its own pull up). */
  enabled: boolean
  /** Commit: the switcher opens. */
  onOpen: () => void
  /** Something else took the press (a dnd-kit reorder in flight). */
  isSuppressed: () => boolean
}) {
  const pullRef = useRef<null | { id: number, x0: number, y0: number, axis: 'y' | null }>(null)

  const onPullDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || pullRef.current || e.button !== 0 || !e.isPrimary)
      return
    const target = e.target as HTMLElement
    // The dock sheet is a sibling of the board area anyway, but a dialog can
    // cover it (settings, library, help): neither is the board.
    if (target.closest('[role="dialog"],[data-dock-mode]'))
      return
    // A finger's quick swipe is still ours: the touch sensor only arms a
    // reorder after a 250ms hold, so the pull wins a swipe and loses a hold.
    if (e.pointerType === 'mouse' && target.closest('[data-cell]'))
      return
    pullRef.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, axis: null }
  }

  const onPullMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = pullRef.current
    if (!d || d.id !== e.pointerId)
      return
    if (isSuppressed()) {
      pullRef.current = null
      return
    }
    const dx = e.clientX - d.x0
    const dy = e.clientY - d.y0
    if (d.axis === null) {
      if (Math.abs(dx) < PAGER_SLOP && Math.abs(dy) < PAGER_SLOP)
        return
      // The pager's mirror image: down and vertical, or the press is handed
      // back untouched (a click, a reorder, a sideways pan).
      if (lockedAxis(dx, dy) !== 'y' || dy <= 0) {
        pullRef.current = null
        return
      }
      d.axis = 'y'
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    if (dy >= PULL_COMMIT) {
      pullRef.current = null
      releaseCapture(e.currentTarget, e.pointerId)
      onOpen()
    }
  }

  const onPullEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pullRef.current?.id !== e.pointerId)
      return
    pullRef.current = null
    releaseCapture(e.currentTarget, e.pointerId)
  }

  return { onPullDown, onPullMove, onPullEnd }
}
