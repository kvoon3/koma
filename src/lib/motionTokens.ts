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
