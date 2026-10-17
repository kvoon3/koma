/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { clampDockMode, dockHandleIntent, dockModeAtHeight, dockModeMidpoint, dockModes, dockTransition } from './toolsDockMode'

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
