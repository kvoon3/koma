/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { BLUR_LONG, blurSize, coverCrop, hasBgLayers, hasGradient } from './collageBg'

describe('coverCrop', () => {
  test('wide image into a square crops the sides', () => {
    expect(coverCrop(200, 100, 50, 50)).toEqual({ sx: 50, sy: 0, sw: 100, sh: 100 })
  })
  test('tall image into a wide box crops top and bottom', () => {
    expect(coverCrop(100, 400, 200, 100)).toEqual({ sx: 0, sy: 175, sw: 100, sh: 50 })
  })
})

describe('blurSize', () => {
  test('is independent of the output scale', () => {
    expect(blurSize(3000, 2000)).toEqual(blurSize(600, 400))
    expect(blurSize(3000, 2000)).toEqual({ w: BLUR_LONG, h: 16 })
  })
})

describe('layers', () => {
  test('gradient needs an opaque base', () => {
    expect(hasGradient({ bg: '#000000', gradient: '#ff0000', image: null })).toBe(true)
    expect(hasGradient({ bg: 'transparent', gradient: '#ff0000', image: null })).toBe(false)
    expect(hasGradient({ bg: '#000000', gradient: null, image: null })).toBe(false)
  })
  test('an image counts only when its photo resolves', () => {
    const b = { bg: '#000000', gradient: null, image: { photoId: 'p1', blur: true } }
    expect(hasBgLayers(b, true)).toBe(true)
    expect(hasBgLayers(b, false)).toBe(false)
  })
})
