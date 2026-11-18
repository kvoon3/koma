/**
 * The cloud save lifecycle (see docs/state-machines.md): one explicit save,
 * its outcome, and the two ways it can fail. There is no auto-sync and no
 * merge state: a conflict asks the user to reload the cloud copy, it never
 * combines the two documents.
 */
export type SyncFlowState
  = | { phase: 'idle' }
    | { phase: 'saving' }
    | { phase: 'saved', projectId: string, updatedAt: string }
    | { phase: 'conflict' }
    | { phase: 'error', message: string }

export type SyncFlowEvent
  = | { type: 'save' }
    | { type: 'saved', projectId: string, updatedAt: string }
    | { type: 'conflict' }
    | { type: 'failed', message: string }
    | { type: 'dismissed' }
    | { type: 'reset' }

/**
 * A save starts only from rest. `saved` is rest for the next save; `error`
 * is retryable; `conflict` is not, because the client no longer holds the
 * row's timestamp and another attempt would answer 409 again. `reset` is the
 * way out (loading the cloud copy or clearing the project). It also cancels
 * an in-flight save so a later `saved` / `failed` / `conflict` is refused and
 * cannot rewrite the identity the open just wrote.
 */
export function syncTransition(state: SyncFlowState, event: SyncFlowEvent): SyncFlowState {
  switch (event.type) {
    case 'save':
      return state.phase === 'idle' || state.phase === 'saved' || state.phase === 'error'
        ? { phase: 'saving' }
        : state
    case 'saved':
      return state.phase === 'saving'
        ? { phase: 'saved', projectId: event.projectId, updatedAt: event.updatedAt }
        : state
    case 'conflict':
      return state.phase === 'saving' ? { phase: 'conflict' } : state
    case 'failed':
      return state.phase === 'saving' ? { phase: 'error', message: event.message } : state
    case 'dismissed':
      return state.phase === 'saved' || state.phase === 'error' ? { phase: 'idle' } : state
    case 'reset':
      return { phase: 'idle' }
  }
}

export const SYNC_IDLE: SyncFlowState = { phase: 'idle' }
