/**
 * The groups page geometry and the group pager physics, pure and DOM-free:
 * the tile grid every group's card lays out in, and the slide, falloff and
 * release rules the overview's pager hook reads (the groups page itself no
 * longer pages; its tiles are buttons). Components render these numbers, they
 * do not invent sizes.
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
  /** Every tile is the same square. */
  tile: number
  gap: number
  radius: number
  matte: number
  board: { w: number, h: number }
  cell: { w: number, h: number }
  boardGap: number
  /** The open group's check badge, drawn inside the tile's corner. */
  check: number
  tiles: PageBox[]
  done: { top: number, right: number, w: number, h: number }
}

/**
 * The groups page as a flat grid of tiles: one per group (plus the dashed add
 * slot while there is room), every tile the same square, centred as one grid
 * in the area between the header and the compact dock band. The board inside
 * keeps the page card's matte-and-radius language, scaled to the tile.
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
  const columns = stageW < 640 ? 2 : Math.min(4, Math.max(2, Math.floor(stageW / 300)))
  const slots = count + (count < MAX_GRIDS ? 1 : 0)
  const rows = Math.max(1, Math.ceil(slots / columns))

  const base: TilesLayout = {
    stageW,
    stageH,
    floor,
    headerH,
    columns,
    rows,
    slots,
    tile: 0,
    gap,
    radius: 20,
    matte: 16,
    board: { w: 0, h: 0 },
    cell: { w: 0, h: 0 },
    boardGap: Math.min(12, Math.max(2, gridGap)),
    check: 24,
    tiles: [],
    done: { top: 10, right: marginX, w: 80, h: 36 },
  }
  if (stageW <= 0 || stageH <= 0)
    return base

  const byW = (stageW - 2 * marginX - (columns - 1) * gap) / columns
  const byH = (floor - headerH - 2 * marginY - (rows - 1) * gap) / rows
  const tile = Math.floor(Math.max(0, Math.min(byW, byH)))
  if (tile < 1)
    return base

  // A single short row (fewer slots than columns) centres on the columns it
  // uses; a multi-row grid is a full rectangle, every row but the last full.
  const usedCols = rows === 1 ? slots : columns
  const gridW = usedCols * tile + (usedCols - 1) * gap
  const gridH = rows * tile + (rows - 1) * gap
  const originX = Math.round((stageW - gridW) / 2)
  const originY = Math.round(headerH + (floor - headerH - gridH) / 2)
  const matte = clamp(Math.round(tile * 0.055), 16, 32)
  const board = tile - 2 * matte
  const cell = gridCellBox({ w: board, h: board }, base.boardGap, ratio, board, 1)
  const tiles = Array.from({ length: slots }, (_, i) => ({
    x: Math.round(originX + (i % columns) * (tile + gap)),
    y: Math.round(originY + Math.floor(i / columns) * (tile + gap)),
    w: tile,
    h: tile,
  }))
  return {
    ...base,
    tile,
    radius: clamp(Math.round(tile * 0.08), 20, 32),
    matte,
    board: { w: board, h: board },
    cell: { w: cell.w, h: cell.h },
    check: clamp(Math.round(tile * 0.16), 24, 36),
    tiles,
  }
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
