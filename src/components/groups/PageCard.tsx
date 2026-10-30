import type { BoardCell } from '../../lib/boardPreview'
import type { PageLayout } from '../../lib/groupPage'
import type { Photo } from '../../lib/imageStore'
import type { GridGroup } from '../../lib/workspaces'
import { Check, X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useT } from '../../lib/i18n'
import { CellBody } from '../grid/CellPreview'

/** A board is always nine slots. */
const SLOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const

export interface PageCardProps {
  index: number
  group: GridGroup
  board: readonly BoardCell[]
  /** The card's left edge in the stage, before the row's offset. */
  left: number
  layout: PageLayout
  active: boolean
  /** Only the active card's cells carry the view-transition names. */
  named: boolean
  photoById: Map<string, Photo>
  transparent: boolean
  canDelete: boolean
  onRef: (index: number, el: HTMLElement | null) => void
  onDelete: (id: string) => void
}

/** One group's board as a full-stage page card: a rounded face, a 3x3 board, the open badge and the delete chip. */
export function PageCard({ index, group, board, left, layout, active, named, photoById, transparent, canDelete, onRef, onDelete }: PageCardProps) {
  const t = useT()
  const contentW = layout.cell.w * 3 + layout.boardGap * 2
  const contentH = layout.cell.h * 3 + layout.boardGap * 2
  return (
    <div
      ref={el => onRef(index, el)}
      data-page-card=""
      data-page-active={active || undefined}
      role="group"
      aria-label={t('Group {name}', { name: group.name })}
      className="group/page-card absolute"
      style={{ left, top: layout.card.y, width: layout.card.w, height: layout.card.h }}
    >
      <div
        data-page-face=""
        className="page-card absolute inset-0 overflow-hidden bg-panel-2"
        style={{ borderRadius: layout.radius, padding: layout.matte }}
      >
        <div className="flex h-full w-full items-center justify-center">
          <div
            className="relative grid grid-cols-3"
            style={{ width: contentW, height: contentH, gap: layout.boardGap }}
          >
            {SLOTS.map((slot) => {
              const ws = board[slot]
              if (!ws) {
                return (
                  <span
                    key={`slot-${slot}`}
                    aria-hidden
                    className="relative block border border-line bg-pane-empty"
                    style={{ width: layout.cell.w, height: layout.cell.h }}
                  />
                )
              }
              return (
                <div
                  key={ws.id}
                  data-page-cell=""
                  className="relative overflow-hidden bg-pane-bg"
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
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <CheckBadge open={active} layout={layout} />

      {canDelete && (
        <button
          type="button"
          data-page-delete=""
          className="pointer-events-auto absolute top-1.5 left-1.5 z-10 grid h-5 w-5 cursor-pointer place-items-center rounded-full border border-float-line bg-float-bg text-float-icon opacity-0 shadow-pop outline-0 transition-[opacity,background-color,color,scale] duration-(--dur-fast) group-hover/page-card:opacity-100 hover:text-danger focus-visible:opacity-100 focus-visible:outline-1 focus-visible:outline-accent active:scale-[0.97] pointer-coarse:opacity-100"
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
 * The iOS page marker: a circle under the roomy card, or inside the tight
 * card's bottom-right corner. It is decorative; the surface's tap decides.
 */
function CheckBadge({ open, layout }: { open: boolean, layout: PageLayout }) {
  const size = layout.check.size
  const top = layout.check.inside ? layout.card.h - 10 - size : layout.card.h + layout.check.gap
  const left = layout.check.inside ? layout.card.w - 10 - size : (layout.card.w - size) / 2
  return (
    <span
      aria-hidden
      data-page-check=""
      data-page-check-open={open || undefined}
      className={`pointer-events-none absolute grid place-items-center rounded-full border transition-[background-color,border-color,color] duration-(--dur-fast) ${
        open ? 'border-accent bg-accent text-on-accent' : 'border-line-strong bg-panel-2 text-dim'
      }`}
      style={{ top, left, width: size, height: size }}
    >
      <MorphIcon icon={Check} size={Math.round(size * 0.45)} strokeWidth={2.25} />
    </span>
  )
}
