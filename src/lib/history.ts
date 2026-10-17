/**
 * Undo / redo stacks over whole-state snapshots. Pure, so the store keeps the
 * two arrays (plus the coalescing tag) in its own state and every transition
 * here is unit-tested without a store.
 *
 * A snapshot is a shallow view of the undoable slices (the workspace array,
 * its objects and the background are all replaced, never mutated, by the
 * store's actions), so an entry costs a handful of references: fifty of them
 * stay well under a kilobyte of bookkeeping.
 */

/** How many undo steps a session keeps. Older ones fall off the bottom. */
export const HISTORY_LIMIT = 50

/**
 * A drag emits a stream of mutations (every pointermove, every wheel tick).
 * Commits sharing a `tag` inside this window collapse into the single entry
 * the drag started with, so one gesture is one undo step.
 */
export const COALESCE_MS = 600

export interface History<T> {
  /** Snapshots before each mutation, oldest first. */
  past: T[]
  /** Snapshots after undos, newest last: the redo path. */
  future: T[]
  /** Coalescing tag of the newest `past` entry. */
  tag: string | null
  /** When that entry was recorded (ms), for the coalescing window. */
  at: number
}

export function emptyHistory<T>(): History<T> {
  return { past: [], future: [], tag: null, at: 0 }
}

/** Keep the newest `limit` entries. */
function capped<T>(list: T[], limit: number): T[] {
  return list.length > limit ? list.slice(list.length - limit) : list
}

/**
 * Record `snapshot`: the state as it was before the mutation about to run.
 * A new action always drops the redo path; a commit that continues the same
 * gesture (`tag` unchanged inside COALESCE_MS) keeps the entry already on the
 * stack, so undo returns to before the gesture began.
 */
export function record<T>(
  history: History<T>,
  snapshot: T,
  now = Date.now(),
  tag: string | null = null,
  limit = HISTORY_LIMIT,
): History<T> {
  if (tag != null && history.tag === tag && now - history.at < COALESCE_MS) {
    // Same gesture: the first snapshot is the one undo should reach.
    return { ...history, at: now }
  }
  return { past: capped([...history.past, snapshot], limit), future: [], tag, at: now }
}

export interface Step<T> {
  history: History<T>
  snapshot: T
}

/** Step back one entry, pushing `current` onto the redo path. Null at the bottom. */
export function undoStep<T>(history: History<T>, current: T): Step<T> | null {
  const snapshot = history.past.at(-1)
  if (snapshot === undefined)
    return null
  return {
    history: { past: history.past.slice(0, -1), future: [...history.future, current], tag: null, at: 0 },
    snapshot,
  }
}

/** Step forward one entry, pushing `current` back onto the undo path. Null at the top. */
export function redoStep<T>(history: History<T>, current: T, limit = HISTORY_LIMIT): Step<T> | null {
  const snapshot = history.future.at(-1)
  if (snapshot === undefined)
    return null
  return {
    history: {
      past: capped([...history.past, current], limit),
      future: history.future.slice(0, -1),
      tag: null,
      at: 0,
    },
    snapshot,
  }
}

export const canUndo = <T>(history: History<T>): boolean => history.past.length > 0
export const canRedo = <T>(history: History<T>): boolean => history.future.length > 0
