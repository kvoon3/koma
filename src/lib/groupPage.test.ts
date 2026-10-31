/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { pageFalloff, pageOffset, pageRestOffset, pageStep, pageTargetIndex, pageTravel, tilesLayout, tileWiggle } from './groupPage'

const PHONE = { stageW: 375, coarse: true, ratio: 1, gridGap: 10 }
const DESKTOP = { stageW: 1280, coarse: false, ratio: 1, gridGap: 10 }
const LANDSCAPE = { stageW: 915, coarse: true, ratio: 1, gridGap: 10 }

describe('tilesLayout, one scrolling grid (seven groups)', () => {
  test('375 keeps two columns and wraps four rows the page scrolls through', () => {
    const l = tilesLayout({ ...PHONE, count: 7 })
    expect(l.headerH).toBe(56)
    expect(l.columns).toBe(2)
    expect(l.rows).toBe(4)
    expect(l.board).toEqual({ w: 158, h: 158 })
    expect(l.cell).toEqual({ w: 46, h: 46 })
    expect(l.boardGap).toBe(10)
    expect(l.checkRow).toBe(36)
    expect(l.check).toBe(22)
    // Four rows of (tile + check) plus gaps and air: taller than any phone
    // stage, which is the scrolling.
    expect(l.contentH).toBe(4 * (158 + 36) + 3 * 24 + 2 * 12)
    expect(l.tiles).toEqual([
      { x: 18, y: 12, w: 158, h: 158 },
      { x: 200, y: 12, w: 158, h: 158 },
      { x: 18, y: 230, w: 158, h: 158 },
      { x: 200, y: 230, w: 158, h: 158 },
      { x: 18, y: 448, w: 158, h: 158 },
      { x: 200, y: 448, w: 158, h: 158 },
      { x: 18, y: 666, w: 158, h: 158 },
    ])
    expect(l.done).toEqual({ top: 10, right: 16, w: 80, h: 36 })
    expect(l.add).toEqual({ top: 10, right: 104, w: 36, h: 36 })
  })

  test('1280 is capped at four columns, so seven groups wrap two rows', () => {
    const l = tilesLayout({ ...DESKTOP, count: 7 })
    expect(l.columns).toBe(4)
    expect(l.rows).toBe(2)
    expect(l.board).toEqual({ w: 263, h: 263 })
    expect(l.cell).toEqual({ w: 81, h: 81 })
    expect(l.checkRow).toBe(28)
    expect(l.contentH).toBe(2 * (263 + 28) + 32 + 2 * 8)
    expect(l.tiles).toEqual([
      { x: 66, y: 8, w: 263, h: 263 },
      { x: 361, y: 8, w: 263, h: 263 },
      { x: 656, y: 8, w: 263, h: 263 },
      { x: 951, y: 8, w: 263, h: 263 },
      { x: 66, y: 331, w: 263, h: 263 },
      { x: 361, y: 331, w: 263, h: 263 },
      { x: 656, y: 331, w: 263, h: 263 },
    ])
    expect(l.done).toEqual({ top: 10, right: 64, w: 80, h: 36 })
    expect(l.add).toEqual({ top: 10, right: 152, w: 36, h: 36 })
  })

  test('915 keeps three columns once the height no longer has a say', () => {
    const l = tilesLayout({ ...LANDSCAPE, count: 7 })
    expect(l.columns).toBe(3)
    expect(l.rows).toBe(3)
    expect(l.board).toEqual({ w: 239, h: 239 })
    expect(l.cell).toEqual({ w: 73, h: 73 })
    expect(l.contentH).toBe(3 * (239 + 36) + 2 * 32 + 2 * 8)
    expect(l.tiles[0]).toEqual({ x: 67, y: 8, w: 239, h: 239 })
    expect(l.tiles[3]).toEqual({ x: 67, y: 315, w: 239, h: 239 })
  })

  test('adding groups wraps rows, it never shrinks the tile', () => {
    const few = tilesLayout({ ...PHONE, count: 3 })
    expect(few.rows).toBe(2)
    expect(few.board).toEqual({ w: 158, h: 158 })
    for (const count of [5, 9, 30]) {
      const l = tilesLayout({ ...PHONE, count })
      expect(l.columns).toBe(2)
      expect(l.rows).toBe(Math.ceil(count / 2))
      expect(l.board).toEqual({ w: 158, h: 158 })
      expect(l.contentH).toBe(Math.ceil(count / 2) * (158 + 36) + (Math.ceil(count / 2) - 1) * 24 + 24)
      expect(l.tiles).toHaveLength(count)
    }
  })

  test('a wide stage stays at four columns', () => {
    expect(tilesLayout({ stageW: 2560, coarse: false, ratio: 1, gridGap: 10, count: 9 }).columns).toBe(4)
  })

  test('a stage too narrow for two floor-sized tiles pays for one column', () => {
    const l = tilesLayout({ stageW: 240, coarse: true, ratio: 1, gridGap: 10, count: 3 })
    expect(l.columns).toBe(1)
    expect(l.rows).toBe(3)
    expect(l.board.w).toBeGreaterThanOrEqual(96)
  })

  test('an empty or unmeasured stage lays out no tiles', () => {
    expect(tilesLayout({ ...PHONE, count: 3, stageW: 0 }).tiles).toEqual([])
    expect(tilesLayout({ ...PHONE, count: 3, stageW: 0 }).board).toEqual({ w: 0, h: 0 })
    expect(tilesLayout({ ...PHONE, count: 0 }).tiles).toEqual([])
  })
})

