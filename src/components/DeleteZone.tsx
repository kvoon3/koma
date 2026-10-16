import { Trash2 } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useDeleteZone } from '../lib/deleteZone'

/**
 * Red drop strip pinned directly under the top bar while a pane or grid cell
 * is dragged. Dropping the piece on it deletes it; `setRef` lets the grid hand
 * in dnd-kit's droppable ref, and `over` overrides the store's hover state.
 */
export function DeleteZone({ setRef, over: overProp, active: activeProp, label }: {
  setRef?: (el: HTMLElement | null) => void
  over?: boolean
  active?: boolean
  label: string
}) {
  const store = useDeleteZone()
  const active = activeProp ?? store.active
  const over = overProp ?? store.over
  return (
    <div
      ref={setRef}
      data-delete-zone=""
      data-over={over ? '' : undefined}
      aria-hidden={!active}
      className={`absolute inset-x-0 top-0 z-[60] flex h-14 items-center justify-center gap-2 text-sm font-semibold text-white transition-[opacity,translate,background-color] duration-(--dur-fast) ${
        active ? ' translate-y-0 opacity-100' : ' pointer-events-none -translate-y-2 opacity-0'
      }${over ? ' bg-danger' : ' bg-danger/75'}`}
    >
      <MorphIcon icon={Trash2} size={16} strokeWidth={2} />
      {label}
    </div>
  )
}
