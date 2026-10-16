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
