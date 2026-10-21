/// <reference types="bun" />
import type { Node } from './panes'
import { describe, expect, it } from 'bun:test'
import { cachedGeometry, cachedSeams, computeGeometry, computeLayout, emptyGeometryCache, emptySeamsCache, paneShape, withLiveLeaves } from './layout'
import { newLeaf } from './panes'

function leaf(id: string, photoId: string | null = `ph-${id}`) {
  return { ...newLeaf(), id, photoId }
}
function split(id: string, a: Node, b: Node, dir: 'row' | 'column' = 'row', ratio = 0.5): Node {
  return { type: 'split', id, dir, ratio, a, b }
}
const BOX = { canvasRatio: 1.5, canvasFill: 1, availW: 1000, availH: 700, gapValue: 0, radiusValue: 0, fadeValue: 0 }

describe('paneShape', () => {
  it('ignores what a leaf holds, so a pan keeps the shape', () => {
    const root = split('s', leaf('a'), leaf('b'))
    const panned = split('s', { ...leaf('a'), zoom: 3, cx: 0.2, cy: 0.9 }, { ...leaf('b'), filter: { id: 'mosaic' } as never })
    expect(paneShape(panned)).toBe(paneShape(root))
  })

  it('changes with a ratio, a direction, or a pane', () => {
    const root = split('s', leaf('a'), leaf('b'))
    expect(paneShape(split('s', leaf('a'), leaf('b'), 'row', 0.6))).not.toBe(paneShape(root))
    expect(paneShape(split('s', leaf('a'), leaf('b'), 'column'))).not.toBe(paneShape(root))
    expect(paneShape(split('s', leaf('a'), split('t', leaf('b'), leaf('c'))))).not.toBe(paneShape(root))
  })
})

describe('computeGeometry', () => {
  it('keys every pane rect by leaf id', () => {
    const geo = computeGeometry(split('s', leaf('a'), leaf('b')), BOX)
    expect([...geo.rects.keys()]).toEqual(['a', 'b'])
    expect(geo.rects.get('a')!.x).toBe(0)
    expect(geo.rects.get('b')!.x).toBe(500)
  })

  it('leaves the canvas where it was before the split types did', () => {
    const root = split('s', leaf('a'), leaf('b'), 'column', 0.25)
    expect(computeLayout(root, 1.5, 1, 1000, 700, 0, 0, 0).leaves.map(l => l.rect))
      .toEqual(withLiveLeaves(computeGeometry(root, BOX), root).leaves.map(l => l.rect))
  })
})

describe('cachedGeometry', () => {
  it('reuses the object while the shape and the box hold still', () => {
    const cache = emptyGeometryCache()
    const first = cachedGeometry(cache, split('s', leaf('a'), leaf('b')), BOX)
    const panned = split('s', { ...leaf('a'), zoom: 2, cx: 0.1 }, leaf('b'))
    expect(cachedGeometry(cache, panned, BOX)).toBe(first)
  })

  it('lays out again when the box or the ratio moves', () => {
    const cache = emptyGeometryCache()
    const root = split('s', leaf('a'), leaf('b'))
    const first = cachedGeometry(cache, root, BOX)
    expect(cachedGeometry(cache, split('s', leaf('a'), leaf('b'), 'row', 0.7), BOX)).not.toBe(first)
    const after = cachedGeometry(cache, split('s', leaf('a'), leaf('b'), 'row', 0.7), BOX)
    expect(cachedGeometry(cache, root, { ...BOX, availW: 1200 })).not.toBe(after)
  })
})

describe('withLiveLeaves', () => {
  it('pairs the cached rects with the leaves as they stand now', () => {
    const cache = emptyGeometryCache()
    const cacheRoot = split('s', leaf('a'), leaf('b'))
    const geo = cachedGeometry(cache, cacheRoot, BOX)
    const live = split('s', { ...leaf('a'), zoom: 4 }, leaf('b'))
    const view = withLiveLeaves(geo, live)
    expect(view.leaves[0].node.zoom).toBe(4)
    // The rect objects are the cache's own: that identity is what keeps an
    // untouched pane out of the next render.
    expect(view.leaves[0].rect).toBe(geo.rects.get('a') as never)
    expect(view.leaves[1].rect).toBe(geo.rects.get('b') as never)
  })
})

describe('cachedSeams', () => {
  it('holds the map still while a photo is panned', () => {
    const cache = emptySeamsCache()
    const geoCache = emptyGeometryCache()
    const root = split('s', leaf('a'), leaf('b'))
    const geo = cachedGeometry(geoCache, root, BOX)
    const first = cachedSeams(cache, root, geo)
    const panned = split('s', { ...leaf('a'), zoom: 3, cx: 0.2 }, leaf('b'))
    expect(cachedSeams(cache, panned, geo)).toBe(first)
  })

  it('recomputes when a pane gains a photo, since that is what a seam reads', () => {
    const cache = emptySeamsCache()
    const geoCache = emptyGeometryCache()
    const empty = split('s', leaf('a', null), leaf('b'))
    const geo = cachedGeometry(geoCache, empty, BOX)
    const before = cachedSeams(cache, empty, geo)
    const filled = split('s', leaf('a'), leaf('b'))
    const after = cachedSeams(cache, filled, geo)
    expect(after).not.toBe(before)
    expect(before.get('b')).toEqual({ left: false, right: false, top: false, bottom: false })
    expect(after.get('b')).toEqual({ left: true, right: false, top: false, bottom: false })
  })
})
