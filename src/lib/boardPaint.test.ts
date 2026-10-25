/// <reference types="bun" />
import type { Derived } from './layout'
import type { Leaf, Rect, SeamSides } from './panes'
import { describe, expect, it } from 'bun:test'
import { dividerBandStyle, dividerGripStyle, minimapStyles, minimapViewStyle, minimapVisible, paintBoard, paneBoxStyle, paneDraws, paneOutlineStyle, photoBoxStyle, photoTransform, stageMinimapSeat, transformOf } from './boardPaint'
import { newLeaf } from './panes'

function leaf(id: string, photoId: string | null = `ph-${id}`, zoom = 1): Leaf {
  return { ...newLeaf(), id, photoId, zoom }
}
function view(leaves: { node: Leaf, rect: Rect }[], gap = 0, fade = 8): Derived {
  return { W: 1000, H: 1000, leaves, dividers: [], gap, radius: 0, fade, unit: 1 }
}
const NO_SEAMS = new Map<string, SeamSides>()
const CELL: Rect = { x: 100, y: 50, w: 400, h: 300 }

describe('paneDraws', () => {
  it('draws the cell itself when the crossfade is off', () => {
    const draws = paneDraws(view([{ node: leaf('a'), rect: CELL }]), NO_SEAMS, false, 8, 100)
    expect(draws[0].draw).toBe(CELL)
    expect(draws[0].fade).toBe(8)
  })

  it('grows a photo pane into its seams when the crossfade is on', () => {
    const seams = new Map([['a', { left: true, right: false, top: false, bottom: false }]])
    const draws = paneDraws(view([{ node: leaf('a'), rect: CELL }]), seams, true, 8, 100)
    expect(draws[0].draw.x).toBeLessThan(CELL.x)
    expect(draws[0].draw.w).toBeGreaterThan(CELL.w)
    expect(draws[0].fade).toBeGreaterThan(0)
    expect(draws[0].seam).toEqual(seams.get('a'))
  })

  it('leaves an empty pane unfeathered under the crossfade, and unexpanded', () => {
    const seams = new Map([['a', { left: true, right: true, top: true, bottom: true }]])
    const draws = paneDraws(view([{ node: leaf('a', null), rect: CELL }]), seams, true, 8, 100)
    expect(draws[0].draw).toBe(CELL)
    expect(draws[0].fade).toBe(0)
  })

  it('feathers nothing when an intentional gutter turns the blend off', () => {
    const draws = paneDraws(view([{ node: leaf('a'), rect: CELL }], 12), NO_SEAMS, true, 8, 100)
    expect(draws[0].fade).toBe(0)
  })
})

describe('placement styles', () => {
  it('offsets the photo against the drawn box, not the cell', () => {
    const draw: Rect = { x: 90, y: 45, w: 420, h: 310 }
    const p = { x: 100, y: 50, scale: 2 }
    expect(transformOf(p, draw)).toBe('translate(10px, 5px) scale(2)')
    expect(transformOf(p, CELL)).toBe('translate(0px, 0px) scale(2)')
  })

  it('has no transform before the preview arrives', () => {
    expect(photoTransform(CELL, CELL, leaf('a'), 0, 0)).toBeNull()
    expect(photoTransform(CELL, CELL, leaf('a'), 800, 600)).toBe('translate(0px, 0px) scale(0.5)')
  })

  it('places a zoomed photo around its centre', () => {
    const box = photoBoxStyle(CELL, CELL, leaf('a', 'ph-a', 2), 800, 600)
    // cover fit at zoom 1 is 0.5; doubling the zoom doubles the placed box
    expect(box.width).toBeCloseTo(800, 6)
    expect(box.height).toBeCloseTo(600, 6)
    expect(box.left).toBeCloseTo((CELL.w - 800) / 2, 6)
  })

  it('boxes a pane at its drawn rect', () => {
    expect(paneBoxStyle({ x: 3, y: 4, w: 5, h: 6 })).toEqual({ left: 3, top: 4, width: 5, height: 6 })
  })

  it('fills the pane element with the outline when the box is the cell', () => {
    expect(paneOutlineStyle(CELL, CELL)).toEqual({ left: 0, top: 0, width: 400, height: 300 })
  })

  it('insets the outline to the cell inside a blend-grown box', () => {
    const grown: Rect = { x: 70, y: 30, w: 440, h: 340 }
    expect(paneOutlineStyle(CELL, grown)).toEqual({ left: 30, top: 20, width: 400, height: 300 })
  })
})

describe('minimapStyles', () => {
  it('windows the pane inside a zoomed photo, as photo fractions', () => {
    const m = minimapStyles(CELL, CELL, leaf('a', 'ph-a', 2), 800, 600)
    // the pane covers half the photo at zoom 2, centred: 0.25 .. 0.75
    expect(m.view.x).toBeCloseTo(0.25, 6)
    expect(m.view.w).toBeCloseTo(0.5, 6)
    expect(m.box.width).toBeCloseTo(CELL.w, 6)
  })

  it('clamps the window clear of the tools sheet', () => {
    const full = minimapStyles(CELL, CELL, leaf('a', 'ph-a', 1), 800, 600)
    const trimmed = minimapStyles(CELL, CELL, leaf('a', 'ph-a', 1), 800, 600, 120)
    expect(trimmed.box.height).toBeLessThan(full.box.height)
    expect(trimmed.box.height).toBeCloseTo(120, 6)
  })

  it('writes the window as percentages', () => {
    expect(minimapViewStyle({ x: 0.25, y: 0, w: 0.5, h: 1 }))
      .toEqual({ left: '25%', top: '0%', width: '50%', height: '100%' })
  })
})

