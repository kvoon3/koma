import type { CollisionDetection } from '@dnd-kit/core'
import { closestCenter, pointerWithin } from '@dnd-kit/core'
import { create } from 'zustand'

/**
 * The drag-to-delete strip under the top bar. `active` shows it (a pane carry
 * on the stage or a cell drag on the grid is in flight); `over` lights it up
 * while the carried piece hovers it.
 */
export const useDeleteZone = create<{ active: boolean, over: boolean }>(() => ({ active: false, over: false }))

export function setDeleteZone(active: boolean, over = false) {
  const s = useDeleteZone.getState()
  if (s.active !== active || s.over !== over)
    useDeleteZone.setState({ active, over })
}

/** Is the viewport point over the delete strip? */
export function overDeleteZone(x: number, y: number): boolean {
  return document.elementsFromPoint(x, y).some(n => n.closest('[data-delete-zone]'))
}

/** The delete strip's droppable id, shared by every drag that can drop on it. */
export const DELETE_ZONE_ID = '__delete__'

/**
 * Collision detection for a sortable list that also carries the delete strip:
 * the strip is hit by the pointer itself (it sits outside the sortable flow,
 * so nearest-center would never pick it, and must not steal near-top drops),
 * every other drop is decided by the pointer too, with `closestCenter` as the
 * fallback for a pointer resting in a gap. The pointer-first rule also keeps a
 * CSS-scaled canvas honest: dnd-kit's translate (screen pixels) and the
 * collided rect (the rect plus that translate) can disagree by the scale,
 * while the pointer and every droppable rect share one space.
 */
export const deleteFirst: CollisionDetection = (args) => {
  const hit = pointerWithin(args)
  const zone = hit.filter(c => c.id === DELETE_ZONE_ID)
  if (zone.length)
    return zone
  const cells = hit.filter(c => c.id !== DELETE_ZONE_ID)
  if (cells.length)
    return cells
  return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter(c => c.id !== DELETE_ZONE_ID) })
}
