/**
 * Drawer physics for the tools dock (Vaul-inspired, no Vaul dependency).
 * Offsets are px from the top of the sheet's clip: 0 = fully open (largest
 * snap), larger = lower. Velocity is px/s, positive = moving down.
 */

/** Resistance past an edge: grows ever slower, never past `dim` px. */
export function rubberBand(overshoot: number, dim = 120, c = 0.55): number {
  if (overshoot <= 0)
    return 0
  return (1 - 1 / ((overshoot * c) / dim + 1)) * dim
}

/** Raw drag offset → displayed offset, rubber-banding beyond [min, max]. */
export function dampOffset(raw: number, min: number, max: number): number {
  if (raw < min)
    return min - rubberBand(min - raw)
  if (raw > max)
    return max + rubberBand(raw - max)
  return raw
}

/** Release speed (px/s) above which a flick always moves at least one snap. */
export const FLICK_VELOCITY = 400
/** Seconds of momentum projected forward when choosing the snap. */
const PROJECT_S = 0.2

/** The scrolled box a press landed in, if the press landed in one. */
export interface DragSurface {
  /** The press landed in the horizontally scrolled tools row. */
  horizontal: boolean
  /** The press landed in the expanded list; its scroll state, when it scrolls at all. */
  list: { scrollTop: number, clientHeight: number, scrollHeight: number } | null
}

/**
 * Who owns a press-and-move inside the drawer: the scroller the press landed
 * on, or the drawer, which follows the pointer vertically. The whole sheet is
 * drag surface, so tool buttons are as good a grab as the handle; only a
 * scroller that can still move in the drag's direction keeps the gesture.
 *
 * - A horizontal gesture in the tools row scrolls the row (the drawer has no
 *   horizontal snap).
 * - A vertical gesture in the expanded list scrolls the list while the list
 *   can still move that way, and hands over to the drawer at its edge, so the
 *   two never fight over the same drag.
 * - Everywhere else (the handle, the tool buttons, a single-row dock) the
 *   drawer takes the gesture.
 */
export function dragOwner(surface: DragSurface, dx: number, dy: number): 'drawer' | 'scroller' {
  if (surface.horizontal && Math.abs(dx) > Math.abs(dy))
    return 'scroller'
  const list = surface.list
  if (!list)
    return 'drawer'
  const max = Math.max(0, list.scrollHeight - list.clientHeight)
  if (max <= 0)
    return 'drawer'
  const top = Math.min(max, Math.max(0, Number.isFinite(list.scrollTop) ? list.scrollTop : 0))
  // Dragging down reveals earlier content: the list can only follow while it
  // is scrolled away from its top; dragging up, while it is short of its end.
  if (dy > 0)
    return top > 0 ? 'scroller' : 'drawer'
  if (dy < 0)
    return top < max ? 'scroller' : 'drawer'
  return 'drawer'
}

/**
 * Snap to land on after release: the snap nearest the position projected by
 * the release velocity (position + velocity). A fast flick moves at least
 * one snap in its direction from where the drag started.
 * `offsets` are sorted descending by height or not, any order; returns index.
 */
export function pickSnap(offsets: readonly number[], pos: number, velocity: number, from: number): number {
  const projected = pos + velocity * PROJECT_S
  let best = 0
  for (let i = 1; i < offsets.length; i++) {
    if (Math.abs(offsets[i]! - projected) < Math.abs(offsets[best]! - projected))
      best = i
  }
  if (Math.abs(velocity) >= FLICK_VELOCITY && offsets[best] === offsets[from]) {
    const dir = Math.sign(velocity)
    let next = -1
    for (let i = 0; i < offsets.length; i++) {
      const d = (offsets[i]! - offsets[from]!) * dir
      if (d > 0 && (next < 0 || d < (offsets[next]! - offsets[from]!) * dir))
        next = i
    }
    if (next >= 0)
      best = next
  }
  return best
}
