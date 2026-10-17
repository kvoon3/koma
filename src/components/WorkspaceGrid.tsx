import type { CollisionDetection, DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import type { Photo } from '../lib/imageStore'
import type { Leaf, Node, PaneLabel, Rect, SeamSides, Sticker } from '../lib/panes'
import { closestCenter, DndContext, DragOverlay, MeasuringStrategy, MouseSensor, pointerWithin, TouchSensor, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import { rectSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useNavigate } from '@tanstack/react-router'
import { Camera, LayoutDashboard, LayoutGrid, LoaderCircle, Plus, X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useElementSize, useMediaQuery, usePreview } from '../hooks'
import { useAppCommands } from '../lib/appCommands'
import { GRID_CELL_MAX } from '../lib/exporter'
import { fontById } from '../lib/fonts'
import { cellRatioValue, gridCellBox } from '../lib/gridTools'
import { useT } from '../lib/i18n'
import { LABEL_ICON_GAP_EM, labelIconNode } from '../lib/labelIcons'
import { blendFadePx, boardStickerRect, cornerRadiiCss, expandRectForBlend, labelPaint, layoutTree, leafCornerRadii, leafList, placement, rotationCss, seamFadeWidth, seamMaskStyle, seamSides } from '../lib/panes'
import { prefersReducedMotion, viewTransitionOption } from '../lib/viewTransition'
import { gridStep, MAX_GRIDS, MAX_WORKSPACES } from '../lib/workspaces'
import { isTransparentBg, useStore } from '../store'
import { LabelIconGlyph } from './BoardLabel'
import { DeleteZone } from './DeleteZone'
import { DockToolset, SeamBackdrop } from './Stage'
import { ToolsDock } from './ToolsDock'
import { Tip } from './ui/tip'

// Virtual canvas short side for preview layout math. Any value works; the
// tree layout is resolution-independent, only the ratio matters.
const PV = 400

/** A board's caption row: its group's name, and the overview's two chips. */
const CAPTION_H = 30

/** Air under a caption row, over its board. */
const CAPTION_GAP = 8

/** Side air the stage keeps around a board (both sides together). */
const STAGE_PAD = 48

/** Air the stage keeps above and below a board. */
const STAGE_PAD_Y = 12

/**
 * The chrome the dock keeps at the bottom of the stage on this route: its 28px
 * handle over the tools row (70px) over the status bar (31–44px, `--statusH`).
 * The dock is an overlay, so every board has to be sized above it: without the
 * reserve the third row of cells ends up under the sheet.
 */
const DOCK_CHROME_H = 144

/** The floating-chip idiom shared with FloatActions (back / reset). */
const snapBtnCls = 'grid h-[30px] w-[30px] cursor-pointer place-items-center rounded-none border border-float-line bg-float-bg text-float-icon backdrop-blur-[7px] transition-[background-color,border-color,color,scale] duration-(--dur-fast) active:scale-[0.97] hover:not-disabled:bg-chip-hover hover:not-disabled:text-txt focus-visible:outline-1 focus-visible:outline-accent disabled:cursor-default disabled:opacity-35 pointer-coarse:h-[38px] pointer-coarse:w-[38px]'

/** Stable keys for the slots a board has not filled (a board holds nine). */
const EMPTY_SLOT_KEYS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'] as const

/** One board sticker in a workspace preview (canvas-normalized, scaled by k). */
function PreviewSticker({ st, board, k, photoById }: {
  st: Sticker
  board: { w: number, h: number }
  k: number
  photoById: Map<string, Photo>
}) {
  const photo = photoById.get(st.photoId)
  const preview = usePreview(photo ?? null)
  if (!photo?.trueW || !photo?.trueH || !preview)
    return null
  const r = boardStickerRect(board, st, photo.trueW / photo.trueH)
  return (
    <img
      src={preview.url}
      alt=""
      draggable={false}
      className="pointer-events-none absolute max-w-none"
      style={{
        left: r.x * k,
        top: r.y * k,
        width: r.w * k,
        height: r.h * k,
        transform: rotationCss(st),
      }}
    />
  )
}

/** Photo placement + draw box for a preview leaf (crossfade expands the cell). */
function previewLeafPlace(leaf: Leaf, layout: Rect, cell: Rect, iw: number, ih: number, crossfade: boolean) {
  if (!iw || !ih)
    return null
  return crossfade
    ? placement(layout, leaf, iw, ih)
    : placement({ x: 0, y: 0, w: cell.w, h: cell.h }, leaf, iw, ih)
}

/** One leaf of a workspace preview: the photo, panned/zoomed like the editor. */
function PreviewLeaf({ leaf, rect, k, unit, fade, seam, crossfade, photoById }: {
  leaf: Leaf
  rect: Rect
  /** Virtual→cell scale factor. */
  k: number
  /** Cell-normalized unit (short side / 1000), for radius scaling. */
  unit: number
  /** Blend feather width in cell px (0 turns the fade off). */
  fade: number
  seam?: SeamSides
  crossfade: boolean
  photoById: Map<string, Photo>
}) {
  const photo = leaf.photoId ? photoById.get(leaf.photoId) : undefined
  const preview = usePreview(photo ?? null)
  const radius = useStore(s => s.radius)
  const layout: Rect = { x: rect.x * k, y: rect.y * k, w: rect.w * k, h: rect.h * k }
  const cell = crossfade && leaf.photoId ? expandRectForBlend(layout, seam, fade) : layout
  const style: React.CSSProperties = {
    left: cell.x,
    top: cell.y,
    width: cell.w,
    height: cell.h,
    borderRadius: cornerRadiiCss(leafCornerRadii(radius * unit, seam, 0)),
  }
  const place = previewLeafPlace(leaf, layout, cell, preview?.w ?? 0, preview?.h ?? 0, crossfade)
  const mask = leaf.photoId ? seamMaskStyle(seam, seamFadeWidth(fade, crossfade ? layout : cell)) : undefined
  const imgTx = place
    ? (crossfade
        ? `translate(${place.x - cell.x}px, ${place.y - cell.y}px) scale(${place.scale})`
        : `translate(${place.x}px, ${place.y}px) scale(${place.scale})`)
    : ''
  return (
    <div className={`absolute overflow-hidden ${leaf.photoId ? '' : ' bg-pane-bg bg-pane-empty'}`} style={style}>
      {preview && place
        ? (
            <div
              className="absolute inset-0"
              style={{
                ...mask,
                mixBlendMode: crossfade && mask ? 'plus-lighter' : undefined,
              }}
            >
              <img
                src={preview.url}
                alt=""
                draggable={false}
                className="block max-w-none"
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  transformOrigin: '0 0',
                  transform: imgTx,
                }}
              />
            </div>
          )
        : null}
    </div>
  )
}

