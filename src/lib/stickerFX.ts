/**
 * Die-cut silhouette math for the sticker maker (pure, unit-tested).
 *
 * Three steps, each a function of the alpha channel alone:
 *
 *  1. `squaredDistanceTransform`: a Euclidean distance field (Felzenszwalb's
 *     separable parabola envelope) over the alpha mask, in squared pixels.
 *  2. `silhouetteCoverage`: the white border as `radius + ½ − √d²` clamped to
 *     [0,1]: a *round* dilation of the silhouette, so the border follows the
 *     artwork's outline instead of offsetting its bounding box. The half pixel
 *     is the antialias band, which is why the border edge is soft at any zoom.
 *  3. `perforationPunches`: stamp notches, the outer edge of that border
 *     (the ring at distance ≈ radius) is walked in raster order and centres are
 *     kept at least `spacing` apart, then punched out with an antialiased disc
 *     of diameter `size`. Notches are periodic along the edge, which is what a
 *     stamp perforation looks like; a periodic function of √d² (the note this
 *     lane started from) only paints concentric rings *inside* the border.
 *
 * A fourth section holds the manual cutout's arithmetic (stroke discs, the
 * lasso's closing rule, the undo cap). Nothing here touches a canvas:
 * `lib/sticker.ts` reads pixels, calls these, and paints the result, and
 * `lib/stickerMask.ts` does the same for the mask editor. Keeping it
 * array-in/array-out is what lets the geometry be tested exactly (single-pixel
 * rings, rectangle interiors).
 */

export interface Perforation {
  /** Disc diameter of one notch, in texture pixels. */
  size: number
  /** Distance between notch centres along the silhouette edge, in texture pixels. */
  spacing: number
}

export interface SilhouetteOptions {
  /** Border width in pixels, already mapped through `outlineRadius`. */
  radius: number
  /** Stamp perforation, or null/absent for a plain die-cut border. */
  perforation?: Perforation | null
}

export interface SilhouetteResult {
  /** The radius actually used (clamped). */
  radius: number
  /** Silhouette coverage including the border band, 0..1, length w×h. */
  coverage: Float32Array
  /** Punch coverage, 0..1; 1 is fully cut away. All zero without perforation. */
  punch: Float32Array
  /** Punch centres (texture pixel centres), for tests and debugging. */
  centers: { x: number, y: number }[]
}

/**
 * The width slider is a design unit, not pixels: `outlineWidth × 2.35` is the
 * radius, so the slider's 0–40 range spans a 0–94px border on the 2048px
 * texture (~4.6% of the long edge at the top). The factor is the one this app
 * shipped with, so the default slider position keeps its look; the cap keeps a
 * runaway value inside the canvas padding.
 */
export const OUTLINE_RADIUS_FACTOR = 2.35
export const MAX_OUTLINE_RADIUS = 112
/** Alpha at or above this counts as "artwork" when seeding the distance field. */
export const ALPHA_SEED_THRESHOLD = 0.1
/** Half-pixel antialias band on every threshold (`radius + 0.5 − d`). */
export const EDGE_SOFTNESS = 0.5
/**
 * Hole size and spacing are slider design units too, mapped by the same 2.35 as
 * the border width so the two read on one scale: a hole looks big next to a
 * thick border because both numbers come from the same unit.
 */
export const PERFORATION_FACTOR = OUTLINE_RADIUS_FACTOR
const DISTANCE_INFINITY = 1e20
const MIN_PERFORATION_SPACING = 4
const MAX_PERFORATION_SIZE = 96

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

export function outlineRadius(widthPx: number): number {
  const raw = Number.isFinite(widthPx) ? widthPx * OUTLINE_RADIUS_FACTOR : 0
  return Math.min(MAX_OUTLINE_RADIUS, Math.max(0, raw))
}

/** Slider units → the notch geometry `composeSilhouette` takes. */
export function perforationFromSliders(holeSize: number, holeSpacing: number): Perforation {
  const size = Number.isFinite(holeSize) ? holeSize * PERFORATION_FACTOR : 0
  const spacing = Number.isFinite(holeSpacing) ? holeSpacing * PERFORATION_FACTOR : 0
  return {
    size: Math.min(MAX_PERFORATION_SIZE, Math.max(0, size)),
    spacing: Math.max(MIN_PERFORATION_SPACING, spacing),
  }
}

/**
 * One 1-D pass of Felzenszwalb & Huttenlocher's squared-distance transform:
 * the lower envelope of parabolas rooted at every sample. `f` holds the row's
 * squared distances (or 0 / ∞ seeds), `out` receives the result.
 */
