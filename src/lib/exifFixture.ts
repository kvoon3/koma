/**
 * Test-only EXIF/JPEG fixtures: tiny but valid JPEGs with a hand-built APP1
 * (Exif) segment, so `exif.test.ts` and the browser e2e share one synthetic
 * camera file. Never imported by the app.
 *
 * The TIFF layout is written twice (little and big endian) on purpose: both
 * byte orders exist in real cameras and the parser has to read both.
 */

/** A valid 1×1 baseline JPEG. */
const BASE_JPEG_B64
  = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='

export interface ExifJpegOptions {
  /** WGS-84 latitude; sign picks the N/S ref. */
  lat?: number
  /** WGS-84 longitude; sign picks the E/W ref. */
  lng?: number
  /** EXIF DateTimeOriginal; omit for no timestamp tag. */
  takenAt?: string
  /** Motorola byte order (MM) instead of Intel (II). */
  bigEndian?: boolean
  /** No GPS IFD pointer at all, just the Exif IFD. */
  omitGps?: boolean
  /** No DateTimeOriginal tag either: an Exif block with nothing usable. */
  omitDate?: boolean
  /** Point the GPS IFD past the buffer: malformed, must parse to null. */
  corruptGpsPointer?: boolean
}

export function baseJpeg(): Uint8Array<ArrayBuffer> {
  return fromBase64(BASE_JPEG_B64)
}

/** A valid JPEG that carries no Exif segment at all. */
export function plainJpeg(): Uint8Array<ArrayBuffer> {
  return baseJpeg()
}

/**
 * A valid JPEG with an Exif APP1 segment.
 *
 * The byte layout is deliberately one straight sequence (offset arithmetic,
 * then each IFD, then the data area); splitting it would make the offsets
 * harder to follow, so the complexity rule is waived for this test helper.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
export function exifJpeg(opts: ExifJpegOptions = {}): Uint8Array<ArrayBuffer> {
  const lat = opts.lat ?? 30.259
  const lng = opts.lng ?? 120.13
  const takenAt = opts.takenAt ?? '2024:05:01 12:34:56'
  const little = !opts.bigEndian
  const bytes: number[] = []
  const base = baseJpeg()
  // SOI
  bytes.push(base[0], base[1])

  const tiff: number[] = []
  const u16 = (n: number) => {
    tiff.push(...(little ? [n & 0xFF, (n >> 8) & 0xFF] : [(n >> 8) & 0xFF, n & 0xFF]))
  }
  const u32 = (n: number) => {
    tiff.push(...(little
      ? [n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >>> 24) & 0xFF]
      : [(n >>> 24) & 0xFF, (n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF]))
  }
  const ascii = (s: string) => [...s].map(c => c.charCodeAt(0))

  // Offsets are relative to the TIFF header. IFDs come first, then their data.
  const IFD0 = 8
  const IFD0_COUNT = opts.omitGps ? 1 : 2
  const EXIF_COUNT = opts.omitDate ? 0 : 1
  const EXIF_IFD = IFD0 + 2 + IFD0_COUNT * 12 + 4
  const GPS_IFD = EXIF_IFD + 2 + EXIF_COUNT * 12 + 4
  const GPS_SIZE = 2 + 4 * 12 + 4
  const DATA = opts.omitGps ? GPS_IFD : GPS_IFD + GPS_SIZE
  const DATE_LEN = takenAt.length + 1
  const DATE_AT = DATA
  const LAT_AT = DATE_AT + DATE_LEN
  const LNG_AT = LAT_AT + 24

  const entry = (tag: number, type: number, count: number, value: (at: number) => void) => {
    u16(tag)
    u16(type)
    u32(count)
    value(tiff.length + 4)
  }
  const inlineU32 = (n: number) => () => u32(n)
  const inlineAscii = (s: string) => () => {
    const raw = ascii(s)
    for (let i = 0; i < 4; i++)
      tiff.push(raw[i] ?? 0)
  }

  // TIFF header
  if (little)
    tiff.push(0x49, 0x49)
  else
    tiff.push(0x4D, 0x4D)
  u16(0x002A)
  u32(IFD0)

  // IFD0: Exif IFD pointer, GPS IFD pointer
  u16(IFD0_COUNT)
  entry(0x8769, 4, 1, inlineU32(EXIF_IFD))
  if (!opts.omitGps)
    entry(0x8825, 4, 1, inlineU32(opts.corruptGpsPointer ? 0xFFFF : GPS_IFD))
  u32(0)

  // Exif IFD: DateTimeOriginal
  u16(EXIF_COUNT)
  if (!opts.omitDate)
    entry(0x9003, 2, DATE_LEN, inlineU32(DATE_AT))
  u32(0)

  // GPS IFD: refs + rational DMS
  if (!opts.omitGps) {
    u16(4)
    entry(0x0001, 2, 2, inlineAscii(lat < 0 ? 'S' : 'N'))
    entry(0x0002, 5, 3, inlineU32(LAT_AT))
    entry(0x0003, 2, 2, inlineAscii(lng < 0 ? 'W' : 'E'))
    entry(0x0004, 5, 3, inlineU32(LNG_AT))
    u32(0)
  }

  // Data area
  if (!opts.omitDate) {
    for (const c of ascii(takenAt))
      tiff.push(c)
    tiff.push(0)
  }
  const rational = (value: number) => {
    const abs = Math.abs(value)
    const deg = Math.floor(abs)
    const min = Math.floor((abs - deg) * 60)
    const sec = (abs - deg - min / 60) * 3600
    u32(deg)
    u32(1)
    u32(min)
    u32(1)
    u32(Math.round(sec * 10000))
    u32(10000)
  }
  rational(lat)
  rational(lng)

  const app1 = [0xFF, 0xE1]
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  const len = payload.length + 2
  app1.push((len >> 8) & 0xFF, len & 0xFF)
  bytes.push(...app1, ...payload)
  // The rest of the base JPEG (everything after SOI).
  bytes.push(...base.slice(2))
  return new Uint8Array(bytes)
}

/** The same GPS JPEG cut in the middle of its APP1 segment. */
export function truncatedExifJpeg(): Uint8Array<ArrayBuffer> {
  const full = exifJpeg()
  return full.slice(0, 40)
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++)
    out[i] = bin.charCodeAt(i)
  return out
}
