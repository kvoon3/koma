import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { TilesLayout } from '../../lib/groupPage'
import { closestCenter, DndContext, DragOverlay, MeasuringStrategy } from '@dnd-kit/core'
import { rectSortingStrategy, SortableContext } from '@dnd-kit/sortable'
import { useNavigate } from '@tanstack/react-router'
import { Check, Plus } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useElementSize, useMediaQuery } from '../../hooks'
import { cellRatioValue } from '../../lib/gridTools'
import { tilesLayout } from '../../lib/groupPage'
import { useT } from '../../lib/i18n'
import { EASE_OUT_CSS } from '../../lib/motionTokens'
import { OVERVIEW_PATH } from '../../lib/routes'
import { prefersReducedMotion, viewTransitionOption } from '../../lib/viewTransition'
import { isTransparentBg, useStore } from '../../store'
import { DockToolset } from '../Stage'
import { ToolsDock } from '../ToolsDock'
import { GroupWallpaper } from './GroupWallpaper'
import { PageTile, TileBoard } from './PageCard'
import { useGroupsKeys } from './useGroupsKeys'
import { useGroupsNav } from './useGroupsNav'
import { useGroupsReorder } from './useGroupsReorder'

/** The entry morph's landing time: the wiggle waits it out before it starts. */
const WIGGLE_START_MS = 350
/** Air between one tile's wiggle start and the next. */
const WIGGLE_STAGGER_MS = 90
/** A finished drag's drop still clicks; neither opens nor exits inside this. */
const CLICK_AFTER_DRAG_MS = 150
/** A scroll's tail: a blank tap inside this is the scroll's release, not a leave. */
const CLICK_AFTER_SCROLL_MS = 150
/** A press that wandered this far before release was a drag on the surface, not a tap. */
const PRESS_SLOP_PX = 8

/** A press on these is a press on a control, never the blank page. */
const BLANK_OWNER = '[data-group-tile],button,a,[data-dock-mode],[role="dialog"],input,textarea,select'