/** Read-only live preview of a workspace's full collage in a square cell. */
function CellPreview({ root, canvasRatio, box, photoById, stickers = [], labels = [] }: {
  root: Node
  canvasRatio: number | null
  box: { w: number, h: number }
  photoById: Map<string, Photo>
  stickers?: Sticker[]
  labels?: PaneLabel[]
}) {
  const bg = useStore(s => s.bg)
  const edgeFade = useStore(s => s.edgeFade)
  const fadeStrength = useStore(s => s.edgeFadeStrength)
  const blendCrossfade = useStore(s => s.blendCrossfade)
  const VW = PV
  const VH = Math.round(PV / (canvasRatio ?? 1.5))
  const view = useMemo(() => layoutTree(root, VW, VH, 0), [root, VW, VH])
  // Cover-fit: scale the workspace's own aspect up so it fills the whole
  // square cell, centered; the overflow is cropped away (Moments style).
  const k = Math.max(box.w / VW, box.h / VH)
  // Center the oversized preview box: negative offsets + half overflow.
  const pw = VW * k
  const ph = VH * k
  // Font/radius unit follows the canvas short edge, like the editor.
  const unit = (Math.min(VW, VH) / 1000) * k
  const fade = blendCrossfade
    ? blendFadePx(edgeFade * unit, fadeStrength, 0)
    : edgeFade * unit
  const seams = useMemo(() => seamSides(view.leaves, 0), [view])
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className={`absolute top-1/2 left-1/2 ${isTransparentBg(bg) ? ' stage-clear' : ''}`}
        style={{
          width: pw,
          height: ph,
          transform: 'translate(-50%, -50%)',
          background: isTransparentBg(bg) ? undefined : bg,
        }}
      >
        {fade > 0 && !blendCrossfade && (
          <SeamBackdrop
            leaves={view.leaves.map(({ node, rect }) => ({
              node,
              rect: { x: rect.x * k, y: rect.y * k, w: rect.w * k, h: rect.h * k },
            }))}
            photoById={photoById}
            radius={Math.max(unit * 40, fade)}
            opacity={fadeStrength / 100}
          />
        )}
        {view.leaves.map(({ node, rect }) => (
          <PreviewLeaf
            key={node.id}
            leaf={node}
            rect={rect}
            k={k}
            unit={unit}
            fade={fade}
            seam={seams.get(node.id)}
            crossfade={blendCrossfade}
            photoById={photoById}
          />
        ))}
        {stickers.map(st => (
          <PreviewSticker
            key={st.id}
            st={st}
            board={{ w: VW, h: VH }}
            k={k}
            photoById={photoById}
          />
        ))}
        {labels.filter(lab => lab.text.trim()).map(lab => (
          <span
            key={lab.id}
            className="absolute whitespace-pre leading-[normal]"
            style={{
              left: `${lab.x * 100}%`,
              top: `${lab.y * 100}%`,
              transform: `translate(-50%, -50%) ${rotationCss(lab)}`,
              fontSize: lab.size * unit,
              fontFamily: fontById(lab.font).cssStack,
              background: labelPaint(lab).fill,
              color: labelPaint(lab).fg,
              padding: '0.22em 0.38em',
              display: 'flex',
              alignItems: 'center',
              gap: `${LABEL_ICON_GAP_EM}em`,
            }}
          >
            {labelIconNode(lab.icon) && <LabelIconGlyph node={labelIconNode(lab.icon)!} />}
            {lab.text}
          </span>
        ))}
      </div>
    </div>
  )
}

