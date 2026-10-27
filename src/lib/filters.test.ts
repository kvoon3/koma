import type { FilterPixels } from './filters'
/// <reference types="bun" />
import { describe, expect, it } from 'bun:test'
import { applyFilter, FILTER_BASE, FILTER_IDS, filterScale, filterSeed, isFilterId } from './filters'

/**
 * A synthetic photo-ish frame: gradients on both axes, a saturated patch, a
 * near-black patch and a little noise, so every recipe has highlights,
 * midtones and shadows to chew on. Deterministic, no DOM.
 */
function makePixels(w: number, h: number): FilterPixels {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const u = x / w
      const v = y / h
      data[i] = 40 + 200 * u
      data[i + 1] = 30 + 200 * v
      data[i + 2] = 190 - 150 * u * v
      data[i + 3] = 255
    }
  }
  // A saturated square and a shadow square, to exercise the separations.
  for (let y = Math.floor(h * 0.2); y < Math.floor(h * 0.45); y++) {
    for (let x = Math.floor(w * 0.6); x < Math.floor(w * 0.85); x++) {
      const i = (y * w + x) * 4
      data[i] = 220
      data[i + 1] = 60
      data[i + 2] = 40
    }
  }
  for (let y = Math.floor(h * 0.65); y < Math.floor(h * 0.9); y++) {
    for (let x = Math.floor(w * 0.1); x < Math.floor(w * 0.35); x++) {
      const i = (y * w + x) * 4
      data[i] = 12
      data[i + 1] = 14
      data[i + 2] = 18
    }
  }
  return { data, width: w, height: h }
}

function run(w: number, h: number, id: (typeof FILTER_IDS)[number], seed: number) {
  const px = makePixels(w, h)
  applyFilter(px, id, seed)
  return px
}

