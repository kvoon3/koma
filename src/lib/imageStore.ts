import { decodeHeicBitmap, looksHeic, probeHeic } from './heic'

export interface Photo {
  id: string
  name: string
  file: File
  /** Paired Live Photo video (IMG_1234.HEIC + IMG_1234.MOV), if one was dropped alongside. */
  videoFile?: File
  trueW: number
  trueH: number
}

export interface Dims {
  w: number
  h: number
}

export interface Preview extends Dims {
  url: string
}

const THUMB_MAX = 220
const PREVIEW_MAX = 1800

export interface FullSource {
  src: ImageBitmap | HTMLImageElement
  w: number
  h: number
}

interface FullJob {
  refs: number
  promise: Promise<FullSource | null>
}

/**
 * One full-res decode per photo, shared by the thumb and preview jobs: a HEIC
 * decode is expensive (a 48MP frame moves ~190MB of ImageData), so shrinking
 * it twice must never decode twice.
 */
const fullJobs = new Map<string, FullJob>()

function acquireFull(file: File, photoId: string, priority: 0 | 1): { job: Promise<FullSource | null>, release: () => void } {
  let entry = fullJobs.get(photoId)
  if (!entry) {
    entry = { refs: 0, promise: decodeFullSource(file, priority) }
    fullJobs.set(photoId, entry)
  }
  entry.refs++
  let released = false
  return {
    job: entry.promise,
    release: () => {
      if (released)
        return
      released = true
      entry!.refs--
      if (entry!.refs <= 0) {
        fullJobs.delete(photoId)
        void entry!.promise.then(f => (f?.src as ImageBitmap).close?.())
      }
    },
  }
}

/**
 * Export draws each unique photo once per run, so it holds one refcounted
 * full-res source per photo (keyed by id) for the whole run and drops them
 * all together at the end. Sources are interactive priority: an export must
 * not queue behind library thumbnails. A bitmap closes when its last
 * reference drops, so every drawImage must happen before `release`.
 */
export interface FullSourceBatch {
  get: (photo: Photo) => Promise<FullSource | null>
  release: () => void
}

export function acquireFullBatch(): FullSourceBatch {
  const held = new Map<string, { release: () => void, job: Promise<FullSource | null> }>()
  return {
    get: (photo) => {
      let h = held.get(photo.id)
      if (!h) {
        h = acquireFull(photo.file, photo.id, 0)
        held.set(photo.id, h)
      }
      return h.job
    },
    release: () => {
      for (const h of held.values())
        h.release()
      held.clear()
    },
  }
}

async function decodeFullSource(file: File, priority: 0 | 1): Promise<FullSource | null> {
  if (looksHeic(file)) {
    const bmp = await decodeHeicBitmap(file, priority)
    return bmp ? { src: bmp, w: bmp.width, h: bmp.height } : null
  }
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return { src: bmp, w: bmp.width, h: bmp.height }
  }
  catch {
    const objUrl = URL.createObjectURL(file)
    try {
      const im = await loadViaImg(objUrl)
      return im ? { src: im, w: im.naturalWidth, h: im.naturalHeight } : null
    }
    finally {
      URL.revokeObjectURL(objUrl)
    }
  }
}

/** Draw `full` onto a fresh canvas capped at `max` on the long side. */
function drawScaled(full: FullSource, max: number): HTMLCanvasElement {
  const k = Math.min(1, max / Math.max(full.w, full.h))
  const w = Math.max(1, Math.round(full.w * k))
  const h = Math.max(1, Math.round(full.h * k))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(full.src, 0, 0, w, h)
  return canvas
}

function disposeCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0
  canvas.height = 0
}

/**
 * PNG keeps alpha: made stickers and other cutouts must not flatten to black.
 * toBlob encodes off the main thread where the browser can; toDataURL's
 * synchronous encode + base64 janked every inserted photo.
 */
function canvasToObjectUrl(canvas: HTMLCanvasElement, photo: Photo, quality: number): Promise<string> {
  return new Promise((resolve) => {
    canvas.toBlob(
      blob => resolve(blob ? URL.createObjectURL(blob) : ''),
      photo.file.type === 'image/png' ? 'image/png' : 'image/jpeg',
      quality,
    )
  })
}

