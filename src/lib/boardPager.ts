/**
 * Physics for the overview's board pager: all boards laid out as pages in one
 * track, dragged sideways 1:1, released into a velocity snap, rubber-banded at
 * the row's ends and allowed to cross several pages in one flick.
 *
 * The rules are still the tools dock's (`lib/dockPhysics`): a release lands on
 * the page its position and velocity project, a flick above `FLICK_VELOCITY`
 * carries at least one page, and an end leans asymptotically instead of
 * tearing off. Offsets are screen px (`travel * viewScale`); the page count is
 * the caller's.
 */

import { FLICK_VELOCITY, rubberBand } from './dockPhysics'

/** How long one page takes to settle, before multi-page scaling. */
export const PAGER_SNAP_MS = 200

/** Seconds of release velocity projected forward when choosing the page. */
const PROJECT_S = 0.2

/** Release samples older than this carry no momentum: a held release has stopped. */
export const SAMPLE_STALE_MS = 80

/** Resistance at an end with no page behind it: macOS's gentle 0.3x. */
const EDGE_SLOPE = 0.3

/** How far an end can be pulled, as a fraction of one page. */
const EDGE_REACH = 0.35

/**
 * Pages available either side of the open board: the row's ends. `before` is
 * the number of pages at lower indices, `after` at higher ones.
 */
export interface PagerBounds {
  readonly before: number
  readonly after: number
}

/**
 * One page of travel: the board's visible width plus a seam, so the board
 * arriving from the far edge clears the one leaving by a visible gap.
 */
export function pagerTravel(boardW: number): number {
  return Math.round(boardW + Math.max(16, boardW * 0.06))
}

/**
 * Raw pointer travel → the track's shown offset. Inside the row a multi-page
 * drag is 1:1 all the way to the last page available; past an end the offset
 * rubber-bands, so the track leans and springs back rather than tearing off.
 */
export function pagerOffset(raw: number, travel: number, bounds: PagerBounds): number {
  const max = bounds.before * travel
  const min = -bounds.after * travel
  if (raw > max)
    return max + rubberBand(raw - max, travel * EDGE_REACH, EDGE_SLOPE)
  if (raw < min)
    return min - rubberBand(min - raw, travel * EDGE_REACH, EDGE_SLOPE)
  return raw
}

/**
 * Round to the nearest integer, with a tie settling home: 0.5 → 0, 1.5 → 1.
 * Used by the page projection and by the dots' page read, so a half-page
 * release and a half-page dot tell the same story.
 */
function halfTowardZero(v: number): number {
  const sign = Math.sign(v)
  const rounded = sign * Math.ceil(Math.abs(v) - 0.5)
  // `-0` would leak into equality checks (Object.is(-0, 0) is false).
  return rounded === 0 ? 0 : rounded
}

function clampPages(pages: number, bounds: PagerBounds): number {
  const clamped = Math.max(-bounds.before, Math.min(bounds.after, pages))
  return clamped === 0 ? 0 : clamped
}

/**
 * Which page the release lands on, as a signed delta from the open board:
 * negative is toward lower indices (the drag right, which reveals the page to
 * the left), positive toward higher ones. A slow release lands on the page it
 * is nearest; a flick carries at least one page when it points with the lean,
 * while a return flick only gets the position's nearest page. A multi-page
 * flick is allowed; the row's ends clamp.
 */
export function pagerPages(pos: number, velocity: number, travel: number, bounds: PagerBounds): number {
  const withLean = Math.sign(velocity) === Math.sign(pos) || pos === 0
  const projected = (withLean ? pos + velocity * PROJECT_S : pos) / travel
  let pages = halfTowardZero(-projected)
  if (Math.abs(velocity) >= FLICK_VELOCITY && withLean) {
    const dir = pages === 0 ? -Math.sign(velocity) : Math.sign(pages)
    pages = dir * Math.max(1, Math.abs(pages))
  }
  return clampPages(pages, bounds)
}

/**
 * The page under the viewport mid-drag, as a signed delta from the open
 * board: the page the dots mark and a release home would land on.
 */
export function pagerPageAt(pos: number, travel: number, bounds: PagerBounds): number {
  return clampPages(halfTowardZero(-pos / travel), bounds)
}

/**
 * Where a landing step comes to rest, in screen px from the old page's home.
 * The base moves by `-pages * travel` in the same frame, so the two cancel.
 */
export function pagerRest(pages: number, travel: number): number {
  const rest = -pages * travel
  return rest === 0 ? 0 : rest
}

export function pagerSnapMs(pages: number): number {
  return Math.min(PAGER_SNAP_MS * 3, PAGER_SNAP_MS + Math.max(0, Math.abs(pages) - 1) * 80)
}

/**
 * The release's momentum. A cancelled pointer never had any, and a release
 * whose last sample is stale (a held press) has already stopped: both are 0,
 * so the snap decides on position alone.
 */
export function releaseVelocity(v: number, sampleAgeMs: number, cancelled: boolean): number {
  return cancelled || sampleAgeMs > SAMPLE_STALE_MS ? 0 : v
}
