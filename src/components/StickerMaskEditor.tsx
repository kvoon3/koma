import type { MaskMode, MaskPoint } from '../lib/stickerFX'
import type { MaskLayers, MaskView } from '../lib/stickerMask'
import { Maximize2, Undo2 } from 'lucide'
import { MorphIcon } from 'morphicons/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { RangeField, SegmentedField } from '@/components/ui/field'
import { useT } from '../lib/i18n'
import { brushRadius, MASK_UNDO_CAP, pushCapped } from '../lib/stickerFX'
import {
  commitMask,
  compositeMasked,
  fitView,
  loadMaskLayers,
  MASK_MAX_DPR,
  paintLasso,
  paintStroke,
  panView,
  restoreMask,
  snapshotMask,
  traceLasso,
  viewToMask,
  zoomView,
} from '../lib/stickerMask'

/**
 * Manual cutout adjustment: paint the cutout in or out over the source, so the
 * last 5% a model always misses is a brush stroke instead of a re-pick.
 *
 * The stage is one canvas over the dialog's own checkerboard; the layers and
 * the compositing live in `lib/stickerMask` (commit = source α × mask α), so
 * this component is pointer plumbing, the toolbar, and the undo stack.
 * Everything it paints is at the mask's resolution, never the display's: the
 * display only scales the composite, which is why a zoomed-in brush edge lands
 * in the committed PNG exactly as it looked.
 *
 * Undo is a snapshot stack of the mask canvas (`MASK_UNDO_CAP` deep) and a
 * stroke is its unit: one press-drag-release is one snapshot, whatever it
 * painted, and a lasso only takes a snapshot once it encloses something.
 */
