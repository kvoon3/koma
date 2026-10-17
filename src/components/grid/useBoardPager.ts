/**
 * The board pager: the receded board inside the switcher, dragged sideways so
 * the neighbouring group's board slides in from the far edge (macOS Spaces),
 * and pulled up to leave the switcher again.
 *
 * The rules are the tools dock's (`lib/dockPhysics`), by way of
 * `lib/boardPager`: a release snaps to the page its position and velocity point
 * at, a flick carries a page on its own, and the ends of the group row
 * rubber-band. Landing on a neighbour is `switchGrid` (navigation, no undo
 * step), so ring and board always agree. The surface it all happens on is
 * `grid/WorkspaceSwitcher`'s `PagerSurface`, laid exactly over the board.
 *
 * The gesture is axis-locked with the vertical pull (`lockedAxis`): sideways is
 * the pager, up is the exit, and a drag too close to the diagonal decides
 * nothing until one side wins.
 */
import type { MotionValue } from 'motion/react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { animate, useMotionValue } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { PAGER_SLOP, PAGER_SNAP_MS, pagerOffset, pagerRestOffset, pagerStep, pagerTravel } from '../../lib/boardPager'
import { prefersReducedMotion } from '../../lib/viewTransition'
import { useStore } from '../../store'
import { lockedAxis, PULL_COMMIT, RECEDE_SCALE, releaseCapture } from './switcherLayout'

/** `--ease-out` as JS: the pager's settle uses the same curve as the CSS. */
const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1]

