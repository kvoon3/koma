import {
  borderCoverage,
  composedAlpha,
  composeSilhouette,
  perforationPunches,
  silhouetteCoverage,
  squaredDistanceTransform,
} from '../../src/lib/stickerFX.ts'

const DISTANCE_INFINITY = 1e20
const ALPHA_SEED_THRESHOLD = 0.1
const EDGE_SOFTNESS = 0.5
const MAX_OUTLINE_RADIUS = 112
const MIN_PERFORATION_SPACING = 4
const MAX_PERFORATION_SIZE = 320

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function oldTransform1D(f: Float64Array, out: Float64Array, parabola: Int32Array, boundary: Float64Array, length: number) {
  let k = 0
  parabola[0] = 0
  boundary[0] = -DISTANCE_INFINITY
  boundary[1] = DISTANCE_INFINITY
  for (let q = 1; q < length; q += 1) {
    let s = (f[q] + q * q - (f[parabola[k]] + parabola[k] * parabola[k])) / (2 * q - 2 * parabola[k])
    while (s <= boundary[k]) {
      k -= 1
      s = (f[q] + q * q - (f[parabola[k]] + parabola[k] * parabola[k])) / (2 * q - 2 * parabola[k])
    }
    k += 1
    parabola[k] = q
    boundary[k] = s
    boundary[k + 1] = DISTANCE_INFINITY
  }
  k = 0
  for (let q = 0; q < length; q += 1) {
    while (boundary[k + 1] < q)
      k += 1
    const delta = q - parabola[k]
    out[q] = delta * delta + f[parabola[k]]
  }
}

function oldSquaredDistanceTransform(alpha: Float32Array, width: number, height: number, threshold = ALPHA_SEED_THRESHOLD): Float32Array {
  const columns = new Float64Array(width * height)
  const line = new Float64Array(Math.max(width, height))
  const result = new Float64Array(Math.max(width, height))
  const parabola = new Int32Array(Math.max(width, height))
  const boundary = new Float64Array(Math.max(width, height) + 1)
  const out = new Float32Array(width * height)
  let seeded = false
  for (let y = 0; y < height; y += 1) {
    const row = y * width
    for (let x = 0; x < width; x += 1) {
      const solid = alpha[row + x] >= threshold
      seeded ||= solid
      line[x] = solid ? 0 : DISTANCE_INFINITY
    }
    oldTransform1D(line, result, parabola, boundary, width)
    for (let x = 0; x < width; x += 1)
      columns[x * height + y] = result[x]
  }
  for (let x = 0; x < width; x += 1) {
    const column = x * height
    oldTransform1D(columns.subarray(column, column + height), result, parabola, boundary, height)
    for (let y = 0; y < height; y += 1)
      out[y * width + x] = result[y]
  }
  if (!seeded)
    out.fill(Number.POSITIVE_INFINITY)
  return out
}

function oldBorderCoverage(distSq: Float32Array, radius: number): Float32Array {
  const out = new Float32Array(distSq.length)
  const r = Math.max(0, radius)
  for (let i = 0; i < distSq.length; i += 1)
    out[i] = clamp01(r + EDGE_SOFTNESS - Math.sqrt(distSq[i]))
  return out
}

function oldSilhouetteCoverage(alpha: Float32Array, distSq: Float32Array, radius: number): Float32Array {
  const band = oldBorderCoverage(distSq, radius)
  const out = new Float32Array(alpha.length)
  for (let i = 0; i < alpha.length; i += 1)
    out[i] = alpha[i] > band[i] ? alpha[i] : band[i]
  return out
}

type CenterBuckets = Map<number, { x: number, y: number }[]>
function bucketKey(bx: number, by: number) { return by * 65536 + bx }
function oldNearPlacedCenter(buckets: CenterBuckets, cell: number, spacing: number, x: number, y: number) {
  const bx = Math.floor(x / cell)
  const by = Math.floor(y / cell)
  const reach = spacing * spacing
  for (let oy = by - 1; oy <= by + 1; oy += 1) {
    for (let ox = bx - 1; ox <= bx + 1; ox += 1) {
      for (const c of buckets.get(bucketKey(ox, oy)) ?? []) {
        const dx = c.x - x
        const dy = c.y - y
        if (dx * dx + dy * dy < reach)
          return true
      }
    }
  }
  return false
}
function oldRimCenters(distSq: Float32Array, width: number, height: number, radius: number, spacing: number) {
  const centers: { x: number, y: number }[] = []
  const buckets: CenterBuckets = new Map()
  const cell = Math.max(1, Math.floor(spacing))
  const outer = radius + EDGE_SOFTNESS
  const inner = radius - EDGE_SOFTNESS
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const d = Math.sqrt(distSq[y * width + x])
      if (d > outer || d < inner)
        continue
      if (oldNearPlacedCenter(buckets, cell, spacing, x, y))
        continue
      const center = { x, y }
      centers.push(center)
      const key = bucketKey(Math.floor(x / cell), Math.floor(y / cell))
      const bucket = buckets.get(key)
      if (bucket)
        bucket.push(center)
      else
        buckets.set(key, [center])
    }
  }
  return centers
}
function oldPunchDiscs(centers: readonly { x: number, y: number }[], width: number, height: number, size: number) {
  const punch = new Float32Array(width * height)
  const reach = size / 2 + EDGE_SOFTNESS
  for (const center of centers) {
    const x0 = Math.max(0, Math.floor(center.x - reach))
    const x1 = Math.min(width - 1, Math.ceil(center.x + reach))
    const y0 = Math.max(0, Math.floor(center.y - reach))
    const y1 = Math.min(height - 1, Math.ceil(center.y + reach))
    for (let py = y0; py <= y1; py += 1) {
      for (let px = x0; px <= x1; px += 1) {
        const dx = px - center.x
        const dy = py - center.y
        const value = clamp01(reach - Math.sqrt(dx * dx + dy * dy))
        const at = py * width + px
        if (value > punch[at])
          punch[at] = value
      }
    }
  }
  return punch
}
function oldPerforationPunches(distSq: Float32Array, width: number, height: number, radius: number, perforation: { size: number, spacing: number }) {
  const size = Math.min(MAX_PERFORATION_SIZE, Math.max(0, perforation.size))
  const spacing = Math.max(MIN_PERFORATION_SPACING, perforation.spacing)
  if (size <= 0)
    return { punch: new Float32Array(width * height), centers: [] }
  const centers = oldRimCenters(distSq, width, height, Math.max(0, radius), spacing)
  return { punch: oldPunchDiscs(centers, width, height, size), centers }
}
function oldComposeSilhouette(alpha: Float32Array, width: number, height: number, options: { radius: number, perforation?: { size: number, spacing: number } | null }) {
  const radius = Math.min(MAX_OUTLINE_RADIUS, Math.max(0, options.radius))
  const distSq = oldSquaredDistanceTransform(alpha, width, height)
  const coverage = oldSilhouetteCoverage(alpha, distSq, radius)
  const { punch, centers } = options.perforation
    ? oldPerforationPunches(distSq, width, height, radius, options.perforation)
    : { punch: new Float32Array(width * height), centers: [] as { x: number, y: number }[] }
  return { radius, coverage, punch, centers }
}
function oldComposedAlpha(result: { coverage: Float32Array, punch: Float32Array }) {
  const out = new Float32Array(result.coverage.length)
  for (let i = 0; i < out.length; i += 1)
    out[i] = result.coverage[i] * (1 - result.punch[i])
  return out
}

