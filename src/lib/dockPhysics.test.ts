import { describe, expect, it } from 'bun:test'
import { dampOffset, dragOwner, pickSnap, rubberBand } from './dockPhysics'

// offsets for [icons, row, expanded] in a 228px clip
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
    expect(pickSnap(OFF, 195, -500, 0)).toBe(1) // up from icons
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

const list = (scrollTop: number, clientHeight = 200, scrollHeight = 600) => ({ scrollTop, clientHeight, scrollHeight })

describe('dragOwner', () => {
  it('a plain press on the sheet drags the drawer', () => {
    expect(dragOwner({ horizontal: false, list: null }, 0, 40)).toBe('drawer')
    expect(dragOwner({ horizontal: false, list: null }, 30, 10)).toBe('drawer')
  })

  it('a horizontal swipe in the tools row scrolls the row', () => {
    expect(dragOwner({ horizontal: true, list: null }, 40, 4)).toBe('scroller')
    // ... but a vertical one still drags the drawer
    expect(dragOwner({ horizontal: true, list: null }, 4, 40)).toBe('drawer')
  })

  it('the expanded list keeps a drag it can still follow', () => {
    // scrolled down 100 of 400: dragging down scrolls back, dragging up scrolls on
    expect(dragOwner({ horizontal: false, list: list(100) }, 0, 40)).toBe('scroller')
    expect(dragOwner({ horizontal: false, list: list(100) }, 0, -40)).toBe('scroller')
  })

  it('hands the drawer the gesture at the list edges', () => {
    // at the top, a downward drag has nowhere to go in the list
    expect(dragOwner({ horizontal: false, list: list(0) }, 0, 40)).toBe('drawer')
    // at the end, an upward drag neither
    expect(dragOwner({ horizontal: false, list: list(400) }, 0, -40)).toBe('drawer')
  })

  it('a list that does not scroll never owns the gesture', () => {
    expect(dragOwner({ horizontal: false, list: list(0, 200, 200) }, 0, 40)).toBe('drawer')
    expect(dragOwner({ horizontal: false, list: list(0, 200, 200) }, 0, -40)).toBe('drawer')
  })

  it('survives nonsense scroll state', () => {
    expect(dragOwner({ horizontal: false, list: list(Number.NaN) }, 0, 40)).toBe('drawer')
    expect(dragOwner({ horizontal: false, list: list(-50) }, 0, 40)).toBe('drawer')
    expect(dragOwner({ horizontal: false, list: list(9999) }, 0, -40)).toBe('drawer')
    // a still pointer has no direction to hand over
    expect(dragOwner({ horizontal: false, list: list(100) }, 0, 0)).toBe('drawer')
  })
})
