import { describe, expect, it } from 'bun:test'
import { dampOffset, dragOwner, nearestSnapIndex, pickSnap, rubberBand } from './dockPhysics'

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
  })
  it('dampOffset stops dead at the largest snap (the sheet is bottom-anchored)', () => {
    // `min` is the largest height: travel above it would lift the sheet's
    // bottom edge off the footer and show the board behind the dock's clip.
    expect(dampOffset(-100, 0, 200)).toBe(0)
    expect(dampOffset(-1, 0, 200)).toBe(0)
  })
  it('dampOffset still gives at the put-away end', () => {
    expect(dampOffset(300, 0, 200)).toBeGreaterThan(200)
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

describe('nearestSnapIndex', () => {
  it('is the snap nearest the position, in either offset order', () => {
    expect(nearestSnapIndex(OFF, 0)).toBe(2)
    expect(nearestSnapIndex(OFF, 190)).toBe(0)
    expect(nearestSnapIndex(OFF, 130)).toBe(1)
    expect(nearestSnapIndex([...OFF].reverse(), 130)).toBe(1)
  })
  it('lands exactly between two snaps on the earlier one, like dockModeAtHeight', () => {
    // Halfway between 200 and 128: the earlier index wins, which is the
    // larger offset, the shorter display's snap (see the docstring).
    expect(nearestSnapIndex(OFF, 164)).toBe(0)
    // Halfway between 128 and 0: the row (128) is the earlier of the two.
    expect(nearestSnapIndex(OFF, 64)).toBe(1)
  })
  it('a single snap is always the answer', () => {
    expect(nearestSnapIndex([72], 0)).toBe(0)
    expect(nearestSnapIndex([72], 5000)).toBe(0)
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

  it('a frozen scroller never owns the press, whatever it holds', () => {
    // Mid-band the list is locked and its scroll state describes a layout the
    // field has replaced with transforms: every press belongs to the drawer.
    expect(dragOwner({ horizontal: false, list: list(100), frozen: true }, 0, 40)).toBe('drawer')
    expect(dragOwner({ horizontal: false, list: list(100), frozen: true }, 0, -40)).toBe('drawer')
    expect(dragOwner({ horizontal: true, list: null, frozen: true }, 40, 4)).toBe('drawer')
  })

  it('survives nonsense scroll state', () => {
    expect(dragOwner({ horizontal: false, list: list(Number.NaN) }, 0, 40)).toBe('drawer')
    expect(dragOwner({ horizontal: false, list: list(-50) }, 0, 40)).toBe('drawer')
    expect(dragOwner({ horizontal: false, list: list(9999) }, 0, -40)).toBe('drawer')
    // a still pointer has no direction to hand over
    expect(dragOwner({ horizontal: false, list: list(100) }, 0, 0)).toBe('drawer')
  })
})
