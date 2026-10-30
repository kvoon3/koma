/**
 * The groups page geometry and physics, pure and DOM-free: one page card per
 * group sized against the compact dock band, the carousel falloff, and the
 * release rules the pager hook reads. Components render these numbers, they do
 * not invent sizes.
 */
import { FLICK_VELOCITY, pickSnap, rubberBand } from './dockPhysics'
import { PAGER_SLOP } from './gestureAxis'
import { gridCellBox } from './gridTools'

export interface PageBox {
  x: number
  y: number
  w: number
  h: number
}

export interface PageLayout {
  band: 'roomy' | 'tight'
  stageW: number
  stageH: number
  /** The stage's bottom edge above the compact dock band. */
  floor: number
  headerH: number
  card: PageBox
  radius: number
  matte: number
  board: { w: number, h: number }
  cell: { w: number, h: number }
  boardGap: number
  cardGap: number
  travel: number
  check: { size: number, gap: number, inside: boolean }
  dots: { y: number, row: number, slot: number, size: number, active: number }
  done: { top: number, right: number, w: number, h: number }
  add: { top: number, right: number, size: number }
}

/** The dot jump's duration per page, in ms. */
export const PAGE_JUMP_MS = 200

/** Release spring: quick and near-critical, so a flick lands without a bounce. */
export const PAGE_SPRING = { type: 'spring', stiffness: 380, damping: 40, mass: 1 } as const

/** A card's dot growth at rest, and the active pill's width. */
const DOT_SIZE = 6
const DOT_ACTIVE = 18

/** How far a page slides before its neighbour centres: its width plus air. */
export function pageTravel(cardW: number, gap: number): number {
  return cardW + gap
}

