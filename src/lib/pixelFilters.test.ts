/// <reference types="bun" />
import type { FilterId, FilterPixels, FilterSpec } from './filters'
import { describe, expect, it } from 'bun:test'
import {
  applyFilter,
  BAYER4,
  BAYER8,
  bayerSide,
  defaultFilter,
  FILTER_IDS,
  FILTER_PARAMS,
  filterKey,
  GROUT_INK,
  GROUT_RATIO,
  resolveFilter,
  sameFilter,
  SCREEN_INK,
  SCREEN_PAPER,
  stagePitch,
} from './filters'

/**
 * The pixel family: blocks, tiles, screens and dithers. What is worth
 * pinning here is *geometry*: a dial of 20 must print 20-pixel tiles at the
 * base size (1024, where `r` is 1) and 40 at 2048, grout must fall on the tile
 * boundaries, a halftone dot must grow with the tone it prints, and the ordered
 * dither's screen must be the matrix named in the source, not a similar one.
 * The diffusion dither has no screen to pin, so its tests pin the scan itself:
 * a flat grey must settle into the exact ink count the Floyd–Steinberg walk
 * produces, and a 2× render must be that picture doubled.
 *
 * Every fixture is flat or cell-constant, so an expected value is arithmetic on
 * the fixture rather than a second run of the code under test.
 */

const WHITE: [number, number, number] = [200, 200, 200]

/** A constant-colour frame: cell means equal the colour, so output is predictable. */
function flat(w: number, h: number, rgb: [number, number, number] = WHITE): FilterPixels {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0]
    data[i + 1] = rgb[1]
    data[i + 2] = rgb[2]
    data[i + 3] = 255
  }
  return { data, width: w, height: h }
}

/** One flat colour per `cell`-sized square, every square a different one. */
function cellSource(w: number, h: number, cell: number): FilterPixels {
  const px = flat(w, h)
  const { data } = px
  const colour = (bx: number, by: number) => [
    (bx * 61 + by * 23) % 256,
    (bx * 17 + by * 97) % 256,
    (bx * 43 + by * 13) % 256,
  ]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const [r, g, b] = colour(Math.floor(x / cell), Math.floor(y / cell))
      data[i] = r!
      data[i + 1] = g!
      data[i + 2] = b!
    }
  }
  return px
}

function rgbAt(px: FilterPixels, x: number, y: number): [number, number, number] {
  const i = (y * px.width + x) * 4
  return [px.data[i]!, px.data[i + 1]!, px.data[i + 2]!]
}

function isGrout(px: FilterPixels, x: number, y: number) {
  const [r, g, b] = rgbAt(px, x, y)
  return r === GROUT_INK[0] && g === GROUT_INK[1] && b === GROUT_INK[2]
}

/** Ink on the one-bit screens is dark; paper is light. */
const isInk = (px: FilterPixels, x: number, y: number) => rgbAt(px, x, y)[0] < 128

/** Is every pixel of this square one colour? (A block, a tile, a dot cell.) */
function flatSquare(px: FilterPixels, x0: number, y0: number, side: number): boolean {
  const first = rgbAt(px, x0, y0)
  for (let y = y0; y < y0 + side; y++) {
    for (let x = x0; x < x0 + side; x++) {
      if (rgbAt(px, x, y)[0] !== first[0])
        return false
    }
  }
  return true
}

/** Ink runs along one row of a screen, and the width of the first of them. */
function inkRuns(px: FilterPixels, row: number, size: number): { runs: number, width: number } {
  let runs = 0
  let ink = false
  let firstAt = -1
  for (let x = 0; x < size; x++) {
    const now = isInk(px, x, row)
    if (now && !ink)
      runs++
    if (now && firstAt < 0)
      firstAt = x
    ink = now
  }
  if (firstAt < 0)
    return { runs, width: 0 }
  let width = 0
  while (firstAt + width < size && isInk(px, firstAt + width, row))
    width++
  return { runs, width }
}

/** The share of a `side`-square corner that prints ink. */
function inkFraction(px: FilterPixels, side: number): number {
  let ink = 0
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      if (isInk(px, x, y))
        ink++
    }
  }
  return ink / (side * side)
}

/** The grout width the recipes promise: `GROUT_RATIO` of the tile, in whole pixels. */
function groutOf(tile: number, pitch: number, r: number): number {
  return Math.min(Math.round(Math.round(tile * GROUT_RATIO) * r), Math.floor(pitch / 2))
}

