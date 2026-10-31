/**
 * The groups page geometry and the group pager physics, pure and DOM-free:
 * the frameless tile grid every group's board lays out in, and the slide,
 * falloff and release rules the overview's pager hook reads (the groups page
 * itself no longer pages; its tiles are buttons). Components render these
 * numbers, they do not invent sizes.
 */
import { FLICK_VELOCITY, pickSnap, rubberBand } from './dockPhysics'
import { gridCellBox } from './gridTools'
import { MAX_GRIDS } from './workspaces'

export interface PageBox {
  x: number
  y: number
  w: number
  h: number
}

/** Release spring: quick and near-critical, so a flick lands without a bounce. */
export const PAGE_SPRING = { type: 'spring', stiffness: 380, damping: 40, mass: 1 } as const

/** How far a page slides before its neighbour centres: its width plus air. */
export function pageTravel(boardW: number, air: number): number {
  return boardW + air
}

export interface TilesLayout {
  stageW: number
  stageH: number
  /** The stage's bottom edge above the compact dock band. */
  floor: number
  headerH: number
  /** Tile columns and rows (the add slot counts as a tile). */
  columns: number
  rows: number
  /** How many tiles the grid holds: one per group, plus the add slot. */
  slots: number
  /** Air between tile slots. */
  gap: number
  /** The tile is the board box itself: the 3×3 at the root's own cell gap. */
  board: { w: number, h: number }
  cell: { w: number, h: number }
  /** The board's own cell gap, the root's `gridGap`, so a tile reads as the board. */
  boardGap: number
  /** The checkbox row reserved under every tile. */
  checkRow: number
  /** The round checkbox's face, inside its row. */
  check: number
  tiles: PageBox[]
  done: { top: number, right: number, w: number, h: number }
}

/** The smallest board tile the page draws before it widens the grid a column. */
const TILE_FLOOR = 96

/**
 * The groups page as a flat grid of frameless tiles: one per group (plus the
 * dashed add slot while there is room), every tile the board itself, the 3×3
 * at the root's own cell gap with no card frame or matte, plus a checkbox
 * row reserved under it. Centred as one grid between the header and the
 * compact dock band. When two rows cannot keep the board at the floor once
 * the checkbox rows are paid for, the grid widens a column until one row can
 * (a landscape phone trades rows for a legible board).
 */