/** The cell's visible body, shared by the in-grid cell and the drag overlay. */
function CellBody({ ws, box, photoById, transparent, dimmed }: {
  ws: { root: Node, canvasRatio: number | null, stickers?: Sticker[], labels?: PaneLabel[] }
  box: { w: number, h: number }
  photoById: Map<string, Photo>
  transparent: boolean
  dimmed: boolean
}) {
  const t = useT()
  const filled = leafList(ws.root).some(l => l.photoId)
  return (
    <div className={`absolute inset-0 transition-opacity duration-(--dur-surface) ${dimmed ? ' opacity-25' : ''}`}>
      {filled
        ? (
            <div className={`absolute inset-0 ${transparent ? ' stage-clear' : ''}`}>
              <CellPreview root={ws.root} canvasRatio={ws.canvasRatio} box={box} photoById={photoById} stickers={ws.stickers ?? []} labels={ws.labels ?? []} />
            </div>
          )
        : (
            // The empty pane's hint, worn by the cell: near-canvas fill, and
            // the glyph over the label centered in the neutral gray. No
            // button of its own: the cell is the button.
            <span className="absolute inset-0 grid place-items-center bg-pane-bg bg-pane-empty">
              <span className="flex flex-col items-center gap-1.5 whitespace-nowrap text-[12.5px] font-semibold text-dim">
                <MorphIcon icon={LayoutDashboard} size={22} strokeWidth={1.75} />
                {t('New collage')}
              </span>
            </span>
          )}
    </div>
  )
}

type NavDir = 'left' | 'right' | 'up' | 'down'

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

/** Air between the cards in the switcher strip (Mission Control's window gap). */
const STRIP_GAP = 60

/** Air between the nine cells inside a card thumbnail. */
const CARD_GAP = 2

/** Switcher strip geometry: air above it, its own height, card + label sizes. */
function switcherMetrics(stageH: number) {
  const stripH = Math.max(96, Math.round(stageH * 0.125))
  const stripTop = Math.max(8, Math.round(stageH * 0.09))
  // The cards sit on the strip's fill: pad y, then thumbnail, then the name.
  const cardH = Math.max(36, stripH - 12 - 2 - 16)
  const cardW = Math.max(56, Math.round(cardH * 1.6))
  return { stripH, stripTop, cardH, cardW }
}

/** vim keys and arrows → a grid navigation direction, null for anything else. */
function dirForKey(k: string): NavDir | null {
  if (k === 'h' || k === 'H' || k === 'ArrowLeft')
    return 'left'
  if (k === 'l' || k === 'L' || k === 'ArrowRight')
    return 'right'
  if (k === 'k' || k === 'K' || k === 'ArrowUp')
    return 'up'
  if (k === 'j' || k === 'J' || k === 'ArrowDown')
    return 'down'
  return null
}

