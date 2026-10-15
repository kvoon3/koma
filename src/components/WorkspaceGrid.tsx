import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import type { Photo } from '../lib/imageStore'
import type { Leaf, Node, PaneLabel, Rect, SeamSides, Sticker } from '../lib/panes'
import { closestCenter, DndContext, DragOverlay, MeasuringStrategy, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { rectSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useNavigate } from '@tanstack/react-router'
import { Camera, LayoutDashboard, LoaderCircle } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useElementSize, usePreview } from '../hooks'
import { useAppCommands } from '../lib/appCommands'
import { GRID_CELL_MAX } from '../lib/exporter'
import { fontById } from '../lib/fonts'
import { useT } from '../lib/i18n'
import { LABEL_ICON_GAP_EM, labelIconNode } from '../lib/labelIcons'
import { boardStickerRect, labelPaint, layoutTree, leafList, placement, rotationCss, seamFadeWidth, seamMaskStyle, seamSides } from '../lib/panes'
import { prefersReducedMotion, viewTransitionOption } from '../lib/viewTransition'
import { isTransparentBg, useStore } from '../store'
import { LabelIconGlyph } from './BoardLabel'
import { SeamBackdrop } from './Stage'
import { Tip } from './ui/tip'

// Virtual canvas short side for preview layout math. Any value works; the
// tree layout is resolution-independent, only the ratio matters.
const PV = 400

/**
 * Height the snapshot chip above the grid asks for (chip + gap), reserved
 * while sizing the cells so the board group stays inside the stage.
 */
const SNAP_ROW_H = 50

/** The floating-chip idiom shared with FloatActions (back / reset). */
const snapBtnCls = 'grid h-[30px] w-[30px] cursor-pointer place-items-center rounded-none border border-float-line bg-float-bg text-float-icon backdrop-blur-[7px] transition-[background-color,border-color,color,scale] duration-(--dur-fast) active:scale-[0.97] hover:not-disabled:bg-chip-hover hover:not-disabled:text-txt focus-visible:outline-1 focus-visible:outline-accent disabled:cursor-default disabled:opacity-35 pointer-coarse:h-[38px] pointer-coarse:w-[38px]'

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

