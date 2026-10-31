import type { MinimapView } from '../lib/boardPaint'
import type { ExportView } from '../lib/exportView'
import type { ExportItem } from './ExportDialog'
import NumberFlow from '@number-flow/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useElementSize, useMediaQuery } from '../hooks'
import { minimapViewStyle } from '../lib/boardPaint'
import { viewWheelFactor } from '../lib/canvasView'
import {
  centerExportView,
  EXPORT_FIT,
  exportFrame,
  exportMinimapSize,
  NO_IMAGE,
  panExportView,
  zoomExportView,
} from '../lib/exportView'
import { useT } from '../lib/i18n'

/** A double-tap is a short press, released near a previous short press. */
const TAP_MAX_MS = 250
const TAP_PAIR_MS = 320
const TAP_SLOP_PX = 28
/**
 * One toggle per window: a touch double-tap also raises the browser's synthetic
 * `dblclick`, and the chip's own click must not compound with either.
 */
const TOGGLE_GUARD_MS = 350
/** A double-tap lands on the zoom ladder at 2×; a second one returns to fit. */
const TAP_ZOOM = 2

/**
 * The export preview: the stage's checkerboard, the still (or the video) on it,
 * and, for a still, the zoom and pan that let a seam or a caption edge be
 * inspected at native pixels. The view is per item. Mount with `key={item?.url}`:
 * React's key is its only reset, so a new run, a strip switch and a dialog close
 * all come back at fit with no reset code anywhere.
 *
 * The gestures live on the viewport div, never on the img: at fit the img is
 * exactly the browser's own image (the long-press save sheet, the desktop
 * drag-out, "Save image as…"), and only a zoomed view takes the pointer.
 */
