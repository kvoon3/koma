/**
 * Tactile texture filters: deterministic, resolution-independent pixel
 * replacement for a pane's photo. Pure (no DOM, no store, no fonts), so the
 * preview cache (`lib/filterCache`) and the exporter draw the very same bytes
 * through one function.
 *
 * Everything here is our own recipe, measured against nothing: no palette,
 * kernel, preset or threshold is taken from any other app's filter set (the
 * product brief for this lane names a reference site, whose artwork is not
 * ours to copy). The shapes below are described by what they do, not by where
 * they came from.
 *
 * Conventions that the whole module keeps:
 *
 * - **In place.** `applyFilter` overwrites the pixels it is handed and returns
 *   nothing: callers work on a canvas they own, so a copy back would be waste.
 *   The pane's pixels are replaced wholesale, so every output is opaque: alpha
 *   is forced to 255 (the exporter clips the pane itself).
 * - **Resolution independent.** Every parameter is expressed in *filter units*
 *   and multiplied by `r = max(w, h) / 1024` (our base, not any reference
 *   app's), so a 2048px render carries the same texture as a 1024px one, at
 *   twice the pixel size. Noise is sampled from an integer lattice in filter
 *   space, so the pattern itself is scale-invariant: the same 2× render
 *   downsamples onto the 1× one instead of being an unrelated field.
 * - **Deterministic.** Same pixels + same id + same seed → byte-identical
 *   output, in every engine: the pipeline uses only integer ops (`Math.imul`,
 *   shifts) and IEEE-exact float ops (+, −, ×, ÷, `Math.sqrt`, `Math.floor`),
 *   never a transcendental (`Math.sin`, `Math.pow`), whose last bits differ
 *   between engines and would make the preview and the exporter disagree.
 * - **Alpha, dimensions.** Width, height and length are never touched.
 */

/** Filters in dock order: the film grain pair, the three duotones, then the processes. */
export const FILTER_IDS = [
  'grain',
  'duotoneWarm',
  'duotoneCool',
  'duotoneSepia',
  'print',
  'cyanotype',
  'paper',
  'bitgrain',
] as const

export type FilterId = (typeof FILTER_IDS)[number]

export function isFilterId(v: unknown): v is FilterId {
  return typeof v === 'string' && (FILTER_IDS as readonly string[]).includes(v)
}

/**
 * The pixel view every recipe works on. `ImageData` satisfies this
 * structurally, so callers pass one straight in; tests pass the same shape
 * without a DOM.
 */
export interface FilterPixels {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** The reference long edge every parameter is measured against. */
export const FILTER_BASE = 1024

/** Our resolution factor: 1 at 1024px on the long side, 2 at 2048px. */
export function filterScale(w: number, h: number): number {
  return Math.max(w, h) / FILTER_BASE
}

/**
 * Seed for one photo + filter pair: stable across the preview and the export
 * (they both derive it from the same two strings), and different per photo so
 * two photos do not share one grain field. FNV-1a over the joined key, then
 * one `imul` scramble; integers only.
 */
export function filterSeed(photoId: string, id: FilterId): number {
  const key = `${photoId}|${id}`
  let h = 0x811C9DC5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x7FEB352D)
  h ^= h >>> 15
  return h >>> 0
}

// --- Primitives -------------------------------------------------------------

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
/** Hermite ramp: flat at both ends, so textures do not band at their joins. */
const smoothT = (t: number) => t * t * (3 - 2 * t)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * 32-bit integer hash of a lattice point → [0, 1). Three odd mixers picked for
 * this module (they only have to avalanche well, and they are ours).
 */
function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul((x | 0) ^ seed, 0x27D4EB2D)
  h = Math.imul((h ^ (y | 0)) + 0x9E3779B1, 0x165667B1)
  h ^= h >>> 15
  h = Math.imul(h, 0x2545F491)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

/**
 * Value noise: one hashed value per lattice cell, smoothly interpolated. `cell`
 * is the lattice pitch in *pixels* (`units * r`), so both the pattern and its
 * scale come out resolution independent. Callers pass a pitch above zero.
 */
function cellNoise(x: number, y: number, cell: number, seed: number): number {
  const u = x / cell
  const v = y / cell
  const x0 = Math.floor(u)
  const y0 = Math.floor(v)
  const tx = smoothT(u - x0)
  const ty = smoothT(v - y0)
  const a = hash2(x0, y0, seed)
  const b = hash2(x0 + 1, y0, seed)
  const c = hash2(x0, y0 + 1, seed)
  const d = hash2(x0 + 1, y0 + 1, seed)
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty)
}

