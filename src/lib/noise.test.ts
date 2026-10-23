import { describe, expect, it } from 'bun:test'
import { hash2, valueNoise } from './noise'

describe('noise', () => {
  it('pins the hash mixers the filters and textures depend on', () => {
    expect(hash2(3, -7, 0)).toBe(0.9720449871383607)
    expect(hash2(0, 0, 0x1B873593)).toBe(0.9214591875206679)
    expect(hash2(-12, 9, 0xC2B2AE35)).toBe(0.001681664027273655)
  })

  it('stays inside the noise range and repeats for the same lattice point', () => {
    for (const [x, y, seed] of [[0, 0, 1], [0.25, 3.5, 7], [-8.75, 12.25, 99]] as const) {
      const value = valueNoise(x, y, seed)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
      expect(valueNoise(x, y, seed)).toBe(value)
    }
  })
})
