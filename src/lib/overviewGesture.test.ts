import { describe, expect, it } from 'bun:test'
import {
  DND_POINTER_DELAY_MS,
  DND_POINTER_TOLERANCE_PX,
  JIGGLE_HOLD_MS,
  JIGGLE_SLOP_PX,
  jiggleArmed,
  lockedAxis,
  pressOrigin,
  SWIPE_SLOP_AIR_PX,
  SWIPE_SLOP_CELL_PX,
  swipeAxis,
  swipeSlop,
} from './overviewGesture'

/** A target whose `closest` answers from a fixed set of matched selectors. */
function target(matches: string[]): EventTarget {
  return Object.assign(new EventTarget(), {
    closest: (selector: string) => (matches.some(m => selector.includes(m)) ? new EventTarget() : null),
  })
}

describe('pressOrigin', () => {
  it('reads a cell face first, even though it is a button', () => {
    expect(pressOrigin(target(['[data-cell]', 'button']))).toBe('cell')
  })
  it('reads chrome for the controls that share the stage', () => {
    for (const s of ['button', 'a[href]', 'input', '[role="dialog"]', '[role="menu"]', '[data-dock-mode]', '[data-board-dots]', '[data-cell-delete]', '[data-add-cell]'])
      expect(pressOrigin(target([s]))).toBe('chrome')
  })
  it('reads the gaps and the caption air as air', () => {
    expect(pressOrigin(target([]))).toBe('air')
    expect(pressOrigin(null)).toBe('air')
  })
})

describe('the slop ordering', () => {
  it('lets the pager cell slop outrun dnd-kit tolerance, so the sensor has already aborted', () => {
    expect(SWIPE_SLOP_CELL_PX).toBeGreaterThan(DND_POINTER_TOLERANCE_PX)
    // And the delay is the sensor's own: the pager never waits for it.
    expect(DND_POINTER_DELAY_MS).toBe(250)
  })
  it('keeps air tighter than a cell, and chrome out of it', () => {
    expect(SWIPE_SLOP_AIR_PX).toBeLessThan(SWIPE_SLOP_CELL_PX)
    expect(swipeSlop('chrome')).toBeNull()
    expect(swipeSlop('air')).toBe(SWIPE_SLOP_AIR_PX)
    expect(swipeSlop('cell')).toBe(SWIPE_SLOP_CELL_PX)
  })
})

describe('lockedAxis', () => {
  it('locks a clearly sideways or vertical drag', () => {
    expect(lockedAxis(30, 4)).toBe('x')
    expect(lockedAxis(-30, 4)).toBe('x')
    expect(lockedAxis(4, -30)).toBe('y')
  })
  it('refuses a drag too close to the diagonal', () => {
    expect(lockedAxis(30, 30)).toBeNull()
    expect(lockedAxis(30, 26)).toBeNull()
    expect(lockedAxis(30, 24)).toBe('x')
  })
})

describe('swipeAxis', () => {
  it('arms a cell swipe only past the cell slop', () => {
    expect(swipeAxis('cell', 'touch', 10, 1, false)).toBeNull()
    expect(swipeAxis('cell', 'touch', SWIPE_SLOP_CELL_PX, 1, false)).toBe('x')
    expect(swipeAxis('cell', 'pen', -SWIPE_SLOP_CELL_PX, 1, false)).toBe('x')
    expect(swipeAxis('cell', 'touch', 10, 12, false)).toBeNull()
  })
  it('arms an air swipe past the air slop', () => {
    expect(swipeAxis('air', 'mouse', SWIPE_SLOP_AIR_PX, 0, false)).toBe('x')
    expect(swipeAxis('air', 'touch', 5, 0, false)).toBeNull()
    expect(swipeAxis('air', 'touch', 1, 20, false)).toBeNull()
  })
  it('pages from a cell under every pointer type past the cell slop', () => {
    expect(swipeAxis('cell', 'touch', SWIPE_SLOP_CELL_PX, 1, false)).toBe('x')
    expect(swipeAxis('cell', 'pen', -SWIPE_SLOP_CELL_PX, 1, false)).toBe('x')
    expect(swipeAxis('cell', 'mouse', 80, 0, false)).toBe('x')
    // The mouse is held to reorder only when it does not move past the slop;
    // once it does, the sensor has aborted and the pager owns the gesture.
    expect(swipeAxis('cell', 'mouse', 10, 0, false)).toBeNull()
  })
  it('never pages for chrome, or while a reorder is live', () => {
    expect(swipeAxis('chrome', 'touch', 80, 0, false)).toBeNull()
    expect(swipeAxis('cell', 'touch', 80, 0, true)).toBeNull()
    expect(swipeAxis('air', 'mouse', 80, 0, true)).toBeNull()
  })
})

describe('jiggleArmed', () => {
  it('needs the hold, the air origin and no travel', () => {
    expect(jiggleArmed('air', JIGGLE_HOLD_MS, 0, 0)).toBe(true)
    expect(jiggleArmed('air', JIGGLE_HOLD_MS, JIGGLE_SLOP_PX, -JIGGLE_SLOP_PX)).toBe(true)
    expect(jiggleArmed('air', JIGGLE_HOLD_MS - 1, 0, 0)).toBe(false)
    expect(jiggleArmed('air', JIGGLE_HOLD_MS, JIGGLE_SLOP_PX + 1, 0)).toBe(false)
    expect(jiggleArmed('cell', JIGGLE_HOLD_MS, 0, 0)).toBe(false)
    expect(jiggleArmed('chrome', JIGGLE_HOLD_MS, 0, 0)).toBe(false)
  })
})
