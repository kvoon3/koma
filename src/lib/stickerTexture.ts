/**
 * Newspaper print for a sticker's artwork, applied before the die-cut (see
 * `prepareArtwork` in lib/sticker.ts). Pure: no DOM, no canvas, no time.
 *
 * The artwork prints as one ink AM halftone on newsprint: every screen cell
 * carries the artwork's own mean tone, the lattice is turned 45° the way a
 * print screen is, the two tones are a newspaper's ink and paper, and the paper
 * carries its own grain. The pitch is measured in *display* pixels (the same
 * stage length the stamp sliders read), so the 480px preview and the 960px save
 * are the same printed sheet at two scales.
 *
 * Alpha is never written: the die-cut's distance field reads it and must not
 * move.
 */

import { valueNoise } from './noise'

/** The frozen texture picks. The recipe stores one of these, or null for off. */
export const STICKER_TEXTURES = ['newsprint'] as const
export type StickerTexture = (typeof STICKER_TEXTURES)[number]

/** cos 45°, which is also sin 45°: the screen's turn. */
const SCREEN_COS = Math.SQRT1_2

/**
 * One screen cell across, in display pixels. The stage draws a sticker about
 * 220px tall, so this is roughly 55 to 70 cells across its long edge: coarse
 * enough to read as dots at 1x, fine enough that a face stays a face.
 */
const DOT_PITCH_DISPLAY = 4
/**
 * 1/√π: a dot's radius for its share of a cell, so the screen prints the cell's
 * own tone and neighbouring dots just touch at 78% coverage.
 */
const DOT_SPREAD = 0.5641895835477563
/** The dot rim's ramp, in display pixels: under one pixel it anti-aliases the screen. */
const EDGE_DISPLAY = 0.6

/** Newsprint's two tones: a warm dark ink and the paper it soaks into. */
const INK = [42, 39, 34] as const
const PAPER = [233, 228, 213] as const

/** Paper fiber (fine) and the pulp's unevenness (coarse), in RGB units of 255. */
const GRAIN_CELL_DISPLAY = 1.4
const GRAIN_AMPLITUDE = 5.5
const MOTTLE_CELL_DISPLAY = 47
const MOTTLE_AMPLITUDE = 3
const GRAIN_SEED = 0x9E3779B1
const MOTTLE_SEED = 0x85EBCA6B

interface GrainField {
  values: Float32Array
  width: number
  height: number
}

/**
 * One grain sample per display pixel, built once. Both the preview and the save
 * run at their own texture size but describe the same display sheet, so they
 * build the same field and place the same fibers.
 */
function buildGrainField(width: number, height: number, scale: number): GrainField {
  const fieldWidth = Math.max(2, Math.ceil(width / scale))
  const fieldHeight = Math.max(2, Math.ceil(height / scale))
  const values = new Float32Array(fieldWidth * fieldHeight)
  for (let fy = 0; fy < fieldHeight; fy += 1) {
    const y = (fy + 0.5) / GRAIN_CELL_DISPLAY
    const mottleY = (fy + 0.5) / MOTTLE_CELL_DISPLAY
    const row = fy * fieldWidth
    for (let fx = 0; fx < fieldWidth; fx += 1) {
      const x = (fx + 0.5) / GRAIN_CELL_DISPLAY
      const mottleX = (fx + 0.5) / MOTTLE_CELL_DISPLAY
      const fiber = (valueNoise(x, y, GRAIN_SEED) - 0.5) * 2 * GRAIN_AMPLITUDE
      const mottle = (valueNoise(mottleX, mottleY, MOTTLE_SEED) - 0.5) * 2 * MOTTLE_AMPLITUDE
      values[row + fx] = fiber + mottle
    }
  }
  return { values, width: fieldWidth, height: fieldHeight }
}

function sampleGrain(field: GrainField, x: number, y: number): number {
  const fx = Math.max(0, Math.min(field.width - 1, x))
  const fy = Math.max(0, Math.min(field.height - 1, y))
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const x1 = Math.min(field.width - 1, x0 + 1)
  const y1 = Math.min(field.height - 1, y0 + 1)
  const tx = fx - x0
  const ty = fy - y0
  const top = field.values[y0 * field.width + x0]! * (1 - tx) + field.values[y0 * field.width + x1]! * tx
  const bottom = field.values[y1 * field.width + x0]! * (1 - tx) + field.values[y1 * field.width + x1]! * tx
  return top * (1 - ty) + bottom * ty
}

