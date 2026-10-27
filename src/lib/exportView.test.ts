/// <reference types="bun" />
import type { ExportView, Size } from './exportView'
import { describe, expect, it } from 'bun:test'
import {
  centerExportView,
  EXPORT_FIT,
  EXPORT_MINIMAP_ZOOM,
  EXPORT_ZOOM_CAP,
  exportFrame,
  exportMinimapSize,
  NO_IMAGE,
  panExportView,
  zoomExportView,
} from './exportView'

/** A 2048-long-side export in the dialog's measured stage: width-limited fit. */
const IMAGE: Size = { w: 2048, h: 1365 }
const BOX: Size = { w: 696, h: 560 }

/**
 * The object-contain box, restated from the requirement (the image fits inside
 * the box, one axis exact) rather than read back from the code under test.
 */
function contain(image: Size, box: Size): Size {
  const s = Math.min(box.w / image.w, box.h / image.h)
  return { w: image.w * s, h: image.h * s }
}

/** The image fraction under a viewport-local point, for a view at `scale`. */
function fractionUnder(view: ExportView, at: { x: number, y: number }) {
  const fit = contain(IMAGE, BOX)
  return {
    u: view.cx + (at.x - BOX.w / 2) / (fit.w * view.scale),
    v: view.cy + (at.y - BOX.h / 2) / (fit.h * view.scale),
  }
}

describe('the export view fit', () => {
  it('is centred, contained, and renders with no transform at all', () => {
    const frame = exportFrame(EXPORT_FIT, IMAGE, BOX)
    expect(frame.transform).toBeUndefined()
    expect(frame.window).toEqual({ x: 0, y: 0, w: 1, h: 1 })
    expect(frame.percent).toBe(100)
    expect(frame.zoomed).toBe(false)
    expect(frame.minimap).toBe(false)

    // Contained, one axis exact: at 1.5× the landscape export fills the box's
    // width, so its window width is 1/1.5 of the image.
    const landscape = exportFrame({ scale: 1.5, cx: 0.5, cy: 0.5 }, IMAGE, BOX)
    expect(landscape.window.w).toBeCloseTo(1 / 1.5, 6)
    // A portrait image in the same box is height-limited instead.
    const portrait = exportFrame({ scale: 1.5, cx: 0.5, cy: 0.5 }, { w: 1365, h: 2048 }, BOX)
    expect(portrait.window.h).toBeCloseTo(1 / 1.5, 6)
  })

  it('pins any off-centre view at scale 1 back to the centre', () => {
    expect(exportFrame({ scale: 1, cx: 0.9, cy: 0.1 }, IMAGE, BOX).view).toEqual(EXPORT_FIT)
    // A broken gesture's NaN cannot reach a render.
    expect(exportFrame({ scale: Number.NaN, cx: Number.NaN, cy: Number.NaN }, IMAGE, BOX).view).toEqual(EXPORT_FIT)
  })

  it('answers the unmeasured image and box with the fit frame', () => {
    for (const frame of [
      exportFrame(EXPORT_FIT, NO_IMAGE, BOX),
      exportFrame(EXPORT_FIT, IMAGE, { w: 0, h: 0 }),
    ]) {
      expect(frame.transform).toBeUndefined()
      expect(frame.window).toEqual({ x: 0, y: 0, w: 1, h: 1 })
      expect(frame.zoomed).toBe(false)
    }
  })
})

