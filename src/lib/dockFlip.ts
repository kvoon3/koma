/**
 * Motion for a display flip in the tools dock (lib/toolsDockMode). The drawer
 * keeps one tools list and the display is one attribute on the sheet, so a
 * flip re-styles every button in place: in the wrapped display the row folds
 * into several lines, and the tools that were past the row's scroll edge come
 * back into view. Without motion the buttons teleport to their new boxes in a
 * single frame, which reads as a hard snap mid-drag.
 *
 * A flip is FLIP'd instead: the tools' boxes are captured before the render
 * (ToolsDock.captureFlipFrom), the new ones measured after it with every
 * transform cleared, and each button starts on its old box through a transform
 * and glides to zero. A button that was clipped before the flip and is on
 * screen after it also fades in, so the wrap reads as the list unfolding
 * rather than the row being re-cut. Transform + opacity only, exactly like the
 * list swap (lib/dockSwap): the sheet's own drag transform is a separate
 * concern and the layout never moves.
 *
 * The math lives here, pure, so bun can test it without a DOM; ToolsDock owns
 * the reads and the animations.
 */
import { EASE_OUT, EASE_OUT_CSS } from './motionTokens'

/** Duration, seconds. --dur-fast (120ms) plus a hair so the fade lands with it. */
export const DOCK_FLIP_S = 0.13

/** The shared `--ease-out` token (lib/motionTokens) drives the glide. */
export const DOCK_FLIP_EASE = EASE_OUT

/** The same curve in the shape WAAPI (and CSS) take it. */
export const DOCK_FLIP_EASE_CSS = EASE_OUT_CSS

/** Moves under half a pixel are layout noise, not motion. */
export const DOCK_FLIP_MIN_PX = 0.5

export interface FlipBox {
  left: number
  top: number
  right: number
  bottom: number
}

export interface FlipStart {
  x: number
  y: number
}

/** The transform that puts `from` back on screen: the start of a FLIP. */
export function flipStart(from: FlipBox, to: FlipBox): FlipStart {
  return { x: from.left - to.left, y: from.top - to.top }
}

/** Is the move worth an animation at all? */
export function isFlipMove(start: FlipStart, min = DOCK_FLIP_MIN_PX): boolean {
  return Math.abs(start.x) >= min || Math.abs(start.y) >= min
}

/**
 * Does any part of `box` lie inside the viewport? The tools scroll inside a
 * clip (the row horizontally, the wrapped list vertically), so an off-screen
 * box is fully clipped: it is not on screen even though it is laid out.
 */
export function isBoxVisible(box: FlipBox, view: FlipBox, min = DOCK_FLIP_MIN_PX): boolean {
  return box.right - min > view.left
    && box.left + min < view.right
    && box.bottom - min > view.top
    && box.top + min < view.bottom
}

/** Shift a box by a translate (the in-flight state of a running flip). */
export function shiftFlipBox(box: FlipBox, x: number, y: number): FlipBox {
  return { left: box.left + x, top: box.top + y, right: box.right + x, bottom: box.bottom + y }
}

export interface FlipItemPlan {
  /** FLIP start, px: the transform the glide begins on. */
  x: number
  y: number
  /** Was clipped before the flip and is on screen after it: fade it in. */
  enter: boolean
  /** Is the tool on screen after the flip? (Clipped before and after: skip it.) */
  visible: boolean
}

/**
 * What one tool does across a flip. `from` is the box it was showing before
 * the flip (null for a tool that has no previous box), `to` the box after it,
 * `view` the scroller both are clipped by.
 *
 * A tool clipped on both sides of the flip is invisible either way: it does
 * not animate, so a long list does not spin up work nobody can see. An exit
 * needs no opacity: the new box is clipped, so the button slides out under the
 * clip edge by the same glide as everything else.
 */
export function planFlipItem(input: { from: FlipBox | null, to: FlipBox, view: FlipBox }): FlipItemPlan {
  const { from, to, view } = input
  const visible = isBoxVisible(to, view)
  const wasVisible = from != null && isBoxVisible(from, view)
  if (!visible && !wasVisible)
    return { x: 0, y: 0, enter: false, visible }
  const start = from ? flipStart(from, to) : { x: 0, y: 0 }
  const move = isFlipMove(start) ? start : { x: 0, y: 0 }
  return { x: move.x, y: move.y, enter: from != null && !wasVisible && visible, visible }
}

/**
 * The translate a computed `transform` carries, px. A flip is a pure translate,
 * so the matrix's translation column is all an interrupted flip needs to read
 * to resume from where it was.
 */
export function parseTranslate(transform: string | null | undefined): FlipStart {
  if (!transform || transform === 'none')
    return { x: 0, y: 0 }
  const body = /^matrix(3d)?\(([^)]+)\)$/.exec(transform.trim())
  if (!body)
    return { x: 0, y: 0 }
  const parts = body[2]!.split(',').map(n => Number(n))
  // matrix(a, b, c, d, tx, ty); matrix3d(... 16 values, tx at 12).
  const x = body[1] ? parts[12] : parts[4]
  const y = body[1] ? parts[13] : parts[5]
  return { x: Number.isFinite(x) ? x! : 0, y: Number.isFinite(y) ? y! : 0 }
}
