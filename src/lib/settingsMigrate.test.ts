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
  test('version is 7', () => {
    expect(SETTINGS_VERSION).toBe(8)
  })
  test('v1 → v2 adds dock defaults and starts in row', () => {
    expect(migrateSettings({ gap: 2, blendCrossfade: false }, 1)).toMatchObject({
      gap: 2,
      blendCrossfade: false,
      dockBg: DOCK_BG,
      dockOpacity: DOCK_OPACITY,
      toolsDockMode: 'row',
    })
  })
  test('v2 values are kept', () => {
    const v = { dockBg: 'liquid', dockOpacity: 30, toolsDockMode: 'row' }
    expect(migrateSettings({ ...v, dockHandleIcon: 'sliders' }, 2)).toMatchObject(v)
    expect(migrateSettings({ dockBg: 'frosted' }, 5).dockBg).toBe('frosted')
  })
  test('invalid values are sanitized', () => {
    expect(migrateSettings({ dockBg: 'neon', dockOpacity: 400, toolsDockMode: 'huge' }, 2)).toMatchObject({
      dockBg: DOCK_BG,
      dockOpacity: 100,
      toolsDockMode: 'row',
    })
  })
  test('null persisted state', () => {
    expect(migrateSettings(null, 0).toolsDockMode).toBe('row')
  })
})

describe('migrateSettings v4', () => {
  test('saved transparent dock style → default', () => {
    expect(migrateSettings({ dockBg: 'transparent', dockOpacity: 40 }, 3)).toMatchObject({ dockBg: DOCK_BG, dockOpacity: 40 })
  })
  test('v3 liquid is kept', () => {
    expect(migrateSettings({ dockBg: 'liquid' }, 3).dockBg).toBe('liquid')
  })
})

describe('migrateSettings v5', () => {
  test('default is solid', () => {
    expect(DOCK_BG).toBe('solid')
  })
  test('pre-v5 frosted (old default) → solid; liquid kept', () => {
    expect(migrateSettings({ dockBg: 'frosted' }, 4).dockBg).toBe('solid')
    expect(migrateSettings({ dockBg: 'liquid' }, 4).dockBg).toBe('liquid')
  })

  test('v5 → v6 resets the saved dock mode to row once', () => {
    expect(migrateSettings({ toolsDockMode: 'collapsed' }, 5).toolsDockMode).toBe('row')
    expect(migrateSettings({ toolsDockMode: 'expanded' }, 5).toolsDockMode).toBe('row')
  })
})

describe('migrateSettings dock rework (collapsed removed)', () => {
  test('a saved post-v6 collapsed becomes the icon-only row', () => {
    expect(migrateSettings({ toolsDockMode: 'collapsed' }, 6).toolsDockMode).toBe('icons')
    expect(migrateSettings({ toolsDockMode: 'collapsed' }, 8).toolsDockMode).toBe('icons')
  })
  test('the other displays survive untouched', () => {
    expect(migrateSettings({ toolsDockMode: 'icons' }, 8).toolsDockMode).toBe('icons')
    expect(migrateSettings({ toolsDockMode: 'row' }, 8).toolsDockMode).toBe('row')
    expect(migrateSettings({ toolsDockMode: 'expanded' }, 8).toolsDockMode).toBe('expanded')
  })
  test('an unknown mode still falls back to the labelled row', () => {
    expect(migrateSettings({ toolsDockMode: 'hidden' }, 8).toolsDockMode).toBe('row')
  })
})

describe('migrateSettings v7', () => {
  test('adds the 1:1 grid cell ratio; keeps valid, fixes invalid', () => {
    expect(migrateSettings({}, 6).gridCellRatio).toBe('1:1')
    expect(migrateSettings({ gridCellRatio: '4:5' }, 6).gridCellRatio).toBe('4:5')
    expect(migrateSettings({ gridCellRatio: '2:1' }, 6).gridCellRatio).toBe('1:1')
  })
})

describe('migrateSettings v8 (collage background)', () => {
  test('pre-v8 gets no gradient and no photo', () => {
    expect(migrateSettings({ bg: '#ffffff' }, 7)).toMatchObject({ bg: '#ffffff', bgGradient: null, bgImage: null })
    expect(migrateSettings({}, 0)).toMatchObject({ bgGradient: null, bgImage: null })
  })
  test('v8 values are kept', () => {
    const bgImage = { photoId: 'p1', blur: true }
    expect(migrateSettings({ bgGradient: '#ff0000', bgImage }, 8)).toMatchObject({ bgGradient: '#ff0000', bgImage })
  })
})
