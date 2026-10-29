import type { PagerBounds } from './boardPager'
import { describe, expect, it } from 'bun:test'
import { PAGER_SNAP_MS, pagerOffset, pagerPageAt, pagerPages, pagerRest, pagerSnapMs, pagerTravel, releaseVelocity, SAMPLE_STALE_MS } from './boardPager'

const T = 400
const MID: PagerBounds = { before: 2, after: 2 }
const START: PagerBounds = { before: 0, after: 3 }
const END: PagerBounds = { before: 3, after: 0 }

describe('pagerTravel', () => {
  it('is the board width plus a seam', () => {
    expect(pagerTravel(300)).toBeGreaterThan(300)
    expect(pagerTravel(300)).toBeLessThanOrEqual(300 + 0.06 * 300 + 1)
    expect(pagerTravel(10)).toBe(26) // a floor, not a fraction of nothing
  })
})

describe('pagerOffset', () => {
  it('tracks the pointer 1:1 inside the row, across pages', () => {
    expect(pagerOffset(0, T, MID)).toBe(0)
    expect(pagerOffset(37, T, MID)).toBe(37)
    expect(pagerOffset(-37, T, MID)).toBe(-37)
    expect(pagerOffset(T * 2, T, MID)).toBe(T * 2)
    expect(pagerOffset(-T * 2, T, MID)).toBe(-T * 2)
  })

  it('stops at the last page available, leaning past it by at most the band', () => {
    expect(pagerOffset(T * 2, T, MID)).toBe(T * 2)
    expect(pagerOffset(T * 9, T, MID)).toBeLessThan(T * 2 + T * 0.35)
    expect(pagerOffset(-T * 2, T, MID)).toBe(-T * 2)
    expect(pagerOffset(-T * 9, T, MID)).toBeGreaterThan(-T * 2 - T * 0.35)
  })

  it('rubber-bands past an end, starting at 0.3x and never reaching a page', () => {
    // The first px past the edge moves 0.3 px (macOS's gentle lean).
    expect(pagerOffset(5, T, START)).toBeCloseTo(1.5, 1)
    expect(pagerOffset(-5, T, END)).toBeCloseTo(-1.5, 1)
    const lean = pagerOffset(40, T, START)
    expect(lean).toBeGreaterThan(0)
    expect(lean).toBeLessThan(40 * 0.3)
    expect(lean).toBeGreaterThan(40 * 0.25)
    // Monotonic, and bounded well under a page.
    expect(pagerOffset(300, T, START)).toBeGreaterThan(pagerOffset(100, T, START))
    expect(pagerOffset(1e6, T, { before: 0, after: 0 })).toBeLessThan(T * 0.35)
    expect(pagerOffset(-1e6, T, { before: 0, after: 0 })).toBeGreaterThan(-T * 0.35)
  })

  it('leans past the end page, not past zero, when one page remains', () => {
    const one: PagerBounds = { before: 1, after: 0 }
    expect(pagerOffset(T + 5, T, one)).toBeGreaterThan(T)
    expect(pagerOffset(T + 5, T, one)).toBeLessThan(T + 1.5 + 0.01)
  })
})

describe('pagerPages', () => {
  it('stays home under half a page and goes where it leans past it', () => {
    expect(pagerPages(0.4 * T, 0, T, MID)).toBe(0)
    expect(pagerPages(-0.4 * T, 0, T, MID)).toBe(0)
    expect(pagerPages(0.6 * T, 0, T, MID)).toBe(-1)
    expect(pagerPages(-0.6 * T, 0, T, MID)).toBe(1)
  })

  it('settles home on an exact half page', () => {
    expect(pagerPages(0.5 * T, 0, T, MID)).toBe(0)
    expect(pagerPages(-0.5 * T, 0, T, MID)).toBe(0)
    expect(pagerPages(1.5 * T, 0, T, MID)).toBe(-1)
  })

  it('carries at least one page on a flick with the lean', () => {
    expect(pagerPages(0.1 * T, 900, T, MID)).toBe(-1)
    expect(pagerPages(-0.1 * T, -900, T, MID)).toBe(1)
    // A flick from a still start still moves one page.
    expect(pagerPages(0, -900, T, MID)).toBe(1)
  })

  it('does not sail on a return flick', () => {
    expect(pagerPages(0.45 * T, -900, T, MID)).toBe(0)
    expect(pagerPages(-0.45 * T, 900, T, MID)).toBe(0)
  })

  it('projects across several pages, clamped at the row ends', () => {
    // 0.2s at 1500 px/s is 300 screen px: 0.75 page, on top of the drag.
    expect(pagerPages(-T * 1.6, -1500, T, MID)).toBe(2)
    expect(pagerPages(-T * 1.6, -1500, T, END)).toBe(0)
    expect(pagerPages(T * 1.6, 1500, T, START)).toBe(0)
    expect(pagerPages(T * 1.6, 1500, T, MID)).toBe(-2)
  })
})

describe('pagerPageAt', () => {
  it('names the page under the viewport, with ties home and clamped ends', () => {
    expect(pagerPageAt(0, T, MID)).toBe(0)
    expect(pagerPageAt(0.49 * T, T, MID)).toBe(0)
    expect(pagerPageAt(0.51 * T, T, MID)).toBe(-1)
    expect(pagerPageAt(-1.4 * T, T, MID)).toBe(1)
    expect(pagerPageAt(9 * T, T, START)).toBe(0)
    expect(pagerPageAt(-9 * T, T, END)).toBe(0)
  })
})

describe('pagerRest', () => {
  it('rests on the side the step moved, in screen px', () => {
    expect(pagerRest(0, T)).toBe(0)
    expect(pagerRest(1, T)).toBe(-T)
    expect(pagerRest(-1, T)).toBe(T)
    expect(pagerRest(2, T)).toBe(-2 * T)
  })
})

describe('pagerSnapMs', () => {
  it('is the base duration for one page and monotone from there', () => {
    expect(pagerSnapMs(0)).toBe(PAGER_SNAP_MS)
    expect(pagerSnapMs(0)).toBe(pagerSnapMs(-0))
    expect(pagerSnapMs(1)).toBe(PAGER_SNAP_MS)
    expect(pagerSnapMs(2)).toBeGreaterThan(pagerSnapMs(1))
    expect(pagerSnapMs(3)).toBeGreaterThan(pagerSnapMs(2))
    expect(pagerSnapMs(-3)).toBe(pagerSnapMs(3))
    expect(pagerSnapMs(100)).toBe(PAGER_SNAP_MS * 3)
  })
})

describe('releaseVelocity', () => {
  it('keeps a fresh sample and zeroes a stale or cancelled release', () => {
    expect(releaseVelocity(1200, 10, false)).toBe(1200)
    expect(releaseVelocity(-1200, SAMPLE_STALE_MS, false)).toBe(-1200)
    expect(releaseVelocity(1200, SAMPLE_STALE_MS + 1, false)).toBe(0)
    expect(releaseVelocity(1200, 10, true)).toBe(0)
  })
})
