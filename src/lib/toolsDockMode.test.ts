/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { clampDockMode, DOCK_DISPLAY_EPS, dockDisplayAt, dockHandleIntent, dockModeAtHeight, dockModeMidpoint, dockModes, dockTransition, isBandTransition } from './toolsDockMode'

const multi = { fitsOneRow: false }
const single = { fitsOneRow: true }

describe('dockModes', () => {
  test('three displays when the tools wrap, two when they fit one row', () => {
    expect(dockModes(single)).toEqual(['icons', 'row'])
    expect(dockModes(multi)).toEqual(['icons', 'row', 'expanded'])
  })
  test('there is no put-away mode left', () => {
    expect(dockModes(single) as readonly string[]).not.toContain('collapsed')
    expect(dockModes(multi) as readonly string[]).not.toContain('collapsed')
  })
})

describe('dockTransition tap', () => {
  test('cycles icons → row → expanded → icons when the tools wrap', () => {
    expect(dockTransition('icons', { type: 'tap' }, multi)).toBe('row')
    expect(dockTransition('row', { type: 'tap' }, multi)).toBe('expanded')
    expect(dockTransition('expanded', { type: 'tap' }, multi)).toBe('icons')
  })
  test('skips expanded when the tools fit one row', () => {
    expect(dockTransition('icons', { type: 'tap' }, single)).toBe('row')
    expect(dockTransition('row', { type: 'tap' }, single)).toBe('icons')
  })
  test('stale expanded under single-row capacity behaves like row', () => {
    expect(dockTransition('expanded', { type: 'tap' }, single)).toBe('icons')
  })
})

describe('dockTransition snap / dismiss', () => {
  test('drag cannot snap to expanded when the tools fit one row', () => {
    expect(dockTransition('row', { type: 'snap', mode: 'expanded' }, single)).toBe('row')
    expect(dockTransition('row', { type: 'snap', mode: 'expanded' }, multi)).toBe('expanded')
  })
  test('snap to icons is honored', () => {
    expect(dockTransition('expanded', { type: 'snap', mode: 'icons' }, multi)).toBe('icons')
    expect(dockTransition('row', { type: 'snap', mode: 'icons' }, single)).toBe('icons')
  })
  test('dismiss lands on the icon-only row, not on a hidden sheet', () => {
    expect(dockTransition('row', { type: 'dismiss' }, multi)).toBe('icons')
    expect(dockTransition('expanded', { type: 'dismiss' }, multi)).toBe('icons')
    expect(dockTransition('icons', { type: 'dismiss' }, multi)).toBe('icons')
  })
})

describe('clampDockMode', () => {
  test('expanded collapses to the labelled row when one row fits', () => {
    expect(clampDockMode('expanded', single)).toBe('row')
    expect(clampDockMode('expanded', multi)).toBe('expanded')
    expect(clampDockMode('icons', single)).toBe('icons')
    expect(clampDockMode('row', multi)).toBe('row')
  })
})

describe('dockHandleIntent', () => {
  test('follows the next tap', () => {
    expect(dockHandleIntent('icons', multi)).toBe('expand')
    expect(dockHandleIntent('row', multi)).toBe('expand')
    expect(dockHandleIntent('expanded', multi)).toBe('collapse')
    expect(dockHandleIntent('icons', single)).toBe('expand')
    expect(dockHandleIntent('row', single)).toBe('collapse')
  })
})

// The sheet's snap heights, handle included (see ToolsDock.snapPoints).
const ICON_H = 42
const ROW_H = 70
const EXP_H = 300

describe('dockModeMidpoint', () => {
  test('sits halfway between two adjacent snap heights', () => {
    expect(dockModeMidpoint(ICON_H, ROW_H)).toBe(56)
    expect(dockModeMidpoint(ROW_H, EXP_H)).toBe(185)
  })
})

