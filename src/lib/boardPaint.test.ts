/// <reference types="bun" />
import type { Derived } from './layout'
import type { Leaf, Rect, SeamSides } from './panes'
import { describe, expect, it } from 'bun:test'
import { CROP_MASK_DIM, cropSpillStyles, dividerBandStyle, dividerGripStyle, minimapStyles, minimapViewStyle, minimapVisible, paintBoard, paneBoxStyle, paneDraws, paneOutlineStyle, photoBoxStyle, photoTransform, stageMinimapSeat, transformOf } from './boardPaint'
import { newLeaf, paneTransform, paneTransformCss, placement } from './panes'

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
      closest: () => null,
      written: style,
    }
  }

  it('writes pane boxes and divider chrome, in px', () => {
    const pane = fakeElement({ paneId: 'a' })
    const outline = fakeElement({ paneOutline: 'a' })
    const band = fakeElement({})
    const grip = fakeElement({})
    paintBoard(
      { panes: new Map([['a', pane as never]]), outlines: new Map([['a', outline as never]]), spills: new Map(), bands: new Map([['s', band as never]]), grips: new Map([['s', grip as never]]) },
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
      { panes: new Map([['a', pane as never]]), outlines: new Map([['a', outline as never]]), spills: new Map(), bands: new Map(), grips: new Map() },
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
      paintBoard({ panes: new Map(), outlines: new Map(), spills: new Map(), bands: new Map(), grips: new Map() }, paneDraws(view([{ node: leaf('a'), rect: CELL }]), NO_SEAMS, false, 0, 0), [], 15),
    ).not.toThrow()
  })

  it('moves the crop preview hole with the cell, from the pane\'s own preview size', () => {
    const pane = fakeElement({ paneId: 'a', photoW: '800', photoH: '600' })
    const spill = fakeElement({ cropSpill: 'a' })
    paintBoard(
      { panes: new Map([['a', pane as never]]), outlines: new Map(), spills: new Map([['a', spill as never]]), bands: new Map(), grips: new Map() },
      paneDraws(view([{ node: leaf('a'), rect: CELL }]), NO_SEAMS, false, 8, 100),
      [],
      15,
    )
    // The painter speaks CSS: `assign` hyphenates every property name.
    expect(spill.written['mask-size']).toBe('100% 100%, 400px 300px')
    expect(spill.written['mask-position']).toBe('0 0, 100px 50px')
  })

  it('leaves a spill alone when the pane has no preview size yet', () => {
    const pane = fakeElement({ paneId: 'a' })
    const spill = fakeElement({ cropSpill: 'a' })
    paintBoard(
      { panes: new Map([['a', pane as never]]), outlines: new Map(), spills: new Map([['a', spill as never]]), bands: new Map(), grips: new Map() },
      paneDraws(view([{ node: leaf('a'), rect: CELL }]), NO_SEAMS, false, 8, 100),
      [],
      15,
    )
    expect(spill.written).toEqual({})
  })
})

