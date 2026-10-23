import type { IconInput } from 'morphicons/react'
import type { Action, DockRoute } from '../lib/actionGuard'
import type { PaintedBoard, PaneDraw } from '../lib/boardPaint'
import type { CutoutMap } from '../lib/cutout'
import type { CutoutSets, CutoutState } from '../lib/cutoutVariants'
import type { Translate } from '../lib/i18n'
import type { Photo } from '../lib/imageStore'
import type { GeometryCache, SeamsCache } from '../lib/layout'
import type { Divider, Leaf, Node, PaneLabel, Rect, SeamSides, Sticker } from '../lib/panes'
import type { StickerTarget } from '../lib/stickerAssets'
import type { Derived } from '../store'
import { Popover } from '@base-ui/react/popover'
import { Blend, Check, Columns2, CopyPlus, Eraser, Frame, GripVertical, Image as ImageIcon, ImagePlus, MapPin, Maximize, MoveDiagonal2, Music, Ratio, RectangleHorizontal, RotateCcw, Scaling, Scissors, Shuffle, SquareSplitHorizontal, SquareSplitVertical, Sticker as StickerIcon, Trash2, Type, Undo2, WandSparkles } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useElementSize, useMediaQuery, usePreview, useStageZoom } from '../hooks'
import { bindAction, canRun, paneContext } from '../lib/actionGuard'
import { collectBoard, dividerBandStyle, dividerGripStyle, paintBoard, paneDraws } from '../lib/boardPaint'
import { viewScaleAt, viewTransform } from '../lib/canvasView'
import { variantsOf } from '../lib/cutoutVariants'
import { GRID_CELL_RATIOS } from '../lib/gridTools'
import { useT } from '../lib/i18n'
import { setLabelPreviewUnit } from '../lib/labelMetrics'
import { addLabelToPane, duplicatePaneAuto, fitPanePhoto, insertLocationLabel, matchCanvasToPhoto, pickPhotoForPane, pickStickersForPane, resetPaneView, splitPane } from '../lib/paneCommands'
import { applyCutoutState } from '../lib/paneCutout'
import { leafList, placement, ratioFromPointer, seamSides, setSplitRatioIn } from '../lib/panes'
import { CANVAS_WHEEL_SCALE, stepValue } from '../lib/scaleRail'
import { photoAssetsOf } from '../lib/stickerLibrary'
import { activeWs, cachedGeometry, cachedSeams, computeGeometry, emptyGeometryCache, emptySeamsCache, fitCanvas, isTransparentBg, MIN_PANE_PX, useStore, withLiveLeaves } from '../store'
import { AppearanceDockTools, GridDockTool } from './AppearanceTools'
import { BoardInserts } from './BoardInserts'
import { LabelDockTools } from './BoardLabel'
import { CanvasMenu } from './CanvasMenu'
import { CollageBgLayer } from './CollageBgLayer'
import { ConfirmDialog } from './ConfirmDialog'
import { DeleteZone } from './DeleteZone'
import { Pane } from './Pane'
import { PaneFilterTool } from './PaneFilterTools'
import { PaneRotateTool } from './PaneRotateTools'
import { ScaleRail } from './ScaleRail'
import { StickerMakerDialog } from './StickerMakerDialog'
import { toolsBtnCls, ToolsDock, toolsLabelCls } from './ToolsDock'
import { dockBtnStateCls, dockPopupMotionCls, menuItemCls, menuSurfaceCls } from './ui/menu'
import { ViewZoomChip } from './ViewZoomChip'

const NO_STICKERS: Sticker[] = []
const NO_LABELS: PaneLabel[] = []

const HIT_MIN = 15
const MIN_CANVAS = 120

/** `bindAction`'s `when` for the Location tool: the photo has an EXIF fix. */
function photoHasGps(p: { photo: Photo | null }): boolean {
  return !!p.photo?.gps
}

/** Does the focused pane's photo carry an EXIF fix? (The label dock's Location action.) */
function focusPhotoHasGps(view: Derived, focusId: string, photoById: Map<string, Photo>): boolean {
  if (!focusId)
    return false
  const leaf = view.leaves.find(l => l.node.id === focusId)?.node
  if (!leaf?.photoId)
    return false
  return !!photoById.get(leaf.photoId)?.gps
}

/**
 * The Location tool: its own function keeps the long tool-definition list in
 * `usePaneTools` below the cognitive-complexity budget.
 */
function locationToolFor(t: Translate, bind: (a: Action<Photo>) => (() => void) | null): ToolDef {
  return {
    key: 'location',
    icon: MapPin,
    label: t('Location'),
    hint: t('Insert a location label from this photo\'s GPS'),
    onClick: bind({ requires: 'photo', when: photoHasGps, run: p => insertLocationLabel(p.paneId) }),
  }
}

interface ToolDef {
  key: string
  icon: IconInput
  label: string
  hint: string
  /** Bound by `bindAction`: null when the precondition fails → disabled. */
  onClick?: (() => void) | null
  /** Options: the icon opens a small popover above itself instead of acting. */
  options?: ToolOption[]
}

interface ToolOption {
  key: string
  icon: IconInput
  label: string
  /** Bound by `bindAction`: null when the precondition fails → disabled. */
  onClick: (() => void) | null
  /** This row is what the pane already shows: a check, `aria-pressed`. */
  active?: boolean
  /** Why the row is off, said in the row itself rather than only in a tooltip. */
  reason?: string
}

const toolDisabledCls = 'disabled:cursor-default disabled:opacity-35 disabled:active:scale-100 disabled:hover:bg-transparent'
const toolPopupCls = `${menuSurfaceCls} ${dockPopupMotionCls} min-w-[170px]`

