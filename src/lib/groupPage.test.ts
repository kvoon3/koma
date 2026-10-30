/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { pageFalloff, pageOffset, pageRestOffset, pageStep, pageTargetIndex, pageTravel, tilesLayout } from './groupPage'

const PHONE = { stageW: 375, stageH: 812, dockBand: 107, coarse: true, ratio: 1, gridGap: 10 }
const DESKTOP = { stageW: 1280, stageH: 900, dockBand: 107, coarse: false, ratio: 1, gridGap: 10 }
const SHORT = { stageW: 1280, stageH: 600, dockBand: 107, coarse: false, ratio: 1, gridGap: 10 }
const LANDSCAPE = { stageW: 915, stageH: 412, dockBand: 107, coarse: true, ratio: 1, gridGap: 10 }

describe('tilesLayout at the four sizes (three groups, plus the add tile)', () => {
  test('375x812 is two columns of 159', () => {
    const l = tilesLayout({ ...PHONE, count: 3 })
    expect(l.floor).toBe(705)
    expect(l.headerH).toBe(56)
    expect(l.columns).toBe(2)
    expect(l.rows).toBe(2)
    expect(l.slots).toBe(4)
    expect(l.tile).toBe(159)
    expect(l.gap).toBe(24)
    expect(l.tiles).toEqual([
      { x: 17, y: 210, w: 159, h: 159 },
      { x: 200, y: 210, w: 159, h: 159 },
      { x: 17, y: 393, w: 159, h: 159 },
      { x: 200, y: 393, w: 159, h: 159 },
    ])
    expect(l.matte).toBe(16)
    expect(l.board).toEqual({ w: 127, h: 127 })
    expect(l.cell).toEqual({ w: 35, h: 35 })
    expect(l.boardGap).toBe(10)
    expect(l.radius).toBe(20)
    expect(l.check).toBe(25)
    expect(l.done).toEqual({ top: 10, right: 16, w: 80, h: 36 })
  })

  test('1280x900 is one row of four 264 tiles', () => {
    const l = tilesLayout({ ...DESKTOP, count: 3 })
    expect(l.columns).toBe(4)
    expect(l.rows).toBe(1)
    expect(l.slots).toBe(4)
    expect(l.tile).toBe(264)
    expect(l.tiles).toEqual([
      { x: 64, y: 297, w: 264, h: 264 },
      { x: 360, y: 297, w: 264, h: 264 },
      { x: 656, y: 297, w: 264, h: 264 },
      { x: 952, y: 297, w: 264, h: 264 },
    ])
    expect(l.matte).toBe(16)
    expect(l.board).toEqual({ w: 232, h: 232 })
    expect(l.cell).toEqual({ w: 70, h: 70 })
    expect(l.radius).toBe(21)
    expect(l.check).toBe(36)
    expect(l.done).toEqual({ top: 10, right: 64, w: 80, h: 36 })
  })

  test('1280x600 keeps the 264 row, higher up', () => {
    const l = tilesLayout({ ...SHORT, count: 3 })
    expect(l.tile).toBe(264)
    expect(l.tiles).toEqual([
      { x: 64, y: 147, w: 264, h: 264 },
      { x: 360, y: 147, w: 264, h: 264 },
      { x: 656, y: 147, w: 264, h: 264 },
      { x: 952, y: 147, w: 264, h: 264 },
    ])
  })

  test('915x412 fits two rows at the 96px floor', () => {
    const l = tilesLayout({ ...LANDSCAPE, count: 3 })
    expect(l.columns).toBe(3)
    expect(l.rows).toBe(2)
    expect(l.tile).toBe(96)
    expect(l.tiles).toEqual([
      { x: 282, y: 73, w: 96, h: 96 },
      { x: 410, y: 73, w: 96, h: 96 },
      { x: 538, y: 73, w: 96, h: 96 },
      { x: 282, y: 201, w: 96, h: 96 },
    ])
    expect(l.matte).toBe(16)
    expect(l.board).toEqual({ w: 64, h: 64 })
    expect(l.cell).toEqual({ w: 14, h: 14 })
    expect(l.radius).toBe(20)
    expect(l.check).toBe(24)
  })

  test('a full bar drops the add tile', () => {
    const l = tilesLayout({ ...PHONE, count: 4 })
    expect(l.slots).toBe(4)
    expect(l.tiles).toHaveLength(4)
    const desktop = tilesLayout({ ...DESKTOP, count: 4 })
    expect(desktop.slots).toBe(4)
    expect(desktop.tiles).toHaveLength(4)
  })

  test('an empty or unmeasured stage lays out no tiles', () => {
    expect(tilesLayout({ ...PHONE, count: 3, stageW: 0, stageH: 0 }).tiles).toEqual([])
    expect(tilesLayout({ ...PHONE, count: 3, stageW: 0, stageH: 0 }).tile).toBe(0)
  })
})

