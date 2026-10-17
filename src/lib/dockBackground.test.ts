/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { DOCK_GLASS_CLS, dockDragFade, dockSurface } from './dockBackground'

const v = (s: object, k: string) => (s as Record<string, unknown>)[k]

describe('dockSurface', () => {
  test('each style maps to its glass utility', () => {
    expect(dockSurface('solid', 50).className).toBe('glass-solid')
    expect(dockSurface('frosted', 50).className).toBe('glass-frosted')
    expect(dockSurface('liquid', 50).className).toBe('glass-liquid')
    expect(Object.keys(DOCK_GLASS_CLS)).toEqual(['solid', 'frosted', 'liquid'])
  })
  test('opacity drives --glass-opacity, clamped and rounded', () => {
    expect(v(dockSurface('solid', 42.4).style, '--glass-opacity')).toBe('42%')
    expect(v(dockSurface('solid', 150).style, '--glass-opacity')).toBe('100%')
    expect(v(dockSurface('solid', -5).style, '--glass-opacity')).toBe('0%')
    expect(v(dockSurface('solid', Number.NaN).style, '--glass-opacity')).toBe('0%')
  })
  test('the tint is full at rest, whatever the display', () => {
    // No put-away mode left, so the sheet is never chrome-less: only the drag
    // gesture (--dock-drag-fade, written by ToolsDock) moves the tint.
    expect(v(dockSurface('frosted', 60).style, '--dock-fade')).toBeUndefined()
    expect(v(dockSurface('frosted', 60).style, '--glass-tint')).toBe('var(--drawerBg)')
  })
})

describe('dockDragFade', () => {
  // handle 28, row 72 → smallest snap 28, tool row snap 100, expanded 160
  test('no tools showing is 0, the tool row is 1', () => {
    expect(dockDragFade(28, 0, 72, 28)).toBe(0)
    expect(dockDragFade(100, 0, 72, 28)).toBe(1)
  })
  test('ramps linearly while dragging up from the smallest snap', () => {
    expect(dockDragFade(28, -36, 72, 28)).toBe(0.5)
    expect(dockDragFade(28, -18, 72, 28)).toBe(0.25)
  })
  test('dragging down from row fades out; clamped both ends', () => {
    expect(dockDragFade(100, 54, 72, 28)).toBe(0.25)
    expect(dockDragFade(100, 200, 72, 28)).toBe(0)
    expect(dockDragFade(160, 0, 72, 28)).toBe(1)
  })
  test('degenerate inputs', () => {
    expect(dockDragFade(28, Number.NaN, 72, 28)).toBe(0)
    expect(dockDragFade(28, 0, 0, 28)).toBe(1)
  })
})
