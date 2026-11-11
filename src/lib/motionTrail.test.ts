import { afterEach, describe, expect, test } from 'bun:test'
import { createTrail, TRAIL_MAX, trailOpacity, trailStep } from './motionTrail'

describe('trailStep', () => {
  test('eases toward the head and never overshoots', () => {
    const first = trailStep({ x: 0, y: 0 }, { x: 100, y: 0 }, 16)
    expect(first.x).toBeGreaterThan(0)
    expect(first.x).toBeLessThan(100)
    const long = trailStep({ x: 0, y: 0 }, { x: 100, y: 0 }, 5000)
    expect(long.x).toBeCloseTo(100, 6)
  })
})

describe('trailOpacity', () => {
  test('nothing below the floor, capped at the maximum', () => {
    expect(trailOpacity(0)).toBe(0)
    expect(trailOpacity(6)).toBe(0)
    expect(trailOpacity(42)).toBeCloseTo(TRAIL_MAX)
    expect(trailOpacity(1000)).toBe(TRAIL_MAX)
  })
})

describe('createTrail', () => {
  const originalRaf = globalThis.requestAnimationFrame
  const originalCancel = globalThis.cancelAnimationFrame
  const originalMatchMedia = globalThis.matchMedia
  let scheduled: { id: number, cb: FrameRequestCallback }[] = []
  let paints: { x: number, opacity: number }[] = []
  let nextId = 1

  function install() {
    scheduled = []
    paints = []
    nextId = 1
    Object.assign(globalThis, {
      matchMedia: () => ({ matches: false }),
      requestAnimationFrame: (cb: FrameRequestCallback) => {
        const id = nextId++
        scheduled.push({ id, cb })
        return id
      },
      cancelAnimationFrame: (id: number) => {
        scheduled = scheduled.filter(frame => frame.id !== id)
      },
    })
  }

  function runFrame(now: number) {
    scheduled.shift()?.cb(now)
  }

  afterEach(() => {
    Object.assign(globalThis, {
      requestAnimationFrame: originalRaf,
      cancelAnimationFrame: originalCancel,
      matchMedia: originalMatchMedia,
    })
  })

  test('one pump chases the head and hides at rest', () => {
    install()
    const trail = createTrail(({ tail, opacity }) => paints.push({ x: tail.x, opacity }))
    trail.begin({ x: 0, y: 0 })
    expect(paints.at(-1)?.opacity).toBe(0)

    trail.push({ x: 100, y: 0 })
    expect(scheduled).toHaveLength(1)
    runFrame(16)
    expect(paints.at(-1)?.x).toBeGreaterThan(0)
    expect(paints.at(-1)?.opacity).toBeGreaterThan(0)

    let now = 16
    for (let i = 0; i < 200 && scheduled.length; i++) {
      now += 16
      runFrame(now)
    }
    expect(paints.at(-1)?.opacity).toBe(0)
    expect(scheduled).toHaveLength(0)
  })

  test('two trails share one frame and retire independently', () => {
    install()
    const a = createTrail(({ opacity }) => paints.push({ x: 0, opacity }))
    const b = createTrail(({ opacity }) => paints.push({ x: 1, opacity }))
    a.push({ x: 100, y: 0 })
    b.push({ x: 100, y: 0 })
    expect(scheduled).toHaveLength(1)
    runFrame(16)
    expect(paints.filter(p => p.x === 0).length).toBeGreaterThan(0)
    expect(paints.filter(p => p.x === 1).length).toBeGreaterThan(0)

    a.cancel()
    let now = 16
    for (let i = 0; i < 200 && scheduled.length; i++) {
      now += 16
      runFrame(now)
    }
    expect(scheduled).toHaveLength(0)
  })

  test('cancel hides and stops the pump', () => {
    install()
    const trail = createTrail(({ opacity }) => paints.push({ x: 0, opacity }))
    trail.push({ x: 100, y: 0 })
    runFrame(16)
    trail.cancel()
    expect(paints.at(-1)?.opacity).toBe(0)
    expect(scheduled).toHaveLength(0)
  })
})