/** One leaf of a workspace preview: the photo, panned/zoomed like the editor. */
function PreviewLeaf({ leaf, rect, k, unit, fade, seam, photoById }: {
  leaf: Leaf
  rect: Rect
  /** Virtual→cell scale factor. */
  k: number
  /** Cell-normalized unit (short side / 1000), for radius scaling. */
  unit: number
  /** Blend feather width in cell px (0 turns the fade off). */
  fade: number
  seam?: SeamSides
  photoById: Map<string, Photo>
}) {
  const photo = leaf.photoId ? photoById.get(leaf.photoId) : undefined
  const preview = usePreview(photo ?? null)
  const radius = useStore(s => s.radius)
  const iw = preview?.w ?? 0
  const ih = preview?.h ?? 0
  const cell: Rect = { x: rect.x * k, y: rect.y * k, w: rect.w * k, h: rect.h * k }
  const style: React.CSSProperties = {
    left: cell.x,
    top: cell.y,
    width: cell.w,
    height: cell.h,
    borderRadius: radius * unit,
  }
  const place = iw && ih
    ? placement({ x: 0, y: 0, w: cell.w, h: cell.h }, leaf, iw, ih)
    : null
  // Blend: the same seam feather the editor's panes use, scaled to the cell.
  const mask = seamMaskStyle(seam, seamFadeWidth(fade, cell))
  // No pane background: like the editor, the blurred field shows through the
  // feathered seam edges (an opaque leaf would hide the blend).
  return (
    <div className={`absolute overflow-hidden ${leaf.photoId ? '' : ' bg-pane-bg bg-pane-empty'}`} style={style}>
      {preview && place
        ? (
            <div className="absolute inset-0" style={mask}>
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
                  transform: `translate(${place.x}px, ${place.y}px) scale(${place.scale})`,
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
  // Backdrop blend, scaled down from the editor: pane edges feather into a
  // shared blurred field behind them; width 0 turns the whole treatment off.
  const fade = edgeFade * unit
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
        {fade > 0 && (
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

function step(from: number, dir: 'left' | 'right' | 'up' | 'down' | 'next') {
  if (dir === 'next')
    return (from + 1) % 9
  const r = Math.floor(from / 3)
  const c = from % 3
  if (dir === 'left')
    return r * 3 + ((c + 2) % 3)
  if (dir === 'right')
    return r * 3 + ((c + 1) % 3)
  if (dir === 'up')
    return ((r + 2) % 3) * 3 + c
  return ((r + 1) % 3) * 3 + c
}

/**
 * The 3×3 workspace overview: read-only square previews of all nine
 * workspaces. Click a cell to edit that workspace, drag a cell onto another
 * to insert-shift reorder (dnd-kit sortable grid: the dragged cell follows
 * the pointer as an overlay while the rest make room live), arrows/hjkl/Tab
 * + Enter to navigate by keyboard. Pure navigation view, no photo tools.
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
  const { snapshotGrid, busy } = useAppCommands()
  /** Local to the camera chip: the app-wide `busy` also spins during an export. */
  const [snapBusy, setSnapBusy] = useState(false)

  // Enter a workspace: set activeId before navigating so the stage renders the
  // right workspace inside the same view-transition commit (the route wrapper
  // re-syncs it for direct URLs), then morph the cell into the canvas.
  const enter = useCallback((id: string) => {
    useStore.getState().patch({ activeId: id })
    useStore.getState().clearSelection()
    void navigate({ to: '/w/$wsId', params: { wsId: id }, viewTransition: viewTransitionOption() })
  }, [navigate])

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
        setHl(step(hlRef.current, dirKey))
        return
      }
      if (k === 'Tab') {
        e.preventDefault()
        setHl(step(hlRef.current, 'next'))
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
  }, [enter])

  // ---- Drag-to-reorder (dnd-kit, insert-shift) -----------------------------
  // PointerSensor with a distance threshold keeps plain clicks for entering
  // a workspace; once a drag activates, the dragged cell rides a DragOverlay
  // that tracks the pointer 1:1 while the remaining cells translate to make
  // room (rectSortingStrategy), and the drop commits via moveWorkspace.
  const [dragId, setDragId] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, {
    activationConstraint: { distance: 5 },
  }))
  // Suppress the click that follows a finished drag; it must not enter.
  const dragEndedAtRef = useRef(0)

  const ids = useMemo(() => workspaces.map(w => w.id), [workspaces])
  const draggedWs = dragId ? workspaces.find(w => w.id === dragId) : null

  const onDragStart = (e: DragStartEvent) => setDragId(String(e.active.id))

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragId(null)
    dragEndedAtRef.current = Date.now()
    if (!over || active.id === over.id)
      return
    const arr = useStore.getState().workspaces
    const from = arr.findIndex(w => w.id === active.id)
    const to = arr.findIndex(w => w.id === over.id)
    if (from !== -1 && to !== -1)
      moveWorkspace(arr[from].id, to)
  }

  const [wrapRef, wrapSize] = useElementSize<HTMLDivElement>()
  const cell = Math.max(60, Math.floor(
    Math.min(
      (wrapSize.w - 48 - gridGap * 2) / 3,
      (wrapSize.h - 48 - SNAP_ROW_H - gridGap * 2) / 3,
      GRID_CELL_MAX,
    ),
  ))
  const box = { w: cell, h: cell }

  return (
    <div ref={wrapRef} className="stage-checker absolute inset-0 flex touch-none items-center justify-center overflow-hidden">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setDragId(null)
          dragEndedAtRef.current = Date.now()
        }}
      >
        <SortableContext items={ids} strategy={rectSortingStrategy}>
          {/* The snapshot chip sits above the grid, as part of the same group:
              it takes layout space, so the centered board never grows past
              the stage or clips the chip. */}
          <div className="flex flex-col items-center gap-3">
            <Tip
              label={t('Snapshot all nine workspaces as one image')}
              trigger={(
                <button
                  className={snapBtnCls}
                  aria-label={t('Snapshot all nine workspaces as one image')}
                  disabled={!anyFilled || busy || snapBusy}
                  onClick={() => {
                    setSnapBusy(true)
                    void snapshotGrid().finally(() => setSnapBusy(false))
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
            </div>
          </div>
        </SortableContext>

        <DragOverlay dropAnimation={prefersReducedMotion() ? null : { duration: 160, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }}>
          {draggedWs
            ? (
                <div
                  className="relative cursor-grabbing overflow-hidden bg-panel-2 shadow-[0_18px_48px_rgba(0,0,0,0.55)]"
                  style={{ width: cell, height: cell }}
                >
                  <CellBody ws={draggedWs} box={box} photoById={photoById} transparent={transparent} dimmed={false} />
                </div>
              )
            : null}
        </DragOverlay>
      </DndContext>
    </div>
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
        height: cell,
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
