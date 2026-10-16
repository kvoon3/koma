import type { ToolsDockMode } from '../store'

/** Measured-content capacity: does every dock item fit on a single row? */
export interface DockCapacity { fitsOneRow: boolean }

export type DockEvent
  = | { type: 'tap' }
    | { type: 'snap', mode: ToolsDockMode }
    | { type: 'dismiss' }

/** Modes reachable for the given capacity, in tap-cycle order. */
export function dockModes(cap: DockCapacity): readonly ToolsDockMode[] {
  return cap.fitsOneRow ? ['collapsed', 'row'] : ['collapsed', 'row', 'expanded']
}

/** Clamp a mode into what the capacity allows (expanded → row when one row fits). */
export function clampDockMode(mode: ToolsDockMode, cap: DockCapacity): ToolsDockMode {
  return mode === 'expanded' && cap.fitsOneRow ? 'row' : mode
}

/**
 * Pure transition: tap cycles collapsed → row → expanded → collapsed
 * (collapsed ↔ row when everything fits one row); drag snaps are clamped;
 * dismiss (swipe past the bottom) collapses instead of closing.
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
      return 'collapsed'
  }
}
