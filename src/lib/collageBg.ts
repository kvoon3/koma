/**
 * Whole-collage background, layered on top of the existing gap fill (`bg`).
 *
 * The gap fill was already the collage's background: one solid color (or
 * transparent) painted under the whole canvas, so it shows in the gaps, the
 * edges and any transparent region of a pane. This module extends it with two
 * optional layers painted over that color, still behind every pane:
 *
 * - `gradient`: an end color; the canvas runs top → bottom from `bg` to it.
 * - `image`: a library photo, cover-fit, optionally blurred.
 *
 * The Stage and the exporter both paint these layers with `paintCollageBg`
 * on a 2D canvas, so the preview and the export match by construction. The
 * blur is a fixed-size downsample (BLUR_LONG px on the long side) stretched
 * back up, not `ctx.filter`/CSS blur: the result is the same at any output
 * size, and it works where `ctx.filter` does not (Safari).
 */

export interface BgImage {
  photoId: string
  /** Blurred backdrop instead of a sharp cover fill. */
  blur: boolean
}

export interface CollageBg {
  /** The gap fill: a CSS color or 'transparent'. */
  bg: string
  /** Gradient end color (top → bottom from `bg`), or null for a solid fill. */
  gradient: string | null
  image: BgImage | null
}

/** Long side of the downsample the blurred backdrop is stretched from. */
export const BLUR_LONG = 24

export interface ImageLike {
  src: CanvasImageSource
  w: number
  h: number
}

/** Source crop that cover-fits a `sw`×`sh` image into a `W`×`H` box, centered. */
export function coverCrop(sw: number, sh: number, W: number, H: number) {
  const k = Math.max(W / sw, H / sh)
  const cw = W / k
  const ch = H / k
  return { sx: (sw - cw) / 2, sy: (sh - ch) / 2, sw: cw, sh: ch }
}

/** Size of the blur downsample for a `W`×`H` canvas: BLUR_LONG on the long side. */
export function blurSize(W: number, H: number) {
  const k = BLUR_LONG / Math.max(W, H)
  return { w: Math.max(1, Math.round(W * k)), h: Math.max(1, Math.round(H * k)) }
}

/** A gradient only applies over an opaque base color. */
export function hasGradient(b: CollageBg): boolean {
  return !!b.gradient && b.bg !== 'transparent'
}

/** True when something beyond the plain gap fill has to be painted. */
export function hasBgLayers(b: CollageBg, hasImage: boolean): boolean {
  return hasGradient(b) || (!!b.image && hasImage)
}

/**
 * Paint the gradient and image layers (not the solid fill: the caller paints
 * that, as before) onto `ctx` over the `W`×`H` canvas.
 */
export function paintCollageBg(ctx: CanvasRenderingContext2D, W: number, H: number, b: CollageBg, img: ImageLike | null) {
  if (hasGradient(b)) {
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, b.bg)
    g.addColorStop(1, b.gradient!)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }
  if (!b.image || !img || img.w <= 0 || img.h <= 0)
    return
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  if (b.image.blur) {
    const s = blurSize(W, H)
    const c = coverCrop(img.w, img.h, s.w, s.h)
    const small = document.createElement('canvas')
    small.width = s.w
    small.height = s.h
    const sc = small.getContext('2d')!
    sc.imageSmoothingQuality = 'high'
    sc.drawImage(img.src, c.sx, c.sy, c.sw, c.sh, 0, 0, s.w, s.h)
    ctx.drawImage(small, 0, 0, W, H)
    small.width = small.height = 0
  }
  else {
    const c = coverCrop(img.w, img.h, W, H)
    ctx.drawImage(img.src, c.sx, c.sy, c.sw, c.sh, 0, 0, W, H)
  }
  ctx.restore()
}
