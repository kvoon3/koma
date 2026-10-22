import { MAX_CANVAS_FILL, MIN_CANVAS_FILL } from '../store'

/**
 * The canvas resize rail's mapping and its tick ladder (`CanvasResizeRail`),
 * pure so bun can test it without a DOM.
 *
 * The rail is a size control: its position is "tallness", 0 at the bottom
 * (smallest) and 1 at the top (largest), and `canvasFill` is the canvas's scale
 * against the stage fit. A straight line is all it needs: scaling multiplies
 * both edges by the same value, so equal travel is equal growth. 1 (fit) sits
 * between the ends, which is what gives a drag upward somewhere to go.
 *
 * Three things ride that line and are decided here rather than in the
 * component:
 *
 * - **The ladder** (`railTicks`): which scale values get a mark. The rail is
 *   short on a phone and tall on a desktop, so the density is a function of the
 *   track, not a fixed list, and the marks carry two weights (every tenth, and
 *   a longer one every half) with the fit as the one tinted mark;
 * - **the fit's magnetism** (`assistFill` / `settleFill`): 100% is the one stop
 *   worth landing on exactly, so a drag leans toward it inside a narrow band and
 *   a release inside a narrower one takes it. The lean is a contraction toward
 *   the stop, zero at the band's edge, so the mapping stays monotonic and a
 *   continuing drag always walks out of the band (no stuck bar);
 * - **the ends' give** (`rubberBand`): past either bound the bar keeps moving a
 *   little instead of dead-stopping, then springs back on release. The canvas
 *   itself stops at the bound; the give is the bar's, not the board's.
 *
 * The keyboard walks the same ladder (`nextTickFill`), so a keypress always
 * lands on a mark the rail draws rather than on 73%.
 */

/** The ladder's spacing, in canvas-scale points: every tenth of the fit. */
export const RAIL_LADDER_PTS = 10
/** Points between the longer marks. The fit (100) sits on one. */
export const RAIL_MAJOR_PTS = 50
/**
 * The shortest gap two ticks may sit at, in px. A short track drops to a coarser
 * ladder rather than drawing a comb.
 */
export const RAIL_TICK_GAP = 9
/** The fit's magnetic band, in scale points: a light lean toward 100%. */
export const FIT_PULL_PTS = 4
/** A release this close to the fit lands on it exactly. */
export const FIT_CAPTURE_PTS = 2
/** How far the bar gives past an end, in px (it never travels further). */
export const RAIL_GIVE = 14

/** One arrow-key press: the next mark up or down the ladder. */
export const RAIL_KEY_STEPS = 1
/** A Shift + arrow, or a page key: half the range, which is the major spacing. */
export const RAIL_PAGE_STEPS = 5

const MIN_PTS = Math.round(MIN_CANVAS_FILL * 100)
const MAX_PTS = Math.round(MAX_CANVAS_FILL * 100)
const SPAN_PTS = MAX_PTS - MIN_PTS

/**
 * The ladder the keyboard walks: both bounds, and every tenth between them. The
 * drawn ladder may thin out on a short track; the keyboard keeps the full
 * ladder so a keypress reads the same at every screen size.
 */
const LADDER: readonly number[] = (() => {
  const out = [MIN_PTS]
  for (let pts = Math.ceil((MIN_PTS + 1) / RAIL_LADDER_PTS) * RAIL_LADDER_PTS; pts < MAX_PTS; pts += RAIL_LADDER_PTS)
    out.push(pts)
  out.push(MAX_PTS)
  return out
})()

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/** The canvas scale bounds, applied (the store applies them again on write). */
export function clampFill(v: number): number {
  return Math.min(MAX_CANVAS_FILL, Math.max(MIN_CANVAS_FILL, Number.isFinite(v) ? v : 1))
}

/** The canvas scale at a rail position. */
export function fillAtTallness(t: number): number {
  return MIN_CANVAS_FILL + clamp01(t) * (MAX_CANVAS_FILL - MIN_CANVAS_FILL)
}

/** Where a canvas scale sits on the rail: 0 = smallest, 1 = largest. */
export function tallnessOfFill(fill: number): number {
  if (!Number.isFinite(fill))
    return tallnessOfFill(1)
  return clamp01((fill - MIN_CANVAS_FILL) / (MAX_CANVAS_FILL - MIN_CANVAS_FILL))
}

/**
 * A tick's centre line down the rail, in px from its top: the same line the
 * bar's centre rides (`inset` at either end), so a mark and the bar agree about
 * where "100%" is. `inset` is half the bar's thickness: the bar cannot overhang.
 */
export function tickY(tall: number, track: number, inset: number): number {
  return inset + Math.max(1, track - 2 * inset) * (1 - tall)
}