export function useBoardPager({ open, stageRef, boardRef, stageW, stageH, cell, boxH, gap, cellCount, gridIds, activeIdx, onExit }: {
  /** The switcher is open: the surface is measured, and a close resets the pan. */
  open: boolean
  /** The stage the surface is placed in (measured, not depended on). */
  stageRef: RefObject<HTMLDivElement | null>
  /** The live board: its pan is divided by the recede scale, so it stays 1:1. */
  boardRef: RefObject<HTMLDivElement | null>
  /** The stage and the board it holds: every reason to re-measure. */
  stageW: number
  stageH: number
  cell: number
  boxH: number
  gap: number
  cellCount: number
  /** The group row, in strip order. */
  gridIds: string[]
  /** Where the open group sits in that row. */
  activeIdx: number
  /** Leave the switcher: the pull-up exit, the mirror of the overview's pull-down. */
  onExit: () => void
}) {
  /**
   * The board's offset in screen px. A drag writes it straight (no render per
   * frame, only the ring's lean is state).
   */
  const x: MotionValue<number> = useMotionValue(0)
  /** The card the strip's ring leans onto mid-drag (null = the open group). */
  const [ringId, setRingId] = useState<string | null>(null)
  const ringRef = useRef<string | null>(null)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const geomRef = useRef({ travel: 0 })
  // The press's origin (x0/y0, the 1:1 reference) and its last sample (x/t,
  // for the release speed).
  const dragRef = useRef<null | { id: number, x0: number, y0: number, x: number, y: number, t: number, v: number, axis: 'x' | 'y' | null }>(null)
  const snapRef = useRef<null | { stop: () => void }>(null)
  const settlingRef = useRef(false)

  const hasPrev = activeIdx > 0
  const hasNext = activeIdx >= 0 && activeIdx < gridIds.length - 1

  // The offset reaches two elements that React does not style, so a drag costs
  // no render: the board (inside the column's recede scale, hence the divide;
  // on screen it still tracks the finger 1:1) and the neighbour boards' track.
  useEffect(() => {
    const apply = (v: number) => {
      if (boardRef.current)
        boardRef.current.style.transform = v ? `translateX(${v / RECEDE_SCALE}px)` : ''
      if (trackRef.current)
        trackRef.current.style.transform = v ? `translateX(${v}px)` : ''
    }
    apply(x.get())
    const off = x.on('change', apply)
    return () => {
      off()
    }
  }, [x, boardRef])

  // Where the gesture surface sits, and how far one page of travel is: measured
  // off the receded board itself, so the surface and the neighbour boards land
  // exactly on it. The board's own pan is subtracted, because a switch
  // re-measures while the board is still a page over.
  useLayoutEffect(() => {
    const surface = surfaceRef.current
    const board = boardRef.current
    const stage = stageRef.current
    if (!open || !surface || !board || !stage)
      return
    const s = stage.getBoundingClientRect()
    const b = board.getBoundingClientRect()
    const travel = pagerTravel(b.width)
    surface.style.left = `${b.left - s.left - x.get()}px`
    surface.style.top = `${b.top - s.top}px`
    surface.style.width = `${b.width}px`
    surface.style.height = `${b.height}px`
    surface.style.setProperty('--pager-travel', `${travel}px`)
    geomRef.current.travel = travel
  }, [open, stageRef, boardRef, stageW, stageH, cell, boxH, gap, cellCount, gridIds.length, activeIdx, x])

  const leanTo = (id: string | null) => {
    if (ringRef.current === id)
      return
    ringRef.current = id
    setRingId(id)
  }

  /**
   * Let the board go: the dock's page rules pick the board it lands on, the
   * ring settles on that card, and the switch itself waits until the board has
   * landed, so the board the finger let go of is the one that stays.
   */
  const settle = (velocity: number) => {
    const { travel } = geomRef.current
    const step = pagerStep(x.get(), velocity, travel, hasPrev, hasNext)
    const targetId = step === 0 ? null : gridIds[activeIdx + step] ?? null
    const rest = pagerRestOffset(targetId ? step : 0, travel)
    leanTo(targetId)
    settlingRef.current = true
    const land = () => {
      settlingRef.current = false
      // The board that landed is the store's open group now: swap it in while
      // the pan still holds the board it replaces off the edge, then let the
      // pan go in the same frame, so neither board jumps.
      // eslint-disable-next-line react/dom-no-flush-sync -- the swap and the pan reset must paint together
      flushSync(() => {
        leanTo(null)
        if (targetId)
          useStore.getState().switchGrid(targetId)
      })
      x.jump(0)
    }
    if (prefersReducedMotion()) {
      x.jump(rest)
      land()
      return
    }
    const anim = animate(x, rest, { duration: PAGER_SNAP_MS / 1000, ease: EASE_OUT })
    snapRef.current = anim
    void anim.then(() => {
      if (snapRef.current !== anim)
        return
      snapRef.current = null
      land()
    })
  }

  /** Drop any gesture and put the board home: leaving must never park it. */
  const reset = useCallback(() => {
    dragRef.current = null
    settlingRef.current = false
    snapRef.current?.stop()
    snapRef.current = null
    if (x.get() !== 0)
      x.jump(0)
    if (ringRef.current !== null) {
      ringRef.current = null
      setRingId(null)
    }
  }, [x])

  /**
   * A pull up on the receded board: the way out, the mirror of the overview's
   * pull down. Under `PULL_COMMIT` the board simply stays where it is.
   */
  const pullUp = (e: ReactPointerEvent<HTMLDivElement>, dy: number) => {
    if (dy > -PULL_COMMIT)
      return
    dragRef.current = null
    releaseCapture(e.currentTarget, e.pointerId)
    onExit()
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // A settling board owns the pager until it lands (200ms): a second press
    // mid-settle would fight the animation.
    if (e.button !== 0 || settlingRef.current)
      return
    dragRef.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t: e.timeStamp, v: 0, axis: null }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || d.id !== e.pointerId)
      return
    const dx = e.clientX - d.x0
    const dy = e.clientY - d.y0
    if (d.axis === null) {
      // Under the slop the press is still a click; past it the gesture keeps
      // the axis it picks (sideways = pager, upward = out of the switcher).
      if (Math.abs(dx) < PAGER_SLOP && Math.abs(dy) < PAGER_SLOP)
        return
      const axis = lockedAxis(dx, dy)
      if (!axis)
        return
      d.axis = axis
    }
    if (d.axis === 'y') {
      pullUp(e, dy)
      return
    }
    // Release speed: the slope of the samples, so a flick reads as a flick.
    const dt = e.timeStamp - d.t
    if (dt > 0) {
      const v = ((e.clientX - d.x) / dt) * 1000
      d.v = d.v === 0 ? v : d.v * 0.6 + v * 0.4
      d.x = e.clientX
      d.t = e.timeStamp
    }
    const { travel } = geomRef.current
    const shown = pagerOffset(dx, travel, hasPrev, hasNext)
    x.set(shown)
    // The ring leans with the board: past the half the neighbour's card wears
    // it, so the strip says where a release here would land.
    const lean = shown >= travel / 2 ? -1 : shown <= -travel / 2 ? 1 : 0
    leanTo(lean === 0 ? null : gridIds[activeIdx + lean] ?? null)
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || d.id !== e.pointerId)
      return
    dragRef.current = null
    releaseCapture(e.currentTarget, e.pointerId)
    // A click, or a vertical gesture: nothing moved, nothing switches.
    if (d.axis !== 'x')
      return
    // A held release has no momentum left (and a cancelled one never had it).
    settle(e.type === 'pointercancel' || e.timeStamp - d.t > 80 ? 0 : d.v)
  }

  /** A capture lost mid-gesture (the element going away, the OS taking the pointer) is still a release. */
  const onLostPointerCapture = () => {
    if (!dragRef.current)
      return
    dragRef.current = null
    settle(0)
  }

  return {
    ringId,
    reset,
    surfaceRef,
    trackRef,
    hasPrev,
    hasNext,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onLostPointerCapture },
  }
}