describe('dockModeAtHeight (three displays)', () => {
  const order = dockModes(multi)
  const heights = [ICON_H, ROW_H, EXP_H]
  const at = (h: number) => dockModeAtHeight(order, heights, h)

  test('each display owns the band around its own height', () => {
    expect(at(ICON_H)).toBe('icons')
    expect(at(ROW_H)).toBe('row')
    expect(at(EXP_H)).toBe('expanded')
  })

  test('switches just past the midpoint between two heights', () => {
    expect(at(dockModeMidpoint(ICON_H, ROW_H) - 0.5)).toBe('icons')
    expect(at(dockModeMidpoint(ICON_H, ROW_H) + 0.5)).toBe('row')
    expect(at(dockModeMidpoint(ROW_H, EXP_H) - 0.5)).toBe('row')
    expect(at(dockModeMidpoint(ROW_H, EXP_H) + 0.5)).toBe('expanded')
  })

  test('lands on the shorter display exactly on the midpoint (same tie-break as pickSnap)', () => {
    expect(at(dockModeMidpoint(ICON_H, ROW_H))).toBe('icons')
    expect(at(dockModeMidpoint(ROW_H, EXP_H))).toBe('row')
  })

  test('clamps past both ends (rubber-banded drags stay inside the cycle)', () => {
    expect(at(-400)).toBe('icons')
    expect(at(0)).toBe('icons')
    expect(at(5000)).toBe('expanded')
  })

  test('agrees with a nearest-snap release, so releasing never re-picks', () => {
    for (let h = -20; h <= EXP_H + 20; h += 0.5) {
      const nearest = heights
        .map((sp, i) => ({ i, d: Math.abs(sp - h) }))
        .reduce((a, b) => (b.d < a.d ? b : a))
      expect(at(h)).toBe(order[nearest.i]!)
    }
  })
})

describe('dockModeAtHeight (two displays)', () => {
  const order = dockModes(single)
  const heights = [ICON_H, 72]

  test('one threshold, and the missing expanded is unreachable', () => {
    expect(dockModeAtHeight(order, heights, 40)).toBe('icons')
    expect(dockModeAtHeight(order, heights, 57.5)).toBe('row')
    // Past where expanded would have snapped: still the labelled row.
    expect(dockModeAtHeight(order, heights, 300)).toBe('row')
    expect(dockModeAtHeight(order, heights, 5000)).toBe('row')
  })

  test('a single reachable display is always that display', () => {
    expect(dockModeAtHeight(['row'], [ROW_H], 0)).toBe('row')
    expect(dockModeAtHeight(['row'], [ROW_H], 999)).toBe('row')
  })

  test('equal heights (a caption-less row measured twice) still resolve', () => {
    expect(dockModeAtHeight(['icons', 'row'], [50, 50], 49)).toBe('icons')
    expect(dockModeAtHeight(['icons', 'row'], [50, 50], 50)).toBe('icons')
    expect(dockModeAtHeight(['icons', 'row'], [50, 50], 50.5)).toBe('row')
  })
})

describe('isBandTransition', () => {
  test('is exactly the row ⇄ expanded pair', () => {
    expect(isBandTransition('row', 'expanded')).toBe(true)
    expect(isBandTransition('expanded', 'row')).toBe(true)
    expect(isBandTransition('icons', 'row')).toBe(false)
    expect(isBandTransition('row', 'icons')).toBe(false)
    expect(isBandTransition('icons', 'expanded')).toBe(false)
    expect(isBandTransition('expanded', 'icons')).toBe(false)
    expect(isBandTransition('row', 'row')).toBe(false)
    expect(isBandTransition('expanded', 'expanded')).toBe(false)
  })
})

