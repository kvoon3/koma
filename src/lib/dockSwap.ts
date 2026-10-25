/**
 * Motion for the tools dock's list swaps. The drawer keeps one tools container
 * and every route, the label tools and the focus-driven tool sets portal their
 * buttons into it, so the visible list changes in place: an instant replace
 * reads as a flicker. A swap instead slides: the outgoing list leaves to the
 * right, then the incoming one enters from the right edge travelling left.
 *
 * The direction is fixed both ways (a swap is a swap, not stack navigation):
 * both lists move rightward over the same curve. The halves are serialized, so
 * only one readable list occupies the row at a time. A crossfade put two
 * readable lists in one row, and on narrow viewports that overflowed the dock.
 * GPU-friendly only, transform + opacity.
 */
import { EASE_OUT } from './motionTokens'

/** Travel of the slide, px. A strip of buttons, not a page: subtle. */
export const DOCK_SWAP_PX = 24

/** Duration, seconds. Between --dur-surface (160ms) and --dur-dialog (180ms). */
export const DOCK_SWAP_S = 0.18

/** The shared `--ease-out` token (lib/motionTokens) drives the slide. */
export const DOCK_SWAP_EASE = EASE_OUT

/**
 * A route swap reaches the dock as two mutation batches: the old route's portal
 * unmounts (the list leaves), then the new route's mounts (the list arrives),
 * a commit apart. An arrival this soon after an exit belongs to the same swap,
 * so it still slides in.
 */
export const DOCK_SWAP_PAIR_MS = 300

/** Where one half of a swap runs inside the swap's DOCK_SWAP_S window. */
export interface SwapWindow {
  delayS: number
  durationS: number
}

export interface DockSwapPlan {
  /** Keep a static copy of the previous list and slide it out to the right. */
  ghost: SwapWindow | null
  /** Slide the live container in from the right (and fade it up). */
  enter: SwapWindow | null
}

/**
 * What a container mutation batch should animate. `hadContent` is whether the
 * dock held tools before the batch (the first population has nothing to swap
 * with, so it just appears); `midSwap` is whether an exit just ran for the
 * batch that emptied the container. Reduced motion does neither.
 *
 * Paired halves are disjoint by construction: the entrance's window starts at
 * the exit's end, so the row never holds two lists at once, and the pair still
 * costs one DOCK_SWAP_S. The entrance alone gets the whole window.
 */
export function planDockSwap(input: { hadContent: boolean, midSwap: boolean, reduce: boolean }): DockSwapPlan {
  if (input.reduce)
    return { ghost: null, enter: null }
  const ghost = input.hadContent ? { delayS: 0, durationS: DOCK_SWAP_S / 2 } : null
  const enter = ghost
    ? { delayS: ghost.delayS + ghost.durationS, durationS: DOCK_SWAP_S / 2 }
    : input.midSwap ? { delayS: 0, durationS: DOCK_SWAP_S } : null
  return { ghost, enter }
}