/** A vertical luma ramp, so the halftone's dot colour moves between two inks. */
function lumaRamp(w: number, h: number): FilterPixels {
  const px = flat(w, h)
  for (let y = 0; y < h; y++) {
    const v = Math.round(20 + 200 * (y / h))
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      px.data[i] = v
      px.data[i + 1] = v
      px.data[i + 2] = v
    }
  }
  return px
}

/** Base-size render: `r === 1`, so a dial of N is a pitch of N pixels. */
const BASE = 1024

describe('filter settings', () => {
  it('reads a bare id as that filter with its defaults filled in', () => {
    const spec = resolveFilter('mosaic')!
    expect(spec.id).toBe('mosaic')
    for (const p of FILTER_PARAMS.mosaic)
      expect([p.knob, spec[p.knob]]).toEqual([p.knob, p.def])
    // The frozen textures take nothing, so their value is just an id.
    expect(resolveFilter('grain')).toEqual({ id: 'grain' })
    expect(FILTER_PARAMS.grain).toHaveLength(0)
  })

  it('clamps a hand-edited value into range and fills what is missing', () => {
    const spec = resolveFilter({ id: 'mosaic', block: 999, levels: 1 })!
    expect(spec.block).toBe(48)
    expect(spec.levels).toBe(2)
    expect(resolveFilter({ id: 'mosaic', grain: Number.NaN })!.grain).toBe(0)
    expect(resolveFilter({ id: 'halftone', angle: -5 })!.angle).toBe(0)
    // The matrix snaps to the nearer of 4 and 8.
    expect(resolveFilter({ id: 'bayerMono', matrix: 5 })!.matrix).toBe(4)
    expect(resolveFilter({ id: 'bayerMono', matrix: 7 })!.matrix).toBe(8)
  })

  it('is null for nothing and for an id this build lacks', () => {
    expect(resolveFilter(null)).toBeNull()
    expect(resolveFilter(undefined)).toBeNull()
    expect(resolveFilter('risograph' as never)).toBeNull()
  })

  it('keys a setting by its id and every knob, so a dial change is a new bitmap', () => {
    expect(filterKey('grain')).toBe('grain')
    expect(filterKey({ id: 'grain' })).toBe('grain')
    expect(filterKey('mosaic')).toBe(filterKey(defaultFilter('mosaic')))
    expect(filterKey({ id: 'mosaic', block: 24 })).not.toBe(filterKey('mosaic'))
    expect(filterKey({ id: 'mosaic', block: 24 })).toBe(filterKey({ id: 'mosaic', block: 24, levels: 6 }))
    expect(sameFilter({ id: 'mosaic', block: 24 }, { id: 'mosaic', block: 24 })).toBe(true)
    expect(sameFilter({ id: 'mosaic', block: 24 }, { id: 'mosaic', block: 16 })).toBe(false)
    expect(sameFilter(null, undefined)).toBe(true)
  })
})

describe('stagePitch', () => {
  it('is the dial at the base size and doubles with the render', () => {
    expect(stagePitch(16, 1)).toBe(16)
    expect(stagePitch(16, 2)).toBe(32)
    expect(stagePitch(16, 0.5)).toBe(8)
    // Never less than a pixel: a tiny preview still prints something.
    expect(stagePitch(2, 0.0625)).toBe(1)
    expect(stagePitch(0, 1)).toBe(1)
  })
})