/**
 * Print the artwork in place as a newspaper halftone.
 *
 * - A null/undefined design, or anything that is not a known texture, returns
 *   before writing a byte: that is what keeps an untouched bake byte-identical.
 * - Only offsets 0..2 of each quad are written, and alpha-0 pixels are skipped,
 *   so the die-cut geometry and the rim's alpha are identical with and without
 *   the print.
 * - `texturePixelsPerDisplayPixel` is the silhouette's texture long edge over
 *   the stage's drawn long edge (lib/sticker passes it). A missing or invalid
 *   ratio falls back to 1:1, which is only right for a 1:1 bake.
 */
export function applyNewsprint(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  texture: StickerTexture | null | undefined,
  texturePixelsPerDisplayPixel: number,
): void {
  if (texture !== 'newsprint' || width <= 0 || height <= 0)
    return
  const scale = Number.isFinite(texturePixelsPerDisplayPixel) && texturePixelsPerDisplayPixel > 0
    ? texturePixelsPerDisplayPixel
    : 1

  // A turned square lattice: u runs down one screen axis, v down the other.
  const pitch = DOT_PITCH_DISPLAY * scale
  const step = SCREEN_COS / pitch
  const cellsU = Math.floor((width - 1 + height - 1) * step) + 1
  const cellV0 = Math.floor(-(width - 1) * step)
  const cellsV = Math.floor((height - 1) * step) - cellV0 + 1
  const sums = new Float64Array(cellsU * cellsV)
  const counts = new Uint32Array(cellsU * cellsV)

  // Pass one: every opaque pixel's tone into the cell it lands in, so a dot
  // prints the local average rather than one pixel's noise.
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4
    let u = y * step
    let v = y * step
    for (let x = 0; x < width; x += 1, u += step, v -= step) {
      const index = row + x * 4
      if (pixels[index + 3] === 0)
        continue
      const cell = Math.floor(u) * cellsV + (Math.floor(v) - cellV0)
      sums[cell] = sums[cell]!
        + 0.2126 * pixels[index]!
        + 0.7152 * pixels[index + 1]!
        + 0.0722 * pixels[index + 2]!
      counts[cell] = counts[cell]! + 1
    }
  }

  // Pass two: the dot and the paper.
  const grain = buildGrainField(width, height, scale)
  const edge = EDGE_DISPLAY / DOT_PITCH_DISPLAY
  const paperR = PAPER[0]
  const paperG = PAPER[1]
  const paperB = PAPER[2]
  const inkR = INK[0] - paperR
  const inkG = INK[1] - paperG
  const inkB = INK[2] - paperB
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4
    const fieldY = (y + 0.5) / scale - 0.5
    let u = y * step
    let v = y * step
    for (let x = 0; x < width; x += 1, u += step, v -= step) {
      const index = row + x * 4
      if (pixels[index + 3] === 0)
        continue
      const cu = Math.floor(u)
      const cv = Math.floor(v)
      const cell = cu * cellsV + (cv - cellV0)
      const coverage = 1 - sums[cell]! / counts[cell]! / 255
      const radius = DOT_SPREAD * Math.sqrt(Math.max(0, Math.min(1, coverage)))
      const du = u - cu - 0.5
      const dv = v - cv - 0.5
      const distance = Math.sqrt(du * du + dv * dv)
      // A dot's rim ramps over `edge`, and a dot smaller than one ramp keeps
      // only the area it really covers, so paper stays paper in the highlights.
      const rim = Math.max(0, Math.min(1, (radius - distance) / edge + 0.5))
      const subpixel = Math.min(1, radius / edge)
      const ink = rim * subpixel * subpixel * (3 - 2 * subpixel)
      const fiber = sampleGrain(grain, (x + 0.5) / scale - 0.5, fieldY)
      pixels[index] = paperR + inkR * ink + fiber
      pixels[index + 1] = paperG + inkG * ink + fiber
      pixels[index + 2] = paperB + inkB * ink + fiber
    }
  }
}
