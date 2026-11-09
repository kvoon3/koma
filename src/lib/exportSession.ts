import type { ExportItem } from '../components/ExportDialog'

/**
 * The export run's lifecycle. The router used to encode it as a `busy`
 * boolean beside the items state, which let a second export start while the
 * first was still rendering. Here the phases and their legal moves are one
 * value:
 *
 *   idle -> rendering -> previewing -> releasing -> idle
 *                  \-> idle (failure, no run to show)
 *
 * A run starts only from idle, so the single-flight rule is a property of the
 * machine rather than a disabled button that a keyboard shortcut can bypass.
 * Previewing and releasing both hold the run: the dialog animates out while
 * the URLs stay alive, and `released` is the one moment they may be revoked.
 */
export type ExportSession
  = | { phase: 'idle' }
    | { phase: 'rendering' }
    | { phase: 'previewing', run: ExportItem[] }
    | { phase: 'releasing', run: ExportItem[] }

export type ExportEvent
  = | { type: 'start' }
    | { type: 'rendered', run: ExportItem[] }
    | { type: 'failed' }
    | { type: 'dismiss' }
    | { type: 'released' }

export const EXPORT_IDLE: ExportSession = { phase: 'idle' }

/**
 * The one transition. A refused event returns the same state object, which is
 * what `useFlow` reports as "not consumed" and skips a render for.
 */
export function exportTransition(state: ExportSession, event: ExportEvent): ExportSession {
  switch (event.type) {
    case 'start':
      return state.phase === 'idle' ? { phase: 'rendering' } : state
    case 'rendered':
      return state.phase === 'rendering' ? { phase: 'previewing', run: event.run } : state
    case 'failed':
      return state.phase === 'rendering' ? EXPORT_IDLE : state
    case 'dismiss':
      return state.phase === 'previewing' ? { phase: 'releasing', run: state.run } : state
    case 'released':
      return state.phase === 'releasing' ? EXPORT_IDLE : state
  }
}

/** A render is in flight: the chrome shows its spinner and every door is shut. */
export function exportBusy(state: ExportSession): boolean {
  return state.phase === 'rendering'
}

/** The run the dialog shows, or null while there is nothing to preview. */
export function exportItems(state: ExportSession): ExportItem[] | null {
  return state.phase === 'previewing' ? state.run : null
}

/** The run whose close transition just finished, if there is one to release. */
export function exportRunToRelease(state: ExportSession): ExportItem[] | null {
  return state.phase === 'releasing' ? state.run : null
}
