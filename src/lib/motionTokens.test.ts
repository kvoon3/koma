import { describe, expect, test } from 'bun:test'
import { cubicBezier, EASE_MORPH } from './motionTokens'

describe('cubicBezier', () => {
  test('pins both ends', () => {
    expect(cubicBezier(EASE_MORPH, 0)).toBe(0)
    expect(cubicBezier(EASE_MORPH, 1)).toBe(1)
  })

  test('a linear control set follows t', () => {
    for (const t of [0.25, 0.5, 0.75])
      expect(cubicBezier([1 / 3, 1 / 3, 2 / 3, 2 / 3], t)).toBeCloseTo(t, 5)
  })

  test('the morph curve is monotonic', () => {
    let last = 0
    for (let i = 1; i <= 20; i++) {
      const y = cubicBezier(EASE_MORPH, i / 20)
      expect(y).toBeGreaterThanOrEqual(last)
      last = y
    }
  })
})
