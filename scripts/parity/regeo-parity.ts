import { readFileSync } from 'node:fs'
import { buildIndex, formatCoords, lookupDistrict, shortPlaceName } from '../../src/lib/regeo.ts'

type Ring = number[][]
type DistrictRow = [number, string, Ring[]]

const CELL_DEG = 0.5
const CELL_X = Math.ceil(360 / CELL_DEG)
const CELL_Y = Math.ceil(180 / CELL_DEG)
const cellKey = (ix: number, iy: number) => ix * CELL_Y + iy
const cellX = (lng: number) => Math.min(CELL_X - 1, Math.max(0, Math.floor((lng + 180) / CELL_DEG)))
const cellY = (lat: number) => Math.min(CELL_Y - 1, Math.max(0, Math.floor((lat + 90) / CELL_DEG)))

function oldPrepareRing(points: Ring) {
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
function oldPrepareRow([adcode, path, rings]: DistrictRow) {
  if (!Number.isFinite(adcode) || !path || !Array.isArray(rings))
    return null
  const prepared: ReturnType<typeof oldPrepareRing>[] = []
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  for (const ring of rings) {
    const p = oldPrepareRing(ring)
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
function oldTileRow(cells: Map<number, number[]>, idx: number, box: NonNullable<ReturnType<typeof oldPrepareRow>>) {
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
function oldBuildIndex(rows: DistrictRow[]) {
  const out: NonNullable<ReturnType<typeof oldPrepareRow>>['row'][] = []
  const cells = new Map<number, number[]>()
  for (const row of rows) {
    const prepared = oldPrepareRow(row)
    if (!prepared)
      continue
    oldTileRow(cells, out.length, prepared)
    out.push(prepared.row)
  }
  return { rows: out, cells }
}
function oldRingContains(r: NonNullable<ReturnType<typeof oldPrepareRing>>, lng: number, lat: number) {
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
function oldLookupDistrict(index: ReturnType<typeof oldBuildIndex>, lat: number, lng: number) {
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
      if (oldRingContains(ring, lng, lat))
        inside = !inside
    }
    if (inside) {
      best = row.path
      bestDepth = row.depth
    }
  }
  return best
}

const rows = JSON.parse(readFileSync(new URL('../../src/data/districts.json', import.meta.url), 'utf8')) as DistrictRow[]
const oldIndex = oldBuildIndex(rows)
const newIndex = buildIndex(rows)

if (oldIndex.rows.length !== newIndex.rows.length)
  throw new Error(`row count ${oldIndex.rows.length} != ${newIndex.rows.length}`)

let checked = 0
function compare(lat: number, lng: number) {
  const a = oldLookupDistrict(oldIndex, lat, lng)
  const b = lookupDistrict(newIndex, lat, lng)
  if (a !== b)
    throw new Error(`lookup differs at ${lat},${lng}: ${a} != ${b}`)
  checked += 1
}

for (let lat = -89.75; lat <= 90; lat += 0.75) {
  for (let lng = -179.75; lng <= 180; lng += 0.75)
    compare(lat, lng)
}
for (const [lat, lng] of [
  [30.259, 120.13],
  [39.9087, 116.3975],
  [30.276924646, 120.148925536],
  [31.2304, 121.4737],
  [22.5431, 114.0579],
  [29.65, 91.13],
  [48.8566, 2.3522],
  [40.7128, -74.006],
  [20, 100],
  [35.6762, 139.6503],
  [1.3521, 103.8198],
  [-33.8688, 151.2093],
  [NaN, 120],
  [91, 120],
  [30, 181],
] as const)
  compare(lat, lng)

const shorts = ['浙江省/杭州市/西湖区', '北京市/北京市/东城区', '台湾省', '香港特别行政区/香港特别行政区/香港特别行政区']
for (const path of shorts) {
  if (shortPlaceName(path) !== path.split('/').filter(Boolean).slice(-2).join(''))
    throw new Error(`shortPlaceName differs for ${path}`)
}
if (formatCoords(30.259, 120.13) !== '30.25900, 120.13000')
  throw new Error('formatCoords differs')

console.log(`regeo parity: ${checked} lookups identical on the real districts, ${newIndex.rows.length} rows indexed`)
