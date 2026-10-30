import type { BoardCell } from '../../lib/boardPreview'
import type { PageBox, TilesLayout } from '../../lib/groupPage'
import type { Photo } from '../../lib/imageStore'
import type { GridGroup } from '../../lib/workspaces'
import { Check, Plus, X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useT } from '../../lib/i18n'
import { CellBody } from '../grid/CellPreview'

/** A board is always nine slots. */
const SLOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const

export interface PageTileProps {
  group: GridGroup
  board: readonly BoardCell[]
  /** The tile's box in the stage, from `tilesLayout`. */
  box: PageBox
  layout: TilesLayout
  open: boolean
  /** Only the open group's cells carry the view-transition names. */
  named: boolean
  photoById: Map<string, Photo>
  transparent: boolean
  canDelete: boolean
  onOpen: (id: string) => void
  onDelete: (id: string) => void
}

/**
 * One group's board as a tile of the groups page grid: a rounded face, a 3x3
 * board at tile scale, the open group's check badge and the delete chip. The
 * tile is a button, so Tab and Enter reach it natively; tapping it opens the
 * group's overview through the `ws-<id>` morph.
 */
export function PageTile({ group, board, box, layout, open, named, photoById, transparent, canDelete, onOpen, onDelete }: PageTileProps) {
  const t = useT()
  const contentW = layout.cell.w * 3 + layout.boardGap * 2
  const contentH = layout.cell.h * 3 + layout.boardGap * 2
  return (
    <div
      data-group-tile=""
      data-tile-open={open || undefined}
      className="group/tile absolute"
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
    >
      <button
        type="button"
        data-tile-face=""
        className="page-card absolute inset-0 flex cursor-pointer items-center justify-center overflow-hidden bg-panel-2 outline-2 outline-offset-1 outline-transparent outline-0 transition-[outline-color] duration-(--dur-fast) hover:not-focus-visible:outline-line-strong focus-visible:outline-sel"
        style={{ borderRadius: layout.radius, padding: layout.matte }}
        aria-label={t('Open group {name}', { name: group.name })}
        aria-current={open ? 'true' : undefined}
        onClick={() => onOpen(group.id)}
      >
        <span
          aria-hidden
          className="relative grid grid-cols-3"
          style={{ width: contentW, height: contentH, gap: layout.boardGap }}
        >
          {SLOTS.map((slot) => {
            const ws = board[slot]
            if (!ws) {
              return (
                <span
                  key={`slot-${slot}`}
                  className="relative block border border-line bg-pane-empty"
                  style={{ width: layout.cell.w, height: layout.cell.h }}
                />
              )
            }
            return (
              <span
                key={ws.id}
                data-tile-cell=""
                className="relative block overflow-hidden bg-pane-bg"
                style={{
                  width: layout.cell.w,
                  height: layout.cell.h,
                  viewTransitionName: named ? `ws-${ws.id}` : undefined,
                }}
              >
                <CellBody
                  ws={ws}
                  box={{ w: layout.cell.w, h: layout.cell.h }}
                  photoById={photoById}
                  transparent={transparent}
                  dimmed={false}
                  quiet
                />
              </span>
            )
          })}
        </span>
      </button>

      {/* The open group's mark, inside the tile's corner. */}
      {open && (
        <span
          aria-hidden
          data-tile-check=""
          className="pointer-events-none absolute grid place-items-center rounded-full border border-accent bg-accent text-on-accent"
          style={{ bottom: 10, right: 10, width: layout.check, height: layout.check }}
        >
          <MorphIcon icon={Check} size={Math.round(layout.check * 0.5)} strokeWidth={2.25} />
        </span>
      )}

      {canDelete && (
        <button
          type="button"
          data-tile-delete=""
          className="pointer-events-auto absolute top-1.5 left-1.5 z-10 grid h-5 w-5 cursor-pointer place-items-center rounded-full border border-float-line bg-float-bg text-float-icon opacity-0 shadow-pop outline-0 transition-[opacity,background-color,color,scale] duration-(--dur-fast) group-hover/tile:opacity-100 hover:text-danger focus-visible:opacity-100 focus-visible:outline-1 focus-visible:outline-accent active:scale-[0.97] pointer-coarse:opacity-100"
          aria-label={t('Delete group?')}
          title={t('Delete group?')}
          onClick={() => onDelete(group.id)}
        >
          <MorphIcon icon={X} size={11} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}

/**
 * The grid's last slot when there is room for another group: the overview's
 * add-cell language (a dashed frame and a Plus) on a tile, rounded. Adding
 * keeps the page; the new group's tile appears with the rest.
 */
export function AddTile({ box, radius, onAdd }: { box: PageBox, radius: number, onAdd: () => void }) {
  const t = useT()
  return (
    <button
      type="button"
      data-add-tile=""
      className="absolute grid cursor-pointer place-items-center border-2 border-dashed border-line-strong bg-transparent text-dim outline-0 transition-[background-color,color,scale] duration-(--dur-fast) hover:bg-chip-hover hover:text-txt focus-visible:outline-2 focus-visible:outline-txt active:scale-[0.97]"
      style={{ left: box.x, top: box.y, width: box.w, height: box.h, borderRadius: radius }}
      aria-label={t('Add a group')}
      title={t('Add a group')}
      onClick={onAdd}
    >
      <MorphIcon icon={Plus} size={22} strokeWidth={1.75} />
    </button>
  )
}
