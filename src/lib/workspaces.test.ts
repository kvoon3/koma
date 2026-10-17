/// <reference types="bun" />
import { describe, expect, it } from 'bun:test'
import { activeAfterRemove, addGroup, addSlot, DEFAULT_WORKSPACES, gridStep, MAX_GRIDS, MAX_WORKSPACES, nextGridName, normalizeGrids, normalizeSlots, removeGroup, removeSlot, renameGroup, resetSlot } from './workspaces'

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

/** Groups of the group bar, as the store holds them. */
const groups = (...names: string[]) => names.map((name, i) => ({ id: `g${i}`, name }))

describe('the group bar', () => {
  it('numbers a new group with the first free number', () => {
    expect(nextGridName([])).toBe('1')
    expect(nextGridName(groups('1', '2'))).toBe('3')
    // A renamed group frees its number for the next one.
    expect(nextGridName(groups('Cover', '2'))).toBe('1')
  })

  it('appends up to the cap and no further', () => {
    let bar = groups('1')
    for (let i = 0; i < MAX_GRIDS + 2; i++)
      bar = addGroup(bar, () => ({ id: `new${i}`, name: nextGridName(bar) }))
    expect(bar).toHaveLength(MAX_GRIDS)
    expect(bar.map(g => g.name)).toEqual(['1', '2', '3', '4'])
  })

  it('removes a group but never the last one', () => {
    expect(removeGroup(groups('1', '2', '3'), 'g1').map(g => g.name)).toEqual(['1', '3'])
    const only = groups('1')
    expect(removeGroup(only, 'g0')).toBe(only)
    const pair = groups('1', '2')
    expect(removeGroup(pair, 'nope')).toBe(pair)
  })

  it('renames a group, refusing blank names', () => {
    expect(renameGroup(groups('1', '2'), 'g1', ' Variant 2 ')).toEqual([{ id: 'g0', name: '1' }, { id: 'g1', name: 'Variant 2' }])
    const bar = groups('1', '2')
    expect(renameGroup(bar, 'g1', '   ')).toBe(bar)
    expect(renameGroup(bar, 'g1', '2')).toBe(bar)
  })
})

describe('normalizeGrids (session migration)', () => {
  const newGridId = () => `fresh${++n}`
  const makeGrid = (k: number) => Array.from({ length: k }, (_, i) => ({ id: `w${i}`, v: i + 1 }))

  it('hydrates a legacy single-group session as one group', () => {
    const saved = makeGrid(9)
    const out = normalizeGrids({ workspaces: saved, activeId: 'w4' }, fresh, newGridId)
    expect(out.grids).toHaveLength(1)
    expect(out.grids[0].name).toBe('1')
    expect(out.workspaces).toEqual(saved)
    expect(out.activeId).toBe('w4')
    // One group means nothing is parked.
    expect(out.parked).toEqual({})
    expect(out.activeGridId).toBe(out.grids[0].id)
  })

  it('hydrates a legacy session without cells as a default board', () => {
    const out = normalizeGrids({ activeId: 'nope' }, fresh, newGridId)
    expect(out.workspaces).toHaveLength(DEFAULT_WORKSPACES)
    expect(out.activeId).toBe(out.workspaces[0].id)
  })

  it('hydrates groups: the saved open one keeps the view, the rest park', () => {
    const out = normalizeGrids({
      grids: [
        { id: 'gA', name: 'Cover A', workspaces: makeGrid(3), activeId: 'w2' },
        { id: 'gB', name: 'Cover B', workspaces: makeGrid(4), activeId: 'w1' },
      ],
      activeGridId: 'gB',
      activeId: 'w1',
    }, fresh, newGridId)
    expect(out.grids).toEqual([{ id: 'gA', name: 'Cover A' }, { id: 'gB', name: 'Cover B' }])
    expect(out.activeGridId).toBe('gB')
    expect(out.workspaces.map(w => w.id)).toEqual(['w0', 'w1', 'w2', 'w3'])
    expect(out.activeId).toBe('w1')
    expect(out.parked.gA).toEqual({ workspaces: makeGrid(3), activeId: 'w2' })
    expect(out.parked.gB).toBeUndefined()
  })

  it('opens the first group when the saved one is gone, and drops extra groups', () => {
    const out = normalizeGrids({
      grids: [
        // Saved names are kept verbatim, whatever they are (these are the
        // letters an older build numbered its groups with).
        { id: 'gA', name: 'A', workspaces: makeGrid(2), activeId: '' },
        { id: 'gB', name: 'B', workspaces: makeGrid(2), activeId: '' },
        { id: 'gC', name: 'C', workspaces: makeGrid(2), activeId: '' },
        { id: 'gD', name: 'D', workspaces: makeGrid(2), activeId: '' },
        { id: 'gE', name: 'E', workspaces: makeGrid(2), activeId: '' },
      ],
      activeGridId: 'gone',
    }, fresh, newGridId)
    expect(out.grids.map(g => g.id)).toEqual(['gA', 'gB', 'gC', 'gD'])
    expect(out.grids.map(g => g.name)).toEqual(['A', 'B', 'C', 'D'])
    expect(out.activeGridId).toBe('gA')
    // A board's cell falls back to its first when the saved one is unknown.
    expect(out.activeId).toBe('w0')
    expect(Object.keys(out.parked).sort()).toEqual(['gB', 'gC', 'gD'])
  })

  it('numbers nameless saved groups 1, 2, …', () => {
    const out = normalizeGrids({
      grids: [
        { id: 'g1', workspaces: makeGrid(2), activeId: '' },
        { id: 'g2', name: '  ', workspaces: makeGrid(2), activeId: '' },
      ],
      activeGridId: 'g2',
    }, fresh, newGridId)
    expect(out.grids.map(g => g.name)).toEqual(['1', '2'])
  })
})
