/**
 * Filtered previews: the pane's on-screen photo carrying its texture filter,
 * rendered from the same `lib/filters` pixels the exporter bakes into a
 * `filteredSource` canvas, so the two cannot drift.
 *
 * A filtered bitmap is keyed by (photo, filter, decode-size bucket): the
 * filter's parameters scale with the image, so a bitmap filtered at one size
 * is not the same picture as one filtered at another, so the bucket is part of
 * the identity, not a detail. The bucket is the preview's own size capped at
 * `FILTER_PREVIEW_MAX`, which keeps one filter pass inside a frame's budget
 * (a 1024² pass is 7–31ms, see `lib/filters`) even though the photo preview
 * itself tops out at 1800px.
 *
 * URLs are owned here (minted on render, revoked on eviction or clear), and
 * the cache is an LRU: a board of nine panes with eight filters explored in the
 * dock must not pin dozens of megapixels.
 */
import type { FilterId } from './filters'
import type { Photo, Preview } from './imageStore'
import { applyFilter, filterSeed } from './filters'
import { getPreview, peekPreview } from './imageStore'

/** Long edge of a filtered preview bitmap: one filter pass, one frame's worth. */
export const FILTER_PREVIEW_MAX = 1024
/** Filtered previews kept alive at once (each is up to 1024² of RGBA). */
const PREVIEW_CAP = 24
/** Dock swatches kept alive at once (tiny, so a much larger cap). */
const SWATCH_CAP = 96

/**
 * Insertion-ordered LRU over object URLs. `get` re-inserts, so iteration order
 * is recency and the first key is always the one to drop. The URLs are the
 * cache's to revoke: nothing else holds a reference to a filtered bitmap.
 */
class UrlLru<V> {
  private map = new Map<string, { value: V, url: string }>()
  constructor(private cap: number) {}
  get(key: string): V | null {
    const hit = this.map.get(key)
    if (!hit)
      return null
    this.map.delete(key)
    this.map.set(key, hit)
    return hit.value
  }

  set(key: string, value: V, url: string) {
    this.drop(key)
    this.map.set(key, { value, url })
    for (const k of this.map.keys()) {
      if (this.map.size <= this.cap)
        break
      this.drop(k)
    }
  }

  clear() {
    for (const e of this.map.values())
      URL.revokeObjectURL(e.url)
    this.map.clear()
  }

  private drop(key: string) {
    const old = this.map.get(key)
    if (!old)
      return
    this.map.delete(key)
    URL.revokeObjectURL(old.url)
  }
}

const previews = new UrlLru<Preview>(PREVIEW_CAP)
const swatches = new UrlLru<string>(SWATCH_CAP)
const previewJobs = new Map<string, Promise<Preview | null>>()
const swatchJobs = new Map<string, Promise<string | null>>()

/** The size a filtered preview renders at: the preview's own, capped. */
export function filteredPreviewSize(preview: { w: number, h: number }): { w: number, h: number } {
  const k = Math.min(1, FILTER_PREVIEW_MAX / Math.max(preview.w, preview.h))
  return { w: Math.max(1, Math.round(preview.w * k)), h: Math.max(1, Math.round(preview.h * k)) }
}

function previewKey(photoId: string, filterId: FilterId, size: { w: number, h: number }) {
  return `${photoId}|${filterId}|${size.w}x${size.h}`
}

/** The cached filtered preview, or null when it has not been rendered yet. */
export function peekFilteredPreview(photoId: string, filterId: FilterId): Preview | null {
  const base = peekPreview(photoId)
  if (!base)
    return null
  return previews.get(previewKey(photoId, filterId, filteredPreviewSize(base)))
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = () => resolve(null)
    im.src = url
  })
}

/**
 * Draw `source` into a canvas of the given size, then run the filter over its
 * pixels and hand the canvas back. `apply` is what keeps the preview identical
 * to the export: same function, same seed, same size → same bytes.
 */
function filteredCanvas(source: CanvasImageSource, w: number, h: number, filterId: FilterId, seed: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, w, h)
  const img = ctx.getImageData(0, 0, w, h)
  applyFilter(img, filterId, seed)
  ctx.putImageData(img, 0, 0)
  return canvas
}

function canvasToUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve) => {
    canvas.toBlob(blob => resolve(blob ? URL.createObjectURL(blob) : ''), 'image/png')
  })
}

/**
 * The pane photo with `filterId` applied, at the preview's size (capped), as an
 * object URL. Renders once per (photo, filter, size); concurrent callers share
 * one job.
 */
export function getFilteredPreview(photo: Photo, filterId: FilterId): Promise<Preview | null> {
  const base = peekPreview(photo.id)
  if (!base) {
    // Nothing decoded yet: warm the plain preview, which the caller already
    // waits on, and let the next render ask again.
    void getPreview(photo)
    return Promise.resolve(null)
  }
  const size = filteredPreviewSize(base)
  const key = previewKey(photo.id, filterId, size)
  const hit = previews.get(key)
  if (hit)
    return Promise.resolve(hit)
  const job = previewJobs.get(key)
  if (job)
    return job

  const p = (async (): Promise<Preview | null> => {
    try {
      const im = await loadImage(base.url)
      if (!im)
        return null
      const canvas = filteredCanvas(im, size.w, size.h, filterId, filterSeed(photo.id, filterId))
      const url = await canvasToUrl(canvas)
      canvas.width = canvas.height = 0
      if (!url)
        return null
      const result: Preview = { url, w: size.w, h: size.h }
      previews.set(key, result, url)
      return result
    }
    finally {
      previewJobs.delete(key)
    }
  })()
  previewJobs.set(key, p)
  return p
}

function swatchKey(photoId: string, filterId: FilterId | null, px: number) {
  return `${photoId}|${filterId ?? 'none'}|${px}`
}

/** A cached swatch URL, or null when that tile has not been rendered yet. */
export function peekFilterSwatch(photoId: string, filterId: FilterId | null, px: number): string | null {
  return swatches.get(swatchKey(photoId, filterId, px))
}

/**
 * A dock swatch: a 1:1 loupe into the photo's *filtered* preview, centred, at
 * `px` CSS pixels (rendered at 2× for the device pixel ratio). Showing a crop
 * rather than the whole photo is what makes the texture legible: the filters
 * are resolution independent, so a photo squeezed into a 76px chip averages its
 * own grain away, while a 152px window of the same filtered bitmap shows the
 * grain, the plates and the dither at exactly the size the pane draws them.
 *
 * The bitmap comes from `getFilteredPreview`, so a swatch and the pane it is
 * about to replace are the same pixels, and picking a filter is instant.
 */
export function getFilterSwatch(photo: Photo, filterId: FilterId | null, px: number): Promise<string | null> {
  const key = swatchKey(photo.id, filterId, px)
  const hit = swatches.get(key)
  if (hit)
    return Promise.resolve(hit)
  const job = swatchJobs.get(key)
  if (job)
    return job

  const p = (async (): Promise<string | null> => {
    try {
      const base = peekPreview(photo.id) ?? await getPreview(photo)
      if (!base)
        return null
      const source = filterId ? await getFilteredPreview(photo, filterId) : base
      if (!source)
        return null
      const im = await loadImage(source.url)
      if (!im)
        return null
      const side = Math.min(px * 2, Math.min(im.naturalWidth, im.naturalHeight))
      const sx = (im.naturalWidth - side) / 2
      const sy = (im.naturalHeight - side) / 2
      const out = document.createElement('canvas')
      out.width = side
      out.height = side
      const octx = out.getContext('2d')!
      octx.imageSmoothingQuality = 'high'
      octx.drawImage(im, sx, sy, side, side, 0, 0, side, side)
      const url = await canvasToUrl(out)
      out.width = out.height = 0
      if (!url)
        return null
      swatches.set(key, url, url)
      return url
    }
    finally {
      swatchJobs.delete(key)
    }
  })()
  swatchJobs.set(key, p)
  return p
}

/** Drop every filtered bitmap (the library was cleared, or replaced). */
export function clearFilterCaches() {
  previews.clear()
  swatches.clear()
  previewJobs.clear()
  swatchJobs.clear()
}
