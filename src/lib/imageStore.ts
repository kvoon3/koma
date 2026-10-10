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

const thumbs = new Map<string, string>()
const previews = new Map<string, Preview>()
const thumbJobs = new Map<string, Promise<string | null>>()
const previewJobs = new Map<string, Promise<Preview | null>>()
const trueDims = new Map<string, Dims>()
const liveUrls = new Map<string, string>()

function loadViaImg(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const im = new Image()
    im.onload = () => res(im)
    im.onerror = () => res(null)
    im.src = url
  })
}

async function decodeResized(
  file: File,
  max: number,
): Promise<{ src: CanvasImageSource, w: number, h: number, dispose: () => void } | null> {
  let full: ImageBitmap | HTMLImageElement | null = null
  let objUrl = ''
  if (looksHeic(file)) {
    full = await decodeHeicBitmap(file)
  }
  else {
    objUrl = URL.createObjectURL(file)
    try {
      full = await createImageBitmap(file, { imageOrientation: 'from-image' })
    }
    catch {
      full = await loadViaImg(objUrl)
    }
  }
  if (!full) {
    if (objUrl)
      URL.revokeObjectURL(objUrl)
    return null
  }

  const fw = (full as ImageBitmap).width
  const fh = (full as ImageBitmap).height
  const k = Math.min(1, max / Math.max(fw, fh))
  const w = Math.max(1, Math.round(fw * k))
  const h = Math.max(1, Math.round(fh * k))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(full, 0, 0, w, h)

  ;(full as ImageBitmap).close?.()
  if (objUrl)
    URL.revokeObjectURL(objUrl)

  return {
    src: canvas,
    w,
    h,
    dispose: () => {
      canvas.width = 0
      canvas.height = 0
    },
  }
}

export function getThumb(photo: Photo): Promise<string | null> {
  const hit = thumbs.get(photo.id)
  if (hit)
    return Promise.resolve(hit)
  const job = thumbJobs.get(photo.id)
  if (job)
    return job

  const p = (async () => {
    const r = await decodeResized(photo.file, THUMB_MAX)
    if (!r)
      return null
    const url = r.src instanceof HTMLCanvasElement ? r.src.toDataURL('image/jpeg', 0.72) : ''
    r.dispose()
    if (url)
      thumbs.set(photo.id, url)
    thumbJobs.delete(photo.id)
    return url || null
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
    const r = await decodeResized(photo.file, PREVIEW_MAX)
    if (!r)
      return null
    const full = await readTrueDims(photo)
    if (full)
      trueDims.set(photo.id, full)

    const url = r.src instanceof HTMLCanvasElement ? r.src.toDataURL('image/jpeg', 0.9) : ''
    r.dispose()
    const result: Preview = { url, w: r.w, h: r.h }
    if (url)
      previews.set(photo.id, result)
    previewJobs.delete(photo.id)
    return result
  })()
  previewJobs.set(photo.id, p)
  return p
}

async function readTrueDims(photo: Photo): Promise<Dims | null> {
  if (looksHeic(photo.file)) {
    const p = await probeHeic(photo.file)
    if (p)
      return p
    const bmp = await decodeHeicBitmap(photo.file)
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

export async function decodeFull(photo: Photo): Promise<ImageBitmap | HTMLImageElement | null> {
  if (looksHeic(photo.file))
    return decodeHeicBitmap(photo.file)
  try {
    return await createImageBitmap(photo.file, { imageOrientation: 'from-image' })
  }
  catch {
    return await loadViaImg(URL.createObjectURL(photo.file))
  }
}

export function releaseFull(src: ImageBitmap | HTMLImageElement | null) {
  ;(src as ImageBitmap)?.close?.()
}

/** Object URL for a paired Live Photo video, cached until the library is cleared. */
export function getLiveVideoUrl(photo: Photo): string | null {
  if (!photo.videoFile)
    return null
  let url = liveUrls.get(photo.id)
  if (!url) {
    url = URL.createObjectURL(photo.videoFile)
    liveUrls.set(photo.id, url)
  }
  return url
}

export function clearImageCaches() {
  thumbs.clear()
  previews.clear()
  thumbJobs.clear()
  previewJobs.clear()
  trueDims.clear()
  for (const url of liveUrls.values())
    URL.revokeObjectURL(url)
  liveUrls.clear()
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

  let p = 2
  let orientation = 1
  while (p + 4 <= n) {
    if (v.getUint8(p) !== 0xFF) {
      p++
      continue
    }
    const marker = v.getUint8(p + 1)
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
      p += 2
      continue
    }
    if (marker === 0xD9)
      break
    const len = v.getUint16(p + 2)
    if (len < 2)
      break
    if (marker === 0xE1) {
      const o = readExifOrientation(v, p + 4, len - 2)
      if (o)
        orientation = o
    }
    else if (SOF.has(marker) && p + 9 <= n) {
      const h = v.getUint16(p + 5)
      const w = v.getUint16(p + 7)
      if (w > 0 && h > 0) {
        return orientation >= 5 && orientation <= 8 ? { w: h, h: w } : { w, h }
      }
    }
    p += 2 + len
  }
  return null
}
