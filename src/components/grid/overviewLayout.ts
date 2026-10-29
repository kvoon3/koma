/**
 * The overview's geometry, in one pure module: the stage's air, the common
 * caption row, the board slot, and the page-dots row every board's height is
 * measured against. The components only render what these functions decide.
 */
import type { Node, PaneLabel, Sticker } from '../../lib/panes'
import { GRID_CELL_MAX } from '../../lib/exporter'
import { gridCellBox } from '../../lib/gridTools'
import { MAX_WORKSPACES } from '../../lib/workspaces'

export const CAPTION_H = 30

export const CAPTION_GAP = 8

export const STAGE_PAD_Y = 12

/** Side air the stage keeps around a board (both sides together). */
export const STAGE_PAD = 48

/**
 * The page-dot pill's row, reserved under every board so the dots never sit
 * over a cell. The pill is 28px tall; its hit area reaches 44px with a
 * pseudo-element, without taking a taller row out of the board.
 */
export const DOTS_ROW_H = 28

export const DOTS_GAP = 8

/**
 * The chrome the dock keeps at the bottom of the stage on the overview route.
 * A first-frame fallback only: the component measures the sheet's real band
 * (see `useDockRestBand`) and hands it in.
 */
export const DOCK_CHROME_H = 144

/**
 * The floating action cluster's metrics, mirrored from FloatActions and the
 * caption chip's Tailwind classes. There is no shared token source, so these
 * numbers drift if those classes change.
 */
export const FLOAT_ACTIONS = {
  offset: 10,
  btn: { fine: 30, coarse: 38 } as const,
  count: 4,
  gap: 6,
} as const

/**
 * The top padding the board stage keeps so the caption chip clears the
 * floating action cluster: the plain stage air where the two never share a
 * horizontal band, and the cluster's whole row plus the caption's own air
 * where they do. Paid out of the board's slot (like the dock's chrome at the
 * bottom), not painted over.
 */
export function stageTopPad(stageW: number, coarse: boolean): number {
  const btn = coarse ? FLOAT_ACTIONS.btn.coarse : FLOAT_ACTIONS.btn.fine
  const clusterLeft = stageW - FLOAT_ACTIONS.offset - (FLOAT_ACTIONS.count * btn + (FLOAT_ACTIONS.count - 1) * FLOAT_ACTIONS.gap)
  // One centred chip: its right edge is half a chip past the centre.
  const chipsRight = stageW / 2 + btn / 2
  if (chipsRight <= clusterLeft)
    return STAGE_PAD_Y
  // On a coarse pointer the chip stands taller than the caption row itself;
  // the half that overflows the row's top has to clear the cluster too.
  return FLOAT_ACTIONS.offset + btn + CAPTION_GAP + Math.max(0, (btn - CAPTION_H) / 2)
}

/**
 * The height every board is laid out against: the stage less its top air, its
 * bottom air, the dock band and the dots row. The dots row is taken from the
 * board's budget, not painted over it, so a swipe never changes the cell size.
 */
export function boardBody(stageH: number, topPad: number, dockH: number): number {
  return Math.max(1, stageH - topPad - STAGE_PAD_Y - dockH - DOTS_ROW_H)
}

export function dotsBottom(dockH: number): number {
  return STAGE_PAD_Y + dockH
}

/**
 * How many rows a board's cells fill: 1–3, with the + cell counting as one
 * more slot until the board is full. A fresh board (eight cells and the +)
 * already takes three rows, which is the height every page reserves.
 */
export function boardRows(cells: number): number {
  const slots = cells + (cells < MAX_WORKSPACES ? 1 : 0)
  return Math.min(3, Math.max(1, Math.ceil(slots / 3)))
}

/** The tallest board in the row, in rows. Every page reserves this height. */
export function maxRows(cellCounts: readonly number[]): number {
  return Math.max(1, ...cellCounts.map(boardRows))
}

export function slotH(rows: number, boxH: number, gap: number): number {
  return rows * boxH + (rows - 1) * gap
}

export type BoardCells = { id: string, root: Node, canvasRatio: number | null, stickers?: Sticker[], labels?: PaneLabel[] }[]

/**
 * The smallest cell the fit may use: the coarse tap target. Below it the stage
 * is shorter than any shipped phone, and the 915×412 layout would paint three
 * 60px rows under the page dots (measured: 19px overlap).
 */
const MIN_CELL_PX = 44

export function boardSlot(body: { w: number, h: number }): { w: number, h: number, min: number } {
  const height = Math.max(1, body.h - CAPTION_H - CAPTION_GAP)
  return { w: body.w - STAGE_PAD, h: height, min: MIN_CELL_PX }
}

/**
 * The cell size for the stage. An odd horizontal leftover is shaved by one
 * pixel: a board centred on half pixels snaps its 1px edges unevenly, and the
 * + cell's dashed right edge vanished.
 */
export function stageCellBox(body: { w: number, h: number }, gap: number, ratio: number): { cell: number, box: { w: number, h: number } } {
  const slot = boardSlot(body)
  const fit = gridCellBox({ w: slot.w, h: Math.max(1, slot.h) }, gap, ratio, GRID_CELL_MAX, slot.min)
  const cell = fit.w > 60 && (slot.w - (fit.w * 3 + gap * 2)) % 2 !== 0 ? fit.w - 1 : fit.w
  return { cell, box: { w: cell, h: cell === fit.w ? fit.h : Math.max(1, Math.round(cell / ratio)) } }
}
