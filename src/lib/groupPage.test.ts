/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { pageAtX, pageCardLeft, pageFalloff, pageJumpOffset, pageLayout, pageOffset, pageRelease, pageRestOffset, pageStep, pageTargetIndex, pageTravel } from './groupPage'

const PHONE = { stageW: 375, stageH: 781, dockH: 107, ratio: 1, gridGap: 10, coarse: true }
const DESKTOP = { stageW: 1280, stageH: 869, dockH: 107, ratio: 1, gridGap: 10, coarse: false }
const SHORT = { stageW: 1280, stageH: 569, dockH: 107, ratio: 1, gridGap: 10, coarse: false }
const LANDSCAPE = { stageW: 915, stageH: 381, dockH: 107, ratio: 1, gridGap: 10, coarse: true }

describe('pageLayout at the four sizes', () => {
  test('375x812 keeps the 343 card and the 305 board', () => {
    const l = pageLayout(PHONE)
    expect(l.band).toBe('roomy')
    expect(l.floor).toBe(674)
    expect(l.headerH).toBe(56)
    expect(l.card).toEqual({ x: 16, y: 132, w: 343, h: 343 })
    expect(l.board).toEqual({ w: 305, h: 305 })
    expect(l.cell).toEqual({ w: 95, h: 95 })
    expect(l.boardGap).toBe(10)
    expect(l.cardGap).toBe(24)
    expect(l.travel).toBe(367)
    expect(l.check).toEqual({ size: 44, gap: 12, inside: false })
    expect(l.dots).toEqual({ y: 555, row: 36, slot: 24, size: 6, active: 18 })
    expect(l.done).toEqual({ top: 10, right: 16, w: 80, h: 36 })
    expect(l.add).toEqual({ top: 10, right: 108, size: 44 })
    expect(l.matte).toBe(19)
    expect(l.radius).toBe(27)
  })

  test('1280x900 height-limits the card at 560', () => {
    const l = pageLayout(DESKTOP)
    expect(l.band).toBe('roomy')
    expect(l.floor).toBe(762)
    expect(l.headerH).toBe(64)
    expect(l.card).toEqual({ x: 360, y: 77, w: 560, h: 560 })
    expect(l.board).toEqual({ w: 498, h: 498 })
    expect(l.cell).toEqual({ w: 159, h: 159 })
    expect(l.cardGap).toBe(32)
    expect(l.travel).toBe(592)
    expect(l.dots.y).toBe(717)
    expect(l.dots.row).toBe(24)
    expect(l.dots.slot).toBe(16)
    expect(l.done).toEqual({ top: 10, right: 64, w: 80, h: 36 })
    expect(l.add).toEqual({ top: 10, right: 156, size: 44 })
    expect(l.matte).toBe(31)
    expect(l.radius).toBe(32)
  })

  test('1280x600 shows three full 270 cards', () => {
    const l = pageLayout(SHORT)
    expect(l.band).toBe('roomy')
    expect(l.floor).toBe(462)
    expect(l.card).toEqual({ x: 505, y: 72, w: 270, h: 270 })
    expect(l.board).toEqual({ w: 238, h: 238 })
    expect(l.cell).toEqual({ w: 72, h: 72 })
    expect(l.travel).toBe(302)
    expect(l.matte).toBe(16)
    expect(l.radius).toBe(22)
    expect(l.dots.y).toBe(422)
  })

  test('915x412 is tight: the check rides inside the card', () => {
    const l = pageLayout(LANDSCAPE)
    expect(l.band).toBe('tight')
    expect(l.floor).toBe(274)
    expect(l.headerH).toBe(0)
    expect(l.card).toEqual({ x: 349, y: 48, w: 218, h: 218 })
    expect(l.board).toEqual({ w: 186, h: 186 })
    expect(l.cell).toEqual({ w: 55, h: 55 })
    expect(l.cardGap).toBe(32)
    expect(l.travel).toBe(250)
    expect(l.check).toEqual({ size: 36, gap: 0, inside: true })
    expect(l.dots).toEqual({ y: 8, row: 36, slot: 24, size: 6, active: 18 })
    expect(l.done).toEqual({ top: 8, right: 16, w: 80, h: 36 })
    expect(l.add).toEqual({ top: 8, right: 108, size: 44 })
    expect(l.matte).toBe(16)
    expect(l.radius).toBe(20)
  })
})