const DELETE_ZONE_ID = '__delete__'

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
 * Boards come in groups (`lib/workspaces`): the Workspace chip opens the
 * Mission Control-style switcher over the receding board: a frosted strip of
 * one card per group, where + copies the open board into a new group, ×
 * deletes one, and a click zooms back into the picked workspace.
 */
export function WorkspaceGrid() {
  const workspaces = useStore(s => s.workspaces)
  const activeId = useStore(s => s.activeId)
  const photos = useStore(s => s.photos)
  const bg = useStore(s => s.bg)
  const gridGap = useStore(s => s.gridGap)
  const moveWorkspace = useStore(s => s.moveWorkspace)
  const navigate = useNavigate()
  const t = useT()
  const { exportGridCells, busy } = useAppCommands()
  /** Local to the camera chip: the app-wide `busy` also spins during an export. */
  const [snapBusy, setSnapBusy] = useState(false)
  /**
   * The switcher is this view's mode, not the board's, so it lives here: an
   * overlay above the receding board, not a route (the hash URL keeps meaning
   * the overview).
   */
  const [switcher, setSwitcher] = useState(false)
  /**
   * The receding board carries a view-transition name from before the open
   * transition's first snapshot until the close one has painted: the name must
   * sit on the element in BOTH snapshots for the group to morph between the
   * full and the receded board (the app-shrinking feel).
   */
  const [boardNamed, setBoardNamed] = useState(false)

  /**
   * Open the switcher over the board, or leave it, zooming back into
   * `gridId`'s workspace first when given (switching groups is navigation, no
   * undo step). The flip runs inside a view transition so the board scales
   * down / back up instead of cutting; reduced motion or a missing API keeps
   * the synchronous change.
   */
  const morphSwitcher = useCallback((open: boolean, gridId?: string) => {
    const apply = () => {
      if (!open && gridId && gridId !== useStore.getState().activeGridId)
        useStore.getState().switchGrid(gridId)
      setSwitcher(open)
    }
    if (!document.startViewTransition || prefersReducedMotion()) {
      apply()
      setBoardNamed(false)
      return
    }
    if (open) {
      // eslint-disable-next-line react/dom-no-flush-sync -- the name must be on the element before the old snapshot is captured
      flushSync(() => setBoardNamed(true))
    }
    const vt = document.startViewTransition(() => {
      // eslint-disable-next-line react/dom-no-flush-sync -- DOM must match the store before the new snapshot is captured
      flushSync(apply)
    })
    void vt.finished.finally(() => {
      if (!open)
        setBoardNamed(false)
    }).catch(() => {})
  }, [])

  // Enter a workspace: set activeId before navigating so the stage renders the
  // right workspace inside the same view-transition commit (the route wrapper
  // re-syncs it for direct URLs), then morph the cell into the canvas.
  const enter = useCallback((id: string) => {
    useStore.getState().patch({ activeId: id })
    useStore.getState().clearSelection()
    void navigate({ to: '/w/$wsId', params: { wsId: id }, viewTransition: viewTransitionOption() })
  }, [navigate])

  const grids = useStore(s => s.grids)
  const activeGridId = useStore(s => s.activeGridId)

  const photoById = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos])
  const transparent = isTransparentBg(bg)
  // Anything to snapshot? Empty cells render blank, so an all-empty board is
  // not worth a render (the chip is disabled instead).
  const anyFilled = useMemo(() => workspaces.some(w => leafList(w.root).some(l => l.photoId)), [workspaces])

  // ---- Keyboard highlight (grid navigation) --------------------------------
  const [hl, setHl] = useState(() => {
    const i = workspaces.findIndex(w => w.id === activeId)
    return i === -1 ? 0 : i
  })
  const hlRef = useRef(hl)
  useEffect(
    () => { hlRef.current = hl },
    [hl],
  )

  useEffect(() => {
    // The switcher owns the keyboard while it is open (Esc leaves it; its own
    // effect below listens): no highlight to walk behind a frosted strip.
    if (switcher)
      return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
        return
      const k = e.key
      // A dialog (settings drawer, library, help) owns Tab, the arrows and
      // Enter while it is open, so its own controls stay reachable.
      if (t.closest('[role="dialog"]'))
        return
      const dirKey = dirForKey(k)
      if (dirKey) {
        e.preventDefault()
        setHl(gridStep(hlRef.current, dirKey, useStore.getState().workspaces.length))
        return
      }
      if (k === 'Tab') {
        e.preventDefault()
        setHl(gridStep(hlRef.current, 'next', useStore.getState().workspaces.length))
        return
      }
      if (k === 'Enter') {
        e.preventDefault()
        const ws = useStore.getState().workspaces[hlRef.current]
        if (ws)
          enter(ws.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enter, switcher])

  // Esc leaves the switcher (the other exits are a card click and the
  // backdrop); a rename field keeps its own Esc for itself.
  useEffect(() => {
    if (!switcher)
      return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape')
        return
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
        return
      e.preventDefault()
      morphSwitcher(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [switcher, morphSwitcher])

  // ---- Drag-to-reorder (dnd-kit, insert-shift) -----------------------------
  // PointerSensor with a distance threshold keeps plain clicks for entering
  // a workspace; once a drag activates, the dragged cell rides a DragOverlay
  // that tracks the pointer 1:1 while the remaining cells translate to make
  // room (rectSortingStrategy), and the drop commits via moveWorkspace.
  const [dragId, setDragId] = useState<string | null>(null)
  // Mouse drags after 5px; touch is a long press, like the stage carry. The
  // TouchSensor adds the non-passive touchmove iOS Safari needs, so the
  // browser can't claim the touch (pointercancel) before the drag arms.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  )
  // Suppress the click that follows a finished drag; it must not enter.
  const dragEndedAtRef = useRef(0)

  const ids = useMemo(() => workspaces.map(w => w.id), [workspaces])
  const draggedWs = dragId ? workspaces.find(w => w.id === dragId) : null

  const onDragStart = (e: DragStartEvent) => setDragId(String(e.active.id))

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragId(null)
    dragEndedAtRef.current = Date.now()
    if (over?.id === DELETE_ZONE_ID) {
      navigator.vibrate?.(10)
      useStore.getState().removeWorkspace(String(active.id))
      return
    }
    if (!over || active.id === over.id)
      return
    const arr = useStore.getState().workspaces
    const from = arr.findIndex(w => w.id === active.id)
    const to = arr.findIndex(w => w.id === over.id)
    if (from !== -1 && to !== -1)
      moveWorkspace(arr[from].id, to)
  }

  const [wrapRef, wrapSize] = useElementSize<HTMLDivElement>()
  const gridCellRatio = useStore(s => s.gridCellRatio)
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
  const openGroup = grids.find(g => g.id === activeGridId)
  const { stripTop, stripH, cardW, cardH } = switcherMetrics(wrapSize.h)

  return (
    <div
      ref={wrapRef}
      className="stage-checker absolute inset-0 flex touch-none flex-col overflow-hidden"
    >
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center"
        style={{ paddingTop: STAGE_PAD_Y, paddingBottom: STAGE_PAD_Y + dockReserve }}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={deleteFirst}
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => {
            setDragId(null)
            dragEndedAtRef.current = Date.now()
          }}
        >
          <GridDeleteZone active={!!dragId} label={t('Drop here to delete')} />
          <SortableContext items={ids} strategy={rectSortingStrategy}>
            {/* The board's caption row (its group's name, the workspace
                and snapshot chips) and the grid below it, one column of the
                board's width. While the switcher is open the whole column
                recedes (scaled down, dimmed, blurred, inert) behind the
                frosted strip, morphing there as the ws-board group. */}
            <div
              className="flex flex-col items-center"
              style={{
                width: boardW,
                gap: CAPTION_GAP,
                viewTransitionName: boardNamed ? 'ws-board' : undefined,
                transform: switcher ? 'scale(0.65)' : undefined,
                opacity: switcher ? 0.45 : 1,
                filter: switcher ? 'blur(3px)' : undefined,
                pointerEvents: switcher ? 'none' : undefined,
              }}
            >
              <div
                data-board-caption=""
                className="flex items-center justify-between gap-2"
                style={{ width: boardW, height: CAPTION_H }}
              >
                <span data-board-name="" className="min-w-0 truncate text-[15px] font-semibold text-txt">
                  {openGroup?.name}
                </span>
                <div className="flex flex-none items-center gap-1.5">
                  <Tip
                    label={t('Workspace')}
                    trigger={(
                      <button
                        className={snapBtnCls}
                        aria-label={t('Workspace')}
                        onClick={() => morphSwitcher(true)}
                      >
                        <MorphIcon icon={LayoutGrid} size={15} strokeWidth={1.75} />
                      </button>
                    )}
                  />
                  <Tip
                    label={t('Snapshot: each cell plus the whole grid')}
                    trigger={(
                      <button
                        className={snapBtnCls}
                        aria-label={t('Snapshot: each cell plus the whole grid')}
                        disabled={!anyFilled || busy || snapBusy}
                        onClick={() => {
                          setSnapBusy(true)
                          void exportGridCells().finally(() => setSnapBusy(false))
                        }}
                      >
                        <MorphIcon
                          icon={snapBusy ? LoaderCircle : Camera}
                          size={15}
                          strokeWidth={1.75}
                          className={snapBusy ? 'animate-spin [animation-duration:900ms]' : undefined}
                        />
                      </button>
                    )}
                  />
                </div>
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
                    onEnter={(id) => {
                      if (Date.now() - dragEndedAtRef.current > 120)
                        enter(id)
                    }}
                  />
                ))}
                {workspaces.length < MAX_WORKSPACES && <AddCell cell={cell} cellH={box.h} />}
              </div>
            </div>
          </SortableContext>

          <DragOverlay dropAnimation={prefersReducedMotion() ? null : { duration: 160, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }}>
            {draggedWs
              ? (
                  <div
                    className="relative cursor-grabbing overflow-hidden bg-panel-2 shadow-[0_18px_48px_rgba(0,0,0,0.55)]"
                    style={{ width: cell, height: box.h }}
                  >
                    <CellBody ws={draggedWs} box={box} photoById={photoById} transparent={transparent} dimmed={false} />
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
          photoById={photoById}
          transparent={transparent}
          onPick={id => morphSwitcher(false, id ?? undefined)}
        />
      )}

      {/* Grid-route-only tools: Grid gap. Same 3-snap sheet as the collage stage;
          put away while the switcher holds the stage. */}
      <ToolsDock hidden={switcher} contextKey="grid">
        <DockToolset route="grid" />
      </ToolsDock>
    </div>
  )
}

