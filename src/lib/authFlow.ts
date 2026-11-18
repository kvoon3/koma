/**
 * The sign-in / sign-up form lifecycle (see docs/state-machines.md): one
 * attempt, submitting, its outcome, and the reset back to idle.
 */
export type AuthFlowState
  = | { phase: 'idle' }
    | { phase: 'signingIn' }
    | { phase: 'signedIn', email: string }
    | { phase: 'error', message: string }

export type AuthFlowEvent
  = | { type: 'submit' }
    | { type: 'resolved', email: string }
    | { type: 'failed', message: string }
    | { type: 'dismissed' }

/** The same state and event always fold to the same state; refusals return it unchanged. */
export function authTransition(state: AuthFlowState, event: AuthFlowEvent): AuthFlowState {
  switch (event.type) {
    case 'submit':
      return state.phase === 'idle' || state.phase === 'error' ? { phase: 'signingIn' } : state
    case 'resolved':
      return state.phase === 'signingIn' ? { phase: 'signedIn', email: event.email } : state
    case 'failed':
      return state.phase === 'signingIn' ? { phase: 'error', message: event.message } : state
    case 'dismissed':
      return state.phase === 'error' ? { phase: 'idle' } : state
  }
}

export const AUTH_IDLE: AuthFlowState = { phase: 'idle' }
