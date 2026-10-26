/// <reference types="bun" />
import type { BandSlot } from './dockBand'
import { describe, expect, test } from 'bun:test'
import { BAND_CONCURRENCY, BAND_WINDOW_MAX, BAND_WINDOW_MIN, bandEase, bandProgress, bandPush, bandSchedule } from './dockBand'

/** Tools strictly mid-flight (0 < u < 1) at one progress. */
function inFlight(slots: readonly BandSlot[], p: number): number {
  let n = 0
  for (const s of slots) {
    const u = bandPush(s, p)
    if (u > 0 && u < 1)
      n++
  }
  return n
}

/** The most tools ever mid-flight at once, sampled across the whole band. */
function peakInFlight(slots: readonly BandSlot[]): number {
  let peak = 0
  for (let i = 0; i <= 10_000; i++)
    peak = Math.max(peak, inFlight(slots, i / 10_000))
  return peak
}

/**
 * `ceil(width / step)`: the bound the synthesis corrects candidate 2's
 * `floor(width / step) + 1` to. The epsilon absorbs float division: width and
 * step come from the same derivation, so an exact integer ratio (3 for every
 * unclamped count) can land a hair above the integer and round a ceil up.
 */
const concurrencyBound = (width: number, step: number): number => Math.ceil(width / step - 1e-9)

describe('bandProgress', () => {
  test('is 0 at the row snap and 1 at the expanded snap', () => {
    expect(bandProgress(98, 98, 328)).toBe(0)
    expect(bandProgress(328, 98, 328)).toBe(1)
    expect(bandProgress(213, 98, 328)).toBe(0.5)
  })
  test('clamps a spring overshooting either end', () => {
    expect(bandProgress(-40, 98, 328)).toBe(0)
    expect(bandProgress(9999, 98, 328)).toBe(1)
  })
  test('a degenerate band reads 0 instead of dividing by zero', () => {
    expect(bandProgress(100, 100, 100)).toBe(0)
    expect(bandProgress(200, 100, 100)).toBe(0)
    expect(bandProgress(200, 300, 100)).toBe(0)
    expect(bandProgress(120, 100, Number.NaN)).toBe(0)
  })
})

describe('bandEase', () => {
  test('smoothstep: exact at the ends, symmetric about the middle', () => {
    expect(bandEase(0)).toBe(0)
    expect(bandEase(1)).toBe(1)
    expect(bandEase(0.5)).toBe(0.5)
    for (let x = 0; x <= 1; x += 0.05)
      expect(bandEase(x) + bandEase(1 - x)).toBeCloseTo(1, 12)
  })
  test('has zero slope at both ends, so nothing lurches or snaps', () => {
    const eps = 1e-4
    expect(bandEase(eps) / eps).toBeLessThan(0.01)
    expect((1 - bandEase(1 - eps)) / eps).toBeLessThan(0.01)
  })
  test('clamps outside [0, 1]', () => {
    expect(bandEase(-3)).toBe(0)
    expect(bandEase(4)).toBe(1)
  })
})

describe('bandSchedule', () => {
  const COUNTS = Array.from({ length: 32 }, (_, i) => i + 1)

  test('is empty with nothing to schedule, and one full slot for a single tool', () => {
    expect(bandSchedule(0)).toEqual([])
    expect(bandSchedule(-1)).toEqual([])
    expect(bandSchedule(1)).toEqual([{ start: 0, width: 1 }])
  })

  test('edge exactness: every slot is 0 at p=0 and 1 at p=1, for counts 1..32', () => {
    for (const count of COUNTS) {
      const slots = bandSchedule(count)
      expect(slots).toHaveLength(count)
      for (const s of slots) {
        expect(bandPush(s, 0)).toBe(0)
        expect(bandPush(s, 1)).toBe(1)
      }
      // The first window opens at the row end, the last one closes exactly at
      // the expanded end: `1 - width` plus `width` is exact in floating point.
      expect(slots[0]!.start).toBe(0)
      expect(slots.at(-1)!.start + slots.at(-1)!.width).toBe(1)
    }
  })

  test('the window stays inside its clamped range and is shared by every slot', () => {
    // A lone tool has no sequence to stagger, so its window is the whole band.
    for (const count of COUNTS.slice(1)) {
      const slots = bandSchedule(count)
      const width = slots[0]!.width
      for (const s of slots)
        expect(s.width).toBe(width)
      expect(width).toBeGreaterThanOrEqual(BAND_WINDOW_MIN)
      expect(width).toBeLessThanOrEqual(BAND_WINDOW_MAX)
    }
  })

  test('starts are evenly spaced and strictly increasing', () => {
    for (const count of COUNTS) {
      const slots = bandSchedule(count)
      if (count === 1)
        continue
      const step = slots[1]!.start - slots[0]!.start
      for (let i = 1; i < slots.length; i++) {
        expect(slots[i]!.start).toBeGreaterThan(slots[i - 1]!.start)
        expect(slots[i]!.start - slots[i - 1]!.start).toBeCloseTo(step, 12)
      }
    }
  })

  test('at most ceil(width / step) tools are in flight at once', () => {
    for (const count of COUNTS.slice(1)) {
      const slots = bandSchedule(count)
      const expected = concurrencyBound(slots[0]!.width, slots[1]!.start - slots[0]!.start)
      expect(peakInFlight(slots)).toBe(expected)
    }
  })

  test('aims BAND_CONCURRENCY mid-flight across the plausible dock range', () => {
    // The load-bearing decision for 4 tools vs 12: the same reading, because
    // the window is derived from the target rather than fixed.
    for (let count = 4; count <= 12; count++)
      expect(peakInFlight(bandSchedule(count))).toBe(BAND_CONCURRENCY)
  })
})

describe('bandPush', () => {
  const slots = bandSchedule(6)

  test('is a pure, monotone function of progress within a slot', () => {
    const slot = slots[2]!
    let last = -1
    for (let p = 0; p <= 1; p += 0.01) {
      const u = bandPush(slot, p)
      expect(u).toBeGreaterThanOrEqual(last)
      last = u
    }
  })

  test('is 0 before a slot and 1 after it', () => {
    const slot = slots[3]!
    expect(bandPush(slot, slot.start - 0.001)).toBe(0)
    expect(bandPush(slot, 0)).toBe(0)
    expect(bandPush(slot, slot.start + slot.width + 0.001)).toBe(1)
    expect(bandPush(slot, 1)).toBe(1)
  })

  test('expand and collapse are exact mirrors', () => {
    // Every slot's window is the reverse of its mirror's (starts sum to
    // 1 - width), and smoothstep is symmetric, so the reverse traversal
    // 1 - p hands slot i exactly the complement of what slot n-1-i does.
    // That is what makes the collapse the same motion read backwards.
    for (let i = 0; i < slots.length; i++) {
      const mirror = slots[slots.length - 1 - i]!
      for (let p = 0; p <= 1; p += 0.05)
        expect(bandPush(slots[i]!, p) + bandPush(mirror, 1 - p)).toBeCloseTo(1, 12)
    }
  })

  test('no tool is left mid-flight when the band closes', () => {
    for (const p of [0, 1]) {
      for (const slot of slots)
        expect([0, 1]).toContain(bandPush(slot, p))
    }
  })
})
