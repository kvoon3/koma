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
