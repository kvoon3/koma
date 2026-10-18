/**
 * Texture and pixel-grid filters: deterministic, resolution-independent pixel
 * replacement for a pane's photo. Pure (no DOM, no store, no fonts), so the
 * preview cache (`lib/filterCache`) and the exporter draw the very same bytes
 * through one function.
 *
 * Two families share the pipeline: the *textures* (grain, duotones, print,
 * cyanotype, paper, bit grain) are frozen presets drawn from noise fields, and
 * the *pixel family* (mosaic, tessera, diamond, halftone, two ordered dithers)
 * is geometry drawn from a dialled grid, which is why those six take parameters
 * (`FilterParams` below).
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
 *   (stage pixels, for the pixel family: see `stagePitch`) and multiplied by
 *   `r = max(w, h) / 1024` (our base, not any reference app's), so a 2048px
 *   render carries the same texture as a 1024px one, at twice the pixel size.
 *   Noise is sampled from an integer lattice in filter space and the pixel
 *   family's grids are whole pixels, so the pattern itself is scale-invariant:
 *   the same 2× render downsamples onto the 1× one instead of being an
 *   unrelated field.
 * - **Deterministic.** Same pixels + same id + same seed → byte-identical
 *   output, in every engine: the pipeline uses only integer ops (`Math.imul`,
 *   shifts) and IEEE-exact float ops (+, −, ×, ÷, `Math.sqrt`, `Math.floor`),
 *   never a transcendental (`Math.sin`, `Math.pow`), whose last bits differ
 *   between engines and would make the preview and the exporter disagree.
 * - **Alpha, dimensions.** Width, height and length are never touched.
 */

/**
 * Filters in dock order: the film grain pair, the three duotones, the
 * processes, then the pixel family (blocks, tiles, screens and ordered
 * dithers), which alone take parameters.
 */
