/// <reference types="bun" />
import { describe, expect, it } from 'bun:test'
import { applyWrinkle, MAX_WRINKLE_STRENGTH, wrinkleFromSlider } from './stickerTexture'

function filled(width: number, height: number, red: number, green: number, blue: number, alpha: number) {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = red
    pixels[index + 1] = green
    pixels[index + 2] = blue
    pixels[index + 3] = alpha
  }
  return pixels
}

/** A checker of alpha values so the "alpha untouched" case is not all opaque. */
function cutout(width: number, height: number) {
  const pixels = filled(width, height, 90, 90, 90, 255)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      pixels[index + 3] = (x + y) % 3 === 0 ? 0 : (x * 7 + y * 3) % 256
    }
  }
  return pixels
}

function at(pixels: Uint8ClampedArray, width: number, x: number, y: number, channel: number) {
  return pixels[(y * width + x) * 4 + channel]!
}

describe('wrinkled paper', () => {
  it('leaves every byte alone when it is off', () => {
    const source = cutout(32, 24)
    const designs = [null, undefined, { strength: 0 }, { strength: -1 }, { strength: Number.NaN }, { strength: Number.POSITIVE_INFINITY }]
    for (const design of designs) {
      const pixels = new Uint8ClampedArray(source)
      applyWrinkle(pixels, 32, 24, design)
      expect([...pixels]).toEqual([...source])
    }
  })

  it('never writes alpha and leaves transparent pixels byte-identical', () => {
    const source = cutout(48, 40)
    const pixels = new Uint8ClampedArray(source)
    applyWrinkle(pixels, 48, 40, { strength: 60 })
    for (let index = 0; index < source.length; index += 4) {
      expect(pixels[index + 3]).toBe(source[index + 3])
      if (source[index + 3] === 0) {
        expect(pixels[index]).toBe(source[index])
        expect(pixels[index + 1]).toBe(source[index + 1])
        expect(pixels[index + 2]).toBe(source[index + 2])
      }
    }
  })

  it('shades black text at full strength', () => {
    const pixels = filled(64, 64, 0, 0, 0, 255)
    applyWrinkle(pixels, 64, 64, { strength: MAX_WRINKLE_STRENGTH })
    let lifted = 0
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index]! > 0 || pixels[index + 1]! > 0 || pixels[index + 2]! > 0)
        lifted += 1
    }
    expect(lifted).toBeGreaterThan(0)
  })

  it('is deterministic', () => {
    const first = filled(40, 30, 120, 80, 60, 255)
    const second = new Uint8ClampedArray(first)
    applyWrinkle(first, 40, 30, { strength: 37 })
    applyWrinkle(second, 40, 30, { strength: 37 })
    expect([...first]).toEqual([...second])
  })

  it('clamps above the maximum and keeps 20 distinct from both ends', () => {
    const over = filled(40, 40, 100, 100, 100, 255)
    const max = filled(40, 40, 100, 100, 100, 255)
    const off = filled(40, 40, 100, 100, 100, 255)
    const light = filled(40, 40, 100, 100, 100, 255)
    applyWrinkle(over, 40, 40, { strength: 1000 })
    applyWrinkle(max, 40, 40, { strength: MAX_WRINKLE_STRENGTH })
    applyWrinkle(light, 40, 40, { strength: 20 })
    expect([...over]).toEqual([...max])
    expect([...light]).not.toEqual([...off])
    expect([...light]).not.toEqual([...max])
  })

  it('carries the same low-frequency shade at the same normalized position', () => {
    const small = filled(64, 64, 128, 128, 128, 255)
    const large = filled(128, 128, 128, 128, 128, 255)
    applyWrinkle(small, 64, 64, { strength: 80 })
    applyWrinkle(large, 128, 128, { strength: 80 })
    for (const fraction of [0.25, 0.5, 0.75]) {
      const sx = Math.min(63, Math.max(0, Math.round(fraction * 64 - 0.5)))
      const lx = Math.min(127, Math.max(0, Math.round(fraction * 128 - 0.5)))
      const sy = sx
      const ly = lx
      for (let channel = 0; channel < 3; channel += 1) {
        const a = at(small, 64, sx, sy, channel)
        const b = at(large, 128, lx, ly, channel)
        expect(Math.abs(a - b)).toBeLessThanOrEqual(6)
      }
    }
  })
})

describe('the texture slider', () => {
  it('turns zero, negative and non-finite values off', () => {
    expect(wrinkleFromSlider(0)).toBeNull()
    expect(wrinkleFromSlider(-4)).toBeNull()
    expect(wrinkleFromSlider(Number.NaN)).toBeNull()
    expect(wrinkleFromSlider(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('keeps a fraction and clamps above the maximum', () => {
    expect(wrinkleFromSlider(42.5)).toEqual({ strength: 42.5 })
    expect(wrinkleFromSlider(150)).toEqual({ strength: MAX_WRINKLE_STRENGTH })
  })
})
