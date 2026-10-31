import type { CollisionDetection } from '@dnd-kit/core'
import type { CardKind } from '../lib/cards'
import type { Photo } from '../lib/imageStore'
import type { Node } from '../lib/panes'
import type { Workspace } from '../store'
import { Menu } from '@base-ui/react/menu'
import { closestCenter, DndContext, DragOverlay, MeasuringStrategy, pointerWithin, useDroppable } from '@dnd-kit/core'
import { rectSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useNavigate } from '@tanstack/react-router'
import { Camera, Image, Square, Type } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useDockRestBand, useElementSize, useMediaQuery, useStageZoom } from '../hooks'
import { useAppCommands } from '../lib/appCommands'
import { viewTransform } from '../lib/canvasView'
import { dockBand } from '../lib/dockMetrics'
import { GRID_CELL_MAX } from '../lib/exporter'
import { cellRatioValue, gridCellBox } from '../lib/gridTools'
import { pageTravel } from '../lib/groupPage'
import { useT } from '../lib/i18n'
import { EASE_OUT_CSS } from '../lib/motionTokens'
import { leafList } from '../lib/panes'
import { clampDockMode } from '../lib/toolsDockMode'
import { prefersReducedMotion, viewTransitionOption } from '../lib/viewTransition'
import { MAX_WORKSPACES } from '../lib/workspaces'
import { isTransparentBg, useStore } from '../store'
import { DeleteZone } from './DeleteZone'
import { useDockCapacity, useDockMetrics } from './dockContext'
import { CAPSULE_H, CAPTION_GAP, CAPTION_H, STAGE_PAD_Y, stageTopPad } from './grid/boardLayout'
import { AddSlotFrame, CellBody } from './grid/CellPreview'
import { useGridKeyboard } from './grid/useGridKeyboard'
import { DELETE_ZONE_ID, useGridReorder } from './grid/useGridReorder'
import { useStageGestures } from './grid/useStageGestures'
import { useGroupsNav } from './groups/useGroupsNav'
import { DockToolset } from './Stage'
import { ToolsDock } from './ToolsDock'
import { Button } from './ui/button'
import { menuItemCls, menuPopupCls } from './ui/menu'
import { Tip } from './ui/tip'
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
 * to insert-shift reorder (dnd-kit sortable grid: the dragged cell follows the
 * pointer as an overlay while the rest make room live), arrows/hjkl/Tab
 * + Enter to navigate by keyboard. Pure navigation view, no photo tools.
 *
 * The board groups swipe in place: dragging the board sideways slides the
 * neighbouring group's board in from the screen edge and a release past half
 * (or a flick) opens it (`grid/useStageGestures` owns the gesture). The
 * groups page (`/groups`) is reached through the dot capsule under the board,
 * a pull down, or a long press on blank stage; a tile's cell names morph from
 * the same `ws-<id>` names this overview wears.
 */