describe('pageLayout invariants', () => {
  const cases = [PHONE, DESKTOP, SHORT, LANDSCAPE]

  test('the card and its board stay inside the stage and above the floor', () => {
    for (const input of cases) {
      const l = pageLayout(input)
      expect(l.card.h).toBe(l.card.w)
      expect(l.card.x).toBeGreaterThanOrEqual(0)
      expect(l.card.x + l.card.w).toBeLessThanOrEqual(l.stageW)
      expect(l.card.y).toBeGreaterThanOrEqual(0)
      expect(l.card.y + l.card.h).toBeLessThanOrEqual(l.floor)
      expect(l.board.w).toBe(l.card.w - 2 * l.matte)
      expect(l.board.h).toBe(l.card.w - 2 * l.matte)
      expect(3 * l.cell.w + 2 * l.boardGap).toBeLessThanOrEqual(l.board.w)
      expect(3 * l.cell.h + 2 * l.boardGap).toBeLessThanOrEqual(l.board.h)
    }
  })

  test('roomy puts the check and dots in a column under the card', () => {
    for (const input of [PHONE, DESKTOP, SHORT]) {
      const l = pageLayout(input)
      expect(l.card.y).toBeGreaterThanOrEqual(l.headerH)
      expect(l.card.y + l.card.h).toBeLessThanOrEqual(l.dots.y)
      expect(l.dots.y - (l.card.y + l.card.h)).toBe(l.check.gap + l.check.size + 24)
      expect(l.dots.y + l.dots.row).toBeLessThanOrEqual(l.floor)
      expect(l.check.inside).toBe(false)
    }
  })

  test('tight keeps the check inside the card and the dots at the top', () => {
    const l = pageLayout(LANDSCAPE)
    expect(l.check.inside).toBe(true)
    expect(l.dots.y).toBe(8)
    expect(l.dots.y + l.dots.row).toBeLessThanOrEqual(l.card.y)
  })

  test('the header buttons stay inside the stage', () => {
    for (const input of cases) {
      const l = pageLayout(input)
      expect(l.done.right + l.done.w).toBeLessThanOrEqual(l.stageW)
      expect(l.add.right + l.add.size).toBeLessThanOrEqual(l.stageW)
      expect(l.add.right).toBeGreaterThan(l.done.right + l.done.w)
    }
  })

  test('the phone guards hold', () => {
    const roomy = pageLayout({ stageW: 360, stageH: 609, dockH: 107, ratio: 1, gridGap: 10, coarse: true })
    expect(roomy.band).toBe('roomy')
    expect(roomy.card.w).toBe(306)
    expect(roomy.board.w).toBe(272)
    expect(roomy.cell.w).toBe(84)

    const tight = pageLayout({ stageW: 320, stageH: 537, dockH: 107, ratio: 1, gridGap: 10, coarse: true })
    expect(tight.band).toBe('tight')
    expect(tight.card.w).toBe(272)
    expect(tight.board.w).toBe(240)
    expect(tight.cell.w).toBe(73)
  })

  test('a tall card board fits a 3:2 cell ratio too', () => {
    const l = pageLayout({ ...PHONE, ratio: 1.5 })
    expect(l.cell.w).toBe(95)
    expect(l.cell.h).toBe(63)
    expect(3 * l.cell.h + 2 * l.boardGap).toBeLessThanOrEqual(l.board.h)
  })

  test('the phone margin and the card gap are the design numbers', () => {
    const l = pageLayout(PHONE)
    expect(l.card.x).toBe(16)
    expect(l.cardGap).toBe(24)
    expect(l.travel).toBe(pageTravel(l.card.w, l.cardGap))
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

describe('pageTravel / pageCardLeft', () => {
  test('a page is the card plus its gap', () => {
    expect(pageTravel(300, 24)).toBe(324)
  })

  test('cards sit a travel apart around the active card', () => {
    const l = pageLayout(PHONE)
    expect(pageCardLeft(0, 1, l, 0)).toBe(l.card.x - l.travel)
    expect(pageCardLeft(1, 1, l, 0)).toBe(l.card.x)
    expect(pageCardLeft(2, 1, l, 0)).toBe(l.card.x + l.travel)
    expect(pageCardLeft(1, 1, l, -37)).toBe(l.card.x - 37)
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

describe('pageRelease', () => {
  const tap = { axis: null, dx: 0, dy: 0, cancelled: false } as const

  test('a press that never left the slop is a tap', () => {
    expect(pageRelease({ ...tap })).toBe('tap')
    expect(pageRelease({ ...tap, dx: 5, dy: -5 })).toBe('tap')
    expect(pageRelease({ ...tap, dx: -5.9, dy: 5.9 })).toBe('tap')
  })

  test('a sideways gesture settles a page, held or cancelled', () => {
    expect(pageRelease({ ...tap, axis: 'x', dx: -120 })).toBe('page')
    expect(pageRelease({ ...tap, axis: 'x', dx: 40, cancelled: true })).toBe('page')
  })

  test('a vertical gesture and a cancelled pointer stay', () => {
    expect(pageRelease({ ...tap, axis: 'y', dy: -20 })).toBe('stay')
    expect(pageRelease({ ...tap, cancelled: true })).toBe('stay')
  })

  test('a past-slop gesture with no axis decided nothing', () => {
    expect(pageRelease({ ...tap, dx: 6, dy: 6 })).toBe('stay')
    expect(pageRelease({ ...tap, dx: -7, dy: 0 })).toBe('stay')
  })
})

describe('pageTargetIndex', () => {
  test('is the active card at rest and follows the drag', () => {
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

describe('pageAtX', () => {
  test('a phone margin and an offscreen peep are not tappable', () => {
    const l = pageLayout(PHONE)
    expect(pageAtX(200, l, 0, 3, 0)).toBe(0)
    expect(pageAtX(5, l, 0, 3, 0)).toBe(null)
    expect(pageAtX(370, l, 0, 3, 0)).toBe(null)
    // The next card rests a travel past the active one, off the stage.
    expect(pageAtX(380, l, 0, 3, 0)).toBe(null)
    // Mid-drag the peep comes in and is tappable once it shows 48px.
    expect(pageAtX(370, l, 0, 3, -183.5)).toBe(1)
  })

  test('a desktop peep maps to its card, and the gap maps to none', () => {
    const l = pageLayout(DESKTOP)
    expect(pageAtX(500, l, 0, 3, 0)).toBe(0)
    expect(pageAtX(1000, l, 0, 3, 0)).toBe(1)
    expect(pageAtX(940, l, 0, 3, 0)).toBe(null)
    expect(pageAtX(63, l, 0, 3, 0)).toBe(null)
  })

  test('a card showing less than 48px is not tappable', () => {
    const l = pageLayout(DESKTOP)
    // Push the neighbour so only 40px of it sits inside the stage.
    const clipped = { ...l, travel: l.stageW - l.card.x - 40 }
    expect(pageAtX(l.stageW - 10, clipped, 0, 3, 0)).toBe(null)
  })
})

describe('pageJumpOffset', () => {
  test('is the raw multi-page travel for a dot jump', () => {
    expect(pageJumpOffset(0, 1, T)).toBe(-T)
    expect(pageJumpOffset(1, 0, T)).toBe(T)
    expect(pageJumpOffset(0, 3, T)).toBe(-3 * T)
    expect(pageJumpOffset(3, 0, T)).toBe(3 * T)
  })
})
