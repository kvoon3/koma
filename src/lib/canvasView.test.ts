import { describe, expect, it } from 'bun:test'
import { clampViewScale, isOffFit, VIEW_MAX, VIEW_MIN, viewPercent, viewScaleAt, viewTransform, viewWheelFactor } from './canvasView'

describe('clampViewScale', () => {
  it('keeps the range at a quarter to two and a half', () => {
    expect(clampViewScale(0.01)).toBe(VIEW_MIN)
    expect(clampViewScale(9)).toBe(VIEW_MAX)
    expect(clampViewScale(0.75)).toBe(0.75)
  })

  it('falls back to fit on a non-number', () => {
    expect(clampViewScale(Number.NaN)).toBe(1)
  })
})

describe('viewWheelFactor', () => {
  it('is 1.1 per wheel notch in both directions', () => {
    expect(viewWheelFactor(-100, false)).toBeCloseTo(1.1, 10)
    expect(viewWheelFactor(100, false)).toBeCloseTo(1 / 1.1, 10)
  })

  it('reads a trackpad pinch on the same 1.1 per notch', () => {
    expect(viewWheelFactor(-20, true)).toBeCloseTo(1.1, 10)
  })

  it('never jumps more than 1.1^1.5 for one event', () => {
    expect(viewWheelFactor(-4000, false)).toBeCloseTo(1.1 ** 1.5, 10)
    expect(viewWheelFactor(4000, true)).toBeCloseTo(1.1 ** -1.5, 10)
  })
})

describe('viewScaleAt', () => {
  it('is fit outside a canvas wrapper', () => {
    expect(viewScaleAt(null)).toBe(1)
  })
})

describe('viewPercent and isOffFit', () => {
  it('rounds to whole percent', () => {
    expect(viewPercent(0.5)).toBe(50)
    expect(viewPercent(1.333)).toBe(133)
  })

  it('treats fit as on-fit, and anything else as off', () => {
    expect(isOffFit(1)).toBe(false)
    expect(isOffFit(1.0004)).toBe(false)
    expect(isOffFit(0.5)).toBe(true)
  })
})

describe('viewTransform', () => {
  it('is absent at fit and a centre scale otherwise', () => {
    expect(viewTransform(1)).toBeUndefined()
    expect(viewTransform(0.5)).toBe('scale(0.5)')
  })
})
