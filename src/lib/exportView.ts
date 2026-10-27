/**
 * The export preview's zoom and pan. The view is a point ON THE IMAGE, in image
 * fractions, plus a scale relative to fit: `cx`,`cy` is the image point under
 * the centre of the viewport, `scale` 1 is the whole image contained. Box-free
 * by construction, so a window resize or a phone rotation re-derives the
 * transform and the minimap's window from the same three numbers; only their
 * legality depends on the box, and that is the clamp's job.
 *
 * Session-only and local to one preview mount: not part of the board, not in
 * the undo history, never persisted. The item's object URL is the identity and
 * React's `key` is the reset (see `ExportPreview`).
 *
 * The range's top is the native-pixel rule, not a round number: one image pixel
 * per CSS pixel is what "100%" means in an image editor, and at fit an image
 * pixel is `fit / image` CSS px, so the ceiling is `1 / fitRatio`. An export
 * already drawn larger than its own pixels has a ceiling of 1, which switches
 * the feature off for that item: there is nothing to reveal, and the arithmetic
 * says so rather than a special case.
 */
import type { MinimapView } from './boardPaint'
import { viewPercent } from './canvasView'

/** A width/height pair: the image's own pixels, or the stage's CSS box. */
export interface Size {
  w: number
  h: number
}

/**
 * The preview's zoom and pan, in image fractions. The three numbers are the
 * minimum that expresses "which part of the image, and how big"; the minimap's
 * window is a centred rect around `(cx, cy)`, and a resize changes nothing but
 * legality.
 */
export interface ExportView {
  scale: number
  cx: number
  cy: number
}

/** The export preview never zooms out of fit: a delivery preview has no use for it. */
export const EXPORT_MIN_ZOOM = 1

/**
 * The hard ceiling on the range's top. The top is `1 / fit` (native pixels, see
 * `zoomCeiling`); this only bounds what a very large export can ask for, so one
 * wheel notch keeps a sane meaning at the extreme.
 */
export const EXPORT_ZOOM_CAP = 8

/** The minimap's own threshold: chrome appears with the overflow (the pane rule). */
export const EXPORT_MINIMAP_ZOOM = 1.05

/**
 * How far off fit counts as zoomed. Matches `isOffFit` (canvasView.ts): a pinch
 * that returns to fit can land on 1.0000000000000002, and that must still
 * render the fit state (no transform, no `touch-none`, no chips).
 */
export const FIT_EPSILON = 1e-3

export const EXPORT_FIT: ExportView = { scale: 1, cx: 0.5, cy: 0.5 }

/**
 * The absent / not-yet-measured image. A zero `Size` is the identity that
 * `exportFrame` answers with fit, so a null item and the first paint before
 * measurement need no branch at the call site.
 */
export const NO_IMAGE: Size = { w: 0, h: 0 }

/**
 * Everything the render needs, from the raw state. `view` here is CLAMPED; the
 * component's state may be staler (a resize invalidates it), so the frame is
 * the truth every consumer draws: transform, window, chip, touch-action.
 */
export interface ExportFrame {
  view: ExportView
  /** The img's CSS transform; undefined at fit (the element keeps its layout). */
  transform: string | undefined
  /** The visible image region in image fractions (0..1): the minimap's rect. */
  window: MinimapView
  /** The chip's whole percentage, relative to fit. */
  percent: number
  /** There is overflow to pan: the stage owns the pointer (`touch-action: none`). */
  zoomed: boolean
  /** There is overflow worth navigating: the map appears. */
  minimap: boolean
}

/** The contained image box: the numbers `object-contain` lays out. */
function fitSize(image: Size, box: Size): Size {
  const s = Math.min(box.w / image.w, box.h / image.h)
  return { w: image.w * s, h: image.h * s }
}

/**
 * The top of the range: one image pixel per CSS pixel, capped. `fitRatio` is
 * the drawn CSS px per image px at fit (object-contain: one axis exact, the
 * other smaller).
 */
function zoomCeiling(image: Size, box: Size): number {
  const fit = fitSize(image, box)
  const fitRatio = Math.max(fit.w / image.w, fit.h / image.h)
  return Math.min(EXPORT_ZOOM_CAP, Math.max(EXPORT_MIN_ZOOM, 1 / fitRatio))
}

/**
 * The visible half-window, in image fractions, at a scale. At scale 1 both are
 * 0.5, which is why "fit is centred" is an invariant of the clamp rather than a
 * habit of its callers.
 */
function halfWindow(fit: Size, box: Size, scale: number): { hx: number, hy: number } {
  return {
    hx: Math.min(0.5, box.w / (2 * fit.w * scale)),
    hy: Math.min(0.5, box.h / (2 * fit.h * scale)),
  }
}

/**
 * The single clamp authority: the write path and the read path both end here.
 * A non-finite field (a broken gesture) falls back to fit's value for that
 * field; an unmeasured image or box has no legal view at all, so it is fit.
 */
