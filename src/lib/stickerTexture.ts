/**
 * Wrinkled-paper shading for a sticker's artwork, applied before the die-cut
 * (see `prepareArtwork` in lib/sticker.ts). Pure: no DOM, no canvas, no time.
 *
 * The field is anchored to the artwork's long edge, so the same subject carries
 * the same creases at preview and save. Alpha is never written: the die-cut's
 * distance field reads it and must not move.
 */

import { lerp, valueNoise } from './noise'

export interface WrinkleDesign {
  /** The Paper texture slider's own unit: 0 (off) to 100. */
  strength: number
}

export const MIN_WRINKLE_STRENGTH = 0
export const MAX_WRINKLE_STRENGTH = 100
export const DEFAULT_WRINKLE_STRENGTH = 0

/**
 * Long edge of the shade field. The build is bounded at about 147k samples, but
 * shading still takes one bilinear sample per artwork pixel.
 */
const FIELD_MAX_EDGE = 384
/** 34/255 is about 13% at full strength: visible on black text without blowing highlights. */
const SHADE_AMPLITUDE = 34

/**
 * A fixed fold direction. The first octave is stretched along it, so the
 * creases read as long folds instead of isotropic blobs.
 */
const FOLD_X = 0.8
const FOLD_Y = -0.6
const FOLD_ALONG_FREQ = 4.3
const FOLD_ACROSS_FREQ = 11.5
const MID_FREQ = 9
const FINE_FREQ = 23
const FOLD_WEIGHT = 0.55
const MID_WEIGHT = 0.3
const FINE_WEIGHT = 0.15
const FOLD_SEED = 0x1B873593
const MID_SEED = 0x85EBCA6B
const FINE_SEED = 0xC2B2AE35

/** Light from the upper left, in image coordinates (y grows downward). */
const LIGHT_X = -0.62
const LIGHT_Y = -0.78
/** The raw derivative is a few units per normalized unit; this maps it onto [-1, 1]. */
const SHADE_GAIN = 0.16

/** Three octaves of height; the first is stretched along the fixed fold direction. */
function heightAt(u: number, v: number): number {
  const along = u * FOLD_X + v * FOLD_Y
  const across = u * -FOLD_Y + v * FOLD_X
  const fold = valueNoise(along * FOLD_ALONG_FREQ, across * FOLD_ACROSS_FREQ, FOLD_SEED)
  const mid = valueNoise(u * MID_FREQ, v * MID_FREQ, MID_SEED)
  const fine = valueNoise(u * FINE_FREQ, v * FINE_FREQ, FINE_SEED)
  return fold * FOLD_WEIGHT + mid * MID_WEIGHT + fine * FINE_WEIGHT
}

interface ShadeField {
  values: Float32Array
  width: number
  height: number
}

/**
 * The directional derivative of the height field, built once at field
 * resolution. Coordinates are normalized by the artwork long edge, but the
 * derivative is divided by the field's own spacing, so it is per normalized
 * unit and does not change with the artwork's pixel size.
 */
