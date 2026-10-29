/**
 * One timestamp gate shared by the two gesture owners: the page pager and
 * dnd-kit's cell reorder. A pointer release that ended a drag, or a swipe that
 * ended a page, is followed by a browser click (on the cell under the pointer
 * or its common ancestor); that click must not open the editor. 120ms matches
 * the guard the grid always used.
 */
import { useMemo, useRef } from 'react'

export interface ClickGate {
  /** A gesture just ended: the click it emits is not a tap. */
  mark: () => void
  /** True while a click from that gesture could still arrive. */
  blocked: () => boolean
}

export function useClickGate(ms = 120): ClickGate {
  const atRef = useRef(Number.NEGATIVE_INFINITY)
  return useMemo(() => ({
    mark: () => {
      atRef.current = Date.now()
    },
    blocked: () => Date.now() - atRef.current <= ms,
  }), [ms])
}