describe('mosaic', () => {
  it('prints one flat colour per block, on a grid of the dialled pitch', () => {
    const block = 16
    const px = cellSource(BASE, BASE, block)
    applyFilter(px, { id: 'mosaic', block, levels: 16 }, 7)
    // 1024 / 16 = 64 blocks a side, every one flat, every one its own mean.
    let differing = 0
    for (let by = 0; by < BASE; by += block) {
      for (let bx = 0; bx < BASE; bx += block) {
        const first = rgbAt(px, bx, by)
        for (let y = by; y < by + block; y++) {
          for (let x = bx; x < bx + block; x++)
            expect([x, y, rgbAt(px, x, y)]).toEqual([x, y, first])
        }
        if (bx + block < BASE && first[0] !== rgbAt(px, bx + block, by)[0])
          differing++
      }
    }
    // The blocks land on different plates: this is a mosaic, not a wash.
    expect(differing / (63 * 64) > 0.5).toBe(true)
  })

  it('is 16-pixel blocks at the base and 32 at 2048', () => {
    for (const [size, pitch] of [[1024, 16], [2048, 32]] as const) {
      const px = cellSource(size, size, pitch)
      applyFilter(px, { id: 'mosaic', block: 16, levels: 16 }, 3)
      let flatBlocks = 0
      for (let by = 0; by < size; by += pitch) {
        for (let bx = 0; bx < size; bx += pitch) {
          if (flatSquare(px, bx, by, pitch))
            flatBlocks++
        }
      }
      expect([size, flatBlocks]).toEqual([size, (size / pitch) ** 2])
    }
  })

  it('posterises to the dialled number of levels', () => {
    // Two levels are 0 and 255: 200 is nearer the top, 50 the bottom.
    const hi = flat(256, 256, [200, 200, 200])
    applyFilter(hi, { id: 'mosaic', block: 16, levels: 2 }, 0)
    expect(rgbAt(hi, 8, 8)).toEqual([255, 255, 255])
    const lo = flat(256, 256, [50, 50, 50])
    applyFilter(lo, { id: 'mosaic', block: 16, levels: 2 }, 0)
    expect(rgbAt(lo, 8, 8)).toEqual([0, 0, 0])
    // Sixteen steps: 100 snaps to the nearest of 0, 17, 34 … 255.
    const fine = flat(256, 256, [100, 100, 100])
    applyFilter(fine, { id: 'mosaic', block: 16, levels: 16 }, 0)
    expect(rgbAt(fine, 8, 8)[0]).toBe(Math.round(Math.round(100 / 255 * 15) * 255 / 15))
  })

  it('speckles only when it is dialled, and then from the seed', () => {
    const off = cellSource(256, 256, 16)
    applyFilter(off, { id: 'mosaic', block: 16, levels: 16 }, 5)
    const on = cellSource(256, 256, 16)
    applyFilter(on, { id: 'mosaic', block: 16, levels: 16, grain: 24 }, 5)
    expect(on.data).not.toEqual(off.data)
    const again = cellSource(256, 256, 16)
    applyFilter(again, { id: 'mosaic', block: 16, levels: 16, grain: 24 }, 5)
    expect(again.data).toEqual(on.data)
  })
})

describe('tessera', () => {
  it('tiles the frame and draws grout on the tile boundaries, 12% of the tile', () => {
    const tile = 20
    const px = flat(BASE, BASE)
    applyFilter(px, { id: 'tessera', block: tile }, 0)
    const g = groutOf(tile, tile, 1)
    expect(g).toBe(2)
    for (let y = 0; y < 200; y++) {
      for (let x = 0; x < 200; x++) {
        // Grout is the last g pixels of a cell in each axis: the pattern's
        // period is exactly the pitch, and the lines land on the boundaries.
        const want = x % tile >= tile - g || y % tile >= tile - g
        expect([x, y, isGrout(px, x, y)]).toEqual([x, y, want])
      }
    }
    // Flat areas carry the tile's own mean, which for a flat photo is its colour.
    expect(rgbAt(px, 4, 4)).toEqual(WHITE)
  })

  it('doubles the tile and the grout at 2048', () => {
    const tile = 20
    const px = flat(2048, 2048)
    applyFilter(px, { id: 'tessera', block: tile }, 0)
    const g = groutOf(tile, tile * 2, 2)
    expect(g).toBe(4)
    for (let y = 0; y < 400; y += 7) {
      for (let x = 0; x < 400; x += 7) {
        const want = x % 40 >= 36 || y % 40 >= 36
        expect([x, y, isGrout(px, x, y)]).toEqual([x, y, want])
      }
    }
  })

  it('averages each tile from the photo under it', () => {
    const tile = 40
    const px = cellSource(BASE, BASE, tile)
    applyFilter(px, { id: 'tessera', block: tile }, 0)
    // Tile (2, 3): the source's own colour for that square, nothing borrowed.
    const want: [number, number, number] = [
      (2 * 61 + 3 * 23) % 256,
      (2 * 17 + 3 * 97) % 256,
      (2 * 43 + 3 * 13) % 256,
    ]
    expect(rgbAt(px, tile * 2 + 20, tile * 3 + 20)).toEqual(want)
    // A neighbour is a different tile, not the same wash.
    expect(rgbAt(px, tile * 3 + 20, tile * 3 + 20)).not.toEqual(want)
  })
})

