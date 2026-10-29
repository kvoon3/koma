/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { MANAGER_FOOTER_H, MANAGER_HEADER_H, MANAGER_INSET, managerLayout, thumbnailCell } from './managerLayout'

/** The manager content area at a viewport: the popup less its header and footer. */
const content = (w: number, h: number) => ({ w, h: h - MANAGER_HEADER_H - MANAGER_FOOTER_H })
const VIEWPORTS = [
  content(375, 812),
  content(1280, 900),
  content(1280, 600),
  content(915, 412),
]

describe('managerLayout', () => {
  test('one to four boards fit the content area at every shipped viewport', () => {
    for (const view of VIEWPORTS) {
      for (const ratio of [1, 4 / 5, 16 / 9]) {
        for (let count = 1; count <= 4; count++) {
          const l = managerLayout({ count, viewW: view.w, viewH: view.h, ratio })
          expect(l.cols * l.rows).toBeGreaterThanOrEqual(count)
          // The card grid is inside the content box, insets and gaps included.
          expect(l.cols * l.cardW + l.gap * (l.cols - 1)).toBeLessThanOrEqual(view.w - 2 * MANAGER_INSET + 0.5)
          expect(l.rows * l.cardH + l.gap * (l.rows - 1)).toBeLessThanOrEqual(view.h - 2 * MANAGER_INSET + 0.5)
          expect(l.cardW).toBeGreaterThanOrEqual(1)
          // The thumbnail keeps the cell ratio and lives inside the card.
          expect(l.thumbW).toBe(l.cardW - 20)
          expect(l.thumbH).toBeCloseTo((l.thumbW - 4) / ratio + 4, 6)
          expect(l.cardH).toBeCloseTo(l.thumbH + 20 + 48, 6)
        }
      }
    }
  })

  test('a phone stacks two boards; a landscape stage puts four in one row', () => {
    const phone = content(375, 812)
    expect(managerLayout({ count: 2, viewW: phone.w, viewH: phone.h, ratio: 1 })).toMatchObject({ cols: 1, rows: 2 })
    const landscape = content(915, 412)
    expect(managerLayout({ count: 4, viewW: landscape.w, viewH: landscape.h, ratio: 1 })).toMatchObject({ cols: 4, rows: 1 })
  })

  test('picks the arrangement with the largest card, stable on ties', () => {
    const view = content(1000, 800)
    const two = managerLayout({ count: 2, viewW: view.w, viewH: view.h, ratio: 1 })
    // Two square-ish cards side by side are larger than two stacked here.
    expect(two.cols).toBe(2)
    const four = managerLayout({ count: 4, viewW: view.w, viewH: view.h, ratio: 1 })
    expect(four.cols * four.rows).toBeGreaterThanOrEqual(4)
    // Deterministic: the same input always yields the same layout.
    expect(managerLayout({ count: 4, viewW: view.w, viewH: view.h, ratio: 1 })).toEqual(four)
  })

  test('degenerate inputs still return a usable layout', () => {
    const l = managerLayout({ count: 0, viewW: 0, viewH: 0, ratio: Number.NaN })
    expect(l.cols).toBe(1)
    expect(l.rows).toBe(1)
    expect(l.cardW).toBe(1)
    expect(l.cardH).toBeGreaterThan(0)
  })
})

describe('thumbnailCell', () => {
  test('fits three columns and three rows of the board ratio', () => {
    for (const [w, h] of [[320, 260], [120, 120], [300, 160]]) {
      for (const ratio of [1, 0.8, 16 / 9]) {
        const cell = thumbnailCell(w, h, ratio)
        expect(cell.w * 3 + 4).toBeLessThanOrEqual(w)
        expect(cell.h * 3 + 4).toBeLessThanOrEqual(h)
        expect(cell.h).toBe(Math.max(1, Math.round(cell.w / ratio)))
      }
    }
  })
})
