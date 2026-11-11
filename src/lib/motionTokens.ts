/**
 * The UI's motion curves, in the shapes a JS-driven animation needs them.
 *
 * `index.css` owns the tokens (`--ease-out`, `--dur-fast`, …) that CSS
 * consumes; WAAPI and motion/react cannot pass a CSS variable as an `ease`,
 * so anything animating from JS has to spell the curve out. It spells it out
 * here, once, instead of copying the four numbers into every driver, so the CSS
 * token and the JS constant change together or not at all.
 */

/** `--ease-out` as JS: the strong ease-out surfaces and moves settle on. */
export const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1]

/** The same curve in the shape WAAPI (and CSS) take it. */
export const EASE_OUT_CSS = `cubic-bezier(${EASE_OUT.join(', ')})`

/**
 * The symmetric ease shape, gentle in and out. A tween whose per-item
 * stagger is the point (the dock's display band, lib/dockBand) must map time
 * to progress almost evenly: a strong ease-out spends most of the distance in
 * the first frames and every window opens at once, which reads as a wave, not
 * a cascade. This shape's peak slope stays ~1.7x the average, so with the
 * duration the schedule picks, window openings keep a frame to themselves at
 * 60 fps through 24 tools (measured, lib/dockBand.test.ts). The per-item
 * curve supplies the character; this one only paces it.
 */
export const EASE_IN_OUT: [number, number, number, number] = [0.45, 0.05, 0.55, 0.95]

/** `--ease-in-out` as JS: the grid cells' 260ms move. */
export const EASE_MORPH: [number, number, number, number] = [0.77, 0, 0.175, 1]

/** `--dur-morph`: the grid cell's move, in ms. */
export const MORPH_MS = 260

/** A cubic-bezier's y at x = t. */
export function cubicBezier(ease: readonly [number, number, number, number], t: number): number {
  if (t <= 0)
    return 0
  if (t >= 1)
    return 1
  const [x1, y1, x2, y2] = ease
  const ax = 3 * x1 - 3 * x2 + 1
  const bx = 3 * x2 - 6 * x1
  const cx = 3 * x1
  const ay = 3 * y1 - 3 * y2 + 1
  const by = 3 * y2 - 6 * y1
  const cy = 3 * y1
  const sample = (s: number, a: number, b: number, c: number) => ((a * s + b) * s + c) * s
  const slope = (s: number, a: number, b: number, c: number) => (3 * a * s + 2 * b) * s + c
  let s = t
  for (let i = 0; i < 8; i++) {
    const x = sample(s, ax, bx, cx) - t
    if (Math.abs(x) < 1e-6)
      break
    const d = slope(s, ax, bx, cx)
    if (Math.abs(d) < 1e-6)
      break
    s -= x / d
  }
  return sample(Math.min(1, Math.max(0, s)), ay, by, cy)
}
