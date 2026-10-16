/// <reference types="bun" />
import { describe, expect, it } from 'bun:test'
import { activeAfterRemove, addSlot, DEFAULT_WORKSPACES, gridStep, MAX_WORKSPACES, normalizeSlots, removeSlot, resetSlot } from './workspaces'

let n = 0
const fresh = () => ({ id: `new${++n}`, v: 0 })
const make = (k: number) => Array.from({ length: k }, (_, i) => ({ id: `w${i}`, v: i + 1 }))

describe('addSlot', () => {
  it('appends a fresh cell at the end', () => {
    const next = addSlot(make(8), fresh)
    expect(next).toHaveLength(9)
    expect(next[8].v).toBe(0)
    expect(next.slice(0, 8)).toEqual(make(8))
  })
  it('is a no-op at the max', () => {
    const full = make(MAX_WORKSPACES)
    expect(addSlot(full, fresh)).toBe(full)
  })
})

describe('removeSlot', () => {
  it('removes the cell and closes the gap in order', () => {
    expect(removeSlot(make(4), 'w1', fresh).map(w => w.id)).toEqual(['w0', 'w2', 'w3'])
  })
  it('removes non-empty and empty cells alike', () => {
    const list = [{ id: 'a', v: 0 }, { id: 'b', v: 5 }]
    expect(removeSlot(list, 'b', fresh)).toEqual([{ id: 'a', v: 0 }])
    expect(removeSlot(list, 'a', fresh)).toEqual([{ id: 'b', v: 5 }])
  })
  it('resets the last remaining cell in place instead of removing it', () => {
    expect(removeSlot([{ id: 'only', v: 7 }], 'only', fresh)).toEqual([{ id: 'only', v: 0 }])
  })
  it('returns the same list for an unknown id', () => {
    const list = make(3)
    expect(removeSlot(list, 'x', fresh)).toBe(list)
  })
})

describe('resetSlot', () => {
  it('resets the slot in place, keeping its id and position', () => {
    expect(resetSlot(make(3), 'w1', fresh)).toEqual([{ id: 'w0', v: 1 }, { id: 'w1', v: 0 }, { id: 'w2', v: 3 }])
  })
})

describe('normalizeSlots (migration)', () => {
  it('keeps a legacy nine-cell board whole', () => {
    expect(normalizeSlots(make(9), fresh)).toEqual(make(9))
  })
  it('keeps a smaller saved board as is', () => {
    expect(normalizeSlots(make(3), fresh)).toEqual(make(3))
  })
  it('gives a missing or empty board the default size', () => {
    expect(normalizeSlots(undefined, fresh)).toHaveLength(DEFAULT_WORKSPACES)
    expect(normalizeSlots([], fresh)).toHaveLength(DEFAULT_WORKSPACES)
  })
  it('drops cells past the max and duplicate ids', () => {
    expect(normalizeSlots(make(12), fresh)).toEqual(make(9))
    expect(normalizeSlots([{ id: 'a', v: 1 }, { id: 'a', v: 2 }], fresh)).toEqual([{ id: 'a', v: 1 }])
  })
})

describe('activeAfterRemove', () => {
  const before = make(4)
  it('keeps the active cell when another one goes', () => {
    expect(activeAfterRemove(before, removeSlot(before, 'w1', fresh), 'w3')).toBe('w3')
  })
  it('moves to the cell that took its place, or the new last one', () => {
    expect(activeAfterRemove(before, removeSlot(before, 'w1', fresh), 'w1')).toBe('w2')
    expect(activeAfterRemove(before, removeSlot(before, 'w3', fresh), 'w3')).toBe('w2')
  })
})

describe('gridStep', () => {
  it('walks a full 3×3 like before', () => {
    expect(gridStep(8, 'next', 9)).toBe(0)
    expect(gridStep(0, 'left', 9)).toBe(2)
    expect(gridStep(0, 'up', 9)).toBe(6)
    expect(gridStep(7, 'down', 9)).toBe(1)
  })
  it('respects a short last row', () => {
    // 5 cells: row 0 = 0 1 2, row 1 = 3 4
    expect(gridStep(4, 'right', 5)).toBe(3)
    expect(gridStep(3, 'left', 5)).toBe(4)
    expect(gridStep(2, 'down', 5)).toBe(2)
    expect(gridStep(1, 'down', 5)).toBe(4)
    expect(gridStep(4, 'next', 5)).toBe(0)
  })
  it('stays put on a single cell', () => {
    expect(gridStep(0, 'right', 1)).toBe(0)
  })
})
