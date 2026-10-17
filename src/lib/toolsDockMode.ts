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

export type DockHandleIntent = 'expand' | 'collapse'

/** What the next tap does, derived from the transition: drives icon + label. */
export function dockHandleIntent(mode: ToolsDockMode, cap: DockCapacity): DockHandleIntent {
  return dockTransition(mode, { type: 'tap' }, cap) === 'icons' ? 'collapse' : 'expand'
}
