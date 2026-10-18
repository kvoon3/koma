/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import {
  ALPHA_SEED_THRESHOLD,
  borderCoverage,
  brushRadius,
  closedLasso,
  composedAlpha,
  composeSilhouette,
  MASK_UNDO_CAP,
  MAX_OUTLINE_RADIUS,
  MAX_TOOTH_DEPTH,
  MAX_TOOTH_SPACING,
  MIN_TOOTH_DEPTH,
  MIN_TOOTH_SPACING,
  outlineRadius,
  parseHexColor,
  perforationFromSliders,
  perforationPunches,
  perforationToTexture,
  pushCapped,
  silhouetteCoverage,
  silhouettePadding,
  squaredDistanceTransform,
  strokeDiscs,
} from './stickerFX'

/** A blank alpha buffer with a filled rectangle painted into it. */
function rectangle(size: number, x0: number, y0: number, x1: number, y1: number): Float32Array {
  const alpha = new Float32Array(size * size)
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1)
      alpha[y * size + x] = 1
  }
  return alpha
}

/** Centres of the true runs of a boolean scan. */
function runCenters(scan: boolean[]): number[] {
  const centers: number[] = []
  let start = -1
  for (let i = 0; i <= scan.length; i += 1) {
    const on = i < scan.length && scan[i]
    if (on && start === -1)
      start = i
    if (!on && start !== -1) {
      centers.push((start + i - 1) / 2)
      start = -1
    }
  }
  return centers
}

const deltas = (values: number[]) => values.slice(1).map((v, i) => v - values[i]!)

describe('squaredDistanceTransform', () => {
  test('a single pixel gives the exact d² = x² + y² field', () => {
    const size = 11
    const alpha = new Float32Array(size * size)
    alpha[0] = 1
    const dist = squaredDistanceTransform(alpha, size, size)
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1)
        expect(dist[y * size + x]).toBe(x * x + y * y)
    }
  })

  test('the d² rings 1, 2, 4 and 5 land where they should', () => {
    const size = 9
    const alpha = new Float32Array(size * size)
    alpha[0] = 1
    const at = (x: number, y: number) => squaredDistanceTransform(alpha, size, size)[y * size + x]
    expect(at(1, 0)).toBe(1)
    expect(at(0, 1)).toBe(1)
    expect(at(1, 1)).toBe(2)
    expect(at(2, 0)).toBe(4)
    expect(at(0, 2)).toBe(4)
    expect(at(2, 1)).toBe(5)
    expect(at(1, 2)).toBe(5)
    expect(at(3, 3)).toBe(18)
  })

  test('a filled rectangle: zero inside, the exact offset outside', () => {
    // Filled [10,20) × [10,20) in a 30×30 frame.
    const size = 30
    const alpha = rectangle(size, 10, 10, 20, 20)
    const dist = squaredDistanceTransform(alpha, size, size)
    const at = (x: number, y: number) => dist[y * size + x]
    // Every artwork pixel is its own seed.
    expect(at(15, 15)).toBe(0)
    expect(at(10, 15)).toBe(0)
    expect(at(19, 19)).toBe(0)
    // Outside: the squared distance to the nearest artwork pixel.
    expect(at(9, 15)).toBe(1)
    expect(at(8, 15)).toBe(4)
    expect(at(5, 15)).toBe(25)
    expect(at(15, 9)).toBe(1)
    // Off the corner diagonally: d² = 1 + 1.
    expect(at(9, 9)).toBe(2)
    expect(at(7, 8)).toBe(9 + 4)
  })

  test('a hole in the artwork gets the interior distances right', () => {
    // A filled 20×20 block with a 6×6 transparent hole in its middle.
    const size = 30
    const alpha = rectangle(size, 5, 5, 25, 25)
    for (let y = 12; y < 18; y += 1) {
      for (let x = 12; x < 18; x += 1)
        alpha[y * size + x] = 0
    }
    const dist = squaredDistanceTransform(alpha, size, size)
    const at = (x: number, y: number) => dist[y * size + x]
    // Centre of the hole: 3 px to the hole's right wall (x = 18).
    expect(at(15, 15)).toBe(9)
    // One pixel in from the hole's corner.
    expect(at(12, 12)).toBe(1)
    // The hole's walls keep the block's own pixels at zero.
    expect(at(11, 15)).toBe(0)
    expect(at(18, 15)).toBe(0)
  })

  test('the threshold decides what counts as artwork', () => {
    const alpha = new Float32Array([ALPHA_SEED_THRESHOLD, 0, 0])
    const dist = squaredDistanceTransform(alpha, 3, 1)
    // The first pixel is (just) a seed: the field is a plain row of distances.
    expect(Array.from(dist)).toEqual([0, 1, 4])
    const below = squaredDistanceTransform(new Float32Array([0.05, 0, 0]), 3, 1)
    expect(below.every(v => v === Number.POSITIVE_INFINITY)).toBe(true)
  })

  test('deterministic: the same buffer twice is bit-identical', () => {
    const alpha = rectangle(24, 4, 4, 18, 15)
    const first = squaredDistanceTransform(alpha, 24, 24)
    const second = squaredDistanceTransform(alpha, 24, 24)
    expect(Array.from(first)).toEqual(Array.from(second))
  })
})