export function ExportPreview({ item }: { item: ExportItem | null }) {
  const image = item ?? NO_IMAGE
  const [boxRef, box] = useElementSize<HTMLDivElement>()
  const [view, setView] = useState<ExportView>(EXPORT_FIT)
  const viewRef = useRef<ExportView>(EXPORT_FIT)
  const frame = exportFrame(view, image, box)
  const coarse = useMediaQuery('(pointer: coarse)')

  const pointersRef = useRef(new Map<number, { x: number, y: number }>())
  const pinchesRef = useRef<{ distance: number, base: ExportView } | null>(null)
  const pansRef = useRef<{ x: number, y: number } | null>(null)
  const lastTapRef = useRef<{ t: number, x: number, y: number } | null>(null)
  const downAtRef = useRef<{ t: number, x: number, y: number } | null>(null)
  const lastToggleRef = useRef(0)

  /**
   * The one writer. Every call is a clamped `ExportView` (the writers guarantee
   * it), so the ref is always legal for the box it was written against, and a
   * second event before a paint reads the first one's result rather than a stale
   * value. A resize can leave the ref legal-but-different from the DRAWN frame;
   * no effect corrects it, because the frame is what renders and the next write
   * re-clamps through the same authority.
   */
  const apply = useCallback((next: ExportView) => {
    viewRef.current = next
    setView(next)
  }, [])

  const fit = () => apply(EXPORT_FIT)
  const scrub = (u: number, v: number) =>
    apply(centerExportView(viewRef.current, image, box, u, v))

  /**
   * The toggle both entries share: a double-click / double-tap zooms 2× about
   * the point, a second one returns to fit. On an item whose ceiling is 1
   * (already larger than its own pixels) this is a clamped no-op.
   */
  const toggleZoom = (anchor: { x: number, y: number }) => {
    const now = performance.now()
    if (now - lastToggleRef.current < TOGGLE_GUARD_MS)
      return
    lastToggleRef.current = now
    apply(frame.zoomed ? EXPORT_FIT : zoomExportView(EXPORT_FIT, image, box, TAP_ZOOM, anchor))
  }

  // A non-passive NATIVE wheel listener: React's own is passive, so
  // preventDefault would be ignored (see StickerMaskEditor's `useWheelZoom`).
  // `box` is a fresh object per measurement, so this rebinds only on a resize.
  useEffect(() => {
    const el = boxRef.current
    if (!el || item?.kind !== 'image' || !box.w || !box.h)
      return
    const onWheel = (e: WheelEvent) => {
      // A pure horizontal swipe is left alone.
      if (e.deltaY === 0)
        return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const anchor = { x: e.clientX - r.left, y: e.clientY - r.top }
      apply(zoomExportView(viewRef.current, image, box, viewWheelFactor(e.deltaY, e.ctrlKey || e.metaKey), anchor))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [boxRef, item, image, box, apply])

  // A pinch at fit begins under `touch-action: auto` (the class follows the
  // frame, and the browser reads touch-action once at touch start), so the page
  // zoom has to be refused here while two touches are down. Single-finger
  // defaults are untouched, which is what the save sheet needs.
  useEffect(() => {
    const el = boxRef.current
    if (!el || item?.kind !== 'image')
      return
    const block = (e: TouchEvent) => {
      if (e.touches.length >= 2)
        e.preventDefault()
    }
    el.addEventListener('touchstart', block, { passive: false })
    el.addEventListener('touchmove', block, { passive: false })
    return () => {
      el.removeEventListener('touchstart', block)
      el.removeEventListener('touchmove', block)
    }
  }, [boxRef, item])

  const local = (e: { clientX: number, clientY: number, currentTarget: HTMLElement }) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const distanceOf = () => {
    const [a, b] = [...pointersRef.current.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  const midpoint = () => {
    const [a, b] = [...pointersRef.current.values()]
    return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : { x: 0, y: 0 }
  }

  // A TOUCH pointer is implicitly captured to its target, and a mouse reuses
  // one pointerId, so the tracked set cannot go stale at fit even though
  // nothing is captured there; a scroll takeover arrives as pointercancel.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // The right button is the "Save image as…" menu and is never ours.
    if (e.pointerType === 'mouse' && e.button !== 0)
      return
    // A third finger is ignored outright: the machine is one-or-two, and a
    // third pointer in the map would otherwise be picked as one of the pinch pair.
    if (pointersRef.current.size >= 2)
      return
    const at = local(e)
    pointersRef.current.set(e.pointerId, at)
    // A double-TAP needs both a short press and a short release, and the press
    // side is the only place the down time exists.
    if (e.pointerType !== 'mouse')
      downAtRef.current = { t: performance.now(), ...at }

    if (pointersRef.current.size === 2) {
      downAtRef.current = null
      // A second finger is a pinch at ANY scale. Capture both (the first one is
      // not ours at fit) and freeze the base. preventDefault suppresses the
      // compatibility mouse events and the image drag; it cannot cancel a
      // touch scroll, which only touch-action can, from the next touch on.
      pansRef.current = null
      pinchesRef.current = { distance: distanceOf(), base: viewRef.current }
      for (const id of pointersRef.current.keys())
        e.currentTarget.setPointerCapture(id)
      e.preventDefault()
      return
    }
    // One finger is ours only when there is overflow. At fit this does NOTHING:
    // no capture, no preventDefault, so the img keeps its native long-press
    // sheet and desktop drag-out.
    if (!frame.zoomed)
      return
    pansRef.current = at
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(e.pointerId))
      return
    pointersRef.current.set(e.pointerId, local(e))
    const pinch = pinchesRef.current
    if (pointersRef.current.size >= 2 && pinch) {
      // Always from the frozen base, never frame to frame: no drift, and the
      // clamp cannot ratchet a gesture toward the floor.
      apply(zoomExportView(pinch.base, image, box, distanceOf() / pinch.distance, midpoint()))
      return
    }
    const pan = pansRef.current
    if (!pan || pointersRef.current.size !== 1)
      return
    const p = local(e)
    apply(panExportView(viewRef.current, image, box, p.x - pan.x, p.y - pan.y))
    pansRef.current = p
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    // A pointer we never tracked (the ignored third finger) ends nothing:
    // without this guard its release would look like "one finger remains" and
    // kill the pinch still in progress.
    if (!pointersRef.current.delete(e.pointerId))
      return
    if (pointersRef.current.size === 0) {
      pansRef.current = null
      pinchesRef.current = null
    }
    else {
      // One finger remains: the pinch becomes a pan from WHERE THAT FINGER IS,
      // so the view does not jump on the frame the second finger lifts.
      pinchesRef.current = null
      pansRef.current = [...pointersRef.current.values()][0]!
    }
    // pointercancel lands here too. The view already holds what was painted:
    // there is no draft to flush.
    if (e.type === 'pointercancel') {
      downAtRef.current = null
      lastTapRef.current = null
      return
    }
    const now = performance.now()
    const p = local(e)
    const down = downAtRef.current
    downAtRef.current = null
    if (e.pointerType === 'mouse' || !down)
      return
    if (now - down.t > TAP_MAX_MS)
      return
    if (Math.hypot(down.x - p.x, down.y - p.y) > TAP_SLOP_PX)
      return
    const prev = lastTapRef.current
    lastTapRef.current = { t: now, ...p }
    if (prev && now - prev.t <= TAP_PAIR_MS && Math.hypot(prev.x - p.x, prev.y - p.y) <= TAP_SLOP_PX) {
      // A triple tap is a new pair, not two toggles.
      lastTapRef.current = null
      toggleZoom(p)
    }
  }

  if (item == null)
    return <div className="stage-clear flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3" />

  if (item.kind !== 'image') {
    return (
      <div className="stage-clear flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3">
        <video src={item.url} controls playsInline preload="auto" className="h-full w-full object-contain" />
      </div>
    )
  }

  return (
    <div className="stage-clear flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3">
      {/* The shadow sits on the viewport, not the img, so the clip edge and the
          viewport are the same rectangle and the minimap's rect tells the truth
          at every zoom. `touch-none` follows the frame: absent at fit, which is
          what leaves the img's long-press and drag to the browser. */}
      <div
        ref={boxRef}
        data-export-preview=""
        className={`relative h-full w-full overflow-hidden shadow-[0_18px_44px_-24px_rgba(0,0,0,0.6)] ${frame.zoomed ? 'touch-none' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={e => toggleZoom(local(e))}
      >
        <img
          src={item.url}
          alt={item.name}
          className="export-shot absolute inset-0 h-full w-full object-contain"
          style={{ transform: frame.transform }}
          data-export-view={frame.view.scale.toFixed(3)}
        />
        {frame.zoomed && <ExportZoomChip percent={frame.percent} onFit={fit} />}
        {frame.minimap && (
          <ExportMinimap item={item} window={frame.window} coarse={coarse} onScrub={scrub} />
        )}
      </div>
    </div>
  )
}

/**
 * The discoverable reset: the live percentage, and fit on click. Not a reuse of
 * `ViewZoomChip`, which hardcodes its own label key and attribute; the classes
 * are the shared thing and they are copied verbatim.
 */
function ExportZoomChip({ percent, onFit }: { percent: number, onFit: () => void }) {
  const t = useT()
  const label = t('Preview at {n}% · click to fit', { n: percent })
  return (
    <button
      type="button"
      data-export-zoom-chip=""
      className="absolute right-2 top-2 z-[3] grid h-[30px] min-w-[46px] cursor-pointer place-items-center border border-float-line bg-float-bg px-1.5 text-[11px] font-semibold tabular-nums text-float-icon backdrop-blur-[7px] transition-[background-color,color,scale] duration-(--dur-fast) active:scale-[0.97] hover:bg-chip-hover hover:text-txt focus-visible:outline-1 focus-visible:outline-accent pointer-coarse:h-[38px]"
      title={label}
      aria-label={label}
      // The chip is not the photo: its press must not reach the viewport's
      // pointer machine, and its double-click must not toggle the view.
      onPointerDown={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      onClick={onFit}
    >
      {/* Same rolling digits as ViewZoomChip; the comment there covers both. */}
      <NumberFlow value={percent} format={{ useGrouping: false }} suffix="%" willChange />
    </button>
  )
}

/**
 * The whole image, small, with the visible window drawn on it: a drag carries
 * the view (the grab offset is kept), a tap recentres on the point. Both
 * dimensions are definite, so the box's aspect IS the image's.
 */
function ExportMinimap({ item, window, coarse, onScrub }: {
  item: ExportItem
  window: MinimapView
  coarse: boolean
  onScrub: (u: number, v: number) => void
}) {
  const t = useT()
  /** The one pointer that owns the scrub; a second finger is ignored. */
  const scrubIdRef = useRef<number | null>(null)
  const movedRef = useRef(false)
  const grabRef = useRef({ u: 0, v: 0 })
  const size = exportMinimapSize(item, coarse ? { w: 84, h: 62 } : { w: 72, h: 54 })
  const label = t('Export preview minimap, drag to pan')

  const pointOf = (e: { clientX: number, clientY: number, currentTarget: HTMLElement }) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { u: (e.clientX - r.left) / r.width, v: (e.clientY - r.top) / r.height }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // FIRST, unconditionally: a second finger on the map must not reach the
    // viewport and start a pinch there.
    e.stopPropagation()
    // The right button is the browser's menu here too.
    if (e.pointerType === 'mouse' && e.button !== 0)
      return
    if (scrubIdRef.current != null)
      return
    scrubIdRef.current = e.pointerId
    movedRef.current = false
    e.currentTarget.setPointerCapture(e.pointerId)
    const at = pointOf(e)
    grabRef.current = {
      u: window.x + window.w / 2 - at.u,
      v: window.y + window.h / 2 - at.v,
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scrubIdRef.current !== e.pointerId)
      return
    movedRef.current = true
    const at = pointOf(e)
    onScrub(at.u + grabRef.current.u, at.v + grabRef.current.v)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scrubIdRef.current !== e.pointerId)
      return
    scrubIdRef.current = null
    // A tap means "put this point in the middle"; a drag already carried the
    // window there, so releasing must not snap it again. A cancelled pointer is
    // neither, so it ends the scrub where it stands.
    if (!movedRef.current && e.type === 'pointerup') {
      const at = pointOf(e)
      onScrub(at.u, at.v)
    }
  }

  return (
    <div
      data-export-minimap=""
      aria-label={label}
      title={label}
      className={`absolute right-2 bottom-2 z-[3] cursor-grab overflow-hidden border border-float-line bg-float-bg backdrop-blur-[7px] transition-opacity duration-(--dur-fast) hover:opacity-100 focus-within:opacity-100 ${coarse ? 'opacity-90' : 'opacity-70'}`}
      style={{ width: size.w, height: size.h }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      // A double-tap on the map must not reach the viewport's toggle: its own
      // tap already recentred, which is what a second tap means here.
      onDoubleClick={e => e.stopPropagation()}
    >
      <img src={item.url} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
      <div
        data-export-minimap-viewport=""
        className="pointer-events-none absolute border-[1.5px] border-accent outline-1 outline-white/70 bg-accent/15"
        style={minimapViewStyle(window)}
      />
    </div>
  )
}
