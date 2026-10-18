/// <reference types="bun" />
import type { DistrictRow } from './regeo'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'
import { buildIndex, formatCoords, lookupDistrict, shortPlaceName } from './regeo'

/**
 * The real bundled polygons, read from disk rather than through the lazy
 * browser loader (`import.meta.glob` has no meaning under Bun). The lookup
 * itself is pure and takes the index, so this is the same code the app runs
 * after its first location insert.
 */
const rows = JSON.parse(readFileSync(new URL('../data/districts.json', import.meta.url), 'utf8')) as DistrictRow[]
const index = buildIndex(rows)

describe('district index', () => {
  it('loaded the three administrative levels', () => {
    expect(index.rows.length).toBeGreaterThan(3000)
    expect(index.rows.some(r => r.depth === 0)).toBe(true)
    expect(index.rows.some(r => r.depth === 1)).toBe(true)
    expect(index.rows.some(r => r.depth === 2)).toBe(true)
  })

  it('names the district well inside its polygon', () => {
    expect(lookupDistrict(index, 30.259, 120.13)).toBe('浙江省/杭州市/西湖区')
    expect(lookupDistrict(index, 39.9087, 116.3975)).toBe('北京市/北京市/东城区')
  })

  it('still resolves a point a few hundred metres from an edge', () => {
    // A boundary vertex of Xihu nudged ~100 m toward its centroid; the edge
    // there is shared with Gongshu, so this is the near-edge case.
    expect(lookupDistrict(index, 30.276924646, 120.148925536)).toBe('浙江省/杭州市/拱墅区')
  })

  it('returns null abroad and over water outside the polygons', () => {
    expect(lookupDistrict(index, 48.8566, 2.3522)).toBeNull()
    expect(lookupDistrict(index, 40.7128, -74.006)).toBeNull()
    expect(lookupDistrict(index, 20.0, 100.0)).toBeNull()
  })

  it('rejects nonsense coordinates', () => {
    expect(lookupDistrict(index, Number.NaN, 120)).toBeNull()
    expect(lookupDistrict(index, 91, 120)).toBeNull()
    expect(lookupDistrict(index, 30, 181)).toBeNull()
  })

  it('looks up in under 5 ms once loaded', () => {
    const points: [number, number][] = [
      [30.259, 120.13],
      [39.9087, 116.3975],
      [31.2304, 121.4737],
      [22.5431, 114.0579],
      [30.2741, 120.1551],
      [29.65, 91.13],
      [48.8566, 2.3522],
    ]
    let worst = 0
    for (let i = 0; i < 500; i++) {
      const [lat, lng] = points[i % points.length]
      const t0 = performance.now()
      lookupDistrict(index, lat, lng)
      worst = Math.max(worst, performance.now() - t0)
    }
    expect(worst).toBeLessThan(5)
  })
})

describe('place names', () => {
  it('drops the province from a district path', () => {
    expect(shortPlaceName('浙江省/杭州市/西湖区')).toBe('杭州市西湖区')
    expect(shortPlaceName('北京市/北京市/东城区')).toBe('北京市东城区')
  })

  it('keeps a province-only path whole', () => {
    expect(shortPlaceName('台湾省')).toBe('台湾省')
    expect(shortPlaceName('香港特别行政区/香港特别行政区/香港特别行政区')).toBe('香港特别行政区香港特别行政区')
  })

  it('formats the coordinate fallback', () => {
    expect(formatCoords(30.259, 120.13)).toBe('30.25900, 120.13000')
  })
})
