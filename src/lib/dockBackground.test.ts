/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { COLLAPSED_DOCK_STYLE, DOCK_GLASS_CLS, dockSurface } from './dockBackground'

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
  test('open modes carry no chrome overrides', () => {
    expect(dockSurface('frosted', 60, 'row').style.backdropFilter).toBeUndefined()
  })
  test('collapsed clears every chrome property for all styles', () => {
    for (const bg of ['solid', 'frosted', 'liquid'] as const) {
      const s = dockSurface(bg, 80, 'collapsed').style
      expect(s).toMatchObject(COLLAPSED_DOCK_STYLE)
    }
  })
})
