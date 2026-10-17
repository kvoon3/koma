/// <reference types="bun" />
import type { Node } from './panes'
import { describe, expect, it } from 'bun:test'
import { degToRad, radToDeg } from './detent'
import { deletePane, findLeaf, isPaneTransformed, leafList, newLeaf, paneTransform, paneTransformCss, pressPlan, rotationCoverScale, swapLeafContents, wrapAngle } from './panes'

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
