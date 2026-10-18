/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { clampViewScale, fitView, maskEditSize, MAX_VIEW_SCALE, MIN_VIEW_SCALE, panView, viewToMask, zoomView } from './stickerMask'

describe('mask edit size', () => {
  test('never upscales, caps the long edge, keeps the aspect', () => {
    expect(maskEditSize(400, 300)).toEqual({ width: 400, height: 300 })
    expect(maskEditSize(2048, 1024)).toEqual({ width: 1024, height: 512 })
    expect(maskEditSize(1024, 4096)).toEqual({ width: 256, height: 1024 })
    // A one-pixel frame stays drawable rather than collapsing to zero.
    expect(maskEditSize(0, 0)).toEqual({ width: 1, height: 1 })
  })
})

describe('the mask view transform', () => {
  test('fit centres the artwork in the box, touching one side', () => {
    const view = fitView(1000, 500, 400, 300)
    // Height is the tighter axis: 300/500 = 0.6, 400/1000 = 0.4 → 300 wins,
    // except 0.6 × 1000 = 600 > 400, so the width is the tighter one.
    expect(view.scale).toBeCloseTo(0.4, 6)
    expect(view.x).toBeCloseTo(0, 6)
    expect(view.y).toBeCloseTo((300 - 500 * 0.4) / 2, 6)
    const topLeft = viewToMask(view, view.x, view.y)
    expect(topLeft).toEqual({ x: 0, y: 0 })
    const bottomRight = viewToMask(view, view.x + 1000 * view.scale, view.y + 500 * view.scale)
    expect(bottomRight.x).toBeCloseTo(1000, 6)
    expect(bottomRight.y).toBeCloseTo(500, 6)
  })

  test('zoom keeps the anchor pixel under the cursor', () => {
    const view = fitView(800, 800, 400, 400)
    const anchor = { x: 310, y: 120 }
    const before = viewToMask(view, anchor.x, anchor.y)
    for (const factor of [1.25, 0.5, 3]) {
      const zoomed = zoomView(view, factor, anchor)
      const after = viewToMask(zoomed, anchor.x, anchor.y)
      expect(after.x).toBeCloseTo(before.x, 6)
      expect(after.y).toBeCloseTo(before.y, 6)
      expect(zoomed.scale).toBeCloseTo(view.scale * factor, 6)
    }
  })

  test('zoom clamps at both ends instead of inverting or vanishing', () => {
    const view = fitView(100, 100, 400, 400)
    expect(zoomView(view, 1e6, { x: 0, y: 0 }).scale).toBe(MAX_VIEW_SCALE)
    expect(zoomView(view, 0, { x: 0, y: 0 }).scale).toBe(MIN_VIEW_SCALE)
    expect(clampViewScale(1)).toBe(1)
  })

  test('pan moves the artwork with the pointer, 1:1 in display pixels', () => {
    const view = fitView(200, 200, 400, 400)
    const panned = panView(view, 30, -12)
    expect(panned.x).toBe(view.x + 30)
    expect(panned.y).toBe(view.y - 12)
    expect(panned.scale).toBe(view.scale)
    const a = viewToMask(view, 40, 40)
    const b = viewToMask(panned, 70, 28)
    expect(b.x).toBeCloseTo(a.x, 6)
    expect(b.y).toBeCloseTo(a.y, 6)
  })
})
