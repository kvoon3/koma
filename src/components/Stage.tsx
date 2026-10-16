import type { IconInput } from 'morphicons/react'
import type { Photo } from '../lib/imageStore'
import type { Divider, Leaf, PaneLabel, Rect, SeamSides, Sticker } from '../lib/panes'
import type { Derived } from '../store'
import { Popover } from '@base-ui/react/popover'
import { Columns2, CopyPlus, Frame, GripVertical, Image as ImageIcon, ImagePlus, Maximize, MoveDiagonal2, Ratio, RotateCcw, Scaling, SquareSplitHorizontal, SquareSplitVertical, Sticker as StickerIcon, Trash2, Type, WandSparkles, X } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useElementSize, useMediaQuery, usePreview } from '../hooks'
import { useT } from '../lib/i18n'
import { addLabelToPane, duplicatePaneAuto, fitPanePhoto, matchCanvasToPhoto, pickPhotoForPane, pickStickersForPane, resetPaneView, splitPane } from '../lib/paneCommands'
import { blendFadePx, dividerLine, expandRectForBlend, placement, ratioFromPointer, seamSides } from '../lib/panes'
import { activeWs, computeLayout, fitCanvas, isTransparentBg, MIN_PANE_PX, useStore } from '../store'
import { AppearanceDockTools } from './AppearanceTools'
import { BoardInserts } from './BoardInserts'
import { LabelDockTools } from './BoardLabel'
import { CanvasMenu } from './CanvasMenu'
import { Pane } from './Pane'
import { StickerMakerDialog } from './StickerMakerDialog'
import { toolsBtnCls, ToolsDock, toolsLabelCls } from './ToolsDock'
import { dockBtnStateCls, dockPopupMotionCls, menuItemCls, menuSurfaceCls } from './ui/menu'

const NO_STICKERS: Sticker[] = []
const NO_LABELS: PaneLabel[] = []

const HIT_MIN = 15
const MIN_CANVAS = 120

interface ToolDef {
  key: string
  icon: IconInput
  label: string
  hint: string
  onClick?: () => void
  /** Options: the icon opens a small popover above itself instead of acting. */
  options?: ToolOption[]
  danger?: boolean
}

interface ToolOption {
  key: string
  icon: IconInput
  label: string
  disabled?: boolean
  onClick: () => void
}

const toolPopupCls = `${menuSurfaceCls} ${dockPopupMotionCls} min-w-[170px]`

