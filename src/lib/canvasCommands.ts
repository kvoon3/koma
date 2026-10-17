import { activeWs, MAX_CANVAS_RATIO, MIN_CANVAS_RATIO, useStore } from '../store'

/**
 * The canvas ratio commands, shared by the workspace menu (CanvasMenu) and the
 * dock's ratio tool so neither re-derives them. They read the store through
 * `getState`, like lib/paneCommands: a caller only ever passes a ratio.
 *
 * Every write goes through `setCanvasSize`, which already commits the undo
 * step, so the ratio is one undoable change per command.
 */

/** Square, the ratio the dock's tool offers besides following a photo. */
export const SQUARE_RATIO = 1

/** The canvas ratio flipped by a quarter turn (p / landscape ⇄ the reverse). */
export function flippedRatio(ratio: number): number {
  return 1 / ratio
}

/** Clamp a raw ratio into what `setCanvasSize` accepts (see store.ts). */
export function clampCanvasRatio(ratio: number): number {
  return Math.min(MAX_CANVAS_RATIO, Math.max(MIN_CANVAS_RATIO, ratio))
}

/** Reshape the canvas, keeping how much of the visible stage it fills. */
export function setCanvasRatio(ratio: number) {
  if (!Number.isFinite(ratio) || ratio <= 0)
    return
  const s = useStore.getState()
  s.setCanvasSize(clampCanvasRatio(ratio), activeWs(s).canvasFill)
}

/** The current workspace's ratio, flipped. No-op on a grid of panes with no ratio set. */
export function flipCanvasRatio(): boolean {
  const ratio = activeWs(useStore.getState()).canvasRatio
  if (ratio == null)
    return false
  setCanvasRatio(flippedRatio(ratio))
  return true
}

/**
 * Follow the first photo that knows its size: the ratio a fresh board starts
 * out with. Returns false when the library has no sized photo yet.
 */
export function matchCanvasToFirstPhoto(): boolean {
  const first = useStore.getState().photos.find(p => p.trueW > 0 && p.trueH > 0)
  if (!first)
    return false
  setCanvasRatio(first.trueW / first.trueH)
  return true
}
