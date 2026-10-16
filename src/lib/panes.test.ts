/// <reference types="bun" />
import type { Node } from './panes'
import { describe, expect, it } from 'bun:test'
import { deletePane, findLeaf, leafList, newLeaf, resetSlot } from './panes'

function leaf(id: string, photoId: string | null = `ph-${id}`) {
  return { ...newLeaf(), id, photoId }
}
function split(id: string, a: Node, b: Node, dir: 'row' | 'column' = 'row'): Node {
  return { type: 'split', id, dir, ratio: 0.5, a, b }
}

describe('deletePane', () => {
  it('lets the sibling take over the space of a two-pane split', () => {
    const b = leaf('b')
    const root = split('s', leaf('a'), b)
    expect(deletePane(root, 'a')).toBe(b)
  })

  it('collapses only the parent split in a deeper tree', () => {
    const c = leaf('c')
    const inner = split('in', leaf('b'), c, 'column')
    const root = split('s', leaf('a'), inner)
    const next = deletePane(root, 'b')
    expect(next.type).toBe('split')
    expect(next.id).toBe('s')
    expect(next.type === 'split' && next.b).toBe(c)
    expect(leafList(next).map(l => l.id)).toEqual(['a', 'c'])
  })

  it('clears the last remaining pane in place instead of removing it', () => {
    const only = { ...leaf('a'), zoom: 2, label: { id: 'l' } as never }
    const next = deletePane(only, 'a')
    expect(next.type).toBe('leaf')
    expect(next.id).toBe('a')
    const l = findLeaf(next, 'a')!
    expect(l.photoId).toBeNull()
    expect(l.zoom).toBe(1)
    expect(l.stickers).toEqual([])
    expect(l.label).toBeNull()
  })

  it('returns the same root for an unknown id', () => {
    const root = split('s', leaf('a'), leaf('b'))
    expect(deletePane(root, 'nope')).toBe(root)
    expect(deletePane(root, 's')).toBe(root)
  })
})

describe('resetSlot', () => {
  const fresh = () => ({ id: 'new', v: 0 })
  const list = [{ id: 'w1', v: 1 }, { id: 'w2', v: 2 }, { id: 'w3', v: 3 }]

  it('resets the slot in place, keeping its id and position', () => {
    expect(resetSlot(list, 'w2', fresh)).toEqual([{ id: 'w1', v: 1 }, { id: 'w2', v: 0 }, { id: 'w3', v: 3 }])
  })

  it('returns the same list for an unknown id', () => {
    expect(resetSlot(list, 'x', fresh)).toBe(list)
  })
})
