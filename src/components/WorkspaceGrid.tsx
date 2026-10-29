import type { CollisionDetection } from '@dnd-kit/core'
import type { OverviewMode } from '../lib/overviewMode'
import { closestCenter, DndContext, DragOverlay, MeasuringStrategy, pointerWithin, useDroppable } from '@dnd-kit/core'
import { useNavigate } from '@tanstack/react-router'
import { Camera } from 'lucide'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useDockRestBand, useElementSize, useMediaQuery, useStageZoom } from '../hooks'
import { useAppCommands } from '../lib/appCommands'
import { pagerTravel } from '../lib/boardPager'
import { viewTransform } from '../lib/canvasView'
import { cellRatioValue } from '../lib/gridTools'
import { useT } from '../lib/i18n'
import { EASE_OUT_CSS } from '../lib/motionTokens'
import { leafList } from '../lib/panes'
import { prefersReducedMotion, viewTransitionOption } from '../lib/viewTransition'
import { isTransparentBg, useStore } from '../store'
import { DeleteZone } from './DeleteZone'
import { BoardManager } from './grid/BoardManager'
import { BoardTrack } from './grid/BoardTrack'
import { CellBody } from './grid/CellPreview'
import { boardBody, CAPTION_GAP, CAPTION_H, DOTS_ROW_H, dotsBottom, maxRows, slotH, STAGE_PAD_Y, stageCellBox, stageTopPad } from './grid/overviewLayout'
import { PageDots } from './grid/PageDots'
import { useClickGate } from './grid/useClickGate'
import { useGridKeyboard } from './grid/useGridKeyboard'
import { DELETE_ZONE_ID, useGridReorder } from './grid/useGridReorder'
import { useOverviewGestures } from './grid/useOverviewGestures'
import { DockToolset } from './Stage'
import { ToolsDock } from './ToolsDock'
import { Button } from './ui/button'
import { Tip } from './ui/tip'
import { ViewZoomChip } from './ViewZoomChip'

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
  const { exportGridCells, busy: appBusy } = useAppCommands()
  /** Local to the camera chip: the app-wide `busy` also spins during an export. */
  const [snapBusy, setSnapBusy] = useState(false)

  const photoById = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos])
  const transparent = isTransparentBg(bg)
  // Anything to snapshot? Empty cells render blank, so an all-empty board is
  // not worth a render (the chip is disabled instead).
  const anyFilled = useMemo(() => workspaces.some(w => leafList(w.root).some(l => l.photoId)), [workspaces])

  const [wrapRef, wrapSize] = useElementSize<HTMLDivElement>()
  const columnRef = useRef<HTMLDivElement | null>(null)
  const activeIdx = Math.max(0, grids.findIndex(g => g.id === activeGridId))

  // The dock band is measured from the real sheet; it freezes while the pager
  // owns a gesture (the hook reports busy in the claim's own tick), so the
  // board's cell size is identical before, during and after a swipe.
  const [busy, setBusy] = useState(false)
  const dockBand = useDockRestBand(wrapSize.h, wrapSize.top, busy)
  const topPad = stageTopPad(wrapSize.w, useMediaQuery('(pointer: coarse)'))
  const ratio = cellRatioValue(gridCellRatio)
  const counts = useMemo(
    () => grids.map(g => (g.id === activeGridId ? workspaces.length : parkedBoards[g.id]?.workspaces.length ?? 0)),
    [grids, activeGridId, workspaces, parkedBoards],
  )
  const rows = maxRows(counts)
  const { cell, box } = useMemo(
    () => stageCellBox({ w: wrapSize.w, h: boardBody(wrapSize.h, topPad, dockBand) }, gridGap, ratio),
    [wrapSize.w, wrapSize.h, topPad, dockBand, gridGap, ratio],
  )
  const boardW = cell * 3 + gridGap * 2
  const slot = slotH(rows, box.h, gridGap)
  const travel = pagerTravel(boardW)

  // The stage's view zoom is off while the pager, jiggle or the manager own the
  // stage. The ref form lets the pager's claim (and the mode's commit) flip it
  // in the same tick as the gesture, not one render later.
  const phaseRef = useRef<{ busy: boolean, mode: OverviewMode }>({ busy: false, mode: 'browse' })
  const zoomEnabled = useCallback(() => !phaseRef.current.busy && phaseRef.current.mode === 'browse', [])
  const viewZoom = useStageZoom(wrapRef, columnRef, { enabled: zoomEnabled })
  const viewScale = viewZoom.scale

  const gate = useClickGate()
  const reorderRef = useRef<ReturnType<typeof useGridReorder> | null>(null)
  const isReorderActive = useCallback(() => reorderRef.current?.dragIdRef.current != null, [])

  const enter = useCallback((id: string) => {
    useStore.getState().patch({ activeId: id })
    useStore.getState().clearSelection()
    void navigate({ to: '/w/$wsId', params: { wsId: id }, viewTransition: viewTransitionOption() })
  }, [navigate])
  const onLand = useCallback((gridId: string) => useStore.getState().switchGrid(gridId), [])
  const onBusyChange = useCallback((next: boolean) => {
    phaseRef.current.busy = next
    setBusy(next)
  }, [])

  const overview = useOverviewGestures({
    grids,
    activeIdx,
    boardW,
    viewScale,
    isReorderActive,
    gate,
    onEnter: enter,
    onLand,
    onBusyChange,
  })

  // The dnd-kit reorder is armed everywhere but the manager. It is read after
  // the pager because the pager's refusal callback is what decides the race.
  const reorder = useGridReorder({ workspaces, moveWorkspace, gate, enabled: overview.mode !== 'manage' })
  // The zoom gate and the pager's refusal read refs from event handlers, so
  // they follow the committed render rather than mutating during one.
  useLayoutEffect(() => {
    phaseRef.current.mode = overview.mode
    reorderRef.current = reorder
  })

  const highlighted = useGridKeyboard({ workspaces, activeId, enabled: overview.mode === 'browse', enter: overview.enterCell })

  // One array of page boards, stable across a dots-only render, so the track's
  // memo actually keeps the pages out of the dots' update path.
  const pages = useMemo(
    () => grids.map(g => ({ id: g.id, board: g.id === activeGridId ? workspaces : parkedBoards[g.id]?.workspaces ?? [] })),
    [grids, activeGridId, workspaces, parkedBoards],
  )
  const deleteCell = useCallback((id: string) => useStore.getState().removeWorkspace(id), [])

  const caption = (mode: OverviewMode) => (
    <div className="flex shrink-0 items-center justify-center gap-1.5" style={{ width: boardW, height: CAPTION_H }}>
      {mode === 'jiggle'
        ? (
            <button
              type="button"
              data-jiggle-done=""
              onClick={overview.leaveJiggle}
              className="h-[30px] cursor-pointer border border-float-line bg-float-bg px-3 text-[11.5px] text-float-icon backdrop-blur-[7px] transition-[background-color,color,scale] duration-(--dur-fast) hover:bg-chip-hover hover:text-txt focus-visible:outline-1 focus-visible:outline-accent active:scale-[0.97] pointer-coarse:h-[38px]"
            >
              {t('Done')}
            </button>
          )
        : (
            <Tip
              label={t('Snapshot: each cell plus the whole grid')}
              trigger={(
                <Button
                  variant="float"
                  icon={Camera}
                  iconSize={15}
                  loading={snapBusy}
                  disabled={!anyFilled || appBusy || snapBusy}
                  aria-label={t('Snapshot: each cell plus the whole grid')}
                  onClick={() => {
                    setSnapBusy(true)
                    void exportGridCells().finally(() => setSnapBusy(false))
                  }}
                />
              )}
            />
          )}
    </div>
  )

  return (
    <div ref={wrapRef} className="stage-checker absolute inset-0 flex touch-none flex-col overflow-hidden">
      {/* The stage's board area: the top air the caption clears, the dock band
          and the dots row at the floor. The pager's handlers live here, so a
          press on the air or a cell is arbitrated in one place. */}
      <div
        data-board-stage=""
        data-paging={overview.dragging || undefined}
        className="relative flex min-h-0 flex-1 touch-none items-center justify-center"
        style={{ paddingTop: topPad, paddingBottom: STAGE_PAD_Y + dockBand + DOTS_ROW_H }}
        onDoubleClick={viewZoom.onStageDoubleClick}
        {...overview.handlers}
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
          {/* The board column is the canvas here: the view zoom scales it about
              its centre, and the track's pan is divided by the frozen scale. */}
          <div
            ref={columnRef}
            data-canvas-view={viewScale}
            className="flex flex-col items-center"
            style={{ width: boardW, gap: CAPTION_GAP, transform: viewTransform(viewScale) }}
          >
            {caption(overview.mode)}
            <BoardTrack
              pages={pages}
              activeIdx={activeIdx}
              travel={travel}
              boardW={boardW}
              slotH={slot}
              cell={cell}
              box={box}
              gap={gridGap}
              mode={overview.mode}
              trackRef={overview.trackRef}
              sortableIds={reorder.ids}
              highlighted={highlighted}
              viewScale={viewScale}
              photoById={photoById}
              transparent={transparent}
              onEnter={overview.enterCell}
              onDelete={deleteCell}
            />
          </div>
          <DragOverlay dropAnimation={prefersReducedMotion() ? null : { duration: 160, easing: EASE_OUT_CSS }}>
            {reorder.draggedWs
              ? (
                  // dnd-kit sizes this wrapper in screen pixels while the cells
                  // it copies are laid out in canvas pixels: the ghost is drawn
                  // at the scaled size, so the two never disagree under a view
                  // zoom.
                  <div
                    data-drag-overlay=""
                    className="relative cursor-grabbing overflow-hidden bg-panel-2 shadow-[0_18px_48px_rgba(0,0,0,0.55)]"
                    style={{ width: cell * viewScale, height: box.h * viewScale }}
                  >
                    <CellBody ws={reorder.draggedWs} box={{ w: box.w * viewScale, h: box.h * viewScale }} photoById={photoById} transparent={transparent} dimmed={false} />
                  </div>
                )
              : null}
          </DragOverlay>
        </DndContext>

        <PageDots
          count={grids.length}
          index={Math.min(overview.shownIdx, Math.max(0, grids.length - 1))}
          bottom={dotsBottom(dockBand)}
          onOpen={overview.openManager}
        />
      </div>

      {overview.mode === 'browse' && (
        <ViewZoomChip scale={viewScale} onFit={viewZoom.fit} className="absolute left-2.5 top-2.5 z-20" />
      )}

      <BoardManager open={overview.mode === 'manage'} onClose={overview.closeManager} />

      {/* Grid-route-only tools: Grid gap. The sheet and footer slide away while
          a page swipe is in flight (the busy flag), then return. */}
      <ToolsDock hidden={false} collapsed={busy} contextKey="grid">
        <DockToolset route="grid" />
      </ToolsDock>
    </div>
  )
}

function GridDeleteZone({ active, label }: { active: boolean, label: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: DELETE_ZONE_ID })
  return <DeleteZone setRef={setNodeRef} active={active} over={isOver} label={label} />
}
