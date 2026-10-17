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

export type DockHandleIntent = 'expand' | 'collapse'

/** What the next tap does, derived from the transition: drives icon + label. */
export function dockHandleIntent(mode: ToolsDockMode, cap: DockCapacity): DockHandleIntent {
  return dockTransition(mode, { type: 'tap' }, cap) === 'icons' ? 'collapse' : 'expand'
}