export function tilesLayout({ stageW, stageH, count, dockBand, coarse, ratio, gridGap }: {
  stageW: number
  stageH: number
  /** How many groups there are; the grid adds the add slot under the cap. */
  count: number
  /** The compact dock band, handle + icon row + footer. */
  dockBand: number
  coarse: boolean
  ratio: number
  gridGap: number
}): TilesLayout {
  const floor = stageH - dockBand
  const wide = stageW >= 768
  const marginX = wide ? 64 : 16
  const marginY = wide ? 8 : (coarse ? 12 : 16)
  const headerH = wide ? 64 : 56
  const gap = wide ? 32 : 24
  const checkRow = coarse ? 36 : 28
  const slots = count + (count < MAX_GRIDS ? 1 : 0)
  const startColumns = stageW < 640 ? 2 : Math.min(4, Math.max(2, Math.floor(stageW / 300)))
  const rowsOf = (cols: number) => Math.max(1, Math.ceil(slots / cols))
  const base: TilesLayout = {
    stageW,
    stageH,
    floor,
    headerH,
    columns: startColumns,
    rows: rowsOf(startColumns),
    slots,
    gap,
    board: { w: 0, h: 0 },
    cell: { w: 0, h: 0 },
    boardGap: gridGap,
    checkRow,
    check: 22,
    tiles: [],
    done: { top: 10, right: marginX, w: 80, h: 36 },
  }
  if (stageW <= 0 || stageH <= 0)
    return base

  // The board one column/row pair fits: cells floored to integers, so the
  // board can come out a touch under the pair's box.
  const boardAt = (cols: number) => {
    const rows = rowsOf(cols)
    const colW = (stageW - 2 * marginX - (cols - 1) * gap) / cols
    const rowH = (floor - headerH - 2 * marginY - (rows - 1) * gap) / rows - checkRow
    const cell = gridCellBox({ w: colW, h: rowH }, gridGap, ratio, colW, 1)
    return { rows, colW, rowH, cell, board: { w: cell.w * 3 + gridGap * 2, h: cell.h * 3 + gridGap * 2 } }
  }

  let columns = startColumns
  let fit = boardAt(columns)
  while (columns < 4 && columns < slots && fit.board.w < TILE_FLOOR) {
    columns += 1
    fit = boardAt(columns)
  }
  const { rows, colW, rowH, cell, board } = fit
  if (colW < 1 || rowH < 1)
    return { ...base, columns, rows }

  // A single short row (fewer slots than columns) centres on the columns it
  // uses; a multi-row grid is a full rectangle, every row but the last full.
  const usedCols = rows === 1 ? slots : columns
  const gridW = usedCols * board.w + (usedCols - 1) * gap
  const gridH = rows * board.h + rows * checkRow + (rows - 1) * gap
  const originX = Math.round((stageW - gridW) / 2)
  const originY = Math.round(headerH + (floor - headerH - gridH) / 2)
  const tiles = Array.from({ length: slots }, (_, i) => ({
    x: Math.round(originX + (i % columns) * (board.w + gap)),
    y: Math.round(originY + Math.floor(i / columns) * (board.h + checkRow + gap)),
    w: board.w,
    h: board.h,
  }))
  return { ...base, columns, rows, board, cell, tiles }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/**
 * A tile's falloff at `distance` pages from centre. The smoothstep eases both
 * ends, so a neighbour starts a page out at half opacity and a 0.94 scale and
 * reaches the active tile's full strength only on centre. Reduced motion keeps
 * the fade but drops the scale.
 */
export function pageFalloff(distance: number, reduce: boolean): { opacity: number, scale: number } {
  const t = clamp(distance, 0, 1)
  const e = t * t * (3 - 2 * t)
  return { opacity: 1 - 0.5 * e, scale: reduce ? 1 : 1 - 0.06 * e }
}

/** Resistance at an end with no board behind it, and the most it can lean. */
const EDGE_SLOPE = 0.3
const EDGE_REACH = 0.35

/**
 * Raw pointer travel to the row's shown offset. Inside the row it is 1:1 and
 * hard-stopped one page over; past an end it rubber-bands, so the row leans and
 * springs home instead of tearing off the edge.
 */
export function pageOffset(raw: number, travel: number, hasPrev: boolean, hasNext: boolean): number {
  if (raw > 0)
    return hasPrev ? Math.min(raw, travel) : rubberBand(raw, travel * EDGE_REACH, EDGE_SLOPE)
  if (raw < 0)
    return hasNext ? Math.max(raw, -travel) : -rubberBand(-raw, travel * EDGE_REACH, EDGE_SLOPE)
  return 0
}

/**
 * Which board a release lands on, as a step over the group list: 0 stays, +1 is
 * the next group (dragged left), -1 the previous one. Past half a travel the
 * release goes where it leans; a flick carries one page on its own, and a flick
 * back home settles home. An end has nowhere to go.
 */
export function pageStep(pos: number, velocity: number, travel: number, hasPrev: boolean, hasNext: boolean): -1 | 0 | 1 {
  const offsets = [-travel, 0, travel]
  const dir = Math.sign(pos)
  const offset = Math.abs(velocity) >= FLICK_VELOCITY
    ? (Math.sign(velocity) === dir ? dir * travel : 0)
    : offsets[pickSnap(offsets, pos, 0, 1)]!
  if (offset < 0)
    return hasNext ? 1 : 0
  if (offset > 0)
    return hasPrev ? -1 : 0
  return 0
}

/** Where a settled step comes to rest: home, or one page over. */
export function pageRestOffset(step: -1 | 0 | 1, travel: number): number {
  return step === 0 ? 0 : step > 0 ? -travel : travel
}

/** The board nearest the stage centre at `offset`, clamped to the row. */
export function pageTargetIndex(offset: number, travel: number, activeIndex: number, count: number): number {
  if (count <= 0)
    return 0
  const raw = Math.round(activeIndex - offset / Math.max(1, travel))
  return Math.min(count - 1, Math.max(0, raw))
}
