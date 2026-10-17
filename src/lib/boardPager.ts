/**
 * Physics for the board pager: the receded board in the workspace switcher,
 * dragged sideways so the neighbouring group's board slides in (macOS Spaces).
 *
 * The rules are the tools dock's (`lib/dockPhysics`), not new ones: a
 * release snaps to the page nearest the position the release velocity
 * projects, a flick above `FLICK_VELOCITY` always moves one page, and the
 * ends of the group row rubber-band instead of stopping dead.
 *
 * Offsets are screen px of the board's own travel: 0 = the open group's board
 * home. Dragging right (+x) pulls the *previous* group's board in from the
 * left edge, dragging left brings the next one in from the right edge.
 */

import { FLICK_VELOCITY, pickSnap, rubberBand } from './dockPhysics'

/** Pointer travel (px) before a press becomes a drag: below it, a click. */
export const PAGER_SLOP = 6

/** How long the release takes to settle onto a board, in ms. */
export const PAGER_SNAP_MS = 200

/** Resistance at an edge with no board behind it: macOS's gentle 0.3×. */
const EDGE_SLOPE = 0.3

/**
 * How far an edge can be pulled, as a fraction of one page. The rubber band is
 * asymptotic, so this is the most the board ever leans past home (the first px
 * still moves 0.3 px, see EDGE_SLOPE).
 */
const EDGE_REACH = 0.35

/**
 * One page of travel: the board's visible width plus a gap, so the board
 * arriving from the far edge clears the one leaving by a visible seam.
 */
export function pagerTravel(boardW: number): number {
  return Math.round(boardW + Math.max(16, boardW * 0.06))
}

/**
 * Raw pointer travel → the board's shown offset. Inside the row the pager is
 * hard-stopped one page over (a group is either here or one page away, never
 * two); past an end (`hasPrev` / `hasNext` false) the offset rubber-bands, so
 * the board leans and springs back rather than tearing off the edge.
 */
export function pagerOffset(raw: number, travel: number, hasPrev: boolean, hasNext: boolean): number {
  if (raw > 0)
    return hasPrev ? Math.min(raw, travel) : rubberBand(raw, travel * EDGE_REACH, EDGE_SLOPE)
  if (raw < 0)
    return hasNext ? Math.max(raw, -travel) : -rubberBand(-raw, travel * EDGE_REACH, EDGE_SLOPE)
  return 0
}

/**
 * Which board the release lands on, as a step over the group list: 0 stays,
 * +1 is the next group (dragged left), −1 the previous one (dragged right).
 *
 * A slow release lands on the page it is nearest (`pickSnap`, no velocity):
 * past half a travel it goes where it leans. A flick (`FLICK_VELOCITY`, the
 * dock's threshold) decides on its own instead: with the lean it carries the
 * page over, so a short quick flick still switches; against it (flicking the
 * board back the way it came) it settles home rather than sailing through to
 * the far page. An end of the row has nowhere to go and settles home too.
 */
export function pagerStep(pos: number, velocity: number, travel: number, hasPrev: boolean, hasNext: boolean): -1 | 0 | 1 {
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
export function pagerRestOffset(step: -1 | 0 | 1, travel: number): number {
  return step === 0 ? 0 : step > 0 ? -travel : travel
}
