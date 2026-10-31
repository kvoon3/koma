import type { BoardCell } from '../../lib/boardPreview'
import type { PageBox, TilesLayout } from '../../lib/groupPage'
import type { Photo } from '../../lib/imageStore'
import type { GridGroup } from '../../lib/workspaces'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Check, X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useT } from '../../lib/i18n'
import { MAX_WORKSPACES } from '../../lib/workspaces'
import { AddSlotFrame, CellBody } from '../grid/CellPreview'

/** The one shadow a frameless tile is allowed: separation from the wallpaper. */
const TILE_SHADOW = 'shadow-[0_14px_36px_-12px_rgba(0,0,0,0.45)]'

/**
 * The board a tile wears (and the drag ghost carries): the root's own 3×3 at
 * the root's own cell gap, filled cells through `CellBody`, an empty
 * workspace with its hint, the dashed + slot while there is room. Ragged like
 * the root: a board with fewer workspaces ends where its cells do.
 */
export function TileBoard({ board, cell, gap, photoById, transparent, named, dimmed = false, className }: {
  board: readonly BoardCell[]
  cell: { w: number, h: number }
  gap: number
  photoById: Map<string, Photo>
  transparent: boolean
  /** Only the open group's cells carry the view-transition names. */
  named?: boolean
  /** The tile the ghost lifts fades back, like the overview's dragged cell. */
  dimmed?: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={`relative grid grid-cols-3 transition-opacity duration-(--dur-surface) ${dimmed ? ' opacity-25' : ''} ${className ?? ''}`}
      style={{ width: cell.w * 3 + gap * 2, gap }}
    >
      {board.map(ws => (
        <span
          key={ws.id}
          data-tile-cell=""
          className="relative block overflow-hidden bg-pane-bg"
          style={{
            width: cell.w,
            height: cell.h,
            viewTransitionName: named ? `ws-${ws.id}` : undefined,
          }}
        >
          <CellBody ws={ws} box={cell} photoById={photoById} transparent={transparent} dimmed={false} />
        </span>
      ))}
      {board.length < MAX_WORKSPACES && (
        <span className="relative grid place-items-center text-dim" style={{ width: cell.w, height: cell.h }}>
          <AddSlotFrame cell={cell.w} cellH={cell.h} />
        </span>
      )}
    </span>
  )
}

export interface PageTileProps {
  group: GridGroup
  board: readonly BoardCell[]
  /** The tile's board box in the stage, from `tilesLayout`. */
  box: PageBox
  layout: TilesLayout
  /** Only the open group's cells carry the view-transition names. */
  named: boolean
  /** The checkbox under the tile is checked, so the delete `x` shows. */
  selected: boolean
  /** The wiggle's start offset: the entry morph lands first, then a stagger. */
  wiggleDelay: number
  photoById: Map<string, Photo>
  transparent: boolean
  canDelete: boolean
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onToggle: (id: string) => void
}

/**
 * One group as a frameless edit-mode tile: the board itself (no card frame,
 * no matte, one soft shadow), wiggling like an iOS home-screen icon while the
 * page is shown. The board face is the drag handle (dnd-kit insert-shift
 * reorder through `onOpen`'s siblings; the drop commits via the store's
 * `moveGrid`), the round checkbox under it gates the delete `x`, and tapping
 * the board opens the group through the `ws-<id>` morph. The tile leaves
 * `touch-action` to its chain so a swipe on it scrolls the page; the hold
 * arms the drag before any scroll can start.
 */
export function PageTile({ group, board, box, layout, named, selected, wiggleDelay, photoById, transparent, canDelete, onOpen, onDelete, onToggle }: PageTileProps) {
  const t = useT()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: group.id })
  return (
    <div
      ref={setNodeRef}
      data-group-tile=""
      data-tile-open={named || undefined}
      className="absolute"
      style={{
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      {/* The wiggle rides this inner wrapper, so its keyframe transform never
          composes with dnd-kit's translate above; a drag pauses it on the
          tile the ghost already lifts. */}
      <div
        className="tile-wiggle relative"
        style={{ animationDelay: `${wiggleDelay}ms`, animationPlayState: isDragging ? 'paused' : undefined }}
      >
        <button
          type="button"
          data-tile-face=""
          {...attributes}
          {...listeners}
          className={`relative block cursor-pointer select-none ${TILE_SHADOW} outline-2 outline-offset-2 outline-transparent outline-0 transition-[outline-color] duration-(--dur-fast) hover:not-focus-visible:outline-line-strong focus-visible:outline-sel`}
          aria-label={t('Open group {name}', { name: group.name })}
          aria-current={named ? 'true' : undefined}
          onClick={() => onOpen(group.id)}
        >
          <TileBoard board={board} cell={layout.cell} gap={layout.boardGap} photoById={photoById} transparent={transparent} named={named} dimmed={isDragging} />
        </button>

        {/* The delete `x` shows only while the tile's checkbox is checked; it
            never rides a hover or a coarse-pointer press. */}
        {canDelete && selected && (
          <button
            type="button"
            data-tile-delete=""
            className="absolute top-0 left-0 z-10 grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-float-line bg-float-bg text-danger shadow-pop outline-0 transition-[scale] duration-(--dur-fast) active:scale-[0.97] focus-visible:outline-1 focus-visible:outline-accent"
            aria-label={t('Delete group?')}
            title={t('Delete group?')}
            onClick={() => onDelete(group.id)}
          >
            <MorphIcon icon={X} size={11} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* The round iOS checkbox: a hollow ring when clear, filled with a check
          when set. Page-local selection state; its own hit target. */}
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        data-tile-check=""
        className="absolute top-full left-1/2 grid h-7 w-7 -translate-x-1/2 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 outline-0 pointer-coarse:h-11 pointer-coarse:w-11 focus-visible:outline-1 focus-visible:outline-accent"
        aria-label={t('Select group {name}', { name: group.name })}
        onClick={() => onToggle(group.id)}
      >
        <span
          aria-hidden
          className={`grid place-items-center rounded-full border-2 ${
            selected ? 'border-accent bg-accent text-on-accent' : 'border-dim bg-transparent text-transparent'
          }`}
          style={{ width: layout.check, height: layout.check }}
        >
          <MorphIcon icon={Check} size={Math.round(layout.check * 0.55)} strokeWidth={2.5} />
        </span>
      </button>
    </div>
  )
}
