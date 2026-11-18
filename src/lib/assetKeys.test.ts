import { describe, expect, test } from 'bun:test'
import { assetStorageKey, isAssetId, motionAssetId } from './assetKeys'

describe('assetStorageKey', () => {
  test('derives one flat key under the user prefix', () => {
    expect(assetStorageKey('user_1', 'photo-2')).toBe('assets/user_1/photo-2')
    expect(assetStorageKey('user_1', 'photo-2')).toBe(assetStorageKey('user_1', 'photo-2'))
  })

  test('keeps two users’ identical asset ids apart', () => {
    expect(assetStorageKey('user_1', 'same')).not.toBe(assetStorageKey('user_2', 'same'))
  })

  test('rejects an empty or separator-bearing part', () => {
    expect(assetStorageKey('', 'photo')).toBeNull()
    expect(assetStorageKey('user', '')).toBeNull()
    expect(assetStorageKey('user/1', 'photo')).toBeNull()
    expect(assetStorageKey('user', 'photo/1')).toBeNull()
    expect(assetStorageKey('..', 'photo')).toBeNull()
    expect(assetStorageKey('user', '..')).toBeNull()
  })

  test('rejects characters that would widen the key', () => {
    expect(isAssetId('photo 1')).toBe(false)
    expect(isAssetId('photo.1')).toBe(false)
    expect(isAssetId('photo:1')).toBe(false)
    expect(isAssetId('a'.repeat(129))).toBe(false)
  })
})

describe('motionAssetId', () => {
  test('derives a second id a real photo id cannot collide with', () => {
    expect(motionAssetId('photo-1')).toBe('photo-1~motion')
    expect(isAssetId(motionAssetId('photo-1') ?? '')).toBe(true)
  })

  test('refuses an unsafe still id or one too long for a derived id', () => {
    expect(motionAssetId('bad/id')).toBeNull()
    expect(motionAssetId('a'.repeat(122))).toBeNull()
  })
})
