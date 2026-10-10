import type { Divider } from '../lib/panes'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useElementSize } from '../hooks'
import { outputSizeFor } from '../lib/exporter'
import { dividerLine, ratioFromPointer } from '../lib/panes'
import { computeLayout, fitCanvas, isTransparentBg, MIN_PANE_PX, useStore } from '../store'
import { Pane } from './Pane'

const HIT_MIN = 15
const MIN_CANVAS = 120

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

  const root = useStore(s => s.root)
  const focusId = useStore(s => s.focusId)
  const canvasRatio = useStore(s => s.canvasRatio)
  const canvasFill = useStore(s => s.canvasFill)
  const gapValue = useStore(s => s.gap)
  const radiusValue = useStore(s => s.radius)
  const bg = useStore(s => s.bg)
  const longSide = useStore(s => s.longSide)
  const photos = useStore(s => s.photos)
  const focus = useStore(s => s.focus)
  const selectLabel = useStore(s => s.selectLabel)
  const updateLeaf = useStore(s => s.updateLeaf)
  const split = useStore(s => s.split)
  const closePane = useStore(s => s.closePane)
  const resizeSplit = useStore(s => s.resizeSplit)
  const setCanvasSize = useStore(s => s.setCanvasSize)
  const patch = useStore(s => s.patch)

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
      ),
    [root, canvasRatio, canvasFill, wrapSize, gapValue, radiusValue],
  )

  const photoById = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos])
  const out = outputSizeFor(longSide, canvasRatio ?? 1.5)

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
      const { focusId } = useStore.getState()
      if (!focusId)
        return
      el.querySelector<HTMLElement>(`[data-pane-id="${CSS.escape(focusId)}"]`)
        ?.dispatchEvent(new WheelEvent('wheel', e))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [wrapRef])

  const resetRatio = useCallback(() => {
    const first = photos.find(p => p.trueW)
    patch({ canvasRatio: first ? first.trueW / first.trueH : null, canvasFill: 1 })
  }, [photos, patch])

  return (
    <div
      ref={wrapRef}
      className={`stage-checker absolute inset-0 flex touch-none items-center justify-center ${dragging ? ' cursor-col-resize! [&_*]:cursor-col-resize!' : ''}${sizing ? ' cursor-nwse-resize! [&_*]:cursor-nwse-resize!' : ''}`}
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
        style={{ width: view.W, height: view.H, background: transparent ? undefined : bg }}
      >
        {view.leaves.map(({ node, rect }) => (
          <Pane
            key={node.id}
            leaf={node}
            rect={rect}
            radius={view.radius}
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
          title="Drag to change canvas aspect · double-click to reset"
        >
          <ResizeIcon />
        </div>
      </div>

      <div className={`pointer-events-none absolute bottom-3.5 left-4 rounded-none border bg-badge-bg px-[11px] py-[5px] text-[11.5px] tabular-nums text-dim ${sizing ? ' border-accent text-txt [&_em]:text-accent [&_em]:not-italic' : ''}`}>
        {sizing
          ? (
              <>
                Canvas ratio
                {' '}
                {(view.W / view.H).toFixed(2)}
                <em>
                  {' '}
                  Output
                  {out.W}
                  {' '}
                  ×
                  {out.H}
                </em>
              </>
            )
          : (
              <>
                Output
                {' '}
                {out.W}
                {' '}
                ×
                {' '}
                {out.H}
                {' '}
                px ·
                {' '}
                {view.leaves.length}
                {' '}
                panes
              </>
            )}
      </div>
    </div>
  )
}
