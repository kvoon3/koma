/// <reference types="bun" />
import type { Node } from './panes'
import { describe, expect, it } from 'bun:test'
import { deletePane, findLeaf, leafList, newLeaf, pressPlan, swapLeafContents } from './panes'

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

describe('swapLeafContents', () => {
  it('swaps two photos with their placement', () => {
    const a = { ...leaf('a'), zoom: 2, cx: 0.2 }
    const root = split('s', a, leaf('b'))
    const next = swapLeafContents(root, 'a', 'b')
    expect(findLeaf(next, 'a')!.photoId).toBe('ph-b')
    expect(findLeaf(next, 'b')!.photoId).toBe('ph-a')
    expect(findLeaf(next, 'b')!.zoom).toBe(2)
    expect(findLeaf(next, 'b')!.cx).toBe(0.2)
  })
  it('an empty pane dropped on a photo pane pulls the photo over', () => {
    const root = split('s', leaf('e', null), leaf('b'))
    const next = swapLeafContents(root, 'e', 'b')
    expect(findLeaf(next, 'e')!.photoId).toBe('ph-b')
    expect(findLeaf(next, 'b')!.photoId).toBeNull()
  })
  it('two empty panes, the same pane or an unknown id change nothing', () => {
    const root = split('s', leaf('e', null), leaf('f', null))
    expect(swapLeafContents(root, 'e', 'f')).toBe(root)
    const r2 = split('s', leaf('a'), leaf('b'))
    expect(swapLeafContents(r2, 'a', 'a')).toBe(r2)
    expect(swapLeafContents(r2, 'a', 'x')).toBe(r2)
  })
})

describe('pressPlan', () => {
  it('arms the touch carry on empty and photo panes alike', () => {
    expect(pressPlan(false, 'touch').armHold).toBe(true)
    expect(pressPlan(true, 'touch').armHold).toBe(true)
    expect(pressPlan(false, 'pen').armHold).toBe(true)
  })
  it('only a photo pane pans and captures the pointer', () => {
    expect(pressPlan(true, 'mouse')).toEqual({ capture: true, pan: true, armHold: false })
    expect(pressPlan(false, 'touch')).toEqual({ capture: false, pan: false, armHold: true })
    expect(pressPlan(false, 'mouse')).toEqual({ capture: false, pan: false, armHold: false })
  })
})
