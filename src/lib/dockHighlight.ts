/**
 * The dock highlight box's pure geometry: where a glide starts, how far a
 * handed-over panel travels, whether two triggers share a row, and whether a
 * mutation batch is only Base UI focus guards. No DOM, no animation state.
 *
 * Two coordinate spaces share `DockBox` and must never be mixed: the content
 * box (`boxIn` + offset size) is scroll- and transform-free, while the visual
 * box (`getBoundingClientRect`) carries scroll, FLIP transforms and band
 * translate. Every function here takes visual boxes; the box element stores
 * its resting `left/top` in content space.
 */

export interface DockBox {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface DockPoint {
  readonly x: number
  readonly y: number
}

/** Moves under half a pixel are layout noise, not motion (lib/dockFlip). */
export const DOCK_BOX_EPSILON = 0.5

/** Where the box must start so it looks like it is at `painted` and lands on `target`. */
export function glideDelta(painted: DockBox, target: DockBox): DockPoint {
  return { x: painted.left - target.left, y: painted.top - target.top }
}

/**
 * Panel travel: the outgoing trigger's box expressed in the incoming trigger's
 * frame. Both axes, because the wrapped display stacks rows and two neighbours
 * can share a row without sharing the outgoing panel's frame.
 */
export function hopDelta(from: DockBox, to: DockBox): DockPoint {
  return { x: from.left - to.left, y: from.top - to.top }
}

/**
 * Do two trigger boxes share a row band? In the wrapped display a panel sits
 * above its trigger, over the row above it, so only a candidate whose vertical
 * box overlaps the open trigger's by half the shorter height may take over.
 */
export function sameRowBand(a: DockBox, b: DockBox, share = 0.5): boolean {
  const overlap = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top)
  return overlap > 0 && overlap >= share * Math.min(a.height, b.height)
}

/**
 * Is the box already at its target? The top-left corner decides: a glide fixes
 * position and a commit snaps width/height, so a size-only change is not a move.
 */
export function isStill(a: DockBox, b: DockBox, eps = DOCK_BOX_EPSILON): boolean {
  return Math.abs(a.left - b.left) < eps && Math.abs(a.top - b.top) < eps
}

/**
 * A child-list mutation record shaped for the guard predicate, so the decision
 * stays testable without a DOM: the nodes that were added and removed, and the
 * record's type. `added` and `removed` are only meaningful on `childList`.
 */
export interface DockMutationBatchRecord {
  readonly type: string
  readonly added: readonly unknown[]
  readonly removed: readonly unknown[]
}

/**
 * Is a mutation batch nothing but Base UI focus-guard churn? A non-modal dock
 * popover parks two fixed, 1×1, out-of-flow spans beside its trigger, and their
 * arriving and leaving are not layout changes. Strict on purpose: an empty
 * batch, another record type (an attribute or character change), or any node
 * that is not a guard falls through to the full measure.
 */
export function guardsOnly(records: readonly DockMutationBatchRecord[], isGuard: (node: unknown) => boolean): boolean {
  if (records.length === 0)
    return false
  return records.every((record) => {
    if (record.type !== 'childList')
      return false
    const nodes = [...record.added, ...record.removed]
    return nodes.length > 0 && nodes.every(isGuard)
  })
}
