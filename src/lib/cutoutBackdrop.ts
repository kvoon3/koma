/**
 * The cutout's other ending: instead of a transparent hole, the photo's own
 * frame stays behind the cutout as a BLURRED backdrop (the portrait-mode look).
 *
 * It is baked into a PNG at the moment the user asks for it (see
 * `lib/paneCutout`), so nothing downstream learns a new concept: the pane,
 * the preview, the export and undo all just see another photo, exactly as
 * they do for a made sticker. The two halves of the bake are the frame the
 * cutout was cut from (the pane's oriented preview, ≤1800px, the same pixels
 * the model read) and the cutout PNG itself, which the model returns at that
 * same size: the composite needs no resampling and the cutout cannot
 * drift off its own subject.
 *
 * Two pure pieces carry the behaviour, and the canvas half executes them:
 * `backdropBlurRadius` (how soft) and `backdropPlan` (what is drawn, in which
 * order, over which rect). The radius is a RATIO of the long edge, not a
 * pixel count: a 1800px preview and a 600px one must read as the same
 * backdrop, the same reason `lib/filters` scales its texture by the image.
 */

/** Blur radius as a fraction of the long edge: 2.5% reads as iOS portrait at any size. */
export const BACKDROP_BLUR_RATIO = 0.025
/** A backdrop smaller than this is a smudge, not a blur: floor for tiny previews. */
export const BACKDROP_BLUR_MIN = 2
/** Past this the frame is an average color (a 8000px source); ceiling keeps the bake honest. */
export const BACKDROP_BLUR_MAX = 80

/**
 * Gaussian radius, in pixels, of the backdrop for a `w`×`h` frame: 2.5% of the
 * long edge, clamped to 2–80px so tiny previews still read as blurred and huge
 * ones do not collapse into a single tone. Rounded: the CSS-style radius the
 * canvas filter and the downsample fallback both take is in whole pixels.
 */
export function backdropBlurRadius(w: number, h: number): number {
  const long = Math.max(w, h)
  if (!Number.isFinite(long) || long <= 0)
    return BACKDROP_BLUR_MIN
  return Math.round(Math.min(BACKDROP_BLUR_MAX, Math.max(BACKDROP_BLUR_MIN, long * BACKDROP_BLUR_RATIO)))
}

export interface BackdropRect {
  x: number
  y: number
  w: number
  h: number
}

export type BackdropOp
  = | { kind: 'blur', rect: BackdropRect, radius: number }
    | { kind: 'cutout', rect: BackdropRect }

/**
 * The draw order for a `w`×`h` frame, painter's first to last:
 *
 * 1. the photo, blurred, drawn LARGER than the frame by one radius on every
 *    side. A Gaussian samples past the edge it is blurring, so an exact-size
 *    draw fades the border toward transparent (a glassy rim on an opaque
 *    photo, and the hole shows through on transparency). The overhang is what
 *    makes the backdrop fill the frame; a side effect is the slight zoom real
 *    portrait mode has, since the overhang is scaled from the same frame.
 * 2. the cutout, unblurred, filling the frame exactly: the subject stays sharp
 *    and keeps its silhouette, which is the whole point of the pair.
 */
export function backdropPlan(w: number, h: number): BackdropOp[] {
  const radius = backdropBlurRadius(w, h)
  return [
    { kind: 'blur', rect: { x: -radius, y: -radius, w: w + radius * 2, h: h + radius * 2 }, radius },
    { kind: 'cutout', rect: { x: 0, y: 0, w, h } },
  ]
}

/** PNG keeps the cutout's alpha: a JPEG backdrop would square off the subject's edges. */
function encodePng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('The blurred backdrop could not be encoded as a PNG.'))),
      'image/png',
    )
  })
}

function decodeBlob(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  return createImageBitmap(blob).catch(async () => {
    const url = URL.createObjectURL(blob)
    try {
      return await new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image()
        im.onload = () => resolve(im)
        im.onerror = () => reject(new Error('The photo could not be decoded for the backdrop.'))
        im.src = url
      })
    }
    finally {
      URL.revokeObjectURL(url)
    }
  })
}

/** Does this canvas carry a `ctx.filter` blur (Chromium and Firefox do, WebKit has long not)? */
function hasCanvasFilter(ctx: CanvasRenderingContext2D): boolean {
  return typeof ctx.filter === 'string'
}

/**
 * Paint `src` into `rect` blurred by `radius`.
 *
 * `ctx.filter` is the direct route where it exists. WebKit has long gone
 * without it (and this app spends most of its life there), the same gap
 * `lib/exporter`'s backdrop and `lib/collageBg` test for. There the blur is the
 * classic downsample trick: draw the frame at a fraction of the size, then
 * stretch it back with smoothing on, which is a close-enough Gaussian and costs
 * one extra small canvas. `lib/collageBg` uses a fixed tiny size because its
 * backdrop is a full-board wash; here the downsample follows the requested
 * radius, so a small preview blurs less than a large one.
 */
function drawBlurred(ctx: CanvasRenderingContext2D, src: CanvasImageSource, rect: BackdropRect, radius: number) {
  const w = Math.max(1, Math.round(rect.w))
  const h = Math.max(1, Math.round(rect.h))
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  if (hasCanvasFilter(ctx)) {
    ctx.filter = `blur(${radius}px)`
    ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h)
    ctx.restore()
    return
  }
  const k = Math.max(2, Math.round(radius * 1.5))
  const small = document.createElement('canvas')
  small.width = Math.max(1, Math.round(w / k))
  small.height = Math.max(1, Math.round(h / k))
  const sc = small.getContext('2d')!
  sc.imageSmoothingQuality = 'high'
  sc.drawImage(src, 0, 0, small.width, small.height)
  ctx.drawImage(small, rect.x, rect.y, rect.w, rect.h)
  small.width = 0
  small.height = 0
  ctx.restore()
}

/**
 * Compose the cutout over its own blurred photo and resolve to the PNG.
 *
 * Both inputs are frames of the SAME aspect and size (see the header), and the
 * output keeps that size: the composite is the same picture as the cutout, so
 * the pane's zoom and focus survive the swap untouched.
 */
export async function bakeBlurredBackdrop(photo: Blob, cutout: Blob): Promise<Blob> {
  const [frame, cut] = await Promise.all([decodeBlob(photo), decodeBlob(cutout)])
  const w = frame.width
  const h = frame.height
  if (!(w > 0 && h > 0))
    throw new Error('The photo has no pixels to blur.')
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx)
    throw new Error('Canvas 2D is unavailable.')
  ctx.imageSmoothingQuality = 'high'
  for (const op of backdropPlan(w, h)) {
    if (op.kind === 'blur')
      drawBlurred(ctx, frame, op.rect, op.radius)
    else
      ctx.drawImage(cut, op.rect.x, op.rect.y, op.rect.w, op.rect.h)
  }
  ;(frame as ImageBitmap).close?.()
  ;(cut as ImageBitmap).close?.()
  const blob = await encodePng(canvas)
  canvas.width = 0
  canvas.height = 0
  return blob
}
