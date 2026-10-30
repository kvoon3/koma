/**
 * Gesture thresholds shared by the board pull-down and the page pager: one
 * slop before a press becomes a drag, one axis rule so a sideways and a
 * vertical gesture never fight over the same press, and one release helper.
 */

/** Pointer travel (px) before a press becomes a drag: below it, a click. */
export const PAGER_SLOP = 6

/**
 * How far a pull travels before it commits: down on the board to open the
 * groups page, up on the page to leave it. Below it the press is still a click.
 */
export const PULL_COMMIT = 70

/** How much one axis must outweigh the other before a gesture locks to it. */
export const PULL_DOMINANCE = 1.2

/**
 * Which axis a gesture past the slop belongs to, decided once. A drag too close
 * to the diagonal has not committed to either yet (null), so nothing is
 * hijacked.
 */
export function lockedAxis(dx: number, dy: number): 'x' | 'y' | null {
  if (Math.abs(dx) > Math.abs(dy) * PULL_DOMINANCE)
    return 'x'
  if (Math.abs(dy) > Math.abs(dx) * PULL_DOMINANCE)
    return 'y'
  return null
}

/** Hand a captured pointer back, if this element still has it. */
export function releaseCapture(el: HTMLElement, pointerId: number) {
  if (el.hasPointerCapture(pointerId))
    el.releasePointerCapture(pointerId)
}