describe('diamond', () => {
  it('turns the lattice 45°: the grout follows the diamond edges', () => {
    const tile = 20
    const px = flat(BASE, BASE)
    applyFilter(px, { id: 'diamond', block: tile }, 0)
    const g = groutOf(tile, tile, 1)
    const mod = (v: number) => ((v % tile) + tile) % tile
    expect(g).toBe(2)
    for (let y = 0; y < 200; y++) {
      for (let x = 0; x < 200; x++) {
        // A diamond of diagonal d is an axis-aligned d-square in (x+y, x−y).
        const want = mod(x + y) >= tile - g || mod(x - y) >= tile - g
        expect([x, y, isGrout(px, x, y)]).toEqual([x, y, want])
      }
    }
  })

  it('is tessera turned, not tessera', () => {
    const size = 512
    const a = flat(size, size)
    const b = flat(size, size)
    applyFilter(a, { id: 'tessera', block: 20 }, 0)
    applyFilter(b, { id: 'diamond', block: 20 }, 0)
    expect(a.data).not.toEqual(b.data)
    // The diamond mask is d-periodic in x and in y (the offset rows are why).
    for (let y = 0; y < 60; y += 3) {
      for (let x = 0; x < 60; x += 3) {
        expect([x, y, isGrout(b, x, y)]).toEqual([x, y, isGrout(b, x + 20, y)])
        expect([x, y, isGrout(b, x, y)]).toEqual([x, y, isGrout(b, x, y + 20)])
      }
    }
  })

  it('averages over the diamond, not over a square', () => {
    const d = 20
    const px = cellSource(BASE, BASE, 10)
    applyFilter(px, { id: 'diamond', block: d }, 0)
    // Gather one cell's non-grout pixels independently, then check the recipe
    // painted exactly their mean.
    const iu = 8
    const iv = 2
    const cell: [number, number][] = []
    for (let y = 0; y < 400; y++) {
      for (let x = 0; x < 400; x++) {
        if (Math.floor((x + y) / d) === iu && Math.floor((x - y) / d) === iv)
          cell.push([x, y])
      }
    }
    const members = cell.filter(([x, y]) => !isGrout(px, x, y))
    expect(members.length > 100).toBe(true)
    const sum = [0, 0, 0]
    // The source's own colours, gathered here: cellSource(…, 10) squares. The
    // tile's colour is the mean over its whole diamond, since the grout is
    // painted over its edges afterwards, so those pixels count too.
    for (const [x, y] of cell) {
      const bx = Math.floor(x / 10)
      const by = Math.floor(y / 10)
      sum[0]! += (bx * 61 + by * 23) % 256
      sum[1]! += (bx * 17 + by * 97) % 256
      sum[2]! += (bx * 43 + by * 13) % 256
    }
    const mean = sum.map(v => Math.round(v / cell.length)) as [number, number, number]
    for (const [x, y] of members) {
      // One flat colour per diamond, the mean of what the diamond covers.
      expect([x, y, rgbAt(px, x, y)]).toEqual([x, y, mean])
    }
  })
})