/** Rec. 709 luma of one 8-bit pixel, in [0, 255]. */
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/** Two octaves: a clumped coarse field over a fine one, centred on zero. */
function grainNoise(x: number, y: number, r: number, seed: number): number {
  const coarse = cellNoise(x, y, 2.4 * r, seed)
  const fine = cellNoise(x, y, 0.85 * r, seed + 7)
  return (coarse - 0.5) * 0.62 + (fine - 0.5) * 0.38
}

/** Linear ramp between two RGB triples, per channel. */
type RGB = readonly [number, number, number]

// --- 1. Film grain (monochrome) --------------------------------------------

/**
 * The photo kept in colour, one monochrome grain field laid over it: two
 * octaves of value noise, weighted toward the shadows the way silver grain
 * clumps in a negative, with the blacks lifted a touch (density, not fog).
 */
function filmGrain(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, seed: number, r: number) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const R = src[i]!
      const G = src[i + 1]!
      const B = src[i + 2]!
      const L = luma(R, G, B) / 255
      // Grain grows as the exposure drops, as it does on film.
      const amp = 20 + 28 * (1 - L)
      const g = grainNoise(x, y, r, seed) * amp
      dst[i] = R * 0.975 + g + 3
      dst[i + 1] = G * 0.975 + g + 3
      dst[i + 2] = B * 0.975 + g + 3
      dst[i + 3] = 255
    }
  }
}

// --- 2–4. Grain duotones ----------------------------------------------------

interface Duotone {
  /** Ink colour the shadows print in. */
  shadow: RGB
  /** Paper colour the highlights fall back to. */
  highlight: RGB
  /** Grain amplitude in 8-bit levels, before the shadow weighting. */
  grain: number
  /** How far the tonal curve leans into a filmic S (0 = plain luma ramp). */
  curve: number
  /** Keeps the three duotones on separate noise fields. */
  salt: number
}

/**
 * Our three ink pairs, hand-picked: amber over cream (warm), navy over ice
 * (cool) and low-chroma brown over parchment (sepia). Warm and sepia are close
 * cousins by nature, so they are pushed apart on chroma and on curve: the warm
 * pair is the saturated one, sepia the grey-brown one.
 */
const DUOTONES: Record<'duotoneWarm' | 'duotoneCool' | 'duotoneSepia', Duotone> = {
  duotoneWarm: { shadow: [58, 24, 16], highlight: [252, 234, 198], grain: 34, curve: 0.62, salt: 11 },
  duotoneCool: { shadow: [14, 30, 58], highlight: [224, 240, 250], grain: 30, curve: 0.5, salt: 23 },
  duotoneSepia: { shadow: [40, 31, 24], highlight: [230, 216, 190], grain: 36, curve: 0.38, salt: 37 },
}

/**
 * Luma → a two-colour ramp, then one monochrome grain field on top. The tonal
 * curve pulls the midtones toward a filmic S and the grain rides heavier in the
 * ink, so the print reads as textured rather than tinted.
 */
function duotone(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, seed: number, r: number, tone: Duotone) {
  const { shadow, highlight, grain, curve } = tone
  const toneSeed = seed + tone.salt
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const L = luma(src[i]!, src[i + 1]!, src[i + 2]!) / 255
      const curved = clamp01(lerp(L, smoothT(L), curve))
      const ink = 1 - curved
      const amp = grain * (0.6 + 0.7 * ink)
      const g = grainNoise(x, y, r, toneSeed) * amp
      dst[i] = lerp(highlight[0], shadow[0], ink) + g
      dst[i + 1] = lerp(highlight[1], shadow[1], ink) + g
      dst[i + 2] = lerp(highlight[2], shadow[2], ink) + g
      dst[i + 3] = 255
    }
  }
}

// --- 5. Two-ink print -------------------------------------------------------

/**
 * A risograph-style two-plate print: a warm red plate separated from the red
 * channel, a cool blue plate from the cool channels, each printed with its own
 * uneven density, the blue plate deliberately a hair off-register, and both
 * multiplied over warm paper whose fibre shows through where neither plate
 * reached.
 */
const PRINT_PAPER: RGB = [242, 237, 224]
const PRINT_RED: RGB = [205, 52, 63]
const PRINT_BLUE: RGB = [30, 78, 156]

