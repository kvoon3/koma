import { useCallback, useRef, useState } from 'react'

/** A pure transition: the same state and event always fold to the same state. */
export type FlowTransition<S, E> = (state: S, event: E) => S

/**
 * A state machine bound to a component. `send` folds one event through the
 * pure transition and drops events the current state refuses (the transition
 * returns the same object). The ref is the synchronous source of truth, so an
 * async callback, a double click in one frame, or a late promise all read the
 * state the machine is actually in, not the one the last render saw.
 *
 * The transition stays a module-level function: it is testable without React,
 * and the hook adds only the binding.
 */
export function useFlow<S, E>(initial: S, transition: FlowTransition<S, E>) {
  const [state, setState] = useState(initial)
  const ref = useRef(state)

  const send = useCallback((event: E) => {
    const next = transition(ref.current, event)
    if (next === ref.current)
      return false
    ref.current = next
    setState(next)
    return true
  }, [transition])

  /** The latest state, for async callbacks that run after their render. */
  const latest = useCallback(() => ref.current, [])

  return { state, send, latest }
}