function buildShadeField(width: number, height: number, longEdge: number): ShadeField {
  const scale = Math.min(1, FIELD_MAX_EDGE / longEdge)
  const fieldWidth = Math.max(2, Math.round(width * scale))
  const fieldHeight = Math.max(2, Math.round(height * scale))
  const spanU = width / longEdge
  const spanV = height / longEdge
  const stepU = spanU / fieldWidth
  const stepV = spanV / fieldHeight
  const heights = new Float32Array(fieldWidth * fieldHeight)

  for (let fy = 0; fy < fieldHeight; fy += 1) {
    const v = (fy + 0.5) * stepV
    const row = fy * fieldWidth
    for (let fx = 0; fx < fieldWidth; fx += 1)
      heights[row + fx] = heightAt((fx + 0.5) * stepU, v)
  }

  const values = new Float32Array(fieldWidth * fieldHeight)
  for (let fy = 0; fy < fieldHeight; fy += 1) {
    const y0 = Math.max(0, fy - 1)
    const y1 = Math.min(fieldHeight - 1, fy + 1)
    const span = (y1 - y0) * stepV
    const row = fy * fieldWidth
    for (let fx = 0; fx < fieldWidth; fx += 1) {
      const x0 = Math.max(0, fx - 1)
      const x1 = Math.min(fieldWidth - 1, fx + 1)
      const across = (x1 - x0) * stepU
      const gradientX = across > 0 ? (heights[row + x1]! - heights[row + x0]!) / across : 0
      const gradientY = span > 0 ? (heights[y1 * fieldWidth + fx]! - heights[y0 * fieldWidth + fx]!) / span : 0
      const derivative = gradientX * LIGHT_X + gradientY * LIGHT_Y
      values[row + fx] = Math.max(-1, Math.min(1, derivative * SHADE_GAIN))
    }
  }
  return { values, width: fieldWidth, height: fieldHeight }
}

function sampleField(field: ShadeField, x: number, y: number): number {
  const fx = Math.max(0, Math.min(field.width - 1, x))
  const fy = Math.max(0, Math.min(field.height - 1, y))
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const x1 = Math.min(field.width - 1, x0 + 1)
  const y1 = Math.min(field.height - 1, y0 + 1)
  const tx = fx - x0
  const ty = fy - y0
  const top = lerp(field.values[y0 * field.width + x0]!, field.values[y0 * field.width + x1]!, tx)
  const bottom = lerp(field.values[y1 * field.width + x0]!, field.values[y1 * field.width + x1]!, tx)
  return lerp(top, bottom, ty)
}

/**
 * The slider's value -> the serialized design. Non-finite and <= 0 are off;
 * values over 100 clamp to 100. The recipe validator normalises a stored 0 to
 * the same off shape, so both sides agree on the one off value.
 */
export function wrinkleFromSlider(strength: number): WrinkleDesign | null {
  if (!Number.isFinite(strength) || strength <= MIN_WRINKLE_STRENGTH)
    return null
  return { strength: Math.min(MAX_WRINKLE_STRENGTH, strength) }
}

/**
 * Shade the artwork's RGB in place with a wrinkled-paper height field.
 *
 * - A null/undefined design, a non-finite strength, or a strength <= 0 returns
 *   before writing a byte, so strength 0 is byte-identical to no texture.
 * - Only offsets 0..2 of each quad are written; alpha is byte-for-byte
 *   unchanged and alpha-0 pixels are skipped, which is what keeps the die-cut
 *   geometry identical.
 * - Additive, not multiplicative: the maker's default black text would show no
 *   crease under a multiplicative shade.
 */
export function applyWrinkle(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  design: WrinkleDesign | null | undefined,
): void {
  if (!design || !Number.isFinite(design.strength) || design.strength <= 0)
    return
  if (width <= 0 || height <= 0)
    return

  const strength = Math.min(MAX_WRINKLE_STRENGTH, design.strength)
  const amplitude = SHADE_AMPLITUDE * (strength / MAX_WRINKLE_STRENGTH)
  const longEdge = Math.max(width, height)
  const field = buildShadeField(width, height, longEdge)
  const fieldStepX = field.width / width
  const fieldStepY = field.height / height

  for (let y = 0; y < height; y += 1) {
    const fieldY = (y + 0.5) * fieldStepY - 0.5
    const row = y * width * 4
    for (let x = 0; x < width; x += 1) {
      const index = row + x * 4
      if (pixels[index + 3] === 0)
        continue
      const shade = sampleField(field, (x + 0.5) * fieldStepX - 0.5, fieldY)
      const delta = amplitude * shade
      pixels[index] = pixels[index]! + delta
      pixels[index + 1] = pixels[index + 1]! + delta
      pixels[index + 2] = pixels[index + 2]! + delta
    }
  }
}