let seed = 123456789
function rand() {
  seed = (seed * 48271) % 2147483647
  return seed / 2147483647
}
function randInt(min: number, max: number) {
  return min + Math.floor(rand() * (max - min + 1))
}
function sameFloatArray(a: Float32Array, b: Float32Array, label: string) {
  if (a.length !== b.length)
    throw new Error(`${label}: length ${a.length} != ${b.length}`)
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]
    const y = b[i]
    if (!(x === y || (Number.isNaN(x) && Number.isNaN(y))))
      throw new Error(`${label}: index ${i} is ${x} != ${y}`)
  }
}
function sameCenters(a: { x: number, y: number }[], b: { x: number, y: number }[], label: string) {
  if (a.length !== b.length)
    throw new Error(`${label}: center count ${a.length} != ${b.length}`)
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].x !== b[i].x || a[i].y !== b[i].y)
      throw new Error(`${label}: center ${i} differs`)
  }
}

let cases = 0
for (let trial = 0; trial < 300; trial += 1) {
  const width = randInt(1, 45)
  const height = randInt(1, 45)
  const alpha = new Float32Array(width * height)
  const mode = trial % 4
  for (let i = 0; i < alpha.length; i += 1) {
    alpha[i] = mode === 0 ? (rand() > 0.9 ? 1 : 0)
      : mode === 1 ? rand()
        : mode === 2 ? 0
          : 1
  }
  const threshold = [0, 0.1, 0.35, 0.9, 1][trial % 5]
  const oldDist = oldSquaredDistanceTransform(alpha, width, height, threshold)
  const newDist = squaredDistanceTransform(alpha, width, height, threshold)
  sameFloatArray(oldDist, newDist, `dist ${width}x${height} mode ${mode} t ${threshold}`)

  const radius = rand() * 130
  sameFloatArray(oldBorderCoverage(oldDist, radius), borderCoverage(newDist, radius), 'band')
  sameFloatArray(oldSilhouetteCoverage(alpha, oldDist, radius), silhouetteCoverage(alpha, newDist, radius), 'silhouette')

  const perforation = { size: rand() * 340, spacing: rand() * 45 }
  const oldPunch = oldPerforationPunches(oldDist, width, height, radius, perforation)
  const newPunch = perforationPunches(newDist, width, height, radius, perforation)
  sameFloatArray(oldPunch.punch, newPunch.punch, 'punch')
  sameCenters(oldPunch.centers, newPunch.centers, 'centers')

  const options = trial % 3 === 0 ? { radius } : { radius, perforation }
  const oldResult = oldComposeSilhouette(alpha, width, height, options)
  const newResult = composeSilhouette(alpha, width, height, options)
  sameFloatArray(oldResult.coverage, newResult.coverage, 'coverage')
  sameFloatArray(oldResult.punch, newResult.punch, 'composed punch')
  sameFloatArray(oldComposedAlpha(oldResult), composedAlpha(newResult), 'composed alpha')
  cases += 1
}
console.log(`stickerFX parity: ${cases} randomized cases, all bit-identical`)

// Degenerate dimensions: the 1-D pass is a no-op, so both versions must agree.
for (const [w, h] of [[0, 0], [0, 5], [5, 0], [1, 1], [1, 40], [40, 1]] as const) {
  const alpha = new Float32Array(w * h)
  sameFloatArray(oldSquaredDistanceTransform(alpha, w, h, 0.1), squaredDistanceTransform(alpha, w, h, 0.1), `degenerate ${w}x${h}`)
  cases += 1
}
console.log(`stickerFX parity: ${cases} randomized cases (including degenerate sizes), all bit-identical`)