describe('cropSpillStyles', () => {
  /** The mask's second layer: the hole, which must sit on the drawn box. */
  const hole = (style: Record<string, string | number>) => {
    const [size, position] = [String(style.maskSize).split(', ')[1], String(style.maskPosition).split(', ')[1]]
    return { size, position }
  }

  const upright = (): Leaf => ({ ...newLeaf(), id: 'a', photoId: 'ph-a' })

  it('dims at one constant, and punches the hole where the pane paints', () => {
    const cell: Rect = { x: 100, y: 50, w: 400, h: 300 }
    const draw: Rect = { x: 70, y: 50, w: 430, h: 300 }
    const s = cropSpillStyles(cell, draw, upright(), 800, 600)!
    expect(CROP_MASK_DIM).toBe(0.3)
    expect(hole(s.mask)).toEqual({ size: '430px 300px', position: '70px 50px' })
    expect(s.mask.maskRepeat).toBe('no-repeat, no-repeat')
    expect(s.mask.maskComposite).toBe('exclude')
    expect(s.mask.WebkitMaskComposite).toBe('xor')
    expect(s.mask.maskImage).toBe('linear-gradient(#000,#000), linear-gradient(#000,#000)')
    expect(s.mask.WebkitMaskImage).toBe(s.mask.maskImage)
  })

  it('never lets the hole collapse into the full layer', () => {
    const cell: Rect = { x: 100, y: 50, w: 400, h: 300 }
    const draw: Rect = { x: 70, y: 50, w: 430, h: 300 }
    const s = cropSpillStyles(cell, draw, upright(), 800, 600)!
    expect(hole(s.mask).size).not.toBe('100% 100%')
    expect(hole(s.mask).size).toBe(`${draw.w}px ${draw.h}px`)
  })

  it('has no spill before the preview decodes', () => {
    expect(cropSpillStyles(CELL, CELL, upright(), 0, 0)).toBeNull()
    expect(cropSpillStyles(CELL, CELL, upright(), 800, 0)).toBeNull()
  })

  it('places the photo against the cell and only offsets against the drawn box', () => {
    const draw: Rect = { x: 70, y: 50, w: 430, h: 300 }
    const l = upright()
    const s = cropSpillStyles(CELL, draw, l, 800, 600)!
    const place = placement(CELL, l, 800, 600)
    const cx = draw.x + draw.w / 2
    const cy = draw.y + draw.h / 2
    const expected = `translate(${cx}px, ${cy}px) ${paneTransformCss(paneTransform(draw, l))} translate(${-cx}px, ${-cy}px) translate(${place.x}px, ${place.y}px) scale(${place.scale})`
    expect(s.img.transform).toBe(expected)
    expect(s.img.transform).toContain(`translate(${place.x}px, ${place.y}px) scale(${place.scale})`)
    expect(s.img.transformOrigin).toBe('0 0')
  })

  it('maps photo-space points exactly as the pane\'s own DOM does', () => {
    // The pane composes three boxes: its shell, a turn wrapper filling it
    // (origin at its centre), and the img inside. The spill is one
    // canvas-anchored img, so its string must reproduce that product. Upright
    // leaves included: the turn segment is always emitted, and identity is a
    // no-op.
    type M = [number, number, number, number, number, number]
    const mul = (a: M, b: M): M => [
      a[0] * b[0] + a[2] * b[1],
      a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3],
      a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4],
      a[1] * b[4] + a[3] * b[5] + a[5],
    ]
    const T = (x: number, y: number): M => [1, 0, 0, 1, x, y]
    const S = (x: number, y: number): M => [x, 0, 0, y, 0, 0]
    const R = (r: number): M => [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]
    const map = (m: M, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

    /** The pane's real structure, as `Pane.tsx` builds it. */
    const paneMatrix = (cell: Rect, draw: Rect, l: Leaf, iw: number, ih: number): M => {
      const place = placement(cell, l, iw, ih)
      const turn = paneTransform(draw, l)
      const turnBox = mul(mul(T(draw.w / 2, draw.h / 2), mul(mul(R(turn.rot), S(turn.scaleX, turn.scaleY)), T(-draw.w / 2, -draw.h / 2))), mul(T(place.x - draw.x, place.y - draw.y), S(place.scale, place.scale)))
      return mul(T(draw.x, draw.y), turnBox)
    }
    /**
     * The spill's emitted string, parsed segment by segment. The string is the
     * artifact under test, so the parser reads it rather than rebuilding the
     * same product the implementation computes.
     */
    const spillMatrix = (cell: Rect, draw: Rect, l: Leaf, iw: number, ih: number): M => {
      const css = String(cropSpillStyles(cell, draw, l, iw, ih)!.img.transform)
      const segments = css.match(/(translate|rotate|scale)\([^)]*\)/g) ?? []
      expect(segments.map(segment => segment.slice(0, segment.indexOf('(')))).toEqual(['translate', 'rotate', 'scale', 'translate', 'translate', 'scale'])
      return segments.reduce<M>((acc, segment) => {
        const numbers = (segment.match(/-?[\d.]+/g) ?? []).map(Number)
        const name = segment.slice(0, segment.indexOf('('))
        if (name === 'rotate')
          return mul(acc, R(numbers[0]!))
        if (name === 'scale')
          return mul(acc, S(numbers[0]!, numbers[1] ?? numbers[0]!))
        return mul(acc, T(numbers[0]!, numbers[1]!))
      }, [1, 0, 0, 1, 0, 0])
    }

    const cell: Rect = { x: 100, y: 50, w: 400, h: 300 }
    const draw: Rect = { x: 70, y: 50, w: 430, h: 300 }
    const cases: Leaf[] = [
      upright(),
      { ...upright(), rot: 0.35 },
      { ...upright(), flipX: true },
      { ...upright(), rot: -1.1, flipY: true, zoom: 1.8 },
      { ...upright(), rot: 2.5, flipX: true, flipY: true, zoom: 2.4 },
    ]
    for (const l of cases) {
      const a = paneMatrix(cell, draw, l, 800, 600)
      const b = spillMatrix(cell, draw, l, 800, 600)
      for (const [x, y] of [[0, 0], [800, 600], [123, 456]]) {
        const [ax, ay] = map(a, x, y)
        const [bx, by] = map(b, x, y)
        expect(ax).toBeCloseTo(bx, 8)
        expect(ay).toBeCloseTo(by, 8)
      }
    }
  })

  it('puts the turn about the drawn box\'s centre, not the cell\'s', () => {
    // A hole-at-cell turn would land the spill a seam-width away from the photo.
    const draw: Rect = { x: 70, y: 50, w: 430, h: 300 }
    const l = { ...upright(), rot: 0.5 }
    const s = cropSpillStyles(CELL, draw, l, 800, 600)!
    expect(s.img.transform).toContain(`translate(${draw.x + draw.w / 2}px, ${draw.y + draw.h / 2}px)`)
    const offCentre = `translate(${CELL.x + CELL.w / 2}px, ${CELL.y + CELL.h / 2}px) ${paneTransformCss(paneTransform(draw, l))}`
    expect(String(s.img.transform).startsWith(offCentre)).toBe(false)
  })
})