describe('zoomExportView', () => {
  it('keeps the image fraction under the anchor where it was', () => {
    const cases = [
      { factor: 1.25, anchor: { x: 348, y: 280 } },
      { factor: 2, anchor: { x: 261, y: 280 } },
      { factor: 2, anchor: { x: 600, y: 350 } },
      { factor: 2, anchor: { x: 348, y: 140 } },
      { factor: 1.5, anchor: { x: 261, y: 280 } },
    ]
    for (const { factor, anchor } of cases) {
      const view = zoomExportView(EXPORT_FIT, IMAGE, BOX, factor, anchor)
      const frame = exportFrame(view, IMAGE, BOX)
      // The result was not clamped: neither the ceiling nor the edge band moved
      // it, which is the case the identity promises.
      expect(frame.view.scale).toBeCloseTo(factor, 10)
      expect(frame.window.w).toBeLessThan(1)
      const was = fractionUnder(EXPORT_FIT, anchor)
      const now = fractionUnder(view, anchor)
      expect(now.u).toBeCloseTo(was.u, 6)
      expect(now.v).toBeCloseTo(was.v, 6)
    }
  })

  it('turns an anchor in the letterbox margin into the nearest legal view', () => {
    // Bottom-left margin: the fraction under it is off the image on the
    // vertical axis, on it horizontally.
    const anchor = { x: 8, y: 552 }
    const view = zoomExportView(EXPORT_FIT, IMAGE, BOX, 2, anchor)
    const frame = exportFrame(view, IMAGE, BOX)
    expect(fractionUnder(view, anchor).u).toBeCloseTo(fractionUnder(EXPORT_FIT, anchor).u, 6)
    expect(frame.window.y + frame.window.h).toBeCloseTo(1, 10)
  })

  it('lands 2× about a point left of centre on the worked numbers', () => {
    const view = zoomExportView(EXPORT_FIT, IMAGE, BOX, 2, { x: 261, y: 280 })
    expect(view.scale).toBe(2)
    // The anchor's fraction is 0.5 - 87/696 = 0.375; keeping it there at 2×
    // puts the VIEW CENTRE at 0.375 + 87/1392 = 0.4375.
    expect(view.cx).toBeCloseTo(0.4375, 10)
    expect(view.cy).toBeCloseTo(0.5, 10)
    const frame = exportFrame(view, IMAGE, BOX)
    expect(frame.window.x).toBeCloseTo(0.1875, 4)
    expect(frame.window.y).toBeCloseTo(0.1982, 4)
    expect(frame.window.w).toBeCloseTo(0.5, 10)
    expect(frame.window.h).toBeCloseTo(0.6036, 4)
    // The view centre sits left of the image centre, so the image shifts right.
    expect(frame.transform).toBe('translate(87px, 0px) scale(2)')
    expect(exportFrame(EXPORT_FIT, IMAGE, BOX).transform).toBeUndefined()
  })
})

describe('the clamp at the edges', () => {
  it('stops the view at the image edge at 2×', () => {
    const left = panExportView({ scale: 2, cx: 0.5, cy: 0.5 }, IMAGE, BOX, 1000, 0)
    expect(left.cx).toBeCloseTo(0.25, 10)
    expect(exportFrame(left, IMAGE, BOX).window.x).toBeCloseTo(0, 10)
    const right = panExportView({ scale: 2, cx: 0.5, cy: 0.5 }, IMAGE, BOX, -1000, 0)
    expect(right.cx).toBeCloseTo(0.75, 10)
    expect(exportFrame(right, IMAGE, BOX).window.x + exportFrame(right, IMAGE, BOX).window.w).toBeCloseTo(1, 10)
  })

  it('turns a tap on the map into a centre, never a scale', () => {
    const view = centerExportView({ scale: 2, cx: 0.5, cy: 0.5 }, IMAGE, BOX, 0, 1)
    expect(view.scale).toBe(2)
    expect(view.cx).toBeCloseTo(0.25, 10)
    expect(view.cy).toBeCloseTo(1 - exportFrame(view, IMAGE, BOX).window.h / 2, 10)
  })

  it('cannot zoom below fit, and a broken factor is a no-op', () => {
    expect(zoomExportView(EXPORT_FIT, IMAGE, BOX, 0.5, { x: 348, y: 280 })).toEqual(EXPORT_FIT)
    expect(zoomExportView(EXPORT_FIT, IMAGE, BOX, Number.NaN, { x: 348, y: 280 })).toEqual(EXPORT_FIT)
    expect(panExportView(EXPORT_FIT, IMAGE, BOX, 40, 40)).toEqual(EXPORT_FIT)
  })
})

