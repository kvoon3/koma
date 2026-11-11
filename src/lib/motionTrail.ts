import { prefersReducedMotion } from './viewTransition'

/**
 * The app's drag wake, generalized: one tail eases toward a head point with an
 * exponential lag, and the paint callback draws the gap. Its length is the
 * speed, so a CSS transition cannot express it. One shared frame pump drives
 * every live trail.
 */

/** The tail's lag, in ms: a steady 480px/s drag trails about 58px behind. */
export const TRAIL_TAU = 120
/** A tail shorter than this is not drawn: a stopped head leaves nothing. */
export const TRAIL_MIN = 6
/** Full weight this far past the floor, so a slow nudge stays a smudge. */
export const TRAIL_RAMP = 36
/** The weight at full tilt: always under the head it trails. */
export const TRAIL_MAX = 0.9
/** The gap at which the tail has caught up and the streak retires. */
const TRAIL_DONE = 0.4

export interface TrailPoint {
  x: number
  y: number
}

export interface TrailPaint {
  /** The head's current position. Do not retain the point. */
  head: TrailPoint
  /** Where the lag has reached. Do not retain the point. */
  tail: TrailPoint
  /** 0..TRAIL_MAX, already ramped. Zero means hide the streak. */
  opacity: number
}

export interface Trail {
  /** Seed the tail at the head, with no streak. */
  begin: (p: TrailPoint) => void
  /** Report the head; the pump starts and the tail chases it. */
  push: (p: TrailPoint) => void
  /** Stop now and paint the zero state. */
  cancel: () => void
}

interface LiveTrail {
  paint: (p: TrailPaint) => void
  head: TrailPoint
  tail: TrailPoint
  last: number
}

/** Every live trail shares one frame pump. */
const live = new Set<LiveTrail>()
let frame = 0

/** One exponential step of the tail toward the head. Pure. */
export function trailStep(tail: TrailPoint, head: TrailPoint, dt: number): TrailPoint {
  const k = 1 - Math.exp(-dt / TRAIL_TAU)
  return { x: tail.x + (head.x - tail.x) * k, y: tail.y + (head.y - tail.y) * k }
}

/** The weight of a streak this long. Pure. */
export function trailOpacity(gap: number): number {
  return TRAIL_MAX * Math.min(1, Math.max(0, (gap - TRAIL_MIN) / TRAIL_RAMP))
}

function hide(t: LiveTrail): void {
  t.paint({ head: t.head, tail: t.tail, opacity: 0 })
}

function step(now: number): void {
  frame = 0
  for (const t of live) {
    const dt = t.last ? Math.min(64, now - t.last) : 16
    t.last = now
    t.tail = trailStep(t.tail, t.head, dt)
    const gap = Math.hypot(t.head.x - t.tail.x, t.head.y - t.tail.y)
    if (gap <= TRAIL_DONE) {
      hide(t)
      live.delete(t)
      continue
    }
    t.paint({ head: t.head, tail: t.tail, opacity: trailOpacity(gap) })
  }
  if (live.size)
    frame = requestAnimationFrame(step)
}

/**
 * Create a trail that paints its tail gap through `paint`. The caller owns the
 * head's motion and the pixels; this owns the lag, the ramp, the shared pump
 * and the reduced-motion kill switch.
 */
export function createTrail(paint: (p: TrailPaint) => void): Trail {
  const t: LiveTrail = {
    paint,
    head: { x: 0, y: 0 },
    tail: { x: 0, y: 0 },
    last: 0,
  }
  const stop = () => {
    live.delete(t)
    t.last = 0
    if (!live.size && frame) {
      cancelAnimationFrame(frame)
      frame = 0
    }
  }
  return {
    begin(p) {
      stop()
      t.head.x = p.x
      t.head.y = p.y
      t.tail.x = p.x
      t.tail.y = p.y
      hide(t)
    },
    push(p) {
      if (prefersReducedMotion()) {
        stop()
        t.head.x = p.x
        t.head.y = p.y
        hide(t)
        return
      }
      t.head.x = p.x
      t.head.y = p.y
      if (!live.has(t)) {
        t.last = 0
        live.add(t)
      }
      if (!frame)
        frame = requestAnimationFrame(step)
    },
    cancel() {
      stop()
      hide(t)
    },
  }
}
