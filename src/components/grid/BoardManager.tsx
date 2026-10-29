/**
 * Board management: a full-screen Base UI Dialog (portalled to body, so it
 * covers the top bar, the dock and the safe areas) that fits every board to
 * the viewport without scrolling. Each card opens its board, checks it for a
 * batch delete, or reorders it by its handle. Selection is local UI state and
 * never enters the store; the batch delete is one commit and one undo step.
 */
import type { DragEndEvent } from '@dnd-kit/core'
import { Dialog } from '@base-ui/react/dialog'
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { Plus } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useElementSize } from '../../hooks'
import { cellRatioValue } from '../../lib/gridTools'
import { useT } from '../../lib/i18n'
import { canRemoveGroups, MAX_GRIDS } from '../../lib/workspaces'
import { isTransparentBg, useStore } from '../../store'
import { dialogButton, dialogDangerButton } from '../ui/buttonStyles'
import { BoardCard } from './BoardCard'
import { MANAGER_FOOTER_H, MANAGER_HEADER_H, managerLayout } from './managerLayout'
import { useClickGate } from './useClickGate'

const HINT_ID = 'board-manager-min-one'

export function BoardManager({ open, onClose }: {
  open: boolean
  onClose: () => void
}) {
  const t = useT()
  const grids = useStore(s => s.grids)
  const activeGridId = useStore(s => s.activeGridId)
  const workspaces = useStore(s => s.workspaces)
  const parked = useStore(s => s.parkedBoards)
  const photos = useStore(s => s.photos)
  const bg = useStore(s => s.bg)
  const ratio = cellRatioValue(useStore(s => s.gridCellRatio))

  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [contentRef, contentSize] = useElementSize<HTMLDivElement>()
  const selectAllRef = useRef<HTMLInputElement | null>(null)
  const gate = useClickGate()

  const photoById = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos])
  const transparent = isTransparentBg(bg)
  const boardOf = useCallback((id: string) => (id === activeGridId ? workspaces : parked[id]?.workspaces ?? []), [activeGridId, workspaces, parked])

  // The selected view is pruned every render: a board the store removed (or
  // undo restored away) drops out without a state sync. `selected` keeps the
  // raw ids; a fresh board is never given an id that could resurrect one.
  const chosen = useMemo(() => [...selected].filter(id => grids.some(g => g.id === id)), [selected, grids])
  const allSelected = grids.length > 0 && chosen.length === grids.length
  const someSelected = chosen.length > 0 && !allSelected
  const canDelete = canRemoveGroups(grids, chosen)

  useEffect(() => {
    if (selectAllRef.current)
      selectAllRef.current.indeterminate = someSelected
  }, [someSelected])

  const fallbackW = typeof window === 'undefined' ? 1 : window.innerWidth
  const fallbackH = typeof window === 'undefined' ? 1 : window.innerHeight - MANAGER_HEADER_H - MANAGER_FOOTER_H
  const layout = managerLayout({
    count: grids.length,
    viewW: contentSize.w || fallbackW,
    viewH: contentSize.h || fallbackH,
    ratio,
  })

  const ids = useMemo(() => grids.map(g => g.id), [grids])
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id))
      next.delete(id)
    else
      next.add(id)
    return next
  })
  const toggleAll = () => setSelected(() => (allSelected ? new Set() : new Set(ids)))

  const onOpenBoard = (id: string) => {
    if (gate.blocked())
      return
    useStore.getState().switchGrid(id)
    onClose()
  }
  const onDelete = () => {
    useStore.getState().removeGrids(chosen)
    setSelected(new Set())
  }
  const onAdd = () => {
    useStore.getState().addGrid()
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    gate.mark()
    if (!over || active.id === over.id)
      return
    const to = grids.findIndex(g => g.id === over.id)
    if (to !== -1)
      useStore.getState().moveGrid(String(active.id), to)
  }
  const onDragCancel = () => {
    gate.mark()
  }

  const hint = chosen.length > 0 && chosen.length === grids.length
  const footer = `${dialogButton} disabled:cursor-default disabled:opacity-35`
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setSelected(new Set())
          onClose()
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-(--z-modal) bg-overlay-dim backdrop-blur-[3px] transition-opacity duration-(--dur-dialog) ease-(--ease-out) data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup
          data-board-manager=""
          className="fixed inset-0 z-(--z-modal) flex h-[100dvh] w-screen flex-col bg-panel text-txt outline-0"
          style={{
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
            paddingLeft: 'env(safe-area-inset-left)',
            paddingRight: 'env(safe-area-inset-right)',
          }}
        >
          <header className="flex shrink-0 items-center gap-3 border-b border-line px-4" style={{ height: MANAGER_HEADER_H }}>
            <Dialog.Title className="text-[13.5px] font-semibold">{t('Boards')}</Dialog.Title>
            <label className="ml-auto flex h-11 cursor-pointer items-center gap-2 text-[11.5px] text-dim">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                aria-label={t('Select all boards')}
                className="size-4 cursor-pointer accent-accent"
              />
              <span className="max-sm:hidden">{t('Select all boards')}</span>
            </label>
            <Dialog.Close className={`${footer} border-line bg-transparent text-txt hover:bg-chip-hover`}>
              {t('Done')}
            </Dialog.Close>
          </header>

          <div ref={contentRef} data-manager-content="" className="min-h-0 flex-1 overflow-hidden">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
              <SortableContext items={ids} strategy={rectSortingStrategy}>
                <div className="flex size-full items-center justify-center">
                  <div
                    className="grid"
                    style={{
                      gridTemplateColumns: `repeat(${layout.cols}, ${layout.cardW}px)`,
                      gap: layout.gap,
                    }}
                  >
                    {grids.map((grid, i) => (
                      <BoardCard
                        key={grid.id}
                        grid={grid}
                        index={i}
                        board={boardOf(grid.id)}
                        cellW={layout.cardW}
                        cellH={layout.cardH}
                        thumbW={layout.thumbW}
                        thumbH={layout.thumbH}
                        ratio={ratio}
                        photoById={photoById}
                        transparent={transparent}
                        active={grid.id === activeGridId}
                        checked={selected.has(grid.id)}
                        onToggle={() => toggle(grid.id)}
                        onOpen={() => onOpenBoard(grid.id)}
                      />
                    ))}
                  </div>
                </div>
              </SortableContext>
            </DndContext>
          </div>

          <footer className="flex shrink-0 items-center gap-2 border-t border-line px-3" style={{ height: MANAGER_FOOTER_H }}>
            <span className="text-[11.5px] text-dim">{t('Selected {n}', { n: chosen.length })}</span>
            {hint && <span id={HINT_ID} className="min-w-0 flex-1 truncate text-[11px] text-faint">{t('Keep at least one board')}</span>}
            <span className="flex-1" />
            <button
              type="button"
              data-manager-delete=""
              className={dialogDangerButton}
              disabled={!canDelete}
              aria-describedby={hint ? HINT_ID : undefined}
              onClick={onDelete}
            >
              {t('Delete selected ({n})', { n: chosen.length })}
            </button>
            <button
              type="button"
              data-manager-add=""
              className={`${footer} flex items-center gap-1.5 border-line bg-transparent text-txt hover:bg-chip-hover`}
              disabled={grids.length >= MAX_GRIDS}
              onClick={onAdd}
            >
              <MorphIcon icon={Plus} size={13} strokeWidth={1.75} />
              {t('Add a board')}
            </button>
          </footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
