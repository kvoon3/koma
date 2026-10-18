import type { CollisionDetection } from '@dnd-kit/core'
import type { Photo } from '../lib/imageStore'
import type { Node } from '../lib/panes'
import { closestCenter, DndContext, DragOverlay, MeasuringStrategy, pointerWithin, useDroppable } from '@dnd-kit/core'
import { rectSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useElementSize } from '../hooks'
import { useAppCommands } from '../lib/appCommands'
import { GRID_CELL_MAX } from '../lib/exporter'
import { cellRatioValue, gridCellBox } from '../lib/gridTools'
import { useT } from '../lib/i18n'
import { leafList } from '../lib/panes'
import { prefersReducedMotion, viewTransitionOption } from '../lib/viewTransition'
import { MAX_WORKSPACES } from '../lib/workspaces'
import { isTransparentBg, useStore } from '../store'
import { DeleteZone } from './DeleteZone'
import { BoardCaption } from './grid/BoardCaption'
import { AddSlotFrame, CellBody } from './grid/CellPreview'
import { CAPTION_GAP, CAPTION_H, DOCK_CHROME_H, RECEDE_BLUR, RECEDE_OPACITY, recedeFit, STAGE_PAD_Y, switcherMetrics } from './grid/switcherLayout'
import { useBoardPager } from './grid/useBoardPager'
import { useGridKeyboard } from './grid/useGridKeyboard'
import { DELETE_ZONE_ID, useGridReorder } from './grid/useGridReorder'
import { usePullDown } from './grid/usePullDown'
import { useSwitcherMorph } from './grid/useSwitcherMorph'
import { PagerSurface, WorkspaceSwitcher } from './grid/WorkspaceSwitcher'
import { DockToolset } from './Stage'
import { ToolsDock } from './ToolsDock'

/** Side air the stage keeps around a board (both sides together). */
const STAGE_PAD = 48

/**
 * The 3×3 slot the board gets, and the smallest cell it may use, inside the
 * stage: above the dock (which overlays the stage's floor) and under its own
 * caption row.
 */
function boardSlot(body: { w: number, h: number }): { w: number, h: number, min: number } {
  const height = Math.max(1, body.h - CAPTION_H - CAPTION_GAP)
  return { w: body.w - STAGE_PAD, h: height, min: 60 }
}

/** The cell size for the stage, from the slot its board gets (`boardSlot`). */
function stageCellBox(body: { w: number, h: number }, gap: number, ratio: number): { cell: number, box: { w: number, h: number } } {
  const slot = boardSlot(body)
  const fit = gridCellBox({ w: slot.w, h: Math.max(1, slot.h) }, gap, ratio, GRID_CELL_MAX, slot.min)
  // Centering an odd leftover put every cell on a half pixel, where 1px
  // edges snap unevenly (the + cell's dashed right edge vanished). One px
  // less flips the board's parity, so the cells land on whole pixels.
  const cell = fit.w > 60 && (slot.w - (fit.w * 3 + gap * 2)) % 2 !== 0 ? fit.w - 1 : fit.w
  return { cell, box: { w: cell, h: cell === fit.w ? fit.h : Math.max(1, Math.round(cell / ratio)) } }
}

/**
 * The delete strip is hit by the pointer itself (it sits outside the grid, so
 * closestCenter would never pick it, and must not steal near-top drops);
 * every other drop keeps the sortable's closestCenter over the cells only.
 */
const deleteFirst: CollisionDetection = (args) => {
  const zone = args.droppableContainers.filter(c => c.id === DELETE_ZONE_ID)
  const hit = pointerWithin({ ...args, droppableContainers: zone })
  if (hit.length)
    return hit
  return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter(c => c.id !== DELETE_ZONE_ID) })
}

/**
 * The 3×3 workspace overview: read-only square previews of all nine
 * workspaces. Click a cell to edit that workspace, drag a cell onto another
 * to insert-shift reorder (dnd-kit sortable grid: the dragged cell follows
 * the pointer as an overlay while the rest make room live), arrows/hjkl/Tab
 * + Enter to navigate by keyboard. Pure navigation view, no photo tools.
 *
 * Boards come in groups (`lib/workspaces`): the Workspace chip (or a pull down
 * on the board) opens the Mission Control-style switcher over the receding
 * board: a frosted strip of one card per group, where + copies the open board
 * into a new group, × deletes one, and a click zooms back into the picked
 * workspace. A pull up on the receded board, Esc or the dim leaves it again.
 * The pieces live next door: the cell previews and the switcher's own surface
 * in `grid/CellPreview` and `grid/WorkspaceSwitcher`, the board pager's
 * physics and gestures in `grid/useBoardPager`.
 */