export interface RailTick {
  /** The canvas scale the mark stands for (1 = the stage fit). */
  fill: number
  /** Its position on the control, 0 at the bottom and 1 at the top. */
  tall: number
  /** A longer mark: every half of the range, and both bounds. */
  major: boolean
  /** The stage fit (100%): the one mark the rail tints on its own. */
  fit: boolean
}

/**
 * The marks the rail draws for a track of `track` px, bottom to top. The
 * spacing coarsens as the track shortens: tenths while the marks are at least
 * `RAIL_TICK_GAP` apart, then fifths, quarters and halves, so a phone never
 * gets a comb and a desktop never gets three lonely ticks. A bound that would
 * crowd the mark next to it is dropped: the track's own end already reads as a
 * boundary, and a doubled tick reads as a mistake.
 */
export function railTicks(track: number, inset: number): RailTick[] {
  const perPoint = Math.max(1, track - 2 * inset) / SPAN_PTS
  const step = [10, 20, 25, 50].find(points => perPoint * points >= RAIL_TICK_GAP) ?? RAIL_MAJOR_PTS
  const pts = [MIN_PTS]
  for (let v = Math.ceil(MIN_PTS / step) * step; v < MAX_PTS; v += step) {
    if (v > MIN_PTS)
      pts.push(v)
  }
  pts.push(MAX_PTS)
  const roomy = pts.filter((v, i) => {
    if (v !== MIN_PTS && v !== MAX_PTS)
      return true
    const below = i > 0 ? (v - pts[i - 1]) * perPoint : Number.POSITIVE_INFINITY
    const above = i < pts.length - 1 ? (pts[i + 1] - v) * perPoint : Number.POSITIVE_INFINITY
    return Math.min(below, above) >= RAIL_TICK_GAP
  })
  return roomy.map((v) => {
    const fill = v / 100
    return {
      fill,
      tall: tallnessOfFill(fill),
      major: v % RAIL_MAJOR_PTS === 0 || v === MIN_PTS || v === MAX_PTS,
      fit: v === 100,
    }
  })
}

/**
 * The mark `steps` marks away from `fill` in `dir`. A keypress lands on the
 * ladder, and past either end it stays on the bound.
 */
export function nextTickFill(fill: number, dir: 1 | -1, steps = RAIL_KEY_STEPS): number {
  const pts = fill * 100
  const away = Math.max(1, Math.round(steps))
  if (dir > 0) {
    const up = LADDER.findIndex(v => v > pts + 1e-6)
    if (up < 0)
      return MAX_PTS / 100
    return LADDER[Math.min(LADDER.length - 1, up + away - 1)] / 100
  }
  let down = -1
  for (let i = LADDER.length - 1; i >= 0; i--) {
    if (LADDER[i] < pts - 1e-6) {
      down = i
      break
    }
  }
  if (down < 0)
    return MIN_PTS / 100
  return LADDER[Math.max(0, down - away + 1)] / 100
}

/**
 * How much of its distance to the fit the mapping removes at the fit itself.
 * `detent.ts`'s shape, one stop instead of a lattice.
 */
const FIT_LEAN = 0.7

/**
 * Where a drag reads around the fit: inside `FIT_PULL_PTS` the scale leans
 * toward 100%, by nothing at the band's edge and by `FIT_LEAN` at the stop, so
 * the mapping is continuous and monotonic and a continuing drag always walks
 * out of the band.
 */
export function assistFill(fill: number): number {
  const f = clampFill(fill)
  const band = FIT_PULL_PTS / 100
  const d = f - 1
  const u = Math.abs(d)
  if (u >= band)
    return f
  return 1 + d * (1 - FIT_LEAN * (1 - u / band))
}

/**
 * Where a release lands: inside `FIT_CAPTURE_PTS` of the fit it takes it
 * exactly (that is the stop worth exact), and everywhere else it keeps the
 * scale the hand stopped at, decimals and all.
 */
export function settleFill(fill: number): number {
  const f = clampFill(fill)
  // Compared in points: a scale of 1.02 is 2/100 away, which is not exactly the
  // same float as `FIT_CAPTURE_PTS / 100`.
  return Math.abs(f * 100 - 100) <= FIT_CAPTURE_PTS + 1e-6 ? 1 : f
}

/**
 * The bar's visual overshoot for `px` of pointer past an end: it covers most of
 * the first few px, then flattens out at `limit` (tanh, so it is smooth at 0 and
 * asymptotic at the end). Only the chrome moves: the scale it reports is already
 * clamped to the bound.
 */
export function rubberBand(px: number, limit = RAIL_GIVE): number {
  if (!Number.isFinite(px) || limit <= 0)
    return 0
  return limit * Math.tanh(px / limit)
}

/**
 * The scale against the fit, as the slider's `aria-valuetext` and the readout
 * chip read it: `100%` is the canvas as the stage fits it, `150%` is half again
 * as large.
 */
export function fillLabel(fill: number): string {
  if (!Number.isFinite(fill) || fill <= 0)
    return '-'
  return `${Math.round(fill * 100)}%`
}