export function WorkspaceGrid() {
  const workspaces = useStore(s => s.workspaces)
  const activeId = useStore(s => s.activeId)
  const photos = useStore(s => s.photos)
  const bg = useStore(s => s.bg)
  const gridGap = useStore(s => s.gridGap)
  const gridCellRatio = useStore(s => s.gridCellRatio)
  const moveWorkspace = useStore(s => s.moveWorkspace)
  const storedMode = useStore(s => s.toolsDockMode)
  const grids = useStore(s => s.grids)
  const activeGridId = useStore(s => s.activeGridId)
  const parkedBoards = useStore(s => s.parkedBoards)
  const switchGrid = useStore(s => s.switchGrid)
  const navigate = useNavigate()
  const t = useT()
  const { exportGridCells, busy } = useAppCommands()
  const { open: openGroups } = useGroupsNav()
  /** Local to the camera chip: the app-wide `busy` also spins during an export. */
  const [snapBusy, setSnapBusy] = useState(false)

  const photoById = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos])
  const transparent = isTransparentBg(bg)
  // Anything to snapshot? Empty cells render blank, so an all-empty board is
  // not worth a render (the chip is disabled instead).
  const anyFilled = useMemo(() => workspaces.some(w => leafList(w.root).some(l => l.photoId)), [workspaces])

  // ---- Geometry ------------------------------------------------------------
  const [wrapRef, wrapSize] = useElementSize<HTMLDivElement>()
  // The dock is an overlay, so the board is sized and centred above it. The
  // band is measured; the restored band is what the sheet shows once a
  // compact page (groups) has handed the dock back, so the first overview
  // paint after that route already uses the final floor.
  const metrics = useDockMetrics()
  const capacity = useDockCapacity()
  const dockReserve = useDockRestBand(wrapSize.h, wrapSize.top, dockBand(metrics, clampDockMode(storedMode, capacity)))
  // The undo/redo cluster floats over the stage's top-right, and on a phone
  // the centred caption chips share its horizontal band: the column starts
  // below it (`stageTopPad`) instead of under it. Desktops keep plain air.
  const topPad = stageTopPad(wrapSize.w, useMediaQuery('(pointer: coarse)'))
  const body = {
    w: wrapSize.w,
    h: Math.max(1, wrapSize.h - topPad - STAGE_PAD_Y - dockReserve - CAPSULE_H),
  }
  const { cell, box } = stageCellBox(body, gridGap, cellRatioValue(gridCellRatio))
  const boardW = cell * 3 + gridGap * 2
  // The 3×3's row count: every cell is the same box, and the + cell counts as
  // one more slot until the board is full. Fewer rows lift the board (the
  // column is centred), so the pager's measured base follows it.
  const boardRows = Math.max(1, Math.ceil((workspaces.length + (workspaces.length < MAX_WORKSPACES ? 1 : 0)) / 3))
  // The board column is the canvas here: the view zoom (from the stage margin)
  // scales it about its centre, and the wheel there never touches the cells.
  // The pan of a pager drag lands on the board itself, inside that scale.
  const stageRef = useRef<HTMLDivElement | null>(null)
  const columnRef = useRef<HTMLDivElement | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const boardFalloffRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const viewZoom = useStageZoom(wrapRef, columnRef)

  const activeIndex = Math.max(0, grids.findIndex(g => g.id === activeGridId))
  const hasPrev = activeIndex > 0
  const hasNext = activeIndex >= 0 && activeIndex < grids.length - 1
  /** The cells of the group at `index` in the row (the live board included). */
  const boardOf = useCallback((index: number) => {
    const id = grids[index]?.id
    if (!id)
      return []
    return id === activeGridId ? workspaces : parkedBoards[id]?.workspaces ?? []
  }, [grids, activeGridId, workspaces, parkedBoards])

  // ---- Group pager (swipe sideways to switch groups) -----------------------
  // The board's screen box, measured the way the old board switcher measured
  // its surface: the previews sit at it, one page off each side. A landing
  // re-measures mid re-base, so the pan comes back out of the read.
  const [boardBase, setBoardBase] = useState<{ x: number, y: number } | null>(null)
  const boardScreenW = boardW * viewZoom.scale
  // Half the stage's leftover width at the board's screen size. The neighbour
  // rests one page off, flush with the far screen edge, so it enters from the
  // edge, and the mask that fades it never reaches the resting board.
  const sideAir = Math.max(0, (wrapSize.w - boardScreenW) / 2)
  const travel = pageTravel(boardScreenW, sideAir)
  const fade = Math.min(16, Math.max(8, sideAir - 4))
  const mask = `linear-gradient(to right, transparent 0, black ${fade}px, black calc(100% - ${fade}px), transparent 100%)`

  // Enter a workspace: set activeId before navigating so the stage renders the
  // right workspace inside the same view-transition commit (the route wrapper
  // re-syncs it for direct URLs), then morph the cell into the canvas.
  const enter = useCallback((id: string) => {
    useStore.getState().patch({ activeId: id })
    useStore.getState().clearSelection()
    void navigate({ to: '/w/$wsId', params: { wsId: id }, viewTransition: viewTransitionOption() })
  }, [navigate])

  // ---- Keyboard highlight (grid navigation) --------------------------------
  const hl = useGridKeyboard({ workspaces, activeId, enter })

  // ---- Drag-to-reorder (dnd-kit, insert-shift) -----------------------------
  const reorder = useGridReorder({ workspaces, moveWorkspace })
  /** The click that follows a finished drag must not enter. */
  const enterAfterDrag = (id: string) => {
    if (Date.now() - reorder.dragEndedAtRef.current > 120)
      enter(id)
  }

  // ---- Stage gestures (the pager, the pull-down, the long press) -----------
  const gestures = useStageGestures({
    enabled: true,
    gridIds: grids.map(g => g.id),
    activeIndex,
    travel,
    viewScale: viewZoom.scale,
    boardRef,
    falloffRef: boardFalloffRef,
    trackRef,
    onSwitch: switchGrid,
    onOpenGroups: openGroups,
    isSuppressed: () => reorder.dragIdRef.current !== null,
  })
  const { registerPreview, offset } = gestures

  useLayoutEffect(() => {
    const stage = stageRef.current
    const board = boardRef.current
    if (!stage || !board)
      return
    const s = stage.getBoundingClientRect()
    const b = board.getBoundingClientRect()
    setBoardBase({ x: b.left - s.left - offset(), y: b.top - s.top })
  }, [wrapSize.w, wrapSize.h, cell, box.h, gridGap, boardRows, viewZoom.scale, topPad, dockReserve, activeIndex, grids.length, offset])

  return (
    <div
      ref={wrapRef}
      className="stage-checker absolute inset-0 flex touch-none flex-col overflow-hidden"
      // A double-click on the stage margin fits the view again; on the board
      // it belongs to the board.
      onDoubleClick={viewZoom.onStageDoubleClick}
    >
      {/* The board area: every press here belongs to the stage gestures (a
          swipe between groups, a pull down or a long press into the groups
          page). The dock is a sibling, so a pull on the sheet never lands
          here. */}
      <div
        ref={stageRef}
        data-board-stage=""
        className="relative min-h-0 flex-1"
        {...gestures.stageProps}
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
          {/* The sliding row: the live column and the neighbour previews, one
              masked plane. The mask fades only at the stage's edges and never
              reaches the resting board, whose side air is wider. The delete
              strip and the drag ghost stay outside it. */}
          <div
            data-stage-row=""
            className="absolute inset-0 flex items-center justify-center"
            style={{
              paddingTop: topPad,
              paddingBottom: STAGE_PAD_Y + dockReserve + CAPSULE_H,
              maskImage: mask,
              WebkitMaskImage: mask,
            }}
          >
            <SortableContext items={reorder.ids} strategy={rectSortingStrategy}>
              {/* The board's caption row (the snapshot chip alone: groups
                  render nameless, the dot capsule under the board is the
                  groups entry) and the grid below it. While a pager drag is
                  live the column ignores the pointer, so no cell grabs it. */}
              <div
                ref={columnRef}
                data-canvas-view={viewZoom.scale}
                className="flex flex-col items-center"
                style={{
                  width: boardW,
                  gap: CAPTION_GAP,
                  transform: viewTransform(viewZoom.scale) || undefined,
                  pointerEvents: gestures.panning ? 'none' : undefined,
                }}
              >
                <div className="flex items-center justify-center" style={{ width: boardW, height: CAPTION_H }}>
                  <Tip
                    label={t('Snapshot: each cell plus the whole grid')}
                    trigger={(
                      <Button
                        variant="float"
                        icon={Camera}
                        iconSize={15}
                        loading={snapBusy}
                        disabled={!anyFilled || busy || snapBusy}
                        aria-label={t('Snapshot: each cell plus the whole grid')}
                        onClick={() => {
                          setSnapBusy(true)
                          void exportGridCells().finally(() => setSnapBusy(false))
                        }}
                      />
                    )}
                  />
                </div>
                {/* The board carries the pager's pan; the grid inside carries
                    the falloff, whose shrink keeps its own centre origin. */}
                <div ref={boardRef} data-board="" style={{ width: boardW }}>
                  <div
                    ref={boardFalloffRef}
                    data-board-grid=""
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
                        viewScale={viewZoom.scale}
                        onEnter={enterAfterDrag}
                      />
                    ))}
                    {workspaces.length < MAX_WORKSPACES && <AddCell cell={cell} cellH={box.h} />}
                  </div>
                </div>
              </div>
            </SortableContext>

            {/* The neighbouring groups as full-size quiet board previews, one
                page of travel either side of the live board's measured box.
                They slide with the row (the track pans) and are inert. */}
            <div ref={trackRef} data-pager-track="" aria-hidden className="pointer-events-none absolute inset-0">
              {boardBase && hasPrev && (
                <PagerBoard
                  side="prev"
                  board={boardOf(activeIndex - 1)}
                  base={boardBase}
                  cell={cell}
                  box={box}
                  gap={gridGap}
                  boardW={boardW}
                  travel={travel}
                  viewScale={viewZoom.scale}
                  photoById={photoById}
                  transparent={transparent}
                  onRef={registerPreview}
                />
              )}
              {boardBase && hasNext && (
                <PagerBoard
                  side="next"
                  board={boardOf(activeIndex + 1)}
                  base={boardBase}
                  cell={cell}
                  box={box}
                  gap={gridGap}
                  boardW={boardW}
                  travel={travel}
                  viewScale={viewZoom.scale}
                  photoById={photoById}
                  transparent={transparent}
                  onRef={registerPreview}
                />
              )}
            </div>
          </div>

          <DragOverlay dropAnimation={prefersReducedMotion() ? null : { duration: 160, easing: EASE_OUT_CSS }}>
            {reorder.draggedWs
              ? (
                  // dnd-kit sizes this wrapper in screen pixels while the cells
                  // it copies are laid out in canvas pixels: the ghost is drawn
                  // at the scaled size, so the two never disagree under a view
                  // zoom.
                  <div
                    className="relative cursor-grabbing overflow-hidden bg-panel-2 shadow-[0_18px_48px_rgba(0,0,0,0.55)]"
                    style={{ width: cell * viewZoom.scale, height: box.h * viewZoom.scale }}
                  >
                    <CellBody ws={reorder.draggedWs} box={{ w: box.w * viewZoom.scale, h: box.h * viewZoom.scale }} photoById={photoById} transparent={transparent} dimmed={false} />
                  </div>
                )
              : null}
          </DragOverlay>
        </DndContext>

        {/* The dot capsule (the iOS home-screen page indicator): one dot per
            group, the pill on the group the row rests on, and a swipe leans
            the pill to the group a release would land on. One button into
            the groups page; its row is reserved in the board's layout. */}
        <div
          data-dot-capsule=""
          className="pointer-events-none absolute inset-x-0 flex justify-center"
          style={{ bottom: dockReserve, height: CAPSULE_H }}
        >
          <button
            type="button"
            data-groups-capsule=""
            aria-label={t('Groups')}
            onClick={openGroups}
            className="pointer-events-auto flex h-full cursor-pointer items-center justify-center gap-[9px] rounded-full px-3 outline-0 transition-[scale] duration-(--dur-fast) active:scale-[0.97] focus-visible:outline-1 focus-visible:outline-accent"
          >
            {grids.map((g, i) => (
              <span
                key={g.id}
                aria-hidden
                className={`h-[6px] rounded-full transition-[width] duration-(--dur-surface) ease-(--ease-out) ${
                  i === gestures.targetIndex ? 'w-[22px] bg-float-icon' : 'w-[6px] bg-float-icon/50'
                }`}
              />
            ))}
          </button>
        </div>
      </div>

      {/* Off fit, a small chip says how far and puts it back. */}
      <ViewZoomChip scale={viewZoom.scale} onFit={viewZoom.fit} className="absolute left-2.5 top-2.5 z-20" />

      {/* Grid-route tools: Grid gap. */}
      <ToolsDock hidden={false} contextKey="grid">
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

