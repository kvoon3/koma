import type { MotionValue } from 'motion/react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { PointerKind } from '../../lib/overviewGesture'
import type { OverviewMode } from '../../lib/overviewMode'
import type { GridGroup } from '../../lib/workspaces'
import type { ClickGate } from './useClickGate'
import { animate, useMotionValue } from 'motion/react'
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { pagerOffset, pagerPageAt, pagerPages, pagerRest, pagerSnapMs, pagerTravel, releaseVelocity } from '../../lib/boardPager'
import { EASE_OUT } from '../../lib/motionTokens'
import { JIGGLE_HOLD_MS, JIGGLE_SLOP_PX, jiggleArmed, pressOrigin, swipeAxis, swipeSlop } from '../../lib/overviewGesture'
import { nextOverviewMode, OVERVIEW_POLICY } from '../../lib/overviewMode'
import { prefersReducedMotion } from '../../lib/viewTransition'

/**
 * The overview's one pointer owner: a pending press becomes a page drag past
 * its slop, a cell hold belongs to dnd-kit, and an air hold becomes jiggle.
 * Landing moves the track's base, switches the open board inside a flushSync
 * and zeroes the pan in the same tick, so the page under the finger never
 * jumps. External board changes reset the pan in a layout effect instead.
 */
export interface OverviewGestures {
  readonly mode: OverviewMode
  /** A page gesture or its settle is in flight: the dock is put away. */
  readonly busy: boolean
  /** The pager owns the pointer (`data-paging` on the stage). */
  readonly dragging: boolean
  /** The page the dots mark: the release target mid-settle, else the open board. */
  readonly shownIdx: number
  readonly trackRef: RefObject<HTMLDivElement | null>
  readonly handlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void
    onLostPointerCapture: (e: ReactPointerEvent<HTMLElement>) => void
  }
  /** The one gate: mode policy + the post-swipe timestamp. */
  enterCell: (id: string) => void
  openManager: () => void
  closeManager: () => void
  leaveJiggle: () => void
}

interface PendingPress {
  readonly phase: 'pending'
  readonly id: number
  readonly origin: ReturnType<typeof pressOrigin>
  readonly pointer: PointerKind
  readonly x0: number
  readonly y0: number
  readonly t0: number
  /** The pan at the press, so a press that catches a settle keeps tracking 1:1. */
  readonly catchX: number
  readonly wasSettling: boolean
  /** Only the pending phase owns a hold timer. */
  holdTimer: ReturnType<typeof setTimeout> | null
}

interface PagingPress {
  readonly phase: 'paging'
  readonly id: number
  readonly origin: ReturnType<typeof pressOrigin>
  /** The press origin, so dx stays measured from where the finger landed. */
  readonly x0: number
  readonly y0: number
  readonly catchX: number
  /** Last sampled client x and time, for the release velocity. */
  x: number
  t: number
  v: number
}

type Press = PendingPress | PagingPress

interface View {
  scale: number
  travel: number
}