function twoInkPrint(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, seed: number, r: number) {
  // Plate misregistration: whole pixels, so the plate shift is exact (and the
  // same relative shift at any resolution).
  const dx = Math.round(1.7 * r)
  const dy = Math.round(1.2 * r)
  const fiber = 0.9 * r
  const redAbsorb = [1 - PRINT_RED[0] / 255, 1 - PRINT_RED[1] / 255, 1 - PRINT_RED[2] / 255] as const
  const blueAbsorb = [1 - PRINT_BLUE[0] / 255, 1 - PRINT_BLUE[1] / 255, 1 - PRINT_BLUE[2] / 255] as const
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      // The red plate answers to what absorbs red; the blue plate to the cool
      // channels, read off-register.
      const ca0 = clamp01((1 - src[i]! / 255 - 0.16) / 0.82)
      const jx = Math.min(w - 1, Math.max(0, x - dx))
      const jy = Math.min(h - 1, Math.max(0, y - dy))
      const j = (jy * w + jx) * 4
      const cb0 = clamp01((1 - (0.42 * src[j + 1]! + 0.58 * src[j + 2]!) / 255 - 0.18) / 0.8)
      // Each plate lays its ink unevenly, as a drum does.
      const ca = clamp01(ca0 * (0.9 + 0.2 * cellNoise(x, y, 1.4 * r, seed + 3)))
      const cb = clamp01(cb0 * (0.9 + 0.2 * cellNoise(x, y, 1.9 * r, seed + 5)))
      const fib = (cellNoise(x, y, fiber, seed + 9) - 0.5) * 7
      for (let c = 0; c < 3; c++) {
        dst[i + c] = PRINT_PAPER[c]! * (1 - ca * redAbsorb[c]!) * (1 - cb * blueAbsorb[c]!) + fib
      }
      dst[i + 3] = 255
    }
  }
}

// --- 6. Cyanotype -----------------------------------------------------------

/**
 * The iron print: luma → density on a pale sheet, hard into Prussian blue in
 * the shadows, with the sheet's edge darkening where the sun reached it at an
 * angle and paper fibre under the wash. The falloff is radial and therefore
 * resolution independent.
 */
const CYANO_PAPER: RGB = [228, 238, 236]
const CYANO_BLUE: RGB = [11, 41, 74]

function cyanotype(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, seed: number, r: number) {
  for (let y = 0; y < h; y++) {
    const ny = (y + 0.5) / h - 0.5
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const nx = (x + 0.5) / w - 0.5
      const L = luma(src[i]!, src[i + 1]!, src[i + 2]!) / 255
      // Density curve: shadows deepen faster than midtones, so the blue holds.
      let d = clamp01((1 - L) * 1.2)
      d = clamp01(d * (0.85 + 0.3 * d))
      const rad2 = (nx * nx + ny * ny) * 2
      d = clamp01(d * (1 + 0.14 * rad2))
      const fib = (cellNoise(x, y, 0.7 * r, seed + 13) - 0.5) * 6
      const mottle = (cellNoise(x, y, 9 * r, seed + 17) - 0.5) * 9
      const tex = fib + mottle
      dst[i] = lerp(CYANO_PAPER[0], CYANO_BLUE[0], d) + tex
      dst[i + 1] = lerp(CYANO_PAPER[1], CYANO_BLUE[1], d) + tex
      dst[i + 2] = lerp(CYANO_PAPER[2], CYANO_BLUE[2], d) + tex
      dst[i + 3] = 255
    }
  }
}

// --- 7. Paper tone ----------------------------------------------------------

/**
 * The photo printed on warm stock with a soft ink: contrast compressed, blacks
 * lifted so the paper never goes to ink, warm fibre and a broad unevenness over
 * all of it. The quiet one of the set: meant for a photo that should stay
 * readable, not become a graphic.
 */
const PAPER_TONE_BASE: RGB = [246, 238, 220]
const PAPER_TONE_INK: RGB = [57, 45, 36]

function paperTone(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, seed: number, r: number) {
  const absorb = [1 - PAPER_TONE_INK[0] / 255, 1 - PAPER_TONE_INK[1] / 255, 1 - PAPER_TONE_INK[2] / 255] as const
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const L = luma(src[i]!, src[i + 1]!, src[i + 2]!) / 255
      const p = 1 - L
      // Soft ink: the coverage curve flattens at both ends, so nothing is pure
      // paper or pure ink.
      const cov = 0.05 + 0.78 * clamp01(p * (0.72 + 0.3 * p))
      const fib = (cellNoise(x, y, 0.85 * r, seed + 19) - 0.5) * 8
      const mottle = (cellNoise(x, y, 7.5 * r, seed + 21) - 0.5) * 6
      const tex = fib + mottle
      for (let c = 0; c < 3; c++)
        dst[i + c] = PAPER_TONE_BASE[c]! * (1 - cov * absorb[c]!) + tex
      dst[i + 3] = 255
    }
  }
}