/**
 * The workspace switcher, Mission Control style. A frosted, full-width strip
 * near the top of the stage holds one card per group: a 16:10 thumbnail of
 * its board (every cell the grid's own preview) with the group's name under
 * it; the open group's card wears the selection ring and stands slightly
 * larger. The bare + at the strip's right edge copies the open board into a
 * new group; the × on a card's corner deletes it (never the last one; both
 * ride the undo stack, no confirm). The strip scrolls sideways: a touch swipe
 * that settles on a neighbouring card switches the open group (the ring
 * follows), clicking a card zooms back into it, and the backdrop or Esc
 * returns to the overview as it was. Enter/exit morph via the ws-board view
 * transition; this component is only what sits above the receding board.
 */
function WorkspaceSwitcher({ stripTop, stripH, cardW, cardH, photoById, transparent, onPick }: {
  /** The strip's box within the stage, from `switcherMetrics`. */
  stripTop: number
  stripH: number
  cardW: number
  cardH: number
  photoById: Map<string, Photo>
  transparent: boolean
  /** null = leave without switching; a group id = zoom back into that board. */
  onPick: (gridId: string | null) => void
}) {
  const t = useT()
  const grids = useStore(s => s.grids)
  const activeGridId = useStore(s => s.activeGridId)
  const parked = useStore(s => s.parkedBoards)
  const workspaces = useStore(s => s.workspaces)
  // Scroll-to-switch is a touch gesture (the brief's mobile behavior); a
  // trackpad or wheel keeps scroll as scroll and clicks pick instead.
  const coarse = useMediaQuery('(pointer: coarse)')
  const [stripBoxRef, stripSize] = useElementSize<HTMLDivElement>()
  const cardRef = useRef(new Map<string, HTMLDivElement>())
  /** True while the strip scrolls itself (alignment on open/switch). */
  const autoScrollRef = useRef(false)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const alignResetRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const boardOfGroup = (id: string) => (id === activeGridId ? workspaces : parked[id]?.workspaces ?? [])

  // Keep the open group's card centred in the strip: on open, and whenever a
  // + / × / undo moves which card the ring sits on.
  useLayoutEffect(() => {
    const strip = stripBoxRef.current
    const card = cardRef.current.get(activeGridId)
    if (!strip || !card)
      return
    autoScrollRef.current = true
    strip.scrollLeft = card.offsetLeft + card.offsetWidth / 2 - strip.clientWidth / 2
    clearTimeout(alignResetRef.current)
    alignResetRef.current = setTimeout(() => {
      autoScrollRef.current = false
    }, 200)
  }, [activeGridId, cardW, grids.length, stripBoxRef])

  // A swipe that settles past the halfway point to a neighbouring card: with
  // scroll-snap the settle lands ON a card, so the card nearest the strip's
  // centre after the settle is the pick, and switching is plain navigation.
  const onStripScroll = () => {
    clearTimeout(settleTimerRef.current)
    settleTimerRef.current = setTimeout(() => {
      const strip = stripBoxRef.current
      if (!coarse || autoScrollRef.current || !strip)
        return
      const center = strip.scrollLeft + strip.clientWidth / 2
      let best: string | null = null
      let bestD = Number.POSITIVE_INFINITY
      for (const [id, node] of cardRef.current) {
        const d = Math.abs(node.offsetLeft + node.offsetWidth / 2 - center)
        if (d < bestD) {
          bestD = d
          best = id
        }
      }
      if (best && best !== useStore.getState().activeGridId)
        useStore.getState().switchGrid(best)
    }, 150)
  }

  const submitRename = (id: string) => {
    useStore.getState().renameGrid(id, draft)
    setRenaming(null)
  }

  // Every card's inner 3×3 at card size (hairline border takes 1px a side).
  const cellW = (cardW - 2 - 2 * CARD_GAP) / 3
  const cellH = (cardH - 2 - 2 * CARD_GAP) / 3
  // Air either side of the card row lets the first and last card centre under
  // scroll-snap; the same value is the strip's scroll padding. The port is the
  // strip less the edge padding (8px a side) and the 40px add glyph.
  const scrollPort = Math.max(0, stripSize.w - 16 - 40)
  const inset = Math.max(12, Math.round((scrollPort - cardW) / 2))

  return (
    <div data-switcher="" className="absolute inset-0 z-20">
      {/* The dim between the strip and the receding board; clicking it is the
          way back to the overview as it was. */}
      <div className="absolute inset-0 bg-overlay-dim" onClick={() => onPick(null)} />

      <div
        data-switcher-strip=""
        className="absolute inset-x-0 flex items-stretch gap-1 overflow-hidden border-y border-line bg-panel-2/75 px-2 shadow-pop backdrop-blur-xl backdrop-saturate-150"
        style={{ top: stripTop, height: stripH, viewTransitionName: 'ws-strip' }}
      >
        <div
          ref={stripBoxRef}
          data-switcher-cards=""
          className="flex min-w-0 snap-x snap-mandatory flex-1 touch-pan-x items-center overscroll-x-contain overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ gap: STRIP_GAP, paddingInline: inset, scrollPaddingInline: inset }}
          onScroll={onStripScroll}
        >
          {grids.map((g) => {
            const active = g.id === activeGridId
            const board = boardOfGroup(g.id)
            return (
              <div
                key={g.id}
                ref={(node) => {
                  if (node)
                    cardRef.current.set(g.id, node)
                  else
                    cardRef.current.delete(g.id)
                }}
                data-switcher-card=""
                data-card-active={active || undefined}
                className="group/card relative flex shrink-0 snap-center flex-col items-center gap-0.5"
                style={{ width: cardW }}
              >
                <button
                  data-card-face=""
                  className={`relative block cursor-pointer overflow-hidden border bg-pane-bg shadow-pop outline-0 transition-[scale,outline-color] duration-(--dur-fast) focus-visible:outline-2 focus-visible:outline-sel ${
                    active
                      ? ' border-line-strong scale-[1.08] outline-2 outline-offset-1 outline-sel'
                      : ' border-line outline-2 outline-offset-1 outline-transparent hover:not-focus-visible:outline-line-strong'
                  }`}
                  style={{ width: cardW, height: cardH }}
                  onClick={() => onPick(g.id)}
                  title={g.name}
                >
                  <span aria-hidden className="grid h-full w-full grid-cols-3" style={{ gap: CARD_GAP }}>
                    {board.map(ws => (
                      <CardCell
                        key={ws.id}
                        ws={ws}
                        box={{ w: cellW, h: cellH }}
                        photoById={photoById}
                        transparent={transparent}
                      />
                    ))}
                    {/* A board is always nine slots: the ones past its last
                        cell stay drawn as quiet squares, so the thumbnail
                        reads as the 3×3 it is. */}
                    {EMPTY_SLOT_KEYS.slice(0, MAX_WORKSPACES - board.length).map(key => (
                      <span key={key} aria-hidden className="border border-line bg-pane-empty" />
                    ))}
                  </span>
                </button>
                {grids.length > 1 && (
                  <button
                    data-card-delete=""
                    className="pointer-coarse:opacity-100 absolute -top-1.5 -left-1.5 z-10 grid h-5 w-5 cursor-pointer place-items-center rounded-full border border-float-line bg-float-bg text-float-icon opacity-0 shadow-pop transition-[opacity,background-color,color,scale] duration-(--dur-fast) group-hover/card:opacity-100 hover:text-danger focus-visible:opacity-100 focus-visible:outline-1 focus-visible:outline-accent active:scale-[0.97]"
                    aria-label={t('Delete group?')}
                    title={t('Delete group?')}
                    onClick={() => useStore.getState().removeGrid(g.id)}
                  >
                    <MorphIcon icon={X} size={11} strokeWidth={2} />
                  </button>
                )}
                {renaming === g.id
                  ? (
                      <input
                        autoFocus
                        value={draft}
                        aria-label={t('Rename')}
                        className="w-full cursor-text border border-line-strong bg-panel-2 px-1 text-center text-[11px] font-semibold text-txt outline-0 focus-visible:outline-1 focus-visible:outline-accent"
                        style={{ height: 16 }}
                        onChange={e => setDraft(e.target.value)}
                        onBlur={() => submitRename(g.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            submitRename(g.id)
                          }
                          else if (e.key === 'Escape') {
                            e.preventDefault()
                            setRenaming(null)
                          }
                        }}
                      />
                    )
                  : (
                      <span
                        data-card-name=""
                        className="max-w-full cursor-default truncate px-1 text-xs font-medium text-txt"
                        style={{ height: 16, lineHeight: '16px' }}
                        title={t('Rename')}
                        onDoubleClick={() => {
                          setDraft(g.name)
                          setRenaming(g.id)
                        }}
                      >
                        {g.name}
                      </span>
                    )}
              </div>
            )
          })}
        </div>

        {/* The bare + at the strip's right edge: a new group that copies the
            open board (photos shared, ids fresh) and opens it. Undoable. */}
        <button
          data-switcher-add=""
          className="grid w-10 shrink-0 cursor-pointer place-items-center text-dim outline-0 transition-[color,scale] duration-(--dur-fast) hover:text-txt focus-visible:outline-1 focus-visible:outline-accent active:scale-[0.97] disabled:cursor-default disabled:opacity-35"
          disabled={grids.length >= MAX_GRIDS}
          aria-label={t('Add a group')}
          title={t('Add a group')}
          onClick={() => useStore.getState().addGrid()}
        >
          <MorphIcon icon={Plus} size={22} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}

