/**
 * A small, dependency-free JPEG EXIF reader: just the two fields koma uses,
 * the camera's GPS fix and when the frame was taken.
 *
 * It only walks the APP1 (Exif) segment, so nothing outside a JPEG's header is
 * read and a 40 MB raw never enters memory. Every offset is bounds-checked
 * against the segment and malformed data returns null instead of throwing:
 * a broken EXIF block must degrade to "no location", never to a failed import.
 *
 * WGS-84: the GPS IFD already carries WGS-84 degrees; no Chinese shift here
 * (the district polygons are converted to WGS-84 at build time instead).
 */

export interface GpsFix {
  lat: number
  lng: number
}

export interface ExifData {
  /** WGS-84 camera fix, absent when the photo has no usable GPS tags. */
  gps?: GpsFix
  /** EXIF `DateTimeOriginal` as written by the camera (`2024:05:01 12:34:56`). */
  takenAt?: string
}

/** Type sizes of the TIFF field types we read; anything else is skipped. */
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }

const TAG_EXIF_IFD = 0x8769
const TAG_GPS_IFD = 0x8825
const TAG_DATETIME = 0x0132
const TAG_DATETIME_ORIGINAL = 0x9003

const GPS_LAT_REF = 0x0001
const GPS_LAT = 0x0002
const GPS_LNG_REF = 0x0003
const GPS_LNG = 0x0004

interface Field {
  type: number
  count: number
  /** Absolute byte offset of the value (either inline or at the pointed offset). */
  at: number
}

type Ifd = Map<number, Field>

/**
 * Walk the JPEG segments to the first APP1 segment that starts with `Exif\0\0`.
 * Returns the TIFF block's start and the segment end (both absolute), or null.
 */
function findExifSegment(bytes: Uint8Array, v: DataView): { tiff: number, end: number } | null {
  let p = 2
  while (p + 4 <= bytes.length) {
    if (bytes[p] !== 0xFF) {
      p++
      continue
    }
    const marker = bytes[p + 1]
    // Standalone markers: SOI, TEM, RSTn carry no length field.
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
      p += 2
      continue
    }
    // Start of scan: no metadata follows the compressed data.
    if (marker === 0xD9 || marker === 0xDA)
      return null
    const len = v.getUint16(p + 2)
    if (len < 2)
      return null
    const end = p + 2 + len
    if (end > bytes.length)
      return null
    if (marker === 0xE1 && len >= 8 && startsWithExif(bytes, p + 4, end))
      return { tiff: p + 10, end }
    p = end
  }
  return null
}

/** Read a JPEG's Exif block. Null when there is none or it is unusable. */
export function parseExif(input: ArrayBuffer | Uint8Array): ExifData | null {
  try {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
    if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8)
      return null
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const seg = findExifSegment(bytes, v)
    return seg ? parseTiff(v, seg.tiff, seg.end) : null
  }
  catch {
    return null
  }
}

const TAKEN_AT = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/

/**
 * `DateTimeOriginal` as a detail view shows it: `2024:05:01 12:34:56` becomes
 * `2024-05-01 12:34` (the EXIF colon date is a camera convention, not an ISO
 * one, so it is rewritten rather than handed to a Date parser). Null for
 * anything that is not that shape.
 */
export function formatTakenAt(raw: string | null | undefined): string | null {
  if (!raw)
    return null
  const m = TAKEN_AT.exec(raw.trim())
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : null
}

/** Read a photo's header (the APP1 block sits in the first 256 KB). */
export async function readExif(file: File): Promise<ExifData | null> {
  const jpeg = file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name)
  if (!jpeg)
    return null
  try {
    return parseExif(await file.slice(0, 262144).arrayBuffer())
  }
  catch {
    return null
  }
}

function startsWithExif(bytes: Uint8Array, at: number, end: number): boolean {
  if (at + 6 > end)
    return false
  return bytes[at] === 0x45 && bytes[at + 1] === 0x78 && bytes[at + 2] === 0x69
    && bytes[at + 3] === 0x66 && bytes[at + 4] === 0 && bytes[at + 5] === 0
}