/** A dock tool with options: a Base UI Popover anchored above the icon. */
function ToolPopoverButton({ icon, label, hint, options }: Omit<ToolDef, 'key'> & { options: ToolOption[] }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={`${toolsBtnCls} ${dockBtnStateCls}`}
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
                className={`${menuItemCls} hover:bg-chip-hover disabled:cursor-default disabled:opacity-35`}
                disabled={o.disabled}
                onClick={() => {
                  setOpen(false)
                  o.onClick()
                }}
              >
                <MorphIcon icon={o.icon} size={15} strokeWidth={1.75} />
                {o.label}
              </button>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

function ToolButton({ icon, label, hint, onClick, options, danger }: Omit<ToolDef, 'key'>) {
  if (options)
    return <ToolPopoverButton icon={icon} label={label} hint={hint} options={options} />
  return (
    <button
      className={`${toolsBtnCls} ${dockBtnStateCls}${danger ? ' text-danger hover:text-danger' : ''}`}
      title={hint}
      aria-label={label}
      data-dock-tool={label}
      onClick={onClick}
    >
      <MorphIcon icon={icon} size={22} strokeWidth={1.5} />
      <span className={toolsLabelCls}>{label}</span>
    </button>
  )
}

export function Stage() {
  const [wrapRef, wrapSize] = useElementSize<HTMLDivElement>()
  const stageRef = useRef<HTMLDivElement | null>(null)
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
  /** Hovered or being dragged: what lights a divider's grip and its line. */
  const isLit = (id: string) => hotId === id || dragId === id
  const [sizing, setSizing] = useState(false)
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

  const transparent = isTransparentBg(bg)

  const view = useMemo(
    () =>
      computeLayout(
        root,
        canvasRatio,
        canvasFill,
        Math.max(160, wrapSize.w - 48),
        Math.max(160, wrapSize.h - 48),
        gapValue,
        radiusValue,
        fadeValue,
      ),
    [root, canvasRatio, canvasFill, wrapSize, gapValue, radiusValue, fadeValue],
  )

  // Which pane edges are seams (face another photo); recomputed with the layout.
  const seams = useMemo(() => seamSides(view.leaves, view.gap), [view])
  // Backdrop blend: pane edges feather into the shared blurred field behind
  // everything (width 0 turns the whole treatment off).
  const paneFade = view.fade

  const photoById = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos])

  const dragRef = useRef<Divider | null>(null)

  const beginDrag = useCallback((d: Divider) => {
    return (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragRef.current = d
      setDragId(d.id)
    }
  }, [])

  useEffect(() => {
    if (dragId == null)
      return
    const move = (e: PointerEvent) => {
      const d = dragRef.current
      const r = stageRef.current?.getBoundingClientRect()
      if (!d || !r)
        return
      resizeSplit(
        d.id,
        ratioFromPointer(d, e.clientX - r.left, e.clientY - r.top, view.gap, MIN_PANE_PX),
      )
    }
    const up = () => {
      dragRef.current = null
      setDragId(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [dragId, view.gap, resizeSplit])

  const sizeRef = useRef<{
    cx: number
    cy: number
    availW: number
    availH: number
  } | null>(null)

  const beginResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const r = wrapRef.current?.getBoundingClientRect()
      if (!r)
        return
      sizeRef.current = {
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        availW: Math.max(160, r.width - 48),
        availH: Math.max(160, r.height - 48),
      }
      setSizing(true)
      focus('')
    },
    [wrapRef, focus],
  )

  useEffect(() => {
    if (!sizing)
      return
    const move = (e: PointerEvent) => {
      const d = sizeRef.current
      if (!d)
        return
      const hx = Math.max(MIN_CANVAS / 2, e.clientX - d.cx)
      const hy = Math.max(MIN_CANVAS / 2, e.clientY - d.cy)
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
  }, [sizing, setCanvasSize])

  useEffect(() => {
    // Pinch/ctrl+wheel over the canvas background (or a pane without a photo)
    // must never zoom the browser page: send it to the focused pane instead.
    const el = wrapRef.current
    if (!el)
      return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || e.defaultPrevented)
        return
      e.preventDefault()
      const focusId = activeWs(useStore.getState()).focusId
      if (!focusId)
        return
      el.querySelector<HTMLElement>(`[data-pane-id="${CSS.escape(focusId)}"]`)
        ?.dispatchEvent(new WheelEvent('wheel', e))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [wrapRef])

  const resetRatio = useCallback(() => {
    const s = useStore.getState()
    const first = s.photos.find(p => p.trueW)
    // canvasRatio lives on the workspace now, so reset through setCanvasSize
    // (which always needs a number: fall back to the current ratio).
    s.setCanvasSize(first ? first.trueW / first.trueH : (activeWs(s).canvasRatio ?? 1.5), 1)
  }, [])

  const { tools, toolsHidden: paneToolsHidden } = usePaneTools(focusId, view, photoById)
  const labelSel = useStore(s => s.labelSel)
  const setLabel = useStore(s => s.setLabel)
  const removeLabel = useStore(s => s.removeLabel)
  // Below lg the label's floating toolbar is hidden, so the dock takes over
  // its controls while a label is selected.
  const compact = useMediaQuery('(max-width: 1023.98px)')
  const dockLabel = compact && labelSel ? boardLabels.find(l => l.id === labelSel) ?? null : null
  // Canvas appearance tools always live in the dock; pane/label tools join when relevant.
  const toolsHidden = false

  return (
    <div
      ref={wrapRef}
      className={`stage-checker absolute inset-0 flex touch-none flex-col items-center justify-center ${dragId ? ' cursor-col-resize! [&_*]:cursor-col-resize!' : ''}${sizing ? ' cursor-nwse-resize! [&_*]:cursor-nwse-resize!' : ''}`}
    >
      <CanvasMenu>
        <div
          className="flex min-h-0 w-full flex-1 items-center justify-center"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              focus('')
              selectLabel(null)
            }
          }}
        >
          <div
            ref={stageRef}
            className={`relative shadow-[0_16px_50px_rgba(0,0,0,0.6)] ${transparent ? ' stage-clear' : ''}`}
            style={{ width: view.W, height: view.H, background: transparent ? undefined : bg, viewTransitionName: `ws-${wsId}` }}
          >
            {!blendCrossfade && (
              <SeamLayer view={view} photoById={photoById} paneFade={paneFade} fadeStrength={fadeStrength} />
            )}

            <PaneLayers
              view={view}
              seams={seams}
              photoById={photoById}
              focusId={focusId}
              paneBorder={paneBorder}
              paneFade={blendCrossfade ? blendFadePx(paneFade, fadeStrength, view.gap) : paneFade}
              crossfade={blendCrossfade}
              onFocus={focus}
              onUpdate={updateLeaf}
              onSplit={split}
              onClose={closePane}
            />

            <BoardInserts
              stickers={boardStickers}
              labels={boardLabels}
              unit={view.unit}
              photoById={photoById}
              board={{ w: view.W, h: view.H }}
              stageRef={stageRef}
            />

            <DividerChrome
              view={view}
              focused={!!focusId}
              isLit={isLit}
              onBeginDrag={beginDrag}
              onHotChange={setHotId}
            />

            <CanvasResizeHandle
              sizing={sizing}
              label={t('Drag to change canvas aspect · double-click to reset')}
              onPointerDown={beginResize}
              onDoubleClick={resetRatio}
            />
          </div>
        </div>
      </CanvasMenu>

      {/* Tools dock: Border (appearance panel) always here; pane/label tools join
          when relevant. Base UI Drawer snap points: collapsed / row / expanded. */}
      <ToolsDock
        hidden={toolsHidden}
        contextKey={dockLabel ? 'label' : (paneToolsHidden ? 'canvas' : 'pane')}
      >
        <AppearanceDockTools />
        {dockLabel
          ? (
              <LabelDockTools
                labelId={dockLabel.id}
                lab={dockLabel}
                setLabel={setLabel}
                onDelete={() => removeLabel(dockLabel.id)}
              />
            )
          : tools.map(({ key, ...tool }) => <ToolButton key={key} {...tool} />)}
      </ToolsDock>

      <StickerMakerDialog open={stickerMakerFor != null} paneId={stickerMakerFor} onClose={() => openStickerMaker(null)} />
    </div>
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