describe('tilesLayout invariants', () => {
  const sizes = [PHONE, DESKTOP, SHORT, LANDSCAPE, { stageW: 320, stageH: 537, dockBand: 107, coarse: true, ratio: 1, gridGap: 10 }, { stageW: 360, stageH: 609, dockBand: 107, coarse: true, ratio: 1, gridGap: 10 }]

  test('tiles clear the header and the dock, stay in the stage, and hold every group plus the add slot', () => {
    for (const size of sizes) {
      for (let count = 1; count <= 4; count++) {
        for (const ratio of [1, 1.5]) {
          const l = tilesLayout({ ...size, ratio, count })
          expect(l.slots).toBe(count + (count < 4 ? 1 : 0))
          expect(l.tiles).toHaveLength(l.slots)
          expect(l.tile).toBeGreaterThanOrEqual(96)
          for (const tile of l.tiles) {
            expect(tile.w).toBe(l.tile)
            expect(tile.h).toBe(l.tile)
            expect(tile.x).toBeGreaterThanOrEqual(0)
            expect(tile.x + tile.w).toBeLessThanOrEqual(l.stageW)
            expect(tile.y).toBeGreaterThanOrEqual(l.headerH)
            expect(tile.y + tile.h).toBeLessThanOrEqual(l.floor)
          }
          expect(3 * l.cell.w + 2 * l.boardGap).toBeLessThanOrEqual(l.board.w)
          expect(3 * l.cell.h + 2 * l.boardGap).toBeLessThanOrEqual(l.board.h)
        }
      }
    }
  })

  test('the grid is centred as one block', () => {
    for (const size of sizes) {
      const l = tilesLayout({ ...size, count: 2 })
      const left = l.tiles[0].x
      const right = Math.max(...l.tiles.map(tile => tile.x + tile.w))
      expect(Math.abs(left - (l.stageW - right))).toBeLessThanOrEqual(1)
      expect(l.tiles[1].x - (left + l.tile)).toBe(l.gap)
    }
  })
})

describe('pageFalloff', () => {
  test('the endpoints and the quarter points', () => {
    expect(pageFalloff(0, false)).toEqual({ opacity: 1, scale: 1 })
    expect(pageFalloff(1, false)).toEqual({ opacity: 0.5, scale: 0.94 })
    const third = pageFalloff(1 / 3, false)
    expect(third.opacity).toBeCloseTo(0.8704, 4)
    expect(third.scale).toBeCloseTo(0.9844, 4)
    const half = pageFalloff(0.5, false)
    expect(half.opacity).toBeCloseTo(0.75, 4)
    expect(half.scale).toBeCloseTo(0.97, 4)
    const twoThirds = pageFalloff(2 / 3, false)
    expect(twoThirds.opacity).toBeCloseTo(0.6296, 4)
    expect(twoThirds.scale).toBeCloseTo(0.9556, 4)
  })

  test('it clamps past the ends and never brightens as it moves away', () => {
    expect(pageFalloff(4, false)).toEqual(pageFalloff(1, false))
    expect(pageFalloff(-4, false)).toEqual(pageFalloff(0, false))
    let last = 2
    for (let d = 0; d <= 1; d += 0.05) {
      const f = pageFalloff(d, false)
      expect(f.opacity).toBeLessThanOrEqual(last)
      last = f.opacity
    }
  })

  test('reduced motion keeps the fade but drops the scale', () => {
    expect(pageFalloff(1, true)).toEqual({ opacity: 0.5, scale: 1 })
    expect(pageFalloff(1 / 3, true).scale).toBe(1)
  })
})