describe('border coverage', () => {
  const radius = 6
  const alpha = rectangle(40, 15, 15, 25, 25)
  const dist = squaredDistanceTransform(alpha, 40, 40)
  const band = borderCoverage(dist, radius)

  test('full inside, ½ on the outer edge, zero past it', () => {
    const at = (x: number, y: number) => band[y * 40 + x]
    // Inside the artwork: the band is fully opaque (it never thins the art).
    expect(at(20, 20)).toBe(1)
    // The artwork's left edge is x = 15, so the band's outer edge is x = 9.
    expect(at(10, 20)).toBe(1)
    expect(at(9, 20)).toBeCloseTo(0.5, 6)
    expect(at(8, 20)).toBe(0)
  })

  test('monotone in distance: the band only grows toward the artwork', () => {
    for (let x = 1; x < 20; x += 1)
      expect(band[20 * 40 + x]).toBeGreaterThanOrEqual(band[20 * 40 + x - 1]!)
  })

  test('the silhouette keeps the artwork and adds the band (under, not over)', () => {
    const a = new Float32Array(9).fill(0)
    a[4] = 1
    const d = squaredDistanceTransform(a, 3, 3)
    const silhouette = silhouetteCoverage(a, d, 1)
    expect(silhouette[4]).toBe(1)
    // Radius 1 + ½ − √1 = ½ at the four neighbours.
    expect(silhouette[1]).toBeCloseTo(0.5, 6)
    // The corner is √2 away: 1½ − √2 of coverage, no more.
    expect(silhouette[0]).toBeCloseTo(1.5 - Math.SQRT2, 6)
  })

  test('a concave silhouette gets a border at the same width, not a bounding box', () => {
    // An L: the notch at (0..10, 0..10) is empty inside the 20×20 block.
    const alpha = rectangle(30, 5, 5, 25, 25)
    for (let y = 5; y < 15; y += 1) {
      for (let x = 5; x < 15; x += 1)
        alpha[y * 30 + x] = 0
    }
    const result = composeSilhouette(alpha, 30, 30, { radius: 4 })
    // Deep in the notch the artwork is 7 px away: outside a 4 px border, and
    // well inside the block's bounding box, where a box border would have
    // painted solid white.
    expect(result.coverage[8 * 30 + 8]).toBe(0)
    // One pixel off the notch's right wall (x = 15) the border is full.
    expect(result.coverage[12 * 30 + 14]).toBeGreaterThan(0.9)
  })

  test('the slider maps to a radius by the app factor, clamped', () => {
    expect(outlineRadius(0)).toBe(0)
    expect(outlineRadius(18)).toBeCloseTo(42.3, 6)
    expect(outlineRadius(40)).toBeCloseTo(94, 6)
    expect(outlineRadius(1000)).toBe(MAX_OUTLINE_RADIUS)
    expect(outlineRadius(Number.NaN)).toBe(0)
  })
})