/** The photo panes themselves: one `Pane` per leaf of the layout. */
function PaneLayers({ view, seams, photoById, focusId, paneBorder, paneFade, crossfade, onFocus, onUpdate, onSplit, onClose }: {
  view: Derived
  seams: Map<string, SeamSides>
  photoById: Map<string, Photo>
  focusId: string | null
  paneBorder: boolean
  paneFade: number
  crossfade: boolean
  onFocus: React.ComponentProps<typeof Pane>['onFocus']
  onUpdate: React.ComponentProps<typeof Pane>['onUpdate']
  onSplit: React.ComponentProps<typeof Pane>['onSplit']
  onClose: React.ComponentProps<typeof Pane>['onClose']
}) {
  return (
    <>
      {view.leaves.map(({ node, rect }) => {
        const seam = seams.get(node.id)
        const draw = crossfade && node.photoId ? expandRectForBlend(rect, seam, paneFade) : rect
        const fade = crossfade && !node.photoId ? 0 : paneFade
        return (
          <Pane
            key={node.id}
            leaf={node}
            layoutRect={crossfade ? rect : undefined}
            rect={draw}
            radius={view.radius}
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
        const line = dividerLine(d, view.gap)
        const hit = Math.max(view.gap, HIT_MIN)
        const vertical = d.dir === 'row'
        const style: React.CSSProperties
          = vertical
            ? { left: (line.x ?? 0) - hit / 2, top: d.area.y, width: hit, height: d.area.h }
            : { left: d.area.x, top: (line.y ?? 0) - hit / 2, width: d.area.w, height: hit }
        return (
          <div
            key={d.id}
            className={`absolute z-[5] touch-none ${vertical ? 'cursor-col-resize' : 'cursor-row-resize'}`}
            style={style}
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
          const line = dividerLine(d, view.gap)
          return (
            <span
              key={d.id}
              style={vertical
                ? { left: line.x, top: d.area.y + d.area.h / 2 }
                : { left: d.area.x + d.area.w / 2, top: line.y }}
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

/** The bottom-right canvas resize handle. */
function CanvasResizeHandle({ sizing, label, onPointerDown, onDoubleClick }: {
  sizing: boolean
  label: string
  onPointerDown: React.PointerEventHandler<HTMLDivElement>
  onDoubleClick: React.MouseEventHandler<HTMLDivElement>
}) {
  return (
    <div
      className={`absolute -right-[13px] -bottom-[13px] z-[8] grid h-7 w-7 cursor-nwse-resize touch-none place-items-center rounded-none border bg-float-bg-2 text-handle-txt backdrop-blur-[6px] transition-[background-color,border-color,color,scale] duration-(--dur-fast) active:scale-[0.97] hover:border-accent hover:bg-accent hover:text-on-accent ${sizing ? ' border-accent bg-accent text-on-accent' : ''}`}
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
 * hover chip and right-click menu); every command comes from lib/paneCommands.
 */
function usePaneTools(focusId: string, view: Derived, photoById: Map<string, Photo>) {
  const t = useT()
  const mobile = useMediaQuery('(max-width: 1023.98px)')
  const removePhoto = useStore(s => s.removePhoto)
  const resetPane = useStore(s => s.resetPane)
  const closePane = useStore(s => s.closePane)
  const openStickerMaker = useStore(s => s.openStickerMaker)
  // Same pick flows as the tools row, aimed at the focused pane. The flows
  // themselves live in lib/paneCommands so the pane menu can share them.
  const pickForFocused = () => {
    if (focusId)
      pickPhotoForPane(focusId)
  }
  const pickStickerForFocused = () => {
    if (focusId)
      pickStickersForPane(focusId)
  }
  const addLabelToFocused = () => {
    if (focusId)
      addLabelToPane(focusId)
  }

  const focusLeaf = focusId ? view.leaves.find(l => l.node.id === focusId)?.node : null
  const hasPhoto = !!(focusLeaf?.photoId)
  // Desktop: the dock shows only for a focused pane holding a photo. Below lg
  // it is also where a phone splits and edits panes, so any focus shows it.
  const toolsHidden = mobile ? !focusLeaf : !hasPhoto
  const focusPhoto = focusLeaf?.photoId ? photoById.get(focusLeaf.photoId) : undefined
  const focusRect = focusId ? view.leaves.find(l => l.node.id === focusId)?.rect : undefined
  const onFocused = (fn: (id: string) => void) => () => {
    if (focusId)
      fn(focusId)
  }
  const splitTool: ToolDef = {
    key: 'split',
    icon: Columns2,
    label: t('Split'),
    hint: t('Split this pane'),
    options: [
      { key: 'column', icon: SquareSplitVertical, label: t('Split top/bottom'), onClick: onFocused(id => splitPane(id, 'column')) },
      { key: 'row', icon: SquareSplitHorizontal, label: t('Split left/right'), onClick: onFocused(id => splitPane(id, 'row')) },
    ],
  }
  const canClosePane = view.leaves.length > 1
  const closeTool: ToolDef = { key: 'close', icon: X, label: t('Close'), hint: t('Close pane'), danger: true, onClick: onFocused(closePane) }
  // One row, so the order here is the order on screen.
  const tools: ToolDef[] = !hasPhoto
    ? [
        { key: 'photo', icon: ImagePlus, label: t('Photo'), hint: t('Choose a photo'), onClick: pickForFocused },
        splitTool,
        { key: 'text', icon: Type, label: t('Text'), hint: t('Add a text label'), onClick: addLabelToFocused },
        ...(canClosePane ? [closeTool] : []),
      ]
    : [
        { key: 'photo', icon: ImagePlus, label: t('Replace'), hint: t('Pick a photo to replace this pane\'s photo'), onClick: pickForFocused },
        ...(mobile ? [splitTool] : []),
        { key: 'sticker', icon: StickerIcon, label: t('Sticker'), hint: t('Pick images and pin them onto this photo'), onClick: pickStickerForFocused },
        { key: 'make', icon: WandSparkles, label: t('Make'), hint: t('Make a sticker from text or an image'), onClick: () => focusId && openStickerMaker(focusId) },
        { key: 'text', icon: Type, label: t('Text'), hint: t('Add a text label'), onClick: addLabelToFocused },
        ...(mobile
          ? [
            {
              key: 'view',
              icon: ImageIcon,
              label: t('Fit'),
              hint: t('Photo'),
              options: [
                { key: 'reset', icon: Maximize, label: t('Reset zoom'), onClick: onFocused(resetPaneView) },
                { key: 'fit', icon: Frame, label: t('Fit whole photo'), disabled: !focusPhoto, onClick: onFocused(id => focusPhoto && fitPanePhoto(id, focusPhoto.trueW, focusPhoto.trueH, focusRect)) },
                { key: 'match', icon: Ratio, label: t('Match the canvas to this photo'), disabled: !focusPhoto?.trueW, onClick: () => focusPhoto && matchCanvasToPhoto(focusPhoto.trueW, focusPhoto.trueH) },
              ],
            },
            { key: 'dup', icon: CopyPlus, label: t('Duplicate'), hint: t('Duplicate pane'), onClick: onFocused(id => duplicatePaneAuto(id, focusRect)) },
            { key: 'remove', icon: Trash2, label: t('Remove'), hint: t('Remove photo'), onClick: onFocused(removePhoto) },
            { key: 'reset', icon: RotateCcw, label: t('Reset'), hint: t('Reset this pane'), onClick: onFocused(resetPane) },
            ...(canClosePane ? [closeTool] : []),
          ] satisfies ToolDef[]
          : []),
      ]

  return { tools, toolsHidden }
}
