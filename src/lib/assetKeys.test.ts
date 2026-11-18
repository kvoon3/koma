import { describe, expect, test } from 'bun:test'
import { assetStorageKey, isAssetId } from './assetKeys'

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
    expect(isAssetId('photo~1')).toBe(false)
    expect(isAssetId('a'.repeat(129))).toBe(false)
  })
})