/** A dock tool with options: a Base UI Popover anchored above the icon. */
function ToolPopoverButton({ icon, label, hint, options }: Omit<ToolDef, 'key'> & { options: ToolOption[] }) {
  const [open, setOpen] = useState(false)
  const allDisabled = options.every(o => !o.onClick)
  return (
    <Popover.Root open={open && !allDisabled} onOpenChange={setOpen}>
      <Popover.Trigger
        disabled={allDisabled}
        className={`${toolsBtnCls} ${dockBtnStateCls} ${toolDisabledCls}`}
        title={hint}
        aria-label={label}
        data-dock-tool={label}
      >
        <MorphIcon icon={icon} size={22} strokeWidth={1.5} />
        <span className={toolsLabelCls}>{label}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="center" sideOffset={6} collisionPadding={6} className="z-[260] select-none outline-0">
          <Popover.Popup className={toolPopupCls}>
            {options.map(o => (
              <button
                key={o.key}
                data-tool-option={o.key}
                className={`${menuItemCls} hover:bg-chip-hover disabled:cursor-default disabled:opacity-35`}
                disabled={!o.onClick}
                aria-pressed={o.active ?? false}
                title={o.reason}
                onClick={() => {
                  setOpen(false)
                  o.onClick?.()
                }}
              >
                <MorphIcon icon={o.icon} size={15} strokeWidth={1.75} />
                {o.label}
                {/* The row's own state: a check for the one the pane shows, a
                    short reason for one that cannot be used right now. */}
                {o.active
                  ? <MorphIcon icon={Check} size={13} strokeWidth={2} className="ml-auto text-accent" />
                  : o.reason ? <span className="ml-auto pl-3 text-[10px] text-faint">{o.reason}</span> : null}
              </button>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

function ToolButton({ icon, label, hint, onClick, options }: Omit<ToolDef, 'key'>) {
  if (options)
    return <ToolPopoverButton icon={icon} label={label} hint={hint} options={options} />
  return (
    <button
      className={`${toolsBtnCls} ${dockBtnStateCls} ${toolDisabledCls}`}
      title={hint}
      aria-label={label}
      data-dock-tool={label}
      disabled={!onClick}
      onClick={onClick ?? undefined}
    >
      <MorphIcon icon={icon} size={22} strokeWidth={1.5} />
      <span className={toolsLabelCls}>{label}</span>
    </button>
  )
}

/**
 * What the editor's Make tool hands the dialog: the focused pane, as a pane
 * target (module scope so the page body keeps one branch fewer).
 */
function paneTarget(paneId: string | null): StickerTarget | null {
  return paneId ? { kind: 'pane', paneId } : null
}

/**
 * The divider drag: which divider is down, which one a mouse is over, and the
 * window listeners that resize it. The stage owns the geometry; this owns the
 * gesture.
 */
function useDividerDrag({
  view,
  stageRef,
  onPaint,
  resizeSplit,
}: {
  view: Derived
  stageRef: React.RefObject<HTMLDivElement | null>
  /** Paint the board as it would be at `ratio` (see `lib/boardPaint`). */
  onPaint: (divider: Divider, ratio: number, board: PaintedBoard) => void
  resizeSplit: (splitId: string, ratio: number) => void
}) {
  /**
   * The divider being dragged, by id: its grip stays lit even once the pointer
   * has left the 15px band it lives in.
   */
  const [dragId, setDragId] = useState<string | null>(null)
  /**
   * The divider a mouse is hovering, by id: the grip and its line light off it
   * (the grip rides above the lines, so it cannot use `group-hover`).
   */
  const [hotId, setHotId] = useState<string | null>(null)
  /**
   * The drag in flight: the divider, the elements it repaints, and the ratio it
   * has painted but not committed. A ratio drag moves every rect on both sides
   * of its split, so a React render per pointermove cost a phone frame, while
   * the browser's own layout of the same change is nearly free. The drag paints
   * instead and commits once, on release.
   */
  const dragRef = useRef<{ divider: Divider, board: PaintedBoard, ratio: number } | null>(null)

  const beginDrag = useCallback((d: Divider) => {
    return (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragRef.current = { divider: d, board: collectBoard(stageRef.current), ratio: d.ratio }
      setDragId(d.id)
    }
  }, [stageRef])

  useEffect(() => {
    if (dragId == null)
      return
    const move = (e: PointerEvent) => {
      const drag = dragRef.current
      const r = stageRef.current?.getBoundingClientRect()
      if (!drag || !r)
        return
      // The canvas may carry the view zoom (a CSS scale), so its client rect is
      // in screen pixels: the divider math wants the canvas's own.
      const s = viewScaleAt(stageRef.current)
      const ratio = ratioFromPointer(drag.divider, (e.clientX - r.left) / s, (e.clientY - r.top) / s, view.gap, MIN_PANE_PX)
      if (ratio === drag.ratio)
        return
      drag.ratio = ratio
      onPaint(drag.divider, ratio, drag.board)
    }
    const up = () => {
      const drag = dragRef.current
      dragRef.current = null
      setDragId(null)
      // One commit, and one undo step: what the drag painted becomes the board.
      if (drag && drag.ratio !== drag.divider.ratio)
        resizeSplit(drag.divider.id, drag.ratio)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [dragId, view.gap, resizeSplit, stageRef, onPaint])

  // A render that lands mid-drag (a photo finishing its decode, say) would
  // otherwise snap the board back to the committed ratio: repaint the draft.
  useLayoutEffect(() => {
    const drag = dragRef.current
    if (drag && drag.ratio !== drag.divider.ratio)
      onPaint(drag.divider, drag.ratio, drag.board)
  })

  /** Hovered or being dragged: what lights a divider's grip and its line. */
  const isLit = (id: string) => hotId === id || dragId === id
  return { dragId, setHotId, isLit, beginDrag }
}

/**
 * The canvas aspect handle's gesture: drag the bottom-right corner to change the
 * canvas aspect, double-click to follow the first photo again. It is the direct
 * control the right-edge rail is not: the rail scales the canvas as a whole,
 * this one reshapes it. It rides the canvas, so a canvas scaled past the fit
 * takes its corner (and this handle) off the stage: the rail is what stays.
 */
function useCanvasResize(
  wrapRef: React.RefObject<HTMLDivElement | null>,
  canvasRef: React.RefObject<HTMLDivElement | null>,
  focus: (paneId: string) => void,
  setCanvasSize: (ratio: number, fill: number) => void,
) {
  const [sizing, setSizing] = useState(false)
  const sizeRef = useRef<{
    cx: number
    cy: number
    availW: number
    availH: number
    /** Canvas corner minus pointer, so the grab carries instead of snapping. */
    offX: number
    offY: number
  } | null>(null)

  const beginResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const canvas = canvasRef.current?.getBoundingClientRect()
      const wrap = wrapRef.current?.getBoundingClientRect()
      if (!canvas || !wrap)
        return
      sizeRef.current = {
        cx: canvas.left + canvas.width / 2,
        cy: canvas.top + canvas.height / 2,
        availW: Math.max(160, wrap.width - 48),
        availH: Math.max(160, wrap.height - 48),
        // Measured from the canvas corner, not from the handle's own centre:
        // the handle can be lifted clear of the tools sheet, and a grab that
        // used the lifted point would read as a shorter canvas and shrink it.
        offX: canvas.right - e.clientX,
        offY: canvas.bottom - e.clientY,
      }
      setSizing(true)
      focus('')
    },
    [wrapRef, canvasRef, focus],
  )

  useEffect(() => {
    if (!sizing)
      return
    const move = (e: PointerEvent) => {
      const d = sizeRef.current
      if (!d)
        return
      // The handle rides the canvas, which the view zoom scales about its own
      // centre: the pointer's distance from that centre is in screen pixels,
      // and the canvas it has to become is in canvas pixels.
      const s = viewScaleAt(canvasRef.current)
      const hx = Math.max(MIN_CANVAS / 2, (e.clientX + d.offX - d.cx) / s)
      const hy = Math.max(MIN_CANVAS / 2, (e.clientY + d.offY - d.cy) / s)
      const ratio = hx / hy
      const fit = fitCanvas(ratio, d.availW, d.availH)
      setCanvasSize(ratio, (2 * hx) / fit.W)
    }
    const up = () => {
      sizeRef.current = null
      setSizing(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [sizing, setCanvasSize, canvasRef])

  const resetRatio = useCallback(() => {
    const s = useStore.getState()
    const first = photoAssetsOf(s.photos).find(p => p.trueW)
    // canvasRatio lives on the workspace now, so reset through setCanvasSize
    // (which always needs a number: fall back to the current ratio).
    s.setCanvasSize(first ? first.trueW / first.trueH : (activeWs(s).canvasRatio ?? 1.5), 1)
  }, [])

  return { sizing, beginResize, resetRatio }
}

/**
 * The dock's stage content. Memoized on purpose: `Stage` re-renders on every
 * pointermove of a drag, and every one of these props is still (the tool list
 * is memoized in `usePaneTools`), so the whole trigger/popover/MorphIcon tree
 * inside stays out of the frame.
 */
const StageToolsDock = memo(StageToolsDockImpl)

export function Stage() {
  const [wrapRef, wrapSize] = useElementSize<HTMLDivElement>()
  const stageRef = useRef<HTMLDivElement | null>(null)
  const t = useT()

  const root = useStore(s => activeWs(s).root)
  const wsId = useStore(s => s.activeId)
  const focusId = useStore(s => activeWs(s).focusId)
  const canvasRatio = useStore(s => activeWs(s).canvasRatio)
  const canvasFill = useStore(s => activeWs(s).canvasFill)
  const gapValue = useStore(s => s.gap)
  const radiusValue = useStore(s => s.radius)
  const fadeValue = useStore(s => s.edgeFade)
  const fadeStrength = useStore(s => s.edgeFadeStrength)
  const blendCrossfade = useStore(s => s.blendCrossfade)
  const paneBorder = useStore(s => s.paneBorder)
  const bg = useStore(s => s.bg)
  const photos = useStore(s => s.photos)
  const focus = useStore(s => s.focus)
  const selectLabel = useStore(s => s.selectLabel)
  const updateLeaf = useStore(s => s.updateLeaf)
  const split = useStore(s => s.split)
  const closePane = useStore(s => s.closePane)
  const resizeSplit = useStore(s => s.resizeSplit)
  const setCanvasSize = useStore(s => s.setCanvasSize)
  // The sticker maker dialog is store-driven: the pane menu opens it too.
  const stickerMakerFor = useStore(s => s.stickerMakerFor)
  const boardStickers = useStore(s => activeWs(s).stickers ?? NO_STICKERS)
  const boardLabels = useStore(s => activeWs(s).labels ?? NO_LABELS)
  const openStickerMaker = useStore(s => s.openStickerMaker)
  const closeStickerMaker = useCallback(() => openStickerMaker(null), [openStickerMaker])

  const transparent = isTransparentBg(bg)
  // One-slot layout caches, one pair per mounted stage (see `cachedGeometry`).
  // Lazy state, because it is a plain mutable cache: created once, never set.
  const [geometryCache] = useState<GeometryCache>(emptyGeometryCache)
  const [seamsCache] = useState<SeamsCache>(emptySeamsCache)
  const availW = Math.max(160, wrapSize.w - 48)
  const availH = Math.max(160, wrapSize.h - 48)

  // Layout is cached on the board's SHAPE: panning, zooming, turning or
  // filtering a photo moves pixels inside a rect, so a drag keeps the same
  // geometry, and with it the same rect and seam objects. Every pane the
  // gesture does not touch then memoizes away instead of re-rendering.
  const geometry = cachedGeometry(
    geometryCache,
    root,
    { canvasRatio, canvasFill, availW, availH, gapValue, radiusValue, fadeValue },
  )
  const view = useMemo(() => withLiveLeaves(geometry, root), [geometry, root])
  // Which pane edges are seams (face another photo): cached on the geometry
  // plus which panes hold a photo, the only leaf field a seam reads.
  const seams = cachedSeams(seamsCache, root, geometry)
  // Publish the preview's label unit: the exporter measures labels at this
  // size rather than at export px so multi-line x matches the preview.
  useEffect(() => setLabelPreviewUnit(view.unit), [view.unit])

  const photoById = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos])

  // The stage's air: a plain wheel sizes the canvas (the same value the size
  // rail's canvas line drives), ctrl/meta + wheel scales the working view. The
  // canvas itself keeps every gesture it had, so the wheel there is still the
  // pane's photo zoom.
  const [sizeNudge, setSizeNudge] = useState(0)
  const resizeByWheel = useCallback((notches: number) => {
    const s = useStore.getState()
    s.setCanvasFill(stepValue(activeWs(s).canvasFill, notches, CANVAS_WHEEL_SCALE))
    // The readout comes up even when the wheel is already on a bound, so "nothing
    // moved" reads as "this is the end", not as a dead wheel.
    setSizeNudge(n => n + 1)
  }, [])
  const fitCanvas = useCallback(() => {
    useStore.getState().setCanvasFill(1)
  }, [])
  const stageZoom = useStageZoom(wrapRef, stageRef, { onWheelResize: resizeByWheel, fitCanvas })

  // A ratio drag paints the board itself (see `useDividerDrag`): this hands it
  // the same layout the render would produce at the dragged ratio.
  const paintRatio = useCallback((divider: Divider, ratio: number, board: PaintedBoard) => {
    const ratioed = setSplitRatioIn(root, divider.id, ratio)
    const geo = computeGeometry(ratioed, { canvasRatio, canvasFill, availW, availH, gapValue, radiusValue, fadeValue })
    const draws = paneDraws(withLiveLeaves(geo, ratioed), seams, blendCrossfade, geo.fade, fadeStrength)
    paintBoard(board, draws, geo.dividers, geo.gap, HIT_MIN)
  }, [root, canvasRatio, canvasFill, availW, availH, gapValue, radiusValue, fadeValue, seams, blendCrossfade, fadeStrength])
  const { dragId, setHotId, isLit, beginDrag } = useDividerDrag({ view, stageRef, onPaint: paintRatio, resizeSplit })
  const { sizing, beginResize, resetRatio } = useCanvasResize(wrapRef, stageRef, focus, setCanvasSize)
  const { tools, toolsHidden: paneToolsHidden } = usePaneTools(focusId, view, photoById)
  // The label dock's location action follows the focused pane's photo, not the
  // selected label: it inserts a new label for that photo's EXIF fix.
  const focusHasGps = focusPhotoHasGps(view, focusId, photoById)

  return (
    <div
      ref={wrapRef}
      className={`stage-checker absolute inset-0 flex touch-none flex-col items-center justify-center overflow-hidden ${dragId ? ' cursor-col-resize! [&_*]:cursor-col-resize!' : ''}${sizing ? ' cursor-nwse-resize! [&_*]:cursor-nwse-resize!' : ''}`}
      // A press on the stage's own surface (the margin, the canvas between
      // panes) is the deselect gesture: panes, inserts, handles and dividers
      // stop their own pointerdowns, so whatever reaches here is empty space.
      onPointerDown={(e) => {
        if (e.button !== 0 || e.defaultPrevented)
          return
        const el = e.target as HTMLElement
        if (el.closest('[data-pane-id], [data-board-sticker], [data-label-id], button, [role="button"], [role="slider"], [role="menu"], [data-dock-mode]'))
          return
        const s = useStore.getState()
        if (!s.labelSel && !s.stickerSel && !activeWs(s).focusId)
          return
        s.selectLabel(null)
        s.focus('')
      }}
      // A double-click on the stage margin (the empty air around the canvas)
      // fits the view again; on the canvas it stays the pane's own reset.
      onDoubleClick={stageZoom.onStageDoubleClick}
    >
      <DeleteZone label={t('Drop here to delete')} />
      <StageCanvas
        view={view}
        viewScale={stageZoom.scale}
        seams={seams}
        stickers={boardStickers}
        labels={boardLabels}
        photoById={photoById}
        focusId={focusId}
        paneBorder={paneBorder}
        blendCrossfade={blendCrossfade}
        fadeStrength={fadeStrength}
        transparent={transparent}
        bg={bg}
        wsId={wsId}
        stageRef={stageRef}
        sizing={sizing}
        isLit={isLit}
        onHotChange={setHotId}
        onBeginDrag={beginDrag}
        onBeginResize={beginResize}
        onResetRatio={resetRatio}
        onFocus={focus}
        onSelectLabel={selectLabel}
        onUpdate={updateLeaf}
        onSplit={split}
        onClose={closePane}
      />

      {/* Off fit, a small chip says how far and puts it back (below the back
          button, which stands 30px tall on a mouse and 38px under a finger). */}
      <ViewZoomChip scale={stageZoom.scale} onFit={stageZoom.fit} className="absolute left-2.5 top-[46px] z-20 pointer-coarse:top-[54px]" />

      {/* The size control: a right-edge rail for the selected object or the
          canvas. `nudge` is the stage's wheel lights its readout, so the number
          is there while it turns. */}
      <ScaleRail nudge={sizeNudge} />

      {/* Canvas appearance tools always live in the dock; pane/label tools join
          when relevant. The dock itself is mounted by the root layout. */}
      <StageToolsDock
        tools={tools}
        paneToolsHidden={paneToolsHidden}
        focusHasGps={focusHasGps}
        focusId={focusId}
      />

      <StickerMakerDialog
        open={stickerMakerFor != null}
        target={paneTarget(stickerMakerFor)}
        onClose={closeStickerMaker}
      />
    </div>
  )
}

/** The board itself: backdrop, panes, inserts and divider chrome. */
function StageCanvas({
  view,
  viewScale,
  seams,
  stickers,
  labels,
  photoById,
  focusId,
  paneBorder,
  blendCrossfade,
  fadeStrength,
  transparent,
  bg,
  wsId,
  stageRef,
  sizing,
  isLit,
  onHotChange,
  onBeginDrag,
  onBeginResize,
  onResetRatio,
  onFocus,
  onSelectLabel,
  onUpdate,
  onSplit,
  onClose,
}: {
  view: Derived
  /** The view zoom's scale, written on the canvas as a centre transform. */
  viewScale: number
  seams: Map<string, SeamSides>
  stickers: Sticker[]
  labels: PaneLabel[]
  photoById: Map<string, Photo>
  focusId: string
  paneBorder: boolean
  blendCrossfade: boolean
  fadeStrength: number
  transparent: boolean
  bg: string
  wsId: string
  stageRef: React.RefObject<HTMLDivElement | null>
  sizing: boolean
  isLit: (id: string) => boolean
  onHotChange: React.Dispatch<React.SetStateAction<string | null>>
  onBeginDrag: (d: Divider) => (e: React.PointerEvent) => void
  onBeginResize: React.PointerEventHandler<HTMLDivElement>
  onResetRatio: () => void
  onFocus: (paneId: string) => void
  onSelectLabel: (labelId: string | null) => void
  onUpdate: React.ComponentProps<typeof Pane>['onUpdate']
  onSplit: React.ComponentProps<typeof Pane>['onSplit']
  onClose: React.ComponentProps<typeof Pane>['onClose']
}) {
  // Backdrop blend: pane edges feather into the shared blurred field behind
  // everything (width 0 turns the whole treatment off).
  const paneFade = view.fade
  const t = useT()

  return (
    <CanvasMenu>
      <div
        className="flex min-h-0 w-full flex-1 items-center justify-center"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) {
            onFocus('')
            onSelectLabel(null)
          }
        }}
      >
        <div
          ref={stageRef}
          data-canvas-view={viewScale}
          className={`relative flex-none shadow-[0_16px_50px_rgba(0,0,0,0.6)] ${transparent ? ' stage-clear' : ''}`}
          style={{ width: view.W, height: view.H, background: transparent ? undefined : bg, transform: viewTransform(viewScale), viewTransitionName: `ws-${wsId}` }}
        >
          <CollageBgLayer W={view.W} H={view.H} photoById={photoById} />
          {!blendCrossfade && (
            <SeamLayer view={view} photoById={photoById} paneFade={paneFade} fadeStrength={fadeStrength} />
          )}

          <PaneLayers
            view={view}
            draws={paneDraws(view, seams, blendCrossfade, paneFade, fadeStrength)}
            photoById={photoById}
            focusId={focusId}
            paneBorder={paneBorder}
            crossfade={blendCrossfade}
            onFocus={onFocus}
            onUpdate={onUpdate}
            onSplit={onSplit}
            onClose={onClose}
          />

          <CutoutProgress view={view} />

          <BoardInserts
            stickers={stickers}
            labels={labels}
            unit={view.unit}
            photoById={photoById}
            board={{ w: view.W, h: view.H }}
            stageRef={stageRef}
          />

          <DividerChrome
            view={view}
            focused={!!focusId}
            isLit={isLit}
            onBeginDrag={onBeginDrag}
            onHotChange={onHotChange}
          />

          <CanvasResizeHandle
            sizing={sizing}
            label={t('Drag to change canvas aspect · double-click to reset')}
            onPointerDown={onBeginResize}
            onDoubleClick={onResetRatio}
          />
        </div>
      </div>
    </CanvasMenu>
  )
}

/**
 * The dock's content for the stage: appearance and grid tools, then either the
 * selected label's controls or the focused pane's tools, in one fixed order.
 */
function StageToolsDockImpl({ tools, paneToolsHidden, focusHasGps, focusId }: {
  tools: ToolDef[]
  paneToolsHidden: boolean
  focusHasGps: boolean
  focusId: string
}) {
  const labelSel = useStore(s => s.labelSel)
  const setLabel = useStore(s => s.setLabel)
  const removeLabel = useStore(s => s.removeLabel)
  const boardLabels = useStore(s => activeWs(s).labels ?? NO_LABELS)
  // Below lg the label's floating toolbar is hidden, so the dock takes over
  // its controls while a label is selected.
  const compact = useMediaQuery('(max-width: 1023.98px)')
  const dockLabel = compact && labelSel ? boardLabels.find(l => l.id === labelSel) ?? null : null

  return (
    <ToolsDock
      hidden={false}
      contextKey={dockLabel ? 'label' : (paneToolsHidden ? 'canvas' : 'pane')}
    >
      <AppearanceDockTools />
      <GridDockTool disabled />
      <GridBoardTools route="stage" />
      {dockLabel
        ? (
            <LabelDockTools
              labelId={dockLabel.id}
              lab={dockLabel}
              setLabel={setLabel}
              onDelete={() => removeLabel(dockLabel.id)}
              onInsertLocation={focusHasGps && focusId ? () => insertLocationLabel(focusId) : undefined}
            />
          )
        : tools.map(({ key, ...tool }) => <ToolButton key={key} {...tool} />)}
      {/* The detent rotation dial + flips: a sibling of the pane tools, so
          their fixed order and list stay untouched. */}
      <PaneRotateTool hidden={!!dockLabel} />
      {/* Texture filters: also a sibling, next to the turn controls. Both
          act on the photo a pane holds, and neither disturbs the list. */}
      <PaneFilterTool hidden={!!dockLabel} />
    </ToolsDock>
  )
}

/**
 * One photo of the shared blurred backdrop field: painted unclipped and
 *  blurred so the panes' feathered edges melt into one continuous field.
 */
function BackdropLeaf({ leaf, rect, photo, radius }: {
  leaf: Leaf
  rect: Rect
  photo: Photo
  radius: number
}) {
  const preview = usePreview(photo)
  if (!preview)
    return null
  const place = placement(rect, leaf, preview.w, preview.h)
  return (
    <img
      src={preview.url}
      alt=""
      draggable={false}
      className="pointer-events-none absolute block max-w-none"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        transformOrigin: '0 0',
        transform: `translate(${place.x}px, ${place.y}px) scale(${place.scale})`,
        filter: `blur(${radius}px)`,
      }}
    />
  )
}

/**
 * The blurred photo field behind all panes; `opacity` is the blend strength.
 * Shared with the 3×3 workspace preview (WorkspaceGrid), which renders it
 * scaled into the cell.
 */
export function SeamBackdrop({ leaves, photoById, radius, opacity, gap = 0 }: {
  leaves: { node: Leaf, rect: Rect }[]
  photoById: Map<string, Photo>
  radius: number
  opacity: number
  gap?: number
}) {
  // Backdrop only where a photo seam exists; panes without a
  // photo-bearing neighbor skip it, so empty neighbors stay blank
  // instead of bleeding a blurred copy of the filled pane.
  const seams = useMemo(() => seamSides(leaves, gap), [leaves, gap])
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ opacity }}>
      {leaves.map(({ node, rect }) => {
        const photo = node.photoId ? photoById.get(node.photoId) : undefined
        const seam = seams.get(node.id)
        if (!photo || !seam || !(seam.left || seam.right || seam.top || seam.bottom))
          return null
        return <BackdropLeaf key={node.id} leaf={node} rect={rect} photo={photo} radius={radius} />
      })}
    </div>
  )
}

