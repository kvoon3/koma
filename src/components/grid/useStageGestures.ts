/**
 * The overview's stage gestures: one hook owns every press on the board stage.
 *
 * A press that moves locks one axis past the slop (`lockedAxis`): sideways is
 * the group pager (the board column and quiet previews of the neighbouring
 * groups slide as one row, and a release past half or a flick lands on the
 * neighbour through `switchGrid`), and straight down is the pull-down into
 * the groups page (the old `usePullDown` rule: one commit, at `PULL_COMMIT`).
 * Up and undecided presses do nothing, and a press held still on blank stage
 * for `LONG_PRESS_MS` opens the groups page as well.
 *
 * The pager is the groups page's row moved to the overview at scale 1: the
 * same pure physics from `lib/groupPage` (`pageOffset`, `pageStep`,
 * `pageRestOffset`, `pageTargetIndex`, `pageFalloff`, `pageTravel`), one
 * Motion value the drag writes (the board pans by `v / viewScale` so it still
 * tracks the finger 1:1 under a view zoom, the previews pan raw; the old
 * board switcher divided by its recede scale for the same reason), and one
 * `flushSync` landing that swaps the group and re-bases the row in a frame.
 */
import type { MotionValue } from 'motion/react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { animate, useMotionValue, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { lockedAxis, PAGER_SLOP, PULL_COMMIT, releaseCapture } from '../../lib/gestureAxis'
import { PAGE_SPRING, pageFalloff, pageOffset, pageRestOffset, pageStep, pageTargetIndex } from '../../lib/groupPage'
import { prefersReducedMotion } from '../../lib/viewTransition'

/** A blank press held this long opens the groups page. */
export const LONG_PRESS_MS = 500

/**
 * Selectors that own their press: a cell (the mouse reorder starts there), the
 * dock and any dialog over the stage, and every native control. A press that
 * begins inside one of these is a click on it, not a stage gesture.
 */
const PRESS_OWNER = '[data-cell],[data-dock-mode],button,a,[role="dialog"],input,textarea'

/**
 * Whether a press target is blank stage. Structural over `closest`, so the
 * rule tests without a DOM; the long-press timer that reads it does not.
 */
export function isBlankStageTarget(target: { closest: (selector: string) => unknown } | null | undefined): boolean {
  return target != null && target.closest(PRESS_OWNER) == null
}

export interface StageGestures {
  /** The four handlers for the `[data-board-stage]` container. */
  stageProps: Pick<React.DOMAttributes<HTMLDivElement>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'>
  /** Registers a neighbour preview element (the falloff writes it per frame). */
  registerPreview: (side: 'prev' | 'next', el: HTMLElement | null) => void
  /** The row's live offset, for the measured base of the previews. */
  offset: () => number
  /** The group a drag leans onto (the capsule's `n/N` follows it). */
  targetIndex: number
  /** A pager drag is live: the board column must not take the pointer. */
  panning: boolean
}

interface PressState {
  id: number
  x0: number
  y0: number
  /** Last x sample and its time, for the release speed. */
  x: number
  t: number
  v: number
  axis: 'x' | 'y' | null
}

