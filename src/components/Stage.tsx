import type { IconInput } from 'morphicons/react'
import type { Photo } from '../lib/imageStore'
import type { Divider, Leaf, Rect } from '../lib/panes'
import { ChevronDown, ChevronUp, ImagePlus, Sticker as StickerIcon, Type } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useElementSize, usePreview } from '../hooks'
import { pickImageFiles } from '../lib/filePicker'
import { useT } from '../lib/i18n'
import { dividerLine, placement, ratioFromPointer, seamSides } from '../lib/panes'
import { activeWs, computeLayout, fitCanvas, isTransparentBg, MIN_PANE_PX, useStore } from '../store'
import { Pane } from './Pane'

const HIT_MIN = 15
const MIN_CANVAS = 120

/* The focused pane's tools: an overlay above the footer, pulled open by the
   handle on its top edge. Overlaying keeps the canvas at full size; collapsed,
   the panel rests behind the footer (z-40) with only the handle showing. */
const toolsPanelCls = 'pointer-events-auto relative mb-2 w-[min(920px,100vw)] rounded-none border border-line bg-drawer-bg shadow-pop transition-transform duration-[260ms] ease-(--ease-drawer)'
const toolsHandleCls = 'absolute -top-[20px] left-1/2 grid h-5 w-16 -translate-x-1/2 cursor-pointer place-items-center rounded-t-[6px] border border-b-0 border-float-line bg-float-bg p-0 text-float-icon backdrop-blur-[7px] transition-opacity duration-[160ms] hover:text-txt'
const toolsBtnCls = 'flex w-[120px] cursor-pointer flex-col items-center gap-1.5 whitespace-nowrap rounded-none border-0 bg-transparent p-3 text-float-icon transition-colors duration-[120ms] hover:bg-chip-hover hover:text-txt'
const toolsLabelCls = 'text-[11.5px] font-semibold text-txt'

function ToolButton({ icon, label, hint, onClick }: {
  icon: IconInput
  label: string
  hint: string
  onClick: () => void
}) {
  return (
    <button className={toolsBtnCls} title={hint} onClick={onClick}>
      <MorphIcon icon={icon} size={22} strokeWidth={1.5} />
      <span className={toolsLabelCls}>{label}</span>
    </button>
  )
}

function ResizeIcon() {
  return (
    <svg viewBox="0 0 20 20" width="19" height="19" aria-hidden>
      <path
        d="M5 17.5 H17.5 V5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M11 17.5 H17.5 V11"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.45"
      />
    </svg>
  )
}

