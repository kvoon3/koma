/**
 * The groups page's drag-to-reorder (dnd-kit, insert-shift).
 *
 * The same sensors and feel as the overview's cell reorder
 * (`grid/useGridReorder`): a mouse drag arms after 5px, a touch drag after a
 * 250ms hold, and the drop commits through the store's `moveGrid`. No delete
 * strip here; deletion is the checkbox-gated `x` on the tile, not a drop.
 */
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import type { GridGroup } from '../../lib/workspaces'
import { MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { useMemo, useRef, useState } from 'react'

export function useGroupsReorder({ grids, moveGrid }: {
  grids: readonly GridGroup[]
  /** Commit a reorder: the moved group's id and its new index. */
  moveGrid: (id: string, to: number) => void
}) {
  const [dragId, setDragId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  )
  // Suppress the clicks that follow a finished drag: the tile must not open
  // and the page's blank-click exit must not fire.
  const dragEndedAtRef = useRef(0)

  const ids = useMemo(() => grids.map(g => g.id), [grids])

  const onDragStart = (e: DragStartEvent) => {
    setDragId(String(e.active.id))
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragId(null)
    dragEndedAtRef.current = Date.now()
    if (!over || active.id === over.id)
      return
    const from = grids.findIndex(g => g.id === active.id)
    const to = grids.findIndex(g => g.id === over.id)
    if (from !== -1 && to !== -1)
      moveGrid(grids[from].id, to)
  }

  const onDragCancel = () => {
    setDragId(null)
    dragEndedAtRef.current = Date.now()
  }

  return { dragId, ids, sensors, dragEndedAtRef, onDragStart, onDragEnd, onDragCancel }
}