export function WorkspaceGrid() {
  const workspaces = useStore(s => s.workspaces)
  const activeId = useStore(s => s.activeId)
  const photos = useStore(s => s.photos)
  const bg = useStore(s => s.bg)
  const gridGap = useStore(s => s.gridGap)
  const gridCellRatio = useStore(s => s.gridCellRatio)
  const moveWorkspace = useStore(s => s.moveWorkspace)
  const grids = useStore(s => s.grids)
  const activeGridId = useStore(s => s.activeGridId)
  const parkedBoards = useStore(s => s.parkedBoards)
  const navigate = useNavigate()
  const t = useT()
  const { exportGridCells, busy } = useAppCommands()
  /** Local to the camera chip: the app-wide `busy` also spins during an export. */
  const [snapBusy, setSnapBusy] = useState(false)
  /** The switcher's mode and its morph (its own hook, `grid/useSwitcherMorph`). */
  const { switcher, boardNamed, morphSwitcher, resetRef: resetPagerRef } = useSwitcherMorph()

  const photoById = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos])
  const transparent = isTransparentBg(bg)
  // Anything to snapshot? Empty cells render blank, so an all-empty board is
  // not worth a render (the chip is disabled instead).
  const anyFilled = useMemo(() => workspaces.some(w => leafList(w.root).some(l => l.photoId)), [workspaces])

  // ---- Geometry ------------------------------------------------------------
  const [wrapRef, wrapSize] = useElementSize<HTMLDivElement>()
  // The dock is an overlay, so the board is sized and centered above it. The
  // reserve holds while the switcher is open (the dock is put away there), so
  // the receded board stays exactly where the zoom-out left it.
  const dockReserve = DOCK_CHROME_H
  const body = {
    w: wrapSize.w,
    h: Math.max(1, wrapSize.h - STAGE_PAD_Y * 2 - dockReserve),
  }
  const { cell, box } = stageCellBox(body, gridGap, cellRatioValue(gridCellRatio))
  const boardW = cell * 3 + gridGap * 2
  // The 3×3's height as it lays out: every cell is the same box, and the + cell
  // counts as one more slot until the board is full.
  const rows = Math.max(1, Math.ceil((workspaces.length + (workspaces.length < MAX_WORKSPACES ? 1 : 0)) / 3))
  const boardH = rows * box.h + (rows - 1) * gridGap
  const { stripTop, stripH, cardW, cardH } = switcherMetrics(wrapSize.h)
  // Where the board recedes to: the same zoom-out, shifted down (and on a stage
  // too short for it, shrunk) so the whole column clears the strip.
  const recede = recedeFit({ stageH: wrapSize.h, boardH, stripTop, stripH })
  const activeIdx = grids.findIndex(g => g.id === activeGridId)
  const boardRef = useRef<HTMLDivElement | null>(null)

  /** The cells of the group at `index` in the row (the live board included). */
  const boardOf = (index: number) => {
    const id = grids[index]?.id
    if (!id)
      return []
    return id === activeGridId ? workspaces : parkedBoards[id]?.workspaces ?? []
  }

  // ---- Board pager (the receded board dragged sideways, pulled up) ---------
  const pager = useBoardPager({
    open: switcher,
    stageRef: wrapRef,
    boardRef,
    stageW: wrapSize.w,
    stageH: wrapSize.h,
    recedeScale: recede.scale,
    cell,
    boxH: box.h,
    gap: gridGap,
    cellCount: workspaces.length,
    gridIds: grids.map(g => g.id),
    activeIdx,
    onExit: () => morphSwitcher(false),
  })
  useEffect(
    () => { resetPagerRef.current = pager.reset },
    [pager.reset, resetPagerRef],
  )

  // Enter a workspace: set activeId before navigating so the stage renders the
  // right workspace inside the same view-transition commit (the route wrapper
  // re-syncs it for direct URLs), then morph the cell into the canvas.
  const enter = useCallback((id: string) => {
    useStore.getState().patch({ activeId: id })
    useStore.getState().clearSelection()
    void navigate({ to: '/w/$wsId', params: { wsId: id }, viewTransition: viewTransitionOption() })
  }, [navigate])

  // ---- Keyboard highlight (grid navigation) --------------------------------
  const hl = useGridKeyboard({ workspaces, activeId, switcherOpen: switcher, enter })

  // Esc leaves the switcher (the other exits are a card click, the backdrop and
  // a pull up on the board); nothing else here re-subscribes with it.
  const onSwitcherKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== 'Escape')
      return
    const t = e.target as HTMLElement
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      return
    e.preventDefault()
    morphSwitcher(false)
  })

  useEffect(() => {
    if (!switcher)
      return
    window.addEventListener('keydown', onSwitcherKey)
    return () => window.removeEventListener('keydown', onSwitcherKey)
  }, [switcher])

  // ---- Drag-to-reorder (dnd-kit, insert-shift) -----------------------------
  const reorder = useGridReorder({ workspaces, moveWorkspace })
  /** The click that follows a finished drag must not enter. */
  const enterAfterDrag = (id: string) => {
    if (Date.now() - reorder.dragEndedAtRef.current > 120)
      enter(id)
  }

  // ---- Pull-down (the overview's way into the switcher) --------------------
  const pull = usePullDown({
    enabled: !switcher,
    onOpen: () => morphSwitcher(true),
    isSuppressed: () => reorder.dragIdRef.current !== null,
  })

  /**
   * The gesture surface over the receded board: above the dim, under the strip,
   * so a press on the board is a pager drag (or a pull up out of the switcher)
   * while a click there does nothing (it used to fall through to the dim and
   * leave the switcher).
   */
  const surface = (
    <PagerSurface
      surfaceRef={pager.surfaceRef}
      trackRef={pager.trackRef}
      prevBoard={pager.hasPrev ? boardOf(activeIdx - 1) : undefined}
      nextBoard={pager.hasNext ? boardOf(activeIdx + 1) : undefined}
      cell={cell}
      box={box}
      gap={gridGap}
      boardW={boardW}
      scale={recede.scale}
      photoById={photoById}
      transparent={transparent}
      {...pager.handlers}
    />
  )

  return (
    <div
      ref={wrapRef}
      className="stage-checker absolute inset-0 flex touch-none flex-col overflow-hidden"
    >
      {/* The board area: the stage's own air and everything the board column
          draws, minus the dock (a sibling, so a pull on the sheet never lands
          here). Pulled down it opens the switcher. */}
      <div
        data-board-stage=""
        className="relative flex min-h-0 flex-1 items-center justify-center"
        style={{ paddingTop: STAGE_PAD_Y, paddingBottom: STAGE_PAD_Y + dockReserve }}
        onPointerDown={pull.onPullDown}
        onPointerMove={pull.onPullMove}
        onPointerUp={pull.onPullEnd}
        onPointerCancel={pull.onPullEnd}
      >
        <DndContext
          sensors={reorder.sensors}
          collisionDetection={deleteFirst}
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          onDragStart={reorder.onDragStart}
          onDragEnd={reorder.onDragEnd}
          onDragCancel={reorder.onDragCancel}
        >
          <GridDeleteZone active={!!reorder.dragId} label={t('Drop here to delete')} />
          <SortableContext items={reorder.ids} strategy={rectSortingStrategy}>
            {/* The board's caption row (the workspace and snapshot chips,
                centred: groups render nameless) and the grid below it, one
                column of the board's width. While the switcher is open the
                column recedes behind the frosted strip (scaled down, shifted
                clear of it, dimmed, blurred, inert), morphing as ws-board. */}
            <div
              className="flex flex-col items-center"
              style={{
                width: boardW,
                gap: CAPTION_GAP,
                viewTransitionName: boardNamed ? 'ws-board' : undefined,
                transform: switcher ? `translateY(${recede.translateY}px) scale(${recede.scale})` : undefined,
                opacity: switcher ? RECEDE_OPACITY : 1,
                filter: switcher ? `blur(${RECEDE_BLUR}px)` : undefined,
                pointerEvents: switcher ? 'none' : undefined,
              }}
            >
              <BoardCaption
                width={boardW}
                height={CAPTION_H}
                snapshotDisabled={!anyFilled || busy || snapBusy}
                snapshotBusy={snapBusy}
                onOpenSwitcher={() => morphSwitcher(true)}
                onSnapshot={() => {
                  setSnapBusy(true)
                  void exportGridCells().finally(() => setSnapBusy(false))
                }}
              />
              <div
                ref={boardRef}
                data-board=""
                className="grid grid-cols-3"
                style={{ gap: gridGap, width: boardW }}
              >
                {workspaces.map((ws, i) => (
                  <SortableCell
                    key={ws.id}
                    ws={ws}
                    cell={cell}
                    box={box}
                    photoById={photoById}
                    transparent={transparent}
                    highlighted={hl === i}
                    quiet={switcher}
                    onEnter={enterAfterDrag}
                  />
                ))}
                {workspaces.length < MAX_WORKSPACES && <AddCell cell={cell} cellH={box.h} />}
              </div>
            </div>
          </SortableContext>

          <DragOverlay dropAnimation={prefersReducedMotion() ? null : { duration: 160, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }}>
            {reorder.draggedWs
              ? (
                  <div
                    className="relative cursor-grabbing overflow-hidden bg-panel-2 shadow-[0_18px_48px_rgba(0,0,0,0.55)]"
                    style={{ width: cell, height: box.h }}
                  >
                    <CellBody ws={reorder.draggedWs} box={box} photoById={photoById} transparent={transparent} dimmed={false} />
                  </div>
                )
              : null}
          </DragOverlay>
        </DndContext>
      </div>

      {switcher && (
        <WorkspaceSwitcher
          stripTop={stripTop}
          stripH={stripH}
          cardW={cardW}
          cardH={cardH}
          ringId={pager.ringId}
          photoById={photoById}
          transparent={transparent}
          onPick={id => morphSwitcher(false, id ?? undefined)}
        >
          {surface}
        </WorkspaceSwitcher>
      )}

      {/* Grid-route-only tools: Grid gap. Same 3-snap sheet as the collage stage;
          put away while the switcher holds the stage. */}
      <ToolsDock hidden={switcher} contextKey="grid">
        <DockToolset route="grid" />
      </ToolsDock>
    </div>
  )
}