function clampExportView(view: ExportView, image: Size, box: Size): ExportView {
  if (!(image.w > 0 && image.h > 0 && box.w > 0 && box.h > 0))
    return EXPORT_FIT
  const ceiling = zoomCeiling(image, box)
  const scale = Number.isFinite(view.scale)
    ? Math.min(ceiling, Math.max(EXPORT_MIN_ZOOM, view.scale))
    : EXPORT_MIN_ZOOM
  const { hx, hy } = halfWindow(fitSize(image, box), box, scale)
  return {
    scale,
    cx: Number.isFinite(view.cx) ? Math.min(1 - hx, Math.max(hx, view.cx)) : 0.5,
    cy: Number.isFinite(view.cy) ? Math.min(1 - hy, Math.max(hy, view.cy)) : 0.5,
  }
}

/**
 * The render-side derivation, clamped once. The zero guard turns an unmeasured
 * image or box into the fit frame, so the first paint needs no branch; the same
 * guard answers a non-finite input from a broken gesture.
 */
export function exportFrame(view: ExportView, image: Size, box: Size): ExportFrame {
  if (!(image.w > 0 && image.h > 0 && box.w > 0 && box.h > 0)) {
    return {
      view: EXPORT_FIT,
      transform: undefined,
      window: { x: 0, y: 0, w: 1, h: 1 },
      percent: 100,
      zoomed: false,
      minimap: false,
    }
  }
  const safe = clampExportView(view, image, box)
  const fit = fitSize(image, box)
  const { hx, hy } = halfWindow(fit, box, safe.scale)
  // `zoomed` and `transform === undefined` must be the same predicate, so a
  // fitted render can never be touch-none and a zoomed one never pointer-passive.
  const zoomed = safe.scale > EXPORT_MIN_ZOOM + FIT_EPSILON
  return {
    view: safe,
    // The img is object-contain in a centred box, so scaling about its own
    // centre scales the painted image about the same point; the translate is
    // the offset that then puts image point (cx, cy) on the viewport centre.
    transform: zoomed
      ? `translate(${fit.w * safe.scale * (0.5 - safe.cx)}px, ${fit.h * safe.scale * (0.5 - safe.cy)}px) scale(${safe.scale})`
      : undefined,
    window: { x: safe.cx - hx, y: safe.cy - hy, w: 2 * hx, h: 2 * hy },
    percent: viewPercent(safe.scale),
    zoomed,
    minimap: safe.scale > EXPORT_MINIMAP_ZOOM,
  }
}

/**
 * Zoom by `factor` while keeping the image fraction under `anchor` (a
 * viewport-local point) exactly where it is. An anchor in the letterbox margin
 * is legal input: the fraction falls outside [0, 1] and the clamp turns it into
 * the nearest legal view, which is what keeps a wheel at the edge from pulling
 * the image off-centre.
 */
export function zoomExportView(
  view: ExportView,
  image: Size,
  box: Size,
  factor: number,
  anchor: { x: number, y: number },
): ExportView {
  // A non-finite base divides into NaN; the clamp below answers that with fit.
  if (!Number.isFinite(factor) || factor <= 0 || view.scale <= 0)
    return clampExportView(view, image, box)
  const fit = fitSize(image, box)
  const next = view.scale * factor
  // `box.w / 2` is the viewport centre in the same local space as the anchor.
  const ax = anchor.x - box.w / 2
  const ay = anchor.y - box.h / 2
  const u = view.cx + ax / (fit.w * view.scale)
  const v = view.cy + ay / (fit.h * view.scale)
  return clampExportView({
    scale: next,
    cx: u - ax / (fit.w * next),
    cy: v - ay / (fit.h * next),
  }, image, box)
}

/**
 * Pan by the pointer's delta in CSS px: the image follows the finger, so the
 * view moves the other way, converted through the scale it is drawn at. At fit
 * the clamp pins the centre, so a drag there is a no-op even if delivered.
 */
export function panExportView(view: ExportView, image: Size, box: Size, dx: number, dy: number): ExportView {
  const fit = fitSize(image, box)
  return clampExportView({
    scale: view.scale,
    cx: view.cx - dx / (fit.w * view.scale),
    cy: view.cy - dy / (fit.h * view.scale),
  }, image, box)
}

/**
 * Put image fraction `(u, v)` under the viewport centre without touching the
 * scale: the minimap's scrub and its tap both land here.
 */
export function centerExportView(view: ExportView, image: Size, box: Size, u: number, v: number): ExportView {
  return clampExportView({ scale: view.scale, cx: u, cy: v }, image, box)
}

/**
 * The map is the WHOLE image or it lies: both dimensions are definite and the
 * aspect is the image's own (unlike the pane chip's fixed frame plus
 * object-cover, which puts its rect slightly off for a non-52:40 photo). Rounds
 * to whole CSS px, never to zero, and never past the cap.
 */
export function exportMinimapSize(image: Size, cap: Size): Size {
  if (image.w <= 0 || image.h <= 0)
    return { w: 1, h: 1 }
  const s = Math.min(cap.w / image.w, cap.h / image.h)
  return { w: Math.max(1, Math.round(image.w * s)), h: Math.max(1, Math.round(image.h * s)) }
}
