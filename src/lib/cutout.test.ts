/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { blurredCutoutFileName, cutoutFileName, originalOf, recordCutout } from './cutout'

describe('cutout bookkeeping', () => {
  test('file name', () => {
    expect(cutoutFileName('IMG_1234.HEIC')).toBe('IMG_1234-cutout.png')
    expect(cutoutFileName('a.b.jpg')).toBe('a.b-cutout.png')
    expect(cutoutFileName('noext')).toBe('noext-cutout.png')
    expect(cutoutFileName('.png')).toBe('photo-cutout.png')
  })
  test('a cutout that kept its blurred backdrop stays recognisable', () => {
    expect(blurredCutoutFileName('IMG_1234.HEIC')).toBe('IMG_1234-cutout-blur.png')
    expect(blurredCutoutFileName('noext')).toBe('noext-cutout-blur.png')
    expect(blurredCutoutFileName('.png')).toBe('photo-cutout-blur.png')
  })
  test('record / original', () => {
    let m = recordCutout({}, 'c1', 'p1')
    expect(originalOf(m, 'c1')).toBe('p1')
    expect(originalOf(m, 'p1')).toBeNull()
    expect(originalOf(m, null)).toBeNull()
    // cutting a cutout keeps pointing at the first original
    m = recordCutout(m, 'c2', 'c1')
    expect(originalOf(m, 'c2')).toBe('p1')
  })
})
