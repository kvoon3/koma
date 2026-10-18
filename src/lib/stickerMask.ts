import type { MaskMode, MaskPoint } from './stickerFX'
import { closedLasso, strokeDiscs } from './stickerFX'

/**
 * The manual cutout adjustment's canvas half (the arithmetic is in
 * `lib/stickerFX`): its layers, its stroke painting, its view transform and
 * the commit that bakes source α × mask α into the sticker's PNG.
 *
 * The edit is a paint-over-mask, the strongest pattern in the upstream
 * reference (CatsJuice/sticker-forge, MIT) and the reason a U²-Net cutout is
 * ever usable: the model gets 95% of a subject and the last 5% is a brush
 * stroke. Three layers, all at the same resolution:
 *
 *   source  the picked image (or the AI cutout), drawn once at load
 *   mask    alpha only: opaque = keep, transparent = cut away; starts full
 *   scratch source composited *through* the mask, rebuilt for the display
 *
 * Commit is `destination-in`: the source's own antialiasing and the mask's are
 * both alpha, so a multiplied edge is feathered for free at whatever size the
 * brush was. Nothing here is unit tested (it needs a canvas); `stickerFX` holds
 * every number, and the browser measurement drives a real stroke instead.
 */

/** Longest edge of the edit layers: a phone-sized cutout at working resolution. */
export const MASK_EDIT_EDGE = 1024
/** Display pixels per CSS pixel, capped: a 3× phone is not three times clearer. */
export const MASK_MAX_DPR = 2

export interface MaskLayers {
  source: HTMLCanvasElement
  mask: HTMLCanvasElement
  width: number
  height: number
}

/** Where the mask pixel sits in the display box: `display = mask × scale + (x,y)`. */
export interface MaskView {
  scale: number
  x: number
  y: number
}

export const MIN_VIEW_SCALE = 0.05
export const MAX_VIEW_SCALE = 24

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

function context2d(canvas: HTMLCanvasElement, readFrequently = false) {
  const context = canvas.getContext('2d', readFrequently ? { willReadFrequently: true } : undefined)
  if (!context)
    throw new Error('Canvas 2D is unavailable.')
  return context
}