describe('halftone', () => {
  it('is a dot screen on the dialled pitch, periodic at angle 0', () => {
    const pitch = 14
    const px = flat(BASE, BASE, [128, 128, 128])
    applyFilter(px, { id: 'halftone', block: pitch, angle: 0 }, 0)
    for (let y = 0; y < 400; y += 5) {
      for (let x = 0; x < 400; x += 5)
        expect([x, y, rgbAt(px, x, y)]).toEqual([x, y, rgbAt(px, x + pitch, y)])
    }
    // The dot sits in the cell's middle: ink there, paper in the corner.
    expect(isInk(px, 7, 7)).toBe(true)
    expect(isInk(px, 0, 0)).toBe(false)
    expect(isInk(px, 13, 13)).toBe(false)
  })

  it('sizes the dot from the tone: the ink covers the photo\'s own darkness', () => {
    const pitch = 14
    const span = 70 * pitch
    for (const [luma, want] of [[230, 0.098], [180, 0.294], [150, 0.412]] as const) {
      const px = flat(BASE, BASE, [luma, luma, luma])
      applyFilter(px, { id: 'halftone', block: pitch, angle: 0 }, 0)
      expect([luma, Math.abs(inkFraction(px, span) - want) < 0.05]).toEqual([luma, true])
    }
    // All the way dark, the dots overlap and the screen goes nearly solid.
    const dark = flat(BASE, BASE, [10, 10, 10])
    applyFilter(dark, { id: 'halftone', block: pitch, angle: 0 }, 0)
    expect(inkFraction(dark, 68 * pitch) > 0.85).toBe(true)
  })

  it('turns the screen by the angle dial, and 45° is symmetric', () => {
    const size = 512
    const base = flat(size, size, [128, 128, 128])
    applyFilter(base, { id: 'halftone', block: 14, angle: 0 }, 0)
    const turned = flat(size, size, [128, 128, 128])
    applyFilter(turned, { id: 'halftone', block: 14, angle: 15 }, 0)
    expect(turned.data).not.toEqual(base.data)
    const diagonal = flat(size, size, [128, 128, 128])
    applyFilter(diagonal, { id: 'halftone', block: 14, angle: 45 }, 0)
    // At 45° the cell lattice is symmetric about the main diagonal.
    for (let y = 0; y < size; y += 4) {
      for (let x = 0; x < size; x += 4)
        expect([x, y, rgbAt(diagonal, x, y)]).toEqual([x, y, rgbAt(diagonal, y, x)])
    }
  })

  it('keeps the same number of dots per row at twice the render', () => {
    const pitch = 14
    const runsPerRow: number[] = []
    for (const [size, r] of [[1024, 1], [2048, 2]] as const) {
      const px = flat(size, size, [190, 190, 190])
      applyFilter(px, { id: 'halftone', block: pitch, angle: 0 }, 0)
      const p = stagePitch(pitch, r)
      // Along the row through the dot centres: one ink run per dot, each run
      // one dot's diameter (so it doubles with the pitch).
      const { runs, width } = inkRuns(px, Math.floor(p / 2), size)
      runsPerRow.push(runs)
      // One dot's diameter: 2 · (1/√π) · pitch · √coverage, and it doubles.
      const want = 2 * 0.5641895835477563 * p * Math.sqrt(1 - 190 / 255)
      expect([size, Math.abs(width - want) <= 1.5]).toEqual([size, true])
    }
    expect(runsPerRow[0]).toBe(runsPerRow[1]!)
  })

  it('prints one ink in mono and two in duotone', () => {
    // At the base size a dial of 20 is a 20-pixel cell, so cell centres are at
    // 10, 30, 50 … and that is where the dot's middle sits.
    const pitch = 20
    const mono = flat(BASE, BASE, [150, 150, 150])
    applyFilter(mono, { id: 'halftone', block: pitch, angle: 0, ink: 0 }, 0)
    const duo = flat(BASE, BASE, [150, 150, 150])
    applyFilter(duo, { id: 'halftone', block: pitch, angle: 0, ink: 1 }, 0)
    expect(duo.data).not.toEqual(mono.data)
    // The duotone's paper is warm and its dots are not the mono ink.
    const paper = rgbAt(duo, 0, 0)
    expect(paper[0]).toBeGreaterThan(paper[2]!)
    expect(rgbAt(duo, 10, 10)).not.toEqual(rgbAt(mono, 10, 10))
    // Down a luma ramp, the dot colour moves between the two inks.
    const ramp = lumaRamp(BASE, BASE)
    applyFilter(ramp, { id: 'halftone', block: pitch, angle: 0, ink: 1 }, 0)
    const inks = new Set<string>()
    for (let cy = 0; cy < BASE - pitch; cy += pitch) {
      for (let cx = 0; cx < BASE - pitch; cx += pitch) {
        const [r, g, b] = rgbAt(ramp, cx + pitch / 2, cy + pitch / 2)
        if (r < 200)
          inks.add(`${r},${g},${b}`)
      }
    }
    expect(inks.size).toBeGreaterThan(1)
  })
})

