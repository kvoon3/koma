import type { RefObject } from 'react'
import type { TilesLayout } from '../../lib/groupPage'
import { closestCenter, DndContext, DragOverlay, MeasuringStrategy } from '@dnd-kit/core'
import { rectSortingStrategy, SortableContext } from '@dnd-kit/sortable'
import { useNavigate } from '@tanstack/react-router'
import { Check } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useElementSize, useMediaQuery } from '../../hooks'
import { compactDockBand } from '../../lib/dockMetrics'
import { cellRatioValue } from '../../lib/gridTools'
import { tilesLayout } from '../../lib/groupPage'
import { useT } from '../../lib/i18n'
import { EASE_OUT_CSS } from '../../lib/motionTokens'
import { OVERVIEW_PATH } from '../../lib/routes'
import { prefersReducedMotion, viewTransitionOption } from '../../lib/viewTransition'
import { isTransparentBg, useStore } from '../../store'
import { useDockMetrics } from '../dockContext'
import { DockToolset } from '../Stage'
import { ToolsDock } from '../ToolsDock'
import { GroupWallpaper } from './GroupWallpaper'
import { AddTile, PageTile, TileBoard } from './PageCard'
import { useGroupsKeys } from './useGroupsKeys'
import { useGroupsNav } from './useGroupsNav'
import { useGroupsReorder } from './useGroupsReorder'

/** The entry morph's landing time: the wiggle waits it out before it starts. */
const WIGGLE_START_MS = 350
/** Air between one tile's wiggle start and the next. */
const WIGGLE_STAGGER_MS = 90
/** A finished drag's drop still clicks; neither opens nor exits inside this. */
const CLICK_AFTER_DRAG_MS = 150

/** A press on these is a press on a control, never the blank page. */
const BLANK_OWNER = '[data-group-tile],[data-add-tile],button,a,[data-dock-mode],[role="dialog"],input,textarea,select'

/**
 * The groups page: every board group as a frameless tile of one flat grid,
 * opened from the overview's dot capsule, a pull down or a long press. The
 * page is the board's edit mode: tiles wiggle, drag reorders the row (the
 * store's `grids` order, which the root pager and capsule follow), the
 * checkbox under a tile gates its delete `x`, and a tap on the board, Done,
 * Escape, Back or the blank page leaves for that group's overview through
 * the `ws-<id>` morph. The dashed tile adds a group; the tools dock rides
 * along in its compact icon row.
 */