/**
 * The groups page: every board group as a frameless tile of one scrolling
 * grid, opened from the overview's dot capsule, a pull down or a long press.
 * The page is the board's edit mode: tiles wiggle, drag reorders the row (the
 * store's `grids` order, which the root pager and capsule follow), the
 * checkbox under a tile gates its delete `x`, and a tap on the board, Done,
 * Escape, Back or the blank page leaves for that group's overview through
 * the `ws-<id>` morph. The + pill beside Done adds a group (the row is
 * endless); the tools dock is not on this page, so the grid owns the whole
 * height and scrolls when the tiles run past it.
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
  const coarse = useMediaQuery('(pointer: coarse)')
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  /** Which tiles have their checkbox set: page-local, never the store's. */
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())

  const photoById = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos])
  const transparent = isTransparentBg(bg)
  const layout = useMemo(
    () => tilesLayout({
      stageW: stage.w,
      count: grids.length,
      coarse,
      ratio: cellRatioValue(gridCellRatio),
      gridGap,
    }),
    [stage.w, grids.length, coarse, gridCellRatio, gridGap],
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

  // ---- The scroll module's own tap guards ---------------------------------
  // A release at the end of a scroll still clicks on the surface it scrolled,
  // and so does a press that wandered past the slop: neither leaves.
  const scrolledAtRef = useRef(0)
  const onTilesScroll = useCallback(() => {
    scrolledAtRef.current = Date.now()
  }, [])
  const pressRef = useRef<{ x: number, y: number } | null>(null)
  const surfaceDragRef = useRef(false)
  const onSurfacePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    surfaceDragRef.current = false
    if (e.isPrimary)
      pressRef.current = { x: e.clientX, y: e.clientY }
  }, [])
  const onSurfacePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pressRef.current
    if (!p)
      return
    if (Math.abs(e.clientX - p.x) > PRESS_SLOP_PX || Math.abs(e.clientY - p.y) > PRESS_SLOP_PX)
      surfaceDragRef.current = true
  }, [])
  const onSurfacePointerUp = useCallback(() => {
    pressRef.current = null
  }, [])

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
  // reorder, a scroll or a wander on the surface is not a leave.
  const onBlankClick = useCallback((e: { target: EventTarget | null }) => {
    if (e.target instanceof Element && e.target.closest(BLANK_OWNER))
      return
    if (surfaceDragRef.current) {
      surfaceDragRef.current = false
      return
    }
    if (Date.now() - scrolledAtRef.current < CLICK_AFTER_SCROLL_MS)
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

  return (
    <div
      ref={stageRef}
      data-groups-page=""
      data-groups-active={activeGridId}
      role="region"
      aria-label={t('Groups')}
      className="absolute inset-0 touch-pan-y select-none overflow-hidden bg-panel-2"
      onKeyDown={keys}
      onClick={onBlankClick}
      onPointerDown={onSurfacePointerDown}
      onPointerMove={onSurfacePointerMove}
      onPointerUp={(e) => {
        onSurfacePointerUp()
        // A press on the page's own surface (not its buttons) would leave focus
        // on the body, and with it the page's key map. The browser blurs on the
        // press, so put focus back on the heading at the release.
        if (!(e.target as HTMLElement).closest('button, a[href]'))
          headingRef.current?.focus({ preventScroll: true })
      }}
      onPointerCancel={() => {
        onSurfacePointerUp()
        headingRef.current?.focus({ preventScroll: true })
      }}
    >
      <GroupWallpaper board={activeBoard} photoById={photoById} />

      {/* The tiles: one scrolling module filling the page from under the
          header to the safe-area bottom; the grid centres while it fits and
          scrolls once it does not. Each board face is a button, so Tab and
          Enter reach them natively; the drag rides the same face. */}
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
            <div
              data-tiles-scroll=""
              className="absolute inset-x-0 bottom-[env(safe-area-inset-bottom)] flex touch-pan-y flex-col overflow-y-auto overscroll-contain"
              style={{ top: layout.headerH }}
              onScroll={onTilesScroll}
            >
              {/* An auto margin centres the grid while it fits and collapses
                  to zero when it overflows, so the scroll starts at the top
                  instead of clipping it (the justify-content trap). */}
              <div className="relative m-auto w-full" style={{ height: layout.contentH }}>
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
              </div>
            </div>
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

      <GroupsHeader layout={layout} onDone={closeGroups} onAdd={addGroup} headingRef={headingRef} />
      <p aria-live="polite" aria-atomic="true" className="sr-only">{live}</p>

      <ToolsDock hidden contextKey="groups">
        <DockToolset route="grid" />
      </ToolsDock>
    </div>
  )
}

/** The page chrome: the + pill and the check-mark Done pill. The title stays for screen readers. */
function GroupsHeader({ layout, onDone, onAdd, headingRef }: {
  layout: TilesLayout
  onDone: () => void
  onAdd: () => void
  headingRef: RefObject<HTMLHeadingElement | null>
}) {
  const t = useT()
  const pillCls = 'pointer-events-auto absolute cursor-pointer rounded-full border border-float-line bg-float-bg text-txt shadow-pop outline-0 backdrop-blur-[7px] transition-[background-color,color,scale] duration-(--dur-fast) hover:bg-chip-hover focus-visible:outline-1 focus-visible:outline-accent active:scale-[0.97]'
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
        className={`${pillCls} inline-flex items-center justify-center gap-1 text-[12px] font-semibold`}
        style={{ top: layout.done.top, right: layout.done.right, width: layout.done.w, height: layout.done.h }}
        onClick={onDone}
      >
        <MorphIcon icon={Check} size={13} strokeWidth={2.25} />
        {t('Done')}
      </button>
      <button
        type="button"
        data-groups-add=""
        className={`${pillCls} grid place-items-center`}
        style={{ top: layout.add.top, right: layout.add.right, width: layout.add.w, height: layout.add.h }}
        aria-label={t('Add a group')}
        title={t('Add a group')}
        onClick={onAdd}
      >
        <MorphIcon icon={Plus} size={14} strokeWidth={2.25} />
      </button>
    </header>
  )
}