/** The shared blurred backdrop layer, drawn only while the edge fade is on. */
function SeamLayer({ view, photoById, paneFade, fadeStrength }: {
  view: Derived
  photoById: Map<string, Photo>
  paneFade: number
  fadeStrength: number
}) {
  if (paneFade <= 0)
    return null
  return (
    <SeamBackdrop
      leaves={view.leaves}
      photoById={photoById}
      radius={Math.max(view.unit * 40, view.fade)}
      opacity={fadeStrength / 100}
      gap={view.gap}
    />
  )
}

/** The photo panes themselves: one `Pane` per draw of the layout. */
function PaneLayers({ view, draws, photoById, focusId, paneBorder, crossfade, onFocus, onUpdate, onSplit, onClose }: {
  view: Derived
  /** Every pane's cell and drawn box, from `paneDraws` (one source of truth). */
  draws: PaneDraw[]
  photoById: Map<string, Photo>
  focusId: string | null
  paneBorder: boolean
  crossfade: boolean
  onFocus: React.ComponentProps<typeof Pane>['onFocus']
  onUpdate: React.ComponentProps<typeof Pane>['onUpdate']
  onSplit: React.ComponentProps<typeof Pane>['onSplit']
  onClose: React.ComponentProps<typeof Pane>['onClose']
}) {
  return (
    <>
      {draws.map(({ leaf: node, rect, draw, fade, seam }) => {
        return (
          <Pane
            key={node.id}
            leaf={node}
            layoutRect={crossfade ? rect : undefined}
            rect={draw}
            radius={view.radius}
            gap={view.gap}
            bordered={paneBorder}
            fade={fade}
            seam={seam}
            unit={view.unit}
            crossfade={crossfade}
            photo={node.photoId ? (photoById.get(node.photoId) ?? null) : null}
            photoById={photoById}
            focused={focusId === node.id}
            canClose={view.leaves.length > 1}
            onFocus={onFocus}
            onUpdate={onUpdate}
            onSplit={onSplit}
            onClose={onClose}
          />
        )
      })}
    </>
  )
}

