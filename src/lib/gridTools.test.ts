/// <reference types="bun" />
import type { Leaf, Node, Split } from './panes'
import { describe, expect, test } from 'bun:test'
import { cellRatioValue, clearTreePhotos, gridCellBox, gridCellFileName, isGridCellRatio, mulberry32, shuffleFilled } from './gridTools'

describe('shuffleFilled', () => {
  const list = ['a', '', 'b', 'c', '', 'd']
  const filled = (s: string) => s !== ''
  test('empty slots stay put; filled items are a permutation', () => {
    const out = shuffleFilled(list, filled, mulberry32(1))
    expect(out[1]).toBe('')
    expect(out[4]).toBe('')
    expect(out.filter(filled).sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(list).toEqual(['a', '', 'b', 'c', '', 'd'])
  })
  test('deterministic with a seed, varies across seeds', () => {
    expect(shuffleFilled(list, filled, mulberry32(42))).toEqual(shuffleFilled(list, filled, mulberry32(42)))
    const seen = new Set(Array.from({ length: 20 }, (_, i) => shuffleFilled(list, filled, mulberry32(i)).join(',')))
    expect(seen.size).toBeGreaterThan(5)
  })
  test('0 or 1 filled → unchanged order', () => {
    expect(shuffleFilled(['', 'x', ''], filled, mulberry32(3))).toEqual(['', 'x', ''])
  })
})

describe('cell ratio', () => {
  test('values and guard', () => {
    expect(cellRatioValue('1:1')).toBe(1)
    expect(cellRatioValue('4:5')).toBe(0.8)
    expect(cellRatioValue('3:4')).toBe(0.75)
    expect(cellRatioValue('16:9')).toBeCloseTo(1.7778, 3)
    expect(isGridCellRatio('4:5')).toBe(true)
    expect(isGridCellRatio('2:1')).toBe(false)
  })
  test('gridCellBox fits 3×3 and respects the ratio and cap', () => {
    expect(gridCellBox({ w: 1000, h: 1000 }, 10, 1, 220)).toEqual({ w: 220, h: 220 })
    const tall = gridCellBox({ w: 1000, h: 600 }, 10, 0.75, 220)
    expect(tall.h * 3 + 20).toBeLessThanOrEqual(600)
    expect(tall.w / tall.h).toBeCloseTo(0.75, 1)
    const wide = gridCellBox({ w: 400, h: 1000 }, 10, 16 / 9, 220)
    expect(wide.w * 3 + 20).toBeLessThanOrEqual(400)
  })
})

describe('gridCellFileName', () => {
  test('zero-padded posting order', () => {
    expect(gridCellFileName(0, 9, 'jpg')).toBe('grid_01_of_09.jpg')
    expect(gridCellFileName(8, 9, 'png', '10161230')).toBe('grid_09_of_09_10161230.png')
  })
})

describe('clearTreePhotos', () => {
  const leaf = (id: string, photoId: string | null): Leaf => ({ type: 'leaf', id, photoId, zoom: 2, cx: 0.2, cy: 0.3, stickers: [], label: null })
  test('clears photos, keeps layout, resets view', () => {
    const root: Split = { type: 'split', id: 's', dir: 'row', ratio: 0.4, a: leaf('a', 'p1'), b: leaf('b', null) }
    const out = clearTreePhotos(root) as Extract<Node, { type: 'split' }>
    expect(out.ratio).toBe(0.4)
    expect(out.a).toMatchObject({ photoId: null, zoom: 1, cx: 0.5, cy: 0.5 })
    expect(out.b).toBe(root.b)
  })
  test('untouched tree is returned as-is', () => {
    const root: Node = leaf('x', null)
    expect(clearTreePhotos(root)).toBe(root)
  })
})
