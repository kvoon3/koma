/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { BACKDROP_BLUR_MAX, BACKDROP_BLUR_MIN, BACKDROP_BLUR_RATIO, backdropBlurRadius, backdropPlan } from './cutoutBackdrop'

/**
 * The bake itself needs a canvas (the browser e2e covers the pixels); what the
 * composite is (how soft, in which order, over which rect) is pure and is
 * pinned here.
 */
describe('backdrop blur radius', () => {
  test('is a ratio of the long edge, 2.5% of it', () => {
    expect(backdropBlurRadius(1800, 1200)).toBe(Math.round(1800 * BACKDROP_BLUR_RATIO))
    expect(backdropBlurRadius(1800, 1200)).toBe(45)
    expect(BACKDROP_BLUR_RATIO).toBeGreaterThan(0.02)
    expect(BACKDROP_BLUR_RATIO).toBeLessThan(0.03)
  })
  test('a portrait frame and the landscape one rotated read the same', () => {
    expect(backdropBlurRadius(1200, 1800)).toBe(backdropBlurRadius(1800, 1200))
    expect(backdropBlurRadius(1600, 1600)).toBe(Math.round(1600 * BACKDROP_BLUR_RATIO))
  })
  test('scales with the frame, so a small preview is not a smudge', () => {
    const small = backdropBlurRadius(600, 400)
    const large = backdropBlurRadius(1800, 1200)
    expect(small).toBe(15)
    expect(large / small).toBeCloseTo(3, 0)
    expect(backdropBlurRadius(400, 300)).toBeLessThan(backdropBlurRadius(800, 600))
  })
  test('clamps at both ends instead of collapsing or vanishing', () => {
    expect(backdropBlurRadius(20, 20)).toBe(BACKDROP_BLUR_MIN)
    expect(backdropBlurRadius(0, 0)).toBe(BACKDROP_BLUR_MIN)
    expect(backdropBlurRadius(8000, 8000)).toBe(BACKDROP_BLUR_MAX)
  })
})

describe('backdrop plan', () => {
  test('paints the blurred photo first and the sharp cutout on top of it', () => {
    const ops = backdropPlan(1800, 1200)
    expect(ops.map(o => o.kind)).toEqual(['blur', 'cutout'])
  })
  test('the blur overhangs the frame by one radius on every side', () => {
    const [blur] = backdropPlan(1800, 1200)
    const r = backdropBlurRadius(1800, 1200)
    expect(blur.kind).toBe('blur')
    if (blur.kind !== 'blur')
      return
    expect(blur.radius).toBe(r)
    // A Gaussian samples past the edge: an exact-size draw would fade the
    // border toward transparent, so the backdrop has to hang over the frame.
    expect(blur.rect).toEqual({ x: -r, y: -r, w: 1800 + 2 * r, h: 1200 + 2 * r })
  })
  test('the cutout fills the frame exactly, so the subject keeps its silhouette', () => {
    const [, cut] = backdropPlan(1800, 1200)
    expect(cut.rect).toEqual({ x: 0, y: 0, w: 1800, h: 1200 })
    expect('radius' in cut).toBe(false)
  })
})
