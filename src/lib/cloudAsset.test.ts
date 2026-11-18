import type { CloudAssetSummary } from './cloudApi'
import { describe, expect, test } from 'bun:test'
import { photoRecordFromAsset, sessionPhotoMeta } from './cloudAsset'

const still = new File(['still'], 'p.jpg', { type: 'image/jpeg' })
const motion = new File(['motion'], 'p.mov', { type: 'video/quicktime' })

function asset(meta: string | null): CloudAssetSummary {
  return { id: 'p', kind: 'photo', name: 'p.jpg', trueW: 1, trueH: 1, meta, createdAt: '2026-01-01 00:00:00' }
}

describe('sessionPhotoMeta', () => {
  test('keeps tags and dims fields without naming Live Photo motion', () => {
    const meta = sessionPhotoMeta({
      id: 'p',
      name: 'p.jpg',
      file: still,
      videoFile: motion,
      trueW: 1,
      trueH: 1,
      tags: ['a'],
    })
    expect(meta).toEqual({ tags: ['a'] })
    expect('motionAssetId' in meta).toBe(false)
  })
})

describe('photoRecordFromAsset', () => {
  test('rebuilds a still from the row and file', () => {
    const meta = JSON.stringify(sessionPhotoMeta({ id: 'p', name: 'p.jpg', file: still, trueW: 1, trueH: 1 }))
    const record = photoRecordFromAsset(asset(meta), still)
    expect(record?.id).toBe('p')
    expect(record?.videoFile).toBeUndefined()
  })
})