export function StickerMaskEditor({ src, onApply, onCancel }: {
  src: string
  onApply: (dataUrl: string) => void
  onCancel: () => void
}) {
  const t = useT()
  const boxRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const layersRef = useRef<MaskLayers | null>(null)
  const scratchRef = useRef<HTMLCanvasElement | null>(null)
  /** Display transform in CSS pixels: `display = mask × scale + (x, y)`. */
  const viewRef = useRef<MaskView>({ scale: 1, x: 0, y: 0 })
  const dprRef = useRef(1)
  const undoRef = useRef<HTMLCanvasElement[]>([])
  /** The stroke (or lasso) under the pointer's button, in mask pixels. */
  const strokeRef = useRef<{ mode: MaskMode, points: MaskPoint[] } | null>(null)
  /** Pointer id → last display-box position, for drags and pinches. */
  const pointersRef = useRef(new Map<number, { x: number, y: number }>())
  const pinchRef = useRef<{ distance: number, view: MaskView } | null>(null)
  const spaceRef = useRef(false)

  const [ready, setReady] = useState(false)
  const [mode, setMode] = useState<MaskMode>('remove')
  const [tool, setTool] = useState<'brush' | 'lasso'>('brush')
  const [sizePct, setSizePct] = useState(12)
  const [undoDepth, setUndoDepth] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const brushSize = useCallback((layers: MaskLayers) => {
    return brushRadius(sizePct, Math.min(layers.width, layers.height)) * 2
  }, [sizePct])

  /** Rebuild the composite and blit it through the view transform. */
  const display = useCallback(() => {
    const canvas = canvasRef.current
    const layers = layersRef.current
    const scratch = scratchRef.current
    if (!canvas || !layers || !scratch)
      return
    const context = canvas.getContext('2d')
    if (!context)
      return
    compositeMasked(layers.source, layers.mask, scratch)
    const view = viewRef.current
    const dpr = dprRef.current
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.setTransform(view.scale * dpr, 0, 0, view.scale * dpr, view.x * dpr, view.y * dpr)
    context.drawImage(scratch, 0, 0)
    const stroke = strokeRef.current
    if (stroke && tool === 'lasso')
      traceLasso(context, stroke.points, view.scale * dpr)
    context.setTransform(1, 0, 0, 1, 0, 0)
  }, [tool])

  /** Size the backing store to the box, and optionally fit the artwork in it. */
  const layout = useCallback((fit: boolean) => {
    const box = boxRef.current
    const canvas = canvasRef.current
    const layers = layersRef.current
    if (!box || !canvas || !layers)
      return
    const dpr = Math.min(MASK_MAX_DPR, Math.max(1, window.devicePixelRatio || 1))
    const width = Math.max(1, box.clientWidth)
    const height = Math.max(1, box.clientHeight)
    const backingWidth = Math.max(1, Math.round(width * dpr))
    const backingHeight = Math.max(1, Math.round(height * dpr))
    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth
      canvas.height = backingHeight
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    }
    dprRef.current = dpr
    if (fit)
      viewRef.current = fitView(layers.width, layers.height, width, height)
    display()
  }, [display])

  // Load the layers once per source. The dialog remounts this component when
  // the source changes (a new pick, a new cutout, a committed mask), so a load
  // belongs to one mount: there is no stale session to reset.
  useEffect(() => {
    let alive = true
    loadMaskLayers(src)
      .then((layers) => {
        if (!alive)
          return
        layersRef.current = layers
        scratchRef.current = document.createElement('canvas')
        setReady(true)
      })
      .catch(() => {
        if (alive)
          setError(t('Could not open this image'))
      })
    return () => {
      alive = false
      layersRef.current = null
      scratchRef.current = null
    }
  }, [src, t])

  // First paint once the layers land, then a refit whenever the box resizes.
  useEffect(() => {
    if (!ready)
      return
    layout(true)
    const box = boxRef.current
    if (!box || typeof ResizeObserver === 'undefined')
      return
    const observer = new ResizeObserver(() => layout(false))
    observer.observe(box)
    return () => observer.disconnect()
  }, [ready, layout])

  // Space held is the pan modifier; it must not also scroll the dialog behind.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat)
        return
      const target = e.target as HTMLElement | null
      if (target && /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
        return
      spaceRef.current = true
      e.preventDefault()
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space')
        spaceRef.current = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // Wheel zoom needs a non-passive listener: React's own is passive, so the
  // browser would scroll the dialog instead of letting the handler eat it.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !ready)
      return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      viewRef.current = zoomView(viewRef.current, Math.exp(-e.deltaY * 0.0015), anchor)
      display()
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [ready, display])

  const boxPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const pushUndo = () => {
    const layers = layersRef.current
    if (!layers)
      return
    undoRef.current = pushCapped(undoRef.current, snapshotMask(layers.mask), MASK_UNDO_CAP)
    setUndoDepth(undoRef.current.length)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const layers = layersRef.current
    if (!layers || !ready)
      return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, boxPoint(e))
    // A second finger turns the gesture into a pinch, and drops any stroke the
    // first one had started (they are different gestures, not a continuation).
    if (pointersRef.current.size === 2) {
      strokeRef.current = null
      const [a, b] = [...pointersRef.current.values()]
      pinchRef.current = { distance: Math.hypot(a!.x - b!.x, a!.y - b!.y), view: viewRef.current }
      return
    }
    if (spaceRef.current || e.button === 1) {
      strokeRef.current = null
      return
    }
    if (e.button !== 0)
      return
    const point = boxPoint(e)
    const maskPoint = viewToMask(viewRef.current, point.x, point.y)
    strokeRef.current = { mode, points: [maskPoint] }
    if (tool === 'brush') {
      pushUndo()
      // A tap paints here and not on release: the disc is what makes a click
      // visible at all, and it is also the joint that keeps a polyline smooth.
      paintStroke(layers.mask.getContext('2d', { willReadFrequently: true })!, [maskPoint], mode, brushSize(layers))
      display()
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const layers = layersRef.current
    if (!layers)
      return
    const previous = pointersRef.current.get(e.pointerId)
    if (!previous)
      return
    const point = boxPoint(e)
    pointersRef.current.set(e.pointerId, point)

    const pinch = pinchRef.current
    if (pointersRef.current.size >= 2 && pinch) {
      const [a, b] = [...pointersRef.current.values()]
      const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y)
      if (pinch.distance > 0) {
        viewRef.current = zoomView(
          pinch.view,
          distance / pinch.distance,
          { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 },
        )
      }
      display()
      return
    }

    if (spaceRef.current) {
      viewRef.current = panView(viewRef.current, point.x - previous.x, point.y - previous.y)
      display()
      return
    }

    const stroke = strokeRef.current
    if (!stroke)
      return
    const maskPoint = viewToMask(viewRef.current, point.x, point.y)
    const last = stroke.points[stroke.points.length - 1]!
    // Drop sub-pixel samples: a fast drag would otherwise pile up thousands.
    if (Math.abs(maskPoint.x - last.x) < 0.4 && Math.abs(maskPoint.y - last.y) < 0.4)
      return
    stroke.points.push(maskPoint)
    if (tool === 'brush')
      paintStroke(layers.mask.getContext('2d', { willReadFrequently: true })!, [last, maskPoint], stroke.mode, brushSize(layers))
    display()
  }

  const finishStroke = () => {
    const stroke = strokeRef.current
    const layers = layersRef.current
    strokeRef.current = null
    if (!stroke || !layers)
      return
    // A lasso is filled on release, so its snapshot is only spent when the
    // drag actually enclosed something.
    if (tool === 'lasso') {
      pushUndo()
      const filled = paintLasso(layers.mask.getContext('2d', { willReadFrequently: true })!, stroke.points, stroke.mode)
      if (!filled) {
        undoRef.current = undoRef.current.slice(0, -1)
        setUndoDepth(undoRef.current.length)
      }
      display()
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId)
    if (pointersRef.current.size < 2)
      pinchRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
    finishStroke()
  }

  const undo = () => {
    const layers = layersRef.current
    const snapshot = undoRef.current.at(-1)
    if (!layers || !snapshot)
      return
    undoRef.current = undoRef.current.slice(0, -1)
    setUndoDepth(undoRef.current.length)
    restoreMask(layers.mask, snapshot)
    display()
  }

  const apply = () => {
    const layers = layersRef.current
    if (layers)
      onApply(commitMask(layers.source, layers.mask))
  }

  return (
    <div className="flex flex-col gap-2.5" data-sticker-mask-editor="">
      <div
        ref={boxRef}
        className="stage-clear relative h-[min(46dvh,280px)] w-full shrink-0 overflow-hidden border border-line-strong"
      >
        <canvas
          ref={canvasRef}
          className="absolute left-0 top-0 touch-none select-none"
          data-sticker-mask-canvas=""
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={e => e.preventDefault()}
        />
        {!ready && (
          <span className="absolute inset-0 grid place-items-center px-3 text-center text-[11.5px] text-faint">
            {error ?? t('Loading...')}
          </span>
        )}
        <span className="pointer-events-none absolute bottom-1.5 left-1.5 bg-panel/80 px-1.5 py-0.5 text-[10.5px] text-faint backdrop-blur-[2px]">
          {t('Drag to paint · space or two fingers to move')}
        </span>
      </div>

      <SegmentedField
        label={t('Mask')}
        value={mode}
        items={[
          { value: 'keep', label: t('Keep') },
          { value: 'remove', label: t('Erase') },
        ]}
        onChange={setMode}
      />
      <SegmentedField
        label={t('Tool')}
        value={tool}
        items={[
          { value: 'brush', label: t('Brush') },
          { value: 'lasso', label: t('Lasso') },
        ]}
        onChange={setTool}
      />
      <RangeField
        label={t('Brush size')}
        text={`${sizePct}`}
        min={2}
        max={60}
        value={sizePct}
        onChange={setSizePct}
      />

      <div className="flex items-center gap-1.5 border-t border-line pt-2.5">
        <Button disabled={undoDepth === 0} onClick={undo}>
          <MorphIcon icon={Undo2} size={13} strokeWidth={1.75} />
          {t('Undo')}
        </Button>
        <Button onClick={() => layout(true)}>
          <MorphIcon icon={Maximize2} size={13} strokeWidth={1.75} />
          {t('Fit')}
        </Button>
        <span className="ml-auto text-[10.5px] tabular-nums text-faint">
          {undoDepth}
          /
          {MASK_UNDO_CAP}
        </span>
      </div>

      <div className="flex justify-end gap-[6px] border-t border-line pt-2.5">
        <Button onClick={onCancel}>{t('Cancel')}</Button>
        <Button variant="strong" disabled={!ready} onClick={apply}>{t('Apply')}</Button>
      </div>
    </div>
  )
}