export function useStageGestures({ enabled, gridIds, activeIndex, travel, viewScale, boardRef, trackRef, onSwitch, onOpenGroups, isSuppressed }: {
  /** The overview owns the stage; other routes keep their presses. */
  enabled: boolean
  /** The group row, in strip order. */
  gridIds: readonly string[]
  /** Where the open group sits in that row. */
  activeIndex: number
  /** How far one page slides: the board's screen width plus its side air. */
  travel: number
  /** The view zoom: the board's pan divides by it to stay 1:1 on screen. */
  viewScale: number
  /** The live board (`[data-board]`): the pan and its falloff land on it. */
  boardRef: RefObject<HTMLDivElement | null>
  /** The previews' track: it pans raw, in screen pixels. */
  trackRef: RefObject<HTMLDivElement | null>
  /** Commit the landing group, in the same flush as the row's re-base. */
  onSwitch: (id: string) => void
  /** Open the groups page: the pull's commit and the long press. */
  onOpenGroups: () => void
  /** Something else took the press (a dnd-kit reorder in flight). */
  isSuppressed: () => boolean
}): StageGestures {
  const x: MotionValue<number> = useMotionValue(0)
  const reduce = !!useReducedMotion()
  const pressRef = useRef<PressState | null>(null)
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const snapRef = useRef<null | { stop: () => void }>(null)
  const previewElsRef = useRef(new Map<'prev' | 'next', HTMLElement>())
  const [panning, setPanning] = useState(false)
  const [targetIndex, setTargetIndex] = useState(activeIndex)
  const targetRef = useRef(activeIndex)

  const count = gridIds.length
  const hasPrev = activeIndex > 0
  const hasNext = activeIndex >= 0 && activeIndex < count - 1
  const travelRef = useRef(travel)
  useLayoutEffect(() => {
    travelRef.current = travel
  })

  const setTarget = useCallback((next: number) => {
    if (targetRef.current === next)
      return
    targetRef.current = next
    setTargetIndex(next)
  }, [])

  /** The row's only writer is this offset; the falloff and the pans follow it. */
  const applyRef = useRef<(v: number) => void>(() => {})
  useEffect(() => {
    const apply = (v: number) => {
      const t = travelRef.current
      const board = boardRef.current
      if (board) {
        // The board is laid out in canvas pixels and scaled by the view zoom,
        // so its pan divides by the scale to move v screen pixels.
        board.style.transform = v ? `translateX(${v / viewScale}px)` : ''
        const live = pageFalloff(t > 0 ? Math.abs(v) / t : 0, reduce)
        board.style.opacity = String(live.opacity)
        board.style.scale = String(live.scale)
      }
      const track = trackRef.current
      if (track)
        track.style.transform = v ? `translate3d(${v}px, 0, 0)` : ''
      for (const [side, el] of previewElsRef.current) {
        const distance = t > 0 ? Math.abs((side === 'prev' ? -t : t) + v) / t : 1
        const fall = pageFalloff(distance, reduce)
        el.style.opacity = String(fall.opacity)
        el.style.scale = String(fall.scale)
      }
    }
    applyRef.current = apply
    apply(x.get())
    const off = x.on('change', apply)
    return () => off()
  }, [x, boardRef, trackRef, viewScale, reduce])

  const registerPreview = useCallback((side: 'prev' | 'next', el: HTMLElement | null) => {
    if (!el) {
      previewElsRef.current.delete(side)
      return
    }
    previewElsRef.current.set(side, el)
    applyRef.current(x.get())
  }, [x])

  const offset = useCallback(() => x.get(), [x])

  useEffect(() => () => snapRef.current?.stop(), [])
  useEffect(() => () => {
    if (pressTimerRef.current != null) {
      clearTimeout(pressTimerRef.current)
      pressTimerRef.current = null
    }
  }, [])

  // A store switch from elsewhere re-bases the lean; the pager's own landing
  // has already set the target, so only an idle row follows.
  useEffect(() => {
    if (!pressRef.current && !snapRef.current)
      setTarget(activeIndex)
  }, [activeIndex, setTarget])

  const clearPressTimer = useCallback(() => {
    if (pressTimerRef.current == null)
      return
    clearTimeout(pressTimerRef.current)
    pressTimerRef.current = null
  }, [])

  const stopPanning = useCallback(() => {
    setPanning(false)
  }, [])

  /** Let the row go: spring to its rest, then swap the group and re-base. */
  const settle = useCallback((velocity: number) => {
    const t = travelRef.current
    const step = pageStep(x.get(), velocity, t, hasPrev, hasNext)
    const rest = pageRestOffset(step, t)
    const nextIndex = Math.min(count - 1, Math.max(0, activeIndex + step))
    const nextId = step === 0 ? null : gridIds[nextIndex] ?? null
    setTarget(nextIndex)
    snapRef.current?.stop()
    const land = () => {
      snapRef.current = null
      // eslint-disable-next-line react/dom-no-flush-sync -- the store swap and the row reset must paint together
      flushSync(() => {
        if (nextId)
          onSwitch(nextId)
        x.jump(0)
      })
      setTarget(nextIndex)
    }
    if (prefersReducedMotion()) {
      x.jump(rest)
      land()
      return
    }
    const anim = animate(x, rest, { ...PAGE_SPRING, velocity })
    snapRef.current = anim
    void anim.then(() => {
      if (snapRef.current !== anim)
        return
      land()
    }).catch(() => {})
  }, [activeIndex, count, gridIds, hasNext, hasPrev, onSwitch, setTarget, x])

  /** Drop a pager drag where it stands: home, now, with no landing. */
  const abortPan = useCallback((el: HTMLElement, pointerId: number) => {
    clearPressTimer()
    snapRef.current?.stop()
    snapRef.current = null
    x.jump(0)
    setTarget(activeIndex)
    stopPanning()
    releaseCapture(el, pointerId)
  }, [activeIndex, clearPressTimer, setTarget, stopPanning, x])

  /** A pull-down reaching the commit opens the groups page, once. */
  const pullDown = (e: ReactPointerEvent<HTMLDivElement>, dy: number) => {
    if (dy < PULL_COMMIT)
      return
    pressRef.current = null
    releaseCapture(e.currentTarget, e.pointerId)
    onOpenGroups()
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || pressRef.current || e.button !== 0 || !e.isPrimary)
      return
    const target = e.target as HTMLElement | null
    // The dock sheet is a sibling of the board area anyway, but a dialog can
    // cover it (settings, library, help): neither is the board.
    if (target?.closest('[role="dialog"],[data-dock-mode]'))
      return
    // A mouse press on a cell belongs to dnd-kit's reorder; a finger's swipe
    // is still ours (the touch sensor only arms a reorder after a 250ms hold,
    // so the pager wins a swipe and loses a hold, like the pull before it).
    if (e.pointerType === 'mouse' && target?.closest('[data-cell]'))
      return
    pressRef.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, t: e.timeStamp, v: 0, axis: null }
    // A still, blank press is the third way into the groups page.
    if (isBlankStageTarget(target)) {
      pressTimerRef.current = setTimeout(() => {
        pressTimerRef.current = null
        if (pressRef.current?.axis != null)
          return
        pressRef.current = null
        onOpenGroups()
      }, LONG_PRESS_MS)
    }
  }

  /**
   * Lock the press's axis once, past the slop: sideways pages, down pulls.
   * Up and still-diagonal presses decide nothing yet, so the press stays
   * armed and a curve that later dominates one way still gets its gesture.
   */
  const lockPressAxis = (d: PressState, dx: number, dy: number, el: HTMLDivElement) => {
    if (Math.abs(dx) < PAGER_SLOP && Math.abs(dy) < PAGER_SLOP)
      return false
    clearPressTimer()
    const axis = lockedAxis(dx, dy)
    if (axis === 'x') {
      d.axis = 'x'
      // While the row slides, no cell may grab the gesture.
      setPanning(true)
      el.setPointerCapture(d.id)
      return true
    }
    if (axis === 'y' && dy > 0) {
      d.axis = 'y'
      el.setPointerCapture(d.id)
      return true
    }
    return false
  }

  /** Release speed: the slope of the samples, so a flick reads as a flick. */
  const trackVelocity = (d: PressState, e: ReactPointerEvent<HTMLDivElement>) => {
    const dt = e.timeStamp - d.t
    if (dt <= 0)
      return
    const v = ((e.clientX - d.x) / dt) * 1000
    d.v = d.v === 0 ? v : d.v * 0.6 + v * 0.4
    d.x = e.clientX
    d.t = e.timeStamp
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = pressRef.current
    if (!d || d.id !== e.pointerId)
      return
    if (isSuppressed()) {
      if (d.axis === 'x')
        abortPan(e.currentTarget, e.pointerId)
      else
        pressRef.current = null
      return
    }
    const dx = e.clientX - d.x0
    const dy = e.clientY - d.y0
    if (d.axis === null && !lockPressAxis(d, dx, dy, e.currentTarget))
      return
    if (d.axis === 'y') {
      pullDown(e, dy)
      return
    }
    trackVelocity(d, e)
    const t = travelRef.current
    const shown = pageOffset(dx, t, hasPrev, hasNext)
    x.set(shown)
    setTarget(pageTargetIndex(shown, t, activeIndex, count))
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = pressRef.current
    if (!d || d.id !== e.pointerId)
      return
    pressRef.current = null
    clearPressTimer()
    releaseCapture(e.currentTarget, e.pointerId)
    if (d.axis === 'y')
      return
    if (d.axis === 'x') {
      stopPanning()
      const cancelled = e.type === 'pointercancel'
      settle(cancelled || e.timeStamp - d.t > 80 ? 0 : d.v)
    }
  }

  return {
    stageProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
    registerPreview,
    offset,
    targetIndex,
    panning,
  }
}