const thumbs = new Map<string, string>()
const previews = new Map<string, Preview>()
const thumbJobs = new Map<string, Promise<string | null>>()
const previewJobs = new Map<string, Promise<Preview | null>>()
const trueDims = new Map<string, Dims>()

function loadViaImg(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const im = new Image()
    im.onload = () => res(im)
    im.onerror = () => res(null)
    im.src = url
  })
}

export function getThumb(photo: Photo): Promise<string | null> {
  const hit = thumbs.get(photo.id)
  if (hit)
    return Promise.resolve(hit)
  const job = thumbJobs.get(photo.id)
  if (job)
    return job

  const p = (async () => {
    // A cached preview already holds decoded pixels: shrink it instead of
    // decoding the original again (the usual order, a photo enters a pane
    // before its library row scrolls into view).
    const pv = previews.get(photo.id)
    if (pv) {
      const im = await loadViaImg(pv.url)
      if (im) {
        const canvas = drawScaled({ src: im, w: im.naturalWidth, h: im.naturalHeight }, THUMB_MAX)
        const url = await canvasToObjectUrl(canvas, photo, 0.72)
        disposeCanvas(canvas)
        if (url)
          thumbs.set(photo.id, url)
        thumbJobs.delete(photo.id)
        return url || null
      }
    }
    const { job, release } = acquireFull(photo.file, photo.id, 1)
    try {
      const full = await job
      if (!full)
        return null
      const canvas = drawScaled(full, THUMB_MAX)
      const url = await canvasToObjectUrl(canvas, photo, 0.72)
      disposeCanvas(canvas)
      if (url)
        thumbs.set(photo.id, url)
      return url || null
    }
    finally {
      release()
      thumbJobs.delete(photo.id)
    }
  })()
  thumbJobs.set(photo.id, p)
  return p
}

export function getPreview(photo: Photo): Promise<Preview | null> {
  const hit = previews.get(photo.id)
  if (hit)
    return Promise.resolve(hit)
  const job = previewJobs.get(photo.id)
  if (job)
    return job

  const p = (async () => {
    const { job, release } = acquireFull(photo.file, photo.id, 0)
    try {
      const full = await job
      if (!full) {
        // Pixels are unusable, but the header probe still feeds the crop
        // report's true dimensions.
        const d = await readTrueDims(photo)
        if (d)
          trueDims.set(photo.id, d)
        return null
      }
      trueDims.set(photo.id, { w: full.w, h: full.h })
      const canvas = drawScaled(full, PREVIEW_MAX)
      const w = canvas.width
      const h = canvas.height
      const url = await canvasToObjectUrl(canvas, photo, 0.9)
      disposeCanvas(canvas)
      const result: Preview = { url, w, h }
      if (url)
        previews.set(photo.id, result)
      return result
    }
    finally {
      release()
      previewJobs.delete(photo.id)
    }
  })()
  previewJobs.set(photo.id, p)
  return p
}

async function readTrueDims(photo: Photo): Promise<Dims | null> {
  if (looksHeic(photo.file)) {
    const p = await probeHeic(photo.file)
    if (p)
      return p
    const bmp = await decodeHeicBitmap(photo.file, 0)
    const d = bmp ? { w: bmp.width, h: bmp.height } : null
    bmp?.close()
    return d
  }
  try {
    const bmp = await createImageBitmap(photo.file, { imageOrientation: 'from-image' })
    const d = { w: bmp.width, h: bmp.height }
    bmp.close?.()
    return d
  }
  catch {
    const im = await loadViaImg(URL.createObjectURL(photo.file))
    return im ? { w: im.naturalWidth, h: im.naturalHeight } : null
  }
}

export function getTrueDims(photoId: string): Dims | null {
  return trueDims.get(photoId) ?? null
}

export function clearImageCaches() {
  for (const url of thumbs.values())
    URL.revokeObjectURL(url)
  for (const p of previews.values())
    URL.revokeObjectURL(p.url)
  thumbs.clear()
  previews.clear()
  thumbJobs.clear()
  previewJobs.clear()
  trueDims.clear()
}

