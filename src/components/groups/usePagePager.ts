import type { MotionValue } from 'motion/react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { PageLayout } from '../../lib/groupPage'
import { animate, useMotionValue } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { lockedAxis, PAGER_SLOP, releaseCapture } from '../../lib/gestureAxis'
import { PAGE_JUMP_MS, pageAtX, pageFalloff, pageJumpOffset, pageOffset, pageRelease, pageRestOffset, pageStep, pageTargetIndex } from '../../lib/groupPage'
import { EASE_OUT } from '../../lib/motionTokens'

/** Release spring: quick and near-critical, so a flick lands without a bounce. */
const PAGE_SPRING = { type: 'spring', stiffness: 380, damping: 40, mass: 1 } as const

export interface PagePager {
  surfaceRef: RefObject<HTMLDivElement | null>
  trackRef: RefObject<HTMLDivElement | null>
  surfaceProps: Pick<React.DOMAttributes<HTMLDivElement>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onLostPointerCapture' | 'onDragStart'>
  surfaceStyle: CSSProperties
  targetIndex: number
  settling: boolean
  goTo: (index: number) => void
  registerCard: (index: number, el: HTMLElement | null) => void
  reset: () => void
}

interface DragState {
  id: number
  x0: number
  y0: number
  x: number
  t: number
  v: number
  axis: 'x' | 'y' | null
  /** The row was still landing when the press began: a drag cannot fight it. */
  settling: boolean
}

/**
 * The groups page carousel: the row tracks the finger, a release past half or a
 * flick switches the open group and stays on the page, a tap on the live card
 * opens it, and a tap on a visible neighbour centres it. The row is one Motion
 * value; the per-frame falloff writes each card's opacity and scale directly, so
 * a drag costs no React render.
 */
