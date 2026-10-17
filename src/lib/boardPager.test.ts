import { describe, expect, it } from 'bun:test'
import { pagerOffset, pagerRestOffset, pagerStep, pagerTravel } from './boardPager'

const T = 400

describe('pagerTravel', () => {
  it('is the board width plus a seam', () => {
    expect(pagerTravel(300)).toBeGreaterThan(300)
    expect(pagerTravel(300)).toBeLessThanOrEqual(300 + 0.06 * 300 + 1)
    expect(pagerTravel(10)).toBe(26) // a floor, not a fraction of nothing
  })
})

describe('pagerOffset', () => {
  it('tracks the pointer 1:1 inside a page', () => {
    expect(pagerOffset(0, T, true, true)).toBe(0)
    expect(pagerOffset(37, T, true, true)).toBe(37)
    expect(pagerOffset(-37, T, true, true)).toBe(-37)
    expect(pagerOffset(T, T, true, true)).toBe(T)
    expect(pagerOffset(-T, T, true, true)).toBe(-T)
  })
  it('stops at one page when the neighbour exists, both ways', () => {
    expect(pagerOffset(T * 3, T, true, true)).toBe(T)
    expect(pagerOffset(-T * 3, T, true, true)).toBe(-T)
  })
  it('rubber-bands at an end, starting at 0.3×', () => {
    // the first px past the edge moves 0.3 px (macOS's gentle lean)
    expect(pagerOffset(5, T, false, true)).toBeCloseTo(1.5, 1)
    expect(pagerOffset(-5, T, true, false)).toBeCloseTo(-1.5, 1)
    const lean = pagerOffset(40, T, false, true)
    expect(lean).toBeGreaterThan(0)
    expect(lean).toBeLessThan(40 * 0.3)
    expect(lean).toBeGreaterThan(40 * 0.25)
  })
  it('never lets an end be pulled a whole page', () => {
    expect(pagerOffset(1e6, T, false, false)).toBeLessThan(T * 0.35)
    expect(pagerOffset(-1e6, T, false, false)).toBeGreaterThan(-T * 0.35)
    // and it is monotonic, so the board follows rather than freezes
    expect(pagerOffset(300, T, false, false)).toBeGreaterThan(pagerOffset(100, T, false, false))
  })
})

describe('pagerStep', () => {
  it('stays home under half a page', () => {
    expect(pagerStep(0.4 * T, 0, T, true, true)).toBe(0)
    expect(pagerStep(-0.4 * T, 0, T, true, true)).toBe(0)
  })
  it('goes where it leans past half a page', () => {
    expect(pagerStep(0.6 * T, 0, T, true, true)).toBe(-1) // right → previous
    expect(pagerStep(-0.6 * T, 0, T, true, true)).toBe(1) // left → next
  })
  it('a flick carries one page even from a short drag', () => {
    expect(pagerStep(0.1 * T, 900, T, true, true)).toBe(-1)
    expect(pagerStep(-0.1 * T, -900, T, true, true)).toBe(1)
  })
  it('a flick the other way stays/returns home', () => {
    expect(pagerStep(0.45 * T, -900, T, true, true)).toBe(0)
    expect(pagerStep(-0.45 * T, 900, T, true, true)).toBe(0)
  })
  it('an end has nowhere to go', () => {
    expect(pagerStep(0.8 * T, 2000, T, false, true)).toBe(0) // first group
    expect(pagerStep(-0.8 * T, -2000, T, true, false)).toBe(0) // last group
  })
})

describe('pagerRestOffset', () => {
  it('rests home or one page over', () => {
    expect(pagerRestOffset(0, T)).toBe(0)
    expect(pagerRestOffset(1, T)).toBe(-T)
    expect(pagerRestOffset(-1, T)).toBe(T)
  })
})