export function peekPreview(photoId: string): Preview | null {
  return previews.get(photoId) ?? null
}
export function peekThumb(photoId: string): string | null {
  return thumbs.get(photoId) ?? null
}

const SOF = new Set([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF])

function readExifOrientation(v: DataView, off: number, len: number): number | null {
  try {
    if (len < 14)
      return null
    if (v.getUint32(off) !== 0x45786966)
      return null
    const tiff = off + 6
    const little = v.getUint16(tiff) === 0x4949
    const r16 = (o: number) => v.getUint16(o, little)
    const r32 = (o: number) => v.getUint32(o, little)
    if (r16(tiff + 2) !== 0x002A)
      return null
    const ifd0 = tiff + r32(tiff + 4)
    const n = r16(ifd0)
    for (let i = 0; i < n; i++) {
      const e = ifd0 + 2 + i * 12
      if (e + 12 > off + len)
        break
      if (r16(e) === 0x0112)
        return r16(e + 8)
    }
  }
  catch {
  }
  return null
}

/** Standalone/temp markers carry no payload: only the 2 marker bytes follow. */
function isStandaloneMarker(marker: number): boolean {
  return marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)
}

/** First SOF frame's dimensions at segment start `p`, or null if degenerate. */
function sofDims(v: DataView, p: number): Dims | null {
  const h = v.getUint16(p + 5)
  const w = v.getUint16(p + 7)
  return w > 0 && h > 0 ? { w, h } : null
}

/** Exif orientations 5–8 store the frame rotated 90°: swap width and height. */
function applyOrientation(dims: Dims, orientation: number): Dims {
  return orientation >= 5 && orientation <= 8 ? { w: dims.h, h: dims.w } : dims
}

/**
 * Read one APPn/SOF segment: a fresh Exif orientation, and final dims when
 *  this was the SOF frame (non-null dims ends the scan).
 */
function readSegment(
  v: DataView,
  p: number,
  len: number,
  marker: number,
  orientation: number,
): { orientation: number, dims: Dims | null } {
  if (marker === 0xE1) {
    const o = readExifOrientation(v, p + 4, len - 2)
    return { orientation: o || orientation, dims: null }
  }
  if (!SOF.has(marker) || p + 9 > v.byteLength)
    return { orientation, dims: null }
  const dims = sofDims(v, p)
  return { orientation, dims: dims ? applyOrientation(dims, orientation) : null }
}

/**
 * Walk the segments after SOI hunting for the first SOF frame, honoring any
 *  Exif orientation met along the way; null when no usable frame appears.
 */
function scanJpegSegments(v: DataView): Dims | null {
  const n = v.byteLength
  let p = 2
  let orientation = 1
  while (p + 4 <= n) {
    if (v.getUint8(p) !== 0xFF) {
      p++
      continue
    }
    const marker = v.getUint8(p + 1)
    if (isStandaloneMarker(marker)) {
      p += 2
      continue
    }
    if (marker === 0xD9)
      break
    const len = v.getUint16(p + 2)
    if (len < 2)
      break
    const seg = readSegment(v, p, len, marker, orientation)
    orientation = seg.orientation
    if (seg.dims)
      return seg.dims
    p += 2 + len
  }
  return null
}

export async function probeJpeg(file: File): Promise<Dims | null> {
  let v: DataView
  try {
    v = new DataView(await file.slice(0, 262144).arrayBuffer())
  }
  catch {
    return null
  }
  const n = v.byteLength
  if (n < 4 || v.getUint16(0) !== 0xFFD8)
    return null
  return scanJpegSegments(v)
}

/** PNG dimensions from the IHDR chunk; keeps made stickers (always PNG) renderable. */
export async function probePng(file: File): Promise<Dims | null> {
  try {
    const v = new DataView(await file.slice(0, 33).arrayBuffer())
    if (v.byteLength < 24 || v.getUint32(0) !== 0x89504E47)
      return null
    return { w: v.getUint32(16), h: v.getUint32(20) }
  }
  catch {
    return null
  }
}
