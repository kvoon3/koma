/**
 * The overview's drag-to-reorder (dnd-kit, insert-shift).
 *
 * A distance threshold keeps plain clicks for entering a workspace; once a drag
 * activates, the dragged cell rides a `DragOverlay` that tracks the pointer 1:1
 * while the rest make room live (`rectSortingStrategy`), and the drop commits
 * through `moveWorkspace` (or removes the cell when it lands on the delete
 * strip). Nothing here renders: the overview draws the cells and the overlay.
 */
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import type { Workspace } from '../../store'
import {
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'

/** The delete strip's droppable id (it sits outside the grid). */
export const DELETE_ZONE_ID = '__delete__'

export function useGridReorder({ workspaces, moveWorkspace }: {
  workspaces: Workspace[]
  /** Commit a reorder: the moved cell's id and its new index. */
  moveWorkspace: (id: string, to: number) => void
}) {
  const [dragId, setDragId] = useState<string | null>(null)
  // Mouse drags after 5px; touch is a long press, like the stage carry. The
  // TouchSensor adds the non-passive touchmove iOS Safari needs, so the
  // browser can't claim the touch (pointercancel) before the drag arms.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  )
  // Suppress the click that follows a finished drag; it must not enter.
  const dragEndedAtRef = useRef(0)
  /** Set while dnd-kit owns a cell drag: the overview's pull-down must not fight it. */
  const dragIdRef = useRef<string | null>(null)

  const ids = useMemo(() => workspaces.map(w => w.id), [workspaces])
  const draggedWs = dragId ? workspaces.find(w => w.id === dragId) : null

  const onDragStart = (e: DragStartEvent) => {
    dragIdRef.current = String(e.active.id)
    setDragId(String(e.active.id))
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    dragIdRef.current = null
    setDragId(null)
    dragEndedAtRef.current = Date.now()
    if (over?.id === DELETE_ZONE_ID) {
      navigator.vibrate?.(10)
      useStore.getState().removeWorkspace(String(active.id))
      return
    }
    if (!over || active.id === over.id)
      return
    const arr = useStore.getState().workspaces
    const from = arr.findIndex(w => w.id === active.id)
    const to = arr.findIndex(w => w.id === over.id)
    if (from !== -1 && to !== -1)
      moveWorkspace(arr[from].id, to)
  }

  const onDragCancel = () => {
    dragIdRef.current = null
    setDragId(null)
    dragEndedAtRef.current = Date.now()
  }

  return { dragId, ids, draggedWs, sensors, dragEndedAtRef, dragIdRef, onDragStart, onDragEnd, onDragCancel }
}
