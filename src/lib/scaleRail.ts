import { MAX_CANVAS_FILL, MIN_CANVAS_FILL } from '../store'

/**
 * The size rail's mapping and its tick ladder (`components/ScaleRail`), pure so
 * bun can test it without a DOM.
 *
 * The rail is one control with three targets. Its position is "tallness",
 * 0 at the bottom (smallest) and 1 at the top (largest), and a target's
 * `RailScale` says what that line spans: its bounds, its ladder's step, and the
 * stop that reads as natural (the stage fit for the canvas, a default size for a
 * sticker or a label). Every target scales uniformly, so a straight line is all
 * the mapping needs: equal travel is equal growth, and the natural stop sits
 * inside the range, which is what gives a drag upward somewhere to go.
 *
 * Three things ride that line and are decided here rather than in the
 * component:
 *
 * - **The ladder** (`railTicks`): which values get a mark. The rail is short on
 *   a phone and tall on a desktop, so the density is a function of the track,
 *   not a fixed list; the marks carry two weights (every step, and a longer one
 *   every five), and the natural stop is the one mark the rail draws longest.
 *   A bound that would crowd its neighbour is dropped: the track's own end
 *   already reads as a boundary.
 * - **The natural stop's magnetism** (`assistValue` / `settleValue`): only a
 *   target that asks for it (the canvas, whose 100% is worth landing on exactly)
 *   leans toward its stop inside a narrow band, and a release inside a narrower
 *   one takes it. The lean is a contraction toward the stop, zero at the band's
 *   edge, so the mapping stays monotonic and a continuing drag always walks out.
 * - **The ends' give** (`rubberBand`): past either bound the bar keeps moving a
 *   little instead of dead-stopping, then springs back on release. The object
 *   stops at the bound; the give is the bar's.
 *
 * The keyboard walks the same ladder (`nextTickValue`), so a keypress lands on
 * a mark the rail draws rather than on an arbitrary value.
 */

/**
 * One target's line: what the rail spans, how finely it is marked, and the stop
 * that reads as natural.
 */
export interface RailScale {
  /** The smallest and largest value the target may take. */
  min: number
  max: number
  /** The ladder's finest step, in the target's own units. */
  step: number
  /** The stop the rail marks as the target's natural size. */
  ref: number
  /**
   * How hard a drag leans onto `ref`: the band (in the target's units) either
   * side, and how close a release has to stop to take it exactly. Absent for
   * targets whose natural size is not worth a detent.
   */
  magnet?: { pull: number, capture: number }
}

/** The canvas: 100% is the stage fit, and that is worth landing on exactly. */
export const CANVAS_SCALE: RailScale = {
  min: MIN_CANVAS_FILL,
  max: MAX_CANVAS_FILL,
  step: 0.1,
  ref: 1,
  magnet: { pull: 0.04, capture: 0.02 },
}

/**
 * The canvas line as the stage's wheel drives it: fit and below, never past the
 * fit. The wheel's job on the air is showing the collage at the size the stage
 * holds; growing past the fit is the deliberate bleed the rail and the corner
 * handle offer, and it would also eat the wheel's own surface (a canvas past the
 * fit covers the air the gesture lives on, and the wheel would silently become a
 * photo zoom under the pointer). The rail keeps the full `CANVAS_SCALE` range,
 * and its own wheel reaches it, so nothing is lost.
 */
export const CANVAS_WHEEL_SCALE: RailScale = { ...CANVAS_SCALE, max: CANVAS_SCALE.ref }

/**
 * The step multipliers the ladder may thin to, in order: every step, then
 * fifths/quarters/halves of the range, so a short track never draws a comb.
 */
const STEP_FACTORS = [1, 2, 2.5, 5] as const
/** Marks are five steps apart at the finest, and that is a "long" mark. */
const MAJOR_FACTOR = 5
/**
 * The shortest gap two ticks may sit at, in px. A short track drops to a coarser
 * ladder rather than drawing a comb.
 */
export const RAIL_TICK_GAP = 9
/** How far the bar gives past an end, in px (it never travels further). */
export const RAIL_GIVE = 14

/** One arrow-key press: the next mark up or down the ladder. */
export const RAIL_KEY_STEPS = 1
/** A Shift + arrow, or a page key: the major spacing. */
export const RAIL_PAGE_STEPS = 5