describe('stamp perforation', () => {
  const size = 120
  // Artwork: a 60 × 60 square, so its straight top edge is long enough to
  // carry several notches at the spacings under test.
  const alpha = rectangle(size, 30, 20, 90, 80)
  const radius = 10
  const dist = squaredDistanceTransform(alpha, size, size)

  test('notches are periodic along a straight edge, with the spacing asked for', () => {
    const spacing = 12
    const { centers } = perforationPunches(dist, size, size, radius, { size: 6, spacing })
    // Only the top rim's straight run (x 20..79 at d ≈ radius).
    const rim = centers.filter(c => c.y === 10)
    const xs = rim.map(c => c.x).sort((a, b) => a - b)
    expect(xs.length).toBeGreaterThan(3)
    for (const delta of deltas(xs))
      expect(Math.abs(delta - spacing)).toBeLessThanOrEqual(1)
  })

  test('doubling the spacing halves the notches on that edge', () => {
    const count = (spacing: number) =>
      perforationPunches(dist, size, size, radius, { size: 6, spacing })
        .centers
        .filter(c => c.y === 10 && c.x >= 20 && c.x <= 100)
        .length
    const dense = count(12)
    const sparse = count(24)
    expect(sparse).toBeGreaterThan(1)
    expect(Math.abs(dense / sparse - 2)).toBeLessThanOrEqual(0.5)
  })

  test('the punched coverage reads as a period along the edge', () => {
    // The whole sticker (border + art) with notches cut out, as the canvas paints it.
    const result = composeSilhouette(alpha, size, size, { radius, perforation: { size: 8, spacing: 12 } })
    const composed = composedAlpha(result)
    // Row y = 11 sits inside the border (coverage 1 → punched to 0 in a notch).
    const punched = Array.from({ length: size }, (_, x) => composed[11 * size + x]! < 0.5)
    const centers = runCenters(punched).filter(x => x >= 30 && x <= 100)
    expect(centers.length).toBeGreaterThan(3)
    for (const delta of deltas(centers))
      expect(Math.abs(delta - 12)).toBeLessThanOrEqual(1)
    // Between two notches it is the opaque border as usual.
    expect(composed[11 * size + 33]!).toBeGreaterThan(0.9)
  })

  test('without perforation the punch buffer is empty and the border is intact', () => {
    const result = composeSilhouette(alpha, size, size, { radius })
    expect(Array.from(result.punch).every(v => v === 0)).toBe(true)
    expect(Array.from(composedAlpha(result))).toEqual(Array.from(result.coverage))
  })

  test('a notch smaller than the border stays in the border; a big one bites the art', () => {
    const small = composedAlpha(composeSilhouette(alpha, size, size, { radius, perforation: { size: 6, spacing: 24 } }))
    // The artwork's own pixels survive a small notch (art starts at y = 20).
    let artEaten = 0
    for (let y = 20; y < 80; y += 1) {
      for (let x = 30; x < 90; x += 1) {
        if (small[y * size + x]! < 0.5)
          artEaten += 1
      }
    }
    expect(artEaten).toBe(0)
    // A 30 px notch (15 px radius) reaches 5 px past the 10 px border.
    const big = composedAlpha(composeSilhouette(alpha, size, size, { radius, perforation: { size: 30, spacing: 24 } }))
    expect(big[20 * size + 30]!).toBeLessThan(0.5)
  })

  test('zero size is a no-op rather than a divide-by-zero', () => {
    const { punch, centers } = perforationPunches(dist, size, size, radius, { size: 0, spacing: 0 })
    expect(centers).toEqual([])
    expect(Array.from(punch).every(v => v === 0)).toBe(true)
  })

  test('deterministic: two runs pick the same centres and punches', () => {
    const a = composeSilhouette(alpha, size, size, { radius, perforation: { size: 8, spacing: 16 } })
    const b = composeSilhouette(alpha, size, size, { radius, perforation: { size: 8, spacing: 16 } })
    expect(a.centers).toEqual(b.centers)
    expect(Array.from(a.punch)).toEqual(Array.from(b.punch))
  })
})

