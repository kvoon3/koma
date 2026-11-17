/**
 * The sign-in / sign-up form lifecycle (see docs/state-machines.md). The
 * machine owns one form attempt: submitting, its outcome, and the reset back
 * to idle. Whether a session exists at all is the auth client's `useSession`
 * state, not a machine concern: the component initializes the machine from it
 * and forwards sign-outs, so the two never hold contradicting truths.
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
    | { type: 'signedOut' }

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
    case 'signedOut':
      return state.phase === 'signedIn' ? { phase: 'idle' } : state
  }
}

export const AUTH_IDLE: AuthFlowState = { phase: 'idle' }

/** A submit is only legal from idle or after an error was dismissed. */
export function canSubmit(state: AuthFlowState): boolean {
  return state.phase === 'idle' || state.phase === 'error'
}
