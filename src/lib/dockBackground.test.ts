/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { DOCK_GLASS_CLS, dockDragFade, dockSurface } from './dockBackground'

const v = (s: object, k: string) => (s as Record<string, unknown>)[k]

describe('dockSurface', () => {
  test('each style maps to its glass utility', () => {
    expect(dockSurface('solid', 50, 'row').className).toBe('glass-solid')
    expect(dockSurface('frosted', 50, 'row').className).toBe('glass-frosted')
    expect(dockSurface('liquid', 50, 'expanded').className).toBe('glass-liquid')
    expect(Object.keys(DOCK_GLASS_CLS)).toEqual(['solid', 'frosted', 'liquid'])
  })
  test('opacity drives --glass-opacity, clamped and rounded', () => {
    expect(v(dockSurface('solid', 42.4, 'row').style, '--glass-opacity')).toBe('42%')
    expect(v(dockSurface('solid', 150, 'row').style, '--glass-opacity')).toBe('100%')
    expect(v(dockSurface('solid', -5, 'row').style, '--glass-opacity')).toBe('0%')
    expect(v(dockSurface('solid', Number.NaN, 'row').style, '--glass-opacity')).toBe('0%')
  })
  test('--dock-fade: 0 collapsed, 1 open', () => {
    expect(v(dockSurface('frosted', 60, 'collapsed').style, '--dock-fade')).toBe(0)
    expect(v(dockSurface('frosted', 60, 'row').style, '--dock-fade')).toBe(1)
    expect(v(dockSurface('liquid', 60, 'expanded').style, '--dock-fade')).toBe(1)
  })
})

describe('dockDragFade', () => {
  // handle 28, row 72 → collapsed snap 28, row snap 100
  test('collapsed at rest is 0, row at rest is 1', () => {
    expect(dockDragFade(28, 0, 72, 28)).toBe(0)
    expect(dockDragFade(100, 0, 72, 28)).toBe(1)
  })
  test('ramps linearly while dragging up from collapsed', () => {
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
