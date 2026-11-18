import type { CloudAssetSummary } from './cloudApi'
import { describe, expect, test } from 'bun:test'
import {
  motionAssetIdFromMeta,
  motionFillTargets,
  photoRecordFromAsset,
  sessionPhotoMeta,
  stillRowNeedsWrite,
} from './cloudAsset'

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

describe('stillRowNeedsWrite', () => {
  test('a new still is written', () => {
    expect(stillRowNeedsWrite('p', false, new Set())).toBe(true)
  })

  test('a known still without new motion is skipped', () => {
    expect(stillRowNeedsWrite('p', false, new Set(['p']))).toBe(false)
    expect(stillRowNeedsWrite('p', true, new Set(['p', 'p~motion']))).toBe(false)
  })

  test('a known still rewrites when its motion is new so meta can name it', () => {
    expect(stillRowNeedsWrite('p', true, new Set(['p']))).toBe(true)
  })
})

describe('motionFillTargets', () => {
  test('a local still without videoFile follows cloud meta to its motion id', () => {
    const meta = JSON.stringify({ motionAssetId: 'p~motion' })
    const local = new Map([['p', { videoFile: undefined }]])
    const metas = new Map([['p', meta]])
    expect(motionFillTargets(['p'], local, metas)).toEqual([{ photoId: 'p', motionId: 'p~motion' }])
  })

  test('a local Live Photo is left alone', () => {
    const meta = JSON.stringify({ motionAssetId: 'p~motion' })
    const local = new Map([['p', { videoFile: motion }]])
    const metas = new Map([['p', meta]])
    expect(motionFillTargets(['p'], local, metas)).toEqual([])
  })

  test('cloud meta without motion yields nothing', () => {
    const local = new Map([['p', { videoFile: undefined }]])
    const metas = new Map([['p', JSON.stringify({})]])
    expect(motionFillTargets(['p'], local, metas)).toEqual([])
  })
})