/** FNV-1a over the bytes: the equality check the byte-for-byte assertions use. */
function digest(data: Uint8ClampedArray): number {
  let h = 0x811C9DC5
  for (let i = 0; i < data.length; i++) {
    h ^= data[i]!
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Recipes whose detail is a screen rather than a continuous field: a 2× render
 * lays the same screen out at twice the pitch, so it is the same texture but not
 * the same pixels after a downsample.
 */
const BINARY_IDS = new Set<(typeof FILTER_IDS)[number]>(['bitgrain', 'halftone', 'bayerMono', 'bayerColor', 'ditherDiffuse'])

/**
 * The pixel family draws geometry, not a noise field: a block average, a tiled
 * mean, a dot screen, an ordered matrix. None of them has anything to vary per
 * photo, so they are seed-invariant on purpose (the mosaic's speckle is off at
 * its default, and a seed would only drive that).
 */
const PIXEL_IDS = new Set<(typeof FILTER_IDS)[number]>(['mosaic', 'tessera', 'diamond', 'halftone', 'bayerMono', 'bayerColor', 'ditherDiffuse'])

describe('filterScale', () => {
  it('is 1 at the 1024 base and doubles with the long side', () => {
    expect(FILTER_BASE).toBe(1024)
    expect(filterScale(1024, 768)).toBe(1)
    expect(filterScale(768, 2048)).toBe(2)
    expect(filterScale(512, 512)).toBe(0.5)
  })
})

describe('filterSeed', () => {
  it('is stable, unsigned and different per photo and per filter', () => {
    const a = filterSeed('photo-a', 'grain')
    expect(a).toBe(filterSeed('photo-a', 'grain'))
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBe(Math.floor(a))
    expect(a).not.toBe(filterSeed('photo-b', 'grain'))
    expect(a).not.toBe(filterSeed('photo-a', 'print'))
  })
})

describe('isFilterId', () => {
  it('accepts the fifteen ids and nothing else', () => {
    expect(FILTER_IDS).toHaveLength(15)
    for (const id of FILTER_IDS)
      expect(isFilterId(id)).toBe(true)
    for (const bad of ['', 'none', 'grain ', 'Grain', null, undefined, 3, {}])
      expect(isFilterId(bad)).toBe(false)
  })
})

describe('applyFilter', () => {
  it('is byte-identical for the same input and seed', () => {
    for (const id of FILTER_IDS) {
      const seed = filterSeed('photo-a', id)
      const a = run(96, 128, id, seed)
      const b = run(96, 128, id, seed)
      expect([id, digest(a.data)]).toEqual([id, digest(b.data)])
      expect(a.data).toEqual(b.data)
    }
  })

  it('gives a different field for a different seed, and none where it has no field', () => {
    for (const id of FILTER_IDS) {
      const a = run(96, 96, id, 1)
      const b = run(96, 96, id, 2)
      expect([id, digest(a.data) === digest(b.data)]).toEqual([id, PIXEL_IDS.has(id)])
    }
  })

  it('is byte-identical across seeds for the whole pixel family', () => {
    for (const id of PIXEL_IDS) {
      expect([id, digest(run(96, 96, id, 1).data) === digest(run(96, 96, id, 7).data)]).toEqual([id, true])
    }
  })

  it('produces fifteen distinct results from one input', () => {
    // 128px: at 64 the pixel family's stage-pixel pitches round to one pixel,
    // which collapses the tiled recipes back onto the photo they were handed.
    const seeds = new Map(FILTER_IDS.map(id => [id, 0x2F1B3C5D]))
    const digests = FILTER_IDS.map(id => digest(run(128, 128, id, seeds.get(id)!).data))
    expect(new Set(digests).size).toBe(FILTER_IDS.length)
    // Not just a couple of bytes apart: every pair differs in many pixels.
    const outs = FILTER_IDS.map(id => run(128, 128, id, 0x2F1B3C5D).data)
    for (let i = 0; i < outs.length; i++) {
      for (let j = i + 1; j < outs.length; j++) {
        let diff = 0
        for (let k = 0; k < outs[i]!.length; k += 4) {
          if (outs[i]![k] !== outs[j]![k] || outs[i]![k + 1] !== outs[j]![k + 1] || outs[i]![k + 2] !== outs[j]![k + 2])
            diff++
        }
        expect([FILTER_IDS[i], FILTER_IDS[j], diff > 64]).toEqual([FILTER_IDS[i], FILTER_IDS[j], true])
      }
    }
  })

  it('forces every pixel opaque and keeps the dimensions', () => {
    for (const id of FILTER_IDS) {
      const px = makePixels(80, 40)
      // A transparent input on purpose: these filters replace the pixels.
      for (let i = 3; i < px.data.length; i += 4)
        px.data[i] = i % 32
      applyFilter(px, id, 11)
      expect([id, px.width, px.height, px.data.length]).toEqual([id, 80, 40, 80 * 40 * 4])
      let minAlpha = 255
      for (let i = 3; i < px.data.length; i += 4)
        minAlpha = Math.min(minAlpha, px.data[i]!)
      expect([id, minAlpha]).toEqual([id, 255])
    }
  })

  it('is resolution independent: a 2× render carries the same texture', () => {
    // A 16×16 coarse luma field must match for all fourteen filters. The
    // continuous ones must also match pixel for pixel after a 2× downsample;
    // the screened ones cannot (their detail is meant to be rearranged at 2×).
    const grid = 16
    const coarse = (px: FilterPixels) => {
      const out = new Float64Array(grid * grid)
      const step = px.width / grid
      for (let gy = 0; gy < grid; gy++) {
        for (let gx = 0; gx < grid; gx++) {
          let sum = 0
          for (let y = gy * step; y < (gy + 1) * step; y++) {
            for (let x = gx * step; x < (gx + 1) * step; x++) {
              const i = (y * px.width + x) * 4
              sum += 0.2126 * px.data[i]! + 0.7152 * px.data[i + 1]! + 0.0722 * px.data[i + 2]!
            }
          }
          out[gy * grid + gx] = sum / (step * step)
        }
      }
      return out
    }
    for (const id of FILTER_IDS) {
      const seed = filterSeed('photo-a', id)
      const small = run(1024, 1024, id, seed)
      const big = run(2048, 2048, id, seed)
      const a = coarse(small)
      const b = coarse(big)
      let fieldDiff = 0
      for (let i = 0; i < a.length; i++)
        fieldDiff += Math.abs(a[i]! - b[i]!)
      expect([id, fieldDiff / a.length < 3]).toEqual([id, true])
      if (BINARY_IDS.has(id))
        continue
      // Box-average the 2× detail the way a browser's downscale would.
      let sum = 0
      let n = 0
      for (let y = 0; y < 1024; y++) {
        for (let x = 0; x < 1024; x++) {
          const si = (y * 1024 + x) * 4
          for (let c = 0; c < 3; c++) {
            const s2 = (y * 2 * 2048 + x * 2) * 4 + c
            const avg = (big.data[s2]! + big.data[s2 + 4]! + big.data[s2 + 2048 * 4]! + big.data[s2 + 2048 * 4 + 4]!) / 4
            sum += Math.abs(avg - small.data[si + c]!)
            n++
          }
        }
      }
      // Under 6 of 255 on average: the same texture, not an unrelated field.
      expect([id, sum / n < 6]).toEqual([id, true])
    }
    // Fourteen 2048² renders plus a 1024² box average. It takes 3.3s here and
    // 4.1-5.0s on a CI runner, so the 5s default sits inside the spread.
  }, 30_000)

  it('applies to a 1024×1024 source well inside the 150ms budget', () => {
    const px = makePixels(1024, 1024)
    for (const id of FILTER_IDS) {
      const seed = filterSeed('photo-a', id)
      // Best of three: a single-shot timing flakes on a busy machine or CI
      // runner (measured 767ms once under load, vs 6-31ms idle). The floor of
      // repeated runs is the honest cost of the recipe.
      let best = Number.POSITIVE_INFINITY
      for (let run = 0; run < 3; run++) {
        const work = makePixels(1024, 1024)
        const t0 = performance.now()
        applyFilter(work, id, seed)
        best = Math.min(best, performance.now() - t0)
      }
      // Measured on this machine: 6-31ms per filter (see the lane's report).
      expect([id, best < 150]).toEqual([id, true])
    }
    // Keep the fixture alive across the timings (no dead-code elision).
    expect(px.data.length).toBe(1024 * 1024 * 4)
  })
})
