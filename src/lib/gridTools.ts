/**
 * Pure helpers for the 3×3 grid's whole-board tools (shuffle, cell aspect,
 * per-cell export naming, clear). No store or DOM access, unit-tested.
 */
import type { Node } from './panes'

export type GridCellRatio = '1:1' | '4:5' | '3:4' | '16:9'
export const GRID_CELL_RATIOS: readonly GridCellRatio[] = ['1:1', '4:5', '3:4', '16:9']
export const GRID_CELL_RATIO: GridCellRatio = '1:1'

/** Width / height of a cell aspect. */
export function cellRatioValue(r: GridCellRatio): number {
  const [w, h] = r.split(':').map(Number) as [number, number]
  return w / h
}

export function isGridCellRatio(v: unknown): v is GridCellRatio {
  return GRID_CELL_RATIOS.includes(v as GridCellRatio)
}

/**
 * Cell box for the on-screen grid: the largest w×h at `ratio` with three
 * columns and three rows (plus gaps) inside `avail`, capped by `max` on the
 * long side, never below `min` wide.
 */
export function gridCellBox(avail: { w: number, h: number }, gap: number, ratio: number, max: number, min = 60): { w: number, h: number } {
  const byW = (avail.w - gap * 2) / 3
  const byH = ((avail.h - gap * 2) / 3) * ratio
  const capW = ratio >= 1 ? max : max * ratio
  const w = Math.max(min, Math.floor(Math.min(byW, byH, capW)))
  return { w, h: Math.max(1, Math.round(w / ratio)) }
}

/** Seeded PRNG (mulberry32): deterministic shuffles in tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Shuffle only the filled items among their own slots (Fisher–Yates);
 * empty slots keep their positions. Returns a new array.
 */
export function shuffleFilled<T>(list: readonly T[], isFilled: (t: T) => boolean, rng: () => number = Math.random): T[] {
  const slots = list.map((t, i) => (isFilled(t) ? i : -1)).filter(i => i >= 0)
  const picked = slots.map(i => list[i]!)
  for (let i = picked.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[picked[i], picked[j]] = [picked[j]!, picked[i]!]
  }
  const out = [...list]
  slots.forEach((slot, k) => {
    out[slot] = picked[k]!
  })
  return out
}

/** File name for the n-th (0-based) cell of a posting-order export: grid_01_of_09.jpg */
export function gridCellFileName(i: number, total: number, ext: string, stamp = ''): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `grid_${pad(i + 1)}_of_${pad(total)}${stamp ? `_${stamp}` : ''}.${ext}`
}

/** A layout tree with every pane's photo removed (layout kept, view reset). */
export function clearTreePhotos(root: Node): Node {
  if (root.type === 'leaf')
    return root.photoId ? { ...root, photoId: null, zoom: 1, cx: 0.5, cy: 0.5 } : root
  const a = clearTreePhotos(root.a)
  const b = clearTreePhotos(root.b)
  return a === root.a && b === root.b ? root : { ...root, a, b }
}