/** How much of its distance to the stop the mapping removes at the stop itself. */
const MAGNET_LEAN = 0.7

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/** A value inside its target's bounds (the store applies them again on write). */
export function clampValue(v: number, scale: RailScale): number {
  if (!Number.isFinite(v))
    return scale.ref
  return Math.min(scale.max, Math.max(scale.min, v))
}

/** The value at a rail position. */
export function valueAtTallness(t: number, scale: RailScale): number {
  return scale.min + clamp01(t) * (scale.max - scale.min)
}

/** Where a value sits on the rail: 0 = smallest, 1 = largest. */
export function tallnessOfValue(v: number, scale: RailScale): number {
  if (!Number.isFinite(v))
    return tallnessOfValue(scale.ref, scale)
  return clamp01((v - scale.min) / (scale.max - scale.min))
}

/**
 * A tick's centre line down the rail, in px from its top: the same line the
 * bar's centre rides (`inset` at either end), so a mark and the bar agree about
 * where a value is. `inset` is half the bar's thickness: the bar cannot overhang.
 */
export function tickY(tall: number, track: number, inset: number): number {
  return inset + Math.max(1, track - 2 * inset) * (1 - tall)
}

export interface RailTick {
  /** The value the mark stands for, in the target's own units. */
  value: number
  /** Its position on the control, 0 at the bottom and 1 at the top. */
  tall: number
  /** A longer mark: every five steps, and both bounds. */
  major: boolean
  /** The target's natural size: the longest mark, and never a dim one. */
  ref: boolean
}

/** A value's distance to `step`-spaced values, tolerant of float drift. */
const near = (a: number, b: number, tolerance = 1e-6) => Math.abs(a - b) <= tolerance

/**
 * The marks the rail draws for a track of `track` px, bottom to top. The spacing
 * coarsens as the track shortens (`STEP_FACTORS`) so a phone never gets a comb
 * and a desktop never gets three lonely ticks.
 *
 * The landmarks go down first: both bounds and the natural stop are what the
 * scale is read against, so the grid fills in around them and never crowds one
 * out. A label's default size is not on the tenths grid, which is exactly the
 * mark the eye looks for.
 */
export function railTicks(track: number, inset: number, scale: RailScale): RailTick[] {
  const { min, max, step, ref } = scale
  const travel = Math.max(1, track - 2 * inset)
  const perStep = travel / ((max - min) / step)
  const factor = STEP_FACTORS.find(f => perStep * f >= RAIL_TICK_GAP) ?? MAJOR_FACTOR
  const spacing = step * factor
  /** A distance in the target's units, in px on this track. */
  const px = (units: number) => (units / step) * perStep
  // The natural stop outranks the bounds: it is the mark the scale is read
  // against, while a track's end already reads as a boundary by itself.
  const placed: number[] = []
  for (const landmark of [ref, max, min]) {
    const inside = landmark >= min && landmark <= max
    if (inside && placed.every(p => px(Math.abs(p - landmark)) >= RAIL_TICK_GAP))
      placed.push(landmark)
  }
  for (let k = Math.ceil(min / spacing); k * spacing < max - spacing * 1e-9; k++) {
    const v = k * spacing
    if (v > min + spacing * 1e-6 && placed.every(p => px(Math.abs(p - v)) >= RAIL_TICK_GAP))
      placed.push(v)
  }
  return placed.sort((a, b) => a - b).map(v => ({
    value: v,
    tall: tallnessOfValue(v, scale),
    major: near(v % (step * MAJOR_FACTOR), 0, step / 3) || near(v, min) || near(v, max),
    ref: near(v, ref, step * 1e-6),
  }))
}

/**
 * The ladder the keyboard walks: both bounds, every step between them, and the
 * natural stop. The drawn ladder may thin out on a short track; the keyboard
 * keeps the full one so a keypress reads the same at every screen size.
 */
export function railLadder(scale: RailScale): number[] {
  const { min, max, step } = scale
  const out: number[] = [min]
  for (let k = Math.ceil(min / step); k * step < max - step * 1e-9; k++) {
    const v = k * step
    // The bounds are pushed separately: skip only a mark that lands on one.
    if (v > min + step * 1e-6)
      out.push(v)
  }
  out.push(max)
  if (!out.some(v => near(v, scale.ref, step * 1e-6)))
    out.push(scale.ref)
  return out.sort((a, b) => a - b)
}

