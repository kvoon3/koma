/**
 * The canvas view zoom: one view-level `scale` on the canvas wrapper, driven
 * from the stage AROUND the canvas (the empty margin, the checker backdrop).
 * It is session working view only: not part of the board, not in the undo
 * history, never persisted. Photo zoom inside a pane is a different thing
 * (`Pane.tsx`, `zoomAbout`) and keeps its own range and its own gestures.
 *
 * Composition: the scale is a CSS `transform` around the canvas's centre, and
 * every gesture that turns client pixels into canvas pixels divides by
 * `viewScaleAt` (see the callers), while plain DOM hit testing (clicks,
 * buttons, focus) needs no correction because the browser already maps through
 * the transform. The live value rides the canvas wrapper's `CANVAS_VIEW_ATTR`
 * attribute, so a gesture can read it without the component tree re-rendering
 * on every wheel notch.
 */

/** The range the view scales over: a quarter out, two and a half in. */
export const VIEW_MIN = 0.25
export const VIEW_MAX = 2.5

/**
 * The wrapper's scale marker: its value is the live view scale, 1 at fit.
 * `viewScaleAt` reads it; e2e reads it off the same attribute.
 */
export const CANVAS_VIEW_ATTR = 'data-canvas-view'

/** The scale one wheel gesture may move to, clamped to the view range. */
export function clampViewScale(scale: number): number {
  if (!Number.isFinite(scale))
    return 1
  return Math.min(VIEW_MAX, Math.max(VIEW_MIN, scale))
}

/**
 * The step one wheel event takes: a mouse notch (deltaY 100) is exactly 1.1×,
 * and a pinch notch (a trackpad reports ~20px with ctrl held, which is also
 * how a trackpad pinch arrives) lands on the same 1.1×. One event never moves
 * more than 1.1^1.5, so a stray delta (or a line-mode wheel) cannot jump the
 * view across the range.
 */
export function viewWheelFactor(deltaY: number, pinch: boolean): number {
  const notches = Math.max(-1.5, Math.min(1.5, -deltaY / (pinch ? 20 : 100)))
  return 1.1 ** notches
}

/**
 * The view scale in force at `node`: the value riding the nearest canvas
 * wrapper. Gesture math that maps client pixels to canvas pixels divides by
 * it; outside the canvas (the stage margin, a dialog) it is 1.
 */
export function viewScaleAt(node: Element | null | undefined): number {
  const wrapper = node?.closest(`[${CANVAS_VIEW_ATTR}]`)
  const raw = wrapper?.getAttribute(CANVAS_VIEW_ATTR)
  if (!raw)
    return 1
  const scale = Number(raw)
  return Number.isFinite(scale) && scale > 0 ? scale : 1
}

/** The whole percentage the indicator chip shows. */
export function viewPercent(scale: number): number {
  return Math.round(scale * 100)
}

/** Is the view off fit? (The chip and the fit affordance hang off this.) */
export function isOffFit(scale: number): boolean {
  return Math.abs(scale - 1) > 1e-3
}

/**
 * The canvas's transform for a given scale: nothing at fit (so the element
 * keeps the exact box every measurement was written against), a scale about
 * its centre otherwise.
 */
export function viewTransform(scale: number): string | undefined {
  return isOffFit(scale) ? `scale(${scale})` : undefined
}
