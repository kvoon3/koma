import type { CloudAssetSummary } from './cloudApi'
import { describe, expect, test } from 'bun:test'
import { motionAssetIdFromMeta, photoRecordFromAsset, sessionPhotoMeta } from './cloudAsset'

const still = new File(['still'], 'p.jpg', { type: 'image/jpeg' })
const motion = new File(['motion'], 'p.mov', { type: 'video/quicktime' })

function asset(meta: string | null): CloudAssetSummary {
  return { id: 'p', kind: 'photo', name: 'p.jpg', trueW: 1, trueH: 1, meta, createdAt: '2026-01-01 00:00:00' }
}

describe('Live Photo motion metadata', () => {
  test('a still with motion names its second asset', () => {
    const meta = JSON.stringify(sessionPhotoMeta({ id: 'p', name: 'p.jpg', file: still, videoFile: motion, trueW: 1, trueH: 1 }))
    expect(motionAssetIdFromMeta(meta)).toBe('p~motion')
  })

  test('the downloaded still gets its motion file back', () => {
    const meta = JSON.stringify(sessionPhotoMeta({ id: 'p', name: 'p.jpg', file: still, videoFile: motion, trueW: 1, trueH: 1 }))
    const record = photoRecordFromAsset(asset(meta), still, motion)
    expect(record?.videoFile?.name).toBe('p.mov')
    expect(record?.videoFile?.size).toBe(6)
  })

  test('a still without motion stays a still', () => {
    const meta = JSON.stringify(sessionPhotoMeta({ id: 'p', name: 'p.jpg', file: still, trueW: 1, trueH: 1 }))
    expect(motionAssetIdFromMeta(meta)).toBeNull()
    expect(photoRecordFromAsset(asset(meta), still)?.videoFile).toBeUndefined()
  })
})