const T = 400

describe('pageTravel', () => {
  test('a page is the board plus its air', () => {
    expect(pageTravel(300, 24)).toBe(324)
    expect(pageTravel(327, 24)).toBe(351)
  })
})

describe('pageOffset', () => {
  test('tracks the pointer 1:1 inside a page', () => {
    expect(pageOffset(0, T, true, true)).toBe(0)
    expect(pageOffset(37, T, true, true)).toBe(37)
    expect(pageOffset(-37, T, true, true)).toBe(-37)
    expect(pageOffset(T, T, true, true)).toBe(T)
    expect(pageOffset(-T, T, true, true)).toBe(-T)
  })

  test('stops at one page both ways, and rubber-bands at an end', () => {
    expect(pageOffset(T * 3, T, true, true)).toBe(T)
    expect(pageOffset(-T * 3, T, true, true)).toBe(-T)
    expect(pageOffset(5, T, false, true)).toBeCloseTo(1.5, 1)
    expect(pageOffset(-5, T, true, false)).toBeCloseTo(-1.5, 1)
    expect(pageOffset(1e6, T, false, false)).toBeLessThan(T * 0.35)
    expect(pageOffset(-1e6, T, false, false)).toBeGreaterThan(-T * 0.35)
    expect(pageOffset(300, T, false, false)).toBeGreaterThan(pageOffset(100, T, false, false))
  })
})

describe('pageStep / pageRestOffset', () => {
  test('stays under half and goes where it leans past half', () => {
    expect(pageStep(0.4 * T, 0, T, true, true)).toBe(0)
    expect(pageStep(-0.4 * T, 0, T, true, true)).toBe(0)
    expect(pageStep(0.6 * T, 0, T, true, true)).toBe(-1)
    expect(pageStep(-0.6 * T, 0, T, true, true)).toBe(1)
  })

  test('a flick carries one page, and a flick back settles home', () => {
    expect(pageStep(0.1 * T, 900, T, true, true)).toBe(-1)
    expect(pageStep(-0.1 * T, -900, T, true, true)).toBe(1)
    expect(pageStep(0.45 * T, -900, T, true, true)).toBe(0)
    expect(pageStep(-0.45 * T, 900, T, true, true)).toBe(0)
  })

  test('an end has nowhere to go', () => {
    expect(pageStep(0.8 * T, 2000, T, false, true)).toBe(0)
    expect(pageStep(-0.8 * T, -2000, T, true, false)).toBe(0)
  })

  test('a step rests home or one page over', () => {
    expect(pageRestOffset(0, T)).toBe(0)
    expect(pageRestOffset(1, T)).toBe(-T)
    expect(pageRestOffset(-1, T)).toBe(T)
  })
})

describe('pageTargetIndex', () => {
  test('is the active board at rest and follows the drag', () => {
    expect(pageTargetIndex(0, T, 1, 3)).toBe(1)
    expect(pageTargetIndex(-0.6 * T, T, 1, 3)).toBe(2)
    expect(pageTargetIndex(0.6 * T, T, 1, 3)).toBe(0)
  })

  test('clamps to the row', () => {
    expect(pageTargetIndex(-5000, T, 1, 3)).toBe(2)
    expect(pageTargetIndex(5000, T, 1, 3)).toBe(0)
    expect(pageTargetIndex(0, 0, 2, 0)).toBe(0)
  })
})