describe('minimapVisible', () => {
  const base = { zoom: 2, previewUrl: 'blob:x', boxWidth: 400 }

  it('seats an overflowing pane with a preview wide enough for the chip', () => {
    expect(minimapVisible({ ...base, placement: 'pane' })).toBe(true)
    expect(minimapVisible({ ...base, placement: 'pane', boxWidth: 259 })).toBe(false)
  })

  it('needs an overflow and a preview in either placement', () => {
    expect(minimapVisible({ ...base, placement: 'pane', zoom: 1.05 })).toBe(false)
    expect(minimapVisible({ ...base, placement: 'stage', zoom: 1.05 })).toBe(false)
    expect(minimapVisible({ ...base, placement: 'stage', previewUrl: undefined })).toBe(false)
  })

  it('ignores the pane width on the stage, where the seat is fixed', () => {
    expect(minimapVisible({ ...base, placement: 'stage', boxWidth: 40 })).toBe(true)
  })
})

describe('stageMinimapSeat', () => {
  it('seats the chip above the dock\'s top edge, inset from its left', () => {
    const seat = stageMinimapSeat({ left: 0, top: 660 }, { left: 0, bottom: 812 })
    expect(seat).toEqual({ left: 10, bottom: 160 })
    expect(812 - seat.bottom).toBe(660 - 8)
  })

  it('measures the dock in stage coordinates, not the viewport\'s', () => {
    expect(stageMinimapSeat({ left: 100, top: 500 }, { left: 40, bottom: 800 }))
      .toEqual({ left: 70, bottom: 308 })
  })
})

describe('divider chrome', () => {
  const divider = { id: 's', dir: 'row' as const, ratio: 0.5, area: { x: 0, y: 0, w: 1000, h: 600 }, gap: 0 }

  it('bands a row divider down the line, as wide as the hit area', () => {
    const band = dividerBandStyle(divider, 15)
    expect(band).toEqual({ left: 500 - 7.5, top: 0, width: 15, height: 600 })
  })

  it('grips the line at its midpoint', () => {
    expect(dividerGripStyle(divider)).toEqual({ left: 500, top: 300 })
    expect(dividerGripStyle({ ...divider, dir: 'column' })).toEqual({ left: 500, top: 300 })
  })
})

describe('paintBoard', () => {
  // A DOM stand-in: the painter only touches `style`, `dataset` and queries.
  function fakeElement(dataset: Record<string, string> = {}) {
    const style: Record<string, string> = {}
    return {
      style: { setProperty: (k: string, v: string) => { style[k] = v } },
      dataset,
      children: [] as unknown[],
      querySelector: () => null,
      written: style,
    }
  }

  it('writes pane boxes and divider chrome, in px', () => {
    const pane = fakeElement({ paneId: 'a' })
    const outline = fakeElement({ paneOutline: 'a' })
    const band = fakeElement({})
    const grip = fakeElement({})
    paintBoard(
      { panes: new Map([['a', pane as never]]), outlines: new Map([['a', outline as never]]), bands: new Map([['s', band as never]]), grips: new Map([['s', grip as never]]) },
      paneDraws(view([{ node: leaf('a'), rect: CELL }]), NO_SEAMS, false, 8, 100),
      [{ id: 's', dir: 'row', ratio: 0.5, area: { x: 0, y: 0, w: 1000, h: 600 }, gap: 0 }],
      15,
    )
    expect(pane.written).toEqual({ left: '100px', top: '50px', width: '400px', height: '300px' })
    expect(outline.written).toEqual({ left: '0px', top: '0px', width: '400px', height: '300px' })
    expect(band.written).toEqual({ left: '492.5px', top: '0px', width: '15px', height: '600px' })
    expect(grip.written).toEqual({ left: '500px', top: '300px' })
  })

  it('keeps the outline on the cell while the crossfade grows the pane box', () => {
    const pane = fakeElement({ paneId: 'a' })
    const outline = fakeElement({ paneOutline: 'a' })
    const seams = new Map([['a', { left: true, right: false, top: false, bottom: false }]])
    paintBoard(
      { panes: new Map([['a', pane as never]]), outlines: new Map([['a', outline as never]]), bands: new Map(), grips: new Map() },
      paneDraws(view([{ node: leaf('a'), rect: CELL }]), seams, true, 60, 100),
      [],
      15,
    )
    // The pane grew 30px into its left seam; the outline still spans the cell.
    expect(pane.written).toEqual({ left: '70px', top: '50px', width: '430px', height: '300px' })
    expect(outline.written).toEqual({ left: '30px', top: '0px', width: '400px', height: '300px' })
  })

  it('skips a pane it has no element for', () => {
    expect(() =>
      paintBoard({ panes: new Map(), outlines: new Map(), bands: new Map(), grips: new Map() }, paneDraws(view([{ node: leaf('a'), rect: CELL }]), NO_SEAMS, false, 0, 0), [], 15),
    ).not.toThrow()
  })
})