function GridDeleteZone({ active, label }: { active: boolean, label: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: DELETE_ZONE_ID })
  return <DeleteZone setRef={setNodeRef} active={active} over={isOver} label={label} />
}

/** The + cell after the last workspace: adds a blank one. Not sortable. */
function AddCell({ cell, cellH }: { cell: number, cellH: number }) {
  const t = useT()
  return (
    <button
      data-add-cell=""
      className="relative grid cursor-pointer select-none place-items-center border-0 bg-transparent p-0 text-dim outline-0 transition-[background-color,color,scale] duration-(--dur-fast) hover:bg-chip-hover hover:text-txt active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-txt"
      style={{ width: cell, height: cellH }}
      aria-label={t('Add a workspace')}
      title={t('Add a workspace')}
      onClick={() => useStore.getState().addWorkspace()}
    >
      <AddSlotFrame cell={cell} cellH={cellH} />
    </button>
  )
}

function SortableCell({ ws, cell, box, photoById, transparent, highlighted, quiet, onEnter }: {
  ws: { id: string, root: Node, canvasRatio: number | null }
  cell: number
  box: { w: number, h: number }
  photoById: Map<string, Photo>
  transparent: boolean
  highlighted: boolean
  /** Empty cell as a bare square: the receded board behind the switcher. */
  quiet: boolean
  onEnter: (id: string) => void
}) {
  const t = useT()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ws.id })
  const filled = leafList(ws.root).some(l => l.photoId)
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-cell=""
      className={`relative cursor-pointer touch-none select-none overflow-hidden bg-panel-2 outline-0 transition-[transform,scale,opacity,outline-color] duration-(--dur-surface) active:scale-[0.97] ${
        highlighted ? ' outline-2 outline-txt -outline-offset-2' : ''
      }`}
      style={{
        width: cell,
        height: box.h,
        transform: CSS.Transform.toString(transform),
        transition,
        viewTransitionName: `ws-${ws.id}`,
      }}
      onClick={() => onEnter(ws.id)}
      title={filled ? t('Edit this workspace') : t('Start a new collage here')}
    >
      <CellBody ws={ws} box={box} photoById={photoById} transparent={transparent} dimmed={isDragging} quiet={quiet} />
    </button>
  )
}
