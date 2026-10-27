import type { ToolsDockMode } from '../store'

/** Measured-content capacity: does every dock item fit on a single row? */
export interface DockCapacity { fitsOneRow: boolean }

export type DockEvent
  = | { type: 'tap' }
    | { type: 'snap', mode: ToolsDockMode }
    | { type: 'dismiss' }

/**
 * Modes reachable for the given capacity, in tap-cycle order: the icon-only
 * row, the labelled row, then the wrapped multi-row (only while the tools do
 * not fit one row). There is no put-away mode: the drawer is always open, the
 * cycle just walks the three displays.
 */
export function dockModes(cap: DockCapacity): readonly ToolsDockMode[] {
  return cap.fitsOneRow ? ['icons', 'row'] : ['icons', 'row', 'expanded']
}

/** Clamp a mode into what the capacity allows (expanded → row when one row fits). */
export function clampDockMode(mode: ToolsDockMode, cap: DockCapacity): ToolsDockMode {
  return mode === 'expanded' && cap.fitsOneRow ? 'row' : mode
}

/**
 * Pure transition: tap cycles icons → row → expanded → icons
 * (icons ↔ row when everything fits one row); drag snaps are clamped;
 * dismiss (a swipe that would close the drawer) lands on the compact
 * icon-only row instead, since the drawer cannot be put away.
 */
export function dockTransition(mode: ToolsDockMode, event: DockEvent, cap: DockCapacity): ToolsDockMode {
  switch (event.type) {
    case 'tap': {
      const modes = dockModes(cap)
      const i = modes.indexOf(clampDockMode(mode, cap))
      return modes[(i + 1) % modes.length]!
    }
    case 'snap':
      return clampDockMode(event.mode, cap)
    case 'dismiss':
      return 'icons'
  }
}

/**
 * The live sheet height (px, handle included) at which the display switches
 * between two adjacent snap heights: the midpoint, so the crossing sits exactly
 * where a nearest-snap release would have landed.
 */
export function dockModeMidpoint(lower: number, upper: number): number {
  return (lower + upper) / 2
}

/**
 * The display whose band a live sheet height falls in, given the modes
 * `dockModes(cap)` allows (tap-cycle order: icons, row, expanded) and their
 * snap heights in the same order. Crossing the midpoint between two adjacent
 * heights is the switch, so a drag morphs the content as the pointer crosses
 * it and the release only settles the position.
 *
 * Only `order`'s own modes are reachable: a two-mode dock has one threshold and
 * can never land on the missing `expanded`. A height exactly on a midpoint has
 * not crossed it yet, which is `pickSnap`'s tie-break too, so a release at the
 * threshold lands on the display the crossing already chose.
 */
export function dockModeAtHeight(
  order: readonly ToolsDockMode[],
  heights: readonly number[],
  liveH: number,
): ToolsDockMode {
  for (let i = 1; i < order.length; i++) {
    if (liveH <= dockModeMidpoint(heights[i - 1]!, heights[i]!))
      return order[i - 1]!
  }
  return order[order.length - 1]!
}

/**
 * A display commit within this many px of a band edge is at the edge. Half a
 * pixel is the repo's layout-noise tolerance (lib/dockFlip).
 */
export const DOCK_DISPLAY_EPS = 0.5

/** The one pair the displacement field serves (see lib/dockBand). */
export function isBandTransition(from: ToolsDockMode, to: ToolsDockMode): boolean {
  return (from === 'row' && to === 'expanded') || (from === 'expanded' && to === 'row')
}

/**
 * The display the live height shows, given the display on screen.
 *
 * The latch: icons ⇄ row keeps the midpoint rule, because that swap is a
 * caption fold rather than a spatial move, and committing it earlier would
 * open a blank strip over the shorter icons layout. Row ⇄ expanded commits at
 * the band edges, where the projected field already equals the incoming
 * layout (lib/dockBand). `prev` is the commitment's memory: mid-band the same
 * height is crossed in both directions, so the height alone cannot say which
 * base the field is over, and the last commit stands until an edge crosses.
 *
 * Reduced motion, a two-mode dock, or a degenerate band (heights within a
 * pixel) fall back to `dockModeAtHeight` exactly: one swap at the midpoint,
 * no field. That fallback runs before the icons branch, so the two-mode dock
 * keeps one threshold and never assumes an `icons` snap exists. Only a raw
 * pointer move may ask this; taps and releases commit `dockTransition`'s own
 * answer through the sheet's one mode writer, which is why the edge overlap
 * needs no direction parameter.
 */
export function dockDisplayAt(input: {
  order: readonly ToolsDockMode[]
  heights: readonly number[]
  liveH: number
  prev: ToolsDockMode
  reduce: boolean
}): ToolsDockMode {
  const { order, heights, liveH, prev, reduce } = input
  const iRow = order.indexOf('row')
  const iExp = order.indexOf('expanded')
  const iIcons = order.indexOf('icons')
  // Defensive: not a dock order. The last mode is the largest display.
  if (iRow < 0)
    return order.at(-1)!
  if (reduce || iIcons < 0 || iExp < 0 || heights[iExp]! - heights[iRow]! < 1)
    return dockModeAtHeight(order, heights, liveH)
  if (liveH <= dockModeMidpoint(heights[iIcons]!, heights[iRow]!))
    return 'icons'
  return prev === 'expanded'
    ? (liveH <= heights[iRow]! + DOCK_DISPLAY_EPS ? 'row' : 'expanded')
    : (liveH >= heights[iExp]! - DOCK_DISPLAY_EPS ? 'expanded' : 'row')
}

export type DockHandleIntent = 'expand' | 'collapse'

/** What the next tap does, derived from the transition: drives icon + label. */
export function dockHandleIntent(mode: ToolsDockMode, cap: DockCapacity): DockHandleIntent {
  return dockTransition(mode, { type: 'tap' }, cap) === 'icons' ? 'collapse' : 'expand'
}