export function GroupsPage() {
  const t = useT()
  const grids = useStore(s => s.grids)
  const activeGridId = useStore(s => s.activeGridId)
  const workspaces = useStore(s => s.workspaces)
  const parked = useStore(s => s.parkedBoards)
  const photos = useStore(s => s.photos)
  const bg = useStore(s => s.bg)
  const gridGap = useStore(s => s.gridGap)
  const gridCellRatio = useStore(s => s.gridCellRatio)
  const switchGrid = useStore(s => s.switchGrid)
  const moveGrid = useStore(s => s.moveGrid)
  const addGrid = useStore(s => s.addGrid)
  const removeGrid = useStore(s => s.removeGrid)
  const navigate = useNavigate()
  const { close: closeGroups } = useGroupsNav()

  const [stageRef, stage] = useElementSize<HTMLDivElement>()
  const metrics = useDockMetrics()
  const coarse = useMediaQuery('(pointer: coarse)')
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  /** Which tiles have their checkbox set: page-local, never the store's. */
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())

  const photoById = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos])
  const transparent = isTransparentBg(bg)
  const layout = useMemo(
    () => tilesLayout({
      stageW: stage.w,
      stageH: stage.h,
      count: grids.length,
      dockBand: compactDockBand(metrics),
      coarse,
      ratio: cellRatioValue(gridCellRatio),
      gridGap,
    }),
    [stage.w, stage.h, grids.length, metrics, coarse, gridCellRatio, gridGap],
  )
  const activeIndex = Math.max(0, grids.findIndex(g => g.id === activeGridId))
  const activeBoard = useMemo(
    () => (grids[activeIndex]?.id === activeGridId ? workspaces : parked[activeGridId]?.workspaces ?? workspaces),
    [grids, activeIndex, activeGridId, workspaces, parked],
  )
  const boardOf = useCallback((index: number) => {
    const id = grids[index]?.id
    if (!id)
      return []
    return id === activeGridId ? workspaces : parked[id]?.workspaces ?? []
  }, [grids, activeGridId, workspaces, parked])

  // ---- Drag-to-reorder (dnd-kit, insert-shift through `moveGrid`) ---------
  const reorder = useGroupsReorder({ grids, moveGrid })
  const dragIndex = reorder.dragId ? grids.findIndex(g => g.id === reorder.dragId) : -1
  const dragBoard = dragIndex >= 0 ? boardOf(dragIndex) : null
  const afterDrag = useCallback((run: () => void) => {
    if (Date.now() - reorder.dragEndedAtRef.current > CLICK_AFTER_DRAG_MS)
      run()
  }, [reorder.dragEndedAtRef])

  // Tap a tile: swap the store first, in its own flush, so the navigation's
  // old snapshot already carries the tapped tile's `ws-<id>` names; then leave
  // for the overview, where the same names morph its cells into place. The
  // open group's tile skips the switch (it already wears the names).
  const openGroup = useCallback((id: string) => {
    if (id !== activeGridId) {
      // eslint-disable-next-line react/dom-no-flush-sync -- the switch must land before the transition takes its old snapshot
      flushSync(() => {
        switchGrid(id)
      })
    }
    void navigate({ to: OVERVIEW_PATH, replace: true, viewTransition: viewTransitionOption() })
  }, [activeGridId, navigate, switchGrid])
  const openTile = useCallback((id: string) => {
    afterDrag(() => openGroup(id))
  }, [afterDrag, openGroup])

  const keys = useGroupsKeys({ onLeave: closeGroups })

  const addGroup = useCallback(() => {
    addGrid()
  }, [addGrid])
  const deleteGroup = useCallback((id: string) => {
    removeGrid(id)
    setSelected((prev) => {
      if (!prev.has(id))
        return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [removeGrid])
  const toggleCheck = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (prev.has(id))
        next.delete(id)
      else
        next.add(id)
      return next
    })
  }, [])

  // The blank page is a leave: anything that is not a tile, a button or the
  // dock returns to `/` the way Done does. The click that follows a finished
  // reorder is not a leave.
  const onBlankClick = useCallback((e: { target: EventTarget | null }) => {
    if (e.target instanceof Element && e.target.closest(BLANK_OWNER))
      return
    afterDrag(closeGroups)
  }, [afterDrag, closeGroups])

  // The heading takes focus on entry, so the page's Escape exit is live and a
  // screen reader announces the fresh page.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const activeName = grids[activeIndex]?.name ?? ''
  const live = t('Group {name}', { name: activeName })
  const groupTiles = layout.tiles.slice(0, grids.length)
  const addBox = layout.tiles[grids.length] ?? null

  return (
    <div
      ref={stageRef}
      data-groups-page=""
      data-groups-active={activeGridId}
      role="region"
      aria-label={t('Groups')}
      className="absolute inset-0 touch-none select-none overflow-hidden bg-panel-2"
      onKeyDown={keys}
      onClick={onBlankClick}
      onPointerUp={(e) => {
        // A press on the page's own surface (not its buttons) would leave focus
        // on the body, and with it the page's key map. The browser blurs on the
        // press, so put focus back on the heading at the release.
        if (!(e.target as HTMLElement).closest('button, a[href]'))
          headingRef.current?.focus({ preventScroll: true })
      }}
      onPointerCancel={() => headingRef.current?.focus({ preventScroll: true })}
    >
      <GroupWallpaper board={activeBoard} photoById={photoById} />

      {/* The tiles: every group at once, plus the dashed add slot while there
          is room. Each board face is a button, so Tab and Enter reach them
          natively; the drag rides the same face. */}
      <div data-groups-tiles="" className="absolute inset-0 z-[5]">
        <DndContext
          sensors={reorder.sensors}
          collisionDetection={closestCenter}
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          onDragStart={reorder.onDragStart}
          onDragEnd={reorder.onDragEnd}
          onDragCancel={reorder.onDragCancel}
        >
          <SortableContext items={reorder.ids} strategy={rectSortingStrategy}>
            {groupTiles.map((box, i) => (
              <PageTile
                key={grids[i].id}
                group={grids[i]}
                board={boardOf(i)}
                box={box}
                layout={layout}
                named={i === activeIndex}
                selected={selected.has(grids[i].id)}
                wiggleDelay={WIGGLE_START_MS + i * WIGGLE_STAGGER_MS}
                photoById={photoById}
                transparent={transparent}
                canDelete={grids.length > 1}
                onOpen={openTile}
                onDelete={deleteGroup}
                onToggle={toggleCheck}
              />
            ))}
            {addBox && <AddTile box={addBox} wiggleDelay={WIGGLE_START_MS + grids.length * WIGGLE_STAGGER_MS} onAdd={addGroup} />}
          </SortableContext>

          <DragOverlay dropAnimation={prefersReducedMotion() ? null : { duration: 160, easing: EASE_OUT_CSS }}>
            {dragBoard
              ? (
                  // The lifted ghost: the dragged tile's board with the shadow
                  // doing the lifting.
                  <div
                    className="relative cursor-grabbing"
                    style={{ width: layout.board.w, height: layout.board.h }}
                  >
                    <TileBoard
                      board={dragBoard}
                      cell={layout.cell}
                      gap={layout.boardGap}
                      photoById={photoById}
                      transparent={transparent}
                      className="shadow-[0_24px_60px_-12px_rgba(0,0,0,0.6)]"
                    />
                  </div>
                )
              : null}
          </DragOverlay>
        </DndContext>
      </div>

      <GroupsHeader layout={layout} onDone={closeGroups} headingRef={headingRef} />
      <p aria-live="polite" aria-atomic="true" className="sr-only">{live}</p>

      <ToolsDock hidden={false} compact contextKey="groups">
        <DockToolset route="grid" />
      </ToolsDock>
    </div>
  )
}

/** The page chrome: the check-mark Done pill. The title stays for screen readers. */
function GroupsHeader({ layout, onDone, headingRef }: {
  layout: TilesLayout
  onDone: () => void
  headingRef: RefObject<HTMLHeadingElement | null>
}) {
  const t = useT()
  return (
    <header
      data-groups-header=""
      className="pointer-events-none absolute inset-x-0 top-0 z-20"
      style={{ height: layout.headerH }}
    >
      <h1 ref={headingRef} tabIndex={-1} className="sr-only m-0 outline-0">{t('Groups')}</h1>
      <button
        type="button"
        data-groups-done=""
        className="pointer-events-auto absolute inline-flex cursor-pointer items-center justify-center gap-1 rounded-full border border-float-line bg-float-bg text-[12px] font-semibold text-txt shadow-pop outline-0 backdrop-blur-[7px] transition-[background-color,color,scale] duration-(--dur-fast) hover:bg-chip-hover focus-visible:outline-1 focus-visible:outline-accent active:scale-[0.97]"
        style={{ top: layout.done.top, right: layout.done.right, width: layout.done.w, height: layout.done.h }}
        onClick={onDone}
      >
        <MorphIcon icon={Check} size={13} strokeWidth={2.25} />
        {t('Done')}
      </button>
    </header>
  )
}
