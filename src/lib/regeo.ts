/**
 * Offline reverse geocoding for a photo's GPS fix: the district (qu / xian) whose
 * polygon contains a WGS-84 point, named through its parent path.
 *
 * The data is a simplified snapshot of the AreaCity boundary set, built by
 * `scripts/build-districts.mjs` (see THIRD_PARTY_NOTICES.md). It is a lazy
 * import: nothing here runs, and no polygon JSON is fetched, until the first
 * call to `reverseGeocode` / `placeName`, so a normal board load never pays
 * for it.
 *
 * Coordinates are WGS-84. The source is GCJ-02 and was shifted once at build
 * time, because a camera / phone writes WGS-84 and the browser never sees the
 * Chinese offset.
 */

/** One ring of `[lng, lat]` points; rings are implicitly closed. */
export type Ring = number[][]

/** `[adcode, "province/city/district", rings]` as written by the build script. */
export type DistrictRow = [number, string, Ring[]]

/** A ring with its bounding box, so a lookup can skip most polygons cheaply. */
interface PreparedRing {
  points: Ring
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

interface PreparedRow {
  path: string
  /** Number of path segments; the deepest hit wins (district over city over province). */
  depth: number
  rings: PreparedRing[]
}

export interface GeoIndex {
  rows: PreparedRow[]
  /**
   * Coarse prefilter: a 0.5° cell (≈55 km) maps to every row whose bounding box
   * touches it. Any polygon that contains the point also has a bounding box
   * that touches the point's cell, so the filter can never hide a hit.
   */
  cells: Map<number, number[]>
}

const CELL_DEG = 0.5
const CELL_X = Math.ceil(360 / CELL_DEG)
const CELL_Y = Math.ceil(180 / CELL_DEG)
const cellKey = (ix: number, iy: number) => ix * CELL_Y + iy
const cellX = (lng: number) => Math.min(CELL_X - 1, Math.max(0, Math.floor((lng + 180) / CELL_DEG)))
const cellY = (lat: number) => Math.min(CELL_Y - 1, Math.max(0, Math.floor((lat + 90) / CELL_DEG)))

function prepareRing(points: Ring): PreparedRing | null {
  if (points.length < 3)
    return null
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  for (const [lng, lat] of points) {
    if (lng < minLng)
      minLng = lng
    if (lng > maxLng)
      maxLng = lng
    if (lat < minLat)
      minLat = lat
    if (lat > maxLat)
      maxLat = lat
  }
  return { points, minLng, minLat, maxLng, maxLat }
}

interface PreparedRowWithBox {
  row: PreparedRow
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

/** One JSON row -> rings with bounding boxes and the row's own box; null when unusable. */
function prepareRow([adcode, path, rings]: DistrictRow): PreparedRowWithBox | null {
  if (!Number.isFinite(adcode) || !path || !Array.isArray(rings))
    return null
  const prepared: PreparedRing[] = []
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  for (const ring of rings) {
    const p = prepareRing(ring)
    if (!p)
      continue
    prepared.push(p)
    minLng = Math.min(minLng, p.minLng)
    minLat = Math.min(minLat, p.minLat)
    maxLng = Math.max(maxLng, p.maxLng)
    maxLat = Math.max(maxLat, p.maxLat)
  }
  if (!prepared.length)
    return null
  return {
    row: { path, depth: path.split('/').length - 1, rings: prepared },
    minLng,
    minLat,
    maxLng,
    maxLat,
  }
}

/** Register one row's index in every 0.5° cell its bounding box touches. */
function tileRow(cells: Map<number, number[]>, idx: number, box: PreparedRowWithBox) {
  for (let ix = cellX(box.minLng); ix <= cellX(box.maxLng); ix++) {
    for (let iy = cellY(box.minLat); iy <= cellY(box.maxLat); iy++) {
      const key = cellKey(ix, iy)
      const bucket = cells.get(key)
      if (bucket)
        bucket.push(idx)
      else
        cells.set(key, [idx])
    }
  }
}

/** Build the lookup structures once, from the JSON rows (also the unit-test seam). */
export function buildIndex(rows: DistrictRow[]): GeoIndex {
  const out: PreparedRow[] = []
  const cells = new Map<number, number[]>()
  for (const row of rows) {
    const prepared = prepareRow(row)
    if (!prepared)
      continue
    tileRow(cells, out.length, prepared)
    out.push(prepared.row)
  }
  return { rows: out, cells }
}

/** Even-odd test across every ring: disjoint parts and holes both fall out of it. */
function ringContains(r: PreparedRing, lng: number, lat: number): boolean {
  if (lng < r.minLng || lng > r.maxLng || lat < r.minLat || lat > r.maxLat)
    return false
  const pts = r.points
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0]
    const yi = pts[i][1]
    const xj = pts[j][0]
    const yj = pts[j][1]
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
      inside = !inside
  }
  return inside
}

/** The full province/city/district path containing a WGS-84 point, or null. */
export function lookupDistrict(index: GeoIndex, lat: number, lng: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180)
    return null
  const candidates = index.cells.get(cellKey(cellX(lng), cellY(lat)))
  if (!candidates)
    return null
  let best: string | null = null
  let bestDepth = -1
  for (const idx of candidates) {
    const row = index.rows[idx]
    if (row.depth <= bestDepth)
      continue
    let inside = false
    for (const ring of row.rings) {
      if (ringContains(ring, lng, lat)) {
        inside = !inside
      }
    }
    if (inside) {
      best = row.path
      bestDepth = row.depth
    }
  }
  return best
}

let loaded: Promise<GeoIndex | null> | null = null

/**
 * Load and index the bundled polygons. The dynamic import is what splits
 * `districts.json` into its own chunk; the promise is shared so concurrent
 * first calls pay for one parse.
 */
export function loadDistricts(): Promise<GeoIndex | null> {
  loaded ??= (async () => {
    try {
      const modules = import.meta.glob('../data/districts.json') as Record<string, () => Promise<{ default: DistrictRow[] }>>
      const load = modules['../data/districts.json']
      if (!load)
        return null
      const mod = await load()
      return buildIndex(mod.default)
    }
    catch {
      return null
    }
  })()
  return loaded
}

/** Full province/city/district path for a WGS-84 fix, null when none contains it. */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const index = await loadDistricts()
  return index ? lookupDistrict(index, lat, lng) : null
}

/** Drop the province: `Hangzhou Xihu`. Province-only paths stay as they are. */
export function shortPlaceName(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts.slice(-2).join('')
}

/** The short name for a WGS-84 fix, null when no polygon contains it. */
export async function placeName(lat: number, lng: number): Promise<string | null> {
  const path = await reverseGeocode(lat, lng)
  return path ? shortPlaceName(path) : null
}

/** The label text used when reverse geocoding misses: `30.27410, 120.15510`. */
export function formatCoords(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}
