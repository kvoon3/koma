/**
 * The photo upload lifecycle (see docs/state-machines.md): the files a save
 * still has to send, how far it got, and the two ways it ends. `failed` keeps
 * the message, and `start` is legal from it, so the next Save retries without
 * a separate reset. A save cannot start while one runs.
 */
export type UploadFlowState
  = | { phase: 'idle' }
    | { phase: 'running', done: number, total: number }
    | { phase: 'done', uploaded: number }
    | { phase: 'failed', message: string }

export type UploadFlowEvent
  = | { type: 'start', total: number }
    | { type: 'progress', done: number }
    | { type: 'finished', uploaded: number }
    | { type: 'failed', message: string }
    | { type: 'dismissed' }

function count(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

export function uploadTransition(state: UploadFlowState, event: UploadFlowEvent): UploadFlowState {
  switch (event.type) {
    case 'start':
      return state.phase === 'running'
        ? state
        : { phase: 'running', done: 0, total: count(event.total) }
    case 'progress':
      return state.phase === 'running' && event.done >= state.done && event.done <= state.total
        ? { phase: 'running', done: event.done, total: state.total }
        : state
    case 'finished':
      return state.phase === 'running' ? { phase: 'done', uploaded: count(event.uploaded) } : state
    case 'failed':
      return state.phase === 'running' ? { phase: 'failed', message: event.message } : state
    case 'dismissed':
      return state.phase === 'done' || state.phase === 'failed' ? { phase: 'idle' } : state
  }
}

export const UPLOAD_IDLE: UploadFlowState = { phase: 'idle' }
