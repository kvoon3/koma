/// <reference types="bun" />
import type { Node } from './panes'
import { describe, expect, it } from 'bun:test'
import { deletePane, findLeaf, layoutTree, leafCornerRadii, leafList, newLeaf, pressPlan, seamSides, swapLeafContents } from './panes'

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

/** The panes' seam sides as a sorted "left,right" style string, keyed by leaf id. */
function sides(root: Node, gap = 0) {
  const { leaves } = layoutTree(root, 1000, 1000, gap)
  const seams = seamSides(leaves, gap)
  return (id: string) => {
    const seam = seams.get(leaves.find(l => l.node.id === id)!.node.id)!
    return ['left', 'right', 'top', 'bottom'].filter(k => seam[k as keyof typeof seam]).join(',')
  }
}

describe('seamSides', () => {
  it('marks the shared edge of two filled panes only', () => {
    const at = sides(split('s', leaf('a'), leaf('b')))
    expect(at('a')).toBe('right')
    expect(at('b')).toBe('left')
  })

  it('marks nothing against an empty pane', () => {
    expect(sides(split('s', leaf('a'), leaf('b', null)))('a')).toBe('')
  })

  it('keeps the canvas border out of it in a 2×2', () => {
    const root = split('outer', split('top', leaf('a'), leaf('b')), split('bottom', leaf('c'), leaf('d')), 'column')
    const at = sides(root)
    expect(at('a')).toBe('right,bottom')
    expect(at('b')).toBe('left,bottom')
    expect(at('c')).toBe('right,top')
    expect(at('d')).toBe('left,top')
  })

  it('resolves adjacency across a gap', () => {
    const at = sides(split('s', leaf('a'), leaf('b')), 30)
    expect(at('a')).toBe('right')
    expect(at('b')).toBe('left')
  })

  it('sees a tall pane from both of the panes stacked beside it', () => {
    const at = sides(split('s', leaf('a'), split('t', leaf('b'), leaf('c'), 'column')))
    expect(at('a')).toBe('right')
    expect(at('b')).toBe('left,bottom')
    expect(at('c')).toBe('left,top')
  })
})

describe('leafCornerRadii', () => {
  it('squares the corners that sit on a seam when panes are flush', () => {
    const root = split('outer', split('top', leaf('a'), leaf('b')), split('bottom', leaf('c'), leaf('d')), 'column')
    const { leaves } = layoutTree(root, 1000, 1000, 0)
    const radii = (id: string) => {
      const seam = seamSides(leaves, 0).get(leaves.find(l => l.node.id === id)!.node.id)!
      return leafCornerRadii(40, seam, 0).join(',')
    }
    expect(radii('a')).toBe('40,0,0,0')
    expect(radii('b')).toBe('0,40,0,0')
    expect(radii('c')).toBe('0,0,0,40')
    expect(radii('d')).toBe('0,0,40,0')
  })

  it('keeps the full radius when a gutter separates the panes', () => {
    const { leaves } = layoutTree(split('s', leaf('a'), leaf('b')), 1000, 1000, 30)
    const seam = seamSides(leaves, 30).get(leaves.find(l => l.node.id === 'a')!.node.id)!
    expect(leafCornerRadii(40, seam, 30).join(',')).toBe('40,40,40,40')
  })
})

describe('layoutTree tiling', () => {
  const rects = (root: Node, W: number, H: number, gap: number) =>
    layoutTree(root, W, H, gap).leaves.map(l => l.rect)

  it('abuts panes exactly on whole pixels at gap 0, whatever the width', () => {
    for (const W of [1000, 1001, 1023, 2048]) {
      const [a, b] = rects(split('s', leaf('a'), leaf('b')), W, 800, 0)
      expect(a.x + a.w).toBe(b.x)
      expect(a.w + b.w).toBe(W)
      for (const r of [a, b])
        expect([r.x, r.w].every(Number.isInteger)).toBe(true)
    }
  })

  it('rounds a repeating split into whole-pixel panes', () => {
    const [a, b] = rects({ ...split('s', leaf('a'), leaf('b')), ratio: 1 / 3 } as Node, 1000, 800, 0)
    expect(a.w).toBe(333)
    expect(b.w).toBe(667)
    expect(a.x + a.w).toBe(b.x)
  })

  it('leaves a whole-pixel gutter that still adds up', () => {
    const [a, b] = rects(split('s', leaf('a'), leaf('b')), 1000, 800, 20)
    expect(a.w + 20 + b.w).toBe(1000 - 20 * 2)
    expect([a.x, a.w, b.x, b.w].every(Number.isInteger)).toBe(true)
  })
})