/**
 * The divider drag chrome: a 15px hit band per divider, plus the grip that
 * rides a layer above every line so the thing you see is the thing you grab.
 */
function DividerChrome({ view, focused, isLit, onBeginDrag, onHotChange }: {
  view: Derived
  focused: boolean
  isLit: (id: string) => boolean
  onBeginDrag: (d: Divider) => (e: React.PointerEvent) => void
  onHotChange: React.Dispatch<React.SetStateAction<string | null>>
}) {
  return (
    <>
      {view.dividers.map((d) => {
        const vertical = d.dir === 'row'
        return (
          <div
            key={d.id}
            data-divider-band={d.id}
            className={`absolute z-[5] touch-none ${vertical ? 'cursor-col-resize' : 'cursor-row-resize'}`}
            style={dividerBandStyle(d, view.gap, HIT_MIN)}
            onPointerDown={onBeginDrag(d)}
            // The grip lives in the layer above, so it cannot light itself
            // off this hover: a mouse is tracked here, a finger only
            // through the drag (no hover to lose).
            onPointerEnter={(e) => {
              if (e.pointerType === 'mouse')
                onHotChange(d.id)
            }}
            onPointerLeave={() => onHotChange(h => (h === d.id ? null : h))}
          >
            <span
              className={
                `absolute rounded-none transition-colors duration-(--dur-fast) ${
                  vertical
                    ? 'bottom-0 left-1/2 top-0 w-[5px] -translate-x-1/2'
                    : 'left-0 right-0 top-1/2 h-[5px] -translate-y-1/2'} ${
                  isLit(d.id) ? 'bg-accent' : 'bg-transparent'}`
              }
            />
          </div>
        )
      })}

      {/* Grips, one layer above every line: shadcn/`react-resizable-panels`
          style, as wide as the 15px band, so the thing you see is the
          thing you grab. Shown only while a pane is focused. (Above the
          lines: see the T-junction note in DESIGN.md.) */}
      <div
        className={`pointer-events-none absolute inset-0 z-[6] transition-opacity duration-(--dur-fast) ${
          focused ? 'opacity-100' : 'opacity-0'}`}
      >
        {view.dividers.map((d) => {
          const vertical = d.dir === 'row'
          const lit = isLit(d.id)
          return (
            <span
              key={d.id}
              data-divider-grip={d.id}
              style={dividerGripStyle(d, view.gap)}
              className={
                `absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[6px] border backdrop-blur-[7px] transition-colors duration-(--dur-fast) ${
                  lit
                    ? 'border-accent bg-accent text-on-accent'
                    : 'border-float-line bg-float-bg text-float-icon'} ${
                  vertical
                    ? 'h-[30px] w-[15px] pointer-coarse:h-[38px] pointer-coarse:w-[19px]'
                    : 'h-[15px] w-[30px] pointer-coarse:h-[19px] pointer-coarse:w-[38px]'}`
              }
            >
              <MorphIcon icon={GripVertical} size={15} strokeWidth={1.75} className={vertical ? '' : 'rotate-90'} />
            </span>
          )
        })}
      </div>
    </>
  )
}

