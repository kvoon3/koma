import type { RefObject } from 'react'
import type { RailTick } from '../lib/canvasRail'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFloatingActionsBottom, useMediaQuery, useToolsSheetTop } from '../hooks'
import {
  assistFill,
  clamp01,
  fillAtTallness,
  fillLabel,
  nextTickFill,
  RAIL_KEY_STEPS,
  RAIL_PAGE_STEPS,

  railTicks,
  rubberBand,
  settleFill,
  tallnessOfFill,
  tickY,
} from '../lib/canvasRail'
import { useT } from '../lib/i18n'
import { activeWs, MAX_CANVAS_FILL, MIN_CANVAS_FILL, useStore } from '../store'
import { SCALE_BAR_LONG, SCALE_BAR_THICK, SCALE_MARK_HARD, SCALE_MARK_SOFT, TickScale } from './ui/TickScale'

/**
 * How long the rail stays open after the pointer leaves it (and after a drag or
 * a size change elsewhere). The first window is longer so a fresh board still
 * shows the scale before it tucks away. The readout lingers a tap longer.
 */
const IDLE_MS = 3200
const IDLE_FIRST_MS = 8000
const READOUT_HOLD_MS = 1200
/**
 * The rail's band: the hairline through its middle, the marks and the bar either
 * side of it, and the whole thing a hit target (the bar itself is 3px thick, so
 * the strip is what a finger presses, not the bar).
 */
const BAND_W = SCALE_BAR_LONG + 6
const BAND_W_COARSE = SCALE_BAR_LONG + 10
/** Track bounds. It never gets taller than this, nor shorter than a few marks. */
const TRACK_MAX = 340
const TRACK_MIN = 150
/**
 * The resting length of the ladder: a stub, not a dot. Short enough to step out
 * of the stage's way, long enough that a handful of marks still read as a scale.
 */
const TRACK_IDLE = 96
/** Clearance from the sheet's top edge, the minimap's rule (see Pane.tsx). */
const EDGE_INSET = 8
/** The fit's mark: longer than a half mark, shorter than the bar. */
const TICK_FIT = 13
/** The live value chip beside the bar: its height and the gap it keeps. */
const CHIP_H = 22
const CHIP_GAP = 8
/** How close a mark has to come to the bar before it starts to light up, in px. */
const TICK_NEAR = 52
/** The bar's centre keeps this much from either end of the track, in px. */
const INSET = SCALE_BAR_THICK / 2
/**
 * The wake's lag, in ms: an exponential tail, so its length is the speed (a
 * steady 480px/s drag trails ~58px behind; a flick, several times that). Long
 * enough that the streak reads as one, short enough that it dissolves in a
 * quarter second when the drag stops.
 */
const WAKE_TAU = 120
/**
 * How fast the wake comes in: a tail shorter than `WAKE_MIN` px is not drawn at
 * all (a stopped bar leaves nothing), and it reaches full weight `WAKE_RAMP` px
 * further on, so a slow nudge stays a faint smudge and only a real streak reads.
 */
const WAKE_MIN = 6
const WAKE_RAMP = 36
/** The wake's weight at full tilt: always under the bar it trails. */
const WAKE_MAX = 0.9

/**
 * The canvas resize rail: the size control on the right edge of the stage.
 *
 * The corner handle is the direct control, and the tools sheet covers the
 * corner it sits on (the sheet is an overlay with no put-away state), so a tall
 * canvas or an expanded dock hides it. This is the control that is always
 * reachable: the app's tick scale (`ui/TickScale`, the one the rotate dial
 * draws through) stood on its end along the stage's right edge, centred on the
 * part of the stage the sheet leaves visible, with the scale as a percentage
 * beside the bar while the pointer is there.
 *
 * It scales the canvas as a whole: `canvasFill` multiplies both edges, so width
 * and height grow together, and up the rail is bigger. That is a size change to
 * the preview only; the export takes its ratio and long edge from the board and
 * the settings. Double-click fits the canvas to the stage again.
 *
 * Feel (`lib/canvasRail` decides the numbers): a drag leans onto 100% and a
 * release next to it lands there exactly; past either end the bar gives a
 * little and springs back instead of stopping dead; the marks near the bar
 * light up as it passes; and the bar drags a short trail behind it, so a fast
 * slide leaves afterimages the way a physical dial does. The trail is the
 * chrome's, not the board's: the canvas follows the pointer exactly.
 *
 * A press anywhere on the band grabs the value where it is and drags it
 * relatively, the way a finger on a camera's zoom scale does. The bar is a 3px
 * playhead, not a handle to hit, and nothing jumps under the press.
 *
 * Left alone the rail draws itself in to a stub at the edge (3.2s idle; 8s on
 * the first visit), with the bar and the marks around it still parked at the
 * current size, so a full ladder does not lie over the photo for the whole
 * session. Hover, focus or a press draws it back out.
 */