/** One IFD: tag -> field, every value already bounds-checked against `end`. */
function readIfd(v: DataView, tiff: number, end: number, offset: number, little: boolean): Ifd | null {
  const at = tiff + offset
  if (offset < 8 || at + 2 > end)
    return null
  const n = v.getUint16(at, little)
  if (n > 512)
    return null
  const fields: Ifd = new Map()
  for (let i = 0; i < n; i++) {
    const e = at + 2 + i * 12
    if (e + 12 > end)
      return fields
    const tag = v.getUint16(e, little)
    const type = v.getUint16(e + 2, little)
    const count = v.getUint32(e + 4, little)
    const size = TYPE_SIZE[type]
    if (!size)
      continue
    const total = size * count
    if (total > end - tiff)
      continue
    const valueAt = total <= 4 ? e + 8 : tiff + v.getUint32(e + 8, little)
    if (valueAt < tiff || valueAt + total > end)
      continue
    fields.set(tag, { type, count, at: valueAt })
  }
  return fields
}

/** A LONG field's value (IFD pointers are count 1, therefore inline). */
function readLong(v: DataView, field: Field | undefined, little: boolean): number | null {
  if (!field || field.at + 4 > v.byteLength)
    return null
  return v.getUint32(field.at, little)
}

function readAscii(v: DataView, field: Field | undefined): string | null {
  if (!field || field.type !== 2 || field.count < 1)
    return null
  let s = ''
  for (let i = 0; i < field.count; i++) {
    const c = v.getUint8(field.at + i)
    if (c === 0)
      break
    s += String.fromCharCode(c)
  }
  return s.trim() || null
}

function readRationals(v: DataView, field: Field | undefined, little: boolean): number[] | null {
  if (!field || field.type !== 5 || field.count < 1 || field.count > 8)
    return null
  const out: number[] = []
  for (let i = 0; i < field.count; i++) {
    const num = v.getUint32(field.at + i * 8, little)
    const den = v.getUint32(field.at + i * 8 + 4, little)
    if (den <= 0)
      return null
    out.push(num / den)
  }
  return out
}

/** `DateTimeOriginal` from the Exif IFD, falling back to IFD0's `DateTime`. */
function readDate(v: DataView, ifd0: Ifd, tiff: number, end: number, little: boolean): string | null {
  const exifOffset = readLong(v, ifd0.get(TAG_EXIF_IFD), little)
  const exif = exifOffset == null ? null : readIfd(v, tiff, end, exifOffset, little)
  return (exif && readAscii(v, exif.get(TAG_DATETIME_ORIGINAL))) ?? readAscii(v, ifd0.get(TAG_DATETIME))
}

function readGps(v: DataView, ifd0: Ifd, tiff: number, end: number, little: boolean): GpsFix | null {
  const gpsOffset = readLong(v, ifd0.get(TAG_GPS_IFD), little)
  if (gpsOffset == null)
    return null
  const gps = readIfd(v, tiff, end, gpsOffset, little)
  if (!gps)
    return null
  const lat = dms(readRationals(v, gps.get(GPS_LAT), little), readAscii(v, gps.get(GPS_LAT_REF)))
  const lng = dms(readRationals(v, gps.get(GPS_LNG), little), readAscii(v, gps.get(GPS_LNG_REF)))
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return null
  return { lat, lng }
}

/**
 * TIFF block at `tiff`, bounded by `end` (the APP1 segment end). Every IFD and
 * value offset is relative to `tiff` and validated against that bound.
 */
function parseTiff(v: DataView, tiff: number, end: number): ExifData | null {
  if (tiff + 8 > end)
    return null
  const order = v.getUint16(tiff)
  if (order !== 0x4949 && order !== 0x4D4D)
    return null
  const little = order === 0x4949
  if (v.getUint16(tiff + 2, little) !== 0x002A)
    return null
  const ifd0Offset = v.getUint32(tiff + 4, little)
  const ifd0 = readIfd(v, tiff, end, ifd0Offset, little)
  if (!ifd0)
    return null
  const out: ExifData = {}
  const takenAt = readDate(v, ifd0, tiff, end, little)
  if (takenAt)
    out.takenAt = takenAt
  const gps = readGps(v, ifd0, tiff, end, little)
  if (gps)
    out.gps = gps
  return out.gps || out.takenAt ? out : null
}

/** Degrees + minutes/60 + seconds/3600, negated for S / W. */
function dms(parts: number[] | null, ref: string | null): number | null {
  if (!parts || parts.length < 3 || !ref)
    return null
  const [d, m, s] = parts
  if (d < 0 || m < 0 || m >= 60 || s < 0 || s >= 60)
    return null
  const value = d + m / 60 + s / 3600
  const sign = ref.toUpperCase()
  if (sign === 'S' || sign === 'W')
    return -value
  if (sign !== 'N' && sign !== 'E')
    return null
  return value
}
