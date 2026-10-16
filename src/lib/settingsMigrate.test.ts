/// <reference types="bun" />
import { describe, expect, test } from 'bun:test'
import { BLEND_CROSSFADE, DOCK_BG, DOCK_OPACITY, migrateSettings, SETTINGS_VERSION } from '../store'

describe('migrateSettings', () => {
  test('crossfade is the default', () => {
    expect(BLEND_CROSSFADE).toBe(true)
  })
  test('v0 stored false (old default) → on', () => {
    expect(migrateSettings({ gap: 4, blendCrossfade: false }, 0)).toMatchObject({ gap: 4, blendCrossfade: true })
  })
  test('v0 without the key → on', () => {
    expect(migrateSettings({ gap: 4 }, 0).blendCrossfade).toBe(true)
  })
  test('v1 explicit off is kept', () => {
    expect(migrateSettings({ blendCrossfade: false }, 1).blendCrossfade).toBe(false)
  })
})

describe('migrateSettings v2 (dock)', () => {
  test('version is 3', () => {
    expect(SETTINGS_VERSION).toBe(3)
  })
  test('v1 → v2 adds dock defaults and starts collapsed', () => {
    expect(migrateSettings({ gap: 2, blendCrossfade: false }, 1)).toEqual({
      gap: 2,
      blendCrossfade: false,
      dockBg: DOCK_BG,
      dockOpacity: DOCK_OPACITY,
      toolsDockMode: 'collapsed',
    })
  })
  test('v2 values are kept', () => {
    const v = { dockBg: 'liquid', dockOpacity: 30, toolsDockMode: 'row' }
    expect(migrateSettings({ ...v, dockHandleIcon: 'sliders' }, 2)).toEqual(v)
  })
  test('invalid values are sanitized', () => {
    expect(migrateSettings({ dockBg: 'neon', dockOpacity: 400, toolsDockMode: 'huge' }, 2)).toEqual({
      dockBg: DOCK_BG,
      dockOpacity: 100,
      toolsDockMode: 'collapsed',
    })
  })
  test('null persisted state', () => {
    expect(migrateSettings(null, 0).toolsDockMode).toBe('collapsed')
  })
})