describe('ordered dither', () => {
  it('is the canonical 4×4 Bayer matrix, and its 8×8 doubling', () => {
    expect(BAYER4).toEqual([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5])
    expect(BAYER8).toHaveLength(64)
    for (const m of [BAYER4, BAYER8]) {
      expect(new Set(m).size).toBe(m.length)
      expect(Math.max(...m)).toBe(m.length - 1)
      expect(Math.min(...m)).toBe(0)
    }
    // Block (i, j) of the 4×4 gives 4·M4 + 0 / 2 / 3 / 1, the standard doubling.
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const quad = (y < 4 ? 0 : 1) * 2 + (x < 4 ? 0 : 1)
        const offset = [0, 2, 3, 1][quad]!
        expect([x, y, BAYER8[y * 8 + x]!]).toEqual([x, y, 4 * BAYER4[(y % 4) * 4 + (x % 4)]! + offset])
      }
    }
    expect([bayerSide(4), bayerSide(8)]).toEqual([4, 8])
  })

  it('prints the matrix itself: mid grey inks exactly the first eight ranks', () => {
    const px = flat(64, 64, [128, 128, 128])
    // Ink = 1 − 128/255 = 0.498, so a threshold (m + 0.5)/16 under it means m ≤ 7.
    applyFilter(px, { id: 'bayerMono', block: 1, matrix: 4 }, 0)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++)
        expect([x, y, isInk(px, x, y)]).toEqual([x, y, BAYER4[y * 4 + x]! <= 7])
    }
  })

  it('repeats the screen on a period of matrix × cell', () => {
    for (const cell of [1, 3]) {
      const px = flat(128, 128, [128, 128, 128])
      applyFilter(px, { id: 'bayerMono', block: cell, matrix: 4 }, 0)
      const period = 4 * cell
      for (let y = 0; y < 64; y += 3) {
        for (let x = 0; x < 64; x += 3)
          expect([cell, x, y, isInk(px, x, y)]).toEqual([cell, x, y, isInk(px, x + period, y)])
      }
    }
  })

  it('answers to the 8×8 matrix too', () => {
    const px = flat(64, 64, [128, 128, 128])
    applyFilter(px, { id: 'bayerMono', block: 1, matrix: 8 }, 0)
    const ink = 1 - 128 / 255
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++)
        expect([x, y, isInk(px, x, y)]).toEqual([x, y, (BAYER8[y * 8 + x]! + 0.5) / 64 < ink])
    }
  })

  it('prints two tones only, on paper-white', () => {
    const px = flat(64, 64)
    applyFilter(px, { id: 'bayerMono', block: 2 }, 0)
    const tones = new Set<string>()
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) tones.add(rgbAt(px, x, y).join(','))
    }
    expect(tones.size).toBe(2)
    // Paper-white and the ink; a 200-luma photo inks about a fifth of the frame.
    const [dark, light] = [...tones].map(t => Number(t.split(',')[0])).sort((a, b) => a - b) as [number, number]
    expect([dark < 64, light > 200]).toEqual([true, true])
    let ink = 0
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        if (isInk(px, x, y))
          ink++
      }
    }
    expect(Math.abs(ink / 4096 - (1 - 200 / 255)) < 0.06).toBe(true)
  })

  it('dithers colour between each channel\'s own two steps, so the hue survives', () => {
    const size = 64
    const src: [number, number, number] = [100, 150, 200]
    const px = flat(size, size, src)
    applyFilter(px, { id: 'bayerColor', block: 1, matrix: 4 }, 0)
    const seen = new Set<number>()
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        for (const c of rgbAt(px, x, y))
          seen.add(c)
      }
    }
    // Each channel only ever lands on the two 64-wide steps it sits between.
    expect([...seen].sort((a, b) => a - b)).toEqual([64, 128, 192, 255])
    // And the average still reads as the source's own colour.
    for (let c = 0; c < 3; c++) {
      let sum = 0
      for (let i = c; i < px.data.length; i += 4) sum += px.data[i]!
      expect([c, Math.abs(sum / (size * size) - src[c]!) < 3]).toEqual([c, true])
    }
  })
})