describe('canvas padding', () => {
  test('reserves at least the stroke and the punch', () => {
    expect(silhouettePadding(0)).toBe(2)
    expect(silhouettePadding(42)).toBeGreaterThanOrEqual(43)
    // Half a punch disc: the other half opens into air.
    expect(silhouettePadding(10, { size: 30, spacing: 12 })).toBeGreaterThanOrEqual(16)
    expect(silhouettePadding(42, { size: 30, spacing: 12 })).toBeGreaterThanOrEqual(43)
  })

  test('padding tracks the widest thing painted, holes included', () => {
    // A notch's outward half is punched air, so only its radius (half the
    // disc) has to fit inside the frame; the border gets its own air.
    expect(silhouettePadding(42, { size: 96, spacing: 12 })).toBe(50)
    expect(silhouettePadding(42, { size: 320, spacing: 12 })).toBe(162)
    expect(silhouettePadding(94)).toBe(96)
  })
})

describe('parseHexColor', () => {
  test('both hex lengths and a malformed pick', () => {
    expect(parseHexColor('#ffffff')).toEqual([255, 255, 255])
    expect(parseHexColor('#000000')).toEqual([0, 0, 0])
    expect(parseHexColor('#f80')).toEqual([255, 136, 0])
    expect(parseHexColor('  #1a2b3c ')).toEqual([26, 43, 60])
    expect(parseHexColor('not a color')).toEqual([255, 255, 255])
  })
})

describe('perforation sliders (stage pixels)', () => {
  test('the sliders read as stage pixels: depth and period pass through', () => {
    expect(perforationFromSliders(5, 9)).toEqual({ depth: 5, spacing: 9 })
    expect(perforationFromSliders(1.5, 22)).toEqual({ depth: 1.5, spacing: 22 })
  })

  test('clamped to the ranges the stage can carry, nonsense falls to the floor', () => {
    expect(perforationFromSliders(1000, 1000)).toEqual({ depth: MAX_TOOTH_DEPTH, spacing: MAX_TOOTH_SPACING })
    expect(perforationFromSliders(0, 0)).toEqual({ depth: MIN_TOOTH_DEPTH, spacing: MIN_TOOTH_SPACING })
    expect(perforationFromSliders(Number.NaN, Number.NaN)).toEqual({ depth: MIN_TOOTH_DEPTH, spacing: MIN_TOOTH_SPACING })
  })

  test('the stage → texture scale is the whole mapping: x6 makes a 30px bite', () => {
    // A disc's radius is the bite depth, so the disc is two depths across.
    expect(perforationToTexture({ depth: 5, spacing: 9 }, 6)).toEqual({ size: 60, spacing: 54 })
    expect(perforationToTexture({ depth: 5, spacing: 9 }, 1)).toEqual({ size: 10, spacing: 9 })
    // No reachable scale, no scaling.
    expect(perforationToTexture({ depth: 5, spacing: 9 }, 0)).toEqual({ size: 10, spacing: 9 })
    expect(perforationToTexture({ depth: 5, spacing: 9 }, Number.NaN)).toEqual({ size: 10, spacing: 9 })
    // The texture cap and the floor still hold at a silly scale.
    expect(perforationToTexture({ depth: 16, spacing: 9 }, 100).size).toBe(320)
    expect(perforationToTexture({ depth: 5, spacing: 3 }, 0.5).spacing).toBe(4)
  })

  test('a 4px design bites 4px per unit of scale, measured on the punched field', () => {
    // Rim straight run on the top edge of a 60x60 block, 10px border.
    const size = 120
    const alpha = rectangle(size, 30, 20, 90, 80)
    const radius = 10
    const dist = squaredDistanceTransform(alpha, size, size)
    const scale = 6
    const design = { depth: 4, spacing: 4 }
    const texture = perforationToTexture(design, scale)
    const { punch, centers } = perforationPunches(dist, size, size, radius, texture)
    // One notch on the top rim, at y = 10 (the art starts at y = 20).
    const notch = centers.filter(c => c.y === 10).sort((a, b) => a.x - b.x)[1]
    expect(notch).toBeDefined()
    // Depth = how far the punched disc reaches *down* from the rim, which is
    // the disc's radius: depth × scale texture pixels, i.e. 4 stage pixels.
    let depth = 0
    for (let y = notch.y; y < notch.y + 60; y += 1) {
      if (punch[y * size + notch.x] <= 0.5)
        break
      depth = y - notch.y + 1
    }
    expect(depth).toBe(texture.size / 2)
    expect(depth / scale).toBeCloseTo(design.depth, 6)
    // And the period along the rim is the design spacing × scale.
    const xs = centers.filter(c => c.y === 10).map(c => c.x).sort((a, b) => a - b)
    for (const delta of deltas(xs))
      expect(Math.abs(delta - texture.spacing)).toBeLessThanOrEqual(1)
    expect(texture.spacing / scale).toBeCloseTo(design.spacing, 6)
  })
})

