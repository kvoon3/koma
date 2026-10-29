/**
 * The overview's drag-to-reorder (dnd-kit, insert-shift).
 *
 * A long press (250ms, 8px tolerance) starts a reorder for every pointer
 * type: mouse, touch and pen. Once a drag activates, the dragged cell rides a
 * `DragOverlay` that tracks the pointer 1:1 while the rest make room live
 * (`rectSortingStrategy`), and the drop commits through `moveWorkspace` (or
 * removes the cell when it lands on the delete strip). The constants live in
 * `lib/overviewGesture`, because the pager's cell slop has to stay above the
 * sensor's tolerance. Nothing here renders: the overview draws the cells.
 */
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import type { Workspace } from '../../store'
import type { ClickGate } from './useClickGate'
import {
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { useMemo, useRef, useState } from 'react'
import { DND_POINTER_DELAY_MS, DND_POINTER_TOLERANCE_PX } from '../../lib/overviewGesture'
import { useStore } from '../../store'

/** The delete strip's droppable id (it sits outside the grid). */
export const DELETE_ZONE_ID = '__delete__'

/** No sensors at all: the manager owns the stage, so nothing may arm. */
const NO_SENSORS: [] = []

export function useGridReorder({ workspaces, moveWorkspace, gate, enabled = true }: {
  workspaces: Workspace[]
  /** Commit a reorder: the moved cell's id and its new index. */
  moveWorkspace: (id: string, to: number) => void
  /** Marks the click that follows a drag, so it cannot enter a cell. */
  gate: ClickGate
  /** False while the board manager owns the screen. */
  enabled?: boolean
}) {
  const [dragId, setDragId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { delay: DND_POINTER_DELAY_MS, tolerance: DND_POINTER_TOLERANCE_PX },
    }),
  )
  /** Set while dnd-kit owns a cell drag: the pager must not fight it. */
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
    gate.mark()
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
    gate.mark()
  }

  return {
    dragId,
    ids,
    draggedWs,
    sensors: enabled ? sensors : NO_SENSORS,
    dragIdRef,
    onDragStart,
    onDragEnd,
    onDragCancel,
  }
}