/**
 * The canvas aspect handle: a chip straddling the bottom-right corner, dragging
 * it reshapes the canvas and double-clicking follows the first photo again.
 *
 * It is pinned to that corner, always: it is board chrome, so it rides the
 * canvas and the view zoom and nothing else. The tools sheet may cover it (the
 * sheet is an overlay with no put-away state, and a tall canvas runs under it),
 * which is exactly the job the right-edge rail exists for: this one reshapes the
 * canvas, that one scales it. Scaled past the fit the canvas's corner itself
 * leaves the stage, and the handle goes with the corner it marks.
 */
function CanvasResizeHandle({ sizing, label, onPointerDown, onDoubleClick }: {
  sizing: boolean
  label: string
  onPointerDown: React.PointerEventHandler<HTMLDivElement>
  onDoubleClick: React.MouseEventHandler<HTMLDivElement>
}) {
  return (
    <div
      data-canvas-resize-handle=""
      className={`absolute -right-3.5 -bottom-3.5 z-[8] grid h-7 w-7 cursor-nwse-resize touch-none place-items-center rounded-none border bg-float-bg-2 text-handle-txt backdrop-blur-[6px] transition-[background-color,border-color,color,scale] duration-(--dur-fast) active:scale-[0.97] hover:border-accent hover:bg-accent hover:text-on-accent ${sizing ? ' border-accent bg-accent text-on-accent' : ''}`}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      title={label}
    >
      <MorphIcon icon={sizing ? Scaling : MoveDiagonal2} size={19} strokeWidth={2.5} />
    </div>
  )
}

