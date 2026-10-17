/**
 * Motion for the tools dock's list swaps. The drawer keeps one tools container
 * and every route, the label tools and the focus-driven tool sets portal their
 * buttons into it, so the visible list changes in place: an instant replace
 * reads as a flicker. A swap instead slides: the incoming list enters from the
 * right edge travelling left, the outgoing one leaves to the right.
 *
 * The direction is fixed both ways (a swap is a swap, not stack navigation):
 * both lists move rightward over the same curve, crossing through an opacity
 * crossfade. GPU-friendly only, transform + opacity.
 */

/** Travel of the slide, px. A strip of buttons, not a page: subtle. */
export const DOCK_SWAP_PX = 24

/** Duration, seconds. Between --dur-surface (160ms) and --dur-dialog (180ms). */
export const DOCK_SWAP_S = 0.18

/** --ease-out from index.css, verbatim, for this JS-driven animation. */
export const DOCK_SWAP_EASE: [number, number, number, number] = [0.23, 1, 0.32, 1]

/**
 * A route swap reaches the dock as two mutation batches: the old route's portal
 * unmounts (the list leaves), then the new route's mounts (the list arrives),
 * a commit apart. An arrival this soon after an exit belongs to the same swap,
 * so it still slides in.
 */
export const DOCK_SWAP_PAIR_MS = 300

export interface DockSwapPlan {
  /** Keep a static copy of the previous list and slide it out to the right. */
  ghost: boolean
  /** Slide the live container in from the right (and fade it up). */
  enter: boolean
}

/**
 * What a container mutation batch should animate. `hadContent` is whether the
 * dock held tools before the batch (the first population has nothing to swap
 * with, so it just appears); `midSwap` is whether an exit just ran for the
 * batch that emptied the container. Reduced motion does neither.
 */
export function planDockSwap(input: { hadContent: boolean, midSwap: boolean, reduce: boolean }): DockSwapPlan {
  if (input.reduce)
    return { ghost: false, enter: false }
  return { ghost: input.hadContent, enter: input.hadContent || input.midSwap }
}
