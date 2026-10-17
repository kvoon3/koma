/**
 * Rotation math, shared by every rotation UI in the app (pane photos now; board
 * stickers and labels when they migrate onto the same control). Pure, so
 * `components/ui/RotationControl.tsx` only maps pointers to degrees and paints,
 * and the feel a user's hand actually gets is pinned by tests.
 *
 * Degrees are the UI unit: the readout reads 23.7°, the ticks are in degrees,
 * and the pointer maps straight onto the dial. The store keeps radians, wrapped
 * to (-π, π] by `wrapAngle` (lib/panes), so the two convert at the control's
 * edge.
 *
 * Dragging is stepless. The pointer's angle is the value (no lattice, no
 * rounding), and the ticks survive only as magnetism on the way through:
 *
 * - a SOFT tick every 15° owns a narrow band (`SOFT_ASSIST_DEG`) where the
 *   mapping leans toward the tick: a suggestion, light enough to talk over;
 * - a HARD tick every 90° (upright, sideways, upside down) owns the wider
 *   `HARD_PULL_DEG` band with a firmer lean, so the reading slows down and
 *   hugs 90° as the hand crosses it. The lean is a contraction toward the tick,
 *   zero at the band's edge, so the map stays monotonic and a continuing drag
 *   always walks out of the band (no stuck knob, no click-through pause);
 * - letting go settles: within `HARD_CAPTURE_DEG` of a hard tick the angle
 *   folds onto it exactly (those are the orientations worth exact), and
 *   everywhere else release keeps whatever angle the hand stopped at, decimals
 *   and all. Soft ticks never capture: they are only felt while dragging.
 *
 * The keyboard is quantized on purpose (a11y): 15° arrows, 90° with Shift, 1°
 * with Alt (`nudgeDeg`). The `1°` toggle keeps a quantized drag for anyone who
 * wants whole degrees, and `snapDetent`/`snapFine` remain the lattice landings
 * that model describes.
 */

/** Soft detent: the tick a quantized drag clicks through, and a light assist. */
export const SOFT_STEP_DEG = 15
/** Hard detent: the natural orientations (0, ±90, 180). */
export const HARD_STEP_DEG = 90
/** Fine path granularity: an angle between the ticks. */
export const FINE_STEP_DEG = 1
/**
 * Magnetism band (degrees either side) of a hard tick. Wider than half of the
 * soft spacing (7.5°), which is what makes 0 / ±90 / 180 hold instead of being
 * a tick like any other.
 */
export const HARD_PULL_DEG = 10
/**
 * Assist band (degrees either side) of a soft tick: a light suggestion, well
 * inside the hard band's reach so a soft tick never competes with a hard one.
 */
export const SOFT_ASSIST_DEG = 4
/**
 * Release capture radius (degrees) around a hard tick: stop inside it and the
 * angle settles onto the tick exactly. Outside it, release keeps the angle.
 */
export const HARD_CAPTURE_DEG = 2.5
/** A full turn either way: the dial's range, and the period of the wrap. */
export const FULL_TURN_DEG = 360

/**
 * How much of its distance to the tick the mapping removes at the tick itself
 * (the lean fades to nothing at the band's edge). Hard is the firmer of the two.
 */
const HARD_ASSIST = 0.8
const SOFT_ASSIST = 0.6

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
 * `deg` pulled toward `tick`: inside `band`, the distance is contracted by
 * `strength` at the tick and by nothing at the band's edge, so the mapping is
 * monotonic (a drag can always escape) and continuous (no jump at the edge).
 */
function magnet(deg: number, tick: number, band: number, strength: number): number {
  const d = deg - tick
  const u = Math.abs(d)
  if (u >= band)
    return deg
  return tick + d * (1 - strength * (1 - u / band))
}

/**
 * Where a continuous drag reads: the pointer's own angle, leaning toward the
 * hard tick inside `HARD_PULL_DEG` and toward the soft tick inside
 * `SOFT_ASSIST_DEG`. Anything else is passed through exactly, so 23.7° stays
 * 23.7°.
 */
export function assistDeg(deg: number): number {
  const hard = nearestStep(deg, HARD_STEP_DEG)
  if (Math.abs(deg - hard) <= HARD_PULL_DEG)
    return wrapDeg(magnet(deg, hard, HARD_PULL_DEG, HARD_ASSIST))
  const soft = nearestStep(deg, SOFT_STEP_DEG)
  if (Math.abs(deg - soft) <= SOFT_ASSIST_DEG)
    return wrapDeg(magnet(deg, soft, SOFT_ASSIST_DEG, SOFT_ASSIST))
  return wrapDeg(deg)
}

/**
 * Where a drag lands when the pointer comes up: a hard tick within
 * `HARD_CAPTURE_DEG` takes the angle exactly (upright and sideways settle under
 * the hand), everything else is kept as it is, soft ticks included.
 */
export function settleDeg(deg: number): number {
  const hard = nearestStep(deg, HARD_STEP_DEG)
  if (Math.abs(deg - hard) <= HARD_CAPTURE_DEG)
    return wrapDeg(hard)
  return wrapDeg(deg)
}

/**
 * Where a quantized detent drag lands. A hard tick owns ±HARD_PULL_DEG;
 * everywhere else the value falls on the nearest soft tick. The continuous dial
 * does not use it; it is the lattice `snapFine` sits beside.
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

/**
 * The dial's readout: one decimal at most, and a whole degree drops the ".0"
 * (90°, 23.7°, 0°). Wraps first, then rounds, so the seam reads 0° and never
 * "-0°".
 */
export function formatDeg(deg: number): string {
  const d = Math.round(wrapDeg(deg) * 10) / 10
  if (d === 0)
    return '0°'
  return Number.isInteger(d) ? `${d}°` : `${d.toFixed(1)}°`
}
