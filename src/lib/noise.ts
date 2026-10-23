/**
 * Deterministic value noise shared by the filter pipeline and the sticker
 * texture. Integer ops only, so the bytes stay put across runs and engines.
 */

/** Hermite ramp: flat at both ends, so textures do not band at their joins. */
export function smooth(t: number) {
  return t * t * (3 - 2 * t)
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

/**
 * 32-bit integer hash of a lattice point -> [0, 1). Three odd mixers picked for
 * this module (they only have to avalanche well, and they are ours).
 */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul((x | 0) ^ seed, 0x27D4EB2D)
  h = Math.imul((h ^ (y | 0)) + 0x9E3779B1, 0x165667B1)
  h ^= h >>> 15
  h = Math.imul(h, 0x2545F491)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

/** Value noise on a normalized lattice: one hashed value per cell, smooth in between. */
export function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const tx = smooth(x - x0)
  const ty = smooth(y - y0)
  const a = hash2(x0, y0, seed)
  const b = hash2(x0 + 1, y0, seed)
  const c = hash2(x0, y0 + 1, seed)
  const d = hash2(x0 + 1, y0 + 1, seed)
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty)
}
