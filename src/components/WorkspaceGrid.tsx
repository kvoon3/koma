import type { CollisionDetection, DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import type { Photo } from '../lib/imageStore'
import type { Leaf, Node, PaneLabel, Rect, SeamSides, Sticker } from '../lib/panes'
import type { GridGroup } from '../lib/workspaces'
import type { Workspace } from '../store'
import { closestCenter, DndContext, DragOverlay, MeasuringStrategy, MouseSensor, pointerWithin, TouchSensor, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import { rectSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useNavigate } from '@tanstack/react-router'
import { ArrowRightLeft, Camera, ChevronDown, Columns2, LayoutDashboard, LoaderCircle, Plus, X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useElementSize, useMediaQuery, usePreview } from '../hooks'
import { useAppCommands } from '../lib/appCommands'
import { GRID_CELL_MAX } from '../lib/exporter'
import { fontById } from '../lib/fonts'
import { cellRatioValue, gridCellBox } from '../lib/gridTools'
import { useT } from '../lib/i18n'
import { LABEL_ICON_GAP_EM, labelIconNode } from '../lib/labelIcons'
import { blendFadePx, boardStickerRect, cornerRadiiCss, expandRectForBlend, labelPaint, layoutTree, leafCornerRadii, leafList, placement, rotationCss, seamFadeWidth, seamMaskStyle, seamSides } from '../lib/panes'
import { prefersReducedMotion, viewTransitionOption } from '../lib/viewTransition'
import { comparePair, gridStep, MAX_GRIDS, MAX_WORKSPACES } from '../lib/workspaces'
import { boardOf, isTransparentBg, useStore } from '../store'
import { LabelIconGlyph } from './BoardLabel'
import { ConfirmDialog } from './ConfirmDialog'
import { DeleteZone } from './DeleteZone'
import { DockToolset, SeamBackdrop } from './Stage'
import { ToolsDock } from './ToolsDock'
import { Tip } from './ui/tip'

// Virtual canvas short side for preview layout math. Any value works; the
// tree layout is resolution-independent, only the ratio matters.
const PV = 400

/**
 * Height the snapshot chip above the grid asks for (chip + gap), reserved
 * while sizing the cells so the board group stays inside the stage.
 */
const SNAP_ROW_H = 50

/** Air between the two boards of the compare view, side by side. */
const COMPARE_GAP = 28

/** Air between them when they stack instead (a small screen). */
const COMPARE_STACK_GAP = 18

/** Room under each compare board for the group name. */
const COMPARE_CAPTION_H = 26

/**
 * The chrome the dock keeps at the bottom of the stage on this route: its 28px
 * handle over the tools row (70px) over the status bar (31–44px, `--statusH`).
 * Only the stacked compare view has to keep clear of it: it is the one layout
 * that fills the stage's height (the single board and the wide pair are bounded
 * by width, and end above the dock on their own).
 */
const DOCK_CHROME_H = 144

/**
 * Below Tailwind's `sm` the compare view stacks its two boards, one above the
 * other, instead of laying them side by side: two boards of three columns each
 * leave ~45px cells at phone widths, too small to see or tap. Read through a
 * media query rather than a `max-sm:` class because the cell size is computed
 * here, not by CSS (the same idiom as `compact` on the stage).
 */
const COMPARE_STACK_QUERY = '(max-width: 639.98px)'

/** The floating-chip idiom shared with FloatActions (back / reset). */
const snapBtnCls = 'grid h-[30px] w-[30px] cursor-pointer place-items-center rounded-none border border-float-line bg-float-bg text-float-icon backdrop-blur-[7px] transition-[background-color,border-color,color,scale] duration-(--dur-fast) active:scale-[0.97] hover:not-disabled:bg-chip-hover hover:not-disabled:text-txt focus-visible:outline-1 focus-visible:outline-accent disabled:cursor-default disabled:opacity-35 pointer-coarse:h-[38px] pointer-coarse:w-[38px]'

/** A group chip: the bar's button idiom, lit when its board is the open one. */
const groupChipCls = 'h-[30px] min-w-[30px] cursor-pointer border border-float-line bg-float-bg px-2 text-[11.5px] font-semibold text-float-icon backdrop-blur-[7px] transition-[background-color,border-color,color,scale] duration-(--dur-fast) active:scale-[0.97] hover:bg-chip-hover hover:text-txt focus-visible:outline-1 focus-visible:outline-accent'

/** The compare header's group picker: a native select wearing the chrome tokens. */
const groupSelectCls = 'h-[30px] cursor-pointer appearance-none border border-line-strong bg-panel-2 pr-6 pl-2 text-[11.5px] font-semibold text-txt hover:bg-chip-hover focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1'

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

/** How the view lays its boards out: one, or the compare view's two. */
type BoardLayout = 'single' | 'side' | 'stack'

/**
 * The 3×3 slot one board gets, and the smallest cell it may use. A single board
 * has the whole stage, the compare view's two share it: side by side on a wide
 * screen (less the air between them, plus a caption row), or one above the
 * other on a small one (the full width, half the height each).
 */
function boardSlot(stage: { w: number, h: number }, layout: BoardLayout, gap: number): { w: number, h: number, min: number } {
  const height = stage.h - 48 - SNAP_ROW_H
  if (layout === 'side') {
    const w = Math.floor((stage.w - 48 - COMPARE_GAP) / 2)
    // Two boards on a phone have to go under the grid's 60px floor (down to the
    // width the slot actually has) to stay side by side.
    return { w, h: height - COMPARE_CAPTION_H, min: Math.max(12, Math.floor((w - gap * 2) / 3)) }
  }
  if (layout === 'stack') {
    // Both boards and both captions fit the stage's height, above the dock; at
    // phone widths the width is no limit, so the cells are bounded by height
    // and take no floor (there is nothing to scroll: both stay in view).
    const room = height - DOCK_CHROME_H - COMPARE_STACK_GAP - COMPARE_CAPTION_H * 2
    return { w: stage.w - 48, h: Math.floor(room / 2), min: 12 }
  }
  return { w: stage.w - 48, h: height, min: 60 }
}

/**
 * The layout the stage is in: the plain grid is one board; the compare view's
 * two are side by side, or stacked on a small screen (see COMPARE_STACK_QUERY).
 */
function boardLayout(comparing: boolean, compact: boolean): BoardLayout {
  if (!comparing)
    return 'single'
  return compact ? 'stack' : 'side'
}

/** The cell size for the stage, from the slot its board gets (`boardSlot`). */
function stageCellBox(stage: { w: number, h: number }, layout: BoardLayout, gap: number, ratio: number): { cell: number, box: { w: number, h: number } } {
  const slot = boardSlot(stage, layout, gap)
  const fit = gridCellBox({ w: slot.w, h: Math.max(1, slot.h) }, gap, ratio, GRID_CELL_MAX, slot.min)
  // Centering an odd leftover put every cell on a half pixel, where 1px
  // edges snap unevenly (the + cell's dashed right edge vanished). One px
  // less flips the board's parity, so the cells land on whole pixels.
  const cell = fit.w > 60 && (slot.w - (fit.w * 3 + gap * 2)) % 2 !== 0 ? fit.w - 1 : fit.w
  return { cell, box: { w: cell, h: cell === fit.w ? fit.h : Math.max(1, Math.round(cell / ratio)) } }
}

/**
 * The pair the compare view opens on: the first two groups, or a group made on
 * the spot when there is only one (a comparison needs two boards to show).
 */
function comparePicks(): { a: string, b: string } | null {
  const s = useStore.getState()
  const ready = comparePair(s.grids, null, null)
  if (ready)
    return { a: ready[0].id, b: ready[1].id }
  const from = s.activeGridId
  const added = s.addGrid()
  return added ? { a: from, b: added } : null
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
 * Boards come in groups (`lib/workspaces`): the bar above the grid switches
 * which group of nine the overview shows, and the compare chip turns the view
 * into two of them (arrangement 1 vs 2) instead of one: side by side where
 * there is width for it, stacked one above the other on a small screen.
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
   * The compare view's two picks (group ids), or null for the plain grid. Held
   * here rather than in the store: it is this view's mode, not the board's.
   */
  const [compare, setCompare] = useState<{ a: string, b: string } | null>(null)

  // Enter a workspace: set activeId before navigating so the stage renders the
  // right workspace inside the same view-transition commit (the route wrapper
  // re-syncs it for direct URLs), then morph the cell into the canvas.
  const enter = useCallback((id: string) => {
    useStore.getState().patch({ activeId: id })
    useStore.getState().clearSelection()
    void navigate({ to: '/w/$wsId', params: { wsId: id }, viewTransition: viewTransitionOption() })
  }, [navigate])

  // A cell in the compare view belongs to a group that may not be open: open
  // its board first (navigation, no undo entry), then enter the cell.
  const enterIn = useCallback((gridId: string, id: string) => {
    useStore.getState().switchGrid(gridId)
    enter(id)
  }, [enter])

  const grids = useStore(s => s.grids)
  // Resolved every render: a pick that no longer exists (a deleted or undone
  // group) falls back to the first two, and fewer than two groups leave the
  // plain grid instead of an empty comparison.
  const pair = compare ? comparePair(grids, compare.a, compare.b) : null
  const comparing = pair !== null
  const left = useStore(s => (pair ? boardOf(s, pair[0].id) : null))
  const right = useStore(s => (pair ? boardOf(s, pair[1].id) : null))
  /** The two boards the compare view draws, or null for the plain grid. */
  const compareSides = pair && left && right
    ? [{ group: pair[0], board: left }, { group: pair[1], board: right }]
    : null

  const startCompare = () => setCompare(comparePicks())

  const pickGroup = (slot: 'a' | 'b', id: string) =>
    setCompare(c => (c ? { ...c, [slot]: id } : c))

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
    // The compare view is read-only chrome around two boards: no highlight to
    // walk, and Enter would have to guess which side it meant.
    if (comparing)
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
  }, [enter, comparing])

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
  const compact = useMediaQuery(COMPARE_STACK_QUERY)
  const layout = boardLayout(comparing, compact)
  const { cell, box } = stageCellBox(wrapSize, layout, gridGap, cellRatioValue(gridCellRatio))

  return (
    <div
      ref={wrapRef}
      className="stage-checker absolute inset-0 flex touch-none items-center justify-center overflow-hidden"
      // Centering happens above the dock, not in the whole stage: a stacked
      // pair fills the height, so half a reserve spent below would sit under it.
      style={layout === 'stack' ? { paddingBottom: DOCK_CHROME_H } : undefined}
    >
      {compareSides
        ? (
            <CompareBoards
              sides={compareSides}
              stacked={layout === 'stack'}
              cell={cell}
              box={box}
              gridGap={gridGap}
              photoById={photoById}
              transparent={transparent}
              onEnter={enterIn}
              onPick={pickGroup}
              onExit={() => setCompare(null)}
            />
          )
        : (
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
                {/* The group bar and the chips sit above the grid, as part of the
                    same group: they take layout space, so the centered board
                    never grows past the stage or clips the chrome. */}
                <div className="flex flex-col items-center gap-3">
                  <div className="flex items-center gap-2">
                    <GroupBar />
                    <Tip
                      label={t('Compare')}
                      trigger={(
                        <button
                          className={snapBtnCls}
                          aria-label={t('Compare')}
                          onClick={startCompare}
                        >
                          <MorphIcon icon={Columns2} size={15} strokeWidth={1.75} />
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
                  <div
                    className="grid grid-cols-3"
                    style={{ gap: gridGap, width: cell * 3 + gridGap * 2 }}
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
          )}

      {/* Grid-route-only tools: Grid gap. Same 3-snap sheet as the collage stage. */}
      <ToolsDock hidden={false} contextKey="grid">
        <DockToolset route="grid" />
      </ToolsDock>
    </div>
  )
}

/**
 * The grid-group bar above the board: one chip per group of nine (click to open
 * that board, double-click to rename it, the open one carries ×), and the +
 * that makes a new one. Opening a group is navigation and costs no undo step;
 * adding, renaming and deleting are board mutations and are undoable.
 */
function GroupBar() {
  const t = useT()
  const grids = useStore(s => s.grids)
  const activeGridId = useStore(s => s.activeGridId)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  /** The group whose delete confirm is open. */
  const [asked, setAsked] = useState<string | null>(null)
  const submitRename = (id: string) => {
    useStore.getState().renameGrid(id, draft)
    setRenaming(null)
  }
  return (
    <div className="flex items-center gap-1">
      {grids.map((g) => {
        const active = g.id === activeGridId
        return renaming === g.id
          ? (
              <input
                key={g.id}
                autoFocus
                value={draft}
                aria-label={t('Rename')}
                className={`${groupChipCls} w-20 cursor-text`}
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
              <button
                key={g.id}
                className={`${groupChipCls}${active ? ' border-accent text-txt' : ''}`}
                title={t('Rename')}
                onClick={() => useStore.getState().switchGrid(g.id)}
                onDoubleClick={() => {
                  setDraft(g.name)
                  setRenaming(g.id)
                }}
              >
                {g.name}
              </button>
            )
      })}
      {grids.length > 1 && (
        <button
          className={snapBtnCls}
          title={t('Delete group?')}
          aria-label={t('Delete group?')}
          onClick={() => setAsked(activeGridId)}
        >
          <MorphIcon icon={X} size={13} strokeWidth={1.75} />
        </button>
      )}
      {grids.length < MAX_GRIDS && (
        <button
          className={snapBtnCls}
          title={t('Add a group')}
          aria-label={t('Add a group')}
          onClick={() => useStore.getState().addGrid()}
        >
          <MorphIcon icon={Plus} size={15} strokeWidth={1.75} />
        </button>
      )}
      <ConfirmDialog
        open={asked !== null}
        title={t('Delete group?')}
        description={t('This removes the group and its nine collages. Undo brings them back.')}
        confirmLabel={t('Delete')}
        danger
        onClose={() => setAsked(null)}
        onConfirm={() => {
          if (asked)
            useStore.getState().removeGrid(asked)
          setAsked(null)
        }}
      />
    </div>
  )
}

/**
 * The compare view: two boards, side by side on a wide screen and stacked on a
 * small one, each drawn by the same cell preview the grid uses.
 * Read-only otherwise (no drag, no + cell, no delete strip); a cell still opens
 * its own editor, in its own group.
 */
function CompareBoards({ sides, stacked, cell, box, gridGap, photoById, transparent, onEnter, onPick, onExit }: {
  sides: { group: GridGroup, board: Workspace[] }[]
  /** One board above the other (small screen) instead of beside it. */
  stacked: boolean
  cell: number
  box: { w: number, h: number }
  gridGap: number
  photoById: Map<string, Photo>
  transparent: boolean
  onEnter: (gridId: string, id: string) => void
  onPick: (slot: 'a' | 'b', id: string) => void
  onExit: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <CompareHeader sides={sides} onPick={onPick} onExit={onExit} />
      <div
        data-compare-layout={stacked ? 'stack' : 'side'}
        className={stacked ? 'flex flex-col items-center' : 'flex items-start'}
        style={{ gap: stacked ? COMPARE_STACK_GAP : COMPARE_GAP }}
      >
        {sides.map(({ group, board }) => (
          <div key={group.id} className="flex flex-col items-center gap-2">
            <div className="grid grid-cols-3" style={{ gap: gridGap, width: cell * 3 + gridGap * 2 }}>
              {board.map(ws => (
                <CompareCell
                  key={ws.id}
                  ws={ws}
                  cell={cell}
                  box={box}
                  photoById={photoById}
                  transparent={transparent}
                  onEnter={id => onEnter(group.id, id)}
                />
              ))}
            </div>
            <span className="text-[11.5px] font-semibold text-dim">{group.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The compare view's header: which two boards, and the way back out. */
function CompareHeader({ sides, onPick, onExit }: {
  sides: { group: GridGroup }[]
  onPick: (slot: 'a' | 'b', id: string) => void
  onExit: () => void
}) {
  const t = useT()
  const grids = useStore(s => s.grids)
  return (
    <div className="flex items-center gap-2">
      <GroupPicker groups={grids} value={sides[0].group.id} label={t('First group')} onChange={id => onPick('a', id)} />
      <MorphIcon icon={ArrowRightLeft} size={14} strokeWidth={1.75} className="text-dim" />
      <GroupPicker groups={grids} value={sides[1].group.id} label={t('Second group')} onChange={id => onPick('b', id)} />
      <Tip
        label={t('Exit compare')}
        trigger={(
          <button className={snapBtnCls} aria-label={t('Exit compare')} onClick={onExit}>
            <MorphIcon icon={X} size={15} strokeWidth={1.75} />
          </button>
        )}
      />
    </div>
  )
}

/** One side of the compare header: a select wearing the chrome tokens. */
function GroupPicker({ groups, value, label, onChange }: {
  groups: GridGroup[]
  value: string
  label: string
  onChange: (id: string) => void
}) {
  return (
    <span className="relative flex items-center">
      <select className={groupSelectCls} aria-label={label} value={value} onChange={e => onChange(e.target.value)}>
        {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      <MorphIcon icon={ChevronDown} size={12} strokeWidth={1.75} className="pointer-events-none absolute right-2 text-dim" />
    </span>
  )
}

/** A cell in the compare view: the grid's preview, minus the drag. */
function CompareCell({ ws, cell, box, photoById, transparent, onEnter }: {
  ws: { id: string, root: Node, canvasRatio: number | null, stickers?: Sticker[], labels?: PaneLabel[] }
  cell: number
  box: { w: number, h: number }
  photoById: Map<string, Photo>
  transparent: boolean
  onEnter: (id: string) => void
}) {
  const t = useT()
  const filled = leafList(ws.root).some(l => l.photoId)
  return (
    <button
      className="relative cursor-pointer touch-none select-none overflow-hidden bg-panel-2 outline-0 transition-[scale] duration-(--dur-surface) active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-txt"
      style={{ width: cell, height: box.h }}
      onClick={() => onEnter(ws.id)}
      title={filled ? t('Edit this workspace') : t('Start a new collage here')}
    >
      <CellBody ws={ws} box={box} photoById={photoById} transparent={transparent} dimmed={false} />
    </button>
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