export function Stage() {
  const [wrapRef, wrapSize] = useElementSize<HTMLDivElement>()
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState(false)
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
  const toolsOpen = useStore(s => s.toolsOpen)
  const setToolsOpen = useStore(s => s.setToolsOpen)

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
      setDragging(true)
    }
  }, [])

  useEffect(() => {
    if (!dragging)
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
      setDragging(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [dragging, view.gap, resizeSplit])

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

  // Same pick flows as the tools row, aimed at the focused pane.
  const pickForFocused = () => {
    pickImageFiles((files) => {
      const s = useStore.getState()
      const created = s.addPhotos(files, false)
      const first = created[0]
      if (first && focusId)
        s.assign(focusId, first.id)
    })
  }
  const pickStickerForFocused = () => {
    pickImageFiles((files) => {
      const s = useStore.getState()
      const created = s.addPhotos(files, false)
      created.forEach((ph, i) => {
        const n = Math.min(0.8, 0.5 + i * 0.08)
        if (focusId)
          s.addSticker(focusId, ph.id, n, n)
      })
    })
  }
  const addLabelToFocused = () => {
    const s = useStore.getState()
    if (!focusId)
      return
    s.ensureLabel(focusId)
    s.requestLabelEdit(focusId)
  }

  const focusLeaf = focusId ? view.leaves.find(l => l.node.id === focusId)?.node : null
  const hasPhoto = !!(focusLeaf?.photoId)
  // The panel is open only for a focused pane, and collapses (without losing
  // the user's pull-open state) while no pane is focused.
  const expanded = !!focusLeaf && toolsOpen

  return (
    <div
      ref={wrapRef}
      className={`stage-checker absolute inset-0 flex touch-none flex-col items-center justify-center ${dragging ? ' cursor-col-resize! [&_*]:cursor-col-resize!' : ''}${sizing ? ' cursor-nwse-resize! [&_*]:cursor-nwse-resize!' : ''}`}
    >
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
          {paneFade > 0 && (
            <SeamBackdrop
              leaves={view.leaves}
              photoById={photoById}
              radius={Math.max(view.unit * 40, view.fade)}
              opacity={fadeStrength / 100}
            />
          )}

          {view.leaves.map(({ node, rect }) => (
            <Pane
              key={node.id}
              leaf={node}
              rect={rect}
              radius={view.radius}
              bordered={paneBorder}
              fade={paneFade}
              seam={seams.get(node.id)}
              unit={view.unit}
              photo={node.photoId ? (photoById.get(node.photoId) ?? null) : null}
              photoById={photoById}
              focused={focusId === node.id}
              canClose={view.leaves.length > 1}
              onFocus={focus}
              onUpdate={updateLeaf}
              onSplit={split}
              onClose={closePane}
            />
          ))}

          {view.dividers.map((d) => {
            const line = dividerLine(d, view.gap)
            const hit = Math.max(view.gap, HIT_MIN)
            const style: React.CSSProperties
              = d.dir === 'row'
                ? { left: (line.x ?? 0) - hit / 2, top: d.area.y, width: hit, height: d.area.h }
                : { left: d.area.x, top: (line.y ?? 0) - hit / 2, width: d.area.w, height: hit }
            return (
              <div
                key={d.id}
                className={`group/divider absolute z-[5] touch-none ${d.dir === 'row' ? 'cursor-col-resize' : 'cursor-row-resize'}`}
                style={style}
                onPointerDown={beginDrag(d)}
              >
                <span
                  className={
                    `absolute rounded-none bg-transparent transition-colors duration-[120ms] group-hover/divider:bg-accent ${
                      d.dir === 'row'
                        ? 'bottom-0 left-1/2 top-0 w-[5px] -translate-x-1/2'
                        : 'left-0 right-0 top-1/2 h-[5px] -translate-y-1/2'}`
                  }
                />
              </div>
            )
          })}

          <div
            className={`absolute -right-[13px] -bottom-[13px] z-[8] grid h-7 w-7 cursor-nwse-resize touch-none place-items-center rounded-none border bg-float-bg-2 text-handle-txt backdrop-blur-[6px] transition-colors duration-[120ms] hover:border-accent hover:bg-accent hover:text-on-accent ${sizing ? ' border-accent bg-accent text-on-accent' : ''}`}
            onPointerDown={beginResize}
            onDoubleClick={resetRatio}
            title={t('Drag to change canvas aspect · double-click to reset')}
          >
            <ResizeIcon />
          </div>
        </div>
      </div>

      {/* The focused pane's tools, laid over the canvas so the panel never
          takes layout space. Collapsed, the panel waits behind the footer
          (z-40) with only its handle showing, and the handle fades out with
          the focus. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center">
        <div className={`${toolsPanelCls} ${
          expanded ? 'translate-y-0' : 'translate-y-[calc(100%+10px)]'
        }`}
        >
          <button
            className={`${toolsHandleCls} ${
              focusLeaf ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
            title={t(expanded ? 'Hide tools' : 'Show tools')}
            aria-expanded={expanded}
            aria-label={t(expanded ? 'Hide tools' : 'Show tools')}
            onClick={() => setToolsOpen(!toolsOpen)}
          >
            <MorphIcon icon={expanded ? ChevronDown : ChevronUp} size={14} strokeWidth={1.75} />
          </button>
          {/* inert while collapsed: the tools are off-screen behind the footer */}
          <div className="flex items-start justify-center" inert={!expanded}>
            {hasPhoto
              ? (
                  <>
                    <ToolButton icon={StickerIcon} label={t('Sticker')} hint={t('Pick images and pin them onto this photo')} onClick={pickStickerForFocused} />
                    <ToolButton icon={ImagePlus} label={t('Replace photo')} hint={t('Pick a photo to replace this pane\'s photo')} onClick={pickForFocused} />
                    <ToolButton icon={Type} label={t('Text')} hint={t('Add a text label')} onClick={addLabelToFocused} />
                  </>
                )
              : (
                  // An empty pane has a single tool: put a photo into it.
                  <ToolButton icon={ImagePlus} label={t('Choose a photo')} hint={t('Choose a photo')} onClick={pickForFocused} />
                )}
          </div>
        </div>
      </div>
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
export function SeamBackdrop({ leaves, photoById, radius, opacity }: {
  leaves: { node: Leaf, rect: Rect }[]
  photoById: Map<string, Photo>
  radius: number
  opacity: number
}) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ opacity }}>
      {leaves.map(({ node, rect }) => {
        const photo = node.photoId ? photoById.get(node.photoId) : undefined
        return photo
          ? <BackdropLeaf key={node.id} leaf={node} rect={rect} photo={photo} radius={radius} />
          : null
      })}
    </div>
  )
}