/**
 * The focused pane's dock tools. Below lg the dock also carries the split and
 * the pane context menu's touch-friendly rows (desktop keeps those in the
 * hover chip and right-click menu); every command comes from lib/paneCommands
 * (the layout and view ones re-exported from lib/paneLayoutCommands).
 */
const NO_PHOTOS = new Map<string, Photo>()

const isFilled = (w: { root: Node }) => leafList(w.root).some(l => l.photoId)

/**
 * Grid whole-board tools (Shuffle, Cell ratio, Clear), next to
 * Grid gap. `requires: 'grid'` disables them on the stage; `when` gates on
 * what the board holds.
 */
function GridBoardTools({ route }: { route: DockRoute }) {
  const t = useT()
  const filled = useStore(s => s.workspaces.filter(isFilled).length)
  const ratio = useStore(s => s.gridCellRatio)
  const patch = useStore(s => s.patch)
  const [askClear, setAskClear] = useState(false)
  const ctx = { pane: null, route }
  const onGrid = (run: () => void, ok = true) => (ok ? bindAction({ requires: 'grid', run }, ctx) : null)
  const tools: ToolDef[] = [
    { key: 'shuffle', icon: Shuffle, label: t('Shuffle'), hint: t('Randomly reorder the cells with photos'), onClick: onGrid(() => useStore.getState().shuffleWorkspaces(), filled >= 2) },
    {
      key: 'cell-ratio',
      icon: RectangleHorizontal,
      label: ratio,
      hint: t('Cell aspect ratio'),
      options: GRID_CELL_RATIOS.map(r => ({ key: r, icon: r === ratio ? Check : Ratio, label: r, onClick: onGrid(() => patch({ gridCellRatio: r })) })),
    },
    { key: 'clear', icon: Eraser, label: t('Clear'), hint: t('Remove all photos from the cells'), onClick: onGrid(() => setAskClear(true), filled > 0) },
  ]
  return (
    <>
      {tools.map(({ key, ...tool }) => <ToolButton key={key} {...tool} />)}
      <ConfirmDialog
        open={askClear}
        title={t('Clear all cells?')}
        description={t('This removes every photo from the grid cells. Layouts and the library stay. This cannot be undone.')}
        confirmLabel={t('Clear')}
        danger
        onClose={() => setAskClear(false)}
        onConfirm={() => {
          useStore.getState().clearGridPhotos()
          setAskClear(false)
        }}
      />
    </>
  )
}