describe('the ceiling is the native-pixel rule', () => {
  it('tops a 2048 export at one image pixel per CSS pixel', () => {
    // 696 / 2048 CSS px per image px at fit → 1 / 0.3398 ≈ 2.94.
    const top = zoomExportView(EXPORT_FIT, IMAGE, BOX, 100, { x: 348, y: 280 })
    expect(top.scale).toBeCloseTo(2.9425, 3)
  })

  it('caps a 6000 export at EXPORT_ZOOM_CAP', () => {
    const top = zoomExportView(EXPORT_FIT, { w: 6000, h: 4000 }, BOX, 100, { x: 348, y: 280 })
    expect(top.scale).toBe(EXPORT_ZOOM_CAP)
  })

  it('leaves a small export exactly as it is: no zoom, no chrome', () => {
    const small: Size = { w: 240, h: 240 }
    const top = zoomExportView(EXPORT_FIT, small, BOX, 100, { x: 348, y: 280 })
    expect(top).toEqual(EXPORT_FIT)
    const frame = exportFrame(top, small, BOX)
    expect(frame.zoomed).toBe(false)
    expect(frame.minimap).toBe(false)
    expect(frame.transform).toBeUndefined()
  })
})

describe('exportMinimapSize', () => {
  it('is the whole image at the cap, aspect exact', () => {
    expect(exportMinimapSize(IMAGE, { w: 72, h: 54 })).toEqual({ w: 72, h: 48 })
    expect(exportMinimapSize({ w: 200, h: 200 }, { w: 72, h: 54 })).toEqual({ w: 54, h: 54 })
    expect(exportMinimapSize({ w: 4000, h: 1000 }, { w: 72, h: 54 })).toEqual({ w: 72, h: 18 })
  })

  it('never collapses to zero and never upscales past the cap', () => {
    expect(exportMinimapSize({ w: 4000, h: 2 }, { w: 72, h: 54 })).toEqual({ w: 72, h: 1 })
    expect(exportMinimapSize({ w: 8, h: 8 }, { w: 72, h: 54 })).toEqual({ w: 54, h: 54 })
    expect(exportMinimapSize(NO_IMAGE, { w: 72, h: 54 })).toEqual({ w: 1, h: 1 })
  })
})

describe('the window and the transform agree', () => {
  const view: ExportView = zoomExportView(EXPORT_FIT, IMAGE, BOX, 2, { x: 261, y: 280 })

  it('puts the window centre on the view centre', () => {
    const frame = exportFrame(view, IMAGE, BOX)
    expect(frame.window.x + frame.window.w / 2).toBeCloseTo(frame.view.cx, 10)
    expect(frame.window.y + frame.window.h / 2).toBeCloseTo(frame.view.cy, 10)
  })

  it('maps the window top-left to the viewport top-left', () => {
    const frame = exportFrame(view, IMAGE, BOX)
    const at = fractionUnder(frame.view, { x: 0, y: 0 })
    expect(at.u).toBeCloseTo(frame.window.x, 6)
    expect(at.v).toBeCloseTo(frame.window.y, 6)
  })

  it('shows the map only past its own threshold', () => {
    const justUnder = exportFrame({ scale: EXPORT_MINIMAP_ZOOM - 0.01, cx: 0.5, cy: 0.5 }, IMAGE, BOX)
    expect(justUnder.zoomed).toBe(true)
    expect(justUnder.minimap).toBe(false)
    expect(exportFrame({ scale: EXPORT_MINIMAP_ZOOM + 0.01, cx: 0.5, cy: 0.5 }, IMAGE, BOX).minimap).toBe(true)
  })
})
