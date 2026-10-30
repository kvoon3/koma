import type { CollisionDetection } from '@dnd-kit/core'
import type { CardKind } from '../lib/cards'
import type { Photo } from '../lib/imageStore'
import type { Node } from '../lib/panes'
import { Menu } from '@base-ui/react/menu'
import { closestCenter, DndContext, DragOverlay, MeasuringStrategy, pointerWithin, useDroppable } from '@dnd-kit/core'
import { rectSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useNavigate } from '@tanstack/react-router'
import { Camera, Image, LayoutGrid, Square, Type } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useDockRestBand, useElementSize, useMediaQuery, useStageZoom } from '../hooks'
import { useAppCommands } from '../lib/appCommands'
import { viewTransform } from '../lib/canvasView'
import { dockBand } from '../lib/dockMetrics'
import { GRID_CELL_MAX } from '../lib/exporter'
import { cellRatioValue, gridCellBox } from '../lib/gridTools'
import { useT } from '../lib/i18n'
import { EASE_OUT_CSS } from '../lib/motionTokens'
import { leafList } from '../lib/panes'
import { clampDockMode } from '../lib/toolsDockMode'
import { prefersReducedMotion, viewTransitionOption } from '../lib/viewTransition'
import { MAX_WORKSPACES } from '../lib/workspaces'
import { isTransparentBg, useStore } from '../store'
import { DeleteZone } from './DeleteZone'
import { useDockCapacity, useDockMetrics } from './dockContext'
import { CAPTION_GAP, CAPTION_H, STAGE_PAD_Y, stageTopPad } from './grid/boardLayout'
import { AddSlotFrame, CellBody } from './grid/CellPreview'
import { useGridKeyboard } from './grid/useGridKeyboard'
import { DELETE_ZONE_ID, useGridReorder } from './grid/useGridReorder'
import { usePullDown } from './grid/usePullDown'
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
 * The board groups live on the groups page (`/groups`): the Workspace chip or
 * a pull down on the board opens it, and a page card's cell names morph from
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
    h: Math.max(1, wrapSize.h - topPad - STAGE_PAD_Y - dockReserve),
  }
  const { cell, box } = stageCellBox(body, gridGap, cellRatioValue(gridCellRatio))
  const boardW = cell * 3 + gridGap * 2
  // The board column is the canvas here: the view zoom (from the stage margin)
  // scales it about its centre, and the wheel there never touches the cells.
  const columnRef = useRef<HTMLDivElement | null>(null)
  const viewZoom = useStageZoom(wrapRef, columnRef)

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

  // ---- Pull-down (the overview's way into the groups page) -----------------
  const pull = usePullDown({
    enabled: true,
    onOpen: openGroups,
    isSuppressed: () => reorder.dragIdRef.current !== null,
  })

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
          Pulled down it opens the groups page. */}
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
                column of the board's width. The view zoom scales the column. */}
            <div
              ref={columnRef}
              data-canvas-view={viewZoom.scale}
              className="flex flex-col items-center"
              style={{
                width: boardW,
                gap: CAPTION_GAP,
                transform: viewTransform(viewZoom.scale) || undefined,
              }}
            >
              <div className="flex items-center justify-center gap-1.5" style={{ width: boardW, height: CAPTION_H }}>
                <Tip
                  label={t('Workspace')}
                  trigger={(
                    <Button
                      variant="float"
                      icon={LayoutGrid}
                      iconSize={15}
                      aria-label={t('Workspace')}
                      onClick={openGroups}
                    />
                  )}
                />
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
              <div
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
                    viewScale={viewZoom.scale}
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
                    style={{ width: cell * viewZoom.scale, height: box.h * viewZoom.scale }}
                  >
                    <CellBody ws={reorder.draggedWs} box={{ w: box.w * viewZoom.scale, h: box.h * viewZoom.scale }} photoById={photoById} transparent={transparent} dimmed={false} />
                  </div>
                )
              : null}
          </DragOverlay>
        </DndContext>
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
