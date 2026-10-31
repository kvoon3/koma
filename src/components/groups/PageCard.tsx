import type { CSSProperties } from 'react'
import type { BoardCell } from '../../lib/boardPreview'
import type { PageBox, TilesLayout } from '../../lib/groupPage'
import type { Photo } from '../../lib/imageStore'
import type { GridGroup } from '../../lib/workspaces'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Eye, EyeOff, X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { tileWiggle } from '../../lib/groupPage'
import { useT } from '../../lib/i18n'
import { MAX_WORKSPACES } from '../../lib/workspaces'
import { AddSlotFrame, CellBody } from '../grid/CellPreview'

/** The one shadow a frameless tile is allowed: separation from the wallpaper. */
const TILE_SHADOW = 'shadow-[0_14px_36px_-12px_rgba(0,0,0,0.45)]'

/**
 * The glide between boxes: the grid is absolutely positioned, so a transition
 * on `left`/`top` carries a tile to every box `tilesLayout` hands it after an
 * add, a delete or an undo. While dnd-kit owns the node (its own transition
 * on the sortable translate) that one wins, unchanged.
 */
const TILE_MOVE_CSS = 'left var(--dur-surface) var(--ease-out), top var(--dur-surface) var(--ease-out)'

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
  /** The tile's board box in the content, from `tilesLayout`. */
  box: PageBox
  layout: TilesLayout
  /** Only the open group's cells carry the view-transition names. */
  named: boolean
  /** The group is tucked away: the board dims, the delete `x` shows. */
  hidden: boolean
  /** The group just joined the row (added or undone back in): rise in. */
  entering?: boolean
  photoById: Map<string, Photo>
  transparent: boolean
  /** The last group of the row carries no delete `x`. */
  canDelete: boolean
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onToggle: (id: string) => void
}

/**
 * One group as a frameless edit-mode tile: the board itself (no card frame,
 * no matte, one soft shadow), wiggling like an iOS home-screen icon on a
 * rhythm of its own (`tileWiggle`, hashed from the id). The board face is
 * the drag handle (press and hold on any pointer; the drop commits via the
 * store's `moveGrid`) and a plain tap opens the group through the `ws-<id>`
 * morph. The eye under the board tucks it away; a tucked tile dims, keeps
 * wiggling, and offers the delete `x` at its corner. The tile leaves
 * `touch-action` to its chain so a swipe on it scrolls the page; the hold
 * arms the drag before any scroll can start.
 */
export function PageTile({ group, board, box, layout, named, hidden, entering, photoById, transparent, canDelete, onOpen, onDelete, onToggle }: PageTileProps) {
  const t = useT()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: group.id })
  const wiggle = tileWiggle(group.id)
  return (
    <div
      ref={setNodeRef}
      data-group-tile=""
      data-tile-id={group.id}
      data-tile-open={named || undefined}
      data-tile-hidden={hidden || undefined}
      className={`absolute${entering ? ' tile-in' : ''}`}
      style={{
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        transform: CSS.Transform.toString(transform),
        transition: transition ?? TILE_MOVE_CSS,
      }}
    >
      {/* The wiggle rides this inner wrapper, so its keyframe transform never
          composes with dnd-kit's translate above; a drag pauses it on the
          tile the ghost already lifts. The rhythm is the tile's own, and it
          never changes, so a reorder never restarts it. */}
      <div
        className="tile-wiggle relative"
        style={{
          '--wiggle-dur': `${wiggle.duration}ms`,
          '--wiggle-delay': `${wiggle.delay}ms`,
          'animationPlayState': isDragging ? 'paused' : undefined,
        } as CSSProperties}
      >
        <button
          type="button"
          data-tile-face=""
          {...attributes}
          {...listeners}
          className={`relative block cursor-pointer select-none ${TILE_SHADOW} outline-2 outline-offset-2 outline-transparent outline-0 transition-[outline-color,opacity] duration-(--dur-fast) hover:not-focus-visible:outline-line-strong focus-visible:outline-sel ${hidden ? ' opacity-45' : ''}`}
          aria-label={t('Open group {name}', { name: group.name })}
          aria-current={named ? 'true' : undefined}
          onClick={() => onOpen(group.id)}
        >
          <TileBoard board={board} cell={layout.cell} gap={layout.boardGap} photoById={photoById} transparent={transparent} named={named} dimmed={isDragging} />
        </button>

        {/* The delete `x` is the tucked-away state's affordance: a visible
            tile has none, and a tucked one needs no second check. */}
        {canDelete && hidden && (
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

      {/* The round eye toggle: hollow with the eye when the group is in the
          row at full strength, filled with the slash once it is tucked away.
          Its own hit target; tapping it never opens the group. */}
      <button
        type="button"
        aria-pressed={hidden}
        data-tile-eye=""
        className="absolute top-full left-1/2 grid h-7 w-7 -translate-x-1/2 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 outline-0 pointer-coarse:h-11 pointer-coarse:w-11 focus-visible:outline-1 focus-visible:outline-accent"
        aria-label={t('Toggle visibility for {name}', { name: group.name })}
        onClick={() => onToggle(group.id)}
      >
        <span
          aria-hidden
          className={`grid place-items-center rounded-full border-2 ${
            hidden ? 'border-accent bg-accent text-on-accent' : 'border-dim bg-transparent text-dim'
          }`}
          style={{ width: layout.check, height: layout.check }}
        >
          <MorphIcon icon={hidden ? EyeOff : Eye} size={Math.round(layout.check * 0.6)} strokeWidth={2.25} />
        </span>
      </button>
    </div>
  )
}

/**
 * A deleted tile playing its way out: the same board, shadow and wiggle as
 * `PageTile` minus every control, rendered outside the sortable set so no
 * drag can start from it. It holds its box (`tile-out` fades and shrinks it)
 * until the exit ends and the page commits the store delete, when the
 * survivors glide shut. The exit runs on the tile root, so the wiggle inside
 * keeps its own transform and the two compose.
 */
export function LeavingTile({ group, board, box, layout, hidden, dimmed, photoById, transparent, onExited }: {
  group: GridGroup
  board: readonly BoardCell[]
  box: PageBox
  layout: TilesLayout
  hidden: boolean
  /** The drop-to-delete exit starts from the dimmed face the drag lifted. */
  dimmed: boolean
  photoById: Map<string, Photo>
  transparent: boolean
  /** The exit animation ended: commit the delete. */
  onExited: (id: string) => void
}) {
  const wiggle = tileWiggle(group.id)
  return (
    <div
      data-group-tile=""
      data-tile-leaving=""
      aria-hidden
      className="tile-out pointer-events-none absolute"
      style={{
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
      }}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget)
          onExited(group.id)
      }}
    >
      <div
        className="tile-wiggle relative"
        style={{
          '--wiggle-dur': `${wiggle.duration}ms`,
          '--wiggle-delay': `${wiggle.delay}ms`,
        } as CSSProperties}
      >
        <span className={`relative block select-none ${TILE_SHADOW}${hidden ? ' opacity-45' : ''}`}>
          <TileBoard board={board} cell={layout.cell} gap={layout.boardGap} photoById={photoById} transparent={transparent} dimmed={dimmed} />
        </span>
      </div>
    </div>
  )
}
