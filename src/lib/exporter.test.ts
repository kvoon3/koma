/// <reference types="bun" />
import { describe, expect, it } from 'bun:test'
import { exportGap, gridCellPx } from './exporter'

describe('exportGap', () => {
  it('is zero at gap 0, so flush panes stay flush', () => {
    expect(exportGap(0, 2048, 1365)).toBe(0)
  })

  it('scales from the short edge (the same unit as radius and labels)', () => {
    // 6/1000 of the 1365px short edge.
    expect(exportGap(6, 2048, 1365)).toBe(8)
    expect(exportGap(60, 1024, 1024)).toBe(61)
  })

  it('is always a whole number of pixels', () => {
    for (const [w, h] of [[2048, 1365], [1001, 999], [1500, 1500], [1171, 2048]]) {
      for (const setting of [1, 3, 7, 13, 60, 120]) {
        const gap = exportGap(setting, w, h)
        expect(Number.isInteger(gap)).toBe(true)
        expect(gap).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('gridCellPx', () => {
  it('gives each cell about a third of the long side', () => {
    expect(gridCellPx(2048)).toEqual({ w: 683, h: 683 })
    // `cellRatio` is the cell's width / height, so below 1 is a tall cell.
    expect(gridCellPx(2048, 4 / 5)).toEqual({ w: 546, h: 683 })
    expect(gridCellPx(2048, 5 / 4)).toEqual({ w: 683, h: 546 })
  })

  it('floors the cell at 240px', () => {
    expect(gridCellPx(300)).toEqual({ w: 240, h: 240 })
  })
})
