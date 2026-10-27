import type { CollisionDetection } from '@dnd-kit/core'
import type { CardKind } from '../lib/cards'
import type { Photo } from '../lib/imageStore'
import type { Node } from '../lib/panes'
import { Menu } from '@base-ui/react/menu'
import { closestCenter, DndContext, DragOverlay, MeasuringStrategy, pointerWithin, useDroppable } from '@dnd-kit/core'
import { rectSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useNavigate } from '@tanstack/react-router'
import { Image, Square, Type } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useDockRestBand, useElementSize, useMediaQuery, useStageZoom } from '../hooks'
import { useAppCommands } from '../lib/appCommands'
import { viewTransform } from '../lib/canvasView'
import { GRID_CELL_MAX } from '../lib/exporter'
import { cellRatioValue, gridCellBox } from '../lib/gridTools'
import { useT } from '../lib/i18n'
import { EASE_OUT_CSS } from '../lib/motionTokens'
import { leafList } from '../lib/panes'
import { prefersReducedMotion, viewTransitionOption } from '../lib/viewTransition'
import { MAX_WORKSPACES } from '../lib/workspaces'
import { isTransparentBg, useStore } from '../store'
import { DeleteZone } from './DeleteZone'
import { BoardCaption } from './grid/BoardCaption'
import { AddSlotFrame, CellBody } from './grid/CellPreview'
import { CAPTION_GAP, CAPTION_H, RECEDE_BLUR, RECEDE_OPACITY, recedeFit, STAGE_PAD_Y, stageTopPad, switcherMetrics } from './grid/switcherLayout'
import { useBoardPager } from './grid/useBoardPager'
import { useGridKeyboard } from './grid/useGridKeyboard'
import { DELETE_ZONE_ID, useGridReorder } from './grid/useGridReorder'
import { usePullDown } from './grid/usePullDown'
import { useSwitcherMorph } from './grid/useSwitcherMorph'
import { PagerSurface, WorkspaceSwitcher } from './grid/WorkspaceSwitcher'
import { DockToolset } from './Stage'
import { ToolsDock } from './ToolsDock'
import { menuItemCls, menuPopupCls } from './ui/menu'
import { ViewZoomChip } from './ViewZoomChip'

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
 * every other drop is decided by the pointer too.
 *
 * The cells are decided by the pointer first: the canvas view zoom is a CSS
 * transform, and dnd-kit's translate (screen pixels from the sensor) and the
 * collided rect (the cell's own rect plus that translate) disagree by the
 * scale, while the pointer and every droppable rect are measured in the same
 * space. closestCenter stays the fallback for a pointer resting in a gap.
 */
const deleteFirst: CollisionDetection = (args) => {
  const hit = pointerWithin(args)
  const zone = hit.filter(c => c.id === DELETE_ZONE_ID)
  if (zone.length)
    return zone
  const cells = hit.filter(c => c.id !== DELETE_ZONE_ID)
  if (cells.length)
    return cells
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
 * workspace. A tap on the receded board, a pull up on it, Esc or the dim
 * leaves it again.
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
  // The dock is an overlay, so the board is sized and centered above it: the
  // sheet's live band (measured, its height moves with the icons / row /
  // expanded displays; the constant is the first-frame fallback), frozen for
  // the switcher (see the hook).
  const dockReserve = useDockRestBand(wrapSize.h, wrapSize.top, switcher)
  // The undo/redo cluster floats over the stage's top-right, and on a phone
  // the centred caption chips share its horizontal band: the column starts
  // below it (`stageTopPad`) instead of under it. Desktops keep plain air.
  const topPad = stageTopPad(wrapSize.w, useMediaQuery('(pointer: coarse)'))
  const body = {
    w: wrapSize.w,
    h: Math.max(1, wrapSize.h - topPad - STAGE_PAD_Y - dockReserve),
  }
  const { cell, box } = stageCellBox(body, gridGap, cellRatioValue(gridCellRatio))
  const boardW = cell * 3 + gridGap * 2
  // The 3×3's height as it lays out: every cell is the same box, and the + cell
  // counts as one more slot until the board is full.
  const rows = Math.max(1, Math.ceil((workspaces.length + (workspaces.length < MAX_WORKSPACES ? 1 : 0)) / 3))
  const boardH = rows * box.h + (rows - 1) * gridGap
  const { stripTop, stripH, cardW, cardH } = switcherMetrics(wrapSize.h)
  // Where the board recedes to: the same zoom-out, shifted down (and on a stage
  // too short for it, shrunk) so the whole column clears the strip. The recede
  // centres on the resting column, so it wears the same measured dock band.
  const recede = recedeFit({ stageH: wrapSize.h, boardH, stripTop, stripH, topPad, dockH: dockReserve })
  const activeIdx = grids.findIndex(g => g.id === activeGridId)
  const boardRef = useRef<HTMLDivElement | null>(null)
  // The board column is the canvas here: the view zoom (from the stage margin)
  // scales it about its centre, and the wheel there never touches the cells.
  const columnRef = useRef<HTMLDivElement | null>(null)
  // The switcher owns the stage while it is open: no view zoom then, so the
  // recede, the pager and the strip all keep the geometry they were written
  // against, and the chip cannot sit over the strip.
  const viewZoom = useStageZoom(wrapRef, columnRef, { enabled: !switcher })
  const viewScale = switcher ? 1 : viewZoom.scale

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
   * so a press on the board is a pager drag, a pull up out of the switcher, or
   * a tap that leaves it the way the dim does (the board is the biggest target
   * on screen, and the surface used to swallow that click).
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
      // A double-click on the stage margin fits the view again; on the board
      // it belongs to the board.
      onDoubleClick={viewZoom.onStageDoubleClick}
    >
      {/* The board area: the stage's own air and everything the board column
          draws, minus the top cluster (a phone's caption chips start below it)
          and the dock (a sibling, so a pull on the sheet never lands here).
          Pulled down it opens the switcher. */}
      <div
        data-board-stage=""
        className="relative flex min-h-0 flex-1 items-center justify-center"
        style={{ paddingTop: topPad, paddingBottom: STAGE_PAD_Y + dockReserve }}
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
              ref={columnRef}
              data-canvas-view={viewScale}
              className="flex flex-col items-center"
              style={{
                width: boardW,
                gap: CAPTION_GAP,
                viewTransitionName: boardNamed ? 'ws-board' : undefined,
                // The view zoom and the recede never compose: the switcher
                // renders the view at fit (see `viewScale` above).
                transform: [viewTransform(viewScale), switcher ? `translateY(${recede.translateY}px) scale(${recede.scale})` : undefined].filter(Boolean).join(' ') || undefined,
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
                    viewScale={viewScale}
                    onEnter={enterAfterDrag}
                  />
                ))}
                {workspaces.length < MAX_WORKSPACES && <AddCell cell={cell} cellH={box.h} />}
              </div>
            </div>
          </SortableContext>

          <DragOverlay dropAnimation={prefersReducedMotion() ? null : { duration: 160, easing: EASE_OUT_CSS }}>
            {reorder.draggedWs
              ? (
                  // dnd-kit sizes this wrapper in screen pixels while the cells
                  // it copies are laid out in canvas pixels: the ghost is drawn
                  // at the scaled size, so the two never disagree under a view
                  // zoom.
                  <div
                    className="relative cursor-grabbing overflow-hidden bg-panel-2 shadow-[0_18px_48px_rgba(0,0,0,0.55)]"
                    style={{ width: cell * viewScale, height: box.h * viewScale }}
                  >
                    <CellBody ws={reorder.draggedWs} box={{ w: box.w * viewScale, h: box.h * viewScale }} photoById={photoById} transparent={transparent} dimmed={false} />
                  </div>
                )
              : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Off fit, a small chip says how far and puts it back. */}
      <ViewZoomChip scale={viewScale} onFit={viewZoom.fit} className="absolute left-2.5 top-2.5 z-20" />

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

/**
 * The + cell after the last workspace: a menu for a blank workspace or one of
 * the share-card presets. Not sortable.
 */
function AddCell({ cell, cellH }: { cell: number, cellH: number }) {
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

function SortableCell({ ws, cell, box, photoById, transparent, highlighted, quiet, viewScale, onEnter }: {
  ws: { id: string, root: Node, canvasRatio: number | null }
  cell: number
  box: { w: number, h: number }
  photoById: Map<string, Photo>
  transparent: boolean
  highlighted: boolean
  /** Empty cell as a bare square: the receded board behind the switcher. */
  quiet: boolean
  /** The canvas view zoom: dnd-kit's translate is in screen pixels. */
  viewScale: number
  onEnter: (id: string) => void
}) {
  const t = useT()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ws.id })
  const filled = leafList(ws.root).some(l => l.photoId)
  // The sortable's translate is measured in screen pixels; the cell is laid out
  // in canvas pixels, so a view zoom has to come back out of it.
  const shift = transform ? { ...transform, x: transform.x / viewScale, y: transform.y / viewScale } : null
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
        transform: CSS.Transform.toString(shift),
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