describe('error diffusion', () => {
  /** The screen tones' luma, the levels the recipe quantises between. */
  const INK_L = 0.2126 * SCREEN_INK[0] + 0.7152 * SCREEN_INK[1] + 0.0722 * SCREEN_INK[2]
  const PAPER_L = 0.2126 * SCREEN_PAPER[0] + 0.7152 * SCREEN_PAPER[1] + 0.0722 * SCREEN_PAPER[2]

  /**
   * The ink count the Floyd–Steinberg walk itself must produce on a 32×32 flat
   * field of luma 128, derived once from the algorithm's definition (plain
   * left-to-right scan, 7/16 / 3/16 / 5/16 / 1/16, edge contributions dropped)
   * and pinned here as a literal: this is the number that changes if the scan
   * goes serpentine, the kernel is reordered, or the weights move. Pinned per
   * resolution only; a cross-resolution golden would flake on last-ulp block
   * means.
   */
  const GOLDEN_INK_32 = 530

  it('diffuses a flat mid grey into the exact FS ink count, near half ink', () => {
    const px = flat(32, 32, [128, 128, 128])
    applyFilter(px, { id: 'ditherDiffuse', block: 1 }, 0)
    let ink = 0
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        if (isInk(px, x, y))
          ink++
      }
    }
    expect(ink).toBe(GOLDEN_INK_32)
    expect(Math.abs(ink / 1024 - 0.5) < 0.05).toBe(true)
    // Two tones only, the same screen pair the ordered dither prints.
    const tones = new Set<string>()
    for (let i = 0; i < px.data.length; i += 4) tones.add(`${px.data[i]},${px.data[i + 1]},${px.data[i + 2]}`)
    expect(tones.size).toBe(2)
  })

  it('opens the walk the kernel dictates: 128 sits under the levels midpoint', () => {
    // Hand-derived from the same walk as GOLDEN_INK_32: 128 sits under the
    // inks' luma midpoint, so (0,0) prints ink, its +7/16 residual tips (1,0)
    // to paper, whose -7/16 drops (2,0) back to ink, and row 1 opens in
    // paper. Serpentine or 1D-only spreading prints these differently.
    const px = flat(8, 8, [128, 128, 128])
    applyFilter(px, { id: 'ditherDiffuse', block: 1 }, 0)
    expect(isInk(px, 0, 0)).toBe(true)
    expect(isInk(px, 1, 0)).toBe(false)
    expect(isInk(px, 2, 0)).toBe(true)
    expect(isInk(px, 0, 1)).toBe(false)
  })

  it('saturates: near-black is all ink, near-white all paper', () => {
    // Below the ink's own luma every site quantises to ink and the (negative)
    // residual only deepens the neighbours; above the paper's, the mirror.
    const dark = flat(16, 16, [10, 10, 10])
    applyFilter(dark, { id: 'ditherDiffuse', block: 1 }, 0)
    expect(dark.data.every((v, i) => i % 4 === 3 || v === SCREEN_INK[i % 4])).toBe(true)
    const light = flat(16, 16, [250, 250, 250])
    applyFilter(light, { id: 'ditherDiffuse', block: 1 }, 0)
    expect(light.data.every((v, i) => i % 4 === 3 || v === SCREEN_PAPER[i % 4])).toBe(true)
  })

  it('is byte-identical for the same input, and ignores the seed', () => {
    for (const block of [1, 3]) {
      const a = flat(BASE, BASE, [128, 128, 128])
      const b = flat(BASE, BASE, [128, 128, 128])
      applyFilter(a, { id: 'ditherDiffuse', block }, 7)
      applyFilter(b, { id: 'ditherDiffuse', block }, 7)
      expect([block, a.data]).toEqual([block, b.data])
      const other = flat(BASE, BASE, [128, 128, 128])
      applyFilter(other, { id: 'ditherDiffuse', block }, 99)
      expect([block, other.data]).toEqual([block, a.data])
    }
  })

  it('keeps the tone: the ink share settles where luma is conserved', () => {
    for (const [luma, side, block] of [[64, 48, 1], [150, 48, 1], [220, 48, 1], [150, 256, 4], [150, 1536, 1]] as const) {
      const px = flat(side, side, [luma, luma, luma])
      applyFilter(px, { id: 'ditherDiffuse', block }, 0)
      // The walk spends ink until the two levels' weighted average is the
      // source's; the target is luma conservation, not 1 − luma/255. Edge
      // error is dropped, so a percent of slack absorbs margins. The block
      // dial and the non-integer r at 1536 are the export regime.
      const got = inkFraction(px, side)
      const want = (PAPER_L - luma) / (PAPER_L - INK_L)
      expect([luma, block, Math.abs(got - want) < 0.01]).toEqual([luma, block, true])
    }
  })

  it('is resolution independent: a 2× render is the 1× picture doubled', () => {
    // A flat source's cell means are count-exact (sum / n of one repeated
    // value), so the walk over the 2048 lattice must decide exactly what the
    // 1024 walk decided: the strongest form the contract has for a dither.
    const size = BASE
    const small = flat(size, size, [128, 128, 128])
    applyFilter(small, { id: 'ditherDiffuse', block: 2 }, 0)
    const big = flat(size * 2, size * 2, [128, 128, 128])
    applyFilter(big, { id: 'ditherDiffuse', block: 2 }, 0)
    let wrong = 0
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const si = (y * size + x) * 4
        const bi = (y * 2 * size * 2 + x * 2) * 4
        if (big.data[bi] !== small.data[si] || big.data[bi + 1] !== small.data[si + 1] || big.data[bi + 2] !== small.data[si + 2])
          wrong++
      }
    }
    expect(wrong).toBe(0)
  })

  it('prints every cell flat, coarser at a bigger dial', () => {
    const size = BASE
    for (const cell of [1, 4]) {
      const px = cellSource(size, size, 16)
      applyFilter(px, { id: 'ditherDiffuse', block: cell }, 0)
      // Every pixel carries its block origin's tone.
      let wrong = 0
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (isInk(px, x, y) !== isInk(px, x - (x % cell), y - (y % cell)))
            wrong++
        }
      }
      expect([cell, wrong]).toEqual([cell, 0])
    }
    // The coarser dial is a different picture (not a no-op dial).
    const fine = cellSource(size, size, 16)
    applyFilter(fine, { id: 'ditherDiffuse', block: 1 }, 0)
    const coarse = cellSource(size, size, 16)
    applyFilter(coarse, { id: 'ditherDiffuse', block: 4 }, 0)
    expect(fine.data).not.toEqual(coarse.data)
  })

  it('spreads, not screens: runs of one and two, and the wobble breaks period 4', () => {
    // The diffusion's signature at 128 luma: ink arrives in runs of one and
    // two, wobbling row by row. An ordered screen at cell 1 cannot do this:
    // Bayer4 would hold a fixed period 4 in every row, and no row could print
    // two inks together at this tone.
    const px = flat(64, 64, [128, 128, 128])
    applyFilter(px, { id: 'ditherDiffuse', block: 1 }, 0)
    const rows = Array.from({ length: 64 }, (_, y) => Array.from({ length: 64 }, (_, x) => isInk(px, x, y)))
    let maxRun = 0
    for (const row of rows) {
      let run = 0
      let prev: boolean | null = null
      for (const ink of row) {
        if (ink === prev) {
          run++
        }
        else {
          maxRun = Math.max(maxRun, run)
          run = 1
          prev = ink
        }
      }
      maxRun = Math.max(maxRun, run)
    }
    expect(maxRun).toBe(2)
    // Some top rows alternate (a fresh walk starts in a strict two-cycle); the
    // wobble guarantees the grid as a whole is not a period-4 screen.
    const periodicRows = rows.filter(row => row.every((ink, x) => ink === row[(x + 4) % 64])).length
    expect(periodicRows < 64).toBe(true)
  })
})