describe('tilesLayout invariants', () => {
  const sizes = [PHONE, DESKTOP, LANDSCAPE, { stageW: 320, coarse: true, ratio: 1, gridGap: 10 }, { stageW: 360, coarse: true, ratio: 1, gridGap: 10 }, { stageW: 640, coarse: false, ratio: 1, gridGap: 10 }, { stageW: 240, coarse: true, ratio: 1, gridGap: 10 }]

  test('tiles are the boards, keep the 96 floor, and sit inside the content', () => {
    for (const size of sizes) {
      for (let count = 1; count <= 12; count++) {
        for (const ratio of [1, 0.8, 1.78]) {
          const l = tilesLayout({ ...size, ratio, count })
          expect(l.tiles).toHaveLength(count)
          expect(l.columns).toBeLessThanOrEqual(4)
          expect(l.rows).toBe(Math.ceil(count / l.columns))
          expect(l.board.w).toBeGreaterThanOrEqual(96)
          for (const tile of l.tiles) {
            expect(tile.w).toBe(l.board.w)
            expect(tile.h).toBe(l.board.h)
            expect(tile.x).toBeGreaterThanOrEqual(0)
            expect(tile.x + tile.w).toBeLessThanOrEqual(l.stageW)
            expect(tile.y).toBeGreaterThanOrEqual(0)
            expect(tile.y + tile.h + l.checkRow).toBeLessThanOrEqual(l.contentH)
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
      // A one-column stage has no side-by-side pair to measure.
      if (l.columns > 1)
        expect(l.tiles[1].x - (left + l.board.w)).toBe(l.gap)
    }
  })
})

describe('tileWiggle', () => {
  test('two tiles swing on rhythms of their own', () => {
    const a = tileWiggle('g-abc123')
    const b = tileWiggle('g-def456')
    expect(a.delay).toBe(-934)
    expect(a.duration).toBe(1197)
    expect(b.delay).toBe(-412)
    expect(b.duration).toBe(1031)
  })

  test('every rhythm stays in the band, its phase already under way', () => {
    for (let i = 0; i < 200; i++) {
      const { delay, duration } = tileWiggle(`g${i}`)
      expect(duration).toBeGreaterThanOrEqual(900)
      expect(duration).toBeLessThanOrEqual(1300)
      expect(delay).toBeLessThanOrEqual(0)
      expect(delay).toBeGreaterThan(-duration)
    }
  })

  test('the rhythm belongs to the id alone: stable, and distinct next door', () => {
    expect(tileWiggle('g1')).toEqual(tileWiggle('g1'))
    expect(tileWiggle('g1')).not.toEqual(tileWiggle('g2'))
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