/**
 * The full dock tool set on every route, in one fixed order so buttons never
 * jump between stage and grid: Border, Grid gap, then the pane tools. Off
 * the stage (or without a selection/photo) tools render disabled.
 */
export function DockToolset({ route }: { route: DockRoute }) {
  const { tools } = usePaneTools('', null, NO_PHOTOS, route)
  return (
    <>
      <AppearanceDockTools />
      <GridDockTool disabled={!canRun('grid', { pane: null, route })} />
      <GridBoardTools route={route} />
      {tools.map(({ key, ...tool }) => <ToolButton key={key} {...tool} />)}
    </>
  )
}

/**
 * The dock's Cut out tool: ONE icon whose popover holds the three states of the
 * photo's cutout (see `lib/cutoutVariants`). A row is checked when the pane
 * already shows it and disabled with its reason when the asset behind it
 * cannot be reached; the first visit to a cut state runs the model, and
 * Blurred also bakes the composite. Picking the state the pane is already in
 * is a no-op, not an error, so those rows stay usable.
 */
function cutoutMenuTool(t: Translate, ctx: {
  photo: Photo | null
  cutouts: CutoutMap
  sets: CutoutSets
  busy: boolean
  has: (id: string) => boolean
  apply: (paneId: string, photo: Photo, target: CutoutState) => void
  paneId: string | null
}): ToolDef {
  const variants = ctx.photo ? variantsOf(ctx.cutouts, ctx.sets, ctx.photo.id, ctx.has) : null
  const source = variants?.source ?? null
  const canPick = !ctx.busy && !!ctx.paneId && !!ctx.photo
  const row = (key: CutoutState, icon: IconInput, label: string, reachable: boolean): ToolOption => ({
    key,
    icon,
    label,
    active: variants?.state === key,
    reason: ctx.busy ? t('Cutting out…') : reachable ? undefined : t('The original photo is gone'),
    onClick: canPick && reachable ? () => ctx.apply(ctx.paneId!, ctx.photo!, key) : null,
  })
  return {
    key: 'cutout',
    icon: Scissors,
    label: t('Cut out'),
    hint: t('Cut out, or switch the background'),
    options: [
      // Original needs the source itself; the two cut rows need either their
      // own asset or a source to make it from.
      row('original', Undo2, t('Original'), !!source),
      row('cutout', Scissors, t('Cut out'), !!variants?.cutout || !!source),
      row('blurred', Blend, t('Blurred background'), !!variants?.blurred || !!source),
    ],
  }
}

/**
 * What the dock's pane tools are built from: the focused pane as scalars (its
 * id, whether it holds a photo, which one, where its rect is), the cutout
 * state, and the live board for the closures to resolve a pane through.
 *
 * Scalars rather than the `Derived` itself are the point. A pan rewrites the
 * focused leaf's view fields on every pointermove, so a list keyed on the board
 * was rebuilt per frame, and every base-ui trigger, popover and MorphIcon in
 * the dock with it. That rebuild is what made dragging a photo stutter on a
 * phone. None of these inputs change while a photo is dragged, so none of the
 * dock re-renders for it. `live` keeps a memoized tool honest about the board
 * it acts on when a click finally runs it.
 */
interface PaneToolsInput {
  t: ReturnType<typeof useT>
  focusId: string
  route: DockRoute
  hasPhoto: boolean
  focusPhotoId: string
  cutouts: CutoutMap
  cutoutSets: CutoutSets
  cutoutBusy: boolean
  photoById: Map<string, Photo>
  live: React.RefObject<Derived | null>
  removePhoto: (paneId: string) => void
  resetPane: (paneId: string) => void
  openStickerMaker: (paneId: string | null) => void
}