/** The edit resolution of an image: never upscaled, long edge capped. */
export function maskEditSize(width: number, height: number) {
  const longEdge = Math.max(width, height)
  const scale = longEdge > MASK_EDIT_EDGE ? MASK_EDIT_EDGE / longEdge : 1
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** Decode `src` and build the source + mask layers at the edit resolution. */
export async function loadMaskLayers(src: string): Promise<MaskLayers> {
  const image = new Image()
  image.decoding = 'async'
  image.src = src
  await image.decode()
  const { width, height } = maskEditSize(image.naturalWidth, image.naturalHeight)
  const source = makeCanvas(width, height)
  const sourceContext = context2d(source, true)
  sourceContext.imageSmoothingEnabled = true
  sourceContext.imageSmoothingQuality = 'high'
  sourceContext.drawImage(image, 0, 0, width, height)
  const mask = makeCanvas(width, height)
  const maskContext = context2d(mask, true)
  // A new subject keeps everything the source has: the mask starts fully
  // opaque, so the first strokes are the only cuts.
  maskContext.fillStyle = '#ffffff'
  maskContext.fillRect(0, 0, width, height)
  return { source, mask, width, height }
}

/** Source composited through the mask into `target` (the display's scratch). */
export function compositeMasked(
  source: HTMLCanvasElement,
  mask: HTMLCanvasElement,
  target: HTMLCanvasElement,
) {
  if (target.width !== source.width || target.height !== source.height) {
    target.width = source.width
    target.height = source.height
  }
  const context = context2d(target)
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.globalCompositeOperation = 'source-over'
  context.clearRect(0, 0, target.width, target.height)
  context.drawImage(source, 0, 0)
  context.globalCompositeOperation = 'destination-in'
  context.drawImage(mask, 0, 0)
  context.globalCompositeOperation = 'source-over'
}

/** One brush stroke: round-capped segments plus a disc per point (so a tap paints). */
export function paintStroke(
  context: CanvasRenderingContext2D,
  points: readonly MaskPoint[],
  mode: MaskMode,
  size: number,
) {
  if (!points.length)
    return
  context.save()
  context.globalCompositeOperation = mode === 'remove' ? 'destination-out' : 'source-over'
  context.strokeStyle = '#000000'
  context.fillStyle = '#000000'
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.lineWidth = size
  if (points.length > 1) {
    context.beginPath()
    context.moveTo(points[0]!.x, points[0]!.y)
    for (let i = 1; i < points.length; i += 1)
      context.lineTo(points[i]!.x, points[i]!.y)
    context.stroke()
  }
  const discs = strokeDiscs(points, size)
  if (discs.length) {
    context.beginPath()
    for (const disc of discs) {
      context.moveTo(disc.x + disc.r, disc.y)
      context.arc(disc.x, disc.y, disc.r, 0, Math.PI * 2)
    }
    context.fill()
  }
  context.restore()
}

/**
 * A closed lasso drag filled in one go (its antialiased edge is the feathered
 * cut). Returns false when the drag was too short or too flat to enclose
 * anything, so the caller can drop the undo step it did not spend.
 */
export function paintLasso(
  context: CanvasRenderingContext2D,
  points: readonly MaskPoint[],
  mode: MaskMode,
) {
  const polygon = closedLasso(points)
  if (!polygon)
    return false
  context.save()
  context.globalCompositeOperation = mode === 'remove' ? 'destination-out' : 'source-over'
  context.fillStyle = '#000000'
  context.beginPath()
  context.moveTo(polygon[0]!.x, polygon[0]!.y)
  for (let i = 1; i < polygon.length; i += 1)
    context.lineTo(polygon[i]!.x, polygon[i]!.y)
  context.closePath()
  context.fill()
  context.restore()
  return true
}

/** The mask canvas traced as a hairline, so a lasso drag shows where it is going. */
export function traceLasso(
  context: CanvasRenderingContext2D,
  points: readonly MaskPoint[],
  scale: number,
) {
  if (points.length < 2)
    return
  context.save()
  context.strokeStyle = 'rgba(255,255,255,0.9)'
  context.lineWidth = 1.5 / Math.max(scale, 0.001)
  context.setLineDash([6 / Math.max(scale, 0.001), 4 / Math.max(scale, 0.001)])
  context.beginPath()
  context.moveTo(points[0]!.x, points[0]!.y)
  for (let i = 1; i < points.length; i += 1)
    context.lineTo(points[i]!.x, points[i]!.y)
  context.stroke()
  context.restore()
}

/** A snapshot of the mask for the undo stack: a canvas the caller keeps. */
export function snapshotMask(mask: HTMLCanvasElement) {
  const copy = makeCanvas(mask.width, mask.height)
  context2d(copy).drawImage(mask, 0, 0)
  return copy
}

/** Put a snapshot back on the live mask canvas. */
export function restoreMask(mask: HTMLCanvasElement, snapshot: HTMLCanvasElement) {
  const context = context2d(mask)
  context.save()
  context.globalCompositeOperation = 'source-over'
  context.clearRect(0, 0, mask.width, mask.height)
  context.drawImage(snapshot, 0, 0)
  context.restore()
}

/** The committed cutout: source α × mask α, as a PNG data URL. */
export function commitMask(source: HTMLCanvasElement, mask: HTMLCanvasElement) {
  const target = makeCanvas(source.width, source.height)
  compositeMasked(source, mask, target)
  return target.toDataURL('image/png')
}

/* ------------------------------------------------------------------------- *
 * View transform (pure: the editor's zoom and pan, testable on plain numbers)
 * ------------------------------------------------------------------------- */

export function clampViewScale(scale: number) {
  return Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, scale))
}

/** The view that fits the whole mask inside the box, centred. */
export function fitView(maskWidth: number, maskHeight: number, boxWidth: number, boxHeight: number): MaskView {
  const scale = clampViewScale(Math.min(
    Math.max(boxWidth, 1) / Math.max(maskWidth, 1),
    Math.max(boxHeight, 1) / Math.max(maskHeight, 1),
  ))
  return {
    scale,
    x: (boxWidth - maskWidth * scale) / 2,
    y: (boxHeight - maskHeight * scale) / 2,
  }
}

/** The mask pixel under a point of the display box. */
export function viewToMask(view: MaskView, x: number, y: number): MaskPoint {
  const scale = view.scale || MIN_VIEW_SCALE
  return { x: (x - view.x) / scale, y: (y - view.y) / scale }
}

/**
 * Zoom by `factor` while keeping the mask pixel under `anchor` (a display-box
 * point) exactly where it is. That fixed point is what makes a wheel zoom feel
 * like it is pulling the artwork toward the cursor instead of the corner.
 */
export function zoomView(view: MaskView, factor: number, anchor: { x: number, y: number }): MaskView {
  const scale = clampViewScale(view.scale * factor)
  const ratio = scale / (view.scale || MIN_VIEW_SCALE)
  return {
    scale,
    x: anchor.x - (anchor.x - view.x) * ratio,
    y: anchor.y - (anchor.y - view.y) * ratio,
  }
}

/** Pan by a display-space delta. */
export function panView(view: MaskView, dx: number, dy: number): MaskView {
  return { ...view, x: view.x + dx, y: view.y + dy }
}
