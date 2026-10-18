/// <reference types="bun" />
import { describe, expect, it } from 'bun:test'
import { parseExif, readExif } from './exif'
import { baseJpeg, exifJpeg, plainJpeg, truncatedExifJpeg } from './exifFixture'

const near = (a: number, b: number) => Math.abs(a - b) < 0.0005

describe('parseExif', () => {
  it('reads GPS degrees/minutes/seconds and the date, little-endian, N/E', () => {
    const exif = parseExif(exifJpeg({ lat: 30.259, lng: 120.13 }))
    expect(exif?.gps).toBeDefined()
    expect(near(exif!.gps!.lat, 30.259)).toBe(true)
    expect(near(exif!.gps!.lng, 120.13)).toBe(true)
    expect(exif?.takenAt).toBe('2024:05:01 12:34:56')
  })

  it('reads a big-endian (MM) block and applies the S / W hemisphere signs', () => {
    const exif = parseExif(exifJpeg({ lat: -33.8688, lng: -70.6693, bigEndian: true, takenAt: '2020:12:31 23:59:59' }))
    expect(exif?.gps).toBeDefined()
    expect(exif!.gps!.lat).toBeLessThan(0)
    expect(exif!.gps!.lng).toBeLessThan(0)
    expect(near(exif!.gps!.lat, -33.8688)).toBe(true)
    expect(near(exif!.gps!.lng, -70.6693)).toBe(true)
    expect(exif?.takenAt).toBe('2020:12:31 23:59:59')
  })

  it('returns null for a JPEG with no Exif segment', () => {
    expect(parseExif(plainJpeg())).toBeNull()
    expect(parseExif(baseJpeg())).toBeNull()
  })

  it('returns null, and never throws, for truncated or garbage input', () => {
    expect(parseExif(truncatedExifJpeg())).toBeNull()
    expect(parseExif(new Uint8Array([0xFF, 0xD8, 0xFF, 0xE1, 0xFF, 0xFF]))).toBeNull()
    expect(parseExif(new Uint8Array(0))).toBeNull()
    expect(parseExif(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull()
  })

  it('keeps the date but drops GPS when the GPS IFD pointer is malformed', () => {
    const exif = parseExif(exifJpeg({ corruptGpsPointer: true }))
    expect(exif?.gps).toBeUndefined()
    expect(exif?.takenAt).toBe('2024:05:01 12:34:56')
  })

  it('returns null when the photo has neither GPS nor a date', () => {
    expect(parseExif(exifJpeg({ omitGps: true, omitDate: true }))).toBeNull()
  })
})

describe('readExif', () => {
  it('reads the APP1 header of a File', async () => {
    const bytes = exifJpeg({ lat: 39.9087, lng: 116.3975 })
    const exif = await readExif(new File([bytes], 'IMG_0001.JPG', { type: 'image/jpeg' }))
    expect(near(exif!.gps!.lat, 39.9087)).toBe(true)
    expect(near(exif!.gps!.lng, 116.3975)).toBe(true)
  })

  it('ignores non-JPEG files', async () => {
    expect(await readExif(new File([baseJpeg()], 'note.txt', { type: 'text/plain' }))).toBeNull()
  })
})