/** The page's geometry, from the stage, the compact dock band and the cell ratio. */
export function pageLayout({ stageW, stageH, dockH, ratio, gridGap, coarse }: {
  stageW: number
  stageH: number
  /** The compact dock band, handle + icon row + footer. */
  dockH: number
  ratio: number
  gridGap: number
  coarse: boolean
}): PageLayout {
  const floor = stageH - dockH
  const wide = stageW >= 768
  const marginX = wide ? 64 : 16
  const cardGap = wide ? 32 : 24
  const dotsRow = coarse ? 36 : 24
  const dotsSlot = coarse ? 24 : 16
  const roomy = floor - (wide ? 64 : 56) >= 380
  const dots = { y: 0, row: dotsRow, slot: dotsSlot, size: DOT_SIZE, active: DOT_ACTIVE }

  if (roomy) {
    const headerH = wide ? 64 : 56
    const regionTop = headerH
    const regionBottom = floor - 8
    const regionH = regionBottom - regionTop
    // Card, check below it, then the dots row; centred as one group.
    const groupExtra = 12 + 44 + 24 + dotsRow
    const cardW = Math.round(clamp(Math.min(stageW - 2 * marginX, regionH - 16 - groupExtra, 560), 220, 560))
    const matte = clamp(Math.round(cardW * 0.055), 16, 32)
    const boardW = cardW - 2 * matte
    const boardGap = clamp(gridGap, 2, 12)
    const cell = gridCellBox({ w: boardW, h: boardW }, boardGap, ratio, boardW, 1)
    const cardY = Math.round(regionTop + (regionH - cardW - groupExtra) / 2)
    const doneRight = wide ? 64 : 16
    return {
      band: 'roomy',
      stageW,
      stageH,
      floor,
      headerH,
      card: { x: Math.round((stageW - cardW) / 2), y: cardY, w: cardW, h: cardW },
      radius: clamp(Math.round(cardW * 0.08), 20, 32),
      matte,
      board: { w: boardW, h: boardW },
      cell: { w: cell.w, h: cell.h },
      boardGap,
      cardGap,
      travel: pageTravel(cardW, cardGap),
      check: { size: 44, gap: 12, inside: false },
      dots: { ...dots, y: cardY + cardW + 12 + 44 + 24 },
      done: { top: 10, right: doneRight, w: 80, h: 36 },
      add: { top: 10, right: doneRight + 92, size: 44 },
    }
  }

  // Tight: the stage is too short for the roomy stack. The cards keep the top
  // chrome row and the check rides inside the card.
  const cardW = Math.round(clamp(Math.min(stageW - 48, floor - 56, 560), 160, 560))
  const matte = 16
  const boardW = cardW - 2 * matte
  const boardGap = clamp(gridGap, 2, 12)
  const cell = gridCellBox({ w: boardW, h: boardW }, boardGap, ratio, boardW, 1)
  return {
    band: 'tight',
    stageW,
    stageH,
    floor,
    headerH: 0,
    card: { x: Math.round((stageW - cardW) / 2), y: 48, w: cardW, h: cardW },
    radius: clamp(Math.round(cardW * 0.08), 20, 32),
    matte,
    board: { w: boardW, h: boardW },
    cell: { w: cell.w, h: cell.h },
    boardGap,
    cardGap,
    travel: pageTravel(cardW, cardGap),
    check: { size: 36, gap: 0, inside: true },
    dots: { ...dots, y: 8 },
    done: { top: 8, right: 16, w: 80, h: 36 },
    add: { top: 8, right: 108, size: 44 },
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/**
 * A card's falloff at `distance` pages from centre. The smoothstep eases both
 * ends, so a neighbour starts a page out at half opacity and a 0.94 scale and
 * reaches the active card's full strength only on centre. Reduced motion keeps
 * the fade but drops the scale.
 */
export function pageFalloff(distance: number, reduce: boolean): { opacity: number, scale: number } {
  const t = clamp(distance, 0, 1)
  const e = t * t * (3 - 2 * t)
  return { opacity: 1 - 0.5 * e, scale: reduce ? 1 : 1 - 0.06 * e }
}

/** A card's base left edge in the stage, before the row's drag offset. */
export function pageCardLeft(index: number, activeIndex: number, layout: PageLayout, offset: number): number {
  return layout.card.x + (index - activeIndex) * layout.travel + offset
}

/** Resistance at an end with no card behind it, and the most it can lean. */
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
 * Which card a release lands on, as a step over the group list: 0 stays, +1 is
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

export type PageRelease = 'tap' | 'page' | 'stay'

/**
 * What letting go of the page surface means. A press that never locked an axis
 * and never left the slop is a tap, which the caller hit-tests against the
 * cards. A sideways gesture settles a card. A cancelled pointer is never a tap,
 * and a gesture past the slop with no axis decided nothing.
 */
export function pageRelease({ axis, dx, dy, cancelled }: {
  axis: 'x' | 'y' | null
  dx: number
  dy: number
  cancelled: boolean
}): PageRelease {
  if (axis === 'x')
    return 'page'
  if (cancelled || axis === 'y')
    return 'stay'
  return Math.max(Math.abs(dx), Math.abs(dy)) < PAGER_SLOP ? 'tap' : 'stay'
}

/** The card nearest the stage centre at `offset`, clamped to the row. */
export function pageTargetIndex(offset: number, travel: number, activeIndex: number, count: number): number {
  if (count <= 0)
    return 0
  const raw = Math.round(activeIndex - offset / Math.max(1, travel))
  return Math.min(count - 1, Math.max(0, raw))
}

/**
 * The card under a stage x coordinate, or null. Only a card showing at least
 * 48px inside the stage is tappable, so a phone's offscreen peep and the stage
 * margin are not.
 */
export function pageAtX(x: number, layout: PageLayout, activeIndex: number, count: number, offset: number): number | null {
  for (let i = 0; i < count; i++) {
    const left = pageCardLeft(i, activeIndex, layout, offset)
    const right = left + layout.card.w
    const shown = Math.min(right, layout.stageW) - Math.max(left, 0)
    if (shown >= 48 && x >= left && x <= right)
      return i
  }
  return null
}

/** The raw multi-page offset a dot jump animates to, before the row re-bases. */
export function pageJumpOffset(from: number, to: number, travel: number): number {
  return (from - to) * travel
}