export function usePagePager({ layout, gridIds, activeIndex, onSwitch, onOpen, reduce }: {
  layout: PageLayout
  gridIds: readonly string[]
  activeIndex: number
  /** Commit the open group, in the same commit as the row's re-base. */
  onSwitch: (id: string) => void
  /** Leave for the open group's overview. */
  onOpen: () => void
  reduce: boolean
}): PagePager {
  const x: MotionValue<number> = useMotionValue(0)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const cardElsRef = useRef(new Map<number, HTMLElement>())
  const dragRef = useRef<DragState | null>(null)
  const snapRef = useRef<null | { stop: () => void }>(null)
  const settlingRef = useRef(false)
  const [settling, setSettling] = useState(false)
  const [targetIndex, setTargetIndex] = useState(activeIndex)
  const targetRef = useRef(activeIndex)

  const count = gridIds.length
  const hasPrev = activeIndex > 0
  const hasNext = activeIndex >= 0 && activeIndex < count - 1
  const travel = layout.travel
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

  // The row's only writer is this offset. React writes the cards' base left
  // edges, the Motion value writes the track, and the falloff writes the rest.
  useEffect(() => {
    const track = trackRef.current
    if (!track)
      return
    const apply = (v: number) => {
      track.style.transform = v ? `translate3d(${v}px, 0, 0)` : ''
    }
    apply(x.get())
    const off = x.on('change', apply)
    return () => off()
  }, [x])

  const falloffRef = useRef<(v: number) => void>(() => {})
  useLayoutEffect(() => {
    const apply = (v: number) => {
      const t = travelRef.current
      for (const [index, el] of cardElsRef.current) {
        const distance = t > 0 ? Math.abs((index - activeIndex) * t + v) / t : 1
        const fall = pageFalloff(distance, reduce)
        el.style.opacity = String(fall.opacity)
        el.style.scale = String(fall.scale)
      }
    }
    falloffRef.current = apply
    apply(x.get())
    const off = x.on('change', apply)
    return () => off()
  }, [x, activeIndex, reduce])

  const registerCard = useCallback((index: number, el: HTMLElement | null) => {
    if (!el) {
      cardElsRef.current.delete(index)
      return
    }
    cardElsRef.current.set(index, el)
    falloffRef.current(x.get())
  }, [x])

  /** Put the row home before a route change, so no snapshot catches it parked. */
  const reset = useCallback(() => {
    dragRef.current = null
    settlingRef.current = false
    setSettling(false)
    snapRef.current?.stop()
    snapRef.current = null
    if (x.get() !== 0)
      x.jump(0)
    setTarget(activeIndex)
  }, [activeIndex, setTarget, x])

  useEffect(() => () => snapRef.current?.stop(), [])

  // A store switch from elsewhere (add / remove) re-bases the row; the pager's
  // own land has already set the target, so only an idle row follows.
  useEffect(() => {
    if (!dragRef.current && !snapRef.current)
      setTarget(activeIndex)
  }, [activeIndex, setTarget])

  const land = useCallback((nextId: string | null, nextIndex: number) => {
    settlingRef.current = false
    setSettling(false)
    // eslint-disable-next-line react/dom-no-flush-sync -- the store swap and the row reset must paint together
    flushSync(() => {
      if (nextId)
        onSwitch(nextId)
      x.jump(0)
    })
    setTarget(nextIndex)
  }, [onSwitch, setTarget, x])

  const settle = useCallback((velocity: number) => {
    const step = pageStep(x.get(), velocity, travelRef.current, hasPrev, hasNext)
    const rest = pageRestOffset(step, travelRef.current)
    const nextIndex = step === 0 ? activeIndex : activeIndex + step
    const nextId = step === 0 ? null : gridIds[nextIndex] ?? null
    setTarget(nextIndex)
    settlingRef.current = true
    setSettling(true)
    snapRef.current?.stop()
    if (reduce) {
      x.jump(rest)
      land(nextId, nextIndex)
      return
    }
    const anim = animate(x, rest, { ...PAGE_SPRING, velocity })
    snapRef.current = anim
    void anim.then(() => {
      if (snapRef.current !== anim)
        return
      snapRef.current = null
      land(nextId, nextIndex)
    }).catch(() => {})
  }, [activeIndex, gridIds, hasNext, hasPrev, land, reduce, setTarget, x])

  const goTo = useCallback((index: number) => {
    const to = Math.min(count - 1, Math.max(0, index))
    if (to === activeIndex)
      return
    const offset = pageJumpOffset(activeIndex, to, travelRef.current)
    snapRef.current?.stop()
    snapRef.current = null
    setTarget(to)
    settlingRef.current = true
    setSettling(true)
    if (reduce) {
      x.jump(offset)
      land(gridIds[to] ?? null, to)
      return
    }
    const anim = animate(x, offset, { duration: (PAGE_JUMP_MS * Math.abs(to - activeIndex)) / 1000, ease: EASE_OUT })
    snapRef.current = anim
    void anim.then(() => {
      if (snapRef.current !== anim)
        return
      snapRef.current = null
      land(gridIds[to] ?? null, to)
    }).catch(() => {})
  }, [activeIndex, count, gridIds, land, reduce, setTarget, x])

  const lockAxis = (d: DragState, dx: number, dy: number) => {
    if (d.axis !== null)
      return true
    if (Math.abs(dx) < PAGER_SLOP && Math.abs(dy) < PAGER_SLOP)
      return false
    const axis = lockedAxis(dx, dy)
    if (!axis)
      return false
    if (d.settling) {
      dragRef.current = null
      return false
    }
    d.axis = axis
    return true
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0)
      return
    dragRef.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, t: e.timeStamp, v: 0, axis: null, settling: settlingRef.current }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || d.id !== e.pointerId)
      return
    const dx = e.clientX - d.x0
    const dy = e.clientY - d.y0
    if (!lockAxis(d, dx, dy))
      return
    if (d.axis === 'y')
      return
    const dt = e.timeStamp - d.t
    if (dt > 0) {
      const v = ((e.clientX - d.x) / dt) * 1000
      d.v = d.v === 0 ? v : d.v * 0.6 + v * 0.4
      d.x = e.clientX
      d.t = e.timeStamp
    }
    const t = travelRef.current
    const shown = pageOffset(dx, t, hasPrev, hasNext)
    x.set(shown)
    setTarget(pageTargetIndex(shown, t, activeIndex, count))
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || d.id !== e.pointerId)
      return
    dragRef.current = null
    releaseCapture(e.currentTarget, e.pointerId)
    const cancelled = e.type === 'pointercancel'
    const release = pageRelease({ axis: d.axis, dx: e.clientX - d.x0, dy: e.clientY - d.y0, cancelled })
    if (release === 'tap') {
      const rect = surfaceRef.current?.getBoundingClientRect()
      if (!rect)
        return
      const hit = pageAtX(e.clientX - rect.left, layout, activeIndex, count, x.get())
      if (hit == null)
        return
      if (hit === activeIndex)
        onOpen()
      else
        goTo(hit)
      return
    }
    if (release === 'stay')
      return
    settle(cancelled || e.timeStamp - d.t > 80 ? 0 : d.v)
  }

  /** A lost capture mid-drag is still a release: settle where the row is. */
  const onLostPointerCapture = () => {
    if (!dragRef.current)
      return
    dragRef.current = null
    settle(0)
  }

  return {
    surfaceRef,
    trackRef,
    surfaceProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onLostPointerCapture,
      onDragStart: e => e.preventDefault(),
    },
    surfaceStyle: {
      left: 0,
      top: layout.card.y,
      width: layout.stageW,
      height: layout.card.h + (layout.check.inside ? 0 : layout.check.gap + layout.check.size),
    },
    targetIndex,
    settling,
    goTo,
    registerCard,
    reset,
  }
}
