/// <reference types="bun" />
import { describe, expect, it } from 'bun:test'
import { applyNewsprint } from './stickerTexture'

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

function luminance(pixels: Uint8ClampedArray, index: number) {
  return 0.2126 * pixels[index]! + 0.7152 * pixels[index + 1]! + 0.0722 * pixels[index + 2]!
}

/** Mean ink coverage per column, which carries the screen's own period. */
function columnInk(pixels: Uint8ClampedArray, width: number, height: number) {
  const profile = new Float64Array(width)
  for (let x = 0; x < width; x += 1) {
    let ink = 0
    for (let y = 0; y < height; y += 1)
      ink += 255 - luminance(pixels, (y * width + x) * 4)
    profile[x] = ink / height / 255
  }
  return profile
}

/**
 * The first autocorrelation peak that is close to the strongest one, in
 * pixels: the screen's own period, not one of its harmonics.
 */
function screenPeriod(profile: Float64Array) {
  let total = 0
  for (const value of profile)
    total += value
  const mean = total / profile.length
  const correlations: number[] = []
  for (let lag = 2; lag < Math.floor(profile.length / 3); lag += 1) {
    let sum = 0
    for (let index = 0; index + lag < profile.length; index += 1)
      sum += (profile[index]! - mean) * (profile[index + lag]! - mean)
    correlations.push(sum)
  }
  const strongest = Math.max(...correlations)
  for (let index = 1; index < correlations.length - 1; index += 1) {
    if (correlations[index]! >= correlations[index - 1]! && correlations[index]! >= correlations[index + 1]! && correlations[index]! >= strongest * 0.8)
      return index + 2
  }
  return correlations.indexOf(strongest) + 2
}

describe('newspaper print', () => {
  it('leaves every byte alone when it is off', () => {
    const source = cutout(32, 24)
    for (const texture of [null, undefined]) {
      const pixels = new Uint8ClampedArray(source)
      applyNewsprint(pixels, 32, 24, texture, 2)
      expect([...pixels]).toEqual([...source])
    }
  })

  it('never writes alpha and leaves transparent pixels byte-identical', () => {
    const source = cutout(48, 40)
    const pixels = new Uint8ClampedArray(source)
    applyNewsprint(pixels, 48, 40, 'newsprint', 2)
    for (let index = 0; index < source.length; index += 4) {
      expect(pixels[index + 3]).toBe(source[index + 3])
      if (source[index + 3] === 0) {
        expect(pixels[index]).toBe(source[index])
        expect(pixels[index + 1]).toBe(source[index + 1])
        expect(pixels[index + 2]).toBe(source[index + 2])
      }
    }
  })

  it('prints a mid tone as ink dots on paper, not as the source colour', () => {
    const pixels = filled(96, 96, 150, 110, 70, 255)
    applyNewsprint(pixels, 96, 96, 'newsprint', 1)
    let light = 0
    let dark = 0
    let tint = 0
    let sum = 0
    for (let index = 0; index < pixels.length; index += 4) {
      const value = luminance(pixels, index)
      sum += value
      if (value >= 205)
        light += 1
      if (value <= 80)
        dark += 1
      tint = Math.max(tint, Math.max(pixels[index]!, pixels[index + 1]!, pixels[index + 2]!) - Math.min(pixels[index]!, pixels[index + 1]!, pixels[index + 2]!))
    }
    expect(light).toBeGreaterThan(0)
    expect(dark).toBeGreaterThan(0)
    // One ink on one paper: the source's saturated hue is gone, leaving at most
    // the warm spread of the newsprint palette itself.
    expect(tint).toBeLessThanOrEqual(22)
    // The dot's area carries the tone, so the sheet's mean stays near the source's.
    const sourceLuma = 0.2126 * 150 + 0.7152 * 110 + 0.0722 * 70
    expect(Math.abs(sum / (pixels.length / 4) - sourceLuma)).toBeLessThan(18)
  })

  it('is deterministic', () => {
    const first = filled(64, 48, 128, 128, 128, 255)
    const second = new Uint8ClampedArray(first)
    applyNewsprint(first, 64, 48, 'newsprint', 2)
    applyNewsprint(second, 64, 48, 'newsprint', 2)
    expect([...first]).toEqual([...second])
  })

  it('measures the same screen pitch in display pixels at two texture sizes', () => {
    const small = filled(240, 240, 128, 128, 128, 255)
    const large = filled(480, 480, 128, 128, 128, 255)
    applyNewsprint(small, 240, 240, 'newsprint', 2)
    applyNewsprint(large, 480, 480, 'newsprint', 4)
    const smallPeriod = screenPeriod(columnInk(small, 240, 240))
    const largePeriod = screenPeriod(columnInk(large, 480, 480))
    expect(smallPeriod).toBeGreaterThan(0)
    expect(largePeriod / smallPeriod).toBeGreaterThan(1.7)
    expect(largePeriod / smallPeriod).toBeLessThan(2.3)
  })

  it('prints the same display sheet at two texture sizes', () => {
    const small = filled(240, 240, 128, 128, 128, 255)
    const large = filled(480, 480, 128, 128, 128, 255)
    applyNewsprint(small, 240, 240, 'newsprint', 2)
    applyNewsprint(large, 480, 480, 'newsprint', 4)
    const smallProfile = columnInk(small, 240, 240)
    const largeProfile = columnInk(large, 480, 480)
    let difference = 0
    for (let x = 0; x < 240; x += 1)
      difference += Math.abs(smallProfile[x]! - (largeProfile[x * 2]! + largeProfile[x * 2 + 1]!) / 2)
    expect(difference / 240).toBeLessThan(0.08)
  })
})