export const FILTER_IDS = [
  'grain',
  'duotoneWarm',
  'duotoneCool',
  'duotoneSepia',
  'print',
  'cyanotype',
  'paper',
  'bitgrain',
  'mosaic',
  'tessera',
  'diamond',
  'halftone',
  'bayerMono',
  'bayerColor',
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

// --- Parameters -------------------------------------------------------------

/**
 * The knobs a pixel filter takes. `block` is the family's one size dial (a
 * block, tile, diamond diagonal, dot pitch or dither cell), always in *stage
 * pixels*: pixels on a `FILTER_BASE`-long-edge render (see `stagePitch`). `angle` is the halftone screen angle in degrees, `ink` picks
 * the halftone's mono or duotone screen, `matrix` the ordered dither's Bayer
 * size, `levels` the mosaic's posterise steps and `grain` its speckle (off at
 * 0, the default).
 */
export type FilterKnob = 'block' | 'levels' | 'angle' | 'ink' | 'matrix' | 'grain'

/** One filter plus the knob values it is drawn with. */
export interface FilterSpec extends Partial<Record<FilterKnob, number>> {
  id: FilterId
}

/**
 * A leaf's stored filter: a spec, or a bare id from a build that had no knobs.
 * Both hydrate: `resolveFilter` reads the bare id as that filter's defaults, so
 * an old session and a fresh pick of the same filter draw the same picture.
 */
export type FilterValue = FilterId | FilterSpec

/** One knob's range, in the units its label names. */
export interface FilterParamDef {
  knob: FilterKnob
  min: number
  max: number
  step: number
  def: number
}

/**
 * What each filter lets the user dial. The frozen textures take nothing; the
 * pixel family takes one or two knobs each, and these are the only ranges in
 * the app, so the palette strip and `resolveFilter` cannot disagree.
 */
export const FILTER_PARAMS: Record<FilterId, readonly FilterParamDef[]> = {
  grain: [],
  duotoneWarm: [],
  duotoneCool: [],
  duotoneSepia: [],
  print: [],
  cyanotype: [],
  paper: [],
  bitgrain: [],
  mosaic: [
    { knob: 'block', min: 8, max: 48, step: 1, def: 16 },
    { knob: 'levels', min: 2, max: 16, step: 1, def: 6 },
    // Off at 0: the speckle is an option on a flat-plate mosaic, not its look.
    { knob: 'grain', min: 0, max: 40, step: 4, def: 0 },
  ],
  tessera: [{ knob: 'block', min: 8, max: 48, step: 1, def: 20 }],
  diamond: [{ knob: 'block', min: 8, max: 48, step: 1, def: 20 }],
  halftone: [
    { knob: 'block', min: 6, max: 40, step: 1, def: 14 },
    { knob: 'angle', min: 0, max: 45, step: 1, def: 15 },
    { knob: 'ink', min: 0, max: 1, step: 1, def: 0 },
  ],
  bayerMono: [
    { knob: 'block', min: 1, max: 8, step: 1, def: 2 },
    { knob: 'matrix', min: 4, max: 8, step: 4, def: 4 },
  ],
  bayerColor: [
    { knob: 'block', min: 1, max: 8, step: 1, def: 2 },
    { knob: 'matrix', min: 4, max: 8, step: 4, def: 4 },
  ],
}

/**
 * A stored filter value as a spec with every knob filled and in range: a bare
 * id becomes that filter's defaults, a stale or hand-edited number is clamped
 * to its range, and anything unknown is null (treated as no filter).
 */
export function resolveFilter(v: FilterValue | null | undefined): FilterSpec | null {
  if (!v)
    return null
  const id = typeof v === 'string' ? v : v.id
  if (!isFilterId(id))
    return null
  const given: Partial<Record<FilterKnob, unknown>> = typeof v === 'string' ? {} : v
  const out: FilterSpec = { id }
  for (const p of FILTER_PARAMS[id]) {
    const raw = given[p.knob]
    const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : p.def
    out[p.knob] = Math.min(p.max, Math.max(p.min, Math.round(n / p.step) * p.step))
  }
  return out
}

/** Every knob of `id` at its default: what picking a filter in the palette stores. */
export function defaultFilter(id: FilterId): FilterSpec {
  return resolveFilter(id)!
}

/**
 * Stable identity of one filter setting: the cache key for a filtered bitmap
 * and the export's `(photo, filter)` map, so two panes that dial the same
 * numbers share one pass. The frozen textures keep their bare id.
 */
export function filterKey(v: FilterValue | null | undefined): string {
  const spec = resolveFilter(v)
  if (!spec)
    return 'none'
  const params = FILTER_PARAMS[spec.id]
  return params.length
    ? `${spec.id}:${params.map(p => `${p.knob}=${spec[p.knob]}`).join(',')}`
    : spec.id
}

/** Same filter *setting*: id and every knob. Undo, copy and paste compare with this. */
export function sameFilter(a: FilterValue | null | undefined, b: FilterValue | null | undefined): boolean {
  return filterKey(a) === filterKey(b)
}

/** One knob's value as a whole number in range (the palette's strip writes this). */
export function clampKnob(id: FilterId, knob: FilterKnob, value: number): number {
  const p = FILTER_PARAMS[id].find(d => d.knob === knob)
  if (!p || !Number.isFinite(value))
    return p?.def ?? 0
  return Math.min(p.max, Math.max(p.min, Math.round(value / p.step) * p.step))
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
      const fib = (cellNoise(x, y, 0.85 * r, seed + 19) - 0.5) * 15
      const mottle = (cellNoise(x, y, 7.5 * r, seed + 21) - 0.5) * 11
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

// --- 9–14. The pixel family -------------------------------------------------

/**
 * A stage-pixel length as whole render pixels: the one conversion every size
 * knob goes through. Whole pixels on purpose: a block, tile or dither cell is an
 * exact rectangle of pixels, so the grid a test measures is the grid the eye
 * sees, and `block` at 2048 is exactly twice the block at 1024.
 */
export function stagePitch(stagePx: number, r: number): number {
  return Math.max(1, Math.round(stagePx * r))
}

/** Grout is this fraction of the tile it separates (ours: a hairline, not a gutter). */
export const GROUT_RATIO = 0.12

/**
 * The grout width in render pixels for a stage-pixel tile: dialled in stage
 * space and scaled (`GROUT_RATIO` of the tile), so a 2× render carries the same
 * line at twice the pixels. Capped at half the pitch, so a tile too small to
 * hold a line simply prints without one instead of grouting itself solid.
 */
function groutWidth(tile: number, pitch: number, r: number): number {
  return Math.min(Math.round(Math.round(tile * GROUT_RATIO) * r), Math.floor(pitch / 2))
}

/** The dark neutral the tiled recipes draw their grout in: their own ink, both themes. */
export const GROUT_INK: RGB = [30, 28, 26]

/** A 1-bit screen's two tones: our ink, and the paper it sits on. */
const SCREEN_INK: RGB = [22, 21, 20]
const SCREEN_PAPER: RGB = [246, 244, 239]

/**
 * The halftone's radius per unit of coverage: 1/√π, so a dot covers exactly its
 * cell's share of ink and the screen prints the photo's own tone (at 78% the
 * dots just touch, as an AM screen's do, and past that they overlap into solid).
 */
const DOT_SPREAD = 0.5641895835477563

/** The halftone's paper, and the two inks its duotone screen mixes between. */
const SCREEN_PAPER_WARM: RGB = [244, 240, 231]
const INK_WARM: RGB = [226, 92, 48]
const INK_COOL: RGB = [26, 54, 116]

/** One 8-bit channel snapped to `top + 1` evenly spaced levels. */
function posterise(v: number, top: number): number {
  return Math.round(Math.round((v / 255) * top) * (255 / top))
}

/**
 * Mosaic: the photo crushed into square blocks, each one flat colour: the
 * block's own mean, posterised to `levels` steps so neighbouring blocks
 * separate into plates instead of smearing into a blur. The grid sits on whole
 * pixels (`stagePitch`), so the same dial covers the same share of the picture
 * at any render size, and the optional speckle (0 by default) roughens the
 * flat plates into a printed one.
 */
function mosaic(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number, seed: number, block: number, levels: number, speckle: number) {
  const p = stagePitch(block, r)
  const top = Math.max(1, Math.round(levels) - 1)
  for (let y0 = 0; y0 < h; y0 += p) {
    const y1 = Math.min(h, y0 + p)
    for (let x0 = 0; x0 < w; x0 += p) {
      const x1 = Math.min(w, x0 + p)
      let sr = 0
      let sg = 0
      let sb = 0
      for (let y = y0; y < y1; y++) {
        const row = y * w
        for (let x = x0; x < x1; x++) {
          const i = (row + x) * 4
          sr += src[i]!
          sg += src[i + 1]!
          sb += src[i + 2]!
        }
      }
      const n = (y1 - y0) * (x1 - x0)
      // One hashed value per block, so the speckle is the same field at any size.
      const sp = speckle > 0 ? (hash2(x0 / p, y0 / p, seed) - 0.5) * speckle : 0
      fillBlock(dst, w, x0, y0, x1, y1, [
        posterise(sr / n, top) + sp,
        posterise(sg / n, top) + sp,
        posterise(sb / n, top) + sp,
      ])
    }
  }
}

/**
 * The lattice both tilings are squares in: `u = x, v = y` for tiles, `u = x + y,
 * v = x - y` for diamonds (a 45° turn maps a diamond onto the axis-aligned
 * grid). `at(y)` is `[u, v]` at x = 0 for that row and `step` the per-pixel
 * increment of each; `cv0` is the first v-cell index, negative for the diamond
 * lattice, whose upper corner sits above the picture.
 */
interface Lattice {
  d: number
  g: number
  cols: number
  rows: number
  at: (y: number) => [number, number]
  step: [number, number]
  cv0: number
}

/** One lattice coordinate's cell index: `floor(sum / d)`, in whole numbers. */
const cellOf = (coord: number, d: number) => Math.floor(coord / d)

/** Accumulate every pixel's colour into the cell it lands in. */
function sumLattice(src: Uint8ClampedArray, w: number, h: number, lat: Lattice, sumR: Float64Array, sumG: Float64Array, sumB: Float64Array, count: Uint32Array) {
  const { d, rows, at, step, cv0 } = lat
  const [du, dv] = step
  for (let y = 0; y < h; y++) {
    const row = y * w
    const [u0, v0] = at(y)
    for (let x = 0; x < w; x++) {
      const c = cellOf(u0 + x * du, d) * rows + (cellOf(v0 + x * dv, d) - cv0)
      const i = (row + x) * 4
      sumR[c] = sumR[c]! + src[i]!
      sumG[c] = sumG[c]! + src[i + 1]!
      sumB[c] = sumB[c]! + src[i + 2]!
      count[c] = count[c]! + 1
    }
  }
}

/** Print every cell flat, with its grout band on the trailing edges. */
function paintLattice(dst: Uint8ClampedArray, w: number, h: number, lat: Lattice, flat: Uint8Array) {
  const { d, g, rows, at, step, cv0 } = lat
  const [du, dv] = step
  for (let y = 0; y < h; y++) {
    const row = y * w
    const [u0, v0] = at(y)
    for (let x = 0; x < w; x++) {
      const cu = cellOf(u0 + x * du, d)
      const cv = cellOf(v0 + x * dv, d)
      const c = cu * rows + (cv - cv0)
      // The grout is the last `g` pixels of a cell in each lattice axis, so the
      // lines land on the cell boundaries and the period is exactly one cell.
      const grout = u0 + x * du - cu * d >= d - g || v0 + x * dv - cv * d >= d - g
      const i = (row + x) * 4
      dst[i] = grout ? GROUT_INK[0] : flat[c * 3]!
      dst[i + 1] = grout ? GROUT_INK[1] : flat[c * 3 + 1]!
      dst[i + 2] = grout ? GROUT_INK[2] : flat[c * 3 + 2]!
      dst[i + 3] = 255
    }
  }
}

/**
 * One lattice pass, shared by the square and the diamond tiling: every cell's
 * mean colour, printed flat, with a grout line between the cells.
 */
function latticePass(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, lat: Lattice) {
  const total = lat.cols * lat.rows
  const sumR = new Float64Array(total)
  const sumG = new Float64Array(total)
  const sumB = new Float64Array(total)
  const count = new Uint32Array(total)
  sumLattice(src, w, h, lat, sumR, sumG, sumB, count)
  const flat = new Uint8Array(total * 3)
  for (let c = 0; c < total; c++) {
    const n = count[c]!
    if (!n)
      continue
    flat[c * 3] = Math.round(sumR[c]! / n)
    flat[c * 3 + 1] = Math.round(sumG[c]! / n)
    flat[c * 3 + 2] = Math.round(sumB[c]! / n)
  }
  paintLattice(dst, w, h, lat, flat)
}

/**
 * Tessera: square tiles, one flat colour each, a dark grout line between them.
 * The grout is a fixed share of the tile, so a big tile wears a proportionate
 * line and the tiles stay square at any size.
 */
function tessera(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number, tile: number) {
  const p = stagePitch(tile, r)
  latticePass(src, dst, w, h, {
    d: p,
    g: groutWidth(tile, p, r),
    cols: Math.ceil(w / p),
    rows: Math.ceil(h / p),
    at: y => [0, y],
    step: [1, 0],
    cv0: 0,
  })
}

/**
 * Diamond: tessera on a lattice turned 45°, so the tiles are diamonds whose rows
 * are offset by half a step. A diamond of diagonal d is an axis-aligned d-square
 * in (x + y, x - y), which is both what makes the cells cheap to average and
 * what makes their edges exact: the block dial is the diagonal, so the lattice is
 * exactly the dial at the base size and exactly twice it at 2048.
 */
function diamond(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number, tile: number) {
  const d = stagePitch(tile, r)
  const span = Math.floor((w + h) / d) + 2
  latticePass(src, dst, w, h, {
    d,
    g: groutWidth(tile, d, r),
    cols: span,
    rows: span,
    at: y => [y, -y],
    step: [1, 1],
    cv0: Math.floor(-(h - 1) / d),
  })
}

/**
 * The screen angles in fixed point: cos and sin of every whole degree 0–45, in
 * 1/4096 units. Integers, so the screen is the identical set of dots in every
 * engine (`Math.sin`'s last bits are not), and the rotation costs two multiply-
 * adds per pixel.
 */
const ANGLE_Q = 4096
const COS_Q: readonly number[] = [
  4096,
  4095,
  4094,
  4090,
  4086,
  4080,
  4074,
  4065,
  4056,
  4046,
  4034,
  4021,
  4006,
  3991,
  3974,
  3956,
  3937,
  3917,
  3896,
  3873,
  3849,
  3824,
  3798,
  3770,
  3742,
  3712,
  3681,
  3650,
  3617,
  3582,
  3547,
  3511,
  3474,
  3435,
  3396,
  3355,
  3314,
  3271,
  3228,
  3183,
  3138,
  3091,
  3044,
  2996,
  2946,
  2896,
]
const SIN_Q: readonly number[] = [
  0,
  71,
  143,
  214,
  286,
  357,
  428,
  499,
  570,
  641,
  711,
  782,
  852,
  921,
  991,
  1060,
  1129,
  1198,
  1266,
  1334,
  1401,
  1468,
  1534,
  1600,
  1666,
  1731,
  1796,
  1860,
  1923,
  1986,
  2048,
  2110,
  2171,
  2231,
  2290,
  2349,
  2408,
  2465,
  2522,
  2578,
  2633,
  2687,
  2741,
  2793,
  2845,
  2896,
]

/** One halftone screen: the turned lattice's fixed-point steps and cell bounds. */
interface Screen {
  /** cos and sin of the screen angle, in 1/4096 units. */
  cq: number
  sq: number
  /** One cell's pitch in the same fixed point. */
  pu: number
  /** Cells across v, and the first v-cell index. */
  nv: number
  v0: number
}

/** Accumulate every pixel's colour into the screen cell it lands in. */
function sumScreen(src: Uint8ClampedArray, w: number, h: number, sc: Screen, sumR: Float64Array, sumG: Float64Array, sumB: Float64Array, count: Uint32Array) {
  const { cq, sq, pu, nv, v0 } = sc
  for (let y = 0; y < h; y++) {
    const row = y * w
    let u = y * sq
    let v = y * cq
    for (let x = 0; x < w; x++, u += cq, v -= sq) {
      const c = Math.floor(u / pu) * nv + (Math.floor(v / pu) - v0)
      const i = (row + x) * 4
      sumR[c] = sumR[c]! + src[i]!
      sumG[c] = sumG[c]! + src[i + 1]!
      sumB[c] = sumB[c]! + src[i + 2]!
      count[c] = count[c]! + 1
    }
  }
}

/**
 * Turn each cell's mean into a dot: the radius it prints at (squared, in the
 * screen's fixed point) and its flat ink.
 */
function screenDots(src: Uint8ClampedArray, w: number, h: number, sc: Screen, total: number, p: number, duotone: number) {
  const sumR = new Float64Array(total)
  const sumG = new Float64Array(total)
  const sumB = new Float64Array(total)
  const count = new Uint32Array(total)
  sumScreen(src, w, h, sc, sumR, sumG, sumB, count)
  const rad2 = new Float64Array(total)
  const dot = new Uint8Array(total * 3)
  for (let c = 0; c < total; c++) {
    const n = count[c]!
    if (!n)
      continue
    const cov = clamp01(1 - luma(sumR[c]! / n, sumG[c]! / n, sumB[c]! / n) / 255)
    // Radius from area coverage: π r² = coverage · p², so the printed tone is
    // the photo's tone and neighbouring dots touch at 78%.
    const rq = 2 * DOT_SPREAD * p * Math.sqrt(cov) * ANGLE_Q
    rad2[c] = rq * rq
    if (duotone) {
      // Lights print warm, darks print cool: a two-ink screen.
      const t = clamp01((cov - 0.28) / 0.5)
      dot[c * 3] = Math.round(lerp(INK_WARM[0], INK_COOL[0], t))
      dot[c * 3 + 1] = Math.round(lerp(INK_WARM[1], INK_COOL[1], t))
      dot[c * 3 + 2] = Math.round(lerp(INK_WARM[2], INK_COOL[2], t))
    }
    else {
      dot[c * 3] = SCREEN_INK[0]
      dot[c * 3 + 1] = SCREEN_INK[1]
      dot[c * 3 + 2] = SCREEN_INK[2]
    }
  }
  return { rad2, dot }
}

/** Print the screen: ink inside each dot's radius, paper outside. */
function paintScreen(dst: Uint8ClampedArray, w: number, h: number, sc: Screen, rad2: Float64Array, dot: Uint8Array, paper: RGB) {
  const { cq, sq, pu, nv, v0 } = sc
  for (let y = 0; y < h; y++) {
    const row = y * w
    let u = y * sq
    let v = y * cq
    for (let x = 0; x < w; x++, u += cq, v -= sq) {
      const cu = Math.floor(u / pu)
      const cv = Math.floor(v / pu)
      const c = cu * nv + (cv - v0)
      // Distance to the cell's centre, doubled and in fixed point: integers in,
      // so the dot's edge falls on the same pixels everywhere.
      const du = 2 * u - (2 * cu + 1) * pu
      const dv = 2 * v - (2 * cv + 1) * pu
      const on = du * du + dv * dv <= rad2[c]!
      const i = (row + x) * 4
      dst[i] = on ? dot[c * 3]! : paper[0]
      dst[i + 1] = on ? dot[c * 3 + 1]! : paper[1]
      dst[i + 2] = on ? dot[c * 3 + 2]! : paper[2]
      dst[i + 3] = 255
    }
  }
}

/**
 * Halftone: an AM dot screen. A grid of cells is turned by the screen angle and
 * every cell prints one round dot whose radius answers to the cell's own tone: a
 * full dot in the shadows, a pinpoint in the highlights, dots just touching at
 * the midtone. Mono prints our ink on paper-white; the duotone screen runs its
 * dots from a warm ink in the lights to a cool one in the darks. The pitch is a
 * stage-pixel dial and the angle is whole degrees, so the screen is the same
 * picture at any render size.
 */
function halftone(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number, pitch: number, angle: number, duotone: number) {
  const p = stagePitch(pitch, r)
  const deg = Math.min(45, Math.max(0, Math.round(angle)))
  const cq = COS_Q[deg]!
  const sq = SIN_Q[deg]!
  const pu = p * ANGLE_Q
  // Cell bounds over the picture (cos and sin are both ≥ 0 in 0-45°).
  const uMax = (w - 1) * cq + (h - 1) * sq
  const vMin = -(w - 1) * sq
  const vMax = (h - 1) * cq
  const nu = Math.floor(uMax / pu) + 1
  const v0 = Math.floor(vMin / pu)
  const nv = Math.floor(vMax / pu) - v0 + 1
  const sc: Screen = { cq, sq, pu, nv, v0 }
  const { rad2, dot } = screenDots(src, w, h, sc, nu * nv, p, duotone)
  paintScreen(dst, w, h, sc, rad2, dot, duotone ? SCREEN_PAPER_WARM : SCREEN_PAPER)
}

/**
 * The ordered-dither thresholds, ours: the 4×4 and 8×8 Bayer index matrices,
 * built by the usual 2×2 doubling (`4M + [[0,2],[3,1]]` per block), 0 to n²−1.
 * Exported so a test can pin the 4×4 pattern by name.
 */
export const BAYER4: readonly number[] = [
  0,
  8,
  2,
  10,
  12,
  4,
  14,
  6,
  3,
  11,
  1,
  9,
  15,
  7,
  13,
  5,
]
export const BAYER8: readonly number[] = [
  0,
  32,
  8,
  40,
  2,
  34,
  10,
  42,
  48,
  16,
  56,
  24,
  50,
  18,
  58,
  26,
  12,
  44,
  4,
  36,
  14,
  46,
  6,
  38,
  60,
  28,
  52,
  20,
  62,
  30,
  54,
  22,
  3,
  35,
  11,
  43,
  1,
  33,
  9,
  41,
  51,
  19,
  59,
  27,
  49,
  17,
  57,
  25,
  15,
  47,
  7,
  39,
  13,
  45,
  5,
  37,
  63,
  31,
  55,
  23,
  61,
  29,
  53,
  21,
]

/** A Bayer matrix by size (4 or 8; anything smaller picks 4, larger 8). */
export function bayerMatrix(size: number): readonly number[] {
  return size >= 8 ? BAYER8 : BAYER4
}

/** The Bayer side length a dialled matrix size means. */
export function bayerSide(size: number): number {
  return size >= 8 ? 8 : 4
}

/**
 * Ordered dither, monochrome: the photo's tone spent against a Bayer threshold
 * per pixel, so every pixel is one of two inks and the eye averages the screen
 * back into a tone. The cell dial is a stage-pixel pitch, so the screen's
 * period is `matrix × cell` at any render size.
 */
function bayerMono(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number, cell: number, size: number) {
  const p = stagePitch(cell, r)
  const n = bayerSide(size)
  const m = bayerMatrix(size)
  const total = n * n
  for (let y = 0; y < h; y++) {
    const row = y * w
    const ty = (Math.floor(y / p) % n) * n
    for (let x = 0; x < w; x++) {
      const i = (row + x) * 4
      const ink = 1 - luma(src[i]!, src[i + 1]!, src[i + 2]!) / 255
      const t = (m[ty + Math.floor(x / p) % n]! + 0.5) / total
      const c = ink > t ? SCREEN_INK : SCREEN_PAPER
      dst[i] = c[0]
      dst[i + 1] = c[1]
      dst[i + 2] = c[2]
      dst[i + 3] = 255
    }
  }
}

/** The colour dither quantises each channel to steps this wide. */
const DITHER_STEP = 64

/**
 * Ordered dither, in colour: the same Bayer screen, but each channel spends its
 * own tone between the two 64-wide steps it sits between, so the hue survives
 * and only the last 6 bits of each channel are stippled, fine enough that the
 * photo still reads, coarse enough to show as a screen.
 */
function bayerColor(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number, cell: number, size: number) {
  const p = stagePitch(cell, r)
  const n = bayerSide(size)
  const m = bayerMatrix(size)
  const total = n * n
  for (let y = 0; y < h; y++) {
    const row = y * w
    const ty = (Math.floor(y / p) % n) * n
    for (let x = 0; x < w; x++) {
      const i = (row + x) * 4
      const t = (m[ty + Math.floor(x / p) % n]! + 0.5) / total
      for (let ch = 0; ch < 3; ch++) {
        const v = src[i + ch]!
        const lo = v - (v % DITHER_STEP)
        const hi = Math.min(255, lo + DITHER_STEP)
        dst[i + ch] = (v - lo) / DITHER_STEP > t ? hi : lo
      }
      dst[i + 3] = 255
    }
  }
}

// --- Entry point ------------------------------------------------------------

/**
 * Apply one filter to `imageData` in place. The pixels are read from a private
 * copy, so a recipe may sample anywhere (the print's second plate reads
 * off-register) while still writing into the caller's buffer.
 *
 * `filter` is a setting, not just an id: a bare id (an old session, or one of
 * the frozen textures) draws with that filter's defaults, a spec carries the
 * dialled knobs (see `resolveFilter`). `seed` comes from `filterSeed(photoId,
 * id)` in the app, so the preview and the export agree; any integer works, and
 * the same one always gives the same bytes.
 */
export function applyFilter(imageData: FilterPixels, filter: FilterValue, seed: number): void {
  const { data, width: w, height: h } = imageData
  if (w <= 0 || h <= 0 || data.length < w * h * 4)
    return
  const spec = resolveFilter(filter)
  if (!spec)
    return
  const src = data.slice()
  const r = filterScale(w, h)
  const s = seed | 0
  const knob = (k: FilterKnob) => spec[k] ?? FILTER_PARAMS[spec.id].find(p => p.knob === k)?.def ?? 0
  const recipes: Record<FilterId, () => void> = {
    grain: () => filmGrain(src, data, w, h, s, r),
    duotoneWarm: () => duotone(src, data, w, h, s, r, DUOTONES.duotoneWarm),
    duotoneCool: () => duotone(src, data, w, h, s, r, DUOTONES.duotoneCool),
    duotoneSepia: () => duotone(src, data, w, h, s, r, DUOTONES.duotoneSepia),
    print: () => twoInkPrint(src, data, w, h, s, r),
    cyanotype: () => cyanotype(src, data, w, h, s, r),
    paper: () => paperTone(src, data, w, h, s, r),
    bitgrain: () => bitGrain(src, data, w, h, s, r),
    mosaic: () => mosaic(src, data, w, h, r, s, knob('block'), knob('levels'), spec.grain ?? 0),
    tessera: () => tessera(src, data, w, h, r, knob('block')),
    diamond: () => diamond(src, data, w, h, r, knob('block')),
    halftone: () => halftone(src, data, w, h, r, knob('block'), knob('angle'), knob('ink')),
    bayerMono: () => bayerMono(src, data, w, h, r, knob('block'), knob('matrix')),
    bayerColor: () => bayerColor(src, data, w, h, r, knob('block'), knob('matrix')),
  }
  recipes[spec.id]()
}
