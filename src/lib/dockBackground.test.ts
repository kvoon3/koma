/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { dockBgStyle, LIQUID_FILTER_ID } from './dockBackground'

describe('dockBgStyle', () => {
  test('solid: tint scales with opacity, no blur', () => {
    const s = dockBgStyle('solid', 40)
    expect(s.backgroundColor).toContain('40%')
    expect(s.backdropFilter).toBeUndefined()
  })
  test('frosted: blur + tint', () => {
    const s = dockBgStyle('frosted', 75)
    expect(s.backdropFilter).toContain('blur(')
    expect(s.WebkitBackdropFilter).toBe(s.backdropFilter)
    expect(s.backgroundColor).toContain('75%')
  })
  test('liquid: SVG displacement only when supported; webkit never', () => {
    expect(dockBgStyle('liquid', 50, false).backdropFilter).not.toContain('url(')
    const s = dockBgStyle('liquid', 50, true)
    expect(s.backdropFilter).toContain(`url(#${LIQUID_FILTER_ID})`)
    expect(s.WebkitBackdropFilter).not.toContain('url(')
    expect(s.boxShadow).toContain('inset')
  })
  test('transparent: no sheet background; opacity drives the chips', () => {
    const s = dockBgStyle('transparent', 30) as Record<string, unknown>
    expect(s.backgroundColor).toBe('transparent')
    expect(s.boxShadow).toBe('none')
    expect(s['--dock-chip']).toContain('30%')
  })
  test('opacity is clamped and rounded', () => {
    expect(dockBgStyle('solid', 150).backgroundColor).toContain(' 100%')
    expect(dockBgStyle('solid', -5).backgroundColor).toContain(' 0%')
    expect(dockBgStyle('solid', Number.NaN).backgroundColor).toContain(' 0%')
  })
})
