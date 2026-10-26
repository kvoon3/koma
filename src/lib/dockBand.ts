/**
 * The displacement field between the tools dock's labelled row and its
 * wrapped multi-row display (see DESIGN.md, "the dock"). The two displays are
 * two layouts of the same buttons, and layouts cannot be tweened. What can be
 * tweened is each button's transform, so during the band between the two snap
 * heights every tool sits on its row box displaced toward its wrapped box by a
 * staggered share of the band's progress:
 *
 *     translate_k = D_k · u_k(p),   u_k(p) = bandEase(clamp01((p − slot_k.start) / slot_k.width))
 *
 * `p` is a pure function of the live sheet height and `u_k` is a pure function
 * of `p`, so drags, release springs, taps and reversals all get the same
 * cascade with no animation state to interrupt or unwind. The math lives here,
 * DOM-free, so bun can test it; `ToolsDock` owns the reads and the writes.
 */

/**
 * Tools the schedule aims to have mid-flight at once. The per-tool window is
 * derived from it, so "one by one" is a property of the schedule rather than
 * an accident of how many tools the route has: a fixed window turns 12 tools
 * into one wave and 4 into one burst.
 */
export const BAND_CONCURRENCY = 3
/** Floor on the window so a very long list still overlaps into a cascade. */
export const BAND_WINDOW_MIN = 0.2
/** Ceiling on the window so a short list still reads as a sequence. */
export const BAND_WINDOW_MAX = 0.5

/** One tool's window inside the band, in progress units. */
export interface BandSlot {
  /** Band progress at which this tool starts moving, [0, 1). */
  readonly start: number
  /** Share of the band the tool's move takes, (0, 1]. */
  readonly width: number
}

/** A tool's box in each endpoint layout, container-relative px. */
export interface DockToolBoxes {
  readonly row: { readonly x: number, readonly y: number }
  readonly wrap: { readonly x: number, readonly y: number }
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

/**
 * How far the sheet has travelled between the row snap and the expanded snap,
 * [0, 1]. `lower` is the row's snap height, `upper` the wrapped one's, both
 * handle included. Spring overshoot past either end clamps, and a degenerate
 * band (upper at or below lower) reads 0: it is never active, and
 * `dockDisplayAt` guards the display rule for it separately.
 */
export function bandProgress(liveH: number, lower: number, upper: number): number {
  if (upper > lower)
    return clamp01((liveH - lower) / (upper - lower))
  return 0
}

/** The per-slot curve: smoothstep, chosen for zero slope at both ends. */
export function bandEase(x: number): number {
  const t = clamp01(x)
  return t * t * (3 - 2 * t)
}

/**
 * One slot per tool, in the order the cascade visits them (visual order, see
 * `ToolsDock`). The first starts at 0, the last ends at exactly 1, and the
 * starts are evenly spaced, so no tool is ever left mid-flight when the band
 * closes at either end.
 *
 * The last slot's start is written as `1 - width` rather than as
 * `(count - 1) * step`: the sum `(1 - width) + width` rounds to exactly 1 in
 * double precision for every width the window produces (it is at most 0.5),
 * while the product of a rounded step is not exact. That is what makes the
 * closing edge exact rather than merely close.
 */
export function bandSchedule(count: number): readonly BandSlot[] {
  if (count <= 0)
    return []
  if (count === 1)
    return [{ start: 0, width: 1 }]
  const width = Math.min(BAND_WINDOW_MAX, Math.max(BAND_WINDOW_MIN, BAND_CONCURRENCY / (count + 2)))
  const step = (1 - width) / (count - 1)
  const slots: BandSlot[] = []
  for (let i = 0; i < count - 1; i++)
    slots.push({ start: i * step, width })
  slots.push({ start: 1 - width, width })
  return slots
}

/**
 * The eased share of the move a tool has made at `progress`, 0 before its
 * slot, 1 after it, monotone in between. Symmetric in progress, so expand and
 * collapse are exact time mirrors of each other rather than two animations
 * that happen to agree.
 */
export function bandPush(slot: BandSlot, progress: number): number {
  return bandEase(clamp01((progress - slot.start) / slot.width))
}

/**
 * Seconds a tap should take to walk the band with `count` tools. The pacing
 * holds the cascade: the pacing curve's steepest middle runs ~1.7x the
 * average speed, so while the duration scales, 50 ms per tool keeps adjacent
 * window openings ~23 ms apart at the steepest instant, comfortably a frame
 * at 60 fps. The 0.85 s ceiling ends the scaling, and past 24 tools adjacent
 * openings can share a frame there. Measured floor and ceiling: under 0.4 s
 * a tap feels like a snap, past 0.85 s the sheet feels reluctant.
 */
export function bandTapSeconds(count: number): number {
  return Math.min(0.85, Math.max(0.4, 0.05 * Math.max(0, count - 1)))
}
