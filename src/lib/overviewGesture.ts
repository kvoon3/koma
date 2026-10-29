/**
 * Gesture arbitration for the overview: which press belongs to the page
 * pager, which to dnd-kit's cell reorder, which to jiggle mode, and which to
 * the control under the pointer. One table, so the pointer is never owned
 * twice.
 *
 * The load-bearing number is `SWIPE_SLOP_CELL_PX > DND_POINTER_TOLERANCE_PX`.
 * dnd-kit's PointerSensor aborts a pending activation once the pointer passes
 * its tolerance; the pager arms only past its own slop, so with the ordering
 * kept the sensor has already lost the race before the pager claims. A unit
 * test asserts the ordering, so drift fails the suite instead of the hand.
 */

export type PressOrigin = 'cell' | 'air' | 'chrome'
export type PointerKind = 'mouse' | 'touch' | 'pen'

/** dnd-kit's long press before a cell drag activates, for every pointer type. */
export const DND_POINTER_DELAY_MS = 250
/** dnd-kit aborts the pending drag past this travel: the pager's cell slop must exceed it. */
export const DND_POINTER_TOLERANCE_PX = 8

/** Air slop: below it an air press is still a tap (and an air tap exits jiggle). */
export const SWIPE_SLOP_AIR_PX = 6
/** Cell slop: above dnd-kit's tolerance, so a quick swipe wins and a hold loses. */
export const SWIPE_SLOP_CELL_PX = 14

export const AXIS_DOMINANCE = 1.2

export const JIGGLE_HOLD_MS = 500
export const JIGGLE_SLOP_PX = 10

/**
 * Controls own their press: every button, link, field and slider, the page
 * dots, the add cell, the X badge, the dock, and anything inside a dialog or a
 * menu. The manager is a React child of the stage (its DOM is portalled to
 * body), so its presses still bubble through the stage's synthetic handler and
 * have to read as chrome here.
 */
const CHROME = 'button, a[href], input, select, textarea, label, [role="slider"], [role="dialog"], [role="menu"], [role="listbox"], [role="tooltip"], [data-dock-mode], [data-add-cell], [data-cell-delete], [data-board-dots], [contenteditable="true"]'

/**
 * Classify a press target. A cell face comes first: it is a button, so the
 * chrome rule would otherwise swallow it. The X badge is a sibling of the
 * face, not a child, so it stays chrome.
 */
export function pressOrigin(target: EventTarget | null): PressOrigin {
  const el = target as { closest?: (selector: string) => Element | null } | null
  if (!el || typeof el.closest !== 'function')
    return 'air'
  if (el.closest('[data-cell]'))
    return 'cell'
  if (el.closest(CHROME))
    return 'chrome'
  return 'air'
}

export function swipeSlop(origin: PressOrigin): number | null {
  if (origin === 'cell')
    return SWIPE_SLOP_CELL_PX
  if (origin === 'air')
    return SWIPE_SLOP_AIR_PX
  return null
}

export function lockedAxis(dx: number, dy: number): 'x' | 'y' | null {
  if (Math.abs(dx) > Math.abs(dy) * AXIS_DOMINANCE)
    return 'x'
  if (Math.abs(dy) > Math.abs(dx) * AXIS_DOMINANCE)
    return 'y'
  return null
}

/**
 * Whether this move claims the page. A quick x-dominant drag from a cell or
 * from the air pages for every pointer type; a 250ms hold on a cell is
 * dnd-kit's reorder instead, and the sensor's tolerance is below the cell slop
 * so it has already aborted when the pager arms. The pointer kind travels with
 * the press for the arbitration table; it does not change the slop. An armed
 * reorder always wins.
 */
export function swipeAxis(
  origin: PressOrigin,
  _pointer: PointerKind,
  dx: number,
  dy: number,
  reorderActive: boolean,
): 'x' | null {
  if (reorderActive)
    return null
  const slop = swipeSlop(origin)
  if (slop == null)
    return null
  if (Math.max(Math.abs(dx), Math.abs(dy)) < slop)
    return null
  return lockedAxis(dx, dy) === 'x' ? 'x' : null
}

export function jiggleArmed(origin: PressOrigin, heldMs: number, dx: number, dy: number): boolean {
  return origin === 'air'
    && heldMs >= JIGGLE_HOLD_MS
    && Math.max(Math.abs(dx), Math.abs(dy)) <= JIGGLE_SLOP_PX
}