function SortableCell({ ws, cell, box, photoById, transparent, highlighted, viewScale, onEnter }: {
  ws: { id: string, root: Node, canvasRatio: number | null }
  cell: number
  box: { w: number, h: number }
  photoById: Map<string, Photo>
  transparent: boolean
  highlighted: boolean
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
      <CellBody ws={ws} box={box} photoById={photoById} transparent={transparent} dimmed={isDragging} />
    </button>
  )
}

/**
 * A neighbouring group's board on the pager: the same 3×3 the overview draws
 * (the grid's own cell previews at the same cell size and gap, empty cells
 * with their hints too, so landing swaps nothing), laid out at canvas size
 * over the live board's measured box and offset one page of travel either
 * side, scaled by the view zoom so the two boards slide past each other as
 * one plane. Inert: the stage owns the gesture, and only its opacity and
 * scale move (the falloff).
 */
function PagerBoard({ side, board, base, cell, box, gap, boardW, travel, viewScale, photoById, transparent, onRef }: {
  side: 'prev' | 'next'
  board: readonly Workspace[]
  /** The live board's measured top-left corner in the stage. */
  base: { x: number, y: number }
  cell: number
  box: { w: number, h: number }
  gap: number
  boardW: number
  travel: number
  viewScale: number
  photoById: Map<string, Photo>
  transparent: boolean
  onRef: (side: 'prev' | 'next', el: HTMLElement | null) => void
}) {
  return (
    <div
      data-pager-board={side}
      className="pointer-events-none absolute origin-top-left"
      style={{
        left: base.x,
        top: base.y,
        width: boardW,
        // The translate is outermost, so it counts in screen pixels while the
        // scale keeps the board at the live board's on-screen size.
        transform: `translateX(${side === 'prev' ? -travel : travel}px) scale(${viewScale})`,
      }}
    >
      {/* The falloff lands on the grid inside, so its shrink keeps the default
          centre origin and the board converges on the live board's box. */}
      <div
        ref={el => onRef(side, el)}
        className="grid grid-cols-3"
        style={{ gap, width: boardW }}
      >
        {board.map(ws => (
          <div key={ws.id} className="relative overflow-hidden bg-panel-2" style={{ width: cell, height: box.h }}>
            <CellBody ws={ws} box={box} photoById={photoById} transparent={transparent} dimmed={false} />
          </div>
        ))}
        {board.length < MAX_WORKSPACES && (
          <span className="relative grid place-items-center text-dim" style={{ width: cell, height: box.h }}>
            <AddSlotFrame cell={cell} cellH={box.h} />
          </span>
        )}
      </div>
    </div>
  )
}
