import { describe, expect, it } from 'bun:test'
import { dampOffset, pickSnap, rubberBand } from './dockPhysics'

// offsets for [collapsed, row, expanded] in a 228px clip
const OFF = [200, 128, 0]

describe('rubberBand', () => {
  it('is zero inside, monotonic and bounded outside', () => {
    expect(rubberBand(0)).toBe(0)
    expect(rubberBand(50)).toBeLessThan(50)
    expect(rubberBand(100)).toBeGreaterThan(rubberBand(50))
    expect(rubberBand(1e6)).toBeLessThan(120)
  })
  it('dampOffset passes through inside the range', () => {
    expect(dampOffset(60, 0, 200)).toBe(60)
    expect(dampOffset(-100, 0, 200)).toBeGreaterThan(-100)
    expect(dampOffset(-100, 0, 200)).toBeLessThan(0)
    expect(dampOffset(300, 0, 200)).toBeLessThan(300)
  })
})

describe('pickSnap', () => {
  it('slow release snaps to the nearest', () => {
    expect(pickSnap(OFF, 150, 0, 1)).toBe(1)
    expect(pickSnap(OFF, 185, 0, 1)).toBe(0)
  })
  it('a flick moves at least one snap in its direction', () => {
    expect(pickSnap(OFF, 195, -500, 0)).toBe(1) // up from collapsed
    expect(pickSnap(OFF, 120, -500, 1)).toBe(2) // up from row
    expect(pickSnap(OFF, 130, 500, 1)).toBe(0) // down from row
  })
  it('a hard flick carries past the next snap', () => {
    expect(pickSnap(OFF, 190, -1200, 0)).toBe(2)
  })
  it('a flick at the edge stays put', () => {
    expect(pickSnap(OFF, 0, -800, 2)).toBe(2)
  })
})
