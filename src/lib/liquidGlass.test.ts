/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { mapSize } from './liquidGlass'

describe('mapSize', () => {
  test('small elements map 1:1', () => {
    expect(mapSize(200, 40)).toEqual({ mw: 200, mh: 40, k: 1 })
  })
  test('large elements are capped at 256 on the long side', () => {
    const s = mapSize(720, 760)
    expect(s.mh).toBe(256)
    expect(s.mw).toBe(243)
    expect(s.k).toBeCloseTo(760 / 256)
  })
})