describe('manual mask arithmetic', () => {
  test('one disc per point, so a single tap paints', () => {
    const discs = strokeDiscs([{ x: 10, y: 20 }], 12)
    expect(discs).toEqual([{ x: 10, y: 20, r: 6 }])
    const line = strokeDiscs([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 40 }], 4)
    expect(line.map(d => [d.x, d.y])).toEqual([[0, 0], [30, 0], [30, 40]])
    expect(line.every(d => d.r === 2)).toBe(true)
    expect(strokeDiscs([{ x: 0, y: 0 }], 0)).toEqual([])
  })

  test('the brush radius scales with the mask, clamped at 1–100%', () => {
    expect(brushRadius(10, 1000)).toBe(100)
    expect(brushRadius(0, 1000)).toBe(0.5)
    expect(brushRadius(100, 1000)).toBe(1000)
    expect(brushRadius(250, 1000)).toBe(1000)
    expect(brushRadius(Number.NaN, 1000)).toBe(0.5)
    // Monotone in the slider, which is what the drag tests expect of it.
    let previous = 0
    for (const pct of [1, 5, 20, 60, 100]) {
      const r = brushRadius(pct, 800)
      expect(r).toBeGreaterThan(previous)
      previous = r
    }
  })

  test('a lasso needs three points and some area to fill', () => {
    expect(closedLasso([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBeNull()
    // A straight drag encloses nothing.
    expect(closedLasso([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }])).toBeNull()
    const triangle = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }]
    expect(closedLasso(triangle)).toEqual(triangle)
    expect(closedLasso(triangle, 4)).toBeNull()
  })

  test('the undo stack keeps the newest 20 snapshots', () => {
    let stack: number[] = []
    for (let i = 0; i < 25; i += 1)
      stack = pushCapped(stack, i)
    expect(stack.length).toBe(MASK_UNDO_CAP)
    expect(stack[0]).toBe(5)
    expect(stack.at(-1)).toBe(24)
    // A cap of its own is honoured, and nothing is dropped below it.
    expect(pushCapped([1, 2], 3, 2)).toEqual([2, 3])
    expect(pushCapped([1], 2, 8)).toEqual([1, 2])
  })
})
