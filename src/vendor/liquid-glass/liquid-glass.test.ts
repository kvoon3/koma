/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { displacementMap, liquidGlassFragment } from './liquid-glass'

describe('vendored liquid-glass displacementMap', () => {
  test('center pixel is neutral, edges displace, scale > 0', () => {
    const w = 40
    const h = 20
    const { data, scale } = displacementMap(w, h)
    expect(data.length).toBe(w * h * 4)
    expect(scale).toBeGreaterThan(0)
    const c = ((h / 2) * w + w / 2) * 4
    expect(Math.abs(data[c]! - 128)).toBeLessThan(8)
    expect(data[3]).toBe(255)
    expect(Math.abs(data[0]! - 128)).toBeGreaterThan(20)
  })
  test('identity fragment does not produce NaN', () => {
    const { data, scale } = displacementMap(4, 4, uv => uv)
    expect(scale).toBe(0)
    expect(data[0]).toBe(128)
  })
  test('fragment maps center to center', () => {
    const p = liquidGlassFragment({ x: 0.5, y: 0.5 })
    expect(p).toEqual({ x: 0.5, y: 0.5 })
  })
})
