import type { CloudProjectSummary } from './cloudSession'

/**
 * The cloud open dialog's list lifecycle: one fetch per opening, its result,
 * and the close that drops it. Kept separate from the save flow so a save in
 * flight and a list refresh are never one phase union.
 */
export type CloudOpenState
  = | { phase: 'idle' }
    | { phase: 'loading' }
    | { phase: 'ready', projects: CloudProjectSummary[] }
    | { phase: 'error', message: string }

export type CloudOpenEvent
  = | { type: 'open' }
    | { type: 'loaded', projects: CloudProjectSummary[] }
    | { type: 'failed', message: string }
    | { type: 'close' }

export function cloudOpenTransition(state: CloudOpenState, event: CloudOpenEvent): CloudOpenState {
  switch (event.type) {
    case 'open':
      return state.phase === 'loading' ? state : { phase: 'loading' }
    case 'loaded':
      return state.phase === 'loading' ? { phase: 'ready', projects: event.projects } : state
    case 'failed':
      return state.phase === 'loading' ? { phase: 'error', message: event.message } : state
    case 'close':
      return { phase: 'idle' }
  }
}

export const CLOUD_OPEN_IDLE: CloudOpenState = { phase: 'idle' }
