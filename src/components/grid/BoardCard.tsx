/**
 * The board manager's card: a measured 3×3 thumbnail that opens the board, a
 * bottom bar with a 44px checkbox, the board's number and the drag handle, and
 * the active ring. Only the handle is a drag source, so pressing the thumbnail
 * or the checkbox never reorders.
 */
import type { Photo } from '../../lib/imageStore'
import type { GridGroup } from '../../lib/workspaces'
import type { BoardCells } from './overviewLayout'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useElementSize } from '../../hooks'
import { useT } from '../../lib/i18n'
import { leafList } from '../../lib/panes'
import { MAX_WORKSPACES } from '../../lib/workspaces'
import { CellPreview } from './CellPreview'
import { MANAGER_BAR_H, MANAGER_PAD, MANAGER_THUMB_GAP, thumbnailCell } from './managerLayout'

const SLOTS = Array.from({ length: MAX_WORKSPACES }, (_, i) => i)

export function BoardCard({ grid, index, board, cellW, cellH, thumbW, thumbH, ratio, photoById, transparent, active, checked, onToggle, onOpen }: {
  grid: GridGroup
  index: number
  board: BoardCells
  cellW: number
  cellH: number
  thumbW: number
  thumbH: number
  ratio: number
  photoById: Map<string, Photo>
  transparent: boolean
  active: boolean
  checked: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  const t = useT()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: grid.id })
  const n = index + 1
  return (
    <div
      ref={setNodeRef}
      data-board-card=""
      data-active={active || undefined}
      className={`relative flex flex-col border bg-panel-2 ${
        active
          ? ' border-line-strong outline-2 outline-offset-1 outline-sel'
          : ' border-line outline-2 outline-offset-1 outline-transparent'
      }`}
      style={{
        width: cellW,
        height: cellH,
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : 1,
        zIndex: isDragging ? 10 : undefined,
      }}
    >
      <button
        type="button"
        data-board-preview=""
        className="block w-full cursor-pointer border-0 bg-pane-bg p-0 outline-0 focus-visible:outline-2 focus-visible:outline-accent"
        style={{ height: thumbH + 2 * MANAGER_PAD, padding: MANAGER_PAD }}
        aria-label={t('Open board {n}', { n })}
        aria-current={active || undefined}
        onClick={onOpen}
      >
        <BoardThumb board={board} thumbW={thumbW} thumbH={thumbH} ratio={ratio} photoById={photoById} transparent={transparent} />
      </button>
      <div className="flex shrink-0 items-center gap-1 border-t border-line px-1" style={{ height: MANAGER_BAR_H }}>
        <label className="grid size-11 shrink-0 cursor-pointer place-items-center">
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            aria-label={t('Select board {n}', { n })}
            className="size-4 cursor-pointer accent-accent"
          />
        </label>
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-txt">{t('Board {n}', { n })}</span>
        <button
          type="button"
          {...attributes}
          {...listeners}
          data-board-handle=""
          className="grid size-11 shrink-0 cursor-grab touch-none place-items-center border-0 bg-transparent p-0 text-dim outline-0 transition-colors duration-(--dur-fast) hover:text-txt focus-visible:outline-1 focus-visible:outline-accent active:cursor-grabbing"
          aria-label={t('Drag board {n} to reorder', { n })}
          title={t('Drag board {n} to reorder', { n })}
        >
          <MorphIcon icon={GripVertical} size={16} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}

function BoardThumb({ board, thumbW, thumbH, ratio, photoById, transparent }: {
  board: BoardCells
  thumbW: number
  thumbH: number
  ratio: number
  photoById: Map<string, Photo>
  transparent: boolean
}) {
  const [ref, size] = useElementSize<HTMLSpanElement>()
  const cell = thumbnailCell(size.w || thumbW, size.h || thumbH, ratio)
  return (
    <span
      ref={ref}
      data-board-thumb=""
      className="grid grid-cols-3"
      style={{ gap: MANAGER_THUMB_GAP, width: thumbW, height: thumbH }}
    >
      {SLOTS.map((i) => {
        const ws = board[i]
        if (!ws)
          return <span key={`empty-${i}`} aria-hidden className="border border-line bg-pane-empty" />
        const filled = leafList(ws.root).some(l => l.photoId)
        return (
          <span key={ws.id} data-board-thumb-cell="" className={`relative block overflow-hidden ${filled ? ' bg-pane-bg' : ' border border-line bg-pane-empty'}`}>
            {filled
              ? (
                  <div className={`absolute inset-0 ${transparent ? ' stage-clear' : ''}`}>
                    <CellPreview root={ws.root} canvasRatio={ws.canvasRatio} box={cell} photoById={photoById} stickers={ws.stickers ?? []} labels={ws.labels ?? []} />
                  </div>
                )
              : null}
          </span>
        )
      })}
    </span>
  )
}