export function CanvasResizeRail() {
  const t = useT()
  const coarse = useMediaQuery('(pointer: coarse)')
  const bandW = coarse ? BAND_W_COARSE : BAND_W
  /** A finger gets a slightly bigger bar; a drag presses it wider still. */
  const restScale = coarse ? 1.25 : 1

  const rootRef = useRef<HTMLDivElement | null>(null)
  const railRef = useRef<HTMLDivElement | null>(null)

  const fill = useStore(s => activeWs(s).canvasFill)
  const tall = tallnessOfFill(fill)

  // Drawn out full length: on hover, focus, a press, or right after a size
  // change. At rest the ladder keeps its stub (`TRACK_IDLE`).
  const [open, setOpen] = useState(true)
  const [drag, setDrag] = useState(false)
  /** The bar's give past an end, in px (the scale itself is already clamped). */
  const [give, setGive] = useState(0)
  // A finger covers the bar and its chip while it drags, and touch has no hover
  // to leave the chip up afterwards, so the value lingers a moment past the
  // release there. A mouse keeps it on hover anyway.
  const [readout, setReadout] = useState(false)
  const readoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Another control changed the size (undo, a workspace switch): show the bar
  // where it landed. Derived during render rather than in an effect, which
  // would re-render a second time; our own drag leaves it open already.
  const [seenFill, setSeenFill] = useState(fill)
  if (seenFill !== fill) {
    setSeenFill(fill)
    if (!open)
      setOpen(true)
  }
  // The rail's box is frozen while a drag runs (see `useRailBox`).
  const box = useRailBox(rootRef, drag)
  const hoveringRef = useRef(false)
  const focusedRef = useRef(false)
  const draggingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * The rail's rect and the grab this gesture started with, frozen at
   * pointerdown: a press grabs the value where it is and the drag carries it
   * from there, so nothing snaps under the pointer.
   */
  const heldRef = useRef<{ from: number, tall: number } | null>(null)
  const firstArmRef = useRef(true)

  const track = box.track
  const travel = Math.max(0, track - 2 * INSET)
  /** The bar's offset from the travel's own top, give included. */
  const lift = travel * (1 - tall) + give
  /** Where the bar is trying to be, in px from the travel's top, for the wake. */
  const targetRef = useRef(0)
  /** The wake: where the tail has caught up to, the clock, and the frame handle. */
  const wakeRef = useRef({ y: 0, last: 0, frame: 0 })
  const wakeElRef = useRef<HTMLSpanElement | null>(null)
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

  /**
   * Run the wake: one tail eases toward the bar with an exponential lag, and the
   * gap is drawn as a single gradient streak from the bar back to where the tail
   * is (opaque at the bar, gone at the tail). Driven per frame because the one
   * thing a CSS transition cannot express is a wake whose *length* is the speed:
   * it fades to nothing the moment the bar stops, instead of parking a duplicate
   * under it. The styles are written here rather than through React state: a
   * board re-render per frame is exactly what a gesture must not do.
   */
  const pumpWake = useCallback(() => {
    if (reduceMotion || wakeRef.current.frame)
      return
    const step = (now: number) => {
      const wake = wakeRef.current
      const target = targetRef.current
      const dt = wake.last ? Math.min(64, now - wake.last) : 16
      wake.last = now
      wake.y += (target - wake.y) * (1 - Math.exp(-dt / WAKE_TAU))
      const gap = Math.abs(target - wake.y)
      const el = wakeElRef.current
      if (gap > 0.4) {
        wake.frame = requestAnimationFrame(step)
      }
      else {
        wake.frame = 0
        wake.last = 0
      }
      if (!el)
        return
      if (gap <= 0.4) {
        el.style.opacity = '0'
        return
      }
      // Opaque at the bar, gone at the tail: flipping keeps that end at the bar
      // whichever way it is travelling.
      // Meet the bar's edge, not its centre, so the streak has no seam with it.
      const tail = wake.y < target ? wake.y - SCALE_BAR_THICK / 2 : wake.y + SCALE_BAR_THICK / 2
      el.style.top = `${INSET + Math.min(target, tail)}px`
      el.style.height = `${Math.abs(target - tail)}px`
      el.style.scale = `1 ${wake.y < target ? -1 : 1}`
      // Capped under the bar: the wake trails it, it does not outshine it.
      el.style.opacity = (WAKE_MAX * Math.min(1, Math.max(0, (gap - WAKE_MIN) / WAKE_RAMP))).toFixed(3)
    }
    wakeRef.current.last = 0
    wakeRef.current.frame = requestAnimationFrame(step)
  }, [reduceMotion])

  const stopWake = useCallback(() => {
    if (wakeRef.current.frame)
      cancelAnimationFrame(wakeRef.current.frame)
    wakeRef.current.frame = 0
    wakeRef.current.last = 0
    if (wakeElRef.current)
      wakeElRef.current.style.opacity = '0'
  }, [])

  useEffect(() => () => stopWake(), [stopWake])

  const arm = useCallback(() => {
    if (timerRef.current != null)
      clearTimeout(timerRef.current)
    timerRef.current = null
    const delay = firstArmRef.current ? IDLE_FIRST_MS : IDLE_MS
    firstArmRef.current = false
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      if (!hoveringRef.current && !focusedRef.current && !draggingRef.current)
        setOpen(false)
    }, delay)
  }, [])

  useEffect(() => () => {
    if (timerRef.current != null)
      clearTimeout(timerRef.current)
    if (readoutTimerRef.current != null)
      clearTimeout(readoutTimerRef.current)
  }, [])

  // Start the idle clock on mount and on every size change, so a rail nobody
  // touches (and one an undo just opened) still tucks away again.
  useEffect(() => {
    arm()
  }, [arm, fill])

  const applyPointer = useCallback((clientY: number) => {
    const held = heldRef.current
    if (!held)
      return
    const travel = Math.max(1, box.track - 2 * INSET)
    const raw = held.tall + (held.from - clientY) / travel
    // Past an end the bar keeps moving a little (and springs back on release);
    // the canvas stops at the bound either way.
    const past = raw > 1 ? raw - 1 : raw < 0 ? raw : 0
    const give = rubberBand(-past * travel)
    setGive(give)
    targetRef.current = travel * (1 - clamp01(raw)) + give
    pumpWake()
    useStore.getState().setCanvasFill(assistFill(fillAtTallness(raw)))
  }, [box.track, pumpWake])

  const onMove = useCallback((e: PointerEvent) => applyPointer(e.clientY), [applyPointer])

  const end = useCallback(() => {
    if (!draggingRef.current)
      return
    draggingRef.current = false
    heldRef.current = null
    document.body.style.cursor = ''
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    setDrag(false)
    // The give is a spring back, not a snap: it lands in the same frame the
    // bar's transition comes back on.
    setGive(0)
    // A release next to the fit lands on it exactly, so the usual stop is a
    // round number instead of 99%.
    const s = useStore.getState()
    const now = activeWs(s).canvasFill
    const settled = settleFill(now)
    if (settled !== now)
      s.setCanvasFill(settled)
    // The bar is at rest now; let the wake catch up and dissolve.
    targetRef.current = travel * (1 - tallnessOfFill(settled))
    pumpWake()
    if (readoutTimerRef.current != null)
      clearTimeout(readoutTimerRef.current)
    readoutTimerRef.current = setTimeout(() => {
      readoutTimerRef.current = null
      setReadout(false)
    }, READOUT_HOLD_MS)
    arm()
  }, [arm, onMove, pumpWake, travel])

  // Unmounting mid-gesture (a route change) still has to let go of the pointer
  // and the global cursor.
  useEffect(() => () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    if (draggingRef.current)
      document.body.style.cursor = ''
  }, [onMove, end])

  const begin = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0)
      return
    const rail = railRef.current
    if (!rail)
      return
    const r = rail.getBoundingClientRect()
    if (r.height <= 0)
      return
    e.preventDefault()
    e.stopPropagation()
    heldRef.current = { from: e.clientY, tall }
    // The wake starts where the bar already is, so nothing flies in from zero.
    targetRef.current = travel * (1 - tall)
    wakeRef.current.y = targetRef.current
    draggingRef.current = true
    if (timerRef.current != null)
      clearTimeout(timerRef.current)
    timerRef.current = null
    setDrag(true)
    setOpen(true)
    if (readoutTimerRef.current != null)
      clearTimeout(readoutTimerRef.current)
    readoutTimerRef.current = null
    setReadout(true)
    // The gesture leaves the rail's own narrow band as it travels, so the
    // cursor follows the bar across the whole stage, like a divider drag's.
    document.body.style.cursor = 'row-resize'
    rail.setPointerCapture(e.pointerId)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }, [end, onMove, tall, travel])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === 'ArrowUp' || e.key === 'PageUp' ? 1 : e.key === 'ArrowDown' || e.key === 'PageDown' ? -1 : 0
    const page = e.shiftKey || e.key === 'PageUp' || e.key === 'PageDown'
    let next: number | null = null
    if (dir)
      next = nextTickFill(activeWs(useStore.getState()).canvasFill, dir, page ? RAIL_PAGE_STEPS : RAIL_KEY_STEPS)
    else if (e.key === 'Home')
      next = MIN_CANVAS_FILL
    else if (e.key === 'End')
      next = MAX_CANVAS_FILL
    if (next == null)
      return
    e.preventDefault()
    setOpen(true)
    useStore.getState().setCanvasFill(next)
  }, [])

  // A press grabs the rail before a double-click can land, so fitting again is
  // explicit: 100% (the stage fit), with the canvas ratio left alone.
  const fit = useCallback(() => {
    useStore.getState().setCanvasFill(1)
  }, [])

  /** The bar's centre down the rail, in px from its top. */
  const barCentre = INSET + lift
  const ticks = useMemo(() => railTicks(track, INSET), [track])
  const marks = useMemo(() => ticks.map((tick: RailTick) => {
    const y = tickY(tick.tall, track, INSET)
    return {
      at: 1 - tick.tall,
      length: tick.fit ? TICK_FIT : tick.major ? SCALE_MARK_HARD : SCALE_MARK_SOFT,
      strong: tick.fit || tick.major,
      near: clamp01(1 - Math.abs(y - barCentre) / TICK_NEAR),
    }
  }), [ticks, track, barCentre])
  // The value rides the bar's own settle curve, but not during the drag it is
  // reporting on.
  const settle = drag ? 'duration-0' : 'duration-(--dur-surface)'
  const chip = readout || drag
    ? 'scale-100 opacity-100'
    : 'scale-[0.96] opacity-0 group-hover/rail:scale-100 group-hover/rail:opacity-100 group-focus-visible/rail:opacity-100'
  // The ladder's resting window: a stub centred on the bar, pulled inside the
  // track's own ends so it never stands in mid-air.
  const stub = Math.min(TRACK_IDLE, track)
  const stubCentre = Math.min(Math.max(barCentre, stub / 2), track - stub / 2)
  const clip = open
    ? 'inset(0px)'
    : `inset(${stubCentre - stub / 2}px 0 ${track - stubCentre - stub / 2}px 0)`

  return (
    <>
      {/* Measured, not painted: the stage's own box, for the visible centre. */}
      <div ref={rootRef} aria-hidden className="pointer-events-none absolute inset-y-0 right-0 z-[9] w-0" />
      <div
        ref={railRef}
        role="slider"
        aria-orientation="vertical"
        aria-label={t('Canvas size')}
        aria-valuemin={Math.round(MIN_CANVAS_FILL * 100)}
        aria-valuemax={Math.round(MAX_CANVAS_FILL * 100)}
        aria-valuenow={Math.round(fill * 100)}
        aria-valuetext={fillLabel(fill)}
        tabIndex={0}
        title={t('Drag to resize the canvas · double-click to fit')}
        className="group/rail absolute right-0 z-[9] cursor-row-resize touch-none select-none outline-0"
        style={{ top: box.center - track / 2, height: track, width: bandW }}
        onPointerDown={begin}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        onPointerEnter={() => {
          hoveringRef.current = true
          setOpen(true)
          arm()
        }}
        onPointerLeave={() => {
          hoveringRef.current = false
          if (!draggingRef.current)
            arm()
        }}
        onFocus={() => {
          focusedRef.current = true
          setOpen(true)
          if (timerRef.current != null)
            clearTimeout(timerRef.current)
          timerRef.current = null
        }}
        onBlur={() => {
          focusedRef.current = false
          arm()
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          fit()
        }}
        onKeyDown={onKeyDown}
      >
        {/* The scale. Drawing it out and tucking it is one clip on the whole
            thing (track, marks and bar), so the marks are revealed in order and
            nothing is re-laid-out. */}
        <span
          aria-hidden
          data-rail-scale=""
          className="pointer-events-none absolute inset-0 transition-[clip-path] duration-(--dur-surface) ease-(--ease-out) motion-reduce:transition-none"
          style={{ clipPath: clip }}
        >
          <TickScale
            ticks={marks}
            value={1 - tall + give / Math.max(1, travel)}
            orientation="vertical"
            inset={INSET}
            tone="float"
            growth={0.45}
            barScale={restScale * (drag ? 1.35 : 1)}
            barMotion={drag ? 'still' : 'settle'}
          />
        </span>

        {/* Keyboard focus: the bar is a 3px playhead, so the ring is drawn
            around it rather than on it. */}
        <span
          aria-hidden
          className="pointer-events-none absolute rounded-[2px] border border-accent opacity-0 transition-opacity duration-(--dur-fast) group-focus-visible/rail:opacity-100"
          style={{
            right: (bandW - SCALE_BAR_LONG - 6) / 2,
            top: INSET - (SCALE_BAR_THICK + 6) / 2,
            width: SCALE_BAR_LONG + 6,
            height: SCALE_BAR_THICK + 6,
            translate: `0 ${lift}px`,
          }}
        />

        {/* The bar's wake: one streak from the bar back to where the tail has
            lagged to. Two gradients, the accent one inside a glass one, so the
            wake reads over a dark photo as well as a light one. */}
        <span
          ref={wakeElRef}
          aria-hidden
          data-rail-trail=""
          className="pointer-events-none absolute right-[1px] w-[18px] opacity-0 motion-reduce:hidden"
          style={{ top: INSET, height: 0 }}
        >
          {/* A 1px glass rim down each side (a fill would read as a lit card),
              then the accent core. All three fade together at the tail. */}
          <span className="absolute inset-y-0 left-0 w-px bg-[linear-gradient(to_bottom,var(--floatBg),transparent_88%)]" />
          <span className="absolute inset-y-0 right-0 w-px bg-[linear-gradient(to_bottom,var(--floatBg),transparent_88%)]" />
          <span className="absolute inset-y-0 left-px w-4 bg-[linear-gradient(to_bottom,var(--accent),transparent_88%)]" />
        </span>

        {/* The live value, beside the scale while the pointer (or focus) is
            there: the same floating chip the view-zoom readout uses. */}
        <span
          data-rail-value=""
          className={`absolute grid origin-right place-items-center border border-float-line bg-float-bg px-1.5 text-[11px] font-semibold tabular-nums text-float-icon backdrop-blur-[7px] transition-[opacity,translate,scale] ease-(--ease-out) motion-reduce:duration-0 ${settle} ${chip}`}
          style={{
            right: bandW / 2 + TICK_FIT / 2 + CHIP_GAP,
            top: INSET - CHIP_H / 2,
            height: CHIP_H,
            minWidth: 44,
            translate: `0 ${lift}px`,
          }}
        >
          {fillLabel(fill)}
        </span>
      </div>
    </>
  )
}

