import type { CSSProperties, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { TilesLayout } from '../../lib/groupPage'
import { DndContext, DragOverlay, MeasuringStrategy, useDroppable } from '@dnd-kit/core'
import { rectSortingStrategy, SortableContext } from '@dnd-kit/sortable'
import { useNavigate } from '@tanstack/react-router'
import { Check, Plus } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useElementSize, useMediaQuery } from '../../hooks'
import { DELETE_ZONE_ID, deleteFirst } from '../../lib/deleteZone'
import { cellRatioValue } from '../../lib/gridTools'
import { TILE_EXIT_CATCHALL_MS, TILE_EXIT_MS, tilesLayout } from '../../lib/groupPage'
import { useT } from '../../lib/i18n'
import { EASE_OUT_CSS } from '../../lib/motionTokens'
import { OVERVIEW_PATH } from '../../lib/routes'
import { prefersReducedMotion, viewTransitionOption } from '../../lib/viewTransition'
import { isTransparentBg, useStore } from '../../store'
import { DeleteZone } from '../DeleteZone'
import { DockToolset } from '../Stage'
import { ToolsDock } from '../ToolsDock'
import { GroupWallpaper } from './GroupWallpaper'
import { LeavingTile, PageTile, TileBoard } from './PageCard'
import { useGroupsKeys } from './useGroupsKeys'
import { useGroupsNav } from './useGroupsNav'
import { useGroupsReorder } from './useGroupsReorder'

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
 * The page is the board's edit mode: tiles wiggle each on its own rhythm,
 * press-hold-move reorders the row (the store's `grids` order, which the
 * root pager and capsule follow), and a tap on the board, Done, Escape, Back
 * or the blank page leaves for that group's overview through the `ws-<id>`
 * morph. The eye under a tucked tile dims it and offers the delete `x`; a
 * held tile dropped on the red strip deletes the same way. Both deletes and
 * the + pill's adds are animated: a new tile rises in and the scroller
 * follows it, a deleted one plays out before the row glides shut. The tools
 * dock is not on this page, so the grid owns the whole height and scrolls
 * when the tiles run past it.
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
  const toggleGridHidden = useStore(s => s.toggleGridHidden)
  const navigate = useNavigate()
  const { close: closeGroups } = useGroupsNav()

  const [stageRef, stage] = useElementSize<HTMLDivElement>()
  const coarse = useMediaQuery('(pointer: coarse)')
  const headingRef = useRef<HTMLHeadingElement | null>(null)

  const photoById = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos])
  const transparent = isTransparentBg(bg)
  // The page lists the visible groups only: a tucked-away group has no tile
  // here (the root pager and the capsule keep it, so the eye stays reversible).
  const shown = useMemo(() => grids.filter(g => g.hidden !== true), [grids])
  const layout = useMemo(
    () => tilesLayout({
      stageW: stage.w,
      count: shown.length,
      coarse,
      ratio: cellRatioValue(gridCellRatio),
      gridGap,
    }),
    [stage.w, shown.length, coarse, gridCellRatio, gridGap],
  )
  // The open group can be tucked away, so it may not be among the shown
  // tiles; -1 then means no tile wears the names or the open mark.
  const activeIndex = shown.findIndex(g => g.id === activeGridId)
  const activeBoard = useMemo(
    () => (shown[activeIndex]?.id === activeGridId ? workspaces : parked[activeGridId]?.workspaces ?? workspaces),
    [shown, activeIndex, activeGridId, workspaces, parked],
  )
  const boardOf = useCallback((index: number) => {
    const id = shown[index]?.id
    if (!id)
      return []
    return id === activeGridId ? workspaces : parked[id]?.workspaces ?? []
  }, [shown, activeGridId, workspaces, parked])

  // ---- Deleting is two-phase -----------------------------------------------
  // The tile plays its way out (`LeavingTile`) before the store drops the
  // group, so survivors glide shut; the catch-all timer commits when the
  // animation never runs. Both the `x` and a strip drop land here; a
  // refused delete (the last group) brings the tile back.
  const [leaving, setLeaving] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const commitDelete = useCallback((id: string) => {
    setLeaving((old) => {
      if (!old.has(id))
        return old
      const next = new Map(old)
      next.delete(id)
      return next
    })
    removeGrid(id)
  }, [removeGrid])
  const deleteGroup = useCallback((id: string, dimmed = false) => {
    if (leaving.has(id))
      return
    setLeaving(old => new Map(old).set(id, dimmed))
    setTimeout(commitDelete, TILE_EXIT_CATCHALL_MS, id)
  }, [leaving, commitDelete])
  const deleteFromDrop = useCallback((id: string) => deleteGroup(id, true), [deleteGroup])

  // ---- A group id that joins the row rises in -------------------------------
  // Added, or undone back in: the tile mounts wearing `tile-in` and the
  // scroller follows it (a no-op while the grid fits). The page's own mount
  // skips the diff, so opening animates nothing.
  const [enteringIds, setEnteringIds] = useState<ReadonlySet<string>>(() => new Set())
  const prevIdsRef = useRef<readonly string[] | null>(null)
  useLayoutEffect(() => {
    const prev = prevIdsRef.current
    prevIdsRef.current = grids.map(g => g.id)
    if (!prev)
      return
    const had = new Set(prev)
    const added = grids.filter(g => !had.has(g.id)).map(g => g.id)
    if (!added.length)
      return
    const live = new Set(grids.map(g => g.id))
    setEnteringIds((old) => {
      const next = new Set(added)
      for (const id of old) {
        if (live.has(id))
          next.add(id)
      }
      return next
    })
    // The tile mounted in this same commit, so its box is already laid out.
    // The new group sits at the end of the row, so the whole scroller rides
    // to the bottom; `block: 'nearest'` keeps it a no-op while the grid fits.
    document.querySelector<HTMLElement>('[data-tiles-scroll]')
      ?.scrollTo({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', top: Number.MAX_SAFE_INTEGER })
  }, [grids])

  // ---- Drag-to-reorder (dnd-kit, insert-shift through `moveGrid`) ----------
  // A drop on the delete strip rides the same two-phase delete as the `x`.
  const reorder = useGroupsReorder({ grids: shown, moveGrid, onDelete: deleteFromDrop })
  const dragIndex = reorder.dragId ? shown.findIndex(g => g.id === reorder.dragId) : -1
  const dragBoard = dragIndex >= 0 ? boardOf(dragIndex) : null
  const afterDrag = useCallback((run: () => void) => {
    if (Date.now() - reorder.dragEndedAtRef.current > CLICK_AFTER_DRAG_MS)
      run()
  }, [reorder.dragEndedAtRef])
  // A leaving tile is not a drop target: the survivors it would shift past
  // are about to close over it.
  const sortableIds = useMemo(
    () => shown.filter(g => !leaving.has(g.id)).map(g => g.id),
    [shown, leaving],
  )

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

  const activeName = shown[activeIndex]?.name ?? ''
  const live = t('Group {name}', { name: activeName })

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
          scrolls once it does not. The exit duration rides the container,
          so every leaving tile reads it. */}
      <div
        data-groups-tiles=""
        className="absolute inset-0 z-[5]"
        style={{ '--tile-exit-ms': `${TILE_EXIT_MS}ms` } as CSSProperties}
      >
        <DndContext
          sensors={reorder.sensors}
          collisionDetection={deleteFirst}
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          onDragStart={reorder.onDragStart}
          onDragEnd={reorder.onDragEnd}
          onDragCancel={reorder.onDragCancel}
        >
          <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
            <div
              data-tiles-scroll=""
              className="absolute inset-x-0 bottom-[env(safe-area-inset-bottom)] flex touch-pan-y flex-col overflow-y-auto overscroll-contain"
              style={{ top: layout.headerH }}
              onScroll={onTilesScroll}
            >
              {/* An auto margin centres the grid while it fits and collapses
                  to zero when it overflows, so the scroll starts at the top
                  instead of clipping it (the justify-content trap). The
                  shrink is off: the content keeps its height and the
                  scroller, not the flex line, owns the overflow. */}
              <div className="relative m-auto w-full shrink-0" style={{ height: layout.contentH }}>
                {layout.tiles.map((box, i) => (
                  leaving.has(shown[i].id)
                    ? null
                    : (
                        <PageTile
                          key={shown[i].id}
                          group={shown[i]}
                          board={boardOf(i)}
                          box={box}
                          layout={layout}
                          named={i === activeIndex}
                          hidden={shown[i].hidden === true}
                          entering={enteringIds.has(shown[i].id)}
                          photoById={photoById}
                          transparent={transparent}
                          canDelete={shown.length > 1}
                          onOpen={openTile}
                          onDelete={deleteGroup}
                          onToggle={toggleGridHidden}
                        />
                      )
                ))}
                {[...leaving.keys()].map((id) => {
                  const i = shown.findIndex(g => g.id === id)
                  const box = i >= 0 ? layout.tiles[i] : undefined
                  if (!box)
                    return null
                  return (
                    <LeavingTile
                      key={id}
                      group={shown[i]}
                      board={boardOf(i)}
                      box={box}
                      layout={layout}
                      hidden={shown[i].hidden === true}
                      dimmed={leaving.get(id) === true}
                      photoById={photoById}
                      transparent={transparent}
                      onExited={commitDelete}
                    />
                  )
                })}
              </div>
            </div>
          </SortableContext>

          {/* The red strip a held tile drops on to delete; the same surface
              the overview's cell drag uses, pinned across the page top. */}
          <GroupsDeleteZone active={!!reorder.dragId} label={t('Drop here to delete')} />

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

/** The delete strip's droppable side: the shared `DeleteZone` under this page's drag. */
function GroupsDeleteZone({ active, label }: { active: boolean, label: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: DELETE_ZONE_ID })
  return <DeleteZone setRef={setNodeRef} active={active} over={isOver} label={label} />
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