// --- 8. Bit grain -----------------------------------------------------------

/**
 * Coarse binary: the photo is averaged into blocks (about 2.6 filter units
 * across, so a handful of pixels at 1024px) and each block prints as either ink
 * or paper, its tone spent against a per-block hashed threshold. That is a
 * random dither rather than an ordered one, so the ink clumps into grain
 * instead of reading as a screen.
 */
const BIT_INK: RGB = [25, 23, 21]
const BIT_PAPER: RGB = [236, 230, 215]

/** Mean luma of one block, in [0, 255]. */
function blockMean(src: Uint8ClampedArray, w: number, x0: number, y0: number, x1: number, y1: number): number {
  let sum = 0
  let n = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4
      sum += luma(src[i]!, src[i + 1]!, src[i + 2]!)
      n++
    }
  }
  return sum / n
}

/** Paint one block a single flat colour. */
function fillBlock(dst: Uint8ClampedArray, w: number, x0: number, y0: number, x1: number, y1: number, ink: RGB) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4
      dst[i] = ink[0]
      dst[i + 1] = ink[1]
      dst[i + 2] = ink[2]
      dst[i + 3] = 255
    }
  }
}

function bitGrain(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, seed: number, r: number) {
  // Block edges sit on multiples of the pitch in filter space, not on a
  // whole-pixel grid derived from the image's size: that keeps the block
  // layout the same at every resolution. A pitch under one pixel (a small
  // preview) just leaves the empty blocks below to be skipped.
  const pitch = 2.6 * r
  const nbx = Math.ceil(w / pitch)
  const nby = Math.ceil(h / pitch)
  for (let byi = 0; byi < nby; byi++) {
    const y0 = Math.round(byi * pitch)
    const y1 = Math.min(h, Math.round((byi + 1) * pitch))
    if (y1 <= y0)
      continue
    for (let bxi = 0; bxi < nbx; bxi++) {
      const x0 = Math.round(bxi * pitch)
      const x1 = Math.min(w, Math.round((bxi + 1) * pitch))
      if (x1 <= x0)
        continue
      // Each block spends its own tone against its own hashed threshold: solid
      // ink at one end of the ramp, solid paper at the other, a dithered mix
      // between, with a slight stretch so midtones break up faster.
      const want = 1 - blockMean(src, w, x0, y0, x1, y1) / 255
      const on = want * 1.1 - 0.05 > hash2(bxi, byi, seed + 27)
      fillBlock(dst, w, x0, y0, x1, y1, on ? BIT_INK : BIT_PAPER)
    }
  }
}

// --- Entry point ------------------------------------------------------------

/**
 * Apply one filter to `imageData` in place. The pixels are read from a private
 * copy, so a recipe may sample anywhere (the print's second plate reads
 * off-register) while still writing into the caller's buffer.
 *
 * `seed` comes from `filterSeed(photoId, id)` in the app, so the preview and
 * the export agree; any integer works, and the same one always gives the same
 * bytes.
 */
export function applyFilter(imageData: FilterPixels, filterId: FilterId, seed: number): void {
  const { data, width: w, height: h } = imageData
  if (w <= 0 || h <= 0 || data.length < w * h * 4)
    return
  const src = data.slice()
  const r = filterScale(w, h)
  const s = seed | 0
  const recipes: Record<FilterId, () => void> = {
    grain: () => filmGrain(src, data, w, h, s, r),
    duotoneWarm: () => duotone(src, data, w, h, s, r, DUOTONES.duotoneWarm),
    duotoneCool: () => duotone(src, data, w, h, s, r, DUOTONES.duotoneCool),
    duotoneSepia: () => duotone(src, data, w, h, s, r, DUOTONES.duotoneSepia),
    print: () => twoInkPrint(src, data, w, h, s, r),
    cyanotype: () => cyanotype(src, data, w, h, s, r),
    paper: () => paperTone(src, data, w, h, s, r),
    bitgrain: () => bitGrain(src, data, w, h, s, r),
  }
  recipes[filterId]()
}