describe('dockDisplayAt (three displays)', () => {
  const order = dockModes(multi)
  const heights = [ICON_H, ROW_H, EXP_H]
  const at = (liveH: number, prev: 'icons' | 'row' | 'expanded', reduce = false) =>
    dockDisplayAt({ order, heights, liveH, prev, reduce })

  test('a drag up out of the row commits expanded at the expanded edge', () => {
    // The row owns the whole band until half a pixel short of the expanded
    // snap: the field is what shows the wrapped layout meanwhile.
    expect(at(ROW_H, 'row')).toBe('row')
    expect(at(EXP_H - DOCK_DISPLAY_EPS - 0.5, 'row')).toBe('row')
    expect(at(EXP_H - DOCK_DISPLAY_EPS, 'row')).toBe('expanded')
    expect(at(EXP_H, 'row')).toBe('expanded')
  })

  test('a drag down out of the expanded display commits row at the row edge', () => {
    expect(at(EXP_H, 'expanded')).toBe('expanded')
    expect(at(ROW_H + DOCK_DISPLAY_EPS + 0.5, 'expanded')).toBe('expanded')
    expect(at(ROW_H + DOCK_DISPLAY_EPS, 'expanded')).toBe('row')
    expect(at(ROW_H, 'expanded')).toBe('row')
  })

  test('the edge band is the memory of where the user came from', () => {
    // Between the two edges the answer is just which display is committed.
    expect(at(200, 'row')).toBe('row')
    expect(at(200, 'expanded')).toBe('expanded')
    // At the row edge: `prev` decides, so a committed expanded holds.
    expect(at(ROW_H, 'expanded')).toBe('row')
    expect(at(ROW_H + DOCK_DISPLAY_EPS, 'expanded')).toBe('row')
    // ... and at the expanded edge a committed row holds until it is crossed.
    expect(at(EXP_H, 'row')).toBe('expanded')
    expect(at(EXP_H - DOCK_DISPLAY_EPS, 'row')).toBe('expanded')
  })

  test('the icons midpoint is untouched, on either memory', () => {
    expect(at(ICON_H, 'row')).toBe('icons')
    expect(at(dockModeMidpoint(ICON_H, ROW_H), 'row')).toBe('icons')
    expect(at(dockModeMidpoint(ICON_H, ROW_H) + 0.5, 'row')).toBe('row')
    expect(at(dockModeMidpoint(ICON_H, ROW_H) + 0.5, 'expanded')).toBe('row')
    expect(at(ICON_H, 'expanded')).toBe('icons')
  })

  test('reduced motion falls back to the midpoint rule exactly', () => {
    for (let h = -20; h <= EXP_H + 20; h += 0.5) {
      expect(at(h, 'row', true)).toBe(dockModeAtHeight(order, heights, h))
      expect(at(h, 'expanded', true)).toBe(dockModeAtHeight(order, heights, h))
    }
  })

  test('a two-mode dock falls back to the midpoint rule exactly', () => {
    const two = dockModes(single)
    const twoH = [ICON_H, ROW_H]
    for (let h = -20; h <= EXP_H + 20; h += 0.5) {
      const got = dockDisplayAt({ order: two, heights: twoH, liveH: h, prev: 'row', reduce: false })
      expect(got).toBe(dockModeAtHeight(two, twoH, h))
    }
  })

  test('a degenerate band (heights within a pixel) falls back too', () => {
    const flat = [ICON_H, ROW_H, ROW_H + 0.5]
    expect(dockDisplayAt({ order, heights: flat, liveH: ROW_H + 1, prev: 'row', reduce: false }))
      .toBe(dockModeAtHeight(order, flat, ROW_H + 1))
    expect(dockDisplayAt({ order, heights: flat, liveH: ROW_H + 1, prev: 'expanded', reduce: false }))
      .toBe(dockModeAtHeight(order, flat, ROW_H + 1))
    // Equal heights: the earlier display owns the tie, as the fallback does.
    const equal = [ICON_H, ROW_H, ROW_H]
    expect(dockDisplayAt({ order, heights: equal, liveH: ROW_H, prev: 'expanded', reduce: false })).toBe('row')
    expect(dockDisplayAt({ order, heights: equal, liveH: ROW_H + 1, prev: 'row', reduce: false })).toBe('expanded')
  })

  test('a settled height always shows its own display, from either memory', () => {
    // These are exactly the heights a release can leave `y` on, so a release
    // never re-arranges what the drag already showed.
    for (const prev of ['icons', 'row', 'expanded'] as const) {
      expect(at(ICON_H, prev)).toBe('icons')
      expect(at(ROW_H, prev)).toBe('row')
      expect(at(EXP_H, prev)).toBe('expanded')
    }
  })

  test('clamps past both ends', () => {
    expect(at(-400, 'row')).toBe('icons')
    expect(at(0, 'expanded')).toBe('icons')
    expect(at(5000, 'row')).toBe('expanded')
    expect(at(5000, 'expanded')).toBe('expanded')
  })

  test('a not-a-dock order answers the largest display instead of throwing', () => {
    expect(dockDisplayAt({ order: ['icons'], heights: [ICON_H], liveH: 0, prev: 'icons', reduce: false })).toBe('icons')
    expect(dockDisplayAt({ order: ['icons', 'expanded'], heights: [ICON_H, EXP_H], liveH: 900, prev: 'icons', reduce: false })).toBe('expanded')
  })
})
