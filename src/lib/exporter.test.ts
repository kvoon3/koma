/// <reference types="bun" />
import { describe, expect, it } from 'bun:test'
import { computeExportSize, gridCellPx, outputSizeFor } from './exporter'

describe('computeExportSize', () => {
  it('keeps the long side for a landscape canvas', () => {
    // 2048 / 1.75 = 1170.28…
    expect(computeExportSize({ ratio: 1.75, longSide: 2048 } as never)).toEqual({ W: 2048, H: 1170 })
  })

  it('keeps the long side for a portrait canvas', () => {
    expect(computeExportSize({ ratio: 0.5718, longSide: 2048 } as never)).toEqual({ W: 1171, H: 2048 })
  })

  it('is square at ratio 1', () => {
    expect(computeExportSize({ ratio: 1, longSide: 2048 } as never)).toEqual({ W: 2048, H: 2048 })
  })

  it('rounds the derived side to whole pixels', () => {
    // 2048 / 1.5 = 1365.33…
    expect(computeExportSize({ ratio: 1.5, longSide: 2048 } as never)).toEqual({ W: 2048, H: 1365 })
    // 2048 * 0.618 = 1265.66…
    expect(computeExportSize({ ratio: 0.618, longSide: 2048 } as never)).toEqual({ W: 1266, H: 2048 })
  })

  it('follows the long side setting', () => {
    expect(computeExportSize({ ratio: 2, longSide: 1500 } as never)).toEqual({ W: 1500, H: 750 })
    expect(computeExportSize({ ratio: 0.5, longSide: 1500 } as never)).toEqual({ W: 750, H: 1500 })
  })
})

describe('outputSizeFor', () => {
  it('is the canvas ratio applied to the long side', () => {
    expect(outputSizeFor(2048, 4 / 3)).toEqual({ W: 2048, H: 1536 })
    expect(outputSizeFor(2048, 3 / 4)).toEqual({ W: 1536, H: 2048 })
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