/**
 * The mark `steps` marks away from `value` in `dir`. A keypress lands on the
 * ladder, and past either end it stays on the bound.
 */
export function nextTickValue(value: number, dir: 1 | -1, scale: RailScale, steps = RAIL_KEY_STEPS): number {
  const ladder = railLadder(scale)
  const away = Math.max(1, Math.round(steps))
  if (dir > 0) {
    const up = ladder.findIndex(v => v > value + scale.step * 1e-6)
    if (up < 0)
      return scale.max
    return ladder[Math.min(ladder.length - 1, up + away - 1)]
  }
  let down = -1
  for (let i = ladder.length - 1; i >= 0; i--) {
    if (ladder[i] < value - scale.step * 1e-6) {
      down = i
      break
    }
  }
  if (down < 0)
    return scale.min
  return ladder[Math.max(0, down - away + 1)]
}

/**
 * Where a drag reads around the natural stop: inside the magnet's band `value`
 * leans toward the stop, by nothing at the band's edge and by `MAGNET_LEAN` at
 * the stop, so the mapping is continuous and monotonic and a continuing drag
 * always walks out of the band. A target with no magnet passes straight through.
 */
export function assistValue(value: number, scale: RailScale): number {
  const v = clampValue(value, scale)
  const magnet = scale.magnet
  if (!magnet)
    return v
  const d = v - scale.ref
  const u = Math.abs(d)
  if (u >= magnet.pull)
    return v
  return scale.ref + d * (1 - MAGNET_LEAN * (1 - u / magnet.pull))
}

/**
 * Where a release lands: inside the magnet's capture radius the value takes the
 * natural stop exactly, and everywhere else it keeps what the hand stopped at,
 * decimals and all.
 */
export function settleValue(value: number, scale: RailScale): number {
  const v = clampValue(value, scale)
  const magnet = scale.magnet
  if (!magnet)
    return v
  return near(v, scale.ref, magnet.capture) ? scale.ref : v
}

/**
 * The bar's visual overshoot for `px` of pointer past an end: it covers most of
 * the first few px, then flattens out at `limit` (tanh, so it is smooth at 0 and
 * asymptotic at the end). Only the chrome moves: the value it reports is already
 * clamped to the bound.
 */
export function rubberBand(px: number, limit = RAIL_GIVE): number {
  if (!Number.isFinite(px) || limit <= 0)
    return 0
  return limit * Math.tanh(px / limit)
}

/** One wheel notch: a tenth of the value, out of the fit. */
export const SCALE_WHEEL_RATE = 1.1
/** A step that crosses the natural stop and lands this close to it takes it. */
export const SCALE_WHEEL_SNAP = 0.06

/**
 * A wheel step on a line: `notches` at `SCALE_WHEEL_RATE` each, clamped to the
 * bounds. A line with a magnet takes its natural stop when a step *crosses* it
 * and lands near it (`SCALE_WHEEL_SNAP`), so wheeling through the fit lands on
 * it exactly while a step away from it is never a trap: a wheel can only be
 * caught passing the stop, not stuck leaving it, which matters because a
 * trackpad's fine wheel moves a few percent per event.
 */
export function stepValue(value: number, notches: number, scale: RailScale): number {
  if (!Number.isFinite(notches) || notches === 0)
    return clampValue(value, scale)
  const next = clampValue(value * SCALE_WHEEL_RATE ** notches, scale)
  if (!scale.magnet)
    return next
  const crossed = (value - scale.ref) * (next - scale.ref) < 0
  return crossed && near(next, scale.ref, SCALE_WHEEL_SNAP) ? scale.ref : next
}

/**
 * How a target's value reads in the chip and in `aria-valuetext`: `percent` for
 * a scale against a reference (the canvas fit, a sticker's share of the canvas),
 * `size` for a value that is its own unit (a label's text size).
 */
export type RailFormat = 'percent' | 'size'

/** The numeric value the rail's readout animates: rounded like the label. */
export function railValue(value: number, format: RailFormat): number {
  if (!Number.isFinite(value) || value <= 0)
    return 0
  return format === 'percent' ? Math.round(value * 100) : Math.round(value)
}

export function railValueLabel(value: number, format: RailFormat): string {
  if (!Number.isFinite(value) || value <= 0)
    return '-'
  return format === 'percent' ? `${Math.round(value * 100)}%` : `${Math.round(value)}`
}
