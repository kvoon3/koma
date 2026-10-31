/**
 * The groups page geometry and the group pager physics, pure and DOM-free:
 * the scrolling tile grid every group's board lays out in, and the slide,
 * falloff and release rules the overview's pager hook reads. Components render
 * these numbers, they do not invent sizes.
 */
import { FLICK_VELOCITY, pickSnap, rubberBand } from './dockPhysics'
import { gridCellBox } from './gridTools'

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
  headerH: number
  /** Tile columns and rows. */
  columns: number
  rows: number
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
  /**
   * The tile grid's height in the scroll module: rows of (tile + check) plus
   * the gaps and the top and bottom air. The scroller centres it (an auto
   * margin) while it fits and scrolls once it does not.
   */
  contentH: number
  /** Tile boxes in the content's own coordinates: x from the stage edge, y from its top. */
  tiles: PageBox[]
  done: { top: number, right: number, w: number, h: number }
  /** The + pill beside Done, same row and chrome. */
  add: { top: number, right: number, w: number, h: number }
}

/** The smallest board tile the page draws before it gives up a column for it. */
const TILE_FLOOR = 96

/**
 * The groups page as one scrolling grid of frameless tiles: one per group,
 * every tile the board itself (the 3×3 at the root's own cell gap, no card
 * frame or matte) plus a checkbox row reserved under it. Columns ask for
 * 300px each, at most four, with a two-column floor on narrow stages; the
 * tile is its column, so its size does not shrink as groups are added. What
 * overflows the stage scrolls: the page renders `contentH` and the scroller
 * centres the grid while it fits.
 */
export function tilesLayout({ stageW, count, coarse, ratio, gridGap }: {
  stageW: number
  /** How many groups there are. */
  count: number
  coarse: boolean
  ratio: number
  gridGap: number
}): TilesLayout {
  const wide = stageW >= 768
  const marginX = wide ? 64 : 16
  const marginY = wide ? 8 : (coarse ? 12 : 16)
  const headerH = wide ? 64 : 56
  const gap = wide ? 32 : 24
  const checkRow = coarse ? 36 : 28
  const done = { top: 10, right: marginX, w: 80, h: 36 }
  const add = { top: done.top, right: marginX + done.w + 8, w: done.h, h: done.h }
  const base: TilesLayout = {
    stageW,
    headerH,
    columns: 2,
    rows: 1,
    gap,
    board: { w: 0, h: 0 },
    cell: { w: 0, h: 0 },
    boardGap: gridGap,
    checkRow,
    check: 22,
    contentH: 0,
    tiles: [],
    done,
    add,
  }
  if (stageW <= 0 || count <= 0)
    return base

  const colW = (cols: number) => (stageW - 2 * marginX - (cols - 1) * gap) / cols
  let columns = stageW < 640 ? 2 : Math.min(4, Math.max(2, Math.floor(stageW / 300)))
  // A column this narrow cannot hold the tile floor, so the stage pays for
  // one column instead. Real stages never get here; the floor stays a promise.
  while (columns > 1 && colW(columns) < TILE_FLOOR)
    columns -= 1
  const rows = Math.max(1, Math.ceil(count / columns))
  // The cell fits its column, never the stage height: extra rows scroll. The
  // height is unbounded (`Infinity`) so `gridCellBox` sizes by width alone.
  const cell = gridCellBox({ w: colW(columns), h: Number.POSITIVE_INFINITY }, gridGap, ratio, colW(columns), 1)
  if (cell.w < 1)
    return base
  const board = { w: cell.w * 3 + gridGap * 2, h: cell.h * 3 + gridGap * 2 }

  // A single short row (fewer tiles than columns) centres on the columns it
  // uses; a multi-row grid is a full rectangle, every row but the last full.
  const usedCols = rows === 1 ? count : columns
  const gridW = usedCols * board.w + (usedCols - 1) * gap
  const originX = Math.round((stageW - gridW) / 2)
  const contentH = rows * (board.h + checkRow) + (rows - 1) * gap + 2 * marginY
  const tiles = Array.from({ length: count }, (_, i) => ({
    x: Math.round(originX + (i % columns) * (board.w + gap)),
    y: Math.round(marginY + Math.floor(i / columns) * (board.h + checkRow + gap)),
    w: board.w,
    h: board.h,
  }))
  return { ...base, columns, rows, board, cell, contentH, tiles }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** The band every tile's own wiggle duration lives in, ms. */
const WIGGLE_MIN_MS = 900
const WIGGLE_MAX_MS = 1300

/**
 * A deleted tile's exit: the CSS animation fades and shrinks it over
 * `TILE_EXIT_MS` (the motion scale's `--dur-fast` step), then the store drops
 * the group and the survivors glide shut. The delete commits on the exit
 * animation's end or at `TILE_EXIT_CATCHALL_MS`, whichever comes first, so the
 * store always updates even when the animation never runs (reduced motion
 * ends it near-instantly; a hidden or unmounted tile never fires it). The page
 * feeds `TILE_EXIT_MS` to the keyframe through `--tile-exit-ms`, so CSS and
 * the timing wiring read one number.
 */
export const TILE_EXIT_MS = 120
export const TILE_EXIT_CATCHALL_MS = 200

/** FNV-1a over the id: a stable hash, so a tile's rhythm survives reorders. */
function hashId(id: string): number {
  let h = 0x811C9DC5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * One tile's wiggle rhythm, from a stable hash of the group's id: a duration
 * in the band and a negative delay (a phase already under way at mount). No
 * two tiles swing together, and a reorder or a re-render restarts nothing.
 */
export function tileWiggle(id: string): { delay: number, duration: number } {
  const h = hashId(id)
  const duration = WIGGLE_MIN_MS + (h % (WIGGLE_MAX_MS - WIGGLE_MIN_MS + 1))
  return { delay: -((h >>> 10) % duration), duration }
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