describe('the pixel family in the pipeline', () => {
  const PIXEL_IDS: FilterId[] = FILTER_IDS.filter(id => FILTER_PARAMS[id].length > 0)

  it('is exactly the seven filters that take parameters', () => {
    expect(PIXEL_IDS).toEqual(['mosaic', 'tessera', 'diamond', 'halftone', 'bayerMono', 'bayerColor', 'ditherDiffuse'])
  })

  it('forces every pixel opaque and keeps the dimensions', () => {
    for (const id of PIXEL_IDS) {
      const px = flat(90, 60)
      for (let i = 3; i < px.data.length; i += 4)
        px.data[i] = 0
      applyFilter(px, id, 11)
      let minAlpha = 255
      for (let i = 3; i < px.data.length; i += 4)
        minAlpha = Math.min(minAlpha, px.data[i]!)
      expect([id, px.width, px.height, minAlpha]).toEqual([id, 90, 60, 255])
    }
  })

  it('is byte-identical for the same setting, and different for a turned dial', () => {
    for (const id of PIXEL_IDS) {
      const base = defaultFilter(id)
      const a = flat(320, 320, [120, 90, 60])
      const b = flat(320, 320, [120, 90, 60])
      applyFilter(a, base, 3)
      applyFilter(b, base, 3)
      expect([id, a.data]).toEqual([id, b.data])
      const turned: FilterSpec = { ...base, block: (base.block ?? 16) + 5 }
      const c = flat(320, 320, [120, 90, 60])
      applyFilter(c, turned, 3)
      expect([id, a.data === c.data]).toEqual([id, false])
    }
  })

  it('runs a 1024² frame well inside the 80ms budget', () => {
    for (const id of PIXEL_IDS) {
      let best = Number.POSITIVE_INFINITY
      for (let run = 0; run < 5; run++) {
        const px = flat(1024, 1024, [90, 120, 160])
        const t0 = performance.now()
        applyFilter(px, id, 7)
        best = Math.min(best, performance.now() - t0)
      }
      expect([id, best < 80]).toEqual([id, true])
    }
  })
})
