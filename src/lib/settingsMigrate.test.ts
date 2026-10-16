/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { BLEND_CROSSFADE, migrateSettings } from '../store'

describe('migrateSettings', () => {
  test('crossfade is the default', () => {
    expect(BLEND_CROSSFADE).toBe(true)
  })
  test('v0 stored false (old default) → on', () => {
    expect(migrateSettings({ gap: 4, blendCrossfade: false }, 0)).toEqual({ gap: 4, blendCrossfade: true, bgGradient: null, bgImage: null })
  })
  test('v0 without the key → on', () => {
    expect(migrateSettings({ gap: 4 }, 0).blendCrossfade).toBe(true)
  })
  test('v1 explicit off is kept', () => {
    expect(migrateSettings({ blendCrossfade: false }, 1).blendCrossfade).toBe(false)
  })
})

describe('migrateSettings v2 (collage background)', () => {
  test('v1 gets no gradient and no photo', () => {
    const p = migrateSettings({ bg: '#ffffff' }, 1)
    expect(p).toEqual({ bg: '#ffffff', bgGradient: null, bgImage: null })
  })
  test('v2 values are kept', () => {
    const bgImage = { photoId: 'p1', blur: true }
    expect(migrateSettings({ bgGradient: '#ff0000', bgImage }, 2)).toEqual({ bgGradient: '#ff0000', bgImage })
  })
})
