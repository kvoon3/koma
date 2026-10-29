/**
 * The live board's cells and the add slot, as the overview draws them:
 * dnd-kit's sortable wrapper, the cell face (which may jiggle), its sibling
 * delete badge, and the + cell's menu. The X is never nested inside the cell
 * face: a press on it must not arm a reorder.
 */
import type { CardKind } from '../../lib/cards'
import type { Photo } from '../../lib/imageStore'
import type { BoardCells } from './overviewLayout'
import { Menu } from '@base-ui/react/menu'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Image, Square, Type, X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useT } from '../../lib/i18n'
import { leafList } from '../../lib/panes'
import { useStore } from '../../store'
import { menuItemCls, menuPopupCls } from '../ui/menu'
import { AddSlotFrame, CellBody } from './CellPreview'

/** The sortable wrapper's transform is in screen px; the cell is laid out in canvas px. */
function scaledShift(transform: { x: number, y: number, scaleX: number, scaleY: number } | null, viewScale: number) {
  return transform ? { ...transform, x: transform.x / viewScale, y: transform.y / viewScale } : null
}

/** Below this cell width the 44px coarse X hit would cover the whole face. */
const COMPACT_X_CELL_PX = 56

export function SortableCell({ ws, index, cell, box, photoById, transparent, highlighted, jiggle, canDelete, viewScale, onEnter, onDelete }: {
  ws: BoardCells[number]
  index: number
  cell: number
  box: { w: number, h: number }
  photoById: Map<string, Photo>
  transparent: boolean
  highlighted: boolean
  jiggle: boolean
  canDelete: boolean
  viewScale: number
  onEnter: (id: string) => void
  onDelete: (id: string) => void
}) {
  const t = useT()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ws.id })
  const filled = leafList(ws.root).some(l => l.photoId)
  return (
    <div
      ref={setNodeRef}
      data-cell-slot=""
      className="relative"
      style={{
        width: cell,
        height: box.h,
        transform: CSS.Transform.toString(scaledShift(transform, viewScale)),
        transition,
        zIndex: isDragging ? 10 : undefined,
      }}
    >
      <button
        type="button"
        data-cell=""
        {...attributes}
        {...listeners}
        data-jiggle={jiggle || undefined}
        data-dragging={isDragging || undefined}
        className={`relative block cursor-pointer touch-none select-none overflow-hidden bg-panel-2 outline-0 transition-[scale,opacity,outline-color] duration-(--dur-surface) ${
          jiggle ? 'cursor-default' : 'active:scale-[0.97]'
        } ${highlighted ? 'outline-2 outline-txt -outline-offset-2' : ''}`}
        style={{
          'width': cell,
          'height': box.h,
          '--cell-i': index,
          'viewTransitionName': `ws-${ws.id}`,
        } as React.CSSProperties}
        onClick={() => onEnter(ws.id)}
        title={filled ? t('Edit this workspace') : t('Start a new collage here')}
      >
        <CellBody ws={ws} box={box} photoById={photoById} transparent={transparent} dimmed={isDragging} />
      </button>
      {jiggle && canDelete && <CellDeleteBadge compact={cell < COMPACT_X_CELL_PX} onDelete={() => onDelete(ws.id)} />}
    </div>
  )
}

/**
 * The jiggle X: a 24px danger circle inside a 36px (44px coarse) hit box,
 * inset in the cell's top-left corner so the page's clip can never cut it. On
 * a short stage's 44px cell the coarse 44px hit would cover the whole face and
 * starve the reorder drag, so it stays at 36px there.
 */
export function CellDeleteBadge({ compact, onDelete }: { compact: boolean, onDelete: () => void }) {
  const t = useT()
  return (
    <button
      type="button"
      data-cell-delete=""
      className={`absolute top-0 left-0 z-10 grid size-9 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 outline-0 transition-[scale] duration-(--dur-fast) active:scale-[0.97] focus-visible:outline-1 focus-visible:outline-accent ${compact ? '' : 'pointer-coarse:size-11'}`}
      aria-label={t('Delete workspace')}
      title={t('Delete workspace')}
      onClick={(e) => {
        e.stopPropagation()
        navigator.vibrate?.(10)
        onDelete()
      }}
    >
      <span className="grid size-6 place-items-center rounded-full bg-danger text-on-danger shadow-pop">
        <MorphIcon icon={X} size={13} strokeWidth={2.5} />
      </span>
    </button>
  )
}

export function StaticCell({ ws, cell, box, photoById, transparent }: {
  ws: BoardCells[number]
  cell: number
  box: { w: number, h: number }
  photoById: Map<string, Photo>
  transparent: boolean
}) {
  return (
    <div data-cell-slot="" data-cell-preview="" className="relative overflow-hidden bg-panel-2" style={{ width: cell, height: box.h }}>
      <CellBody ws={ws} box={box} photoById={photoById} transparent={transparent} dimmed={false} quiet />
    </div>
  )
}

export function StaticAddCell({ cell, cellH }: { cell: number, cellH: number }) {
  return (
    <div aria-hidden className="relative grid place-items-center text-dim" style={{ width: cell, height: cellH }}>
      <AddSlotFrame cell={cell} cellH={cellH} />
    </div>
  )
}

/**
 * The + cell after the last workspace: a menu for a blank workspace or one of
 * the share-card presets. In jiggle it is a static slot: the board's geometry
 * must not move when the mode opens, and a menu is not part of arranging.
 */
export function AddCell({ cell, cellH, jiggle }: { cell: number, cellH: number, jiggle: boolean }) {
  if (jiggle)
    return <StaticAddCell cell={cell} cellH={cellH} />
  return <LiveAddCell cell={cell} cellH={cellH} />
}

function LiveAddCell({ cell, cellH }: { cell: number, cellH: number }) {
  const t = useT()
  const add = (kind?: CardKind) => useStore.getState().addWorkspace(kind)
  return (
    <Menu.Root>
      <Menu.Trigger
        data-add-cell=""
        className="relative grid cursor-pointer select-none place-items-center border-0 bg-transparent p-0 text-dim outline-0 transition-[background-color,color,scale] duration-(--dur-fast) hover:bg-chip-hover hover:text-txt active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-txt"
        style={{ width: cell, height: cellH }}
        aria-label={t('Add a workspace')}
        title={t('Add a workspace')}
      >
        <AddSlotFrame cell={cell} cellH={cellH} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align="start" className="z-[260] select-none outline-0">
          <Menu.Popup className={menuPopupCls}>
            <Menu.Item className={menuItemCls} data-add-kind="blank" onClick={() => add()}>
              <MorphIcon icon={Square} size={13} strokeWidth={1.75} className="text-dim" />
              {t('Blank workspace')}
            </Menu.Item>
            <Menu.Item className={menuItemCls} data-add-kind="cover" onClick={() => add('cover')}>
              <MorphIcon icon={Image} size={13} strokeWidth={1.75} className="text-dim" />
              {t('Cover card')}
            </Menu.Item>
            <Menu.Item className={menuItemCls} data-add-kind="lyrics" onClick={() => add('lyrics')}>
              <MorphIcon icon={Type} size={13} strokeWidth={1.75} className="text-dim" />
              {t('Lyrics card')}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