function transform1D(
  f: Float64Array,
  out: Float64Array,
  parabola: Int32Array,
  boundary: Float64Array,
  length: number,
) {
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

/**
 * Squared Euclidean distance from every pixel centre to the nearest pixel whose
 * alpha is at or above `threshold` (the artwork's silhouette). A mask with no
 * such pixel comes back as `Infinity` everywhere.
 */
export function squaredDistanceTransform(
  alpha: Float32Array,
  width: number,
  height: number,
  threshold = ALPHA_SEED_THRESHOLD,
): Float32Array {
  const columns = new Float64Array(width * height)
  const line = new Float64Array(Math.max(width, height))
  const result = new Float64Array(Math.max(width, height))
  const parabola = new Int32Array(Math.max(width, height))
  const boundary = new Float64Array(Math.max(width, height) + 1)
  const out = new Float32Array(width * height)
  let seeded = false

  // Horizontal pass: each row's distance to the nearest seed in that row.
  for (let y = 0; y < height; y += 1) {
    const row = y * width
    for (let x = 0; x < width; x += 1) {
      const solid = alpha[row + x] >= threshold
      seeded ||= solid
      line[x] = solid ? 0 : DISTANCE_INFINITY
    }
    transform1D(line, result, parabola, boundary, width)
    for (let x = 0; x < width; x += 1)
      columns[x * height + y] = result[x]
  }

  // Vertical pass over the transposed rows: the separable half of the field.
  for (let x = 0; x < width; x += 1) {
    const column = x * height
    transform1D(
      columns.subarray(column, column + height),
      result,
      parabola,
      boundary,
      height,
    )
    for (let y = 0; y < height; y += 1)
      out[y * width + x] = result[y]
  }

  if (!seeded)
    out.fill(Number.POSITIVE_INFINITY)
  return out
}

/**
 * The border band alone: `clamp(radius + ½ − √d², 0, 1)`. 1 anywhere inside the
 * silhouette (d² = 0) and through the border, 0.5 on the border's outer edge,
 * 0 past it. Round by construction: the distance is Euclidean, so a concave
 * notch of the artwork gets a border of the same width as a straight edge.
 */
export function borderCoverage(distSq: Float32Array, radius: number): Float32Array {
  const out = new Float32Array(distSq.length)
  const r = Math.max(0, radius)
  for (let i = 0; i < distSq.length; i += 1)
    out[i] = clamp01(r + EDGE_SOFTNESS - Math.sqrt(distSq[i]))
  return out
}

/** The artwork and its border as one silhouette (`max`, so edges keep their art). */
export function silhouetteCoverage(
  alpha: Float32Array,
  distSq: Float32Array,
  radius: number,
): Float32Array {
  const band = borderCoverage(distSq, radius)
  const out = new Float32Array(alpha.length)
  for (let i = 0; i < alpha.length; i += 1)
    out[i] = alpha[i] > band[i] ? alpha[i] : band[i]
  return out
}

type CenterBuckets = Map<number, { x: number, y: number }[]>

function bucketKey(bx: number, by: number) {
  return by * 65536 + bx
}

/**
 * Is a centre already placed within `spacing` of this pixel? Only the 3×3
 * bucket neighbourhood is scanned: buckets are `spacing` wide, so anything the
 * spacing can reach is in one of those nine (and the naive scan over every
 * centre is quadratic in an edge's length).
 */
function nearPlacedCenter(
  buckets: CenterBuckets,
  cell: number,
  spacing: number,
  x: number,
  y: number,
) {
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

/**
 * Notch centres on the border's outer rim, in raster order and at least
 * `spacing` apart. On a straight horizontal edge that is one centre per
 * `spacing` columns (per rows on a vertical one): the periodicity a die-cut
 * stamp reads as.
 */
function rimCenters(
  distSq: Float32Array,
  width: number,
  height: number,
  radius: number,
  spacing: number,
) {
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
      if (nearPlacedCenter(buckets, cell, spacing, x, y))
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

/** One antialiased disc of diameter `size` per centre, maxed into one buffer. */
function punchDiscs(
  centers: readonly { x: number, y: number }[],
  width: number,
  height: number,
  size: number,
) {
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

/**
 * Stamp notches along the *outer* edge of the border.
 *
 * Each centre punches a disc, opening outward through the border, and when
 * `size` exceeds twice the border width, through the artwork's edge as well.
 */
export function perforationPunches(
  distSq: Float32Array,
  width: number,
  height: number,
  radius: number,
  perforation: Perforation,
): { punch: Float32Array, centers: { x: number, y: number }[] } {
  const size = Math.min(MAX_PERFORATION_SIZE, Math.max(0, perforation.size))
  const spacing = Math.max(MIN_PERFORATION_SPACING, perforation.spacing)
  if (size <= 0)
    return { punch: new Float32Array(width * height), centers: [] }
  const centers = rimCenters(distSq, width, height, Math.max(0, radius), spacing)
  return { punch: punchDiscs(centers, width, height, size), centers }
}

/** Artwork + border, notches cut out: the alpha the sticker actually shows. */
export function composeSilhouette(
  alpha: Float32Array,
  width: number,
  height: number,
  options: SilhouetteOptions,
): SilhouetteResult {
  const radius = Math.min(MAX_OUTLINE_RADIUS, Math.max(0, options.radius))
  const distSq = squaredDistanceTransform(alpha, width, height)
  const coverage = silhouetteCoverage(alpha, distSq, radius)
  const { punch, centers } = options.perforation
    ? perforationPunches(distSq, width, height, radius, options.perforation)
    : { punch: new Float32Array(width * height), centers: [] }
  return { radius, coverage, punch, centers }
}

/** The composed alpha: the silhouette with its stamped notches removed. */
export function composedAlpha(result: SilhouetteResult): Float32Array {
  const out = new Float32Array(result.coverage.length)
  for (let i = 0; i < out.length; i += 1)
    out[i] = result.coverage[i] * (1 - result.punch[i])
  return out
}

/**
 * Transparent margin the composite needs around the artwork so no part of the
 * border (or a notch opened past it) is clipped: the farthest any painted pixel
 * can reach, plus a pixel of air and one for the antialias edge. `sticker.ts`
 * draws the artwork back in, centred, on a canvas this much larger on each
 * side, which is the whole reason a thick border never runs off the texture.
 */
export function silhouettePadding(radius: number, perforation?: Perforation | null): number {
  const stroke = Math.max(
    Math.max(0, radius),
    perforation ? Math.max(0, perforation.size) : 0,
  )
  return Math.ceil(stroke) + 2
}

/**
 * `#rgb` / `#rrggbb` → 0–255 channels. A malformed pick (a browser color input
 * always answers `#rrggbb`) falls back to the sticker border's white.
 */
export function parseHexColor(color: string): [number, number, number] {
  const hex = color.trim().replace(/^#/, '')
  const expand = (value: string) => Number.parseInt(value, 16)
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    const [r, g, b] = [hex[0]!.repeat(2), hex[1]!.repeat(2), hex[2]!.repeat(2)]
    return [expand(r), expand(g), expand(b)]
  }
  if (/^[0-9a-f]{6}$/i.test(hex))
    return [expand(hex.slice(0, 2)), expand(hex.slice(2, 4)), expand(hex.slice(4, 6))]
  return [255, 255, 255]
}

/* ------------------------------------------------------------------------- *
 * Manual cutout adjustment: the mask editor's arithmetic.
 * ------------------------------------------------------------------------- */

export interface MaskPoint {
  x: number
  y: number
}

/** `keep` paints the subject back in, `remove` paints it out. */
export type MaskMode = 'keep' | 'remove'

/**
 * Undo depth for mask strokes. A snapshot is one canvas the size of the mask
 * (4.2 MB at the editor's 1024px ceiling), so the stack is capped to keep a
 * long editing session from pinning a phone out of memory.
 */
export const MASK_UNDO_CAP = 20

/** The radius the brush size slider (1–100, % of the mask's short edge) asks for. */
export function brushRadius(percent: number, shortEdge: number): number {
  const pct = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0
  const edge = Number.isFinite(shortEdge) ? Math.max(0, shortEdge) : 0
  return Math.max(0.5, (pct / 100) * edge)
}

/**
 * One round disc per stroke point. A canvas line from a point to itself paints
 * nothing in most engines, so a single tap (and every vertex of a polyline, for
 * its joints) is painted as an arc this list names; the segments between the
 * points are stroked with round caps.
 */
export function strokeDiscs(points: readonly MaskPoint[], size: number): { x: number, y: number, r: number }[] {
  const r = Math.max(0, size) / 2
  if (r <= 0)
    return []
  return points.map(p => ({ x: p.x, y: p.y, r }))
}

/**
 * The lasso's closing rule: a polygon needs three points to enclose anything,
 * and a drag that lands back where it started still needs the closing edge.
 * Returns the points to fill (as given; the caller closes the path), or null
 * when the drag was too short to be a lasso.
 */
export function closedLasso(
  points: readonly MaskPoint[],
  minPoints = 3,
): readonly MaskPoint[] | null {
  if (points.length < Math.max(3, minPoints))
    return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const p of points) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  // A polygon with no area (a perfectly straight drag) has nothing to fill.
  return maxX - minX < 1 || maxY - minY < 1 ? null : points
}

/** Push a snapshot onto an undo stack, dropping the oldest past `cap`. */
export function pushCapped<T>(stack: readonly T[], item: T, cap = MASK_UNDO_CAP): T[] {
  const next = [...stack, item]
  return next.length > cap ? next.slice(next.length - cap) : next
}