/** One cell of a card's 3×3 thumbnail: the grid's own preview at card size; an empty slot stays a quiet square (no glyph, no hint). */
function CardCell({ ws, box, photoById, transparent }: {
  ws: { root: Node, canvasRatio: number | null, stickers?: Sticker[], labels?: PaneLabel[] }
  box: { w: number, h: number }
  photoById: Map<string, Photo>
  transparent: boolean
}) {
  const filled = leafList(ws.root).some(l => l.photoId)
  return (
    <span data-card-cell="" className={`relative block overflow-hidden ${filled ? ' bg-pane-bg' : ' border border-line bg-pane-empty'}`}>
      {filled
        ? (
            <div className={`absolute inset-0 ${transparent ? ' stage-clear' : ''}`}>
              <CellPreview root={ws.root} canvasRatio={ws.canvasRatio} box={box} photoById={photoById} stickers={ws.stickers ?? []} labels={ws.labels ?? []} />
            </div>
          )
        : null}
    </span>
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
      {/* The dashed frame is drawn, not a CSS border: an SVG rect inset by
          half its stroke keeps all four edges inside the box at any offset. */}
      <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible text-line-strong">
        <rect x="0.5" y="0.5" width={cell - 1} height={cellH - 1} fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="4 3" shapeRendering="crispEdges" />
      </svg>
      <MorphIcon icon={Plus} size={26} strokeWidth={1.75} />
    </button>
  )
}

function SortableCell({ ws, cell, box, photoById, transparent, highlighted, onEnter }: {
  ws: { id: string, root: Node, canvasRatio: number | null }
  cell: number
  box: { w: number, h: number }
  photoById: Map<string, Photo>
  transparent: boolean
  highlighted: boolean
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
      <CellBody ws={ws} box={box} photoById={photoById} transparent={transparent} dimmed={isDragging} />
    </button>
  )
}
