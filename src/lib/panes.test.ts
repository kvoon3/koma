/// <reference types="bun" />
import type { Node, Rect, Split } from './panes'
import { describe, expect, it } from 'bun:test'
import { degToRad, radToDeg } from './detent'
import { deletePane, dividerLine, findLeaf, isPaneTransformed, layoutTree, leafList, newLeaf, paneTransform, paneTransformCss, pressPlan, rotationCoverScale, swapLeafContents, wrapAngle } from './panes'

function leaf(id: string, photoId: string | null = `ph-${id}`) {
  return { ...newLeaf(), id, photoId }
}
function split(id: string, a: Node, b: Node, dir: 'row' | 'column' = 'row'): Node {
  return { type: 'split', id, dir, ratio: 0.5, a, b }
}
function splitRatio(id: string, ratio: number, a: Node, b: Node, dir: 'row' | 'column' = 'row'): Node {
  return { type: 'split', id, dir, ratio, a, b }
}
/** Split the rightmost leaf `depth` times: what repeatedly splitting the last pane builds. */
function rightSpine(depth: number, n = 0): Node {
  const left = leaf(`sp${n}`)
  return n === depth ? left : split(`ss${n}`, left, rightSpine(depth, n + 1))
}
function inside(r: Rect, W: number, H: number, gap: number): boolean {
  return r.x >= gap - 1e-9 && r.y >= gap - 1e-9 && r.x + r.w <= W - gap + 1e-9 && r.y + r.h <= H - gap + 1e-9
}
function findSplit(node: Node, id: string): Split | null {
  if (node.type === 'leaf')
    return null
  return node.id === id ? node : (findSplit(node.a, id) ?? findSplit(node.b, id))
}
function subtreeBox(node: Node, rects: Map<string, Rect>): Rect {
  if (node.type === 'leaf')
    return rects.get(node.id)!
  const a = subtreeBox(node.a, rects)
  const b = subtreeBox(node.b, rects)
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
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

describe('layoutTree', () => {
  it('keeps every pane visible down a deep right spine at gap 0', () => {
    const { leaves } = layoutTree(rightSpine(12), 327, 218, 0)
    expect(leaves).toHaveLength(13)
    expect(leaves.every(({ rect }) => rect.w > 0)).toBe(true)
    // Nothing is left over and nothing is spilled: the widths are the canvas.
    expect(leaves.reduce((sum, { rect }) => sum + rect.w, 0)).toBe(327)
  })

  it('keeps a squeezed nested split on the canvas', () => {
    const root = splitRatio('s0', 0.05, split('s1', leaf('a'), leaf('b')), leaf('c'))
    const { leaves } = layoutTree(root, 80, 80, 4.8)
    expect(leaves.every(({ rect }) => inside(rect, 80, 80, 4.8))).toBe(true)
    expect(leaves.every(({ rect }) => rect.w > 0 && rect.h > 0)).toBe(true)
  })

  it('tiles a split whose gap eats most of the extent', () => {
    // 26 is the tightest gap that still fits two 1px panes; 30 is past it, so
    // the gap itself has to shrink for the children to tile the parent.
    for (const gap of [26, 30]) {
      const { leaves, dividers } = layoutTree(split('s', leaf('a'), leaf('b')), 80, 80, gap)
      const [a, b] = leaves.map(l => l.rect)
      expect(a.w).toBeGreaterThan(0)
      expect(b.w).toBeGreaterThan(0)
      expect(a.w + b.w + dividers[0].gap).toBeCloseTo(80 - gap * 2, 12)
      expect(b.x - (a.x + a.w)).toBeCloseTo(dividers[0].gap, 12)
    }
  })

  it('leaves a healthy split exactly as it was', () => {
    const row = layoutTree(split('r', leaf('a'), leaf('b')), 327, 218, 0)
    expect(row.leaves.map(l => l.rect.w)).toEqual([164, 163])
    const gap = 9.6
    const col = layoutTree(split('c', leaf('a'), leaf('b'), 'column'), 327, 218, gap)
    expect(col.leaves.reduce((sum, l) => sum + l.rect.h, 0)).toBeCloseTo(218 - gap * 2 - gap, 12)
  })

  it('draws each divider line inside the band it actually laid out', () => {
    const trees: [Node, number][] = [
      [splitRatio('s0', 0.05, split('s1', leaf('a'), leaf('b')), leaf('c')), 4.8],
      [splitRatio('s0', 0.05, split('s1', leaf('a'), leaf('b')), leaf('c'), 'column'), 4.8],
      [rightSpine(12), 9.6],
    ]
    for (const [root, gap] of trees) {
      const { leaves, dividers } = layoutTree(root, 80, 80, gap)
      const rects = new Map(leaves.map(({ node, rect }) => [node.id, rect]))
      expect(dividers.length).toBeGreaterThan(0)
      for (const d of dividers) {
        expect(d.gap).toBeLessThanOrEqual(gap)
        const node = findSplit(root, d.id)!
        const a = subtreeBox(node.a, rects)
        const b = subtreeBox(node.b, rects)
        const line = dividerLine(d)
        if (d.dir === 'row') {
          expect(line.x!).toBeGreaterThanOrEqual(a.x + a.w)
          expect(line.x!).toBeLessThanOrEqual(b.x)
        }
        else {
          expect(line.y!).toBeGreaterThanOrEqual(a.y + a.h)
          expect(line.y!).toBeLessThanOrEqual(b.y)
        }
      }
    }
  })
})

describe('pane rotation / flip', () => {
  const cell = { x: 0, y: 0, w: 200, h: 100 }
  const upright = paneTransform(cell, newLeaf())

  it('an untouched pane draws with no transform at all', () => {
    expect(upright).toEqual({ rot: 0, cover: 1, scaleX: 1, scaleY: 1 })
    expect(isPaneTransformed(upright)).toBe(false)
    expect(paneTransformCss(upright)).toBe('rotate(0rad) scale(1, 1)')
  })

  it('a stored angle roundtrips through the transform, wrapped', () => {
    const quarter = paneTransform(cell, { ...newLeaf(), rot: degToRad(90) })
    expect(radToDeg(quarter.rot)).toBeCloseTo(90, 12)
    // Four quarters close the turn exactly where it started.
    expect(wrapAngle(degToRad(90) * 4)).toBe(0)
    expect(radToDeg(paneTransform(cell, { ...newLeaf(), rot: degToRad(450) }).rot)).toBeCloseTo(90, 12)
    expect(radToDeg(paneTransform(cell, { ...newLeaf(), rot: degToRad(-270) }).rot)).toBeCloseTo(90, 12)
    expect(isPaneTransformed(quarter)).toBe(true)
  })

  it('a quarter turn needs no extra zoom to keep a square cell covered', () => {
    expect(rotationCoverScale(degToRad(90), 200, 200)).toBeCloseTo(1, 12)
    expect(rotationCoverScale(degToRad(180), 200, 120)).toBeCloseTo(1, 12)
    // ...but a 2:1 cell rotated a quarter turn has to double.
    expect(rotationCoverScale(degToRad(90), 200, 100)).toBeCloseTo(2, 12)
    // 45° on a square is the tight √2.
    expect(rotationCoverScale(degToRad(45), 100, 100)).toBeCloseTo(Math.SQRT2, 12)
    // Degenerate cells never divide by zero.
    expect(rotationCoverScale(degToRad(45), 0, 100)).toBe(1)
  })

  it('flips mirror the scale without turning the photo', () => {
    expect(paneTransform(cell, { ...newLeaf(), flipX: true })).toEqual({ rot: 0, cover: 1, scaleX: -1, scaleY: 1 })
    expect(paneTransform(cell, { ...newLeaf(), flipY: true })).toEqual({ rot: 0, cover: 1, scaleX: 1, scaleY: -1 })
    // Flipping both axes is the same mirror as a half turn, and still no rotation.
    expect(paneTransform(cell, { ...newLeaf(), flipX: true, flipY: true })).toEqual({ rot: 0, cover: 1, scaleX: -1, scaleY: -1 })
    // The cover scale multiplies the flip, it never cancels it.
    const both = paneTransform(cell, { ...newLeaf(), rot: degToRad(90), flipX: true })
    expect(both.scaleX).toBeCloseTo(-2, 12)
    expect(both.scaleY).toBeCloseTo(2, 12)
  })

  it('the CSS spells the turn first, so it is applied last', () => {
    // rotate() then scale(): the flip happens in the photo's own frame and the
    // turn is the outer one, exactly the exporter's rotate() after scale().
    expect(paneTransformCss({ rot: 0.5, cover: 2, scaleX: 2, scaleY: -2 })).toBe('rotate(0.5rad) scale(2, -2)')
    const t = paneTransform(cell, { ...newLeaf(), rot: degToRad(15), flipY: true })
    expect(t.scaleX).toBeCloseTo(t.cover, 12)
    expect(t.scaleY).toBeCloseTo(-t.cover, 12)
  })
})
