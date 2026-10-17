/**
 * Detent rotation math, shared by every rotation UI in the app (pane photos
 * now; board stickers and labels when they migrate onto the same control). Pure,
 * so `components/ui/RotationControl.tsx` only maps pointers to degrees and
 * paints, and the snapping that a user's hand actually feels is pinned by tests.
 *
 * Degrees are the UI unit: a readout reads 15°, 45°, the lattice is in degrees,
 * and the pointer maps straight onto it. The store keeps radians, wrapped to
 * (-π, π] by `wrapAngle` (lib/panes), so the two convert at the control's edge.
 *
 * Two lattice spacings, which is what makes the dial feel like a detent ring:
 * a SOFT tick every 15°, a HARD one every 90° that owns a wider magnetic band so
 * upright / sideways / upside down are easy to land on, and a fine path at 1°
 * for an angle that sits between two ticks.
 */

/** Soft detent: the tick a detent drag clicks through. */
export const SOFT_STEP_DEG = 15
/** Hard detent: the natural orientations (0, ±90, 180). */
export const HARD_STEP_DEG = 90
/** Fine path granularity: an angle between the ticks. */
export const FINE_STEP_DEG = 1
/**
 * Magnetism half-width (degrees) of a hard tick. Wider than half of the soft
 * spacing (7.5°), which is what makes 0 / ±90 / 180 hold instead of being a
 * tick like any other.
 */
export const HARD_PULL_DEG = 10
/** A full turn either way: the dial's range, and the period of the wrap. */
export const FULL_TURN_DEG = 360

const HALF_TURN = FULL_TURN_DEG / 2
const RAD_PER_DEG = Math.PI / 180

/** Fold degrees into (-180, 180], the seam radians fold at (see `wrapAngle`). */
export function wrapDeg(deg: number): number {
  const t = deg % FULL_TURN_DEG
  // `+ 0` folds -0 into +0, so a readout never renders "-0°".
  if (t > HALF_TURN)
    return t - FULL_TURN_DEG + 0
  if (t <= -HALF_TURN)
    return t + FULL_TURN_DEG + 0
  return t + 0
}

export const degToRad = (deg: number) => deg * RAD_PER_DEG
export const radToDeg = (rad: number) => rad / RAD_PER_DEG

/** The multiple of `step` nearest `deg` (not wrapped: callers wrap). */
export function nearestStep(deg: number, step: number): number {
  if (step <= 0)
    return deg
  // `+ 0` folds -0 into +0, so the lattice never hands back a negative zero.
  return Math.round(deg / step) * step + 0
}

/**
 * Where a detent drag lands. A hard tick owns ±HARD_PULL_DEG; everywhere else
 * the value falls on the nearest soft tick, so a detent control never reports an
 * angle that is off the lattice.
 */
export function snapDetent(deg: number): number {
  const hard = nearestStep(deg, HARD_STEP_DEG)
  if (Math.abs(deg - hard) <= HARD_PULL_DEG)
    return wrapDeg(hard)
  return wrapDeg(nearestStep(deg, SOFT_STEP_DEG))
}

/** Where a fine drag lands: FINE_STEP_DEG steps, with no detent pull. */
export function snapFine(deg: number): number {
  return wrapDeg(nearestStep(deg, FINE_STEP_DEG))
}

/**
 * One keyboard nudge, wrapped. Shift asks for a hard step (90°), the default is
 * a soft one (15°); the fine path passes 1.
 */
export function nudgeDeg(deg: number, step: number, dir: 1 | -1): number {
  return wrapDeg(deg + step * dir)
}

export interface DetentTick {
  /** Position on the dial, in degrees. */
  deg: number
  /** A hard tick (multiple of 90°): drawn taller and used as a hard stop. */
  hard: boolean
}

/**
 * The dial's tick marks across a full turn, both ends included: -180 and 180 are
 * the same orientation, drawn at the two ends of the track.
 */
export function detentTicks(step = SOFT_STEP_DEG): DetentTick[] {
  const ticks: DetentTick[] = []
  for (let deg = -HALF_TURN; deg <= HALF_TURN; deg += step)
    ticks.push({ deg, hard: deg % HARD_STEP_DEG === 0 })
  return ticks
}

/** A dial angle as a percentage across the track (0% = -180°, 100% = 180°). */
export function dialPercent(deg: number): number {
  return ((wrapDeg(deg) + HALF_TURN) / FULL_TURN_DEG) * 100
}

/**
 * The angle (degrees) a pointer at `ratio` (0..1 across the track) asks for.
 * The track spans a full turn, so its two ends are the same orientation: the
 * left end folds onto +180 (the wrap's seam). The control keeps its knob on the
 * side the pointer is on (see `RotationControl`).
 */
export function dialDegAt(ratio: number): number {
  const r = Math.min(1, Math.max(0, ratio))
  return wrapDeg(-HALF_TURN + r * FULL_TURN_DEG)
}

/** The dial's readout: whole degrees, never "-0°". */
export function formatDeg(deg: number): string {
  const d = Math.round(wrapDeg(deg))
  return d === 0 ? '0°' : `${d}°`
}