export function useOverviewGestures({ grids, activeIdx, boardW, viewScale, isReorderActive, gate, onEnter, onLand, onBusyChange }: {
  /** Boards in page order. */
  grids: readonly GridGroup[]
  /** The open board's index. */
  activeIdx: number
  /** The board's canvas width. */
  boardW: number
  /** The column's live view zoom. */
  viewScale: number
  /** dnd-kit owns a cell drag: the pager must refuse. */
  isReorderActive: () => boolean
  gate: ClickGate
  /** Open a cell (browse only, after the gate). */
  onEnter: (id: string) => void
  /** Open the board a page landed on (navigation; the hook flushes it with the pan reset). */
  onLand: (gridId: string) => void
  /**
   * The dock busies at the same tick the pager claims, before React commits:
   * the component freezes the measured dock band from this callback, so the
   * board's geometry cannot change under the gesture.
   */
  onBusyChange?: (busy: boolean) => void
}): OverviewGestures {
  const [mode, setMode] = useState<OverviewMode>('browse')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [shownIdx, setShownIdx] = useState(activeIdx)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const x: MotionValue<number> = useMotionValue(0)

  const modeRef = useRef(mode)
  const busyRef = useRef(false)
  const draggingRef = useRef(false)
  const activeIdxRef = useRef(activeIdx)
  const gridsRef = useRef(grids)
  const idsKey = grids.map(g => g.id).join(',')
  const idsKeyRef = useRef(idsKey)
  const onEnterRef = useRef(onEnter)
  const onLandRef = useRef(onLand)
  const onBusyChangeRef = useRef(onBusyChange)
  // Refs are the event-time truth; they follow the committed props after each
  // render rather than mutating during one.
  useLayoutEffect(() => {
    modeRef.current = mode
    activeIdxRef.current = activeIdx
    gridsRef.current = grids
    idsKeyRef.current = idsKey
    onEnterRef.current = onEnter
    onLandRef.current = onLand
    onBusyChangeRef.current = onBusyChange
  })

  const liveTravel = pagerTravel(boardW)
  /** The frozen `{ scale, travel }` of a phase, or the live values while idle. */
  const viewRef = useRef<View>({ scale: viewScale, travel: liveTravel })
  /** The track's layout base, canvas px (`-activeIdx * travel`). */
  const baseRef = useRef(-activeIdx * liveTravel)
  const seenRef = useRef(`${idsKey}:${activeIdx}`)
  const pressRef = useRef<Press | null>(null)
  const settleRef = useRef<null | { stop: () => void }>(null)
  /** The page step a caught settle was heading for; a catch that never arms resumes it. */
  const settleTargetRef = useRef<number | null>(null)
  /** Landing token: a stopped or superseded settle cannot land late. */
  const runRef = useRef(0)
  const boundsRef = useRef({ before: activeIdx, after: Math.max(0, grids.length - 1 - activeIdx) })
  const moveRef = useRef({ dx: 0, dy: 0 })
  const stageRef = useRef<HTMLElement | null>(null)

  const apply = useCallback(() => {
    const track = trackRef.current
    if (!track)
      return
    track.style.transform = `translateX(${baseRef.current + x.get() / viewRef.current.scale}px)`
  }, [x])

  useLayoutEffect(() => {
    apply()
    const off = x.on('change', apply)
    return () => {
      off()
    }
  }, [apply, x])

  const clearHold = useCallback(() => {
    const press = pressRef.current
    if (press?.phase === 'pending' && press.holdTimer != null) {
      clearTimeout(press.holdTimer)
      press.holdTimer = null
    }
  }, [])

  const commitMode = useCallback((next: OverviewMode) => {
    if (next === modeRef.current)
      return
    modeRef.current = next
    setMode(next)
  }, [])

  const setPhase = useCallback((nextBusy: boolean, nextDragging: boolean) => {
    const wasBusy = busyRef.current
    busyRef.current = nextBusy
    draggingRef.current = nextDragging
    setBusy(nextBusy)
    setDragging(nextDragging)
    if (wasBusy !== nextBusy)
      onBusyChangeRef.current?.(nextBusy)
  }, [])

  const stopSettle = useCallback((clearTarget: boolean) => {
    runRef.current++
    settleRef.current?.stop()
    settleRef.current = null
    if (clearTarget)
      settleTargetRef.current = null
  }, [])

  const land = useCallback((pages: number, token: number) => {
    if (runRef.current !== token)
      return
    settleRef.current = null
    settleTargetRef.current = null
    const lastIdx = Math.max(0, gridsRef.current.length - 1)
    const targetIdx = Math.max(0, Math.min(lastIdx, activeIdxRef.current + pages))
    const targetId = gridsRef.current[targetIdx]?.id
    // The landing's own switch must not be mistaken for an external change.
    seenRef.current = `${idsKeyRef.current}:${targetIdx}`
    baseRef.current = -targetIdx * viewRef.current.travel
    if (pages !== 0 && targetId) {
      // eslint-disable-next-line react/dom-no-flush-sync -- the page swap and the pan reset must paint together
      flushSync(() => {
        onLandRef.current(targetId)
      })
    }
    x.jump(0)
    apply()
    activeIdxRef.current = targetIdx
    setShownIdx(targetIdx)
    setPhase(false, false)
  }, [apply, setPhase, x])

  const settle = useCallback((pages: number) => {
    const token = ++runRef.current
    settleRef.current?.stop()
    settleTargetRef.current = pages
    const travelScreen = viewRef.current.travel * viewRef.current.scale
    const rest = pagerRest(pages, travelScreen)
    draggingRef.current = false
    setDragging(false)
    setShownIdx(Math.max(0, Math.min(gridsRef.current.length - 1, activeIdxRef.current + pages)))
    if (prefersReducedMotion()) {
      x.jump(rest)
      land(pages, token)
      return
    }
    const anim = animate(x, rest, { duration: pagerSnapMs(pages) / 1000, ease: EASE_OUT })
    settleRef.current = { stop: () => anim.stop() }
    void anim.then(() => {
      if (runRef.current === token)
        land(pages, token)
    })
  }, [land, x])

  /** Drop any gesture and put the track home: leaving the stage must never park it. */
  const reset = useCallback(() => {
    stopSettle(true)
    if (pressRef.current?.phase === 'pending' && pressRef.current.holdTimer != null)
      clearTimeout(pressRef.current.holdTimer)
    pressRef.current = null
    if (x.get() !== 0)
      x.jump(0)
    baseRef.current = -activeIdxRef.current * viewRef.current.travel
    apply()
    setPhase(false, false)
    setShownIdx(Math.max(0, Math.min(gridsRef.current.length - 1, activeIdxRef.current)))
  }, [apply, setPhase, stopSettle, x])

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !e.isPrimary)
      return
    if (modeRef.current === 'manage' || pressRef.current || isReorderActive())
      return
    const origin = pressOrigin(e.target)
    if (origin === 'chrome')
      return
    const wasSettling = settleRef.current != null
    if (wasSettling)
      stopSettle(false)
    moveRef.current = { dx: 0, dy: 0 }
    const press: PendingPress = {
      phase: 'pending',
      id: e.pointerId,
      origin,
      pointer: (e.pointerType || 'touch') as PointerKind,
      x0: e.clientX,
      y0: e.clientY,
      t0: e.timeStamp,
      catchX: x.get(),
      wasSettling,
      holdTimer: null,
    }
    pressRef.current = press
    stageRef.current = e.currentTarget
    if (origin === 'air' && OVERVIEW_POLICY[modeRef.current].airHoldEntersJiggle) {
      press.holdTimer = setTimeout(() => {
        if (pressRef.current !== press)
          return
        if (!jiggleArmed(press.origin, JIGGLE_HOLD_MS, moveRef.current.dx, moveRef.current.dy))
          return
        pressRef.current = null
        press.holdTimer = null
        commitMode(nextOverviewMode(modeRef.current, 'hold-air'))
        navigator.vibrate?.(10)
      }, JIGGLE_HOLD_MS)
    }
  }, [commitMode, isReorderActive, stopSettle, x])

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const press = pressRef.current
    if (!press || press.id !== e.pointerId)
      return
    if (modeRef.current === 'manage' || isReorderActive()) {
      clearHold()
      pressRef.current = null
      // A hold that became a reorder while a page was settling leaves the
      // track parked; the pager's phase ends with the press.
      if (busyRef.current)
        reset()
      return
    }
    const dx = e.clientX - press.x0
    const dy = e.clientY - press.y0
    if (press.phase === 'pending') {
      moveRef.current = { dx, dy }
      if (press.holdTimer != null && (Math.abs(dx) > JIGGLE_SLOP_PX || Math.abs(dy) > JIGGLE_SLOP_PX)) {
        clearTimeout(press.holdTimer)
        press.holdTimer = null
      }
      if (swipeAxis(press.origin, press.pointer, dx, dy, false) !== 'x')
        return
      clearHold()
      stageRef.current?.setPointerCapture(press.id)
      boundsRef.current = {
        before: activeIdxRef.current,
        after: Math.max(0, gridsRef.current.length - 1 - activeIdxRef.current),
      }
      pressRef.current = {
        phase: 'paging',
        id: press.id,
        origin: press.origin,
        x0: press.x0,
        y0: press.y0,
        catchX: press.catchX,
        x: e.clientX,
        t: e.timeStamp,
        v: 0,
      }
      setPhase(true, true)
    }
    const paging = pressRef.current
    if (!paging || paging.phase !== 'paging')
      return
    const dt = e.timeStamp - paging.t
    if (dt > 0) {
      const v = ((e.clientX - paging.x) / dt) * 1000
      paging.v = paging.v === 0 ? v : paging.v * 0.6 + v * 0.4
      paging.x = e.clientX
      paging.t = e.timeStamp
    }
    const travelScreen = viewRef.current.travel * viewRef.current.scale
    const shown = pagerOffset(paging.catchX + dx, travelScreen, boundsRef.current)
    x.set(shown)
    const page = Math.max(0, Math.min(
      gridsRef.current.length - 1,
      activeIdxRef.current + pagerPageAt(shown, travelScreen, boundsRef.current),
    ))
    setShownIdx(prev => (prev === page ? prev : page))
  }, [clearHold, isReorderActive, reset, setPhase, x])

  const endPress = useCallback((e: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
    const press = pressRef.current
    if (!press || press.id !== e.pointerId)
      return
    pressRef.current = null
    if (press.phase === 'pending' && press.holdTimer != null)
      clearTimeout(press.holdTimer)
    if (stageRef.current?.hasPointerCapture(press.id))
      stageRef.current.releasePointerCapture(press.id)
    const dx = e.clientX - press.x0
    const dy = e.clientY - press.y0
    if (press.phase === 'pending') {
      if (isReorderActive()) {
        reset()
        return
      }
      const slop = swipeSlop(press.origin) ?? Number.POSITIVE_INFINITY
      const tap = Math.max(Math.abs(dx), Math.abs(dy)) < slop
      // A press that stopped a gliding page completes that landing first. It is
      // never a tap on the page underneath: the caught cell must not enter the
      // editor, and in jiggle the tap must not leave the track parked.
      if (press.wasSettling) {
        gate.mark()
        settle(settleTargetRef.current ?? 0)
        return
      }
      if (!cancelled && tap && press.origin === 'air' && OVERVIEW_POLICY[modeRef.current].airTapExits) {
        commitMode(nextOverviewMode(modeRef.current, 'done'))
        return
      }
      // A drag that decided nothing still must not turn into a click.
      if (!cancelled && !tap)
        gate.mark()
      return
    }
    const travelScreen = viewRef.current.travel * viewRef.current.scale
    const velocity = releaseVelocity(press.v, e.timeStamp - press.t, cancelled)
    const pages = pagerPages(x.get(), velocity, travelScreen, boundsRef.current)
    gate.mark()
    settle(pages)
  }, [commitMode, gate, isReorderActive, reset, settle, x])

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    endPress(e, false)
  }, [endPress])

  const onPointerCancel = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    endPress(e, true)
  }, [endPress])

  const onLostPointerCapture = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const press = pressRef.current
    if (!press)
      return
    // A touch pointer is implicitly captured by the element it landed on. When
    // the pager captures on the stage, that child fires lostpointercapture and
    // it bubbles through here while the stage already owns the pointer: only
    // the stage itself losing its own capture ends the gesture.
    if (e.target !== e.currentTarget)
      return
    pressRef.current = null
    if (press.phase === 'pending' && press.holdTimer != null)
      clearTimeout(press.holdTimer)
    if (press.phase === 'paging') {
      const travelScreen = viewRef.current.travel * viewRef.current.scale
      settle(pagerPages(x.get(), 0, travelScreen, boundsRef.current))
    }
    else if (press.wasSettling) {
      settle(settleTargetRef.current ?? 0)
    }
  }, [settle, x])

  const enterCell = useCallback((id: string) => {
    if (!OVERVIEW_POLICY[modeRef.current].entersCell || gate.blocked())
      return
    onEnterRef.current(id)
  }, [gate])

  const openManager = useCallback(() => {
    reset()
    commitMode(nextOverviewMode(modeRef.current, 'open-manager'))
  }, [commitMode, reset])

  const closeManager = useCallback(() => {
    commitMode(nextOverviewMode(modeRef.current, 'close-manager'))
  }, [commitMode])

  const leaveJiggle = useCallback(() => {
    commitMode(nextOverviewMode(modeRef.current, 'done'))
  }, [commitMode])

  // Esc leaves jiggle; the manager owns Esc through Base UI Dialog while open.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== 'Escape' || modeRef.current !== 'jiggle')
      return
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      return
    if (target.closest('[role="dialog"], [role="menu"]'))
      return
    e.preventDefault()
    leaveJiggle()
  })
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // An external board change (undo, the manager, a hydrate, a session load)
  // resets the pan and the phase before paint. The landing writes `seenRef`
  // itself, so its own switch never takes this path.
  useLayoutEffect(() => {
    const key = `${idsKey}:${activeIdx}`
    if (seenRef.current === key)
      return
    seenRef.current = key
    stopSettle(true)
    if (pressRef.current?.phase === 'pending' && pressRef.current.holdTimer != null)
      clearTimeout(pressRef.current.holdTimer)
    pressRef.current = null
    x.jump(0)
    const live = { scale: viewScale, travel: pagerTravel(boardW) }
    viewRef.current = live
    baseRef.current = -activeIdx * live.travel
    apply()
    setPhase(false, false)
    setShownIdx(Math.max(0, Math.min(grids.length - 1, activeIdx)))
  }, [idsKey, activeIdx, boardW, viewScale, apply, setPhase, stopSettle, x, grids.length])

  // While idle, the track's base and pan follow the live geometry (a resize, a
  // zoom). Frozen for a phase, so a late event cannot move the pages under the
  // pan the gesture was written against.
  useLayoutEffect(() => {
    if (busyRef.current)
      return
    const live = { scale: viewScale, travel: pagerTravel(boardW) }
    viewRef.current = live
    baseRef.current = -activeIdx * live.travel
    if (x.get() !== 0)
      x.jump(0)
    apply()
    setShownIdx(prev => (prev === activeIdx ? prev : Math.max(0, Math.min(grids.length - 1, activeIdx))))
  }, [busy, activeIdx, boardW, viewScale, apply, x, grids.length])

  return {
    mode,
    busy,
    dragging,
    shownIdx,
    trackRef,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture },
    enterCell,
    openManager,
    closeManager,
    leaveJiggle,
  }
}