function buildPaneTools(input: PaneToolsInput) {
  const { t, focusId, route, hasPhoto, focusPhotoId, cutouts, cutoutSets, cutoutBusy, photoById, live, removePhoto, resetPane, openStickerMaker } = input
  // The pane's rect is read when a tool runs, not captured: a ratio drag moves
  // every rect on every frame, and capturing one would rebuild the dock for it.
  const rectOf = (id: string) => live.current?.leaves.find(l => l.node.id === id)?.rect
  // Context key only (the dock always shows the full set): no photo = canvas.
  const toolsHidden = !hasPhoto
  // One context for every pane tool: a stale or empty focus yields no pane,
  // so `bindAction` disables every pane-scoped tool in the same place.
  const ctx = {
    ...paneContext<Photo>(focusId, (id) => {
      const leaf = live.current?.leaves.find(l => l.node.id === id)?.node
      return leaf ? { photo: (leaf.photoId && photoById.get(leaf.photoId)) || null } : null
    }),
    route,
  }
  const bind = (a: Action<Photo>) => bindAction(a, ctx)
  const onPane = (run: (paneId: string) => void): Action<Photo> => ({ requires: 'pane', run: p => run(p.paneId) })

  const splitTool: ToolDef = {
    key: 'split',
    icon: Columns2,
    label: t('Split'),
    hint: t('Split this pane'),
    options: [
      { key: 'column', icon: SquareSplitVertical, label: t('Split top/bottom'), onClick: bind(onPane(id => splitPane(id, 'column'))) },
      { key: 'row', icon: SquareSplitHorizontal, label: t('Split left/right'), onClick: bind(onPane(id => splitPane(id, 'row'))) },
    ],
  }
  // The cutout's three states, switchable any time from one menu (see
  // lib/cutoutVariants for what each row resolves to).
  const cutoutTool: ToolDef = cutoutMenuTool(t, {
    photo: focusPhotoId ? photoById.get(focusPhotoId) ?? null : null,
    cutouts,
    sets: cutoutSets,
    busy: cutoutBusy,
    has: id => photoById.has(id),
    apply: (paneId, photo, target) => void applyCutoutState(paneId, photo, target),
    paneId: focusId || null,
  })
  const textTool: ToolDef = { key: 'text', icon: Type, label: t('Text'), hint: t('Add a text label'), onClick: bind(onPane(addLabelToPane)) }
  // The photo's EXIF fix, when it has one. Disabled (not hidden) without GPS,
  // like every other tool that does not apply to the focused pane.
  const locationTool = locationToolFor(t, bind)
  // Full set, fixed order on every route and breakpoint: what does not apply
  // is disabled by `bindAction`, never hidden, so nothing shifts.
  const tools: ToolDef[] = [
    { key: 'photo', icon: ImagePlus, label: hasPhoto ? t('Replace') : t('Photo'), hint: hasPhoto ? t('Pick a photo to replace this pane\'s photo') : t('Choose a photo'), onClick: bind(onPane(pickPhotoForPane)) },
    splitTool,
    { key: 'sticker', icon: StickerIcon, label: t('Sticker'), hint: t('Pick images and pin them onto this photo'), onClick: bind({ requires: 'photo', run: p => pickStickersForPane(p.paneId) }) },
    cutoutTool,
    { key: 'make', icon: WandSparkles, label: t('Make'), hint: t('Make a sticker from text or an image'), onClick: bind({ requires: 'photo', run: p => openStickerMaker(p.paneId) }) },
    // The focused pane takes the finished card. The library header opens the
    // same dialog with no target, where the card is only added to the library.
    {
      key: 'music',
      icon: Music,
      label: t('Music'),
      hint: focusId ? t('Make a music card and place it in this pane') : t('Make a music card from a Spotify or Apple Music link'),
      onClick: () => useStore.getState().openMusicCard(focusId || null),
    },
    textTool,
    locationTool,
    {
      key: 'view',
      icon: ImageIcon,
      label: t('Fit'),
      hint: t('Photo'),
      options: [
        { key: 'reset', icon: Maximize, label: t('Reset zoom'), onClick: bind({ requires: 'photo', run: p => resetPaneView(p.paneId) }) },
        { key: 'fit', icon: Frame, label: t('Fit whole photo'), onClick: bind({ requires: 'photo', run: p => fitPanePhoto(p.paneId, p.photo.trueW, p.photo.trueH, rectOf(p.paneId)) }) },
        { key: 'match', icon: Ratio, label: t('Match the canvas to this photo'), onClick: bind({ requires: 'photo', when: p => !!p.photo.trueW, run: p => matchCanvasToPhoto(p.photo.trueW, p.photo.trueH) }) },
      ],
    },
    { key: 'dup', icon: CopyPlus, label: t('Duplicate'), hint: t('Duplicate pane'), onClick: bind(onPane(id => duplicatePaneAuto(id, rectOf(id)))) },
    { key: 'remove', icon: Trash2, label: t('Remove'), hint: t('Remove photo'), onClick: bind({ requires: 'photo', run: p => removePhoto(p.paneId) }) },
    { key: 'reset', icon: RotateCcw, label: t('Reset'), hint: t('Reset this pane'), onClick: bind(onPane(resetPane)) },
  ]

  return { tools, toolsHidden }
}

function usePaneTools(focusId: string, view: Derived | null, photoById: Map<string, Photo>, route: DockRoute = 'stage') {
  const t = useT()
  const removePhoto = useStore(s => s.removePhoto)
  const resetPane = useStore(s => s.resetPane)
  const openStickerMaker = useStore(s => s.openStickerMaker)
  const cutouts = useStore(s => s.cutouts)
  const cutoutSets = useStore(s => s.cutoutSets)
  const cutoutBusy = useStore(s => !!s.cutoutJob)

  // The board a tool acts on when it finally runs: a ref, not a dependency, so
  // the tool list is not rebuilt when the board moves under it. Updated after
  // commit, which every click or keypress that reaches a tool follows.
  const liveRef = useRef<Derived | null>(view)
  useLayoutEffect(() => {
    liveRef.current = view
  }, [view])
  const focusHit = focusId && view ? view.leaves.find(l => l.node.id === focusId) : undefined
  const focusLeaf = focusHit?.node ?? null
  const hasPhoto = !!(focusLeaf?.photoId)
  return useMemo(
    () =>
      buildPaneTools({
        t,
        focusId,
        route,
        hasPhoto,
        focusPhotoId: focusLeaf?.photoId ?? '',
        cutouts,
        cutoutSets,
        cutoutBusy,
        photoById,
        live: liveRef,
        removePhoto,
        resetPane,
        openStickerMaker,
      }),
    [t, focusId, route, hasPhoto, focusLeaf?.photoId, cutouts, cutoutSets, cutoutBusy, photoById, removePhoto, resetPane, openStickerMaker],
  )
}

/** Progress veil over the pane whose photo is being cut out (see lib/paneCutout). */
function CutoutProgress({ view }: { view: Derived }) {
  const job = useStore(s => s.cutoutJob)
  const t = useT()
  const rect = job ? view.leaves.find(l => l.node.id === job.paneId)?.rect : undefined
  if (!job || !rect)
    return null
  const pct = job.progress != null ? Math.round(job.progress) : null
  return (
    <div
      role="status"
      aria-live="polite"
      data-cutout-progress=""
      className="pointer-events-none absolute z-20 flex flex-col items-center justify-center gap-2 bg-black/45 text-xs text-white backdrop-blur-[2px]"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      <span>{job.phase === 'loading' ? t('Loading the cutout model…') : t('Cutting out…')}</span>
      <span className="block h-1 w-[min(140px,60%)] overflow-hidden bg-white/25">
        <span
          className={`block h-full bg-white ${pct == null || job.phase === 'processing' ? ' w-1/3 animate-pulse' : ''}`}
          style={pct != null && job.phase === 'loading' ? { width: `${pct}%` } : undefined}
        />
      </span>
    </div>
  )
}