/**
 * The rail's box inside the stage: its centre is the middle of what the tools
 * sheet leaves visible, and its track is that height less a margin, capped so
 * a tall desktop stage does not grow a floor-to-ceiling scrollbar.
 *
 * Frozen while a drag runs (`frozen`): the sheet's edge moves when the dock
 * changes display mode, and a re-centre mid-gesture would slide the bar out
 * from under the pointer.
 */
function useRailBox(rootRef: RefObject<HTMLDivElement | null>, frozen: boolean) {
  // The stage's free strip: below the action cluster, above the tools sheet.
  const actionsBottom = useFloatingActionsBottom()
  const sheetTop = useToolsSheetTop()
  const [box, setBox] = useState({ center: TRACK_MIN / 2, track: TRACK_MIN })

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el)
      return
    const read = () => {
      if (frozen)
        return
      const r = el.getBoundingClientRect()
      const top = actionsBottom == null ? r.top : Math.max(r.top, actionsBottom + EDGE_INSET)
      const bottom = sheetTop == null ? r.bottom : Math.min(r.bottom, sheetTop - EDGE_INSET)
      const visible = Math.max(0, bottom - top)
      if (visible <= 0)
        return
      const track = Math.min(TRACK_MAX, Math.max(TRACK_MIN, visible - 2 * EDGE_INSET), visible)
      const center = top - r.top + visible / 2
      setBox(prev => (
        Math.abs(prev.center - center) < 0.5 && Math.abs(prev.track - track) < 0.5
          ? prev
          : { center, track }
      ))
    }
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [rootRef, actionsBottom, sheetTop, frozen])

  return box
}
