/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { BLEND_CROSSFADE, migrateSettings } from '../store'

describe('migrateSettings', () => {
  test('crossfade is the default', () => {
    expect(BLEND_CROSSFADE).toBe(true)
  })
  test('v0 stored false (old default) → on', () => {
    expect(migrateSettings({ gap: 4, blendCrossfade: false }, 0)).toEqual({ gap: 4, blendCrossfade: true })
  })
  test('v0 without the key → on', () => {
    expect(migrateSettings({ gap: 4 }, 0).blendCrossfade).toBe(true)
  })
  test('v1 explicit off is kept', () => {
    expect(migrateSettings({ blendCrossfade: false }, 1).blendCrossfade).toBe(false)
  })
})
